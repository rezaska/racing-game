import { CFG } from './config.js';
import { clamp, lerp, normalizeAngle } from './mathx.js';

// Conventions (violate these and nothing works):
//   y grows DOWN. "Up" is -y.
//   angle is chassis rotation, +x toward +y.
//     positive angle = nose DOWN, negative angle = nose UP (wheelie).
//   M = 1, so force == acceleration and I is in px^2.
//
// The wheelie is not a special case. Drive force Fx > 0 is applied at the
// contact patch, which sits BELOW the centre of mass (ry ~= +34), so
// tau = -ry*Fx < 0, omega goes negative, and the nose lifts. This is why
// drive force must never be applied at the centre of mass.

export class Vehicle {
  constructor(terrain, x, opts = {}) {
    const C = CFG.car;
    this.terrain = terrain;
    this.color = opts.color || CFG.palette.playerColor;
    this.name = opts.name || 'Player';
    this.isPlayer = !!opts.isPlayer;

    this.x = x;
    this.y = terrain.heightAt(x) - C.REST - C.RADIUS;
    this.vx = 0;
    this.vy = 0;
    this.angle = terrain.angleAt(x, 30);
    this.omega = 0;

    this.wheels = C.wheels.map((w) => ({
      local: w.local,
      drive: w.drive,
      compression: 0,
      overshoot: 0,
      contact: false,
      normalForce: 0,
      spin: 0,
      spinVel: 0,
      worldX: x,
      worldY: this.y,
      probeX: null,
      probeY: null,
    }));

    this.engineScale = 1;      // rubber band, set externally
    this.crashed = false;
    this.crashTimer = 0;
    this.turtleTimer = 0;
    this.finished = false;
    this.finishTime = 0;
    this.airborne = false;
    this.peakNormalForce = 0;  // per-step, read by the camera for shake
    this.distance = 0;
    this.crashCount = 0;
  }

  // tau = (px-x)*Fy - (py-y)*Fx
  #applyForceAt(fx, fy, px, py) {
    const C = CFG.car;
    this.ax += fx / C.M;
    this.ay += fy / C.M;
    this.alpha += ((px - this.x) * fy - (py - this.y) * fx) / C.I;
  }

  #stepWheel(w, terrain, input) {
    const C = CFG.car;
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);

    // Suspension anchor (top of the strut) in world space.
    const anchorX = this.x + w.local.x * ca - w.local.y * sa;
    const anchorY = this.y + w.local.x * sa + w.local.y * ca;

    // Suspension axis = chassis local down.
    const sx = -sa;
    const sy = ca;

    // Fully-extended wheel centre.
    const probeX = anchorX + sx * C.REST;
    const probeY = anchorY + sy * C.REST;

    if (w.probeX === null) { w.probeX = probeX; w.probeY = probeY; }

    // Swept probe: walk the wheel centre along its path since last step and
    // take the DEEPEST penetration. Interpolating the wheel's y as well as its
    // x matters -- probing raw ground height alone would report the hilltop
    // behind the car while descending fast, and the car would float.
    let pen = -Infinity;
    let contactX = probeX;
    for (let k = 0; k <= 3; k++) {
      const t = k / 3;
      const px = lerp(w.probeX, probeX, t);
      const py = lerp(w.probeY, probeY, t);
      const p = (py + C.RADIUS) - terrain.heightAt(px);
      if (p > pen) { pen = p; contactX = px; }
    }
    w.probeX = probeX;
    w.probeY = probeY;

    w.contact = pen > 0;
    w.compression = clamp(pen, 0, C.MAX_TRAVEL);
    w.overshoot = Math.max(0, pen - C.MAX_TRAVEL); // into the bump stop
    w.worldX = anchorX + sx * (C.REST - w.compression);
    w.worldY = anchorY + sy * (C.REST - w.compression);

    // sy <= 0 means the strut axis points UP in world space, i.e. the car is on
    // its roof. The ground can only ever push the chassis away from itself, so
    // the suspension has to disengage here. Without this guard an inverted car
    // gets 26000 of force driving it DOWN into the terrain and it accelerates
    // through the world.
    if (!w.contact || sy <= 0.05) {
      w.contact = false;
      w.normalForce = 0;
      w.overshoot = 0;
      w.spinVel *= 0.995;
      return;
    }

    // --- suspension --------------------------------------------------------
    const vax = this.vx - this.omega * (anchorY - this.y);
    const vay = this.vy + this.omega * (anchorX - this.x);
    const vAlong = vax * sx + vay * sy; // > 0 while compressing

    // Damping ADDS to the force while compressing (vAlong > 0) -- it resists the
    // motion. Subtracting here makes a negative damper that pumps energy in and
    // the car shakes itself apart on flat ground.
    // The lower clamp at 0 is essential: a suspension strut pushes, it never
    // pulls the car back down into the ground.
    const fn = clamp(
      C.SPRING_K * w.compression + C.SPRING_D * vAlong + C.BUMP_STOP_K * w.overshoot,
      0, C.SPRING_MAX
    );
    w.normalForce = fn;
    if (fn > this.peakNormalForce) this.peakNormalForce = fn;
    this.#applyForceAt(-sx * fn, -sy * fn, anchorX, anchorY);

    // --- ground frame at the contact patch ---------------------------------
    const s = terrain.slopeAt(contactX, C.RADIUS);
    const L = Math.hypot(1, s);
    const tx = 1 / L;
    const ty = s / L;

    const cx = contactX;
    const cy = terrain.heightAt(contactX);
    const vcx = this.vx - this.omega * (cy - this.y);
    const vcy = this.vy + this.omega * (cx - this.x);
    const vTan = vcx * tx + vcy * ty;

    // --- drive / brake, grip limited ---------------------------------------
    let ft = 0;
    if (input.throttle > 0) {
      ft = C.ENGINE_FORCE * this.engineScale * input.throttle * w.drive;
    } else if (input.brake > 0) {
      ft = Math.abs(vTan) < 40
        ? -C.REVERSE_FORCE * input.brake * w.drive
        : (vTan > 0 ? -1 : 1) * C.BRAKE_FORCE * input.brake * w.drive;
    }

    // Clamping to the friction circle gives wheelspin on light contact free.
    const grip = C.MU * fn;
    ft = clamp(ft, -grip, grip);
    ft += -C.ROLL_RESIST * vTan * (fn / (C.M * CFG.GRAVITY));

    // AT THE CONTACT PATCH, never at the centre of mass.
    this.#applyForceAt(ft * tx, ft * ty, cx, cy);

    w.spinVel = vTan / C.RADIUS;
  }

  step(dt, input) {
    const C = CFG.car;
    const terrain = this.terrain;

    if (this.crashed || this.finished) {
      input = { throttle: 0, brake: 0 };
    }

    this.ax = 0;
    this.ay = CFG.GRAVITY;
    this.alpha = 0;
    this.peakNormalForce = 0;

    for (const w of this.wheels) this.#stepWheel(w, terrain, input);

    // Quadratic air drag.
    const sp = Math.hypot(this.vx, this.vy);
    this.ax -= C.AIR_DRAG * sp * this.vx;
    this.ay -= C.AIR_DRAG * sp * this.vy;

    // Grounded means SUPPORTED, not merely touching. Diving nose-first into a
    // valley the car often keeps one wheel in light contact; treating that as
    // grounded left the player with no pitch authority in exactly the moment
    // they need it, and the car speared its head into the ground every time.
    const support = (this.wheels[0].normalForce + this.wheels[1].normalForce) /
                    (C.M * CFG.GRAVITY);
    const grounded = support > 0.25;
    this.airborne = !grounded;

    if (!grounded) {
      // In flight the pedals become pitch thrusters: gas backflips, brake
      // frontflips. Negative alpha = nose up.
      this.alpha -= C.AIR_TORQUE * input.throttle;
      this.alpha += C.AIR_TORQUE * input.brake;
      this.alpha -= C.ANG_DAMP_AIR * this.omega;
    } else {
      // Tuning knob layered on top of the physical drive torque.
      if (this.wheels[0].contact) this.alpha -= C.WHEELIE_TORQUE * input.throttle;

      // Anti-loop assist, relative to the surface so climbing is unaffected.
      const rel = normalizeAngle(this.angle - terrain.angleAt(this.x, 30));
      if (rel < -C.WHEELIE_LIMIT) this.alpha += C.ANTI_LOOP * (-C.WHEELIE_LIMIT - rel);
    }

    // Semi-implicit (symplectic) Euler: velocity FIRST, then position from the
    // NEW velocity. Explicit Euler pumps energy into a spring every step and a
    // parked car will slowly bounce itself into orbit.
    this.vx += this.ax * dt;
    this.vy += this.ay * dt;
    this.omega += this.alpha * dt;

    this.vx = clamp(this.vx, -C.MAX_SPEED, C.MAX_SPEED);
    this.vy = clamp(this.vy, -C.MAX_SPEED, C.MAX_SPEED);
    this.omega = clamp(this.omega, -C.MAX_OMEGA, C.MAX_OMEGA);

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = normalizeAngle(this.angle + this.omega * dt);

    for (const w of this.wheels) w.spin += w.spinVel * dt;

    this.#backstop();
    this.#sleep(input);
    this.#checkCrash(dt);

    if (this.x > this.distance) this.distance = this.x;
  }

  // Two safety nets; neither should fire in normal play.
  #backstop() {
    const C = CFG.car;
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    const sx = -sa;
    const sy = ca;

    // Upright: push a buried wheel back out along its strut.
    if (sy > 0.05) {
      for (const w of this.wheels) {
        const wx = this.x + w.local.x * ca - w.local.y * sa + sx * C.REST;
        const wy = this.y + w.local.x * sa + w.local.y * ca + sy * C.REST;
        const deep = (wy + C.RADIUS) - this.terrain.heightAt(wx);
        if (deep > C.BACKSTOP_DEPTH) {
          this.y -= deep - C.BACKSTOP_DEPTH;
          const vAlong = this.vx * sx + this.vy * sy;
          if (vAlong > 0) { // kill only the inward component
            this.vx -= vAlong * sx;
            this.vy -= vAlong * sy;
          }
          for (const ww of this.wheels) { ww.probeX = null; ww.probeY = null; }
        }
      }
    }

    // Attitude-independent floor. With the struts disengaged this is the only
    // thing holding an inverted car up, so it cannot depend on wheel geometry.
    const floor = this.terrain.heightAt(this.x) + C.CHASSIS_FLOOR;
    if (this.y > floor) {
      this.y = floor;
      if (this.vy > 0) this.vy = 0;
    }
  }

  // Damp residual micro-oscillation. Never hard-zero the velocities -- the car
  // visibly freezes mid-settle if you do.
  #sleep(input) {
    if (input.throttle > 0 || input.brake > 0) return;
    if (!this.wheels.every((w) => w.contact)) return;
    if (Math.hypot(this.vx, this.vy) > 6 || Math.abs(this.omega) > 0.06) return;
    this.vx *= 0.88;
    this.vy *= 0.88;
    this.omega *= 0.85;
  }

  headPos() {
    const C = CFG.car;
    const ca = Math.cos(this.angle);
    const sa = Math.sin(this.angle);
    return {
      x: this.x + C.headLocal.x * ca - C.headLocal.y * sa,
      y: this.y + C.headLocal.x * sa + C.headLocal.y * ca,
    };
  }

  #checkCrash(dt) {
    const C = CFG.car;
    if (this.finished) return;

    if (this.crashed) {
      this.crashTimer -= dt;
      if (this.crashTimer <= 0) this.respawn();
      return;
    }

    // The genre's real fail state: the driver's head hits the ground.
    const head = this.headPos();
    if (head.y > this.terrain.heightAt(head.x) - 2) {
      this.crash();
      return;
    }

    // Turtled on your roof and not going anywhere.
    if (Math.abs(this.angle) > C.TURTLE_ANGLE && Math.abs(this.vx) < C.TURTLE_SPEED) {
      this.turtleTimer += dt;
      if (this.turtleTimer >= C.TURTLE_TIME) this.crash();
    } else {
      this.turtleTimer = 0;
    }
  }

  crash() {
    if (this.crashed) return;
    this.crashed = true;
    this.crashTimer = CFG.race.CRASH_FREEZE;
    this.turtleTimer = 0;
    this.crashCount++;
  }

  respawn() {
    const cp = this.terrain.checkpointBefore(this.x);
    this.x = cp.x;
    this.y = this.terrain.heightAt(cp.x) - CFG.race.RESPAWN_HEIGHT;
    this.vx = 0;
    this.vy = 0;
    this.omega = 0;
    this.angle = this.terrain.angleAt(cp.x, 30);
    this.crashed = false;
    this.crashTimer = 0;
    this.turtleTimer = 0;
    for (const w of this.wheels) {
      w.probeX = null;
      w.probeY = null;
      w.compression = 0;
      w.contact = false;
      w.spinVel = 0;
    }
  }
}
