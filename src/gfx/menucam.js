import * as THREE from 'three';
import { CFG } from '../config.js';

const M = CFG.menuCam;

// The title-screen camera.
//
// Not a chase camera with the car hidden -- that is a camera composed around an
// object that is not there, and it shows. This one is composed around the road
// itself: raised, offset to one side, on a long lens so the sun sits large and
// the road compresses into a graphic band running to the vanishing point the
// piece is named after.
//
// Everything it does is slow and out of phase. The height, the lateral offset
// and the look-ahead all drift on periods that share no common multiple, so the
// move never visibly repeats while someone reads the menu.
export class MenuCam {
  constructor(camera, t3) {
    this.camera = camera;
    this.t3 = t3;
    this.t = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this._f = {};
    this.started = false;
  }

  setTrack(t3) {
    this.t3 = t3;
    this.started = false;
  }

  update(s, dt) {
    const t3 = this.t3;
    this.t += dt;

    const side = Math.sin(this.t / M.SIDE_PERIOD) * M.SIDE * t3.halfWidth;
    const rise = M.HEIGHT + Math.sin(this.t / M.RISE_PERIOD) * M.RISE;
    const ahead = M.LOOKAHEAD + Math.sin(this.t / M.AHEAD_PERIOD) * M.AHEAD_SWING;

    const here = t3.surfaceAt(s, side, this._f);
    const up = { x: here.ux, y: here.uy, z: here.uz };
    this.pos.set(here.x + up.x * rise, here.y + up.y * rise, here.z + up.z * rise);

    // Look far enough down the road that the vanishing point, not the tarmac in
    // front of the lens, is what the shot is about.
    const far = t3.surfaceAt(Math.min(s + ahead, t3.length - 1), side * 0.3, {});
    this.look.set(far.x, far.y + M.LOOK_UP, far.z);

    if (!this.started) { this.started = true; }

    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.look);
    this.camera.rotateZ(Math.sin(this.t / M.ROLL_PERIOD) * M.ROLL);

    if (Math.abs(this.camera.fov - M.FOV) > 0.01) {
      this.camera.fov = M.FOV;
      this.camera.updateProjectionMatrix();
    }
  }
}
