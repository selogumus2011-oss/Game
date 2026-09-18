// Getting a mesh onto the GPU.
//
// The meshes are built once and cached forever (see `cached()` in
// ../models3.js), so the buffers are built once too and hung off the mesh
// itself. Nothing here runs per frame.
//
// Two things about the source format shape this:
//
//   * **Shading is per face, not per vertex.** Colour, emissive and the normal
//     all belong to the triangle, so the index buffer has to go: each triangle
//     gets its own three vertices carrying its own attributes. These models are
//     a few hundred triangles each, so tripling the vertex count costs
//     kilobytes and buys flat shading for free.
//   * **Some faces are double-sided.** Back-face culling is pipeline state,
//     not per-triangle state, so the faces are sorted at upload — single-sided
//     first, double-sided after — and the boundary is recorded. Drawing then
//     costs two calls instead of one, and only for the meshes that need it.

const FLOATS_PER_VERT = 20;
//  0..2   position
//  3..5   the next corner in winding order    } the whole triangle, which the
//  6..8   the corner after that               } outline's miter needs
//  9..11  edge b-a                            } the two edges, for the normal
// 12..14  edge c-a                            }
// 15..17  colour, 0..1
// 18..19  flags: emissive, spare
//
// The two edges are derivable from the three corners, and carrying both is
// redundant. It is also three floats a vertex on meshes measured in hundreds
// of triangles, against a multiply-and-subtract in every vertex shader
// invocation of every frame — so they are precomputed.

export const STRIDE = FLOATS_PER_VERT * 4;
export const OFFSETS = {
  pos: 0, p1: 12, p2: 24, edge1: 36, edge2: 48, color: 60, flags: 72,
};

/**
 * Upload a mesh, or hand back the buffers from last time.
 *
 * `contextId` guards against a lost GL context: the mesh cache outlives the
 * context, and a stale buffer handle from a dead context draws nothing while
 * reporting no error at all, which is a miserable thing to debug.
 */
export function gpuMesh(gl, mesh, contextId) {
  const cached = mesh._gpu;
  if (cached && cached.contextId === contextId) return cached;

  const nf = mesh.nf;
  const v = mesh.v;
  const f = mesh.f;

  // Single-sided faces first so one cull setting covers each run.
  const order = new Int32Array(nf);
  let lo = 0, hi = nf;
  for (let i = 0; i < nf; i++) {
    if (mesh.dbl[i]) order[--hi] = i; else order[lo++] = i;
  }
  const solidCount = lo;

  const data = new Float32Array(nf * 3 * FLOATS_PER_VERT);
  let o = 0;
  for (let k = 0; k < nf; k++) {
    const i = order[k];
    const ia = f[i * 3] * 3, ib = f[i * 3 + 1] * 3, ic = f[i * 3 + 2] * 3;
    const ax = v[ia], ay = v[ia + 1], az = v[ia + 2];
    const bx = v[ib], by = v[ib + 1], bz = v[ib + 2];
    const cx = v[ic], cy = v[ic + 1], cz = v[ic + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const col = mesh.fc[i];
    const cr = col[0] / 255, cg = col[1] / 255, cb = col[2] / 255;
    const em = mesh.emis[i] || 0;

    // Each corner carries the other two after it, in winding order, so the
    // outline pass can offset both edges meeting at this corner.
    const corners = [
      [ax, ay, az, bx, by, bz, cx, cy, cz],
      [bx, by, bz, cx, cy, cz, ax, ay, az],
      [cx, cy, cz, ax, ay, az, bx, by, bz],
    ];
    for (const c of corners) {
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
      data[o + 3] = c[3]; data[o + 4] = c[4]; data[o + 5] = c[5];
      data[o + 6] = c[6]; data[o + 7] = c[7]; data[o + 8] = c[8];
      data[o + 9] = e1x; data[o + 10] = e1y; data[o + 11] = e1z;
      data[o + 12] = e2x; data[o + 13] = e2y; data[o + 14] = e2z;
      data[o + 15] = cr; data[o + 16] = cg; data[o + 17] = cb;
      data[o + 18] = em; data[o + 19] = 0;
      o += FLOATS_PER_VERT;
    }
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

  const gpu = {
    contextId,
    buffer,
    solidVerts: solidCount * 3,
    doubleVerts: (nf - solidCount) * 3,
    totalVerts: nf * 3,
    vaos: new Map(),      // program key -> VAO
    bytes: data.byteLength,
  };
  mesh._gpu = gpu;
  return gpu;
}

/**
 * A vertex array object binding this mesh's buffer to one program's attributes.
 *
 * Cached per program because the mesh pass and the outline pass read different
 * subsets of the same interleaved buffer, and rebinding five attributes per
 * draw across a few hundred draws a frame is most of the CPU cost of a naive
 * GL renderer.
 */
export function meshVao(gl, gpu, key, attribs) {
  let vao = gpu.vaos.get(key);
  if (vao) return vao;
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
  for (const [loc, size, offset] of attribs) {
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE, offset);
  }
  gl.bindVertexArray(null);
  gpu.vaos.set(key, vao);
  return vao;
}

/**
 * The interior lines, as quads.
 *
 * `gl.lineWidth` is a lie: every browser on every desktop platform clamps it
 * to 1, so a GL line cannot be the 1.25 device pixels the software path draws
 * and certainly cannot be the 2.5 a phone at 2x needs. Each edge therefore
 * becomes two triangles expanded sideways in the vertex shader, which also
 * gets the width in screen pixels rather than in world units — the same
 * property that makes the silhouette hold up at every distance.
 *
 * Every edge in the list is uploaded, including the ones on the far side of
 * the model. The software path has to test each one against the facing of its
 * two triangles to avoid drawing the far seams through the near surface; here
 * the depth buffer does that for free and better.
 */
export function gpuLines(gl, mesh, contextId, edges) {
  const cached = mesh._gpuLines;
  if (cached && cached.contextId === contextId) return cached;
  if (!edges || !edges.length) {
    const empty = { contextId, buffer: null, verts: 0, vaos: new Map() };
    mesh._gpuLines = empty;
    return empty;
  }

  const v = mesh.v;
  const n = edges.length / 4;
  // Six vertices an edge; each carries both endpoints plus which end and which
  // side of the line it is.
  const data = new Float32Array(n * 6 * 8);
  let o = 0;
  // end, side — the two triangles of the quad, wound consistently.
  const corners = [[0, -1], [1, -1], [1, 1], [0, -1], [1, 1], [0, 1]];
  for (let e = 0; e < n; e++) {
    const a = edges[e * 4] * 3, b = edges[e * 4 + 1] * 3;
    const ax = v[a], ay = v[a + 1], az = v[a + 2];
    const bx = v[b], by = v[b + 1], bz = v[b + 2];
    for (const [end, side] of corners) {
      data[o] = ax; data[o + 1] = ay; data[o + 2] = az;
      data[o + 3] = bx; data[o + 4] = by; data[o + 5] = bz;
      data[o + 6] = end; data[o + 7] = side;
      o += 8;
    }
  }

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const out = { contextId, buffer, verts: n * 6, vaos: new Map() };
  mesh._gpuLines = out;
  return out;
}

export const LINE_STRIDE = 8 * 4;
export const LINE_OFFSETS = { a: 0, b: 12, side: 24 };

/** As meshVao, for the line buffer. */
export function lineVao(gl, lines, key, attribs) {
  let vao = lines.vaos.get(key);
  if (vao) return vao;
  vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, lines.buffer);
  for (const [loc, size, offset] of attribs) {
    if (loc < 0) continue;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, LINE_STRIDE, offset);
  }
  gl.bindVertexArray(null);
  lines.vaos.set(key, vao);
  return vao;
}


/**
 * Position and texture coordinates for a textured mesh.
 *
 * Kept in its own buffer rather than widened into the main vertex format: one
 * surface in the game is textured, and two more floats on every vertex of
 * every character to serve it would be a poor trade.
 */
export function gpuTexMesh(gl, mesh, contextId) {
  const cached = mesh._gpuTex;
  if (cached && cached.contextId === contextId) return cached;

  const nf = mesh.nf;
  const data = new Float32Array(nf * 3 * 5);
  let o = 0;
  for (let i = 0; i < nf * 3; i++) {
    const v = mesh.f[i] * 3, u = mesh.f[i] * 2;
    data[o] = mesh.v[v]; data[o + 1] = mesh.v[v + 1]; data[o + 2] = mesh.v[v + 2];
    data[o + 3] = mesh.uv[u]; data[o + 4] = mesh.uv[u + 1];
    o += 5;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  const out = { contextId, buffer, verts: nf * 3, vaos: new Map() };
  mesh._gpuTex = out;
  return out;
}

export const TEXMESH_STRIDE = 5 * 4;
export const TEXMESH_OFFSETS = { pos: 0, uv: 12 };

/** A GL texture for a canvas, uploaded once and kept on the canvas itself. */
export function gpuTexture(gl, canvas, contextId) {
  const cached = canvas._glTex;
  if (cached && cached.contextId === contextId) return cached.tex;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  // Trilinear, because a face is read at every distance from arm's length to
  // across the arena and an unmipmapped one crawls badly as it recedes.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  canvas._glTex = { contextId, tex };
  return tex;
}
