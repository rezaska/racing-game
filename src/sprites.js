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
// proportion, and a tall sprite eats the whole screen once scaled to the ~35%
// of screen width a foreground car wants.
// `lean` (-2, 0, 2) shifts the cabin so the car reads as turning.
function carSprite(body, lean = 0) {
  const W = 44;
  const H = 21;
  const s = make(W, H);
  const cx = 22;
  const dark = shade(body, -46);
  const light = shade(body, 34);

  // Spoiler, with visible supports. Drawn as a bare bar it read as a detached
  // stripe floating above the roof.
  span(s.x, 0, cx - 11, cx + 10, OUTLINE);
  span(s.x, 1, cx - 11, cx + 10, dark);
  span(s.x, 2, cx - 8, cx - 7, OUTLINE);
  span(s.x, 2, cx + 6, cx + 7, OUTLINE);

  // Cabin then body, half-widths for rows 3..17.
  const half = [9, 10, 11, 12, 13, 15, 16, 17, 18, 18, 18, 18, 18, 18, 18];
  for (let i = 0; i < half.length; i++) {
    const y = 3 + i;
    const hw = half[i];
    span(s.x, y, cx - hw, cx + hw - 1, OUTLINE);
    span(s.x, y, cx - hw + 1, cx + hw - 2, i < 5 ? light : body);
  }

  // Rear window, leaning with the steer.
  for (let i = 0; i < 4; i++) {
    const hw = half[i + 1] - 3;
    span(s.x, 4 + i, cx - hw + lean, cx + hw - 1 + lean, GLASS);
  }
  span(s.x, 5, cx - 6 + lean, cx + 5 + lean, GLASS_HI);

  // Tail lights.
  for (let y = 12; y <= 14; y++) {
    span(s.x, y, cx - 16, cx - 10, '#e8402c');
    span(s.x, y, cx + 9, cx + 15, '#e8402c');
  }
  span(s.x, 12, cx - 16, cx - 10, '#ff8a6a');
  span(s.x, 12, cx + 9, cx + 15, '#ff8a6a');

  // Bumper and plate.
  span(s.x, 15, cx - 17, cx + 16, dark);
  span(s.x, 16, cx - 17, cx + 16, CHROME);
  span(s.x, 16, cx - 4, cx + 3, '#f0f0f0');
  span(s.x, 17, cx - 18, cx + 17, OUTLINE);

  // Tyres: overlapping the body edge so they read as attached, and standing
  // proud below it so the car has visible wheels. A full-width drop shadow here
  // instead just swallowed them into one dark skirt.
  for (let y = 14; y <= 19; y++) {
    span(s.x, y, cx - 21, cx - 17, TIRE);
    span(s.x, y, cx + 16, cx + 20, TIRE);
  }
  span(s.x, 16, cx - 20, cx - 18, '#54545e');
  span(s.x, 16, cx + 17, cx + 19, '#54545e');
  span(s.x, 20, cx - 20, cx - 18, OUTLINE);
  span(s.x, 20, cx + 17, cx + 19, OUTLINE);

  return { canvas: s.c, w: W, h: H, worldW: 900 };
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

// Broadleaf tree, to break up a roadside of nothing but palms.
function treeSprite(rng, light, dark) {
  const W = 28;
  const H = 42;
  const s = make(W, H);
  const cx = W / 2;
  for (let y = 26; y < H; y++) span(s.x, y, cx - 2, cx + 1, '#6b4a2a');
  span(s.x, H - 1, cx - 3, cx + 2, '#4a331d');

  const blobs = [
    [0, 12, 10], [-7, 17, 7], [7, 17, 8], [-4, 8, 7], [5, 8, 6],
  ];
  for (const [dx, dy, r] of blobs) {
    s.x.fillStyle = dark;
    s.x.beginPath();
    s.x.arc(cx + dx, dy + 2, r, 0, Math.PI * 2);
    s.x.fill();
  }
  for (const [dx, dy, r] of blobs) {
    s.x.fillStyle = light;
    s.x.beginPath();
    s.x.arc(cx + dx, dy, r - 1, 0, Math.PI * 2);
    s.x.fill();
  }
  return { canvas: s.c, w: W, h: H, worldW: 1150 };
}

function billboardSprite(rng) {
  const W = 48;
  const H = 40;
  const s = make(W, H);
  s.x.fillStyle = '#7b8290';
  s.x.fillRect(9, 22, 3, H - 22);
  s.x.fillRect(W - 12, 22, 3, H - 22);
  s.x.fillStyle = OUTLINE;
  s.x.fillRect(2, 1, W - 4, 24);
  const bg = ['#e8542f', '#2f8ce4', '#f0b429', '#37b46b'][Math.floor(rng() * 4)];
  s.x.fillStyle = bg;
  s.x.fillRect(4, 3, W - 8, 20);
  // Abstract "advert": a few blocks, readable at any distance.
  s.x.fillStyle = '#ffffff';
  s.x.fillRect(7, 7, 12, 4);
  s.x.fillRect(7, 14, 20, 3);
  s.x.fillStyle = 'rgba(0,0,0,0.28)';
  s.x.fillRect(W - 20, 6, 14, 12);
  return { canvas: s.c, w: W, h: H, worldW: 1900 };
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

export function buildSprites(rng, theme) {
  const player = [carSprite('#2f6fe0', -2), carSprite('#2f6fe0', 0), carSprite('#2f6fe0', 2)];
  const opponents = CAR_COLORS.map((c) => carSprite(c, 0));
  const palms = [palmSprite(rng), palmSprite(rng), palmSprite(rng)];
  const tl = theme?.trees?.[0] || '#3fa845';
  const td = theme?.trees?.[1] || '#2f8035';
  const trees = [treeSprite(rng, tl, td), treeSprite(rng, tl, td)];
  const billboards = [billboardSprite(rng), billboardSprite(rng), billboardSprite(rng)];
  return { player, opponents, palms, trees, billboards, lamp: lampSprite(), sign: signSprite(), finish: finishSprite() };
}
