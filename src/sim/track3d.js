import { CFG } from '../config.js';
import { clamp } from '../mathx.js';

// Turns the seeded 2D track (per-segment curve + elevation) into a real 3D
// centreline with banking, and provides the two operations everything else
// needs: frameAt(s) and projectToTrack(point).
//
// PURE MATH. This file must never import three.js or touch the DOM -- it is the
// bridge between the simulation and the renderer, and it has to stay testable
// headlessly because a silent error here breaks race progress, off-road
// detection and AI avoidance at once, with no visible symptom until the
// standings come out wrong.
//
// Frame convention (matches three.js: right-handed, Y up, forward -Z):
//   forward = (-sin psi, grade, -cos psi)
//   right   = ( cos psi,     0, -sin psi)
//   up      = cross(right, forward)
// Positive seg.curve is a right-hand turn, so psi DECREASES.

const W = CFG.world;
const R = CFG.road;

// Box filter via prefix sums, O(n) per pass.
function box(a, r) {
  const n = a.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - r);
    const hi = Math.min(n - 1, i + r);
    out[i] = (pre[hi + 1] - pre[lo]) / (hi - lo + 1);
  }
  return out;
}

// Zero-phase one-pole: forward then backward, so smoothing introduces no lag.
function smoothBidir(a, tau, ds) {
  const k = 1 - Math.exp(-ds / tau);
  const n = a.length;
  const out = Float64Array.from(a);
  for (let i = 1; i < n; i++) out[i] = out[i - 1] + (out[i] - out[i - 1]) * k;
  for (let i = n - 2; i >= 0; i--) out[i] = out[i + 1] + (out[i] - out[i + 1]) * k;
  return out;
}

export class Track3D {
  constructor(track) {
    this.track = track;
    this.ds = R.SEGMENT_LENGTH * W.U;          // 0.70 m per station
    this.halfWidth = R.WIDTH * W.U;            // 7.0 m
    this.n = track.segments.length;            // stations 0..n inclusive
    this.length = this.n * this.ds;

    this.#buildHeading();
    this.#buildElevation();
    this.#buildBank();
    this.#buildFrames();
  }

  #buildHeading() {
    const segs = this.track.segments;
    const n = this.n;
    const ds = this.ds;
    const psi = new Float64Array(n + 1);
    const px = new Float64Array(n + 1);
    const pz = new Float64Array(n + 1);

    for (let i = 0; i < n; i++) {
      const dpsi = -segs[i].curve * W.KAPPA * ds;
      // Midpoint heading over the step: trapezoidal integration, which halves
      // the drift compared with using the heading at the start of the step.
      const mid = psi[i] + dpsi * 0.5;
      psi[i + 1] = psi[i] + dpsi;
      px[i + 1] = px[i] - Math.sin(mid) * ds;
      pz[i + 1] = pz[i] - Math.cos(mid) * ds;
    }
    this.psi = psi;
    this.px = px;
    this.pz = pz;
  }

  #buildElevation() {
    const segs = this.track.segments;
    const n = this.n;
    const ds = this.ds;

    const target = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const raw = i < n ? segs[i].p1.world.y : segs[n - 1].p2.world.y;
      target[i] = raw * W.U * W.ELEV;
    }

    // Grade limit. Raw generator output measures at 125.7% grades; this is what
    // brings it to a drivable 13%.
    const lim = W.SLEW * ds;
    let y = target[0];
    const limited = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
      y += clamp(target[i] - y, -lim, lim);
      limited[i] = y;
    }

    // The limiter is C0 but not C1: wherever it engages it leaves a kink, and
    // kinks read as creases in the road surface at 42 m/s. Three box passes
    // approximate a Gaussian and remove them.
    let py = limited;
    for (let p = 0; p < W.BOX_PASSES; p++) py = box(py, W.BOXR);
    this.py = py;
  }

  #buildBank() {
    const segs = this.track.segments;
    const n = this.n;
    const raw = new Float64Array(n + 1);
    for (let i = 0; i <= n; i++) {
      const curve = segs[Math.min(i, n - 1)].curve;
      // Negative: for a right-hand turn (curve > 0) the OUTSIDE is the left,
      // and the outside of a bend must be the high side.
      raw[i] = -W.BANK_MAX * clamp(curve / 6, -1, 1);
    }
    // Unsmoothed, #addRoad's per-section easing shows a visible fold at every
    // section boundary.
    this.bank = smoothBidir(raw, W.BANK_TAU, this.ds);
  }

  #buildFrames() {
    const n = this.n;
    const ds = this.ds;
    const F = new Float64Array((n + 1) * 3);
    const RT = new Float64Array((n + 1) * 3);
    const UP = new Float64Array((n + 1) * 3);
    const grade = new Float64Array(n + 1);

    for (let i = 0; i <= n; i++) {
      const j = i === n ? n - 1 : i;
      grade[i] = (this.py[j + 1] - this.py[j]) / ds;

      const c = Math.cos(this.psi[i]);
      const s = Math.sin(this.psi[i]);
      const g = grade[i];
      const fl = Math.hypot(1, g);

      let fx = -s / fl, fy = g / fl, fz = -c / fl;
      let rx = c, ry = 0, rz = -s;

      // Bank by rotating the cross-section about the tangent.
      const phi = this.bank[i];
      if (phi !== 0) {
        // up_flat = cross(right, forward)
        const ux = ry * fz - rz * fy;
        const uy = rz * fx - rx * fz;
        const uz = rx * fy - ry * fx;
        const cp = Math.cos(phi), sp = Math.sin(phi);
        rx = rx * cp + ux * sp;
        ry = ry * cp + uy * sp;
        rz = rz * cp + uz * sp;
      }

      const ux = ry * fz - rz * fy;
      const uy = rz * fx - rx * fz;
      const uz = rx * fy - ry * fx;

      F[i * 3] = fx; F[i * 3 + 1] = fy; F[i * 3 + 2] = fz;
      RT[i * 3] = rx; RT[i * 3 + 1] = ry; RT[i * 3 + 2] = rz;
      UP[i * 3] = ux; UP[i * 3 + 1] = uy; UP[i * 3 + 2] = uz;
    }
    this.fwd = F;
    this.rgt = RT;
    this.upv = UP;
    this.grade = grade;
  }

  // Frame at arc length s (metres). Linearly extrapolates outside the track,
  // which is exactly right because the generator starts and ends on a straight
  // -- that is what lets the mesh run on past the finish line.
  frameAt(s, out = {}) {
    const ds = this.ds;
    const n = this.n;
    let i, t;
    if (s < 0) { i = 0; t = s / ds; }
    else if (s >= this.length) { i = n - 1; t = s / ds - i; }
    else { i = Math.floor(s / ds); t = s / ds - i; }
    i = clamp(i, 0, n - 1);

    const a = i * 3, b = (i + 1) * 3;
    const it = 1 - t;

    out.x = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    out.y = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    out.z = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t;

    let fx = this.fwd[a] * it + this.fwd[b] * t;
    let fy = this.fwd[a + 1] * it + this.fwd[b + 1] * t;
    let fz = this.fwd[a + 2] * it + this.fwd[b + 2] * t;
    let fl = Math.hypot(fx, fy, fz) || 1;
    out.fx = fx / fl; out.fy = fy / fl; out.fz = fz / fl;

    let rx = this.rgt[a] * it + this.rgt[b] * t;
    let ry = this.rgt[a + 1] * it + this.rgt[b + 1] * t;
    let rz = this.rgt[a + 2] * it + this.rgt[b + 2] * t;
    // Gram-Schmidt against forward: interpolating the two independently leaves
    // them a few microradians off square, and the projection round-trip is an
    // exact-inverse invariant that will not tolerate it.
    const d = rx * out.fx + ry * out.fy + rz * out.fz;
    rx -= out.fx * d; ry -= out.fy * d; rz -= out.fz * d;
    const rl = Math.hypot(rx, ry, rz) || 1;
    out.rx = rx / rl; out.ry = ry / rl; out.rz = rz / rl;

    out.ux = out.ry * out.fz - out.rz * out.fy;
    out.uy = out.rz * out.fx - out.rx * out.fz;
    out.uz = out.rx * out.fy - out.ry * out.fx;

    out.yaw = this.psi[i] + (this.psi[i + 1] - this.psi[i]) * t;
    out.bank = this.bank[i] + (this.bank[i + 1] - this.bank[i]) * t;
    out.grade = this.grade[i] + (this.grade[i + 1] - this.grade[i]) * t;
    out.i = i;
    return out;
  }

  // Surface point at arc length s, lateral offset nOff metres.
  surfaceAt(s, nOff, out = {}) {
    const f = this.frameAt(s, out);
    // Road crown: a 2% crossfall that catches the low sun along the centre line.
    const crown = -W.CROWN * (nOff / this.halfWidth) ** 2;
    f.x += f.rx * nOff + f.ux * crown;
    f.y += f.ry * nOff + f.uy * crown;
    f.z += f.rz * nOff + f.uz * crown;
    return f;
  }

  // Inverse of surfaceAt: world point -> (s, n). `hint` is the previous
  // station index, which makes this O(1) rather than a search.
  //
  // Walks to bracket the station, then refines with two Newton steps against
  // the real interpolated frame. Without the refinement the answer is only as
  // good as the per-station frame, which is ~5 cm out at the road edge -- fine
  // for physics, not fine for a round-trip invariant.
  projectToTrack(x, y, z, hint = 0) {
    const ds = this.ds;
    const n = this.n;
    let i = clamp(hint | 0, 0, n - 1);
    let t = 0;
    let bracketed = false;

    // Project onto the horizontal chord between stations, which is exactly how
    // frameAt interpolates position, so the two agree by construction.
    const param = (k) => {
      const dx = x - this.px[k];
      const dz = z - this.pz[k];
      const cx = this.px[k + 1] - this.px[k];
      const cz = this.pz[k + 1] - this.pz[k];
      return (dx * cx + dz * cz) / (cx * cx + cz * cz);
    };

    for (let k = 0; k < 64; k++) {
      t = param(i);
      if (t > 1 && i < n - 1) { i++; continue; }
      if (t < 0 && i > 0) { i--; continue; }
      bracketed = true;
      break;
    }

    // The walk is O(1) while the car moves continuously, but a respawn or a
    // teleport can land arbitrarily far from the hint. Fall back to a strided
    // scan rather than silently returning a station 60 places away.
    if (!bracketed) {
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k <= n; k += 16) {
        const d = (x - this.px[k]) ** 2 + (z - this.pz[k]) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      i = clamp(best, 0, n - 1);
      for (let k = 0; k < 24; k++) {
        t = param(i);
        if (t > 1 && i < n - 1) { i++; continue; }
        if (t < 0 && i > 0) { i--; continue; }
        break;
      }
    }

    let s = (i + clamp(t, 0, 1)) * ds;
    const f = {};
    this.frameAt(s, f);
    let nOff = (x - f.x) * f.rx + (y - f.y) * f.ry + (z - f.z) * f.rz;

    // Newton against the real interpolated surface. Without this the answer is
    // only as good as the per-station frame -- ~5 cm out at the road edge.
    // Four steps rather than two because the step ignores the metric factor:
    // d(surface)/ds is forward * (1 - n*curvature), so at 11 m offset on a 93 m
    // radius each step under-corrects by ~12% and two steps leave ~1 cm.
    for (let k = 0; k < 4; k++) {
      this.surfaceAt(s, nOff, f);
      const ex = x - f.x, ey = y - f.y, ez = z - f.z;
      s += ex * f.fx + ey * f.fy + ez * f.fz;
      nOff += ex * f.rx + ey * f.ry + ez * f.rz;
    }

    return { s, n: nOff, i: clamp(Math.floor(s / ds), 0, n - 1) };
  }

  // --- legacy <-> metric bridges. These are what let the whole sim layer,
  // the AI and the existing tests keep working unchanged. ---
  zToS(z) { return z * W.U; }
  sToZ(s) { return s / W.U; }
  xToN(x) { return x * this.halfWidth; }
  nToX(nOff) { return nOff / this.halfWidth; }
}
