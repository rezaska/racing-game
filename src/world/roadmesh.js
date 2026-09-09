import * as THREE from 'three';
import { CFG } from '../config.js';

// The road as a swept cross-section along the track spline.
//
// Built per chunk. The road itself is nowhere near a rendering bottleneck at
// any granularity, but chunks are the natural culling unit for scenery, and one
// culling story beats two.

// Lateral offsets in half-widths, with a vertical offset in metres. Boundary
// points are duplicated so the raised rumble and dropped shoulder get real
// vertical faces instead of a stretched T-junction.
//   D = tarmac, R = rumble, S = shoulder
const PROFILE = [
  [-17.0, -6.00], [-4.00, -0.90],
  [-1.60, -0.15], [-1.12, -0.15], [-1.12, 0.03], [-1.00, 0.03], [-1.00, 0.00],
  [-0.50, 0.00], [0.00, 0.00], [0.50, 0.00], [1.00, 0.00],
  [1.00, 0.03], [1.12, 0.03], [1.12, -0.15], [1.60, -0.15],
  [4.00, -0.90], [17.0, -6.00],
];
const QUAD_MAT = ['T', 'T', 'S', 'S', 'R', 'R', 'D', 'D', 'D', 'D', 'R', 'R', 'S', 'S', 'T', 'T'];
const MAT_ORDER = ['D', 'R', 'S', 'T'];

// Terrain follows the road ribbon rather than being a separate heightfield: a
// heightfield cannot be guaranteed to meet the verge, and the resulting gap on
// every crest is the classic failure of this approach.
function hash2(x, z) {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi);
  const c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
function fbm(x, z) {
  return vnoise(x * 0.055, z * 0.055) * 1.0
       + vnoise(x * 0.14, z * 0.14) * 0.42
       + vnoise(x * 0.36, z * 0.36) * 0.16;
}

export function buildRoadChunks(t3, materials) {
  const R = CFG.road;
  const hw = t3.halfWidth;
  const ds = t3.ds;
  const group = new THREE.Group();
  group.name = 'road';

  // Run past both ends of the simulated track: it otherwise stops 84 m past the
  // finish while the fog reaches ~300 m, and you watch the world end.
  const first = -R.HEAD;
  const last = t3.n + R.TAIL;
  const chunks = [];

  for (let c0 = first; c0 < last; c0 += R.CHUNK) {
    const c1 = Math.min(c0 + R.CHUNK, last);
    const rings = c1 - c0 + 1;
    const cols = PROFILE.length;

    const pos = new Float32Array(rings * cols * 3);
    const uv = new Float32Array(rings * cols * 2);
    const dark = new Uint8Array(rings);

    const f = {};
    for (let r = 0; r < rings; r++) {
      const station = c0 + r;
      const s = station * ds;
      t3.frameAt(s, f);
      const seg = t3.track.segments[Math.max(0, Math.min(station, t3.n - 1))];
      dark[r] = seg.dark ? 1 : 0;

      for (let k = 0; k < cols; k++) {
        const [lx, dy] = PROFILE[k];
        const nOff = lx * hw;
        const crown = -CFG.world.CROWN * Math.min(lx * lx, 1);
        let h = crown + dy;
        // Displace only the outer terrain points, ramped in so the verge stays
        // exactly welded to the shoulder.
        const away = Math.min(1, Math.max(0, (Math.abs(lx) - 1.6) / 3.0));
        if (away > 0) {
          const px0 = f.x + f.rx * nOff;
          const pz0 = f.z + f.rz * nOff;
          h += (fbm(px0, pz0) - 0.8) * 7.0 * away * away;
        }
        const i3 = (r * cols + k) * 3;
        pos[i3] = f.x + f.rx * nOff + f.ux * h;
        pos[i3 + 1] = f.y + f.ry * nOff + f.uy * h;
        pos[i3 + 2] = f.z + f.rz * nOff + f.uz * h;
        const i2 = (r * cols + k) * 2;
        // u spans the full 14 m; v is real arc length so a 12 m texture tile
        // holds an exact 3 m mark / 9 m gap dash with no seam.
        uv[i2] = (lx + 1) / 2;
        uv[i2 + 1] = s / 12;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    // One index buffer, grouped by material, so a chunk is 3 draw calls.
    const buckets = { D: [], R: [], S: [], T: [] };
    for (let r = 0; r < rings - 1; r++) {
      for (let k = 0; k < cols - 1; k++) {
        const a = r * cols + k;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        // Winding matters: reversed, computeVertexNormals() points every road
        // normal downward and the whole surface renders lit from below, i.e.
        // black.
        buckets[QUAD_MAT[k]].push(a, b, c, b, d, c);
      }
    }
    const index = [];
    const groups = [];
    for (const m of MAT_ORDER) {
      const start = index.length;
      index.push(...buckets[m]);
      groups.push([start, index.length - start]);
    }
    geo.setIndex(index);
    groups.forEach(([start, count], i) => geo.addGroup(start, count, i));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const mesh = new THREE.Mesh(geo, [materials.road, materials.rumble, materials.shoulder, materials.terrain]);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.userData.station = (c0 + c1) / 2;
    group.add(mesh);
    chunks.push(mesh);
  }

  group.userData.chunks = chunks;
  return group;
}

// Hide chunks beyond the draw distance. Fog already makes them invisible, but
// invisible is not free: without this every chunk of a 2.7 km track stays in
// the frustum on a straight and gets rasterised behind the haze.
export function cullChunks(road, station, ds) {
  const reach = CFG.render.DRAW_DISTANCE / ds;
  for (const m of road.userData.chunks) {
    const d = m.userData.station - station;
    m.visible = d > -reach * 0.25 && d < reach;
  }
}
