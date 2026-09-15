// Films a domain expansion cutscene: triggers the chant, then screenshots the
// sequence at a fixed cadence so every beat can be checked as a strip.
//
//   node tools/serve.mjs &   node tools/cutscene.mjs [characterId]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/cutscene';
const CHAR = process.argv[2] || process.env.CHAR || 'hollowSix';
const EVERY = Number(process.env.EVERY || 170);   // ms between frames
const COUNT = Number(process.env.COUNT || 14);
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
const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) {
    errors.push('console: ' + m.text());
  }
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.click('[data-act="play"]');
await page.click('[data-mode="duel"]');
await page.click('[data-act="next"]');
await page.click(`[data-char="${CHAR}"]`);
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-act="fight"]').catch(() => {});
await page.waitForTimeout(1800);

const name = await page.evaluate(() => {
  const g = window.game, w = g.world, p = w.player;
  // Clear the opening cards, stand the opponent up in front, and arm the domain.
  g.hud.vs = null;
  g.hud.controlsFade = 0;
  w.over = false;
  for (const f of w.fighters) {
    f.dead = false; f.deathTime = 0; f.hp = f.maxHp; f.ce = f.maxCe; f.state = 'idle';
    if (!f.isPlayer) { f.pos.x = 2.5; f.pos.y = -6; w.controllers.delete(f.id); }
  }
  p.pos.x = 0; p.pos.y = 0;
  p.facing = -Math.PI / 2; p.aim = -Math.PI / 2;
  p.flow = 1; p.ce = p.maxCe; p.domainBurnout = 0; p.cooldowns = {};
  p.tryDomain(w);
  return p.domainSpec()?.name || '?';
});
console.log(`${CHAR} — ${name}`);

// A screenshot in this container costs longer than a frame, so the wall clock
// is useless as a label. Ask the page where the cutscene actually is instead.
for (let i = 0; i < COUNT; i++) {
  const t = await page.evaluate(() => {
    const c = window.game.cinematic.active;
    return c ? c.t : -1;
  });
  const label = t < 0 ? 'after' : String(Math.round(t * 1000)).padStart(4, '0') + 'ms';
  await page.screenshot({ path: `${OUT}/${CHAR}-${String(i).padStart(2, '0')}-${label}.png` });
  if (t >= 0) console.log(`  frame ${i}  t=${t.toFixed(2)}s`);
  else console.log(`  frame ${i}  (cutscene over)`);
  await page.waitForTimeout(EVERY);
}

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exitCode = 1;
} else {
  console.log('\nno console errors. shots in', OUT);
}
await browser.close();
