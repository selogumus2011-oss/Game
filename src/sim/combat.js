// The damage pipeline — and Black Flash.
//
// Every source of damage in the game (melee swing, projectile, beam, domain
// sure-hit, command) ends up in dealDamage(). The order of operations matters
// and is deliberately explicit:
//
//   iframes -> technique nullification (Infinity) -> Simple Domain counter ->
//   parry -> block -> reinforcement -> combo scaling -> Black Flash ->
//   crit / weak point -> shields -> application
//
// Black Flash is the centrepiece. In the source material it is a distortion of
// space caused by landing a hit within 0.000001 seconds of the cursed energy
// impact. Here it is a timing band: land your *next* hit while the band is open
// and space distorts. The band is narrow, it moves with your stats, and
// chaining them is the highest-skill expression in the game.

import { clamp, clamp01, lerp, vdist, vnorm, vsub, wrapAngle, vangle, rand } from '../core/math.js';
import { addStatus, absorbShield, hasStatus, getStatus } from './status.js';

// --- Black Flash tuning -----------------------------------------------------
export const FLASH = {
  windowDur: 0.62,      // how long the timing ring runs after a landed hit
  bandStart: 0.20,      // when the "flash band" opens, in seconds
  bandBase: 0.105,      // base band width
  bandPerControl: 0.075,
  bandPerFlow: 0.085,
  failShrink: 0.86,     // band narrows on a miss...
  failFloor: 0.55,      // ...down to this fraction
  chainBonus: 0.16,     // damage multiplier added per consecutive flash
  baseMultiplier: 2.5,
  ceReward: 30,
  flowReward: 0.36,
  hitstop: 0.3,
};

/** Open (or refresh) the Black Flash timing window on an attacker. */
export function openFlashWindow(f, { wide = 0, reason = 'hit' } = {}) {
  const fw = f.flashWindow;
  const control = f.stats.ceControl ?? 0.5;
  const band =
    (FLASH.bandBase + FLASH.bandPerControl * control + FLASH.bandPerFlow * f.flow) *
    (1 + f.mods.flashBand + (f.tool?.flashBand ?? 0) * 8 + wide) *
    (fw.failScale ?? 1);
  fw.active = true;
  fw.t = 0;
  fw.dur = FLASH.windowDur;
  fw.start = FLASH.bandStart;
  fw.band = clamp(band, 0.05, 0.42);
  fw.reason = reason;
  fw.ticked = false;
}

export function closeFlashWindow(f, failed) {
  const fw = f.flashWindow;
  fw.active = false;
  if (failed) {
    fw.failScale = Math.max(FLASH.failFloor, (fw.failScale ?? 1) * FLASH.failShrink);
    fw.failTimer = 4;
  }
}

/** Is the window currently inside its band? */
export function inFlashBand(f) {
  const fw = f.flashWindow;
  return fw.active && fw.t >= fw.start && fw.t <= fw.start + fw.band;
}

export function flashWindowPhase(f) {
  const fw = f.flashWindow;
  if (!fw.active) return null;
  return {
    t: fw.t / fw.dur,
    bandStart: fw.start / fw.dur,
    bandEnd: (fw.start + fw.band) / fw.dur,
    chain: fw.chain,
  };
}

// --- Reinforcement ----------------------------------------------------------

/**
 * Cursed energy reinforcement: the passive layer of energy every sorcerer keeps
 * over their body. It is the single biggest reason a sorcerer survives a hit
 * that would kill a person, and it is why running your energy dry is fatal.
 */
export function reinforcement(f) {
  if (f.stats.maxCe <= 0) return 0;            // Heavenly Restriction
  if (f.flags.burnout) return 0.04;
  const fill = clamp01(f.ce / Math.max(1, f.maxCe));
  const control = f.stats.ceControl ?? 0.5;
  let r = 0.06 + 0.34 * fill * (0.55 + 0.65 * control) + f.mods.reinforce;
  if (f.state === 'block') r += 0.2;
  if (f.state === 'stagger' || f.state === 'knockdown') r *= 0.45;
  return clamp(r, 0, 0.72);
}

// --- Hit construction -------------------------------------------------------

export function makeHit(attacker, opts) {
  return Object.assign({
    damage: 0, poise: 0, knock: 0, lift: 0, pull: 0,
    tags: [], physical: false, sureHit: false, pierceInfinity: false,
    ignoreReinforce: 0, unblockable: false, guardBreak: false,
    projectile: false, angle: attacker ? attacker.facing : 0,
    pos: attacker ? { x: attacker.pos.x, y: attacker.pos.y } : { x: 0, y: 0 },
    status: null, hitstop: 0.05, sourceName: '', crit: false,
    reinforceMul: 1, blackFlash: false, actionId: null,
  }, opts);
}

// --- The pipeline -----------------------------------------------------------

/**
 * @returns {Object} result — {hit:boolean, damage, blocked, parried, negated, blackFlash}
 */
export function dealDamage(world, attacker, victim, hitIn) {
  const result = { hit: false, damage: 0, blocked: false, parried: false, negated: false, blackFlash: false, killed: false };
  if (!victim || victim.dead || victim.invulnerable) return result;
  if (attacker && attacker === victim && !hitIn.selfDamage) return result;

  const hit = makeHit(attacker, hitIn);
  hit.pos = hit.pos || { x: victim.pos.x, y: victim.pos.y };

  // 0. Attack direction, used for backstabs, block arcs and knockback.
  const dir = attacker ? vnorm(vsub(victim.pos, attacker.pos)) : { x: Math.cos(hit.angle), y: Math.sin(hit.angle) };
  if (dir.x === 0 && dir.y === 0) { dir.x = Math.cos(hit.angle); dir.y = Math.sin(hit.angle); }
  const incomingAngle = Math.atan2(dir.y, dir.x);
  hit.angle = incomingAngle;

  // 1. Invulnerability frames from dashes / wake-up.
  if (victim.iframes > 0 && !hit.sureHit) {
    world.fx('dodge', { pos: victim.pos, z: victim.z, angle: incomingAngle });
    victim.flow = clamp01(victim.flow + 0.035);
    if (victim.isPlayer) world.notify('Dodged', '#9fe870');
    return result;
  }

  // 2. Innate negation: Infinity and friends.
  if (victim.technique?.passive?.onIncomingHit) {
    const negated = victim.technique.passive.onIncomingHit({
      world, self: victim, attacker, hit, dt: world.dt,
    });
    if (negated === true) {
      result.negated = true;
      world.event({ type: 'negate', victim: victim.id, attacker: attacker?.id, pos: hit.pos });
      return result;
    }
  }

  // 3. Simple Domain — a 2.21m circle that neutralises sure-hits and answers
  //    anything that crosses the line.
  if (victim.simpleDomain.active && !hit.ignoreSimpleDomain) {
    if (hit.sureHit) {
      hit.sureHit = false;
      hit.damage *= 0.35;
      world.fx('simpleNegate', { pos: victim.pos, z: victim.z });
    }
    if (victim.simpleDomain.counterCd <= 0 && !hit.projectile) {
      victim.simpleDomain.counterCd = 0.34;
      world.simpleDomainCounter(victim, attacker);
    } else if (victim.simpleDomain.counterCd <= 0 && hit.projectile) {
      victim.simpleDomain.counterCd = 0.28;
      world.fx('simpleNegate', { pos: hit.pos, z: victim.z });
      world.audio('slash', { volume: 0.5, pitch: 1.4 });
      return result; // the counter slash cuts the projectile out of the air
    }
  }

  // 4. Domain Amplification wraps the body in barrier: techniques fizzle.
  if (victim.amplify.active && hit.tags.includes('technique') && !hit.pierceAmplification) {
    hit.damage *= 0.25;
    hit.status = null;
    world.fx('amplifyNegate', { pos: hit.pos, z: victim.z });
  }

  // 5. Parry — the highest-value defensive option in the game.
  const facingDot = Math.abs(wrapAngle(incomingAngle + Math.PI - victim.facing));
  const facingIt = facingDot < 1.5;
  if (victim.parryTimer > 0 && !hit.unblockable && facingIt && !hit.projectileUnparryable) {
    victim.parryTimer = 0;
    result.parried = true;
    onParry(world, victim, attacker, hit);
    return result;
  }

  // 6. Block.
  let blockMul = 1;
  if (victim.state === 'block' && !hit.unblockable && facingIt) {
    result.blocked = true;
    blockMul = hit.guardBreak ? 0.55 : 0.28;
    victim.poise -= hit.poise * (hit.guardBreak ? 1.6 : 0.9);
    victim.ce += Math.min(6, hit.damage * 0.12);
    world.fx('block', { pos: hit.pos, z: victim.z, angle: incomingAngle });
    world.audio('blocked', { volume: 0.7, throttle: 40 });
    if (victim.poise <= 0) {
      guardBreak(world, victim, attacker);
      blockMul = 1.0;
    }
  }

  // 6b. Attacker passives get their say *before* the numbers are computed.
  //     This is where soul-piercing, mass accumulation and similar rules live;
  //     onOutgoingHit at the end of the pipeline is too late to change damage.
  if (attacker?.technique?.passive?.onPreHit) {
    attacker.technique.passive.onPreHit({ world, self: attacker, victim, hit, dt: world.dt });
  }
  if (attacker?.tool?.onPreHit) attacker.tool.onPreHit({ world, self: attacker, victim, hit });

  // 7. Reinforcement.
  const ignore = clamp01(hit.ignoreReinforce || 0);
  const reinforce = reinforcement(victim) * (1 - ignore) * (hit.reinforceMul ?? 1);
  let damage = hit.damage * blockMul * (1 - reinforce);

  // 8. Attacker-side multipliers.
  if (attacker) {
    const physical = hit.physical || hit.tags.includes('physical');
    let out = 1 + attacker.mods.output + (physical ? attacker.mods.physical : attacker.mods.technique);
    out *= attacker.vowMods ? (1 + (physical ? attacker.vowMods.physicalOutput : attacker.vowMods.techniqueOutput)) : 1;
    out *= attacker.stats.power ?? 1;
    if (attacker.flags.overtime) out *= 1.1;
    damage *= out;

    // Combo scaling keeps infinite loops from being optimal.
    const comboScale = Math.max(0.42, Math.pow(0.965, Math.max(0, attacker.combo.count - 2)));
    damage *= comboScale;

    // Wounds: a broken arm really does reduce your output.
    damage *= 1 - clamp01((attacker.wounds.arms || 0) * 0.3);
  }

  // 9. Black Flash check — physical hits only, and never on a block.
  if (attacker && hit.physical && !result.blocked && attacker.canBlackFlash && !hit.noFlash) {
    if (inFlashBand(attacker)) {
      result.blackFlash = true;
      hit.blackFlash = true;
      const chain = attacker.flashWindow.chain;
      damage *= FLASH.baseMultiplier * (1 + chain * FLASH.chainBonus);
      hit.poise *= 2.6;
      hit.knock *= 1.7;
      onBlackFlash(world, attacker, victim, hit);
    } else if (attacker.flashWindow.active) {
      closeFlashWindow(attacker, true);
      if (attacker.isPlayer) world.event({ type: 'flashMiss', attacker: attacker.id });
    }
    openFlashWindow(attacker, { reason: 'hit' });
  }

  // 10. Crits: weak points, backstabs, stagger punishes.
  let critMul = 1;
  if (hasStatus(victim, 'weakPoint')) { critMul *= 1.6; hit.crit = true; }
  if (hit.backstab) {
    const behind = Math.abs(wrapAngle(incomingAngle - victim.facing)) < 0.9;
    if (behind) { critMul *= hit.backstab; hit.crit = true; }
  }
  if (victim.state === 'stagger' || victim.state === 'knockdown') critMul *= 1.3;
  if (victim.z > 0.8 && hit.juggle !== false) critMul *= 1.08;
  critMul += victim.mods.critTaken * 0.5;
  damage *= critMul;

  // 11. Victim-side damage taken modifiers and shields.
  damage *= 1 + victim.mods.damageTaken;
  if (victim.resist) {
    for (const tag of hit.tags) {
      const r = victim.resist[tag];
      if (r) damage *= 1 - clamp01(r);
    }
  }
  damage = Math.max(0, damage);
  damage = absorbShield(victim, damage);

  // 12. Apply.
  const before = victim.hp;
  victim.hp -= damage;
  victim.lastHitBy = attacker ? attacker.id : null;
  victim.lastHitTime = world.time;
  victim.timeSinceHit = 0;
  result.hit = true;
  result.damage = damage;

  // Poise / stagger.
  if (!result.blocked) {
    const armor = victim.actionFlags.superArmor ? 0.25 : 1;
    victim.poise -= hit.poise * armor;
    if (victim.poise <= 0 && !victim.actionFlags.superArmor) stagger(world, victim, hit);
  }

  // Knockback and launch.
  if (!result.blocked || hit.guardBreak) {
    const weight = Math.max(0.35, victim.stats.weight ?? 1);
    const kb = (hit.knock || 0) / weight;
    victim.vel.x += dir.x * kb;
    victim.vel.y += dir.y * kb;
    if (hit.lift) {
      victim.vz = Math.max(victim.vz, hit.lift / weight);
      if (hit.lift < 0 && victim.z > 0.2) victim.vz = hit.lift; // spike
      victim.airborne = true;
    }
    if (hit.pull && attacker) {
      const pd = vnorm(vsub(attacker.pos, victim.pos));
      victim.vel.x += pd.x * hit.pull / weight;
      victim.vel.y += pd.y * hit.pull / weight;
    }
  }

  // Statuses.
  if (hit.status && !result.blocked) addStatus(victim, Object.assign({}, hit.status));
  if (hit.burn) addStatus(victim, { type: 'burn', time: hit.burn.time, power: hit.burn.dps });

  // Cursed energy economy.
  if (attacker) {
    attacker.ce = Math.min(attacker.maxCe, attacker.ce + damage * 0.3 * (1 + attacker.mods.ceGain));
    attacker.combo.count++;
    attacker.combo.timer = 2.2;
    attacker.combo.damage += damage;
    attacker.timeSinceDealt = 0;
    attacker.flow = clamp01(attacker.flow + 0.014);
    if (attacker.technique?.passive?.onOutgoingHit) {
      attacker.technique.passive.onOutgoingHit({ world, self: attacker, victim, hit, dt: world.dt });
    }
    if (attacker.tool?.onHit) attacker.tool.onHit({ world, self: attacker, victim, hit });
    if (attacker.tool?.ceDrain) {
      const drained = Math.min(victim.ce, attacker.tool.ceDrain);
      victim.ce -= drained;
    }
    if (attacker.tool?.fragmentBonus) {
      addStatus(victim, { type: 'fragment', time: 20, power: attacker.tool.fragmentBonus, stack: true, max: 8 });
    }
  }
  victim.ce = Math.min(victim.maxCe, victim.ce + damage * 0.18);
  victim.flow = clamp01(victim.flow + 0.008);

  // Mahoraga-style adaptation: repeated exposure to the same tag stops working.
  if (victim.adapts) adaptTo(world, victim, hit);

  // Presentation events.
  const kind = result.blackFlash ? 'blackflash' : result.blocked ? 'block' : hit.crit ? 'crit' : 'hit';
  world.event({
    type: 'damage', kind, attacker: attacker?.id, victim: victim.id,
    damage, pos: { x: victim.pos.x, y: victim.pos.y }, z: victim.z + 1.0,
    angle: incomingAngle, blackFlash: result.blackFlash, crit: hit.crit,
    tags: hit.tags, sourceName: hit.sourceName,
    // Identity, so the presentation layer can draw this technique's own
    // signature rather than a generic puff in the technique's colour.
    abilityId: hit.abilityId || null,
    techniqueId: attacker?.technique?.id || null,
  });

  if (!result.blackFlash) {
    const big = damage > 26 || hit.guardBreak;
    world.hitstopFor(hit.hitstop * (big ? 1.6 : 1));
    world.audio(big ? 'hitHeavy' : (hit.hitSfx || 'hit'), {
      volume: clamp(0.45 + damage / 90, 0.4, 1), throttle: 25,
      pitch: lerp(1.25, 0.82, clamp01(damage / 60)),
    });
    world.shake(clamp(1.5 + damage * 0.16, 1.5, 11), 0.18);
  }

  if (victim.hp <= 0 && before > 0) {
    result.killed = true;
    world.killFighter(victim, attacker, hit);
  }
  return result;
}

// --- Reaction helpers -------------------------------------------------------

function onParry(world, victim, attacker, hit) {
  victim.ce = Math.min(victim.maxCe, victim.ce + 18 * (1 + (victim.vowMods?.parryRefund ?? 0)));
  victim.flow = clamp01(victim.flow + 0.14);
  victim.poise = Math.min(victim.maxPoise, victim.poise + hit.poise * 0.8 + 12);
  victim.parrySuccess = 0.5;
  victim.perfectParries++;
  // A parry is the cleanest way into a Black Flash: the window opens wide.
  openFlashWindow(victim, { wide: 0.55, reason: 'parry' });
  if (attacker && !attacker.actionFlags.superArmor) {
    attacker.poise -= 40;
    stagger(world, attacker, { poise: 40 }, 0.62);
    attacker.vel.x *= 0.2;
    attacker.vel.y *= 0.2;
  }
  world.hitstopFor(0.13);
  world.slowmo(0.35, 0.16);
  world.shake(6, 0.2);
  world.audio('parry', { volume: 0.95 });
  world.fx('parry', { pos: hit.pos, z: victim.z + 1, angle: hit.angle });
  world.event({ type: 'parry', victim: victim.id, attacker: attacker?.id, pos: victim.pos });
  if (victim.isPlayer) world.notify('PERFECT PARRY', '#ffd166');
}

export function stagger(world, f, hit, time = 0.85) {
  if (f.actionFlags.superArmor) return;
  f.state = 'stagger';
  f.stateTime = 0;
  f.staggerTime = time;
  f.action = null;
  f.poise = 0;
  f.poiseRecoverDelay = 1.1;
  f.combo.count = 0;
  closeFlashWindow(f, false);
  world.event({ type: 'stagger', victim: f.id, pos: f.pos });
}

function guardBreak(world, victim, attacker) {
  victim.state = 'stagger';
  victim.stateTime = 0;
  victim.staggerTime = 1.25;
  victim.poise = 0;
  victim.poiseRecoverDelay = 1.6;
  victim.action = null;
  world.audio('guardBreak', { volume: 0.9 });
  world.fx('guardBreak', { pos: victim.pos, z: victim.z + 1 });
  world.shake(9, 0.3);
  world.event({ type: 'guardBreak', victim: victim.id });
  if (victim.isPlayer) world.notify('GUARD BROKEN', '#ff4d4d');
}

function onBlackFlash(world, attacker, victim, hit) {
  const fw = attacker.flashWindow;
  fw.chain++;
  fw.failScale = 1;
  attacker.blackFlashCount++;
  attacker.bestChain = Math.max(attacker.bestChain, fw.chain);
  attacker.ce = Math.min(attacker.maxCe, attacker.ce + FLASH.ceReward);
  attacker.flow = clamp01(attacker.flow + FLASH.flowReward);
  addStatus(attacker, { type: 'overdrive', time: 12 });
  world.hitstopFor(FLASH.hitstop);
  world.slowmo(0.14, 0.55);
  world.shake(20, 0.55);
  world.audio('blackflash', { volume: 1 });
  world.fx('blackflash', {
    pos: { x: victim.pos.x, y: victim.pos.y }, z: victim.z + 1.1,
    angle: hit.angle, chain: fw.chain, owner: attacker.id,
  });
  world.event({ type: 'blackflash', attacker: attacker.id, victim: victim.id, chain: fw.chain });
  if (attacker.isPlayer) {
    world.notify(fw.chain > 1 ? `BLACK FLASH ×${fw.chain}` : 'BLACK FLASH', '#ff2d2d');
    world.banner(fw.chain > 1 ? `Black Flash — chain ${fw.chain}` : 'Black Flash', '#ff2d2d', 1.5);
  }
}

function adaptTo(world, victim, hit) {
  const key = hit.tags[0] || (hit.physical ? 'physical' : 'technique');
  victim.adaptation = victim.adaptation || {};
  victim.adaptation[key] = (victim.adaptation[key] || 0) + 1;
  const n = victim.adaptation[key];
  if (n === 8 || n === 16 || n === 24) {
    addStatus(victim, { type: 'adaptation', time: 9999, power: Math.min(0.75, n / 32) });
    world.fx('adapt', { pos: victim.pos, z: victim.z + 1.4 });
    world.audio('warn', { volume: 0.8 });
    world.banner(`Adapted to ${key}`, '#c8b06a', 1.4);
  }
}

// --- Utility used by the world for melee swings ------------------------------

/** Everything the swing can reach, sorted nearest first. */
export function targetsInArc(world, attacker, { origin, angle, range, halfArc, maxTargets = 8, heightRange = 3.2 }) {
  const out = [];
  for (const f of world.fighters) {
    if (f === attacker || f.dead) continue;
    if (f.team === attacker.team && !f.decoy) continue;
    const d = vdist(origin, f.pos);
    if (d > range + f.radius) continue;
    if (Math.abs(f.z - attacker.z) > heightRange) continue;
    const a = vangle(vsub(f.pos, origin));
    const widen = d > 0.01 ? Math.asin(clamp(f.radius / Math.max(d, f.radius), 0, 1)) : Math.PI;
    if (Math.abs(wrapAngle(a - angle)) > halfArc + widen) continue;
    out.push({ f, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out.slice(0, maxTargets).map((o) => o.f);
}
