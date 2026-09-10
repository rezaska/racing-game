import * as THREE from 'three';
import { CFG } from '../config.js';

// A procedural sports car, lofted from rings along the body.
//
// The shape work that matters is in the profile functions below: wheel arches
// cut into the sill, fender flares over them, a beltline crease, and a
// greenhouse tucked inboard. Without arches the wheels read as stuck on, which
// was the single biggest reason the old model looked like a bar of soap.

const C = CFG.car;
const L = C.LENGTH;
const HW = C.WIDTH_M / 2;
const H = C.HEIGHT;

// Axle centres as a fraction of body length, from the actual wheelbase.
const AXLE_F = 0.5 - C.WHEELBASE / 2 / L;
const AXLE_R = 0.5 + C.WHEELBASE / 2 / L;
const ARCH_W = 0.092;

// 1 at an axle centre, easing to 0 at the edge of the arch.
function arch(t) {
  const d = Math.min(Math.abs(t - AXLE_F), Math.abs(t - AXLE_R));
  return d < ARCH_W ? Math.cos((d / ARCH_W) * (Math.PI / 2)) ** 1.4 : 0;
}

// Superellipse ring: a rounded rectangle with no corner geometry.
function ring(halfW, yLo, yHi, n = 18, e = 3.6) {
  const pts = [];
  const cy = (yLo + yHi) / 2;
  const hy = (yHi - yLo) / 2;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.push([
      halfW * Math.sign(c) * Math.abs(c) ** (2 / e),
      cy + hy * Math.sign(s) * Math.abs(s) ** (2 / e),
    ]);
  }
  return pts;
}

function loft(sections, close = true) {
  const n = sections[0].ring.length;
  const pos = [];
  const idx = [];
  for (const s of sections) for (const [x, y] of s.ring) pos.push(x, y, s.z);
  for (let s = 0; s < sections.length - 1; s++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = s * n + k, b = s * n + k2, c = (s + 1) * n + k, d = (s + 1) * n + k2;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (close) {
    for (const [si, flip] of [[0, true], [sections.length - 1, false]]) {
      const base = pos.length / 3;
      const sec = sections[si];
      let cx = 0, cy = 0;
      for (const [x, y] of sec.ring) { cx += x; cy += y; }
      pos.push(cx / n, cy / n, sec.z);
      for (let k = 0; k < n; k++) {
        const a = si * n + k, b = si * n + (k + 1) % n;
        idx.push(...(flip ? [base, a, b] : [base, b, a]));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bodyGeometry() {
  const sections = [];
  const N = 26;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const a = arch(t);

    // Plan: pointed nose, full width through the middle, slight tail taper.
    let w = 0.46 + 0.56 * Math.sin(Math.min(1, t / 0.20) * (Math.PI / 2));
    if (t > 0.80) w -= (t - 0.80) * 1.5;
    // Fender flare only -- the sill stays flat. Lifting the sill to fake an
    // arch just runs a wave down the flank, because the ring is closed.
    const halfW = HW * Math.min(1.0, w) + a * 0.045;

    const sill = (0.155 + Math.max(0, 0.13 - t) * 0.7) * H;

    // Wedge: low nose rising to a high deck, then dropping over the tail.
    const wedge = Math.min(1, t / 0.46);
    const shoulder = (0.40 + 0.26 * wedge - Math.max(0, t - 0.84) * 1.1) * H;

    sections.push({ z: (t - 0.5) * L, ring: ring(halfW, sill, shoulder) });
  }
  return loft(sections);
}

function cabinGeometry() {
  const sections = [];
  const T = [0.30, 0.38, 0.47, 0.57, 0.67, 0.76, 0.84];
  const W = [0.44, 0.63, 0.73, 0.75, 0.72, 0.63, 0.40];
  const LO = [0.58, 0.60, 0.615, 0.625, 0.625, 0.615, 0.60];
  const HI = [0.62, 0.74, 0.84, 0.875, 0.865, 0.79, 0.64];
  for (let i = 0; i < T.length; i++) {
    sections.push({ z: (T[i] - 0.5) * L, ring: ring(HW * W[i], LO[i] * H, HI[i] * H, 14, 3.4) });
  }
  return loft(sections);
}

function wheelGeometry() {
  const r = C.WHEEL_RADIUS;
  const pts = [
    [r * 0.62, 0.115], [r * 0.86, 0.115], [r * 0.975, 0.098],
    [r, 0.05], [r, -0.05], [r * 0.975, -0.098],
    [r * 0.86, -0.115], [r * 0.62, -0.115],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, 22);
  g.rotateZ(Math.PI / 2);
  return g;
}

function rimGroup(rimMat, discMat) {
  const g = new THREE.Group();
  const r = C.WHEEL_RADIUS;

  const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.60, r * 0.60, 0.10, 20), rimMat);
  hub.rotation.z = Math.PI / 2;
  g.add(hub);

  // Spokes: five, radiating in the wheel plane.
  for (let i = 0; i < 5; i++) {
    const holder = new THREE.Group();
    holder.rotation.x = (i / 5) * Math.PI * 2;
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, r * 1.02, 0.05), rimMat);
    s2.position.set(0, 0, 0);
    holder.add(s2);
    g.add(holder);
  }

  // Brake disc sitting behind the spokes, visible through them.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.03, 20), discMat);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = -0.03;
  g.add(disc);
  return g;
}

export function buildCarModel(color, opts = {}) {
  const g = new THREE.Group();
  const player = !!opts.player;

  const paint = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(color),
    roughness: 0.28,
    metalness: 0.6,
    envMapIntensity: 1.5,
    // Clearcoat is a second specular lobe: it is what separates car paint from
    // coloured plastic. Costs ~25% more fragment work, so player only.
    clearcoat: player ? 1.0 : 0.0,
    clearcoatRoughness: 0.07,
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x080b12, roughness: 0.06, metalness: 0.25, envMapIntensity: 2.6,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.72, metalness: 0.25 });
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x131318, roughness: 0.95 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xb9bec9, roughness: 0.26, metalness: 0.95, envMapIntensity: 1.8 });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x2a2b31, roughness: 0.5, metalness: 0.8 });
  const tail = new THREE.MeshStandardMaterial({
    color: 0x38070a, emissive: 0xff2a12, emissiveIntensity: player ? 2.0 : 1.3,
  });
  const head = new THREE.MeshStandardMaterial({
    color: 0xdfe6f0, emissive: 0xfff0d0, emissiveIntensity: 1.4,
  });

  const body = new THREE.Mesh(bodyGeometry(), paint);
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(cabinGeometry(), glass);
  cabin.castShadow = true;
  g.add(cabin);

  // Splitter, diffuser, spoiler.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(HW * 1.86, 0.045, 0.34), trim);
  splitter.position.set(0, H * 0.13, -L * 0.465);
  g.add(splitter);
  const diffuser = new THREE.Mesh(new THREE.BoxGeometry(HW * 1.7, 0.14, 0.3), trim);
  diffuser.position.set(0, H * 0.19, L * 0.45);
  g.add(diffuser);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(HW * 1.72, 0.045, 0.3), paint);
  wing.position.set(0, H * 0.60, L * 0.43);
  wing.castShadow = true;
  g.add(wing);
  for (const sx of [-1, 1]) {
    const stay = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.1), trim);
    stay.position.set(sx * HW * 0.6, H * 0.545, L * 0.43);
    g.add(stay);
  }

  // Lights.
  for (const sx of [-1, 1]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.10, 0.05), tail);
    t.position.set(sx * HW * 0.60, H * 0.40, L * 0.472);
    g.add(t);
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.09, 0.05), head);
    h.position.set(sx * HW * 0.58, H * 0.34, -L * 0.463);
    g.add(h);
    // Mirrors: small, but the silhouette is instantly more car-shaped with them.
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.07, 0.09), trim);
    m.position.set(sx * HW * 0.97, H * 0.60, -L * 0.02);
    g.add(m);
  }

  const wg = wheelGeometry();
  const wheels = [];
  const wx = HW - 0.16;
  const wz = C.WHEELBASE / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, C.WHEEL_RADIUS, sz * wz);
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(wg, tyreMat);
    tyre.castShadow = true;
    spin.add(tyre);
    const rim = rimGroup(rimMat, discMat);
    rim.position.x = sx * 0.045;
    spin.add(rim);
    pivot.add(spin);
    g.add(pivot);
    wheels.push({ pivot, spin, front: sz < 0 });
  }

  g.userData = { wheels, paint, tail, head, spinAngle: 0 };
  return g;
}

// Wheel roll and steer. Above 25 m/s a 0.34 m wheel turns a third of a
// revolution per frame, so five spokes strobe and appear to run backwards --
// the visible rate is blended down rather than shown honestly.
export function updateWheels(car, speed, steer, dt) {
  const d = car.userData;
  if (!d || !d.wheels) return;
  const strobe = THREE.MathUtils.smoothstep(Math.abs(speed), 22, 34);
  d.spinAngle += (speed / C.WHEEL_RADIUS) * (1 - strobe * 0.84) * dt;
  for (const w of d.wheels) {
    w.spin.rotation.x = d.spinAngle;
    if (w.front) w.pivot.rotation.y = steer;
  }
}
