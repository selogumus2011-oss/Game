// The face, painted rather than built.
//
// It used to be a dozen thin boxes stacked on the front of the skull: an eye
// white, an iris, a pupil, a highlight, a lash line, a brow, a nose tick, a
// mouth, a pair of clan markings. That works, and it is what you do when every
// triangle is filled by hand and there is no way to put an image on a surface.
// It also loses: a box cannot be almond-shaped, a lash cannot taper, and at
// three metres the whole assembly resolves into a pale plate with marks on it.
//
// This draws the same face with a brush instead. One transparent square of
// line art, composited over the shaded skull — which is exactly how a cel is
// made, and it means the features are flat line work that does not shade while
// the head underneath still takes the full cel treatment.
//
// Everything is authored in a unit square: (0,0) top-left, (1,1) bottom-right,
// with the face centred on x = 0.5. The eye line sits at y = 0.42 because a
// drawn head puts it low, and every other feature is placed relative to it.

const SIZE = 256;
const cache = new Map();

/** The eye line, and the distance from it to the chin. Everything hangs off these. */
const EYE_Y = 0.44;
const EYE_DX = 0.245;      // from centre to the middle of each eye
// A drawn face leaves about an eye's width between the eyes. At the spacing
// these started on, the two openings nearly touched and the whole face read
// as a mask.
const EYE_W = 0.135;       // half-width of one opening
const EYE_H = 0.100;       // half-height

function px(v) { return v * SIZE; }

/**
 * One eye, as an inker draws it.
 *
 * The order is the order of the strokes: the white first, then the iris
 * cropped by the lid, then the pupil, then the highlight, and the lash line
 * last and heaviest. The lash is the single most important mark on the face —
 * thicker than the contour of the head itself — and the thing that makes an
 * eye read as an eye rather than as a window.
 */
function eye(ctx, cx, cy, s, colors, mirror) {
  const { iris, lash, brow } = colors;
  const W = EYE_W * s, H = EYE_H * s;

  // The opening: a lens, wider than tall, with the outer corner carried higher
  // than the inner one. Drawn as a closed path of two arcs so the lids meet at
  // a point at each corner rather than in a rounded stub.
  const inner = cx - mirror * W;
  const outer = cx + mirror * W;
  const lens = () => {
    ctx.beginPath();
    ctx.moveTo(px(inner), px(cy + 0.012 * s));
    ctx.bezierCurveTo(
      px(cx - mirror * W * 0.55), px(cy - H * 1.32),
      px(cx + mirror * W * 0.42), px(cy - H * 1.45),
      px(outer), px(cy - 0.028 * s));
    ctx.bezierCurveTo(
      px(cx + mirror * W * 0.5), px(cy + H * 0.98),
      px(cx - mirror * W * 0.6), px(cy + H * 0.92),
      px(inner), px(cy + 0.012 * s));
    ctx.closePath();
  };

  ctx.save();
  lens();
  ctx.fillStyle = '#f8f7fa';
  ctx.fill();
  // Clip to the opening so the iris is cropped by the lids instead of floating
  // inside them — a drawn iris is always cut off top and bottom.
  ctx.clip();

  const irisR = H * 1.25;
  const ix = cx - mirror * W * 0.06;
  ctx.beginPath();
  ctx.ellipse(px(ix), px(cy + H * 0.06), px(irisR * 0.78), px(irisR), 0, 0, Math.PI * 2);
  ctx.fillStyle = iris;
  ctx.fill();
  // A darker rim inside the iris: the edge of a drawn iris is always a shade
  // deeper than its middle, and it is what stops it reading as a flat disc.
  ctx.lineWidth = px(0.012 * s);
  ctx.strokeStyle = shadeHex(iris, 0.55);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(px(ix), px(cy + H * 0.1), px(irisR * 0.34), px(irisR * 0.46), 0, 0, Math.PI * 2);
  ctx.fillStyle = shadeHex(iris, 0.3);
  ctx.fill();

  // The highlight. One small bright shape, off-centre, the same corner on both
  // eyes because it comes from a light and lights do not mirror.
  ctx.beginPath();
  ctx.ellipse(px(ix - 0.035 * s), px(cy - H * 0.42), px(0.032 * s), px(0.026 * s), -0.4, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // The upper lid's shadow falls across the top of the eye.
  ctx.beginPath();
  ctx.rect(px(cx - W * 1.2), px(cy - H * 1.6), px(W * 2.4), px(H * 0.7));
  ctx.fillStyle = 'rgba(40,28,44,0.30)';
  ctx.fill();
  ctx.restore();

  // The lash line, over the top, heaviest at the outer third and tapering to a
  // point past the outer corner.
  ctx.beginPath();
  ctx.moveTo(px(inner), px(cy + 0.008 * s));
  ctx.bezierCurveTo(
    px(cx - mirror * W * 0.55), px(cy - H * 1.34),
    px(cx + mirror * W * 0.42), px(cy - H * 1.48),
    px(outer + mirror * 0.03 * s), px(cy - 0.05 * s));
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px(0.036 * s);
  ctx.strokeStyle = lash;
  ctx.stroke();

  // A finer line under the eye, only across the outer half: a full loop reads
  // as a pair of goggles.
  ctx.beginPath();
  ctx.moveTo(px(cx), px(cy + H * 0.99));
  ctx.quadraticCurveTo(
    px(cx + mirror * W * 0.62), px(cy + H * 0.9),
    px(outer), px(cy - 0.02 * s));
  ctx.lineWidth = px(0.014 * s);
  ctx.strokeStyle = lash;
  ctx.stroke();

  // Brow: a tapered stroke above, angled down toward the nose.
  ctx.beginPath();
  ctx.moveTo(px(cx - mirror * W * 1.05), px(cy - H * 2.35));
  ctx.quadraticCurveTo(
    px(cx + mirror * W * 0.1), px(cy - H * 2.95),
    px(cx + mirror * W * 1.0), px(cy - H * 2.25));
  ctx.lineWidth = px(0.030 * s);
  ctx.strokeStyle = brow;
  ctx.stroke();
}

/** Darken a hex colour toward black by k. */
function shadeHex(hex, k) {
  const h = (hex || '#000000').replace('#', '');
  const n = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return `rgb(${Math.round(n[0] * k)},${Math.round(n[1] * k)},${Math.round(n[2] * k)})`;
}

/**
 * The whole face, cached per appearance.
 *
 * Returns a canvas with a transparent background: only the marks are drawn, so
 * the skull's own cel shading shows between them and the features sit on top
 * as flat line work. That is the correct relationship — on a cel the paint and
 * the line are different layers, and the line does not take the light.
 */
export function faceTexture(a) {
  const hair = a.hair || '#1b1b22';
  const eyes = a.eyes || '#3d4a63';
  const skin = a.skin || '#e9c8ac';
  const key = `${hair}:${eyes}:${skin}:${a.blindfold ? 1 : 0}:${a.markings ? 1 : 0}:${a.stitches ? 1 : 0}`;
  let c = cache.get(key);
  if (c) return c;

  c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);

  const lash = shadeHex(hair, 0.55);
  const brow = shadeHex(hair, 0.72);

  if (a.blindfold) {
    // The wrap covers the whole upper face and there is nothing else to draw
    // up there.
    ctx.fillStyle = '#12151c';
    ctx.beginPath();
    ctx.moveTo(px(0.02), px(EYE_Y - 0.10));
    ctx.lineTo(px(0.98), px(EYE_Y - 0.13));
    ctx.lineTo(px(0.98), px(EYE_Y + 0.11));
    ctx.lineTo(px(0.02), px(EYE_Y + 0.14));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = px(0.008);
    ctx.beginPath();
    ctx.moveTo(px(0.04), px(EYE_Y + 0.02));
    ctx.lineTo(px(0.96), px(EYE_Y - 0.01));
    ctx.stroke();
  } else {
    // The shadow the fringe casts across the brow. The most recognisable thing
    // about an animated face and the cheapest to get: a flat shape of shadow
    // with a stepped lower edge, so it reads as painted rather than as a band.
    ctx.fillStyle = 'rgba(58,40,66,0.34)';
    ctx.beginPath();
    ctx.moveTo(px(0.0), px(0.0));
    ctx.lineTo(px(1.0), px(0.0));
    ctx.lineTo(px(1.0), px(0.150));
    ctx.lineTo(px(0.78), px(0.108));
    ctx.lineTo(px(0.62), px(0.186));
    ctx.lineTo(px(0.40), px(0.120));
    ctx.lineTo(px(0.19), px(0.196));
    ctx.lineTo(px(0.0), px(0.138));
    ctx.closePath();
    ctx.fill();

    eye(ctx, 0.5 - EYE_DX, EYE_Y, 1, { iris: eyes, lash, brow }, -1);
    eye(ctx, 0.5 + EYE_DX, EYE_Y, 1, { iris: eyes, lash, brow }, 1);

    // The nose: a single tick down its shadow side, which is all a drawn nose
    // is from the front. Anything more becomes a beak.
    ctx.beginPath();
    ctx.moveTo(px(0.524), px(0.598));
    ctx.quadraticCurveTo(px(0.532), px(0.630), px(0.508), px(0.640));
    ctx.lineCap = 'round';
    ctx.lineWidth = px(0.013);
    ctx.strokeStyle = shadeHex(skin, 0.60);
    ctx.stroke();

    // The mouth: short, slightly asymmetric, thickening at one end. A
    // symmetrical line reads as a slot.
    ctx.beginPath();
    ctx.moveTo(px(0.443), px(0.762));
    ctx.quadraticCurveTo(px(0.5), px(0.779), px(0.556), px(0.760));
    ctx.lineWidth = px(0.017);
    ctx.strokeStyle = shadeHex(skin, 0.42);
    ctx.stroke();
  }

  if (a.markings) {
    // Clan markings, out at the temple and down on the cheekbone — clear of
    // the eyes, which is where they belong and where they stop reading as part
    // of the eye.
    ctx.fillStyle = '#2a1414';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(px(0.5 + s * 0.118), px(0.232));
      ctx.lineTo(px(0.5 + s * 0.150), px(0.226));
      ctx.lineTo(px(0.5 + s * 0.143), px(0.300));
      ctx.lineTo(px(0.5 + s * 0.111), px(0.306));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(px(0.5 + s * 0.372), px(0.600));
      ctx.lineTo(px(0.5 + s * 0.404), px(0.590));
      ctx.lineTo(px(0.5 + s * 0.398), px(0.678));
      ctx.lineTo(px(0.5 + s * 0.366), px(0.688));
      ctx.closePath();
      ctx.fill();
    }
  }

  if (a.stitches) {
    ctx.strokeStyle = '#3a2a2a';
    ctx.lineWidth = px(0.012);
    ctx.lineCap = 'butt';
    for (let i = 0; i < 5; i++) {
      const y = 0.30 + i * 0.105;
      ctx.beginPath();
      ctx.moveTo(px(0.745), px(y));
      ctx.lineTo(px(0.845), px(y - 0.012));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(px(0.795), px(0.27));
    ctx.lineTo(px(0.795), px(0.78));
    ctx.lineWidth = px(0.008);
    ctx.stroke();
  }

  cache.set(key, c);
  if (cache.size > 40) cache.clear();
  return c;
}

export function clearFaceCache() { cache.clear(); }
