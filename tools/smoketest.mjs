// Headless simulation test. The whole combat model is DOM-free, so we can run
// thousands of frames of real fights in node and assert the mechanics behave.
//
//   node tools/smoketest.mjs

import { World } from '../src/sim/world.js';
import { PLAYABLE_TECHNIQUES, TECHNIQUES } from '../src/data/techniques.js';
import { CHARACTERS, ROSTER } from '../src/data/characters.js';
import { CURSES } from '../src/data/curses.js';
import { VOWS } from '../src/data/vows.js';
import { TOOLS } from '../src/data/tools.js';
import { ACTIONS } from '../src/data/actions.js';
import { openFlashWindow, inFlashBand, FLASH } from '../src/sim/combat.js';

let passed = 0, failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push(`  ok   ${name}`);
  } catch (e) {
    failed++;
    results.push(`  FAIL ${name}\n         ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

const DT = 1 / 60;
function run(world, seconds, perFrame) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    if (perFrame) perFrame(i, world);
    world.update(DT);
  }
}

// ---------------------------------------------------------------------------
console.log('\n— data integrity —');

test('every playable technique resolves', () => {
  for (const id of PLAYABLE_TECHNIQUES) {
    const t = TECHNIQUES[id];
    assert(t, `missing technique ${id}`);
    assert(t.abilities.length === 4, `${id} should have 4 abilities, has ${t.abilities.length}`);
    for (const ab of t.abilities) {
      assert(ab.id && ab.name && ab.archetype, `${id}: malformed ability`);
      assert(typeof ab.cost === 'number', `${id}/${ab.id}: missing cost`);
      if (ab.archetype === 'projectile') assert(ab.projectile, `${id}/${ab.id}: projectile spec missing`);
    }
    if (t.domain) {
      assert(t.domain.radius > 0 && t.domain.integrity > 0, `${id}: bad domain`);
      assert(t.domain.sureHit, `${id}: domain has no sure-hit`);
    } else {
      assert(t.blurbNoDomain, `${id}: no domain and no explanation`);
    }
  }
});

test('every character maps to a real technique and tool', () => {
  for (const id of ROSTER) {
    const c = CHARACTERS[id];
    assert(TECHNIQUES[c.technique], `${id}: unknown technique ${c.technique}`);
    assert(TOOLS[c.tool], `${id}: unknown tool ${c.tool}`);
    assert(c.maxHp > 0 && c.poise > 0, `${id}: bad stats`);
  }
});

test('curse action ids all exist', () => {
  for (const [id, c] of Object.entries(CURSES)) {
    for (const a of c.actions) assert(ACTIONS[a], `${id}: unknown action ${a}`);
  }
});

test('binding vows apply without throwing', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 1 });
  for (const v of Object.values(VOWS)) {
    const f = w.spawnPlayer('kingOfCurses', { vows: [v.id], x: 0, y: 0 });
    assert(f.hp > 0, `${v.id} left the fighter dead`);
    f.dead = true;
  }
});

// ---------------------------------------------------------------------------
console.log('— core combat —');

test('a light attack damages an enemy', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 7 });
  const p = w.spawnPlayer('kingOfCurses', { x: 0, y: 0 });
  const e = w.spawnCurse('larva', { x: 1.2, y: 0, team: 1 });
  w.controllers.delete(e.id); // stop it dodging — we are testing the swing itself
  const hp0 = e.hp;
  p.intent.aim = 0;
  p.intent.attackTap = true;
  run(w, 0.5);
  assert(e.hp < hp0, `enemy took no damage (${hp0} -> ${e.hp})`);
});

test('reinforcement scales with cursed energy', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 3 });
  const f = w.spawnPlayer('shadowHeir', { x: 0, y: 0 });
  f.ce = f.maxCe;
  const full = f.reinforcement;
  f.ce = 0;
  const empty = f.reinforcement;
  assert(full > empty, `full CE should reinforce more (${full} vs ${empty})`);
  assert(full <= 0.72, 'reinforcement cap exceeded');
});

test('Heavenly Restriction has no reinforcement at all', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 3 });
  const f = w.spawnPlayer('zeroPresence', { x: 0, y: 0 });
  assert(f.maxCe === 0, 'should have zero cursed energy');
  assert(f.reinforcement === 0, 'should have zero reinforcement');
});

test('blocking reduces damage, parry negates it', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 11 });
  const a = w.spawnSorcerer('sevenThree', { team: 1, x: 0, y: 0 });
  const d = w.spawnPlayer('shadowHeir', { x: 1.5, y: 0 });
  d.ce = 0; // isolate blocking from reinforcement

  const before = d.hp;
  w.dealDamage(a, d, { damage: 30, poise: 10, physical: true, tags: ['physical'] });
  const rawLoss = before - d.hp;

  d.hp = d.maxHp;
  d.state = 'block';
  d.facing = Math.PI; // facing the attacker
  const b2 = d.hp;
  w.dealDamage(a, d, { damage: 30, poise: 10, physical: true, tags: ['physical'] });
  const blockedLoss = b2 - d.hp;
  assert(blockedLoss < rawLoss, `block should reduce damage (${blockedLoss} vs ${rawLoss})`);

  d.hp = d.maxHp;
  d.state = 'idle';
  d.parryTimer = 0.15;
  const res = w.dealDamage(a, d, { damage: 30, poise: 10, physical: true, tags: ['physical'] });
  assert(res.parried, 'parry did not register');
  assert(near(d.hp, d.maxHp), 'parry should take zero damage');
});

test('poise break staggers', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 12 });
  const a = w.spawnSorcerer('clapDancer', { team: 1, x: 0, y: 0 });
  const d = w.spawnCurse('larva', { x: 1, y: 0, team: 2 });
  w.dealDamage(a, d, { damage: 1, poise: 999, physical: true, tags: ['physical'] });
  assert(d.state === 'stagger', `expected stagger, got ${d.state}`);
});

// ---------------------------------------------------------------------------
console.log('— black flash —');

test('hitting inside the band produces a Black Flash', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 21 });
  const a = w.spawnPlayer('kingOfCurses', { x: 0, y: 0 });
  const d = w.spawnCurse('hulkCurse', { x: 1.2, y: 0, team: 1 });
  openFlashWindow(a, {});
  a.flashWindow.t = a.flashWindow.start + a.flashWindow.band * 0.5;
  assert(inFlashBand(a), 'window should be inside its band');
  const res = w.dealDamage(a, d, { damage: 20, poise: 10, physical: true, tags: ['physical'] });
  assert(res.blackFlash, 'expected a black flash');
  assert(res.damage > 20 * FLASH.baseMultiplier * 0.3, 'black flash damage too low');
  assert(a.blackFlashCount === 1, 'flash count not incremented');
});

test('hitting outside the band does not, and narrows the band', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 22 });
  const a = w.spawnPlayer('kingOfCurses', { x: 0, y: 0 });
  const d = w.spawnCurse('hulkCurse', { x: 1.2, y: 0, team: 1 });
  openFlashWindow(a, {});
  const band0 = a.flashWindow.band;
  a.flashWindow.t = 0.01; // far too early
  const res = w.dealDamage(a, d, { damage: 20, poise: 10, physical: true, tags: ['physical'] });
  assert(!res.blackFlash, 'should not flash outside the band');
  assert(a.flashWindow.failScale < 1, 'failing should narrow the band');
  assert(a.flashWindow.band <= band0, 'band should not grow after a miss');
});

test('a perfect parry opens a wide Black Flash window', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 23 });
  const atk = w.spawnSorcerer('sevenThree', { team: 1, x: 0, y: 0 });
  const def = w.spawnPlayer('kingOfCurses', { x: 1.4, y: 0 });
  def.facing = Math.PI;
  def.parryTimer = 0.15;
  const narrow = (() => { openFlashWindow(def, {}); return def.flashWindow.band; })();
  def.flashWindow.active = false;
  w.dealDamage(atk, def, { damage: 20, poise: 20, physical: true, tags: ['physical'] });
  assert(def.flashWindow.active, 'parry should open the window');
  assert(def.flashWindow.band > narrow, 'parry window should be wider');
});

test('black flash chains multiply damage', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 24 });
  const a = w.spawnPlayer('kingOfCurses', { x: 0, y: 0 });
  const d = w.spawnCurse('mahoraga', { x: 1.2, y: 0, team: 1 });
  d.adapts = false;
  const flash = () => {
    openFlashWindow(a, {});
    a.flashWindow.t = a.flashWindow.start + a.flashWindow.band * 0.5;
    a.combo.count = 0;
    return w.dealDamage(a, d, { damage: 20, poise: 1, physical: true, tags: ['physical'] }).damage;
  };
  const first = flash();
  const second = flash();
  assert(a.flashWindow.chain >= 2, `chain should climb, got ${a.flashWindow.chain}`);
  assert(second > first, `chained flash should hit harder (${first} -> ${second})`);
});

// ---------------------------------------------------------------------------
console.log('— techniques —');

test('every ability of every technique executes without throwing', () => {
  for (const id of PLAYABLE_TECHNIQUES) {
    const w = new World({ mode: 'training', arena: 'void', seed: 31 });
    const t = TECHNIQUES[id];
    const caster = w.addFighter({
      name: 'Test', team: 0, technique: id, tool: 'fists', x: 0, y: 0, isPlayer: true,
      stats: { maxHp: 400, maxCe: 999, ceControl: 0.9, ceRegen: 50, rct: 0.8, poise: 200 },
    });
    w.spawnCurse('hulkCurse', { x: 6, y: 0, team: 1 });
    for (let i = 0; i < t.abilities.length; i++) {
      caster.ce = 999;
      caster.hp = 400;
      caster.flow = 1;
      caster.clearCooldowns();
      const ab = t.abilities[i];
      try {
        w.executeAbility(caster, ab, 0);
      } catch (e) {
        throw new Error(`${id}/${ab.id} threw: ${e.message}`);
      }
      run(w, 0.4);
    }
    run(w, 2);
  }
});

test('Infinity negates a hit and costs cursed energy', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 41 });
  const gojo = w.spawnPlayer('hollowSix', { x: 0, y: 0 });
  const atk = w.spawnCurse('mantis', { x: 1.4, y: 0, team: 1 });
  const ce0 = gojo.ce;
  const res = w.dealDamage(atk, gojo, { damage: 40, poise: 20, physical: true, tags: ['physical'] });
  assert(res.negated, 'Infinity should negate the hit');
  assert(gojo.ce < ce0, 'Infinity should cost cursed energy');
  assert(gojo.hp === gojo.maxHp, 'negated hit should do no damage');
});

test('Infinity fails when the energy is gone', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 42 });
  const gojo = w.spawnPlayer('hollowSix', { x: 0, y: 0 });
  const atk = w.spawnCurse('mantis', { x: 1.4, y: 0, team: 1 });
  gojo.ce = 0;
  const res = w.dealDamage(atk, gojo, { damage: 40, poise: 20, physical: true, tags: ['physical'] });
  assert(!res.negated, 'Infinity should fail at zero cursed energy');
  assert(gojo.hp < gojo.maxHp, 'the hit should land');
});

test('Heavenly Restriction and the Inverted Spear pierce Infinity', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 43 });
  const gojo = w.spawnSorcerer('hollowSix', { team: 1, x: 0, y: 0 });
  const toji = w.spawnPlayer('zeroPresence', { x: 1.4, y: 0 });
  const res = w.dealDamage(toji, gojo, {
    damage: 40, poise: 20, physical: true, tags: ['physical'],
    pierceInfinity: toji.flags.pierceInfinity || toji.tool.pierceInfinity,
  });
  assert(!res.negated, 'Heavenly Restriction should pierce Infinity');
  assert(res.damage > 0, 'the hit should land');
});

// ---------------------------------------------------------------------------
console.log('— domains —');

test('a domain opens, applies its sure-hit and drains the caster', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 51 });
  const p = w.spawnPlayer('hollowSix', { x: 0, y: 0 });
  const e = w.spawnCurse('hulkCurse', { x: 4, y: 0, team: 1 });
  p.flow = 1;
  p.ce = p.maxCe;
  const hp0 = e.hp;
  p.tryDomain(w);
  run(w, 3);
  assert(p.domain, 'domain should be open');
  assert(e.hp < hp0, `sure-hit should damage inside the barrier (${hp0} -> ${e.hp})`);
  assert(p.ce < p.maxCe, 'holding a domain should drain energy');
});

test('Simple Domain neutralises the sure-hit', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 52 });
  const p = w.spawnPlayer('hollowSix', { x: 0, y: 0 });
  const e = w.spawnSorcerer('sevenThree', { team: 1, x: 4, y: 0 });
  // Drive the defender manually — its own AI is smart enough to raise Simple
  // Domain the moment it is caught inside a barrier, which is what we want to
  // isolate here.
  w.controllers.delete(e.id);
  p.flow = 1;
  p.tryDomain(w);
  run(w, 2);
  assert(p.domain, 'domain should be open');

  // Without Simple Domain.
  e.intent.simpleDomain = false;
  e.hp = e.maxHp;
  run(w, 1.5);
  const lossOpen = e.maxHp - e.hp;

  // With it.
  e.hp = e.maxHp;
  e.ce = e.maxCe = 9999;
  run(w, 1.5, () => { e.intent.simpleDomain = true; });
  const lossGuarded = e.maxHp - e.hp;
  assert(lossGuarded < lossOpen, `Simple Domain should cut the damage (${lossGuarded} vs ${lossOpen})`);
});

test('a domain shatters under enough barrier damage and backfires', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 53 });
  const p = w.spawnPlayer('kingOfCurses', { x: 0, y: 0 });
  w.spawnCurse('larva', { x: 4, y: 0, team: 1 });
  p.flow = 1;
  p.tryDomain(w);
  run(w, 2);
  const d = p.domain;
  assert(d, 'domain should be open');
  const hp0 = p.hp;
  d.damageBarrier(99999, null);
  assert(d.closed, 'domain should have shattered');
  assert(p.hp < hp0, 'shattering should backfire on the caster');
  assert(p.domainBurnout > 0, 'shattering should cause burnout');
});

test('domain expansion is interrupted by heavy poise damage', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 54 });
  const p = w.spawnPlayer('hollowSix', { x: 0, y: 0 });
  const e = w.spawnCurse('hulkCurse', { x: 2, y: 0, team: 1 });
  p.flow = 1;
  p.tryDomain(w);
  run(w, 0.2);
  p.poise = 0;
  run(w, 0.2);
  assert(!p.domain, 'domain should not have opened');
  assert(p.domainBurnout > 0, 'interrupt should cause burnout');
});

// ---------------------------------------------------------------------------
console.log('— reverse cursed technique —');

test('RCT converts cursed energy into health', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 61 });
  const p = w.spawnPlayer('hollowSix', { x: 0, y: 0 });
  p.hp = p.maxHp * 0.4;
  const hp0 = p.hp;
  const ce0 = p.ce;
  run(w, 1.2, () => { p.intent.rct = true; });
  assert(p.hp > hp0, `RCT should heal (${hp0} -> ${p.hp})`);
  assert(p.ce < ce0, 'RCT should spend cursed energy');
});

test('the Abstinence vow forbids RCT', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 62 });
  const p = w.spawnPlayer('hollowSix', { vows: ['abstinence'], x: 0, y: 0 });
  p.hp = p.maxHp * 0.4;
  const hp0 = p.hp;
  run(w, 1.0, () => { p.intent.rct = true; });
  assert(Math.abs(p.hp - hp0) < 0.001, 'RCT should be impossible under the vow');
  assert(p.maxCe > p.stats.maxCe, 'the vow should have raised maximum cursed energy');
});

test('RCT clears wounds and throat strain', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 63 });
  const p = w.spawnPlayer('quietWords', { x: 0, y: 0 });
  p.hp = p.maxHp * 0.5;
  p.throat = 100;
  p.wounds.arms = 1;
  run(w, 1.5, () => { p.intent.rct = true; });
  assert(p.throat < 40, `throat should heal (${p.throat})`);
  assert(p.wounds.arms < 1, 'wounds should close');
});

// ---------------------------------------------------------------------------
console.log('— full fights —');

test('a duel between every pair of techniques runs 20s without throwing', () => {
  const picks = ['hollowSix', 'kingOfCurses', 'zeroPresence', 'patchwork', 'quietWords', 'clapDancer'];
  for (const a of picks) {
    for (const b of picks) {
      if (a === b) continue;
      const w = new World({ mode: 'duel', arena: 'shibuya', seed: 70 + a.length * 13 + b.length });
      w.spawnPlayer(a, { x: -6, y: 0 });
      w.spawnSorcerer(b, { team: 1, x: 6, y: 0 });
      // Drive the player with a crude bot so both sides actually fight.
      run(w, 20, (i, world) => {
        const p = world.player;
        if (!p || p.dead) return;
        p.intent.aim = Math.atan2(-p.pos.y, -p.pos.x);
        p.intent.move.x = Math.cos(p.intent.aim);
        p.intent.move.y = Math.sin(p.intent.aim);
        if (i % 40 === 0) p.intent.attackTap = true;
        if (i % 190 === 0) p.intent.ability = (i / 190) % 4;
        if (i % 300 === 0) p.intent.dash = true;
      });
      assert(isFinite(w.player.hp), `${a} vs ${b}: player hp went non-finite`);
      for (const f of w.fighters) {
        assert(isFinite(f.pos.x) && isFinite(f.pos.y), `${a} vs ${b}: ${f.name} left the coordinate system`);
      }
    }
  }
});

test('the gauntlet spawns waves and the curses fight back', () => {
  const w = new World({ mode: 'gauntlet', arena: 'shibuya', seed: 81, difficulty: 1 });
  const p = w.spawnPlayer('kingOfCurses', { x: 0, y: 0 });
  p.invulnerable = true;
  run(w, 30, (i, world) => {
    const t = world.nearestEnemy(p.pos, p.team, 40);
    if (t) {
      p.intent.aim = Math.atan2(t.pos.y - p.pos.y, t.pos.x - p.pos.x);
      p.intent.move.x = Math.cos(p.intent.aim);
      p.intent.move.y = Math.sin(p.intent.aim);
      if (i % 20 === 0) p.intent.attackTap = true;
    }
  });
  assert(w.wave >= 1, 'no wave started');
  assert(w.stats.kills > 0, 'the player killed nothing in 30 seconds');
});

test('the culling game closes its veil and resolves', () => {
  const w = new World({ mode: 'culling', arena: 'cullingIsland', seed: 91 });
  w.spawnPlayer('zeroPresence', { x: 0, y: 0 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    w.spawnSorcerer(ROSTER[i % ROSTER.length], { team: i + 2, x: Math.cos(a) * 20, y: Math.sin(a) * 20 });
  }
  const r0 = w.veilRadius;
  run(w, 25);
  assert(w.veilRadius < r0, 'the veil should be closing');
  for (const f of w.fighters) assert(isFinite(f.hp), 'a fighter left the number line');
});

test('summons obey their owner and expire', () => {
  const w = new World({ mode: 'training', arena: 'void', seed: 101 });
  const p = w.spawnPlayer('shadowHeir', { x: 0, y: 0 });
  w.spawnCurse('mantis', { x: 8, y: 0, team: 1 });
  p.ce = p.maxCe;
  w.executeAbility(p, p.abilityList()[0], 0);
  assert(w.countSummons(p) > 0, 'no shikigami summoned');
  run(w, 30);
  assert(w.countSummons(p) === 0, 'shikigami should expire');
});

// ---------------------------------------------------------------------------
console.log('— determinism —');

test('the same seed produces the same fight', () => {
  const play = () => {
    const w = new World({ mode: 'duel', arena: 'void', seed: 1234 });
    const p = w.spawnPlayer('kingOfCurses', { x: -5, y: 0 });
    w.spawnSorcerer('patchwork', { team: 1, x: 5, y: 0 });
    run(w, 8, (i) => {
      p.intent.aim = 0;
      p.intent.move.x = 1;
      if (i % 30 === 0) p.intent.attackTap = true;
    });
    return w.fighters.map((f) => `${f.name}:${f.hp.toFixed(4)}:${f.pos.x.toFixed(4)}`).join('|');
  };
  assert(play() === play(), 'identical seeds diverged');
});

// ---------------------------------------------------------------------------
console.log(results.join('\n'));
console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
