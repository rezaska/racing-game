import * as THREE from 'three';
import { CFG } from '../config.js';

// Road surface textures, generated at load.
//
// These have to be generated rather than downloaded, because the markings must
// line up with the road mesh's arc-length UVs: v is metres/12, so one tile is
// exactly 12 m and a 3 m dash with a 9 m gap fits it seamlessly. A downloaded
// photo of tarmac cannot know where the dashes go.
//
// This is also the single biggest thing missing from the piece. A flat-coloured
// road gives the eye nothing to measure motion against, so 150 km/h reads as
// drifting. Markings and grain streaming past you ARE the sense of speed.

const SIZE = 1024;
const TILE_M = 12;                 // metres of road per texture repeat

function surface() {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  return c;
}

function hash(x, y, s) {
  let h = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  // Wrap so the tile is seamless in both directions.
  const w = (a) => ((a % SIZE) + SIZE) % SIZE;
  const a = hash(w(xi), w(yi), s), b = hash(w(xi + 1), w(yi), s);
  const cc = hash(w(xi), w(yi + 1), s), d = hash(w(xi + 1), w(yi + 1), s);
  return (a * (1 - u) + b * u) * (1 - v) + (cc * (1 - u) + d * u) * v;
}

// Where markings sit, in u across the full road width.
const EDGE = 0.043;        // solid line, both shoulders
const EDGE_W = 0.007;
const LANE_W = 0.005;
const DASH = 3 / TILE_M;   // 3 m mark in a 12 m tile

function markingAt(u, v) {
  // Solid edge lines.
  if (Math.abs(u - EDGE) < EDGE_W || Math.abs(u - (1 - EDGE)) < EDGE_W) return 1;
  // Dashed lane dividers, one per lane boundary.
  const lanes = CFG.road.LANES;
  for (let i = 1; i < lanes; i++) {
    const lu = EDGE + ((1 - 2 * EDGE) * i) / lanes;
    if (Math.abs(u - lu) < LANE_W && v < DASH) return 1;
  }
  return 0;
}

export function buildRoadTextures(renderer) {
  const height = new Float32Array(SIZE * SIZE);

  // --- colour ---
  const cCanvas = surface();
  const cx = cCanvas.getContext('2d');
  const img = cx.createImageData(SIZE, SIZE);
  const base = new THREE.Color(CFG.art.roadColor);
  const line = new THREE.Color(CFG.art.lineColor);

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      // Aggregate: fine speckle over a broader mottle. The fine layer is what
      // the eye tracks at speed.
      const fine = vnoise(x * 0.9, y * 0.9, 1);
      const mid = vnoise(x * 0.16, y * 0.16, 2);
      const broad = vnoise(x * 0.035, y * 0.035, 3);
      let l = 0.88 + (fine - 0.5) * 0.34 + (mid - 0.5) * 0.22 + (broad - 0.5) * 0.18;

      // Tar seams across the lane, and darker repair patches.
      const seam = Math.abs(((y / SIZE) * 3 % 1) - 0.5);
      if (seam > 0.482 && vnoise(x * 0.02, 7, 4) > 0.42) l *= 0.86;
      if (broad > 0.70) l *= 0.90;

      height[i] = l;

      const m = markingAt(x / SIZE, y / SIZE);
      // Paint is worn: the aggregate shows through a little.
      // Paint sits proud of the aggregate, so it stays bright even where the
      // surface underneath is dark.
      const wear = 1.15 + fine * 0.2;
      const r = m ? line.r * wear : base.r * l;
      const g = m ? line.g * wear : base.g * l;
      const b = m ? line.b * wear : base.b * l;

      const o = i * 4;
      img.data[o] = Math.min(255, r * 255);
      img.data[o + 1] = Math.min(255, g * 255);
      img.data[o + 2] = Math.min(255, b * 255);
      img.data[o + 3] = 255;
    }
  }
  cx.putImageData(img, 0, 0);

  // --- normal map, central-differenced from the same height field ---
  const nCanvas = surface();
  const nx = nCanvas.getContext('2d');
  const nImg = nx.createImageData(SIZE, SIZE);
  const at = (x, y) => height[(((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE)];
  const STRENGTH = 2.6;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * STRENGTH;
      const dy = (at(x, y + 1) - at(x, y - 1)) * STRENGTH;
      const len = Math.hypot(dx, dy, 1);
      const o = (y * SIZE + x) * 4;
      nImg.data[o] = ((-dx / len) * 0.5 + 0.5) * 255;
      nImg.data[o + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      nImg.data[o + 2] = (1 / len) * 0.5 * 255 + 127;
      nImg.data[o + 3] = 255;
    }
  }
  nx.putImageData(nImg, 0, 0);

  // --- roughness: painted lines are smoother, patches vary ---
  const rCanvas = surface();
  const rx = rCanvas.getContext('2d');
  const rImg = rx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const m = markingAt(x / SIZE, y / SIZE);
      const patch = vnoise(x * 0.03, y * 0.03, 9);
      let v = m ? 0.58 : 0.70 + (patch - 0.5) * 0.34;
      const o = i * 4;
      rImg.data[o] = rImg.data[o + 1] = rImg.data[o + 2] = v * 255;
      rImg.data[o + 3] = 255;
    }
  }
  rx.putImageData(rImg, 0, 0);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const mk = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    // The most important line here. Without anisotropic filtering the road
    // past 100 m is a shimmering grey mess at 42 m/s, and no amount of
    // antialiasing fixes it.
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };

  return {
    map: mk(cCanvas, true),
    normalMap: mk(nCanvas, false),
    roughnessMap: mk(rCanvas, false),
    maxAnisotropy: maxAniso,
  };
}
