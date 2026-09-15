// The Black Flash cut-in, frame by frame.
//
// It lasts about half a second of real time, so this drives the loop by hand
// at a fixed step and shoots every few frames. That also checks the thing most
// likely to be wrong: whether the cut-in gives the camera back cleanly.
//
//   node tools/serve.mjs &   node tools/flashshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/flash';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
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
await page.click('[data-char="sevenThree"]');
await page.waitForTimeout(150);
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-act="fight"]');
await page.waitForTimeout(1500);

// Hand-drive the loop so the half-second cut-in can be walked through.
await page.evaluate(() => {
  window.game.loop.stop();
  window.__step = (dt) => { window.game.update(dt); window.game.render(dt); };
});

// Put the player next to a dummy and force a Black Flash on the next hit.
const fired = await page.evaluate(() => {
  const g = window.game;
  const w = g.world;
  const p = w.player;
  const dummy = w.fighters.find((f) => f !== p && !f.dead);
  if (!dummy) return 'no target';
  p.pos.x = dummy.pos.x;
  p.pos.y = dummy.pos.y + 1.4;
  p.aim = -Math.PI / 2;
  p.facing = -Math.PI / 2;
  // Open the flash window and make the band cover the whole of it, so the
  // very next swing lands inside rather than the harness having to time a
  // seventy-millisecond gap.
  const fw = p.flashWindow;
  fw.active = true;
  fw.t = 0;
  fw.dur = 4;
  fw.start = 0;
  fw.band = 4;
  fw.ticked = false;
  p.startAction('light1');
  return 'ok';
});
if (fired !== 'ok') { console.log('  setup failed:', fired); await browser.close(); process.exit(1); }

const state = () => page.evaluate(() => ({
  cine: !!window.game.flashCine.active,
  t: window.game.flashCine.active ? +window.game.flashCine.active.t.toFixed(3) : null,
  drain: +window.game.flashCine.drain.toFixed(3),
  override: !!window.game.camera3d.override,
  flashes: window.game.world.player.blackFlashCount,
}));

let sawCine = false;
let shot = 0;
for (let i = 0; i < 70; i++) {
  await page.evaluate(() => window.__step(1 / 60));
  const st = await state();
  if (st.cine) sawCine = true;
  if (st.cine && i % 3 === 0 && shot < 8) {
    await page.screenshot({ path: `${OUT}/cine-${String(shot).padStart(2, '0')}.png` });
    shot++;
  }
}

const after = await state();
const checks = [];
checks.push(['a black flash actually landed', after.flashes > 0, `count ${after.flashes}`]);
checks.push(['the cut-in ran', sawCine, '']);
checks.push(['the cut-in ended', after.cine === false, `t ${after.t}`]);
checks.push(['the camera was handed back', after.override === false, '']);
checks.push(['the drain returned to zero', after.drain === 0, `drain ${after.drain}`]);

// And that the follow camera recovers rather than staying at the cut angle.
await page.evaluate(() => { for (let i = 0; i < 60; i++) window.__step(1 / 60); });
await page.screenshot({ path: `${OUT}/after.png` });

let fail = 0;
console.log('');
for (const [name, ok, extra] of checks) {
  if (ok) console.log('  ok  ', name);
  else { fail++; console.log('  FAIL', name, extra); }
}
for (const e of errors) console.log('  ERROR', e);
console.log(`\n${checks.length - fail} passed, ${fail} failed, ${errors.length} console errors`);
console.log(`${shot} cut-in frames in ${OUT}`);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
