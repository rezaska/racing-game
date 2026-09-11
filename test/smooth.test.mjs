// Is the picture STEADY? Nothing else in this project can answer that.
//
// The sim tests run headless in Node and prove the car ends up in the right
// place; the screenshots prove a frame looks right. Neither can see judder,
// because judder only exists in the relationship between consecutive frames --
// and every still of a stuttering game looks perfect.
//
// So this drives the real page in a real browser over the DevTools Protocol,
// advancing the shipped loop at display rates that do NOT divide the 60 Hz
// simulation rate (which is every real display), and measures where the car
// lands on screen each frame. The metric is the second difference of its pixel
// position: steady drift cancels, jitter does not.
//
// Needs Chrome. Run it with: node test/smooth.test.mjs

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paceDivisor, refreshHz } from '../src/gfx/pace.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8231;
const CDP = 9334;
const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Frame-to-frame jitter of the car's on-screen position, in pixels of a
// 1920x1080 frame. Under a pixel is imperceptible; the staircase this test was
// written to catch measured 6-8 px RMS and 13.7 px at worst.
const LIMIT_RMS = 1.0;
const LIMIT_WORST = 3.0;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.glb': 'model/gltf-binary', '.json': 'application/json',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('no');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let id = 0;
function rpc(ws, method, params = {}) {
  const msg = { id: ++id, method, params };
  return new Promise((resolve, reject) => {
    const onMsg = (e) => {
      const d = JSON.parse(e.data);
      if (d.id !== msg.id) return;
      ws.removeEventListener('message', onMsg);
      d.error ? reject(new Error(d.error.message)) : resolve(d.result);
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify(msg));
  });
}

// Runs in the page. Drives the shipped loop, not a reimplementation of it.
const MEASURE = `(() => {
  const g = window.__game;
  const held = { left: false, right: false, accel: true, brake: false, boost: false, handbrake: false };
  const run = (hz) => {
    const base = 1 / hz;
    const px = [];
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let i = 0; i < 400; i++) {
      // Jittered on purpose: a perfectly regular cadence is the one case a
      // staircase can accidentally look smooth.
      g.advance(base * (0.92 + 0.16 * rnd()), held);
      const c = g.cam.camera;
      c.updateMatrixWorld(true);
      const v = g.cars.player.position.clone().project(c);
      px.push([v.x * 960, v.y * 540]);
    }
    let worst = 0, sum = 0;
    for (let i = 2; i < px.length; i++) {
      const ax = px[i][0] - 2 * px[i-1][0] + px[i-2][0];
      const ay = px[i][1] - 2 * px[i-1][1] + px[i-2][1];
      const d = Math.hypot(ax, ay);
      worst = Math.max(worst, d);
      sum += d * d;
    }
    return { hz, worst, rms: Math.sqrt(sum / (px.length - 2)) };
  };
  return JSON.stringify([run(144), run(120), run(60)]);
})()`;

let fails = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) fails++;
};

// --- Frame pacing, pure and headless ---------------------------------------
console.log('\n== Frame pacing ==');
check('60 Hz display renders every vsync', paceDivisor(60, 60) === 1);
check('120 Hz display renders every second vsync', paceDivisor(120, 60) === 2);
check('240 Hz display renders every fourth vsync', paceDivisor(240, 60) === 4);
// A display never reports its nominal rate exactly, and 119.8 / 60 = 1.997 --
// a bare floor() would give a divisor of 1 and no cap at all.
check('a refresh measured a hair under nominal still caps',
  paceDivisor(119.8, 60) === 2 && paceDivisor(59.8, 60) === 1);
check('an uncapped target renders every vsync', paceDivisor(120, 0) === 1);

// The important property, and the reason this uses floor rather than round:
// capping must never meaningfully undershoot. At 90 Hz, round(1.5) would give
// a divisor of 2 and the game would run at 45. The 1% floor is the measurement
// slack that lets a display reporting 119.8 Hz still cap to 2.
let under = [], worst = 60;
for (let hz = 60; hz <= 260; hz += 0.1) {
  const got = hz / paceDivisor(hz, 60);
  worst = Math.min(worst, got);
  if (got < 60 * 0.99) under.push(`${hz.toFixed(1)}Hz -> ${got.toFixed(1)}fps`);
}
check('never presents below the target on any refresh rate 60-260 Hz',
  under.length === 0, under.length ? under.slice(0, 3).join(', ') : `worst ${worst.toFixed(1)} fps`);
check('144 Hz paces evenly at 72 rather than lurching at 60',
  paceDivisor(144, 60) === 2, `${(144 / paceDivisor(144, 60)).toFixed(0)} fps`);

// Median, not mean: one 500 ms frame from a garbage collection would drag a
// mean far enough to change the divisor, and a divisor changing mid-race is
// itself a visible hitch.
const gaps = new Array(24).fill(1000 / 120);
gaps[7] = 500;
check('one stalled frame does not move the refresh estimate',
  paceDivisor(refreshHz(gaps), 60) === 2, `${refreshHz(gaps).toFixed(1)} Hz`);
check('too few samples report nothing rather than a guess',
  refreshHz([16.7, 16.7, 16.7]) === 0);

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const chrome = spawn(CHROME, [
  '--headless=new', '--no-sandbox', '--mute-audio', '--hide-scrollbars',
  `--remote-debugging-port=${CDP}`, '--window-size=960,540',
  '--user-data-dir=' + fs.mkdtempSync('/tmp/vp-smooth-'), 'about:blank',
], { stdio: 'ignore' });

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`http://127.0.0.1:${CDP}/json/version`)).ok) break; } catch {}
    if (i > 60) throw new Error('chrome did not start');
    await sleep(250);
  }

  const url = `http://127.0.0.1:${PORT}/index.html?shot=clean&warp=20#seed=777`;
  const tab = await (await fetch(
    `http://127.0.0.1:${CDP}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  await rpc(ws, 'Page.enable');
  await rpc(ws, 'Runtime.enable');
  await rpc(ws, 'Network.enable');
  // The profile is fresh, but the page is not reloaded into it -- be explicit.
  await rpc(ws, 'Network.setCacheDisabled', { cacheDisabled: true });

  let ready = false;
  for (let i = 0; i < 200 && !ready; i++) {
    const r = await rpc(ws, 'Runtime.evaluate', {
      expression: 'Boolean(window.__ready && window.__game)', returnByValue: true,
    });
    ready = r.result.value === true;
    if (!ready) await sleep(150);
  }

  console.log('\n== Steadiness (car position on screen, 1920x1080 pixels) ==');
  check('the page reaches a drivable state', ready);
  if (!ready) throw new Error('page never became ready');

  const r = await rpc(ws, 'Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  for (const m of JSON.parse(r.result.value)) {
    const px = `rms ${m.rms.toFixed(2)}px, worst ${m.worst.toFixed(2)}px`;
    check(`${m.hz} Hz display against a 60 Hz sim`,
      m.rms < LIMIT_RMS && m.worst < LIMIT_WORST, px);
  }
  ws.close();
} finally {
  chrome.kill();
  server.close();
}

console.log(fails ? `\n${fails} CHECK(S) FAILED\n` : '\nALL CHECKS PASSED\n');
process.exit(fails ? 1 : 0);
