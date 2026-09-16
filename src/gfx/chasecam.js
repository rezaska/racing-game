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
    // CFG.render, not CFG.camera. Read from the wrong block this was undefined,
    // which made the first `this.fov += ...` NaN -- and every NaN comparison is
    // false, so the guard below never fired and the chase camera never once set
    // the camera's field of view. The speed ramp has been dead the whole time;
    // the lens sat at whatever the renderer constructed it with.
    this.fov = CFG.render.FOV_MIN;
    this.shake = 0;
    this.started = false;
    this._f = {};
    this._v = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._lead = new THREE.Vector3();
  }

  // car: { position: Vector3, velocity: Vector3, s, speedPct, lateralG }
  update(car, dt) {
    const t3 = this.t3;
    if (!this.started) {
      this.anchor.copy(car.position);
      this.yaw = t3.frameAt(car.s, this._f).yaw;
      this.started = true;
    }

    // Lead compensation.
    //
    // Exponential smoothing tracking a target moving at constant velocity does
    // not converge on it: it settles a fixed distance behind, v * tau. Two of
    // these filters run in series here -- the anchor chasing the car, then the
    // camera chasing a point offset from the anchor -- so at 35 m/s they
    // together parked the camera 5.6 m further back than BACK and BACK_SPEED
    // ask for. Measured: 14.85 m against a nominal 9.25 m at 126 km/h. The
    // config numbers described a stationary car and nothing else.
    //
    // Feeding the target's velocity forward by its own tau cancels that error.
    // LEAD is deliberately short of 1: some fall-back under acceleration is a
    // good speed cue, and this keeps it bounded and intentional rather than an
    // artifact that grows with speed.
    const lead = this._lead.copy(car.velocity).multiplyScalar(C.LEAD);
    this.anchor.lerp(
      this._tmp.copy(car.position).addScaledVector(lead, C.TAU_ANCHOR),
      k(C.TAU_ANCHOR, dt));

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
    desired.addScaledVector(lead, C.TAU_POS);   // the second filter, same story
    this.pos.lerp(desired, k(C.TAU_POS, dt));

    // Never let the camera sink through a crest. Mandatory with 13% grades.
    // A hard max() is C0 but not C1: on the frame it engages, the camera's
    // motion switches discontinuously from its own damped path to the raw
    // terrain profile behind the car, and on a sustained climb it engages and
    // releases over and over. That reads as shake. Softplus blends across
    // GROUND_SOFT metres instead, so the floor is felt before it is hit.
    const floor = t3.surfaceAt(car.s - back, 0, this._f).y + C.GROUND_CLEAR;
    const over = (this.pos.y - floor) / C.GROUND_SOFT;
    if (over < 12) this.pos.y = floor + C.GROUND_SOFT * Math.log1p(Math.exp(over));

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
    // Roll about the camera's OWN view axis, not about world Z. An up vector of
    // (sin r, cos r, 0) is a screen-space roll only while the camera happens to
    // face along Z; a quarter of the way round a course it faces along X, where
    // the same vector tilts the horizon in pitch instead and the whole frame
    // pumps up and down through every corner. Negated to match what the up
    // vector did at the start line, which is where it was dialled in.
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);
    this.camera.rotateZ(-this.roll);
    // Guard against NaN explicitly rather than relying on a comparison: a NaN
    // here is what hid the bug above for so long.
    if (!Number.isFinite(this.fov)) this.fov = CFG.render.FOV_MIN;
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
