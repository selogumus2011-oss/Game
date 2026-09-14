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

function build(color, stops) {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  const [r, g, b] = parse(color);
  const grad = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  for (const [pos, a] of stops) grad.addColorStop(pos, `rgba(${r},${g},${b},${a})`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  return c;
}

/** Hard-cored glow: bright centre, fast falloff. Good for sparks and orbs. */
export function glowSprite(color) {
  let s = glowCache.get(color);
  if (!s) {
    s = build(color, [[0, 1], [0.25, 0.75], [0.55, 0.22], [1, 0]]);
    glowCache.set(color, s);
    if (glowCache.size > 120) glowCache.delete(glowCache.keys().next().value);
  }
  return s;
}

/** Soft haze: no hot centre. Good for auras, smoke and light pools. */
export function softSprite(color) {
  let s = softCache.get(color);
  if (!s) {
    s = build(color, [[0, 0.55], [0.4, 0.28], [0.75, 0.08], [1, 0]]);
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
