import * as THREE from 'three';
import { CFG } from '../config.js';

// A procedural low-poly sports car, built by lofting rings along the body.
//
// Extruding a side profile gives a slab-sided car and a rounded box gives a bar
// of soap; lofting a changing cross-section is the only cheap approach that
// reads as a car. The proportions below are what make it read as modern:
// track-to-height above 1.55, roof peak at ~55% of length, short front
// overhang, and a strong beltline with the glass tucked inboard of it.

const C = CFG.car;

// Superellipse ring: a rounded rectangle without needing corner geometry.
function ring(halfW, yLo, yHi, n = 14, e = 3.4) {
  const pts = [];
  const cy = (yLo + yHi) / 2;
  const hy = (yHi - yLo) / 2;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const ct = Math.cos(t), st = Math.sin(t);
    pts.push([
      halfW * Math.sign(ct) * Math.abs(ct) ** (2 / e),
      cy + hy * Math.sign(st) * Math.abs(st) ** (2 / e),
    ]);
  }
  return pts;
}

// Connect a sequence of rings into a closed shell.
function loft(sections) {
  const n = sections[0].ring.length;
  const pos = [];
  const idx = [];
  for (const s of sections) {
    for (const [x, y] of s.ring) pos.push(x, y, s.z);
  }
  for (let s = 0; s < sections.length - 1; s++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = s * n + k, b = s * n + k2;
      const c = (s + 1) * n + k, d = (s + 1) * n + k2;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Caps, as fans around each end ring's centroid.
  for (const [si, flip] of [[0, true], [sections.length - 1, false]]) {
    const base = pos.length / 3;
    const s = sections[si];
    let cx = 0, cy = 0;
    for (const [x, y] of s.ring) { cx += x; cy += y; }
    pos.push(cx / n, cy / n, s.z);
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      const a = si * n + k, b = si * n + k2;
      idx.push(...(flip ? [base, a, b] : [base, b, a]));
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function bodyGeometry() {
  const L = C.LENGTH;
  const hw = C.WIDTH_M / 2;
  // t along the body, 0 = nose, 1 = tail.
  const T =      [0.00, 0.06, 0.16, 0.30, 0.45, 0.58, 0.70, 0.82, 0.92, 1.00];
  const HALFW =  [0.50, 0.72, 0.88, 0.97, 1.00, 1.00, 0.99, 0.97, 0.92, 0.80];
  const SILL =   [0.30, 0.24, 0.21, 0.20, 0.20, 0.20, 0.20, 0.21, 0.25, 0.32];
  const SHOULD = [0.42, 0.52, 0.60, 0.66, 0.68, 0.68, 0.67, 0.65, 0.62, 0.55];
  const sections = T.map((t, i) => ({
    z: (t - 0.5) * L,
    ring: ring(hw * HALFW[i], SILL[i] * C.HEIGHT, SHOULD[i] * C.HEIGHT),
  }));
  return loft(sections);
}

function cabinGeometry() {
  const L = C.LENGTH;
  const hw = C.WIDTH_M / 2;
  // Windscreen raked back, fastback rear. Sits inboard of the beltline.
  const T =      [0.30, 0.40, 0.52, 0.64, 0.76, 0.86];
  const HALFW =  [0.62, 0.76, 0.80, 0.78, 0.70, 0.52];
  const LO =     [0.62, 0.64, 0.65, 0.65, 0.64, 0.60];
  const HI =     [0.70, 0.88, 1.00, 1.00, 0.92, 0.72];
  const sections = T.map((t, i) => ({
    z: (t - 0.5) * L,
    ring: ring(hw * HALFW[i], LO[i] * C.HEIGHT, HI[i] * C.HEIGHT, 12, 3.0),
  }));
  return loft(sections);
}

function wheelGeometry() {
  const r = C.WHEEL_RADIUS;
  // Lathe profile: tread, then a sidewall bulge so it is not a bare cylinder.
  const pts = [
    [r * 0.70, 0.12], [r * 0.88, 0.12], [r * 0.985, 0.10],
    [r, 0.05], [r, -0.05], [r * 0.985, -0.10],
    [r * 0.88, -0.12], [r * 0.70, -0.12],
  ].map(([a, b]) => new THREE.Vector2(a, b));
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateZ(Math.PI / 2);   // lathe axis Y -> X, so it rolls about X
  return g;
}

export function buildCarModel(color, opts = {}) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color), roughness: 0.34, metalness: 0.55,
    envMapIntensity: 1.4,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a0e14, roughness: 0.08, metalness: 0.2, envMapIntensity: 2.2,
  });
  const trim = new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.85 });
  const tail = new THREE.MeshStandardMaterial({
    color: 0x4a0a08, emissive: 0xff2a12, emissiveIntensity: opts.player ? 1.4 : 1.0,
  });

  const body = new THREE.Mesh(bodyGeometry(), paint);
  body.castShadow = true;
  g.add(body);

  const cabin = new THREE.Mesh(cabinGeometry(), glass);
  cabin.castShadow = true;
  g.add(cabin);

  // Duck-tail spoiler: two rings' worth of geometry that does a lot of work.
  const spoiler = new THREE.Mesh(
    new THREE.BoxGeometry(C.WIDTH_M * 0.86, 0.05, 0.34),
    paint,
  );
  spoiler.position.set(0, C.HEIGHT * 0.60, C.LENGTH * 0.44);
  spoiler.castShadow = true;
  g.add(spoiler);

  // Front splitter.
  const splitter = new THREE.Mesh(new THREE.BoxGeometry(C.WIDTH_M * 0.9, 0.04, 0.3), trim);
  splitter.position.set(0, C.HEIGHT * 0.16, -C.LENGTH * 0.47);
  g.add(splitter);

  const wg = wheelGeometry();
  const wheels = [];
  const wx = C.WIDTH_M / 2 - 0.06;
  const wz = C.WHEELBASE / 2;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wx, C.WHEEL_RADIUS, sz * wz);
    const w = new THREE.Mesh(wg, trim);
    w.castShadow = true;
    pivot.add(w);
    g.add(pivot);
    wheels.push({ pivot, mesh: w, front: sz < 0 });
  }

  for (const sx of [-1, 1]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.06), tail);
    l.position.set(sx * C.WIDTH_M * 0.3, C.HEIGHT * 0.42, C.LENGTH * 0.49);
    g.add(l);
  }

  g.userData = { wheels, paint, tail, spin: 0 };
  return g;
}

// Wheel roll and steer. Above 25 m/s a 0.34 m wheel turns a third of a
// revolution per frame, so the spokes strobe and appear to run backwards --
// blend the visible rate down rather than showing it.
export function updateWheels(car, speed, steer, dt) {
  const d = car.userData;
  const strobe = THREE.MathUtils.smoothstep(Math.abs(speed), 22, 34);
  d.spin += (speed / C.WHEEL_RADIUS) * (1 - strobe * 0.82) * dt;
  for (const w of d.wheels) {
    w.mesh.rotation.x = d.spin;
    if (w.front) w.pivot.rotation.y = steer;
  }
}
