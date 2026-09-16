import { CFG } from '../config.js';
import { Track } from './track.js';
import { Track3D } from './track3d.js';
import { Vehicle } from './vehicle.js';
import { Traffic } from './ai.js';
import { mulberry32 } from '../mathx.js';

const IDLE = { left: false, right: false, accel: false, brake: false };

export class Race {
  constructor(seed) {
    this.restart(seed);
  }

  restart(seed) {
    this.seed = seed;
    this.track = new Track(seed);
    this.t3 = new Track3D(this.track);
    this.player = new Vehicle(this.track, this.t3);
    this.traffic = new Traffic(this.track, seed, CFG.ai.LIVERIES);
    this.fieldSize = this.traffic.cars.length + 1;
    this.state = 'attract';
    this.attractT = 0;
    this.attractS = 0;
    this.countdown = CFG.race.COUNTDOWN;
    this.elapsed = 0;
    this.clock = 0;
    this.results = null;
    this.classified = false;
  }


  // Back to the title screen without rebuilding the course, so the meshes the
  // renderer already holds stay valid.
  toAttract() {
    this.player = new Vehicle(this.track, this.t3);
    this.traffic = new Traffic(this.track, this.seed, CFG.ai.LIVERIES);
    this.state = 'attract';
    this.attractT = 0;
    this.attractS = 0;
    this.elapsed = 0;
    this.clock = 0;
    this.results = null;
    this.classified = false;
  }

  // Leaves attract mode with a clean grid: the demo drive has moved the player
  // and the traffic down the road, so both are rebuilt rather than raced from
  // wherever the camera drifted to.
  start() {
    this.player = new Vehicle(this.track, this.t3);
    this.traffic = new Traffic(this.track, this.seed, CFG.ai.LIVERIES);
    this.elapsed = 0;
    this.clock = 0;
    this.countdown = CFG.race.COUNTDOWN;
    this.results = null;
    this.classified = false;
    this.state = 'countdown';
  }

  step(dt, input) {
    if (this.state === 'attract') {
      // A slow demo cruise behind the title. It drives the car along the
      // spline directly rather than through the physics, so the title screen
      // cannot be knocked off the road by its own opponents.
      this.attractT += dt;
      const t3 = this.t3;
      // The title screen is a landscape now, not a demo lap: no cars are drawn,
      // so this station drives a cinematic camera rather than a car, and the
      // traffic is left parked because nothing can see it.
      this.attractS += CFG.menuCam.SPEED * dt;
      if (this.attractS > t3.length * 0.86) this.attractS = 0;
      const n = Math.sin(this.attractT * 0.45) * 0.4 * t3.halfWidth;
      const f = t3.surfaceAt(this.attractS, n, {});
      const p = this.player;
      p.px = f.x; p.py = f.y; p.pz = f.z;
      p.psi = f.yaw; p.bank = f.bank; p.grade = f.grade;
      p.s = this.attractS; p.n = n;
      p.z = t3.sToZ(this.attractS); p.x = t3.nToX(n);
      // Metres per second: `speed` changed units with the arcade model, and vx
      // is now a derived getter with no setter -- assigning to it throws.
      p.speed = 3400 * CFG.world.U;
      p.vpsi = f.yaw;
      p.beta = 0;
      p.segmentRef = this.track.findSegment(p.z);
      return;
    }

    if (this.state === 'countdown') {
      this.countdown -= dt;
      this.player.segmentRef = this.track.findSegment(this.player.z);
      // Opponents hold station until the flag drops; letting them drive through
      // the countdown hands them a free head start.
      this.player.place = this.#place();
      if (this.countdown <= 0) this.state = 'racing';
      return;
    }

    this.player.segmentRef = this.track.findSegment(this.player.z);

    // Two clocks. `elapsed` is the player's race time and stops the moment they
    // cross; `clock` keeps running, because the opponents are still out on
    // track and a finishing time has to be measured against something that
    // moves. Reading both off `elapsed` gave every car that finished after the
    // player the identical, frozen time the player crossed on.
    this.clock += dt;
    if (!this.player.finished) this.elapsed += dt;
    this.player.update(dt, this.state === 'racing' ? input : IDLE, this.traffic);
    this.traffic.update(dt, this.player);

    if (this.player.finished && !this.player.finishTime) this.player.finishTime = this.clock;
    for (const car of this.traffic.cars) {
      if (car.finished && !car.finishTime) car.finishTime = this.clock;
    }

    this.player.place = this.#place();

    if (this.player.finished && this.state !== 'finished') {
      this.state = 'finished';
      this.#settleField();
      this.results = this.standings();
    }
  }

  // The race is not over when the player's race is over -- but nobody wants to
  // sit and watch for half a minute while the field trails in. The opponents
  // run on rails, so their remaining laps are simulated as fast as the loop can
  // turn them over, and the classification is complete by the time the results
  // panel has faded in. Capped, because a car shoved off the road may never
  // arrive at all.
  #settleField() {
    const dt = CFG.DT;
    const limit = CFG.race.CLASSIFY_LIMIT / dt;
    for (let i = 0; i < limit && this.traffic.cars.some((c) => !c.finished); i++) {
      this.clock += dt;
      this.traffic.update(dt, this.player);
      for (const car of this.traffic.cars) {
        if (car.finished && !car.finishTime) car.finishTime = this.clock;
      }
    }
    this.classified = true;
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

  standings() {
    return this.#entries().map((e, i) => ({ ...e, place: i + 1 }));
  }
}
