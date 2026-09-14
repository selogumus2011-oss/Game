// Domain gallery: opens every domain in the game in turn and screenshots it,
// so a change to the barrier or an interior can be eyeballed across all of them
// instead of one at a time.
//
//   node tools/serve.mjs &   node tools/domainshots.mjs

import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const URL = process.env.URL || 'http://localhost:8080/';
const OUT = process.env.OUT || '/tmp/claude-0/domains';
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => {
  if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) {
    errors.push('console: ' + m.text());
  }
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

// Start any match so a world exists, then rebuild it per domain from the page.
await page.click('[data-act="play"]');
await page.click('[data-mode="duel"]');
await page.click('[data-act="next"]');
await page.click('[data-char="hollowSix"]');
await page.click('[data-act="next"]');
await page.waitForTimeout(200);
await page.click('[data-act="fight"]').catch(() => {});
await page.waitForTimeout(1500);

const domains = await page.evaluate(async () => {
  const mod = await import('/src/data/techniques.js');
  return Object.values(mod.TECHNIQUES)
    .filter((t) => t.domain)
    .map((t) => ({ id: t.id, domain: t.domain.id, name: t.domain.name, visual: t.domain.visual }));
});
console.log(`${domains.length} domains`);

for (const d of domains) {
  const ok = await page.evaluate(async (tid) => {
    const g = window.game;
    const w = g.world;
    const mod = await import('/src/data/techniques.js');
    const tech = mod.TECHNIQUES[tid];
    const p = w.player;
    p.technique = tech;
    // The sure-hit would kill everyone halfway through the gallery, so put the
    // fight back on its feet before each expansion.
    w.over = false;
    for (const f of w.fighters) {
      f.dead = false;
      f.deathTime = 0;
      f.hp = f.maxHp;
      f.ce = f.maxCe;
      f.state = 'idle';
    }
    // Close anything already up, then expand this one directly.
    for (const dom of w.domains.slice()) dom.closed = true;
    w.domains.length = 0;
    w.openDomain(p, tech.domain);
    g.camera.snapTo(p.pos.x, p.pos.y);
    return true;
  }, d.id);
  if (!ok) continue;
  // Let the barrier finish unfolding and the interior settle.
  await page.waitForTimeout(1700);
  await page.screenshot({ path: `${OUT}/${d.visual}-${d.domain}.png` });
  console.log('  shot', d.visual, '—', d.name);
}

if (errors.length) {
  console.error('\nERRORS:');
  for (const e of errors) console.error(' ', e);
  process.exitCode = 1;
} else {
  console.log('\nno console errors. shots in', OUT);
}
await browser.close();
