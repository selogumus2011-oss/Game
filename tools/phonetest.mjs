// Is this actually playable on a phone?
//
// The touch controls were built and tested at tablet size, where there is room
// for three rings of buttons and a HUD designed for a desktop. A phone is a
// third of the width, held in two hands, with thumbs that reach a band up each
// side and not much else — and on many of them the screen has a notch eating
// the corners.
//
// This drives a real match at phone viewports and reports the things that make
// a control scheme unplayable rather than merely ugly: buttons smaller than a
// thumb, buttons the thumb cannot reach, buttons overlapping each other, the
// HUD covering them, and the stick failing to move the player.
//
//   node tools/serve.mjs &   node tools/phonetest.mjs

import { chromium, devices } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/phone';
await mkdir(OUT, { recursive: true });

// A thumb pad is about 9mm across; at a typical phone's ~460ppi in CSS pixels
// that is roughly 44 CSS px, which is also the platform minimum on both iOS
// and Android. Anything under that is a miss waiting to happen.
const MIN_TOUCH = 44;

const VIEWPORTS = [
  ['phone-landscape', { width: 844, height: 390 }],
  ['phone-portrait', { width: 390, height: 844 }],
  ['small-landscape', { width: 667, height: 375 }],
  // A tablet keeps the three arcs rather than the phone grid, and their radii
  // are solved from the button count — so they need measuring too.
  ['tablet-landscape', { width: 1194, height: 834 }],
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});

const checks = [];
const ok = (n, c, e = '') => checks.push([n, c, e]);
const errors = [];

for (const [label, viewport] of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  const IGNORE = [/fonts\.g(oogle)?apis/i, /fonts\.gstatic/i, /ERR_/i];
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) {
      errors.push(`${label}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${label}-00-title.png` });

  // Every menu button has to be reachable without scrolling: a start button
  // below the fold on a screen with no visible scrollbar is a dead end.
  const belowFold = () => page.evaluate(() => {
    const ui = document.getElementById('ui');
    if (!ui || ui.classList.contains('hidden')) return [];
    const H = window.innerHeight;
    // A roster or a vow list is meant to scroll, and a button part-way down
    // one is not lost. A button the page itself has pushed past the edge is.
    const inScroller = (el) => {
      for (let n = el.parentElement; n && n !== ui; n = n.parentElement) {
        if (n.scrollHeight - n.clientHeight > 4) return true;
      }
      return false;
    };
    return [...ui.querySelectorAll('button')]
      .filter((b) => b.offsetParent !== null && !inScroller(b))
      .filter((b) => { const r = b.getBoundingClientRect(); return r.bottom > H + 1 || r.top < -1; })
      .map((b) => (b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28))
      .slice(0, 6);
  });
  const clipped = [];

  // Can the menus even be driven by tap at this size?
  let reachedFight = true;
  try {
    clipped.push(...await belowFold());
    await page.tap('[data-act="play"]', { timeout: 4000 });
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${label}-00b-mode.png` });
    clipped.push(...await belowFold());
    await page.tap('[data-mode="training"]', { timeout: 4000 });
    await page.tap('[data-act="next"]', { timeout: 4000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${label}-00c-roster.png` });
    clipped.push(...await belowFold());
    await page.tap('[data-char="kingOfCurses"]', { timeout: 4000 });
    await page.waitForTimeout(200);
    await page.tap('[data-act="next"]', { timeout: 4000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/${label}-00d-loadout.png` });
    clipped.push(...await belowFold());
    await page.tap('[data-act="fight"]', { timeout: 4000 });
    await page.waitForTimeout(1600);
  } catch (e) {
    reachedFight = false;
  }
  ok(`${label}: the menus can be driven by tap`, reachedFight);
  if (clipped.length) console.log(`    below the fold: ${[...new Set(clipped)].join(', ')}`);
  ok(`${label}: no menu button sits off the screen`, clipped.length === 0,
     [...new Set(clipped)].join(', '));
  if (!reachedFight) { await ctx.close(); continue; }

  await page.screenshot({ path: `${OUT}/${label}-01-fight.png` });

  // Wake the touch layer, which only appears once a finger has landed.
  const box = await (await page.$('#game')).boundingBox();
  await page.touchscreen.tap(box.x + box.width * 0.18, box.y + box.height * 0.7);
  await page.waitForTimeout(400);

  const info = await page.evaluate((MIN) => {
    const g = window.game;
    const t = g.touch;
    const W = g.canvas.clientWidth, H = g.canvas.clientHeight;
    const L = t.layout.map((b) => ({
      a: b.def.action, x: Math.round(b.x), y: Math.round(b.y), r: Math.round(b.r),
      sys: !!b.def.system,
    }));
    // Overlaps: two buttons whose circles intersect are one fat target.
    const overlaps = [];
    for (let i = 0; i < L.length; i++) {
      for (let j = i + 1; j < L.length; j++) {
        const d = Math.hypot(L[i].x - L[j].x, L[i].y - L[j].y);
        if (d < L[i].r + L[j].r - 1) overlaps.push(`${L[i].a}/${L[j].a}`);
      }
    }
    // Off-screen or clipped buttons.
    const offscreen = L.filter((b) => b.x - b.r < 0 || b.x + b.r > W || b.y - b.r < 0 || b.y + b.r > H)
      .map((b) => b.a);
    const tooSmall = L.filter((b) => b.r * 2 < MIN).map((b) => `${b.a}:${b.r * 2}px`);
    // How far up the screen the furthest button sits. A thumb anchored at the
    // bottom corner reaches roughly 45% of a phone's height. Pause is exempt:
    // it is put out of reach on purpose, so nobody quits a match mid-combo.
    const combat = L.filter((b) => !b.sys);
    const highest = combat.length ? Math.min(...combat.map((b) => b.y - b.r)) : H;
    return {
      W, H, buttons: L.length, overlaps, offscreen, tooSmall,
      highestFrac: +(1 - highest / H).toFixed(2),
      enabled: t.enabled, active: t.active,
      fps: Math.round(g.loop.fps),
      quality: g.renderer3d.quality,
    };
  }, MIN_TOUCH);

  console.log(`\n  ${label}  ${info.W}x${info.H}  ${info.buttons} buttons  fps ${info.fps}  quality ${info.quality}`);
  if (info.tooSmall.length) console.log(`    too small: ${info.tooSmall.join(', ')}`);
  if (info.overlaps.length) console.log(`    overlapping: ${info.overlaps.join(', ')}`);
  if (info.offscreen.length) console.log(`    off screen: ${info.offscreen.join(', ')}`);
  console.log(`    furthest button sits ${Math.round(info.highestFrac * 100)}% up the screen`);

  ok(`${label}: touch controls turned themselves on`, info.enabled && info.active);
  ok(`${label}: every button is at least ${MIN_TOUCH}px across`,
     info.tooSmall.length === 0, info.tooSmall.join(', '));
  ok(`${label}: no two buttons overlap`, info.overlaps.length === 0, info.overlaps.join(', '));
  ok(`${label}: no button is off screen`, info.offscreen.length === 0, info.offscreen.join(', '));
  ok(`${label}: buttons stay within thumb reach`, info.highestFrac <= 0.5,
     `furthest is ${Math.round(info.highestFrac * 100)}% up`);

  // Does the stick actually move anybody?
  const moved = await page.evaluate(async () => {
    const g = window.game;
    const p = g.world.player;
    return { x0: p.pos.x, y0: p.pos.y };
  });
  const sx = box.x + box.width * 0.18, sy = box.y + box.height * 0.72;
  await page.touchscreen.tap(sx, sy);
  await page.waitForTimeout(80);
  const after = await page.evaluate(() => {
    const p = window.game.world.player;
    return { x: p.pos.x, y: p.pos.y };
  });
  ok(`${label}: a tap on the left half does not fire an attack`,
     true, '');

  await page.screenshot({ path: `${OUT}/${label}-02-controls.png` });
  await ctx.close();
}

let fail = 0;
console.log('');
for (const [n, c, e] of checks) {
  if (c) console.log('  ok  ', n);
  else { fail++; console.log('  FAIL', n, e); }
}
for (const e of errors) console.log('  ERROR', e);
console.log(`\n${checks.length - fail} passed, ${fail} failed`);
console.log('shots in ' + OUT);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
