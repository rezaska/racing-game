import * as THREE from 'three';
import { clamp } from './mathx.js';
import { CFG } from './config.js';
import { hashString } from './mathx.js';
import { Race } from './sim/race.js';
import { Input } from './input.js';
import { Renderer3D } from './gfx/renderer3d.js';
import { ChaseCam } from './gfx/chasecam.js';
import { buildRoadChunks, cullChunks } from './world/roadmesh.js';
import { buildScenery } from './world/scenery.js';
import { buildGuardrails, contactShadowTexture, contactShadow } from './world/guardrail.js';
import { buildRoadTextures } from './world/textures.js';
import { Sound } from './audio/sound.js';
import { buildCarModel, updateWheels } from './gfx/carmodel.js';
import { loadCarFactory, updateModelWheels } from './gfx/carload.js';
import { Hud } from './gfx/hud.js';
import { mountArtPanel } from './gfx/artpanel.js';

function seedFromHash() {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (m) {
    const raw = decodeURIComponent(m[1]);
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n >>> 0 : hashString(raw);
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const gfx = new Renderer3D(canvas);
const input = new Input();

let race, t3, road, scenery, rails, hills, cars, aiPrev;
// Swappable car source: procedural by default, any glTF via ?car=<url>.
let makeCar = buildCarModel;
let spinWheels = updateWheels;
const shadowTex = contactShadowTexture();
const sound = new Sound();

// A ring of low ridges far enough out that fog does most of the work, but close
// enough to give the horizon a silhouette instead of a hard edge.
function buildDistantHills() {
  const R = 1150;
  const seg = 128;
  const pos = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const h = 34 + Math.sin(a * 3.1) * 16 + Math.sin(a * 7.7 + 1.3) * 11 + Math.sin(a * 13.3) * 6;
    pos.push(Math.cos(a) * R, -40, Math.sin(a) * R);
    pos.push(Math.cos(a) * R, h, Math.sin(a) * R);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, gfx.materials.hills);
  m.frustumCulled = false;
  return m;
}

function build(seed) {
  race = new Race(seed);
  t3 = race.t3;
  if (road) gfx.scene.remove(road);
  road = buildRoadChunks(t3, gfx.materials);
  gfx.scene.add(road);
  if (scenery) gfx.scene.remove(scenery);
  scenery = buildScenery(t3, gfx.materials.scenery);
  gfx.scene.add(scenery);
  if (rails) gfx.scene.remove(rails);
  rails = buildGuardrails(t3, gfx.materials.rail, gfx.materials.post);
  gfx.scene.add(rails);
  if (!hills) { hills = buildDistantHills(); gfx.scene.add(hills); }

  if (cars) cars.group.forEach((c) => gfx.scene.remove(c));
  // Muted liveries: against a blazing sky the opponents should read as dark
  // shapes with a rim, not as bright spots competing with the player's car.
  const liveries = ['#7a4a52', '#4a5a7a', '#7a6a44', '#4a7a5e', '#63487a', '#7a5240', '#40707a', '#7a4470'];
  cars = {
    player: makeCar(CFG.art.playerColor, { player: true }),
    group: [],
    ai: race.traffic.cars.map((c, i) => makeCar(liveries[i % liveries.length])),
  };
  cars.group = [cars.player, ...cars.ai];
  aiPrev = race.traffic.cars.map((c) => ({ s: t3.zToS(c.z), n: t3.xToN(c.offset) }));
  cars.group.forEach((c) => {
    c.add(contactShadow(shadowTex));
    gfx.scene.add(c);
  });

  cam.t3 = t3;
  cam.started = false;
  location.hash = `seed=${seed}`;
}

const cam = new ChaseCam(gfx.camera, null);
const hud = new Hud(document.getElementById('hud'));

const loadEl = document.getElementById('loading');
const loadBar = loadEl?.querySelector('.lo-bar i');
const loadStep = loadEl?.querySelector('.lo-step');
const setProgress = (p, label) => {
  if (loadBar) loadBar.style.width = `${Math.round(p * 100)}%`;
  if (loadStep) loadStep.textContent = label;
};
// Yield via a timer, not requestAnimationFrame: rAF does not run in a
// background tab or under a headless browser's virtual clock, and boot would
// simply never finish there.
// In capture mode boot synchronously: a headless screenshot fires at the load
// event, so anything produced after an await simply is not in the picture.
const SHOT = params.has('shot');
const nextFrame = () => (SHOT ? Promise.resolve() : new Promise((r) => setTimeout(r, 16)));

async function boot() {
  setProgress(0.08, 'generating road surface');
  await nextFrame();
  gfx.applyRoadTextures(buildRoadTextures(gfx.renderer));

  // Car model: config default, overridden by ?car=<url>, disabled by ?car=none.
  const carParam = params.get('car');
  const url = carParam === 'none' ? null
    : carParam === 'ferrari'
      ? 'https://raw.githubusercontent.com/mrdoob/three.js/r180/examples/models/gltf/ferrari.glb'
      : (carParam || CFG.carModel);
  if (url) {
    setProgress(0.25, 'loading car model');
    await nextFrame();
    try {
      makeCar = await loadCarFactory(url);
      spinWheels = updateModelWheels;
    } catch (err) {
      // Never let a missing model take the whole page down.
      console.warn('car model failed to load, using the built-in one:', err);
    }
  }

  setProgress(0.45, 'building the course');
  await nextFrame();
  build(seedFromHash());

  setProgress(0.75, 'compiling shaders');
  await nextFrame();
  // Warm every material now. three compiles a program the first time a
  // material/light/fog combination is drawn, which otherwise lands as a
  // ~200ms freeze partway through the first lap.
  gfx.renderer.compile(gfx.scene, gfx.camera);

  setProgress(1, 'ready');
  await nextFrame();
  document.body.classList.add('loaded');
  // Diagnostic hook: says which car source is live and whether its wheels were
  // found, which is the thing that silently fails with a downloaded model.
  const w = cars?.player?.userData?.wheels?.length ?? 0;
  window.__ready = { car: makeCar === buildCarModel ? 'procedural' : 'gltf', wheels: w };
  if (params.has('probe')) document.title = `READY car=${window.__ready.car} wheels=${w}`;
}

// --- page <-> game ---
function enterRace() {
  if (race.state !== 'attract') return;
  // Same gesture that starts the race unlocks audio; browsers will not let it
  // start any other way.
  sound.start();
  race.start();
  document.body.classList.add('playing');
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function leaveRace() {
  race.toAttract();
  document.body.classList.remove('playing');
}
document.getElementById('start').addEventListener('click', enterRace);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') leaveRace();
  else if (e.code === 'KeyM') sound.toggleMute();
  // Only take over the keyboard once the page is out of the way.
  else if (document.body.classList.contains('playing') && e.code === 'KeyR') {
    build((Math.random() * 0xffffffff) >>> 0);
    race.start();
  }
});

if (params.has('art')) {
  mountArtPanel(() => { gfx.syncArt(); });
}


// Photo mode: strip every overlay so stills show the render alone.
// shot=1 keeps the HUD; shot=clean strips it too, for art-direction stills.
function photoMode() {
  const clean = params.get('shot') === 'clean';
  const ids = clean ? ['hero', 'story', 'hud', 'loading'] : ['hero', 'story', 'loading'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.body.classList.add('playing');
}

// Third-party asset credit, wherever it comes from.
{
  const text = params.get('credit') || CFG.credits.car;
  const el = document.querySelector('[data-credit]');
  if (el && text) {
    const url = CFG.credits.carUrl;
    el.innerHTML = url ? `Car model: <a href="${url}">${text}</a>` : `Car model: ${text}`;
  }
}

window.addEventListener('resize', () => gfx.resize());

const f = {};
const carState = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  s: 0, speedPct: 0, lateralG: 0,
};

// AI cars stay in legacy (z, offset) units and are converted only for display.
// The lateral RATE has to go into their heading or they visibly crab sideways
// through every lane change.
function placeAI(obj, car, i) {
  const s = t3.zToS(car.z);
  const n = t3.xToN(car.offset);
  t3.surfaceAt(s, n, f);
  obj.position.set(f.x, f.y, f.z);
  const prev = aiPrev[i];
  const ds = Math.max(0.01, s - prev.s);
  const yaw = f.yaw + Math.atan2(-(n - prev.n), ds);
  prev.s = s; prev.n = n;
  obj.rotation.set(0, 0, 0);
  obj.rotateY(yaw);
  obj.rotateZ(f.bank);
  // +, not -: rotateX(+t) pitches the nose UP, and grade is positive uphill.
  obj.rotateX(Math.atan(f.grade));
  return f;
}

function sync(dt) {
  const p = race.player;

  // The player sits on the road surface at its projected position, but points
  // along its OWN heading -- that difference between where the car is going and
  // where it is aimed is the whole feel of driving.
  t3.surfaceAt(p.s, p.n, f);
  const car = cars.player;
  car.position.set(f.x, f.y, f.z);
  car.rotation.set(0, 0, 0);
  car.rotateY(p.psi);
  car.rotateZ(f.bank + bodyRoll);
  car.rotateX(Math.atan(f.grade) + bodyPitch);

  carState.position.set(f.x, f.y, f.z);
  const sinP = Math.sin(p.psi), cosP = Math.cos(p.psi);
  carState.velocity.set(
    -sinP * p.vx - cosP * p.vy, 0,
    -cosP * p.vx + sinP * p.vy,
  );
  carState.s = p.s;
  carState.speedPct = p.speedPct;
  carState.lateralG = p.lateralG;

  spinWheels(cars.player, p.vx, p.delta, dt);
  race.traffic.cars.forEach((c, i) => {
    placeAI(cars.ai[i], c, i);
    spinWheels(cars.ai[i], c.speed * CFG.world.U, 0, dt);
  });
}

// Body attitude. Roll and pitch from acceleration are the single biggest cue
// that the car has mass.
let bodyRoll = 0;
let bodyPitch = 0;
function updateBody(dt) {
  const p = race.player;
  const rollT = clamp(-p.lateralG * 0.10, -0.12, 0.12);
  const pitchT = clamp((p.vx - lastVx) / Math.max(dt, 1e-3) / 9.81 * 0.05, -0.06, 0.06);
  lastVx = p.vx;
  bodyRoll += (rollT - bodyRoll) * (1 - Math.exp(-dt / 0.13));
  bodyPitch += (pitchT - bodyPitch) * (1 - Math.exp(-dt / 0.11));
}
let lastVx = 0;

// Dev/photo hook: run the simulation forward before the first frame. Attract
// mode drives itself, so this yields a real mid-track view without an
// autopilot -- and headless browsers only fire a couple of animation frames, so
// screenshots have to arrive this way.
function runWarp() {
  const warp = Number(params.get('warp') || 0);
  if (warp <= 0) return;
  const idle = { left: false, right: false, accel: false, brake: false };
  const wrapAng = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  // When warping into a race, drive it -- otherwise a still shows a car
  // stationary on the grid rather than the game being played.
  const autopilot = () => {
    const p = race.player;
    const look = t3.frameAt(Math.min(p.s + 16, t3.length - 1), {});
    const cmd = wrapAng(look.yaw - p.psi) * 1.7 + (p.n / t3.halfWidth) * 0.7;
    return {
      left: cmd > 0.03, right: cmd < -0.03, accel: true, brake: false,
      boost: Math.abs(cmd) < 0.06 && p.boost > 0.4, handbrake: false,
    };
  };
  for (let i = 0; i < Math.round(warp / CFG.DT); i++) {
    race.step(CFG.DT, race.state === 'racing' ? autopilot() : idle);
  }
  updateBody(CFG.DT);
  sync(CFG.DT);
  const st0 = race.player.s / t3.ds;
  cullChunks(road, st0, t3.ds);
  cullChunks(scenery, st0, t3.ds);
  cullChunks(rails, st0, t3.ds);
  cam.update(carState, 0.5);
  for (let i = 0; i < 40; i++) cam.update(carState, CFG.DT);
}

// Benchmark hook: render N frames back to back, forcing a GPU sync each time so
// the number is real work and not just queued commands.
const bench = Number(params.get('bench') || 0);
if (bench > 0) {
  const gl = gfx.renderer.getContext();
  const idle = { left: false, right: false, accel: true, brake: false };
  for (let i = 0; i < 20; i++) { race.step(CFG.DT, idle); sync(CFG.DT); cam.update(carState, CFG.DT); gfx.render(CFG.DT, 0.5); }
  gl.finish();
  const times = [];
  for (let i = 0; i < bench; i++) {
    const t0 = performance.now();
    race.step(CFG.DT, idle);
    updateBody(CFG.DT);
    sync(CFG.DT);
    const st = race.player.s / t3.ds;
    cullChunks(road, st, t3.ds); cullChunks(scenery, st, t3.ds); cullChunks(rails, st, t3.ds);
    cam.update(carState, CFG.DT);
    gfx.updateSun(carState.position);
    gfx.render(CFG.DT, carState.speedPct);
    gl.finish();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1];
  const p95 = times[Math.floor(times.length * 0.95)];
  const info = gfx.renderer.info.render;
  document.title = `BENCH med=${med.toFixed(2)}ms p95=${p95.toFixed(2)}ms fps=${(1000 / med).toFixed(0)} calls=${info.calls} tris=${info.triangles} dpr=${gfx.renderer.getPixelRatio().toFixed(2)}`;
}

let acc = 0;
let last = performance.now();

function frame(now) {
  const t0 = now;
  let ft = (now - last) / 1000;
  last = now;
  if (ft > 0.25) ft = 0.25;

  acc += ft;
  const held = input.poll();
  if (race.state === 'attract' && (held.accel || held.brake || held.left || held.right)) enterRace();

  let steps = 0;
  while (acc >= CFG.DT && steps < 6) {
    race.step(CFG.DT, held);
    acc -= CFG.DT;
    steps++;
  }
  if (steps === 6) acc = 0;

  updateBody(Math.max(1 / 240, ft));
  sync(Math.max(1 / 240, ft));
  const st = race.player.s / t3.ds;
  cullChunks(road, st, t3.ds);
  cullChunks(scenery, st, t3.ds);
  cullChunks(rails, st, t3.ds);
  cam.update(carState, Math.max(1 / 240, ft));
  if (hills) hills.position.set(carState.position.x, 0, carState.position.z);
  gfx.updateSun(carState.position);
  const pl = race.player;
  sound.update(
    Math.abs(pl.vx), held.accel ? 1 : 0, held.brake ? 1 : 0,
    pl.slip, pl.offroad, race.state === 'racing' || race.state === 'countdown',
  );
  hud.update(race);
  gfx.render(ft, carState.speedPct);
  gfx.adapt(performance.now() - t0);
  requestAnimationFrame(frame);
}
await boot();
if (params.has('shot')) photoMode();
if (params.has('play') || params.has('shot')) enterRace();
runWarp();
// Draw one frame synchronously before handing over to rAF. Without this a
// headless capture gets nothing: the boot's timer yields consume the virtual
// clock, and no animation frame is ever delivered afterwards.
sync(CFG.DT);
cam.update(carState, CFG.DT);
gfx.updateSun(carState.position);
gfx.render(CFG.DT, carState.speedPct);
last = performance.now();
requestAnimationFrame(frame);

window.__game = { get race() { return race; }, get t3() { return t3; }, gfx, cam, carState, build };
