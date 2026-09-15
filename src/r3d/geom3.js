// Low-poly primitive builders and the mesh rasteriser.
//
// Meshes are plain buffers: positions, triangle indices, one colour per face.
// Winding is counter-clockwise seen from outside, so a face whose view-space
// normal points at the camera (+z) is front-facing.

import { clamp, clamp01, lerp, TAU, PI } from '../core/math.js';
import { hexToRgb, shadeColor, matCompose } from './core3.js';

export class MeshBuilder {
  constructor() {
    this.v = [];
    this.f = [];
    this.fc = [];
    this.dbl = [];
    this.emis = [];
  }

  vert(x, y, z) {
    this.v.push(x, y, z);
    return this.v.length / 3 - 1;
  }

  tri(a, b, c, color, double = false, emissive = 0) {
    this.f.push(a, b, c);
    this.fc.push(hexToRgb(color));
    this.dbl.push(double ? 1 : 0);
    this.emis.push(emissive);
  }

  quad(a, b, c, d, color, double = false, emissive = 0) {
    this.tri(a, b, c, color, double, emissive);
    this.tri(a, c, d, color, double, emissive);
  }

  /** Append another mesh, transformed by a matrix. */
  merge(mesh, mat) {
    const base = this.v.length / 3;
    for (let i = 0; i < mesh.nv; i++) {
      const x = mesh.v[i * 3], y = mesh.v[i * 3 + 1], z = mesh.v[i * 3 + 2];
      if (mat) {
        this.v.push(
          mat[0] * x + mat[1] * y + mat[2] * z + mat[3],
          mat[4] * x + mat[5] * y + mat[6] * z + mat[7],
          mat[8] * x + mat[9] * y + mat[10] * z + mat[11],
        );
      } else {
        this.v.push(x, y, z);
      }
    }
    for (let i = 0; i < mesh.nf; i++) {
      this.f.push(mesh.f[i * 3] + base, mesh.f[i * 3 + 1] + base, mesh.f[i * 3 + 2] + base);
      this.fc.push(mesh.fc[i]);
      this.dbl.push(mesh.dbl[i]);
      this.emis.push(mesh.emis[i]);
    }
    return this;
  }

  build() {
    const nv = this.v.length / 3;
    const nf = this.f.length / 3;
    let radius = 0;
    for (let i = 0; i < nv; i++) {
      const d = Math.hypot(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]);
      if (d > radius) radius = d;
    }
    return {
      v: new Float32Array(this.v),
      f: nv > 65000 ? new Uint32Array(this.f) : new Uint16Array(this.f),
      fc: this.fc,
      dbl: new Uint8Array(this.dbl),
      emis: new Float32Array(this.emis),
      nv, nf, radius,
    };
  }
}

// ---------------------------------------------------------------------------
// Primitives. All are centred on the origin unless noted; +z is up.
// ---------------------------------------------------------------------------

/** A frustum along +z: bottom face w0×d0 at z=0, top w1×d1 at z=h. */
export function taperedBox(w0, d0, w1, d1, h, color, opts = {}) {
  const b = new MeshBuilder();
  const top = opts.topColor || color;
  const side = opts.sideColor || color;
  const hw0 = w0 / 2, hd0 = d0 / 2, hw1 = w1 / 2, hd1 = d1 / 2;
  const z0 = opts.z0 ?? 0;
  const z1 = z0 + h;
  const a = b.vert(-hw0, -hd0, z0), bb = b.vert(hw0, -hd0, z0);
  const c = b.vert(hw0, hd0, z0), d = b.vert(-hw0, hd0, z0);
  const e = b.vert(-hw1, -hd1, z1), f = b.vert(hw1, -hd1, z1);
  const g = b.vert(hw1, hd1, z1), hh = b.vert(-hw1, hd1, z1);
  b.quad(a, bb, f, e, side);                    // -y
  b.quad(bb, c, g, f, opts.rightColor || side); // +x
  b.quad(c, d, hh, g, side);                    // +y
  b.quad(d, a, e, hh, opts.leftColor || side);  // -x
  b.quad(e, f, g, hh, top);                     // top
  b.quad(d, c, bb, a, opts.bottomColor || side);// bottom
  return b.build();
}

export const box = (w, d, h, color, opts) => taperedBox(w, d, w, d, h, color, opts);

export function cylinder(r0, r1, h, seg, color, opts = {}) {
  const b = new MeshBuilder();
  const z0 = opts.z0 ?? 0, z1 = z0 + h;
  const bottom = [], top = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    bottom.push(b.vert(Math.cos(a) * r0, Math.sin(a) * r0, z0));
    top.push(b.vert(Math.cos(a) * r1, Math.sin(a) * r1, z1));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.quad(bottom[i], bottom[j], top[j], top[i], color);
  }
  if (r1 > 0.001 && opts.capTop !== false) {
    const ct = b.vert(0, 0, z1);
    for (let i = 0; i < seg; i++) b.tri(top[i], top[(i + 1) % seg], ct, opts.topColor || color);
  }
  if (r0 > 0.001 && opts.capBottom !== false) {
    const cb = b.vert(0, 0, z0);
    for (let i = 0; i < seg; i++) b.tri(bottom[(i + 1) % seg], bottom[i], cb, opts.bottomColor || color);
  }
  return b.build();
}

export const cone = (r, h, seg, color, opts) => cylinder(r, 0.001, h, seg, color, opts);

export function sphere(r, segU = 8, segV = 6, color = '#888888', opts = {}) {
  const b = new MeshBuilder();
  const sx = opts.sx ?? 1, sy = opts.sy ?? 1, sz = opts.sz ?? 1;
  const rows = [];
  for (let vi = 0; vi <= segV; vi++) {
    const phi = (vi / segV) * PI;
    const zr = Math.sin(phi), z = Math.cos(phi);
    const row = [];
    if (vi === 0 || vi === segV) {
      row.push(b.vert(0, 0, z * r * sz));
    } else {
      for (let ui = 0; ui < segU; ui++) {
        const th = (ui / segU) * TAU;
        row.push(b.vert(Math.cos(th) * zr * r * sx, Math.sin(th) * zr * r * sy, z * r * sz));
      }
    }
    rows.push(row);
  }
  // Rows run north pole -> south pole, so the outward winding is
  // upper -> lower -> lower, the opposite hand from the cylinder walls.
  for (let vi = 0; vi < segV; vi++) {
    const a = rows[vi], c = rows[vi + 1];
    if (a.length === 1) {
      for (let ui = 0; ui < segU; ui++) b.tri(a[0], c[ui], c[(ui + 1) % segU], color);
    } else if (c.length === 1) {
      for (let ui = 0; ui < segU; ui++) b.tri(a[ui], c[0], a[(ui + 1) % segU], color);
    } else {
      for (let ui = 0; ui < segU; ui++) {
        const uj = (ui + 1) % segU;
        b.quad(a[ui], c[ui], c[uj], a[uj], color);
      }
    }
  }
  return b.build();
}

/** A flat annulus in the XY plane — shockwaves, seals, ground rings. */
export function ringMesh(rInner, rOuter, seg, color, emissive = 1) {
  const b = new MeshBuilder();
  const inner = [], outer = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    inner.push(b.vert(Math.cos(a) * rInner, Math.sin(a) * rInner, 0));
    outer.push(b.vert(Math.cos(a) * rOuter, Math.sin(a) * rOuter, 0));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.quad(inner[i], outer[i], outer[j], inner[j], color, true, emissive);
  }
  return b.build();
}

export function disc(r, seg, color, emissive = 0) {
  const b = new MeshBuilder();
  const c = b.vert(0, 0, 0);
  const rim = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * TAU;
    rim.push(b.vert(Math.cos(a) * r, Math.sin(a) * r, 0));
  }
  for (let i = 0; i < seg; i++) b.tri(c, rim[i], rim[(i + 1) % seg], color, true, emissive);
  return b.build();
}

/** Upper half of a sphere, open at the bottom — every domain barrier. */
export function domeMesh(r, segU, segV, color, emissive = 1) {
  const b = new MeshBuilder();
  const rows = [];
  for (let vi = 0; vi <= segV; vi++) {
    const phi = (vi / segV) * (PI * 0.5);
    const zr = Math.cos(phi), z = Math.sin(phi);
    const row = [];
    if (vi === segV) {
      row.push(b.vert(0, 0, r));
    } else {
      for (let ui = 0; ui < segU; ui++) {
        const th = (ui / segU) * TAU;
        row.push(b.vert(Math.cos(th) * zr * r, Math.sin(th) * zr * r, z * r));
      }
    }
    rows.push(row);
  }
  for (let vi = 0; vi < segV; vi++) {
    const a = rows[vi], c = rows[vi + 1];
    if (c.length === 1) {
      for (let ui = 0; ui < segU; ui++) b.tri(a[ui], a[(ui + 1) % segU], c[0], color, true, emissive);
    } else {
      for (let ui = 0; ui < segU; ui++) {
        const uj = (ui + 1) % segU;
        b.quad(a[ui], a[uj], c[uj], c[ui], color, true, emissive);
      }
    }
  }
  return b.build();
}

/** Extrude a closed 2D polygon (XY) along +z. */
export function prism(points, h, color, opts = {}) {
  const b = new MeshBuilder();
  const z0 = opts.z0 ?? 0, z1 = z0 + h;
  const bot = [], top = [];
  for (const p of points) {
    bot.push(b.vert(p[0], p[1], z0));
    top.push(b.vert(p[0], p[1], z1));
  }
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    b.quad(bot[i], bot[j], top[j], top[i], opts.sideColor || color);
  }
  // Fan the caps (polygons here are convex enough for a fan).
  for (let i = 1; i < n - 1; i++) {
    b.tri(top[0], top[i], top[i + 1], opts.topColor || color);
    b.tri(bot[0], bot[i + 1], bot[i], opts.bottomColor || color);
  }
  return b.build();
}

/** A flat quad in the XY plane, used for ground tiles and decals. */
export function plane(w, d, color, emissive = 0) {
  const b = new MeshBuilder();
  const hw = w / 2, hd = d / 2;
  const a = b.vert(-hw, -hd, 0), bb = b.vert(hw, -hd, 0);
  const c = b.vert(hw, hd, 0), dd = b.vert(-hw, hd, 0);
  b.quad(a, bb, c, dd, color, true, emissive);
  return b.build();
}

/** Bake a list of {mesh, mat} into one mesh — static props and whole models. */
export function bake(parts) {
  const b = new MeshBuilder();
  for (const p of parts) b.merge(p.mesh, p.mat);
  return b.build();
}

// ---------------------------------------------------------------------------
// Rasteriser
// ---------------------------------------------------------------------------

/**
 * How far round the silhouette the rim band starts.
 *
 * `1 - nz` is 0 for a face pointing straight at the camera and 1 for one
 * exactly edge-on. On a low-poly body very few triangles are within a fifth of
 * edge-on, so a tighter threshold than this simply never fires; this catches
 * the last third of the turn, which on these models is the contour band.
 */
const RIM_EDGE = 0.62;

const scratch = { x: new Float32Array(4096), y: new Float32Array(4096), z: new Float32Array(4096) };
const poly = new Float32Array(8);

function ensureScratch(n) {
  if (scratch.x.length < n) {
    scratch.x = new Float32Array(n * 2);
    scratch.y = new Float32Array(n * 2);
    scratch.z = new Float32Array(n * 2);
  }
}

/**
 * Transform, light and emit one mesh into the draw list.
 *
 * @param opts.light      view-space unit light direction
 * @param opts.ambient    floor brightness
 * @param opts.tint       [r,g,b] multipliers, for hit flashes and auras
 * @param opts.additive   draw every face additively (energy, barriers)
 * @param opts.alpha      constant alpha
 * @param opts.fog        0..1 blend toward the fog colour with distance
 */
export function drawMesh(dl, cam, mesh, mat, opts) {
  const nv = mesh.nv;
  ensureScratch(nv);
  const view = cam.view;
  const sx = scratch.x, sy = scratch.y, sz = scratch.z;
  const f = cam.f;
  const cx = cam.width * 0.5, cy = cam.height * 0.5;
  const near = cam.near;

  // Combined model -> view matrix.
  const m = opts.mv || (opts.mv = new Float32Array(16));
  for (let r = 0; r < 3; r++) {
    const a0 = view[r * 4], a1 = view[r * 4 + 1], a2 = view[r * 4 + 2], a3 = view[r * 4 + 3];
    m[r * 4] = a0 * mat[0] + a1 * mat[4] + a2 * mat[8];
    m[r * 4 + 1] = a0 * mat[1] + a1 * mat[5] + a2 * mat[9];
    m[r * 4 + 2] = a0 * mat[2] + a1 * mat[6] + a2 * mat[10];
    m[r * 4 + 3] = a0 * mat[3] + a1 * mat[7] + a2 * mat[11] + a3;
  }

  const vx = mesh.v;
  let anyVisible = false;
  for (let i = 0; i < nv; i++) {
    const x = vx[i * 3], y = vx[i * 3 + 1], z = vx[i * 3 + 2];
    const px = m[0] * x + m[1] * y + m[2] * z + m[3];
    const py = m[4] * x + m[5] * y + m[6] * z + m[7];
    const pz = m[8] * x + m[9] * y + m[10] * z + m[11];
    const d = -pz;
    sz[i] = d;
    if (d > near) {
      const inv = f / d;
      sx[i] = cx + px * inv;
      sy[i] = cy - py * inv;
      anyVisible = true;
    } else {
      sx[i] = NaN;
      sy[i] = NaN;
    }
  }
  if (!anyVisible) return;

  const L = opts.light;
  const ambient = opts.ambient ?? 0.32;
  const keyI = opts.key ?? 0.8;
  const rimI = opts.rim ?? 0.35;
  const tint = opts.tint;
  const tr = tint ? tint[0] : 1, tg = tint ? tint[1] : 1, tb = tint ? tint[2] : 1;
  const add = !!opts.additive;
  const alpha = opts.alpha ?? 1;
  const faces = mesh.f;
  const nf = mesh.nf;

  for (let i = 0; i < nf; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = sx[i0], ay = sy[i0];
    if (ax !== ax) continue;                      // behind the near plane
    const bx = sx[i1], by = sy[i1];
    if (bx !== bx) continue;
    const ccx = sx[i2], ccy = sy[i2];
    if (ccx !== ccx) continue;

    // View-space normal from the un-projected depths is expensive; the screen
    // winding gives the same answer and costs three subtractions.
    const area = (bx - ax) * (ccy - ay) - (ccx - ax) * (by - ay);
    const dbl = mesh.dbl[i];
    if (!dbl && area >= 0) continue;              // back face

    const z0 = sz[i0], z1 = sz[i1], z2 = sz[i2];
    const depth = (z0 + z1 + z2) * 0.333333;

    let light;
    if (add) {
      light = 1;
    } else {
      // Recover the three view-space positions and take a real face normal.
      const k0 = z0 / f, k1 = z1 / f, k2 = z2 / f;
      const vax = (ax - cx) * k0, vay = -(ay - cy) * k0;
      const vbx = (bx - cx) * k1, vby = -(by - cy) * k1;
      const vcx = (ccx - cx) * k2, vcy = -(ccy - cy) * k2;
      const e1x = vbx - vax, e1y = vby - vay, e1z = -(z1 - z0);
      const e2x = vcx - vax, e2y = vcy - vay, e2z = -(z2 - z0);
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }   // face the camera
      const d = nx * L.x + ny * L.y + nz * L.z;
      light = ambient + keyI * Math.max(0, d);
      // Rim is a painted shape, not a falloff. A smooth `rim * rim` term slides
      // a surface through the bands as it curves away, which is a gradient by
      // another name; a hard test snaps the edge into the rim band and leaves
      // everything inside it alone, which is how the edge is actually painted.
      if (rimI > 0 && 1 - nz > RIM_EDGE) light += rimI * 1.7;
      const em = mesh.emis[i];
      if (em) light = lerp(light, 1.45, em);
    }

    const a = alpha;
    let fogQ = 0;
    if (opts.fogNear !== undefined) {
      const fog = clamp01((depth - opts.fogNear) / Math.max(1, opts.fogFar - opts.fogNear));
      // Quantised so the colour cache still hits; 8 steps is finer than the
      // eye can pick out across an arena.
      fogQ = Math.round(fog * 8);
    }

    poly[0] = ax; poly[1] = ay;
    poly[2] = bx; poly[3] = by;
    poly[4] = ccx; poly[5] = ccy;
    dl.poly(depth, poly, 3, shadeColor(mesh.fc[i], light, tr, tg, tb, fogQ), add, a);
  }
}

/**
 * Inverted-hull outline: draw the mesh's back faces in near-black behind it,
 * expanded outward so they poke out around the silhouette. Classic cel-shading
 * trick, and cheap here because it reuses the same buffers.
 *
 * The expansion is done in *screen* space rather than by scaling the model.
 * A scaled hull draws a line whose width falls off with distance, so a fighter
 * across the arena loses their ink entirely while one in your face is wearing a
 * thick black border. Pushing each back-face triangle `px` pixels out from its
 * own centroid instead gives a line of constant weight at every depth, which is
 * how cel animation actually looks: the line does not thin out with the drawing.
 */
export function drawOutline(dl, cam, mesh, mat, scale = 1.0, color = [10, 10, 14], px = 2.2) {
  const nv = mesh.nv;
  ensureScratch(nv);
  const view = cam.view;
  const sx = scratch.x, sy = scratch.y, sz = scratch.z;
  const f = cam.f;
  const cx = cam.width * 0.5, cy = cam.height * 0.5;

  const m = new Float32Array(16);
  for (let r = 0; r < 3; r++) {
    const a0 = view[r * 4], a1 = view[r * 4 + 1], a2 = view[r * 4 + 2], a3 = view[r * 4 + 3];
    m[r * 4] = (a0 * mat[0] + a1 * mat[4] + a2 * mat[8]) * scale;
    m[r * 4 + 1] = (a0 * mat[1] + a1 * mat[5] + a2 * mat[9]) * scale;
    m[r * 4 + 2] = (a0 * mat[2] + a1 * mat[6] + a2 * mat[10]) * scale;
    m[r * 4 + 3] = a0 * mat[3] + a1 * mat[7] + a2 * mat[11] + a3;
  }
  const vx = mesh.v;
  for (let i = 0; i < nv; i++) {
    const x = vx[i * 3], y = vx[i * 3 + 1], z = vx[i * 3 + 2];
    const px = m[0] * x + m[1] * y + m[2] * z + m[3];
    const py = m[4] * x + m[5] * y + m[6] * z + m[7];
    const pz = m[8] * x + m[9] * y + m[10] * z + m[11];
    const d = -pz;
    sz[i] = d;
    if (d > cam.near) {
      const inv = f / d;
      sx[i] = cx + px * inv;
      sy[i] = cy - py * inv;
    } else { sx[i] = NaN; sy[i] = NaN; }
  }
  const style = inkStyle(mesh, color);
  const faces = mesh.f;
  for (let i = 0; i < mesh.nf; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = sx[i0], ay = sy[i0];
    if (ax !== ax) continue;
    const bx = sx[i1], by = sy[i1];
    if (bx !== bx) continue;
    const ccx = sx[i2], ccy = sy[i2];
    if (ccx !== ccx) continue;
    const area = (bx - ax) * (ccy - ay) - (ccx - ax) * (by - ay);
    if (area <= 0) continue;                      // keep only back faces

    // Line weight follows the size of the form.
    //
    // A hand-inked drawing does not use one pen. Big forms — a torso, a thigh,
    // a skull — carry a heavy contour; small details — fingers, a collar, a
    // tuft of hair — carry a fine one. A single width everywhere is the tell
    // of a shader rather than a hand, and it is why the fine parts of a model
    // end up looking clotted while the big shapes look underdrawn.
    //
    // Projected area is the right proxy: it already folds in both how large
    // the form is and how far away it is.
    const w = px * clamp(Math.sqrt(area) * 0.036, 0.5, 1.8);

    // Offset every edge outward by w and take the corners where the offset
    // edges meet. Pushing the corners radially from the centroid instead would
    // leave the middle of a long edge barely moved, so the ink would thin out
    // exactly where a silhouette is longest and most visible.
    offsetTri(ax, ay, bx, by, ccx, ccy, w, poly);
    dl.poly((sz[i0] + sz[i1] + sz[i2]) * 0.333333 + 0.02, poly, 3, style, false, 1);
  }
}

/**
 * The ink colour for a mesh.
 *
 * Animation linework is rarely pure black. A line round skin is a deep brown,
 * one round a blue coat is a deep blue — the contour belongs to the thing it
 * encloses. Pure black everywhere flattens a drawing and makes every material
 * read as the same plastic.
 *
 * The mesh's own average colour is a good enough stand-in for "the local
 * tone", and it is cached on the mesh because it never changes.
 */
function inkStyle(mesh, base) {
  let s = mesh._ink;
  if (s === undefined) {
    let r = 0, g = 0, b = 0;
    const n = mesh.nf || 1;
    for (let i = 0; i < n; i++) {
      const c = mesh.fc[i];
      r += c[0]; g += c[1]; b += c[2];
    }
    r /= n; g /= n; b /= n;
    // A quarter of the way toward the local tone: enough to warm or cool the
    // line, not enough to stop it reading as a line.
    const k = 0.25;
    s = `rgb(${Math.round(base[0] + (r - base[0]) * k)},`
      + `${Math.round(base[1] + (g - base[1]) * k)},`
      + `${Math.round(base[2] + (b - base[2]) * k)})`;
    mesh._ink = s;
  }
  return s;
}

/** Outward normal of edge P->Q for a triangle whose screen area is positive. */
function edgeNormal(px0, py0, px1, py1, out, k) {
  const dx = px1 - px0, dy = py1 - py0;
  const l = Math.hypot(dx, dy) || 1;
  out[k] = dy / l;
  out[k + 1] = -dx / l;
}

const _n = new Float32Array(6);

/** Grow a screen triangle by `px` on every side, writing 3 points into `out`. */
function offsetTri(ax, ay, bx, by, cx, cy, px, out) {
  edgeNormal(ax, ay, bx, by, _n, 0);
  edgeNormal(bx, by, cx, cy, _n, 2);
  edgeNormal(cx, cy, ax, ay, _n, 4);
  corner(ax, ay, bx, by, 4, 0, px, out, 0);   // A: edges CA and AB
  corner(bx, by, cx, cy, 0, 2, px, out, 2);   // B: edges AB and BC
  corner(cx, cy, ax, ay, 2, 4, px, out, 4);   // C: edges BC and CA
}

/**
 * Where the two offset edges meeting at (vx, vy) cross. The bisector form is
 * used directly: moving along it by px / sin(half-angle) lands on the crossing,
 * and the miter is capped so a needle-thin triangle cannot fire a spike off
 * across the screen.
 */
function corner(vx, vy, nx, ny, e0, e1, px, out, k) {
  let bxn = _n[e0] + _n[e1];
  let byn = _n[e0 + 1] + _n[e1 + 1];
  const l = Math.hypot(bxn, byn);
  if (l < 1e-4) {                                // edges doubled back: no miter
    out[k] = vx + _n[e0] * px;
    out[k + 1] = vy + _n[e0 + 1] * px;
    return;
  }
  bxn /= l; byn /= l;
  // cos of the half angle between the two edge normals.
  const cosHalf = Math.max(0.45, (bxn * _n[e0] + byn * _n[e0 + 1]));
  const d = Math.min(px / cosHalf, px * 1.9);
  out[k] = vx + bxn * d;
  out[k + 1] = vy + byn * d;
}
