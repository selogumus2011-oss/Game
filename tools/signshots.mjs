// Hand signs, checked at a pinned frame.
//
// A sign only exists for the length of a cast, and the follow camera swings
// during a domain, so catching one live is hopeless. This stops the app loop,
// winds a cast to a chosen point, plants the camera in front of the caster and
// draws exactly one frame.
//
//   node tools/serve.mjs &   node tools/signshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/signs';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 900, height: 760 } });
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
await page.click('[data-char="kingOfCurses"]');
await page.waitForTimeout(150);
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-act="fight"]');
await page.waitForTimeout(1500);

// Take the stage: stop the loop, clear the extras, drop the HUD and cutscene.
await page.evaluate(() => {
  const g = window.game;
  g.loop.stop();
  g.cinematic.enabled = false;
  g.hud.hidden = true;
  g.renderer3d.settings.showNames = false;
  for (const f of g.world.fighters) if (f !== g.world.player) f.dead = true;
  const p = g.world.player;
  p.aim = Math.PI / 2;      // face the camera, which sits at -y
  p.facing = Math.PI / 2;
});

/**
 * Plant the camera and draw one frame. `fpv` puts the eye in the caster's head
 * instead, which is the view the hands were raised for in the first place.
 */
const frame = (fpv = false) => page.evaluate((fpv) => {
  const g = window.game;
  const c = g.camera3d;
  const p = g.world.player;
  c.cine = 0;
  c.override = null;
  if (fpv) {
    c.fpv = 1; c.fpvTarget = 1; c.fpvYaw = p.aim; c.fpvPitch = 0.20;
    // First person derives the eye inside update(); dt = 0 runs the placement
    // without advancing anything.
    c.update(0, g.world, p, g.input);
  } else {
    c.fpv = 0; c.fpvTarget = 0;
    c.yaw = -Math.PI / 2; c.pitch = 0.08; c.dist = 2.3;
    c.lookAt.x = p.pos.x; c.lookAt.y = p.pos.y; c.lookAt.z = 1.35;
    c.commit();
  }
  g.renderer3d.render(g.world, c, g.effects, 1 / 60);
}, fpv);

const castAt = (slot, frac) => page.evaluate(([slot, frac]) => {
  const g = window.game;
  const p = g.world.player;
  p.cast = null; p.domainCast = null; p.state = 'idle';
  p.ce = p.maxCe;
  for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
  if (!p.tryAbility(slot, g.world) || !p.cast) return null;
  const ct = Math.max(0.05, p.cast.ability.castTime || 0.2);
  p.cast.t = ct * frac;
  return { name: p.cast.ability.name, sign: p.cast.ability.sign || '(inferred)' };
}, [slot, frac]);

const domainAt = (frac) => page.evaluate((frac) => {
  const g = window.game;
  const p = g.world.player;
  p.cast = null; p.domainCast = null; p.state = 'idle';
  p.ce = p.maxCe; p.flow = 1;
  if (!p.tryDomain(g.world) || !p.domainCast) return null;
  p.domainCast.t = p.domainCast.dur * frac;
  return { name: p.domainCast.spec.name };
}, frac);

const report = [];
for (let slot = 0; slot < 4; slot++) {
  const info = await castAt(slot, 0.75);
  if (!info) { report.push(`slot ${slot}: refused`); continue; }
  await frame(false);
  await page.screenshot({ path: `${OUT}/tech${slot}-third.png` });
  await castAt(slot, 0.75);
  await frame(true);
  await page.screenshot({ path: `${OUT}/tech${slot}-first.png` });
  report.push(`slot ${slot}: ${info.name} — sign ${info.sign}`);
}

const dom = await domainAt(0.6);
if (dom) {
  await frame(false);
  await page.screenshot({ path: `${OUT}/domain-third.png` });
  await domainAt(0.6);
  await frame(true);
  await page.screenshot({ path: `${OUT}/domain-first.png` });
  report.push(`domain: ${dom.name} — always signs`);
} else {
  report.push('domain: refused');
}

for (const r of report) console.log('  ' + r);
for (const e of errors) console.log('  ERROR', e);
console.log('shots in ' + OUT);
await browser.close();
process.exit(errors.length ? 1 : 0);
