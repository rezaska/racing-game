// Convert a glTF/GLB from KHR_materials_pbrSpecularGlossiness to the core
// metallic-roughness model, and optionally strip nodes.
//
// Why this exists: three.js removed support for the specular-glossiness
// extension in r165, and a very large share of Sketchfab's back catalogue uses
// it. Such a model loads with every material defaulting to flat white, because
// the extension block is the ONLY place its colours and textures are declared.
//
// The conversion cannot be done with factors alone. In the specular workflow a
// metal has a BLACK diffuse and a coloured specular, so a naive "base colour =
// diffuse texture" reads the paint off the wrong map and produces a black car.
// This walks the textures pixel by pixel using the Khronos conversion, which
// recovers base colour, metalness and roughness maps correctly for metals and
// dielectrics alike.
//
//   node tools/glb-specgloss.mjs in.glb out.glb [--strip nodeA,nodeB]
//
// No dependencies: PNG is decoded and re-encoded here against zlib, which is
// in the standard library. Keeping the project free of a build step means
// keeping its tools free of one too.

import fs from 'node:fs';
import zlib from 'node:zlib';

// ---------------------------------------------------------------- PNG codec
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function pngDecode(buf) {
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const depth = buf[24], ctype = buf[25], interlace = buf[28];
  const chan = CHANNELS[ctype];
  // Sub-byte grayscale is rare but real -- a pure black-and-white mask gets
  // written at 1 bit per pixel, and this model's glass map is exactly that.
  const subByte = depth < 8 && ctype === 0;
  if ((depth !== 8 && !subByte) || interlace !== 0 || !chan) {
    throw new Error(`unsupported PNG: depth ${depth}, colour type ${ctype}, interlace ${interlace}`);
  }
  const idat = [];
  for (let off = 8; off < buf.length;) {
    const len = buf.readUInt32BE(off);
    if (buf.toString('latin1', off + 4, off + 8) === 'IDAT') idat.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // Below 8 bits the filter still works on whole bytes with a 1-byte step.
  const stride = subByte ? Math.ceil((w * depth) / 8) : w * chan;
  const step = subByte ? 1 : chan;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= step ? cur[i - step] : 0;
      const b = prev ? prev[i] : 0;
      const c = (prev && i >= step) ? prev[i - step] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 255;
    }
  }
  if (!subByte) return { w, h, chan, data: out };

  // Expand packed samples to one byte each, scaled so the maximum value of the
  // source depth maps to 255 (a 1-bit 1 becomes white, not 1/255 of white).
  const max = (1 << depth) - 1;
  const wide = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const bit = x * depth;
      const byte = out[y * stride + (bit >> 3)];
      const shift = 8 - depth - (bit & 7);
      wide[y * w + x] = Math.round(((byte >> shift) & max) / max * 255);
    }
  }
  return { w, h, chan: 1, data: wide };
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (b) => {
  let c = -1;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function pngEncode({ w, h, chan, data }) {
  const ctype = chan === 3 ? 2 : chan === 4 ? 6 : chan === 2 ? 4 : 0;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = ctype;
  const stride = w * chan;
  // Filter 0 on every row. The images this writes are flat colour regions that
  // deflate well regardless, and an adaptive filter would triple the code.
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------- Khronos specGloss -> metalRough
const DIELECTRIC = 0.04;
const perceived = (r, g, b) => Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b);

function solveMetallic(diffuse, specular, oneMinusSpecStrength) {
  if (specular < DIELECTRIC) return 0;
  const a = DIELECTRIC;
  const b = diffuse * oneMinusSpecStrength / (1 - DIELECTRIC) + specular - 2 * DIELECTRIC;
  const c = DIELECTRIC - specular;
  const d = Math.max(b * b - 4 * a * c, 0);
  return Math.min(1, Math.max(0, (-b + Math.sqrt(d)) / (2 * a)));
}

// Sampler over a decoded image, tolerant of the two maps being different sizes.
function sampler(img, fallback) {
  if (!img) return () => fallback;
  return (u, v) => {
    const x = Math.min(img.w - 1, (u * img.w) | 0);
    const y = Math.min(img.h - 1, (v * img.h) | 0);
    const i = (y * img.w + x) * img.chan;
    const d = img.data;
    if (img.chan === 1) return [d[i] / 255, d[i] / 255, d[i] / 255, 1];
    if (img.chan === 2) return [d[i] / 255, d[i] / 255, d[i] / 255, d[i + 1] / 255];
    if (img.chan === 3) return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, 1];
    return [d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, d[i + 3] / 255];
  };
}

function convertMaps(diffImg, specImg, diffuseFactor, specularFactor, glossFactor) {
  const w = Math.max(diffImg?.w || 1, specImg?.w || 1);
  const h = Math.max(diffImg?.h || 1, specImg?.h || 1);
  const sampleDiff = sampler(diffImg, [1, 1, 1, 1]);
  const sampleSpec = sampler(specImg, [1, 1, 1, 1]);
  const base = Buffer.alloc(w * h * 3);
  const mr = Buffer.alloc(w * h * 3);
  let metalSum = 0;
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h;
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const ds = sampleDiff(u, v), ss = sampleSpec(u, v);
      const dr = ds[0] * diffuseFactor[0], dg = ds[1] * diffuseFactor[1], db = ds[2] * diffuseFactor[2];
      const sr = ss[0] * specularFactor[0], sg = ss[1] * specularFactor[1], sb = ss[2] * specularFactor[2];
      const gloss = ss[3] * glossFactor;

      const oneMinusSpec = 1 - Math.max(sr, sg, sb);
      const metal = solveMetallic(perceived(dr, dg, db), perceived(sr, sg, sb), oneMinusSpec);
      metalSum += metal;

      const kd = oneMinusSpec / (1 - DIELECTRIC) / Math.max(1 - metal, 1e-4);
      const ks = 1 / Math.max(metal, 1e-4);
      const t = metal * metal;
      const out = [
        (dr * kd) * (1 - t) + ((sr - DIELECTRIC * (1 - metal)) * ks) * t,
        (dg * kd) * (1 - t) + ((sg - DIELECTRIC * (1 - metal)) * ks) * t,
        (db * kd) * (1 - t) + ((sb - DIELECTRIC * (1 - metal)) * ks) * t,
      ];
      const o = (y * w + x) * 3;
      for (let k = 0; k < 3; k++) base[o + k] = Math.round(Math.min(1, Math.max(0, out[k])) * 255);
      // glTF packs occlusion in R, roughness in G, metalness in B.
      mr[o] = 255;
      mr[o + 1] = Math.round(Math.min(1, Math.max(0, 1 - gloss)) * 255);
      mr[o + 2] = Math.round(metal * 255);
    }
  }
  return { base: { w, h, chan: 3, data: base }, mr: { w, h, chan: 3, data: mr },
           meanMetal: metalSum / (w * h) };
}

// --------------------------------------------------------------- GLB plumbing
function readGlb(file) {
  const d = fs.readFileSync(file);
  let json = null, bin = null;
  for (let off = 12; off < d.length;) {
    const len = d.readUInt32BE(off) === 0 ? d.readUInt32LE(off) : d.readUInt32LE(off);
    const type = d.readUInt32LE(off + 4);
    if (type === 0x4e4f534a) json = JSON.parse(d.toString('utf8', off + 8, off + 8 + len));
    else bin = d.subarray(off + 8, off + 8 + len);
    off += 8 + len;
  }
  return { json, bin };
}

function writeGlb(file, json, bin) {
  const pad = (b, to, fill) => {
    const extra = (to - (b.length % to)) % to;
    return extra ? Buffer.concat([b, Buffer.alloc(extra, fill)]) : b;
  };
  const jsonBuf = pad(Buffer.from(JSON.stringify(json), 'utf8'), 4, 0x20);
  const binBuf = pad(bin, 4, 0);
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4);
  head.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(jsonBuf.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(binBuf.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  fs.writeFileSync(file, Buffer.concat([head, jh, jsonBuf, bh, binBuf]));
}

export { pngDecode, pngEncode, solveMetallic, convertMaps, readGlb, writeGlb, DIELECTRIC, perceived };

// ------------------------------------------------------------------- driver
const EXT = 'KHR_materials_pbrSpecularGlossiness';

function imageOf(json, bin, textureIndex) {
  if (textureIndex === undefined) return null;
  const src = json.textures[textureIndex].source;
  const view = json.bufferViews[json.images[src].bufferView];
  const off = view.byteOffset || 0;
  return pngDecode(bin.subarray(off, off + view.byteLength));
}

// Everything still reachable from the scene, so the repack can drop the rest.
function garbageCollect(json, bin, extraBlobs) {
  const keepNodes = new Set();
  const walk = (i) => {
    if (keepNodes.has(i)) return;
    keepNodes.add(i);
    (json.nodes[i].children || []).forEach(walk);
  };
  (json.scenes || []).forEach((s) => (s.nodes || []).forEach(walk));

  const usedMesh = new Set(), usedAcc = new Set(), usedMat = new Set();
  for (const i of keepNodes) if (json.nodes[i].mesh !== undefined) usedMesh.add(json.nodes[i].mesh);
  for (const mi of usedMesh) {
    for (const p of json.meshes[mi].primitives) {
      if (p.indices !== undefined) usedAcc.add(p.indices);
      Object.values(p.attributes).forEach((a) => usedAcc.add(a));
      if (p.material !== undefined) usedMat.add(p.material);
    }
  }
  const usedTex = new Set();
  for (const mi of usedMat) {
    const m = json.materials[mi];
    const pbr = m.pbrMetallicRoughness || {};
    for (const t of [pbr.baseColorTexture, pbr.metallicRoughnessTexture,
                     m.normalTexture, m.occlusionTexture, m.emissiveTexture]) {
      if (t) usedTex.add(t.index);
    }
  }
  const usedImg = new Set([...usedTex].map((t) => json.textures[t].source));
  const usedView = new Set();
  for (const a of usedAcc) if (json.accessors[a].bufferView !== undefined) usedView.add(json.accessors[a].bufferView);
  for (const i of usedImg) if (json.images[i].bufferView !== undefined) usedView.add(json.images[i].bufferView);

  // Rebuild the binary chunk from the surviving views, remapping every index.
  const order = [...usedView].sort((a, b) => a - b);
  const viewMap = new Map();
  const parts = [];
  let cursor = 0;
  const newViews = [];
  for (const v of order) {
    const src = json.bufferViews[v];
    const blob = extraBlobs.has(v)
      ? extraBlobs.get(v)
      : bin.subarray(src.byteOffset || 0, (src.byteOffset || 0) + src.byteLength);
    const padding = (4 - (cursor % 4)) % 4;
    if (padding) { parts.push(Buffer.alloc(padding)); cursor += padding; }
    const nv = { buffer: 0, byteOffset: cursor, byteLength: blob.length };
    if (src.byteStride !== undefined) nv.byteStride = src.byteStride;
    if (src.target !== undefined) nv.target = src.target;
    viewMap.set(v, newViews.length);
    newViews.push(nv);
    parts.push(blob);
    cursor += blob.length;
  }
  const newBin = Buffer.concat(parts);

  const remap = (set) => {
    const list = [...set].sort((a, b) => a - b);
    return new Map(list.map((v, i) => [v, i]));
  };
  const nodeMap = remap(keepNodes), meshMap = remap(usedMesh), accMap = remap(usedAcc);
  const matMap = remap(usedMat), texMap = remap(usedTex), imgMap = remap(usedImg);

  const out = { ...json };
  out.nodes = [...nodeMap.keys()].map((i) => {
    const n = { ...json.nodes[i] };
    if (n.children) n.children = n.children.filter((c) => nodeMap.has(c)).map((c) => nodeMap.get(c));
    if (n.children && !n.children.length) delete n.children;
    if (n.mesh !== undefined) n.mesh = meshMap.get(n.mesh);
    return n;
  });
  out.scenes = json.scenes.map((s) => ({ ...s, nodes: (s.nodes || []).filter((n) => nodeMap.has(n)).map((n) => nodeMap.get(n)) }));
  out.meshes = [...meshMap.keys()].map((i) => ({
    ...json.meshes[i],
    primitives: json.meshes[i].primitives.map((p) => {
      const q = { ...p, attributes: { ...p.attributes } };
      if (q.indices !== undefined) q.indices = accMap.get(q.indices);
      for (const k of Object.keys(q.attributes)) q.attributes[k] = accMap.get(q.attributes[k]);
      if (q.material !== undefined) q.material = matMap.get(q.material);
      return q;
    }),
  }));
  out.accessors = [...accMap.keys()].map((i) => {
    const a = { ...json.accessors[i] };
    if (a.bufferView !== undefined) a.bufferView = viewMap.get(a.bufferView);
    return a;
  });
  out.materials = [...matMap.keys()].map((i) => {
    const m = JSON.parse(JSON.stringify(json.materials[i]));
    const fix = (t) => { if (t) t.index = texMap.get(t.index); };
    const pbr = m.pbrMetallicRoughness || {};
    fix(pbr.baseColorTexture); fix(pbr.metallicRoughnessTexture);
    fix(m.normalTexture); fix(m.occlusionTexture); fix(m.emissiveTexture);
    return m;
  });
  out.textures = [...texMap.keys()].map((i) => ({ ...json.textures[i], source: imgMap.get(json.textures[i].source) }));
  out.images = [...imgMap.keys()].map((i) => ({ ...json.images[i], bufferView: viewMap.get(json.images[i].bufferView) }));
  out.bufferViews = newViews;
  out.buffers = [{ byteLength: newBin.length }];
  delete out.skins; delete out.animations;
  out.extensionsUsed = (json.extensionsUsed || []).filter((e) => e !== EXT);
  if (!out.extensionsUsed.length) delete out.extensionsUsed;
  delete out.extensionsRequired;
  return { json: out, bin: newBin };
}

function main() {
  const [inFile, outFile, ...rest] = process.argv.slice(2);
  if (!inFile || !outFile) {
    console.error('usage: node tools/glb-specgloss.mjs in.glb out.glb [--strip a,b]');
    process.exit(2);
  }
  const stripArg = rest.indexOf('--strip');
  const strip = stripArg >= 0 ? rest[stripArg + 1].split(',').map((s) => s.trim()) : [];

  const { json, bin } = readGlb(inFile);
  const extraBlobs = new Map();   // bufferView index -> replacement bytes

  for (const mat of json.materials || []) {
    const ext = mat.extensions?.[EXT];
    if (!ext) continue;
    const diffuseFactor = ext.diffuseFactor || [1, 1, 1, 1];
    const specularFactor = ext.specularFactor || [1, 1, 1];
    const glossFactor = ext.glossinessFactor ?? 1;
    const diffImg = imageOf(json, bin, ext.diffuseTexture?.index);
    const specImg = imageOf(json, bin, ext.specularGlossinessTexture?.index);

    // A transparent material is never a metal. In glTF metals are opaque and
    // see-through is transmission, not a dark diffuse -- but tinted glass in
    // the specular workflow IS a dark diffuse with a real specular, which the
    // solver reads as 0.92 metallic and renders as a chrome windscreen.
    const alpha = diffuseFactor[3] ?? 1;
    const seeThrough = (mat.alphaMode === 'BLEND' || mat.alphaMode === 'MASK') && alpha < 1;

    if (diffImg || specImg) {
      const { base, mr, meanMetal } = convertMaps(diffImg, specImg, diffuseFactor, specularFactor, glossFactor);
      // Reuse the two source bufferViews for the two new images, so the view
      // count stays put and the repack simply writes different bytes.
      const baseView = ext.diffuseTexture?.index !== undefined
        ? json.images[json.textures[ext.diffuseTexture.index].source].bufferView
        : json.images[json.textures[ext.specularGlossinessTexture.index].source].bufferView;
      const mrView = ext.specularGlossinessTexture?.index !== undefined
        ? json.images[json.textures[ext.specularGlossinessTexture.index].source].bufferView
        : baseView;
      extraBlobs.set(baseView, pngEncode(base));
      const baseTex = ext.diffuseTexture?.index ?? ext.specularGlossinessTexture.index;
      const mrTex = ext.specularGlossinessTexture?.index ?? baseTex;
      if (mrView !== baseView) extraBlobs.set(mrView, pngEncode(mr));
      mat.pbrMetallicRoughness = {
        baseColorTexture: { index: baseTex },
        ...(mrView !== baseView ? { metallicRoughnessTexture: { index: mrTex } } : {}),
        // The diffuse factor's RGB is already baked into the pixels; its ALPHA
        // is not, and dropping it turns every transparent material opaque.
        baseColorFactor: [1, 1, 1, alpha],
        metallicFactor: seeThrough ? 0 : 1,
        roughnessFactor: 1,
      };
      console.log(`  ${mat.name.padEnd(12)} textured  mean metalness ${meanMetal.toFixed(2)} ` +
                  `(${seeThrough ? 'forced dielectric: transparent' : meanMetal > 0.5 ? 'metal' : 'dielectric'})` +
                  `  ${base.w}x${base.h}  alpha ${alpha}`);
    } else {
      // Factor-only material: the same maths on a single notional pixel.
      const [dr, dg, db, da = alpha] = diffuseFactor;
      const [sr, sg, sb] = specularFactor;
      const oneMinusSpec = 1 - Math.max(sr, sg, sb);
      const metal = solveMetallic(perceived(dr, dg, db), perceived(sr, sg, sb), oneMinusSpec);
      const kd = oneMinusSpec / (1 - DIELECTRIC) / Math.max(1 - metal, 1e-4);
      const ks = 1 / Math.max(metal, 1e-4);
      const t = metal * metal;
      const mixc = (d, s) => Math.min(1, Math.max(0,
        d * kd * (1 - t) + (s - DIELECTRIC * (1 - metal)) * ks * t));
      mat.pbrMetallicRoughness = {
        baseColorFactor: [mixc(dr, sr), mixc(dg, sg), mixc(db, sb), da],
        metallicFactor: seeThrough ? 0 : metal,
        roughnessFactor: Math.min(1, Math.max(0, 1 - glossFactor)),
      };
      console.log(`  ${mat.name.padEnd(12)} factors   metalness ${metal.toFixed(2)} ` +
                  `roughness ${(1 - glossFactor).toFixed(2)}`);
    }
    delete mat.extensions[EXT];
    if (!Object.keys(mat.extensions).length) delete mat.extensions;
  }

  if (strip.length) {
    const byName = new Map((json.nodes || []).map((n, i) => [n.name, i]));
    const drop = new Set(strip.map((n) => byName.get(n)).filter((i) => i !== undefined));
    for (const n of json.nodes) if (n.children) n.children = n.children.filter((c) => !drop.has(c));
    for (const s of json.scenes) s.nodes = (s.nodes || []).filter((n) => !drop.has(n));
    console.log(`  stripped ${drop.size} node(s): ${strip.join(', ')}`);
  }

  const packed = garbageCollect(json, bin, extraBlobs);
  writeGlb(outFile, packed.json, packed.bin);
  const before = fs.statSync(inFile).size, after = fs.statSync(outFile).size;
  const tris = packed.json.meshes.reduce((t, m) => t + m.primitives.reduce((u, p) => {
    const acc = packed.json.accessors[p.indices !== undefined ? p.indices : p.attributes.POSITION];
    return u + acc.count / 3;
  }, 0), 0);
  console.log(`  ${(before / 1048576).toFixed(2)} MB -> ${(after / 1048576).toFixed(2)} MB, ` +
              `${Math.round(tris)} triangles, ${packed.json.materials.length} materials`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
