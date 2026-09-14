// Touch smoke test: loads the game in an iPad-sized touch viewport, drives it
// entirely with touch events, and asserts that the on-screen controls actually
// moved the player and fired a technique.
//
//   node tools/serve.mjs &   node tools/touchtest.mjs

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/touch';
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
// iPad Pro 11" in landscape, with touch on and no mouse.
const context = await browser.newContext({
  viewport: { width: 1194, height: 834 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await context.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) {
    errors.push('console: ' + m.text());
  }
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));

const fail = (msg) => { errors.push('ASSERT: ' + msg); console.error('  FAIL', msg); };
const ok = (msg) => console.log('  ok  ', msg);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/01-title.png` });

// The menus must be reachable by tap alone.
await page.tap('[data-act="play"]');
await page.tap('[data-mode="duel"]');
await page.tap('[data-act="next"]');
await page.tap('[data-char="kingOfCurses"]');
await page.tap('[data-act="next"]');
await page.waitForTimeout(250);
await page.tap('[data-act="fight"]').catch(() => {});
await page.waitForTimeout(1800);
await page.screenshot({ path: `${OUT}/02-match.png` });

const started = await page.evaluate(() => !!(window.game && window.game.world));
if (!started) fail('match did not start from taps'); else ok('menus drive by tap');

// --- movement stick -------------------------------------------------------
const before = await page.evaluate(() => {
  const p = window.game.world.player;
  return { x: p.pos.x, y: p.pos.y };
});
// Drag from the left half: the stick appears wherever the thumb lands.
await page.touchscreen.tap(300, 600);           // wake the control layer
await page.waitForTimeout(80);
const t = page.touchscreen;
await page.evaluate(() => {
  // Playwright's touchscreen has tap only, so drive a real drag by hand.
  const c = document.getElementById('game');
  const mk = (type, x, y) => {
    const touch = new Touch({ identifier: 1, target: c, clientX: x, clientY: y });
    c.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [touch],
      targetTouches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch], bubbles: true, cancelable: true,
    }));
  };
  window.__drag = mk;
  mk('touchstart', 300, 600);
});
for (let i = 0; i < 12; i++) {
  await page.evaluate((k) => window.__drag('touchmove', 300 + k * 6, 600 - k * 6), i);
  await page.waitForTimeout(40);
}
await page.waitForTimeout(250);
const after = await page.evaluate(() => {
  const p = window.game.world.player;
  return { x: p.pos.x, y: p.pos.y, stick: { ...window.game.input.touchStick } };
});
await page.evaluate(() => window.__drag('touchend', 366, 534));
const moved = Math.hypot(after.x - before.x, after.y - before.y);
if (moved < 0.4) fail(`stick did not move the player (${moved.toFixed(2)}m)`);
else ok(`stick moved the player ${moved.toFixed(2)}m`);
await page.screenshot({ path: `${OUT}/03-stick.png` });

// --- buttons --------------------------------------------------------------
const btn = await page.evaluate(() => {
  const b = window.game.touch.layout.find((l) => l.def.action === 'ability1');
  return b ? { x: b.x, y: b.y } : null;
});
if (!btn) fail('no ability button in the touch layout');
else {
  const ce0 = await page.evaluate(() => window.game.world.player.ce);
  await page.touchscreen.tap(btn.x, btn.y);
  await page.waitForTimeout(400);
  const ce1 = await page.evaluate(() => window.game.world.player.ce);
  if (ce1 >= ce0) fail('technique button did not fire (no cursed energy spent)');
  else ok(`technique button fired (${(ce0 - ce1).toFixed(0)} CE spent)`);
}
await page.screenshot({ path: `${OUT}/04-button.png` });

// --- right half aims and attacks -----------------------------------------
const atk = await page.evaluate(async () => {
  const g = window.game;
  const c = document.getElementById('game');
  const mk = (type, x, y) => {
    const touch = new Touch({ identifier: 7, target: c, clientX: x, clientY: y });
    c.dispatchEvent(new TouchEvent(type, {
      touches: type === 'touchend' ? [] : [touch],
      targetTouches: type === 'touchend' ? [] : [touch],
      changedTouches: [touch], bubbles: true, cancelable: true,
    }));
  };
  const before = g.world.player.aim;
  mk('touchstart', 900, 300);
  await new Promise((r) => setTimeout(r, 300));
  const held = g.input.down('attack');
  mk('touchend', 900, 300);
  await new Promise((r) => setTimeout(r, 200));
  return { aimChanged: Math.abs(g.world.player.aim - before) > 0.01, held };
});
if (!atk.held) fail('touching the right half did not hold attack');
else ok('right half holds attack');
if (!atk.aimChanged) fail('touching the right half did not change aim');
else ok('right half aims');

// The canvas must fill the viewport with no page scroll.
const layout = await page.evaluate(() => ({
  scroll: document.scrollingElement.scrollHeight - window.innerHeight,
  w: document.getElementById('game').clientWidth,
  h: document.getElementById('game').clientHeight,
  vw: window.innerWidth, vh: window.innerHeight,
  dpr: window.game.renderer.dpr,
}));
if (layout.scroll > 1) fail(`page scrolls by ${layout.scroll}px`);
else ok('no page scroll');
if (Math.abs(layout.w - layout.vw) > 2 || Math.abs(layout.h - layout.vh) > 2) {
  fail(`canvas ${layout.w}x${layout.h} does not fill viewport ${layout.vw}x${layout.vh}`);
} else ok(`canvas fills viewport (dpr ${layout.dpr})`);

await page.screenshot({ path: `${OUT}/05-final.png` });

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exitCode = 1;
} else {
  console.log('\ntouch controls OK. shots in', OUT);
}
await browser.close();
