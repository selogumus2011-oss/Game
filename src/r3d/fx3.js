// Effects in 3D.
//
// The Effects pool is already world-space (x, y, z in metres), so nothing in
// the simulation or the event translation changes — this file just draws the
// same pools as geometry and billboards instead of flat ellipses.
//
// Screen-space passes (impact frames, colour flashes, chromatic aberration)
// stay in 2D and run after the draw list flushes.

import { clamp, clamp01, lerp, TAU, PI, rand, randRange } from '../core/math.js';
import { matCompose, matMul, hexToRgb } from './core3.js';
import {
  MeshBuilder, ringMesh, disc, cylinder, sphere, cone, box, plane, drawMesh,
} from './geom3.js';
import { cached, shade } from './models3.js';
import { insideDomain } from './arena3.js';
import { glowSprite, softSprite } from '../render/sprites.js';

const tmp = new Float32Array(16);
const tmpDir = new Float32Array(16);
const proj = { x: 0, y: 0, d: 0 };
const proj2 = { x: 0, y: 0, d: 0 };

const ringUnit = () => cached('fxRing', () => ringMesh(0.84, 1, 30, '#ffffff', 1));
const ringThick = () => cached('fxRingT', () => ringMesh(0.58, 1, 26, '#ffffff', 1));
const discUnit = () => cached('fxDisc', () => disc(1, 22, '#ffffff', 1));
const sphereUnit = () => cached('fxSphere', () => sphere(1, 10, 7, '#ffffff'));
const beamUnit = () => cached('fxBeam', () => cylinder(1, 1, 1, 8, '#ffffff'));
const spikeUnit = () => cached('fxSpike', () => cone(1, 1, 5, '#ffffff'));

/** A crescent sector in the XY plane, spanning `span` radians about +x. */
function arcMesh(span, inner) {
  const q = Math.round(span * 8) / 8;
  const qi = Math.round(inner * 8) / 8;
  return cached(`fxArc:${q}:${qi}`, () => {
    const b = new MeshBuilder();
    const seg = 16;
    const inA = [], outA = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const a = -q * 0.5 + q * t;
      // The crescent is fat in the middle and tapers to points at both ends —
      // that taper is what makes a swing read as a swing.
      const taper = Math.sin(t * PI);
      const ri = lerp(1, qi, taper);
      inA.push(b.vert(Math.cos(a) * ri, Math.sin(a) * ri, 0));
      outA.push(b.vert(Math.cos(a), Math.sin(a), 0));
    }
    for (let i = 0; i < seg; i++) {
      b.quad(inA[i], outA[i], outA[i + 1], inA[i + 1], '#ffffff', true, 1);
    }
    return b.build();
  });
}

function tintOf(color, gain = 1) {
  const c = hexToRgb(color);
  return [c[0] / 200 * gain, c[1] / 200 * gain, c[2] / 200 * gain];
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function drawEffects3(dl, cam, fx, S, q, time, world) {
  S.additive = true;
  S.tint = null;
  S.alpha = 1;

  drawDecals3(dl, cam, fx, S, world);
  drawRings3(dl, cam, fx, S, time);
  drawArcs3(dl, cam, fx, S);
  drawCuts3(dl, cam, fx, S);
  drawBeams3(dl, cam, fx, S, time);
  drawBolts3(dl, cam, fx);
  drawParticles3(dl, cam, fx, q);
  drawSprites3(dl, cam, fx);
  drawNumbers3(dl, cam, fx);

  S.additive = false;
  S.tint = null;
  S.alpha = 1;
}

// ---------------------------------------------------------------------------

function drawDecals3(dl, cam, fx, S, world) {
  S.additive = false;
  for (const d of fx.decals) {
    if (!cam.visible(d.x, d.y, 0, d.r * 2)) continue;
    // A domain replaces the ground it covers, scars included.
    if (world && insideDomain(world, d.x, d.y)) continue;
    const k = clamp01(d.life / d.max);
    const r = d.r;
    matCompose(d.x, d.y, 0.03, 0, 0, d.angle, r, r * (d.style === 'scar' ? 0.35 : 0.85), 1, tmp);
    S.alpha = d.alpha * Math.min(1, k * 3) * 0.75;
    S.tint = tintOf(d.color, 0.95);
    drawMesh(dl, cam, discUnit(), tmp, S);
  }
  S.alpha = 1;
  S.additive = true;
}

function drawRings3(dl, cam, fx, S, time) {
  for (const r of fx.rings) {
    if (!cam.visible(r.x, r.y, r.z, r.r * 1.2 + 1)) continue;
    const k = clamp01(r.life / r.max);
    S.alpha = (r.alpha ?? 1) * k;
    S.tint = tintOf(r.color, 1.3);
    const rad = Math.max(0.05, r.r);
    if (r.style === 'dome') {
      matCompose(r.x, r.y, r.z, 0, 0, time * 0.4, rad, rad, rad, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
    } else if (r.style === 'sphere' || r.flat === false) {
      // A vertical shockwave: three rings on different axes read as a bubble.
      matCompose(r.x, r.y, r.z, 0, 0, 0, rad, rad, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
      matCompose(r.x, r.y, r.z, PI / 2, 0, 0, rad, rad, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
      matCompose(r.x, r.y, r.z, PI / 2, 0, PI / 2, rad, rad, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
    } else {
      const mesh = r.width > 0.2 ? ringThick() : ringUnit();
      matCompose(r.x, r.y, Math.max(0.03, r.z), 0, 0, 0, rad, rad, 1, tmp);
      drawMesh(dl, cam, mesh, tmp, S);
      // A second, lower-opacity ring just inside sells the expansion.
      if (r.style === 'shock') {
        S.alpha *= 0.5;
        matCompose(r.x, r.y, Math.max(0.03, r.z) + 0.05, 0, 0, 0, rad * 0.82, rad * 0.82, 1, tmp);
        drawMesh(dl, cam, ringUnit(), tmp, S);
      }
    }
  }
  S.alpha = 1;
}

function drawArcs3(dl, cam, fx, S) {
  for (const a of fx.arcs) {
    if (!cam.visible(a.x, a.y, a.z, a.range + 1)) continue;
    const k = clamp01(a.life / a.max);
    const span = a.arc || 1;
    const mesh = arcMesh(span, a.inner ?? 0.35);
    S.alpha = k;
    S.tint = tintOf(a.color, 1.5);
    // Swings are not flat: tip the crescent so it cuts down through the target.
    const tilt = a.style === 'slash' ? 0.32 : a.style === 'cleave' ? 0.5 : 0.12;
    const grow = lerp(1.06, 0.94, k);
    const rr = a.range * grow;
    matCompose(a.x, a.y, a.z, 0, tilt, a.angle, rr, rr, 1, tmp);
    drawMesh(dl, cam, mesh, tmp, S);
    // Chained hits stack a brighter, tighter copy.
    if (a.chain) {
      S.alpha = k * 0.7;
      matCompose(a.x, a.y, a.z + 0.18, 0, tilt * 0.6, a.angle, rr * 0.82, rr * 0.82, 1, tmp);
      drawMesh(dl, cam, mesh, tmp, S);
    }
  }
  S.alpha = 1;
}

/**
 * A cut, in three stages.
 *
 *   FLASH   a hairline the full length of the cut, white-hot, two frames
 *   HOLD    nothing moves; this is the beat that makes the cut land
 *   OPEN    the gap spreads apart, its edges glowing, and a dark void shows
 *           between them — the space the cut took out of the world
 *
 * The plane is built once as a unit quad and stretched, so a lattice of a dozen
 * cuts costs a dozen matrices.
 */
const cutQuad = () => cached('fxCut', () => {
  const b = new MeshBuilder();
  const v = (x, y, z) => b.vert(x, y, z);
  b.quad(v(-0.5, 0, -0.5), v(0.5, 0, -0.5), v(0.5, 0, 0.5), v(-0.5, 0, 0.5),
    '#ffffff', true, 1);
  return b.build();
});

function drawCuts3(dl, cam, fx, S) {
  for (const c of fx.cuts) {
    if (c.delay > 0) continue;
    if (!cam.visible(c.x, c.y, c.z, c.len * 0.6)) continue;
    const k = clamp01(c.life / c.max);          // 1 at birth, 0 at death
    const age = 1 - k;
    const mesh = cutQuad();
    const tint = tintOf(c.color, 1.7);

    // FLASH: a hairline at full length, before anything has moved.
    if (age < 0.16) {
      const f = 1 - age / 0.16;
      S.alpha = f;
      S.tint = [2.4, 2.4, 2.4];
      matCompose(c.x, c.y, c.z, c.tilt, c.lean, c.angle,
        c.len, 1, 0.05 + f * 0.08, tmp);
      drawMesh(dl, cam, mesh, tmp, S);
      continue;
    }

    // OPEN: two lit edges parting, with the void between them.
    const open = easeOut(clamp01((age - 0.16) / 0.5));
    const fade = clamp01(k / 0.55);
    const gap = open * c.width;

    // The direction the two halves part in is the cut plane's own thin axis,
    // which is the image of local +z under the composed rotation. Taking it
    // from a unit matrix avoids re-deriving it by hand for every combination of
    // roll, lean and heading.
    matCompose(0, 0, 0, c.tilt, c.lean, c.angle, 1, 1, 1, tmpDir);
    const ux = tmpDir[2], uy = tmpDir[6], uz = tmpDir[10];

    // The void: darkness where the world used to be.
    S.additive = false;
    S.alpha = fade * 0.85;
    S.tint = [0.05, 0.02, 0.04];
    matCompose(c.x, c.y, c.z, c.tilt, c.lean, c.angle, c.len, 1, Math.max(0.02, gap), tmp);
    drawMesh(dl, cam, mesh, tmp, S);

    // The two edges.
    S.additive = true;
    S.tint = tint;
    for (const s of [1, -1]) {
      S.alpha = fade;
      matCompose(c.x + ux * gap * 0.5 * s, c.y + uy * gap * 0.5 * s, c.z + uz * gap * 0.5 * s,
        c.tilt, c.lean, c.angle, c.len, 1, 0.14, tmp);
      drawMesh(dl, cam, mesh, tmp, S);
    }
    // A white core along the middle for the first part of the opening.
    if (open < 0.7) {
      S.alpha = fade * (1 - open / 0.7);
      S.tint = [2.6, 2.6, 2.7];
      matCompose(c.x, c.y, c.z, c.tilt, c.lean, c.angle, c.len, 1, 0.1, tmp);
      drawMesh(dl, cam, mesh, tmp, S);
    }
  }
  S.additive = true;
  S.alpha = 1;
  S.tint = null;
}

const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 2.6);

function drawBeams3(dl, cam, fx, S, time) {
  for (const b of fx.beams) {
    const k = clamp01(b.life / b.max);
    const dx = b.to.x - b.from.x, dy = b.to.y - b.from.y;
    const L = Math.hypot(dx, dy) || 0.01;
    const mx = (b.from.x + b.to.x) * 0.5, my = (b.from.y + b.to.y) * 0.5;
    if (!cam.visible(mx, my, b.z, L * 0.5 + 2)) continue;
    const ang = Math.atan2(dy, dx);
    const w = b.width * (b.style === 'hollow' ? 1.15 : 1) * (0.6 + k * 0.4);
    S.tint = tintOf(b.color, 1.6);

    // Core: a cylinder laid along the beam. The unit cylinder runs +z, so the
    // bone rotation is ry = PI/2 about the y axis then rz = the beam heading.
    S.alpha = k;
    matCompose(b.from.x, b.from.y, b.z, 0, PI / 2, ang, w * 0.42, w * 0.42, L, tmp);
    drawMesh(dl, cam, beamUnit(), tmp, S);
    // Halo.
    S.alpha = k * 0.35;
    matCompose(b.from.x, b.from.y, b.z, 0, PI / 2, ang, w, w, L, tmp);
    drawMesh(dl, cam, beamUnit(), tmp, S);
    // Muzzle flare.
    S.alpha = k * 0.8;
    const fr = w * 1.9;
    matCompose(b.from.x, b.from.y, b.z, 0, PI / 2, ang, fr, fr, fr, tmp);
    drawMesh(dl, cam, sphereUnit(), tmp, S);
    if (b.style === 'hollow') {
      // Hollow Purple eats a channel out of the ground under it.
      S.alpha = k * 0.5;
      matCompose(mx, my, 0.04, 0, 0, ang, L * 0.5, w * 1.6, 1, tmp);
      drawMesh(dl, cam, discUnit(), tmp, S);
    }
  }
  S.alpha = 1;
}

function drawBolts3(dl, cam, fx) {
  for (const b of fx.bolts) {
    const k = clamp01(b.life / b.max);
    const pts = b.pts;
    let prev = null;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      cam.project(p.x, p.y, p.z, proj);
      if (proj.d <= cam.near) { prev = null; continue; }
      if (prev) {
        const lw = Math.max(1, b.width * cam.f / proj.d);
        dl.line((proj.d + prev.d) * 0.5 - 0.1, prev.x, prev.y, proj.x, proj.y,
          b.color, lw, true, k);
        if (b.glow) {
          dl.line((proj.d + prev.d) * 0.5, prev.x, prev.y, proj.x, proj.y,
            b.color, lw * 3.2, true, k * 0.25);
        }
      }
      prev = { x: proj.x, y: proj.y, d: proj.d };
    }
  }
}

function drawParticles3(dl, cam, fx, q) {
  const step = q.detail > 1 ? 1 : q.detail > 0 ? 1 : 2;
  const ps = fx.particles;
  for (let i = 0; i < ps.length; i += step) {
    const p = ps[i];
    const k = clamp01(p.life / p.max);
    cam.project(p.x, p.y, p.z, proj);
    if (proj.d <= cam.near || proj.d > 90) continue;
    const size = (p.size + p.grow * (1 - k)) * cam.f / proj.d * 2;
    if (size < 0.6) continue;
    const alpha = clamp01(k * (p.fade ?? 1));
    if (p.kind === 'spark' || p.stretch > 0) {
      // Stretched sparks trail along their velocity.
      const vx = p.vx, vy = p.vy, vz = p.vz;
      const sl = Math.max(0.05, Math.hypot(vx, vy, vz) * (p.stretch || 0.05));
      cam.project(p.x - vx * 0.02, p.y - vy * 0.02, p.z - vz * 0.02, proj2);
      const lw = Math.max(1, size * 0.4);
      dl.line(proj.d, proj.x, proj.y, proj2.x, proj2.y, p.color, lw, true, alpha);
      continue;
    }
    const sprite = p.kind === 'smoke' || p.glow < 0.3
      ? softSprite(p.color) : glowSprite(p.color);
    dl.sprite(proj.d, proj.x, proj.y, size, size, sprite, alpha, p.additive !== false, p.rot);
  }
}

function drawSprites3(dl, cam, fx) {
  for (const s of fx.sprites) {
    cam.project(s.x, s.y, s.z, proj);
    if (proj.d <= cam.near) continue;
    const k = clamp01(s.life / s.max);
    const px = s.size * cam.f / proj.d * 0.08;
    const rise = (1 - k) * 26;
    dl.text(proj.d - 0.5, proj.x, proj.y - rise, s.text, s.color,
      `800 ${Math.max(9, px * 0.62).toFixed(0)}px system-ui, sans-serif`, k, true);
  }
}

function drawNumbers3(dl, cam, fx) {
  for (const n of fx.numbers) {
    cam.project(n.x, n.y, n.z, proj);
    if (proj.d <= cam.near) continue;
    const k = clamp01(n.life / n.max);
    const px = Math.max(9, n.size * cam.f / proj.d * 0.06);
    dl.text(proj.d - 1, proj.x, proj.y, n.text, n.color,
      `${n.weight} ${px.toFixed(0)}px system-ui, sans-serif`, k);
  }
}

// ---------------------------------------------------------------------------
// Screen-space passes
// ---------------------------------------------------------------------------

/**
 * Manga impact frames. Radial speed lines converging on a focus point plus a
 * colour wash — the single most effective thing you can do to make a hit feel
 * like it came out of the anime.
 */
export function drawSpeedLines(ctx, W, H, strength, color, seed, focusX = W / 2, focusY = H / 2) {
  if (strength <= 0.01) return;
  const n = Math.round(22 * clamp01(strength) + 10);
  const R = Math.hypot(W, H) * 0.62;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = color;
  ctx.lineCap = 'butt';
  for (let i = 0; i < n; i++) {
    const a = seed + (i / n) * TAU + Math.sin(i * 12.9898) * 0.05;
    const inner = R * (0.3 + (Math.sin(i * 78.233) * 0.5 + 0.5) * 0.26 * (1 - strength * 0.4));
    const outer = R * (1.0 + (Math.sin(i * 39.77) * 0.5 + 0.5) * 0.2);
    const w = 1.5 + (Math.sin(i * 12.3) * 0.5 + 0.5) * 9 * strength;
    ctx.globalAlpha = (0.06 + (Math.sin(i * 4.1) * 0.5 + 0.5) * 0.19) * strength;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(focusX + Math.cos(a) * inner, focusY + Math.sin(a) * inner);
    ctx.lineTo(focusX + Math.cos(a) * outer, focusY + Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.restore();
}

/** Ragged white slash gashes across the frame — used on the biggest hits. */
export function drawImpactGashes(ctx, W, H, k, strength, color, seed) {
  const n = Math.round(3 + strength * 3);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const a = seed * 2.3 + i * 1.97;
    const cx = W * (0.5 + Math.cos(a * 3.1) * 0.32);
    const cy = H * (0.5 + Math.sin(a * 2.3) * 0.3);
    const len = Math.hypot(W, H) * (0.3 + (i % 3) * 0.16) * (0.4 + k * 0.6);
    const dir = a;
    const w = (5 + (i % 4) * 7) * strength * k;
    ctx.globalAlpha = 0.5 * k * strength;
    ctx.fillStyle = i % 3 === 0 ? color : '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(dir) * len, cy - Math.sin(dir) * len);
    ctx.lineTo(cx - Math.sin(dir) * w, cy + Math.cos(dir) * w);
    ctx.lineTo(cx + Math.cos(dir) * len, cy + Math.sin(dir) * len);
    ctx.lineTo(cx + Math.sin(dir) * w * 0.4, cy - Math.cos(dir) * w * 0.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

export function drawImpactFrames(ctx, W, H, fx, cam) {
  for (const im of fx.impacts) {
    const k = clamp01(im.life / im.max);
    let fxp = W / 2, fyp = H / 2;
    if (im.focus) {
      cam.project(im.focus.x, im.focus.y, im.focus.z ?? 1.2, proj);
      if (proj.d > cam.near) { fxp = proj.x; fyp = proj.y; }
    }
    drawSpeedLines(ctx, W, H, k * im.strength, im.color, im.seed, fxp, fyp);
    if (im.gash || im.strength > 0.9) {
      drawImpactGashes(ctx, W, H, k, im.strength, im.color, im.seed);
    }
    if (im.flash) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const c = hexToRgb(im.color);
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.16 * k * im.strength).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }
}
