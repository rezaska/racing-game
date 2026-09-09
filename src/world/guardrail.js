import * as THREE from 'three';
import { CFG } from '../config.js';

// Guardrails swept along the track spline, one ribbon per chunk per side.
//
// Instancing straight rail segments does not work here: on a 93 m radius the
// joins kink visibly and leave gaps. Sweeping a cross-section along the same
// station loop the road uses gives a continuous ribbon that follows every
// curve and crest exactly.
//
// Rails only go where a rail would go -- the outside of a real bend. Running
// them down both sides for two kilometres looks like a bobsleigh run.

// W-profile: (height above the verge, outward offset in metres).
const PROFILE = [
  [0.42, 0.00], [0.56, 0.09], [0.68, 0.02], [0.80, 0.09], [0.90, 0.02],
];

const RAIL_X = 1.34;   // half-widths from the centre line
const MIN_CURVE = 2.6; // below this a bend does not warrant a barrier
const RUN_IN = 26;     // stations of lead-in/out so rails do not start abruptly

// Which stations get a rail, per side. Computed from the course, then dilated
// so a rail begins before the bend and ends after it.
function railMask(t3) {
  const n = t3.n;
  const left = new Uint8Array(n + 1);
  const right = new Uint8Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const curve = t3.track.segments[Math.min(i, n - 1)].curve;
    if (curve > MIN_CURVE) left[i] = 1;        // right-hand bend -> outside is left
    else if (curve < -MIN_CURVE) right[i] = 1;
  }
  const dilate = (a) => {
    const out = new Uint8Array(a.length);
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      for (let k = Math.max(0, i - RUN_IN); k <= Math.min(a.length - 1, i + RUN_IN); k++) out[k] = 1;
    }
    return out;
  };
  return { left: dilate(left), right: dilate(right) };
}

function buildRibbon(t3, mask, side, from, to) {
  // Split the masked range into continuous runs; a ribbon across a gap would
  // stretch a single quad over the unrailed section.
  const runs = [];
  let start = -1;
  for (let i = from; i <= to; i++) {
    if (mask[i] && start < 0) start = i;
    if ((!mask[i] || i === to) && start >= 0) {
      if (i - start > 4) runs.push([start, i]);
      start = -1;
    }
  }
  if (!runs.length) return null;

  const cols = PROFILE.length;
  const pos = [];
  const idx = [];
  const f = {};
  let base = 0;

  for (const [a, b] of runs) {
    const rings = b - a + 1;
    for (let r = 0; r < rings; r++) {
      const s = (a + r) * t3.ds;
      t3.surfaceAt(s, side * RAIL_X * t3.halfWidth, f);
      for (const [h, out] of PROFILE) {
        pos.push(
          f.x + f.ux * h + f.rx * out * side,
          f.y + f.uy * h + f.ry * out * side,
          f.z + f.uz * h + f.rz * out * side,
        );
      }
    }
    for (let r = 0; r < rings - 1; r++) {
      for (let k = 0; k < cols - 1; k++) {
        const p = base + r * cols + k;
        const q = p + 1;
        const u = p + cols;
        const v = u + 1;
        if (side > 0) idx.push(p, q, u, q, v, u);
        else idx.push(p, u, q, q, u, v);
      }
    }
    base += rings * cols;
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

export function buildGuardrails(t3, railMat, postMat) {
  const R = CFG.road;
  const group = new THREE.Group();
  group.name = 'guardrails';
  const mask = railMask(t3);
  const chunks = [];

  const postGeo = new THREE.BoxGeometry(0.11, 0.95, 0.11);
  postGeo.translate(0, -0.05, 0);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const f = {};

  for (let c0 = 0; c0 < t3.n; c0 += R.CHUNK) {
    const c1 = Math.min(c0 + R.CHUNK, t3.n);
    const holder = new THREE.Group();
    holder.userData.station = (c0 + c1) / 2;
    let any = false;

    for (const side of [-1, 1]) {
      const geo = buildRibbon(t3, side < 0 ? mask.left : mask.right, side, c0, c1);
      if (!geo) continue;
      const mesh = new THREE.Mesh(geo, railMat);
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      holder.add(mesh);
      any = true;

      // Posts every 8 stations (5.6 m), instanced.
      const spots = [];
      for (let i = c0; i <= c1; i += 8) if ((side < 0 ? mask.left : mask.right)[i]) spots.push(i);
      if (spots.length) {
        const inst = new THREE.InstancedMesh(postGeo, postMat, spots.length);
        inst.castShadow = true;
        spots.forEach((i, k) => {
          t3.surfaceAt(i * t3.ds, side * RAIL_X * t3.halfWidth, f);
          p.set(f.x + f.ux * 0.5, f.y + f.uy * 0.5, f.z + f.uz * 0.5);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.yaw);
          m.compose(p, q, one);
          inst.setMatrixAt(k, m);
        });
        inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        holder.add(inst);
      }
    }

    if (any) { group.add(holder); chunks.push(holder); }
  }

  group.userData.chunks = chunks;
  return group;
}

// A soft dark ellipse under each car. Costs nothing, grounds the car whatever
// the shadow map is doing, and is the fallback when shadows are turned off.
export function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.28)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function contactShadow(tex) {
  const geo = new THREE.PlaneGeometry(CFG.car.WIDTH_M * 1.9, CFG.car.LENGTH * 1.25);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4, fog: true,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = 0.03;
  m.renderOrder = 1;
  return m;
}
