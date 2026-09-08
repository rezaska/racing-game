import { CFG } from './config.js';
import { easeIn, easeInOut, mulberry32 } from './mathx.js';

const R = CFG.road;

export const CAMERA_DEPTH = 1 / Math.tan(((R.FIELD_OF_VIEW / 2) * Math.PI) / 180);
// How far ahead of the camera the player's car sits. Works out to exactly
// CAMERA_HEIGHT * CAMERA_DEPTH, so the on-screen scale is 1 / CAMERA_HEIGHT.
export const PLAYER_Z = R.CAMERA_HEIGHT * CAMERA_DEPTH;

// Curve strengths (per-segment horizontal shift) and hill heights.
const CURVE = { NONE: 0, EASY: 2, MEDIUM: 4, HARD: 6 };
const HILL = { NONE: 0, LOW: 20, MEDIUM: 40, HIGH: 60 };
const LEN = { NONE: 0, SHORT: 25, MEDIUM: 50, LONG: 100 };

export class Track {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.segments = [];
    this.#build();
    this.length = this.segments.length * R.SEGMENT_LENGTH;
    // The finish sits before the end so there is still road on the horizon as
    // you cross it, rather than the world simply stopping.
    this.finishIndex = this.segments.length - 120;
    this.finishZ = this.finishIndex * R.SEGMENT_LENGTH;
    this.#addScenery(seed);
  }

  #lastY() {
    const n = this.segments.length;
    return n === 0 ? 0 : this.segments[n - 1].p2.world.y;
  }

  #addSegment(curve, y) {
    const n = this.segments.length;
    this.segments.push({
      index: n,
      p1: { world: { x: 0, y: this.#lastY(), z: n * R.SEGMENT_LENGTH }, camera: {}, screen: {} },
      p2: { world: { x: 0, y, z: (n + 1) * R.SEGMENT_LENGTH }, camera: {}, screen: {} },
      curve,
      // Alternating band index; the renderer maps this onto the active theme so
      // themes can be swapped at runtime without rebuilding the track.
      dark: Math.floor(n / R.RUMBLE_LENGTH) % 2 === 1,
      sprites: [],
      cars: [],
      clip: 0,
    });
  }

  #addRoad(enter, hold, leave, curve, y) {
    const startY = this.#lastY();
    const endY = startY + y * R.SEGMENT_LENGTH;
    const total = enter + hold + leave;
    for (let n = 0; n < enter; n++) {
      this.#addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
    }
    for (let n = 0; n < hold; n++) {
      this.#addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
    }
    for (let n = 0; n < leave; n++) {
      this.#addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
    }
  }

  #straight(n = LEN.MEDIUM, hill = HILL.NONE) {
    this.#addRoad(n, n, n, 0, hill);
  }

  #curve(n, curve, hill = HILL.NONE) {
    this.#addRoad(n, n, n, curve, hill);
  }

  #sCurves() {
    this.#addRoad(LEN.SHORT, LEN.SHORT, LEN.SHORT, -CURVE.EASY, HILL.NONE);
    this.#addRoad(LEN.SHORT, LEN.SHORT, LEN.SHORT, CURVE.MEDIUM, HILL.MEDIUM);
    this.#addRoad(LEN.SHORT, LEN.SHORT, LEN.SHORT, CURVE.EASY, -HILL.LOW);
    this.#addRoad(LEN.SHORT, LEN.SHORT, LEN.SHORT, -CURVE.EASY, HILL.MEDIUM);
    this.#addRoad(LEN.SHORT, LEN.SHORT, LEN.SHORT, -CURVE.MEDIUM, -HILL.MEDIUM);
  }

  #build() {
    // Composed from a seeded shuffle of sections. Hand-composing this instead
    // made every seed produce an identical course, with only the scenery
    // varying -- a shareable seed that changes nothing is not a seed.
    const rng = this.rng;
    const pick = (arr) => arr[Math.floor(rng() * arr.length)];
    const curves = [CURVE.EASY, CURVE.MEDIUM, CURVE.HARD];
    const hills = [HILL.NONE, HILL.LOW, HILL.MEDIUM, HILL.HIGH];
    const lens = [LEN.SHORT, LEN.MEDIUM, LEN.LONG];

    // A flat straight to launch from, so the standing start is never in a bend.
    this.#straight(LEN.MEDIUM, HILL.NONE);

    const sections = 9 + Math.floor(rng() * 4);   // ~45-60s races
    let lastDir = rng() < 0.5 ? -1 : 1;
    for (let i = 0; i < sections; i++) {
      const roll = rng();
      if (roll < 0.22) {
        this.#straight(pick(lens), pick(hills) * (rng() < 0.5 ? -1 : 1));
      } else if (roll < 0.45) {
        this.#sCurves();
      } else {
        // Alternate direction most of the time so the course does not spiral.
        lastDir = rng() < 0.75 ? -lastDir : lastDir;
        this.#curve(pick(lens), pick(curves) * lastDir, pick(hills) * (rng() < 0.5 ? -1 : 1));
      }
    }

    // A flat run-in so the finish line is always approached on a straight.
    this.#straight(LEN.MEDIUM, HILL.NONE);
  }

  // Roadside dressing. Sprite offsets are in road half-widths: 1 is the edge of
  // the tarmac, so anything past ~1.15 sits clear of the rumble strip.
  #addScenery(seed) {
    const rng = mulberry32((seed ^ 0x5bf03635) >>> 0);
    const n = this.segments.length;
    for (let i = 24; i < n - 24; i++) {
      const seg = this.segments[i];
      if (i % 11 === 0) {
        const side = rng() < 0.5 ? -1 : 1;
        const kind = rng() < 0.55 ? 'palm' : 'tree';
        seg.sprites.push({ kind, offset: side * (1.3 + rng() * 1.3) });
      }
      if (i % 53 === 0) {
        seg.sprites.push({ kind: 'billboard', offset: rng() < 0.5 ? -1.9 : 1.9 });
      } else if (i % 31 === 0) {
        seg.sprites.push({ kind: 'sign', offset: rng() < 0.5 ? -1.45 : 1.45 });
      }
    }
    this.segments[this.finishIndex].sprites.push({ kind: 'finish', offset: 0 });
  }

  findSegment(z) {
    const i = Math.floor(z / R.SEGMENT_LENGTH);
    return this.segments[Math.max(0, Math.min(i, this.segments.length - 1))];
  }
}

// Project a road point into screen space.
//   scale = cameraDepth / distanceAhead  -- everything else follows from it.
export function project(p, cameraX, cameraY, cameraZ, cameraDepth, width, height, roadWidth) {
  p.camera.x = (p.world.x || 0) - cameraX;
  p.camera.y = (p.world.y || 0) - cameraY;
  p.camera.z = (p.world.z || 0) - cameraZ;
  p.screen.scale = cameraDepth / p.camera.z;
  p.screen.x = Math.round(width / 2 + (p.screen.scale * p.camera.x * width) / 2);
  p.screen.y = Math.round(height / 2 - (p.screen.scale * p.camera.y * height) / 2);
  p.screen.w = Math.round((p.screen.scale * roadWidth * width) / 2);
}
