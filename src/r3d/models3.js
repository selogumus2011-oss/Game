// Procedural low-poly models.
//
// Nothing here is authored by hand in a modelling tool — every mesh is built
// from the primitives in geom3.js and cached by a key derived from the palette,
// so a roster of 23 sorcerers and 19 curse shapes costs a few dozen buffers.
//
// Humanoids are drawn bone-by-bone from the skeleton pose3() produces. A bone
// is a unit mesh spanning z = 0..1 that gets composed onto the segment:
//
//   ry = acos(dz / L), rz = atan2(dy, dx)
//
// because matCompose's R = Rz·Ry·Rx maps local +z to
// (cos rz · sin ry, sin rz · sin ry, cos ry).

import { clamp, clamp01, lerp, TAU, PI } from '../core/math.js';
import { matCompose, matMul, matIdentity, hexToRgb, shadeColor } from './core3.js';
import {
  MeshBuilder, taperedBox, box, cylinder, cone, sphere, prism, disc, ringMesh, bake,
} from './geom3.js';
import { pose3, rig3 } from './pose3.js';

// ---------------------------------------------------------------------------
// Mesh cache
// ---------------------------------------------------------------------------

const cache = new Map();
function cached(key, build) {
  let m = cache.get(key);
  if (m === undefined) { m = build(); cache.set(key, m); }
  return m;
}

/** Darken or lighten a hex colour by a factor, returning hex. */
function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ---------------------------------------------------------------------------
// Bone plumbing
// ---------------------------------------------------------------------------

const boneMat = new Float32Array(16);
const outMat = new Float32Array(16);

/**
 * Compose a matrix that stretches a unit-z mesh from a to b, `w` wide.
 * `roll` spins the cross-section about the bone axis.
 */
export function boneTransform(root, a, b, w, out = outMat, roll = 0) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const L = Math.hypot(dx, dy, dz) || 0.0001;
  const ry = Math.acos(clamp(dz / L, -1, 1));
  const rz = Math.atan2(dy, dx);
  matCompose(a.x, a.y, a.z, roll, ry, rz, w, w, L, boneMat);
  return matMul(root, boneMat, out);
}

/** Compose a matrix for a mesh sitting at a point with its own rotation. */
export function partTransform(root, p, rx, ry, rz, s, out = outMat, sy = s, sz = s) {
  matCompose(p.x, p.y, p.z, rx, ry, rz, s, sy, sz, boneMat);
  return matMul(root, boneMat, out);
}

// ---------------------------------------------------------------------------
// Unit meshes
// ---------------------------------------------------------------------------

// A limb: square-ish section, tapering slightly toward the far end.
const limbMesh = (c) => cached(`limb:${c}`, () => taperedBox(1, 0.86, 0.78, 0.68, 1, c));
// A muscled limb with a bulge near the root.
const armMesh = (c) => cached(`arm:${c}`, () => {
  const b = new MeshBuilder();
  b.merge(taperedBox(1, 0.9, 1.12, 1.0, 0.42, c), null);
  b.merge(taperedBox(1.12, 1.0, 0.7, 0.62, 0.58, c), matCompose(0, 0, 0.42, 0, 0, 0));
  return b.build();
});
const thighMesh = (c) => cached(`thigh:${c}`, () => taperedBox(1, 0.95, 0.8, 0.78, 1, c));
const boxUnit = (c) => cached(`boxu:${c}`, () => box(1, 1, 1, c, { z0: -0.5 }));

const handMesh = (c) => cached(`hand:${c}`, () => taperedBox(0.9, 1, 0.75, 0.8, 1, c));
const footMesh = (c) => cached(`foot:${c}`, () => taperedBox(0.9, 1, 1, 0.86, 1, c, {
  topColor: shade(c, 1.1),
}));

const sphereMesh = (c, r = 1, u = 8, v = 6) => cached(`sph:${c}:${r}:${u}:${v}`,
  () => sphere(r, u, v, c));

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

/**
 * A head group baked into one mesh: skull, jaw, ears, hair, and the flat eye
 * plates that give the anime read. Built in head-local space with the origin at
 * the neck joint, +x forward, sized for a 1.0 scale body.
 */
/**
 * A shadow tone for painted shapes baked into a model.
 *
 * The band table cools its shadows because painted shadow reads through hue
 * rather than brightness; a shadow baked into geometry has to do the same or
 * it reads as a smudge next to the shaded ones around it.
 */
function shadeCool(hex, k) {
  const h = (hex || '#888888').replace('#', '');
  const p = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  const r = Math.round(Math.min(255, p[0] * k * 0.90));
  const g = Math.round(Math.min(255, p[1] * k * 0.95));
  const bl = Math.round(Math.min(255, p[2] * k * 1.14));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${bl.toString(16).padStart(2, '0')}`;
}

function headMesh(a, opts = {}) {
  const skin = a.skin || '#e9c8ac';
  const hair = a.hair || '#1b1b22';
  const style = a.hairStyle || 'short';
  const eyes = a.eyes || '#3d4a63';
  const key = `head:${skin}:${hair}:${style}:${eyes}:${a.blindfold ? 1 : 0}:${a.markings ? 1 : 0}:${a.stitches ? 1 : 0}:${opts.curse ? 1 : 0}`;
  return cached(key, () => {
    const b = new MeshBuilder();
    const dark = shade(skin, 0.86);
    const hairDark = shade(hair, 0.72);
    const hairLit = shade(hair, 1.18);

    // Skull: a rounded box, slightly deeper than wide, chin tapering forward.
    b.merge(taperedBox(0.145, 0.155, 0.17, 0.165, 0.11, skin, {
      topColor: skin, bottomColor: dark,
    }), matCompose(0.004, 0, 0.055, 0, 0, 0));
    // Cranium cap.
    b.merge(taperedBox(0.17, 0.165, 0.11, 0.115, 0.055, skin, { topColor: skin }),
      matCompose(0, 0, 0.165, 0, 0, 0));
    // Jaw / chin wedge.
    b.merge(prism([[-0.07, -0.07], [0.082, -0.05], [0.082, 0.05], [-0.07, 0.07]], 0.06, dark, {
      topColor: skin,
    }), matCompose(0.008, 0, 0, 0, 0, 0));
    // Neck.
    b.merge(cylinder(0.052, 0.05, 0.07, 6, dark), matCompose(-0.01, 0, -0.07, 0, 0, 0));
    // Ears.
    for (const s of [1, -1]) {
      b.merge(box(0.018, 0.05, 0.07, dark), matCompose(-0.015, s * 0.082, 0.055, 0, 0, 0));
    }

    // The shadow the fringe casts across the brow.
    //
    // This is the most recognisable thing about an animated face and the
    // cheapest to get: a flat shape of shadow-tone skin sitting across the
    // forehead, with a stepped lower edge rather than a straight one so it
    // reads as painted rather than as a band. Without it a face is a blank
    // light shape and no amount of correct shading elsewhere fixes it.
    if (!opts.curse) {
      const brow = shadeCool(skin, 0.68);
      // Two overlapping plates: the upper one full width, the lower one
      // narrower and offset, which gives the edge a break in it.
      b.merge(box(0.01, 0.175, 0.052, brow, { z0: -0.006 }),
        matCompose(0.0855, 0, 0.168, 0, 0, 0));
      b.merge(box(0.01, 0.105, 0.03, brow, { z0: -0.006 }),
        matCompose(0.0855, -0.022, 0.146, 0, 0, 0));
      // And the one under the jaw, which is what gives a chin its shape.
      b.merge(box(0.01, 0.12, 0.022, brow, { z0: -0.006 }),
        matCompose(0.079, 0, 0.055, 0, 0, 0));
    }

    // Eyes: flat plates set just proud of the face so they never z-fight.
    if (!a.blindfold && !opts.curse) {
      for (const s of [1, -1]) {
        b.merge(box(0.012, 0.055, 0.03, '#f6f6fa', { z0: -0.015 }),
          matCompose(0.082, s * 0.046, 0.108, 0, 0, 0));
        b.merge(box(0.014, 0.026, 0.026, eyes, { z0: -0.013 }),
          matCompose(0.086, s * 0.046, 0.108, 0, 0, 0));
        // Brow.
        b.merge(box(0.012, 0.06, 0.012, hairDark, { z0: -0.006 }),
          matCompose(0.084, s * 0.046, 0.136, 0, -0.22 * s, 0));
      }
    } else if (a.blindfold) {
      // The blindfold wraps the whole upper face and knots at the back.
      b.merge(box(0.028, 0.2, 0.062, '#101319', { z0: -0.031 }),
        matCompose(0.076, 0, 0.115, 0, 0, 0));
      b.merge(box(0.16, 0.185, 0.05, '#171b23', { z0: -0.025 }),
        matCompose(0.0, 0, 0.115, 0, 0, 0));
      b.merge(box(0.05, 0.03, 0.03, '#171b23', { z0: -0.015 }),
        matCompose(-0.105, 0.02, 0.1, 0, 0, 0.5));
    }

    // Mouth line.
    b.merge(box(0.01, 0.042, 0.008, shade(skin, 0.6), { z0: -0.004 }),
      matCompose(0.086, 0, 0.032, 0, 0, 0));

    if (a.markings) {
      for (const s of [1, -1]) {
        b.merge(box(0.008, 0.012, 0.03, '#2a1414', { z0: -0.015 }),
          matCompose(0.086, s * 0.03, 0.155, 0, 0, 0));
        b.merge(box(0.008, 0.012, 0.024, '#2a1414', { z0: -0.012 }),
          matCompose(0.08, s * 0.07, 0.09, 0, 0, 0));
      }
    }
    if (a.stitches) {
      for (let i = 0; i < 4; i++) {
        b.merge(box(0.008, 0.05, 0.008, '#3a2a2a', { z0: -0.004 }),
          matCompose(0.084, -0.02 + i * 0.018, 0.07 + i * 0.03, 0, 0, 0));
      }
    }

    // --- hair ---------------------------------------------------------------
    const cap = (h, tone) => b.merge(taperedBox(0.185, 0.18, 0.13, 0.13, h, tone, {
      topColor: hairLit,
    }), matCompose(-0.004, 0, 0.16, 0, 0, 0));

    /**
     * The fringe.
     *
     * A cap on its own is a helmet. What makes drawn hair read as hair is the
     * clumps hanging over the brow: separate wedges, pointed at the tip, of
     * uneven length, with gaps between them. The unevenness is the whole
     * trick — five identical spikes read as a crown, five different ones read
     * as hair that fell that way.
     *
     * They hang over the forehead shadow rather than above it, so the shadow
     * looks cast by them instead of painted on underneath.
     */
    const fringe = () => {
      const lens = [0.085, 0.115, 0.098, 0.125, 0.079];
      const leans = [-0.26, -0.1, 0.05, -0.14, 0.22];
      for (let i = 0; i < 5; i++) {
        const y = -0.076 + i * 0.038;
        b.merge(taperedBox(0.055, 0.042, 0.014, 0.012, lens[i], i % 2 ? hair : hairLit),
          matCompose(0.062, y, 0.215, leans[i], PI - 0.33, 0));
      }
      // Side locks, framing the face. Longer, and angled back along the cheek.
      for (const sgn of [1, -1]) {
        b.merge(taperedBox(0.06, 0.05, 0.018, 0.016, 0.155, hairDark),
          matCompose(0.028, sgn * 0.086, 0.21, sgn * 0.18, PI - 0.1, 0));
      }
    };

    switch (style) {
      case 'none': break;
      case 'buzz':
        cap(0.05, hairDark);
        break;
      case 'short':
        cap(0.075, hair);
        fringe();
        b.merge(box(0.03, 0.17, 0.05, hair), matCompose(0.075, 0, 0.19, 0, -0.3, 0));
        break;
      case 'slick':
        cap(0.07, hair);
        b.merge(taperedBox(0.14, 0.17, 0.05, 0.1, 0.1, hair), matCompose(-0.09, 0, 0.16, 0, 0.5, 0));
        break;
      case 'bob':
        cap(0.075, hair);
        fringe();
        for (const s of [1, -1]) {
          b.merge(box(0.15, 0.04, 0.17, hair), matCompose(-0.005, s * 0.095, 0.03, 0, 0, 0));
        }
        b.merge(box(0.05, 0.19, 0.19, hair), matCompose(-0.1, 0, 0.02, 0, 0, 0));
        break;
      case 'bun':
        cap(0.07, hair);
        fringe();
        b.merge(sphere(0.062, 6, 5, hair), matCompose(-0.1, 0, 0.245, 0, 0, 0));
        break;
      case 'braid':
        cap(0.07, hair);
        fringe();
        for (let i = 0; i < 4; i++) {
          b.merge(box(0.05, 0.055, 0.06, i % 2 ? hair : hairDark),
            matCompose(-0.1 - i * 0.008, 0, 0.17 - i * 0.062, 0, 0, 0));
        }
        break;
      case 'messy':
        cap(0.08, hair);
        fringe();
        for (let i = 0; i < 7; i++) {
          const ang = (i / 7) * TAU;
          b.merge(cone(0.032, 0.075 + (i % 3) * 0.02, 4, i % 2 ? hairLit : hair),
            matCompose(Math.cos(ang) * 0.07 - 0.01, Math.sin(ang) * 0.075, 0.225,
              0, 0.5 + (i % 3) * 0.2, ang));
        }
        break;
      case 'wild':
        cap(0.075, hair);
        for (let i = 0; i < 10; i++) {
          const ang = (i / 10) * TAU;
          b.merge(cone(0.03, 0.12 + (i % 4) * 0.035, 4, i % 2 ? hairLit : hair),
            matCompose(Math.cos(ang) * 0.08 - 0.01, Math.sin(ang) * 0.08, 0.2,
              0, 0.85 + (i % 3) * 0.2, ang));
        }
        break;
      case 'spiky':
      default:
        cap(0.085, hair);
        for (let i = 0; i < 13; i++) {
          const ang = (i / 13) * TAU;
          const r = 0.082;
          b.merge(cone(0.036, 0.13 + (i % 4) * 0.045, 4, i % 2 ? hairLit : hair),
            matCompose(Math.cos(ang) * r - 0.005, Math.sin(ang) * r, 0.225,
              0, 0.5 + (i % 3) * 0.28, ang));
        }
        // The fringe: three heavier locks falling forward over the brow.
        for (let i = -1; i <= 1; i++) {
          b.merge(cone(0.042, 0.16, 4, i === 0 ? hairLit : hair),
            matCompose(0.055, i * 0.055, 0.215, 0, 1.15 + Math.abs(i) * 0.12, i * 0.35));
        }
        break;
    }
    return b.build();
  });
}

/**
 * A cheap head for anything far enough away that the detail cannot be read.
 * Roughly a tenth of the triangles of the real one, and at twenty metres they
 * are indistinguishable.
 */
function headMeshLow(a) {
  const skin = a.skin || '#e9c8ac';
  const hair = a.hair || '#1b1b22';
  return cached(`headLow:${skin}:${hair}`, () => {
    const b = new MeshBuilder();
    b.merge(taperedBox(0.16, 0.17, 0.15, 0.16, 0.2, skin, { topColor: skin }),
      matCompose(0, 0, 0.005, 0, 0, 0));
    b.merge(taperedBox(0.185, 0.19, 0.13, 0.13, 0.09, hair, { topColor: shade(hair, 1.2) }),
      matCompose(-0.004, 0, 0.19, 0, 0, 0));
    if (!a.blindfold) {
      b.merge(box(0.014, 0.13, 0.026, '#20242e', { z0: -0.013 }),
        matCompose(0.082, 0, 0.115, 0, 0, 0));
    } else {
      b.merge(box(0.02, 0.2, 0.05, '#141821', { z0: -0.025 }),
        matCompose(0.076, 0, 0.115, 0, 0, 0));
    }
    return b.build();
  });
}

/** Hair that hangs and swings — drawn separately so the spring can move it. */
function maneMesh(a) {
  const hair = a.hair || '#1b1b22';
  const style = a.hairStyle || 'short';
  if (style === 'buzz' || style === 'none' || style === 'slick') return null;
  return cached(`mane:${hair}:${style}`, () => {
    const b = new MeshBuilder();
    const dark = shade(hair, 0.75);
    const long = style === 'bob' || style === 'braid' || style === 'bun' ? 0.24 : 0.12;
    for (let i = 0; i < 5; i++) {
      const y = (i - 2) * 0.042;
      b.merge(taperedBox(0.05, 0.05, 0.03, 0.03, long * (1 - Math.abs(i - 2) * 0.12),
        i % 2 ? hair : dark), matCompose(-0.09, y, -long * (1 - Math.abs(i - 2) * 0.12), 0, 0, 0));
    }
    return b.build();
  });
}

// ---------------------------------------------------------------------------
// Torso, coat, tools
// ---------------------------------------------------------------------------

/**
 * The jacket.
 *
 * This used to be three stacked boxes with a strip down the front, which under
 * flat cel shading merged into one slab with a floating red line on it. Now
 * that interior lines are drawn, the garment can carry the structure a drawn
 * one does — and has to, because the lines make the absence of it obvious.
 *
 * What a cel character's jacket actually needs, in rough order of how much it
 * matters at gameplay distance:
 *
 *   * A **shoulder seam** where the sleeve joins. It is the line that tells
 *     you an arm is an arm and not a growth off the chest.
 *   * **Lapels** — two angled panels off the collar. They break up the chest,
 *     which is otherwise the largest empty area on the whole figure.
 *   * A **hem** at the bottom, so the jacket ends rather than fading into the
 *     hips.
 *   * A **centre seam**, recessed rather than proud, so it reads as a join and
 *     not as a stripe stuck on.
 *
 * Authored spanning z 0..1: the caller stretches it from hip to neck.
 */
function torsoMesh(a, f) {
  // Uniform colours are authored dark for a flat 2D fill; under a lit shader
  // they need lifting or the whole body reads as a silhouette.
  const uniform = shade(a.uniform || f.color2 || '#171a22', 1.55);
  const accent = a.accent || f.color || '#8ad8ff';
  const key = `torso2:${uniform}:${accent}:${a.scarf ? 1 : 0}`;
  return cached(key, () => {
    const b = new MeshBuilder();
    const lit = shade(uniform, 1.22);
    const dark = shade(uniform, 0.74);
    const deep = shade(uniform, 0.5);

    // Waist, cinched. A straight tube reads as a mannequin; the taper in and
    // then out again is most of what makes a silhouette look like a person.
    b.merge(taperedBox(0.27, 0.37, 0.235, 0.325, 0.26, dark), matCompose(0, 0, 0, 0, 0, 0));
    // Hem: the jacket has a bottom edge, and it is a different tone so the
    // line finder inks it.
    b.merge(taperedBox(0.285, 0.385, 0.275, 0.375, 0.045, deep), matCompose(0, 0, 0.255, 0, 0, 0));
    // Ribcage, flaring to the shoulders — but not as far as it was. A chest
    // that keeps widening to the very top gives the figure a flat shelf to
    // hang the arms off, which reads as a sandwich board.
    b.merge(taperedBox(0.24, 0.33, 0.30, 0.40, 0.53, uniform, {
      sideColor: uniform, rightColor: lit, leftColor: dark,
    }), matCompose(0, 0, 0.3, 0, 0, 0));

    // Lapels: two strips running from the waist up and outward to the collar,
    // making the V that breaks up the chest. Mirrored by leaning them opposite
    // ways rather than by rotating one of them half a turn, which puts it
    // round the back.
    //
    // Rotating about x tips the strip's own +z toward -y, so a negative angle
    // on the left and a positive one on the right opens the V upward.
    for (const sgn of [1, -1]) {
      b.merge(box(0.024, 0.08, 0.37, lit),
        matCompose(0.108, sgn * 0.012, 0.44, -sgn * 0.34, -0.05, 0));
    }

    // Centre seam, recessed into the chest rather than sitting on it.
    b.merge(box(0.018, 0.028, 0.5, deep, { z0: 0 }), matCompose(0.113, 0, 0.3, 0, -0.04, 0));

    // Shoulder yoke, tapering in as it rises so the top of the torso is a
    // slope into the neck rather than a plate.
    b.merge(taperedBox(0.30, 0.40, 0.235, 0.30, 0.075, lit), matCompose(0, 0, 0.83, 0, 0, 0));

    // Deltoid caps: the shoulder itself, sloping down and outward to where the
    // sleeve starts. Without them an arm grows straight out of the side of the
    // chest at a right angle.
    for (const sgn of [1, -1]) {
      b.merge(taperedBox(0.27, 0.11, 0.2, 0.075, 0.12, uniform, { topColor: lit }),
        matCompose(0, sgn * 0.175, 0.78, sgn * 0.42, 0, 0));
      // Shoulder seam: a narrow band where the sleeve is set in. The single
      // most useful line on the whole figure.
      b.merge(box(0.28, 0.028, 0.055, deep), matCompose(0, sgn * 0.196, 0.80, 0, 0, 0));
    }

    // Collar, standing.
    b.merge(taperedBox(0.2, 0.3, 0.155, 0.225, 0.115, dark), matCompose(0, 0, 0.895, 0, 0, 0));
    // Collar band, a tone apart so its top edge inks.
    b.merge(taperedBox(0.16, 0.235, 0.15, 0.22, 0.028, accent), matCompose(0, 0, 0.982, 0, 0, 0));

    // Belt.
    b.merge(taperedBox(0.29, 0.39, 0.28, 0.38, 0.05, deep), matCompose(0, 0, 0.2, 0, 0, 0));

    if (a.scarf) {
      b.merge(cylinder(0.14, 0.13, 0.1, 8, accent), matCompose(0, 0, 0.86, 0, 0, 0));
      b.merge(taperedBox(0.06, 0.13, 0.04, 0.08, 0.36, accent),
        matCompose(-0.12, 0.05, 0.86, 0, 2.7, 0));
    }
    return b.build();
  });
}

function pelvisMesh(a, f) {
  const uniform = shade(a.uniform || f.color2 || '#171a22', 1.55);
  return cached(`pelvis:${uniform}`, () => taperedBox(0.27, 0.36, 0.26, 0.34, 0.16, shade(uniform, 0.82), {
    z0: -0.1,
  }));
}

/** Coat tails: four hanging panels that the coat spring swings. */
function coatMesh(a, f) {
  const uniform = shade(a.uniform || f.color2 || '#171a22', 1.45);
  const accent = a.accent || f.color || '#8ad8ff';
  return cached(`coat:${uniform}:${accent}`, () => {
    const b = new MeshBuilder();
    const dark = shade(uniform, 0.62);
    const panels = [
      [0.13, 0.0, 0.16, 0.34],
      [-0.14, 0.0, 0.18, 0.4],
      [0.0, 0.16, 0.14, 0.38],
      [0.0, -0.16, 0.14, 0.38],
    ];
    for (const [x, y, w, h] of panels) {
      b.merge(taperedBox(w, w, w * 1.15, w * 1.15, h, dark, { topColor: uniform }),
        matCompose(x, y, -h, 0, 0, Math.atan2(y, x)));
    }
    b.merge(box(0.3, 0.38, 0.03, accent), matCompose(0, 0, -0.012, 0, 0, 0));
    return b.build();
  });
}

const TOOL_BUILDERS = {
  blade(t) {
    const b = new MeshBuilder();
    const steel = t.color || '#cfd6e0';
    const L = t.length || 1.35;
    b.merge(box(0.028, 0.03, 0.22, '#1d1d24'), matCompose(0, 0, -0.22, 0, 0, 0));
    b.merge(box(0.05, 0.12, 0.022, '#2a2a33'), matCompose(0, 0, 0, 0, 0, 0));
    // Blade with a bevel: two tapered slabs meeting at a spine.
    b.merge(taperedBox(0.022, 0.05, 0.016, 0.04, L * 0.78, steel, {
      rightColor: shade(steel, 1.3), leftColor: shade(steel, 0.68),
    }), matCompose(0, 0, 0.022, 0, 0, 0));
    b.merge(cone(0.026, L * 0.16, 4, shade(steel, 1.2)),
      matCompose(0, 0, 0.022 + L * 0.78, 0, 0, 0));
    return b.build();
  },
  cleaver(t) {
    const b = new MeshBuilder();
    const steel = t.color || '#d68a6a';
    const L = t.length || 1.3;
    b.merge(box(0.035, 0.035, 0.2, '#241a16'), matCompose(0, 0, -0.2, 0, 0, 0));
    b.merge(prism([[-0.03, -0.02], [0.06, -0.02], [0.03, 0.02], [-0.03, 0.02]], L * 0.7, steel, {
      topColor: shade(steel, 1.25),
    }), matCompose(0, 0, 0, 0, 0, 0));
    return b.build();
  },
  spear(t) {
    const b = new MeshBuilder();
    const steel = t.color || '#b7c9d8';
    const L = t.length || 2.3;
    b.merge(cylinder(0.022, 0.02, L * 0.76, 6, '#3a3f47'), matCompose(0, 0, -L * 0.34, 0, 0, 0));
    // The Inverted Spear's head is a broad reversed blade.
    b.merge(taperedBox(0.02, 0.07, 0.018, 0.1, L * 0.16, steel),
      matCompose(0, 0, L * 0.42, 0, 0, 0));
    b.merge(cone(0.05, L * 0.16, 4, shade(steel, 1.25)), matCompose(0, 0, L * 0.58, 0, 0, 0));
    b.merge(cylinder(0.035, 0.035, 0.05, 6, '#8a9099'), matCompose(0, 0, L * 0.4, 0, 0, 0));
    return b.build();
  },
  staff(t) {
    const b = new MeshBuilder();
    const gold = t.color || '#e8c46a';
    const L = t.length || 1.9;
    // Three sections with banded joints.
    for (let i = 0; i < 3; i++) {
      const z = -L * 0.5 + i * (L / 3);
      b.merge(cylinder(0.05, 0.05, L / 3 - 0.03, 8, i === 1 ? shade(gold, 0.8) : gold),
        matCompose(0, 0, z, 0, 0, 0));
      b.merge(cylinder(0.062, 0.062, 0.035, 8, '#2a2620'), matCompose(0, 0, z + L / 3 - 0.035, 0, 0, 0));
    }
    return b.build();
  },
  club(t) {
    const b = new MeshBuilder();
    const bone = t.color || '#e6ddc4';
    const L = t.length || 2.1;
    b.merge(cylinder(0.05, 0.085, L * 0.8, 7, bone), matCompose(0, 0, -L * 0.3, 0, 0, 0));
    b.merge(sphere(0.15, 7, 5, shade(bone, 0.92)), matCompose(0, 0, L * 0.52, 0, 0, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      b.merge(cone(0.04, 0.11, 4, shade(bone, 1.1)),
        matCompose(Math.cos(a) * 0.12, Math.sin(a) * 0.12, L * 0.52, 0, 1.3, a));
    }
    return b.build();
  },
  hammer(t) {
    const b = new MeshBuilder();
    const wood = t.color || '#c8a27a';
    const L = t.length || 1.1;
    b.merge(cylinder(0.026, 0.03, L * 0.8, 6, wood), matCompose(0, 0, -L * 0.3, 0, 0, 0));
    b.merge(box(0.09, 0.09, 0.16, '#4a4a52'), matCompose(0, 0, L * 0.45, 0, 0, 0));
    return b.build();
  },
  chain(t) {
    const b = new MeshBuilder();
    const steel = t.color || '#9aa3ad';
    const L = t.length || 2.6;
    const links = 9;
    for (let i = 0; i < links; i++) {
      b.merge(box(0.05, 0.03, 0.09, i % 2 ? steel : shade(steel, 0.75)),
        matCompose(0, 0, -L * 0.4 + i * (L * 0.85 / links), 0, 0, i % 2 ? 1.2 : 0));
    }
    return b.build();
  },
  rope(t) {
    const b = new MeshBuilder();
    const c = t.color || '#4a4a55';
    const L = t.length || 2.4;
    for (let i = 0; i < 8; i++) {
      b.merge(cylinder(0.025, 0.022, L * 0.11, 5, i % 2 ? c : shade(c, 1.3)),
        matCompose(Math.sin(i * 1.1) * 0.02, Math.cos(i * 1.1) * 0.02,
          -L * 0.4 + i * (L * 0.11), 0, 0, 0));
    }
    return b.build();
  },
};

function toolMesh(tool) {
  if (!tool || tool.shape === 'none' || !TOOL_BUILDERS[tool.shape]) return null;
  return cached(`tool:${tool.id}`, () => TOOL_BUILDERS[tool.shape](tool));
}

// ---------------------------------------------------------------------------
// Curse bodies
// ---------------------------------------------------------------------------

/**
 * Curse builders return `{ body, parts }` where `parts` are transformed at draw
 * time. `parts` entries are `{ mesh, x, y, z, rx, ry, rz, s, anim }` and `anim`
 * names how the part moves: 'idleL'/'idleR' swing with the walk cycle, 'jaw'
 * opens on attack, 'tail' sways, 'float' bobs, 'swipe' follows the strike.
 */
function buildCurse(f) {
  const shape = f.shape || 'blob';
  const c1 = f.color || '#6b5a7a';
  const c2 = f.color2 || '#2a2333';
  const eye = f.eyeColor || '#ffd166';
  return cached(`curse:${shape}:${c1}:${c2}:${eye}`, () => CURSE_BUILDERS[shape]
    ? CURSE_BUILDERS[shape](c1, c2, eye)
    : CURSE_BUILDERS.blob(c1, c2, eye));
}

/** Irregular lumpy sphere — the base flesh of most low-grade curses. */
function lump(r, c, seedN = 3, squash = 1) {
  const b = new MeshBuilder();
  const segU = 8, segV = 6;
  const rows = [];
  for (let vi = 0; vi <= segV; vi++) {
    const phi = (vi / segV) * PI;
    const zr = Math.sin(phi), z = Math.cos(phi);
    const row = [];
    if (vi === 0 || vi === segV) {
      row.push(b.vert(0, 0, z * r * squash));
    } else {
      for (let ui = 0; ui < segU; ui++) {
        const th = (ui / segU) * TAU;
        const wob = 1 + Math.sin(th * seedN + vi * 1.7) * 0.16 + Math.cos(vi * 2.3) * 0.08;
        row.push(b.vert(Math.cos(th) * zr * r * wob, Math.sin(th) * zr * r * wob,
          z * r * squash * wob));
      }
    }
    rows.push(row);
  }
  for (let vi = 0; vi < segV; vi++) {
    const a = rows[vi], cc = rows[vi + 1];
    const col = vi < segV / 2 ? c : shade(c, 0.82);
    if (a.length === 1) for (let ui = 0; ui < segU; ui++) b.tri(a[0], cc[ui], cc[(ui + 1) % segU], col);
    else if (cc.length === 1) for (let ui = 0; ui < segU; ui++) b.tri(a[ui], cc[0], a[(ui + 1) % segU], col);
    else {
      for (let ui = 0; ui < segU; ui++) {
        const uj = (ui + 1) % segU;
        b.quad(a[ui], cc[ui], cc[uj], a[uj], col);
      }
    }
  }
  return b.build();
}

/** A ring of teeth around a mouth opening in the XY plane. */
function teethRing(r, n, len, color) {
  const b = new MeshBuilder();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const up = i % 2 === 0;
    b.merge(cone(r * 0.16, len * (up ? 1 : 0.7), 3, color),
      matCompose(Math.cos(a) * r, Math.sin(a) * r, 0, 0, up ? PI : 0, a));
  }
  return b.build();
}

/** A single staring eye plate, used all over the curse roster. */
function eyeMesh(r, color) {
  return cached(`eye:${r}:${color}`, () => {
    const b = new MeshBuilder();
    b.merge(sphere(r, 7, 5, '#f4f2e8'), null);
    b.merge(sphere(r * 0.55, 6, 4, color), matCompose(r * 0.62, 0, 0, 0, 0, 0));
    b.merge(sphere(r * 0.26, 5, 4, '#100c10'), matCompose(r * 0.85, 0, 0, 0, 0, 0));
    return b.build();
  });
}

/**
 * One animated piece of a curse.
 *
 * `s` scales along the part's own +z and `w` across it, so the limb meshes —
 * which are unit-z bones like the humanoid's — stretch into limbs instead of
 * inflating into cubes. Anything already modelled at its final size leaves both
 * at 1.
 */
const P = (mesh, x, y, z, s = 1, anim = null, rx = 0, ry = 0, rz = 0, w = null) =>
  ({ mesh, x, y, z, s, anim, rx, ry, rz, w: w ?? s });

/** A limb part: `len` long, `thick` across, anchored at (x, y, z). */
const LP = (mesh, x, y, z, len, thick, anim, ry = 0, rz = 0) =>
  P(mesh, x, y, z, len, anim, 0, ry, rz, thick);

const CURSE_BUILDERS = {
  blob(c1, c2, eye) {
    return {
      h: 1.0,
      parts: [
        P(lump(0.42, c2, 3, 1.05), 0, 0, 0.44),
        P(lump(0.3, c1, 4, 0.9), 0.06, 0, 0.62),
        P(eyeMesh(0.1, eye), 0.3, 0.1, 0.66, 1, 'look'),
        P(eyeMesh(0.08, eye), 0.3, -0.13, 0.62, 1, 'look'),
        P(teethRing(0.15, 8, 0.09, '#efe7d8'), 0.3, -0.01, 0.4, 1, 'jaw', 0, PI / 2, 0),
        LP(limbMesh(c2), 0.12, 0.3, 0.5, 0.46, 0.15, 'armL'),
        LP(limbMesh(c2), 0.12, -0.3, 0.5, 0.46, 0.15, 'armR'),
      ],
    };
  },
  mouth(c1, c2, eye) {
    const b = new MeshBuilder();
    b.merge(lump(0.46, c2, 3, 0.9), null);
    return {
      h: 1.0,
      parts: [
        P(b.build(), 0, 0, 0.5),
        P(teethRing(0.3, 14, 0.16, '#efe7d8'), 0.3, 0, 0.5, 1, 'jaw', 0, PI / 2, 0),
        P(disc(0.3, 10, '#2a0f14', 0.3), 0.29, 0, 0.5, 1, null, 0, PI / 2, 0),
        P(eyeMesh(0.07, eye), 0.22, 0.28, 0.76, 1, 'look'),
        P(eyeMesh(0.07, eye), 0.22, -0.28, 0.76, 1, 'look'),
      ],
    };
  },
  mantis(c1, c2, eye) {
    const thorax = new MeshBuilder();
    thorax.merge(taperedBox(0.26, 0.3, 0.16, 0.2, 0.7, c1, { topColor: shade(c1, 1.2) }), null);
    thorax.merge(taperedBox(0.2, 0.24, 0.3, 0.32, 0.3, c2), matCompose(0, 0, -0.3, 0, 0, 0));
    const scythe = new MeshBuilder();
    scythe.merge(taperedBox(0.07, 0.09, 0.05, 0.06, 0.55, c2), null);
    scythe.merge(prism([[-0.02, -0.03], [0.5, -0.02], [0.46, 0.03], [-0.02, 0.05]], 0.05,
      shade(c1, 1.3)), matCompose(0, 0, 0.55, 0, 0, 0));
    const head = new MeshBuilder();
    head.merge(taperedBox(0.16, 0.2, 0.1, 0.12, 0.16, c1), null);
    head.merge(sphere(0.06, 6, 4, eye), matCompose(0.07, 0.08, 0.1, 0, 0, 0));
    head.merge(sphere(0.06, 6, 4, eye), matCompose(0.07, -0.08, 0.1, 0, 0, 0));
    return {
      h: 1.5,
      parts: [
        P(thorax.build(), 0, 0, 0.62, 1, null, 0, 0.35, 0),
        P(head.build(), 0.22, 0, 1.22, 1, 'look'),
        P(scythe.build(), 0.05, 0.22, 1.02, 1, 'scytheL', 0, 1.1, 0.2),
        P(scythe.build(), 0.05, -0.22, 1.02, 1, 'scytheR', 0, 1.1, -0.2),
        LP(limbMesh(c2), -0.02, 0.18, 0.6, 0.66, 0.1, 'legL', 2.4, 0.5),
        LP(limbMesh(c2), -0.02, -0.18, 0.6, 0.66, 0.1, 'legR', 2.4, -0.5),
      ],
    };
  },
  wraith(c1, c2, eye) {
    const cloak = new MeshBuilder();
    cloak.merge(taperedBox(0.2, 0.24, 0.5, 0.56, 0.9, c2, { topColor: c1 }),
      matCompose(0, 0, 0.35, 0, 0, 0));
    // Ragged hem.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU;
      cloak.merge(cone(0.07, 0.22 + (i % 3) * 0.08, 4, shade(c2, 0.8)),
        matCompose(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.36, 0, PI, a));
    }
    const hood = new MeshBuilder();
    hood.merge(taperedBox(0.24, 0.26, 0.1, 0.12, 0.26, c1), null);
    hood.merge(disc(0.1, 8, '#07060c', 0.1), matCompose(0.12, 0, 0.1, 0, PI / 2, 0));
    return {
      h: 1.6, float: 0.35,
      parts: [
        P(cloak.build(), 0, 0, 0.1),
        P(hood.build(), 0.03, 0, 1.24, 1, 'look'),
        P(eyeMesh(0.045, eye), 0.14, 0.05, 1.36, 1, 'look'),
        P(eyeMesh(0.045, eye), 0.14, -0.05, 1.36, 1, 'look'),
        LP(limbMesh(c2), 0.06, 0.24, 1.14, 0.55, 0.11, 'armL'),
        LP(limbMesh(c2), 0.06, -0.24, 1.14, 0.55, 0.11, 'armR'),
      ],
    };
  },
  hulk(c1, c2, eye) {
    const torso = new MeshBuilder();
    torso.merge(taperedBox(0.62, 0.9, 0.5, 0.78, 0.85, c1, { topColor: shade(c1, 1.15) }),
      matCompose(0, 0, 0.05, 0, 0, 0));
    // Plated back.
    for (let i = 0; i < 4; i++) {
      torso.merge(box(0.12, 0.6 - i * 0.1, 0.1, c2), matCompose(-0.26, 0, 0.2 + i * 0.2, 0, 0.3, 0));
    }
    const head = new MeshBuilder();
    head.merge(taperedBox(0.3, 0.36, 0.22, 0.26, 0.22, c1), null);
    head.merge(teethRing(0.13, 8, 0.07, '#e8dcc0'), matCompose(0.14, 0, 0.08, 0, PI / 2, 0));
    return {
      h: 1.9,
      parts: [
        P(torso.build(), 0, 0, 0.72),
        P(head.build(), 0.18, 0, 1.64, 1.3, 'look'),
        P(eyeMesh(0.075, eye), 0.36, 0.12, 1.86, 1, 'look'),
        P(eyeMesh(0.075, eye), 0.36, -0.12, 1.86, 1, 'look'),
        LP(armMesh(shade(c1, 0.86)), 0, 0.62, 1.52, 1.0, 0.3, 'armL'),
        LP(armMesh(shade(c1, 0.86)), 0, -0.62, 1.52, 1.0, 0.3, 'armR'),
        LP(thighMesh(c2), 0, 0.26, 0.74, 0.76, 0.3, 'legL'),
        LP(thighMesh(c2), 0, -0.26, 0.74, 0.76, 0.3, 'legR'),
      ],
    };
  },
  serpent(c1, c2, eye) {
    const head = new MeshBuilder();
    head.merge(taperedBox(0.3, 0.26, 0.16, 0.14, 0.2, c1, { topColor: shade(c1, 1.2) }), null);
    head.merge(teethRing(0.1, 8, 0.07, '#e8e0cc'), matCompose(0.16, 0, 0.06, 0, PI / 2, 0));
    const seg = (r, col) => cylinder(r, r * 0.92, 0.3, 7, col);
    const parts = [P(head.build(), 0.5, 0, 1.0, 1, 'look')];
    for (let i = 0; i < 7; i++) {
      parts.push(P(seg(0.3 - i * 0.03, i % 2 ? c1 : c2), 0.35 - i * 0.22, 0,
        0.95 - i * 0.06, 1, `coil${i}`, 0, PI / 2 + 0.12, 0));
    }
    parts.push(P(eyeMesh(0.055, eye), 0.66, 0.1, 1.12, 1, 'look'));
    parts.push(P(eyeMesh(0.055, eye), 0.66, -0.1, 1.12, 1, 'look'));
    return { h: 1.5, parts };
  },
  fingerBearer(c1, c2, eye) {
    const torso = new MeshBuilder();
    torso.merge(lump(0.5, c1, 3, 1.2), matCompose(0, 0, 0, 0, 0, 0));
    torso.merge(lump(0.34, c2, 5, 0.9), matCompose(-0.16, 0, 0.42, 0, 0, 0));
    const head = new MeshBuilder();
    head.merge(lump(0.24, c1, 4, 1.1), null);
    head.merge(teethRing(0.14, 10, 0.1, '#efe4cc'), matCompose(0.16, 0, 0, 0, PI / 2, 0));
    const parts = [
      P(torso.build(), 0, 0, 1.05),
      P(head.build(), 0.2, 0, 1.62, 1, 'look'),
      LP(armMesh(c1), 0, 0.5, 1.42, 0.92, 0.26, 'armL'),
      LP(armMesh(c1), 0, -0.5, 1.42, 0.92, 0.26, 'armR'),
      LP(thighMesh(c2), 0, 0.24, 0.82, 0.84, 0.28, 'legL'),
      LP(thighMesh(c2), 0, -0.24, 0.82, 0.84, 0.28, 'legR'),
    ];
    // The staring eyes that cover a special-grade's flesh.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      parts.push(P(eyeMesh(0.07, eye), Math.cos(a) * 0.34 + 0.1, Math.sin(a) * 0.4,
        1.0 + Math.sin(i * 2.1) * 0.3, 1, 'look'));
    }
    return { h: 2.0, parts };
  },
  hanged(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(taperedBox(0.18, 0.2, 0.34, 0.4, 0.8, c1, { topColor: shade(c1, 1.2) }),
      matCompose(0, 0, 0.1, 0, 0, 0));
    const head = new MeshBuilder();
    head.merge(taperedBox(0.24, 0.24, 0.3, 0.3, 0.3, c2), null);
    head.merge(cylinder(0.05, 0.05, 0.3, 5, '#3a3040'), matCompose(0, 0, 0.3, 0, 0, 0));
    return {
      h: 1.8, float: 0.25,
      parts: [
        P(body.build(), 0, 0, 0.5, 1, 'sway'),
        P(head.build(), 0, 0, 1.4, 1, 'sway'),
        P(eyeMesh(0.05, eye), 0.14, 0.08, 1.54, 1, 'look'),
        P(eyeMesh(0.05, eye), 0.14, -0.08, 1.54, 1, 'look'),
        LP(limbMesh(c2), 0, 0.22, 1.3, 0.62, 0.1, 'armL'),
        LP(limbMesh(c2), 0, -0.22, 1.3, 0.62, 0.1, 'armR'),
      ],
    };
  },
  special(c1, c2, eye) {
    const torso = new MeshBuilder();
    torso.merge(taperedBox(0.4, 0.56, 0.5, 0.7, 0.9, c1, { topColor: shade(c1, 1.2) }),
      matCompose(0, 0, 0.1, 0, 0, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      torso.merge(cone(0.06, 0.3, 4, c2),
        matCompose(Math.cos(a) * 0.2 - 0.18, Math.sin(a) * 0.28, 0.7, 0, 2.2, a));
    }
    const head = new MeshBuilder();
    head.merge(taperedBox(0.26, 0.3, 0.18, 0.2, 0.26, c1), null);
    head.merge(cone(0.05, 0.28, 4, shade(c2, 1.3)), matCompose(-0.02, 0.1, 0.2, 0, 0.5, 1.0));
    head.merge(cone(0.05, 0.28, 4, shade(c2, 1.3)), matCompose(-0.02, -0.1, 0.2, 0, 0.5, -1.0));
    head.merge(teethRing(0.1, 10, 0.07, '#f0e6d0'), matCompose(0.14, 0, 0.06, 0, PI / 2, 0));
    return {
      h: 2.1,
      parts: [
        P(torso.build(), 0, 0, 1.0),
        P(head.build(), 0.12, 0, 1.94, 1, 'look'),
        P(eyeMesh(0.07, eye), 0.26, 0.09, 2.08, 1, 'look'),
        P(eyeMesh(0.07, eye), 0.26, -0.09, 2.08, 1, 'look'),
        LP(armMesh(c1), 0, 0.44, 1.86, 0.98, 0.22, 'armL'),
        LP(armMesh(c1), 0, -0.44, 1.86, 0.98, 0.22, 'armR'),
        LP(thighMesh(c2), 0, 0.2, 1.02, 1.0, 0.24, 'legL'),
        LP(thighMesh(c2), 0, -0.2, 1.02, 1.0, 0.24, 'legR'),
      ],
    };
  },
  dog(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(taperedBox(0.62, 0.3, 0.3, 0.26, 0.3, c1, { topColor: shade(c1, 1.2) }),
      matCompose(0, 0, 0, 0, 0, 0));
    const head = new MeshBuilder();
    head.merge(taperedBox(0.2, 0.2, 0.16, 0.16, 0.18, c1), null);
    head.merge(taperedBox(0.16, 0.12, 0.1, 0.1, 0.1, c2), matCompose(0.14, 0, 0.02, 0, 1.4, 0));
    head.merge(cone(0.05, 0.12, 4, c2), matCompose(-0.02, 0.08, 0.16, 0, 0.2, 0));
    head.merge(cone(0.05, 0.12, 4, c2), matCompose(-0.02, -0.08, 0.16, 0, 0.2, 0));
    return {
      h: 0.95, quad: true,
      parts: [
        P(body.build(), 0, 0, 0.5, 1, null, 0, PI / 2, 0),
        P(head.build(), 0.42, 0, 0.62, 1, 'look'),
        P(eyeMesh(0.035, eye), 0.54, 0.07, 0.7, 1, 'look'),
        P(eyeMesh(0.035, eye), 0.54, -0.07, 0.7, 1, 'look'),
        LP(limbMesh(c2), 0.24, 0.13, 0.44, 0.44, 0.09, 'legL'),
        LP(limbMesh(c2), 0.24, -0.13, 0.44, 0.44, 0.09, 'legR'),
        LP(limbMesh(c2), -0.24, 0.13, 0.44, 0.44, 0.09, 'legR'),
        LP(limbMesh(c2), -0.24, -0.13, 0.44, 0.44, 0.09, 'legL'),
        P(taperedBox(0.07, 0.07, 0.03, 0.03, 0.34, c1), -0.34, 0, 0.55, 1, 'tail', 0, 2.2, 0),
      ],
    };
  },
  toad(c1, c2, eye) {
    return {
      h: 1.0,
      parts: [
        P(lump(0.44, c1, 3, 0.72), 0, 0, 0.36),
        P(lump(0.18, c2, 3, 0.8), 0.32, 0, 0.42, 1, 'look'),
        P(eyeMesh(0.08, eye), 0.3, 0.16, 0.6, 1, 'look'),
        P(eyeMesh(0.08, eye), 0.3, -0.16, 0.6, 1, 'look'),
        P(teethRing(0.16, 8, 0.05, '#e8e0c8'), 0.36, 0, 0.32, 1, 'jaw', 0, PI / 2, 0),
        LP(limbMesh(c2), 0.18, 0.34, 0.34, 0.4, 0.12, 'legL', 2.1, 0.6),
        LP(limbMesh(c2), 0.18, -0.34, 0.34, 0.4, 0.12, 'legR', 2.1, -0.6),
      ],
    };
  },
  nue(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(taperedBox(0.44, 0.24, 0.2, 0.18, 0.26, c1), matCompose(0, 0, 0, 0, PI / 2, 0));
    const wing = new MeshBuilder();
    wing.merge(prism([[0, -0.03], [0.9, -0.18], [0.85, 0.02], [0, 0.04]], 0.035, c2,
      { topColor: shade(c1, 1.1) }), null);
    const head = new MeshBuilder();
    head.merge(taperedBox(0.2, 0.16, 0.12, 0.12, 0.14, c1), null);
    head.merge(cone(0.07, 0.16, 4, shade(c2, 1.2)), matCompose(0.1, 0, 0.04, 0, 1.4, 0));
    return {
      h: 1.4, float: 0.85,
      parts: [
        P(body.build(), 0, 0, 1.1),
        P(head.build(), 0.28, 0, 1.16, 1, 'look'),
        P(eyeMesh(0.045, eye), 0.36, 0.07, 1.26, 1, 'look'),
        P(eyeMesh(0.045, eye), 0.36, -0.07, 1.26, 1, 'look'),
        P(wing.build(), 0, 0.14, 1.2, 1, 'wingL', 0, 0, 0.4),
        P(wing.build(), 0, -0.14, 1.2, 1, 'wingR', 0, 0, -0.4),
        P(taperedBox(0.06, 0.06, 0.02, 0.02, 0.5, c2), -0.3, 0, 1.06, 1, 'tail', 0, 2.0, 0),
      ],
    };
  },
  mahoraga(c1, c2, eye) {
    const torso = new MeshBuilder();
    torso.merge(taperedBox(0.4, 0.62, 0.52, 0.8, 1.0, c1, { topColor: shade(c1, 1.2) }),
      matCompose(0, 0, 0, 0, 0, 0));
    // Ribs of pale bone armour.
    for (let i = 0; i < 4; i++) {
      torso.merge(box(0.3, 0.72 - i * 0.06, 0.06, '#d8cfb8'),
        matCompose(0.06, 0, 0.3 + i * 0.18, 0, 0, 0));
    }
    const head = new MeshBuilder();
    head.merge(taperedBox(0.26, 0.3, 0.2, 0.22, 0.24, c2), null);
    head.merge(teethRing(0.11, 10, 0.07, '#efe6cc'), matCompose(0.14, 0, 0.05, 0, PI / 2, 0));
    // The wheel above the head — the adaptation counter.
    const wheel = new MeshBuilder();
    wheel.merge(cylinder(0.24, 0.24, 0.05, 10, '#e8dcc0'), null);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      wheel.merge(box(0.05, 0.05, 0.16, '#3a3228'),
        matCompose(Math.cos(a) * 0.22, Math.sin(a) * 0.22, 0.02, 0, 0, a));
    }
    const parts = [
      P(torso.build(), 0, 0, 1.1),
      P(head.build(), 0.14, 0, 2.15, 1, 'look'),
      P(eyeMesh(0.06, eye), 0.28, 0.09, 2.28, 1, 'look'),
      P(eyeMesh(0.06, eye), 0.28, -0.09, 2.28, 1, 'look'),
      P(wheel.build(), -0.05, 0, 2.62, 1, 'wheel'),
      LP(armMesh(c1), 0, 0.5, 2.05, 1.1, 0.26, 'armL'),
      LP(armMesh(c1), 0, -0.5, 2.05, 1.1, 0.26, 'armR'),
      LP(thighMesh(c2), 0, 0.24, 1.12, 1.12, 0.3, 'legL'),
      LP(thighMesh(c2), 0, -0.24, 1.12, 1.12, 0.3, 'legR'),
      P(taperedBox(0.14, 0.14, 0.04, 0.04, 0.9, c2), -0.26, 0, 1.2, 1, 'tail', 0, 2.3, 0),
    ];
    return { h: 2.6, parts };
  },
  rika(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(lump(0.55, c1, 3, 1.1), matCompose(0, 0, 0, 0, 0, 0));
    // The layered skirt of hair-like strands.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      body.merge(cone(0.08, 0.6 + (i % 3) * 0.16, 4, shade(c2, 0.9)),
        matCompose(Math.cos(a) * 0.36, Math.sin(a) * 0.36, -0.2, 0, PI, a));
    }
    const head = new MeshBuilder();
    head.merge(taperedBox(0.3, 0.34, 0.24, 0.26, 0.3, c1), null);
    head.merge(teethRing(0.15, 12, 0.14, '#f2e8d4'), matCompose(0.16, 0, 0.08, 0, PI / 2, 0));
    // Crown horns.
    for (let i = 0; i < 4; i++) {
      const a = -0.6 + i * 0.4;
      head.merge(cone(0.05, 0.3, 4, '#f0e4cc'), matCompose(-0.04, Math.sin(a) * 0.14, 0.26, 0, 0.35, a));
    }
    return {
      h: 2.4, float: 0.4,
      parts: [
        P(body.build(), 0, 0, 1.35),
        P(head.build(), 0.2, 0, 1.95, 1, 'look'),
        P(eyeMesh(0.09, eye), 0.34, 0.12, 2.12, 1, 'look'),
        P(eyeMesh(0.09, eye), 0.34, -0.12, 2.12, 1, 'look'),
        LP(armMesh(c1), 0, 0.58, 1.8, 1.15, 0.32, 'armL'),
        LP(armMesh(c1), 0, -0.58, 1.8, 1.15, 0.32, 'armR'),
      ],
    };
  },
  isomer(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(lump(0.4, c1, 5, 1.3), null);
    const parts = [P(body.build(), 0, 0, 0.9)];
    // Transfigured humans are a knot of mismatched limbs.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.4;
      parts.push(LP(limbMesh(i % 2 ? c1 : c2), Math.cos(a) * 0.3, Math.sin(a) * 0.34,
        0.75 + (i % 3) * 0.22, 0.5 + (i % 3) * 0.16, 0.12, i % 2 ? 'armL' : 'armR',
        1.2 + (i % 3) * 0.4, a));
    }
    parts.push(P(eyeMesh(0.07, eye), 0.28, 0.14, 1.12, 1, 'look'));
    parts.push(P(eyeMesh(0.05, eye), 0.22, -0.2, 0.86, 1, 'look'));
    parts.push(P(teethRing(0.13, 9, 0.09, '#efe4d0'), 0.3, -0.02, 1.0, 1, 'jaw', 0, PI / 2, 0));
    return { h: 1.6, parts };
  },
  transfigured(c1, c2, eye) {
    const b = CURSE_BUILDERS.isomer(c1, c2, eye);
    return { h: 1.3, parts: b.parts };
  },
  fish(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(taperedBox(0.7, 0.3, 0.14, 0.2, 0.3, c1, { topColor: shade(c1, 1.25) }),
      matCompose(0, 0, 0, 0, PI / 2, 0));
    return {
      h: 1.1, float: 0.6,
      parts: [
        P(body.build(), 0, 0, 0.8),
        P(teethRing(0.12, 8, 0.08, '#e8e4d0'), 0.36, 0, 0.8, 1, 'jaw', 0, PI / 2, 0),
        P(eyeMesh(0.05, eye), 0.3, 0.13, 0.9, 1, 'look'),
        P(eyeMesh(0.05, eye), 0.3, -0.13, 0.9, 1, 'look'),
        P(prism([[0, -0.02], [0.34, -0.2], [0.34, 0.2], [0, 0.02]], 0.03, c2), -0.36, 0, 0.8, 1, 'tail'),
      ],
    };
  },
  puppet(c1, c2, eye) {
    const body = new MeshBuilder();
    body.merge(box(0.22, 0.3, 0.5, c1, { topColor: shade(c1, 1.2) }), null);
    const head = new MeshBuilder();
    head.merge(box(0.2, 0.2, 0.2, c2), null);
    head.merge(box(0.02, 0.05, 0.05, eye, { z0: -0.025 }), matCompose(0.11, 0.05, 0.12, 0, 0, 0));
    head.merge(box(0.02, 0.05, 0.05, eye, { z0: -0.025 }), matCompose(0.11, -0.05, 0.12, 0, 0, 0));
    return {
      h: 1.5,
      parts: [
        P(body.build(), 0, 0, 0.7),
        P(head.build(), 0.02, 0, 1.22, 1, 'look'),
        LP(limbMesh(c2), 0, 0.22, 1.14, 0.5, 0.1, 'armL'),
        LP(limbMesh(c2), 0, -0.22, 1.14, 0.5, 0.1, 'armR'),
        LP(limbMesh(c2), 0, 0.09, 0.72, 0.6, 0.12, 'legL'),
        LP(limbMesh(c2), 0, -0.09, 0.72, 0.6, 0.12, 'legR'),
      ],
    };
  },
  decoy(c1, c2, eye) {
    const b = CURSE_BUILDERS.blob(c1, c2, eye);
    return { h: 1.0, ghost: true, parts: b.parts };
  },
};

// ---------------------------------------------------------------------------
// Limb scale tables
// ---------------------------------------------------------------------------

const LIMB_W = {
  upperArm: 0.105, foreArm: 0.088, thigh: 0.145, shin: 0.115,
};

export {
  headMesh, headMeshLow, torsoMesh, coatMesh, pelvisMesh, maneMesh, toolMesh,
  buildCurse, shade, eyeMesh, lump, LIMB_W, cached,
};
