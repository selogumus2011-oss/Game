// Aim assist, checked against the promises the module makes.
//
// The interesting cases are the ones where assist must NOT fire: a target
// behind you, a target you are pointedly aiming away from, an ally. Those are
// what stop assist feeling like the game is playing for you.

import { World } from '../src/sim/world.js';
import { assistedAim, bestTarget, hitGenerosity } from '../src/sim/assist.js';

let pass = 0;
let fail = 0;
function ok(name, cond, extra = '') {
  if (cond) { pass++; console.log('  ok  ', name); }
  else { fail++; console.log('  FAIL', name, extra); }
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function makeWorld() {
  const w = new World({ mode: 'training', arena: 'void', seed: 1 });
  const p = w.spawnPlayer('yuji', { x: 0, y: 0, team: 0 });
  p.facing = 0;
  p.aim = 0;
  return { w, p };
}

// --- capture ---------------------------------------------------------------
{
  const { w, p } = makeWorld();
  // Straight ahead in +x, then 20 degrees off it.
  const e = w.spawnCurse('larva', { x: 6, y: 0, team: 1 });
  e.pos.x = 6 * Math.cos(0.35);
  e.pos.y = 6 * Math.sin(0.35);
  p.aimAssist = 1;
  const out = assistedAim(w, p, 0, 8, 1);
  ok('a target inside the cone pulls the aim toward it', out > 0.0001 && out <= 0.35 + 1e-9,
     `got ${out.toFixed(3)}`);
  ok('the pull never overshoots the target', out <= 0.35 + 1e-9, `got ${out.toFixed(3)}`);
}

// --- the cap ---------------------------------------------------------------
{
  const { w, p } = makeWorld();
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = 6 * Math.cos(0.44);
  e.pos.y = 6 * Math.sin(0.44);
  const out = assistedAim(w, p, 0, 8, 1);
  ok('correction is capped well short of the capture cone', out <= 0.301,
     `got ${out.toFixed(3)}`);
  ok('an edge-of-cone target still leaves a gap', out < 0.44,
     `got ${out.toFixed(3)} vs target at 0.44`);
}

// --- refusals --------------------------------------------------------------
{
  const { w, p } = makeWorld();
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = 4 * Math.cos(1.2);
  e.pos.y = 4 * Math.sin(1.2);
  ok('a target outside the cone is not captured', bestTarget(w, p, 0, 8) === null);
  ok('and the aim is returned untouched', near(assistedAim(w, p, 0, 8, 1), 0));
}
{
  const { w, p } = makeWorld();
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = -5; e.pos.y = 0;
  ok('a target directly behind is not captured', bestTarget(w, p, 0, 8) === null);
}
{
  const { w, p } = makeWorld();
  const ally = w.spawnSorcerer('yuji', { team: 0, x: 5, y: 0 });
  ally.pos.x = 5; ally.pos.y = 0.3;
  ok('an ally is never captured', bestTarget(w, p, 0, 8) === null);
}
{
  const { w, p } = makeWorld();
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = 40; e.pos.y = 0;
  ok('a target past the move\'s reach is not captured', bestTarget(w, p, 0, 4) === null);
}

// --- strength --------------------------------------------------------------
{
  const { w, p } = makeWorld();
  const e = w.spawnCurse('larva', { team: 1 });
  e.pos.x = 6 * Math.cos(0.3);
  e.pos.y = 6 * Math.sin(0.3);
  ok('strength 0 disables assist entirely', near(assistedAim(w, p, 0, 8, 0), 0));
  const half = assistedAim(w, p, 0, 8, 0.5);
  const full = assistedAim(w, p, 0, 8, 1);
  ok('strength scales the correction', half > 0 && half < full,
     `half ${half.toFixed(3)} full ${full.toFixed(3)}`);
}

// --- preferring the centred target over the near one -----------------------
{
  const { w, p } = makeWorld();
  const near_ = w.spawnCurse('larva', { team: 1 });
  near_.pos.x = 2 * Math.cos(0.4); near_.pos.y = 2 * Math.sin(0.4);
  const ahead = w.spawnCurse('larva', { team: 1 });
  ahead.pos.x = 8; ahead.pos.y = 0.05;
  ok('the target you are pointing at wins over a closer one off to the side',
     bestTarget(w, p, 0, 10) === ahead);
}

// --- generosity is player-only --------------------------------------------
{
  const { w, p } = makeWorld();
  const e = w.spawnCurse('larva', { team: 1 });
  e.aimAssist = 1;
  ok('the player gets widened reach', hitGenerosity(p, 1).range > 0);
  ok('an AI fighter never does', hitGenerosity(e, 1).range === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
