// Hand signs.
//
// A sorcerer does not simply press a button: the hands go up first, and the
// shape they make is the tell. The show leans on this hard — the camera cuts
// to the hands, holds, and only then does the technique land. This module
// gives the game the same beat.
//
// Two halves:
//
//   * Geometry. A hand is a palm plus five fingers, each finger a short chain
//     of boxes that can be curled. Curling all five gives a fist, curling
//     none gives a flat palm, and curling everything but two gives the
//     two-finger sign that precedes a domain. The meshes are baked once per
//     (shape, colour) and cached, because a hand is ~70 triangles and rebuilding
//     it every frame would cost more than the rest of the body.
//
//   * A vocabulary. Named signs, each one a finger arrangement for both hands
//     plus where to hold them relative to the chest. Techniques name a sign in
//     their data; anything that does not gets one picked from its shape, so a
//     new technique is never signless.
//
// Local hand space matches the body: +x forward, +y left, +z up, origin at the
// wrist. A hand is authored for a 1.75m body and scaled at draw time.

import { MeshBuilder, box, taperedBox } from './geom3.js';
import { matCompose } from './core3.js';
import { shade, cached } from './models3.js';

// Hand proportions, in units where the whole hand from wrist to fingertip is
// about 1. A real palm is longer than it is wide and much thinner than either;
// getting that wrong reads as a mitten, so the numbers are deliberate.
const PALM_L = 0.52;
const PALM_W = 0.42;
const PALM_T = 0.13;

// Fingers. `y` is the knuckle across the palm, `len` a fraction of PALM_L,
// `w` a fraction of PALM_W, `splay` the fan within the palm plane.
const FINGERS = [
  { name: 'thumb', y: -0.40, z: -0.10, len: 0.62, w: 0.26, splay: -0.80 },
  { name: 'index', y: -0.26, z: 0.10, len: 0.90, w: 0.23, splay: -0.12 },
  { name: 'middle', y: -0.02, z: 0.12, len: 1.00, w: 0.23, splay: 0.00 },
  { name: 'ring', y: 0.22, z: 0.08, len: 0.92, w: 0.21, splay: 0.12 },
  { name: 'little', y: 0.44, z: 0.02, len: 0.72, w: 0.18, splay: 0.26 },
];

/**
 * How far each finger is curled, 0 straight to 1 closed, for every sign.
 *
 * Order is thumb, index, middle, ring, little. These are the shapes the game
 * actually needs rather than a complete mudra set: a flat palm to push with, a
 * fist to hit with, the two-finger sign a domain opens on, a single point for
 * anything aimed, and interlocked hands for the techniques that clasp.
 */
export const SIGN_SHAPES = {
  open:     [0.10, 0.04, 0.02, 0.04, 0.10],
  fist:     [0.85, 1.00, 1.00, 1.00, 1.00],
  point:    [0.70, 0.02, 1.00, 1.00, 1.00],
  two:      [0.80, 0.02, 0.04, 1.00, 1.00],
  claw:     [0.45, 0.50, 0.52, 0.50, 0.45],
  pinch:    [0.55, 0.55, 0.20, 0.10, 0.10],
};

// Primitives here run base-at-origin along +z (see taperedBox), so a finger
// pointing forward is a box rotated a quarter turn about y. Curling then just
// means adding to that angle: at PI/2 the segment points along +x, and beyond
// it tips down toward the palm.
const QUARTER = Math.PI / 2;

function fingerMesh(b, mat, curl, len, w, color) {
  // Three phalanges, each shorter and thinner than the last. The curl is
  // cumulative across them, so a closed finger rolls into the palm rather than
  // folding flat at one hinge.
  const segs = [
    { l: 0.42 * len, w: w, bend: 1.00 },
    { l: 0.33 * len, w: w * 0.88, bend: 1.25 },
    { l: 0.25 * len, w: w * 0.76, bend: 1.05 },
  ];
  let x = 0, z = 0, ang = 0;
  const m = new Float32Array(16);
  for (const s of segs) {
    ang += curl * s.bend;
    matCompose(x, 0, z, 0, QUARTER + ang, 0, s.w, s.w * 0.86, s.l, m);
    // (box() is centred in x and y, so only the length axis needed anchoring.)
    b.merge(box(1, 1, 1, color), matMulLocal(mat, m));
    // Advance to the far end of the segment we just placed.
    x += Math.cos(ang) * s.l;
    z -= Math.sin(ang) * s.l;
  }
}

// A small local matMul for the one nested transform this module needs. The
// result buffer is shared, which is safe because MeshBuilder.merge() transforms
// the vertices immediately rather than keeping the matrix.
const mmTmp = new Float32Array(16);
function matMulLocal(a, b) {
  for (let r = 0; r < 4; r++) {
    const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
    for (let c = 0; c < 4; c++) {
      mmTmp[r * 4 + c] = a0 * b[c] + a1 * b[4 + c] + a2 * b[8 + c] + a3 * b[12 + c];
    }
  }
  return mmTmp;
}

/**
 * Build one hand.
 *
 * `side` is 1 for the left hand and -1 for the right, which mirrors the finger
 * splay so both hands curl inward rather than both leaning the same way.
 */
function buildHand(shape, color, side) {
  const curls = SIGN_SHAPES[shape] || SIGN_SHAPES.open;
  const b = new MeshBuilder();
  const palmL = PALM_L, palmW = PALM_W, palmT = PALM_T;
  const skin = color;
  const deep = shade(color, 0.86);

  // Palm: slightly wedge-shaped, thicker at the wrist. The primitives run
  // base-at-origin along +z, so the slab is pulled down half its thickness —
  // otherwise it sits entirely above the knuckle line and hides the fingers
  // behind its own top face.
  const pm = new Float32Array(16);
  matCompose(palmL * 0.5, 0, -palmT * 0.5, 0, 0, 0, palmL, palmW, palmT, pm);
  b.merge(taperedBox(1, 1, 0.94, 0.86, 1, skin), pm);

  // Heel of the thumb, which is what makes a fist read as a fist.
  matCompose(palmL * 0.28, -side * palmW * 0.36, -palmT * 0.5,
    0, 0, 0, palmL * 0.5, palmW * 0.3, palmT * 0.95, pm);
  b.merge(box(1, 1, 1, deep), pm);

  for (let i = 0; i < FINGERS.length; i++) {
    const f = FINGERS[i];
    const curl = curls[i];
    const isThumb = i === 0;
    // Knuckle line, with the thumb set back and out to the side.
    const kx = isThumb ? palmL * 0.42 : palmL;
    const ky = side * f.y * palmW;
    const kz = f.z * palmT;
    const m = new Float32Array(16);
    // Thumbs rotate out of the palm plane; other fingers splay within it.
    const splay = side * f.splay * (isThumb ? 1 : 1 - curl * 0.6);
    matCompose(kx, ky, kz, isThumb ? side * 1.15 : 0, 0, splay, 1, 1, 1, m);
    fingerMesh(b, m, curl, f.len * palmL, f.w * palmW, i % 2 ? skin : shade(skin, 1.03));
  }

  // Everything above is authored along +x because that is how a hand is easier
  // to reason about. The rest of the renderer orients parts by stretching a
  // unit-z mesh down a bone, so the finished hand is turned a quarter turn to
  // put the fingers along +z and fit that convention.
  const turned = new MeshBuilder();
  const swap = new Float32Array(16);
  matCompose(0, 0, 0, 0, -QUARTER, 0, 1, 1, 1, swap);
  turned.merge(b.build(), swap);
  return turned.build();
}

/** Cached hand mesh for a shape, colour and side. */
export function handMesh(shape, color, side) {
  return cached(`hand:${shape}:${color}:${side}`, () => buildHand(shape, color, side));
}

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

/**
 * A sign is what the hands do, and where.
 *
 * `L`/`R` name the finger shapes. `hold` is where the hands sit relative to
 * the chest in local body space, `spread` how far apart, `roll` how the palms
 * are turned, and `face` whether the hands are held up in front of the face
 * (the domain read) or lower at the sternum.
 *
 * `dir` is which way the fingers point, in body space (+x forward, +y left,
 * +z up). Without it a hand just follows the forearm, which for anything held
 * in front of the chest aims it straight at the viewer and hides the shape
 * that is the entire reason the hand is up.
 */
export const SIGNS = {
  // The sure-hit sign: both hands up, two fingers extended, held at the face.
  domain: {
    L: 'two', R: 'two', hold: 0.58, height: 0.02, spread: 0.24,
    dir: [0.22, 0, 1], roll: 0.0, face: 1, name: 'Domain',
  },
  // Palms pressed together, the gather before something is pushed out.
  press: {
    L: 'open', R: 'open', hold: 0.54, height: -0.04, spread: 0.18,
    dir: [0.62, 0, 0.78], roll: 0.0, face: 0.35, name: 'Press',
  },
  // One hand aimed down the sightline, the other braced at the elbow.
  aim: {
    L: 'open', R: 'point', hold: 0.60, height: 0.0, spread: 0.34,
    dir: [1, 0, 0.06], roll: 0.25, face: 0.2, name: 'Aim',
  },
  // Fingers hooked, for anything that tears or grips.
  rend: {
    L: 'claw', R: 'claw', hold: 0.52, height: -0.02, spread: 0.40,
    dir: [0.86, 0, 0.30], roll: -0.3, face: 0.3, name: 'Rend',
  },
  // Thumb and middle together: the snap that precedes a detonation.
  snap: {
    L: 'fist', R: 'pinch', hold: 0.54, height: 0.06, spread: 0.38,
    dir: [0.48, 0, 0.66], roll: 0.1, face: 0.6, name: 'Snap',
  },
  // Both fists drawn in, for the techniques that are just force.
  brace: {
    L: 'fist', R: 'fist', hold: 0.44, height: -0.08, spread: 0.40,
    dir: [0.74, 0, -0.18], roll: 0.0, face: 0.1, name: 'Brace',
  },
};

/**
 * The sign a given ability uses.
 *
 * Data wins: an ability with `sign: 'snap'` gets that. Otherwise one is
 * inferred from what the ability does, so every technique in the game shows
 * hands doing something rather than only the handful that were annotated.
 */
export function signFor(ability) {
  if (!ability) return null;
  if (ability.sign === false) return null;
  if (ability.sign && SIGNS[ability.sign]) return SIGNS[ability.sign];
  if (ability.ultimate) return SIGNS.press;
  switch (ability.kind) {
    case 'beam': return SIGNS.aim;
    case 'projectile': return SIGNS.aim;
    case 'cone': return SIGNS.press;
    case 'summon': return SIGNS.snap;
    case 'buff':
    case 'heal': return SIGNS.press;
    case 'melee':
    case 'dash': return SIGNS.brace;
    case 'aoe': return SIGNS.rend;
    default: return SIGNS.press;
  }
}
