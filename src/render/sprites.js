// Cached offscreen sprites.
//
// Canvas2D radial gradients are expensive to build, and the game creates
// thousands of glows per frame. Baking one gradient per colour into a small
// offscreen canvas and blitting it turns that cost into a drawImage.

const glowCache = new Map();
const softCache = new Map();
const SIZE = 96;

function parse(hex) {
  if (!hex) return [255, 255, 255];
  if (hex.startsWith('rgb')) {
    const m = hex.match(/\d+/g);
    return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
  }
  const h = hex.replace('#', '');
  if (h.length === 3) return h.split('').map((c) => parseInt(c + c, 16));
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function build(color, stops, kind) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const [r, g, b] = parse(color);
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  for (const [pos, a] of stops) grad.addColorStop(pos, `rgba(${r},${g},${b},${a})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  // What this sprite IS, rather than what it was baked into.
  //
  // The GPU backend does not want a bitmap: a radial ramp is four mix() calls
  // in a fragment shader, and evaluating it there means every particle in the
  // frame lands in one vertex buffer and one draw call regardless of its
  // colour. Uploading a hundred and twenty little textures instead would be a
  // hundred and twenty draw calls, which is the whole cost back again. So the
  // canvas carries its own recipe and each backend takes what it needs.
  c.spriteKind = kind;
  c.spriteRgb = [r, g, b];
  return c;
}

/** Hard-cored glow: bright centre, fast falloff. Good for sparks and orbs. */
export function glowSprite(color) {
  let s = glowCache.get(color);
  if (!s) {
    s = build(color, [[0, 1], [0.25, 0.75], [0.55, 0.22], [1, 0]], 1);
    glowCache.set(color, s);
    if (glowCache.size > 120) glowCache.delete(glowCache.keys().next().value);
  }
  return s;
}

/** Soft haze: no hot centre. Good for auras, smoke and light pools. */
export function softSprite(color) {
  let s = softCache.get(color);
  if (!s) {
    s = build(color, [[0, 0.55], [0.4, 0.28], [0.75, 0.08], [1, 0]], 2);
    softCache.set(color, s);
    if (softCache.size > 120) softCache.delete(softCache.keys().next().value);
  }
  return s;
}

/** Blit a cached sprite centred at (x, y) with the given radius. */
export function blit(ctx, sprite, x, y, radius, alpha = 1, squashY = 1) {
  if (alpha <= 0.004 || radius <= 0.2) return;
  ctx.globalAlpha = alpha;
  ctx.drawImage(sprite, x - radius, y - radius * squashY, radius * 2, radius * 2 * squashY);
  ctx.globalAlpha = 1;
}

export function clearSpriteCache() {
  glowCache.clear();
  softCache.clear();
}

/**
 * Backing-store resolution. Every polygon in this game is filled by hand on the
 * CPU, so cost scales with pixels: an iPad's 2x store over a 1180pt-wide window
 * is five and a half million pixels a frame. Full density stays for small
 * windows, where it is affordable and where text needs it most.
 */
export function pickDpr(w, h) {
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const px = w * h * dpr * dpr;
  if (px < 2.2e6) return Math.min(dpr, 2);
  if (px < 4.5e6) return Math.min(dpr, 1.5);
  return Math.min(dpr, 1.25);
}
