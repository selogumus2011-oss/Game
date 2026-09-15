// The frame's value structure, measured.
//
// "Looks like the anime" is mostly composition, and the composition rule that
// matters most is the value order: in a cel-animated night exterior the
// character is the highest-contrast thing on screen and the background is held
// back behind them. Backgrounds are painted flat and deliberately quiet;
// characters are lit separately and harder.
//
// That is checkable. This plants a camera on a known pose, reads the real
// canvas back, and reports mean luminance for the sky, the ground, the set
// dressing and the figure. Eyeballing a dark frame is exactly the thing eyes
// are worst at — a large field of one tone reads as brighter than it is, which
// is how the cast ended up two and a half times darker than the floor without
// anybody noticing.
//
//   node tools/serve.mjs &   node tools/valuetest.mjs

import { chromium } from 'playwright';

// Pinned so two runs frame the same arena: the prop layout comes out of
// the match seed, and a wall that moves between runs moves the numbers.
const URL = process.env.URL || 'http://localhost:8080/?seed=20250915';

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
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
await page.click('[data-mode="duel"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-char="kingOfCurses"]');
await page.waitForTimeout(150);
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-act="fight"]');
await page.waitForTimeout(1800);

const v = await page.evaluate(() => {
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

  const w = g.world;
  const pl = w.player;
  pl.pos.x = 0; pl.pos.y = 0; pl.z = 0;
  pl.facing = -Math.PI / 2; pl.aim = pl.facing;
  pl.vel.x = 0; pl.vel.y = 0;
  pl.state = 'idle'; pl.action = null; pl.cast = null; pl.domainCast = null;
  pl.timeSinceHit = 9; pl.statuses.length = 0; pl.amplify = null;
  for (const f of w.fighters) if (f !== pl) f.dead = true;
  g.effects.clear();

  const c = g.camera3d;
  c.cine = 0; c.override = null; c.fpv = 0; c.fpvTarget = 0; c.trauma = 0;
  c.shake.x = c.shake.y = c.shake.z = 0; c.roll = 0;
  c.yaw = Math.PI / 2; c.pitch = 0.16; c.dist = 5.5;
  c.lookAt.x = 0; c.lookAt.y = 0; c.lookAt.z = 1.1;
  c.commit();
  g.renderer3d.render(w, c, g.effects, 1 / 60);

  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const lum = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.round(x0)); y0 = Math.max(0, Math.round(y0));
    x1 = Math.min(W, Math.round(x1)); y1 = Math.min(H, Math.round(y1));
    if (x1 <= x0 || y1 <= y0) return 0;
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++; }
    return +(s / n).toFixed(1);
  };

  const chest = c.project(pl.pos.x, pl.pos.y, 1.15);
  const head = c.project(pl.pos.x, pl.pos.y, 1.62);
  const span = Math.abs(head.y - chest.y) || 40;
  return {
    sky: lum(W * 0.1, H * 0.03, W * 0.3, H * 0.1),
    ground: lum(W * 0.06, H * 0.82, W * 0.3, H * 0.96),
    props: lum(W * 0.8, H * 0.3, W * 0.95, H * 0.45),
    // Kept well inside the silhouette. A box wider than the torso samples the
    // background either side of it and reports the background.
    torso: lum(chest.x - span * 0.28, chest.y - span * 0.15, chest.x + span * 0.28, chest.y + span * 0.45),
    // Below the eye line: above it is fringe, and sampling hair tells you
    // nothing about whether the face reads.
    face: lum(head.x - span * 0.3, head.y + span * 0.02, head.x + span * 0.3, head.y + span * 0.34),
  };
});

const checks = [];
const ok = (n, c, e = '') => checks.push([n, c, e]);

console.log('  luminance out of 255');
for (const [k, n] of Object.entries(v)) console.log(`    ${k.padEnd(8)} ${n}`);
console.log('');

ok('the figure reads lighter than the ground it stands on',
   v.torso > v.ground * 1.15, `torso ${v.torso} vs ground ${v.ground}`);
ok('the set dressing sits behind the figure',
   v.props < v.torso, `props ${v.props} vs torso ${v.torso}`);
ok('the face is the brightest thing on the character',
   v.face > v.torso, `face ${v.face} vs torso ${v.torso}`);
ok('the frame is not washed out', v.ground < 70, `ground ${v.ground}`);
ok('nor is it mud', v.torso > 26, `torso ${v.torso}`);

let fail = 0;
for (const [n, c, e] of checks) {
  if (c) console.log('  ok  ', n);
  else { fail++; console.log('  FAIL', n, e); }
}
for (const e of errors) console.log('  ERROR', e);
console.log(`\n${checks.length - fail} passed, ${fail} failed`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
