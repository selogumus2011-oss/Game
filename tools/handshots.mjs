// Renders each hand shape on its own, large, from two angles. Hand geometry is
// small and fiddly and a bug in it is invisible at gameplay scale, so this
// draws them big enough to actually check the fingers curl the right way.
//
//   node tools/serve.mjs &   node tools/handshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/hands';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 820 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'domcontentloaded' });

const result = await page.evaluate(async () => {
  const { handMesh, SIGN_SHAPES } = await import('/src/r3d/hands3.js');
  const { Camera3, matCompose } = await import('/src/r3d/core3.js');
  const { DrawList } = await import('/src/r3d/core3.js');
  const { drawMesh, drawOutline } = await import('/src/r3d/geom3.js');

  const shapes = Object.keys(SIGN_SHAPES);
  const canvas = document.createElement('canvas');
  canvas.width = 1200; canvas.height = 820;
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#12141a';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, 1200, 820);

  const cols = 4;
  const cellW = 1200 / cols;
  const cellH = 820 / Math.ceil((shapes.length * 2) / cols);
  const counts = {};
  let i = 0;
  for (const shape of shapes) {
    for (const [side, label] of [[1, 'L'], [-1, 'R']]) {
      const cx = (i % cols) * cellW;
      const cy = Math.floor(i / cols) * cellH;
      const cam = new Camera3();
      cam.resize(cellW, cellH);
      // Look down at the hand from the front-and-above, the angle you would
      // see your own hands from.
      // Frame the whole hand, not the origin — the wrist is at 0 and the
      // fingertips reach x = 1.1.
      cam.lookAt = { x: 0.46, y: 0, z: 0 };
      cam.yaw = 0.7; cam.pitch = 0.5; cam.dist = 1.7;
      cam.commit();
      const dl = new DrawList();
      const mesh = handMesh(shape, '#e9c8ac', side);
      counts[shape + label] = mesh.nf;
      const m = matCompose(0, 0, 0, 0, 0, 0, 1, 1, 1);
      const S = { light: { x: -0.3, y: -0.4, z: -0.86 }, ambient: 0.66, key: 0.5, alpha: 1 };
      drawMesh(dl, cam, mesh, m, S);
      drawOutline(dl, cam, mesh, m, 1, [10, 10, 14], 2.2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.beginPath(); ctx.rect(0, 0, cellW, cellH); ctx.clip();
      dl.flush(ctx);
      ctx.fillStyle = '#8ad8ff';
      ctx.font = '700 15px system-ui';
      ctx.fillText(`${shape} ${label}  (${mesh.nf} tris)`, 12, 22);
      ctx.restore();
      i++;
    }
  }
  return counts;
});

await page.screenshot({ path: `${OUT}/shapes.png` });
console.log('  tri counts', JSON.stringify(result));
for (const e of errors) console.log('  ERROR', e);
console.log('shots in ' + OUT);
await browser.close();
process.exit(errors.length ? 1 : 0);
