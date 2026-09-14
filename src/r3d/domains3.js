// Domain Expansion in 3D.
//
// A domain is an innate technique turned into a closed space, so in 3D it gets
// to be an actual space: a tessellated floor that replaces the arena, a real
// hemispherical barrier you can see the inside of, and per-domain furniture
// built from the same low-poly primitives as everything else.
//
// Staging matches the simulation's phases:
//
//   0.00-0.10  SLAM     the caster's hands come together, a white core
//   0.10-0.45  UNFOLD   ribs race up from the floor and knit into the shell
//   0.30-0.62  REVEAL   the interior wipes outward from the centre
//   held       the sure-hit pulses the whole space on every tick; damage
//              writes cracks into the shell; a rival barrier presses a seam
//   closing    the shell falls apart along those cracks
//
// Every domain overrides floor, shell treatment and interior, because
// "guaranteed hit inside a barrier" looks like something different each time.

import {
  clamp, clamp01, lerp, TAU, PI, noise1, easeOutQuint, easeOutCubic, easeOutBack,
} from '../core/math.js';
import { matCompose, matMul, hexToRgb } from './core3.js';
import {
  MeshBuilder, taperedBox, box, cylinder, cone, sphere, prism, disc, ringMesh,
  domeMesh, plane, drawMesh, drawOutline,
} from './geom3.js';
import { cached, shade, lump, eyeMesh } from './models3.js';

const tmp = new Float32Array(16);
const tmp2 = new Float32Array(16);

let Q = 1;
export function setDomainQuality3(q) { Q = clamp(q, 0.3, 1.4); }
const count = (n) => Math.max(3, Math.round(n * Q));

const tintOf = (color, gain = 1) => {
  const c = hexToRgb(color);
  return [c[0] / 190 * gain, c[1] / 190 * gain, c[2] / 190 * gain];
};

// ---------------------------------------------------------------------------
// Shared geometry
// ---------------------------------------------------------------------------

/**
 * The floor is concentric rings of quads rather than one fan, so every face's
 * centroid is local to itself and the painter's sort interleaves correctly with
 * the arena tiles underneath.
 */
const floorMesh = () => cached('domFloor', () => {
  const b = new MeshBuilder();
  const rings = 7, seg = 28;
  let prev = null;
  for (let j = 0; j <= rings; j++) {
    const r = Math.pow(j / rings, 0.85);
    const row = [];
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * TAU;
      row.push(b.vert(Math.cos(a) * r, Math.sin(a) * r, 0));
    }
    if (prev) {
      for (let i = 0; i < seg; i++) {
        const k = (i + 1) % seg;
        // A faint tone break gives the floor structure without turning it into
        // a dartboard — the per-domain treatment supplies the real pattern.
        const col = (i + j) % 2 ? '#ffffff' : '#eeeef4';
        b.quad(prev[i], row[i], row[k], prev[k], col, true, 0.35);
      }
    }
    prev = row;
  }
  return b.build();
});

/**
 * The barrier shell: a unit dome, double-sided so it reads from inside.
 *
 * The brightness ramps out toward the ground. Drawn at a flat opacity the
 * dome's lower rim cuts a hard horizontal line across the frame when the camera
 * is inside it — everything above the rim additively brightened, everything
 * below not — and a ramp baked into the face colours dissolves that seam
 * without costing a second draw.
 */
const shellMesh = () => cached('domShell', () => {
  const b = new MeshBuilder();
  const segU = 22, segV = 7;
  const rows = [];
  for (let vi = 0; vi <= segV; vi++) {
    const phi = (vi / segV) * (PI * 0.5);
    const zr = Math.cos(phi), z = Math.sin(phi);
    const row = [];
    if (vi === segV) row.push(b.vert(0, 0, 1));
    else {
      for (let ui = 0; ui < segU; ui++) {
        const th = (ui / segU) * TAU;
        row.push(b.vert(Math.cos(th) * zr, Math.sin(th) * zr, z));
      }
    }
    rows.push(row);
  }
  const tone = (vi) => {
    const t = clamp01(vi / segV);
    const k = Math.round(lerp(26, 255, t * t * (3 - 2 * t)));
    const h = k.toString(16).padStart(2, '0');
    return `#${h}${h}${h}`;
  };
  for (let vi = 0; vi < segV; vi++) {
    const a = rows[vi], c = rows[vi + 1];
    const col = tone(vi + 0.5);
    if (c.length === 1) {
      for (let ui = 0; ui < segU; ui++) b.tri(a[ui], a[(ui + 1) % segU], c[0], col, true, 1);
    } else {
      for (let ui = 0; ui < segU; ui++) {
        const uj = (ui + 1) % segU;
        b.quad(a[ui], a[uj], c[uj], c[ui], col, true, 1);
      }
    }
  }
  return b.build();
});

/** Meridian ribs — the visible skeleton of the barrier while it unfolds. */
const ribsMesh = () => cached('domRibs', () => {
  const b = new MeshBuilder();
  const meridians = 20, steps = 7, w = 0.012;
  for (let m = 0; m < meridians; m++) {
    const a = (m / meridians) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    const na = a + w;
    const cb = Math.cos(na), sb = Math.sin(na);
    let prevA = null, prevB = null;
    for (let s = 0; s <= steps; s++) {
      const phi = (s / steps) * (PI * 0.5);
      const zr = Math.cos(phi), z = Math.sin(phi);
      const va = b.vert(ca * zr, sa * zr, z);
      const vb = b.vert(cb * zr, sb * zr, z);
      if (prevA !== null) b.quad(prevA, prevB, vb, va, '#ffffff', true, 1);
      prevA = va; prevB = vb;
    }
  }
  // Latitude hoops.
  for (let l = 1; l <= 3; l++) {
    const phi = (l / 4) * (PI * 0.5);
    const zr = Math.cos(phi), z = Math.sin(phi);
    let p0 = null, p1 = null;
    for (let i = 0; i <= 28; i++) {
      const a = (i / 28) * TAU;
      const v0 = b.vert(Math.cos(a) * zr, Math.sin(a) * zr, z);
      const v1 = b.vert(Math.cos(a) * zr, Math.sin(a) * zr, z + 0.008);
      if (p0 !== null) b.quad(p0, p1, v1, v0, '#e8e8f4', true, 1);
      p0 = v0; p1 = v1;
    }
  }
  return b.build();
});

const ringUnit = () => cached('domRing', () => ringMesh(0.9, 1, 40, '#ffffff', 1));
const ringWide = () => cached('domRingW', () => ringMesh(0.6, 1, 32, '#ffffff', 1));
const discUnit = () => cached('domDisc', () => disc(1, 24, '#ffffff', 1));
const sphereUnit = () => cached('domSphere', () => sphere(1, 10, 7, '#ffffff'));
const boxUnit = () => cached('domBox', () => box(1, 1, 1, '#ffffff', { z0: 0 }));
const coneUnit = () => cached('domCone', () => cone(1, 1, 6, '#ffffff'));
const cylUnit = () => cached('domCyl', () => cylinder(1, 1, 1, 8, '#ffffff'));

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export function drawDomain3(dl, cam, d, S, q, time) {
  const spec = d.spec;
  const style = STYLES3[spec.visual] || STYLES3.void;
  const R = d.radius;
  const cx = d.center.x, cy = d.center.y;
  const open = d.openProgress;
  const integrity = d.integrityFrac;
  const reveal = easeOutQuint(clamp01((d.t - 0.08) / 0.5));

  const env = {
    dl, cam, d, S, q, time, R, cx, cy, spec, open, integrity, reveal,
    col: spec.color, col2: spec.color2 || '#05050a',
    // The floor plate is lit geometry, not a wash, so its tint has to land on
    // the authored colour rather than over-brighten it the way a glow does.
    tint: tintOf(spec.color), tint2: tintOf(spec.color2 || '#05050a', 0.78),
    pulse: d.pulse, stress: d.stress,
  };

  drawFloor(env);
  if (style.floor) style.floor(env);
  if (style.interior) style.interior(env);
  if (!d.open) drawShell(env, style);
  drawCracks(env);
  drawClashSeam(env);
}

// ---------------------------------------------------------------------------
// Floor
// ---------------------------------------------------------------------------

function drawFloor(env) {
  const { dl, cam, S, R, cx, cy, reveal, d, time } = env;
  const rr = R * reveal;
  if (rr < 0.6) return;

  // Base plate. The arena skips its own tiles inside this radius, so this is
  // the floor now rather than a wash laid over one.
  S.additive = false;
  S.alpha = 1;
  S.tint = env.tint2;
  matCompose(cx, cy, 0.02, 0, 0, 0, rr, rr, 1, tmp);
  drawMesh(dl, cam, floorMesh(), tmp, S);

  // Rim wash in the technique colour.
  S.additive = true;
  S.alpha = 0.5 + env.pulse * 0.25;
  S.tint = env.tint;
  matCompose(cx, cy, 0.05, 0, 0, 0, rr, rr, 1, tmp);
  drawMesh(dl, cam, ringUnit(), tmp, S);

  // The reveal edge is a bright wave still travelling outward.
  if (reveal < 1) {
    S.alpha = 0.9 * (1 - reveal);
    S.tint = [2, 2, 2];
    matCompose(cx, cy, 0.07, 0, 0, 0, rr, rr, 1, tmp);
    drawMesh(dl, cam, ringWide(), tmp, S);
  }

  // Ripples under everyone standing inside — the floor is not neutral ground.
  const world = d.world;
  if (world && Q > 0.5) {
    S.tint = env.tint;
    for (const f of world.fighters) {
      if (f.dead || !d.contains(f.pos)) continue;
      const ph = (time * 1.4 + f.id * 0.37) % 1;
      const rad = 0.5 + ph * 1.9;
      S.alpha = 0.3 * (1 - ph);
      matCompose(f.pos.x, f.pos.y, 0.085, 0, 0, 0, rad, rad, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
    }
  }
  S.alpha = 1;
  S.additive = false;
  S.tint = null;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

function drawShell(env, style) {
  const { dl, cam, S, R, cx, cy, open, integrity, d, time } = env;
  const H = R * 0.66;
  const rise = easeOutBack(clamp01((d.t - 0.06) / 0.42));
  const closing = d.closing ? clamp01(1 - (d.closeT ?? 0) / 0.5) : 1;
  const shake = d.stress * 0.06;
  const wob = shake ? Math.sin(time * 40) * shake : 0;

  S.additive = true;
  S.tint = env.tint;

  // Ribs first: during the unfold they are all there is.
  const ribAlpha = open < 1 ? 0.85 : 0.2 + (1 - integrity) * 0.35 + env.pulse * 0.2;
  S.alpha = ribAlpha * closing;
  matCompose(cx, cy, 0.05, wob, wob * 0.6, time * 0.03,
    R * lerp(0.2, 1, rise), R * lerp(0.2, 1, rise), H * rise, tmp);
  drawMesh(dl, cam, ribsMesh(), tmp, S);

  // Then the skin, once the ribs have knitted.
  if (open > 0.22) {
    const skinK = clamp01((open - 0.22) / 0.55);
    S.alpha = (0.1 + env.pulse * 0.1 + (1 - integrity) * 0.08) * skinK * closing;
    matCompose(cx, cy, 0.05, wob, wob * 0.6, -time * 0.02, R, R, H, tmp);
    drawMesh(dl, cam, shellMesh(), tmp, S);
    // A second, tighter skin gives the barrier a sense of thickness.
    if (Q > 0.8) {
      S.alpha *= 0.6;
      matCompose(cx, cy, 0.05, 0, 0, time * 0.05, R * 0.965, R * 0.965, H * 0.965, tmp);
      drawMesh(dl, cam, shellMesh(), tmp, S);
    }
  }

  if (style.shell) style.shell(env, H, rise);

  // Ground seam where the barrier meets the floor: the brightest line in the
  // space, but a line — not a band wide enough to read as a wall.
  S.alpha = (0.4 + env.pulse * 0.2) * closing;
  S.tint = [1.7, 1.7, 1.8];
  matCompose(cx, cy, 0.09, 0, 0, 0, R, R, 1, tmp);
  drawMesh(dl, cam, cached('domSeam', () => ringMesh(0.975, 1, 40, '#ffffff', 1)), tmp, S);

  S.additive = false;
  S.alpha = 1;
  S.tint = null;
}

/** Damage written into the barrier: bright fissures running down the shell. */
function drawCracks(env) {
  const { dl, cam, S, R, cx, cy, d } = env;
  if (!d.cracks || !d.cracks.length) return;
  const H = R * 0.66;
  S.additive = true;
  S.tint = [2.2, 2.2, 2.4];
  for (const c of d.cracks) {
    const k = clamp01(c.t / c.max);
    const seg = 5;
    let prev = null;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const phi = t * c.len;
      const a = c.angle + Math.sin(t * 7 + c.angle * 3) * 0.06;
      const zr = Math.cos(phi), z = Math.sin(phi);
      const p = cam.project(cx + Math.cos(a) * zr * R, cy + Math.sin(a) * zr * R, 0.05 + z * H);
      if (prev && p.d > cam.near && prev.d > cam.near) {
        dl.line((p.d + prev.d) * 0.5 - 0.05, prev.x, prev.y, p.x, p.y,
          '#ffffff', Math.max(1, 3 * k), true, k * 0.9);
      }
      prev = p.d > cam.near ? { x: p.x, y: p.y, d: p.d } : null;
    }
  }
  S.additive = false;
  S.tint = null;
}

/** Two barriers pressing against each other: a bright vertical seam. */
function drawClashSeam(env) {
  const { dl, cam, S, d, time, R, cx, cy } = env;
  const seam = d.clashSeam;
  if (!seam) return;
  const p = clamp01(seam.pressure);
  const h = R * 0.5;
  S.additive = true;
  S.tint = [2.4, 2.2, 2.4];
  S.alpha = 0.4 + p * 0.5 + Math.sin(time * 24) * 0.08;
  // A flat plate standing on the contact line, wobbling with the pressure.
  matCompose(seam.x, seam.y, 0.05, 0, 0, seam.angle + PI / 2,
    0.12 + p * 0.1, R * 0.5 * (0.5 + p * 0.5), h, tmp);
  drawMesh(dl, cam, boxUnit(), tmp, S);
  // Sparks at the contact point.
  S.alpha = 0.6 * p;
  const s = 0.6 + Math.sin(time * 30) * 0.2;
  matCompose(seam.x, seam.y, h * 0.4, 0, 0, time * 3, s, s, s, tmp);
  drawMesh(dl, cam, sphereUnit(), tmp, S);
  S.additive = false;
  S.alpha = 1;
  S.tint = null;
}

// ---------------------------------------------------------------------------
// Per-domain interiors
// ---------------------------------------------------------------------------

const put = (env, mesh, x, y, z, rx, ry, rz, sx, sy, sz, alpha, tint) => {
  const { dl, cam, S } = env;
  S.alpha = alpha;
  if (tint) S.tint = tint;
  matCompose(x, y, z, rx, ry, rz, sx, sy, sz, tmp);
  drawMesh(dl, cam, mesh, tmp, S);
};

const STYLES3 = {
  // -------------------------------------------------------------------------
  // Unlimited Void — infinite information delivered all at once.
  // -------------------------------------------------------------------------
  void: {
    floor(env) {
      const { S, R, cx, cy, time, reveal } = env;
      S.additive = true;
      // Concentric information rings rushing inward toward the caster.
      const n = count(9);
      for (let i = 0; i < n; i++) {
        const ph = ((time * 0.35 + i / n) % 1);
        const r = R * (1 - ph) * reveal;
        put(env, ringUnit(), cx, cy, 0.075, 0, 0, 0, r, r, 1,
          0.28 * ph, env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open, d } = env;
      S.additive = true;
      // Columns of streaming data. Each is a thin tall box whose height and
      // brightness cycle, so the space reads as infinitely deep.
      const n = count(52);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;               // golden angle: no visible pattern
        const rr = Math.sqrt((i + 0.5) / n) * R * 0.94;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const ph = (time * 0.6 + i * 0.137) % 1;
        const h = R * (0.25 + ph * 0.85);
        put(env, boxUnit(), x, y, 0.06, 0, 0, a, 0.1, 0.1, h,
          (0.16 + 0.42 * (1 - ph)) * open, env.tint);
      }
      // The vast pale orb overhead — the thing you are being shown.
      const orbZ = R * 0.5;
      const orbR = R * (0.2 + Math.sin(time * 0.7) * 0.012) * open;
      put(env, sphereUnit(), cx, cy, orbZ, 0, 0, time * 0.1, orbR, orbR, orbR,
        0.1 + env.pulse * 0.12, [1.5, 1.7, 2.0]);
      // Rings orbiting it, like the information mandala in the show.
      for (let i = 0; i < 3; i++) {
        const rr = orbR * (1.7 + i * 0.55);
        put(env, ringUnit(), cx, cy, orbZ, PI / 2.4 + i * 0.5, time * (0.2 + i * 0.1), time * 0.3,
          rr, rr, 1, 0.2 * open, env.tint);
      }
      S.additive = false;
      S.alpha = 1;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Chimera Shadow Garden — the shadow becomes the ground, and it is deep.
  // -------------------------------------------------------------------------
  shadowGarden: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      // Slow oily swells across the surface.
      const n = count(13);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const rr = Math.sqrt((i + 0.4) / n) * R * 0.9;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const s = 1.2 + Math.sin(time * 0.9 + i) * 0.5;
        put(env, discUnit(), x, y, 0.062, 0, 0, 0, s, s * 0.8, 1, 0.1, env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      S.additive = false;
      // Shikigami shapes surfacing out of the shadow and sinking again.
      const n = count(9);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + time * 0.12;
        const rr = (0.3 + ((i * 0.37) % 1) * 0.6) * R;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const ph = (time * 0.4 + i * 0.21) % 1;
        const up = Math.sin(ph * PI);
        if (up < 0.05) continue;
        const h = up * (1.1 + (i % 3) * 0.5);
        put(env, coneUnit(), x, y, 0.06, 0, 0, a, 0.42, 0.42, h,
          0.9 * open, [0.12, 0.1, 0.2]);
        // A pair of eyes in the silhouette.
        S.additive = true;
        put(env, sphereUnit(), x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, 0.06 + h * 0.62,
          0, 0, 0, 0.07, 0.07, 0.07, up * 0.9, env.tint);
        S.additive = false;
      }
      // Hands reaching up out of the floor.
      S.additive = false;
      const m = count(14);
      for (let i = 0; i < m; i++) {
        const a = i * 1.7 + time * 0.05;
        const rr = (0.2 + ((i * 0.53) % 1) * 0.72) * R;
        const ph = (time * 0.55 + i * 0.31) % 1;
        const up = Math.max(0, Math.sin(ph * PI)) * 0.55;
        if (up < 0.03) continue;
        put(env, cylUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.06,
          0, 0.1, a, 0.06, 0.06, up, 0.85 * open, [0.1, 0.08, 0.18]);
      }
      S.alpha = 1;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Malevolent Shrine — no barrier at all, just the shrine and the storm.
  // -------------------------------------------------------------------------
  shrine: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      // The dismantle storm: slash scars raking the ground everywhere.
      const n = count(26);
      for (let i = 0; i < n; i++) {
        const seed = i * 7.31;
        const ph = ((time * 1.5 + i * 0.13) % 1);
        const a = seed * 1.7;
        const rr = ((seed * 0.29) % 1) * R * 0.95;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        const len = 1.2 + ((seed * 0.61) % 1) * 2.4;
        put(env, boxUnit(), x, y, 0.06, 0, 0, seed * 2.3,
          len, 0.05, 0.01, (1 - ph) * 0.6, [2.2, 0.5, 0.4]);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, cx, cy, time, open, R } = env;
      // The shrine itself: a bone structure with an enormous open maw.
      const mesh = cached('shrineBody', () => {
        const b = new MeshBuilder();
        const bone = '#e6dcc0', dark = '#3a2a24';
        // Plinth.
        b.merge(box(6.0, 6.0, 0.8, dark), null);
        b.merge(box(5.2, 5.2, 0.5, bone), matCompose(0, 0, 0.8, 0, 0, 0));
        // Skull stack: a broad jaw under a domed cranium.
        b.merge(taperedBox(2.8, 3.2, 3.6, 3.9, 2.4, bone), matCompose(0, 0, 1.3, 0, 0, 0));
        b.merge(sphere(2.2, 10, 7, bone, { sz: 1.1 }), matCompose(-0.2, 0, 4.4, 0, 0, 0));
        // Eye sockets.
        for (const s of [1, -1]) {
          b.merge(sphere(0.62, 7, 5, '#120a08'), matCompose(1.5, s * 0.95, 4.7, 0, 0, 0));
        }
        // Teeth around the mouth.
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          b.merge(cone(0.26, 1.0, 4, '#f4ecd8'),
            matCompose(Math.cos(a) * 1.8, Math.sin(a) * 1.8, 3.6, 0, i % 2 ? PI : 0, a));
        }
        // Rib arches sweeping out from the base, each built from segments so
        // they curve rather than spike.
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU;
          for (let k = 0; k < 4; k++) {
            const lean = 0.25 + k * 0.32;
            const rr = 2.6 + k * 1.5;
            b.merge(taperedBox(0.42 - k * 0.07, 0.42 - k * 0.07, 0.35 - k * 0.07, 0.35 - k * 0.07, 2.0,
              k % 2 ? bone : shade(bone, 0.9)),
              matCompose(Math.cos(a) * rr, Math.sin(a) * rr, 5.2 - k * 1.25, 0, lean, a));
          }
        }
        // Torii gate behind it.
        for (const s of [1, -1]) {
          b.merge(cylinder(0.3, 0.24, 6.4, 6, '#8a2a22'), matCompose(-4.6, s * 2.8, 0.6, 0, 0, 0));
        }
        b.merge(box(0.55, 6.6, 0.38, '#a03028'), matCompose(-4.6, 0, 6.0, 0, 0, 0));
        b.merge(taperedBox(0.8, 7.6, 0.6, 7.2, 0.4, '#b03a30'), matCompose(-4.6, 0, 6.5, 0, 0, 0));
        return b.build();
      });
      S.additive = false;
      S.alpha = open;
      S.tint = [1, 0.85, 0.82];
      const sway = Math.sin(time * 0.5) * 0.01;
      const grow = 0.35 + open * 0.65;
      // Set back from the centre: the caster spawns at the middle of their own
      // domain and a shrine this size would swallow them.
      const sx = cx, sy = cy - R * 0.42;
      matCompose(sx, sy, 0.06, sway, sway, 0, grow, grow, grow, tmp);
      drawMesh(env.dl, env.cam, mesh, tmp, S);
      if (env.q.outlines) drawOutline(env.dl, env.cam, mesh, tmp, 1, [14, 6, 6], 2.2);

      // The furnace glow in the shrine's mouth.
      S.additive = true;
      const g = (1.8 + Math.sin(time * 5) * 0.2 + env.pulse * 0.6) * grow;
      put(env, sphereUnit(), sx, sy, 3.6 * grow, 0, 0, 0, g, g, g, 0.5, [2.4, 0.6, 0.35]);
      // Bone piles scattered around it.
      S.additive = false;
      S.tint = [0.95, 0.92, 0.85];
      const n = count(12);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const rr = (0.35 + ((i * 0.41) % 1) * 0.6) * R;
        const s = 0.3 + ((i * 0.77) % 1) * 0.3;
        put(env, sphereUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, s * 0.7,
          0, 0, a, s, s, s * 0.8, open, [0.95, 0.92, 0.85]);
      }
      S.alpha = 1;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Self-Embodiment of Perfection — a still room full of loose souls.
  // -------------------------------------------------------------------------
  soulPalace: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      const n = count(10);
      for (let i = 0; i < n; i++) {
        const ph = ((time * 0.22 + i / n) % 1);
        const r = R * ph;
        put(env, ringUnit(), cx, cy, 0.072, 0, 0, 0, r, r, 1, 0.18 * (1 - ph), env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      // Idols of half-finished people — Mahito's failed shapes.
      const idol = cached('soulIdol', () => {
        const b = new MeshBuilder();
        b.merge(taperedBox(0.5, 0.42, 0.34, 0.3, 1.5, '#7fd4a8'), null);
        b.merge(sphere(0.26, 7, 5, '#a8e8c8'), matCompose(0, 0, 1.7, 0, 0, 0));
        b.merge(taperedBox(0.16, 0.16, 0.08, 0.08, 0.7, '#7fd4a8'),
          matCompose(0.1, 0.3, 1.3, 0, 0.7, 0.4));
        b.merge(taperedBox(0.16, 0.16, 0.08, 0.08, 0.7, '#7fd4a8'),
          matCompose(0.1, -0.3, 1.3, 0, 0.7, -0.4));
        return b.build();
      });
      S.additive = false;
      const n = count(9);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const rr = (0.4 + ((i * 0.37) % 1) * 0.5) * R;
        const bob = Math.sin(time * 0.8 + i) * 0.14;
        put(env, idol, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.1 + bob,
          0, 0, a + PI, 1, 1, 1, 0.75 * open, env.tint);
      }
      // Loose souls drifting: pale blobs with a single eye.
      S.additive = true;
      const m = count(22);
      for (let i = 0; i < m; i++) {
        const a = i * 1.618 + time * 0.14;
        const rr = (0.15 + ((i * 0.53) % 1) * 0.8) * R;
        const z = 0.6 + ((i * 0.29) % 1) * R * 0.4 + Math.sin(time * 0.9 + i) * 0.3;
        const s = 0.16 + ((i * 0.71) % 1) * 0.16;
        put(env, sphereUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z,
          0, 0, 0, s, s, s, 0.4 * open, [1.4, 2.0, 1.7]);
      }
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Coffin of the Iron Mountain — a volcano sealed in a box.
  // -------------------------------------------------------------------------
  volcano: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      // Lava veins cracking outward from the cone.
      const n = count(16);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.sin(i) * 0.2;
        const len = R * (0.4 + ((i * 0.43) % 1) * 0.55);
        const glow = 0.4 + Math.sin(time * 2 + i) * 0.2;
        put(env, boxUnit(), cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5,
          0.07, 0, 0, a, len, 0.16 + glow * 0.08, 0.01, glow, [2.4, 0.9, 0.2]);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      // You are not looking at a volcano, you are standing inside one. The rim
      // is a ring of crater wall; a cone in the middle would just bury whoever
      // cast it, since the caster spawns at the centre of their own domain.
      const slab = cached('calderaSlab', () => {
        const b = new MeshBuilder();
        const rock = '#3a1f14';
        b.merge(prism([[-1, -1], [1, -1.15], [0.8, 1.05], [-0.9, 1]], 1, rock, {
          topColor: shade(rock, 1.3), sideColor: shade(rock, 0.8),
        }), null);
        return b.build();
      });
      S.additive = false;
      S.tint = [1, 0.95, 0.9];
      const n = count(16);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const h = 3.4 + ((i * 0.53) % 1) * 4.6;
        const w = R * 0.24;
        const grow = clamp01((open - ((i * 0.09) % 0.35)) * 3.2);
        if (grow <= 0.02) continue;
        put(env, slab, cx + Math.cos(a) * R * 0.94, cy + Math.sin(a) * R * 0.94, 0.05,
          0, -0.16, a, w, w, h * grow, 1, [1, 0.95, 0.9]);
      }

      // Lava fountains climbing out of the floor around the rim.
      S.additive = true;
      for (let i = 0; i < count(9); i++) {
        const a = i * 2.39996 + time * 0.1;
        const rr = (0.35 + ((i * 0.41) % 1) * 0.5) * R;
        const ph = (time * 0.55 + i * 0.27) % 1;
        const h = Math.sin(ph * PI) * (2.2 + (i % 3) * 1.6);
        if (h < 0.05) continue;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        put(env, coneUnit(), x, y, 0.07, 0, 0, a, 0.42, 0.42, h, 0.7 * open,
          [2.5, 1.0, 0.25]);
        put(env, sphereUnit(), x, y, 0.07 + h, 0, 0, 0, 0.3, 0.3, 0.3, 0.6 * open,
          [2.6, 1.3, 0.3]);
      }
      // The column of heat standing over the centre.
      for (let i = 0; i < count(7); i++) {
        const ph = ((time * 0.4 + i / 7) % 1);
        const rr = R * (0.1 + ph * 0.34);
        put(env, ringUnit(), cx, cy, 0.4 + ph * R * 0.6, 0, 0, ph * 2,
          rr, rr, 1, 0.24 * (1 - ph) * open, [2.2, 0.9, 0.3]);
      }
      // Falling ash.
      const m = count(22);
      for (let i = 0; i < m; i++) {
        const a = i * 2.39996;
        const rr = ((i * 0.31) % 1) * R * 0.92;
        const ph = ((time * 0.7 + i * 0.17) % 1);
        put(env, sphereUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr,
          (1 - ph) * R * 0.6 + 0.2, 0, 0, 0, 0.1, 0.1, 0.1, 0.3 * open, [1.6, 0.7, 0.3]);
      }
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // A sea of blood with things standing in it.
  // -------------------------------------------------------------------------
  bloodSea: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = false;
      // Swell rings on the surface.
      const n = count(11);
      for (let i = 0; i < n; i++) {
        const ph = ((time * 0.3 + i / n) % 1);
        const r = R * ph;
        put(env, ringWide(), cx, cy, 0.07 + Math.sin(time * 2 + i) * 0.03, 0, 0, 0,
          r, r, 1, 0.3 * (1 - ph), [0.9, 0.16, 0.24]);
      }
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      S.additive = false;
      // Blood columns rising and falling like a fountain that never lands.
      const n = count(15);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const rr = Math.sqrt((i + 0.5) / n) * R * 0.9;
        const ph = (time * 0.5 + i * 0.23) % 1;
        const h = Math.sin(ph * PI) * (1.4 + (i % 4) * 0.9);
        if (h < 0.05) continue;
        put(env, coneUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.06,
          0, 0, a, 0.26, 0.26, h, 0.85 * open, [1.15, 0.2, 0.28]);
        S.additive = true;
        put(env, sphereUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.06 + h,
          0, 0, 0, 0.16, 0.16, 0.16, 0.5 * open, [2.2, 0.4, 0.5]);
        S.additive = false;
      }
      S.alpha = 1;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Cursed speech made into architecture: giant words hanging in the air.
  // -------------------------------------------------------------------------
  words: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      const n = count(8);
      for (let i = 0; i < n; i++) {
        const ph = ((time * 0.25 + i / n) % 1);
        const r = R * ph;
        put(env, ringUnit(), cx, cy, 0.072, 0, 0, 0, r, r, 1, 0.22 * (1 - ph), env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { dl, cam, S, R, cx, cy, time, open } = env;
      const WORDS = ['止まれ', '潰れろ', '爆ぜろ', '逃げろ', '眠れ', '動くな'];
      // Tablets: each carries a command and turns slowly to face you.
      const tablet = cached('wordTablet', () => {
        const b = new MeshBuilder();
        b.merge(box(0.1, 1.5, 2.1, '#2a2418'), null);
        b.merge(box(0.04, 1.34, 1.94, '#efe4c4'), matCompose(0.06, 0, 0.08, 0, 0, 0));
        return b.build();
      });
      S.additive = false;
      const n = count(10);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + time * 0.08;
        const rr = (0.4 + ((i * 0.37) % 1) * 0.52) * R;
        const z = 0.4 + ((i * 0.61) % 1) * R * 0.34 + Math.sin(time * 0.6 + i) * 0.18;
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
        put(env, tablet, x, y, z, 0, 0, a + PI, 1, 1, 1, 0.85 * open, [1, 0.97, 0.88]);
        // The command itself, drawn as billboarded text on the tablet face.
        const p = cam.project(x + Math.cos(a + PI) * 0.1, y + Math.sin(a + PI) * 0.1, z + 1.05);
        if (p.d > cam.near) {
          const px = Math.max(9, 2.4 * cam.f / p.d);
          dl.text(p.d - 0.2, p.x, p.y, WORDS[i % WORDS.length], '#1a1710',
            `700 ${px.toFixed(0)}px "Noto Sans JP", system-ui, sans-serif`, open);
        }
      }
      S.alpha = 1;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // A hive: the air itself is insects.
  // -------------------------------------------------------------------------
  swarm: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      const n = count(14);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + time * 0.2;
        const rr = Math.sqrt((i + 0.5) / n) * R * 0.92;
        const s = 0.5 + Math.sin(time * 3 + i) * 0.2;
        put(env, ringUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.07,
          0, 0, 0, s, s, 1, 0.3, env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      // The hive column at the centre.
      const hive = cached('hiveCol', () => {
        const b = new MeshBuilder();
        for (let i = 0; i < 6; i++) {
          const r = 1.5 - i * 0.18;
          b.merge(cylinder(r, r * 0.92, 0.85, 8, i % 2 ? '#1c2f2a' : '#27443c'),
            matCompose(0, 0, i * 0.85, 0, 0, i * 0.4));
        }
        return b.build();
      });
      S.additive = false;
      S.alpha = open;
      S.tint = [1, 1, 1];
      matCompose(cx, cy - R * 0.45, 0.06, 0, 0, time * 0.1, 1, 1, 1, tmp);
      drawMesh(env.dl, env.cam, hive, tmp, S);

      // The swarm: dense clouds of small bodies orbiting in bands.
      S.additive = true;
      const n = count(70);
      for (let i = 0; i < n; i++) {
        const band = i % 5;
        const a = i * 0.9 + time * (1.4 + band * 0.4);
        const rr = (0.2 + band * 0.18) * R + Math.sin(time * 3 + i) * 0.4;
        const z = 0.5 + band * 0.7 + Math.sin(time * 4 + i * 0.7) * 0.4;
        put(env, sphereUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z,
          0, 0, 0, 0.07, 0.07, 0.07, 0.6 * open, env.tint);
      }
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Deadly Sentencing — a courtroom, and you are the defendant.
  // -------------------------------------------------------------------------
  courtroom: {
    floor(env) {
      const { S, R, cx, cy } = env;
      S.additive = true;
      // The aisle running from the gallery to the bench.
      put(env, boxUnit(), cx, cy, 0.072, 0, 0, PI / 2, R * 1.6, 1.8, 0.01, 0.16, env.tint);
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      const wood = '#3a2a1e', pale = '#6a5238';
      // Judge's bench with the seal on its front.
      const bench = cached('courtBench', () => {
        const b = new MeshBuilder();
        b.merge(box(1.4, 6.2, 1.5, wood, { topColor: pale }), null);
        b.merge(box(1.7, 6.6, 0.16, pale), matCompose(0, 0, 1.5, 0, 0, 0));
        b.merge(box(2.6, 7.4, 0.5, shade(wood, 0.7)), matCompose(0.2, 0, -0.5, 0, 0, 0));
        // Back panelling rising behind it.
        b.merge(box(0.35, 7.4, 4.4, shade(wood, 0.85)), matCompose(-1.2, 0, -0.5, 0, 0, 0));
        b.merge(cylinder(1.1, 1.1, 0.12, 12, '#cfa8ff'), matCompose(-1.0, 0, 3.0, 0, PI / 2, 0));
        return b.build();
      });
      S.additive = false;
      S.alpha = open;
      S.tint = [1, 0.96, 1];
      matCompose(cx, cy - R * 0.58, 0.06, 0, 0, PI / 2, 1, 1, 1, tmp);
      drawMesh(env.dl, env.cam, bench, tmp, S);
      if (env.q.outlines) drawOutline(env.dl, env.cam, bench, tmp, 1, [10, 8, 14], 2.2);

      // Gallery pews facing the bench.
      const pew = cached('courtPew', () => {
        const b = new MeshBuilder();
        b.merge(box(0.5, 4.4, 0.5, wood, { topColor: pale }), null);
        b.merge(box(0.22, 4.4, 0.9, shade(wood, 0.9)), matCompose(-0.2, 0, 0.5, 0, 0, 0));
        return b.build();
      });
      for (let i = 0; i < count(5); i++) {
        for (const s of [1, -1]) {
          put(env, pew, cx + s * 3.4, cy + R * 0.06 + i * 1.7, 0.06, 0, 0, -PI / 2,
            1, 1, 1, open, [1, 0.96, 1]);
        }
      }

      // The gavel, hanging above the centre and falling on every sure-hit tick.
      const gavel = cached('courtGavel', () => {
        const b = new MeshBuilder();
        b.merge(cylinder(0.16, 0.16, 1.5, 8, '#2a1e14'), matCompose(0, 0, 0.5, 0, PI / 2, 0));
        b.merge(cylinder(0.42, 0.42, 1.0, 10, '#4a3424'), matCompose(0, 0, 0, 0, PI / 2, 0));
        b.merge(cylinder(0.46, 0.46, 0.12, 10, '#cfa8ff'), matCompose(0, 0, -0.5, 0, PI / 2, 0));
        return b.build();
      });
      const drop = env.pulse;
      put(env, gavel, cx, cy, 2.6 + (1 - drop) * 1.6, 0, -drop * 0.8, 0,
        1.4, 1.4, 1.4, open, [1.1, 1.0, 1.2]);

      // Verdict light from above.
      S.additive = true;
      const g = R * 0.25;
      put(env, coneUnit(), cx, cy, R * 0.6, 0, PI, 0, g, g, R * 0.55,
        0.09 + env.pulse * 0.12, env.tint);
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Frozen Sanctuary — an ice field with a ceiling of hanging fangs.
  // -------------------------------------------------------------------------
  ice: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      // Frost fracture lines spreading from the caster.
      const n = count(22);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + Math.sin(i * 3.1) * 0.3;
        const len = R * (0.5 + ((i * 0.53) % 1) * 0.5);
        put(env, boxUnit(), cx + Math.cos(a) * len * 0.5, cy + Math.sin(a) * len * 0.5,
          0.072, 0, 0, a, len, 0.1, 0.01, 0.35, env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      const shard = cached('iceShard', () => {
        const b = new MeshBuilder();
        b.merge(prism([[-0.4, -0.35], [0.45, -0.2], [0.3, 0.42], [-0.35, 0.3]], 1,
          '#8ad4f0', { topColor: '#d8f4ff' }), null);
        return b.build();
      });
      S.additive = false;
      // Shards standing out of the floor.
      const n = count(18);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996;
        const rr = Math.sqrt((i + 0.4) / n) * R * 0.92;
        const h = 1.2 + ((i * 0.37) % 1) * 3.4;
        const grow = clamp01((open - ((i * 0.13) % 0.4)) * 3);
        if (grow <= 0.02) continue;
        put(env, shard, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.06,
          0.1, 0.1, a, 0.7, 0.7, h * grow, 0.8, [1.05, 1.1, 1.2]);
      }
      // Fangs hanging from the barrier, waiting to drop.
      const m = count(14);
      for (let i = 0; i < m; i++) {
        const a = i * 2.39996 + 1.1;
        const rr = (0.2 + ((i * 0.61) % 1) * 0.68) * R;
        const drop = ((time * 0.5 + i * 0.23) % 1);
        const z = R * 0.6 - drop * R * 0.55;
        put(env, coneUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z,
          0, PI, a, 0.3, 0.3, 1.5, 0.8 * open, [1.05, 1.15, 1.3]);
      }
      // A cold haze over the whole floor.
      S.additive = true;
      put(env, discUnit(), cx, cy, 0.35, 0, 0, 0, R * 0.95, R * 0.95, 1, 0.07, env.tint);
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Authentic Mutual Love — she is the barrier, and she is everywhere in it.
  // -------------------------------------------------------------------------
  love: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      const n = count(10);
      for (let i = 0; i < n; i++) {
        const ph = ((time * 0.4 + i / n) % 1);
        const r = R * (1 - ph);
        put(env, ringUnit(), cx, cy, 0.072, 0, 0, 0, r, r, 1, 0.28 * ph, env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      // Ribbons of her hair sweeping through the whole volume.
      S.additive = true;
      const n = count(26);
      for (let i = 0; i < n; i++) {
        const a = i * 2.39996 + time * 0.3;
        const rr = (0.25 + ((i * 0.41) % 1) * 0.7) * R;
        const z = 0.4 + ((i * 0.29) % 1) * R * 0.55;
        const len = 2 + ((i * 0.67) % 1) * 3;
        put(env, boxUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z,
          Math.sin(time + i) * 0.4, 1.3 + Math.sin(time * 0.7 + i) * 0.3, a,
          0.09, 0.09, len, 0.4 * open, env.tint);
      }
      // The maw overhead: the thing that is actually eating you.
      const maw = cached('loveMaw', () => {
        const b = new MeshBuilder();
        b.merge(lump(1.6, '#e8a0c0', 4, 0.9), null);
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU;
          b.merge(cone(0.16, 0.7, 4, '#fdf0f4'),
            matCompose(Math.cos(a) * 1.15, Math.sin(a) * 1.15, -0.4, 0, i % 2 ? PI : 0.2, a));
        }
        return b.build();
      });
      S.additive = false;
      const bob = Math.sin(time * 0.8) * 0.3;
      const bite = 1 + env.pulse * 0.16;
      put(env, maw, cx, cy, R * 0.52 + bob, 0, 0, time * 0.2, bite, bite, bite,
        0.9 * open, [1, 0.95, 1]);
      S.additive = true;
      put(env, sphereUnit(), cx, cy, R * 0.52 + bob, 0, 0, 0, 1.9, 1.9, 1.9,
        0.14 + env.pulse * 0.2, env.tint);
      // Her eyes, watching from the shell.
      const eye = eyeMesh(0.34, '#ff5a8a');
      for (let i = 0; i < count(6); i++) {
        const a = (i / 6) * TAU + time * 0.05;
        const ph = 0.35 + ((i * 0.37) % 1) * 0.4;
        const zr = Math.cos(ph * PI * 0.5), z = Math.sin(ph * PI * 0.5);
        S.additive = false;
        put(env, eye, cx + Math.cos(a) * zr * R * 0.9, cy + Math.sin(a) * zr * R * 0.9,
          z * R * 0.6, 0, 0, a + PI, 1, 1, 1, 0.9 * open, [1, 1, 1]);
      }
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Idle Death Gamble — a pachinko parlour where the payout is your life.
  // -------------------------------------------------------------------------
  pachinko: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = true;
      // Carpet light strips running out from the machines.
      for (let i = 0; i < count(16); i++) {
        const a = (i / 16) * TAU;
        const ph = (time * 1.2 + i * 0.1) % 1;
        put(env, boxUnit(), cx + Math.cos(a) * R * 0.5, cy + Math.sin(a) * R * 0.5,
          0.072, 0, 0, a, R, 0.12, 0.01, 0.2 + ph * 0.3, env.tint);
      }
      S.additive = false;
    },
    interior(env) {
      const { dl, cam, S, R, cx, cy, time, open, d } = env;
      // The cabinet: three reels behind glass, in a neon frame.
      const cab = cached('pachiCab', () => {
        const b = new MeshBuilder();
        b.merge(box(0.6, 2.6, 3.4, '#241a08', { topColor: '#3a2a10' }), null);
        b.merge(box(0.12, 2.3, 1.5, '#0a0a0e'), matCompose(0.3, 0, 1.3, 0, 0, 0));
        b.merge(box(0.08, 2.5, 0.18, '#ffd166'), matCompose(0.33, 0, 2.9, 0, 0, 0));
        b.merge(box(0.08, 2.5, 0.18, '#ff5a8a'), matCompose(0.33, 0, 0.7, 0, 0, 0));
        return b.build();
      });
      const reel = cached('pachiReel', () => cylinder(0.42, 0.42, 0.62, 10, '#f4ead0'));

      S.additive = false;
      const n = count(10);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const x = cx + Math.cos(a) * R * 0.78, y = cy + Math.sin(a) * R * 0.78;
        put(env, cab, x, y, 0.06, 0, 0, a + PI, 1, 1, 1, open, [1, 1, 1]);
        // Spinning reels in each cabinet.
        for (let k = 0; k < 3; k++) {
          const spin = time * (7 + k * 2.5 + i) + i;
          put(env, reel, x + Math.cos(a + PI) * 0.34, y + Math.sin(a + PI) * 0.34,
            1.3 + 0.0, 0, PI / 2, a + PI + 0, 1, 1, 1, open, [1, 0.98, 0.9]);
        }
      }

      // The centrepiece reels: three drums side by side on a shared axle, big
      // enough to read the symbols from anywhere inside the barrier.
      const symbols = ['7', '★', '7', '◆', '7', '♠'];
      const jackpot = d.jackpot || env.pulse > 0.6;
      const reelZ = R * 0.34;
      put(env, cylUnit(), cx - 4.2, cy, reelZ, 0, PI / 2, 0, 0.16, 0.16, 8.4,
        0.9 * open, [0.6, 0.55, 0.5]);
      for (let k = 0; k < 3; k++) {
        const x = cx + (k - 1) * 2.5;
        put(env, cylUnit(), x - 0.95, cy, reelZ, 0, PI / 2, 0, 1.15, 1.15, 1.9,
          0.9 * open, jackpot ? [2.2, 1.8, 0.6] : [1.15, 1.08, 0.92]);
        const spin = jackpot ? 0 : Math.floor(time * (9 + k * 3)) % symbols.length;
        const p = cam.project(x, cy - 1.2, reelZ);
        if (p.d > cam.near) {
          const px = Math.max(10, 1.7 * cam.f / p.d);
          dl.text(p.d - 0.4, p.x, p.y + px * 0.35, jackpot ? '7' : symbols[spin],
            jackpot ? '#ff3b30' : '#2a1e08',
            `900 ${px.toFixed(0)}px system-ui, sans-serif`, open);
        }
      }

      // Confetti of steel balls when the jackpot is live.
      if (jackpot) {
        S.additive = true;
        for (let i = 0; i < count(40); i++) {
          const a = i * 2.39996 + time * 2;
          const rr = ((time * 3 + i * 0.17) % 1) * R;
          const z = (1 - ((time * 3 + i * 0.17) % 1)) * R * 0.5 + 0.3;
          put(env, sphereUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, z,
            0, 0, 0, 0.11, 0.11, 0.11, 0.8, [2.4, 2.0, 0.8]);
        }
        S.additive = false;
      }
      S.alpha = 1;
      S.tint = null;
    },
  },

  // -------------------------------------------------------------------------
  // Disaster Tides — the domain floods and the water does not care about you.
  // -------------------------------------------------------------------------
  tide: {
    floor(env) {
      const { S, R, cx, cy, time } = env;
      S.additive = false;
      // Wave crests travelling outward.
      const n = count(12);
      for (let i = 0; i < n; i++) {
        const ph = ((time * 0.45 + i / n) % 1);
        const r = R * ph;
        put(env, ringWide(), cx, cy, 0.075 + Math.sin(time * 3 + i) * 0.05, 0, 0, 0,
          r, r, 1, 0.3 * (1 - ph * 0.6), [0.5, 0.9, 1.1]);
      }
    },
    interior(env) {
      const { S, R, cx, cy, time, open } = env;
      // The whirlpool at the centre.
      S.additive = false;
      for (let i = 0; i < count(7); i++) {
        const rr = R * (0.12 + i * 0.1);
        put(env, ringWide(), cx, cy, 0.09 + i * 0.14, 0, 0, time * (1.4 - i * 0.14),
          rr, rr, 1, 0.35 * open, [0.45, 0.85, 1.05]);
      }
      // Standing water columns that sweep the floor.
      S.additive = true;
      const n = count(16);
      for (let i = 0; i < n; i++) {
        const a = i * 0.9 + time * 0.8;
        const rr = (0.25 + ((i * 0.41) % 1) * 0.7) * R;
        const h = 1.4 + Math.sin(time * 1.6 + i) * 1.1;
        put(env, cylUnit(), cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0.08,
          0, 0, 0, 0.34, 0.34, Math.max(0.2, h), 0.3 * open, env.tint);
      }
      // Spray at the rim where the water hits the barrier.
      for (let i = 0; i < count(24); i++) {
        const a = (i / 24) * TAU + time * 0.25;
        const z = 0.3 + ((time * 1.4 + i * 0.19) % 1) * R * 0.45;
        put(env, sphereUnit(), cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92, z,
          0, 0, 0, 0.16, 0.16, 0.16, 0.35 * open, [1.2, 1.8, 2.1]);
      }
      S.alpha = 1;
      S.additive = false;
      S.tint = null;
    },
  },
};

export { STYLES3 };
