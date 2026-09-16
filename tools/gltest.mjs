// Does the GPU draw the same picture as the CPU?
//
// The whole premise of the WebGL backend is that it is a transcription of the
// software rasteriser, not a redesign — same band table, same rim test, same
// ink geometry. That is a claim you can check rather than admire: plant the
// camera on a fixed set of shots, render each one twice, and compare the
// pixels.
//
// They will never be identical. The GPU antialiases polygon edges and the
// software path does not, it has a real depth buffer where the software path
// sorts by centroid, and the two rasterise a triangle's boundary pixels by
// different rules. So this measures the things that would catch a real
// regression instead:
//
//   * **Mean luminance per shot.** A shading bug — wrong band cut, wrong
//     normal, missing rim — moves this immediately.
//   * **Share of pixels that differ a lot.** Edge pixels differ a little
//     everywhere. A backend drawing the wrong geometry, culling the wrong
//     faces or losing the ink differs a lot over a large area.
//
//   node tools/serve.mjs &   node tools/gltest.mjs [outdir]

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

// gpu=1 forces the backend on: this container has no GPU, so the automatic
// choice would decline it and there would be nothing to compare.
const URL = process.env.URL || 'http://localhost:8080/?seed=20250915&gpu=1';
const OUT = process.argv[2] || process.env.OUT || '/tmp/claude-0/gl';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
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
await page.click('[data-mode="duel"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-char="kingOfCurses"]');
await page.waitForTimeout(150);
await page.click('[data-act="next"]');
await page.waitForTimeout(250);
await page.click('[data-act="fight"]');
await page.waitForTimeout(1800);

const setup = await page.evaluate(() => {
  const g = window.game;
  g.loop.stop();
  g.hud.hidden = true;
  g.cinematic.enabled = false;
  g.renderer3d.settings.showNames = false;
  // The screen-space stack is shared by both backends, so leaving it on would
  // only add noise the comparison cannot attribute to either of them.
  g.renderer3d.settings.bloom = false;
  g.renderer3d.settings.grade = false;
  g.renderer3d.settings.grain = false;
  g.renderer3d.settings.vignette = false;
  g.renderer3d.settings.weather = false;
  g.renderer3d.quality = 1;
  g.renderer3d._fpsAvg = 60;
  g.renderer3d.q.outlines = true;
  g.renderer3d.q.inkScale = 1;
  g.renderer3d.q.detail = 2;
  return { available: !!g.renderer3d.gpu, error: g.renderer3d.gpuError || null };
});

if (!setup.available) {
  console.log('  WebGL2 backend unavailable:', setup.error || 'no context');
  await browser.close();
  process.exit(1);
}

const checks = [];
const ok = (n, c, e = '') => checks.push([n, c, e]);

/** Plant the camera and hold a pose, exactly as the look harness does. */
const frame = (o) => page.evaluate((o) => {
  const g = window.game;
  const w = g.world;
  const p = w.player;
  const foe = w.fighters.find((f) => f !== p && !f.dead && !f.isSummon);

  p.pos.x = 0; p.pos.y = 0; p.z = 0;
  p.facing = o.facing ?? Math.PI / 2;
  p.aim = p.facing;
  p.vel.x = 0; p.vel.y = 0;
  p.state = 'idle';
  p.action = null; p.cast = null; p.domainCast = null;
  p.timeSinceHit = 9; p.statuses.length = 0; p.amplify.active = false;
  if (foe) {
    foe.pos.x = 2.2; foe.pos.y = 0.4; foe.z = 0;
    foe.facing = -Math.PI / 2; foe.state = 'idle'; foe.action = null;
    foe.vel.x = 0; foe.vel.y = 0;
    foe.timeSinceHit = 9; foe.statuses.length = 0; foe.amplify.active = false;
  }
  g.effects.clear();

  const c = g.camera3d;
  c.cine = 0; c.override = null; c.fpv = 0; c.fpvTarget = 0; c.trauma = 0;
  c.shake.x = c.shake.y = c.shake.z = 0; c.roll = 0;
  c.yaw = o.yaw; c.pitch = o.pitch; c.dist = o.dist;
  c.lookAt.x = 0; c.lookAt.y = 0; c.lookAt.z = o.lz ?? 1.2;
  c.commit();
}, o);

/** Render one frame on one backend and read the canvas back. */
const shoot = (useGpu) => page.evaluate((useGpu) => {
  const g = window.game;
  g.renderer3d.setGpu(useGpu);
  g.renderer3d.render(g.world, g.camera3d, g.effects, 1 / 60);
  const cv = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height);
  return { w: d.width, h: d.height, data: Array.from(d.data) };
}, useGpu);

const SHOTS = [
  ['01-wide', { yaw: -Math.PI / 2, pitch: 0.34, dist: 13, lz: 1.4 }],
  ['02-mid', { yaw: -Math.PI / 2 + 0.5, pitch: 0.16, dist: 6, lz: 1.3 }],
  ['03-close', { yaw: -Math.PI / 2 + 0.9, pitch: 0.06, dist: 2.6, lz: 1.5 }],
  ['04-face', { yaw: Math.PI / 2, pitch: 0.05, dist: 1.9, lz: 1.62, facing: -Math.PI / 2 }],
  ['05-low', { yaw: -Math.PI / 2 + 0.3, pitch: -0.14, dist: 4.2, lz: 1.0 }],
];

const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

console.log('  shot        cpu lum   gpu lum   drift   pixels >24 apart');
for (const [name, o] of SHOTS) {
  await frame(o);
  const cpu = await shoot(false);
  await page.screenshot({ path: `${OUT}/${name}-cpu.png` });
  await frame(o);
  const gpu = await shoot(true);
  await page.screenshot({ path: `${OUT}/${name}-gpu.png` });

  let sa = 0, sb = 0, n = 0, far = 0;
  for (let i = 0; i < cpu.data.length; i += 4) {
    const a = lum(cpu.data, i), b = lum(gpu.data, i);
    sa += a; sb += b; n++;
    if (Math.abs(a - b) > 24) far++;
  }
  const meanA = sa / n, meanB = sb / n;
  const drift = meanB - meanA;
  const farFrac = far / n;
  console.log(`  ${name.padEnd(10)}  ${meanA.toFixed(1).padStart(7)}   ${meanB.toFixed(1).padStart(7)}`
    + `   ${(drift >= 0 ? '+' : '') + drift.toFixed(1)}`.padStart(8)
    + `   ${(farFrac * 100).toFixed(1)}%`.padStart(10));

  // A shading bug moves the mean. Antialiasing and depth-buffer ordering do
  // not move it by more than a couple of levels out of 255.
  ok(`${name}: the two backends agree on overall value`,
     Math.abs(drift) < 6, `drift ${drift.toFixed(1)}`);
  // Edges differ everywhere; large areas should not.
  ok(`${name}: no large region is drawn differently`,
     farFrac < 0.12, `${(farFrac * 100).toFixed(1)}% of pixels differ by more than 24`);
  // A backend that drew nothing would agree with nothing.
  ok(`${name}: the GPU frame is not blank`, meanB > 4, `mean ${meanB.toFixed(1)}`);
}

// A frame with the effects layer actually doing something.
//
// Every shot above clears the effects so the comparison is about geometry, and
// that means none of them touch the particle path at all — which is most of
// what the overlay draws. This one fires a technique, lets the sparks live a
// few frames, then freezes and renders that one state through both backends.
{
  const built = await page.evaluate(async () => {
    const g = window.game;
    const p = g.world.player;
    const c = g.camera3d;
    p.pos.x = 0; p.pos.y = 0; p.z = 0;
    p.facing = Math.PI / 2; p.aim = p.facing;
    // Whatever the pinned shots left behind, put the player in a state that can
    // actually cast: the shots above null out actions and stop the clock, and a
    // fighter mid-recovery silently refuses.
    p.dead = false;
    p.hp = p.maxHp;
    p.ce = p.maxCe;
    p.state = 'idle';
    p.action = null; p.cast = null; p.domainCast = null;
    p.statuses.length = 0;
    for (const k of Object.keys(p.cooldowns)) p.cooldowns[k] = 0;
    p.tryAbility(0, g.world);
    // drainWorld is what turns the simulation's event queue into particles;
    // stepping the world alone leaves the effects layer empty.
    for (let i = 0; i < 26; i++) {
      g.world.update(1 / 60);
      g.drainWorld(g.world);
      g.effects.update(1 / 60);
    }
    c.cine = 0; c.override = null; c.fpv = 0; c.trauma = 0; c.roll = 0;
    c.shake.x = c.shake.y = c.shake.z = 0;
    c.yaw = -Math.PI / 2 + 0.4; c.pitch = 0.12; c.dist = 5;
    c.lookAt.x = 0; c.lookAt.y = 1.2; c.lookAt.z = 1.2;
    c.commit();
    return { particles: g.effects.particles.length };
  });
  const cpu = await shoot(false);
  await page.screenshot({ path: `${OUT}/06-effects-cpu.png` });
  const gpu = await shoot(true);
  await page.screenshot({ path: `${OUT}/06-effects-gpu.png` });
  let sa = 0, sb = 0, n = 0, far = 0;
  for (let i = 0; i < cpu.data.length; i += 4) {
    const a2 = lum(cpu.data, i), b2 = lum(gpu.data, i);
    sa += a2; sb += b2; n++;
    if (Math.abs(a2 - b2) > 24) far++;
  }
  const drift = sb / n - sa / n;
  console.log(`  06-effects  ${(sa / n).toFixed(1).padStart(7)}   ${(sb / n).toFixed(1).padStart(7)}`
    + `   ${(drift >= 0 ? '+' : '') + drift.toFixed(1)}`.padStart(8)
    + `   ${(far / n * 100).toFixed(1)}%`.padStart(10)
    + `   (${built.particles} particles)`);
  ok('the effects layer has something to draw', built.particles > 0, `${built.particles}`);
  ok('06-effects: the two backends agree on overall value',
     Math.abs(drift) < 6, `drift ${drift.toFixed(1)}`);
  ok('06-effects: no large region is drawn differently',
     far / n < 0.12, `${(far / n * 100).toFixed(1)}%`);
}

// Cast shadows: present, and the right tone.
//
// Measured by difference rather than by absolute darkness. Looking for "the
// darkest pixels on the floor" would happily report the dark squares of a
// checkerboard as a shadow and pass with the feature switched off, so this
// renders the identical frame twice — shadows on, shadows off — and the
// shadow is exactly the set of pixels that changed.
{
  const probe = await page.evaluate(() => {
    const g = window.game;
    const w = g.world;
    const p = w.player;
    const c = g.camera3d;
    p.pos.x = 0; p.pos.y = 0; p.z = 0;
    p.state = 'idle'; p.action = null;
    for (const f of w.fighters) if (f !== p) { f.pos.x = 60; f.pos.y = 60; }
    g.effects.clear();
    // Across the sun's bearing, not down it: looking along the sun puts the
    // shadow behind the figure where their own body hides it.
    const sun = g.renderer3d.gpu.sun;
    c.cine = 0; c.override = null; c.fpv = 0; c.trauma = 0; c.roll = 0;
    c.shake.x = c.shake.y = c.shake.z = 0;
    c.yaw = Math.atan2(sun[1], sun[0]) + Math.PI / 2;
    c.pitch = 0.42; c.dist = 7;
    c.lookAt.x = 0; c.lookAt.y = 0; c.lookAt.z = 0.7;
    c.commit();
    g.renderer3d.setGpu(true);

    const cv = document.getElementById('game');
    const ctx = cv.getContext('2d');
    // Through the setting, not the backend flag: render() reads the setting
    // into the backend at the top of every frame, so poking the backend
    // directly is undone before a single triangle is drawn.
    const grab = (on) => {
      g.renderer3d.settings.shadows = on;
      g.renderer3d.render(w, c, g.effects, 1 / 60);
      return ctx.getImageData(0, 0, cv.width, cv.height).data;
    };
    const lit = grab(false);
    const shaded = grab(true);
    g.renderer3d.settings.shadows = true;

    const L = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    let n = 0, sumLit = 0, sumShade = 0, total = 0;
    for (let i = 0; i < lit.length; i += 4) {
      total++;
      const a = L(lit, i), b = L(shaded, i);
      // Darker with shadows on, by more than a rounding step.
      if (a - b > 2) { n++; sumLit += a; sumShade += b; }
    }
    return {
      frac: n / total,
      lit: n ? sumLit / n : 0,
      shade: n ? sumShade / n : 0,
      casters: g.renderer3d.gpu.stats.casters,
    };
  });
  await page.screenshot({ path: `${OUT}/07-shadow.png` });
  console.log(`\n  shadow  covers ${(probe.frac * 100).toFixed(1)}% of the frame, `
    + `${probe.lit.toFixed(1)} -> ${probe.shade.toFixed(1)}  (${probe.casters} casters)`);
  ok('the shadow pass has something to cast', probe.casters > 0, `${probe.casters}`);
  ok('turning shadows on actually darkens part of the frame',
     probe.frac > 0.01, `${(probe.frac * 100).toFixed(2)}%`);
  ok('a cast shadow is clearly darker than the surface it lies on',
     probe.shade < probe.lit * 0.85,
     `${probe.shade.toFixed(1)} vs ${probe.lit.toFixed(1)}`);
  ok('and is a paint tone rather than a hole',
     probe.shade > probe.lit * 0.3,
     `${probe.shade.toFixed(1)} vs ${probe.lit.toFixed(1)}`);
}

// Last, because it advances the world: ninety frames of each backend driving
// the whole pipeline — HUD, effects and all — which is what catches the
// errors a still frame never reaches. Running it first would leave the fight
// somewhere else entirely by the time the pinned shots were taken, and the
// comparison above would be measuring two different worlds.
const live = await page.evaluate(async () => {
  const g = window.game;
  const out = {};
  for (const useGpu of [true, false]) {
    g.renderer3d.setGpu(useGpu);
    for (let i = 0; i < 90; i++) {
      g.world.update(1 / 60);
      g.render(1 / 60);
    }
    out[useGpu ? 'gpu' : 'cpu'] = useGpu ? { ...g.renderer3d.gpu.stats } : { ok: 1 };
  }
  return out;
});
console.log(`  a live frame: ${live.gpu.meshes} meshes, ${live.gpu.hulls} hulls, `
  + `${live.gpu.tris} triangles, ${live.gpu.blended} blended\n`);
ok('both backends survive ninety frames of a live match', live.gpu.meshes > 0,
   JSON.stringify(live.gpu));

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
