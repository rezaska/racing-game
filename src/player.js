import { CFG } from './config.js';
import { clamp, overlap } from './mathx.js';
import { PLAYER_Z } from './track.js';

const C = CFG.car;
const R = CFG.road;

// Rates derived from the "seconds to reach top speed" figures in config, so the
// numbers you tune are the ones you can feel.
const ACCEL = C.MAX_SPEED / C.ACCEL_TIME;
const BRAKE = -C.MAX_SPEED / C.BRAKE_TIME;
const DECEL = -C.MAX_SPEED / C.DECEL_TIME;
const OFFROAD_DECEL = -C.MAX_SPEED / C.OFFROAD_DECEL_TIME;

export class Player {
  constructor(track) {
    this.track = track;
    this.z = 0;
    this.x = 0;          // lateral position in road half-widths; |x| > 1 is off road
    this.speed = 0;
    this.steer = 0;      // -1..1, for picking the sprite frame
    this.bounce = 0;
    this.offroad = false;
    this.finished = false;
    this.finishTime = 0;
    this.place = 1;
  }

  get speedPercent() {
    return this.speed / C.MAX_SPEED;
  }

  update(dt, input, traffic) {
    const seg = this.track.findSegment(this.z + PLAYER_Z);
    const pct = this.speedPercent;
    // Steering authority scales with speed: stationary cars do not turn.
    const dx = dt * C.STEER_SPEED * pct;

    this.steer = 0;
    if (input.left) { this.x -= dx; this.steer = -1; }
    else if (input.right) { this.x += dx; this.steer = 1; }

    // Centrifugal force pushes you to the outside of a curve, harder the faster
    // you go. This is what makes curves something you have to drive.
    this.x -= dx * pct * seg.curve * C.CENTRIFUGAL;

    if (this.finished) {
      this.speed += DECEL * dt;
    } else if (input.accel) {
      this.speed += ACCEL * dt;
    } else if (input.brake) {
      this.speed += BRAKE * dt;
    } else {
      this.speed += DECEL * dt;
    }

    this.offroad = Math.abs(this.x) > 1;
    if (this.offroad && this.speed > C.OFFROAD_MAX_SPEED) {
      this.speed += OFFROAD_DECEL * dt;
    }

    this.x = clamp(this.x, -2.4, 2.4);
    this.speed = clamp(this.speed, 0, C.MAX_SPEED);

    const fromZ = this.z;
    this.z += this.speed * dt;
    // Test every segment crossed this frame. Checking only the segment we
    // landed in lets the car tunnel straight through traffic at speed, since at
    // top speed it covers a whole segment per frame.
    this.#collide(fromZ, this.z, traffic);

    // Vertical jitter, stronger off road and at speed. Sold entirely by the
    // player sprite moving a pixel or two.
    this.bounce = this.offroad
      ? Math.sin(this.z / 90) * 1.6 * pct
      : Math.sin(this.z / 260) * 0.6 * pct;

    if (!this.finished && this.z >= this.track.finishZ) this.finished = true;
  }

  #collide(fromZ, toZ, traffic) {
    if (this.speed <= 0) return;
    const w = 0.55; // car width in road half-widths
    const first = Math.floor((fromZ + PLAYER_Z) / R.SEGMENT_LENGTH);
    const last = Math.floor((toZ + PLAYER_Z) / R.SEGMENT_LENGTH);
    for (let i = first; i <= last; i++) {
      const seg = this.track.segments[i];
      if (!seg) continue;
      for (const car of seg.cars) {
        if (this.speed <= car.speed) continue;
        if (!overlap(this.x, w, car.offset, w, 0.85)) continue;
        // Rear-ending someone drops you to a fraction of their speed and shoves
        // you sideways, rather than stopping you dead.
        this.speed = car.speed * C.BUMP_SPEED_FACTOR;
        this.x += this.x > car.offset ? 0.14 : -0.14;
        this.z = car.z - PLAYER_Z - R.SEGMENT_LENGTH * 0.4;
        traffic.bumped = 0.25;
        return;
      }
    }
  }
}
