// Software 3D core: vectors, 4x4 matrices, a perspective camera and a
// depth-sorted polygon rasteriser that draws through canvas 2D.
//
// Why not WebGL: the whole game ships as plain modules with no build step and
// no external dependencies, and a flat-shaded painter's-algorithm renderer is
// exactly the look this game wants — hard cel shading with ink outlines.
//
// World axes match the simulation: x/y is the ground plane, +z is up.

import { clamp, clamp01, lerp, damp, vdist, vlen, TAU, PI } from '../core/math.js';

// ---------------------------------------------------------------------------
// Vectors
// ---------------------------------------------------------------------------

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const v3add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const v3sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const v3scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const v3dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3len = (a) => Math.hypot(a.x, a.y, a.z);
export function v3cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
export function v3norm(a) {
  const l = Math.hypot(a.x, a.y, a.z) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
export const v3lerp = (a, b, t) => ({
  x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
});

// ---------------------------------------------------------------------------
// 4x4 matrices, row-major, applied as m * v
// ---------------------------------------------------------------------------

export const matIdentity = () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function matMul(a, b, out = new Float32Array(16)) {
  for (let r = 0; r < 4; r++) {
    const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] = a0 * b[c] + a1 * b[4 + c] + a2 * b[8 + c] + a3 * b[12 + c];
    }
  }
  return out;
}

/** Translation · Rz · Ry · Rx · Scale, the order every model here uses. */
export function matCompose(px, py, pz, rx, ry, rz, sx = 1, sy = sx, sz = sx, out = new Float32Array(16)) {
  const cx = Math.cos(rx), sxr = Math.sin(rx);
  const cy = Math.cos(ry), syr = Math.sin(ry);
  const cz = Math.cos(rz), szr = Math.sin(rz);

  // R = Rz * Ry * Rx
  const m00 = cz * cy;
  const m01 = cz * syr * sxr - szr * cx;
  const m02 = cz * syr * cx + szr * sxr;
  const m10 = szr * cy;
  const m11 = szr * syr * sxr + cz * cx;
  const m12 = szr * syr * cx - cz * sxr;
  const m20 = -syr;
  const m21 = cy * sxr;
  const m22 = cy * cx;

  out[0] = m00 * sx; out[1] = m01 * sy; out[2] = m02 * sz; out[3] = px;
  out[4] = m10 * sx; out[5] = m11 * sy; out[6] = m12 * sz; out[7] = py;
  out[8] = m20 * sx; out[9] = m21 * sy; out[10] = m22 * sz; out[11] = pz;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

export function matLookAt(eye, target, up, out = new Float32Array(16)) {
  const f = v3norm(v3sub(target, eye));       // forward
  const s = v3norm(v3cross(f, up));           // right
  const u = v3cross(s, f);                    // true up
  out[0] = s.x; out[1] = s.y; out[2] = s.z; out[3] = -v3dot(s, eye);
  out[4] = u.x; out[5] = u.y; out[6] = u.z; out[7] = -v3dot(u, eye);
  out[8] = -f.x; out[9] = -f.y; out[10] = -f.z; out[11] = v3dot(f, eye);
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

export function transformPoint(m, x, y, z, out) {
  out.x = m[0] * x + m[1] * y + m[2] * z + m[3];
  out.y = m[4] * x + m[5] * y + m[6] * z + m[7];
  out.z = m[8] * x + m[9] * y + m[10] * z + m[11];
  return out;
}

export function transformDir(m, x, y, z, out) {
  out.x = m[0] * x + m[1] * y + m[2] * z;
  out.y = m[4] * x + m[5] * y + m[6] * z;
  out.z = m[8] * x + m[9] * y + m[10] * z;
  return out;
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

export class Camera3 {
  constructor() {
    this.pos = v3(0, -14, 12);
    this.target = v3(0, 0, 1);
    this.up = v3(0, 0, 1);
    this.fov = 56 * (PI / 180);
    this.near = 0.35;
    this.width = 1280;
    this.height = 720;
    this.view = matIdentity();
    this.focusDist = 18;

    // Presentation state shared with the 2D HUD layer.
    this.trauma = 0;
    this.shake = v3(0, 0, 0);
    this.roll = 0;
    this.punch = 0;
    this.time = 0;

    // Follow rig. The yaw is held fixed so that world axes keep their screen
    // meaning and WASD does not drift — this is a fighting game, not a
    // free-look shooter. Only a domain expansion is allowed to swing it, and
    // only while the caster is locked in place anyway.
    this.baseYaw = -PI / 2;     // looking along +y
    this.yaw = this.baseYaw;
    this.pitch = 0.64;          // radians above the horizon
    this.basePitch = 0.64;
    this.dist = 10.2;
    this.baseDist = 10.2;
    this.zoom = 1;
    this.targetZoom = 1;
    this.lookAt = v3(0, 0, 1.1);
    this.lead = v3(0, 0, 0);
    this.x = 0;                 // ground-plane focus, mirrors the 2D camera
    this.y = 0;
    this.cine = 0;              // 0..1 cinematic sweep weight
    this.cineYaw = 0;
    // A cutscene can take the rig away entirely: {yaw, pitch, dist, lookAt,
    // weight}, blended in by weight so handing control back is a move rather
    // than a snap. Cleared every frame by whoever set it.
    this.override = null;
    this.rot = 0;               // screen roll, read by the 2D post stack

    // --- First person ---
    // A weight rather than a flag, so the switch is a move the eye can follow
    // rather than a teleport. Everything downstream that needs to know whether
    // the player's own body is in shot reads `fpv`.
    this.fpv = 0;
    this.fpvTarget = 0;
    this.fpvYaw = this.baseYaw;
    this.fpvPitch = 0.02;
    // Distance from the eye to the notional look point. The orbit rig places
    // the eye at lookAt - dir * dist, so putting lookAt this far down the
    // sightline and dist at the same value lands the eye exactly on the head.
    this.fpvReach = 3.2;
    this.eyeHeight = 1.56;
  }

  /** Turn first person on or off. The transition is animated by update(). */
  setFirstPerson(on) { this.fpvTarget = on ? 1 : 0; }
  get firstPerson() { return this.fpvTarget > 0.5; }

  /** Feed a look delta in radians, from a mouse, a stick or a drag. */
  look(dYaw, dPitch) {
    this.fpvYaw = this.fpvYaw + dYaw;
    while (this.fpvYaw > PI) this.fpvYaw -= TAU;
    while (this.fpvYaw < -PI) this.fpvYaw += TAU;
    // Short of straight up and straight down: a fighting game does not need
    // either, and clamping well inside them keeps the horizon readable.
    this.fpvPitch = clamp(this.fpvPitch + dPitch, -0.95, 0.85);
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
  }

  snapTo(x, y) {
    this.x = x;
    this.y = y;
    this.lookAt.x = x;
    this.lookAt.y = y;
    this.lead.x = 0;
    this.lead.y = 0;
  }

  /** Swing the camera for a beat — used when a domain unfolds. */
  cinematic(strength = 1, dir = 1) {
    this.cine = Math.max(this.cine, clamp01(strength));
    this.cineYaw = 0.5 * dir;
  }

  addTrauma(a) { this.trauma = clamp01(this.trauma + a / 26); }
  punchZoom(a) { this.punch = Math.max(this.punch, a); }

  /** Rebuild the view matrix from the orbit parameters. */
  commit() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye = v3(
      this.lookAt.x - Math.cos(this.yaw) * cp * this.dist + this.shake.x,
      this.lookAt.y - Math.sin(this.yaw) * cp * this.dist + this.shake.y,
      this.lookAt.z + sp * this.dist + this.shake.z,
    );
    this.pos = eye;
    this.target = { x: this.lookAt.x + this.shake.x, y: this.lookAt.y + this.shake.y, z: this.lookAt.z };
    matLookAt(this.pos, this.target, this.up, this.view);
    this.focusDist = Math.max(1, v3len(v3sub(this.target, this.pos)));
    this.f = (this.height * 0.5) / Math.tan(this.fov * 0.5);
  }

  /** Pixels per world metre at the focus plane — the HUD reads this. */
  get scale() { return (this.f || 600) / this.focusDist; }

  /** World -> screen. Returns {x, y, d} where d is view depth (>0 in front). */
  project(wx, wy, wz = 0, out = { x: 0, y: 0, d: 0 }) {
    const m = this.view;
    const vx = m[0] * wx + m[1] * wy + m[2] * wz + m[3];
    const vy = m[4] * wx + m[5] * wy + m[6] * wz + m[7];
    const vz = m[8] * wx + m[9] * wy + m[10] * wz + m[11];
    const d = -vz;                       // view looks down -z
    const inv = this.f / Math.max(this.near, d);
    out.x = this.width * 0.5 + vx * inv;
    out.y = this.height * 0.5 - vy * inv;
    out.d = d;
    return out;
  }

  /** Screen -> the point on the ground plane (z = 0) under that pixel. */
  unproject(sx, sy, planeZ = 0) {
    const m = this.view;
    // Inverse of the rotation part (orthonormal) applied to the ray direction.
    const ndx = (sx - this.width * 0.5) / this.f;
    const ndy = -(sy - this.height * 0.5) / this.f;
    // Ray in view space: (ndx, ndy, -1) -> world.
    const rx = m[0] * ndx + m[4] * ndy + m[8] * -1;
    const ry = m[1] * ndx + m[5] * ndy + m[9] * -1;
    const rz = m[2] * ndx + m[6] * ndy + m[10] * -1;
    // A ray that is nearly parallel to the ground meets it at infinity, so cap
    // the distance rather than handing back a coordinate in the millions.
    const denom = rz;
    if (Math.abs(denom) < 1e-5) return { x: this.x, y: this.y };
    const t = clamp((planeZ - this.pos.z) / denom, 0, 140);
    return { x: this.pos.x + rx * t, y: this.pos.y + ry * t };
  }

  /** Cheap sphere cull against the view frustum. */
  visible(wx, wy, wz = 0, radius = 2) {
    const m = this.view;
    const vz = m[8] * wx + m[9] * wy + m[10] * wz + m[11];
    const d = -vz;
    if (d < -radius) return false;
    if (d > 120) return false;
    const vx = m[0] * wx + m[1] * wy + m[2] * wz + m[3];
    const vy = m[4] * wx + m[5] * wy + m[6] * wz + m[7];
    const lim = Math.max(d, 1) * Math.tan(this.fov * 0.5) * 1.45 + radius;
    return Math.abs(vy) < lim && Math.abs(vx) < lim * (this.width / this.height) + radius;
  }

  /**
   * Follow rig. Signature matches the 2D camera so main.js drives either one.
   */
  update(dt, world, focus, input) {
    this.time += dt;

    if (focus && world) {
      // Lead the framing toward where they are aiming and moving.
      const leadX = Math.cos(focus.aim) * 2.4 + focus.vel.x * 0.2;
      const leadY = Math.sin(focus.aim) * 2.4 + focus.vel.y * 0.2;
      this.lead.x = damp(this.lead.x, leadX, 3.5, dt);
      this.lead.y = damp(this.lead.y, leadY, 3.5, dt);

      let tx = focus.pos.x + this.lead.x;
      let ty = focus.pos.y + this.lead.y;

      // Frame both fighters when a single enemy is close — duel framing.
      let nearest = null, nd = 16;
      for (const f of world.fighters) {
        if (f.dead || f.team === focus.team) continue;
        const d = vdist(f.pos, focus.pos);
        if (d < nd) { nd = d; nearest = f; }
      }
      if (nearest) {
        const w = clamp01((16 - nd) / 12) * 0.35;
        tx = lerp(tx, (focus.pos.x + nearest.pos.x) / 2, w);
        ty = lerp(ty, (focus.pos.y + nearest.pos.y) / 2, w);
      }

      this.x = damp(this.x, tx, 7, dt);
      this.y = damp(this.y, ty, 7, dt);

      let z = 1;
      z -= clamp(vlen(focus.vel) / 60, 0, 0.14);
      if (nearest && nd < 6) z += 0.1 * (1 - nd / 6);
      if (world.domains.length) z -= 0.12;
      if (world.mode === 'culling') z -= 0.06;
      if (world.arenaRadius > 36) z -= 0.08;
      this.targetZoom = clamp(z, 0.7, 1.3);

      // A domain unfolding earns a camera move; nothing else does.
      const casting = focus.state === 'domainCast';
      const fresh = world.domains.some((d) => d.t < 0.75);
      if (casting || fresh) this.cinematic(casting ? 1 : 0.65, focus.id % 2 ? 1 : -1);
    }

    this.zoom = damp(this.zoom, this.targetZoom + this.punch, 6, dt);
    this.punch = damp(this.punch, 0, 9, dt);
    this.cine = Math.max(0, this.cine - dt * 0.9);

    const cineK = this.cine * this.cine;
    this.yaw = this.baseYaw + this.cineYaw * cineK;
    this.pitch = this.basePitch - 0.3 * cineK;
    this.dist = this.baseDist / clamp(this.zoom, 0.55, 1.6) * (1 + cineK * 0.1);

    this.lookAt.x = this.x;
    this.lookAt.y = this.y;
    this.lookAt.z = 1.1 + cineK * 0.5;

    // First person. The orbit rig already places the eye at
    // lookAt - dir * dist, so rather than special-casing commit() we put the
    // look point one reach down the sightline from the head: the subtraction
    // then lands the eye on the head itself, and every other consumer of the
    // camera (projection, culling, the HUD's metres-per-pixel) keeps working
    // untouched.
    this.fpv = damp(this.fpv, this.fpvTarget, 9, dt);
    if (this.fpv > 0.001 && focus) {
      const cp = Math.cos(this.fpvPitch), sp = Math.sin(this.fpvPitch);
      const R = this.fpvReach;
      // Sit the eye just ahead of the head so the face never clips the lens,
      // and ride the body's bob so running has weight.
      const bob = Math.sin(this.time * 11) * clamp(vlen(focus.vel) / 9, 0, 1) * 0.055;
      const ex = focus.pos.x + Math.cos(this.fpvYaw) * 0.16;
      const ey = focus.pos.y + Math.sin(this.fpvYaw) * 0.16;
      const ez = focus.z + this.eyeHeight * (focus.scale || 1) + bob;
      const w = this.fpv;
      let d = this.fpvYaw - this.yaw;
      while (d > PI) d -= TAU;
      while (d < -PI) d += TAU;
      this.yaw += d * w;
      this.pitch = lerp(this.pitch, this.fpvPitch, w);
      this.dist = lerp(this.dist, R, w);
      this.lookAt.x = lerp(this.lookAt.x, ex + Math.cos(this.fpvYaw) * cp * R, w);
      this.lookAt.y = lerp(this.lookAt.y, ey + Math.sin(this.fpvYaw) * cp * R, w);
      this.lookAt.z = lerp(this.lookAt.z, ez - sp * R, w);
    }

    const o = this.override;
    if (o) {
      const w = clamp01(o.weight);
      // Blend the shortest way round so a sweep past the seam does not spin
      // the whole camera the long way home.
      let d = o.yaw - this.yaw;
      while (d > PI) d -= TAU;
      while (d < -PI) d += TAU;
      this.yaw += d * w;
      this.pitch = lerp(this.pitch, o.pitch, w);
      this.dist = lerp(this.dist, o.dist, w);
      this.lookAt.x = lerp(this.lookAt.x, o.lookAt.x, w);
      this.lookAt.y = lerp(this.lookAt.y, o.lookAt.y, w);
      this.lookAt.z = lerp(this.lookAt.z, o.lookAt.z, w);
      this.override = null;
    }

    // Trauma decays quadratically — shake feels snappier than a linear falloff.
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const s = this.trauma * this.trauma;
    const t = this.time * 32;
    this.shake.x = (Math.sin(t * 1.7) + Math.sin(t * 2.9 + 1.3)) * 0.5 * s * 1.1;
    this.shake.y = (Math.cos(t * 1.9 + 0.7) + Math.sin(t * 3.3)) * 0.5 * s * 1.1;
    this.shake.z = Math.sin(t * 2.3) * s * 0.7;
    this.roll = Math.sin(t * 1.1) * s * 0.03;
    this.rot = this.roll;
    this.commit();
  }
}

// ---------------------------------------------------------------------------
// Lighting
// ---------------------------------------------------------------------------

/**
 * Cel shading, animation-style: a hard terminator and four bands, not a ramp.
 *
 * Cel animation paints a surface in two or three flat tones with a sharp line
 * between them, and the shadow is not merely the base colour turned down — it
 * is cooled and slightly desaturated, which is what makes painted shadow read
 * as shadow rather than as dimness. The bands below do exactly that, and the
 * result is cached because a frame asks for this thousands of times.
 */
const colorCache = new Map();

// [multiplier, red tint, green tint, blue tint] per band, darkest first.
const BANDS = [
  [0.60, 0.88, 0.93, 1.16],   // core shadow: cool, and still readable
  [0.80, 0.94, 0.97, 1.09],   // shadow
  [1.00, 1.00, 1.00, 1.00],   // base — the authored colour, flat
  [1.22, 1.05, 1.02, 0.96],   // lit: warm
  [1.52, 1.10, 1.06, 0.97],   // rim / specular
];

/** Which band a lighting value falls into. The first cut is the terminator. */
function bandOf(light) {
  if (light < 0.46) return 0;
  if (light < 0.72) return 1;
  if (light < 0.98) return 2;
  if (light < 1.22) return 3;
  return 4;
}

export function shadeColor(rgb, light, tintR = 1, tintG = 1, tintB = 1) {
  const q = bandOf(light);
  const key = ((rgb[0] << 16) | (rgb[1] << 8) | rgb[2]) * 4096 +
    q * 64 + (Math.round(tintR * 3) << 4) + (Math.round(tintG * 3) << 2) + Math.round(tintB * 3);
  let s = colorCache.get(key);
  if (s === undefined) {
    const [l, br, bg, bb] = BANDS[q];
    const r = Math.min(255, Math.round(rgb[0] * l * br * tintR));
    const g = Math.min(255, Math.round(rgb[1] * l * bg * tintG));
    const b = Math.min(255, Math.round(rgb[2] * l * bb * tintB));
    s = `rgb(${r},${g},${b})`;
    colorCache.set(key, s);
    if (colorCache.size > 24000) colorCache.clear();
  }
  return s;
}

export function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex;
  if (!hex) return [200, 200, 200];
  const h = hex.replace('#', '');
  if (h.length === 3) return h.split('').map((c) => parseInt(c + c, 16));
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// ---------------------------------------------------------------------------
// Draw list — every polygon, sprite and line in the frame, depth sorted once
// ---------------------------------------------------------------------------

const KIND_POLY = 0;
const KIND_SPRITE = 1;
const KIND_LINE = 2;
const KIND_TEXT = 3;

export class DrawList {
  constructor() {
    this.items = [];
    this.n = 0;
  }

  reset() { this.n = 0; }

  _next() {
    let it = this.items[this.n];
    if (!it) {
      it = { kind: 0, z: 0, pts: new Float32Array(10), count: 0, style: '', alpha: 1, add: false,
             sprite: null, w: 0, h: 0, rot: 0, text: '', font: '', lw: 1 };
      this.items.push(it);
    }
    this.n++;
    return it;
  }

  poly(z, xs, count, style, add = false, alpha = 1) {
    const it = this._next();
    it.kind = KIND_POLY;
    it.z = z;
    it.count = count;
    for (let i = 0; i < count * 2; i++) it.pts[i] = xs[i];
    it.style = style;
    it.add = add;
    it.alpha = alpha;
    return it;
  }

  sprite(z, x, y, w, h, sprite, alpha, add = true, rot = 0) {
    const it = this._next();
    it.kind = KIND_SPRITE;
    it.z = z;
    it.pts[0] = x;
    it.pts[1] = y;
    it.w = w;
    it.h = h;
    it.sprite = sprite;
    it.alpha = alpha;
    it.add = add;
    it.rot = rot;
    return it;
  }

  line(z, x1, y1, x2, y2, style, lw, add = false, alpha = 1) {
    const it = this._next();
    it.kind = KIND_LINE;
    it.z = z;
    it.pts[0] = x1; it.pts[1] = y1; it.pts[2] = x2; it.pts[3] = y2;
    it.style = style;
    it.lw = lw;
    it.add = add;
    it.alpha = alpha;
    return it;
  }

  text(z, x, y, str, style, font, alpha = 1, add = false) {
    const it = this._next();
    it.kind = KIND_TEXT;
    it.z = z;
    it.pts[0] = x; it.pts[1] = y;
    it.text = str;
    it.style = style;
    it.font = font;
    it.alpha = alpha;
    it.add = add;
    return it;
  }

  /** Painter's algorithm: far to near. */
  flush(ctx) {
    const items = this.items;
    const n = this.n;
    const live = items.slice(0, n);
    live.sort((a, b) => b.z - a.z);

    let add = false;
    let alpha = 1;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const it = live[i];
      if (it.add !== add) {
        add = it.add;
        ctx.globalCompositeOperation = add ? 'lighter' : 'source-over';
      }
      if (it.alpha !== alpha) {
        alpha = it.alpha;
        ctx.globalAlpha = alpha;
      }
      switch (it.kind) {
        case KIND_POLY: {
          const p = it.pts;
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          for (let k = 1; k < it.count; k++) ctx.lineTo(p[k * 2], p[k * 2 + 1]);
          ctx.closePath();
          ctx.fillStyle = it.style;
          ctx.fill();
          break;
        }
        case KIND_SPRITE: {
          const p = it.pts;
          if (it.rot) {
            ctx.save();
            ctx.translate(p[0], p[1]);
            ctx.rotate(it.rot);
            ctx.drawImage(it.sprite, -it.w * 0.5, -it.h * 0.5, it.w, it.h);
            ctx.restore();
          } else {
            ctx.drawImage(it.sprite, p[0] - it.w * 0.5, p[1] - it.h * 0.5, it.w, it.h);
          }
          break;
        }
        case KIND_LINE: {
          const p = it.pts;
          ctx.strokeStyle = it.style;
          ctx.lineWidth = it.lw;
          ctx.beginPath();
          ctx.moveTo(p[0], p[1]);
          ctx.lineTo(p[2], p[3]);
          ctx.stroke();
          break;
        }
        case KIND_TEXT: {
          ctx.font = it.font;
          ctx.fillStyle = it.style;
          ctx.textAlign = 'center';
          ctx.fillText(it.text, it.pts[0], it.pts[1]);
          break;
        }
        default: break;
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }
}
