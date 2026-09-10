import { CFG } from '../config.js';

// All audio is synthesised. No files, and not for purity -- a sample cannot
// track a continuously varying throttle and load without a lot of crossfading,
// whereas oscillators just follow it.
//
// Silence is why the piece felt dead. Engine pitch is how a player feels speed
// and throttle; without it the car may as well be a photograph.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function noiseBuffer(ctx, seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.muted = false;
  }

  // Browsers refuse to start audio without a gesture, so this is called from
  // the same click or keypress that starts the race.
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0;
    master.connect(ctx.destination);
    this.master = master;

    // --- engine: a stack of saws an octave apart, through a moving lowpass ---
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 700;
    this.lp.Q.value = 0.9;
    this.engineGain.connect(this.lp);
    this.lp.connect(master);

    this.oscs = [];
    for (const [ratio, gain, type] of [[0.5, 0.5, 'sawtooth'], [1, 1.0, 'sawtooth'], [2, 0.35, 'square'], [3, 0.16, 'sawtooth']]) {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(this.engineGain);
      o.start();
      this.oscs.push({ o, ratio });
    }

    // Induction rasp: noise shaped by a bandpass that tracks the engine.
    const nb = noiseBuffer(ctx);
    this.rasp = ctx.createBufferSource();
    this.rasp.buffer = nb;
    this.rasp.loop = true;
    this.raspBp = ctx.createBiquadFilter();
    this.raspBp.type = 'bandpass';
    this.raspBp.frequency.value = 900;
    this.raspBp.Q.value = 1.6;
    this.raspGain = ctx.createGain();
    this.raspGain.gain.value = 0;
    this.rasp.connect(this.raspBp);
    this.raspBp.connect(this.raspGain);
    this.raspGain.connect(master);
    this.rasp.start();

    // --- tyres: bandpassed noise, driven by slip ---
    this.tyre = ctx.createBufferSource();
    this.tyre.buffer = nb;
    this.tyre.loop = true;
    this.tyreBp = ctx.createBiquadFilter();
    this.tyreBp.type = 'bandpass';
    this.tyreBp.frequency.value = 1500;
    this.tyreBp.Q.value = 0.8;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyre.connect(this.tyreBp);
    this.tyreBp.connect(this.tyreGain);
    this.tyreGain.connect(master);
    this.tyre.start();

    // --- wind: highpassed noise, rises with the square of speed ---
    this.wind = ctx.createBufferSource();
    this.wind.buffer = nb;
    this.wind.loop = true;
    this.windHp = ctx.createBiquadFilter();
    this.windHp.type = 'highpass';
    this.windHp.frequency.value = 700;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.wind.connect(this.windHp);
    this.windHp.connect(this.windGain);
    this.windGain.connect(master);
    this.wind.start();

    this.enabled = true;
    master.gain.setTargetAtTime(this.muted ? 0 : 0.9, ctx.currentTime, 0.4);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.08);
    return this.muted;
  }

  // speed m/s, throttle 0..1, slip 0..1, offroad bool
  update(speed, throttle, brake, slip, offroad, playing) {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const vMax = CFG.car.MAX_SPEED * CFG.world.U;

    // Fake gearing. Pitch climbing and dropping on each shift is most of what
    // makes acceleration audible -- a single rising tone reads as a siren.
    const frac = clamp(speed / vMax, 0, 1);
    const GEARS = 6;
    const g = Math.min(GEARS - 1, Math.floor(frac * GEARS));
    const within = frac * GEARS - g;
    const rpm = 0.24 + within * 0.76;
    const base = 34 + rpm * 132;

    for (const { o, ratio } of this.oscs) {
      o.frequency.setTargetAtTime(base * ratio, t, 0.035);
    }

    const load = throttle > 0 ? 1 : brake > 0 ? 0.25 : 0.45;
    this.lp.frequency.setTargetAtTime(360 + rpm * 2600 * (0.45 + 0.55 * load), t, 0.06);
    this.engineGain.gain.setTargetAtTime(playing ? 0.16 + rpm * 0.16 * load : 0.0, t, 0.08);

    this.raspBp.frequency.setTargetAtTime(700 + rpm * 1500, t, 0.06);
    this.raspGain.gain.setTargetAtTime(playing ? (0.02 + rpm * 0.05) * load : 0, t, 0.08);

    // Tyres: slip on tarmac is a squeal, off road it is a lower rumble.
    this.tyreBp.frequency.setTargetAtTime(offroad ? 420 : 1500 + slip * 900, t, 0.05);
    this.tyreBp.Q.value = offroad ? 0.5 : 1.4;
    const scrub = offroad ? clamp(frac * 1.3, 0, 1) * 0.16 : slip * 0.18;
    this.tyreGain.gain.setTargetAtTime(playing ? scrub : 0, t, 0.06);

    this.windGain.gain.setTargetAtTime(playing ? frac * frac * 0.10 : 0, t, 0.12);
    this.windHp.frequency.setTargetAtTime(500 + frac * 900, t, 0.2);
  }
}
