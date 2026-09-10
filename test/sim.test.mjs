// Headless simulation tests.
//
// Nothing under src/sim imports three.js or touches the DOM, so this runs in
// plain Node with no canvas stub. That separation is the point: a rendering
// change can never silently break race logic without this failing.
//
//   node test/sim.test.mjs

const SRC = new URL('../src/', import.meta.url).href;
const { CFG } = await import(`${SRC}config.js`);
const { Track } = await import(`${SRC}sim/track.js`);
const { Track3D } = await import(`${SRC}sim/track3d.js`);
const { Race } = await import(`${SRC}sim/race.js`);
const { mulberry32 } = await import(`${SRC}mathx.js`);

let fails = 0;
const ok = (c, m, x = '') => { if (!c) fails++; console.log(`${c ? '  PASS' : '  FAIL'}  ${m}${x ? '  ' + x : ''}`); };
const DT = CFG.DT;

// An arcade driver: aim at the road ahead and hold the throttle. That it can
// do that at all is the point -- the old simulation model needed the entry
// speed managed for every corner.
const V_MAX = CFG.car.MAX_SPEED * CFG.world.U;
function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

function drive(race) {
  const p = race.player;
  const t3 = race.t3;
  const look = t3.frameAt(Math.min(p.s + 20, t3.length - 1), {});
  const cmd = wrap(look.yaw - p.psi) * 1.7 + (p.n / t3.halfWidth) * 0.7;
  return {
    left: cmd > 0.03,
    right: cmd < -0.03,
    accel: true,
    brake: false,
    boost: Math.abs(cmd) < 0.06 && p.boost > 0.4,
    handbrake: false,
  };
}

console.log('\n== Track generation ==');
{
  const a = new Track(1234), b = new Track(1234), c = new Track(999);
  let same = a.segments.length === b.segments.length;
  for (let i = 0; i < a.segments.length && same; i++) if (a.segments[i].curve !== b.segments[i].curve) same = false;
  ok(same, 'same seed -> identical course');
  let diff = a.segments.length !== c.segments.length;
  for (let i = 0; i < Math.min(a.segments.length, c.segments.length) && !diff; i++) {
    if (a.segments[i].curve !== c.segments[i].curve) diff = true;
  }
  ok(diff, 'different seed -> different course');
}

console.log('\n== 3D track geometry (200 seeds) ==');
{
  let maxGrade = 0, maxBank = 0, minCrest = 1e9, loops = 0, closest = 1e9;
  for (let s = 1; s <= 200; s++) {
    const t3 = new Track3D(new Track(s));
    const n = t3.n, ds = t3.ds;
    for (let i = 0; i <= n; i++) maxBank = Math.max(maxBank, Math.abs(t3.bank[i]));
    for (let i = 0; i < n; i++) maxGrade = Math.max(maxGrade, Math.abs(t3.py[i + 1] - t3.py[i]) / ds);
    for (let i = 1; i < n; i++) {
      const d2 = Math.abs((t3.py[i + 1] - 2 * t3.py[i] + t3.py[i - 1]) / (ds * ds));
      if (d2 > 1e-9) minCrest = Math.min(minCrest, 1 / d2);
    }
    let mn = 1e9;
    for (let i = 0; i < n; i += 4) for (let j = i + 200; j < n; j += 4) {
      const d = Math.hypot(t3.px[i] - t3.px[j], t3.pz[i] - t3.pz[j]);
      if (d < mn) mn = d;
    }
    closest = Math.min(closest, mn);
    if (mn < 20) loops++;
  }
  ok(maxGrade <= 0.131, 'max grade <= 13% (raw generator gives 126%)', (maxGrade * 100).toFixed(1) + '%');
  ok(maxBank <= CFG.world.BANK_MAX + 1e-9, 'max bank <= 7 deg', (maxBank * 180 / Math.PI).toFixed(2) + ' deg');
  ok(minCrest > 40, 'crests give air, not a launch ramp', minCrest.toFixed(0) + ' m radius');
  ok(loops === 0, 'no course folds back on itself', `${loops}/200, closest ${closest.toFixed(0)} m`);
}

console.log('\n== Projection round-trip ==');
{
  const t3 = new Track3D(new Track(1234));
  const rng = mulberry32(7);
  let ws = 0, wn = 0, hint = 0;
  for (let k = 0; k < 10000; k++) {
    const s = rng() * t3.length, nOff = (rng() * 2 - 1) * t3.halfWidth * 1.6;
    const p = t3.surfaceAt(s, nOff, {});
    const r = t3.projectToTrack(p.x, p.y, p.z, hint); hint = r.i;
    ws = Math.max(ws, Math.abs(r.s - s));
    wn = Math.max(wn, Math.abs(r.n - nOff));
  }
  ok(ws < 1e-3 && wn < 1e-3, 'world point -> (s, n) inverts exactly',
     `s ${ws.toExponential(1)} m, n ${wn.toExponential(1)} m`);
}

console.log('\n== Handling ==');
{
  const GO = { left: false, right: false, accel: true, brake: false };
  // Clear the road first. Now that collisions work, an unsteered run straight
  // off the line just rear-ends the grid, and this would measure that instead.
  const clear = (r) => r.traffic.cars.forEach((c) => { c.z += 1e6; });

  const race = new Race(1234); race.start(); race.state = 'racing'; clear(race);
  for (let i = 0; i < 60 * (CFG.car.ACCEL_TIME + 4); i++) race.step(DT, drive(race));
  ok(race.player.speed > V_MAX * 0.9, 'reaches top speed on the throttle',
     `${(race.player.speed * 3.6).toFixed(0)} km/h`);

  // Turn-in. This is the thing the simulation model did not have: half a second
  // of steering must actually rotate the car.
  const r2 = new Race(1234); r2.start(); r2.state = 'racing'; clear(r2);
  for (let i = 0; i < 60 * 5; i++) r2.step(DT, GO);
  const psi0 = r2.player.psi;
  for (let i = 0; i < 30; i++) r2.step(DT, { left: true, right: false, accel: true, brake: false });
  const turned = Math.abs(r2.player.psi - psi0) * 57.3;
  ok(turned > 8 && turned < 70, 'half a second of steering turns the car usefully',
     `${turned.toFixed(1)} deg`);

  // Compared from the start line, on the opening straight. Running the two
  // cases from a rolling start instead just measures which one wandered off
  // the road first.
  const run = (boost) => {
    const r = new Race(1234); r.start(); r.state = 'racing'; clear(r);
    for (let i = 0; i < 60 * 3; i++) r.step(DT, { ...GO, boost });
    return r.player.speed;
  };
  const plain = run(false);
  const boosted = run(true);
  ok(boosted > plain * 1.1, 'boost is a real gain',
     `${(plain * 3.6).toFixed(0)} -> ${(boosted * 3.6).toFixed(0)} km/h`);
}

console.log('\n== Races ==');
for (const seed of [1234, 42, 777]) {
  const race = new Race(seed); race.start();
  let startPlace = null, steps = 0, worstX = 0, maxSlip = 0;
  while (race.state !== 'finished' && steps < 60 * 240) {
    race.step(DT, race.state === 'racing' ? drive(race) : { left: 0, right: 0, accel: 0, brake: 0 });
    if (startPlace === null && race.player.place) startPlace = race.player.place;
    worstX = Math.max(worstX, Math.abs(race.player.x));
    maxSlip = Math.max(maxSlip, race.player.slip);
    steps++;
  }
  ok(race.state === 'finished', `seed ${seed}: player finished`,
     `${race.player.finishTime?.toFixed(1)}s, P${race.player.place}/${race.fieldSize}`);
  ok(race.player.place < startPlace, `seed ${seed}: gained places`, `${startPlace} -> ${race.player.place}`);
  ok(worstX < 2.2, `seed ${seed}: stayed near the road`, `max |x| ${worstX.toFixed(2)}`);
  ok(worstX < 2.2, `seed ${seed}: never far off the road`, `max |x| ${worstX.toFixed(2)}`);
  ok(race.traffic.cars.every((c) => Number.isFinite(c.z) && Math.abs(c.offset) <= 1.0),
     `seed ${seed}: AI finite and on the road`);
}

console.log('\n== Drifting ==');
{
  const race = new Race(1234); race.start(); race.state = 'racing';
  const GO = { left: false, right: false, accel: true, brake: false };
  for (let i = 0; i < 60 * 7; i++) race.step(DT, GO);

  // Held lock at speed should slide the car.
  let peak = 0;
  for (let i = 0; i < 60 * 2; i++) {
    race.step(DT, { left: true, right: false, accel: true, brake: false });
    peak = Math.max(peak, race.player.slip);
  }
  ok(peak > 0.4, 'held steering at speed breaks it into a slide', `peak slip ${peak.toFixed(2)}`);
  ok(Math.abs(race.player.beta) <= CFG.arcade.BETA_MAX + 1e-6,
     'the slide is capped, so it can never swap ends', `${(race.player.beta * 57.3).toFixed(0)} deg`);

  // And a drift should pay for itself in boost.
  const r2 = new Race(1234); r2.start(); r2.state = 'racing';
  for (let i = 0; i < 60 * 7; i++) r2.step(DT, GO);
  const b0 = r2.player.boost;
  for (let i = 0; i < 60 * 2; i++) r2.step(DT, { left: true, right: false, accel: true, brake: false, handbrake: true });
  ok(r2.player.boost > b0, 'drifting fills the boost meter', `${b0.toFixed(2)} -> ${r2.player.boost.toFixed(2)}`);
}

console.log('\n== Off-track excursion ==');
{
  const race = new Race(1234); race.start(); race.state = 'racing';
  // Full lock and full throttle straight off the road, then hold it there.
  let worstN = 0, worstZ = 0;
  for (let i = 0; i < 60 * 60; i++) {
    race.step(DT, { left: true, right: false, accel: true, brake: false, boost: true, handbrake: false });
    worstN = Math.max(worstN, Math.abs(race.player.n));
    worstZ = Math.max(worstZ, race.player.z);
    if (!Number.isFinite(race.player.n) || !Number.isFinite(race.player.z)) break;
  }
  const p = race.player;
  ok(Number.isFinite(p.n) && Number.isFinite(p.z) && Number.isFinite(p.psi),
     'state stays finite when driven off the road');
  ok(worstN < CFG.car.OFF_LIMIT * race.t3.halfWidth + 1,
     'lateral offset stays inside the singular radius', `max |n| ${worstN.toFixed(1)} m`);
  ok(worstZ <= race.track.finishZ, 'cannot teleport past the finish', `max z ${worstZ.toFixed(0)}`);
}

console.log('\n== Solidity ==');
{
  const U = CFG.world.U;
  const L = CFG.car.LENGTH;
  const W = CFG.car.WIDTH_M;
  const race = new Race(1234); race.start();
  let playerOverlap = 0, aiOverlap = 0, frames = 0, worst = 0;

  while (race.state !== 'finished' && frames < 60 * 120) {
    race.step(DT, race.state === 'racing' ? drive(race) : { left: 0, right: 0, accel: 0, brake: 0 });
    if (race.state !== 'racing') continue;
    frames++;
    const p = race.player;
    for (const c of race.traffic.cars) {
      const ds = Math.abs(p.s - c.z * U);
      const dn = Math.abs(p.n - c.offset * race.t3.halfWidth);
      if (ds < L && dn < W) { playerOverlap++; worst = Math.max(worst, Math.min(L - ds, W - dn)); break; }
    }
    const cars = race.traffic.cars;
    outer: for (let a = 0; a < cars.length; a++) {
      for (let b = a + 1; b < cars.length; b++) {
        const ds = Math.abs(cars[a].z - cars[b].z) * U;
        const dn = Math.abs(cars[a].offset - cars[b].offset) * race.t3.halfWidth;
        if (ds < L && dn < W) { aiOverlap++; break outer; }
      }
    }
  }
  // Contact frames count as overlap until the separation resolves them, so a
  // few percent is contact happening rather than cars passing through walls.
  ok(playerOverlap / frames < 0.05, 'the player does not drive through traffic',
     `${(playerOverlap / frames * 100).toFixed(1)}% of frames, worst ${worst.toFixed(2)}m`);
  ok(worst < 0.4, 'contact is resolved, not interpenetrating', `worst ${worst.toFixed(2)}m`);
  ok(aiOverlap / frames < 0.12, 'opponents do not drive through each other',
     `${(aiOverlap / frames * 100).toFixed(1)}% of frames`);
}

console.log('\n== Cars sit on the road ==');
{
  // Mirrors the placement in main.js. rotateX(+atan(grade)) pitches the nose
  // UP, and grade is positive uphill; the sign was inverted, which buried the
  // nose 0.55m into the road on every slope.
  const t3 = new Track3D(new Track(1234));
  const L = CFG.car.LENGTH;
  let worst = 0;
  for (let s2 = 20; s2 < t3.length - 20; s2 += 3.1) {
    const f = t3.surfaceAt(s2, 0, {});
    const pitch = Math.atan(f.grade);
    const fx = -Math.sin(f.yaw) * Math.cos(pitch);
    const fy = Math.sin(pitch);
    const fz = -Math.cos(f.yaw) * Math.cos(pitch);
    for (const d of [-L / 2, L / 2]) {
      const px = f.x + fx * d, py = f.y + fy * d, pz = f.z + fz * d;
      const pr = t3.projectToTrack(px, py, pz, f.i);
      const g = t3.surfaceAt(pr.s, pr.n, {});
      worst = Math.max(worst, g.y - py);
    }
  }
  ok(worst < 0.08, 'nose and tail stay above the road surface',
     `worst ${worst.toFixed(3)}m buried (inverted sign gives 0.555m)`);
}

console.log('\n== Determinism ==');
{
  const run = () => {
    const r = new Race(4242); r.start();
    const rng = mulberry32(11);
    for (let i = 0; i < 60 * 25; i++) {
      r.step(DT, { left: rng() < 0.2, right: rng() < 0.2, accel: rng() < 0.85, brake: rng() < 0.05 });
    }
    return JSON.stringify(r.standings().map((e) => [e.name, e.z.toFixed(6)]));
  };
  ok(run() === run(), 'identical scripted input -> identical standings');
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}\n`);
process.exit(fails ? 1 : 0);
