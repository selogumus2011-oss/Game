// Fully procedural WebAudio sound design — no asset files, everything synthesised.
// Each cue is a tiny instrument: noise bursts for impacts, FM growls for curses,
// detuned saw stacks for domain drones, bit-crushed sine sweeps for Black Flash.

import { clamp, rand, randRange } from './math.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.enabled = true;
    this.volume = 0.7;
    this.sfxVolume = 0.9;
    this.musicVolume = 0.35;
    this.noiseBuffer = null;
    this.drones = new Map();
    this._lastPlay = new Map();
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 9;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume;
    this.musicGain.connect(this.master);

    // Pre-baked white noise for impacts / wind / fire.
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
  }

  _noise(dest, { start = 0, dur = 0.2, gain = 0.3, type = 'lowpass', freq = 900, q = 1, sweep = null, curve = 2 }) {
    const t0 = this.now + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = randRange(0.85, 1.2);
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t0);
    filt.Q.value = q;
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(40, sweep), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * curve * 0.5 + 0.01);
    src.connect(filt).connect(g).connect(dest || this.sfxGain);
    src.start(t0);
    src.stop(t0 + dur * curve * 0.5 + 0.06);
    return g;
  }

  _tone(dest, { start = 0, dur = 0.3, freq = 220, endFreq = null, type = 'sine', gain = 0.25, detune = 0, attack = 0.005 }) {
    const t0 = this.now + start;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(dest || this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    return g;
  }

  /** Throttle repeated cues so 12 simultaneous hits don't turn into mush. */
  _throttle(name, ms) {
    const t = this.now;
    const last = this._lastPlay.get(name) || -1;
    if ((t - last) * 1000 < ms) return false;
    this._lastPlay.set(name, t);
    return true;
  }

  play(name, opts = {}) {
    if (!this.enabled) return;
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.resume();
    const vol = clamp(opts.volume ?? 1, 0, 2);
    const p = clamp(opts.pitch ?? 1, 0.4, 2.4);
    const fn = CUES[name];
    if (!fn) return;
    if (opts.throttle && !this._throttle(name, opts.throttle)) return;
    try { fn(this, vol, p, opts); } catch (e) { /* audio must never break the game */ }
  }

  /** Continuous looping layer (domains, simple domain, RCT channel, fire). */
  startDrone(key, spec) {
    if (!this.ctx || this.drones.has(key)) return;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.now);
    g.gain.exponentialRampToValueAtTime(spec.gain ?? 0.12, this.now + (spec.fade ?? 0.4));
    g.connect(this.sfxGain);
    const nodes = [];
    for (const v of spec.voices || [{ freq: 60, type: 'sawtooth', detune: 0 }]) {
      const osc = this.ctx.createOscillator();
      osc.type = v.type || 'sawtooth';
      osc.frequency.value = v.freq;
      osc.detune.value = v.detune || 0;
      const f = this.ctx.createBiquadFilter();
      f.type = v.filter || 'lowpass';
      f.frequency.value = v.cutoff || 420;
      f.Q.value = v.q || 4;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = v.lfo || 0.3;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = v.lfoAmt || 60;
      lfo.connect(lfoGain).connect(f.frequency);
      lfo.start();
      osc.connect(f).connect(g);
      osc.start();
      nodes.push(osc, lfo);
    }
    if (spec.noise) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const f = this.ctx.createBiquadFilter();
      f.type = spec.noise.type || 'bandpass';
      f.frequency.value = spec.noise.freq || 700;
      f.Q.value = spec.noise.q || 1.5;
      const ng = this.ctx.createGain();
      ng.gain.value = spec.noise.gain ?? 0.2;
      src.connect(f).connect(ng).connect(g);
      src.start();
      nodes.push(src);
    }
    this.drones.set(key, { gain: g, nodes });
  }

  setDroneGain(key, v) {
    const d = this.drones.get(key);
    if (d) d.gain.gain.setTargetAtTime(Math.max(0.0001, v), this.now, 0.08);
  }

  stopDrone(key, fade = 0.35) {
    const d = this.drones.get(key);
    if (!d) return;
    this.drones.delete(key);
    try {
      d.gain.gain.cancelScheduledValues(this.now);
      d.gain.gain.setValueAtTime(Math.max(0.0001, d.gain.gain.value), this.now);
      d.gain.gain.exponentialRampToValueAtTime(0.0001, this.now + fade);
      for (const n of d.nodes) { try { n.stop(this.now + fade + 0.05); } catch (e) {} }
    } catch (e) {}
  }

  stopAllDrones() {
    for (const key of [...this.drones.keys()]) this.stopDrone(key, 0.2);
  }
}

// ---------------------------------------------------------------------------
// Cue definitions
// ---------------------------------------------------------------------------

const CUES = {
  swing: (a, v, p) => {
    a._noise(null, { dur: 0.16, gain: 0.1 * v, type: 'bandpass', freq: 1400 * p, sweep: 420 * p, q: 1.4 });
  },
  swingHeavy: (a, v, p) => {
    a._noise(null, { dur: 0.3, gain: 0.17 * v, type: 'bandpass', freq: 900 * p, sweep: 190 * p, q: 2 });
    a._tone(null, { dur: 0.24, freq: 160 * p, endFreq: 60, type: 'triangle', gain: 0.08 * v });
  },
  hit: (a, v, p) => {
    a._noise(null, { dur: 0.13, gain: 0.3 * v, type: 'lowpass', freq: 2600 * p, sweep: 260, q: 0.7 });
    a._tone(null, { dur: 0.12, freq: 190 * p, endFreq: 70, type: 'square', gain: 0.14 * v });
  },
  hitHeavy: (a, v, p) => {
    a._noise(null, { dur: 0.26, gain: 0.36 * v, type: 'lowpass', freq: 1800 * p, sweep: 120, q: 0.8 });
    a._tone(null, { dur: 0.3, freq: 120 * p, endFreq: 38, type: 'sine', gain: 0.3 * v });
  },
  blocked: (a, v, p) => {
    a._noise(null, { dur: 0.16, gain: 0.24 * v, type: 'bandpass', freq: 2600 * p, q: 6 });
    a._tone(null, { dur: 0.1, freq: 700 * p, endFreq: 380, type: 'square', gain: 0.06 * v });
  },
  parry: (a, v, p) => {
    a._tone(null, { dur: 0.5, freq: 1750 * p, endFreq: 900, type: 'triangle', gain: 0.22 * v, attack: 0.002 });
    a._tone(null, { dur: 0.35, freq: 2620 * p, endFreq: 1500, type: 'sine', gain: 0.12 * v });
    a._noise(null, { dur: 0.2, gain: 0.16 * v, type: 'highpass', freq: 3200, q: 1 });
  },
  guardBreak: (a, v, p) => {
    a._tone(null, { dur: 0.6, freq: 300 * p, endFreq: 60, type: 'sawtooth', gain: 0.2 * v });
    a._noise(null, { dur: 0.4, gain: 0.25 * v, type: 'lowpass', freq: 1200, sweep: 200 });
  },
  blackflash: (a, v, p) => {
    // Sub drop + inverted crackle + a ringing "space distortion" bell.
    a._tone(null, { dur: 1.1, freq: 300 * p, endFreq: 24, type: 'sine', gain: 0.5 * v, attack: 0.002 });
    a._tone(null, { dur: 0.5, freq: 90, endFreq: 1400, type: 'sawtooth', gain: 0.1 * v });
    a._noise(null, { dur: 0.5, gain: 0.4 * v, type: 'highpass', freq: 220, sweep: 6000, curve: 3 });
    for (let i = 0; i < 7; i++) {
      a._noise(null, { start: i * 0.022, dur: 0.05, gain: 0.16 * v, type: 'bandpass', freq: randRange(1800, 7000), q: 12 });
    }
    a._tone(null, { start: 0.04, dur: 1.6, freq: 58, type: 'triangle', gain: 0.16 * v });
  },
  cast: (a, v, p) => {
    a._tone(null, { dur: 0.4, freq: 180 * p, endFreq: 620 * p, type: 'sawtooth', gain: 0.1 * v });
    a._noise(null, { dur: 0.35, gain: 0.1 * v, type: 'bandpass', freq: 600, sweep: 2600, q: 3 });
  },
  blue: (a, v, p) => {
    a._tone(null, { dur: 0.9, freq: 1200 * p, endFreq: 140, type: 'sine', gain: 0.22 * v });
    a._noise(null, { dur: 0.8, gain: 0.2 * v, type: 'bandpass', freq: 2600, sweep: 300, q: 3 });
  },
  red: (a, v, p) => {
    a._tone(null, { dur: 0.8, freq: 110 * p, endFreq: 900, type: 'sawtooth', gain: 0.2 * v });
    a._noise(null, { dur: 0.6, gain: 0.34 * v, type: 'lowpass', freq: 400, sweep: 4200 });
  },
  purple: (a, v, p) => {
    a._tone(null, { dur: 1.6, freq: 40, endFreq: 260, type: 'sawtooth', gain: 0.34 * v });
    a._tone(null, { dur: 1.4, freq: 61, endFreq: 240, type: 'square', gain: 0.14 * v, detune: 22 });
    a._noise(null, { dur: 1.5, gain: 0.3 * v, type: 'lowpass', freq: 300, sweep: 5200, curve: 3 });
  },
  fire: (a, v, p) => {
    a._noise(null, { dur: 0.7, gain: 0.26 * v, type: 'lowpass', freq: 1500 * p, sweep: 300, q: 0.8 });
    a._tone(null, { dur: 0.5, freq: 70, endFreq: 40, type: 'triangle', gain: 0.14 * v });
  },
  slash: (a, v, p) => {
    a._noise(null, { dur: 0.22, gain: 0.24 * v, type: 'bandpass', freq: 3400 * p, sweep: 700, q: 3 });
  },
  summon: (a, v, p) => {
    a._tone(null, { dur: 0.7, freq: 60 * p, endFreq: 190, type: 'sawtooth', gain: 0.2 * v });
    a._noise(null, { dur: 0.6, gain: 0.16 * v, type: 'lowpass', freq: 500, sweep: 1600 });
  },
  domainOpen: (a, v, p) => {
    a._tone(null, { dur: 3.4, freq: 34, type: 'sine', gain: 0.5 * v, attack: 0.4 });
    a._tone(null, { dur: 2.8, freq: 51, endFreq: 44, type: 'sawtooth', gain: 0.14 * v });
    a._noise(null, { dur: 2.6, gain: 0.24 * v, type: 'lowpass', freq: 140, sweep: 3800, curve: 3 });
    a._tone(null, { start: 0.5, dur: 2.4, freq: 880 * p, endFreq: 430, type: 'triangle', gain: 0.08 * v });
  },
  domainClash: (a, v, p) => {
    a._tone(null, { dur: 1.3, freq: 420, endFreq: 90, type: 'square', gain: 0.2 * v });
    a._noise(null, { dur: 1.2, gain: 0.3 * v, type: 'bandpass', freq: 900, sweep: 220, q: 1.2 });
  },
  domainBreak: (a, v, p) => {
    a._noise(null, { dur: 1.4, gain: 0.42 * v, type: 'highpass', freq: 500, sweep: 6000, curve: 3 });
    a._tone(null, { dur: 1.4, freq: 220, endFreq: 28, type: 'sawtooth', gain: 0.24 * v });
  },
  simpleDomain: (a, v, p) => {
    a._tone(null, { dur: 0.6, freq: 520, endFreq: 320, type: 'triangle', gain: 0.14 * v });
    a._noise(null, { dur: 0.5, gain: 0.1 * v, type: 'bandpass', freq: 1800, q: 8 });
  },
  rct: (a, v, p) => {
    a._tone(null, { dur: 0.8, freq: 520 * p, endFreq: 900, type: 'sine', gain: 0.12 * v, attack: 0.1 });
    a._tone(null, { dur: 0.8, freq: 784 * p, endFreq: 1320, type: 'sine', gain: 0.07 * v, attack: 0.15 });
  },
  vow: (a, v, p) => {
    a._tone(null, { dur: 1.2, freq: 146, type: 'sine', gain: 0.2 * v, attack: 0.02 });
    a._tone(null, { dur: 1.2, freq: 220, type: 'sine', gain: 0.12 * v, attack: 0.03 });
    a._noise(null, { dur: 0.8, gain: 0.1 * v, type: 'bandpass', freq: 2200, q: 9 });
  },
  dash: (a, v, p) => {
    a._noise(null, { dur: 0.2, gain: 0.12 * v, type: 'bandpass', freq: 900 * p, sweep: 2400, q: 1.6 });
  },
  land: (a, v, p) => {
    a._noise(null, { dur: 0.2, gain: 0.18 * v, type: 'lowpass', freq: 500, sweep: 90 });
  },
  death: (a, v, p) => {
    a._tone(null, { dur: 1.6, freq: 180, endFreq: 30, type: 'sawtooth', gain: 0.24 * v });
    a._noise(null, { dur: 1.4, gain: 0.2 * v, type: 'lowpass', freq: 900, sweep: 60 });
  },
  ui: (a, v, p) => {
    a._tone(null, { dur: 0.09, freq: 900 * p, type: 'square', gain: 0.05 * v });
  },
  uiConfirm: (a, v, p) => {
    a._tone(null, { dur: 0.14, freq: 660 * p, endFreq: 1180, type: 'triangle', gain: 0.09 * v });
  },
  flashTick: (a, v, p) => {
    a._tone(null, { dur: 0.045, freq: 2400 * p, type: 'square', gain: 0.05 * v });
  },
  warn: (a, v, p) => {
    a._tone(null, { dur: 0.4, freq: 320, endFreq: 180, type: 'square', gain: 0.1 * v });
  },
};

export const audio = new AudioEngine();
