// A fixed set of framings for judging the art direction.
//
// Every other harness shoots whatever the game happened to be doing. This one
// pins the camera, the pose and the lighting so two runs are comparable — which
// is the only way to tell whether a change to the shading actually improved
// anything or just moved it around.
//
//   node tools/serve.mjs &   node tools/lookshots.mjs [outdir]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.argv[2] || process.env.OUT || '/tmp/claude-0/look';
await mkdir(OUT, { recursive: true });

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

await page.evaluate(() => {
  const g = window.game;
  g.loop.stop();
  g.hud.hidden = true;
  g.cinematic.enabled = false;
  g.renderer3d.settings.showNames = false;
  // This container renders at about 28fps, which trips the adaptive quality
  // tier. Judging the art direction through a performance fallback is
  // meaningless, so pin it to full.
  g.renderer3d.quality = 1;
  g.renderer3d._fpsAvg = 60;
  g.renderer3d.q.outlines = true;
  g.renderer3d.q.inkScale = 1;
  g.renderer3d.q.detail = 2;
});

/** Plant the camera, hold a pose, draw one frame. */
const frame = (opts) => page.evaluate((o) => {
  const g = window.game;
  const w = g.world;
  const p = w.player;
  const foe = w.fighters.find((f) => f !== p && !f.dead && !f.isSummon);

  p.pos.x = 0; p.pos.y = 0; p.z = 0;
  p.facing = o.facing ?? Math.PI / 2;
  p.aim = p.facing;
  p.vel.x = 0; p.vel.y = 0;
  p.state = o.state || 'idle';
  p.action = null; p.cast = null; p.domainCast = null;
  // The loop is stopped, so anything driven by elapsed time is frozen wherever
  // it happened to be — including the hit flash, which starts at zero and
  // would otherwise tint every shot red.
  p.timeSinceHit = 9; p.statuses.length = 0; p.amplify = null;
  if (o.action) {
    p.startAction(o.action);
    if (p.action) p.action.t = (p.action.def.startup || 0.1) * (o.actionAt ?? 1.0);
    p.state = 'attack';
  }
  if (foe) {
    foe.pos.x = o.foeX ?? 2.2; foe.pos.y = o.foeY ?? 0.4; foe.z = 0;
    foe.facing = -Math.PI / 2; foe.state = 'idle'; foe.action = null;
    foe.vel.x = 0; foe.vel.y = 0;
    foe.timeSinceHit = 9; foe.statuses.length = 0; foe.amplify = null;
  }

  // Whatever the fight was doing when the loop stopped is still on screen;
  // a lattice of cuts across the frame makes the model impossible to judge.
  g.effects.clear();

  const c = g.camera3d;
  c.cine = 0; c.override = null; c.fpv = 0; c.fpvTarget = 0; c.trauma = 0;
  c.shake.x = c.shake.y = c.shake.z = 0; c.roll = 0;
  c.yaw = o.yaw; c.pitch = o.pitch; c.dist = o.dist;
  c.lookAt.x = o.lx ?? 0; c.lookAt.y = o.ly ?? 0; c.lookAt.z = o.lz ?? 1.2;
  c.commit();
  g.renderer3d.render(w, c, g.effects, 1 / 60);
}, opts);

const shots = [
  ['01-wide', { yaw: -Math.PI / 2, pitch: 0.34, dist: 13, lz: 1.4 }],
  ['02-mid', { yaw: -Math.PI / 2 + 0.5, pitch: 0.16, dist: 6, lz: 1.3 }],
  ['03-close', { yaw: -Math.PI / 2 + 0.9, pitch: 0.06, dist: 2.6, lz: 1.5 }],
  ['04-face', { yaw: Math.PI / 2, pitch: 0.05, dist: 1.9, lz: 1.62, facing: -Math.PI / 2 }],
  ['05-swing', { yaw: -Math.PI / 2 + 0.7, pitch: 0.1, dist: 3.4, lz: 1.35, action: 'heavy', actionAt: 1.0 }],
  ['06-low', { yaw: -Math.PI / 2 + 0.3, pitch: -0.14, dist: 4.2, lz: 1.0 }],
];

for (const [name, o] of shots) {
  await frame(o);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot', name);
}

for (const e of errors) console.log('  ERROR', e);
console.log('shots in ' + OUT);
await browser.close();
process.exit(errors.length ? 1 : 0);
