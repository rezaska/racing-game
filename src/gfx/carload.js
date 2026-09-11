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
// Split a merged mesh into body + wheels by connected component.
//
// Plenty of downloaded cars arrive as a single mesh with a single material --
// Sketchfab's FBX conversion does this routinely. The parts are merged but not
// WELDED, so the wheels are still separate islands of geometry and can be
// recovered: flood-fill the triangles, then keep the islands that look like
// wheels (thin along X, circular in YZ, low, outboard) and lift them onto their
// own pivots.
function splitMergedMesh(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const index = geo.index;
  if (!index || !pos) return null;

  const nv = pos.count;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
  const ia = index.array;
  for (let i = 0; i < ia.length; i += 3) { uni(ia[i], ia[i + 1]); uni(ia[i + 1], ia[i + 2]); }

  // Bounds per component, and the whole car.
  const comp = new Map();
  const whole = { mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] };
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    let c = comp.get(r);
    if (!c) { c = { mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] }; comp.set(r, c); }
    for (let k = 0; k < 3; k++) {
      const q = pos.array[v * 3 + k];
      if (q < c.mn[k]) c.mn[k] = q;
      if (q > c.mx[k]) c.mx[k] = q;
      if (q < whole.mn[k]) whole.mn[k] = q;
      if (q > whole.mx[k]) whole.mx[k] = q;
    }
  }
  const carLen = Math.max(whole.mx[2] - whole.mn[2], whole.mx[0] - whole.mn[0]);
  const carH = whole.mx[1] - whole.mn[1];
  const carW = whole.mx[0] - whole.mn[0];

  const wheelRoots = new Set();
  for (const [root, c] of comp) {
    const sx = c.mx[0] - c.mn[0];
    const sy = c.mx[1] - c.mn[1];
    const sz = c.mx[2] - c.mn[2];
    const cy = (c.mx[1] + c.mn[1]) / 2;
    const cx = (c.mx[0] + c.mn[0]) / 2;
    const round = Math.abs(sy - sz) < Math.max(sy, sz) * 0.3;   // circular in YZ
    const thin = sx < Math.max(sy, sz) * 0.75;                  // thin along the axle
    const low = cy < whole.mn[1] + carH * 0.45;
    const outboard = Math.abs(cx - (whole.mx[0] + whole.mn[0]) / 2) > carW * 0.12;
    const sized = sy > carLen * 0.04 && sy < carLen * 0.30;
    if (round && thin && low && outboard && sized) wheelRoots.add(root);
  }
  if (wheelRoots.size < 2) return null;

  // Assign each wheel triangle to a quadrant.
  const midX = (whole.mx[0] + whole.mn[0]) / 2;
  const midZ = (whole.mx[2] + whole.mn[2]) / 2;
  const buckets = new Map();
  const bodyTris = [];
  for (let i = 0; i < ia.length; i += 3) {
    const root = find(ia[i]);
    if (!wheelRoots.has(root)) { bodyTris.push(i); continue; }
    const c = comp.get(root);
    const cx = (c.mx[0] + c.mn[0]) / 2;
    const cz = (c.mx[2] + c.mn[2]) / 2;
    const key = `${cx > midX ? 'r' : 'l'}${cz > midZ ? 'b' : 'f'}`;
    if (!buckets.has(key)) buckets.set(key, { tris: [], mn: [Infinity, Infinity, Infinity], mx: [-Infinity, -Infinity, -Infinity] });
    const bk = buckets.get(key);
    bk.tris.push(i);
    for (let k = 0; k < 3; k++) { if (c.mn[k] < bk.mn[k]) bk.mn[k] = c.mn[k]; if (c.mx[k] > bk.mx[k]) bk.mx[k] = c.mx[k]; }
  }
  if (buckets.size < 2) return null;

  // Rebuild a geometry from a list of triangle starts, optionally recentred.
  const build = (tris, centre) => {
    const g = new THREE.BufferGeometry();
    const map = new Map();
    const idxOut = [];
    const attrs = {};
    for (const name of Object.keys(geo.attributes)) attrs[name] = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const v = ia[t + k];
        let ni = map.get(v);
        if (ni === undefined) {
          ni = map.size;
          map.set(v, ni);
          for (const name of Object.keys(geo.attributes)) {
            const a = geo.attributes[name];
            for (let c2 = 0; c2 < a.itemSize; c2++) {
              let val = a.array[v * a.itemSize + c2];
              if (name === 'position' && centre) val -= centre[c2];
              attrs[name].push(val);
            }
          }
        }
        idxOut.push(ni);
      }
    }
    for (const name of Object.keys(geo.attributes)) {
      g.setAttribute(name, new THREE.Float32BufferAttribute(attrs[name], geo.attributes[name].itemSize));
    }
    g.setIndex(idxOut);
    g.computeBoundingSphere();
    return g;
  };

  const parentObj = mesh.parent;
  const wheels = [];
  for (const [key, bk] of buckets) {
    const centre = [0, 1, 2].map((k) => (bk.mx[k] + bk.mn[k]) / 2);
    const wm = new THREE.Mesh(build(bk.tris, centre), mesh.material);
    wm.castShadow = true;
    const pivot = new THREE.Group();
    pivot.rotation.order = 'YXZ';
    pivot.position.set(centre[0], centre[1], centre[2]);
    pivot.add(wm);
    parentObj.add(pivot);
    wheels.push({ node: pivot, front: key[1] === 'f' });
  }

  mesh.geometry = build(bodyTris, null);
  return wheels;
}

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

  if (quads.size < 2) {
    // Last resort: the car is one merged mesh. Split it by island.
    let merged = null;
    inst.traverse((o) => { if (!merged && o.isMesh) merged = o; });
    if (merged) {
      const split = splitMergedMesh(merged);
      if (split && split.length >= 2) return split;
    }
    return [];
  }

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
          if (c.map) {
            // Textured bodywork: the livery colour MULTIPLIES the artwork, so
            // applying it straight crushes a dark paint job to black. Shift the
            // hue only, and lift the player's car so it reads against the field.
            const hsl = {};
            new THREE.Color(color).getHSL(hsl);
            c.color.setHSL(hsl.h, hsl.s * 0.40, 0.88).multiplyScalar(opts.player ? 1.85 : 1.12);
          } else {
            c.color = new THREE.Color(color);
          }
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
