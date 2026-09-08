import { CFG } from './config.js';
import { hashString } from './mathx.js';
import { Race } from './race.js';
import { Camera } from './camera.js';
import { Input } from './input.js';
import { buildCache, render } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const cam = new Camera();
const input = new Input();

function seedFromHash() {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (m) {
    const raw = decodeURIComponent(m[1]);
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? (n >>> 0) : hashString(raw);
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

let race = new Race(seedFromHash());
cam.snapTo(race.player);

function newRace(seed) {
  race = new Race(seed);
  location.hash = `seed=${race.seed}`;
  cam.snapTo(race.player);
  cam.zoom = 1;
}

input.onRestart = () => newRace((Math.random() * 0xffffffff) >>> 0);
window.addEventListener('hashchange', () => {
  const s = seedFromHash();
  if (s !== race.seed) newRace(s);
});

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  cam.resize(w, h, dpr);
  buildCache(ctx, cam);
}
window.addEventListener('resize', resize);
resize();

if (!location.hash) location.hash = `seed=${race.seed}`;

let acc = 0;
let last = performance.now();

function frame(now) {
  let ft = (now - last) / 1000;
  last = now;
  if (ft > 0.25) ft = 0.25; // tab-switch guard: never try to catch up 30s

  acc += ft;
  const pi = input.poll();
  let steps = 0;
  while (acc >= CFG.DT && steps < 8) {
    race.step(CFG.DT, pi);
    cam.follow(race.player, CFG.DT);
    acc -= CFG.DT;
    steps++;
  }
  if (steps === 8) acc = 0; // bail rather than death-spiral

  render(ctx, cam, race);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
