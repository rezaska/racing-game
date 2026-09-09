import * as THREE from 'three';
import { CFG } from './config.js';
import { hashString } from './mathx.js';
import { Race } from './sim/race.js';
import { Track3D } from './sim/track3d.js';
import { Input } from './input.js';
import { Renderer3D } from './gfx/renderer3d.js';
import { ChaseCam } from './gfx/chasecam.js';
import { buildRoadChunks, cullChunks } from './world/roadmesh.js';
import { buildScenery } from './world/scenery.js';
import { buildCarModel, updateWheels } from './gfx/carmodel.js';

function seedFromHash() {
  const m = /seed=([^&]+)/.exec(location.hash);
  if (m) {
    const raw = decodeURIComponent(m[1]);
    const n = Number(raw);
    return Number.isFinite(n) && raw.trim() !== '' ? n >>> 0 : hashString(raw);
  }
  return (Math.random() * 0xffffffff) >>> 0;
}

const canvas = document.getElementById('scene');
const gfx = new Renderer3D(canvas);
const input = new Input();

let race, t3, road, scenery, cars;

function build(seed) {
  race = new Race(seed);
  t3 = new Track3D(race.track);
  if (road) gfx.scene.remove(road);
  road = buildRoadChunks(t3, gfx.materials);
  gfx.scene.add(road);
  if (scenery) gfx.scene.remove(scenery);
  scenery = buildScenery(t3, gfx.materials.scenery);
  gfx.scene.add(scenery);

  if (cars) cars.group.forEach((c) => gfx.scene.remove(c));
  // Muted liveries: against a blazing sky the opponents should read as dark
  // shapes with a rim, not as bright spots competing with the player's car.
  const liveries = ['#7a4a52', '#4a5a7a', '#7a6a44', '#4a7a5e', '#63487a', '#7a5240', '#40707a', '#7a4470'];
  cars = {
    player: buildCarModel(CFG.art.playerColor, { player: true }),
    group: [],
    ai: race.traffic.cars.map((c, i) => buildCarModel(liveries[i % liveries.length])),
  };
  cars.group = [cars.player, ...cars.ai];
  cars.group.forEach((c) => gfx.scene.add(c));

  cam.t3 = t3;
  cam.started = false;
  location.hash = `seed=${seed}`;
}

const cam = new ChaseCam(gfx.camera, null);
build(seedFromHash());

input.onRestart = () => build((Math.random() * 0xffffffff) >>> 0);
window.addEventListener('resize', () => gfx.resize());

const f = {};
const carState = {
  position: new THREE.Vector3(),
  velocity: new THREE.Vector3(),
  s: 0, speedPct: 0, lateralG: 0,
};

// Place a sim car (legacy z along track, x across it) onto the 3D surface.
function place(obj, z, x, yawExtra = 0) {
  const s = t3.zToS(z);
  t3.surfaceAt(s, t3.xToN(x), f);
  obj.position.set(f.x, f.y, f.z);
  obj.rotation.set(0, 0, 0);
  obj.rotateY(f.yaw + yawExtra);
  obj.rotateZ(f.bank);
  obj.rotateX(-Math.atan(f.grade));
  return f;
}

function sync() {
  const p = race.player;
  const fr = place(cars.player, p.z, p.x);
  carState.position.set(fr.x, fr.y, fr.z);
  const speed = p.speed * CFG.world.U;
  carState.velocity.set(fr.fx * speed, fr.fy * speed, fr.fz * speed);
  carState.s = t3.zToS(p.z);
  carState.speedPct = p.speed / CFG.car.MAX_SPEED;
  const seg = race.track.findSegment(p.z);
  carState.lateralG = (seg.curve / 6) * carState.speedPct * 1.9;

  race.traffic.cars.forEach((c, i) => {
    place(cars.ai[i], c.z, c.offset);
    updateWheels(cars.ai[i], c.speed * CFG.world.U, 0, CFG.DT);
  });
  updateWheels(cars.player, speed, p.steer * 0.35, CFG.DT);
}

// Dev/photo hook: run the simulation forward before the first frame. Attract
// mode already drives itself, so this yields a real mid-track view without
// needing an autopilot -- and headless browsers only ever fire a couple of
// animation frames, so screenshots have to arrive this way.
const warp = Number(new URLSearchParams(location.search).get('warp') || 0);
if (warp > 0) {
  const n = Math.round(warp / CFG.DT);
  for (let i = 0; i < n; i++) race.step(CFG.DT, { left: false, right: false, accel: false, brake: false });
  sync();
  const st = race.player.z * CFG.world.U / t3.ds;
  cullChunks(road, st, t3.ds);
  cullChunks(scenery, st, t3.ds);
  cam.update(carState, 0.5);
  for (let i = 0; i < 40; i++) cam.update(carState, CFG.DT);
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
  if (race.state === 'attract' && (held.accel || held.brake || held.left || held.right)) race.start();

  let steps = 0;
  while (acc >= CFG.DT && steps < 6) {
    race.step(CFG.DT, held);
    acc -= CFG.DT;
    steps++;
  }
  if (steps === 6) acc = 0;

  sync();
  const st = race.player.z * CFG.world.U / t3.ds;
  cullChunks(road, st, t3.ds);
  cullChunks(scenery, st, t3.ds);
  cam.update(carState, Math.max(1 / 240, ft));
  gfx.updateSun(carState.position);
  gfx.render();
  gfx.adapt(performance.now() - t0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.__game = { get race() { return race; }, get t3() { return t3; }, gfx, cam, carState, build };
