import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { CFG } from '../config.js';

// Roadside scenery as one InstancedMesh PER CHUNK.
//
// A single InstancedMesh spanning the whole track has a 2 km bounding sphere
// and is therefore never frustum-culled -- you pay the vertex transform on
// every tree, every frame, forever. Per-chunk instances cull properly and are
// uploaded once with StaticDrawUsage, so they cost nothing per frame.
//
// These are what cast the long shadows the art direction is built around, so
// they are shadow casters even though they render as near-silhouettes.

function treeGeometry(kind) {
  const parts = [];
  if (kind === 'palm') {
    const trunk = new THREE.CylinderGeometry(0.16, 0.28, 8.2, 6, 1);
    trunk.translate(0, 4.1, 0);
    parts.push(trunk);
    for (let i = 0; i < 7; i++) {
      const frond = new THREE.ConeGeometry(0.5, 3.4, 4, 1);
      frond.rotateZ(Math.PI / 2.1);
      frond.translate(1.5, 0, 0);
      frond.rotateY((i / 7) * Math.PI * 2);
      frond.rotateZ(-0.35);
      frond.translate(0, 8.2, 0);
      parts.push(frond);
    }
  } else {
    const trunk = new THREE.CylinderGeometry(0.22, 0.36, 3.4, 6, 1);
    trunk.translate(0, 1.7, 0);
    parts.push(trunk);
    for (const [y, r] of [[4.4, 2.5], [6.0, 1.9], [7.2, 1.2]]) {
      const c = new THREE.IcosahedronGeometry(r, 0);
      c.translate(0, y, 0);
      parts.push(c);
    }
  }
  // Normalise before merging: mergeGeometries silently returns null if the
  // inputs disagree on indexing, and IcosahedronGeometry is non-indexed while
  // CylinderGeometry is indexed. A null geometry then crashes at first render.
  const merged = BufferGeometryUtils.mergeGeometries(parts.map((g) => g.toNonIndexed()), false);
  if (!merged) throw new Error('scenery: geometry merge failed for ' + kind);
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  return merged;
}

export function buildScenery(t3, material) {
  const R = CFG.road;
  const group = new THREE.Group();
  group.name = 'scenery';
  const geos = { tree: treeGeometry('tree'), palm: treeGeometry('palm') };
  const byChunk = new Map();

  for (let i = 0; i < t3.n; i++) {
    const seg = t3.track.segments[i];
    if (!seg.sprites.length) continue;
    for (const sp of seg.sprites) {
      const kind = sp.kind === 'palm' ? 'palm' : sp.kind === 'tree' ? 'tree' : null;
      if (!kind) continue;
      const c = Math.floor(i / R.CHUNK);
      const key = `${c}:${kind}`;
      if (!byChunk.has(key)) byChunk.set(key, { chunk: c, kind, items: [] });
      byChunk.get(key).items.push({ i, offset: sp.offset });
    }
  }

  const f = {};
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const chunks = [];

  for (const { chunk, kind, items } of byChunk.values()) {
    const inst = new THREE.InstancedMesh(geos[kind], material, items.length);
    inst.castShadow = true;
    inst.receiveShadow = false;
    items.forEach((it, k) => {
      const s = it.i * t3.ds;
      // Push well clear of the tarmac and sit them on the verge.
      const nOff = it.offset * t3.halfWidth * 1.25;
      t3.surfaceAt(s, nOff, f);
      pos.set(f.x, f.y - 0.4, f.z);
      const h = 0.75 + ((it.i * 2654435761) % 1000) / 1000 * 0.6;
      scale.set(h, h, h);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((it.i * 40503) % 628) / 100);
      m.compose(pos, q, scale);
      inst.setMatrixAt(k, m);
    });
    inst.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    inst.instanceMatrix.needsUpdate = true;
    inst.userData.station = (chunk + 0.5) * R.CHUNK;
    group.add(inst);
    chunks.push(inst);
  }

  group.userData.chunks = chunks;
  return group;
}
