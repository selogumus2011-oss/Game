// Fixed-timestep game loop with accumulator, spiral-of-death protection and
// a global time-scale used for hitstop / slow motion.

export const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;

export class Loop {
  constructor({ update, render, fixedDt = FIXED_DT }) {
    this.update = update;
    this.render = render;
    this.fixedDt = fixedDt;
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.frame = 0;
    this.fps = 60;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this.elapsed = 0;
    this._raf = null;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick(now) {
    if (!this.running) return;
    this._raf = requestAnimationFrame(this._tick);
    let real = (now - this.last) / 1000;
    this.last = now;
    if (!isFinite(real) || real < 0) real = 0;
    real = Math.min(real, 0.25); // tab-out guard

    this._fpsAcc += real;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.4) {
      this.fps = this._fpsFrames / this._fpsAcc;
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.acc += real;
    let steps = 0;
    while (this.acc >= this.fixedDt && steps < MAX_STEPS) {
      this.update(this.fixedDt, real);
      this.acc -= this.fixedDt;
      steps++;
      this.frame++;
      this.elapsed += this.fixedDt;
    }
    if (steps >= MAX_STEPS) this.acc = 0;
    this.render(real, this.acc / this.fixedDt);
  }
}
