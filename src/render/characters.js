// Procedural character rendering. No sprites, no atlases — every fighter is
// drawn from primitives so the art scales, recolours and animates for free.
//
// The world is top-down but bodies are drawn upright in a 3/4 read: the ground
// position sets the anchor, world-z lifts it, and the facing angle drives the
// silhouette mirror plus the shoulder line.

import {
  clamp, clamp01, lerp, TAU, PI, rand, randRange, chance, noise1, fbm1, wrapAngle,
} from '../core/math.js';
import { HEIGHT, FLATTEN } from './camera.js';
import { glowSprite, softSprite, blit } from './sprites.js';

// --- primitives -------------------------------------------------------------

/** Tapered limb: a quad with rounded caps, drawn as a path. */
function limb(ctx, x1, y1, x2, y2, w1, w2, color) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * w1, y1 + ny * w1);
  ctx.lineTo(x2 + nx * w2, y2 + ny * w2);
  ctx.arc(x2, y2, w2, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  ctx.lineTo(x1 - nx * w1, y1 - ny * w1);
  ctx.arc(x1, y1, w1, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function blob(ctx, x, y, rx, ry, color, wobble = 0, t = 0, seed = 0) {
  ctx.beginPath();
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const w = wobble ? 1 + (noise1(i * 0.7 + t * 1.4, seed) - 0.5) * wobble : 1;
    const px = x + Math.cos(a) * rx * w;
    const py = y + Math.sin(a) * ry * w;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function glowDot(ctx, x, y, r, color, alpha = 1) {
  blit(ctx, glowSprite(color), x, y, r, alpha);
}

/** Additive halo behind an eye — replaces canvas shadowBlur, which is slow. */
function eyeGlow(ctx, x, y, r, color) {
  const prev = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  blit(ctx, glowSprite(color), x, y, r * 2.2, 0.55);
  ctx.globalCompositeOperation = prev;
}

// --- shadow -----------------------------------------------------------------

export function drawShadow(ctx, cam, f) {
  const p = cam.project(f.pos.x, f.pos.y, 0);
  const s = cam.scale;
  const lift = clamp01(1 - f.z / 6);
  const r = f.radius * s * (0.9 + f.scale * 0.25) * (0.6 + lift * 0.5);
  ctx.save();
  blit(ctx, softSprite('#000000'), p.x, p.y, r * 1.5, 0.62 * lift, 0.5);
  ctx.restore();
}

// --- aura -------------------------------------------------------------------

export function drawAura(ctx, cam, f, time) {
  if (f.dead) return;
  const intensity = f.maxCe > 0 ? clamp01(f.ce / f.maxCe) : 0;
  const flow = f.flow;
  const casting = f.state === 'cast' || f.state === 'domainCast';
  const amount = intensity * 0.5 + flow * 0.5 + (casting ? 0.6 : 0) + (f.hasStatus('overdrive') ? 0.5 : 0);
  if (amount < 0.08) return;

  const base = cam.project(f.pos.x, f.pos.y, f.z);
  const s = cam.scale;
  const hpx = s * HEIGHT;
  const h = f.height * hpx;
  const col = f.technique?.color || f.color;

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  // Rising wisps of cursed energy.
  const wisps = Math.round(5 + amount * 9);
  for (let i = 0; i < wisps; i++) {
    const seed = f.id * 31 + i * 7;
    const ph = (time * (0.45 + (i % 3) * 0.14) + i * 0.37) % 1;
    const spread = (noise1(i * 2.3 + time * 0.5, seed) - 0.5) * f.radius * s * 2.6;
    const x = base.x + spread;
    const y = base.y - ph * h * 1.25;
    const a = (1 - ph) * amount * 0.5;
    const r = (0.1 + ph * 0.3) * s * (0.5 + f.scale * 0.5);
    glowDot(ctx, x, y, r, col, a);
  }

  // Core halo.
  blit(ctx, softSprite(col), base.x, base.y - h * 0.45, h * 0.85, 0.3 * amount);

  // Infinity shimmer.
  if (f.techniqueId === 'limitless' && f.ce > 6) {
    const flick = f.infinityFlicker > 0 ? 1 : 0.35;
    ctx.strokeStyle = hexA('#7fd7ff', 0.16 * flick + 0.08);
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) {
      const rr = h * (0.55 + i * 0.14) + Math.sin(time * 2 + i) * 3;
      ctx.beginPath();
      ctx.ellipse(base.x, base.y - h * 0.5, rr * 0.62, rr, 0, 0, TAU);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function hexA(hex, a) {
  if (!hex) return `rgba(255,255,255,${a})`;
  if (hex.startsWith('rgb')) return hex;
  const h = hex.replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
}
export { hexA };

// --- main entry -------------------------------------------------------------

export function drawFighter(ctx, cam, f, time) {
  const base = cam.project(f.pos.x, f.pos.y, f.z);
  const s = cam.scale;
  const hpx = s * HEIGHT;

  ctx.save();
  ctx.translate(base.x, base.y);

  // Death: fall over and fade.
  if (f.dead) {
    const t = clamp01(f.deathTime / 1.1);
    ctx.globalAlpha = clamp01(1 - (f.deathTime - 2.2) / 1.6);
    ctx.rotate(t * (f.id % 2 ? 1 : -1) * 1.3);
    ctx.translate(0, t * hpx * 0.3);
  }

  // Hurt flash.
  const hurt = f.timeSinceHit < 0.12 ? 1 - f.timeSinceHit / 0.12 : 0;

  switch (f.shape) {
    case 'blob': drawBlobCurse(ctx, f, hpx, time); break;
    case 'mouth': drawMouthCurse(ctx, f, hpx, time); break;
    case 'mantis': drawMantis(ctx, f, hpx, time); break;
    case 'wraith': drawWraith(ctx, f, hpx, time); break;
    case 'hulk': drawHulk(ctx, f, hpx, time); break;
    case 'serpent': drawSerpent(ctx, f, hpx, time); break;
    case 'dog': drawBeast(ctx, f, hpx, time, 'dog'); break;
    case 'nue': drawNue(ctx, f, hpx, time); break;
    case 'toad': drawBeast(ctx, f, hpx, time, 'toad'); break;
    case 'fingerBearer': drawFingerBearer(ctx, f, hpx, time); break;
    case 'hanged': drawWraith(ctx, f, hpx, time, true); break;
    case 'special': drawSpecialGrade(ctx, f, hpx, time); break;
    case 'mahoraga': drawMahoraga(ctx, f, hpx, time); break;
    case 'transfigured': drawHuman(ctx, f, hpx, time, { patchwork: true }); break;
    case 'isomer': drawIsomer(ctx, f, hpx, time); break;
    case 'decoy': drawHuman(ctx, f, hpx, time, { ghost: true }); break;
    default: drawHuman(ctx, f, hpx, time, {}); break;
  }

  // Eye glow: one additive blit per fighter reads as well as a per-eye blur
  // and costs a fraction of it.
  if (!f.dead && !f.appearance?.blindfold) {
    const eyeY = -f.height * hpx * (f.shape === 'humanoid' || !f.shape ? 0.9 : 0.72);
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, glowSprite(f.eyeColor || '#ffd166'), 0, eyeY, f.height * hpx * 0.16, 0.42);
    ctx.globalCompositeOperation = 'source-over';
  }

  if (hurt > 0) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = hurt * 0.55;
    ctx.fillStyle = '#ff4d4d';
    ctx.beginPath();
    ctx.ellipse(0, -f.height * hpx * 0.5, f.radius * s * 1.5, f.height * hpx * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  ctx.restore();
}

// --- humanoid ---------------------------------------------------------------

function bodyPose(f, time) {
  // Facing: +1 draws to the right, -1 mirrors. `depth` is how much the body is
  // turned toward (1) or away from (-1) the camera.
  const faceX = Math.cos(f.facing);
  const depth = Math.sin(f.facing);
  const dir = faceX >= 0 ? 1 : -1;

  const moving = Math.hypot(f.vel.x, f.vel.y);
  const walk = f.anim.walk;
  const cycle = Math.sin(walk * 1.3);
  const cycle2 = Math.sin(walk * 1.3 + PI);
  const stride = clamp(moving / 7, 0, 1);
  const breathe = Math.sin(f.anim.breathe) * 0.012;

  let swing = 0, lunge = 0, guard = 0, castPose = 0, crouch = 0;
  if (f.state === 'attack' && f.action) {
    const a = f.action;
    const total = a.def.startup + a.def.active + a.def.recovery;
    const t = clamp01(a.t / total);
    const st = a.def.startup / total;
    swing = t < st ? -0.55 * (t / Math.max(st, 0.01)) : 1 - (t - st) / Math.max(1 - st, 0.01);
    lunge = t < st ? t * 0.4 : (1 - t) * 0.5;
  }
  if (f.state === 'block') guard = 1;
  if (f.state === 'cast' || f.state === 'domainCast') castPose = 1;
  if (f.state === 'rct') castPose = 0.6;
  if (f.state === 'stagger' || f.state === 'knockdown') crouch = 1;
  if (f.z > 0.2) crouch = -0.3;

  return { dir, depth, cycle, cycle2, stride, breathe, swing, lunge, guard, castPose, crouch, moving };
}

function drawHuman(ctx, f, hpx, time, opts) {
  const a = f.appearance || {};
  const P = bodyPose(f, time);
  const H = f.height * hpx;
  const build = (a.build ?? 1) * f.scale;
  const uniform = a.uniform || f.color2 || '#1a1d24';
  const accent = a.accent || f.color || '#8ad8ff';
  const skin = a.skin || '#e8c8a8';
  const hairCol = a.hair || '#1b1b22';

  const w = H * 0.115 * build;                       // torso half-width
  const hipY = -H * 0.46;
  const chestY = -H * 0.74;
  const neckY = -H * 0.84;
  const headY = -H * 0.9 - H * 0.055;
  const headR = H * 0.075 * build;
  const lean = P.lunge * 0.12 + P.crouch * 0.16 + f.anim.lean * 0.08;

  if (opts.ghost) ctx.globalAlpha = 0.45;

  ctx.save();
  ctx.scale(P.dir, 1);
  ctx.translate(0, P.crouch * H * 0.1);
  ctx.rotate(-lean * 0.5);

  // --- legs
  const legSpread = w * 0.55;
  const kneeLift = P.stride * H * 0.09;
  for (const side of [-1, 1]) {
    const c = side > 0 ? P.cycle : P.cycle2;
    const hipX = side * legSpread;
    const kneeX = hipX + c * H * 0.06;
    const kneeY = hipY + H * 0.22 - Math.max(0, c) * kneeLift;
    const footX = hipX + c * H * 0.13;
    const footY = -Math.max(0, c * 0.5) * kneeLift * 0.7 + (f.z > 0.2 ? -H * 0.06 : 0);
    limb(ctx, hipX, hipY, kneeX, kneeY, w * 0.46, w * 0.36, shade(uniform, side > 0 ? 1 : 0.82));
    limb(ctx, kneeX, kneeY, footX, footY, w * 0.36, w * 0.26, shade(uniform, side > 0 ? 0.9 : 0.74));
    // Shoe.
    ctx.fillStyle = shade(uniform, 0.55);
    ctx.beginPath();
    ctx.ellipse(footX + w * 0.18, footY - w * 0.12, w * 0.42, w * 0.2, 0, 0, TAU);
    ctx.fill();
  }

  // --- torso
  ctx.save();
  ctx.translate(0, P.breathe * H);
  ctx.beginPath();
  ctx.moveTo(-w, hipY);
  ctx.quadraticCurveTo(-w * 1.22, (hipY + chestY) / 2, -w * 1.1, chestY);
  ctx.quadraticCurveTo(-w * 0.9, neckY, 0, neckY);
  ctx.quadraticCurveTo(w * 0.9, neckY, w * 1.1, chestY);
  ctx.quadraticCurveTo(w * 1.22, (hipY + chestY) / 2, w, hipY);
  ctx.quadraticCurveTo(0, hipY + H * 0.03, -w, hipY);
  ctx.closePath();
  ctx.fillStyle = uniform;
  ctx.fill();

  // Trim / collar.
  ctx.strokeStyle = hexA(accent, 0.85);
  ctx.lineWidth = Math.max(1, H * 0.012);
  ctx.beginPath();
  ctx.moveTo(-w * 0.75, neckY + H * 0.02);
  ctx.lineTo(0, chestY + H * 0.05);
  ctx.lineTo(w * 0.75, neckY + H * 0.02);
  ctx.stroke();

  if (a.tie) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, chestY + H * 0.04);
    ctx.lineTo(w * 0.18, chestY + H * 0.1);
    ctx.lineTo(0, hipY + H * 0.08);
    ctx.lineTo(-w * 0.18, chestY + H * 0.1);
    ctx.closePath();
    ctx.fill();
  }
  if (opts.patchwork || a.stitches) {
    ctx.strokeStyle = hexA('#cfd8df', 0.6);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = lerp(chestY, hipY, i / 3);
      ctx.beginPath();
      ctx.moveTo(-w, yy);
      ctx.lineTo(w, yy + H * 0.01);
      ctx.stroke();
      for (let j = -2; j <= 2; j++) {
        ctx.beginPath();
        ctx.moveTo(j * w * 0.4, yy - H * 0.012);
        ctx.lineTo(j * w * 0.4, yy + H * 0.012);
        ctx.stroke();
      }
    }
  }
  if (a.muscle) {
    ctx.strokeStyle = hexA('#000000', 0.25);
    ctx.lineWidth = Math.max(1, H * 0.008);
    ctx.beginPath();
    ctx.moveTo(0, chestY + H * 0.02);
    ctx.lineTo(0, hipY - H * 0.02);
    ctx.stroke();
  }
  ctx.restore();

  // --- arms
  const shoulderY = chestY - H * 0.01;
  const reachA = P.swing;
  const weaponHand = { x: 0, y: 0 };
  for (const side of [-1, 1]) {
    const front = side > 0;
    const sx = side * w * 1.0;
    let elbowX, elbowY, handX, handY;
    if (P.guard) {
      elbowX = sx * 0.9 + w * 0.5;
      elbowY = shoulderY + H * 0.1;
      handX = w * 1.1;
      handY = shoulderY + H * 0.02;
    } else if (P.castPose) {
      elbowX = sx * 1.1 + w * 0.8;
      elbowY = shoulderY + H * 0.06;
      handX = w * (front ? 2.0 : 1.3);
      handY = shoulderY - H * 0.05 - (front ? H * 0.02 : 0);
    } else if (front && reachA !== 0) {
      const ext = clamp(reachA, -1, 1);
      elbowX = w * (1.2 + ext * 0.9);
      elbowY = shoulderY + H * 0.09 - ext * H * 0.03;
      handX = w * (1.5 + ext * 2.3);
      handY = shoulderY + H * 0.06 - ext * H * 0.06;
    } else {
      const c = front ? P.cycle2 : P.cycle;
      elbowX = sx * 1.05 + c * H * 0.03;
      elbowY = shoulderY + H * 0.12;
      handX = sx * 1.1 + c * H * 0.06;
      handY = shoulderY + H * 0.24;
    }
    const armCol = shade(uniform, front ? 1.08 : 0.78);
    limb(ctx, sx, shoulderY, elbowX, elbowY, w * 0.36, w * 0.28, armCol);
    limb(ctx, elbowX, elbowY, handX, handY, w * 0.28, w * 0.2, armCol);
    // Hand.
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(handX, handY, w * 0.24, 0, TAU);
    ctx.fill();
    if (front) { weaponHand.x = handX; weaponHand.y = handY; }
  }

  // --- weapon
  if (f.tool && f.tool.shape && f.tool.shape !== 'none') {
    drawTool(ctx, f.tool, weaponHand.x, weaponHand.y, H, P, w);
  }

  // --- head
  ctx.save();
  ctx.translate(0, P.breathe * H * 1.2);
  ctx.rotate(-P.lunge * 0.1);
  // neck
  limb(ctx, 0, neckY + H * 0.02, 0, headY + headR * 0.7, w * 0.3, w * 0.28, shade(skin, 0.85));
  // head
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, headY, headR * 0.92, headR, 0, 0, TAU);
  ctx.fill();
  // jaw shading
  ctx.fillStyle = hexA('#000000', 0.12);
  ctx.beginPath();
  ctx.ellipse(-headR * 0.3, headY + headR * 0.2, headR * 0.6, headR * 0.5, 0, 0, TAU);
  ctx.fill();

  drawHair(ctx, a.hairStyle || 'short', hairCol, headR, headY, H);

  // Eyes / blindfold / mask.
  if (a.blindfold) {
    ctx.fillStyle = '#14161c';
    ctx.fillRect(-headR * 1.05, headY - headR * 0.28, headR * 2.1, headR * 0.44);
    ctx.strokeStyle = hexA(accent, 0.5);
    ctx.lineWidth = 1;
    ctx.strokeRect(-headR * 1.05, headY - headR * 0.28, headR * 2.1, headR * 0.44);
  } else if (a.goggles) {
    ctx.fillStyle = '#2a2a30';
    ctx.fillRect(-headR * 1.1, headY - headR * 0.34, headR * 2.2, headR * 0.5);
    ctx.fillStyle = hexA(accent, 0.8);
    ctx.fillRect(headR * 0.1, headY - headR * 0.28, headR * 0.8, headR * 0.34);
  } else {
    const eyeCol = a.eyes || f.eyeColor;
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.ellipse(headR * 0.42, headY - headR * 0.06, headR * 0.2, headR * 0.13, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-headR * 0.18, headY - headR * 0.06, headR * 0.16, headR * 0.11, 0, 0, TAU);
    ctx.fill();
    eyeGlow(ctx, headR * 0.42, headY - headR * 0.06, headR * 0.7, eyeCol);
    eyeGlow(ctx, -headR * 0.18, headY - headR * 0.06, headR * 0.6, eyeCol);
  }
  if (a.scarf) {
    ctx.fillStyle = '#e8e8e8';
    ctx.beginPath();
    ctx.ellipse(0, headY + headR * 0.95, headR * 1.15, headR * 0.5, 0, 0, TAU);
    ctx.fill();
  }
  if (a.mouthMark) {
    ctx.fillStyle = '#b04a4a';
    ctx.fillRect(-headR * 0.5, headY + headR * 0.42, headR * 1.0, headR * 0.16);
  }
  if (a.markings) {
    ctx.strokeStyle = hexA('#2a0a0a', 0.75);
    ctx.lineWidth = Math.max(1, headR * 0.12);
    for (let i = -1; i <= 1; i += 2) {
      ctx.beginPath();
      ctx.moveTo(i * headR * 0.55, headY - headR * 0.5);
      ctx.lineTo(i * headR * 0.55, headY + headR * 0.35);
      ctx.stroke();
    }
  }
  if (a.scar) {
    ctx.strokeStyle = hexA('#b07a6a', 0.9);
    ctx.lineWidth = Math.max(1, headR * 0.1);
    ctx.beginPath();
    ctx.moveTo(headR * 0.15, headY + headR * 0.3);
    ctx.lineTo(headR * 0.72, headY + headR * 0.42);
    ctx.stroke();
  }
  ctx.restore();

  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawHair(ctx, style, col, r, y, H) {
  ctx.fillStyle = col;
  switch (style) {
    case 'spiky':
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, y + r * 0.1);
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const x = lerp(-r * 1.05, r * 1.05, t);
        ctx.lineTo(x + r * 0.12, y - r * (1.05 + (i % 2 ? 0.45 : 0.2)));
        ctx.lineTo(x + r * 0.28, y - r * 0.85);
      }
      ctx.lineTo(r * 1.05, y + r * 0.1);
      ctx.quadraticCurveTo(0, y - r * 1.3, -r * 1.05, y + r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'wild':
      for (let i = 0; i < 9; i++) {
        const a = -PI + (i / 8) * PI;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9);
        ctx.lineTo(Math.cos(a - 0.25) * r * 1.9, y + Math.sin(a - 0.25) * r * 1.9);
        ctx.lineTo(Math.cos(a + 0.18) * r * 1.0, y + Math.sin(a + 0.18) * r * 1.0);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'bun':
      ctx.beginPath();
      ctx.arc(0, y - r * 0.15, r * 1.05, PI, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-r * 0.15, y - r * 1.3, r * 0.52, 0, TAU);
      ctx.fill();
      break;
    case 'bob':
      ctx.beginPath();
      ctx.ellipse(0, y - r * 0.12, r * 1.12, r * 1.1, 0, PI, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-r * 0.95, y + r * 0.25, r * 0.3, r * 0.75, 0, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(r * 0.95, y + r * 0.25, r * 0.3, r * 0.75, 0, 0, TAU);
      ctx.fill();
      break;
    case 'braid':
      ctx.beginPath();
      ctx.arc(0, y - r * 0.1, r * 1.05, PI, TAU);
      ctx.fill();
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(-r * 1.0, y + r * (0.4 + i * 0.5), r * 0.3, 0, TAU);
        ctx.fill();
      }
      break;
    case 'buzz':
      ctx.beginPath();
      ctx.ellipse(0, y - r * 0.08, r * 0.96, r * 0.92, 0, PI, TAU);
      ctx.fill();
      break;
    case 'slick':
      ctx.beginPath();
      ctx.moveTo(-r, y + r * 0.05);
      ctx.quadraticCurveTo(0, y - r * 1.5, r * 1.25, y - r * 0.35);
      ctx.quadraticCurveTo(r * 0.5, y - r * 0.55, -r, y + r * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'messy':
      ctx.beginPath();
      ctx.arc(0, y - r * 0.12, r * 1.08, PI, TAU);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const x = lerp(-r, r, i / 4);
        ctx.beginPath();
        ctx.moveTo(x, y - r * 0.8);
        ctx.lineTo(x + r * 0.22, y - r * 1.5);
        ctx.lineTo(x + r * 0.4, y - r * 0.8);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case 'none':
      break;
    default: // short
      ctx.beginPath();
      ctx.ellipse(0, y - r * 0.1, r * 1.04, r * 1.0, 0, PI, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-r * 1.04, y - r * 0.05);
      ctx.quadraticCurveTo(0, y - r * 0.55, r * 1.04, y - r * 0.1);
      ctx.lineTo(r * 1.04, y - r * 0.4);
      ctx.quadraticCurveTo(0, y - r * 0.9, -r * 1.04, y - r * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
  }
}

function drawTool(ctx, tool, hx, hy, H, P, w) {
  const len = (tool.length || 1.2) * H * 0.46;
  const angle = -0.5 - P.swing * 1.7;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(angle);
  const col = tool.color || '#cfd6e0';
  switch (tool.shape) {
    case 'blade':
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(-w * 0.12, -w * 0.16, w * 0.7, w * 0.32);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(w * 0.6, -w * 0.14);
      ctx.lineTo(len, -w * 0.06);
      ctx.lineTo(len + w * 0.2, 0);
      ctx.lineTo(len, w * 0.08);
      ctx.lineTo(w * 0.6, w * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexA('#ffffff', 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    case 'spear':
      ctx.fillStyle = '#3a3028';
      ctx.fillRect(-w * 0.2, -w * 0.08, len * 0.82, w * 0.16);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(len * 0.8, -w * 0.22);
      ctx.lineTo(len + w * 0.35, 0);
      ctx.lineTo(len * 0.8, w * 0.22);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = hexA('#9fe4ff', 0.8);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      break;
    case 'staff':
      ctx.fillStyle = col;
      ctx.fillRect(-len * 0.45, -w * 0.13, len * 0.95, w * 0.26);
      ctx.fillStyle = shade(col, 0.7);
      ctx.fillRect(len * 0.18, -w * 0.16, w * 0.16, w * 0.32);
      ctx.fillRect(-len * 0.2, -w * 0.16, w * 0.16, w * 0.32);
      break;
    case 'cleaver':
      ctx.fillStyle = '#2a2a30';
      ctx.fillRect(-w * 0.1, -w * 0.14, w * 0.55, w * 0.28);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(w * 0.5, -w * 0.3);
      ctx.lineTo(len, -w * 0.42);
      ctx.lineTo(len, w * 0.2);
      ctx.lineTo(w * 0.5, w * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    case 'club':
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(0, -w * 0.16);
      ctx.lineTo(len * 0.7, -w * 0.4);
      ctx.quadraticCurveTo(len + w * 0.3, 0, len * 0.7, w * 0.4);
      ctx.lineTo(0, w * 0.16);
      ctx.closePath();
      ctx.fill();
      break;
    case 'hammer':
      ctx.fillStyle = '#6a4a34';
      ctx.fillRect(-w * 0.1, -w * 0.1, len * 0.8, w * 0.2);
      ctx.fillStyle = col;
      ctx.fillRect(len * 0.72, -w * 0.34, w * 0.5, w * 0.68);
      break;
    case 'chain':
    case 'rope':
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(1.5, w * 0.18);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        ctx.lineTo(len * t, Math.sin(t * 7 + P.swing * 6) * w * 0.4);
      }
      ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

// --- curse silhouettes ------------------------------------------------------

function drawBlobCurse(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const t = time + f.id;
  blob(ctx, 0, -H * 0.38, H * 0.33, H * 0.4, f.color2 || '#2a2333', 0.22, t, f.id);
  blob(ctx, 0, -H * 0.42, H * 0.28, H * 0.34, f.color, 0.3, t * 1.2, f.id + 3);
  // eyes
  const eyes = 3;
  for (let i = 0; i < eyes; i++) {
    const a = t * 0.6 + i * 2.1;
    const ex = Math.cos(a) * H * 0.12;
    const ey = -H * 0.45 + Math.sin(a * 1.3) * H * 0.09;
    ctx.fillStyle = f.eyeColor;
    ctx.beginPath();
    ctx.ellipse(ex, ey, H * 0.045, H * 0.06, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#14161c';
    ctx.beginPath();
    ctx.arc(ex, ey, H * 0.02, 0, TAU);
    ctx.fill();
  }
  // stubby arms
  for (const s of [-1, 1]) {
    limb(ctx, s * H * 0.24, -H * 0.42, s * H * 0.42, -H * 0.2 + Math.sin(t * 4 + s) * H * 0.05, H * 0.06, H * 0.035, f.color2 || '#2a2333');
  }
}

function drawMouthCurse(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const t = time + f.id;
  const open = 0.4 + Math.abs(Math.sin(t * 3)) * 0.6;
  blob(ctx, 0, -H * 0.4, H * 0.36, H * 0.34, f.color2 || '#3a2028', 0.16, t, f.id);
  // mouth
  ctx.fillStyle = '#14060a';
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.4, H * 0.26, H * 0.2 * open, 0, 0, TAU);
  ctx.fill();
  // teeth
  ctx.fillStyle = '#e8e0d0';
  for (let i = -3; i <= 3; i++) {
    const x = i * H * 0.07;
    ctx.beginPath();
    ctx.moveTo(x - H * 0.025, -H * 0.4 - H * 0.2 * open);
    ctx.lineTo(x + H * 0.025, -H * 0.4 - H * 0.2 * open);
    ctx.lineTo(x, -H * 0.4 - H * 0.06 * open);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - H * 0.025, -H * 0.4 + H * 0.2 * open);
    ctx.lineTo(x + H * 0.025, -H * 0.4 + H * 0.2 * open);
    ctx.lineTo(x, -H * 0.4 + H * 0.06 * open);
    ctx.closePath();
    ctx.fill();
  }
}

function drawMantis(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  const t = time + f.id;
  ctx.save();
  ctx.scale(P.dir, 1);
  // legs
  for (let i = 0; i < 3; i++) {
    for (const s of [-1, 1]) {
      const a = -0.5 + i * 0.4;
      limb(ctx, s * H * 0.08, -H * 0.4, s * H * (0.22 + i * 0.06), -H * (0.5 + Math.sin(t * 3 + i) * 0.04), H * 0.03, H * 0.02, f.color2);
      limb(ctx, s * H * (0.22 + i * 0.06), -H * (0.5 + Math.sin(t * 3 + i) * 0.04), s * H * (0.3 + i * 0.08), 0, H * 0.02, H * 0.012, f.color2);
    }
  }
  // body
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.45, H * 0.13, H * 0.3, 0.2, 0, TAU);
  ctx.fill();
  // scythe arms
  const swing = P.swing;
  for (const s of [1, -1]) {
    const bx = s * H * 0.1, by = -H * 0.62;
    const ex = s * H * (0.3 + swing * 0.25), ey = -H * (0.55 - swing * 0.12);
    limb(ctx, bx, by, ex, ey, H * 0.045, H * 0.03, f.color);
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(s * (-0.9 + swing * 1.6));
    ctx.fillStyle = '#dfe3ea';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(H * 0.3, -H * 0.14, H * 0.42, H * 0.02);
    ctx.quadraticCurveTo(H * 0.26, -H * 0.02, 0, H * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  // head
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.ellipse(H * 0.03, -H * 0.76, H * 0.09, H * 0.07, 0.3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  ctx.beginPath();
  ctx.ellipse(H * 0.08, -H * 0.78, H * 0.03, H * 0.02, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawWraith(ctx, f, hpx, time, hanged = false) {
  const H = f.height * hpx;
  const t = time + f.id;
  const sway = Math.sin(t * 1.6) * H * 0.04;
  // tattered body: a vertical smear with ragged bottom
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.moveTo(-H * 0.2, -H * 0.75);
  ctx.quadraticCurveTo(-H * 0.3, -H * 0.3, -H * 0.18 + sway, 0);
  for (let i = 0; i < 5; i++) {
    const x = lerp(-H * 0.18, H * 0.18, i / 4) + sway;
    ctx.lineTo(x, -H * (0.04 + (i % 2) * 0.08));
  }
  ctx.quadraticCurveTo(H * 0.3, -H * 0.3, H * 0.2, -H * 0.75);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hexA(f.color, 0.8);
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.72, H * 0.18, H * 0.2, 0, 0, TAU);
  ctx.fill();
  // hood opening
  ctx.fillStyle = '#0a0a12';
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.7, H * 0.11, H * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * H * 0.045, -H * 0.71, H * 0.022, H * 0.032, 0, 0, TAU);
    ctx.fill();
  }
  if (hanged) {
    ctx.strokeStyle = '#5a4a3a';
    ctx.lineWidth = Math.max(1, H * 0.015);
    ctx.beginPath();
    ctx.moveTo(0, -H * 0.85);
    ctx.lineTo(0, -H * 1.6);
    ctx.stroke();
  }
}

function drawHulk(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  ctx.save();
  ctx.scale(P.dir, 1);
  const w = H * 0.2;
  // legs
  for (const s of [-1, 1]) {
    const c = s > 0 ? P.cycle : P.cycle2;
    limb(ctx, s * w * 0.55, -H * 0.4, s * w * 0.7 + c * H * 0.05, -H * 0.2, w * 0.5, w * 0.42, shade(f.color2, 1));
    limb(ctx, s * w * 0.7 + c * H * 0.05, -H * 0.2, s * w * 0.8 + c * H * 0.09, 0, w * 0.42, w * 0.34, shade(f.color2, 0.85));
  }
  // torso — broad, hunched
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(-w * 1.1, -H * 0.38);
  ctx.quadraticCurveTo(-w * 1.5, -H * 0.72, -w * 0.8, -H * 0.86);
  ctx.quadraticCurveTo(0, -H * 0.98, w * 0.8, -H * 0.86);
  ctx.quadraticCurveTo(w * 1.5, -H * 0.72, w * 1.1, -H * 0.38);
  ctx.closePath();
  ctx.fill();
  // armour plates
  ctx.fillStyle = hexA('#000000', 0.25);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.ellipse(0, -H * (0.5 + i * 0.13), w * (1.1 - i * 0.15), H * 0.04, 0, 0, TAU);
    ctx.fill();
  }
  // arms
  for (const s of [-1, 1]) {
    const ex = s * w * 1.5, ey = -H * 0.5 + P.swing * H * 0.1 * s;
    limb(ctx, s * w * 1.0, -H * 0.78, ex, ey, w * 0.46, w * 0.4, shade(f.color, 0.9));
    limb(ctx, ex, ey, s * w * 1.7, -H * 0.2 + P.swing * H * 0.2, w * 0.4, w * 0.5, shade(f.color, 0.8));
  }
  // head — small, sunken
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.88, w * 0.42, H * 0.06, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(s * w * 0.16, -H * 0.88, H * 0.014, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawSerpent(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const t = time * 3 + f.id;
  ctx.strokeStyle = f.color;
  ctx.lineWidth = H * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) {
    const p = i / 12;
    const x = Math.sin(t + p * 4) * H * 0.22 * (1 - p * 0.4);
    const y = -H * 0.1 - p * H * 0.7;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = hexA(f.color2, 0.8);
  ctx.lineWidth = H * 0.07;
  ctx.stroke();
  // head
  const hx = Math.sin(t + 4) * H * 0.13;
  const hy = -H * 0.8;
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(hx, hy, H * 0.13, H * 0.09, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(hx + s * H * 0.05, hy - H * 0.02, H * 0.018, 0, TAU);
    ctx.fill();
  }
}

function drawBeast(ctx, f, hpx, time, kind) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  ctx.save();
  ctx.scale(P.dir, 1);
  const bodyY = -H * (kind === 'toad' ? 0.28 : 0.38);
  // legs
  for (let i = 0; i < 2; i++) {
    for (const s of [-1, 1]) {
      const c = Math.sin(f.anim.walk * 1.5 + i * PI + (s > 0 ? 0 : PI));
      const bx = (i ? -1 : 1) * H * 0.2;
      limb(ctx, bx, bodyY, bx + c * H * 0.08, 0, H * 0.05, H * 0.035, shade(f.color, s > 0 ? 1 : 0.8));
    }
  }
  // body
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(0, bodyY, H * (kind === 'toad' ? 0.34 : 0.3), H * (kind === 'toad' ? 0.22 : 0.17), 0, 0, TAU);
  ctx.fill();
  // two-tone for the divine dog
  if (kind === 'dog') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bodyY - H * 0.3, H * 0.4, H * 0.6);
    ctx.clip();
    ctx.fillStyle = f.color2;
    ctx.beginPath();
    ctx.ellipse(0, bodyY, H * 0.3, H * 0.17, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // head
  const hx = H * 0.3, hy = bodyY - H * 0.06;
  ctx.fillStyle = kind === 'dog' ? f.color2 : f.color;
  ctx.beginPath();
  ctx.ellipse(hx, hy, H * 0.13, H * 0.1, 0, 0, TAU);
  ctx.fill();
  if (kind === 'dog') {
    ctx.beginPath();
    ctx.moveTo(hx - H * 0.04, hy - H * 0.08);
    ctx.lineTo(hx - H * 0.01, hy - H * 0.2);
    ctx.lineTo(hx + H * 0.06, hy - H * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = f.eyeColor;
  ctx.beginPath();
  ctx.arc(hx + H * 0.05, hy - H * 0.02, H * 0.022, 0, TAU);
  ctx.fill();
  // tail
  ctx.strokeStyle = f.color;
  ctx.lineWidth = H * 0.04;
  ctx.beginPath();
  ctx.moveTo(-H * 0.28, bodyY);
  ctx.quadraticCurveTo(-H * 0.45, bodyY - H * 0.12 + Math.sin(time * 6) * H * 0.05, -H * 0.5, bodyY - H * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawNue(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const flap = Math.sin(time * 9 + f.id) * 0.5;
  ctx.fillStyle = f.color;
  // wings
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(0, -H * 0.55);
    ctx.rotate(s * (0.5 + flap * 0.5));
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(s * H * 0.5, -H * 0.25, s * H * 0.75, H * 0.02);
    ctx.quadraticCurveTo(s * H * 0.42, H * 0.06, 0, H * 0.08);
    ctx.closePath();
    ctx.fillStyle = hexA(f.color, 0.9);
    ctx.fill();
    ctx.strokeStyle = hexA('#b0d8ff', 0.6);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }
  // body
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.5, H * 0.14, H * 0.2, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  ctx.beginPath();
  ctx.arc(0, -H * 0.6, H * 0.035, 0, TAU);
  ctx.fill();
  // arcing lightning
  if (chance(0.25)) {
    ctx.strokeStyle = '#cfe8ff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(randRange(-H * 0.3, H * 0.3), -H * 0.4);
    ctx.lineTo(randRange(-H * 0.3, H * 0.3), -H * 0.7);
    ctx.stroke();
  }
}

function drawFingerBearer(ctx, f, hpx, time) {
  drawHulk(ctx, f, hpx, time);
  const H = f.height * hpx;
  // the finger, glowing in its chest
  ctx.save();
  ctx.fillStyle = '#ff4d4d';
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.62, H * 0.035, H * 0.075, 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawSpecialGrade(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  ctx.save();
  ctx.scale(P.dir, 1);
  // long cloak-like mass
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.moveTo(-H * 0.3, -H * 0.9);
  ctx.quadraticCurveTo(-H * 0.5, -H * 0.3, -H * 0.26, 0);
  ctx.lineTo(H * 0.26, 0);
  ctx.quadraticCurveTo(H * 0.5, -H * 0.3, H * 0.3, -H * 0.9);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.72, H * 0.24, H * 0.26, 0, 0, TAU);
  ctx.fill();
  // horns
  ctx.fillStyle = f.color2;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(s * H * 0.14, -H * 0.9);
    ctx.lineTo(s * H * 0.3, -H * 1.22);
    ctx.lineTo(s * H * 0.06, -H * 0.94);
    ctx.closePath();
    ctx.fill();
  }
  // multiple eyes
  ctx.fillStyle = f.eyeColor;
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * H * 0.1;
    const y = -H * 0.78 + (i % 2) * H * 0.06;
    ctx.beginPath();
    ctx.ellipse(x, y, H * 0.028, H * 0.04, 0, 0, TAU);
    ctx.fill();
  }
  // arms
  for (const s of [-1, 1]) {
    limb(ctx, s * H * 0.2, -H * 0.78, s * H * (0.42 + P.swing * 0.2), -H * (0.5 - P.swing * 0.1), H * 0.06, H * 0.04, f.color);
  }
  ctx.restore();
}

function drawMahoraga(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  ctx.save();
  ctx.scale(P.dir, 1);
  const w = H * 0.16;
  // legs
  for (const s of [-1, 1]) {
    const c = s > 0 ? P.cycle : P.cycle2;
    limb(ctx, s * w * 0.6, -H * 0.44, s * w * 0.8 + c * H * 0.05, -H * 0.22, w * 0.44, w * 0.34, f.color);
    limb(ctx, s * w * 0.8 + c * H * 0.05, -H * 0.22, s * w * 0.9 + c * H * 0.09, 0, w * 0.34, w * 0.28, shade(f.color, 0.85));
  }
  // torso
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.moveTo(-w, -H * 0.42);
  ctx.quadraticCurveTo(-w * 1.35, -H * 0.75, -w * 0.7, -H * 0.9);
  ctx.quadraticCurveTo(0, -H * 1.0, w * 0.7, -H * 0.9);
  ctx.quadraticCurveTo(w * 1.35, -H * 0.75, w, -H * 0.42);
  ctx.closePath();
  ctx.fill();
  // arms + blade
  for (const s of [-1, 1]) {
    const ex = s * w * 1.6, ey = -H * 0.52 + P.swing * H * 0.1;
    limb(ctx, s * w * 0.9, -H * 0.84, ex, ey, w * 0.4, w * 0.32, f.color);
    limb(ctx, ex, ey, s * w * 1.9, -H * 0.26 + P.swing * H * 0.22, w * 0.32, w * 0.26, f.color);
  }
  // the wheel above the head
  const spin = time * 1.4;
  ctx.save();
  ctx.translate(0, -H * 1.18);
  ctx.strokeStyle = f.color2;
  ctx.lineWidth = Math.max(1.5, H * 0.016);
  ctx.beginPath();
  ctx.ellipse(0, 0, H * 0.2, H * 0.09, 0, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = spin + (i / 8) * TAU;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * H * 0.2, Math.sin(a) * H * 0.09);
    ctx.stroke();
  }
  ctx.restore();
  // head — bare skull with long jaw
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.96, w * 0.5, H * 0.08, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(s * w * 0.2, -H * 0.96, H * 0.018, H * 0.026, 0, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawIsomer(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const t = time + f.id;
  blob(ctx, 0, -H * 0.45, H * 0.34, H * 0.46, f.color2, 0.2, t * 0.8, f.id);
  blob(ctx, 0, -H * 0.5, H * 0.26, H * 0.36, f.color, 0.28, t, f.id + 5);
  // many faces
  for (let i = 0; i < 5; i++) {
    const a = t * 0.5 + i * 1.4;
    const x = Math.cos(a) * H * 0.16;
    const y = -H * 0.5 + Math.sin(a * 1.2) * H * 0.16;
    ctx.fillStyle = hexA('#0a0a10', 0.8);
    ctx.beginPath();
    ctx.ellipse(x, y, H * 0.05, H * 0.06, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = f.eyeColor;
    ctx.beginPath();
    ctx.arc(x, y - H * 0.01, H * 0.014, 0, TAU);
    ctx.fill();
  }
  for (const s of [-1, 1]) {
    limb(ctx, s * H * 0.26, -H * 0.5, s * H * 0.52, -H * 0.16, H * 0.07, H * 0.05, f.color2);
  }
}

// --- utility ----------------------------------------------------------------

export function shade(hex, mul) {
  if (!hex) return '#888888';
  const h = hex.replace('#', '');
  const p = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const c = p.map((v) => clamp(Math.round(v * mul), 0, 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
