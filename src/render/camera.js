// Camera: 3/4 perspective projection, follow with lead, combat framing,
// trauma-based shake and zoom punches.

import { clamp, clamp01, lerp, damp, vdist, vlen, rand, randRange, TAU } from '../core/math.js';

export const PPM = 41;        // pixels per metre at zoom 1
export const FLATTEN = 0.68;  // y-squash that sells the 3/4 view
export const HEIGHT = 0.92;   // how much world-z lifts on screen

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.x = 0;
    this.y = 0;
    this.zoom = 1;
    this.targetZoom = 1;
    this.trauma = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.rot = 0;
    this.lead = { x: 0, y: 0 };
    this.punch = 0;
    this.time = 0;
    this.width = canvas ? canvas.width : 1280;
    this.height = canvas ? canvas.height : 720;
  }

  resize(w, h) {
    this.width = w;
    this.height = h;
  }

  snapTo(x, y) {
    this.x = x;
    this.y = y;
  }

  addTrauma(amount) {
    this.trauma = clamp01(this.trauma + amount / 26);
  }

  punchZoom(amount) {
    this.punch = Math.max(this.punch, amount);
  }

  update(dt, world, focus, input) {
    this.time += dt;

    // Follow the player, biased toward where they are aiming / moving.
    if (focus) {
      const leadX = Math.cos(focus.aim) * 2.6 + focus.vel.x * 0.22;
      const leadY = Math.sin(focus.aim) * 2.6 + focus.vel.y * 0.22;
      this.lead.x = damp(this.lead.x, leadX, 3.5, dt);
      this.lead.y = damp(this.lead.y, leadY, 3.5, dt);

      let tx = focus.pos.x + this.lead.x;
      let ty = focus.pos.y + this.lead.y;

      // If a single enemy is close, frame both fighters like a duel camera.
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

      // Zoom: pull out when moving fast or when a domain is open, push in for
      // close-quarters exchanges.
      let z = 1;
      const speed = vlen(focus.vel);
      z -= clamp(speed / 60, 0, 0.14);
      if (nearest && nd < 6) z += 0.1 * (1 - nd / 6);
      if (world.domains.length) z -= 0.1;
      if (world.mode === 'culling') z -= 0.06;
      if (world.arenaRadius > 36) z -= 0.08;
      this.targetZoom = clamp(z, 0.7, 1.3);
    }

    this.zoom = damp(this.zoom, this.targetZoom + this.punch, 6, dt);
    this.punch = damp(this.punch, 0, 9, dt);

    // Trauma decays quadratically — shake feels snappier than a linear falloff.
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const s = this.trauma * this.trauma;
    const t = this.time * 34;
    this.shakeX = (Math.sin(t * 1.7) + Math.sin(t * 2.9 + 1.3)) * 0.5 * s * 46;
    this.shakeY = (Math.cos(t * 1.9 + 0.7) + Math.sin(t * 3.3)) * 0.5 * s * 46;
    this.rot = Math.sin(t * 1.1) * s * 0.022;
  }

  get scale() { return PPM * this.zoom; }

  /** World (metres) -> screen (pixels). */
  project(wx, wy, wz = 0, out) {
    const s = this.scale;
    const sx = this.width * 0.5 + (wx - this.x) * s + this.shakeX;
    const sy = this.height * 0.52 + (wy - this.y) * s * FLATTEN - wz * s * HEIGHT + this.shakeY;
    if (out) { out.x = sx; out.y = sy; return out; }
    return { x: sx, y: sy };
  }

  /** Screen -> world on the ground plane. */
  unproject(sx, sy) {
    const s = this.scale;
    return {
      x: (sx - this.width * 0.5 - this.shakeX) / s + this.x,
      y: (sy - this.height * 0.52 - this.shakeY) / (s * FLATTEN) + this.y,
    };
  }

  /** Rough visibility test with a generous margin. */
  visible(wx, wy, pad = 6) {
    const s = this.scale;
    const dx = Math.abs(wx - this.x) * s;
    const dy = Math.abs(wy - this.y) * s * FLATTEN;
    return dx < this.width * 0.5 + pad * s && dy < this.height * 0.5 + pad * s;
  }

  applyTransform(ctx) {
    if (this.rot) {
      ctx.translate(this.width / 2, this.height / 2);
      ctx.rotate(this.rot);
      ctx.translate(-this.width / 2, -this.height / 2);
    }
  }
}
