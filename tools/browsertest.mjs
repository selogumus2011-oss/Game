// Browser smoke test: loads the game, walks the menus, starts a match, plays a
// scripted sequence of inputs and screenshots each step. Fails on any console
// error or uncaught exception.
//
//   node tools/serve.mjs &   node tools/browsertest.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/shots';
await mkdir(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const IGNORE = [/fonts\.g(oogle)?apis/i, /fonts\.gstatic/i, /ERR_CONNECTION_RESET/i, /ERR_NAME_NOT_RESOLVED/i];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const text = m.text();
  // Google Fonts is blocked in this sandbox; the page has local fallbacks.
  if (IGNORE.some((re) => re.test(text))) return;
  errors.push('console: ' + text);
});
page.on('requestfailed', (r) => {
  if (!IGNORE.some((re) => re.test(r.url()))) errors.push('request failed: ' + r.url());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log('  shot', name);
};

console.log('loading', URL);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await shot('01-title');

// Menus
await page.click('[data-act="play"]');
await page.waitForTimeout(250);
await shot('02-modes');

await page.click('[data-mode="duel"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(300);
await shot('03-character');

await page.click('[data-char="hollowSix"]');
await page.waitForTimeout(250);
await shot('04-character-gojo');

await page.click('[data-char="kingOfCurses"]');
await page.waitForTimeout(200);
await page.click('[data-act="next"]');
await page.waitForTimeout(300);
await shot('05-loadout');

await page.click('[data-vow="revelation"]');
await page.click('[data-tool="playfulCloud"]');
await page.waitForTimeout(150);
await shot('06-loadout-selected');

await page.click('[data-act="fight"]');
await page.waitForTimeout(1400);
await shot('07-match-start');

// --- scripted combat -------------------------------------------------------
const canvas = await page.$('#game');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

const move = async (dx, dy) => page.mouse.move(cx + dx, cy + dy);
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };

// Approach and swing.
await move(0, -200);
await hold('w', 700);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(160);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(200);
await shot('08-melee');

// Charged heavy.
await page.mouse.down();
await page.waitForTimeout(420);
await page.mouse.up();
await page.waitForTimeout(350);
await shot('09-heavy');

// Technique 1 and 2.
await page.keyboard.press('Digit1');
await page.waitForTimeout(450);
await shot('10-technique1');
await page.keyboard.press('Digit2');
await page.waitForTimeout(500);
await shot('11-technique2');

// Dash + jump + air attack.
await hold('Shift', 80);
await page.waitForTimeout(200);
await page.keyboard.press('Space');
await page.waitForTimeout(150);
await page.mouse.down();
await page.waitForTimeout(60);
await page.mouse.up();
await page.waitForTimeout(300);
await shot('12-air');

// Block / parry.
await page.mouse.down({ button: 'right' });
await page.waitForTimeout(500);
await page.mouse.up({ button: 'right' });
await shot('13-block');

// Simple Domain.
await hold('e', 900);
await shot('14-simple-domain');

// Reverse cursed technique.
await hold('r', 900);
await shot('15-rct');

// Force a Black Flash and a Domain Expansion through the debug hooks.
await page.evaluate(() => {
  const w = window.game.world;
  const p = w.player;
  p.flow = 1;
  p.ce = p.maxCe;
  p.hp = p.maxHp;
  const e = w.fighters.find((f) => f.team !== p.team && !f.dead);
  if (e) {
    e.pos.x = p.pos.x + Math.cos(p.facing) * 1.4;
    e.pos.y = p.pos.y + Math.sin(p.facing) * 1.4;
  }
});
await page.evaluate(() => {
  const w = window.game.world;
  const p = w.player;
  const e = w.fighters.find((f) => f.team !== p.team && !f.dead);
  // Hand-open the timing window in its band so the flash is guaranteed.
  Object.assign(p.flashWindow, { active: true, dur: 0.62, start: 0.2, band: 0.2, t: 0.3 });
  w.dealDamage(p, e, { damage: 30, poise: 20, physical: true, tags: ['physical'] });
});
await page.waitForTimeout(160);
await shot('16-black-flash');
await page.waitForTimeout(700);
await shot('17-black-flash-after');

await page.evaluate(() => {
  const w = window.game.world;
  const p = w.player;
  p.flow = 1;
  p.ce = p.maxCe;
  p.domainBurnout = 0;
  p.tryDomain(w);
});
await page.waitForTimeout(1800);
await shot('18-domain-cast');
await page.waitForTimeout(1400);
await shot('19-domain-open');

// Enemy inside the domain, player defends with Simple Domain.
await page.keyboard.down('e');
await page.waitForTimeout(900);
await shot('20-domain-simple');
await page.keyboard.up('e');

// Pause + codex.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot('21-pause');
await page.click('[data-act="codex"]');
await page.waitForTimeout(300);
await shot('22-codex');
await page.click('[data-tab="domains"]');
await page.waitForTimeout(250);
await shot('23-codex-domains');
await page.click('[data-tab="techniques"]');
await page.waitForTimeout(250);
await shot('24-codex-techniques');
await page.click('[data-act="back"]');
await page.waitForTimeout(200);
await page.click('[data-act="resume"]');
await page.waitForTimeout(400);

// Let the fight run on its own for a while to shake out AI/runtime errors.
await page.keyboard.down('w');
for (let i = 0; i < 14; i++) {
  await page.mouse.down();
  await page.waitForTimeout(70);
  await page.mouse.up();
  await page.waitForTimeout(220);
}
await page.keyboard.up('w');
await page.waitForTimeout(1500);
await shot('25-fight');

const stats = await page.evaluate(() => {
  const w = window.game.world;
  return {
    fps: Math.round(window.game.loop.fps),
    fighters: w.fighters.length,
    particles: window.game.effects.particles.length,
    projectiles: w.projectiles.length,
    playerHp: Math.round(w.player.hp),
    enemyCount: w.fighters.filter((f) => f.team !== w.player.team && !f.dead).length,
    over: w.over,
  };
});
console.log('  state', JSON.stringify(stats));

// Gauntlet mode run.
await page.evaluate(() => window.game.quitToMenu());
await page.waitForTimeout(300);
await page.click('[data-act="play"]');
await page.click('[data-mode="gauntlet"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-char="shadowHeir"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-act="fight"]');
await page.waitForTimeout(5000);
await shot('26-gauntlet');

// Culling game run.
await page.evaluate(() => window.game.quitToMenu());
await page.waitForTimeout(300);
await page.click('[data-act="play"]');
await page.click('[data-mode="culling"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-char="zeroPresence"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-act="fight"]');
await page.waitForTimeout(6000);
await shot('27-culling');

const fps2 = await page.evaluate(() => Math.round(window.game.loop.fps));
console.log('  culling fps', fps2);

await browser.close();

if (errors.length) {
  console.log('\nERRORS:');
  for (const e of errors.slice(0, 12)) console.log(' -', e);
  process.exit(1);
}
console.log('\nno console errors. shots in', OUT);
