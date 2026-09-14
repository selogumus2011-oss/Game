// Domain Expansion — 領域展開.
//
// A domain is a barrier built from the caster's innate technique. Inside it the
// technique becomes a *sure hit*: it does not need to travel, be aimed, or be
// dodged. It simply happens, continuously, to everything the caster designates.
//
// The counterplay ladder, in order of how much it costs you:
//   1. Simple Domain        — a 2.21m circle that neutralises the sure-hit
//   2. Domain Amplification — barrier over your body, technique effects fizzle
//   3. Falling Blossom Emotion — barrier contact shreds the enemy barrier
//   4. Your own Domain      — a clash; refinement and output decide it
//   5. Break the barrier    — hit it until the integrity runs out
//   6. Kill the caster      — they are drained and stationary the whole time

import {
  clamp, clamp01, lerp, vdist, vsub, vnorm, vangle, vfromAngle, TAU,
} from '../core/math.js';
import { addStatus, removeStatus } from './status.js';

let did = 1;

export class Domain {
  constructor(world, owner, spec) {
    this.id = did++;
    this.world = world;
    this.owner = owner;
    this.ownerId = owner.id;
    this.team = owner.team;
    this.spec = spec;
    this.center = { x: owner.pos.x, y: owner.pos.y };
    this.targetRadius = spec.radius * (1 + (owner.stats.domainSkill - 1) * 0.15);
    this.radius = 0.5;
    this.open = !!spec.open;              // open barrier (Malevolent Shrine)
    this.duration = spec.duration;
    this.t = 0;
    this.maxIntegrity = spec.integrity * (1 + owner.vowMods.domainIntegrity);
    this.integrity = this.maxIntegrity;
    this.refinement = (spec.refinement || 1) * (0.7 + (owner.stats.ceControl ?? 0.5) * 0.6);
    this.tickTimer = 0;
    this.tickCount = 0;
    this.closing = false;
    this.closed = false;
    this.clashWith = null;
    this.clashPressure = 0;
    this.summonTimer = 0;
    this.flashT = 0;
  }

  get power() {
    const o = this.owner;
    if (!o || o.dead) return 0;
    return this.refinement * (1 + o.flow) * (0.5 + o.ceFraction) * (1 + o.mods.output + o.vowMods.techniqueOutput) *
      (o.stats.domainSkill || 1);
  }

  contains(pos, pad = 0) {
    return vdist(pos, this.center) <= this.radius + pad;
  }

  update(dt, world) {
    this.t += dt;
    this.flashT += dt;
    this.radius = lerp(this.radius, this.targetRadius, 1 - Math.exp(-7 * dt));

    const owner = this.owner;
    if (!owner || owner.dead) { this.close('caster down'); return; }

    // The caster pays continuously and cannot regenerate while holding it.
    const drain = this.spec.drain * dt * (this.clashWith ? 1.8 : 1);
    owner.ce -= drain;
    if (owner.ce <= 0) { owner.ce = 0; this.close('cursed energy exhausted'); return; }

    // Open barriers follow the caster; sealed barriers are anchored and the
    // caster must stay inside their own domain.
    if (this.open) {
      this.center.x = lerp(this.center.x, owner.pos.x, 1 - Math.exp(-3 * dt));
      this.center.y = lerp(this.center.y, owner.pos.y, 1 - Math.exp(-3 * dt));
    } else if (vdist(owner.pos, this.center) > this.radius * 0.92) {
      const dir = vnorm(vsub(owner.pos, this.center));
      owner.pos.x = this.center.x + dir.x * this.radius * 0.92;
      owner.pos.y = this.center.y + dir.y * this.radius * 0.92;
      owner.vel.x *= 0.3;
      owner.vel.y *= 0.3;
    }

    // Sure-hit ticks.
    this.tickTimer -= dt;
    if (this.tickTimer <= 0) {
      this.tickTimer = 0.25;
      this.tickCount++;
      this.applySureHit(world, 0.25);
      if (this.spec.onTick) this.spec.onTick({ world, owner, domain: this, tickCount: this.tickCount });
    }

    // Anyone attacking from inside wears the barrier down (handled by the
    // world calling damageBarrier), plus Falling Blossom Emotion contact.
    for (const f of world.fighters) {
      if (f.dead || f.team === this.team) continue;
      if (!this.contains(f.pos, 0)) continue;
      const edgeDist = this.radius - vdist(f.pos, this.center);
      if (f.simpleDomain.active && f.simpleDomain.mastered && edgeDist < 1.8) {
        // Falling Blossom Emotion: the barrier is repelled on contact.
        this.damageBarrier(60 * dt, f);
        world.fx('fallingBlossom', { pos: { x: f.pos.x, y: f.pos.y }, z: f.z + 1 });
      }
    }

    // Clash resolution.
    this.updateClash(dt, world);

    if (this.t >= this.duration) this.close('expired');
    if (this.integrity <= 0) this.shatter();
  }

  applySureHit(world, dt) {
    const s = this.spec.sureHit;
    if (!s) return;
    const owner = this.owner;
    for (const f of world.fighters) {
      if (f.dead) continue;
      const inside = this.contains(f.pos, -0.1);
      if (!inside) { if (f.insideDomain === this) f.insideDomain = null; continue; }
      f.insideDomain = this;

      const isOwner = f === owner;
      const ally = f.team === this.team;
      if (isOwner) {
        if (s.selfDamage) f.takeTrueDamage(s.dps * s.selfDamage * dt, this.spec.name, false);
        continue;
      }
      if (ally && !s.selfDamage) continue;

      // Simple Domain is the cheap answer — it neutralises the sure-hit only
      // inside its own small circle, and it costs energy every second.
      if (f.simpleDomain.active) {
        this.damageBarrier(6 * dt, f);
        world.fx('sureHitBlocked', { pos: { x: f.pos.x, y: f.pos.y }, z: f.z + 1 });
        continue;
      }
      // Domain Amplification blunts it but does not remove it.
      const ampMul = f.amplify.active ? 0.3 : 1;

      this.applyEffect(world, f, s, dt * ampMul, ally);
    }
  }

  applyEffect(world, f, s, dt, ally) {
    const dmg = s.dps * dt * this.refinement;
    switch (s.type) {
      case 'overload': // Unlimited Void
        f.takeTrueDamage(dmg, 'Unlimited Void', false);
        addStatus(f, { type: 'slow', time: 0.4, power: s.slow });
        if (s.stunLock) addStatus(f, { type: 'stun', time: 0.32 });
        f.ce = Math.max(0, f.ce - (s.ceDrain || 0) * dt);
        f.flow = clamp01(f.flow - dt * 0.05);
        world.fx('voidTick', { pos: { x: f.pos.x, y: f.pos.y }, z: f.z + 1.4 });
        break;
      case 'dismantleStorm': // Malevolent Shrine
        world.dealDamage(this.owner, f, {
          damage: s.dps * dt * 4, poise: 14 * dt * 4, knock: 1.2,
          tags: ['technique', 'slash'], sureHit: true, ignoreReinforce: 0.35,
          hitstop: 0.01, sourceName: 'Malevolent Shrine',
          pos: { x: f.pos.x + world.rng.range(-0.6, 0.6), y: f.pos.y + world.rng.range(-0.6, 0.6) },
        });
        world.fx('shrineSlash', { pos: { x: f.pos.x, y: f.pos.y }, z: f.z + 1, angle: world.rng.angle() });
        break;
      case 'shadowGrasp':
        f.takeTrueDamage(dmg, 'Chimera Shadow Garden', false);
        addStatus(f, { type: 'slow', time: 0.4, power: s.slow });
        if (s.snare && world.rng.chance(dt * 1.4)) addStatus(f, { type: 'root', time: 0.6 });
        break;
      case 'soulStrike':
        world.dealDamage(this.owner, f, {
          damage: s.dps * dt * 4, poise: 8, knock: 0, tags: ['technique', 'soul'],
          sureHit: true, ignoreReinforce: 1, hitstop: 0.01,
          sourceName: 'Self-Embodiment of Perfection', pos: { x: f.pos.x, y: f.pos.y },
        });
        if (s.transfigure) addStatus(f, { type: 'transfiguring', time: 1.2 });
        break;
      case 'incinerate':
        f.takeTrueDamage(dmg, 'Coffin of the Iron Mountain', false);
        addStatus(f, { type: 'burn', time: 2, power: 8 });
        if (s.blind) addStatus(f, { type: 'blindAsh', time: 1.2, power: s.blind });
        break;
      case 'exsanguinate':
        f.takeTrueDamage(dmg, 'Flowing Red Sea', false);
        addStatus(f, { type: 'bleed', time: 2, power: 5 });
        if (s.healOwner) this.owner.heal(s.healOwner * dt, { source: 'domain' });
        break;
      case 'compel':
        f.takeTrueDamage(dmg, 'Cradle of Quiet Words', false);
        this.compelTimer = (this.compelTimer || 0) + dt;
        if (this.compelTimer >= (s.stunPulse || 2.4)) {
          this.compelTimer = 0;
          addStatus(f, { type: 'stun', time: 0.9 });
          world.fx('wordPulse', { pos: { x: this.center.x, y: this.center.y }, radius: this.radius });
        }
        break;
      case 'swarm':
        f.takeTrueDamage(dmg, 'Chamber of Unknown Depths', false);
        addStatus(f, { type: 'slow', time: 0.4, power: s.slow });
        this.summonTimer += dt;
        if (this.summonTimer >= (s.summonRate || 3)) {
          this.summonTimer = 0;
          world.spawnSummon(this.owner, 'curseGrade2', {
            x: this.center.x + world.rng.range(-4, 4),
            y: this.center.y + world.rng.range(-4, 4), life: 14,
          });
        }
        break;
      case 'verdict':
        f.takeTrueDamage(dmg, 'Deadly Sentencing', false);
        if (s.confiscate) addStatus(f, { type: 'techniqueSealed', time: 1.0 });
        break;
      default:
        f.takeTrueDamage(dmg, this.spec.name, false);
    }
    if (!f.domainWarned && f.isPlayer) {
      f.domainWarned = true;
      world.notify('SURE-HIT — use Simple Domain (E)', '#ff4d4d');
    }
  }

  updateClash(dt, world) {
    let other = null;
    for (const d of world.domains) {
      if (d === this || d.closed) continue;
      if (vdist(d.center, this.center) < d.radius + this.radius) { other = d; break; }
    }
    this.clashWith = other;
    if (!other) { this.clashPressure = 0; return; }

    // Both barriers push; the difference in power decides who loses integrity.
    const mine = this.power + (this.owner.intent.domainPush ? 0.35 : 0);
    const theirs = other.power + (other.owner.intent.domainPush ? 0.35 : 0);
    const delta = mine - theirs;
    this.clashPressure = clamp(delta, -3, 3);
    if (delta < 0) this.integrity += delta * 26 * dt;
    // Contact between two barriers erodes both.
    this.integrity -= 8 * dt;
    if (world.rng.chance(dt * 8)) {
      const a = vangle(vsub(other.center, this.center));
      const mid = {
        x: this.center.x + Math.cos(a) * this.radius * 0.9,
        y: this.center.y + Math.sin(a) * this.radius * 0.9,
      };
      world.fx('clashSpark', { pos: mid, color: this.spec.color });
    }
    if (!this.clashAnnounced) {
      this.clashAnnounced = true;
      world.audio('domainClash', { volume: 1 });
      world.banner('領域対決', 'Domain Clash', '#ffffff', 2);
      world.notify('DOMAIN CLASH — hold X to push', '#ffd166');
    }
  }

  damageBarrier(amount, source) {
    this.integrity -= amount;
    if (this.integrity <= 0) this.shatter(source);
  }

  shatter(source) {
    if (this.closed) return;
    const world = this.world;
    world.audio('domainBreak', { volume: 1 });
    world.shake(24, 1.0);
    world.slowmo(0.25, 0.6);
    world.fx('domainShatter', {
      pos: { x: this.center.x, y: this.center.y }, radius: this.radius, color: this.spec.color,
    });
    world.banner('領域崩壊', `${this.spec.name} shattered`, '#ff4d4d', 1.6);
    // Backlash: losing your own domain hurts.
    if (this.owner && !this.owner.dead) {
      this.owner.takeTrueDamage(this.owner.maxHp * 0.08, 'domain backlash');
      this.owner.ce = 0;
      this.owner.domainBurnout = 45;
      this.owner.flow = 0;
      addStatus(this.owner, { type: 'stun', time: 0.8 });
    }
    this.close('shattered');
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    const world = this.world;
    if (this.owner) {
      this.owner.domain = null;
      if (reason !== 'shattered') this.owner.domainBurnout = Math.max(this.owner.domainBurnout, 30);
    }
    for (const f of world.fighters) if (f.insideDomain === this) f.insideDomain = null;
    world.event({ type: 'domainClose', domain: this.spec.id, reason, owner: this.ownerId });
    world.fx('domainClose', {
      pos: { x: this.center.x, y: this.center.y }, radius: this.radius, color: this.spec.color,
    });
  }
}
