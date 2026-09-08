// Keyboard + touch -> { throttle: 0..1, brake: 0..1 }

export class Input {
  constructor() {
    this.throttle = 0;
    this.brake = 0;
    this.onRestart = null;

    this.keys = new Set();
    this.touchGas = false;
    this.touchBrake = false;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.code === 'KeyR') {
        if (this.onRestart) this.onRestart();
        return;
      }
      if (this.#track(e.code)) {
        this.keys.add(e.code);
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    // Losing focus mid-press would otherwise leave the throttle stuck on.
    window.addEventListener('blur', () => this.releaseAll());

    this.#bindButton('btn-gas', (down) => { this.touchGas = down; });
    this.#bindButton('btn-brake', (down) => { this.touchBrake = down; });
  }

  #track(code) {
    return code === 'ArrowRight' || code === 'ArrowLeft' ||
           code === 'KeyD' || code === 'KeyA' ||
           code === 'KeyW' || code === 'KeyS' ||
           code === 'Space';
  }

  #bindButton(id, set) {
    const el = document.getElementById(id);
    if (!el) return;
    const down = (e) => { e.preventDefault(); set(true); };
    const up = (e) => { e.preventDefault(); set(false); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  releaseAll() {
    this.keys.clear();
    this.touchGas = false;
    this.touchBrake = false;
  }

  poll() {
    const gas = this.touchGas ||
      this.keys.has('ArrowRight') || this.keys.has('KeyD') || this.keys.has('KeyW');
    const brk = this.touchBrake ||
      this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.keys.has('KeyS');
    this.throttle = gas ? 1 : 0;
    this.brake = brk ? 1 : 0;
    return this;
  }
}
