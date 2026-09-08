import { CFG } from './config.js';
import { clamp, hashString } from './mathx.js';
import { Race } from './race.js';
import { Input } from './input.js';
import { drawBackground, renderRoad, drawPlayer, drawHUD, playerElevation } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d', { alpha: false });
const input = new Input();

function seedFromHash() {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (m) {
    const raw = decodeURIComponent(m[1]);
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n >>> 0 : hashString(raw);
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

const themeFromHash = () => (/theme=night/.test(location.hash) ? 'night' : 'coast');

let race = new Race(seedFromHash(), themeFromHash());
let iw = 0;
let ih = 0;

// The backing store is the internal pixel-art resolution; CSS scales it up by a
// whole number with image-rendering: pixelated, so pixels stay square. Height is
// fixed and width follows the window aspect, so widescreen fills without bars.
function resize() {
  ih = CFG.res.H;
  const aspect = window.innerWidth / window.innerHeight;
  iw = clamp(Math.round(ih * aspect), CFG.res.W_MIN, CFG.res.W_MAX);
  iw -= iw % 2;

  canvas.width = iw;
  canvas.height = ih;
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / iw, window.innerHeight / ih)));
  canvas.style.width = `${iw * scale}px`;
  canvas.style.height = `${ih * scale}px`;
  ctx.imageSmoothingEnabled = false;

  race.resize(iw, ih);
}
window.addEventListener('resize', resize);
resize();

function newRace(seed, theme = race.themeName) {
  race = new Race(seed, theme);
  race.resize(iw, ih);
  location.hash = `seed=${seed}${theme === 'night' ? '&theme=night' : ''}`;
}

input.onRestart = () => newRace((Math.random() * 0xffffffff) >>> 0);
input.onTheme = () => {
  race.setTheme(race.themeName === 'coast' ? 'night' : 'coast');
  location.hash = `seed=${race.seed}${race.themeName === 'night' ? '&theme=night' : ''}`;
};

if (!location.hash) location.hash = `seed=${race.seed}`;

function render() {
  ctx.imageSmoothingEnabled = false;
  drawBackground(ctx, race.bg, iw, ih, race.bgOffset, playerElevation(race.track, race.player));
  const info = renderRoad(ctx, iw, ih, race.track, race.player, race.theme, race.sprites);
  drawPlayer(ctx, iw, ih, race.player, race.sprites, info);
  drawHUD(ctx, iw, ih, race);
}

let acc = 0;
let last = performance.now();

function frame(now) {
  let ft = (now - last) / 1000;
  last = now;
  if (ft > 0.25) ft = 0.25; // tab-switch guard: never try to catch up

  acc += ft;
  const held = input.poll();
  let steps = 0;
  while (acc >= CFG.DT && steps < 6) {
    race.step(CFG.DT, held);
    acc -= CFG.DT;
    steps++;
  }
  if (steps === 6) acc = 0;

  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
