// Roster gallery: puts the camera close on every sorcerer and every curse
// silhouette in turn and screenshots it, so a change to the rig or to a model
// can be checked across the whole cast rather than whoever happens to spawn.
//
//   node tools/serve.mjs &   node tools/charshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/cast';
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
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
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
await page.click('[data-char="hollowSix"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-act="fight"]').catch(() => {});
await page.waitForTimeout(1500);

// Freeze the fight and pull the camera in for a portrait.
await page.evaluate(() => {
  const g = window.game;
  g.camera.baseDist = 4.2;
  g.camera.basePitch = 0.24;
  g.camera.targetZoom = 1;
  g.hud.hidden = true;
  for (const f of g.world.fighters) if (!f.isPlayer) f.pos.y -= 60;
});

const cast = await page.evaluate(async () => {
  const chars = await import('/src/data/characters.js');
  const curses = await import('/src/data/curses.js');
  return {
    sorcerers: Object.keys(chars.CHARACTERS),
    curses: Object.keys(curses.CURSES),
  };
});
console.log(`${cast.sorcerers.length} sorcerers, ${cast.curses.length} curses`);

for (const id of cast.sorcerers) {
  await page.evaluate(async (cid) => {
    const g = window.game;
    const w = g.world;
    const chars = await import('/src/data/characters.js');
    const techs = await import('/src/data/techniques.js');
    const tools = await import('/src/data/tools.js');
    const spec = chars.CHARACTERS[cid];
    const p = w.player;
    p.appearance = spec.appearance;
    p.technique = techs.TECHNIQUES[spec.technique];
    p.tool = tools.TOOLS[spec.tool];
    p.color = spec.appearance.accent || '#d9d9d9';
    p.color2 = spec.appearance.uniform || '#1a1d24';
    p.eyeColor = spec.appearance.eyes || '#ffd166';
    p.height = 1.75 * (spec.appearance.height ?? 1);
    p.name = spec.name;
    p.hp = p.maxHp;
    p.facing = -Math.PI / 2 + 0.5;
    w.over = false;
  }, id);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/sorcerer-${id}.png` });
}
console.log('  sorcerers done');

for (const id of cast.curses) {
  await page.evaluate(async (cid) => {
    const g = window.game;
    const w = g.world;
    const curses = await import('/src/data/curses.js');
    const spec = curses.CURSES[cid];
    const p = w.player;
    p.shape = spec.shape;
    p.scale = spec.scale ?? 1;
    p.color = spec.color;
    p.color2 = spec.color2;
    p.eyeColor = spec.eyeColor;
    p.height = 1.75 * (spec.scale ?? 1);
    p.radius = spec.radius ?? 0.5;
    p.name = spec.name;
    p.hp = p.maxHp;
    p.facing = -Math.PI / 2 + 0.5;
    w.over = false;
  }, id);
  await page.waitForTimeout(260);
  await page.screenshot({ path: `${OUT}/curse-${id}.png` });
}
console.log('  curses done');

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exitCode = 1;
} else {
  console.log('\nno console errors. shots in', OUT);
}
await browser.close();
