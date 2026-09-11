import { CFG } from '../config.js';

// Live art direction. Everything the renderer reads for look lives in CFG.art,
// so this panel writes straight into it -- and "Copy config" emits a pasteable
// block, which is what turns a look dialled in the browser into the committed
// default rather than a description someone has to reimplement.
//
// Camera framing is here for the same reason: how far back a chase camera
// belongs is a judgement made by watching it move, never by reading a number.
// CFG.camera and CFG.render are read every frame, so edits apply immediately
// with no rebuild of the scene.

const FIELDS = [
  ['Sun', 'art', [
    ['sunElevation', 0.5, 25, 0.1], ['sunAzimuth', -180, 180, 1],
    ['sunIntensity', 0, 14, 0.1], ['ambient', 0, 3, 0.05],
  ]],
  ['Sky', 'art', [
    ['skyZenith', 'color'], ['skyMid', 'color'], ['skyHorizon', 'color'],
    ['sunColor', 'color'], ['skyMidPoint', 0.05, 0.9, 0.01],
    ['sunSize', 0.002, 0.06, 0.001], ['sunGlow', 0, 0.6, 0.01],
  ]],
  ['Atmosphere', 'art', [
    ['fogColor', 'color'], ['fogDensity', 0, 0.012, 0.0001],
  ]],
  ['Surfaces', 'art', [
    ['roadColor', 'color'], ['terrainNear', 'color'], ['terrainFar', 'color'],
    ['sceneryColor', 'color'], ['ambientSky', 'color'], ['ambientGround', 'color'],
    ['playerColor', 'color'],
  ]],
  ['Grade', 'art', [
    ['exposure', 0.2, 2.2, 0.01], ['bloomStrength', 0, 1.5, 0.01],
    ['bloomThreshold', 0, 1.2, 0.01], ['bloomRadius', 0, 1.5, 0.01],
    ['gradeShadow', 'color'], ['gradeHighlight', 'color'],
    ['gradeStrength', 0, 1, 0.01], ['vignette', 0, 1, 0.01], ['grain', 0, 0.12, 0.002],
  ]],
  ['Camera', 'camera', [
    ['BACK', 3, 16, 0.1], ['BACK_SPEED', 0, 6, 0.1],
    ['UP', 0.8, 6, 0.05], ['UP_SPEED', 0, 2, 0.05],
    ['LOOK_UP', 0, 5, 0.1], ['LOOKAHEAD_S', 0, 3, 0.05],
    ['TAU_YAW', 0.05, 0.8, 0.01], ['TAU_POS', 0.02, 0.5, 0.01],
    ['ROLL_MAX', 0, 0.2, 0.005],
  ]],
  ['Lens', 'render', [
    ['FOV_MIN', 35, 95, 1], ['FOV_MAX', 35, 110, 1],
  ]],
];

// Which CFG blocks the copy button emits, and whether it emits the whole block
// or only the keys the panel exposes. `render` holds shadow and culling numbers
// the panel never touches, so a full dump of it would be misleading to paste.
const EMIT = [['art', 'all'], ['camera', 'all'], ['render', 'panel']];

export function mountArtPanel(onChange) {
  const el = document.createElement('div');
  el.id = 'art';
  el.innerHTML = '<header>ART DIRECTION</header>';

  for (const [group, target, fields] of FIELDS) {
    const sec = document.createElement('section');
    sec.innerHTML = `<h3>${group}</h3>`;
    for (const [key, a, b, step] of fields) {
      const row = document.createElement('label');
      const isColor = a === 'color';
      row.innerHTML = `<span>${key.replace(/([A-Z])/g, ' $1').toLowerCase().trim()}</span>`;
      const input = document.createElement('input');
      if (isColor) {
        input.type = 'color';
        input.value = CFG[target][key];
      } else {
        input.type = 'range';
        input.min = a; input.max = b; input.step = step;
        input.value = CFG[target][key];
      }
      const out = document.createElement('em');
      out.textContent = isColor ? '' : CFG[target][key];
      input.addEventListener('input', () => {
        CFG[target][key] = isColor ? input.value : Number(input.value);
        if (!isColor) out.textContent = CFG[target][key];
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
    const blocks = EMIT.map(([target, scope]) => {
      const keys = scope === 'all'
        ? Object.keys(CFG[target])
        : FIELDS.filter((f) => f[1] === target).flatMap((f) => f[2]).map((f) => f[0]);
      const body = keys
        .map((k) => `    ${k}: ${typeof CFG[target][k] === 'string' ? `'${CFG[target][k]}'` : CFG[target][k]},`)
        .join('\n');
      return `  ${target}: {\n${body}\n  },`;
    });
    await navigator.clipboard.writeText(blocks.join('\n'));
    copy.textContent = 'Copied';
    setTimeout(() => { copy.textContent = 'Copy config'; }, 1200);
  });
  el.append(copy);
  document.body.append(el);
  return el;
}
