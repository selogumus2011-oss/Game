// Domain visuals. Each domain gets its own full-screen treatment inside the
// barrier: Unlimited Void is a starfield of infinite information, Malevolent
// Shrine is a skull shrine with a slash storm, Chimera Shadow Garden floods the
// floor with liquid shadow, and so on.

import { clamp, clamp01, lerp, TAU, PI, rand, randRange, noise1, fbm1 } from '../core/math.js';
import { hexA } from './characters.js';
import { FLATTEN } from './camera.js';

export function drawDomainFloor(ctx, cam, d, time) {
  const c = cam.project(d.center.x, d.center.y, 0);
  const s = cam.scale;
  const r = d.radius * s;
  const spec = d.spec;

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, r, r * FLATTEN, 0, 0, TAU);
  ctx.clip();

  // Base wash.
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
  g.addColorStop(0, hexA(spec.color2 || '#000000', 0.85));
  g.addColorStop(0.7, hexA(spec.color2 || '#000000', 0.7));
  g.addColorStop(1, hexA(spec.color, 0.35));
  ctx.fillStyle = g;
  ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);

  switch (spec.visual) {
    case 'void': drawVoidFloor(ctx, c, r, time, spec); break;
    case 'shrine': drawShrineFloor(ctx, c, r, time, spec); break;
    case 'shadowGarden': drawShadowFloor(ctx, c, r, time, spec); break;
    case 'soulPalace': drawSoulFloor(ctx, c, r, time, spec); break;
    case 'volcano': drawVolcanoFloor(ctx, c, r, time, spec); break;
    case 'bloodSea': drawBloodFloor(ctx, c, r, time, spec); break;
    case 'words': drawWordFloor(ctx, c, r, time, spec); break;
    case 'swarm': drawSwarmFloor(ctx, c, r, time, spec); break;
    case 'courtroom': drawCourtFloor(ctx, c, r, time, spec); break;
    case 'ice': drawIceFloor(ctx, c, r, time, spec); break;
    case 'love': drawLoveFloor(ctx, c, r, time, spec); break;
    case 'pachinko': drawPachinkoFloor(ctx, c, r, time, spec); break;
    case 'tide': drawTideFloor(ctx, c, r, time, spec); break;
    default: drawVoidFloor(ctx, c, r, time, spec); break;
  }
  ctx.restore();
}

export function drawDomainDome(ctx, cam, d, time) {
  const c = cam.project(d.center.x, d.center.y, 0);
  const s = cam.scale;
  const r = d.radius * s;
  const spec = d.spec;
  const integrity = clamp01(d.integrity / d.maxIntegrity);

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';

  if (!d.open) {
    // Barrier wall: a bright rim that frays as integrity drops.
    const rim = ctx.createRadialGradient(c.x, c.y, r * 0.86, c.x, c.y, r * 1.06);
    rim.addColorStop(0, hexA(spec.color, 0));
    rim.addColorStop(0.7, hexA(spec.color, 0.28 * (0.4 + integrity * 0.6)));
    rim.addColorStop(1, hexA(spec.color, 0));
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 1.08, r * 1.08 * FLATTEN, 0, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = hexA(spec.color, 0.55 * integrity + 0.15);
    ctx.lineWidth = 2 + 3 * integrity;
    ctx.setLineDash(integrity < 0.5 ? [14 * integrity + 3, 10 * (1 - integrity) + 4] : []);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);

    // Vertical barrier struts so the dome reads as a volume.
    ctx.strokeStyle = hexA(spec.color, 0.12 * integrity);
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU + time * 0.06;
      const x = c.x + Math.cos(a) * r;
      const y = c.y + Math.sin(a) * r * FLATTEN;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(c.x + Math.cos(a) * r * 0.55, y - r * 0.85);
      ctx.stroke();
    }
  } else {
    // Open barrier: no wall, just a ring of cursed energy on the ground.
    ctx.strokeStyle = hexA(spec.color, 0.4);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r, r * FLATTEN, 0, 0, TAU);
    ctx.stroke();
  }

  // Clash pressure indicator.
  if (d.clashWith) {
    const push = clamp(d.clashPressure, -1, 1);
    ctx.strokeStyle = push >= 0 ? hexA('#ffffff', 0.4) : hexA('#ff4d4d', 0.4);
    ctx.lineWidth = 5 + Math.abs(push) * 6;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, r * 1.02, r * 1.02 * FLATTEN, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();
}

/** Overhead / interior flourishes drawn above the fighters. */
export function drawDomainOverlay(ctx, cam, d, time, width, height) {
  const spec = d.spec;
  const c = cam.project(d.center.x, d.center.y, 0);
  const r = d.radius * cam.scale;
  const inside = Math.hypot(cam.x - d.center.x, cam.y - d.center.y) < d.radius;

  ctx.save();
  if (spec.visual === 'void' && inside) {
    // Infinite information: cascading glyph columns over the whole screen.
    ctx.globalAlpha = 0.5;
    ctx.globalCompositeOperation = 'lighter';
    const cols = Math.ceil(width / 26);
    for (let i = 0; i < cols; i++) {
      const x = i * 26 + 4;
      const speed = 40 + ((i * 37) % 90);
      const y = ((time * speed + i * 211) % (height + 200)) - 100;
      const a = 0.16 + (noise1(i * 0.4 + time, 3) * 0.3);
      ctx.fillStyle = hexA('#8ad8ff', a);
      ctx.font = '13px "Courier New", monospace';
      for (let k = 0; k < 6; k++) {
        ctx.fillText(VOID_GLYPHS[(i * 7 + k + Math.floor(time * 6)) % VOID_GLYPHS.length], x, y + k * 16);
      }
    }
    ctx.globalAlpha = 1;
  }

  if (spec.visual === 'shrine') {
    // The shrine itself, looming behind everything.
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 + Math.sin(time * 2) * 0.06;
    const h = r * 1.5;
    ctx.strokeStyle = hexA('#ff4d4d', 0.5);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c.x - r * 0.55, c.y - r * 0.2);
    ctx.lineTo(c.x - r * 0.4, c.y - h);
    ctx.lineTo(c.x + r * 0.4, c.y - h);
    ctx.lineTo(c.x + r * 0.55, c.y - r * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - r * 0.75, c.y - h);
    ctx.lineTo(c.x, c.y - h - r * 0.4);
    ctx.lineTo(c.x + r * 0.75, c.y - h);
    ctx.closePath();
    ctx.stroke();
    // Skulls along the beam.
    for (let i = -3; i <= 3; i++) {
      const x = c.x + i * r * 0.2;
      ctx.fillStyle = hexA('#ffd8d8', 0.35);
      ctx.beginPath();
      ctx.ellipse(x, c.y - h + 14, 7, 9, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (spec.visual === 'volcano' && inside) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hexA('#ff5e00', 0.1 + Math.sin(time * 3) * 0.03);
    ctx.fillRect(0, 0, width, height);
  }
  if (spec.visual === 'bloodSea' && inside) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = hexA('#ff2d4f', 0.2);
    ctx.fillRect(0, 0, width, height);
  }
  if (spec.visual === 'courtroom' && inside) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = hexA('#cfa8ff', 0.4);
    ctx.lineWidth = 1;
    for (let i = 0; i < 8; i++) {
      const y = (i / 8) * height;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y + 20);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

const VOID_GLYPHS = '無量空処領域展開呪力術式反転蒼赫茈０１２３４５６７８９'.split('');

// --- floor treatments -------------------------------------------------------

function drawVoidFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const a = (i * 2.399) + time * 0.05;
    const d = ((i * 37) % 100) / 100;
    const rr = Math.sqrt(d) * r;
    const x = c.x + Math.cos(a) * rr;
    const y = c.y + Math.sin(a) * rr * FLATTEN;
    const tw = 0.3 + 0.7 * Math.abs(Math.sin(time * 2 + i));
    ctx.fillStyle = hexA('#ffffff', 0.5 * tw);
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  ctx.strokeStyle = hexA(spec.color, 0.16);
  ctx.lineWidth = 1;
  for (let i = 0; i < 7; i++) {
    const rr = r * ((i + 1) / 8) * (1 + Math.sin(time + i) * 0.02);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawShrineFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  // A storm of slashes crossing the floor.
  for (let i = 0; i < 26; i++) {
    const seed = Math.floor(time * 7) * 13 + i;
    const a = noise1(seed * 0.7, 11) * TAU;
    const d = noise1(seed * 0.31, 5) * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN;
    const len = 30 + noise1(seed * 0.11, 9) * 90;
    const ang = noise1(seed * 0.5, 17) * TAU;
    ctx.strokeStyle = hexA('#ff4d4d', 0.35);
    ctx.lineWidth = 1.5 + noise1(seed * 0.9, 3) * 2;
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang) * len, y - Math.sin(ang) * len * FLATTEN);
    ctx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len * FLATTEN);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawShadowFloor(ctx, c, r, time, spec) {
  // Liquid shadow: slow rolling dark blobs with a violet sheen.
  for (let i = 0; i < 16; i++) {
    const a = time * 0.15 + i * 0.7;
    const d = (0.2 + ((i * 17) % 80) / 100) * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN;
    const rr = r * (0.14 + ((i * 11) % 40) / 200);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, hexA('#000000', 0.75));
    g.addColorStop(0.7, hexA(spec.color, 0.2));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rr, rr * FLATTEN, 0, 0, TAU);
    ctx.fill();
  }
}

function drawSoulFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 40; i++) {
    const a = i * 1.7 + time * 0.3;
    const d = ((i * 23) % 100) / 100 * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN;
    ctx.strokeStyle = hexA(spec.color, 0.2);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, 10 + Math.sin(time * 2 + i) * 4, 14, i, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawVolcanoFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 30; i++) {
    const a = i * 2.1;
    const d = ((i * 29) % 100) / 100 * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN;
    const pulse = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.5 + i));
    const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
    g.addColorStop(0, hexA('#ff7a1a', 0.5 * pulse));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, 26, 26 * FLATTEN, 0, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawBloodFloor(ctx, c, r, time, spec) {
  for (let i = 0; i < 10; i++) {
    const a = time * 0.4 + i;
    const rr = r * (0.3 + (i / 10) * 0.7);
    ctx.strokeStyle = hexA('#ff2d4f', 0.18);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(c.x + Math.cos(a) * 8, c.y + Math.sin(a) * 5, rr, rr * FLATTEN, 0, 0, TAU);
    ctx.stroke();
  }
}

function drawWordFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  ctx.font = '16px system-ui, sans-serif';
  const words = ['動くな', '止まれ', '潰れろ', '爆ぜろ', '眠れ', '逃げるな'];
  for (let i = 0; i < 22; i++) {
    const a = i * 1.9 + time * 0.2;
    const d = ((i * 31) % 100) / 100 * r;
    ctx.fillStyle = hexA('#f0e6c8', 0.16 + 0.12 * Math.sin(time * 3 + i));
    ctx.fillText(words[i % words.length], c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * FLATTEN);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawSwarmFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 60; i++) {
    const a = i * 0.9 + time * (0.4 + (i % 5) * 0.1);
    const d = ((i * 19) % 100) / 100 * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN;
    ctx.fillStyle = hexA(spec.color, 0.3);
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 6, a, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Frozen Sanctuary: a lattice of ice shards growing out of the ground. */
function drawIceFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 46; i++) {
    const a = i * 2.399 + time * 0.05;
    const d = ((i * 37) % 100) / 100 * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN;
    const h = 14 + noise1(i * 0.9, 5) * 40;
    const grow = clamp01((time * 0.6 + i * 0.13) % 2);
    ctx.fillStyle = hexA('#a8e8ff', 0.26);
    ctx.beginPath();
    ctx.moveTo(x - 6, y);
    ctx.lineTo(x, y - h * grow);
    ctx.lineTo(x + 6, y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = hexA('#d8f4ff', 0.14);
  ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    const rr = r * ((i + 1) / 6);
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Authentic Mutual Love: petals and a slow heartbeat pulse. */
function drawLoveFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  const beat = 0.5 + 0.5 * Math.pow(Math.abs(Math.sin(time * 1.6)), 4);
  const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
  g.addColorStop(0, hexA('#ff8ab0', 0.26 * beat));
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(c.x - r, c.y - r, r * 2, r * 2);
  for (let i = 0; i < 34; i++) {
    const a = i * 1.7 + time * 0.25;
    const d = ((i * 29) % 100) / 100 * r;
    const x = c.x + Math.cos(a) * d;
    const y = c.y + Math.sin(a) * d * FLATTEN + Math.sin(time + i) * 6;
    ctx.fillStyle = hexA('#ffb8d0', 0.35);
    ctx.beginPath();
    ctx.ellipse(x, y, 6, 3, a, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Idle Death Gamble: a pachinko field of pegs and falling balls. */
function drawPachinkoFloor(ctx, c, r, time, spec) {
  ctx.globalCompositeOperation = 'lighter';
  const cols = 14, rows = 10;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const x = c.x + (i / (cols - 1) - 0.5) * r * 1.7;
      const y = c.y + (j / (rows - 1) - 0.5) * r * 1.7 * FLATTEN + (i % 2) * 6;
      if (Math.hypot(x - c.x, (y - c.y) / FLATTEN) > r) continue;
      ctx.fillStyle = hexA('#ffd166', 0.2);
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, TAU);
      ctx.fill();
    }
  }
  for (let i = 0; i < 24; i++) {
    const phase = (time * (0.5 + (i % 4) * 0.18) + i * 0.21) % 1;
    const x = c.x + ((i * 41) % 100 / 100 - 0.5) * r * 1.7;
    const y = c.y - r * FLATTEN + phase * r * 2 * FLATTEN;
    ctx.fillStyle = hexA('#ffffff', 0.5 * (1 - phase));
    ctx.beginPath();
    ctx.arc(x, y, 3.4, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Horizon of the Captivating Skandha: shallow water to every horizon. */
function drawTideFloor(ctx, c, r, time, spec) {
  for (let i = 0; i < 12; i++) {
    const phase = (time * 0.25 + i / 12) % 1;
    const rr = r * phase;
    ctx.strokeStyle = hexA('#6fd0e8', 0.2 * (1 - phase));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, rr, rr * FLATTEN, 0, 0, TAU);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 30; i++) {
    const a = i * 1.3 + time * 0.4;
    const d = ((i * 23) % 100) / 100 * r;
    ctx.fillStyle = hexA('#d8f8ff', 0.16);
    ctx.beginPath();
    ctx.ellipse(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d * FLATTEN, 12, 2.4, a, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawCourtFloor(ctx, c, r, time, spec) {
  ctx.strokeStyle = hexA('#cfa8ff', 0.22);
  ctx.lineWidth = 1.5;
  const n = 10;
  for (let i = -n; i <= n; i++) {
    ctx.beginPath();
    ctx.moveTo(c.x + i * (r / n), c.y - r * FLATTEN);
    ctx.lineTo(c.x + i * (r / n), c.y + r * FLATTEN);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - r, c.y + i * (r * FLATTEN / n));
    ctx.lineTo(c.x + r, c.y + i * (r * FLATTEN / n));
    ctx.stroke();
  }
}
