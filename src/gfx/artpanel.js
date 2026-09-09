import { CFG } from '../config.js';

// Live art direction. Everything the renderer reads for look lives in CFG.art,
// so this panel writes straight into it -- and "Copy config" emits a pasteable
// block, which is what turns a look dialled in the browser into the committed
// default rather than a description someone has to reimplement.

const FIELDS = [
  ['Sun', [
    ['sunElevation', 0.5, 25, 0.1], ['sunAzimuth', -180, 180, 1],
    ['sunIntensity', 0, 14, 0.1], ['ambient', 0, 3, 0.05],
  ]],
  ['Sky', [
    ['skyZenith', 'color'], ['skyMid', 'color'], ['skyHorizon', 'color'],
    ['sunColor', 'color'], ['skyMidPoint', 0.05, 0.9, 0.01],
    ['sunSize', 0.002, 0.06, 0.001], ['sunGlow', 0, 0.6, 0.01],
  ]],
  ['Atmosphere', [
    ['fogColor', 'color'], ['fogDensity', 0, 0.012, 0.0001],
  ]],
  ['Surfaces', [
    ['roadColor', 'color'], ['terrainNear', 'color'], ['terrainFar', 'color'],
    ['sceneryColor', 'color'], ['ambientSky', 'color'], ['ambientGround', 'color'],
    ['playerColor', 'color'],
  ]],
  ['Grade', [
    ['exposure', 0.2, 2.2, 0.01], ['bloomStrength', 0, 1.5, 0.01],
    ['bloomThreshold', 0, 1.2, 0.01], ['bloomRadius', 0, 1.5, 0.01],
    ['gradeShadow', 'color'], ['gradeHighlight', 'color'],
    ['gradeStrength', 0, 1, 0.01], ['vignette', 0, 1, 0.01], ['grain', 0, 0.12, 0.002],
  ]],
];

export function mountArtPanel(onChange) {
  const el = document.createElement('div');
  el.id = 'art';
  el.innerHTML = '<header>ART DIRECTION</header>';

  for (const [group, fields] of FIELDS) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>${group}</h3>`;
    for (const [key, a, b, step] of fields) {
      const row = document.createElement('label');
      const isColor = a === 'color';
      row.innerHTML = `<span>${key.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>`;
      const input = document.createElement('input');
      if (isColor) {
        input.type = 'color';
        input.value = CFG.art[key];
      } else {
        input.type = 'range';
        input.min = a; input.max = b; input.step = step;
        input.value = CFG.art[key];
      }
      const out = document.createElement('em');
      out.textContent = isColor ? '' : CFG.art[key];
      input.addEventListener('input', () => {
        CFG.art[key] = isColor ? input.value : Number(input.value);
        if (!isColor) out.textContent = CFG.art[key];
        onChange();
      });
      row.append(input, out);
      sec.append(row);
    }
    el.append(sec);
  }

  const copy = document.createElement('button');
  copy.textContent = 'Copy config';
  copy.addEventListener('click', async () => {
    const body = Object.entries(CFG.art)
      .map(([k, v]) => `    ${k}: ${typeof v === 'string' ? `'${v}'` : v},`).join('\n');
    await navigator.clipboard.writeText(`  art: {\n${body}\n  },`);
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy config'; }, 1200);
  });
  el.append(copy);
  document.body.append(el);
  return el;
}
