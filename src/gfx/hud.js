// HUD as DOM rather than canvas: sharper at any DPR, free to render, and
// restyleable in CSS without touching the renderer.

const fmt = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

export class Hud {
  constructor(root) {
    this.root = root;
    this.speed = root.querySelector('[data-speed]');
    this.place = root.querySelector('[data-place]');
    this.time = root.querySelector('[data-time]');
    this.prog = root.querySelector('[data-progress]');
    this.count = root.querySelector('[data-countdown]');
    this.results = root.querySelector('[data-results]');
    this.lastState = null;
  }

  update(race) {
    const p = race.player;
    const racing = race.state === 'racing' || race.state === 'finished';
    this.root.classList.toggle('is-live', racing || race.state === 'countdown');

    this.speed.textContent = Math.round(Math.abs(p.speed) / 40);
    this.place.textContent = `${p.place}/${race.fieldSize}`;
    this.time.textContent = race.state === 'countdown' ? '0:00.00' : fmt(race.elapsed);
    const pct = Math.max(0, Math.min(1, p.z / race.track.finishZ));
    this.prog.style.setProperty('--p', pct);

    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown - 0.6);
      const label = n > 0 ? String(n) : 'GO';
      if (this.count.textContent !== label) {
        this.count.textContent = label;
        // Restart the CSS animation on each tick.
        this.count.style.animation = 'none';
        void this.count.offsetWidth;
        this.count.style.animation = '';
      }
      this.count.hidden = false;
    } else {
      this.count.hidden = true;
    }

    if (race.state === 'finished' && this.lastState !== 'finished') {
      const rows = race.standings().slice(0, 6);
      this.results.innerHTML = `<h2>Finish</h2><ol>${rows.map((r) => `
        <li${r.isPlayer ? ' class="me"' : ''}><span>${r.name}</span>
        <em>${r.time !== null ? fmt(r.time) : `${Math.round((r.z / race.track.finishZ) * 100)}%`}</em></li>`).join('')}
        </ol><p>Press <kbd>R</kbd> for a new road</p>`;
      this.results.hidden = false;
    } else if (race.state !== 'finished') {
      this.results.hidden = true;
    }
    this.lastState = race.state;
  }
}
