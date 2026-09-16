// HUD as DOM rather than canvas: sharper at any DPR, free to render, and
// restyleable in CSS without touching the renderer.

const fmt = (s) => {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(2).padStart(5, '0')}`;
};

// 1st, 2nd, 3rd, 4th -- and 11th/12th/13th, which is where the naive rule for
// this goes wrong.
function ordinal(n) {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
}

// The finishing classification: where you came, what you did it in, and the
// times everyone else did it in. The field is fast-forwarded the moment the
// player crosses, so these are real times rather than progress percentages.
function classification(race) {
  const rows = race.standings();
  const me = rows.find((r) => r.isPlayer);
  const winner = rows[0]?.time ?? null;

  const body = rows.map((r) => {
    const gap = r.time !== null && winner !== null && r.time > winner
      ? `+${(r.time - winner).toFixed(2)}`
      : r.time !== null ? '&mdash;' : '';
    const time = r.time !== null ? fmt(r.time)
      : `${Math.round((r.z / race.track.finishZ) * 100)}%`;
    return `<li${r.isPlayer ? ' class="me"' : ''}>` +
      `<i>${r.place}</i><span>${r.name}</span><em>${time}</em><u>${gap}</u></li>`;
  }).join('');

  return `
    <p class="res-head">Finish</p>
    <div class="res-place"><b>${me.place}</b><sup>${ordinal(me.place)}</sup>
      <span>of ${race.fieldSize}</span></div>
    <div class="res-time">${me.time !== null ? fmt(me.time) : fmt(race.elapsed)}</div>
    <ol class="res-table">${body}</ol>
    <p class="res-foot"><kbd>R</kbd> new road &middot; <kbd>Esc</kbd> menu</p>`;
}

export class Hud {
  constructor(root) {
    this.root = root;
    this.speed = root.querySelector('[data-speed]');
    this.place = root.querySelector('[data-place]');
    this.time = root.querySelector('[data-time]');
    this.prog = root.querySelector('[data-progress]');
    this.count = root.querySelector('[data-countdown]');
    this.results = root.querySelector('[data-results]');
    this.boost = root.querySelector('[data-boost]');
    this.lastState = null;
  }

  update(race) {
    const p = race.player;
    const racing = race.state === 'racing' || race.state === 'finished';
    this.root.classList.toggle('is-live', racing || race.state === 'countdown');
    this.root.classList.toggle('is-done', race.state === 'finished');

    // speed is metres per second now, not legacy units.
    this.speed.textContent = Math.round(Math.abs(p.speed) * 3.6);
    this.place.textContent = `${p.place}/${race.fieldSize}`;
    this.time.textContent = race.state === 'countdown' ? '0:00.00' : fmt(race.elapsed);
    const pct = Math.max(0, Math.min(1, p.z / race.track.finishZ));
    this.prog.style.setProperty('--p', pct);
    if (this.boost) {
      this.boost.style.setProperty('--b', p.boost ?? 0);
      this.boost.classList.toggle('firing', !!p.boosting);
    }

    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown - 0.6);
      const label = n > 0 ? String(n) : 'GO';
      if (this.count.textContent !== label) {
        this.count.textContent = label;
        this.count.classList.toggle('go', n <= 0);
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
      this.results.innerHTML = classification(race);
      this.results.hidden = false;
    } else if (race.state !== 'finished') {
      this.results.hidden = true;
    }
    this.lastState = race.state;
  }
}
