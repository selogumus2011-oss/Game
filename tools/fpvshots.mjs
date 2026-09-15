// First person: get into a training match, switch view, and screenshot the
// things that can only be judged by looking — is the eye at head height, is
// the player's own body out of shot, do the hands read, does mouse look turn
// the aim rather than the cursor.
//
//   node tools/serve.mjs &   node tools/fpvshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/fpv';
await mkdir(OUT, { recursive: true });

const errors = [];
const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const IGNORE = [/fonts\.g(oogle)?apis/i, /fonts\.gstatic/i, /ERR_CONNECTION_RESET/i,
  /ERR_NAME_NOT_RESOLVED/i, /ERR_CERT_AUTHORITY_INVALID/i];
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '')));

const shot = async (n) => { await page.screenshot({ path: `${OUT}/${n}.png` }); console.log('  shot', n); };
const state = () => page.evaluate(() => {
  const g = window.game;
  const c = g.camera3d;
  const p = g.world?.player;
  return {
    firstPerson: g.firstPerson,
    fpv: +c.fpv.toFixed(3),
    fpvYaw: +c.fpvYaw.toFixed(3),
    camZ: +c.pos.z.toFixed(2),
    // The rig derives the eye from the fighter's own height, so the
    // expectation has to as well rather than assuming a 1.75m body.
    playerZ: p ? +(p.z + p.height * c.eyeRatio).toFixed(2) : null,
    dFromHead: p ? +Math.hypot(c.pos.x - p.pos.x, c.pos.y - p.pos.y).toFixed(2) : null,
    aim: p ? +p.aim.toFixed(3) : null,
  };
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// Training mode: dummies to look at, nothing shooting back.
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
await shot('01-third-person');
console.log('  third person', JSON.stringify(await state()));

// Switch.
await page.keyboard.press('KeyG');
await page.waitForTimeout(700);
await shot('02-first-person');
const fp = await state();
console.log('  first person ', JSON.stringify(fp));

const checks = [];
const ok = (name, cond, extra = '') => { checks.push([name, cond, extra]); };
ok('the mode flipped', fp.firstPerson === true);
ok('the blend finished', fp.fpv > 0.95, `fpv ${fp.fpv}`);
ok('the eye is at head height', Math.abs(fp.camZ - fp.playerZ) < 0.12,
   `cam ${fp.camZ} vs head ${fp.playerZ}`);
ok('the eye is on the head, not orbiting it', fp.dFromHead < 0.6, `${fp.dFromHead}m away`);

// Mouse look. Pointer lock needs a click first.
const box = await (await page.$('#game')).boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(300);
const before = await state();
// Playwright's synthetic moves carry movementX under pointer lock.
for (let i = 0; i < 12; i++) {
  await page.mouse.move(box.x + box.width / 2 + i * 14, box.y + box.height / 2);
  await page.waitForTimeout(16);
}
await page.waitForTimeout(250);
const after = await state();
console.log('  after look   ', JSON.stringify(after));
const locked = await page.evaluate(() => window.game.input.pointerLocked);
if (locked) {
  ok('mouse look turned the view', Math.abs(after.fpvYaw - before.fpvYaw) > 0.05,
     `${before.fpvYaw} -> ${after.fpvYaw}`);
  ok('the aim followed the view', Math.abs(after.aim - after.fpvYaw) < 0.01,
     `aim ${after.aim} yaw ${after.fpvYaw}`);
} else {
  console.log('  (pointer lock not granted in this harness; look test skipped)');
}
await shot('03-after-look');

// Walk forward and swing, to see the arms.
await page.keyboard.down('w');
await page.waitForTimeout(600);
await page.keyboard.up('w');
await shot('04-walking');
await page.mouse.down();
await page.waitForTimeout(90);
await page.mouse.up();
await page.waitForTimeout(110);
await shot('05-swing');

// A technique, then a domain, both from the eye.
await page.keyboard.press('Digit1');
await page.waitForTimeout(260);
await shot('06-technique');
await page.keyboard.press('Digit2');
await page.waitForTimeout(380);
await shot('07-technique2');
await page.keyboard.press('KeyX');
await page.waitForTimeout(700);
await shot('08-domain-cast');
await page.waitForTimeout(1400);
await shot('09-domain-open');

// And back out.
await page.keyboard.press('KeyG');
await page.waitForTimeout(700);
await shot('10-back-to-third');
const back = await state();
ok('switching back leaves first person', back.firstPerson === false && back.fpv < 0.1,
   `fpv ${back.fpv}`);

let fail = 0;
console.log('');
for (const [name, cond, extra] of checks) {
  if (cond) console.log('  ok  ', name);
  else { fail++; console.log('  FAIL', name, extra); }
}
for (const e of errors) console.log('  ERROR', e);
console.log(`\n${checks.length - fail} passed, ${fail} failed, ${errors.length} console errors`);
console.log('shots in ' + OUT);
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
