import { CFG } from './config.js';
import { clamp, mulberry32, normalizeAngle } from './mathx.js';

// The AI drives the exact same Vehicle through the exact same physics; only the
// input source differs. So it wheelies, gets air, and crashes like the player.
export class AIController {
  constructor(personality, seed, index) {
    this.p = personality;
    this.rng = mulberry32((seed ^ (0xB5297A4D + Math.imul(index, 0x68E31DA4))) >>> 0);
    this.buf = [];
  }

  update(car, terrain, player) {
    const p = this.p;
    let throttle = 0;
    let brake = 0;

    if (car.airborne) {
      // Predict the landing point and rotate to meet the slope. This single
      // rule does more for perceived AI quality than everything else combined.
      const g = CFG.GRAVITY;
      let t = 0.2;
      for (let k = 0; k < 6; k++) {
        const px = car.x + car.vx * t;
        const c = car.y - terrain.heightAt(px);
        const disc = car.vy * car.vy - 2 * g * c;
        if (disc < 0) break;
        t = (-car.vy + Math.sqrt(disc)) / g;
      }
      const landX = car.x + car.vx * t;
      const err = normalizeAngle(terrain.angleAt(landX, 30) - car.angle);
      if (err > 0.10) brake = 1;        // brake pitches the nose down
      else if (err < -0.10) throttle = 1; // gas pitches the nose up
    } else {
      const v = Math.max(car.vx, 0);
      const xNear = car.x + Math.max(70, v * 0.35);  // ~0.35 s ahead
      const xFar = car.x + Math.max(180, v * 0.90);  // ~0.90 s ahead
      // y grows down, so uphill is a negative slope. climb > 0 == uphill.
      const climbHere = -terrain.slopeAt(car.x, 30);
      const climbNear = -terrain.slopeAt(xNear, 25);
      const climbFar = -terrain.slopeAt(xFar, 45);
      const pitch = normalizeAngle(car.angle); // negative == nose up

      if (pitch < -p.pitchLimit) {
        // About to loop over backwards.
        throttle = 0;
        brake = 0.5;
      } else if (climbHere > 0.15 && climbFar < -0.25) {
        // Crest with a drop just past it -- power over it and you backflip.
        throttle = 0.35 * p.aggression;
      } else if (climbNear > 0.10) {
        throttle = 1.0;
      } else if (climbNear < -0.45 && v > p.cruiseSpeed) {
        // Steep descent at speed: stay planted.
        throttle = 0.25;
        brake = 0.25 * p.caution;
      } else {
        throttle = p.aggression;
      }
    }

    // Per-racer noise, so the field does not move in lockstep.
    throttle = clamp(throttle + (this.rng() - 0.5) * 0.12, 0, 1);

    // Reaction lag (80-200 ms). This is what sells it as a driver rather than
    // a solver that sees the future.
    this.buf.push({ throttle, brake });
    const out = this.buf.length > p.reactionFrames
      ? this.buf.shift()
      : { throttle: 0, brake: 0 };

    // Rubber band scales ENGINE FORCE only, and switches off for the run-in so
    // the finish is honest.
    const A = CFG.ai;
    if (car.x > terrain.length * A.BAND_OFF_AT) {
      car.engineScale = 1;
    } else {
      const lead = car.x - player.x;
      car.engineScale = clamp(1 - lead / A.BAND_RANGE, A.BAND_MIN, A.BAND_MAX);
    }

    return out;
  }
}
