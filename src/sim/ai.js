import { CFG } from '../config.js';
import { clamp, mulberry32, overlap } from '../mathx.js';

const A = CFG.ai;
const R = CFG.road;

// Opponents are plain traffic: they hold a lane, look a little way ahead, and
// ease around whatever is in front of them. No pathfinding, no rubber banding --
// on a road this narrow, "steer around the thing ahead" is the whole behaviour.
export class Traffic {
  constructor(track, seed, spriteCount) {
    this.track = track;
    this.rng = mulberry32((seed ^ 0x7f4a7c15) >>> 0);
    this.cars = [];
    this.bumped = 0;

    // A staggered grid just ahead of the player. Spreading them over the whole
    // track instead makes this traffic to weave through, not a race -- the
    // player would start last and "position" would mean nothing.
    for (let i = 0; i < A.COUNT; i++) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const segIndex = 12 + row * 7;
      const car = {
        z: segIndex * R.SEGMENT_LENGTH,
        offset: (col - 1) * 0.58 + (this.rng() - 0.5) * 0.1,
        target: 0,
        speed: A.MIN_SPEED + this.rng() * (A.MAX_SPEED - A.MIN_SPEED),
        sprite: i % spriteCount,
        finished: false,
        finishTime: 0,
        name: `CAR ${i + 1}`,
      };
      car.target = car.offset;
      this.cars.push(car);
    }
    this.#rebucket();
  }

  #rebucket() {
    for (const seg of this.track.segments) if (seg.cars.length) seg.cars.length = 0;
    for (const car of this.cars) {
      car.segment = this.track.findSegment(car.z);
      car.segment.cars.push(car);
    }
  }

  update(dt, player) {
    this.bumped = Math.max(0, this.bumped - dt);
    const segs = this.track.segments;

    for (const car of this.cars) {
      const seg = car.segment;
      car.offset += this.#avoid(car, seg, player) * dt * A.STEER;

      if (this.rng() < A.LANE_CHANGE_CHANCE) {
        car.target = (this.rng() * 1.6) - 0.8;
      }
      // Ease toward the chosen lane.
      car.offset += clamp(car.target - car.offset, -1, 1) * dt * 0.5;
      car.offset = clamp(car.offset, -0.95, 0.95);

      if (!car.finished) {
        // Corner speed, mirroring the compromise the player has to make.
        const factor = Math.max(A.MIN_CURVE_FACTOR, 1 - Math.abs(seg.curve) * A.CURVE_SLOWDOWN);
        car.z += car.speed * factor * dt;
        if (car.z >= this.track.finishZ) car.finished = true;
      } else {
        car.speed = Math.max(0, car.speed - 4000 * dt);
        car.z += car.speed * dt;
      }
      car.z = Math.min(car.z, (segs.length - 2) * R.SEGMENT_LENGTH);
    }

    this.#separate();
    this.#rebucket();
  }

  // Opponents had no collision with each other at all, so half the time two of
  // them were occupying the same piece of road. Pairwise, 14 cars is 91 tests a
  // frame -- nothing.
  #separate() {
    const U = CFG.world.U;
    const hw = CFG.road.WIDTH * U;
    const L = CFG.car.LENGTH;
    const W = CFG.car.WIDTH_M;
    const cars = this.cars;

    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        const ds = (a.z - b.z) * U;
        const dn = (a.offset - b.offset) * hw;
        const ovS = L - Math.abs(ds);
        const ovN = W - Math.abs(dn);
        if (ovS <= 0 || ovN <= 0) continue;

        // Push apart sideways -- the only axis they can really use -- and have
        // the trailing car lift off, so they separate instead of grinding.
        const side = Math.sign(dn) || (i % 2 ? 1 : -1);
        const push = (ovN * 0.5) / hw;
        a.offset = clamp(a.offset + side * push, -0.95, 0.95);
        b.offset = clamp(b.offset - side * push, -0.95, 0.95);
        const behind = ds < 0 ? a : b;
        behind.speed = Math.max(A.MIN_SPEED * 0.6, behind.speed * 0.982);
      }
    }
  }

  // Look a short way up the road; steer away from anything overlapping.
  #avoid(car, seg, player) {
    const segs = this.track.segments;
    const lookahead = 22;
    const w = 0.55;

    for (let i = 1; i < lookahead; i++) {
      const s = segs[seg.index + i];
      if (!s) break;

      if (s === player.segmentRef && car.speed > player.speed &&
          overlap(player.x, w, car.offset, w, 1.4)) {
        return player.x > car.offset ? -1 : 1;
      }
      for (const other of s.cars) {
        if (other === car) continue;
        if (car.speed <= other.speed) continue;
        if (!overlap(other.offset, w, car.offset, w, 1.4)) continue;
        // Steer toward the side with more road left.
        if (other.offset > car.offset) return -1;
        if (other.offset < car.offset) return 1;
        return car.offset > 0 ? -1 : 1;
      }
    }
    return 0;
  }
}
