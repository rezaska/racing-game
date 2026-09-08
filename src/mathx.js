// Pure helpers. No state, no imports.

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Road-building easing (Jake Gordon's pseudo-3D conventions).
export const easeIn = (a, b, p) => a + (b - a) * Math.pow(p, 2);
export const easeOut = (a, b, p) => a + (b - a) * (1 - Math.pow(1 - p, 2));
export const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);

// Move `val` toward a target by `inc`, wrapping into [0, max).
export function increase(start, inc, max) {
  let r = start + inc;
  while (r >= max) r -= max;
  while (r < 0) r += max;
  return r;
}

// Accelerate/decelerate toward a limit at a fixed rate.
export function accelerate(v, accel, dt) {
  return v + accel * dt;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// mulberry32: small, fast, deterministic across every browser.
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Do two 1D intervals overlap? Used for car-vs-car contact on the road.
export function overlap(x1, w1, x2, w2, pct = 1) {
  const half = pct / 2;
  return !((x1 + w1 * half < x2 - w2 * half) || (x1 - w1 * half > x2 + w2 * half));
}
