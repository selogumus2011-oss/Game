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

/**
 * A quad carrying texture coordinates, for the one surface in the game that is
 * painted rather than built: the face.
 *
 * Corners are given explicitly rather than derived from a width and a height,
 * because the front of a skull is not flat — it slopes back from the brow to
 * the chin — and a face plate that ignored that would float off the jaw at any
 * angle but dead ahead.
 *
 * The UVs are in texture pixels rather than 0..1, which is what both the
 * canvas affine mapping and the GL sampler want with the least arithmetic in
 * between.
 */
export function texQuad(corners, texW, texH, color = '#ffffff', cols = 2, rows = 3) {
  const b = new MeshBuilder();
  const uv = [];
  const grid = [];
  // Subdivided, because the plate is a trapezoid — it follows the jaw in, and
  // the jaw is narrower than the cheekbones. Canvas maps a triangle affinely,
  // and two triangles of a trapezoid have genuinely different affine maps, so
  // an undivided plate kinks visibly down its diagonal. Six cells puts the
  // error below a pixel at any distance a face is looked at.
  for (let r = 0; r <= rows; r++) {
    const tv = r / rows;
    for (let c = 0; c <= cols; c++) {
      const tu = c / cols;
      // Bilinear across the four corners: 0 and 1 are the top edge, 3 and 2
      // the bottom, in the winding order the caller gave.
      const top = [0, 1, 2].map((k) => corners[0][k] + (corners[1][k] - corners[0][k]) * tu);
      const bot = [0, 1, 2].map((k) => corners[3][k] + (corners[2][k] - corners[3][k]) * tu);
      grid.push(b.vert(
        top[0] + (bot[0] - top[0]) * tv,
        top[1] + (bot[1] - top[1]) * tv,
        top[2] + (bot[2] - top[2]) * tv));
      uv.push(tu * texW, tv * texH);
    }
  }
  const at = (r, c) => grid[r * (cols + 1) + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      b.quad(at(r, c), at(r, c + 1), at(r + 1, c + 1), at(r + 1, c), color, true, 0);
    }
  }
  const m = b.build();
  m.uv = new Float32Array(uv);
  return m;
}

/**
 * A tapered prism with an elliptical cross-section: taperedBox with more sides.
 *
 * Every limb in this game was a four-sided box, which is why they read as
 * boxes. A four-sided limb shows exactly two faces from any angle with a hard
 * corner down the middle of it, and no amount of shading hides that — the
 * silhouette is a rectangle. Six sides shows three, and the corner between
 * them lands where an arm actually turns.
 *
 * Four sides was the right call when every triangle was filled by hand on the
 * CPU. It costs twelve more triangles a segment, which was real money then and
 * is not now.
 *
 * The cross-section stays elliptical rather than circular because a limb is
 * wider than it is deep, and that ratio is most of what distinguishes a thigh
 * from a pipe.
 */
export function taperedPrism(seg, w0, d0, w1, d1, h, color, opts = {}) {
  const b = new MeshBuilder();
  const top = opts.topColor || color;
  const side = opts.sideColor || color;
  const z0 = opts.z0 ?? 0, z1 = z0 + h;
  const lo = [], hi = [];
  // Half a step round, so a flat face points along +x rather than a corner:
  // the models are authored facing that way and a ridge down the front of a
  // shin is not what anybody wants.
  //
  // Which means no vertex sits at zero degrees, so the widest the shape gets
  // across x is cos(pi/seg) of the semi-axis — a hexagon built naively from
  // the same numbers as a box comes out thirteen percent narrower than it.
  // Dividing it back out makes w and d mean exactly what they mean in
  // taperedBox, so swapping one for the other does not quietly slim every
  // limb in the game.
  const kx = 1 / Math.cos(PI / seg);
  for (let i = 0; i < seg; i++) {
    const a = ((i + 0.5) / seg) * TAU;
    const ca = Math.cos(a) * kx, sa = Math.sin(a);
    lo.push(b.vert(ca * w0 * 0.5, sa * d0 * 0.5, z0));
    hi.push(b.vert(ca * w1 * 0.5, sa * d1 * 0.5, z1));
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    b.quad(lo[i], lo[j], hi[j], hi[i], side);
  }
  const ct = b.vert(0, 0, z1);
  for (let i = 0; i < seg; i++) b.tri(hi[i], hi[(i + 1) % seg], ct, top);
  const cb = b.vert(0, 0, z0);
  for (let i = 0; i < seg; i++) b.tri(lo[(i + 1) % seg], lo[i], cb, opts.bottomColor || side);
  return b.build();
}

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

const scratch = {
  x: new Float32Array(4096), y: new Float32Array(4096), z: new Float32Array(4096),
  front: new Uint8Array(4096),
};
const poly = new Float32Array(8);

function ensureFront(n) {
  if (!scratch.front || scratch.front.length < n) scratch.front = new Uint8Array(n * 2);
}

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
  // The seam between the two renderers.
  //
  // Every mesh in the game arrives here, so this one branch is the whole of
  // what the GPU path had to change. The models, the skeleton, the poses, the
  // lighting levels and every number in the art direction are shared: the
  // backend decides who fills the triangles and nothing else.
  //
  // A textured mesh is the exception: it still needs projecting here, because
  // the paint tone is worked out from the projected normal and handed to the
  // backend rather than derived twice. Without this it went to the backend as
  // an ordinary white mesh and drew a blank card over the face.
  if (dl.gpu && !mesh.tex) { dl.gpu.submitMesh(mesh, mat, opts); return; }

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

  // A textured surface takes a different route: its colour comes from an image
  // rather than from the face table, so it cannot go through the flat-fill
  // path at all.
  if (mesh.tex && mesh.uv) { drawTexturedMesh(dl, cam, mesh, mat, sx, sy, sz, opts); return; }

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
 * The interior lines of a drawing.
 *
 * An inverted hull gives a silhouette and nothing else, which is why these
 * models were reading as flat fields inside a contour. A drawn character has
 * lines *inside* the outline too — round the collar, along the belt, down the
 * placket, across a cuff, at the corner of a shoulder — and their absence is
 * most of what makes a cel-shaded model look unfinished.
 *
 * Two kinds of edge earn a line:
 *
 *   * A **crease**, where two faces meet at a sharp angle. On these models,
 *     which are assembled from boxes, that catches the corner of every form —
 *     which is exactly where an inker puts a line.
 *   * A **material boundary**, where the faces either side are different
 *     colours. Under flat cel shading two nearby tones land in the same band
 *     and merge into one field, so the line is the only thing keeping a collar
 *     from disappearing into a chest.
 *
 * Both are static properties of the mesh, so the edge list is built once and
 * cached on it. Vertices are welded by position first: the models are merged
 * from separate primitives that abut without sharing vertices, and without
 * welding almost nothing would be adjacent to anything.
 */
const CREASE_COS = Math.cos(0.9);        // about 52 degrees

// Exported because the GPU backend draws the same lines from the same list.
// This is mesh analysis rather than rasterising — which edges of a shape an
// inker would draw is a property of the shape, not of who fills the triangles
// — so both renderers share it and the cache on the mesh serves both.
export function inkEdges(mesh) {
  let e = mesh._edges;
  if (e !== undefined) return e;

  const nv = mesh.nv;
  const nf = mesh.nf;
  const v = mesh.v;

  // Weld by quantised position so abutting primitives share their seams.
  const canon = new Int32Array(nv);
  const at = new Map();
  for (let i = 0; i < nv; i++) {
    const key = `${Math.round(v[i * 3] * 8192)},${Math.round(v[i * 3 + 1] * 8192)},${Math.round(v[i * 3 + 2] * 8192)}`;
    const found = at.get(key);
    if (found === undefined) { at.set(key, i); canon[i] = i; } else canon[i] = found;
  }

  // Model-space face normals, for the dihedral test, and face areas, for the
  // detail test below.
  const nx = new Float32Array(nf), ny = new Float32Array(nf), nz = new Float32Array(nf);
  const area = new Float32Array(nf);
  const faces = mesh.f;
  for (let i = 0; i < nf; i++) {
    const a = faces[i * 3] * 3, b = faces[i * 3 + 1] * 3, c = faces[i * 3 + 2] * 3;
    const e1x = v[b] - v[a], e1y = v[b + 1] - v[a + 1], e1z = v[b + 2] - v[a + 2];
    const e2x = v[c] - v[a], e2y = v[c + 1] - v[a + 1], e2z = v[c + 2] - v[a + 2];
    let x = e1y * e2z - e1z * e2y;
    let y = e1z * e2x - e1x * e2z;
    let z = e1x * e2y - e1y * e2x;
    const L = Math.hypot(x, y, z) || 1;
    nx[i] = x / L; ny[i] = y / L; nz[i] = z / L;
    area[i] = L * 0.5;
  }

  // Collect edges by their welded endpoint pair, keeping the two faces.
  const minLen = (mesh.radius || 1) * 0.055;
  // Detail plates do not get outlined.
  //
  // A face is assembled from a dozen thin boxes laid on the front of the
  // skull — eye whites, irises, pupils, highlights, lash lines, brows, clan
  // markings — and every one of them is a box, so every one of them has a
  // 90-degree crease all the way round it. The interior pass was drawing a
  // rectangle around each, which turned a face into a panel of framed windows
  // and was most of why the characters looked built rather than drawn. An
  // edge earns a line only if both the faces it joins are large enough to be
  // part of the form; a sliver the thickness of a decal is not.
  const minArea = (mesh.radius || 1) * (mesh.radius || 1) * 0.018;
  const seen = new Map();
  const out = [];
  for (let i = 0; i < nf; i++) {
    for (let k = 0; k < 3; k++) {
      const a = canon[faces[i * 3 + k]];
      const b = canon[faces[i * 3 + ((k + 1) % 3)]];
      if (a === b) continue;
      const key = a < b ? a * 1048576 + b : b * 1048576 + a;
      const prev = seen.get(key);
      if (prev === undefined) { seen.set(key, { v0: faces[i * 3 + k], v1: faces[i * 3 + ((k + 1) % 3)], f: i }); continue; }
      if (prev.done) continue;          // three or more faces: not a clean edge
      prev.done = true;
      const fa = prev.f, fb = i;
      const dot = nx[fa] * nx[fb] + ny[fa] * ny[fb] + nz[fa] * nz[fb];
      const ca = mesh.fc[fa], cb = mesh.fc[fb];
      const material = ca[0] !== cb[0] || ca[1] !== cb[1] || ca[2] !== cb[2];
      if (dot >= CREASE_COS && !material) continue;
      if (area[fa] < minArea || area[fb] < minArea) continue;
      // Drop edges that are tiny relative to the whole model. They are
      // sub-pixel at any distance you would actually see the model from, and
      // the per-frame test that proves it costs two projections each — which,
      // across a head made of a dozen hair clumps, is most of the pass.
      const a3 = prev.v0 * 3, b3 = prev.v1 * 3;
      const len = Math.hypot(v[b3] - v[a3], v[b3 + 1] - v[a3 + 1], v[b3 + 2] - v[a3 + 2]);
      if (len < minLen) continue;
      out.push(prev.v0, prev.v1, fa, fb);
    }
  }

  e = out.length ? new Int32Array(out) : null;
  mesh._edges = e;
  return e;
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
export function drawOutline(dl, cam, mesh, mat, scale = 1.0, color = [10, 10, 14], px = 2.2,
  interior = true) {
  if (dl.gpu) {
    const ink = inkRgb(mesh, color);
    dl.gpu.submitHull(mesh, mat, ink, px);
    // Same edge list the software path walks. Which edges of a shape an inker
    // would draw is a property of the shape, so both renderers ask the same
    // question and share the answer cached on the mesh.
    if (interior) dl.gpu.submitLines(mesh, mat, ink, px, inkEdges(mesh));
    return;
  }

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
  const nf = mesh.nf;
  // Which way each face is turned this frame. The hull needs it anyway, and
  // the interior lines need it to avoid drawing the seams on the far side of
  // the model through the near side.
  ensureFront(nf);
  const front = scratch.front;
  for (let i = 0; i < nf; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = sx[i0], ay = sy[i0];
    const bx = sx[i1], by = sy[i1];
    const ccx = sx[i2], ccy = sy[i2];
    if (ax !== ax || bx !== bx || ccx !== ccx) { front[i] = 2; continue; }
    front[i] = (bx - ax) * (ccy - ay) - (ccx - ax) * (by - ay) < 0 ? 1 : 0;
  }

  for (let i = 0; i < nf; i++) {
    if (front[i] !== 0) continue;                 // keep only back faces
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = sx[i0], ay = sy[i0];
    const bx = sx[i1], by = sy[i1];
    const ccx = sx[i2], ccy = sy[i2];
    const area = (bx - ax) * (ccy - ay) - (ccx - ax) * (by - ay);

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

  // --- interior lines --------------------------------------------------------
  // Only worth walking the edge list where the result can actually be seen.
  // On a figure twenty metres away every seam is sub-pixel, and the cost of
  // proving that one edge at a time is most of what the pass costs.
  if (!interior) return;
  const edges = inkEdges(mesh);
  if (!edges) return;
  // Finer than the contour. An inker uses a heavier pen for the outside of a
  // form than for the detail inside it, and interior lines at contour weight
  // turn a collar into a black bar.
  const iw = Math.max(0.8, px * 0.52);
  for (let i = 0; i < edges.length; i += 4) {
    const fa = edges[i + 2], fb = edges[i + 3];
    const va = front[fa], vb = front[fb];
    // Drawn only where the surface it belongs to is actually facing us. A seam
    // on the far side of the body would otherwise print through the near side,
    // because this is a painter's algorithm with no depth buffer to stop it.
    if (va !== 1 && vb !== 1) continue;
    const v0 = edges[i], v1 = edges[i + 1];
    const x0 = sx[v0], y0 = sy[v0], x1 = sx[v1], y1 = sy[v1];
    if (x0 !== x0 || x1 !== x1) continue;
    // Sub-pixel edges are noise, not detail.
    if (Math.abs(x1 - x0) + Math.abs(y1 - y0) < 2.2) continue;
    dl.line((sz[v0] + sz[v1]) * 0.5 - 0.03, x0, y0, x1, y1, style, iw, false, 1);
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
function inkRgb(mesh, base) {
  let c = mesh._inkRgb;
  if (c === undefined) {
    let r = 0, g = 0, b = 0;
    const n = mesh.nf || 1;
    for (let i = 0; i < n; i++) {
      const f = mesh.fc[i];
      r += f[0]; g += f[1]; b += f[2];
    }
    r /= n; g /= n; b /= n;
    // A quarter of the way toward the local tone: enough to warm or cool the
    // line, not enough to stop it reading as a line.
    const k = 0.25;
    c = [
      Math.round(base[0] + (r - base[0]) * k),
      Math.round(base[1] + (g - base[1]) * k),
      Math.round(base[2] + (b - base[2]) * k),
    ];
    mesh._inkRgb = c;
  }
  return c;
}

function inkStyle(mesh, base) {
  let s = mesh._ink;
  if (s === undefined) {
    const c = inkRgb(mesh, base);
    s = `rgb(${c[0]},${c[1]},${c[2]})`;
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

/**
 * Emit a textured mesh as screen-space triangles with their texture corners.
 *
 * The lighting still happens, but it lands on the image rather than on a fill
 * colour: the band index is worked out here and handed along, and whoever
 * draws it is responsible for tinting the image to that band. Doing it this
 * way keeps a painted face sitting in the same paint tone as the skull behind
 * it, so a character in shadow does not have a brightly lit face floating on
 * the front of their head.
 */
function drawTexturedMesh(dl, cam, mesh, mat, sx, sy, sz, opts) {
  const faces = mesh.f;
  const uv = mesh.uv;
  const L = opts.light;
  const ambient = opts.ambient ?? 0.32;
  const keyI = opts.key ?? 0.8;
  const alpha = opts.alpha ?? 1;
  const cx = cam.width * 0.5, cy = cam.height * 0.5;
  const f = cam.f;
  let band = -1;

  for (let i = 0; i < mesh.nf; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = sx[i0], ay = sy[i0];
    if (ax !== ax) continue;
    const bx = sx[i1], by = sy[i1];
    if (bx !== bx) continue;
    const ccx = sx[i2], ccy = sy[i2];
    if (ccx !== ccx) continue;

    const z0 = sz[i0], z1 = sz[i1], z2 = sz[i2];
    const depth = (z0 + z1 + z2) * 0.333333;

    // The same view-space normal the flat path recovers, for the same reason.
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
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // One tone for the whole surface, taken from the first triangle.
    //
    // A textured quad is flat, so both its triangles have the same normal —
    // but the normal is recovered from the projected corners, and two
    // recoveries of the same plane differ in the last few bits. That is enough
    // to drop one triangle a band and leave a hard tonal seam down the diagonal
    // of a face.
    if (band < 0) {
      band = bandOfLight(ambient + keyI * Math.max(0, nx * L.x + ny * L.y + nz * L.z));
      // The GPU draws the whole surface in one call and only needs the tone.
      if (dl.gpu) { dl.gpu.submitTextured(mesh, mat, opts, band); return; }
    }

    dl.texTri(depth - 0.004, mesh.tex,
      ax, ay, uv[i0 * 2], uv[i0 * 2 + 1],
      bx, by, uv[i1 * 2], uv[i1 * 2 + 1],
      ccx, ccy, uv[i2 * 2], uv[i2 * 2 + 1],
      alpha, band);
  }
}

/**
 * Which paint tone a lighting value falls into.
 *
 * Duplicated from core3's private bandOf rather than exported from it: this is
 * the one caller outside the colour path that needs the index rather than the
 * finished colour, and the cut points are the art direction, not an
 * implementation detail to be shared around.
 */
function bandOfLight(light) {
  if (light < 0.56) return 0;
  if (light < 0.80) return 1;
  if (light < 1.14) return 2;
  if (light < 1.36) return 3;
  return 4;
}
