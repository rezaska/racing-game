import { CFG } from '../config.js';
import { clamp, overlap } from '../mathx.js';

// The player's car: a real vehicle in the world, not a point sliding along the
// track.
//
// The previous model set the car's heading to the track's heading and moved it
// sideways to steer, which reads exactly as what it was -- the car crabbing
// across the road without ever pointing where it was going.
//
// Here the car carries its own heading, body-frame velocity and yaw rate, and
// is PROJECTED onto the centreline every frame. Because `s / U` is then the old
// `z` and `n / W` is the old `x`, the AI, collisions, standings and the whole
// test suite keep working untouched.
//
// Conventions: yaw psi matches the track (forward = (-sin psi, -cos psi)), and
// psi INCREASES to the left. Body velocity is (vx forward, vy leftward).

const C = CFG.car;
const U = CFG.world.U;
const G = 9.81;

const V_MAX = C.MAX_SPEED * U;                 // 42 m/s
const F_DRIVE = (C.MASS * V_MAX) / C.ACCEL_TIME;
const F_BRAKE = (C.MASS * V_MAX) / C.BRAKE_TIME;
// Drag pinned so top speed lands exactly on the configured value.
const C_DRAG = F_DRIVE / (V_MAX * V_MAX);
const F_ROLL = F_DRIVE * 0.055;
const FZ = (C.MASS * G) / 2;

// Saturating tyre curve. The fall-off past the peak is what makes a slide
// catchable instead of snapping away the instant grip is exceeded.
const tyre = (alpha, mu) => mu * FZ * Math.sin(1.6 * Math.atan(8 * alpha));
const smoothstep = (x, a, b) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export class Vehicle {
  constructor(track, t3, startS = 0, startN = 0) {
    this.track = track;
    this.t3 = t3;

    const f = t3.surfaceAt(startS, startN, {});
    this.px = f.x;
    this.pz = f.z;
    this.py = f.y;
    this.psi = f.yaw;

    this.vx = 0;        // forward, m/s
    this.vy = 0;        // leftward, m/s
    this.r = 0;         // yaw rate, rad/s
    this.delta = 0;     // road-wheel angle, + = left
    this.hint = 0;

    this.z = t3.sToZ(startS);   // legacy along-track
    this.x = t3.nToX(startN);   // legacy lateral, |x| > 1 is off road
    this.s = startS;
    this.n = startN;
    this.speed = 0;
    this.steer = 0;
    this.slip = 0;
    this.beta = 0;
    this.lateralG = 0;
    this.offroad = false;
    this.finished = false;
    this.finishTime = 0;
    this.place = 1;
    this.bump = 0;
  }

  get speedPct() { return Math.max(0, this.vx) / V_MAX; }

  update(dt, input, traffic) {
    const t3 = this.t3;
    const throttle = this.finished ? 0 : input.accel ? 1 : 0;
    const brake = this.finished ? 0 : input.brake ? 1 : 0;
    const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0); // + = left

    // Limit the steering angle to the grip that actually exists, rather than to
    // an arbitrary speed curve.
    //
    //   a_lat = v^2 * delta / L   ->   delta_max = L * a_max / v^2
    //
    // This matters more than it looks. Steering from a keyboard is inherently
    // bang-bang, and at 42 m/s a 93 m corner needs 0.028 rad while a fixed
    // curve was handing out 0.118 -- so every tap was a massive over-steer and
    // the car spent the race sliding. Capping the command at what the tyres can
    // deliver makes the car go where it is pointed, and leaves the slides to
    // come from throttle and from leaving the road, which is where they belong.
    // Always sized against ROAD grip, never the current surface. Scaling this
    // by the off-road coefficient collapsed steering authority to 0.008 rad on
    // grass, so leaving the road was unrecoverable -- a death spiral. The tyre
    // model already reduces the force off-road; capping the command as well
    // double-counts it. HEADROOM > 1 leaves just enough over the grip limit to
    // provoke a slide deliberately, instead of pure understeer.
    const vxSafe = Math.max(Math.abs(this.vx), 1);
    const aMax = C.MU_ROAD * G * C.STEER_HEADROOM;
    const dMax = Math.min(C.STEER_MAX, (C.WHEELBASE * aMax) / (vxSafe * vxSafe));
    const target = dMax * steerIn;
    this.delta += (target - this.delta) * (1 - Math.exp(-dt / C.STEER_TAU));
    this.steer = steerIn;

    const vxAbs = Math.max(Math.abs(this.vx), 0.6);

    // Surface grip, read from the projected lateral position.
    const muBase = this.offroad ? C.MU_OFFROAD : C.MU_ROAD;
    // Power oversteer: opening the throttle unloads the rear laterally, which
    // is what lets the driver provoke a slide deliberately.
    const muRear = muBase * (1 - C.POWER_OVERSTEER * throttle * smoothstep(this.vx, 10, 26));

    const af = this.delta - Math.atan2(this.vy + C.A_FRONT * this.r, vxAbs);
    const ar = -Math.atan2(this.vy - C.B_REAR * this.r, vxAbs);
    const Ff = tyre(af, muBase);
    const Fr = tyre(ar, muRear);

    let Fx = throttle * F_DRIVE - brake * F_BRAKE * Math.sign(this.vx || 1);
    Fx -= C_DRAG * this.vx * Math.abs(this.vx);
    Fx -= F_ROLL * Math.sign(this.vx || 0);
    if (this.offroad) Fx -= C.OFFROAD_DRAG * this.vx * Math.abs(this.vx);

    const cd = Math.cos(this.delta);
    this.vx += (Fx / C.MASS + this.vy * this.r) * dt;
    this.vy += ((Ff * cd + Fr) / C.MASS - this.vx * this.r) * dt;
    this.r += ((C.A_FRONT * Ff * cd - C.B_REAR * Fr) / C.INERTIA) * dt;

    // Blend the yaw rate toward the kinematic reference. Firm when the car is
    // planted, slack once the driver has provoked a slide -- this is both the
    // "it goes where you point it" feel and the difficulty dial.
    const rRef = (this.vx * Math.tan(this.delta)) / C.WHEELBASE;
    const k = Math.abs(ar) > C.SLIDE_THRESHOLD ? C.ASSIST_LOOSE : C.ASSIST_FIRM;
    this.r += (rRef - this.r) * (1 - Math.exp(-k * dt));

    // Anti-pirouette: stop a low-speed spin from becoming a permanent one.
    this.beta = Math.atan2(this.vy, vxAbs);
    if (Math.abs(this.beta) > 1.05 && Math.abs(this.vx) < 8) this.r *= Math.exp(-6 * dt);

    this.vx = clamp(this.vx, -V_MAX * 0.35, V_MAX);
    this.vy = clamp(this.vy, -C.V_LAT_MAX, C.V_LAT_MAX);
    this.r = clamp(this.r, -2.6, 2.6);
    this.psi += this.r * dt;

    // Integrate in the world, then find out where that is on the track.
    const sinP = Math.sin(this.psi);
    const cosP = Math.cos(this.psi);
    this.px += (-sinP * this.vx - cosP * this.vy) * dt;
    this.pz += (-cosP * this.vx + sinP * this.vy) * dt;

    const proj = t3.projectToTrack(this.px, this.py, this.pz, this.hint);
    this.hint = proj.i;
    this.s = proj.s;
    this.n = proj.n;
    this.z = t3.sToZ(proj.s);
    this.x = t3.nToX(proj.n);

    const f = t3.surfaceAt(this.s, this.n, {});
    this.py = f.y;
    this.groundYaw = f.yaw;
    this.bank = f.bank;
    this.grade = f.grade;

    this.offroad = Math.abs(this.x) > 1.12;
    this.speed = this.vx / U;
    this.lateralG = (this.vx * this.r) / G;
    // Drift signal, used for smoke, camera roll and the drift readout.
    this.slip = clamp((Math.abs(this.beta) - 0.06) / 0.42, 0, 1);

    // Soft barrier rather than a wall: hitting a wall spins you and ends the
    // race, which is a punishment out of all proportion to the mistake.
    const limit = C.BARRIER * t3.halfWidth;
    if (Math.abs(this.n) > limit) {
      this.vy -= 26 * (Math.abs(this.n) - limit) * Math.sign(this.n) * dt;
    }

    // Hard stop, and NOT for tidiness: see OFF_LIMIT in config. Past the radius
    // of curvature the (s, n) surface folds and the projection returns nonsense.
    const hard = C.OFF_LIMIT * t3.halfWidth;
    if (Math.abs(this.n) > hard || !Number.isFinite(this.n)) {
      this.n = Number.isFinite(this.n) ? Math.sign(this.n) * hard : 0;
      const g = t3.surfaceAt(this.s, this.n, {});
      this.px = g.x; this.py = g.y; this.pz = g.z;
      this.x = t3.nToX(this.n);
      // Kill only the outward component.
      const outward = this.vy * -Math.sign(this.n);
      if (outward > 0) this.vy = 0;
    }

    this.bump = Math.max(0, this.bump - dt * 3);
    this.#collide(traffic);

    if (!this.finished && this.z >= this.track.finishZ) this.finished = true;
  }

  #collide(traffic) {
    if (this.vx <= 0) return;
    const w = C.HALF_WIDTH;
    const segIdx = Math.floor(this.z / CFG.road.SEGMENT_LENGTH);
    for (let i = segIdx - 1; i <= segIdx + 1; i++) {
      const seg = this.track.segments[i];
      if (!seg) continue;
      for (const car of seg.cars) {
        if (this.speed <= car.speed) continue;
        if (!overlap(this.x, w, car.offset, w, 0.85)) continue;
        // An impulse, not a teleport: scrub speed, get shoved aside and
        // twitched off line, then drive out of it.
        this.vx = car.speed * U * C.BUMP_SPEED_FACTOR;
        const side = Math.sign(this.x - car.offset) || 1;
        this.vy += side * 2.6;
        this.r += side * 0.5;
        this.bump = 1;
        traffic.bumped = 0.25;
        return;
      }
    }
  }
}
