// Aim assist.
//
// Playing this with a mouse is fine. Playing it on a tablet, with a thumb on
// half the screen and a camera that orbits, is not: you commit to a swing and
// the swing goes past the shoulder of the thing you were obviously aiming at.
// So at the moment you commit — not continuously, which feels like the game
// is steering — the aim gets pulled toward the best candidate in front of you.
//
// Two rules keep it honest:
//
//   * It never picks a target you were not already pointing at. The capture
//     cone is narrow, and a target outside it is ignored no matter how close.
//   * It never turns you further than CORRECTION_CAP. A target inside the cone
//     but at its edge gets a partial correction, so a deliberate miss stays a
//     miss and a near-miss becomes a hit.
//
// The result is that the aim you already had is respected and only the last
// few degrees are given to you.

import { vangle, vsub, vdist, wrapAngle, clamp } from '../core/math.js';

/** Widest angular error that can still capture a target, in radians. */
const CAPTURE_CONE = 0.46;
/** Hard ceiling on how far assist may turn you. */
const CORRECTION_CAP = 0.30;
/** Beyond the move's own reach, how much further we still look. */
const RANGE_SLACK = 1.4;

/**
 * Pick the target the fighter most plausibly meant, or null.
 *
 * Scoring prefers centred targets over near ones: a curse dead ahead at 8m
 * beats one at 2m that you would have to turn 25 degrees to reach, because
 * the near one is the one you are walking past.
 */
export function bestTarget(world, self, aim, range) {
  const reach = range + RANGE_SLACK;
  let best = null;
  let bestScore = Infinity;
  for (const f of world.fighters) {
    if (f === self || f.dead) continue;
    if (f.team === self.team && !f.decoy) continue;
    if (f.untargetable) continue;
    const d = vdist(self.pos, f.pos);
    if (d > reach + f.radius) continue;
    if (Math.abs(f.z - self.z) > 4) continue;
    // A wide target subtends a wider angle, so it forgives more error.
    const widen = Math.asin(clamp(f.radius / Math.max(d, f.radius), 0, 1));
    const err = Math.abs(wrapAngle(vangle(vsub(f.pos, self.pos)) - aim));
    const effErr = Math.max(0, err - widen);
    if (effErr > CAPTURE_CONE) continue;
    const score = effErr + d * 0.02;
    if (score < bestScore) { bestScore = score; best = f; }
  }
  return best;
}

/**
 * The aim angle to actually use, given the one the player asked for.
 *
 * `strength` is 0..1 and comes from settings, so the whole feature can be
 * dialled down to nothing without a branch at every call site.
 */
export function assistedAim(world, self, aim, range, strength = 1) {
  if (!(strength > 0)) return aim;
  const target = bestTarget(world, self, aim, range);
  if (!target) return aim;
  const want = vangle(vsub(target.pos, self.pos));
  const delta = wrapAngle(want - aim);
  const capped = clamp(delta, -CORRECTION_CAP, CORRECTION_CAP);
  return wrapAngle(aim + capped * strength);
}

/**
 * How much the hitbox of a swing is widened for this attacker.
 *
 * Only the human player gets this, and only against things that can fight
 * back — an enemy landing a generous hit on you reads as the game cheating.
 * Returned as a pair because reach and arc want different amounts: a bit more
 * reach barely shows, whereas a lot more arc turns every swing into a sweep.
 */
export function hitGenerosity(self, strength = 1) {
  if (!self.isPlayer || !(strength > 0)) return { range: 0, arc: 0 };
  return { range: 0.55 * strength, arc: 0.16 * strength };
}
