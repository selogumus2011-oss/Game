// Domain visuals.
//
// A domain is the biggest thing that happens in a fight, so it gets a staged
// presentation rather than a single fade:
//
//   1. SLAM      a blinding core, then a ground ring racing outward
//   2. UNFOLD    the barrier walls rise as ribs and knit into a surface
//   3. REVEAL    the interior treatment wipes outward from the centre
//   4. HELD      per-domain floor, dome decoration and screen overlay,
//                plus cracks where it has been struck and a clash seam
//                where it is pressing against a rival barrier
//   5. COLLAPSE  handled by effects.js from the close/shatter events
//
// Every domain supplies its own floor, dome and overlay, because "sure-hit
// barrier" means something different in each of them.

import {
  clamp, clamp01, lerp, TAU, PI, rand, randRange, noise1, fbm1,
  easeOutQuint, easeOutCubic, easeOutBack, vdist,
} from '../core/math.js';
import { hexA } from './characters.js';
import { FLATTEN } from './camera.js';

let Q = 1; // quality scalar, driven by the renderer's adaptive tier
export function setDomainQuality(q) { Q = clamp(q, 0.3, 1.4); }
const count = (n) => Math.max(3, Math.round(n * Q));

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

export function drawDomainFloor(ctx, cam, d, time) {
  const c = cam.project(d.center.x, d.center.y, 0);
  const s = cam.scale;
  const r = d.radius * s;
  const spec = d.spec;
  const style = STYLES[spec.visual] || STYLES.void;

  // The interior wipes outward from the caster rather than appearing at once.
  const reveal = easeOutQuint(clamp01((d.t - 0.08) / 0.5));
  const rr = r * reveal;
  if (rr < 2) return;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
  ctx.clip();

  // Base wash — darker at the centre, the technique's colour at the rim.
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
  g.addColorStop(0, hexA(spec.color2 || '#000000', 0.88));
  g.addColorStop(0.68, hexA(spec.color2 || '#000000', 0.74));
  g.addColorStop(1, hexA(spec.color, 0.38 + d.pulse * 0.16));
  ctx.fillStyle = g;
  ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);

  const env = { ctx, c, r, time, spec, d, cam, open: d.openProgress };
  style.floor(env);

  // Ripples under every fighter standing inside — the floor is not neutral.
  const world = d.world;
  if (world && Q > 0.5) {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of world.fighters) {
      if (f.dead || !d.contains(f.pos)) continue;
      const p = cam.project(f.pos.x, f.pos.y, 0);
      const ph = (time * 1.4 + f.id * 0.37) % 1;
      const rad = s * (0.5 + ph * 1.9);
      ctx.strokeStyle = hexA(spec.color, 0.28 * (1 - ph));
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rad, rad * FLATTEN, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  // The expanding edge of the reveal glows while it is still travelling.
  if (reveal < 1) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA('#ffffff', 0.8 * (1 - reveal));
    ctx.lineWidth = 6 * (1 - reveal) + 2;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Dome
// ---------------------------------------------------------------------------

export function drawDomainDome(ctx, cam, d, time) {
  const c = cam.project(d.center.x, d.center.y, 0);
  const s = cam.scale;
  const r = d.radius * s;
  const spec = d.spec;
  const style = STYLES[spec.visual] || STYLES.void;
  const integrity = d.integrityFrac;
  const open = d.openProgress;
  const domeH = Math.min(r * 0.58, cam.height * 0.38);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (!d.open) {
    // --- the walls, unfolding from the ground -----------------------------
    const rise = easeOutBack(clamp01((d.t - 0.06) / 0.42));
    const ribs = count(30);
    const jitter = d.stress * 4;

    // Surface haze so the dome reads as a volume, not a wireframe.
    const rim = ctx.createRadialGradient(c.x, c.y - domeH * 0.25, r * 0.5, c.x, c.y - domeH * 0.25, r * 1.1);
    rim.addColorStop(0, hexA(spec.color, 0.03 + d.pulse * 0.04));
    rim.addColorStop(0.78, hexA(spec.color, (0.16 + d.pulse * 0.1) * (0.45 + integrity * 0.55)));
    rim.addColorStop(1, hexA(spec.color, 0));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y - domeH * 0.25, r * 1.1, (domeH + r * FLATTEN) * 0.8, 0, 0, TAU);
    ctx.fill();

    // Ribs: vertical arcs from the ground ring to the apex.
    ctx.lineWidth = 1.4;
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * TAU + time * 0.05;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r * FLATTEN;
      const depth = 0.55 + 0.45 * Math.sin(a); // ribs at the front read brighter
      const h = domeH * rise * (0.85 + 0.15 * Math.sin(a * 3 + time));
      ctx.strokeStyle = hexA(spec.color, 0.16 * depth * integrity + 0.04);
      ctx.beginPath();
      ctx.moveTo(x + randSway(i, time, jitter), y);
      ctx.quadraticCurveTo(
        c.x + Math.cos(a) * r * 0.72, y - h * 0.68,
        c.x + Math.cos(a) * r * 0.1, c.y - h);
      ctx.stroke();
    }

    // Latitude rings.
    for (let i = 1; i <= count(4); i++) {
      const k = i / 5;
      const rr = r * Math.cos(k * PI * 0.5);
      const yy = c.y - domeH * rise * Math.sin(k * PI * 0.5);
      ctx.strokeStyle = hexA(spec.color, 0.1 * integrity);
      ctx.beginPath();
      ctx.ellipse(c.x, yy, rr, rr * FLATTEN, 0, 0, TAU);
      ctx.stroke();
    }

    // The ground seam — brightest, animated, frays as integrity drops.
    ctx.strokeStyle = hexA(spec.color, 0.5 * integrity + 0.2 + d.pulse * 0.25);
    ctx.lineWidth = 2 + 3 * integrity + d.pulse * 2;
    ctx.setLineDash(integrity < 0.55 ? [16 * integrity + 4, 12 * (1 - integrity) + 3] : []);
    ctx.lineDashOffset = -time * 30;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Cracks where the barrier has actually been struck.
    for (const cr of d.cracks) {
      const a = cr.angle;
      const life = clamp01(cr.t / cr.max);
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r * FLATTEN;
      ctx.strokeStyle = hexA('#ffffff', 0.5 * life);
      ctx.lineWidth = 1 + cr.len * 2.5;
      for (let b = 0; b < 3; b++) {
        const spread = (b - 1) * 0.16;
        ctx.beginPath();
        ctx.moveTo(x, y);
        const seg = 3;
        for (let k = 1; k <= seg; k++) {
          const up = (k / seg) * domeH * cr.len * 0.9;
          const off = (noise1(b * 7 + k + cr.angle * 10, 3) - 0.5) * 18;
          ctx.lineTo(
            c.x + Math.cos(a + spread) * r * (1 - (k / seg) * 0.2) + off,
            y - up);
        }
        ctx.stroke();
      }
    }

    style.dome({ ctx, c, r, domeH, time, spec, d, cam, rise, integrity });
  } else {
    // --- open barrier: no walls, only a mark on the ground ----------------
    const pulse = 0.35 + d.pulse * 0.3;
    ctx.strokeStyle = hexA(spec.color, pulse);
    ctx.lineWidth = 3 + d.pulse * 3;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = hexA('#ffffff', 0.16);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([10, 14]);
    ctx.lineDashOffset = time * 40;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 0.97, r * 0.97 * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    style.dome({ ctx, c, r, domeH: r * 0.5, time, spec, d, cam, rise: 1, integrity });
  }

  // --- the slam: a white core and a ground shock on the first frames -------
  if (open < 1) {
    const k = 1 - open;
    const shock = easeOutQuint(clamp01(d.t / 0.26));
    ctx.strokeStyle = hexA('#ffffff', 0.9 * (1 - shock));
    ctx.lineWidth = 10 * (1 - shock) + 2;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * shock * 1.15, r * shock * 1.15 * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    const core = ctx.createRadialGradient(c.x, c.y - r * 0.2, 0, c.x, c.y - r * 0.2, r * 0.7 * k);
    core.addColorStop(0, hexA('#ffffff', 0.85 * k));
    core.addColorStop(0.5, hexA(spec.color, 0.5 * k));
    core.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(c.x - r, c.y - r * 1.4, r * 2, r * 2.2);
  }

  // --- clash seam ----------------------------------------------------------
  if (d.clashSeam) {
    const seam = cam.project(d.clashSeam.x, d.clashSeam.y, 0);
    const push = clamp(d.clashSeam.pressure, -1.5, 1.5);
    const winning = push >= 0;
    const a = d.clashSeam.angle;
    const len = r * 0.8;
    ctx.save();
    ctx.translate(seam.x, seam.y);
    ctx.rotate(a + PI / 2);
    // The contested surface: a bowed line that leans toward whoever is losing.
    ctx.strokeStyle = winning ? hexA('#ffffff', 0.75) : hexA('#ff4d4d', 0.7);
    ctx.lineWidth = 4 + Math.abs(push) * 5;
    ctx.beginPath();
    ctx.moveTo(0, -len * FLATTEN);
    ctx.quadraticCurveTo(push * 26, 0, 0, len * FLATTEN);
    ctx.stroke();
    // Sparks along the seam.
    for (let i = 0; i < count(9); i++) {
      const t = ((time * 2 + i / 9) % 1);
      const y = lerp(-len * FLATTEN, len * FLATTEN, t);
      ctx.fillStyle = hexA(winning ? '#ffffff' : '#ff8a8a', 0.8 * (1 - Math.abs(t - 0.5) * 2));
      ctx.beginPath();
      ctx.arc(push * 26 * (1 - Math.abs(t - 0.5) * 2) + randSway(i, time * 6, 6), y, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function randSway(i, t, amp) {
  return amp ? (noise1(i * 3.7 + t * 9, 17) - 0.5) * amp : 0;
}

// ---------------------------------------------------------------------------
// Overlay — screen-space interior, drawn above the fighters
// ---------------------------------------------------------------------------

export function drawDomainOverlay(ctx, cam, d, time, width, height) {
  const spec = d.spec;
  const style = STYLES[spec.visual] || STYLES.void;
  const c = cam.project(d.center.x, d.center.y, 0);
  const r = d.radius * cam.scale;
  const inside = vdist({ x: cam.x, y: cam.y }, d.center) < d.radius;

  ctx.save();
  style.overlay({ ctx, c, r, time, spec, d, cam, width, height, inside });

  // Sure-hit tethers: a line from the domain to everyone it is designating.
  // This is the whole point of a domain, so it is drawn explicitly.
  const world = d.world;
  if (world && inside) {
    ctx.globalCompositeOperation = 'lighter';
    for (const f of world.fighters) {
      if (f.dead || f.team === d.team || !d.contains(f.pos)) continue;
      const guarded = f.simpleDomain.active;
      const p = cam.project(f.pos.x, f.pos.y, f.z + f.height * 0.6);
      const apex = { x: c.x, y: c.y - r * 0.95 };
      ctx.strokeStyle = guarded ? hexA('#a8d8ff', 0.22) : hexA(spec.color, 0.3 + d.pulse * 0.3);
      ctx.setLineDash(guarded ? [4, 8] : [10, 6]);
      ctx.lineDashOffset = -time * 60;
      ctx.lineWidth = guarded ? 1 : 2;
      ctx.beginPath();
      ctx.moveTo(apex.x, apex.y);
      ctx.quadraticCurveTo((apex.x + p.x) / 2, apex.y + (p.y - apex.y) * 0.2, p.x, p.y);
      ctx.stroke();
      ctx.setLineDash([]);
      if (guarded) {
        ctx.strokeStyle = hexA('#cfe8ff', 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 16, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Per-domain styles
// ---------------------------------------------------------------------------

const VOID_GLYPHS = 'INFINITY VOID LIMITLESS BLUE RED PURPLE 0123456789'.split('');
const WORDS = ['DO NOT MOVE', 'STOP', 'CRUSH', 'BURST', 'SLEEP', 'DO NOT FLEE'];

const STYLES = {

  // --- UNLIMITED VOID ------------------------------------------------------
  void: {
    floor({ ctx, c, r, time, spec }) {
      ctx.globalCompositeOperation = 'lighter';
      // A starfield: infinite information rendered as depth.
      for (let i = 0; i < count(110); i++) {
        const a = i * 2.399 + time * 0.04;
        const dd = ((i * 37) % 100) / 100;
        const rr = Math.sqrt(dd) * r;
        const x = c.x + Math.cos(a) * rr;
        const y = c.y + Math.sin(a) * rr * FLATTEN;
        const tw = 0.25 + 0.75 * Math.abs(Math.sin(time * 2.4 + i));
        const sz = 1 + (i % 3) * 0.7;
        ctx.fillStyle = hexA('#ffffff', 0.55 * tw);
        ctx.fillRect(x, y, sz, sz);
      }
      // Concentric information rings, counter-rotating.
      for (let i = 0; i < count(8); i++) {
        const rr = r * ((i + 1) / 9) * (1 + Math.sin(time + i) * 0.015);
        ctx.strokeStyle = hexA(spec.color, 0.13);
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 10]);
        ctx.lineDashOffset = (i % 2 ? 1 : -1) * time * 26;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, spec, rise }) {
      // The eye at the apex: opens as the domain settles.
      const lid = clamp01((rise - 0.5) * 2);
      const ey = c.y - domeH * 0.74;
      const ew = r * 0.3;
      const eh = ew * 0.46 * lid;
      if (eh > 1) {
        ctx.strokeStyle = hexA('#d8f0ff', 0.5);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(c.x, ey, ew, eh, 0, 0, TAU);
        ctx.stroke();
        const g = ctx.createRadialGradient(c.x, ey, 0, c.x, ey, ew);
        g.addColorStop(0, hexA('#ffffff', 0.5));
        g.addColorStop(0.4, hexA(spec.color, 0.35));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(c.x, ey, ew * 0.9, eh * 0.9, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hexA('#06080f', 0.92);
        ctx.beginPath();
        ctx.ellipse(c.x, ey, ew * 0.12, eh * 0.86, 0, 0, TAU);
        ctx.fill();
        // Lashes / lids, so it reads as an eye rather than a lens flare.
        ctx.strokeStyle = hexA('#d8f0ff', 0.35);
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(c.x - ew, ey);
        ctx.quadraticCurveTo(c.x, ey - eh * 1.5, c.x + ew, ey);
        ctx.quadraticCurveTo(c.x, ey + eh * 1.5, c.x - ew, ey);
        ctx.stroke();
      }
      // Orbiting information rings, tilted around the whole dome.
      for (let i = 0; i < count(3); i++) {
        const tilt = time * (0.22 + i * 0.09) + i * 2;
        ctx.strokeStyle = hexA(spec.color, 0.14);
        ctx.lineWidth = 1.4;
        ctx.save();
        ctx.translate(c.x, c.y - domeH * 0.45);
        ctx.rotate(Math.sin(tilt) * 0.35);
        ctx.beginPath();
        ctx.ellipse(0, 0, r * (0.82 + i * 0.06), r * (0.16 + i * 0.05) * (0.4 + 0.6 * Math.abs(Math.cos(tilt))), 0, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
    },
    overlay({ ctx, time, width, height, inside }) {
      if (!inside) return;
      // Cascading glyph columns — too much information, delivered forever.
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'lighter';
      const cols = Math.ceil(width / (Q > 0.6 ? 26 : 44));
      const step = width / cols;
      ctx.font = '13px "Courier New", monospace';
      for (let i = 0; i < cols; i++) {
        const x = i * step + 4;
        const speed = 40 + ((i * 37) % 90);
        const y = ((time * speed + i * 211) % (height + 200)) - 100;
        for (let k = 0; k < 6; k++) {
          ctx.fillStyle = hexA('#8ad8ff', (0.12 + noise1(i * 0.4 + time, 3) * 0.28) * (1 - k / 7));
          ctx.fillText(VOID_GLYPHS[(i * 7 + k + Math.floor(time * 6)) % VOID_GLYPHS.length], x, y + k * 16);
        }
      }
      ctx.globalAlpha = 1;
    },
  },

  // --- MALEVOLENT SHRINE ---------------------------------------------------
  shrine: {
    floor({ ctx, c, r, time, d }) {
      ctx.globalCompositeOperation = 'lighter';
      // Paired cuts: dismantle always arrives as a cross.
      const n = count(30);
      for (let i = 0; i < n; i++) {
        const seed = Math.floor(time * 8) * 13 + i;
        const a = noise1(seed * 0.7, 11) * TAU;
        const dd = noise1(seed * 0.31, 5) * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        const len = 26 + noise1(seed * 0.11, 9) * 110;
        const ang = noise1(seed * 0.5, 17) * TAU;
        const age = (time * 8) % 1;
        for (const off of [0, PI / 2]) {
          const aa = ang + off;
          ctx.strokeStyle = hexA(off ? '#ffb0a0' : '#ff4d4d', 0.4 * (1 - age * 0.5));
          ctx.lineWidth = 1.4 + noise1(seed * 0.9, 3) * 2.4;
          ctx.beginPath();
          ctx.moveTo(x - Math.cos(aa) * len, y - Math.sin(aa) * len * FLATTEN);
          ctx.lineTo(x + Math.cos(aa) * len, y + Math.sin(aa) * len * FLATTEN);
          ctx.stroke();
        }
      }
      // Skull ring marking the shrine's ground.
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < count(20); i++) {
        const a = (i / 20) * TAU;
        const x = c.x + Math.cos(a) * r * 0.94;
        const y = c.y + Math.sin(a) * r * 0.94 * FLATTEN;
        ctx.fillStyle = hexA('#e0cfc4', 0.22);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.02, r * 0.026, 0, 0, TAU);
        ctx.fill();
      }
    },
    dome({ ctx, c, r, time, d }) {
      // Open barrier: a second, wider warning ring that breathes.
      ctx.strokeStyle = hexA('#ff4d4d', 0.12);
      ctx.lineWidth = 2;
      const rr = r * (1.04 + Math.sin(time * 1.6) * 0.012);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
      ctx.stroke();
    },
    overlay({ ctx, c, r, time, inside }) {
      // The shrine itself, standing over the arena.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.5 + Math.sin(time * 2) * 0.07;
      const h = r * 1.45;
      ctx.strokeStyle = hexA('#ff4d4d', 0.55);
      ctx.lineWidth = 3;
      // Uprights and lintel.
      ctx.beginPath();
      ctx.moveTo(c.x - r * 0.55, c.y - r * 0.2);
      ctx.lineTo(c.x - r * 0.42, c.y - h);
      ctx.lineTo(c.x + r * 0.42, c.y - h);
      ctx.lineTo(c.x + r * 0.55, c.y - r * 0.2);
      ctx.stroke();
      // Roof.
      ctx.beginPath();
      ctx.moveTo(c.x - r * 0.8, c.y - h);
      ctx.lineTo(c.x, c.y - h - r * 0.42);
      ctx.lineTo(c.x + r * 0.8, c.y - h);
      ctx.stroke();
      // Hanging skulls along the beam, swinging.
      for (let i = -4; i <= 4; i++) {
        const sway = Math.sin(time * 1.3 + i) * 4;
        const x = c.x + i * r * 0.16 + sway;
        ctx.strokeStyle = hexA('#ffd8d8', 0.3);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - sway, c.y - h);
        ctx.lineTo(x, c.y - h + 16);
        ctx.stroke();
        ctx.fillStyle = hexA('#ffd8d8', 0.4);
        ctx.beginPath();
        ctx.ellipse(x, c.y - h + 24, 6, 8, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hexA('#3a0808', 0.8);
        ctx.beginPath();
        ctx.arc(x - 2.2, c.y - h + 23, 1.6, 0, TAU);
        ctx.arc(x + 2.2, c.y - h + 23, 1.6, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (inside) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = hexA('#5a0a0a', 0.18);
        ctx.fillRect(0, 0, 4000, 4000);
      }
    },
  },

  // --- CHIMERA SHADOW GARDEN ----------------------------------------------
  shadowGarden: {
    floor({ ctx, c, r, time, spec }) {
      // Liquid shadow: slow rolling pools with a violet sheen.
      for (let i = 0; i < count(20); i++) {
        const a = time * 0.14 + i * 0.62;
        const dd = (0.15 + ((i * 17) % 80) / 100) * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        const rr = r * (0.13 + ((i * 11) % 40) / 190);
        const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
        g.addColorStop(0, hexA('#000000', 0.8));
        g.addColorStop(0.66, hexA(spec.color, 0.22));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, rr, rr * FLATTEN, 0, 0, TAU);
        ctx.fill();
      }
      // Eyes opening in the dark and blinking shut.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count(14); i++) {
        const seed = i * 13.7;
        const cycle = (time * 0.5 + noise1(seed, 2)) % 1;
        if (cycle > 0.42) continue;
        const openAmt = Math.sin((cycle / 0.42) * PI);
        const a = noise1(seed, 5) * TAU;
        const dd = noise1(seed * 1.3, 7) * r * 0.9;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        ctx.fillStyle = hexA('#c8b0ff', 0.6 * openAmt);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.022, r * 0.012 * openAmt + 0.5, a, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, spec, integrity }) {
      // Shadow running down the inside of the barrier.
      ctx.lineWidth = 2;
      for (let i = 0; i < count(16); i++) {
        const a = (i / 16) * TAU;
        const drip = ((time * 0.4 + i * 0.11) % 1);
        const x = c.x + Math.cos(a) * r * (1 - drip * 0.12);
        const y0 = c.y - domeH * (1 - drip);
        ctx.strokeStyle = hexA(spec.color, 0.2 * (1 - drip) * integrity);
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y0 + domeH * 0.16);
        ctx.stroke();
      }
    },
    overlay({ ctx, inside, width, height }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = 'rgba(6,4,12,0.3)';
      ctx.fillRect(0, 0, width, height);
    },
  },

  // --- SELF-EMBODIMENT OF PERFECTION --------------------------------------
  soulPalace: {
    floor({ ctx, c, r, time, spec }) {
      ctx.globalCompositeOperation = 'lighter';
      // Soul-shapes drifting just under the surface.
      for (let i = 0; i < count(40); i++) {
        const a = i * 1.7 + time * 0.3;
        const dd = ((i * 23) % 100) / 100 * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        ctx.strokeStyle = hexA(spec.color, 0.2);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(x, y, 9 + Math.sin(time * 2 + i) * 4, 13, i, 0, TAU);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, spec, integrity }) {
      // Hands pressing out through the barrier.
      for (let i = 0; i < count(10); i++) {
        const a = (i / 10) * TAU + time * 0.08;
        const push = 0.5 + 0.5 * Math.sin(time * 1.3 + i * 1.7);
        const h = domeH * (0.25 + ((i * 7) % 5) / 9);
        const x = c.x + Math.cos(a) * r * (0.94 + push * 0.05);
        const y = c.y - h;
        ctx.fillStyle = hexA(spec.color, 0.16 * push * integrity);
        ctx.beginPath();
        ctx.ellipse(x, y, r * 0.035 * push, r * 0.05 * push, a, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = hexA('#dfe7ee', 0.18 * push);
        ctx.lineWidth = 1;
        for (let fgr = -2; fgr <= 2; fgr++) {
          ctx.beginPath();
          ctx.moveTo(x + fgr * r * 0.008, y - r * 0.02 * push);
          ctx.lineTo(x + fgr * r * 0.012, y - r * 0.055 * push);
          ctx.stroke();
        }
      }
    },
    overlay({ ctx, inside, width, height, time }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#7fd4a8', 0.05 + Math.sin(time * 2.2) * 0.02);
      ctx.fillRect(0, 0, width, height);
    },
  },

  // --- COFFIN OF THE IRON MOUNTAIN ----------------------------------------
  volcano: {
    floor({ ctx, c, r, time }) {
      ctx.globalCompositeOperation = 'lighter';
      // Lava fissures that breathe.
      for (let i = 0; i < count(14); i++) {
        const a = i * 2.4 + Math.sin(time * 0.2 + i) * 0.1;
        const pulse = 0.35 + 0.65 * Math.abs(Math.sin(time * 1.1 + i));
        ctx.strokeStyle = hexA('#ff7a1a', 0.4 * pulse);
        ctx.lineWidth = 2 + pulse * 3;
        ctx.beginPath();
        for (let k = 0; k <= 6; k++) {
          const dd = (k / 6) * r;
          const wob = (noise1(i * 5 + k, 9) - 0.5) * r * 0.12;
          const x = c.x + Math.cos(a) * dd + wob;
          const y = c.y + Math.sin(a) * dd * FLATTEN + wob * FLATTEN;
          if (k === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Heat pools.
      for (let i = 0; i < count(20); i++) {
        const a = i * 2.1;
        const dd = ((i * 29) % 100) / 100 * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.5 + i));
        const g = ctx.createRadialGradient(x, y, 0, x, y, 30);
        g.addColorStop(0, hexA('#ff7a1a', 0.45 * pulse));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(x, y, 30, 30 * FLATTEN, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, integrity }) {
      // The barrier is rock: dark plates with glowing seams.
      for (let i = 0; i < count(22); i++) {
        const a = (i / 22) * TAU;
        const h = domeH * (0.3 + noise1(i * 2.1, 4) * 0.7);
        ctx.fillStyle = hexA('#1a0a04', 0.35);
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r * FLATTEN);
        ctx.lineTo(c.x + Math.cos(a) * r * 0.9, c.y - h);
        ctx.lineTo(c.x + Math.cos(a + 0.28) * r * 0.9, c.y - h * 0.85);
        ctx.lineTo(c.x + Math.cos(a + 0.28) * r, c.y + Math.sin(a + 0.28) * r * FLATTEN);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = hexA('#ff7a1a', 0.16 * integrity * (0.5 + 0.5 * Math.sin(time * 2 + i)));
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    },
    overlay({ ctx, inside, width, height, time }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#ff5e00', 0.09 + Math.sin(time * 3) * 0.03);
      ctx.fillRect(0, 0, width, height);
      // Falling ash.
      ctx.fillStyle = 'rgba(220,200,190,0.28)';
      for (let i = 0; i < count(50); i++) {
        const x = ((i * 137 + time * 18) % width);
        const y = ((i * 91 + time * (30 + (i % 5) * 12)) % height);
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    },
  },

  // --- FLOWING RED SEA -----------------------------------------------------
  bloodSea: {
    floor({ ctx, c, r, time }) {
      for (let i = 0; i < count(12); i++) {
        const a = time * 0.4 + i;
        const rr = r * (0.25 + (i / 12) * 0.75);
        ctx.strokeStyle = hexA('#ff2d4f', 0.16);
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(c.x + Math.cos(a) * 8, c.y + Math.sin(a) * 5, rr, rr * FLATTEN, 0, 0, TAU);
        ctx.stroke();
      }
      // Surface highlights, like light on moving liquid.
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count(26); i++) {
        const a = i * 1.9 + time * 0.5;
        const dd = ((i * 31) % 100) / 100 * r;
        ctx.fillStyle = hexA('#ff8a9a', 0.14);
        ctx.beginPath();
        ctx.ellipse(c.x + Math.cos(a) * dd, c.y + Math.sin(a) * dd * FLATTEN,
          14, 2.6, a, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, integrity }) {
      // Drips running down the barrier and hanging at the bottom.
      for (let i = 0; i < count(18); i++) {
        const a = (i / 18) * TAU;
        const drip = ((time * 0.5 + noise1(i, 3)) % 1);
        const x = c.x + Math.cos(a) * r * 0.98;
        const y = c.y - domeH * (1 - drip);
        ctx.fillStyle = hexA('#ff2d4f', 0.3 * integrity);
        ctx.beginPath();
        ctx.ellipse(x, y, 2.4, 6 + drip * 6, 0, 0, TAU);
        ctx.fill();
      }
    },
    overlay({ ctx, inside, width, height }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = hexA('#ff2d4f', 0.2);
      ctx.fillRect(0, 0, width, height);
    },
  },

  // --- CRADLE OF QUIET WORDS ----------------------------------------------
  words: {
    floor({ ctx, c, r, time, d }) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (let i = 0; i < count(26); i++) {
        const a = i * 1.9 + time * 0.2;
        const dd = ((i * 31) % 100) / 100 * r;
        ctx.fillStyle = hexA('#f0e6c8', 0.14 + 0.14 * Math.sin(time * 3 + i) + d.pulse * 0.2);
        ctx.fillText(WORDS[i % WORDS.length], c.x + Math.cos(a) * dd, c.y + Math.sin(a) * dd * FLATTEN);
      }
      ctx.textAlign = 'left';
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, d }) {
      // A mouth seal at the apex that opens when the command pulses.
      const open = 0.15 + d.pulse * 0.5;
      const y = c.y - domeH * 0.7;
      ctx.strokeStyle = hexA('#f0e6c8', 0.4);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(c.x, y, r * 0.2, r * 0.2 * open, 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = hexA('#2a2418', 0.5);
      ctx.beginPath();
      ctx.ellipse(c.x, y, r * 0.19, r * 0.19 * open, 0, 0, TAU);
      ctx.fill();
      // Sound rings running down the walls on each pulse.
      if (d.pulse > 0.05) {
        const k = 1 - d.pulse;
        ctx.strokeStyle = hexA('#f0e6c8', 0.4 * d.pulse);
        ctx.lineWidth = 3;
        const rr = r * k;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y - domeH * (1 - k), rr, rr * FLATTEN, 0, 0, TAU);
        ctx.stroke();
      }
    },
    overlay({ ctx, inside, width, height, d }) {
      if (!inside || d.pulse < 0.1) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#f0e6c8', 0.06 * d.pulse);
      ctx.fillRect(0, 0, width, height);
    },
  },

  // --- CHAMBER OF UNKNOWN DEPTHS ------------------------------------------
  swarm: {
    floor({ ctx, c, r, time, spec }) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count(70); i++) {
        const a = i * 0.9 + time * (0.4 + (i % 5) * 0.1);
        const dd = ((i * 19) % 100) / 100 * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        ctx.fillStyle = hexA(spec.color, 0.3);
        ctx.beginPath();
        ctx.ellipse(x, y, 4, 6, a, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      // The pit: it gets darker toward the middle, and there is no floor.
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * 0.55);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r * 0.55, r * 0.55 * FLATTEN, 0, 0, TAU);
      ctx.fill();
    },
    dome({ ctx, c, r, domeH, time, spec, integrity }) {
      // Curses crawling up the inside of the barrier.
      for (let i = 0; i < count(24); i++) {
        const a = (i / 24) * TAU + Math.sin(time * 0.4 + i) * 0.12;
        const climb = ((time * 0.24 + noise1(i * 3, 8)) % 1);
        const x = c.x + Math.cos(a) * r * (1 - climb * 0.55);
        const y = c.y - domeH * climb;
        ctx.fillStyle = hexA(spec.color, 0.28 * integrity);
        ctx.beginPath();
        ctx.ellipse(x, y, 5, 7, a, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hexA('#ffffff', 0.35 * integrity);
        ctx.beginPath();
        ctx.arc(x, y - 1.5, 1.4, 0, TAU);
        ctx.fill();
      }
    },
    overlay() {},
  },

  // --- DEADLY SENTENCING ---------------------------------------------------
  courtroom: {
    floor({ ctx, c, r, time }) {
      // Parquet court floor.
      ctx.strokeStyle = hexA('#cfa8ff', 0.2);
      ctx.lineWidth = 1.5;
      const n = count(10);
      for (let i = -n; i <= n; i++) {
        ctx.beginPath();
        ctx.moveTo(c.x + i * (r / n), c.y - r * FLATTEN);
        ctx.lineTo(c.x + i * (r / n), c.y + r * FLATTEN);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(c.x - r, c.y + i * (r * FLATTEN / n));
        ctx.lineTo(c.x + r, c.y + i * (r * FLATTEN / n));
        ctx.stroke();
      }
      // The dock: a circle drawn around the accused's half of the room.
      ctx.strokeStyle = hexA('#e0c8ff', 0.3);
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 8]);
      ctx.lineDashOffset = -time * 14;
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, r * 0.45, r * 0.45 * FLATTEN, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    },
    dome({ ctx, c, r, domeH, time, d }) {
      // The bench and a gavel that falls on every verdict tick.
      const y = c.y - domeH * 0.68;
      ctx.strokeStyle = hexA('#cfa8ff', 0.4);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(c.x - r * 0.4, y);
      ctx.lineTo(c.x + r * 0.4, y);
      ctx.stroke();
      const drop = d.pulse * d.pulse;
      ctx.save();
      ctx.translate(c.x + r * 0.3, y - r * 0.12 + drop * r * 0.1);
      ctx.rotate(-0.5 + drop * 0.5);
      ctx.fillStyle = hexA('#e0c8ff', 0.55);
      ctx.fillRect(-r * 0.05, -r * 0.02, r * 0.1, r * 0.04);
      ctx.fillRect(-r * 0.005, 0, r * 0.01, r * 0.09);
      ctx.restore();
      if (d.pulse > 0.6) {
        ctx.strokeStyle = hexA('#ffffff', (d.pulse - 0.6) * 2);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(c.x + r * 0.3, y - r * 0.02, r * 0.1 * (1 - d.pulse), 0, TAU);
        ctx.stroke();
      }
    },
    overlay({ ctx, inside, width, height }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = hexA('#cfa8ff', 0.4);
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const y = (i / 8) * height;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y + 20);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },

  // --- FROZEN SANCTUARY ----------------------------------------------------
  ice: {
    floor({ ctx, c, r, time }) {
      ctx.globalCompositeOperation = 'lighter';
      // A lattice of frost creeping outward.
      ctx.strokeStyle = hexA('#d8f4ff', 0.16);
      ctx.lineWidth = 1;
      for (let i = 0; i < count(26); i++) {
        const a = (i / 26) * TAU;
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        for (let k = 1; k <= 5; k++) {
          const dd = (k / 5) * r;
          const wob = (noise1(i * 3 + k, 21) - 0.5) * r * 0.08;
          ctx.lineTo(c.x + Math.cos(a) * dd + wob, c.y + Math.sin(a) * dd * FLATTEN + wob * FLATTEN);
        }
        ctx.stroke();
      }
      // Shards pushing up out of the ground.
      for (let i = 0; i < count(46); i++) {
        const a = i * 2.399 + time * 0.04;
        const dd = ((i * 37) % 100) / 100 * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN;
        const h = 12 + noise1(i * 0.9, 5) * 44;
        const grow = clamp01((time * 0.5 + i * 0.11) % 1.8);
        ctx.fillStyle = hexA('#a8e8ff', 0.24);
        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + (noise1(i, 3) - 0.5) * 6, y - h * grow);
        ctx.lineTo(x + 6, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, integrity }) {
      // Icicles hanging from the dome.
      for (let i = 0; i < count(20); i++) {
        const a = (i / 20) * TAU;
        const h = domeH * (0.45 + noise1(i * 4, 6) * 0.4);
        const x = c.x + Math.cos(a) * r * 0.88;
        const len = 14 + noise1(i, 9) * 28;
        ctx.fillStyle = hexA('#d8f4ff', 0.22 * integrity);
        ctx.beginPath();
        ctx.moveTo(x - 4, c.y - h);
        ctx.lineTo(x, c.y - h + len);
        ctx.lineTo(x + 4, c.y - h);
        ctx.closePath();
        ctx.fill();
      }
    },
    overlay({ ctx, inside, width, height, time }) {
      if (!inside) return;
      // Frost creeping in from the edges of the screen.
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(width / 2, height / 2, height * 0.3, width / 2, height / 2, height * 0.85);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, hexA('#a8e8ff', 0.2));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = hexA('#d8f4ff', 0.12);
      ctx.lineWidth = 1;
      for (let i = 0; i < count(18); i++) {
        const x = (i / 18) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + Math.sin(i + time * 0.2) * 20, 40 + noise1(i, 2) * 60);
        ctx.moveTo(x, height);
        ctx.lineTo(x + Math.cos(i + time * 0.2) * 20, height - 40 - noise1(i, 4) * 60);
        ctx.stroke();
      }
    },
  },

  // --- AUTHENTIC MUTUAL LOVE ----------------------------------------------
  love: {
    floor({ ctx, c, r, time, d }) {
      ctx.globalCompositeOperation = 'lighter';
      const beat = 0.45 + 0.55 * Math.pow(Math.abs(Math.sin(time * 1.5)), 5);
      const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      g.addColorStop(0, hexA('#ff8ab0', 0.3 * beat));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
      // Petals drifting on the pulse.
      for (let i = 0; i < count(40); i++) {
        const a = i * 1.7 + time * 0.28;
        const dd = ((i * 29) % 100) / 100 * r;
        const x = c.x + Math.cos(a) * dd;
        const y = c.y + Math.sin(a) * dd * FLATTEN + Math.sin(time * 1.4 + i) * 7;
        ctx.fillStyle = hexA('#ffb8d0', 0.4);
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 3.2, a, 0, TAU);
        ctx.fill();
      }
      // The heartbeat ring.
      ctx.strokeStyle = hexA('#ffffff', 0.3 * beat);
      ctx.lineWidth = 2 + beat * 3;
      const rr = r * (0.4 + beat * 0.55);
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, integrity }) {
      for (let i = 0; i < count(22); i++) {
        const a = (i / 22) * TAU;
        const rise = ((time * 0.35 + noise1(i, 7)) % 1);
        const x = c.x + Math.cos(a) * r * (1 - rise * 0.35);
        const y = c.y - domeH * rise;
        ctx.fillStyle = hexA('#ffb8d0', 0.28 * (1 - rise) * integrity);
        ctx.beginPath();
        ctx.ellipse(x, y, 6, 2.8, a + time, 0, TAU);
        ctx.fill();
      }
    },
    overlay({ ctx, inside, width, height, time }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#ff8ab0', 0.05 + Math.pow(Math.abs(Math.sin(time * 1.5)), 5) * 0.05);
      ctx.fillRect(0, 0, width, height);
    },
  },

  // --- IDLE DEATH GAMBLE ---------------------------------------------------
  pachinko: {
    floor({ ctx, c, r, time }) {
      ctx.globalCompositeOperation = 'lighter';
      // Peg field.
      const cols = count(16), rows = count(11);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = c.x + (i / (cols - 1) - 0.5) * r * 1.75;
          const y = c.y + (j / (rows - 1) - 0.5) * r * 1.75 * FLATTEN + (i % 2) * 6;
          if (Math.hypot(x - c.x, (y - c.y) / FLATTEN) > r) continue;
          ctx.fillStyle = hexA('#ffd166', 0.22);
          ctx.beginPath();
          ctx.arc(x, y, 2.2, 0, TAU);
          ctx.fill();
        }
      }
      // Balls falling and bouncing.
      for (let i = 0; i < count(30); i++) {
        const phase = (time * (0.45 + (i % 4) * 0.16) + i * 0.21) % 1;
        const x = c.x + ((i * 41) % 100 / 100 - 0.5) * r * 1.75 + Math.sin(phase * 22 + i) * 8;
        const y = c.y - r * FLATTEN + phase * r * 2 * FLATTEN;
        ctx.fillStyle = hexA('#ffffff', 0.55 * (1 - phase * 0.6));
        ctx.beginPath();
        ctx.arc(x, y, 3.4, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, d }) {
      // The reel strip across the top of the cabinet.
      const y = c.y - domeH * 0.6;
      const w = r * 0.62;
      ctx.fillStyle = 'rgba(10,8,4,0.75)';
      ctx.fillRect(c.x - w / 2, y - 20, w, 40);
      ctx.strokeStyle = hexA('#ffd166', 0.6);
      ctx.lineWidth = 2;
      ctx.strokeRect(c.x - w / 2, y - 20, w, 40);
      ctx.font = `900 ${Math.round(Math.max(12, r * 0.08))}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      const locked = d.pulse > 0.5;
      for (let i = 0; i < 3; i++) {
        const spin = locked ? 7 : Math.floor((time * (9 + i * 3) + i * 3) % 10);
        ctx.fillStyle = locked ? '#ffd166' : 'rgba(255,255,255,0.65)';
        ctx.fillText(String(spin), c.x + (i - 1) * w * 0.3, y + 8);
      }
      ctx.textAlign = 'left';
    },
    overlay({ ctx, inside, width, height, d }) {
      if (!inside || d.pulse < 0.4) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#ffd166', 0.07 * d.pulse);
      ctx.fillRect(0, 0, width, height);
    },
  },

  // --- HORIZON OF THE CAPTIVATING SKANDHA ---------------------------------
  tide: {
    floor({ ctx, c, r, time }) {
      // Shallow water rolling outward forever.
      for (let i = 0; i < count(14); i++) {
        const phase = (time * 0.22 + i / 14) % 1;
        const rr = r * phase;
        ctx.strokeStyle = hexA('#6fd0e8', 0.22 * (1 - phase));
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < count(34); i++) {
        const a = i * 1.3 + time * 0.4;
        const dd = ((i * 23) % 100) / 100 * r;
        ctx.fillStyle = hexA('#d8f8ff', 0.18);
        ctx.beginPath();
        ctx.ellipse(c.x + Math.cos(a) * dd, c.y + Math.sin(a) * dd * FLATTEN, 13, 2.4, a, 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    },
    dome({ ctx, c, r, domeH, time, integrity }) {
      // Torii gates receding toward a horizon that never arrives.
      for (let i = 1; i <= count(5); i++) {
        const k = i / 6;
        const gw = r * (1 - k * 0.8) * 0.5;
        const gh = domeH * (1 - k * 0.75) * 0.55;
        const y = c.y - domeH * 0.12 - k * domeH * 0.35;
        ctx.strokeStyle = hexA('#6fd0e8', 0.2 * (1 - k) * integrity);
        ctx.lineWidth = 2 * (1 - k) + 0.6;
        ctx.beginPath();
        ctx.moveTo(c.x - gw, y);
        ctx.lineTo(c.x - gw * 0.92, y - gh);
        ctx.lineTo(c.x + gw * 0.92, y - gh);
        ctx.lineTo(c.x + gw, y);
        ctx.moveTo(c.x - gw * 1.14, y - gh);
        ctx.lineTo(c.x + gw * 1.14, y - gh);
        ctx.stroke();
      }
      // The horizon line itself.
      ctx.strokeStyle = hexA('#d8f8ff', 0.22 * integrity);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(c.x - r, c.y - domeH * 0.55);
      ctx.lineTo(c.x + r, c.y - domeH * 0.55);
      ctx.stroke();
    },
    overlay({ ctx, inside, width, height, time }) {
      if (!inside) return;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#6fd0e8', 0.05);
      ctx.fillRect(0, 0, width, height);
      // Water caustics across the screen.
      ctx.strokeStyle = hexA('#d8f8ff', 0.07);
      ctx.lineWidth = 2;
      for (let i = 0; i < count(12); i++) {
        const y = (i / 12) * height + Math.sin(time + i) * 8;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 40) {
          const yy = y + Math.sin(x * 0.02 + time * 1.4 + i) * 7;
          if (x === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
    },
  },
};
