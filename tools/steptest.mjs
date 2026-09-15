// Animating on twos, checked by counting drawings.
//
// The claim is that the pose changes on the hold rather than every frame. That
// is measurable: sample a joint sixty times a second and count how many
// distinct values come back. On threes it should be about an eighth of them,
// on ones all of them, and during the strike of an attack it should be all of
// them — a snap that got quantised would land soft.

import { World } from '../src/sim/world.js';
import { pose3, updateRig3 } from '../src/r3d/pose3.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
}

const DT = 1 / 60;

/** Run `frames` frames and report how many distinct hand positions appeared. */
function sample(setup, frames = 60) {
  const w = new World({ mode: 'training', arena: 'void', seed: 7 });
  const p = w.spawnPlayer('yuji', { x: 0, y: 0, team: 0 });
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = 2; e.pos.y = 0;
  setup(p, w);
  const seen = new Set();
  let t = 0;
  for (let i = 0; i < frames; i++) {
    w.update(DT);
    t += DT;
    updateRig3(p, DT, null);
    const sk = pose3(p, t);
    seen.add(`${sk.hR.x.toFixed(4)},${sk.hR.y.toFixed(4)},${sk.hR.z.toFixed(4)}`);
  }
  return { distinct: seen.size, frames };
}

// --- a walk, which should sit on threes -------------------------------------
{
  const r = sample((p) => {
    p.intent.move.x = 1;
    p.intent.move.y = 0;
  }, 60);
  ok('a walk holds its drawings', r.distinct < 30,
     `${r.distinct} distinct poses in ${r.frames} frames`);
  ok('and still animates', r.distinct > 3, `${r.distinct} distinct`);
}

// --- an idle, which should hold hardest --------------------------------------
{
  const r = sample(() => {}, 60);
  ok('an idle holds too', r.distinct < 30, `${r.distinct} distinct`);
}

// --- the strike, which must not be held --------------------------------------
{
  // Count distinct poses only across the active window of a swing.
  const w = new World({ mode: 'training', arena: 'void', seed: 7 });
  const p = w.spawnPlayer('yuji', { x: 0, y: 0, team: 0 });
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = 2; e.pos.y = 0;
  p.startAction('heavy');
  const seen = new Set();
  let active = 0;
  let t = 0;
  for (let i = 0; i < 90; i++) {
    w.update(DT);
    t += DT;
    updateRig3(p, DT, null);
    const a = p.action;
    const sk = pose3(p, t);
    if (a && a.t >= a.def.startup && a.t < a.def.startup + a.def.active) {
      active++;
      seen.add(`${sk.hR.x.toFixed(4)},${sk.hR.y.toFixed(4)},${sk.hR.z.toFixed(4)}`);
    }
  }
  ok('the strike itself is drawn every frame', active > 0 && seen.size === active,
     `${seen.size} distinct across ${active} active frames`);
}

// --- the root stays smooth ---------------------------------------------------
{
  const w = new World({ mode: 'training', arena: 'void', seed: 7 });
  const p = w.spawnPlayer('yuji', { x: 0, y: 0, team: 0 });
  p.intent.move.x = 1;
  const xs = new Set();
  for (let i = 0; i < 40; i++) {
    w.update(DT);
    updateRig3(p, DT, null);
    xs.add(p.pos.x.toFixed(5));
  }
  ok('the root position is not stepped', xs.size > 35,
     `${xs.size} distinct x in 40 frames — stepping position reads as input lag`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
