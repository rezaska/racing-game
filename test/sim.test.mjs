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

// A competent driver, so races are a test of the game rather than of an idiot.
function drive(race) {
  const p = race.player;
  const ahead = race.track.findSegment(p.z + CFG.road.SEGMENT_LENGTH * 20);
  const target = -Math.sign(ahead.curve) * Math.min(0.45, Math.abs(ahead.curve) * 0.08);
  const err = p.x - target;
  const safe = Math.abs(ahead.curve) > 0.5
    ? Math.min(1, 0.92 / (Math.abs(ahead.curve) * CFG.car.CENTRIFUGAL)) : 1;
  const want = CFG.car.MAX_SPEED * safe;
  return { left: err > 0.05, right: err < -0.05, accel: p.speed < want, brake: p.speed > want * 1.12 };
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
  ok(worstX < 2.0, `seed ${seed}: stayed near the road`, `max |x| ${worstX.toFixed(2)}`);
  ok(maxSlip > 0.3, `seed ${seed}: tyres break traction in hard bends`, `peak slip ${maxSlip.toFixed(2)}`);
  ok(race.traffic.cars.every((c) => Number.isFinite(c.z) && Math.abs(c.offset) <= 1.0),
     `seed ${seed}: AI finite and on the road`);
}

console.log('\n== Determinism ==');
{
  const run = () => {
    const r = new Race(4242); r.start();
    const rng = mulberry32(11);
    for (let i = 0; i < 60 * 40; i++) {
      r.step(DT, { left: rng() < 0.2, right: rng() < 0.2, accel: rng() < 0.85, brake: rng() < 0.05 });
    }
    return JSON.stringify(r.standings().map((e) => [e.name, e.z.toFixed(6)]));
  };
  ok(run() === run(), 'identical scripted input -> identical standings');
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}\n`);
process.exit(fails ? 1 : 0);
