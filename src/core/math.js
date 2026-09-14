// Math / vector / random helpers shared by simulation and rendering.
// Everything here is DOM-free so the simulation can run headless.

export const TAU = Math.PI * 2;
export const PI = Math.PI;
export const DEG = Math.PI / 180;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp01(invLerp(a, b, v)));
export const sign = Math.sign;

/** Frame-rate independent exponential approach. */
export const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
/** Linear approach with a fixed step. */
export const approach = (a, b, step) => (a < b ? Math.min(a + step, b) : Math.max(a - step, b));

export const smoothstep = (t) => {
  t = clamp01(t);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (t) => {
  t = clamp01(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeInCubic = (t) => Math.pow(clamp01(t), 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuint = (t) => 1 - Math.pow(1 - clamp01(t), 5);
export const easeOutBack = (t) => {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeOutElastic = (t) => {
  const c4 = TAU / 3;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
export const pulse = (t, freq = 1) => 0.5 + 0.5 * Math.sin(t * TAU * freq);

// ---------------------------------------------------------------------------
// Angles
// ---------------------------------------------------------------------------

/** Wrap to (-PI, PI]. */
export function wrapAngle(a) {
  a = (a + PI) % TAU;
  if (a < 0) a += TAU;
  return a - PI;
}
export const angleDiff = (a, b) => wrapAngle(b - a);
export function angleLerp(a, b, t) {
  return a + wrapAngle(b - a) * t;
}
export function angleDamp(a, b, rate, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
}

// ---------------------------------------------------------------------------
// Vectors (plain {x, y} objects — cheap and JSON friendly)
// ---------------------------------------------------------------------------

export const vec = (x = 0, y = 0) => ({ x, y });
export const vclone = (v) => ({ x: v.x, y: v.y });
export const vset = (o, x, y) => { o.x = x; o.y = y; return o; };
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s });
export const vlen = (a) => Math.hypot(a.x, a.y);
export const vlen2 = (a) => a.x * a.x + a.y * a.y;
export const vdist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
export const vdist2 = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  return dx * dx + dy * dy;
};
export const vangle = (a) => Math.atan2(a.y, a.x);
export const vfromAngle = (a, len = 1) => ({ x: Math.cos(a) * len, y: Math.sin(a) * len });
export const vdot = (a, b) => a.x * b.x + a.y * b.y;
export const vcross = (a, b) => a.x * b.y - a.y * b.x;
export function vnorm(a, len = 1) {
  const l = Math.hypot(a.x, a.y);
  if (l < 1e-9) return { x: 0, y: 0 };
  return { x: (a.x / l) * len, y: (a.y / l) * len };
}
export function vclampLen(a, max) {
  const l = Math.hypot(a.x, a.y);
  if (l <= max || l < 1e-9) return { x: a.x, y: a.y };
  return { x: (a.x / l) * max, y: (a.y / l) * max };
}
export const vlerp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const vrot = (a, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};

// ---------------------------------------------------------------------------
// Random
// ---------------------------------------------------------------------------

/** Deterministic 32-bit PRNG (mulberry32) so fights can be replayed / tested. */
export class Rng {
  constructor(seed = 0x2f6e2b1) {
    this.seed = seed >>> 0;
  }
  next() {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  angle() { return this.next() * TAU; }
  /** Uniform point inside a unit disc. */
  inDisc(radius = 1) {
    const a = this.angle();
    const r = Math.sqrt(this.next()) * radius;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }
  gaussian(mean = 0, sd = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.next();
    while (v === 0) v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  }
}

/** Shared non-deterministic-ish RNG for cosmetic effects. */
export const rng = new Rng((Date.now() ^ 0x9e3779b9) >>> 0);
export const rand = () => rng.next();
export const randRange = (a, b) => rng.range(a, b);
export const randInt = (a, b) => rng.int(a, b);
export const chance = (p) => rng.chance(p);
export const pick = (arr) => rng.pick(arr);

// ---------------------------------------------------------------------------
// Geometry helpers used by hit detection
// ---------------------------------------------------------------------------

/** Is target inside a cone centred on `origin` facing `facing`? */
export function inCone(origin, facing, range, halfArc, target, targetRadius = 0) {
  const dx = target.x - origin.x, dy = target.y - origin.y;
  const d = Math.hypot(dx, dy);
  if (d > range + targetRadius) return false;
  if (d < 1e-4) return true;
  const a = Math.atan2(dy, dx);
  // Widen the arc for close targets so short-range swings still connect.
  const widen = d > 1e-3 ? Math.asin(Math.min(1, targetRadius / Math.max(d, targetRadius))) : PI;
  return Math.abs(wrapAngle(a - facing)) <= halfArc + widen;
}

/** Distance from point p to segment ab. */
export function distToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y;
  const apx = p.x - a.x, apy = p.y - a.y;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1e-9 ? 0 : clamp01((apx * abx + apy * aby) / len2);
  const cx = a.x + abx * t, cy = a.y + aby * t;
  return Math.hypot(p.x - cx, p.y - cy);
}

export function circlesOverlap(a, ar, b, br) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const r = ar + br;
  return dx * dx + dy * dy <= r * r;
}

/** Push `a` out of `b`; returns the applied separation vector. */
export function separate(a, ar, b, br, ratio = 0.5) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  const r = ar + br;
  if (d >= r) return { x: 0, y: 0 };
  if (d < 1e-5) { dx = 1; dy = 0; d = 1; }
  const push = (r - d) * ratio;
  return { x: (-dx / d) * push, y: (-dy / d) * push };
}

/** Value noise in 1D — cheap wobble for auras, flames, blood ribbons. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    let t = (n * 374761393 + seed * 668265263) >>> 0;
    t = (t ^ (t >>> 13)) >>> 0;
    t = Math.imul(t, 1274126177) >>> 0;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
  return lerp(h(i), h(i + 1), smoothstep(f));
}

export function fbm1(x, octaves = 3, seed = 0) {
  let sum = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    sum += noise1(x * freq, seed + i * 97) * amp;
    freq *= 2;
    amp *= 0.5;
  }
  return sum;
}

export const fmt = (n, digits = 0) => n.toFixed(digits);
export const pct = (n) => Math.round(n * 100) + '%';
