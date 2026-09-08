import { CFG } from './config.js';
import { clamp, expDamp } from './mathx.js';

export class Camera {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.W = 800;
    this.H = 600;
    this.dpr = 1;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  resize(cssW, cssH, dpr) {
    this.W = cssW;
    this.H = cssH;
    this.dpr = dpr;
  }

  snapTo(car) {
    this.x = car.x;
    this.y = car.y;
  }

  follow(car, dt) {
    const C = CFG.camera;

    // Lead the car by its velocity so you can see what you are about to hit.
    const targetX = car.x + clamp(car.vx * C.LEAD, C.LEAD_MIN, C.LEAD_MAX);
    const targetY = car.y - 40;

    this.x = expDamp(this.x, targetX, C.LAMBDA_X, dt);
    // Looser vertically -- tight vertical tracking over hills is nauseating.
    this.y = expDamp(this.y, targetY, C.LAMBDA_Y, dt);

    const speed = Math.hypot(car.vx, car.vy);
    const want = clamp(
      1 - speed / C.SPEED_ZOOM - (car.airborne ? C.AIR_ZOOM : 0),
      C.ZOOM_MIN, C.ZOOM_MAX
    );
    this.zoom = expDamp(this.zoom, want, C.LAMBDA_ZOOM, dt);

    if (car.peakNormalForce > C.SHAKE_THRESHOLD) this.shake = 8;
    this.shake *= Math.exp(-C.SHAKE_DECAY * dt);
    this.shakeX = (Math.random() * 2 - 1) * this.shake;
    this.shakeY = (Math.random() * 2 - 1) * this.shake;
  }

  // One transform serves every layer. parallax 1 == the world plane.
  applyTransform(ctx, px = 1, py = px) {
    const z = this.zoom * this.dpr;
    ctx.setTransform(
      z, 0, 0, z,
      (this.W * 0.5 + this.shakeX) * this.dpr - this.x * px * z,
      (this.H * CFG.camera.ANCHOR_Y + this.shakeY) * this.dpr - this.y * py * z
    );
  }

  screenSpace(ctx) {
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  // World-x range currently visible at the given parallax factor.
  visibleRange(px = 1, pad = 60) {
    const half = (this.W * 0.5) / this.zoom;
    return { left: this.x * px - half - pad, right: this.x * px + half + pad };
  }

  worldBottom() {
    return this.y + (this.H * (1 - CFG.camera.ANCHOR_Y)) / this.zoom;
  }
}
