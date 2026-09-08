import { CFG } from './config.js';
import { Track } from './track.js';
import { Player } from './player.js';
import { Traffic } from './ai.js';
import { buildSprites } from './sprites.js';
import { buildBackground } from './render.js';
import { PLAYER_Z } from './track.js';
import { mulberry32 } from './mathx.js';

const IDLE = { left: false, right: false, accel: false, brake: false };

export class Race {
  constructor(seed, themeName = 'coast') {
    this.themeName = themeName;
    this.spriteSeed = (seed ^ 0x1234abcd) >>> 0;
    this.sprites = buildSprites(mulberry32(this.spriteSeed), CFG.themes[themeName]);
    this.restart(seed);
  }

  get theme() {
    return CFG.themes[this.themeName];
  }

  restart(seed) {
    this.seed = seed;
    this.track = new Track(seed);
    this.player = new Player(this.track);
    this.traffic = new Traffic(this.track, seed, this.sprites.opponents.length);
    this.fieldSize = this.traffic.cars.length + 1;
    this.state = 'attract';
    this.attractT = 0;
    this.countdown = CFG.race.COUNTDOWN;
    this.elapsed = 0;
    this.results = null;
    this.bgOffset = 0;
    if (this.iw) this.resize(this.iw, this.ih);
  }

  setTheme(name) {
    this.themeName = name;
    this.sprites = buildSprites(mulberry32(this.spriteSeed), CFG.themes[name]);
    if (this.iw) this.resize(this.iw, this.ih);
  }

  // Backgrounds are pre-rendered at the current internal resolution, so they
  // are rebuilt whenever that changes or the theme is swapped.
  resize(iw, ih) {
    this.iw = iw;
    this.ih = ih;
    this.bg = buildBackground(this.theme, iw, ih, mulberry32((this.seed ^ 0x51ed270b) >>> 0));
  }

  // Leaves attract mode with a clean grid: the demo drive has moved the player
  // and the traffic down the road, so both are rebuilt rather than raced from
  // wherever the camera drifted to.
  start() {
    this.player = new Player(this.track);
    this.traffic = new Traffic(this.track, this.seed, this.sprites.opponents.length);
    this.elapsed = 0;
    this.countdown = CFG.race.COUNTDOWN;
    this.results = null;
    this.bgOffset = 0;
    this.state = 'countdown';
  }

  step(dt, input) {
    if (this.state === 'attract') {
      // A slow demo cruise behind the title, looping back to the start.
      this.attractT += dt;
      const before = this.player.z;
      this.player.speed = 3400;
      this.player.z += this.player.speed * dt;
      this.player.x = Math.sin(this.attractT * 0.45) * 0.4;
      const seg = this.track.findSegment(this.player.z + PLAYER_Z);
      this.player.segmentRef = seg;
      this.bgOffset += seg.curve * ((this.player.z - before) / CFG.road.SEGMENT_LENGTH) * 12;
      this.traffic.update(dt, this.player);
      if (this.player.z > this.track.finishZ * 0.75) this.player.z = 0;
      return;
    }

    if (this.state === 'countdown') {
      this.countdown -= dt;
      this.player.segmentRef = this.track.findSegment(this.player.z + PLAYER_Z);
      // Opponents hold station until the flag drops; letting them drive through
      // the countdown hands them a free head start.
      this.player.place = this.#place();
      if (this.countdown <= 0) this.state = 'racing';
      return;
    }

    this.player.segmentRef = this.track.findSegment(this.player.z + PLAYER_Z);
    const before = this.player.z;

    if (!this.player.finished) this.elapsed += dt;
    this.player.update(dt, this.state === 'racing' ? input : IDLE, this.traffic);
    this.traffic.update(dt, this.player);

    if (this.player.finished && !this.player.finishTime) this.player.finishTime = this.elapsed;
    for (const car of this.traffic.cars) {
      if (car.finished && !car.finishTime) car.finishTime = this.elapsed;
    }

    // Background scrolls with the curve you are actually driving through, which
    // is what makes a bend feel like it is turning rather than sliding.
    const seg = this.player.segmentRef;
    this.bgOffset += seg.curve * ((this.player.z - before) / CFG.road.SEGMENT_LENGTH) * 12;

    this.player.place = this.#place();

    if (this.player.finished) {
      this.state = 'finished';
      this.results = this.#standings();
    }
  }

  #entries() {
    const list = this.traffic.cars.map((c) => ({
      name: c.name, z: c.z, finished: c.finished, time: c.finishTime || null, isPlayer: false,
    }));
    list.push({
      name: 'YOU', z: this.player.z, finished: this.player.finished,
      time: this.player.finishTime || null, isPlayer: true,
    });
    list.sort((a, b) => {
      if (a.finished && b.finished) return (a.time || 0) - (b.time || 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.z - a.z;
    });
    return list;
  }

  #place() {
    const list = this.#entries();
    return list.findIndex((e) => e.isPlayer) + 1;
  }

  #standings() {
    return this.#entries().map((e, i) => ({ ...e, place: i + 1 }));
  }
}
