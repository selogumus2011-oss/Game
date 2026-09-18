// The cel shader, as GLSL.
//
// This is a transcription, not a redesign. Every number in here is lifted from
// the software rasteriser in ../core3.js and ../geom3.js, because the point of
// moving to the GPU is to draw the same picture faster — not to draw a
// different one. Where the two paths disagree the software one is right and
// this is the bug.
//
// Three things are worth knowing before reading it:
//
//   * **Shading is flat, per face.** The models carry one colour and one
//     normal per triangle and nothing is smoothed, so every varying that
//     crosses the boundary is `flat` and the normal is rebuilt in the vertex
//     shader from two edge vectors rather than interpolated.
//   * **The normal is derived, not supplied.** The two edges are transformed
//     by the modelview and crossed there. Limbs are scaled non-uniformly by
//     their bone width, and a normal transformed by such a matrix is wrong
//     unless you use the inverse transpose; crossing the transformed edges
//     sidesteps that and matches what the software path computes from the
//     projected triangle.
//   * **There is no gamma anywhere.** The software path composes colours as
//     plain 0–255 sRGB values with no linearisation, and the canvas shows them
//     as-is. Doing it properly here would be more correct and would not match,
//     so this does not do it properly.

/** Shared between the two programs: the band table and the fog blend. */
const CEL = /* glsl */`
// The five paint tones. x scales the value, yzw tint it — the shadow bands
// pull hard toward violet, which is what makes a shadow read as painted
// rather than as the same colour turned down.
const vec4 BANDS[5] = vec4[5](
  vec4(0.52, 0.74, 0.82, 1.30),
  vec4(0.74, 0.86, 0.92, 1.18),
  vec4(1.00, 1.00, 1.00, 1.00),
  vec4(1.16, 1.04, 1.02, 0.97),
  vec4(1.70, 1.14, 1.10, 1.04)
);

// The cuts are deliberately uneven: the first is the terminator and wants to
// be crisp, and the base band is wide so a lit surface stays flat across its
// whole area instead of drifting a band as it curves.
int bandOf(float l) {
  if (l < 0.56) return 0;
  if (l < 0.80) return 1;
  if (l < 1.14) return 2;
  if (l < 1.36) return 3;
  return 4;
}

// Haze blends toward the sky rather than multiplying toward black. Darkening
// with distance reads as "the lights went out"; blending toward the horizon
// reads as air.
vec3 hazed(vec3 c, float depth, vec2 fogRange, vec3 fogColor) {
  if (fogRange.y <= fogRange.x) return c;
  float t = clamp((depth - fogRange.x) / max(1.0, fogRange.y - fogRange.x), 0.0, 1.0);
  return mix(c, fogColor, t);
}
`;

export const MESH_VS = /* glsl */`#version 300 es
precision highp float;

in vec3 aPos;
in vec3 aEdge1;      // b - a, in model space
in vec3 aEdge2;      // c - a, in model space
in vec3 aColor;      // the authored face colour, 0..1
in vec2 aFlags;      // x: emissive, y: unused

uniform mat4 uMVP;
uniform mat4 uMV;
uniform mat4 uModel;

flat out vec3 vColor;
flat out vec3 vNormal;    // view space, already flipped to face the camera
flat out float vEmissive;
out float vDepth;
out vec3 vWorld;          // for the shadow lookup

void main() {
  vec4 viewPos = uMV * vec4(aPos, 1.0);
  // Depth as the software path measures it: distance in front of the eye.
  vDepth = -viewPos.z;

  vec3 e1 = (uMV * vec4(aEdge1, 0.0)).xyz;
  vec3 e2 = (uMV * vec4(aEdge2, 0.0)).xyz;
  vec3 n = cross(e1, e2);
  float len = length(n);
  n = len > 0.0 ? n / len : vec3(0.0, 0.0, 1.0);
  // The software path flips the normal toward the camera rather than trusting
  // the winding, so double-sided faces light the same from either side.
  if (n.z < 0.0) n = -n;
  vNormal = n;

  vColor = aColor;
  vEmissive = aFlags.x;
  vWorld = (uModel * vec4(aPos, 1.0)).xyz;
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

export const MESH_FS = /* glsl */`#version 300 es
precision highp float;

${CEL}

flat in vec3 vColor;
flat in vec3 vNormal;
flat in float vEmissive;
in float vDepth;
in vec3 vWorld;

uniform vec3 uLight;        // view-space key direction
uniform vec3 uLevels;       // ambient, key, rim
uniform vec3 uTint;
uniform float uAlpha;
uniform float uAdditive;    // 1.0 skips lighting entirely, as the software path does
uniform vec2 uFogRange;
uniform vec3 uFogColor;
uniform sampler2D uShadow;
uniform mat4 uLightVP;      // world -> the sun's clip space
uniform float uShadowOn;

/**
 * Is this point in shade?
 *
 * Hard edged on purpose, and no soft filtering. A cel-animated cast shadow is
 * a shape somebody painted with a brush — it has an edge, not a gradient — so
 * the usual percentage-closer blur would be working against the whole look.
 */
float inShadow() {
  if (uShadowOn < 0.5) return 0.0;
  vec4 lp = uLightVP * vec4(vWorld, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  // Outside the map, or past its far plane: the sun reaches it.
  if (p.x <= 0.0 || p.x >= 1.0 || p.y <= 0.0 || p.y >= 1.0 || p.z >= 1.0) return 0.0;
  // A constant bias is enough here because the map holds back faces: the
  // recorded depth is already the far side of whatever cast the shadow, which
  // is the cheap fix for surface acne on solid geometry.
  return p.z - 0.0016 > texture(uShadow, p.xy).r ? 1.0 : 0.0;
}

// Rim is a painted shape, not a falloff. A smooth term slides a surface
// through the bands as it curves away, which is a gradient by another name; a
// hard test snaps the edge into the rim band and leaves the inside alone.
const float RIM_EDGE = 0.62;

out vec4 outColor;

void main() {
  float light = 1.0;
  if (uAdditive < 0.5) {
    float d = dot(vNormal, uLight);
    light = uLevels.x + uLevels.y * max(0.0, d);
    if (uLevels.z > 0.0 && 1.0 - vNormal.z > RIM_EDGE) light += uLevels.z * 1.7;
    if (vEmissive > 0.0) light = mix(light, 1.45, vEmissive);
    // A cast shadow drops the surface into the second paint tone rather than
    // multiplying it down. Everything else in this renderer quantises to the
    // band table, and a shadow that did not would be the one soft gradient in
    // a frame of flat colour. Taken as a minimum, so a surface already facing
    // away from the key does not get LIGHTER for being in shade.
    if (inShadow() > 0.5) light = min(light, 0.74);
  }

  vec4 band = BANDS[bandOf(light)];
  vec3 c = clamp(vColor * band.x * band.yzw * uTint, 0.0, 1.0);
  c = hazed(c, vDepth, uFogRange, uFogColor);
  outColor = vec4(c, uAlpha);
}
`;

export const HULL_VS = /* glsl */`#version 300 es
precision highp float;

// Every vertex carries the whole triangle. That is what makes it possible to
// reproduce the software outline exactly rather than approximately: the offset
// is per EDGE, and a vertex that can only see itself has no edges.
in vec3 aPos;
in vec3 aP1;     // the next corner, in winding order
in vec3 aP2;     // the one after that

uniform mat4 uMVP;
uniform vec2 uHalfViewport;   // pixels
uniform float uPx;            // base ink width in pixels

/** Outward normal of edge p->q, for a triangle wound positive on screen. */
vec2 edgeNormal(vec2 p, vec2 q) {
  vec2 d = q - p;
  float l = length(d);
  return l > 0.0 ? vec2(d.y, -d.x) / l : vec2(0.0);
}

void main() {
  vec4 clip = uMVP * vec4(aPos, 1.0);
  vec4 c1 = uMVP * vec4(aP1, 1.0);
  vec4 c2 = uMVP * vec4(aP2, 1.0);
  // A triangle straddling the near plane cannot be offset meaningfully in
  // screen space; leave it where it is rather than flinging a corner to
  // infinity.
  if (clip.w <= 0.0 || c1.w <= 0.0 || c2.w <= 0.0) { gl_Position = clip; return; }

  // Screen pixels. The hull is pushed out in SCREEN space, not by scaling the
  // model: a scaled hull draws a line whose width falls off with distance, so
  // a fighter across the arena loses their ink entirely while one in your face
  // wears a thick black border. Constant pixel width at every depth is how cel
  // animation actually looks — the line does not thin out with the drawing.
  vec2 a = (clip.xy / clip.w) * uHalfViewport;
  vec2 b = (c1.xy / c1.w) * uHalfViewport;
  vec2 c = (c2.xy / c2.w) * uHalfViewport;

  // Line weight follows the size of the form. A hand-inked drawing does not
  // use one pen: big forms carry a heavy contour, small details a fine one,
  // and projected area is the right proxy because it folds in both how large
  // the form is and how far away it is. This is the same cross product the
  // software path measures — twice the area, and the square root of that is
  // what the constant below was tuned against.
  float cross2 = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
  float w = uPx * clamp(sqrt(abs(cross2)) * 0.036, 0.5, 1.8);

  // Offset the two edges meeting at this corner and take where they cross.
  // Pushing the corner radially from the centroid instead would leave the
  // middle of a long edge barely moved, so the ink would thin out exactly
  // where a silhouette is longest and most visible.
  //
  // edgeNormal points outward for a positively wound triangle. Clip space is
  // y-up where the software rasteriser's screen space is y-down, so the sign
  // is taken from the winding rather than assumed — that way this is correct
  // in either convention and does not silently invert if the projection ever
  // changes handedness.
  float s = cross2 < 0.0 ? -1.0 : 1.0;
  vec2 nPrev = edgeNormal(c, a) * s;     // edge CA, arriving here
  vec2 nNext = edgeNormal(a, b) * s;     // edge AB, leaving here
  vec2 bis = nPrev + nNext;
  float bl = length(bis);
  vec2 offset;
  if (bl < 1e-4) {
    offset = nNext * w;              // edges doubled back: no miter to take
  } else {
    bis /= bl;
    // Moving along the bisector by w / sin(half-angle) lands on the crossing.
    // Capped so a needle-thin triangle cannot fire a spike across the screen.
    float cosHalf = max(0.45, dot(bis, nNext));
    offset = bis * min(w / cosHalf, w * 1.9);
  }

  clip.xy += (offset / uHalfViewport) * clip.w;
  gl_Position = clip;
}
`;

export const HULL_FS = /* glsl */`#version 300 es
precision highp float;

uniform vec3 uInk;
uniform float uAlpha;

out vec4 outColor;

void main() {
  outColor = vec4(uInk, uAlpha);
}
`;

export const LINE_VS = /* glsl */`#version 300 es
precision highp float;

// Both endpoints on every vertex, plus which end this one is and which side of
// the line it sits on. That is what lets a line have a width: gl.lineWidth is
// clamped to 1 everywhere that matters, so an edge is drawn as a quad.
in vec3 aA;
in vec3 aB;
in vec2 aSide;      // x: 0 at A, 1 at B.  y: -1 or +1 across the line

uniform mat4 uMVP;
uniform vec2 uHalfViewport;
uniform float uWidth;     // pixels
uniform float uBias;      // clip-space pull toward the camera

void main() {
  vec4 ca = uMVP * vec4(aA, 1.0);
  vec4 cb = uMVP * vec4(aB, 1.0);
  // An edge crossing the near plane cannot be given a screen direction.
  // Collapse it rather than letting it swing across the frame.
  if (ca.w <= 0.0 || cb.w <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vec2 pa = (ca.xy / ca.w) * uHalfViewport;
  vec2 pb = (cb.xy / cb.w) * uHalfViewport;
  vec2 d = pb - pa;
  float l = length(d);
  vec2 n = l > 1e-5 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);

  vec4 c = mix(ca, cb, aSide.x);
  vec2 p = mix(pa, pb, aSide.x) + n * aSide.y * uWidth * 0.5;

  // A line lying exactly on the surface it describes z-fights with it, and a
  // fighting line flickers on and off as the camera moves — which is worse
  // than no line at all. Pull it a hair toward the eye. Scaling the bias by w
  // keeps it a constant nudge in depth rather than one that grows with
  // distance and lifts far lines off their surfaces entirely.
  gl_Position = vec4((p / uHalfViewport) * c.w, c.z - uBias * c.w, c.w);
}
`;

export const LINE_FS = /* glsl */`#version 300 es
precision highp float;
uniform vec3 uInk;
uniform float uAlpha;
out vec4 outColor;
void main() { outColor = vec4(uInk, uAlpha); }
`;

export const OVERLAY_VS = /* glsl */`#version 300 es
precision highp float;

// Screen-space geometry that still takes part in the depth test.
//
// Everything the effects layer draws — particles, shards, spark trails, energy
// shapes — is worked out in screen pixels by CPU code that projects each point
// itself. That code is not being rewritten: it knows things about how cursed
// energy should be drawn that a vertex shader has no business knowing. What it
// lacked was a way to say "and this is HOW FAR AWAY it is", so a particle
// behind a character drew over the character's face. Each vertex therefore
// carries its screen position and its view depth, and the depth is turned back
// into exactly the clip-space z a mesh at that distance would have produced.
in vec2 aPos;        // device pixels, y down
in float aDepth;     // metres in front of the eye
in vec4 aColor;
in vec2 aUV;         // -1..1 across a sprite quad; unused when flat
in float aKind;      // 0 flat, 1 glow, 2 soft

uniform vec2 uViewport;    // device pixels
uniform vec2 uDepthMap;    // the projection's z row: (p10, p11)

out vec4 vColor;
out vec2 vUV;
flat out int vKind;

void main() {
  float w = max(aDepth, 1e-3);
  vec2 ndc = vec2(aPos.x / uViewport.x * 2.0 - 1.0,
                  1.0 - aPos.y / uViewport.y * 2.0);
  // clip.z for a vertex at view z = -depth, which is what the mesh pass gets
  // from the same projection matrix. Matching it here is what makes the two
  // sets of geometry occlude each other correctly.
  float z = uDepthMap.x * (-aDepth) + uDepthMap.y;
  gl_Position = vec4(ndc * w, z, w);
  vColor = aColor;
  vUV = aUV;
  vKind = int(aKind + 0.5);
}
`;

export const OVERLAY_FS = /* glsl */`#version 300 es
precision highp float;

in vec4 vColor;
in vec2 vUV;
flat in int vKind;

out vec4 outColor;

/**
 * The two sprite ramps, as functions rather than as bitmaps.
 *
 * These are the exact stop lists the canvas gradients are built from in
 * ../../render/sprites.js — a hard-cored glow for sparks and orbs, a soft haze
 * with no hot centre for auras and smoke. A radial gradient is piecewise
 * linear in the radius, so reproducing one is a chain of mixes.
 */
float ramp(float r, int kind) {
  if (kind == 1) {
    // [0, 1] [0.25, 0.75] [0.55, 0.22] [1, 0]
    if (r < 0.25) return mix(1.0, 0.75, r / 0.25);
    if (r < 0.55) return mix(0.75, 0.22, (r - 0.25) / 0.30);
    return mix(0.22, 0.0, (r - 0.55) / 0.45);
  }
  // [0, 0.55] [0.4, 0.28] [0.75, 0.08] [1, 0]
  if (r < 0.40) return mix(0.55, 0.28, r / 0.40);
  if (r < 0.75) return mix(0.28, 0.08, (r - 0.40) / 0.35);
  return mix(0.08, 0.0, (r - 0.75) / 0.25);
}

void main() {
  vec4 c = vColor;
  if (vKind != 0) {
    float r = length(vUV);
    if (r > 1.0) discard;
    c.a *= ramp(r, vKind);
  }
  if (c.a <= 0.002) discard;
  outColor = vec4(c.rgb, c.a);
}
`;

export const DEPTH_VS = /* glsl */`#version 300 es
precision highp float;
in vec3 aPos;
uniform mat4 uLightMVP;
void main() { gl_Position = uLightMVP * vec4(aPos, 1.0); }
`;

export const DEPTH_FS = /* glsl */`#version 300 es
precision highp float;
void main() {}
`;

export const TEX_VS = /* glsl */`#version 300 es
precision highp float;
in vec3 aPos;
in vec2 aUV;
uniform mat4 uMVP;
uniform mat4 uMV;
uniform vec2 uTexSize;
uniform float uBias;
out vec2 vUV;
out float vDepth;
void main() {
  vUV = aUV / uTexSize;
  vDepth = -(uMV * vec4(aPos, 1.0)).z;
  vec4 clip = uMVP * vec4(aPos, 1.0);
  // A decal, not a surface. The plate is a flat quad across a skull that
  // bulges at the cheekbones, so around the eyes it sits a few millimetres
  // INSIDE the head and a depth buffer is quite right to hide it. The software
  // path never noticed because it has no depth buffer and sorts the plate in
  // front by a fixed offset; this is the same offset, in the same spirit.
  clip.z -= uBias * clip.w;
  gl_Position = clip;
}
`;

export const TEX_FS = /* glsl */`#version 300 es
precision highp float;

${CEL}

in vec2 vUV;
in float vDepth;

uniform sampler2D uTex;
uniform vec3 uTint;
uniform float uAlpha;
uniform int uBand;
uniform vec2 uFogRange;
uniform vec3 uFogColor;

out vec4 outColor;

void main() {
  vec4 t = texture(uTex, vUV);
  if (t.a <= 0.004) discard;
  // The paint tone comes in as an index rather than being worked out here: the
  // surface is flat, so it is one tone for the whole plate, and the software
  // path picks it the same way from the same normal. Deriving it twice from
  // two different recoveries of the same plane is how a face ends up a band
  // darker on one side of its diagonal than the other.
  vec4 band = BANDS[uBand];
  vec3 c = clamp(t.rgb * band.x * band.yzw * uTint, 0.0, 1.0);
  c = hazed(c, vDepth, uFogRange, uFogColor);
  outColor = vec4(c, t.a * uAlpha);
}
`;
