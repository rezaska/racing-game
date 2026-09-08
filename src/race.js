import { CFG } from './config.js';
import { Terrain } from './terrain.js';
import { Vehicle } from './vehicle.js';
import { AIController } from './ai.js';

const NO_INPUT = { throttle: 0, brake: 0 };

export class Race {
  constructor(seed) {
    this.restart(seed);
  }

  restart(seed) {
    this.seed = seed;
    this.terrain = new Terrain(seed);

    const startX = this.terrain.startX;
    const sp = CFG.race.START_SPACING;

    this.player = new Vehicle(this.terrain, startX, {
      color: CFG.palette.playerColor,
      name: 'You',
      isPlayer: true,
    });

    this.ais = [];
    for (let i = 0; i < CFG.ai.COUNT; i++) {
      const p = CFG.ai.PERSONALITIES[i % CFG.ai.PERSONALITIES.length];
      const car = new Vehicle(this.terrain, startX - sp * (i + 1), {
        color: p.color,
        name: p.name,
      });
      this.ais.push({ car, ctrl: new AIController(p, seed, i) });
    }

    this.cars = [this.player, ...this.ais.map((a) => a.car)];
    this.particles = [];
    this.state = 'countdown';
    this.countdown = CFG.race.COUNTDOWN;
    this.elapsed = 0;
    this.results = null;
  }

  step(dt, playerInput) {
    if (this.state === 'countdown') {
      this.countdown -= dt;
      // Physics still runs so every car settles on its suspension before the
      // flag drops.
      for (const c of this.cars) c.step(dt, NO_INPUT);
      if (this.countdown <= 0) this.state = 'racing';
      this.#stepParticles(dt);
      return;
    }

    this.elapsed += dt;

    this.player.step(dt, this.state === 'racing' ? playerInput : NO_INPUT);

    // AI keep driving after the player crosses the line, so you see them come
    // in behind you and the standings settle honestly.
    for (const a of this.ais) {
      a.car.step(dt, a.ctrl.update(a.car, this.terrain, this.player));
    }

    for (const c of this.cars) {
      if (!c.finished && c.x >= this.terrain.finishX) {
        c.finished = true;
        c.finishTime = this.elapsed;
      }
      this.#emitDust(c);
    }

    this.#stepParticles(dt);

    if (this.player.finished) {
      this.state = 'finished';
      // Recomputed every step so late finishers' times fill in live.
      this.results = this.standings().map((c, i) => ({
        place: i + 1,
        name: c.name,
        color: c.color,
        isPlayer: c.isPlayer,
        time: c.finished ? c.finishTime : null,
        progress: c.distance / this.terrain.finishX,
      }));
    }
  }

  standings() {
    return this.cars.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.x - a.x;
    });
  }

  playerPlace() {
    return this.standings().indexOf(this.player) + 1;
  }

  #emitDust(car) {
    if (car.airborne || car.crashed) return;
    const speed = Math.abs(car.vx);
    if (speed < 60) return;
    const w = car.wheels[0];
    if (!w.contact) return;
    if (Math.random() > Math.min(0.8, speed / 900)) return;
    this.particles.push({
      x: w.worldX - 6,
      y: w.worldY + CFG.car.RADIUS - 2,
      vx: -car.vx * 0.12 + (Math.random() - 0.5) * 40,
      vy: -Math.random() * 70 - 10,
      life: 0.45 + Math.random() * 0.35,
      age: 0,
      r: 3 + Math.random() * 5,
    });
  }

  #stepParticles(dt) {
    const p = this.particles;
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      q.age += dt;
      if (q.age >= q.life) { p[i] = p[p.length - 1]; p.pop(); continue; }
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy += 190 * dt;
      q.vx *= 0.96;
    }
  }
}
