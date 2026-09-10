// Keyboard and touch -> { left, right, accel, brake }

const MAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'accel', KeyW: 'accel',
  ArrowDown: 'brake', KeyS: 'brake',
  ShiftLeft: 'boost', ShiftRight: 'boost',
  Space: 'handbrake',
};

export class Input {
  constructor() {
    this.left = this.right = this.accel = this.brake = false;
    this.boost = this.handbrake = false;
    this.touch = { left: false, right: false, accel: false, brake: false, boost: false, handbrake: false };
    this.keys = new Set();
    this.onRestart = null;
    this.onTheme = null;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyR') { this.onRestart?.(); return; }
      if (e.code === 'KeyT') { this.onTheme?.(); return; }
      if (MAP[e.code]) { this.keys.add(e.code); e.preventDefault(); }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    // Losing focus mid-press would otherwise leave the throttle stuck on.
    window.addEventListener('blur', () => this.keys.clear());

    for (const id of ['left', 'right', 'accel', 'brake']) this.#bind(id);
  }

  #bind(name) {
    const el = document.getElementById(`btn-${name}`);
    if (!el) return;
    const set = (v) => (e) => { e.preventDefault(); this.touch[name] = v; };
    el.addEventListener('pointerdown', set(true));
    el.addEventListener('pointerup', set(false));
    el.addEventListener('pointercancel', set(false));
    el.addEventListener('pointerleave', set(false));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  poll() {
    const held = {};
    for (const code of this.keys) held[MAP[code]] = true;
    this.left = !!held.left || this.touch.left;
    this.right = !!held.right || this.touch.right;
    this.accel = !!held.accel || this.touch.accel;
    this.brake = !!held.brake || this.touch.brake;
    this.boost = !!held.boost || this.touch.boost;
    this.handbrake = !!held.handbrake || this.touch.handbrake;
    return this;
  }
}
