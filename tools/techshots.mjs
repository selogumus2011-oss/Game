// Technique gallery: fires every ability of a technique and screenshots it a
// few frames into the effect, so a change to a slash or a projectile can be
// checked without landing the input by hand.
//
//   node tools/serve.mjs &   node tools/techshots.mjs [techniqueId]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/tech';
const TECH = process.argv[2] || process.env.TECH || 'shrine';
const FRAMES = (process.env.FRAMES || '200,300,430').split(',').map(Number);
await mkdir(OUT, { recursive: true });

const errors = [];
const IGNORE = [
  /fonts\.g(oogle)?apis/i, /fonts\.gstatic/i, /ERR_CONNECTION_RESET/i,
  /ERR_CERT_AUTHORITY_INVALID/i, /ERR_NAME_NOT_RESOLVED/i,
];
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) {
    errors.push('console: ' + m.text());
  }
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('[data-act="play"]');
await page.click('[data-mode="duel"]');
await page.click('[data-act="next"]');
await page.click('[data-char="kingOfCurses"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-act="fight"]').catch(() => {});
await page.waitForTimeout(1600);

const abilities = await page.evaluate(async (tid) => {
  const g = window.game;
  const mod = await import('/src/data/techniques.js');
  const tech = mod.TECHNIQUES[tid];
  const p = g.world.player;
  p.technique = tech;
  g.hud.hidden = true;
  return tech.abilities.map((a) => ({ id: a.id, name: a.name }));
}, TECH);
console.log(`${TECH}: ${abilities.length} abilities`);

for (let i = 0; i < abilities.length; i++) {
  await page.evaluate((idx) => {
    const g = window.game;
    const w = g.world;
    const p = w.player;
    // Reset the fight, put a target in front, and fire.
    w.over = false;
    for (const f of w.fighters) {
      f.dead = false; f.deathTime = 0;
      f.hp = f.maxHp; f.ce = f.maxCe; f.state = 'idle';
      if (!f.isPlayer) { f.pos.x = 0; f.pos.y = -7; w.controllers.delete(f.id); }
    }
    p.pos.x = 0; p.pos.y = 0;
    p.facing = -Math.PI / 2;
    p.aim = -Math.PI / 2;
    p.flow = 1;
    p.cooldowns = {};
    p.state = 'idle';
    g.camera.snapTo(0, -3);
    p.tryAbility(idx, w);
  }, i);
  // Three frames across the effect: the wind-up, the strike, and the follow.
  let prev = 0;
  for (const at of FRAMES) {
    await page.waitForTimeout(Math.max(0, at - prev));
    prev = at;
    await page.screenshot({ path: `${OUT}/${TECH}-${i}-${abilities[i].id}-${at}ms.png` });
  }
  console.log('  shot', abilities[i].name);
  await page.waitForTimeout(700);
}

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exitCode = 1;
} else {
  console.log('\nno console errors. shots in', OUT);
}
await browser.close();
