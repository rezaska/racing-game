import { CFG } from '../config.js';
import { clamp, overlap } from '../mathx.js';

// ARCADE handling, in the Need for Speed / Ridge Racer tradition.
//
// This deliberately is NOT a physics simulation. The previous version was a
// bicycle model with slip-curve tyres, which makes a car that understeers at
// the limit, demands you manage entry speed, and punishes mistakes. That is a
// simulator's idea of fun, and it is the wrong genre entirely.
//
// The arcade formulation is much simpler and far easier to make enjoyable:
//
//   heading  turns directly from the steering input
//   velocity chases the heading at a rate called GRIP
//   drift    is simply GRIP dropping for a while
//
// The angle between heading and velocity IS the drift, it is always visible,
// and it is always recoverable by steering. Nothing here can spin you out
// against your will.

const C = CFG.car;
const A = CFG.arcade;
const U = CFG.world.U;
const V_MAX = C.MAX_SPEED * U;

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Vehicle {
  constructor(track, t3, startS = 0, startN = 0) {
    this.track = track;
    this.t3 = t3;

    const f = t3.surfaceAt(startS, startN, {});
    this.px = f.x;
    this.py = f.y;
    this.pz = f.z;
    this.psi = f.yaw;      // where the car points
    this.vpsi = f.yaw;     // where the car is actually going
    this.hint = 0;

    this.speed = 0;        // metres/s along vpsi
    this.boost = A.BOOST_MAX * 0.4;
    this.boosting = false;
    this.drifting = false;
    this.beta = 0;         // heading minus travel: the visible slide
    this.delta = 0;        // front-wheel angle, visual only
    this.steer = 0;

    this.s = startS;
    this.n = startN;
    this.z = t3.sToZ(startS);
    this.x = t3.nToX(startN);
    this.offroad = false;
    this.slip = 0;
    this.lateralG = 0;
    this.finished = false;
    this.finishTime = 0;
    this.place = 1;
    this.bump = 0;
    this.nearMiss = 0;
  }

  // Kept for the renderer and the camera, which think in body-frame velocity.
  get vx() { return this.speed * Math.cos(this.beta); }
  get vy() { return this.speed * Math.sin(this.beta); }
  get speedPct() { return this.speed / V_MAX; }

  update(dt, input, traffic) {
    const t3 = this.t3;
    const done = this.finished;
    const throttle = done ? 0 : input.accel ? 1 : 0;
    const brake = done ? 0 : input.brake ? 1 : 0;
    const steerIn = (input.left ? 1 : 0) - (input.right ? 1 : 0);

    // --- boost -----------------------------------------------------------
    const wantBoost = !done && input.boost && this.boost > 0.02 && this.speed > 4;
    this.boosting = wantBoost;
    if (wantBoost) this.boost = Math.max(0, this.boost - dt / A.BOOST_SECONDS);

    const vMax = V_MAX * (this.boosting ? A.BOOST_TOP : 1) * (this.offroad ? A.OFFROAD_TOP : 1);

    // --- speed -----------------------------------------------------------
    let accel = 0;
    if (throttle) accel = (V_MAX / C.ACCEL_TIME) * (this.boosting ? A.BOOST_ACCEL : 1);
    else if (brake) accel = -V_MAX / C.BRAKE_TIME;
    else accel = -V_MAX / C.DECEL_TIME;
    // Ease off as top speed approaches instead of slamming into a clamp.
    if (accel > 0) accel *= clamp(1 - (this.speed / vMax) ** 2, 0, 1);
    this.speed += accel * dt;
    if (this.speed > vMax) this.speed += (vMax - this.speed) * (1 - Math.exp(-3 * dt));
    this.speed = clamp(this.speed, 0, V_MAX * A.BOOST_TOP);

    // --- steering: turn rate straight from the input --------------------
    // Falls off with speed, but never far. The car must still turn at 200 km/h
    // or it feels like a barge; it just should not pirouette.
    const sp = clamp(this.speed / V_MAX, 0, 1.2);
    const turn = A.TURN_MAX * (1 - A.TURN_FALLOFF * sp);
    // A little lag so taps are not instant, but far less than a real car.
    this.steer += (steerIn - this.steer) * (1 - Math.exp(-dt / A.STEER_TAU));
    this.delta = this.steer * 0.42;

    const moving = clamp(this.speed / 6, 0, 1);
    this.psi += this.steer * turn * moving * dt;

    // --- drift: GRIP is the whole handling model -------------------------
    // Entering a slide is deliberate (handbrake) or the natural result of
    // asking for a lot of steering at speed. Either way it is held and exited
    // on the steering, never lost.
    const hard = Math.abs(this.steer) > A.DRIFT_STEER && sp > A.DRIFT_MIN_SPEED;
    const wantDrift = !done && (input.handbrake || (hard && A.AUTO_DRIFT));
    this.drifting = wantDrift && this.speed > 6;

    const grip = this.offroad ? A.GRIP_OFFROAD : this.drifting ? A.GRIP_DRIFT : A.GRIP;
    this.vpsi += wrap(this.psi - this.vpsi) * (1 - Math.exp(-grip * dt));
    this.beta = wrap(this.psi - this.vpsi);

    // Hard cap on the slide angle so the car can never end up backwards.
    if (Math.abs(this.beta) > A.BETA_MAX) {
      this.vpsi = this.psi - Math.sign(this.beta) * A.BETA_MAX;
      this.beta = Math.sign(this.beta) * A.BETA_MAX;
    }

    this.slip = clamp((Math.abs(this.beta) - 0.05) / A.BETA_MAX, 0, 1);
    // Sliding scrubs speed, which is what stops drifting being a free lunch.
    this.speed -= this.speed * this.slip * A.DRIFT_SCRUB * dt;
    // ...but a good slide pays for itself in boost. This is the loop.
    if (this.slip > 0.25) this.boost = Math.min(A.BOOST_MAX, this.boost + dt * A.BOOST_FROM_DRIFT * this.slip);

    // --- move ------------------------------------------------------------
    this.px -= Math.sin(this.vpsi) * this.speed * dt;
    this.pz -= Math.cos(this.vpsi) * this.speed * dt;

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
    this.lateralG = (this.speed * this.steer * turn) / 9.81;

    // Soft nudge back toward the road, so wandering off is a nuisance rather
    // than the end of your race.
    const limit = A.BARRIER * t3.halfWidth;
    if (Math.abs(this.n) > limit) {
      const over = Math.abs(this.n) - limit;
      this.psi += wrap(f.yaw - this.psi) * (1 - Math.exp(-clamp(over * 0.5, 0, 4) * dt));
      this.speed -= this.speed * 0.5 * dt;
    }

    // The car is snapped back onto the (s, n) surface every frame, clamped.
    //
    // Testing |n| against a limit is not enough: the surface is parameterised
    // as C(s) + right(s)*n, which is singular once |n| reaches the radius of
    // curvature, so once the car is genuinely far out the projection reports a
    // small n for a car 300 m away and the test never fires. Reconstructing the
    // position from the clamped parameters makes the two consistent by
    // construction. Within the limits the round trip is exact to 1e-4 m, so
    // this is a no-op for normal driving.
    const hardLimit = C.OFF_LIMIT * t3.halfWidth;
    if (!Number.isFinite(this.n)) this.n = 0;
    if (!Number.isFinite(this.s)) this.s = 0;
    this.n = clamp(this.n, -hardLimit, hardLimit);
    const g = t3.surfaceAt(this.s, this.n, {});
    this.px = g.x; this.py = g.y; this.pz = g.z;
    this.x = t3.nToX(this.n);

    this.bump = Math.max(0, this.bump - dt * 3);
    this.nearMiss = Math.max(0, this.nearMiss - dt * 2);
    this.#traffic(traffic, dt);

    if (!this.finished && this.z >= this.track.finishZ) this.finished = true;
  }

  // Contact is a glancing scrape, never a race-ender. Passing close pays boost,
  // which is what makes traffic something to dive at rather than avoid.
  #traffic(traffic, dt) {
    const w = C.HALF_WIDTH;
    const segIdx = Math.floor(this.z / CFG.road.SEGMENT_LENGTH);
    for (let i = segIdx - 1; i <= segIdx + 1; i++) {
      const seg = this.track.segments[i];
      if (!seg) continue;
      for (const car of seg.cars) {
        const gap = Math.abs(this.x - car.offset);
        if (gap < w * 2.6 && gap > w * 1.5 && this.speed > car.speed * U) {
          this.boost = Math.min(A.BOOST_MAX, this.boost + dt * A.BOOST_FROM_NEAR);
          this.nearMiss = 1;
        }
        if (this.speed <= car.speed * U) continue;
        if (!overlap(this.x, w, car.offset, w, 0.85)) continue;
        this.speed *= A.BUMP_KEEP;
        const side = Math.sign(this.x - car.offset) || 1;
        this.psi += side * 0.09;
        this.bump = 1;
        traffic.bumped = 0.25;
        return;
      }
    }
  }
}
