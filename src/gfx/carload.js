import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { CFG } from '../config.js';

// Loads a car from a glTF/GLB and adapts it to the same interface the
// procedural model exposes, so nothing downstream has to care which it is.
//
// Requirements a model has to meet:
//   - roughly car-shaped, longest axis forward
//   - wheels as separate nodes named *_fl / *_fr / *_rl / *_rr, or containing
//     "wheel"; without those the wheels cannot spin or steer
//   - a material to recolour per livery (matched by name, see BODY_MATCH)

const BODY_MATCH = /body|paint|carrosserie/i;
const WHEEL_MATCH = /wheel/i;
const FRONT_MATCH = /_f[lr]\b|front/i;

function normalise(root) {
  // Scale so the model is exactly the length the simulation assumes, sit it on
  // the ground, and centre it laterally.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.z);
  if (size.x > size.z) root.rotation.y = Math.PI / 2; // lying across, turn it
  root.updateMatrixWorld(true);

  const scale = CFG.car.LENGTH / longest;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const b2 = new THREE.Box3().setFromObject(root);
  const c2 = b2.getCenter(new THREE.Vector3());
  root.position.x -= c2.x;
  root.position.z -= c2.z;
  root.position.y -= b2.min.y;
  return root;
}

export async function loadCarFactory(url) {
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('./vendor/three/addons/libs/draco/gltf/');
  loader.setDRACOLoader(draco);

  const gltf = await loader.loadAsync(url);
  const template = gltf.scene;
  template.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = false;
    if (o.material) o.material.envMapIntensity = 1.4;
  });

  return function buildFromModel(color, opts = {}) {
    const g = new THREE.Group();
    const inst = template.clone(true);

    // Clone materials so a livery on one car does not repaint the field.
    const seen = new Map();
    inst.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const src = Array.isArray(o.material) ? o.material : [o.material];
      const out = src.map((m) => {
        let c = seen.get(m);
        if (!c) { c = m.clone(); seen.set(m, c); }
        if (BODY_MATCH.test(m.name || '')) {
          c.color = new THREE.Color(color);
          if (opts.player && 'clearcoat' in c) c.clearcoat = 1.0;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });

    g.add(inst);
    normalise(inst);

    const wheels = [];
    inst.traverse((o) => {
      if (!WHEEL_MATCH.test(o.name || '')) return;
      // Only the top-most wheel node; the model nests rim/tyre/brake under it.
      if (o.parent && WHEEL_MATCH.test(o.parent.name || '')) return;
      o.rotation.order = 'YXZ'; // steer about Y, then spin about X
      wheels.push({ node: o, front: FRONT_MATCH.test(o.name || '') });
    });

    g.userData = { wheels, spinAngle: 0, fromModel: true };
    return g;
  };
}

// Matches the procedural model's updateWheels, but drives glTF nodes.
export function updateModelWheels(car, speed, steer, dt) {
  const d = car.userData;
  if (!d || !d.wheels || !d.wheels.length) return;
  const strobe = THREE.MathUtils.smoothstep(Math.abs(speed), 22, 34);
  d.spinAngle += (speed / CFG.car.WHEEL_RADIUS) * (1 - strobe * 0.84) * dt;
  for (const w of d.wheels) {
    w.node.rotation.x = d.spinAngle;
    if (w.front) w.node.rotation.y = steer;
  }
}
