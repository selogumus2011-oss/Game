// The WebGL2 backend.
//
// It stands in for the DrawList: the drawing code in ../geom3.js hands meshes
// to whichever of the two is active, and neither the models, the skeleton, the
// poses nor the art direction know the difference. That is the whole design —
// the software rasteriser took six years of decisions about how this game
// should look, and none of them are being reopened. This changes who fills the
// triangles.
//
// WebGL2 rather than WebGPU, deliberately. WebGPU is the better API and is not
// on enough phones, and the point of the last round of work was that this game
// runs on a phone. A machine with neither keeps the software path, which stays
// in the tree as the fallback rather than as dead weight.
//
// What the GPU changes beyond speed:
//
//   * **There is a real depth buffer.** The software path sorts polygons by
//     centroid depth and paints back to front, which is wrong wherever two
//     triangles interpenetrate — a sword through a torso, a limb crossing a
//     coat. Those artefacts simply stop.
//   * **Ink costs nothing.** The outline hull was the most expensive pass in
//     the software renderer and the one quality tiers kept trying to drop. On
//     the GPU it is a second draw of geometry already resident.

import {
  MESH_VS, MESH_FS, HULL_VS, HULL_FS, LINE_VS, LINE_FS, OVERLAY_VS, OVERLAY_FS,
} from './shaders.js';
import { gpuMesh, meshVao, OFFSETS, gpuLines, lineVao, LINE_OFFSETS } from './meshgpu.js';

let nextContextId = 1;

// x, y, depth, rgba, uv, kind
const OVERLAY_FLOATS = 10;

/**
 * A CSS colour to premultiplied-free rgba in 0..1.
 *
 * The effects layer speaks in canvas colour strings, and it is not worth
 * changing a few hundred call sites to make them speak in numbers instead.
 * Parsing is cached because the same handful of strings recur every frame.
 */
const styleCache = new Map();
function parseStyle(style) {
  if (!style) return null;
  let c = styleCache.get(style);
  if (c !== undefined) return c;
  c = null;
  const m = /^rgba?\(([^)]+)\)$/.exec(style);
  if (m) {
    const n = m[1].split(',').map((v) => parseFloat(v));
    if (n.length >= 3) c = [n[0] / 255, n[1] / 255, n[2] / 255, n.length > 3 ? n[3] : 1];
  } else if (style[0] === '#') {
    const h = style.slice(1);
    const x = h.length === 3 ? h.split('').map((v) => parseInt(v + v, 16))
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (x.every((v) => v === v)) c = [x[0] / 255, x[1] / 255, x[2] / 255, 1];
  }
  styleCache.set(style, c);
  if (styleCache.size > 4000) styleCache.clear();
  return c;
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`${label} failed to compile:\n${log}`);
  }
  return sh;
}

function link(gl, vsSrc, fsSrc, label) {
  const p = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, `${label} vertex shader`);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, `${label} fragment shader`);
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`${label} failed to link:\n${log}`);
  }
  return p;
}

/** Row-major (the convention everywhere else here) to column-major, for GL. */
function toGL(m, out) {
  out[0] = m[0]; out[1] = m[4]; out[2] = m[8]; out[3] = m[12];
  out[4] = m[1]; out[5] = m[5]; out[6] = m[9]; out[7] = m[13];
  out[8] = m[2]; out[9] = m[6]; out[10] = m[10]; out[11] = m[14];
  out[12] = m[3]; out[13] = m[7]; out[14] = m[11]; out[15] = m[15];
  return out;
}

// Renderers that are not hardware at all. On these the GPU path is emulated on
// the CPU by a general-purpose rasteriser, and it loses badly to the
// special-purpose one already in this repo — measured at 7fps against 26 in a
// container with no GPU. This is the one case where the software path is not
// just the fallback but the right answer.
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|basic render|software/i;

/**
 * Which backend this machine should use, and why.
 *
 * Asked once, on a throwaway canvas, before anything commits. Some browsers
 * expose the constructor and then decline to give you a context, so this asks
 * for the real thing rather than sniffing for support.
 */
export function detectGpu() {
  if (typeof document === 'undefined') return { ok: false, reason: 'no document' };
  let gl;
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    gl = c.getContext('webgl2');
  } catch (e) {
    return { ok: false, reason: 'context threw: ' + e.message };
  }
  if (!gl) return { ok: false, reason: 'no WebGL2' };

  let renderer = '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    if (!renderer) renderer = String(gl.getParameter(gl.RENDERER) || '');
  } catch { /* the extension is optional and privacy-gated; not knowing is fine */ }

  if (renderer && SOFTWARE_RENDERERS.test(renderer)) {
    return { ok: false, software: true, renderer, reason: `software renderer (${renderer})` };
  }
  return { ok: true, renderer: renderer || 'unknown' };
}

export class GLBackend {
  /** Marks this as a GPU sink rather than a DrawList, for drawMesh to branch on. */
  get isGpu() { return true; }

  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      // Transparent, because the sky is a canvas-2D gradient painted
      // underneath and the 3D composites onto it.
      alpha: true,
      antialias: true,
      depth: true,
      stencil: false,
      desynchronized: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    if (!this.gl) throw new Error('WebGL2 context could not be created');
    this.contextId = nextContextId++;
    const gl = this.gl;

    this.mesh = link(gl, MESH_VS, MESH_FS, 'mesh');
    this.hull = link(gl, HULL_VS, HULL_FS, 'hull');
    this.line = link(gl, LINE_VS, LINE_FS, 'line');
    this.overlay = link(gl, OVERLAY_VS, OVERLAY_FS, 'overlay');

    this.mLoc = {
      pos: gl.getAttribLocation(this.mesh, 'aPos'),
      edge1: gl.getAttribLocation(this.mesh, 'aEdge1'),
      edge2: gl.getAttribLocation(this.mesh, 'aEdge2'),
      color: gl.getAttribLocation(this.mesh, 'aColor'),
      flags: gl.getAttribLocation(this.mesh, 'aFlags'),
      uMVP: gl.getUniformLocation(this.mesh, 'uMVP'),
      uMV: gl.getUniformLocation(this.mesh, 'uMV'),
      uLight: gl.getUniformLocation(this.mesh, 'uLight'),
      uLevels: gl.getUniformLocation(this.mesh, 'uLevels'),
      uTint: gl.getUniformLocation(this.mesh, 'uTint'),
      uAlpha: gl.getUniformLocation(this.mesh, 'uAlpha'),
      uAdditive: gl.getUniformLocation(this.mesh, 'uAdditive'),
      uFogRange: gl.getUniformLocation(this.mesh, 'uFogRange'),
      uFogColor: gl.getUniformLocation(this.mesh, 'uFogColor'),
    };
    this.hLoc = {
      pos: gl.getAttribLocation(this.hull, 'aPos'),
      p1: gl.getAttribLocation(this.hull, 'aP1'),
      p2: gl.getAttribLocation(this.hull, 'aP2'),
      uMVP: gl.getUniformLocation(this.hull, 'uMVP'),
      uHalfViewport: gl.getUniformLocation(this.hull, 'uHalfViewport'),
      uPx: gl.getUniformLocation(this.hull, 'uPx'),
      uInk: gl.getUniformLocation(this.hull, 'uInk'),
      uAlpha: gl.getUniformLocation(this.hull, 'uAlpha'),
    };

    this.lLoc = {
      a: gl.getAttribLocation(this.line, 'aA'),
      b: gl.getAttribLocation(this.line, 'aB'),
      side: gl.getAttribLocation(this.line, 'aSide'),
      uMVP: gl.getUniformLocation(this.line, 'uMVP'),
      uHalfViewport: gl.getUniformLocation(this.line, 'uHalfViewport'),
      uWidth: gl.getUniformLocation(this.line, 'uWidth'),
      uBias: gl.getUniformLocation(this.line, 'uBias'),
      uInk: gl.getUniformLocation(this.line, 'uInk'),
      uAlpha: gl.getUniformLocation(this.line, 'uAlpha'),
    };

    this.oLoc = {
      pos: gl.getAttribLocation(this.overlay, 'aPos'),
      depth: gl.getAttribLocation(this.overlay, 'aDepth'),
      color: gl.getAttribLocation(this.overlay, 'aColor'),
      uv: gl.getAttribLocation(this.overlay, 'aUV'),
      kind: gl.getAttribLocation(this.overlay, 'aKind'),
      uViewport: gl.getUniformLocation(this.overlay, 'uViewport'),
      uDepthMap: gl.getUniformLocation(this.overlay, 'uDepthMap'),
    };
    this._overlay = new Float32Array(4096 * OVERLAY_FLOATS);
    this._oN = 0;
    this._runs = [];
    this._oBuf = gl.createBuffer();
    this._oVao = null;

    this.proj = new Float32Array(16);
    this.viewProj = new Float32Array(16);
    this.mvp = new Float32Array(16);
    this.mv = new Float32Array(16);
    this._glMat = new Float32Array(16);
    this._glMat2 = new Float32Array(16);

    // Opaque geometry goes down in submission order and lets the depth buffer
    // sort it. Anything blended has to be drawn after all of it, back to
    // front, because a transparent surface has no depth of its own to test
    // against — so it is queued rather than drawn.
    this.blended = [];
    this.stats = { meshes: 0, hulls: 0, lines: 0, tris: 0, blended: 0, overlay: 0 };

    this.fogColor = [16 / 255, 18 / 255, 26 / 255];
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.width = w;
    this.height = h;
    this.dpr = dpr;
    const c = this.canvas;
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    if (c.width !== pw || c.height !== ph) {
      c.width = pw;
      c.height = ph;
    }
    this.gl.viewport(0, 0, pw, ph);
  }

  setFogColor(rgb) {
    this.fogColor[0] = rgb[0] / 255;
    this.fogColor[1] = rgb[1] / 255;
    this.fogColor[2] = rgb[2] / 255;
  }

  /**
   * Projection matching the software camera exactly.
   *
   * `cam.f` is a focal length in pixels: the software path projects a view
   * point to `cx + px * f / d`. Normalised device coordinates span -1..1 over
   * the full width, so the same projection in clip space is `px * 2f / width`
   * with `w = d`. Deriving it this way rather than from a field of view is
   * what keeps the two renderers framing an identical shot.
   */
  _project(cam) {
    const near = Math.max(0.01, cam.near);
    const far = 400;
    const p = this.proj;
    p.fill(0);
    p[0] = (2 * cam.f) / this.width;
    p[5] = (2 * cam.f) / this.height;
    p[10] = -(far + near) / (far - near);
    p[11] = -(2 * far * near) / (far - near);
    p[14] = -1;
    return p;
  }

  /** Start a frame: clear, set the camera, reset the queues. */
  begin(cam, opts, clearRgb) {
    const gl = this.gl;
    this._project(cam);
    matMul4(this.proj, cam.view, this.viewProj);
    this.cam = cam;
    this.light = opts.light;
    this.levels = [opts.ambient ?? 0.32, opts.key ?? 0.8, opts.rim ?? 0.35];
    this.blended.length = 0;
    this.stats.meshes = this.stats.hulls = this.stats.lines = 0;
    this.stats.tris = this.stats.blended = this.stats.overlay = 0;
    this._oN = 0;
    this._runs.length = 0;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    // The software path keeps a face when its SCREEN area is negative, in
    // coordinates with y pointing down. GL measures the same triangle in
    // window coordinates with y pointing up, which negates it — so a front
    // face here is the counter-clockwise one, which is GL's default.
    gl.frontFace(gl.CCW);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    if (clearRgb) {
      gl.clearColor(clearRgb[0] / 255, clearRgb[1] / 255, clearRgb[2] / 255, 1);
    } else {
      gl.clearColor(0, 0, 0, 0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /**
   * Submit one mesh. The signature mirrors the software `drawMesh`, so the
   * call sites do not care which one they are talking to.
   */
  submitMesh(mesh, mat, opts) {
    if (!mesh || !mesh.nf) return;
    const alpha = opts.alpha ?? 1;
    const additive = !!opts.additive;
    if (alpha < 0.999 || additive) {
      // Queue it: depth for the sort is the model origin in view space, which
      // is what the software path sorts polygons by anyway.
      const view = this.cam.view;
      const d = -(view[8] * mat[3] + view[9] * mat[7] + view[10] * mat[11] + view[11]);
      this.blended.push({
        mesh, mat: copy16(mat), depth: d,
        alpha, additive,
        tint: opts.tint ? [opts.tint[0], opts.tint[1], opts.tint[2]] : null,
        fogNear: opts.fogNear, fogFar: opts.fogFar,
        ambient: opts.ambient, key: opts.key, rim: opts.rim,
      });
      return;
    }
    this._drawMesh(mesh, mat, opts, 1, false);
  }

  /** Submit one outline hull. Mirrors the software `drawOutline`. */
  submitHull(mesh, mat, rgb, px, alpha = 1) {
    if (!mesh || !mesh.nf || px <= 0) return;
    const gl = this.gl;
    const gpu = gpuMesh(gl, mesh, this.contextId);
    const vao = meshVao(gl, gpu, 'hull', [
      [this.hLoc.pos, 3, OFFSETS.pos],
      [this.hLoc.p1, 3, OFFSETS.p1],
      [this.hLoc.p2, 3, OFFSETS.p2],
    ]);

    gl.useProgram(this.hull);
    matMul4(this.viewProj, mat, this.mvp);
    gl.uniformMatrix4fv(this.hLoc.uMVP, false, toGL(this.mvp, this._glMat));
    gl.uniform2f(this.hLoc.uHalfViewport,
      (this.width * this.dpr) * 0.5, (this.height * this.dpr) * 0.5);
    gl.uniform1f(this.hLoc.uPx, px * this.dpr);
    gl.uniform3f(this.hLoc.uInk, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    gl.uniform1f(this.hLoc.uAlpha, alpha);

    // The hull is the mesh's back faces, so the cull flips for this draw.
    gl.bindVertexArray(vao);
    gl.cullFace(gl.FRONT);
    gl.drawArrays(gl.TRIANGLES, 0, gpu.totalVerts);
    gl.cullFace(gl.BACK);
    gl.bindVertexArray(null);
    this.stats.hulls++;
  }

  /**
   * The interior lines of a drawing.
   *
   * An inverted hull gives a silhouette and nothing else. A drawn character
   * has lines inside the outline too — round the collar, along the belt, down
   * the placket, at the corner of a shoulder — and their absence is most of
   * what makes a cel-shaded model look unfinished.
   */
  submitLines(mesh, mat, rgb, px, edges) {
    const gl = this.gl;
    const lines = gpuLines(gl, mesh, this.contextId, edges);
    if (!lines.verts) return;
    const vao = lineVao(gl, lines, 'line', [
      [this.lLoc.a, 3, LINE_OFFSETS.a],
      [this.lLoc.b, 3, LINE_OFFSETS.b],
      [this.lLoc.side, 2, LINE_OFFSETS.side],
    ]);

    gl.useProgram(this.line);
    matMul4(this.viewProj, mat, this.mvp);
    gl.uniformMatrix4fv(this.lLoc.uMVP, false, toGL(this.mvp, this._glMat));
    gl.uniform2f(this.lLoc.uHalfViewport,
      (this.width * this.dpr) * 0.5, (this.height * this.dpr) * 0.5);
    // Finer than the contour: an inker uses a heavier pen for the outside of a
    // form than for the detail inside it, and interior lines at contour weight
    // read as a wireframe.
    gl.uniform1f(this.lLoc.uWidth, Math.max(0.8, px * 0.52) * this.dpr);
    gl.uniform1f(this.lLoc.uBias, 3e-4);
    gl.uniform3f(this.lLoc.uInk, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255);
    gl.uniform1f(this.lLoc.uAlpha, 1);

    gl.bindVertexArray(vao);
    // A line quad has no meaningful facing, and half of them would be culled.
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, lines.verts);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    this.stats.lines++;
  }

  _drawMesh(mesh, mat, opts, alpha, additive) {
    const gl = this.gl;
    const gpu = gpuMesh(gl, mesh, this.contextId);
    const vao = meshVao(gl, gpu, 'mesh', [
      [this.mLoc.pos, 3, OFFSETS.pos],
      [this.mLoc.edge1, 3, OFFSETS.edge1],
      [this.mLoc.edge2, 3, OFFSETS.edge2],
      [this.mLoc.color, 3, OFFSETS.color],
      [this.mLoc.flags, 2, OFFSETS.flags],
    ]);

    gl.useProgram(this.mesh);
    matMul4(this.viewProj, mat, this.mvp);
    matMul4(this.cam.view, mat, this.mv);
    gl.uniformMatrix4fv(this.mLoc.uMVP, false, toGL(this.mvp, this._glMat));
    gl.uniformMatrix4fv(this.mLoc.uMV, false, toGL(this.mv, this._glMat2));
    const L = opts.light || this.light;
    gl.uniform3f(this.mLoc.uLight, L.x, L.y, L.z);
    gl.uniform3f(this.mLoc.uLevels,
      opts.ambient ?? this.levels[0], opts.key ?? this.levels[1], opts.rim ?? this.levels[2]);
    const t = opts.tint;
    gl.uniform3f(this.mLoc.uTint, t ? t[0] : 1, t ? t[1] : 1, t ? t[2] : 1);
    gl.uniform1f(this.mLoc.uAlpha, alpha);
    gl.uniform1f(this.mLoc.uAdditive, additive ? 1 : 0);
    if (opts.fogNear !== undefined) {
      gl.uniform2f(this.mLoc.uFogRange, opts.fogNear, opts.fogFar ?? opts.fogNear + 60);
    } else {
      gl.uniform2f(this.mLoc.uFogRange, 0, 0);
    }
    gl.uniform3fv(this.mLoc.uFogColor, this.fogColor);

    gl.bindVertexArray(vao);
    if (gpu.solidVerts) gl.drawArrays(gl.TRIANGLES, 0, gpu.solidVerts);
    if (gpu.doubleVerts) {
      gl.disable(gl.CULL_FACE);
      gl.drawArrays(gl.TRIANGLES, gpu.solidVerts, gpu.doubleVerts);
      gl.enable(gl.CULL_FACE);
    }
    gl.bindVertexArray(null);
    this.stats.meshes++;
    this.stats.tris += mesh.nf;
  }


  // -------------------------------------------------------------------------
  // The screen-space overlay: particles, energy shapes, spark trails.
  //
  // These arrive already projected — the effects layer works in pixels — so
  // they cannot go through the mesh pass. They go into one growable vertex
  // buffer instead, carrying their view depth so the depth test still applies,
  // and they are drawn once at the end of the frame. One buffer and a handful
  // of draw calls for the whole effects layer, whatever its colour.
  // -------------------------------------------------------------------------

  /** Room for `verts` more vertices, growing the scratch buffer if need be. */
  _room(verts) {
    const need = (this._oN + verts) * OVERLAY_FLOATS;
    if (need <= this._overlay.length) return;
    let size = Math.max(this._overlay.length * 2, 4096 * OVERLAY_FLOATS);
    while (size < need) size *= 2;
    const next = new Float32Array(size);
    next.set(this._overlay.subarray(0, this._oN * OVERLAY_FLOATS));
    this._overlay = next;
  }

  _vert(x, y, depth, r, g, b, a, u, v, kind) {
    const o = this._oN * OVERLAY_FLOATS;
    const d = this._overlay;
    d[o] = x; d[o + 1] = y; d[o + 2] = depth;
    d[o + 3] = r; d[o + 4] = g; d[o + 5] = b; d[o + 6] = a;
    d[o + 7] = u; d[o + 8] = v; d[o + 9] = kind;
    this._oN++;
  }

  /** Open a run of triangles sharing a blend mode and a sort depth. */
  _run(depth, add) {
    const last = this._runs[this._runs.length - 1];
    if (last && last.add === add && last.depth === depth && last.end === this._oN) return last;
    const run = { depth, add, start: this._oN, end: this._oN };
    this._runs.push(run);
    return run;
  }

  _close(run) { run.end = this._oN; }

  poly2d(depth, xs, count, style, add, alpha, ink, inkW) {
    if (count < 3 || alpha <= 0.002) return;
    const c = parseStyle(style);
    if (!c) return;
    const run = this._run(depth, !!add);
    this._room((count - 2) * 3 + (ink ? count * 6 : 0));
    const a = c[3] * alpha;
    // Fan from the first point. Every shape the effects layer draws is convex
    // or near enough that a fan is indistinguishable from a real triangulation.
    for (let i = 1; i < count - 1; i++) {
      this._vert(xs[0], xs[1], depth, c[0], c[1], c[2], a, 0, 0, 0);
      this._vert(xs[i * 2], xs[i * 2 + 1], depth, c[0], c[1], c[2], a, 0, 0, 0);
      this._vert(xs[i * 2 + 2], xs[i * 2 + 3], depth, c[0], c[1], c[2], a, 0, 0, 0);
    }
    if (ink) {
      // Cursed energy is drawn, not rendered: it has a hard contour the same
      // way a character does, and a shape without one reads as a light source
      // rather than as something somebody painted.
      const k = parseStyle(ink);
      if (k) {
        for (let i = 0; i < count; i++) {
          const j = (i + 1) % count;
          this._segment(xs[i * 2], xs[i * 2 + 1], xs[j * 2], xs[j * 2 + 1],
            depth, k[0], k[1], k[2], k[3] * alpha, inkW);
        }
      }
    }
    this._close(run);
  }

  line2d(depth, x1, y1, x2, y2, style, lw, add, alpha) {
    if (alpha <= 0.002) return;
    const c = parseStyle(style);
    if (!c) return;
    const run = this._run(depth, !!add);
    this._room(6);
    this._segment(x1, y1, x2, y2, depth, c[0], c[1], c[2], c[3] * alpha, lw);
    this._close(run);
  }

  /** One thick screen-space segment as two triangles. */
  _segment(x1, y1, x2, y2, depth, r, g, b, a, lw) {
    this._room(6);
    let dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) { dx = 1; dy = 0; } else { dx /= len; dy /= len; }
    const hw = Math.max(0.5, lw) * 0.5;
    const nx = -dy * hw, ny = dx * hw;
    const ax = x1 + nx, ay = y1 + ny, bx = x2 + nx, by = y2 + ny;
    const cx = x2 - nx, cy = y2 - ny, ex = x1 - nx, ey = y1 - ny;
    this._vert(ax, ay, depth, r, g, b, a, 0, 0, 0);
    this._vert(bx, by, depth, r, g, b, a, 0, 0, 0);
    this._vert(cx, cy, depth, r, g, b, a, 0, 0, 0);
    this._vert(ax, ay, depth, r, g, b, a, 0, 0, 0);
    this._vert(cx, cy, depth, r, g, b, a, 0, 0, 0);
    this._vert(ex, ey, depth, r, g, b, a, 0, 0, 0);
  }

  sprite2d(depth, x, y, w, h, sprite, alpha, add, rot) {
    if (alpha <= 0.002 || w <= 0.2) return;
    const kind = sprite && sprite.spriteKind;
    const rgb = sprite && sprite.spriteRgb;
    if (!kind || !rgb) return;
    const run = this._run(depth, !!add);
    this._room(6);
    const hw = w * 0.5, hh = h * 0.5;
    const px = x, py = y;
    const cs = rot ? Math.cos(rot) : 1, sn = rot ? Math.sin(rot) : 0;
    const r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
    // Corners in local -1..1, which the fragment shader reads as the radius
    // for the falloff.
    const C = [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]];
    for (const [u, v] of C) {
      const ox = u * hw, oy = v * hh;
      this._vert(px + ox * cs - oy * sn, py + ox * sn + oy * cs,
        depth, r, g, b, alpha, u, v, kind);
    }
    this._close(run);
  }

  /** Draw everything the overlay collected, far to near. */
  _flushOverlay() {
    const gl = this.gl;
    if (!this._oN) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._oBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this._overlay.subarray(0, this._oN * OVERLAY_FLOATS),
      gl.DYNAMIC_DRAW);
    if (!this._oVao) {
      this._oVao = gl.createVertexArray();
      gl.bindVertexArray(this._oVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._oBuf);
      const S = OVERLAY_FLOATS * 4;
      const at = [[this.oLoc.pos, 2, 0], [this.oLoc.depth, 1, 8], [this.oLoc.color, 4, 12],
                  [this.oLoc.uv, 2, 28], [this.oLoc.kind, 1, 36]];
      for (const [loc, size, off] of at) {
        if (loc < 0) continue;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, off);
      }
      gl.bindVertexArray(null);
    }

    gl.useProgram(this.overlay);
    // CSS pixels, because that is what the effects layer projects into.
    // Normalised device coordinates do not care which unit you measure the
    // viewport in, so long as the positions agree with it.
    gl.uniform2f(this.oLoc.uViewport, this.width, this.height);
    gl.uniform2f(this.oLoc.uDepthMap, this.proj[10], this.proj[11]);
    gl.bindVertexArray(this._oVao);
    gl.enable(gl.BLEND);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);

    // Far to near, so alpha-blended shapes lay over one another the way the
    // painter's-algorithm list did. Additive runs do not care about order, but
    // sorting them along with the rest costs nothing and keeps one code path.
    const runs = this._runs.filter((r) => r.end > r.start).sort((a, b) => b.depth - a.depth);
    let addState = null;
    for (const r of runs) {
      if (r.add !== addState) {
        gl.blendFunc(gl.SRC_ALPHA, r.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
        addState = r.add;
      }
      gl.drawArrays(gl.TRIANGLES, r.start, r.end - r.start);
      this.stats.overlay++;
    }

    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** Finish the frame: everything blended, back to front. */
  end() {
    const gl = this.gl;
    if (!this.blended.length) { this._flushOverlay(); return; }
    this.blended.sort((a, b) => b.depth - a.depth);
    gl.enable(gl.BLEND);
    // Depth is still tested — a glow behind a wall stays behind it — but not
    // written, so blended surfaces do not occlude each other.
    gl.depthMask(false);
    for (const b of this.blended) {
      gl.blendFunc(gl.SRC_ALPHA, b.additive ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      this._drawMesh(b.mesh, b.mat, b, b.alpha, b.additive);
      this.stats.blended++;
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    this.blended.length = 0;
    this._flushOverlay();
  }
}

// Local copies rather than imports: core3 owns the row-major convention, but
// pulling it in here would make the GL layer depend on the software renderer
// it is meant to be an alternative to.
function matMul4(a, b, out) {
  for (let r = 0; r < 4; r++) {
    const a0 = a[r * 4], a1 = a[r * 4 + 1], a2 = a[r * 4 + 2], a3 = a[r * 4 + 3];
    for (let c = 0; c < 4; c++) {
      out[r * 4 + c] = a0 * b[c] + a1 * b[4 + c] + a2 * b[8 + c] + a3 * b[12 + c];
    }
  }
  return out;
}

function copy16(m) {
  const out = new Float32Array(16);
  out.set(m.length === 16 ? m : m.subarray(0, 16));
  return out;
}
