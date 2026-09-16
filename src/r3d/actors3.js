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
  buildCurse, shade, eyeMesh, LIMB_W, cached, paintTone, UNIFORM_TONE,
} from './models3.js';
import { boneTransform, partTransform } from './models3.js';
import { handMesh } from './hands3.js';
import {
  MeshBuilder, taperedBox,
} from './geom3.js';

/** How much larger than life the head is drawn. */
const HEAD_SCALE = 1.34;

const rootMat = new Float32Array(16);
const tmpMat = new Float32Array(16);
const tmpMat2 = new Float32Array(16);

const V = (x, y, z) => ({ x, y, z });

// Cached unit meshes reused across every fighter.
// Limb profiles. These used to be one shape used four times, which is why the
// legs read as two rectangles with a seam across them: a thigh that ends as
// wide as the shin begins has no knee, and a shin that ends as wide as it
// starts has no ankle for the foot to sit on. Each segment now tapers the way
// the limb it stands for does — hard into the knee, hard into the ankle and
// the wrist, with the calf and the elbow left a touch proud of the joint above
// them so the break reads.
const limbUnit = (c) => cached(`limbU:${c}`, () => taperedBox(1, 0.9, 0.66, 0.6, 1, c));
const thighUnit = (c) => cached(`thighU:${c}`, () => taperedBox(1, 0.92, 0.74, 0.68, 1, c));
const shinUnit = (c) => cached(`shinU:${c}`, () => taperedBox(1, 0.95, 0.56, 0.5, 1, c));
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
  // In first person the camera is inside the player's own head. Their torso,
  // legs and face are either behind the lens or filling it, so the body draws
  // as a view model: arms, hands and whatever they are holding, nothing else.
  const viewModel = !!f.isPlayer && (cam.fpv || 0) > 0.55;
  const L = {
    lod,
    // Every character carries a line, near or far. A distant figure losing
    // its contour is exactly the case where it most needs one to stay
    // readable against the ground.
    outlines: q.outlines && lod < 2,
    inkScale: q.inkScale ?? 1,
    // Interior seams only on the near tier. Further out they are sub-pixel and
    // the contour is doing all the work anyway.
    interior: lod === 0 && (q.detail ?? 2) > 0,
    detail: lod === 0 ? q.detail : lod === 1 ? Math.min(1, q.detail) : 0,
    viewModel,
  };

  // Characters are lit for the shot; backgrounds are painted flat.
  //
  // This is not a cheat, it is how the work is actually made: a background is
  // a painting with its lighting baked in and deliberately held back, and the
  // characters on top of it are cel-lit separately and harder, so that the
  // figure is always the highest-contrast thing in the frame. Sharing one
  // lighting rig between the two is why a fighter at distance was sinking into
  // the trees — the trees were coming out brighter than the people.
  //
  // A lower floor gives the shadow side somewhere to go; a stronger key widens
  // the gap across the terminator; a stronger rim carves the silhouette off
  // whatever is behind it.
  const envAmbient = S.ambient;
  const envKey = S.key;
  const envRim = S.rim;
  S.ambient = 0.30;
  S.key = 0.74;
  S.rim = 0.62;

  const sk = pose3(f, time);
  const P = sk.P;
  const r = P.rig;

  // --- ground shadow --------------------------------------------------------
  //
  // A dark ellipse on the floor, which is what you draw when you cannot afford
  // to render the scene from the sun's point of view. Where the GPU backend is
  // casting real shadows this would sit underneath one and read as a smudge,
  // so it stands down.
  if (!(dl.gpu && dl.gpu.castingShadows)) {
    const shR = f.radius * 1.5 * (1 - clamp01(f.z / 4) * 0.45);
    matCompose(f.pos.x, f.pos.y, 0.015, 0, 0, 0, shR, shR, 1, tmpMat);
    S.alpha = 0.34 * fade * (1 - clamp01(f.z / 5) * 0.6);
    S.additive = false;
    S.tint = null;
    drawMesh(dl, cam, shadowMesh(), tmpMat, S);
    S.alpha = fade;
  }

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

  // Hand the environment's lighting back before anything else draws.
  S.ambient = envAmbient;
  S.key = envKey;
  S.rim = envRim;

  // --- auras ----------------------------------------------------------------
  S.tint = null;
  // Your own aura seen from inside it is a wall of colour, so it is thinned
  // rather than dropped: you still get the tell that you are amped.
  drawAuras(dl, cam, f, sk, S, L, time, viewModel ? fade * 0.35 : fade);
  S.alpha = 1;
}

// ---------------------------------------------------------------------------
// Humanoid
// ---------------------------------------------------------------------------

function drawHumanoid(dl, cam, f, sk, S, q, time, a) {
  const Sc = sk.S;
  const build = sk.build;
  // Character paint sits in a mid-tone, not near-black — see paintTone().
  const skin = a.skin || '#e9c8ac';
  const uniform = paintTone(a.uniform || f.color2 || '#171a22', UNIFORM_TONE);
  const sleeve = shade(uniform, 1.05);
  const trouser = shade(uniform, 0.8);
  // Gloves when a weapon is being carried, but a shade off the uniform rather
  // than well above it — at 1.3 they came out as the brightest thing on the
  // whole figure, so a fighter read as two white blocks floating at the ends
  // of their arms.
  // Gloves when a weapon is being carried, but a shade off the uniform rather
  // than well above it — at 1.3 they came out as the brightest thing on the
  // whole figure, so a fighter read as two white blocks floating at the ends
  // of their arms. Bare hands get the same treatment for the same reason: a
  // hand hangs below the light and is never the brightest skin on a figure.
  const glove = a.accent && f.tool && f.tool.shape !== 'none'
    ? shade(uniform, 1.12) : shade(skin, 0.86);

  // Upper body twist.
  const tw = sk.twist;
  const ts = Math.sin(tw), tc = Math.cos(tw);
  const T = tw ? (p) => twistPoint(p, ts, tc) : (p) => p;

  const chest = T(sk.chest), neck = T(sk.neck), head = T(sk.head);
  const sL = T(sk.sL), sR = T(sk.sR);
  const eL = T(sk.eL), eR = T(sk.eR), hL = T(sk.hL), hR = T(sk.hR);

  const outline = q.outlines;
  const ink = [8, 8, 12];
  const inkK = q.inkScale ?? 1;
  // `olScale` is an ink width in pixels, not a hull scale.
  const inner = !!q.interior;
  const emit = (mesh, mat, ol = outline, olScale = 2.4) => {
    drawMesh(dl, cam, mesh, mat, S);
    if (ol) drawOutline(dl, cam, mesh, mat, 1, ink, olScale * inkK, inner);
  };

  const vm = q.viewModel;

  // --- legs -----------------------------------------------------------------
  const thighW = LIMB_W.thigh * Sc * build;
  const shinW = LIMB_W.shin * Sc * build;
  for (const k of vm ? [] : ['L', 'R']) {
    const hip = sk['hip' + k], knee = sk['k' + k], foot = sk['f' + k];
    emit(thighUnit(trouser), boneTransform(rootMat, hip, knee, thighW, tmpMat));
    emit(shinUnit(trouser), boneTransform(rootMat, knee, foot, shinW, tmpMat));
    if (q.lod === 2) continue;
    // Foot: a flat box pointing forward.
    matCompose(foot.x + 0.045 * Sc, foot.y, foot.z, 0, 0, 0,
      0.22 * Sc, 0.1 * Sc, 0.06 * Sc, tmpMat2);
    emit(footUnit('#14161c'), matMul(rootMat, tmpMat2, tmpMat), outline, 2.0);
  }

  // --- pelvis and torso -----------------------------------------------------
  if (!vm) {
    emit(pelvisMesh(a, f), partTransform(rootMat, sk.hip, 0, 0, tw * 0.4, Sc * build, tmpMat, Sc * build, Sc));
    emit(torsoMesh(a, f), boneTransform(rootMat, sk.hip, neck, Sc * build, tmpMat, tw));
  }

  // --- coat -----------------------------------------------------------------
  if (q.detail > 0 && !vm) {
    const co = sk.P.rig.coat;
    matCompose(sk.hip.x + co.x * 0.5, sk.hip.y + co.y * 0.5, sk.hip.z + 0.02 * Sc,
      co.y * 0.5, -co.x * 0.7, tw * 0.6, Sc * build, Sc * build, Sc, tmpMat2);
    emit(coatMesh(a, f), matMul(rootMat, tmpMat2, tmpMat), outline, 2.4);
  }

  // --- arms -----------------------------------------------------------------
  const upW = LIMB_W.upperArm * Sc * build;
  const foW = LIMB_W.foreArm * Sc * build;

  // The smear.
  //
  // During the one or two frames a strike actually occupies, an animator does
  // not draw the arm twice in two places — they draw one elongated shape
  // spanning where it was and where it is. That shape is only available
  // because the pose is held: `sk.prev` is the drawing this one replaced, so
  // the smear is literally the gap between two drawings rather than a motion
  // blur bolted on after the fact.
  //
  // It is drawn before the arm so the arm sits on top of it, and it is the
  // same flat colour as the sleeve rather than a transparent trail, because
  // that is what is on the cel.
  const P = sk.P;
  const smearing = P.strike > 0.05 && P.follow < 0.55 && sk.prev && !vm;
  if (smearing) {
    const reach = Math.hypot(hR.x - sk.prev.hR.x, hR.y - sk.prev.hR.y, hR.z - sk.prev.hR.z);
    // Below a finger's width of travel there is nothing to smear, and drawing
    // one anyway just fattens the arm.
    if (reach > 0.12 * Sc) {
      emit(limbUnit(shade(sleeve, 1.12)),
        boneTransform(rootMat, sk.prev.hR, hR, foW * 0.86, tmpMat), outline, 1.6);
      emit(limbUnit(shade(sleeve, 1.12)),
        boneTransform(rootMat, sk.prev.eR, eR, upW * 0.7, tmpMat), false);
    }
  }

  emit(armUnit(sleeve), boneTransform(rootMat, sL, eL, upW, tmpMat));
  emit(armUnit(sleeve), boneTransform(rootMat, sR, eR, upW, tmpMat));
  emit(limbUnit(sleeve), boneTransform(rootMat, eL, hL, foW, tmpMat));
  emit(limbUnit(sleeve), boneTransform(rootMat, eR, hR, foW, tmpMat));

  // Hands, oriented along the forearm. While a sign is up they are real hands
  // with fingers rather than the usual stub, because the shape the fingers
  // make is the whole point of a sign.
  const sign = sk.sign;
  const pairs = q.lod === 2 ? [] : [[eL, hL, 'L'], [eR, hR, 'R']];
  for (const [e, h, side] of pairs) {
    const dx = h.x - e.x, dy = h.y - e.y, dz = h.z - e.z;
    const L = Math.hypot(dx, dy, dz) || 1;
    if (sign && q.lod === 0) {
      // Hand meshes are authored running along +z from the wrist, so they
      // orient with the same angles boneTransform derives for a bone — but at
      // uniform scale, since a hand does not stretch with the forearm.
      //
      // The direction comes from the sign rather than the forearm: a hand held
      // in front of the chest has a forearm pointing at the viewer, which
      // would show the sign end-on and hide the shape entirely. The sign's
      // `dir` is in body space, and the whole body is already rotated by
      // rootMat, so it needs no yawing here.
      const sd = sign.dir;
      const mirror = side === 'L' ? 1 : -1;
      let ax = sd[0], ay = sd[1] * mirror, az = sd[2];
      const aL = Math.hypot(ax, ay, az) || 1;
      ax /= aL; ay /= aL; az /= aL;
      const ry = Math.acos(clamp(az, -1, 1));
      const rz = Math.atan2(ay, ax);
      const hs = 0.2 * Sc * build;
      const mesh = handMesh(side === 'L' ? sign.L : sign.R, skin, side === 'L' ? 1 : -1);
      // No ink on a hand. The outline pass offsets each back face by a fixed
      // number of screen pixels, which on finger-sized triangles is wider than
      // the triangle itself and bursts them into spikes.
      emit(mesh, partTransform(rootMat, h, sign.roll, ry, rz, hs, tmpMat), false);
    } else {
      const tip = { x: h.x + dx / L * 0.1 * Sc, y: h.y + dy / L * 0.1 * Sc, z: h.z + dz / L * 0.1 * Sc };
      emit(handUnit(glove), boneTransform(rootMat, h, tip, 0.085 * Sc * build, tmpMat), outline, 2.0);
    }
  }

  // --- head -----------------------------------------------------------------
  // Anime proportion, not anatomical: the head carries the character's whole
  // identity, so it is drawn a third larger than a real one relative to the
  // body and tucked down slightly so the chin still meets the shoulders.
  const hr = sk.P.rig.hair;
  const hs = Sc * HEAD_SCALE;
  const headAnchor = { x: head.x, y: head.y, z: head.z - 0.055 * Sc };
  const headMat = partTransform(rootMat, headAnchor,
    hr.y * 0.8, sk.headPitch - hr.x * 0.8, tw * 1.1 + sk.headYaw, hs, tmpMat);
  if (!vm) emit(q.lod === 0 ? headMesh(a) : headMeshLow(a), headMat, outline, 2.6);
  const mane = maneMesh(a);
  if (mane && q.detail > 0 && !vm) {
    matCompose(head.x - 0.01 * hs + hr.x * 0.4, head.y + hr.y * 0.4,
      headAnchor.z + 0.2 * hs,
      hr.y * 1.6, -hr.x * 1.6 + 0.12, tw * 1.1, hs, hs, hs, tmpMat2);
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
    emit(tm, boneTransform(rootMat, hR, up, Sc, tmpMat, 0), q.outlines, 2.0);
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

  const outline = q.outlines;
  const ink = [7, 6, 11];
  const inkK = q.inkScale ?? 1;

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
    if (outline) drawOutline(dl, cam, p.mesh, tmpMat, 1, ink, 2.4 * inkK, !!q.interior);
  }
}

// ---------------------------------------------------------------------------
// Auras and defensive reads
// ---------------------------------------------------------------------------

const auraDome = () => cached('auraDome', () => domeMesh(1, 12, 6, '#ffffff', 1));
const auraRing = () => cached('auraRing', () => ringMesh(0.86, 1, 28, '#ffffff', 1));
const auraSphere = () => cached('auraSphere', () => sphere(1, 12, 8, '#ffffff'));
const auraBolt = () => cached('auraBolt', () => cylinder(1, 0.2, 1, 5, '#ffffff'));

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

  // Charging a technique: the energy gathers in the working hand and compresses
  // as the cast completes. A ring on the floor tells you a cast is happening;
  // an orb between the hands tells you what is about to come out of them, which
  // is how every one of these techniques is actually staged on screen.
  if (f.state === 'cast' && f.cast) {
    const ab = f.cast.ability;
    const prog = clamp01(f.cast.t / Math.max(0.01, ab.castTime || 0.4));
    const hand = sk.weaponHand || sk.hR;
    const wx = rootMat[0] * hand.x + rootMat[1] * hand.y + rootMat[2] * hand.z + rootMat[3];
    const wy = rootMat[4] * hand.x + rootMat[5] * hand.y + rootMat[6] * hand.z + rootMat[7];
    const wz = rootMat[8] * hand.x + rootMat[9] * hand.y + rootMat[10] * hand.z + rootMat[11];
    // The orb takes the colour of what is being cast, not of the technique as
    // a whole — Blue, Red and Purple are the same technique and three colours.
    const col = hexToRgb(ab.color || ab.projectile?.color || ab.beamColor
      || f.technique?.color || '#8ad8ff');
    const cTint = [col[0] / 140, col[1] / 140, col[2] / 140];
    // In first person the orb gathers half a metre from the lens, where a
    // full-size one is a wall of colour that hides the sign the hands are
    // making. It shrinks rather than disappears: you still see what is coming.
    const big = (ab.ultimate ? 1.9 : 1) * (q.viewModel ? 0.42 : 1);

    // The orb: starts loose and wide, converges to a dense point.
    const r = lerp(0.62, 0.2, prog) * big * (1 + Math.sin(time * 26) * 0.05);
    S.additive = true;
    S.tint = cTint;
    S.alpha = 0.3 + prog * 0.45;
    matCompose(wx, wy, wz, 0, 0, time * 2, r, r, r, tmpMat);
    drawMesh(dl, cam, auraSphere(), tmpMat, S);
    // A second, denser shell in the same colour before the white core, so the
    // orb reads as its colour rather than as a white dot with a halo.
    S.alpha = 0.55 + prog * 0.3;
    matCompose(wx, wy, wz, 0, 0, -time * 1.4, r * 0.62, r * 0.62, r * 0.62, tmpMat);
    drawMesh(dl, cam, auraSphere(), tmpMat, S);
    S.alpha = 0.85;
    S.tint = [cTint[0] * 1.5 + 0.7, cTint[1] * 1.5 + 0.7, cTint[2] * 1.5 + 0.7];
    const core = r * (0.18 + prog * 0.2);
    matCompose(wx, wy, wz, 0, 0, -time * 3, core, core, core, tmpMat);
    drawMesh(dl, cam, auraSphere(), tmpMat, S);

    // Energy falling into it from every side, tighter as the cast finishes.
    if (q.detail > 0) {
      const n = ab.ultimate ? 10 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + time * 3;
        const rr = r * lerp(4.2, 1.3, prog);
        const zz = Math.sin(a * 2 + time * 4) * r * 1.4;
        S.alpha = 0.34 * (0.4 + prog * 0.6);
        S.tint = cTint;
        matCompose(wx + Math.cos(a) * rr, wy + Math.sin(a) * rr, wz + zz,
          0, PI / 2, a + PI / 2, 0.035 * big, 0.035 * big, rr * 0.7, tmpMat);
        drawMesh(dl, cam, auraBolt(), tmpMat, S);
      }
      // Rings compressing onto the orb.
      for (let i = 0; i < 2; i++) {
        const ph = ((time * 1.6 + i * 0.5) % 1);
        const rr = r * lerp(3.6, 1.05, ph);
        S.alpha = 0.4 * ph * (0.3 + prog * 0.7);
        matCompose(wx, wy, wz, PI / 2.3 + i * 0.7, time * (1.2 + i), time * 0.6,
          rr, rr, 1, tmpMat);
        drawMesh(dl, cam, auraRing(), tmpMat, S);
      }
    }
    S.additive = false;
    S.alpha = fade;
    S.tint = null;
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
