// 3D skeleton animation.
//
// Local character space: +x forward (the way they face), +y left, +z up, origin
// at the feet. Everything is expressed in metres for a 1.75m body and scaled by
// the fighter's actual height at draw time.

import { clamp, clamp01, lerp, TAU, PI, noise1 } from '../core/math.js';
import { actionTotal } from '../data/actions.js';

const ACTION_MODE = {
  light1: 'jab', light2: 'cross', light3: 'spin', light4: 'kick',
  heavy: 'overhead', heavyCharged: 'overhead', dashAttack: 'palm',
  air1: 'jab', air2: 'cross', airFinish: 'slam',
  grab: 'grab', throw: 'slam', parryCounter: 'cross', simpleCounter: 'spin',
  clawSwipe: 'claw', bite: 'lunge', lunge: 'palm', stomp: 'slam', tailWhip: 'spin',
};

const easeOut = (t) => 1 - Math.pow(1 - clamp01(t), 3);
const easeIn = (t) => Math.pow(clamp01(t), 2.2);
const V = (x, y, z) => ({ x, y, z });

/** Per-fighter animation state that the simulation does not own. */
export function rig3(f) {
  if (!f.rig3) {
    f.rig3 = {
      hair: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      coat: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 },
      recoil: 0, recoilYaw: 0,
      squash: 1, squashV: 0,
      prevVz: 0, wasAir: false,
      lastStep: 0, blink: 0, blinkT: 1 + (f.id % 7) * 0.5,
      trail: [],
    };
  }
  return f.rig3;
}

function spring(p, tx, ty, tz, k, damp, dt) {
  p.vx += (tx - p.x) * k * dt;
  p.vy += (ty - p.y) * k * dt;
  p.vz += (tz - p.z) * k * dt;
  const d = Math.exp(-damp * dt);
  p.vx *= d; p.vy *= d; p.vz *= d;
  p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
}

export function updateRig3(f, dt, fx) {
  const r = rig3(f);
  const step = Math.min(dt, 1 / 30);

  // Hair and coat lag behind the body in local space.
  const yaw = f.facing;
  const cs = Math.cos(-yaw), sn = Math.sin(-yaw);
  const lvx = f.vel.x * cs - f.vel.y * sn;    // local forward velocity
  const lvy = f.vel.x * sn + f.vel.y * cs;
  spring(r.hair, -lvx * 0.022, -lvy * 0.022, -0.02 + f.vz * 0.01, 150, 13, step);
  spring(r.coat, -lvx * 0.035, -lvy * 0.035, -0.05 + f.vz * 0.02, 95, 10, step);

  if (f.timeSinceHit < 0.02) {
    r.recoil = Math.min(1, r.recoil + 0.9);
    r.recoilYaw = Math.atan2(f.vel.y, f.vel.x) - yaw;
  }
  r.recoil = Math.max(0, r.recoil - step * 5);

  const inAir = f.z > 0.12;
  let squashTarget = 1;
  if (inAir) squashTarget = 1 + clamp(f.vz * 0.014, -0.12, 0.14);
  if (r.wasAir && !inAir) {
    r.squashV = -Math.min(9, Math.abs(r.prevVz) * 0.65);
    if (fx && Math.abs(r.prevVz) > 4) {
      fx.burst(f.pos.x, f.pos.y, 0.05, 6, {
        color: '#8a8a7a', speedMax: 3, lifeMax: 0.35, kind: 'smoke', sizeMax: 0.2, gravity: 2,
      });
    }
  }
  r.wasAir = inAir;
  r.prevVz = f.vz;
  r.squashV += (squashTarget - r.squash) * 90 * step;
  r.squashV *= Math.exp(-13 * step);
  r.squash = clamp(r.squash + r.squashV * step, 0.72, 1.24);

  const speed = Math.hypot(f.vel.x, f.vel.y);
  if (!inAir && speed > 2.2 && fx) {
    const phase = Math.sin(f.anim.walk * 1.3);
    if (Math.sign(phase) !== Math.sign(r.lastStep) && Math.abs(phase) > 0.1) {
      fx.burst(f.pos.x, f.pos.y, 0.04, 2, {
        color: '#7a7a6a', speedMax: 1.4, lifeMax: 0.3, kind: 'smoke', sizeMax: 0.12, gravity: 1,
      });
    }
    r.lastStep = phase;
  }

  r.blinkT -= step;
  if (r.blinkT <= 0) { r.blinkT = 2.4 + (f.id % 5) * 0.7; r.blink = 0.13; }
  r.blink = Math.max(0, r.blink - step);

  for (let i = r.trail.length - 1; i >= 0; i--) {
    r.trail[i].t -= step;
    if (r.trail[i].t <= 0) r.trail.splice(i, 1);
  }
  if (f.state !== 'attack') r.trail.length = 0;
  return r;
}

/**
 * Build the skeleton for this frame. Joint positions are in character-local
 * space; the caller applies the root transform.
 */
export function pose3(f, time) {
  const r = rig3(f);
  const S = (f.height || 1.75) / 1.75;
  const build = (f.appearance?.build ?? 1);

  const moving = Math.hypot(f.vel.x, f.vel.y);
  const stride = clamp(moving / 6.5, 0, 1);
  const walk = f.anim.walk * 1.3;
  const cyc = Math.sin(walk) * stride;
  const cyc2 = Math.sin(walk + PI) * stride;
  const bob = Math.abs(Math.cos(walk)) * 0.035 * stride;
  const breathe = Math.sin(f.anim.breathe) * 0.012;

  const P = {
    mode: null, windup: 0, strike: 0, follow: 0, spin: 0,
    guard: 0, cast: 0, rct: 0, crouch: 0, lean: 0, twist: 0,
    airborne: f.z > 0.25, knocked: 0, recoil: r.recoil, recoilYaw: r.recoilYaw,
    squash: r.squash, blink: r.blink, rig: r, S, dead: f.dead,
  };

  if (f.state === 'attack' && f.action) {
    const a = f.action, def = a.def;
    const t = a.t;
    P.mode = ACTION_MODE[def.id] || 'jab';
    if (t < def.startup) {
      P.windup = easeOut(t / Math.max(0.01, def.startup));
    } else if (t < def.startup + def.active) {
      P.windup = 1;
      P.strike = easeOut((t - def.startup) / Math.max(0.01, def.active));
    } else {
      P.windup = 1; P.strike = 1;
      P.follow = easeIn((t - def.startup - def.active) / Math.max(0.01, def.recovery));
    }
    if (P.mode === 'spin') P.spin = (P.windup * 0.3 + P.strike) * TAU * (def.id === 'light3' ? 1 : 0.6);
    P.lean = P.windup * -0.1 + P.strike * 0.26 - P.follow * 0.12;
    P.twist = (P.mode === 'cross' ? 0.55 : 0.28) * (P.strike - P.windup * 0.6);
  }
  if (f.state === 'block') P.guard = 1;
  if (f.state === 'cast' || f.state === 'domainCast') P.cast = 1;
  if (f.state === 'rct') P.rct = 1;
  if (f.state === 'stagger') { P.crouch = 0.6; P.lean = 0.45; }
  if (f.state === 'knockdown' || f.dead) P.knocked = 1;
  if (f.state === 'dash') P.lean = 0.42;
  if (P.airborne) P.crouch = -0.2;
  P.lean += clamp(f.anim.lean, 0, 1) * 0.14;

  // --- spine ---------------------------------------------------------------
  const hipZ = (0.90 - P.crouch * 0.16 + bob + breathe) * S * P.squash;
  const sk = {
    hip: V(0, 0, hipZ),
    chest: V(0.02 * S, 0, hipZ + 0.34 * S),
    neck: V(0.01 * S, 0, hipZ + 0.52 * S),
    head: V(0, 0, hipZ + 0.66 * S),
    headYaw: 0, headPitch: -P.lean * 0.3,
    twist: P.twist, lean: P.lean, spin: P.spin, S, build,
    P,
  };

  const shoulderY = 0.215 * S * build;
  sk.sL = V(0, shoulderY, hipZ + 0.48 * S);
  sk.sR = V(0, -shoulderY, hipZ + 0.48 * S);

  // --- legs ----------------------------------------------------------------
  const hipY = 0.10 * S * build;
  const legLen = 0.46 * S;
  const kick = P.mode === 'kick' ? P.strike * (1 - P.follow * 0.5) : 0;
  const tuck = P.mode === 'slam' ? P.strike * 0.6 : 0;

  for (const side of [1, -1]) {
    const c = side > 0 ? cyc : cyc2;
    const hx = 0, hy = side * hipY;
    const key = side > 0 ? 'L' : 'R';
    let kx = hx + c * 0.16 * S;
    let kz = hipZ - legLen + Math.max(0, c) * 0.12 * S + tuck * 0.2 * S;
    let fx2 = hx + c * 0.3 * S;
    let fz = Math.max(0, -Math.min(0, c) * 0.04 * S) + (P.airborne ? 0.1 * S : 0) + tuck * 0.34 * S;

    if (side < 0 && kick > 0) {
      kx = 0.3 * S + kick * 0.34 * S;
      kz = hipZ - 0.24 * S + kick * 0.36 * S;
      fx2 = 0.42 * S + kick * 0.78 * S;
      fz = hipZ - 0.34 * S + kick * 0.86 * S;
    }
    if (P.knocked) { kz = hipZ - 0.2 * S; fz = hipZ - 0.26 * S; fx2 = 0.3 * S; }

    sk['hip' + key] = V(hx, hy, hipZ);
    sk['k' + key] = V(kx, hy + side * 0.01 * S, kz);
    sk['f' + key] = V(fx2, hy + side * 0.02 * S, fz);
  }

  // --- arms ----------------------------------------------------------------
  const armY = shoulderY;
  const upper = 0.27 * S, fore = 0.26 * S;

  const setArm = (key, sh, ex, ey, ez, hx, hy, hz) => {
    sk['e' + key] = V(ex, ey, ez);
    sk['h' + key] = V(hx, hy, hz);
  };

  // Default relaxed swing.
  const relax = (side, key, phase) => {
    const c = phase;
    setArm(key, sk['s' + key],
      c * 0.13 * S, side * (armY + 0.05 * S), sk['s' + key].z - upper,
      c * 0.2 * S, side * (armY + 0.07 * S), sk['s' + key].z - upper - fore);
  };

  relax(1, 'L', cyc2);
  relax(-1, 'R', cyc);

  const t = P.strike * (1 - P.follow * 0.6);
  const back = P.windup * (1 - P.strike);
  const sz = sk.sR.z;

  if (P.guard) {
    setArm('R', sk.sR, 0.22 * S, -armY * 0.6, sz - 0.1 * S, 0.34 * S, -armY * 0.25, sz + 0.06 * S);
    setArm('L', sk.sL, 0.2 * S, armY * 0.7, sz - 0.12 * S, 0.3 * S, armY * 0.3, sz + 0.02 * S);
  } else if (P.rct) {
    setArm('R', sk.sR, 0.2 * S, -armY, sz - 0.2 * S, 0.26 * S, -0.02 * S, sz - 0.42 * S);
    setArm('L', sk.sL, 0.14 * S, armY * 1.2, sz - 0.22 * S, 0.1 * S, armY * 1.1, sz - 0.46 * S);
  } else if (P.cast) {
    setArm('R', sk.sR, 0.3 * S, -armY * 0.8, sz + 0.04 * S, 0.62 * S, -armY * 0.5, sz + 0.14 * S);
    setArm('L', sk.sL, 0.2 * S, armY * 1.1, sz - 0.14 * S, 0.3 * S, armY * 1.0, sz - 0.1 * S);
  } else if (P.mode) {
    switch (P.mode) {
      case 'jab':
      case 'cross':
        setArm('R', sk.sR,
          (0.12 - back * 0.22 + t * 0.4) * S, -armY * (1 - t * 0.5), sz - 0.16 * S + t * 0.06 * S,
          (0.24 - back * 0.4 + t * 0.78) * S, -armY * (1 - t * 0.7), sz - 0.2 * S + t * 0.12 * S);
        setArm('L', sk.sL,
          (-0.06 - t * 0.14) * S, armY * 1.2, sz - 0.2 * S,
          (-0.12 - t * 0.24) * S, armY * 1.3, sz - 0.3 * S);
        break;
      case 'overhead':
      case 'slam':
        setArm('R', sk.sR,
          (0.1 + t * 0.26) * S, -armY * 0.7, sz + (1 - t) * 0.3 * S - t * 0.16 * S,
          (0.16 + t * 0.6) * S, -armY * 0.4, sz + (1 - t) * 0.58 * S - t * 0.44 * S);
        setArm('L', sk.sL,
          (0.08 + t * 0.2) * S, armY * 0.8, sz + (1 - t) * 0.28 * S - t * 0.14 * S,
          (0.14 + t * 0.52) * S, armY * 0.5, sz + (1 - t) * 0.54 * S - t * 0.4 * S);
        break;
      case 'palm':
      case 'grab':
        setArm('R', sk.sR, (0.16 + t * 0.26) * S, -armY * 0.8, sz - 0.12 * S,
          (0.32 + t * 0.6) * S, -armY * 0.5, sz - 0.14 * S);
        setArm('L', sk.sL, (0.14 + t * 0.22) * S, armY * 0.9, sz - 0.14 * S,
          (0.28 + t * 0.52) * S, armY * 0.6, sz - 0.16 * S);
        break;
      case 'claw':
        setArm('R', sk.sR, (0.16 + t * 0.24) * S, (-armY + t * 0.3 * S), sz + (0.1 - t * 0.2) * S,
          (0.3 + t * 0.62) * S, (-armY + t * 0.6 * S), sz + (0.2 - t * 0.44) * S);
        break;
      case 'spin':
        setArm('R', sk.sR, 0.1 * S, -armY * 2.2, sz - 0.04 * S, 0.16 * S, -armY * 3.6, sz - 0.02 * S);
        setArm('L', sk.sL, 0.1 * S, armY * 2.2, sz - 0.04 * S, 0.16 * S, armY * 3.6, sz - 0.02 * S);
        break;
      case 'kick':
      default:
        setArm('R', sk.sR, -0.12 * S, -armY * 1.4, sz - 0.18 * S, -0.24 * S, -armY * 1.7, sz - 0.26 * S);
        setArm('L', sk.sL, -0.1 * S, armY * 1.4, sz - 0.2 * S, -0.2 * S, armY * 1.7, sz - 0.3 * S);
        break;
    }
  }

  // The lead hand carries the tool.
  sk.weaponHand = sk.hR;
  sk.weaponElbow = sk.eR;
  return sk;
}
