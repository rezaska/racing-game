import { CFG } from './config.js';
import { catmull, clamp, lerp, mulberry32, smoothstep } from './mathx.js';

// Generate a seeded Catmull-Rom ridge baked into a dense array.
// Used for both the drivable terrain and the parallax background layers.
function bakeRidge(rng, span, dx, baseY, octaves, rampIn) {
  const n = Math.floor(span / dx) + 1;
  const h = new Float32Array(n);

  for (const oct of octaves) {
    const nCtrl = Math.ceil(span / oct.spacing) + 4;
    const ctrl = new Float32Array(nCtrl);
    for (let i = 0; i < nCtrl; i++) ctrl[i] = rng() * 2 - 1;

    for (let i = 0; i < n; i++) {
      const x = i * dx;
      const f = x / oct.spacing;
      const c = Math.min(Math.floor(f), nCtrl - 4);
      const t = f - c;
      h[i] += catmull(ctrl[c], ctrl[c + 1], ctrl[c + 2], ctrl[c + 3], t) * oct.amp;
    }
  }

  // y grows down, so subtracting the noise raises the hills.
  for (let i = 0; i < n; i++) {
    const x = i * dx;
    const ramp = rampIn > 0 ? smoothstep(0, rampIn, x) : 1;
    h[i] = baseY - h[i] * ramp;
  }

  return { h, dx, n };
}

export class Terrain {
  constructor(seed) {
    const T = CFG.terrain;
    this.dx = T.DX;
    this.length = T.LENGTH;
    this.baseY = T.BASE_Y;

    const rng = mulberry32(seed);
    const baked = bakeRidge(rng, T.LENGTH, T.DX, T.BASE_Y, T.OCTAVES, T.RAMP_IN);
    this.h = baked.h;
    this.n = baked.n;

    this.startX = T.START_FLAT * 0.5;
    this.finishX = T.LENGTH - T.FINISH_FLAT * 0.5;

    // Order matters: the CLAMP MUST RUN LAST. Flattening blends the noise into
    // the start/finish plateaus, and that blend introduces its own grade -- with
    // flattening last it produced faces steeper than the clamp allows, i.e. a
    // finish straight the car could not climb.
    this.#flattenEnds();
    this.#clampSlopes();
    this.#smooth();
    this.#clampSlopes();
    this.#levelPlateaus();

    this.#buildCheckpoints();
    this.#buildParallax(seed);
    this.#buildDecorations(seed);
  }

  // --- generation passes -------------------------------------------------

  #flattenEnds() {
    const T = CFG.terrain;
    const { h, dx, n } = this;

    const hStart = h[0];
    const blendEnd = T.START_FLAT + T.BLEND;
    for (let i = 0; i < n; i++) {
      const x = i * dx;
      if (x >= blendEnd) break;
      if (x <= T.START_FLAT) h[i] = hStart;
      else h[i] = lerp(hStart, h[i], smoothstep(T.START_FLAT, blendEnd, x));
    }

    const flatFrom = T.LENGTH - T.FINISH_FLAT;
    const iFlat = clamp(Math.floor(flatFrom / dx), 0, n - 1);
    const hFinish = h[iFlat];
    const blendFrom = flatFrom - T.BLEND;
    for (let i = n - 1; i >= 0; i--) {
      const x = i * dx;
      if (x < blendFrom) break;
      if (x >= flatFrom) h[i] = hFinish;
      else h[i] = lerp(h[i], hFinish, smoothstep(blendFrom, flatFrom, x));
    }
  }

  // Force the two plateaus exactly level. They are already near-constant by this
  // point, so this only removes the residue left by smoothing.
  #levelPlateaus() {
    const T = CFG.terrain;
    const { h, dx, n } = this;
    const iStart = clamp(Math.floor(T.START_FLAT / dx), 0, n - 1);
    for (let i = 0; i <= iStart; i++) h[i] = h[iStart];
    const iEnd = clamp(Math.ceil((T.LENGTH - T.FINISH_FLAT) / dx), 0, n - 1);
    for (let i = iEnd; i < n; i++) h[i] = h[iEnd];
  }

  // Raw multi-octave noise reliably produces unclimbable walls. Two forward +
  // backward passes limit every step to a drivable grade.
  #clampSlopes() {
    const { h, dx, n } = this;
    const maxD = dx * Math.tan(CFG.terrain.MAX_SLOPE_DEG * Math.PI / 180);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 1; i < n; i++) h[i] = clamp(h[i], h[i - 1] - maxD, h[i - 1] + maxD);
      for (let i = n - 2; i >= 0; i--) h[i] = clamp(h[i], h[i + 1] - maxD, h[i + 1] + maxD);
    }
  }

  // Single 3-tap pass to soften the kinks the clamp introduces.
  #smooth() {
    const { h, n } = this;
    const out = new Float32Array(h);
    for (let i = 1; i < n - 1; i++) out[i] = (h[i - 1] + 2 * h[i] + h[i + 1]) * 0.25;
    this.h = out;
  }

  #buildCheckpoints() {
    const T = CFG.terrain;
    this.checkpoints = [];
    for (let x = this.startX; x < this.finishX; x += T.CHECKPOINT_SPACING) {
      this.checkpoints.push({ x, y: this.heightAt(x) });
    }
  }

  #buildParallax(seed) {
    // Independent PRNG stream per layer -- sharing one stream would mean adding
    // a decoration silently changes the terrain.
    const mk = (k, p, amp, spacing, baseY) => {
      const rng = mulberry32((seed ^ Math.imul(0x9e3779b9, k + 1)) >>> 0);
      const span = this.length * p + 3000;
      const r = bakeRidge(rng, span, 40, baseY, [
        { spacing, amp },
        { spacing: spacing * 0.32, amp: amp * 0.35 },
      ], 0);
      return { ...r, parallax: p };
    };
    // Horizontal parallax only: parallaxY stays 1 so each ridge is anchored to a
    // real world height and sits at a fixed distance above the ground whatever
    // the viewport. With parallaxY < 1 the layer's y becomes an offset from the
    // camera anchor rather than a world height, which makes its on-screen
    // position depend on the window size -- at 800px tall the near ridge landed
    // above the top of the screen and its fill covered the entire sky.
    this.layers = [
      { ...mk(0, 0.15, 150, 1400, this.baseY - 300), parallaxY: 1, color: CFG.palette.far },
      { ...mk(1, 0.35, 110, 900, this.baseY - 190), parallaxY: 1, color: CFG.palette.mid },
      { ...mk(2, 0.70, 70, 520, this.baseY - 80), parallaxY: 1, color: CFG.palette.near },
    ];
  }

  #buildDecorations(seed) {
    const rng = mulberry32((seed ^ 0x2545f491) >>> 0);
    this.decorations = [];
    for (let x = 600; x < this.length - 600; x += 140 + rng() * 260) {
      this.decorations.push({
        x,
        y: this.heightAt(x),
        kind: rng() < 0.72 ? 'tree' : 'rock',
        scale: 0.7 + rng() * 0.7,
        flip: rng() < 0.5,
      });
    }
  }

  // --- sampling ----------------------------------------------------------

  heightAt(x) {
    const { h, dx, n } = this;
    if (x <= 0) return h[0];
    const f = x / dx;
    const i = f | 0;
    if (i >= n - 1) return h[n - 1];
    return h[i] + (h[i + 1] - h[i]) * (f - i);
  }

  // Central difference over the WHEEL RADIUS, not the per-segment slope.
  // Per-segment slope is piecewise-constant, so the surface normal snaps at
  // every vertex and the suspension chatters. This is continuous in x and is
  // also physically right: a wheel of radius r cannot feel features below r.
  slopeAt(x, r) {
    return (this.heightAt(x + r) - this.heightAt(x - r)) / (2 * r);
  }

  angleAt(x, r) {
    return Math.atan(this.slopeAt(x, r));
  }

  checkpointBefore(x) {
    let best = this.checkpoints[0];
    for (const cp of this.checkpoints) {
      if (cp.x <= x) best = cp;
      else break;
    }
    return best;
  }
}
