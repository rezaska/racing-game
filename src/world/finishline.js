import * as THREE from 'three';
import { CFG } from '../config.js';

// The finish line, built from the same track frame the road is, so it lies on
// the tarmac exactly however the road is banked and crowned at that station
// rather than z-fighting a flat quad against a curved surface.
//
// Two pieces: a checkered band across the road, and a gantry over it. The
// gantry is what makes the line readable from far enough away to matter -- at
// 150 km/h a stripe painted on the ground is visible for about a second, and
// the whole point is to see it coming.

const ROWS = 2;        // checker rows across the band
const COLS = 18;       // checker columns across the road
const BAND = 2.2;      // metres of road the band covers
const LIFT = 0.012;    // above the tarmac; below this it z-fights

function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = COLS * 8;
  c.height = ROWS * 8;
  const g = c.getContext('2d');
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      g.fillStyle = (x + y) % 2 ? '#0d0a12' : '#efe7da';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.anisotropy = 8;
  return tex;
}

// A ribbon of road between two stations, lifted clear of the surface.
function band(t3, sMid) {
  const hw = t3.halfWidth;
  const steps = 6;                       // along the road, so it follows a bend
  const cols = 10;                       // across, so it follows the crown
  const pos = new Float32Array((steps + 1) * (cols + 1) * 3);
  const uv = new Float32Array((steps + 1) * (cols + 1) * 2);
  const f = {};
  let p = 0, q = 0;
  for (let i = 0; i <= steps; i++) {
    const s = sMid - BAND / 2 + (BAND * i) / steps;
    for (let k = 0; k <= cols; k++) {
      const nOff = (-1 + (2 * k) / cols) * hw;
      t3.surfaceAt(s, nOff, f);
      pos[p++] = f.x + f.ux * LIFT;
      pos[p++] = f.y + f.uy * LIFT;
      pos[p++] = f.z + f.uz * LIFT;
      uv[q++] = k / cols;
      uv[q++] = i / steps;
    }
  }
  const idx = [];
  const at = (i, k) => i * (cols + 1) + k;
  for (let i = 0; i < steps; i++) {
    for (let k = 0; k < cols; k++) {
      // Winding matches the road's: reverse it and computeVertexNormals points
      // every normal at the ground and the band renders black.
      idx.push(at(i, k), at(i, k + 1), at(i + 1, k));
      idx.push(at(i, k + 1), at(i + 1, k + 1), at(i + 1, k));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildFinishLine(t3) {
  const group = new THREE.Group();
  group.name = 'finish';
  const sMid = t3.zToS(t3.track.finishZ);
  const hw = t3.halfWidth;

  const tex = checkerTexture();
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  group.add(new THREE.Mesh(band(t3, sMid), new THREE.MeshStandardMaterial({
    map: tex, roughness: 0.62, metalness: 0,
    // Painted markings sit ON the road; polygon offset keeps them there under
    // a shallow camera without needing a bigger lift that would look floated.
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));

  // Gantry: two posts and a beam, aligned to the track frame at the line.
  const f = t3.surfaceAt(sMid, 0, {});
  const post = new THREE.MeshStandardMaterial({ color: '#2a2433', roughness: 0.8, metalness: 0.1 });
  const H = 5.6, W = hw * 1.06, T = 0.22;

  const beamGeo = new THREE.BoxGeometry(W * 2, 0.62, T);
  const beamMat = new THREE.MeshStandardMaterial({
    map: tex.clone(), roughness: 0.62, metalness: 0,
  });
  beamMat.map.repeat.set(1, 1);
  beamMat.map.needsUpdate = true;

  const frame = new THREE.Group();
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.position.y = H;
  beam.castShadow = true;
  frame.add(beam);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(T, H, T), post);
    leg.position.set(side * W, H / 2, 0);
    leg.castShadow = true;
    frame.add(leg);
  }

  // Sit the gantry in the road's own frame: position at the centreline, yaw to
  // the track heading, and lean with the banking.
  frame.position.set(f.x, f.y, f.z);
  frame.rotation.set(0, 0, 0);
  frame.rotateY(f.yaw);
  frame.rotateZ(f.bank);
  group.add(frame);

  group.userData.s = sMid;
  return group;
}
