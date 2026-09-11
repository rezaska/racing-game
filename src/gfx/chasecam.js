import * as THREE from 'three';
import { CFG } from '../config.js';

const C = CFG.camera;
// Frame-rate-independent damping. `v += (t - v) * 0.1` is wrong: its rate
// depends on frame time, so the camera behaves differently at 60 and 144 Hz.
const k = (tau, dt) => 1 - Math.exp(-dt / tau);

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export class ChaseCam {
  constructor(camera, t3) {
    this.camera = camera;
    this.t3 = t3;
    this.anchor = new THREE.Vector3();
    this.lookAt = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.roll = 0;
    this.fov = C.FOV_MIN;
    this.shake = 0;
    this.started = false;
    this._f = {};
    this._v = new THREE.Vector3();
  }

  // car: { position: Vector3, velocity: Vector3, s, speedPct, lateralG }
  update(car, dt) {
    const t3 = this.t3;
    if (!this.started) {
      this.anchor.copy(car.position);
      this.yaw = t3.frameAt(car.s, this._f).yaw;
      this.started = true;
    }

    this.anchor.lerp(car.position, k(C.TAU_ANCHOR, dt));

    // Follow the direction of travel, not the car's yaw. During a drift this
    // shows the car sideways on screen instead of rotating the whole world.
    const v = this._v.copy(car.velocity);
    const trackYaw = t3.frameAt(car.s, this._f).yaw;
    let targetYaw = trackYaw;
    if (v.lengthSq() > 4) {
      const velYaw = Math.atan2(-v.x, -v.z);
      targetYaw = trackYaw + shortestAngle(trackYaw, velYaw) * 0.35;
    }
    this.yaw += shortestAngle(this.yaw, targetYaw) * k(C.TAU_YAW, dt);

    const sp = car.speedPct;
    const back = C.BACK + C.BACK_SPEED * sp;
    const up = C.UP + C.UP_SPEED * sp;
    const desired = new THREE.Vector3(
      this.anchor.x + Math.sin(this.yaw) * back,
      this.anchor.y + up,
      this.anchor.z + Math.cos(this.yaw) * back,
    );
    this.pos.lerp(desired, k(C.TAU_POS, dt));

    // Never let the camera sink through a crest. Mandatory with 13% grades.
    const ground = t3.surfaceAt(car.s - back, 0, this._f);
    this.pos.y = Math.max(this.pos.y, ground.y + 1.7);

    // Look-ahead samples the TRACK, rather than differentiating the camera.
    // This is what makes a corner readable before you are in it.
    const ahead = THREE.MathUtils.clamp(
      C.LOOKAHEAD_S * car.velocity.length(), C.LOOKAHEAD_MIN, C.LOOKAHEAD_MAX,
    );
    const la = t3.surfaceAt(car.s + ahead, 0, this._f);
    const target = new THREE.Vector3(la.x, la.y + C.LOOK_UP, la.z).lerp(car.position, 0.3);
    this.lookAt.lerp(target, k(C.TAU_LOOK, dt));

    this.shake = Math.max(0, this.shake - dt * 2.5);
    if (this.shake > 0) {
      const a = this.shake * this.shake * 0.6;
      this.lookAt.x += (Math.random() * 2 - 1) * a;
      this.lookAt.y += (Math.random() * 2 - 1) * a;
    }

    const fovT = CFG.render.FOV_MIN +
      (CFG.render.FOV_MAX - CFG.render.FOV_MIN) * THREE.MathUtils.smoothstep(sp, 0.25, 1.0);
    this.fov += (fovT - this.fov) * k(C.TAU_FOV, dt);

    const rollT = -C.ROLL_MAX * THREE.MathUtils.clamp(car.lateralG / 2, -1, 1);
    this.roll += (rollT - this.roll) * k(C.TAU_ROLL, dt);

    this.camera.position.copy(this.pos);
    this.camera.up.set(Math.sin(this.roll), Math.cos(this.roll), 0);
    this.camera.lookAt(this.lookAt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
