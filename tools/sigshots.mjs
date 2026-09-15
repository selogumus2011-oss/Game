// One frame of each technique signature, side by side.
//
// The point of the signature table is that two techniques should not look the
// same. That is only checkable by looking, so this fires each archetype at a
// fixed point with the loop stopped, lets it run a fixed number of frames, and
// shoots it. It also asserts the cheap half: that every technique in the game
// resolves to a signature, and that they are not all the same one.
//
//   node tools/serve.mjs &   node tools/sigshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/sigs';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
const IGNORE = [/fonts\.g(oogle)?apis/i, /fonts\.gstatic/i, /ERR_/i];
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(e.message + '\n' + (e.stack || '')));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// --- the cheap half: every technique resolves, and not all to the same thing.
const coverage = await page.evaluate(async () => {
  const { TECHNIQUES } = await import('/src/data/techniques.js');
  const { signatureFor, ARCHETYPES } = await import('/src/render/signatures.js');
  const rows = [];
  const seen = {};
  for (const [id, t] of Object.entries(TECHNIQUES)) {
    const sig = signatureFor({ techniqueId: id });
    rows.push({ id, name: t.name, arch: sig.arch, impact: sig.impact });
    seen[sig.arch] = (seen[sig.arch] || 0) + 1;
  }
  return { rows, seen, archCount: Object.keys(ARCHETYPES).length };
});

const checks = [];
const ok = (n, c, e = '') => checks.push([n, c, e]);
ok('every technique resolves to a signature',
   coverage.rows.every((r) => r.arch && r.impact > 0));
ok('they do not all share one archetype',
   Object.keys(coverage.seen).length >= 6,
   `${Object.keys(coverage.seen).length} distinct: ${JSON.stringify(coverage.seen)}`);
ok('an unknown technique still gets one',
   await page.evaluate(async () => {
     const { signatureFor } = await import('/src/render/signatures.js');
     const s = signatureFor({ techniqueId: 'nothingLikeThis', kind: 'beam' });
     return !!s.arch && s.impact > 0;
   }));

// --- the half that needs eyes -----------------------------------------------
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

await page.evaluate(() => {
  const g = window.game;
  g.loop.stop();
  g.hud.hidden = true;
  g.renderer3d.settings.showNames = false;
  for (const f of g.world.fighters) if (f !== g.world.player) f.dead = true;
});

const archetypes = await page.evaluate(async () => {
  const { ARCHETYPES } = await import('/src/render/signatures.js');
  return Object.keys(ARCHETYPES);
});

for (const arch of archetypes) {
  await page.evaluate((arch) => {
    const g = window.game;
    g.effects.clear();
    const p = g.world.player;
    // Stage the effect well clear of the caster: a ground-level archetype
    // fired at their feet is simply hidden behind them.
    p.pos.x = 40; p.pos.y = 40;
    const at = { x: 0, y: 0, z: 1.3 };
    // Colour held constant across all of them on purpose: if two archetypes
    // only differ by hue, this shot makes that obvious.
    g.effects.archetype(arch, at, '#ff8a3c', 0.9, -Math.PI / 2);
    g.effects.impact(0.7, '#ff8a3c', false, 0.3, at, false);
    const c = g.camera3d;
    c.cine = 0; c.override = null; c.fpv = 0; c.fpvTarget = 0;
    c.yaw = -Math.PI / 2; c.pitch = 0.22; c.dist = 7;
    c.lookAt.x = at.x; c.lookAt.y = at.y; c.lookAt.z = 1.2;
    c.commit();
  }, arch);
  // Let the effect develop a few frames before the shot.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const g = window.game;
      g.effects.update(1 / 60);
      g.renderer3d.render(g.world, g.camera3d, g.effects, 1 / 60);
    });
  }
  await page.screenshot({ path: `${OUT}/arch-${arch}.png` });
  console.log('  shot', arch);
}

console.log('');
for (const r of coverage.rows) console.log(`  ${r.id.padEnd(22)} ${r.arch}`);
console.log('');
let fail = 0;
for (const [n, c, e] of checks) {
  if (c) console.log('  ok  ', n);
  else { fail++; console.log('  FAIL', n, e); }
}
for (const e of errors) console.log('  ERROR', e);
console.log(`\n${checks.length - fail} passed, ${fail} failed, ${errors.length} console errors`);
console.log('shots in ' + OUT);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
