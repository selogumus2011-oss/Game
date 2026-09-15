// Every face in the cast, at the same two framings.
//
// The look harness shoots one character, and one character is how a model fix
// gets declared done while the other twenty still have a flat lid of hair or a
// jaw that stops in mid-air. This swaps the player's appearance through the
// whole roster from a single pinned camera, so a change to the head, the hair
// or the proportions can be judged across every hairstyle and build at once
// rather than on whoever the menu happened to select.
//
//   node tools/serve.mjs &   node tools/castsheet.mjs [outdir]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/?seed=20250915';
const OUT = process.argv[2] || process.env.OUT || '/tmp/claude-0/cast-sheet';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const errors = [];
const IGNORE = [/fonts\.g(oogle)?apis/i, /fonts\.gstatic/i, /ERR_/i];
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '')));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('[data-act="play"]');
await page.waitForTimeout(200);
await page.click('[data-mode="training"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-act="fight"]');
await page.waitForTimeout(1800);

const roster = await page.evaluate(async () => {
  const g = window.game;
  g.loop.stop();
  g.hud.hidden = true;
  g.cinematic.enabled = false;
  g.renderer3d.settings.showNames = false;
  g.renderer3d.quality = 1;
  g.renderer3d._fpsAvg = 60;
  g.renderer3d.q.outlines = true;
  g.renderer3d.q.inkScale = 1;
  g.renderer3d.q.detail = 2;
  // Nobody else in frame. Killing them is not enough — a body still draws —
  // so they go over the horizon.
  for (const f of g.world.fighters) {
    if (f === g.world.player) continue;
    f.dead = true;
    f.pos.x = 900; f.pos.y = 900;
  }
  for (const pr of g.world.props) pr.pos.x += 900;
  g.effects.clear();
  const mod = await import('/src/data/characters.js');
  window.__chars = mod.CHARACTERS;
  return Object.keys(mod.CHARACTERS);
});

/** Wear a character, plant the camera, draw one frame. */
const frame = (id, o) => page.evaluate(([id, o]) => {
  const g = window.game;
  const p = g.world.player;
  const spec = window.__chars[id];
  p.appearance = spec.appearance || {};
  p.name = spec.name || id;

  p.pos.x = 0; p.pos.y = 0; p.z = 0;
  p.facing = o.facing ?? Math.PI / 2;
  p.aim = p.facing;
  p.vel.x = 0; p.vel.y = 0;
  p.state = 'idle';
  p.action = null; p.cast = null; p.domainCast = null;
  p.timeSinceHit = 9; p.statuses.length = 0; p.amplify = null;
  g.effects.clear();

  const c = g.camera3d;
  c.cine = 0; c.override = null; c.fpv = 0; c.fpvTarget = 0; c.trauma = 0;
  c.shake.x = c.shake.y = c.shake.z = 0; c.roll = 0;
  c.yaw = o.yaw; c.pitch = o.pitch; c.dist = o.dist;
  c.lookAt.x = 0; c.lookAt.y = 0; c.lookAt.z = o.lz;
  c.commit();
  g.renderer3d.render(g.world, c, g.effects, 1 / 60);
}, [id, o]);

const SHOTS = [
  // What the game actually shows you, and then close enough to read a face.
  ['body', { yaw: -Math.PI / 2 + 0.45, pitch: 0.14, dist: 4.4, lz: 1.1,
             crop: [0.37, 0.04, 0.26, 0.86] }],
  ['head', { yaw: Math.PI / 2 - 0.5, pitch: 0.03, dist: 1.7, lz: 1.63, facing: -Math.PI / 2,
             crop: [0.40, 0.10, 0.20, 0.52] }],
];

// Each frame is also kept as a data URL so the run can end with a single
// contact sheet. Twenty-three separate files is twenty-three separate looks,
// and the whole point is to compare them.
const grabbed = { body: [], head: [] };

for (const id of roster) {
  for (const [name, o] of SHOTS) {
    await frame(id, o);
    await page.screenshot({ path: `${OUT}/${id}-${name}.png` });
    grabbed[name].push([id, await page.evaluate((crop) => {
      // Crop to the figure. The rest of the frame is arena, and at six
      // cells across a sheet has no pixels to spare on it.
      const cv = document.getElementById('game');
      const c = document.createElement('canvas');
      c.width = Math.round(cv.width * crop[2]);
      c.height = Math.round(cv.height * crop[3]);
      c.getContext('2d').drawImage(cv, Math.round(cv.width * crop[0]),
        Math.round(cv.height * crop[1]), c.width, c.height, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }, o.crop)]);
  }
  console.log('  ', id);
}

for (const [kind, shots] of Object.entries(grabbed)) {
  await page.evaluate(async ([shots, cols]) => {
    const imgs = await Promise.all(shots.map(([, src]) => new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.src = src;
    })));
    const cw = 240;
    const ch = Math.round(cw * imgs[0].height / imgs[0].width);
    const rows = Math.ceil(imgs.length / cols);
    const c = document.createElement('canvas');
    c.width = cols * cw;
    c.height = rows * (ch + 18);
    c.id = 'sheet';
    const x = c.getContext('2d');
    x.fillStyle = '#0a0b12';
    x.fillRect(0, 0, c.width, c.height);
    x.font = '600 11px system-ui, sans-serif';
    x.textAlign = 'center';
    for (let i = 0; i < imgs.length; i++) {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * (ch + 18);
      x.drawImage(imgs[i], cx, cy, cw, ch);
      x.fillStyle = 'rgba(255,255,255,0.75)';
      x.fillText(shots[i][0], cx + cw / 2, cy + ch + 13);
    }
    document.body.innerHTML = '';
    document.body.style.margin = '0';
    document.body.appendChild(c);
  }, [shots, 6]);
  // The sheet is taller and wider than the play window, and an element
  // screenshot still clips to the viewport, so grow it to fit first.
  const size = await page.evaluate(() => {
    const c = document.getElementById('sheet');
    return { width: c.width, height: c.height };
  });
  await page.setViewportSize({ width: Math.min(2000, size.width), height: Math.min(4000, size.height) });
  const el = await page.$('#sheet');
  await el.screenshot({ path: `${OUT}/sheet-${kind}.png` });
  await page.setViewportSize({ width: 900, height: 700 });
  console.log('  sheet', kind);
}

for (const e of errors) console.log('  ERROR', e);
console.log(`${roster.length} characters, shots in ${OUT}`);
await browser.close();
process.exit(errors.length ? 1 : 0);
