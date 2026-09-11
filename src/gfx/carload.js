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

const BODY_MATCH = /body|paint|carrosserie|chassis/i;
const WHEEL_MATCH = /wheel|tyre|tire|rim/i;
const FRONT_MATCH = /_f[lr]\b|front|_fl|_fr/i;
const NON_BODY = /glass|window|screen|tyre|tire|rubber|light|lamp|chrome|interior|seat|carpet|leather/i;

function normalise(root) {
  // Scale so the model is exactly the length the simulation assumes, sit it on
  // the ground, and centre it laterally.
  let box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) root.rotation.y = Math.PI / 2; // lying across, turn it
  root.updateMatrixWorld(true);

  box = new THREE.Box3().setFromObject(root);
  const s2 = box.getSize(new THREE.Vector3());
  root.scale.setScalar(CFG.car.LENGTH / Math.max(s2.z, 1e-6));
  root.updateMatrixWorld(true);

  const b3 = new THREE.Box3().setFromObject(root);
  const c3 = b3.getCenter(new THREE.Vector3());
  root.position.x -= c3.x;
  root.position.z -= c3.z;
  root.position.y -= b3.min.y;
  root.updateMatrixWorld(true);
  return root;
}

// Wheels by name where the model provides them, and by GEOMETRY where it does
// not -- which is most models. Rejecting a perfectly good car because its
// author called the parts "Circle.003" would be absurd.
//
// A wheel is: low to the ground, well off the centre line, and small relative
// to the car. Group whatever matches into four quadrants and give each its own
// pivot, so it can spin and steer regardless of where the mesh origin sits.
export function findWheels(inst) {
  const named = [];
  inst.traverse((o) => {
    if (!o.isMesh && !o.isGroup) return;
    if (!WHEEL_MATCH.test(o.name || '')) return;
    if (o.parent && WHEEL_MATCH.test(o.parent.name || '')) return;
    named.push(o);
  });
  if (named.length >= 3) {
    for (const n of named) n.rotation.order = 'YXZ';
    return named.map((n) => ({ node: n, front: FRONT_MATCH.test(n.name || '') }));
  }

  inst.updateMatrixWorld(true);
  const whole = new THREE.Box3().setFromObject(inst);
  const size = whole.getSize(new THREE.Vector3());
  const mid = whole.getCenter(new THREE.Vector3());

  const quads = new Map();
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  const sz = new THREE.Vector3();
  inst.traverse((o) => {
    if (!o.isMesh) return;
    box.setFromObject(o);
    box.getCenter(c);
    box.getSize(sz);
    const lowEnough = c.y < whole.min.y + size.y * 0.52;
    const outboard = Math.abs(c.x - mid.x) > size.x * 0.18;
    const smallEnough = sz.z < size.z * 0.34 && sz.x < size.x * 0.45;
    const roundish = Math.abs(sz.y - sz.z) < Math.max(sz.y, sz.z) * 0.55;
    if (!(lowEnough && outboard && smallEnough && roundish)) return;
    const key = `${c.x > mid.x ? 'r' : 'l'}${c.z > mid.z ? 'b' : 'f'}`;
    if (!quads.has(key)) quads.set(key, []);
    quads.get(key).push({ mesh: o, centre: c.clone() });
  });

  const wheels = [];
  for (const [key, items] of quads) {
    const centre = new THREE.Vector3();
    for (const it of items) centre.add(it.centre);
    centre.divideScalar(items.length);

    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.copy(inst.worldToLocal(centre.clone()));
    inst.add(pivot);
    // attach() keeps each mesh where it already is in the world.
    for (const it of items) pivot.attach(it.mesh);
    wheels.push({ node: pivot, front: key[1] === 'f' });
  }
  return wheels;
}

// The body material by name, or failing that the one covering the most of the
// car once glass, rubber, lights and trim are excluded.
export function findBodyMaterial(inst) {
  const byName = [];
  const area = new Map();
  inst.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const g = o.geometry;
    const count = g?.index ? g.index.count : (g?.attributes?.position?.count || 0);
    for (const m of mats) {
      if (BODY_MATCH.test(m.name || '')) byName.push(m);
      if (NON_BODY.test(m.name || '')) continue;
      if (m.transparent || (m.color && m.color.getHSL({ h: 0, s: 0, l: 0 }).l < 0.06)) continue;
      area.set(m, (area.get(m) || 0) + count);
    }
  });
  if (byName.length) return new Set(byName);
  let best = null;
  let bestArea = -1;
  for (const [m, a] of area) if (a > bestArea) { bestArea = a; best = m; }
  return new Set(best ? [best] : []);
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

    const bodyMats = findBodyMaterial(inst);

    // Clone materials so a livery on one car does not repaint the field.
    const seen = new Map();
    inst.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const src = Array.isArray(o.material) ? o.material : [o.material];
      const out = src.map((m) => {
        let c = seen.get(m);
        if (!c) { c = m.clone(); seen.set(m, c); }
        if (bodyMats.has(m)) {
          c.color = new THREE.Color(color);
          if (opts.player && 'clearcoat' in c) c.clearcoat = 1.0;
        }
        return c;
      });
      o.material = Array.isArray(o.material) ? out : out[0];
    });

    g.add(inst);
    normalise(inst);

    const wheels = findWheels(inst);
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
