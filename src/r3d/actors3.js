// Drawing fighters in 3D.
//
// pose3() produces a skeleton in character-local space; this file turns that
// skeleton into bone matrices, emits the meshes into the draw list, and layers
// the state reads a fighter needs: hit tint, cursed-energy aura, Infinity
// shell, Simple Domain circle, Reverse Cursed Technique glow and the ink
// outline that makes the whole thing read as cel animation.

import { clamp, clamp01, lerp, TAU, PI } from '../core/math.js';
import { matCompose, matMul, hexToRgb } from './core3.js';
import { drawMesh, drawOutline, disc, ringMesh, sphere, cylinder, box, domeMesh } from './geom3.js';
import { pose3, rig3, updateRig3 } from './pose3.js';
import { hasStatus } from '../sim/status.js';
import {
  headMesh, headMeshLow, torsoMesh, coatMesh, pelvisMesh, maneMesh, toolMesh,
  buildCurse, shade, eyeMesh, LIMB_W, cached,
} from './models3.js';
import { boneTransform, partTransform } from './models3.js';
import {
  MeshBuilder, taperedBox,
} from './geom3.js';

const rootMat = new Float32Array(16);
const tmpMat = new Float32Array(16);
const tmpMat2 = new Float32Array(16);

const V = (x, y, z) => ({ x, y, z });

// Cached unit meshes reused across every fighter.
const limbUnit = (c) => cached(`limbU:${c}`, () => taperedBox(1, 0.86, 0.8, 0.7, 1, c));
const armUnit = (c) => cached(`armU:${c}`, () => taperedBox(1, 0.9, 0.82, 0.74, 1, c));
const handUnit = (c) => cached(`handU:${c}`, () => taperedBox(1, 1.1, 0.8, 0.9, 1, c));
const footUnit = (c) => cached(`footU:${c}`, () => taperedBox(1, 0.8, 0.9, 0.75, 1, c, {
  topColor: shade(c, 1.15),
}));
const shadowMesh = () => cached('shadow', () => disc(1, 14, '#05050a', 0));

/** Rotate a local-space point about the vertical axis. */
function twistPoint(p, s, c) {
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c, z: p.z };
}

// ---------------------------------------------------------------------------
// Shared per-frame lighting options
// ---------------------------------------------------------------------------

export function makeShade(light, opts = {}) {
  return {
    light,
    ambient: opts.ambient ?? 0.34,
    key: opts.key ?? 0.78,
    rim: opts.rim ?? 0.34,
    tint: null,
    additive: false,
    alpha: 1,
    mv: new Float32Array(16),
  };
}

// ---------------------------------------------------------------------------
// Fighter
// ---------------------------------------------------------------------------

/**
 * @param q  quality knobs: {outlines:boolean, detail:0..2}
 */
export function drawFighter3(dl, cam, f, time, dt, fx, S, q) {
  updateRig3(f, dt, fx);
  if (!cam.visible(f.pos.x, f.pos.y, f.z + f.height * 0.5, f.height + f.radius * 2)) return;

  const alive = !f.dead;
  const deathT = f.dead ? clamp01(f.deathTime / 1.0) : 0;
  const fade = f.dead ? clamp01(1 - (f.deathTime - 2.2) / 1.6) : 1;
  if (fade <= 0.02) return;

  // Level of detail. A fighter forty metres out is twenty pixels tall; giving
  // them a five-hundred-triangle body is pure waste, and in a culling game with
  // ten of them on screen it is the whole frame budget.
  const dist = Math.hypot(f.pos.x - cam.pos.x, f.pos.y - cam.pos.y, f.z - cam.pos.z);
  const near = q.detail > 1 ? 1 : 0.62;
  const lod = f.isPlayer ? 0 : dist > 34 * near ? 2 : dist > 17 * near ? 1 : 0;
  const L = {
    lod,
    outlines: q.outlines && lod === 0,
    detail: lod === 0 ? q.detail : lod === 1 ? Math.min(1, q.detail) : 0,
  };

  const sk = pose3(f, time);
  const P = sk.P;
  const r = P.rig;

  // --- ground shadow --------------------------------------------------------
  const shR = f.radius * 1.5 * (1 - clamp01(f.z / 4) * 0.45);
  matCompose(f.pos.x, f.pos.y, 0.015, 0, 0, 0, shR, shR, 1, tmpMat);
  S.alpha = 0.34 * fade * (1 - clamp01(f.z / 5) * 0.6);
  S.additive = false;
  S.tint = null;
  drawMesh(dl, cam, shadowMesh(), tmpMat, S);
  S.alpha = fade;

  // --- root -----------------------------------------------------------------
  const lean = sk.lean * 0.45 + deathT * 1.42 + (P.knocked ? 0.9 : 0);
  const facing = f.facing + (P.spin || 0);
  matCompose(f.pos.x, f.pos.y, f.z, 0, clamp(lean, -0.6, 1.5), facing, 1, 1, 1, rootMat);

  // --- state tint -----------------------------------------------------------
  const hurt = f.timeSinceHit < 0.12 ? 1 - f.timeSinceHit / 0.12 : 0;
  let tint = null;
  if (hurt > 0.02) tint = [1 + hurt * 1.5, 1 - hurt * 0.25, 1 - hurt * 0.25];
  else if (f.amplify?.active) tint = [1.18, 1.0, 1.35];
  else if (f.state === 'rct') tint = [1.0, 1.3, 1.12];
  else if (hasStatus(f, 'burn')) tint = [1.3, 1.02, 0.9];
  else if (hasStatus(f, 'chilled')) tint = [0.9, 1.05, 1.3];
  S.tint = tint;

  const a = f.appearance || {};
  const isHuman = !f.shape || f.shape === 'humanoid' || f.shape === 'transfigured' || f.shape === 'decoy';

  if (isHuman) drawHumanoid(dl, cam, f, sk, S, L, time, a);
  else drawCurseBody(dl, cam, f, sk, S, L, time);

  // --- auras ----------------------------------------------------------------
  S.tint = null;
  drawAuras(dl, cam, f, sk, S, L, time, fade);
  S.alpha = 1;
}

// ---------------------------------------------------------------------------
// Humanoid
// ---------------------------------------------------------------------------

function drawHumanoid(dl, cam, f, sk, S, q, time, a) {
  const Sc = sk.S;
  const build = sk.build;
  const skin = a.skin || '#e9c8ac';
  const uniform = shade(a.uniform || f.color2 || '#171a22', 1.55);
  const sleeve = shade(uniform, 1.05);
  const trouser = shade(uniform, 0.8);
  const glove = a.accent && f.tool && f.tool.shape !== 'none' ? shade(uniform, 1.3) : skin;

  // Upper body twist.
  const tw = sk.twist;
  const ts = Math.sin(tw), tc = Math.cos(tw);
  const T = tw ? (p) => twistPoint(p, ts, tc) : (p) => p;

  const chest = T(sk.chest), neck = T(sk.neck), head = T(sk.head);
  const sL = T(sk.sL), sR = T(sk.sR);
  const eL = T(sk.eL), eR = T(sk.eR), hL = T(sk.hL), hR = T(sk.hR);

  const outline = q.outlines;
  const ink = [8, 8, 12];
  const emit = (mesh, mat, ol = outline, olScale = 1.06) => {
    drawMesh(dl, cam, mesh, mat, S);
    if (ol) drawOutline(dl, cam, mesh, mat, olScale, ink);
  };

  // --- legs -----------------------------------------------------------------
  const thighW = LIMB_W.thigh * Sc * build;
  const shinW = LIMB_W.shin * Sc * build;
  for (const k of ['L', 'R']) {
    const hip = sk['hip' + k], knee = sk['k' + k], foot = sk['f' + k];
    emit(limbUnit(trouser), boneTransform(rootMat, hip, knee, thighW, tmpMat));
    emit(limbUnit(trouser), boneTransform(rootMat, knee, foot, shinW, tmpMat));
    if (q.lod === 2) continue;
    // Foot: a flat box pointing forward.
    matCompose(foot.x + 0.045 * Sc, foot.y, foot.z, 0, 0, 0,
      0.22 * Sc, 0.1 * Sc, 0.06 * Sc, tmpMat2);
    emit(footUnit('#14161c'), matMul(rootMat, tmpMat2, tmpMat), outline, 1.08);
  }

  // --- pelvis and torso -----------------------------------------------------
  emit(pelvisMesh(a, f), partTransform(rootMat, sk.hip, 0, 0, tw * 0.4, Sc * build, tmpMat, Sc * build, Sc));
  emit(torsoMesh(a, f), boneTransform(rootMat, sk.hip, neck, Sc * build, tmpMat, tw));

  // --- coat -----------------------------------------------------------------
  if (q.detail > 0) {
    const co = sk.P.rig.coat;
    matCompose(sk.hip.x + co.x * 0.5, sk.hip.y + co.y * 0.5, sk.hip.z + 0.02 * Sc,
      co.y * 0.5, -co.x * 0.7, tw * 0.6, Sc * build, Sc * build, Sc, tmpMat2);
    emit(coatMesh(a, f), matMul(rootMat, tmpMat2, tmpMat), outline, 1.05);
  }

  // --- arms -----------------------------------------------------------------
  const upW = LIMB_W.upperArm * Sc * build;
  const foW = LIMB_W.foreArm * Sc * build;
  emit(armUnit(sleeve), boneTransform(rootMat, sL, eL, upW, tmpMat));
  emit(armUnit(sleeve), boneTransform(rootMat, sR, eR, upW, tmpMat));
  emit(limbUnit(sleeve), boneTransform(rootMat, eL, hL, foW, tmpMat));
  emit(limbUnit(sleeve), boneTransform(rootMat, eR, hR, foW, tmpMat));

  // Hands, oriented along the forearm.
  for (const [e, h] of q.lod === 2 ? [] : [[eL, hL], [eR, hR]]) {
    const dx = h.x - e.x, dy = h.y - e.y, dz = h.z - e.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    const tip = { x: h.x + dx / L * 0.1 * Sc, y: h.y + dy / L * 0.1 * Sc, z: h.z + dz / L * 0.1 * Sc };
    emit(handUnit(glove), boneTransform(rootMat, h, tip, 0.085 * Sc * build, tmpMat), outline, 1.1);
  }

  // --- head -----------------------------------------------------------------
  const hr = sk.P.rig.hair;
  const headMat = partTransform(rootMat, head,
    hr.y * 0.8, sk.headPitch - hr.x * 0.8, tw * 1.1 + sk.headYaw, Sc, tmpMat);
  emit(q.lod === 0 ? headMesh(a) : headMeshLow(a), headMat, outline, 1.05);
  const mane = maneMesh(a);
  if (mane && q.detail > 0) {
    matCompose(head.x - 0.01 * Sc + hr.x * 0.4, head.y + hr.y * 0.4, head.z + 0.16 * Sc,
      hr.y * 1.6, -hr.x * 1.6 + 0.12, tw * 1.1, Sc, Sc, Sc, tmpMat2);
    emit(mane, matMul(rootMat, tmpMat2, tmpMat), false);
  }

  // --- cursed tool ----------------------------------------------------------
  const tm = q.lod < 2 ? toolMesh(f.tool) : null;
  if (tm) {
    // The grip sits in the lead hand; the blade continues the forearm line.
    const dx = hR.x - eR.x, dy = hR.y - eR.y, dz = hR.z - eR.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    const tipV = { x: hR.x + dx / L, y: hR.y + dy / L, z: hR.z + dz / L };
    // Blades stand proud of the fist rather than continuing straight out of it.
    const bend = f.tool.shape === 'blade' || f.tool.shape === 'cleaver' ? 0.9 : 0.25;
    const up = { x: tipV.x - dz / L * bend, y: tipV.y, z: tipV.z + dx / L * bend + bend * 0.5 };
    emit(tm, boneTransform(rootMat, hR, up, Sc, tmpMat, 0), q.outlines, 1.03);
  }
}

// ---------------------------------------------------------------------------
// Curses
// ---------------------------------------------------------------------------

function drawCurseBody(dl, cam, f, sk, S, q, time) {
  const model = buildCurse(f);
  const Sc = (f.height || 1.75) / 1.75 * (model.h ? 1.75 / 1.75 : 1);
  // Curse models are authored at their own natural height; normalise to the
  // fighter's actual height so scale stays a data-driven stat.
  const k = (f.height || 1.75) / (model.h || 1.75);
  const t = time + f.id * 1.7;
  const P = sk.P;
  const walkPhase = Math.sin(f.anim.walk * 1.3);
  const moving = clamp01(Math.hypot(f.vel.x, f.vel.y) / 5);
  const strike = P.strike * (1 - P.follow * 0.7);
  const windup = P.windup * (1 - P.strike);
  const float = (model.float || 0) * k + (model.float ? Math.sin(t * 1.6) * 0.09 * k : 0);
  const breathe = 1 + Math.sin(t * 2.1) * 0.022;

  const outline = q.outlines && q.detail > 0;
  const ink = [7, 6, 11];

  for (let i = 0; i < model.parts.length; i++) {
    const p = model.parts[i];
    let x = p.x, y = p.y, z = p.z;
    let rx = p.rx, ry = p.ry, rz = p.rz;
    let s = p.s;

    switch (p.anim) {
      case 'look':
        rz += clamp(f.anim.lean || 0, -0.4, 0.4) * 0.3 + Math.sin(t * 0.9) * 0.08;
        ry += strike * 0.25;
        break;
      case 'jaw':
        ry += (0.25 + strike * 1.0 + Math.sin(t * 1.3) * 0.08);
        z -= strike * 0.05;
        break;
      case 'armL':
      case 'legL':
        ry += 2.6 + walkPhase * 0.55 * moving - strike * 1.3;
        break;
      case 'armR':
      case 'legR':
        ry += 2.6 - walkPhase * 0.55 * moving - strike * 1.6;
        break;
      case 'scytheL':
        ry += -windup * 0.9 + strike * 1.9;
        break;
      case 'scytheR':
        ry += -windup * 0.9 + strike * 1.9;
        break;
      case 'wingL':
        rz += 0.4 + Math.sin(t * 7) * 0.55;
        break;
      case 'wingR':
        rz += -0.4 - Math.sin(t * 7) * 0.55;
        break;
      case 'tail':
        rz += Math.sin(t * 2.4) * 0.5 + walkPhase * 0.3;
        break;
      case 'sway':
        rz += Math.sin(t * 1.1) * 0.22;
        rx += Math.sin(t * 0.8) * 0.1;
        break;
      case 'wheel':
        rz += t * 1.3;
        break;
      default:
        if (p.anim && p.anim.startsWith('coil')) {
          const n = +p.anim.slice(4);
          rz += Math.sin(t * 2.6 - n * 0.7) * 0.34 * (0.4 + moving);
          y += Math.sin(t * 2.6 - n * 0.7) * 0.16;
        }
        break;
    }

    // At range the staring eyes and teeth stop reading; skip them entirely.
    if (q.lod === 2 && (p.anim === 'look' || p.anim === 'jaw')) continue;

    const w = p.w ?? s;
    matCompose(x * k, y * k, z * k * breathe + float, rx, ry, rz,
      w * k, w * k, s * k * breathe, tmpMat2);
    matMul(rootMat, tmpMat2, tmpMat);
    drawMesh(dl, cam, p.mesh, tmpMat, S);
    if (outline) drawOutline(dl, cam, p.mesh, tmpMat, 1.05, ink);
  }
}

// ---------------------------------------------------------------------------
// Auras and defensive reads
// ---------------------------------------------------------------------------

const auraDome = () => cached('auraDome', () => domeMesh(1, 12, 6, '#ffffff', 1));
const auraRing = () => cached('auraRing', () => ringMesh(0.86, 1, 28, '#ffffff', 1));
const auraSphere = () => cached('auraSphere', () => sphere(1, 10, 7, '#ffffff'));

function drawAuras(dl, cam, f, sk, S, q, time, fade) {
  const H = f.height;
  const cx = f.pos.x, cy = f.pos.y, cz = f.z;

  // Infinity — a faint refractive bubble that never quite touches the body, and
  // ripples hard for a moment whenever it eats a hit.
  if (f.technique?.aura === 'infinity' && f.ce > 0 && !f.dead) {
    const flick = clamp01(f.infinityFlicker / 0.22);
    const r = (f.radius + 0.42) * (1 + flick * 0.22);
    matCompose(cx, cy, cz + H * 0.5, 0, 0, time * 0.3, r, r, H * 0.62 * (1 + flick * 0.1), tmpMat);
    S.additive = true; S.alpha = 0.1 + Math.sin(time * 2.4) * 0.02 + flick * 0.4;
    S.tint = [0.55, 0.8, 1.2];
    drawMesh(dl, cam, auraSphere(), tmpMat, S);
    S.additive = false; S.alpha = fade; S.tint = null;
  }

  // Simple Domain: a hard circle on the floor, the size of the real radius.
  if (f.simpleDomain?.active && !f.dead) {
    const r = 2.21;
    const pulse = 0.55 + Math.sin(time * 6) * 0.14;
    matCompose(cx, cy, 0.04, 0, 0, time * 0.7, r, r, 1, tmpMat);
    S.additive = true; S.alpha = pulse; S.tint = [0.7, 0.85, 1.25];
    drawMesh(dl, cam, auraRing(), tmpMat, S);
    // The dome skin over it, barely there.
    matCompose(cx, cy, 0.03, 0, 0, -time * 0.4, r, r, r * 0.55, tmpMat);
    S.alpha = 0.075;
    drawMesh(dl, cam, auraDome(), tmpMat, S);
    S.additive = false; S.alpha = fade; S.tint = null;
  }

  // Domain Amplification: violet energy clinging to the skin.
  if (f.amplify?.active && !f.dead) {
    const r = (f.radius + 0.18);
    const p = 0.16 + Math.sin(time * 11) * 0.05;
    matCompose(cx, cy, cz + H * 0.5, 0, 0, -time * 1.6, r, r, H * 0.55, tmpMat);
    S.additive = true; S.alpha = p; S.tint = [1.1, 0.5, 1.4];
    drawMesh(dl, cam, auraSphere(), tmpMat, S);
    S.additive = false; S.alpha = fade; S.tint = null;
  }

  // Reverse Cursed Technique: positive energy streaming upward.
  if (f.state === 'rct') {
    const r = f.radius + 0.3;
    matCompose(cx, cy, 0.05, 0, 0, time * 2.2, r, r, 1, tmpMat);
    S.additive = true; S.alpha = 0.5; S.tint = [0.6, 1.4, 1.0];
    drawMesh(dl, cam, auraRing(), tmpMat, S);
    matCompose(cx, cy, 0.05 + (time * 1.6 % 1) * H, 0, 0, -time * 1.4,
      r * 0.8, r * 0.8, 1, tmpMat);
    S.alpha = 0.32 * (1 - (time * 1.6 % 1));
    drawMesh(dl, cam, auraRing(), tmpMat, S);
    S.additive = false; S.alpha = fade; S.tint = null;
  }

  // Charging a technique or a domain: energy gathering at the feet.
  if (f.state === 'cast' || f.state === 'domainCast') {
    const prog = f.state === 'domainCast'
      ? clamp01((f.domainCast?.t || 0) / Math.max(0.01, f.domainCast?.dur || 1))
      : clamp01((f.cast?.t || 0) / Math.max(0.01, f.cast?.ability?.castTime || 0.4));
    const col = hexToRgb(f.technique?.color || f.color || '#8ad8ff');
    const tintV = [col[0] / 160, col[1] / 160, col[2] / 160];
    const r = lerp(f.radius + 1.6, f.radius + 0.4, prog);
    matCompose(cx, cy, 0.05, 0, 0, time * (1 + prog * 5), r, r, 1, tmpMat);
    S.additive = true; S.alpha = 0.35 + prog * 0.4; S.tint = tintV;
    drawMesh(dl, cam, auraRing(), tmpMat, S);
    if (q.detail > 0) {
      const rr = f.radius + 0.25 + prog * 0.3;
      matCompose(cx, cy, cz + H * 0.45, 0, 0, -time * 2, rr, rr, H * 0.5, tmpMat);
      S.alpha = 0.1 + prog * 0.2;
      drawMesh(dl, cam, auraSphere(), tmpMat, S);
    }
    S.additive = false; S.alpha = fade; S.tint = null;
  }

  // Black Flash window open: the world's colour drains toward the fist.
  if (f.flashWindow?.active) {
    const r = f.radius + 0.5;
    matCompose(cx, cy, cz + H * 0.55, 0, 0, time * 4, r, r, r, tmpMat);
    S.additive = true; S.alpha = 0.16; S.tint = [1.4, 0.4, 0.5];
    drawMesh(dl, cam, auraSphere(), tmpMat, S);
    S.additive = false; S.alpha = fade; S.tint = null;
  }
}

export { drawHumanoid, drawCurseBody, drawAuras };
