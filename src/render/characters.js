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

export function drawFighter(ctx, cam, f, time, dt = 1 / 60, fx = null) {
  updateRig(f, dt, cam, fx);
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
    case 'transfigured': drawHuman(ctx, f, hpx, time, { patchwork: true }, cam); break;
    case 'isomer': drawIsomer(ctx, f, hpx, time); break;
    case 'rika': drawRika(ctx, f, hpx, time); break;
    case 'fish': drawFish(ctx, f, hpx, time); break;
    case 'puppet': drawPuppet(ctx, f, hpx, time); break;
    case 'decoy': drawHuman(ctx, f, hpx, time, { ghost: true }, cam); break;
    default: drawHuman(ctx, f, hpx, time, {}, cam); break;
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

// --- animation rig ----------------------------------------------------------
//
// Per-fighter presentation state: secondary motion for hair and cloth, hit
// recoil, squash and stretch, and the weapon trail. The simulation never reads
// any of this — it exists purely so bodies move like bodies.

function rigOf(f) {
  if (!f.anim.rig) {
    f.anim.rig = {
      hair: { x: 0, y: 0, vx: 0, vy: 0 },
      cloth: [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 0, y: 0, vx: 0, vy: 0 }],
      recoil: 0, recoilDir: 0,
      squash: 1, squashV: 0,
      prevVz: 0, wasAir: false,
      weaponTrail: [],
      blink: 0, blinkT: 1 + (f.id % 7) * 0.6,
      spin: 0,
      lastAction: null,
      step: 0, lastStepPhase: 0,
    };
  }
  return f.anim.rig;
}

/** Spring a point toward a target — the whole of the secondary motion model. */
function spring(p, tx, ty, stiffness, damping, dt) {
  p.vx += (tx - p.x) * stiffness * dt;
  p.vy += (ty - p.y) * stiffness * dt;
  const d = Math.exp(-damping * dt);
  p.vx *= d;
  p.vy *= d;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

export function updateRig(f, dt, cam, fx) {
  const rig = rigOf(f);
  const step = Math.min(dt, 1 / 30);
  const s = cam.scale;
  const dir = Math.cos(f.facing) >= 0 ? 1 : -1;

  // Hair and cloth lag behind the body and settle under gravity.
  const velLocal = -f.vel.x * dir * 0.9;
  const airLift = f.vz * 0.35;
  spring(rig.hair, velLocal * 0.02, 0.02 + airLift * 0.012, 120, 11, step);
  spring(rig.cloth[0], velLocal * 0.03, 0.05 + airLift * 0.02, 90, 9, step);
  spring(rig.cloth[1], rig.cloth[0].x * 1.3, rig.cloth[0].y * 1.2 + 0.03, 70, 8, step);

  // Hit recoil: a short shove away from whatever just landed.
  if (f.timeSinceHit < 0.02) {
    rig.recoil = Math.min(1, rig.recoil + 0.9);
    rig.recoilDir = Math.atan2(f.vel.y, f.vel.x);
  }
  rig.recoil = Math.max(0, rig.recoil - step * 5);

  // Squash and stretch around jumps and landings.
  const inAir = f.z > 0.12;
  let squashTarget = 1;
  if (inAir) squashTarget = 1 + Math.max(-0.12, Math.min(0.14, f.vz * 0.016));
  if (rig.wasAir && !inAir) {
    rig.squashV = -Math.min(9, Math.abs(rig.prevVz) * 0.7);
    if (fx && Math.abs(rig.prevVz) > 4) {
      const p = cam.project(f.pos.x, f.pos.y, 0);
      fx.burst(f.pos.x, f.pos.y, 0.04, 6, {
        color: '#8a8a7a', speedMax: 3, lifeMax: 0.35, kind: 'smoke', sizeMax: 0.2, gravity: 2,
      });
    }
  }
  rig.wasAir = inAir;
  rig.prevVz = f.vz;
  rig.squashV += (squashTarget - rig.squash) * 90 * step;
  rig.squashV *= Math.exp(-13 * step);
  rig.squash += rig.squashV * step;
  rig.squash = Math.max(0.7, Math.min(1.25, rig.squash));

  // Footfall dust on the walk cycle's contact frames.
  const speed = Math.hypot(f.vel.x, f.vel.y);
  if (!inAir && speed > 2.2 && fx) {
    const phase = Math.sin(f.anim.walk * 1.3);
    if (Math.sign(phase) !== Math.sign(rig.lastStepPhase) && Math.abs(phase) > 0.1) {
      fx.burst(f.pos.x, f.pos.y, 0.03, 2, {
        color: '#7a7a6a', speedMax: 1.4, lifeMax: 0.3, kind: 'smoke', sizeMax: 0.12, gravity: 1,
      });
    }
    rig.lastStepPhase = phase;
  }

  // Blink.
  rig.blinkT -= step;
  if (rig.blinkT <= 0) { rig.blinkT = 2.4 + (f.id % 5) * 0.7; rig.blink = 0.14; }
  rig.blink = Math.max(0, rig.blink - step);

  // Weapon trail decay.
  for (let i = rig.weaponTrail.length - 1; i >= 0; i--) {
    rig.weaponTrail[i].t -= step;
    if (rig.weaponTrail[i].t <= 0) rig.weaponTrail.splice(i, 1);
  }
  if (!(f.state === 'attack')) rig.weaponTrail.length = 0;
  return rig;
}

// --- humanoid ---------------------------------------------------------------

// Which body mechanic each attack uses. This is what makes a jab look like a
// jab and a rising kick look like a rising kick instead of one generic swing.
const ACTION_MODE = {
  light1: 'jab', light2: 'cross', light3: 'spin', light4: 'kick',
  heavy: 'overhead', heavyCharged: 'overhead', dashAttack: 'palm',
  air1: 'jab', air2: 'cross', airFinish: 'slam',
  grab: 'grab', throw: 'slam', parryCounter: 'cross', simpleCounter: 'spin',
  clawSwipe: 'claw', bite: 'lunge', lunge: 'palm', stomp: 'slam', tailWhip: 'spin',
};

const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t) => Math.pow(clamp01(t), 2.2);

function bodyPose(f, time) {
  const faceX = Math.cos(f.facing);
  const depth = Math.sin(f.facing);
  const dir = faceX >= 0 ? 1 : -1;
  const rig = rigOf(f);

  const moving = Math.hypot(f.vel.x, f.vel.y);
  const walk = f.anim.walk;
  const stride = clamp(moving / 6.5, 0, 1);
  const cycle = Math.sin(walk * 1.3) * stride;
  const cycle2 = Math.sin(walk * 1.3 + PI) * stride;
  const breathe = Math.sin(f.anim.breathe) * 0.012;

  const P = {
    dir, depth, cycle, cycle2, stride, breathe, moving, rig,
    mode: null, windup: 0, strike: 0, follow: 0, spin: 0,
    guard: 0, castPose: 0, rct: 0, crouch: 0, lean: 0, twist: 0,
    airborne: f.z > 0.25, recoil: rig.recoil, recoilDir: rig.recoilDir,
    squash: rig.squash, knocked: 0, swing: 0,
  };

  // --- attack phases -------------------------------------------------------
  if (f.state === 'attack' && f.action) {
    const a = f.action;
    const def = a.def;
    const total = def.startup + def.active + def.recovery;
    const t = a.t;
    P.mode = ACTION_MODE[def.id] || 'jab';
    if (t < def.startup) {
      // Anticipation: coil away from the target.
      P.windup = easeOut(t / Math.max(0.01, def.startup));
    } else if (t < def.startup + def.active) {
      P.windup = 1;
      P.strike = easeOut((t - def.startup) / Math.max(0.01, def.active));
    } else {
      P.windup = 1;
      P.strike = 1;
      P.follow = easeIn((t - def.startup - def.active) / Math.max(0.01, def.recovery));
    }
    P.swing = P.strike * (1 - P.follow);
    // Spin attacks rotate the whole body through a full turn.
    if (P.mode === 'spin') P.spin = (P.windup * 0.3 + P.strike * 1.0) * TAU * (def.id === 'light3' ? 1 : 0.6);
    P.lean = P.windup * -0.08 + P.strike * 0.2 - P.follow * 0.1;
    P.twist = (P.mode === 'cross' ? 0.5 : 0.25) * (P.strike - P.windup * 0.6);
  }

  if (f.state === 'block') P.guard = 1;
  if (f.state === 'cast' || f.state === 'domainCast') P.castPose = 1;
  if (f.state === 'rct') P.rct = 1;
  if (f.state === 'stagger') { P.crouch = 1; P.lean = 0.3; }
  if (f.state === 'knockdown' || (f.state === 'stagger' && f.staggerTime > 0.9)) P.knocked = 1;
  if (f.state === 'dash') P.lean = 0.35;
  if (P.airborne) P.crouch = -0.25;
  if (f.dead) P.knocked = 1;

  P.lean += clamp(f.anim.lean, 0, 1) * 0.12;
  return P;
}

function drawHuman(ctx, f, hpx, time, opts, cam) {
  const a = f.appearance || {};
  const P = bodyPose(f, time);
  const rig = P.rig;
  const H = f.height * hpx;
  const build = (a.build ?? 1) * f.scale;
  const uniform = a.uniform || f.color2 || '#1a1d24';
  const accent = a.accent || f.color || '#8ad8ff';
  const skin = a.skin || '#e8c8a8';
  const hairCol = a.hair || '#1b1b22';

  const w = H * 0.115 * build;
  const hipY = -H * 0.46;
  const chestY = -H * 0.74;
  const neckY = -H * 0.84;
  const headR = H * 0.075 * build;
  const headY = -H * 0.9 - headR * 0.72;

  if (opts.ghost) ctx.globalAlpha = 0.45;

  ctx.save();

  // Knocked down: the whole figure falls to the ground.
  if (P.knocked && !f.dead) {
    ctx.translate(0, -H * 0.12);
    ctx.rotate(P.dir * 1.15);
  }

  // Squash and stretch is applied to the whole body around the feet.
  ctx.scale(1 / P.squash, P.squash);
  ctx.scale(P.dir, 1);

  // Hit recoil: shove the body away from the incoming direction.
  if (P.recoil > 0.01) {
    const away = Math.cos(P.recoilDir) * P.dir;
    ctx.translate(away * P.recoil * w * 0.9, 0);
    ctx.rotate(-away * P.recoil * 0.18);
  }

  ctx.translate(0, P.crouch * H * 0.1);
  ctx.rotate(-P.lean * 0.5 + P.spin * 0);

  // Spin moves turn the torso and arms rather than the feet.
  const spinScale = P.spin ? Math.cos(P.spin) : 1;

  // --- legs ----------------------------------------------------------------
  const legSpread = w * 0.55;
  const kneeLift = P.stride * H * 0.1;
  const kickLeg = P.mode === 'kick' ? P.strike * (1 - P.follow * 0.5) : 0;
  const tuck = P.mode === 'slam' ? P.strike * 0.6 : 0;

  for (const side of [-1, 1]) {
    const front = side > 0;
    const c = front ? P.cycle : P.cycle2;
    const hipX = side * legSpread;
    let kneeX = hipX + c * H * 0.06;
    let kneeY = hipY + H * 0.22 - Math.max(0, c) * kneeLift - tuck * H * 0.14;
    let footX = hipX + c * H * 0.13;
    let footY = -Math.max(0, c * 0.5) * kneeLift * 0.7 + (P.airborne ? -H * 0.06 : 0) - tuck * H * 0.2;

    if (front && kickLeg > 0) {
      // Rising kick: the leg swings up through the target.
      const k = kickLeg;
      kneeX = hipX + w * (1.2 + k * 1.4);
      kneeY = hipY + H * (0.16 - k * 0.3);
      footX = hipX + w * (1.6 + k * 3.6);
      footY = hipY + H * (0.12 - k * 0.62);
    }
    if (P.knocked) {
      kneeY = hipY + H * 0.16;
      footY = hipY + H * 0.08;
    }

    limb(ctx, hipX, hipY, kneeX, kneeY, w * 0.46, w * 0.36, shade(uniform, front ? 1 : 0.82));
    limb(ctx, kneeX, kneeY, footX, footY, w * 0.36, w * 0.26, shade(uniform, front ? 0.9 : 0.74));
    ctx.fillStyle = shade(uniform, 0.55);
    ctx.beginPath();
    ctx.ellipse(footX + w * 0.18, footY - w * 0.12, w * 0.42, w * 0.2, 0, 0, TAU);
    ctx.fill();
  }

  // --- trailing coat -------------------------------------------------------
  if (P.moving > 3 || P.airborne || a.robe) {
    const sway = rig.cloth;
    ctx.fillStyle = shade(uniform, 0.72);
    ctx.beginPath();
    ctx.moveTo(-w * 0.9, chestY + H * 0.06);
    ctx.quadraticCurveTo(
      -w * 2.2 - sway[0].x * H, hipY + sway[0].y * H,
      -w * 2.6 - sway[1].x * H, hipY + H * 0.16 + sway[1].y * H);
    ctx.quadraticCurveTo(-w * 1.2, hipY + H * 0.1, -w * 0.3, hipY);
    ctx.closePath();
    ctx.fill();
  }

  // --- torso ---------------------------------------------------------------
  ctx.save();
  ctx.translate(0, P.breathe * H);
  ctx.rotate(P.twist * 0.25);
  const torsoW = w * (1 + P.twist * 0.12) * (spinScale * 0.25 + 0.75);
  ctx.beginPath();
  ctx.moveTo(-torsoW, hipY);
  ctx.quadraticCurveTo(-torsoW * 1.22, (hipY + chestY) / 2, -torsoW * 1.1, chestY);
  ctx.quadraticCurveTo(-torsoW * 0.9, neckY, 0, neckY);
  ctx.quadraticCurveTo(torsoW * 0.9, neckY, torsoW * 1.1, chestY);
  ctx.quadraticCurveTo(torsoW * 1.22, (hipY + chestY) / 2, torsoW, hipY);
  ctx.quadraticCurveTo(0, hipY + H * 0.03, -torsoW, hipY);
  ctx.closePath();
  ctx.fillStyle = uniform;
  ctx.fill();

  ctx.strokeStyle = hexA(accent, 0.85);
  ctx.lineWidth = Math.max(1, H * 0.012);
  ctx.beginPath();
  ctx.moveTo(-torsoW * 0.75, neckY + H * 0.02);
  ctx.lineTo(0, chestY + H * 0.05);
  ctx.lineTo(torsoW * 0.75, neckY + H * 0.02);
  ctx.stroke();

  if (a.tie) {
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, chestY + H * 0.04);
    ctx.lineTo(torsoW * 0.18, chestY + H * 0.1);
    ctx.lineTo(0, hipY + H * 0.08);
    ctx.lineTo(-torsoW * 0.18, chestY + H * 0.1);
    ctx.closePath();
    ctx.fill();
  }
  if (opts.patchwork || a.stitches) {
    ctx.strokeStyle = hexA('#cfd8df', 0.6);
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const yy = lerp(chestY, hipY, i / 3);
      ctx.beginPath();
      ctx.moveTo(-torsoW, yy);
      ctx.lineTo(torsoW, yy + H * 0.01);
      ctx.stroke();
      for (let j = -2; j <= 2; j++) {
        ctx.beginPath();
        ctx.moveTo(j * torsoW * 0.4, yy - H * 0.012);
        ctx.lineTo(j * torsoW * 0.4, yy + H * 0.012);
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

  // --- arms ----------------------------------------------------------------
  const shoulderY = chestY - H * 0.01;
  const weaponHand = { x: w * 1.4, y: shoulderY + H * 0.2, angle: -0.5 };

  for (const side of [-1, 1]) {
    const front = side > 0;
    const sx = side * w * 1.0;
    let elbowX, elbowY, handX, handY;

    if (P.knocked) {
      elbowX = sx * 1.4;
      elbowY = shoulderY + H * 0.1;
      handX = sx * 1.9;
      handY = shoulderY + H * 0.16;
    } else if (P.guard) {
      // Forearms crossed in front of the head.
      elbowX = sx * 0.7 + w * 0.4;
      elbowY = shoulderY + H * 0.11;
      handX = w * (front ? 1.25 : 0.85);
      handY = shoulderY - H * (front ? 0.04 : 0.01);
    } else if (P.rct) {
      // One palm hovering over the wound, the other braced.
      elbowX = sx * 1.0;
      elbowY = shoulderY + H * 0.1;
      handX = front ? w * 0.6 : sx * 1.2;
      handY = front ? hipY - H * 0.02 : shoulderY + H * 0.2;
    } else if (P.castPose) {
      // Hand raised, palm forward, fingers spread.
      elbowX = sx * 1.1 + w * 0.7;
      elbowY = shoulderY + H * 0.04;
      handX = w * (front ? 2.1 : 1.2);
      handY = shoulderY - H * (front ? 0.1 : 0.02);
    } else if (front && P.mode) {
      const t = P.strike * (1 - P.follow * 0.6);
      const back = P.windup * (1 - P.strike);
      switch (P.mode) {
        case 'jab':
        case 'cross':
          elbowX = w * (1.0 - back * 0.8 + t * 1.4);
          elbowY = shoulderY + H * (0.1 - t * 0.02);
          handX = w * (1.3 - back * 1.6 + t * 3.1);
          handY = shoulderY + H * (0.08 - t * 0.04);
          break;
        case 'overhead':
          elbowX = w * (0.6 + t * 1.3);
          elbowY = shoulderY - H * (0.16 * (1 - t)) + H * (0.16 * t);
          handX = w * (0.3 + t * 2.6);
          handY = shoulderY - H * (0.32 * (1 - t)) + H * (0.3 * t);
          break;
        case 'slam':
          elbowX = w * (0.9 + t * 0.9);
          elbowY = shoulderY - H * (0.2 * (1 - t)) + H * (0.24 * t);
          handX = w * (0.6 + t * 2.0);
          handY = shoulderY - H * (0.42 * (1 - t)) + H * (0.46 * t);
          break;
        case 'palm':
          elbowX = w * (1.1 + t * 1.1);
          elbowY = shoulderY + H * 0.08;
          handX = w * (1.4 + t * 2.6);
          handY = shoulderY + H * 0.04;
          break;
        case 'grab':
          elbowX = w * (1.2 + t * 0.9);
          elbowY = shoulderY + H * 0.07;
          handX = w * (1.6 + t * 1.9);
          handY = shoulderY + H * 0.02;
          break;
        case 'claw':
          elbowX = w * (1.2 + t * 1.0);
          elbowY = shoulderY + H * (0.04 + t * 0.06);
          handX = w * (1.2 - back * 1.4 + t * 3.0);
          handY = shoulderY - H * (0.1 * (1 - t)) + H * (0.14 * t);
          break;
        case 'spin':
          elbowX = w * 1.6;
          elbowY = shoulderY + H * 0.05;
          handX = w * 3.0;
          handY = shoulderY + H * 0.05;
          break;
        case 'kick':
        default:
          elbowX = sx * 1.1 - w * 0.6;
          elbowY = shoulderY + H * 0.14;
          handX = sx * 1.2 - w * 1.0;
          handY = shoulderY + H * 0.1;
          break;
      }
    } else if (!front && P.mode === 'spin') {
      elbowX = -w * 1.6;
      elbowY = shoulderY + H * 0.05;
      handX = -w * 2.8;
      handY = shoulderY + H * 0.06;
    } else if (!front && P.mode) {
      // Counter-balance arm pulled back.
      const t = P.strike;
      elbowX = sx * 1.1 - w * t * 0.5;
      elbowY = shoulderY + H * 0.14;
      handX = sx * 1.3 - w * t * 1.1;
      handY = shoulderY + H * 0.2;
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
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(handX, handY, w * 0.24, 0, TAU);
    ctx.fill();

    if (front) {
      weaponHand.x = handX;
      weaponHand.y = handY;
      weaponHand.angle = Math.atan2(handY - elbowY, handX - elbowX);
    }
    // Cursed energy gathering in the casting palm.
    if (front && (P.castPose || P.rct)) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      blit(ctx, glowSprite(P.rct ? '#8ef0bd' : (f.technique?.color || accent)),
        handX, handY, w * 2.4, 0.7);
      ctx.restore();
    }
  }

  // --- weapon --------------------------------------------------------------
  if (f.tool && f.tool.shape && f.tool.shape !== 'none') {
    drawTool(ctx, f, f.tool, weaponHand, H, P, w, cam);
  }

  // --- head ----------------------------------------------------------------
  ctx.save();
  ctx.translate(0, P.breathe * H * 1.2);
  ctx.rotate(-P.lean * 0.22 + P.twist * 0.12);
  limb(ctx, 0, neckY + H * 0.02, 0, headY + headR * 0.7, w * 0.3, w * 0.28, shade(skin, 0.85));
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, headY, headR * 0.92, headR, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hexA('#000000', 0.12);
  ctx.beginPath();
  ctx.ellipse(-headR * 0.3, headY + headR * 0.2, headR * 0.6, headR * 0.5, 0, 0, TAU);
  ctx.fill();

  // Hair with secondary motion.
  ctx.save();
  ctx.translate(rig.hair.x * H * 0.5, rig.hair.y * H * 0.5);
  ctx.rotate(-rig.hair.x * 0.9);
  drawHair(ctx, a.hairStyle || 'short', hairCol, headR, headY, H);
  ctx.restore();

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
    const lid = rig.blink > 0 ? 0.12 : 1;
    const squint = P.mode ? 0.72 : 1;
    ctx.fillStyle = eyeCol;
    ctx.beginPath();
    ctx.ellipse(headR * 0.42, headY - headR * 0.06, headR * 0.2, headR * 0.13 * lid * squint, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-headR * 0.18, headY - headR * 0.06, headR * 0.16, headR * 0.11 * lid * squint, 0, 0, TAU);
    ctx.fill();
    if (lid > 0.5) {
      eyeGlow(ctx, headR * 0.42, headY - headR * 0.06, headR * 0.7, eyeCol);
      eyeGlow(ctx, -headR * 0.18, headY - headR * 0.06, headR * 0.6, eyeCol);
    }
    // Brow line — the difference between neutral and furious.
    if (P.mode || P.guard) {
      ctx.strokeStyle = hexA('#1a1216', 0.7);
      ctx.lineWidth = Math.max(1, headR * 0.09);
      ctx.beginPath();
      ctx.moveTo(headR * 0.18, headY - headR * 0.3);
      ctx.lineTo(headR * 0.66, headY - headR * 0.18);
      ctx.stroke();
    }
  }
  if (a.scarf) {
    ctx.fillStyle = '#e8e8e8';
    ctx.beginPath();
    ctx.ellipse(0, headY + headR * 0.95, headR * 1.15, headR * 0.5, 0, 0, TAU);
    ctx.fill();
    // Trailing tail.
    const s0 = rig.cloth[0], s1 = rig.cloth[1];
    ctx.beginPath();
    ctx.moveTo(-headR * 0.5, headY + headR);
    ctx.quadraticCurveTo(
      -headR * 2 - s0.x * H * 1.2, headY + headR * 1.6 + s0.y * H,
      -headR * 3.2 - s1.x * H * 1.4, headY + headR * 2.6 + s1.y * H * 1.2);
    ctx.lineTo(-headR * 2.8 - s1.x * H * 1.4, headY + headR * 3.2 + s1.y * H * 1.2);
    ctx.quadraticCurveTo(-headR * 1.6 - s0.x * H, headY + headR * 2.0 + s0.y * H, headR * 0.2, headY + headR * 1.1);
    ctx.closePath();
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

/**
 * Draw the equipped cursed tool in the lead hand, plus its motion ribbon.
 * The ribbon is sampled in body-local space and corrected by how far the
 * fighter has travelled since each sample, so it tracks the swing rather than
 * smearing across the screen.
 */
function drawTool(ctx, f, tool, hand, H, P, w, cam) {
  const len = (tool.length || 1.2) * H * 0.46;
  const rig = P.rig;

  // Blade angle follows the mechanic of the current attack.
  let angle = hand.angle;
  switch (P.mode) {
    case 'overhead':
    case 'slam': angle = lerp(-2.1, 0.9, P.strike); break;
    case 'spin': angle = 0.1; break;
    case 'jab':
    case 'cross': angle = lerp(-0.9, -0.1, P.strike); break;
    case 'claw': angle = lerp(-1.4, 0.7, P.strike); break;
    case 'palm':
    case 'grab': angle = -0.2; break;
    default: angle = P.guard ? -1.2 : (P.castPose ? -1.6 : -0.5 - P.swing * 0.6); break;
  }

  // Sample the tip for the trail while the tool is actually moving.
  if (f.state === 'attack' && P.strike > 0.02 && P.follow < 0.6) {
    const tipX = hand.x + Math.cos(angle) * (len + w * 0.3);
    const tipY = hand.y + Math.sin(angle) * (len + w * 0.3);
    const midX = hand.x + Math.cos(angle) * len * 0.45;
    const midY = hand.y + Math.sin(angle) * len * 0.45;
    rig.weaponTrail.push({
      lx: tipX, ly: tipY, mx: midX, my: midY,
      wx: f.pos.x, wy: f.pos.y, t: 0.16, max: 0.16,
    });
    if (rig.weaponTrail.length > 14) rig.weaponTrail.shift();
  }

  // Ribbon between the tip path and the mid path.
  if (rig.weaponTrail.length > 2) {
    const s = cam ? cam.scale : 30;
    const conv = (p) => {
      const dx = (p.wx - f.pos.x) * s * P.dir;
      const dy = (p.wy - f.pos.y) * s * FLATTEN;
      return { tx: p.lx + dx, ty: p.ly + dy, mx: p.mx + dx, my: p.my + dy, a: clamp01(p.t / p.max) };
    };
    const pts = rig.weaponTrail.map(conv);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.beginPath();
    ctx.moveTo(pts[0].tx, pts[0].ty);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].tx, pts[i].ty);
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i].mx, pts[i].my);
    ctx.closePath();
    const grad = ctx.createLinearGradient(pts[0].tx, pts[0].ty, pts[pts.length - 1].tx, pts[pts.length - 1].ty);
    grad.addColorStop(0, hexA(tool.color || '#ffffff', 0.02));
    grad.addColorStop(1, hexA(f.technique?.color || tool.color || '#ffffff', 0.42));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(hand.x, hand.y);
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

/** Rika — a special grade that was a person, drawn as mass with a face in it. */
function drawRika(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  const t = time + f.id;
  ctx.save();
  ctx.scale(P.dir, 1);

  // Long trailing hair / mantle.
  ctx.fillStyle = f.color2;
  ctx.beginPath();
  ctx.moveTo(-H * 0.34, -H * 0.78);
  for (let i = 0; i <= 6; i++) {
    const p = i / 6;
    ctx.lineTo(-H * (0.34 + p * 0.28) + Math.sin(t * 2 + i) * H * 0.03, -H * 0.78 + p * H * 0.82);
  }
  ctx.lineTo(H * 0.3, 0);
  ctx.lineTo(H * 0.34, -H * 0.78);
  ctx.closePath();
  ctx.fill();

  // Body.
  blob(ctx, 0, -H * 0.52, H * 0.34, H * 0.42, f.color, 0.12, t * 0.7, f.id);

  // Enormous mouth with teeth.
  const open = 0.35 + Math.abs(Math.sin(t * 2.2)) * 0.5;
  ctx.fillStyle = '#180208';
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.5, H * 0.2, H * 0.17 * open + H * 0.03, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f0e4dc';
  for (let i = -3; i <= 3; i++) {
    const x = i * H * 0.055;
    const h = H * 0.05 * open;
    ctx.beginPath();
    ctx.moveTo(x - H * 0.02, -H * 0.5 - H * 0.17 * open);
    ctx.lineTo(x + H * 0.02, -H * 0.5 - H * 0.17 * open);
    ctx.lineTo(x, -H * 0.5 - H * 0.17 * open + h);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - H * 0.02, -H * 0.5 + H * 0.17 * open);
    ctx.lineTo(x + H * 0.02, -H * 0.5 + H * 0.17 * open);
    ctx.lineTo(x, -H * 0.5 + H * 0.17 * open - h);
    ctx.closePath();
    ctx.fill();
  }

  // Eyes above the mouth.
  ctx.fillStyle = f.eyeColor;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * H * 0.14, -H * 0.76, H * 0.05, H * 0.065, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#2a0a14';
    ctx.beginPath();
    ctx.arc(side * H * 0.14, -H * 0.76, H * 0.022, 0, TAU);
    ctx.fill();
    ctx.fillStyle = f.eyeColor;
  }

  // Arms.
  for (const side of [-1, 1]) {
    const reach = P.strike * 0.5;
    limb(ctx, side * H * 0.28, -H * 0.62,
      side * H * (0.52 + reach), -H * (0.4 - reach * 0.2), H * 0.08, H * 0.05, f.color);
  }
  ctx.restore();
}

/** A water shikigami: a fish that swims through air. */
function drawFish(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const t = time * 6 + f.id;
  const P = bodyPose(f, time);
  ctx.save();
  ctx.scale(P.dir, 1);
  ctx.translate(0, -H * 0.5);
  ctx.rotate(Math.sin(t * 0.5) * 0.2);
  ctx.fillStyle = f.color;
  ctx.beginPath();
  ctx.ellipse(0, 0, H * 0.3, H * 0.14, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-H * 0.28, 0);
  ctx.lineTo(-H * 0.46, -H * 0.12 + Math.sin(t) * H * 0.05);
  ctx.lineTo(-H * 0.46, H * 0.12 + Math.sin(t) * H * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = hexA('#ffffff', 0.3);
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.04, H * 0.2, H * 0.05, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  ctx.beginPath();
  ctx.arc(H * 0.18, -H * 0.03, H * 0.03, 0, TAU);
  ctx.fill();
  ctx.restore();
}

/** A hollow puppet built to take a hit. */
function drawPuppet(ctx, f, hpx, time) {
  const H = f.height * hpx;
  const P = bodyPose(f, time);
  const w = H * 0.12;
  ctx.save();
  ctx.scale(P.dir, 1);
  for (const side of [-1, 1]) {
    const c = side > 0 ? P.cycle : P.cycle2;
    limb(ctx, side * w * 0.6, -H * 0.44, side * w * 0.7 + c * H * 0.05, 0, w * 0.4, w * 0.3, shade(f.color, 0.8));
  }
  // Boxy chest with a seam and rivets.
  ctx.fillStyle = f.color;
  ctx.fillRect(-w * 1.2, -H * 0.82, w * 2.4, H * 0.4);
  ctx.strokeStyle = hexA('#000000', 0.5);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(-w * 1.2, -H * 0.82, w * 2.4, H * 0.4);
  ctx.fillStyle = shade(f.color, 0.6);
  for (let i = -1; i <= 1; i++) {
    ctx.beginPath();
    ctx.arc(i * w * 0.7, -H * 0.62, w * 0.14, 0, TAU);
    ctx.fill();
  }
  for (const side of [-1, 1]) {
    const t = P.strike;
    limb(ctx, side * w * 1.2, -H * 0.78, side * w * (1.8 + t), -H * (0.5 - t * 0.1), w * 0.3, w * 0.24, shade(f.color, 0.9));
  }
  // Head: a smooth mask with one lit eye slit.
  ctx.fillStyle = shade(f.color, 1.2);
  ctx.beginPath();
  ctx.ellipse(0, -H * 0.9, w * 0.62, H * 0.07, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = f.eyeColor;
  ctx.fillRect(-w * 0.4, -H * 0.91, w * 0.8, H * 0.016);
  eyeGlow(ctx, 0, -H * 0.9, H * 0.06, f.eyeColor);
  ctx.restore();
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
