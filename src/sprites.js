// Pixel-art sprites drawn procedurally at 1px granularity onto offscreen
// canvases at boot. Building them with span fills rather than big ASCII blocks
// keeps the shapes editable and makes width mistakes impossible.

function make(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  return { c, x, w, h };
}

// Horizontal span, inclusive of x0 and x1.
function span(x, y, x0, x1, color) {
  if (x1 < x0) return;
  x.fillStyle = color;
  x.fillRect(x0, y, x1 - x0 + 1, 1);
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const OUTLINE = '#141018';
const TIRE = '#1a1a1f';
const GLASS = '#24304a';
const GLASS_HI = '#4a6690';
const CHROME = '#c8ccd6';

// Rear view car. Wide and low: the sprite's aspect ratio IS its on-screen
// proportion, and a tall sprite eats the whole screen once it is scaled to the
// ~35% of screen width a foreground car wants.
// `lean` (-2, 0, 2) shifts the cabin so the car reads as turning.
function carSprite(body, lean = 0) {
  const W = 44;
  const H = 21;
  const s = make(W, H);
  const cx = W / 2;
  const dark = shade(body, -46);
  const light = shade(body, 34);

  // Body half-widths for rows 2..16, widening toward the bumper.
  const half = [7, 8, 10, 12, 13, 14, 15, 16, 17, 17, 18, 18, 18, 18, 18];
  const top = 2;

  for (let i = 0; i < half.length; i++) {
    const y = top + i;
    const hw = half[i];
    span(s.x, y, cx - hw, cx + hw - 1, OUTLINE);
    span(s.x, y, cx - hw + 1, cx + hw - 2, i < 4 ? light : body);
  }

  // Spoiler across the shoulders.
  span(s.x, top - 2, cx - 12, cx + 11, OUTLINE);
  span(s.x, top - 1, cx - 12, cx + 11, dark);

  // Rear window, leaning with the steer.
  for (let i = 1; i <= 4; i++) {
    const y = top + i;
    const hw = half[i] - 3;
    if (hw > 0) span(s.x, y, cx - hw + lean, cx + hw - 1 + lean, GLASS);
  }
  span(s.x, top + 2, cx - half[2] + 5 + lean, cx + half[2] - 6 + lean, GLASS_HI);

  // Tail lights.
  for (let y = top + 9; y <= top + 11; y++) {
    span(s.x, y, cx - 16, cx - 10, '#e8402c');
    span(s.x, y, cx + 9, cx + 15, '#e8402c');
  }
  span(s.x, top + 9, cx - 16, cx - 10, '#ff8a6a');
  span(s.x, top + 9, cx + 9, cx + 15, '#ff8a6a');

  // Bumper and plate.
  span(s.x, top + 12, cx - 17, cx + 16, dark);
  span(s.x, top + 13, cx - 17, cx + 16, CHROME);
  span(s.x, top + 13, cx - 4, cx + 3, '#f0f0f0');
  span(s.x, top + 14, cx - 18, cx + 17, OUTLINE);

  // Tyres, proud of the body on both sides.
  for (let y = top + 12; y <= top + 16; y++) {
    span(s.x, y, cx - 21, cx - 17, TIRE);
    span(s.x, y, cx + 16, cx + 20, TIRE);
  }
  // Contact shadow so the car sits on the road rather than floating.
  s.x.fillStyle = 'rgba(0,0,0,0.35)';
  s.x.fillRect(cx - 19, H - 2, 38, 2);

  return { canvas: s.c, w: W, h: H, worldW: 700 };
}

function palmSprite(rng) {
  const W = 26;
  const H = 46;
  const s = make(W, H);
  const trunkTop = 12;
  const bend = rng() < 0.5 ? -1 : 1;

  // Trunk: a gentle S, two pixels wide with a darker side.
  for (let y = H - 1; y >= trunkTop; y--) {
    const t = (H - 1 - y) / (H - 1 - trunkTop);
    const x = Math.round(W / 2 + bend * Math.sin(t * 1.6) * 3.2);
    span(s.x, y, x - 1, x + 1, '#7a5327');
    span(s.x, y, x - 1, x - 1, '#553a1b');
    span(s.x, y, x + 1, x + 1, '#a3703a');
  }

  const hx = Math.round(W / 2 + bend * Math.sin(1.6) * 3.2);
  const hy = trunkTop;
  // Fronds: straight strokes fanning from the crown, dark underside first.
  const fronds = [
    [-11, 4], [-8, -3], [-4, -7], [2, -8], [6, -5], [10, 1], [11, 6], [-11, 8],
  ];
  for (const [dx, dy] of fronds) {
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const px = Math.round(hx + dx * t);
      const py = Math.round(hy + dy * t + t * t * 4);
      s.x.fillStyle = i > steps * 0.6 ? '#2f8f3c' : '#43b552';
      s.x.fillRect(px, py, 2, 2);
    }
  }
  s.x.fillStyle = '#6ede5a';
  s.x.fillRect(hx - 1, hy - 1, 3, 3);
  s.x.fillStyle = '#8a5f2a';
  s.x.fillRect(hx - 1, hy + 1, 2, 2);

  return { canvas: s.c, w: W, h: H, worldW: 1250 };
}

function signSprite() {
  const W = 20;
  const H = 26;
  const s = make(W, H);
  for (let y = 12; y < H; y++) span(s.x, y, 9, 10, '#8a8f9a');
  s.x.fillStyle = OUTLINE;
  s.x.fillRect(0, 0, W, 13);
  s.x.fillStyle = '#f0c020';
  s.x.fillRect(1, 1, W - 2, 11);
  s.x.fillStyle = OUTLINE;
  s.x.fillRect(3, 4, 3, 5);
  s.x.fillRect(8, 4, 3, 5);
  s.x.fillRect(13, 4, 4, 2);
  return { canvas: s.c, w: W, h: H, worldW: 520 };
}

function lampSprite() {
  const W = 16;
  const H = 48;
  const s = make(W, H);
  for (let y = 6; y < H; y++) span(s.x, y, 3, 4, '#6b7280');
  span(s.x, H - 1, 2, 5, '#3f4650');
  // Arm and head reaching over the road.
  for (let x = 4; x <= 11; x++) span(s.x, 6, x, x, '#6b7280');
  s.x.fillStyle = '#3f4650';
  s.x.fillRect(9, 7, 5, 3);
  s.x.fillStyle = '#ffe9a8';
  s.x.fillRect(10, 10, 3, 1);
  s.x.fillStyle = 'rgba(255,233,168,0.28)';
  s.x.fillRect(8, 11, 7, 4);
  return { canvas: s.c, w: W, h: H, worldW: 900 };
}

function finishSprite() {
  const W = 120;
  const H = 40;
  const s = make(W, H);
  // Posts
  s.x.fillStyle = '#d8dae0';
  s.x.fillRect(2, 6, 5, H - 6);
  s.x.fillRect(W - 7, 6, 5, H - 6);
  s.x.fillStyle = OUTLINE;
  s.x.fillRect(2, 6, 1, H - 6);
  s.x.fillRect(W - 3, 6, 1, H - 6);
  // Chequered banner
  const sq = 5;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < (W - 14) / sq; c++) {
      s.x.fillStyle = (r + c) % 2 ? '#141018' : '#f2f2f2';
      s.x.fillRect(7 + c * sq, 2 + r * sq, sq, sq);
    }
  }
  s.x.fillStyle = OUTLINE;
  s.x.fillRect(7, 1, W - 14, 1);
  s.x.fillRect(7, 17, W - 14, 1);
  return { canvas: s.c, w: W, h: H, worldW: 5200 };
}

export const CAR_COLORS = [
  '#2f6fe0', '#e04a3a', '#f0b429', '#37b46b',
  '#a35ce0', '#e07a2f', '#2fc2c8', '#d94f8e',
];

export function buildSprites(rng) {
  const player = [carSprite('#2f6fe0', -2), carSprite('#2f6fe0', 0), carSprite('#2f6fe0', 2)];
  const opponents = CAR_COLORS.map((c) => carSprite(c, 0));
  const palms = [palmSprite(rng), palmSprite(rng), palmSprite(rng)];
  return { player, opponents, palms, lamp: lampSprite(), sign: signSprite(), finish: finishSprite() };
}
