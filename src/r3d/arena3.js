// The arena in 3D: ground plate, tiling floor, destructible props and the veil
// wall. The ground is drawn as a coarse grid of quads rather than one huge
// plane so that fog, damage decals and the domain floor can vary across it
// without any per-pixel work.

import { clamp, clamp01, lerp, TAU, PI } from '../core/math.js';
import { matCompose, matMul, hexToRgb, shadeColor } from './core3.js';
import {
  MeshBuilder, taperedBox, box, cylinder, cone, sphere, prism, disc, ringMesh,
  domeMesh, plane, drawMesh, drawOutline,
} from './geom3.js';
import { shade, cached } from './models3.js';

const tmp = new Float32Array(16);
const tmp2 = new Float32Array(16);

/**
 * Arena palettes are authored for a flat 2D wash, where the colour you write is
 * the colour that lands on screen. Under real lighting the same values are
 * multiplied by a shading term and a grade, and a floor written as #161d18
 * comes out as near-black. Everything the arena supplies is lifted on the way
 * into the 3D renderer so the authored colour is what the lit surface reads as.
 */
const LIFT = 1.6;
const lift = (c, k = LIFT) => shade(c || '#202020', k);

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

const CHUNK = 4;                   // tiles per side in a baked floor chunk

/**
 * A baked CHUNK×CHUNK block of floor, one mesh, spanning -0.5..CHUNK-0.5 in
 * tile units. The checker and the grout are part of the geometry: each tile is
 * an inset face plus an L of two grout strips, so nothing is ever coplanar with
 * anything else and a painter's sort can never z-fight it.
 *
 * Baking blocks rather than drawing tiles one at a time is what makes the floor
 * affordable — sixteen tiles cost one matrix setup and share their vertices.
 */
function tileQuads(b, i, j, col, grid, g) {
  const x0 = i - 0.5 + g, x1 = i + 0.5, y0 = j - 0.5 + g, y1 = j + 0.5;
  const v = (x, y) => b.vert(x, y, 0);
  b.quad(v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y1), col, true, 0);
  if (!g) return;
  const gx = i - 0.5, gy = j - 0.5;
  b.quad(v(gx, gy), v(x1, gy), v(x1, y0), v(gx, y0), grid, true, 0);
  b.quad(v(gx, y0), v(x0, y0), v(x0, y1), v(gx, y1), grid, true, 0);
}

const chunkMesh = (base, alt, grid, grout) => cached(
  `chunk:${base}:${alt}:${grid}:${grout}`, () => {
    const b = new MeshBuilder();
    // CHUNK is even, so the checker parity is continuous across chunk seams and
    // a single baked block tiles the plane without variants.
    for (let i = 0; i < CHUNK; i++) {
      for (let j = 0; j < CHUNK; j++) {
        tileQuads(b, i, j, ((i + j) & 1) ? base : alt, grid, grout ? 0.03 : 0);
      }
    }
    return b.build();
  });

const oneTile = (col, grid, grout) => cached(`tile1:${col}:${grid}:${grout}`, () => {
  const b = new MeshBuilder();
  tileQuads(b, 0, 0, col, grid, grout ? 0.03 : 0);
  return b.build();
});

/**
 * Emit one square band of floor at a given resolution. Chunks that straddle a
 * domain edge drop to per-tile granularity: a domain replaces the ground it
 * covers, and leaving even one arena quad overlapping the domain floor would
 * flicker, since two coplanar surfaces have no stable painter's order.
 */
function tileBand(dl, cam, S, pal, cx, cy, step, inner, outer, R, world, grout) {
  const span = CHUNK * step;
  const i0 = Math.floor((cx - outer) / span), i1 = Math.ceil((cx + outer) / span);
  const j0 = Math.floor((cy - outer) / span), j1 = Math.ceil((cy + outer) / span);
  const half = span * 0.5;
  const diag = half * Math.SQRT2;
  const chunk = chunkMesh(pal[0], pal[1], pal[2], grout);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const x = i * span, y = j * span;              // chunk origin tile centre
      const mx = x + half - step * 0.5, my = y + half - step * 0.5;
      const d = Math.max(Math.abs(mx - cx), Math.abs(my - cy));
      if (d - half > outer || d + half < inner) continue;
      if (Math.hypot(mx, my) > R + span) continue;
      if (!cam.visible(mx, my, 0, span)) continue;

      const near = domainProximity(world, mx, my);
      if (near !== null && near < diag) {
        if (near < -diag) continue;                  // wholly swallowed
        for (let ti = 0; ti < CHUNK; ti++) {
          for (let tj = 0; tj < CHUNK; tj++) {
            const tx = x + ti * step, ty = y + tj * step;
            if (insideDomain(world, tx, ty, step * 0.5)) continue;
            const odd = ((i * CHUNK + ti) + (j * CHUNK + tj)) & 1;
            matCompose(tx, ty, 0, 0, 0, 0, step, step, 1, tmp);
            drawMesh(dl, cam, oneTile(odd ? pal[0] : pal[1], pal[2], grout), tmp, S);
          }
        }
        continue;
      }
      if (near !== null && near < 0) continue;
      matCompose(x, y, 0, 0, 0, 0, step, step, 1, tmp);
      drawMesh(dl, cam, chunk, tmp, S);
    }
  }
}

/** Signed distance from a point to the nearest domain edge, or null if none. */
function domainProximity(world, x, y) {
  let best = null;
  for (const d of world.domains) {
    if (d.closed) continue;
    const reveal = clamp01((d.t - 0.08) / 0.5);
    const r = d.radius * (1 - Math.pow(1 - reveal, 5));
    if (r <= 0) continue;
    const s = Math.hypot(x - d.center.x, y - d.center.y) - r;
    if (best === null || s < best) best = s;
  }
  return best;
}

/**
 * The floor near the camera is tiled at full resolution and everything beyond
 * it far more coarsely, so the ground reaches the horizon for a few hundred
 * quads instead of the ten thousand an even grid would cost.
 */
export function drawGround3(dl, cam, world, S, q) {
  const a = world.arena;
  const R = world.arenaRadius;
  const cx = cam.lookAt.x, cy = cam.lookAt.y;
  const step = q.detail > 1 ? 2.5 : 3.5;
  const near = q.detail > 1 ? 24 : 18;
  const far = q.detail > 0 ? 78 : 50;
  const pal = [lift(a.ground), lift(a.groundAlt), lift(a.grid, LIFT * 1.35)];

  S.additive = false;
  S.tint = null;
  S.alpha = 1;
  S.fogNear = 22;
  S.fogFar = far;

  // Both bands carry their grout. Dropping it from the far one was cheaper but
  // left a brightness step down the seam between them — a grouted tile averages
  // brighter than a plain one, so the near field read as a lit rectangle with
  // darker ground either side of it.
  const grout = q.detail > 0;
  tileBand(dl, cam, S, pal, cx, cy, step, 0, near, R, world, grout);
  tileBand(dl, cam, S, pal, cx, cy, step * 3, near, far, R, world, grout);

  // Ground marks: static scuffs baked by the sim's seeded RNG. They sit just
  // above the floor, and are small enough that their centroids sort cleanly.
  if (q.detail > 0 && world.groundMarks) {
    const mark = cached(`mark:${a.grid}`, () => disc(1, 10, lift(a.grid, LIFT * 1.7), 0));
    for (const m of world.groundMarks) {
      if (Math.hypot(m.x - cx, m.y - cy) > near * 0.85) continue;
      if (insideDomain(world, m.x, m.y)) continue;
      matCompose(m.x, m.y, 0.014, 0, 0, m.a, m.r * 0.8, m.r * 0.5, 1, tmp);
      S.alpha = 0.22 + m.tone * 0.08;
      drawMesh(dl, cam, mark, tmp, S);
    }
    S.alpha = 1;
  }
  S.fogNear = undefined;
}

/**
 * A domain replaces the ground it covers. Anything the arena would have drawn
 * inside one is skipped outright rather than layered under it, which is both
 * correct and the only way coplanar surfaces sort reliably.
 */
export function insideDomain(world, x, y, pad = 0) {
  for (const d of world.domains) {
    if (d.closed) continue;
    // The interior wipes outward over the first half second; only the part it
    // has actually reached counts as covered.
    const reveal = clamp01((d.t - 0.08) / 0.5);
    const r = d.radius * (1 - Math.pow(1 - reveal, 5)) - pad;
    if (r <= 0) continue;
    const dx = x - d.center.x, dy = y - d.center.y;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

const PROP_BUILDERS = {
  pillar(p) {
    const b = new MeshBuilder();
    const c = p.color;
    b.merge(box(1.05, 1.05, 0.12, shade(c, 0.7)), null);
    b.merge(taperedBox(0.92, 0.92, 0.84, 0.84, 0.82, c, { topColor: shade(c, 1.2) }),
      matCompose(0, 0, 0.12, 0, 0, 0));
    b.merge(box(1.0, 1.0, 0.08, shade(c, 1.15)), matCompose(0, 0, 0.92, 0, 0, 0));
    return b.build();
  },
  building(p) {
    const b = new MeshBuilder();
    const c = p.color;
    b.merge(taperedBox(1.9, 1.7, 1.7, 1.55, 1, c, { topColor: shade(c, 1.3) }), null);
    // Window bands.
    for (let i = 1; i < 5; i++) {
      b.merge(box(1.95, 1.75, 0.045, '#3f4c60'), matCompose(0, 0, i * 0.19, 0, 0, 0));
    }
    return b.build();
  },
  car(p) {
    const b = new MeshBuilder();
    const c = p.color;
    b.merge(taperedBox(2.3, 1.15, 2.2, 1.1, 0.42, c, { topColor: shade(c, 1.15) }),
      matCompose(0, 0, 0.16, 0, 0, 0));
    b.merge(taperedBox(1.2, 1.0, 0.95, 0.85, 0.36, shade(c, 1.25), { topColor: shade(c, 1.4) }),
      matCompose(-0.12, 0, 0.58, 0, 0, 0));
    // Glass.
    b.merge(box(1.24, 1.02, 0.2, '#2b3a4a'), matCompose(-0.12, 0, 0.62, 0, 0, 0));
    for (const sx of [0.72, -0.72]) {
      for (const sy of [0.56, -0.56]) {
        b.merge(cylinder(0.26, 0.26, 0.16, 7, '#15151a'),
          matCompose(sx, sy, 0.26, PI / 2, 0, 0));
      }
    }
    return b.build();
  },
  sign(p) {
    const b = new MeshBuilder();
    b.merge(cylinder(0.06, 0.05, 0.72, 5, '#3a3a42'), null);
    b.merge(box(0.1, 0.95, 0.28, p.color, { z0: 0 }), matCompose(0, 0, 0.72, 0, 0, 0));
    if (p.emissive) {
      b.merge(box(0.04, 0.82, 0.2, p.emissive, { z0: 0 }), matCompose(0.06, 0, 0.76, 0, 0, 0));
    }
    return b.build();
  },
  barrier(p) {
    const b = new MeshBuilder();
    const c = p.color;
    b.merge(box(0.4, 1.9, 0.12, shade(c, 0.7)), null);
    for (const s of [0.5, -0.5]) {
      b.merge(box(0.2, 0.2, 0.95, shade(c, 0.9)), matCompose(0, s * 1.5, 0.05, 0, 0, 0));
    }
    for (let i = 0; i < 3; i++) {
      b.merge(box(0.14, 1.85, 0.2, i % 2 ? '#e8e2d0' : c),
        matCompose(0, 0, 0.3 + i * 0.26, 0, 0, 0));
    }
    return b.build();
  },
  tree(p) {
    // Authored inside the unit cylinder (x,y within ±1, z within 0..1) so the
    // prop's radius and height in the arena data scale it correctly.
    const b = new MeshBuilder();
    b.merge(cylinder(0.14, 0.09, 0.46, 6, '#2e2620'), null);
    const leaf = p.color;
    b.merge(cone(1.0, 0.3, 7, leaf), matCompose(0, 0, 0.34, 0, 0, 0));
    b.merge(cone(0.84, 0.3, 7, shade(leaf, 1.18)), matCompose(0, 0, 0.54, 0, 0, 0.45));
    b.merge(cone(0.6, 0.3, 6, shade(leaf, 1.34)), matCompose(0, 0, 0.72, 0, 0, 0.9));
    return b.build();
  },
  rock(p) {
    const b = new MeshBuilder();
    const c = p.color;
    b.merge(sphere(0.78, 7, 4, c, { sz: 0.7 }), matCompose(0, 0, 0.42, 0, 0, 0));
    b.merge(sphere(0.42, 6, 4, shade(c, 1.2), { sz: 0.8 }), matCompose(0.3, 0.2, 0.6, 0, 0, 0));
    return b.build();
  },
  torii(p) {
    const b = new MeshBuilder();
    const c = p.color;
    for (const s of [1, -1]) {
      b.merge(cylinder(0.11, 0.09, 0.84, 6, c), matCompose(0, s * 0.62, 0, 0, 0, 0));
    }
    b.merge(box(0.22, 1.72, 0.1, shade(c, 1.15)), matCompose(0, 0, 0.66, 0, 0, 0));
    b.merge(taperedBox(0.3, 1.9, 0.24, 1.75, 0.1, shade(c, 1.3)), matCompose(0, 0, 0.84, 0, 0, 0));
    return b.build();
  },
  skullpile(p) {
    const b = new MeshBuilder();
    const c = p.color;
    for (let i = 0; i < 11; i++) {
      const a = i * 2.39996;
      const rr = (0.25 + ((i * 0.37) % 1) * 0.5);
      b.merge(sphere(0.3, 6, 4, i % 2 ? c : shade(c, 0.82)),
        matCompose(Math.cos(a) * rr, Math.sin(a) * rr, 0.25 + (i % 4) * 0.2, 0, 0, a));
    }
    return b.build();
  },
  brazier(p) {
    const b = new MeshBuilder();
    const c = p.color;
    b.merge(cylinder(0.2, 0.3, 0.62, 6, c), null);
    b.merge(cylinder(0.75, 0.95, 0.24, 8, shade(c, 1.2)), matCompose(0, 0, 0.62, 0, 0, 0));
    b.merge(disc(0.85, 8, p.emissive || '#ff7a2a', 1), matCompose(0, 0, 0.86, 0, 0, 0));
    return b.build();
  },
};

function propMesh(p) {
  const build = PROP_BUILDERS[p.type] || PROP_BUILDERS.pillar;
  return cached(`prop:${p.type}:${p.color}:${p.emissive || ''}`,
    () => build({ ...p, color: lift(p.color, 1.55) }));
}

export function drawProps3(dl, cam, world, S, q, time) {
  S.additive = false;
  S.alpha = 1;
  S.fogNear = 24;
  S.fogFar = 70;
  const cx = cam.pos.x, cy = cam.pos.y;
  for (const p of world.props) {
    if (p.destroyed) continue;
    if (!cam.visible(p.pos.x, p.pos.y, p.height * 0.5, p.height)) continue;
    // Small clutter stops being legible long before it stops being drawn.
    const d = Math.hypot(p.pos.x - cx, p.pos.y - cy);
    if (d > 30 && p.height < 2.2) continue;
    if (d > 62) continue;
    const mesh = propMesh(p);
    const dmg = 1 - clamp01(p.hp / p.maxHp);
    const shakeAmt = p.shakeT > 0 ? p.shakeT * 0.12 : 0;
    const sx = p.radius * (p.type === 'building' ? 1 : 1.05);
    const tiltX = shakeAmt ? Math.sin(time * 40) * shakeAmt : 0;
    const tiltY = shakeAmt ? Math.cos(time * 37) * shakeAmt : 0;
    matCompose(p.pos.x, p.pos.y, 0, tiltX, tiltY, p.rot, sx, sx, p.height, tmp);
    S.tint = dmg > 0.3 ? [1 - dmg * 0.25, 1 - dmg * 0.35, 1 - dmg * 0.35] : null;
    drawMesh(dl, cam, mesh, tmp, S);
    if (q.outlines && q.detail > 1) drawOutline(dl, cam, mesh, tmp, 1, [10, 10, 14], 1.8);
  }
  S.tint = null;
  S.fogNear = undefined;
}

// ---------------------------------------------------------------------------
// The veil
// ---------------------------------------------------------------------------

const veilMesh = () => cached('veil', () => {
  const b = new MeshBuilder();
  const seg = 40;
  const rows = 6;
  for (let j = 0; j < rows; j++) {
    const z0 = j / rows, z1 = (j + 1) / rows;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * TAU, a1 = ((i + 1) / seg) * TAU;
      const v0 = b.vert(Math.cos(a0), Math.sin(a0), z0);
      const v1 = b.vert(Math.cos(a1), Math.sin(a1), z0);
      const v2 = b.vert(Math.cos(a1), Math.sin(a1), z1);
      const v3 = b.vert(Math.cos(a0), Math.sin(a0), z1);
      // Alternate tones so the curtain reads as falling sheets.
      const tone = (i + j) % 3 === 0 ? '#ffffff' : ((i * 7 + j) % 2 ? '#c8c8d8' : '#8a8aa0');
      b.quad(v0, v1, v2, v3, tone, true, 1);
    }
  }
  return b.build();
});

export function drawVeil3(dl, cam, world, S, time) {
  if (!world.arena.veil) return;
  const R = world.veilRadius;
  const h = 16;
  S.additive = true;
  S.alpha = 0.16;
  const c = hexToRgb(world.arena.veilColor || '#4a1020');
  S.tint = [c[0] / 110, c[1] / 110, c[2] / 110];
  matCompose(0, 0, 0, 0, 0, time * 0.05, R, R, h, tmp);
  drawMesh(dl, cam, veilMesh(), tmp, S);
  // A brighter band right at the floor line.
  S.alpha = 0.32;
  matCompose(0, 0, 0.02, 0, 0, -time * 0.1, R, R, 1, tmp);
  drawMesh(dl, cam, cached('veilRing', () => ringMesh(0.97, 1, 48, '#ffffff', 1)), tmp, S);
  S.additive = false;
  S.alpha = 1;
  S.tint = null;
}

// ---------------------------------------------------------------------------
// Sky
// ---------------------------------------------------------------------------

/**
 * A sky is a gradient behind everything — cheaper and better looking as a flat
 * 2D pass than as geometry, so this draws straight to the context before the
 * draw list flushes.
 */
const skyCache = new Map();
export function drawSky(ctx, cam, arena, w, h) {
  const key = `${arena.id}:${w}x${h}`;
  let g = skyCache.get(key);
  if (!g) {
    g = ctx.createLinearGradient(0, 0, 0, h);
    const horizon = lift(arena.fog || '#0a0b10', 2.2);
    const top = arena.timeOfDay === 'dusk' ? shade(arena.light || '#cfe0b0', 0.5)
      : arena.timeOfDay === 'void' ? '#141a2a'
      : lift(arena.ground || '#14161c', 1.9);
    g.addColorStop(0, top);
    g.addColorStop(0.62, horizon);
    g.addColorStop(1, shade(horizon, 0.72));
    skyCache.set(key, g);
    if (skyCache.size > 12) skyCache.clear();
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
