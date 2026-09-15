// Technique runtime: turns the declarative ability data into simulation events.
//
// Archetypes:
//   projectile  — one or more travelling objects
//   beam        — instantaneous line (Dismantle, Piercing Blood)
//   melee       — a technique-flavoured cone attack
//   aoe         — a burst centred on the caster or the target
//   command     — a ranged cone that applies damage + a status (Cursed Speech)
//   buff        — a status on the caster
//   summon      — shikigami / curses / transfigured humans
//   dashStrike  — reposition, then hit what you land on
//   zone        — a persistent hazard field
//   custom      — behaviour lives entirely in the ability's onCast hook

import {
  clamp, clamp01, vec, vadd, vsub, vscale, vnorm, vlen, vdist, vangle,
  vfromAngle, wrapAngle, distToSegment, rand, randRange, TAU, PI,
} from '../core/math.js';
import { addStatus } from './status.js';

export function executeAbility(world, caster, ability, aim) {
  const origin = { x: caster.pos.x, y: caster.pos.y };
  const ctx = {
    world, self: caster, ability, aim,
    dir: vfromAngle(aim), origin,
    target: world.nearestEnemy(caster.pos, caster.team, 40),
  };

  let handled = false;
  switch (ability.archetype) {
    case 'projectile': handled = castProjectile(ctx); break;
    case 'beam': handled = castBeam(ctx); break;
    case 'melee': handled = castMelee(ctx); break;
    case 'aoe': handled = castAoe(ctx); break;
    case 'command': handled = castCommand(ctx); break;
    case 'buff': handled = castBuff(ctx); break;
    case 'summon': handled = castSummon(ctx); break;
    case 'dashStrike': handled = castDashStrike(ctx); break;
    case 'zone': handled = castZone(ctx); break;
    case 'custom': handled = true; break;
    default: handled = false;
  }

  if (ability.onCast) {
    const r = ability.onCast(ctx);
    if (r === false && !handled) return false;
  }

  world.event({ type: 'ability', fighter: caster.id, ability: ability.id, pos: origin });
  return true;
}

// ---------------------------------------------------------------------------

function castProjectile(ctx) {
  const { world, self, ability, aim } = ctx;
  const p = ability.projectile || {};
  const count = p.count || 1;
  const spread = p.spread || 0;
  const muzzle = vadd(ctx.origin, vfromAngle(aim, 0.9));
  for (let i = 0; i < count; i++) {
    const off = count > 1 ? (i / (count - 1) - 0.5) * 2 * spread : 0;
    const jitter = count > 1 ? world.rng.range(-spread * 0.2, spread * 0.2) : 0;
    world.spawnProjectile(self, Object.assign({}, p, {
      pos: { x: muzzle.x, y: muzzle.y },
      angle: aim + off + jitter,
      z: self.z + 1.05,
      tags: ability.tags || ['technique'],
      sourceName: ability.name, abilityId: ability.id,
      ability,
      onHit: ability.onHit ? (e) => ability.onHit(Object.assign({}, ctx, e)) : null,
      pierceInfinity: p.pierceInfinity || ability.pierceInfinity,
      ignoreReinforce: p.ignoreReinforce || ability.ignoreReinforce || 0,
    }));
  }
  return true;
}

function castBeam(ctx) {
  const { world, self, ability, aim } = ctx;
  const shots = ability.multi || 1;
  for (let i = 0; i < shots; i++) {
    const off = shots > 1 ? (i - (shots - 1) / 2) * (ability.spread || 0.12) : 0;
    const a = aim + off;
    const from = vadd(ctx.origin, vfromAngle(a, 0.8));
    const to = vadd(ctx.origin, vfromAngle(a, ability.length || 10));
    const hits = beamTargets(world, self, from, to, (ability.width || 1) * 0.5);
    for (const f of hits) {
      world.dealDamage(self, f, {
        damage: ability.damage, poise: ability.poise, knock: ability.knock || 0,
        lift: ability.lift || 0, tags: ability.tags || ['technique'],
        ignoreReinforce: ability.ignoreReinforce ? 1 : 0,
        pierceInfinity: !!ability.pierceInfinity, sureHit: !!ability.sureHit,
        status: ability.status ? Object.assign({}, ability.status) : null,
        pos: { x: f.pos.x, y: f.pos.y }, angle: a,
        hitstop: 0.07, sourceName: ability.name, abilityId: ability.id,
      });
      if (ability.onHit) ability.onHit(Object.assign({}, ctx, { victim: f }));
    }
    world.fx('beam', {
      from, to, width: ability.width || 1, color: ability.color || self.technique?.color,
      vfx: ability.vfx || 'beam', life: 0.28,
      // Where the line actually connected, so a slash can be drawn on whoever
      // it cut rather than at the arbitrary midpoint of its reach.
      focus: hits.length ? { x: hits[0].pos.x, y: hits[0].pos.y, z: hits[0].z + hits[0].height * 0.55 } : null,
    });
    // Beams scar the arena.
    for (const prop of world.props) {
      if (prop.destroyed) continue;
      if (distToSegment(prop.pos, from, to) < (ability.width || 1) * 0.5 + prop.radius) {
        world.damageProp(prop, ability.damage, prop.pos);
      }
    }
  }
  world.shake(clamp(ability.damage * 0.12, 2, 10), 0.25);
  return true;
}

function beamTargets(world, self, from, to, halfWidth) {
  const out = [];
  for (const f of world.fighters) {
    if (f.dead || f === self) continue;
    if (f.team === self.team && !f.decoy) continue;
    if (distToSegment(f.pos, from, to) <= halfWidth + f.radius) out.push(f);
  }
  return out;
}

function castMelee(ctx) {
  const { world, self, ability, aim } = ctx;
  const shots = ability.multi || 1;
  const delay = ability.multiDelay || 0.07;
  for (let i = 0; i < shots; i++) {
    const fire = () => {
      if (self.dead) return;
      const origin = vadd(self.pos, vfromAngle(self.facing, 0.4));
      const targets = world.coneTargets(self, origin, self.facing, ability.range || 2.4, ability.halfArc || 0.9);
      for (const f of targets) {
        world.dealDamage(self, f, {
          damage: ability.damage, poise: ability.poise, knock: ability.knock || 0,
          lift: ability.lift || 0, tags: ability.tags || ['technique', 'physical'],
          physical: (ability.tags || []).includes('physical'),
          ignoreReinforce: ability.ignoreReinforce || 0,
          pierceInfinity: !!ability.pierceInfinity,
          guardBreak: !!ability.guardBreak,
          status: ability.status ? Object.assign({}, ability.status) : null,
          pos: { x: f.pos.x, y: f.pos.y }, hitstop: 0.07, sourceName: ability.name, abilityId: ability.id,
        });
        if (ability.onHit) ability.onHit(Object.assign({}, ctx, { victim: f }));
        if (ability.nullifyTechnique) world.nullifyFighterTechniques(f);
      }
      world.fx(ability.vfx || 'slash', {
        pos: { x: origin.x, y: origin.y }, z: self.z + 1, angle: self.facing,
        range: ability.range || 2.4, arc: ability.halfArc || 0.9,
        color: ability.color || self.technique?.color, owner: self.id,
      });
    };
    if (i === 0) fire();
    else world.after(i * delay, fire);
  }
  return true;
}

function castAoe(ctx) {
  const { world, self, ability, aim } = ctx;
  const center = ability.atTarget && ctx.target
    ? { x: ctx.target.pos.x, y: ctx.target.pos.y }
    : vadd(ctx.origin, vfromAngle(aim, ability.forward || 0));
  world.areaDamage(self, {
    pos: center, z: self.z, radius: ability.radius || 4,
    damage: ability.damage, poise: ability.poise, knock: ability.knock || 6,
    lift: ability.lift || 0, tags: ability.tags || ['technique'],
    status: ability.status ? Object.assign({}, ability.status) : null,
    sourceName: ability.name, abilityId: ability.id, burn: ability.burn,
  });
  world.fx(ability.vfx || 'burst', {
    pos: center, z: self.z, radius: ability.radius || 4,
    color: ability.color || self.technique?.color, glow: '#ffffff',
  });
  world.shake(clamp((ability.radius || 4) * 1.6, 4, 16), 0.35);
  return true;
}

function castCommand(ctx) {
  const { world, self, ability, aim } = ctx;
  const targets = world.coneTargets(self, ctx.origin, aim, ability.range || 10, ability.halfArc || 0.6);
  for (const f of targets) {
    world.dealDamage(self, f, {
      damage: ability.damage || 0, poise: ability.poise || 20,
      knock: ability.knock || 0, lift: ability.lift || 0,
      tags: ability.tags || ['technique', 'sound'],
      ignoreReinforce: ability.ignoreReinforce || 0,
      sureHit: true, // a command reaches the body directly
      status: ability.status ? Object.assign({}, ability.status) : null,
      pos: { x: f.pos.x, y: f.pos.y }, hitstop: 0.08, sourceName: ability.name, abilityId: ability.id,
    });
    if (ability.onHit) ability.onHit(Object.assign({}, ctx, { victim: f }));
  }
  world.fx(ability.vfx || 'word', {
    pos: ctx.origin, z: self.z + 1.4, angle: aim,
    range: ability.range || 10, arc: ability.halfArc || 0.6,
    color: self.technique?.color, text: ability.name,
  });
  world.shake(5, 0.22);
  return true;
}

function castBuff(ctx) {
  const { world, self, ability } = ctx;
  if (ability.buff) {
    addStatus(self, Object.assign({ type: 'buff' }, ability.buff));
  }
  world.fx(ability.vfx || 'buffAura', {
    pos: { x: self.pos.x, y: self.pos.y }, z: self.z,
    color: self.technique?.color, owner: self.id,
  });
  return true;
}

function castSummon(ctx) {
  const { world, self, ability, aim } = ctx;
  const s = ability.summon || {};
  const count = s.count || 1;
  for (let i = 0; i < count; i++) {
    const a = aim + (i - (count - 1) / 2) * 0.5;
    const at = vadd(ctx.origin, vfromAngle(a, 2.2 + world.rng.next() * 1.2));
    world.spawnSummon(self, s.kind, {
      x: at.x, y: at.y, life: s.life || 20, hostile: s.hostile,
    });
  }
  world.fx('summonCircle', {
    pos: ctx.origin, z: self.z, color: self.technique?.color, radius: 2.6,
  });
  return true;
}

function castDashStrike(ctx) {
  const { world, self, ability, aim } = ctx;
  const dist = ability.distance || 8;
  const dir = vfromAngle(aim);
  const start = { x: self.pos.x, y: self.pos.y };
  const dest = world.clampToArena(vadd(start, vscale(dir, dist)), self.radius);
  self.pos.x = dest.x;
  self.pos.y = dest.y;
  self.iframes = Math.max(self.iframes, ability.iframes || 0.2);
  self.vel.x = dir.x * 4;
  self.vel.y = dir.y * 4;
  self.facing = aim;

  // Everything along the line eats the hit.
  const hits = beamTargets(world, self, start, dest, 1.2);
  for (const f of hits) {
    world.dealDamage(self, f, {
      damage: ability.damage, poise: ability.poise, knock: ability.knock || 4,
      lift: ability.lift || 0, tags: ability.tags || ['technique', 'physical'],
      physical: true, backstab: ability.backstab || 0,
      status: ability.status ? Object.assign({}, ability.status) : null,
      pos: { x: f.pos.x, y: f.pos.y }, hitstop: 0.09, sourceName: ability.name, abilityId: ability.id,
      pierceInfinity: !!ability.pierceInfinity || !!self.flags.pierceInfinity,
    });
    if (ability.onHit) ability.onHit(Object.assign({}, ctx, { victim: f }));
  }

  if (ability.trail) {
    const steps = Math.ceil(dist / 1.8);
    for (let i = 0; i <= steps; i++) {
      const p = vadd(start, vscale(dir, (dist * i) / steps));
      world.spawnZone(self, {
        pos: p, radius: ability.trail.radius || 1.5, duration: ability.trail.duration || 3,
        dps: ability.trail.dps || 8, tags: [ability.trail.type || 'fire'],
        color: self.technique?.color, vfx: ability.trail.type || 'fire',
      });
    }
  }

  world.fx('dashStreak', { from: start, to: dest, color: self.technique?.color, z: self.z + 1 });
  world.audio(ability.sfx || 'dash', { volume: 0.7 });
  return true;
}

function castZone(ctx) {
  const { world, self, ability, aim } = ctx;
  const center = ability.atTarget && ctx.target
    ? { x: ctx.target.pos.x, y: ctx.target.pos.y }
    : vadd(ctx.origin, vfromAngle(aim, ability.forward || 4));
  world.spawnZone(self, {
    pos: center, radius: ability.radius || 3, duration: ability.duration || 4,
    dps: ability.dps || 10, poise: ability.poise || 8, lift: ability.lift || 0,
    tags: ability.tags || ['technique'], color: ability.color || self.technique?.color,
    vfx: ability.vfx || 'zone', status: ability.status,
  });
  world.fx('zoneOpen', { pos: center, radius: ability.radius || 3, color: self.technique?.color });
  return true;
}
