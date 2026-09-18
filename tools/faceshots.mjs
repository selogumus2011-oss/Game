// The face textures on their own, at size.
//
// A face painted into a texture can be judged before any of it is wired into a
// renderer, which is the only sensible order: if the drawing is wrong, no
// amount of correct plumbing saves it. This renders every character's face
// texture onto a sheet, over a block of their own skin tone so the line work is
// read against what it will actually sit on.
//
//   node tools/serve.mjs &   node tools/faceshots.mjs [outdir]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.argv[2] || process.env.OUT || '/tmp/claude-0/faces';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const info = await page.evaluate(async () => {
  const { faceTexture } = await import('/src/r3d/face3.js');
  const { CHARACTERS } = await import('/src/data/characters.js');
  const ids = Object.keys(CHARACTERS);

  const CELL = 200, COLS = 6, LABEL = 20;
  const rows = Math.ceil(ids.length / COLS);
  const c = document.createElement('canvas');
  c.id = 'sheet';
  c.width = COLS * CELL;
  c.height = rows * (CELL + LABEL);
  const x = c.getContext('2d');
  x.fillStyle = '#141018';
  x.fillRect(0, 0, c.width, c.height);
  x.textAlign = 'center';
  x.font = '600 11px system-ui, sans-serif';

  ids.forEach((id, i) => {
    const a = CHARACTERS[id].appearance || {};
    const cx = (i % COLS) * CELL;
    const cy = Math.floor(i / COLS) * (CELL + LABEL);
    // The skin the face will actually sit on, so the line work is judged
    // against its real ground rather than against a checkerboard.
    x.fillStyle = a.skin || '#e9c8ac';
    x.fillRect(cx + 6, cy + 6, CELL - 12, CELL - 12);
    x.drawImage(faceTexture(a), cx + 6, cy + 6, CELL - 12, CELL - 12);
    x.fillStyle = 'rgba(255,255,255,0.75)';
    x.fillText(id, cx + CELL / 2, cy + CELL + 13);
  });

  document.body.innerHTML = '';
  document.body.style.margin = '0';
  document.body.appendChild(c);
  return { n: ids.length, width: c.width, height: c.height };
});

await page.setViewportSize({
  width: Math.min(2000, info.width), height: Math.min(4000, info.height),
});
const el = await page.$('#sheet');
await el.screenshot({ path: `${OUT}/faces.png` });

for (const e of errors) console.log('  ERROR', e);
console.log(`${info.n} faces, sheet in ${OUT}/faces.png`);
await browser.close();
process.exit(errors.length ? 1 : 0);
