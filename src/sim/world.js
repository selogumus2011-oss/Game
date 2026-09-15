// The World owns every simulation object and every rule that is not specific to
// a single fighter. It is deliberately DOM-free: presentation is emitted as
// queues of events that the renderer / audio layer drain each frame. That makes
// the entire game runnable headlessly for tests.

import {
  clamp, clamp01, lerp, vec, vadd, vsub, vscale, vnorm, vlen, vdist, vangle,
  vfromAngle, wrapAngle, separate, Rng, rand, randRange, TAU, PI,
} from '../core/math.js';
import { Fighter, setTimeoutSim, SIMPLE_DOMAIN_RADIUS } from './fighter.js';
import { Projectile } from './projectile.js';
import { Domain } from './domain.js';
import { AIController, SummonController } from './ai.js';
import { executeAbility } from './abilities.js';
import { dealDamage as resolveDamage, targetsInArc, stagger } from './combat.js';
import { addStatus } from './status.js';
import { getArena } from '../data/arenas.js';
import { getCurse, GRADE_POWER, WAVE_TABLE } from '../data/curses.js';
import { getCharacter } from '../data/characters.js';
import { getTechnique } from '../data/techniques.js';
import { ACTIONS } from '../data/actions.js';
import { getTool, LOOT_TABLE, TOOL_LIST } from '../data/tools.js';

export class World {
  constructor(opts = {}) {
    this.opts = opts;
    this.rng = new Rng(opts.seed ?? ((Date.now() ^ 0x5bf03635) >>> 0));
    this.arena = getArena(opts.arena || 'shibuya');
    this.mode = opts.mode || 'gauntlet';
    this.difficulty = opts.difficulty ?? 1;

    this.arenaCenter = vec(0, 0);
    this.arenaRadius = this.arena.size * 0.5;
    this.veilRadius = this.arenaRadius;
    this.veilTargetRadius = this.arenaRadius;

    this.fighters = [];
    this.controllers = new Map();
    this.projectiles = [];
    this.zones = [];
    this.domains = [];
    this.props = [];
    this.pickups = [];
    this.timers = [];
    this.particlesSim = [];

    this.events = [];
    this.fxQueue = [];
    this.audioQueue = [];
    this.banners = [];
    this.notifications = [];
    this.damageNumbers = [];

    this.time = 0;
    this.matchTime = 0;
    this.dt = 1 / 60;
    this.hitstop = 0;
    this.slowmoTime = 0;
    this.slowmoScale = 1;
    this.shakeAmount = 0;
    this.shakeTime = 0;
    this.player = null;
    this.over = false;
    this.result = null;
    this.wave = 0;
    this.waveTimer = 3;
    this.score = 0;
    this.killFeed = [];
    this.stats = { kills: 0, blackFlashes: 0, parries: 0, domains: 0, maxCombo: 0, damage: 0 };

    this.buildArena();
  }

  // -------------------------------------------------------------------------
  // Setup
  // -------------------------------------------------------------------------

  buildArena() {
    const a = this.arena;
    for (const spec of a.props) {
      for (let i = 0; i < spec.count; i++) {
        const ang = this.rng.angle();
        const r = Math.sqrt(this.rng.next()) * (this.arenaRadius - 4);
        this.props.push({
          id: this.props.length + 1,
          type: spec.type,
          pos: vec(Math.cos(ang) * r, Math.sin(ang) * r),
          radius: spec.radius * this.rng.range(0.85, 1.2),
          height: spec.height * this.rng.range(0.9, 1.15),
          hp: spec.hp, maxHp: spec.hp,
          color: spec.color, emissive: spec.emissive,
          destroyed: false, shakeT: 0, rot: this.rng.angle(), debris: 0,
        });
      }
    }
    // Clear a spawn pocket at the centre.
    this.props = this.props.filter((p) => vlen(p.pos) > 5 || p.type === 'building');

    // Static ground detail — cracks, stains, painted markings. Generated once
    // from the seeded RNG so the arena is stable and the renderer stays cheap.
    this.groundMarks = [];
    const n = Math.round(this.arenaRadius * 2.6);
    for (let i = 0; i < n; i++) {
      const ang = this.rng.angle();
      const r = Math.sqrt(this.rng.next()) * (this.arenaRadius - 2);
      this.groundMarks.push({
        x: Math.cos(ang) * r, y: Math.sin(ang) * r,
        r: this.rng.range(0.4, 1.8), a: this.rng.angle(),
        kind: this.rng.next(), tone: this.rng.range(-1, 1),
      });
    }
  }

  addFighter(spec) {
    const f = new Fighter(spec, this);
    this.fighters.push(f);
    if (spec.isPlayer) {
      this.player = f;
    } else {
      const Ctor = spec.summon ? SummonController : AIController;
      this.controllers.set(f.id, new Ctor(f, spec.ai || 'brute', this.rng));
    }
    return f;
  }

  spawnPlayer(charId, { vows = [], tool = null, x = 0, y = 0, team = 0 } = {}) {
    const c = getCharacter(charId);
    const f = this.addFighter({
      name: c.name, title: c.title, isPlayer: true, team,
      technique: c.technique, tool: tool || c.tool, grade: c.grade,
      appearance: c.appearance, color: c.appearance.accent, color2: c.appearance.uniform,
      eyeColor: c.appearance.eyes, x, y, kind: 'sorcerer',
      stats: {
        maxHp: c.maxHp, maxCe: c.maxCe, ceControl: c.ceControl, ceRegen: c.ceRegen,
        speed: c.speed, power: c.power, weight: c.weight, reach: c.reach,
        poise: c.poise, rct: c.rct, domainSkill: c.domainSkill,
      },
      canBlackFlash: true,
      simpleDomainMastered: c.technique === 'heavenlyRestriction',
      toolBelt: c.technique === 'heavenlyRestriction'
        ? ['invertedSpear', 'splitSoul', 'playfulCloud', 'dragonBone', 'katana']
        : [c.tool, 'katana', 'fists'],
    });
    f.charId = charId;
    if (c.technique === 'limitless' && c.ceControl > 0.9) f.flags.sixEyes = true;
    this.applyVows(f, vows);
    return f;
  }

  spawnSorcerer(charId, { team = 1, x = 0, y = 0, ai = 'duelist', vows = [] } = {}) {
    const c = getCharacter(charId);
    const f = this.addFighter({
      name: c.name, title: c.title, team, ai,
      technique: c.technique, tool: c.tool, grade: c.grade,
      appearance: c.appearance, color: c.appearance.accent, color2: c.appearance.uniform,
      eyeColor: c.appearance.eyes, x, y, kind: 'sorcerer',
      stats: {
        maxHp: c.maxHp * this.difficulty, maxCe: c.maxCe, ceControl: c.ceControl,
        ceRegen: c.ceRegen, speed: c.speed, power: c.power * this.difficulty,
        weight: c.weight, reach: c.reach, poise: c.poise, rct: c.rct,
        domainSkill: c.domainSkill,
      },
      canBlackFlash: true,
      simpleDomainMastered: c.technique === 'heavenlyRestriction',
    });
    f.charId = charId;
    if (c.technique === 'limitless' && c.ceControl > 0.9) f.flags.sixEyes = true;
    this.applyVows(f, vows);
    return f;
  }

  spawnCurse(curseId, { x = 0, y = 0, team = 1, life = 0 } = {}) {
    const c = getCurse(curseId);
    const d = this.difficulty;
    return this.addFighter({
      name: c.name, team, ai: c.ai, kind: 'curse', grade: c.grade,
      technique: c.technique, tool: 'fists', shape: c.shape, scale: c.scale,
      color: c.color, color2: c.color2, eyeColor: c.eyeColor,
      actions: c.actions, radius: c.radius, x, y, life,
      canBlackFlash: c.canBlackFlash, adapts: c.adapts, flying: c.flying,
      curseId,
      stats: {
        maxHp: c.maxHp * d, maxCe: c.maxCe, ceControl: c.ceControl, ceRegen: c.ceRegen,
        speed: c.speed, power: c.power * d, weight: c.weight, reach: c.reach,
        poise: c.poise * d, rct: c.rct, domainSkill: 1,
      },
    });
  }

  spawnSummon(owner, kind, { x, y, life = 20, hostile = null } = {}) {
    const c = getCurse(kind);
    const f = this.spawnCurse(kind, {
      x: x ?? owner.pos.x + this.rng.range(-2, 2),
      y: y ?? owner.pos.y + this.rng.range(-2, 2),
      team: hostile === 'chaotic' ? 99 : owner.team,
      life,
    });
    f.isSummon = true;
    f.summonOwner = owner.id;
    f.decoy = !!c.decoy;
    if (this.controllers.has(f.id)) {
      this.controllers.set(f.id, new SummonController(f, c.ai, this.rng));
    }
    this.fx('summonPop', { pos: { x: f.pos.x, y: f.pos.y }, color: c.color, radius: f.radius * 3 });
    this.audio('summon', { volume: 0.6 });
    this.event({ type: 'summon', owner: owner.id, kind, fighter: f.id });
    if (hostile === 'chaotic') {
      this.notify(`${c.name} is not under your control`, '#ffd166');
    }
    return f;
  }

  spawnDecoy(owner, life = 4) {
    const f = this.spawnCurse('decoy', { x: owner.pos.x, y: owner.pos.y, team: owner.team, life });
    f.decoy = true;
    f.appearance = owner.appearance;
    f.shape = owner.shape;
    f.color = owner.color;
    f.summonOwner = owner.id;
    return f;
  }

  applyVows(f, vowIds) {
    for (const id of vowIds) {
      const v = typeof id === 'string' ? VOW_CACHE[id] : id;
      if (!v) continue;
      v.apply(f);
      f.vows.push(v);
    }
    // Vows that change starting conditions.
    f.maxHp = f.stats.maxHp * (1 + f.vowMods.maxHp);
    f.hp = f.maxHp;
    f.maxCe = f.stats.maxCe * (1 + f.vowMods.maxCe);
    f.ce = f.maxCe;
    if (f.flags.startWounded) f.hp = f.maxHp * 0.45;
    if (f.flags.noTool) { f.toolId = 'fists'; f.tool = getTool('fists'); }
    if (f.flags.deadline) f.deadlineTimer = f.flags.deadline;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  update(rawDt) {
    if (this.over) { this.drainTimers(rawDt); return; }

    // Hitstop freezes the simulation almost completely; slow motion scales it.
    let scale = 1;
    if (this.hitstop > 0) {
      this.hitstop -= rawDt;
      scale = 0.06;
    }
    if (this.slowmoTime > 0) {
      this.slowmoTime -= rawDt;
      scale *= this.slowmoScale;
    }
    const dt = rawDt * scale;
    this.dt = dt;
    this.time += dt;
    this.matchTime += dt;
    this.realDt = rawDt;

    // Screen shake decay (presentation, but tracked here so replays match).
    if (this.shakeTime > 0) {
      this.shakeTime -= rawDt;
      if (this.shakeTime <= 0) this.shakeAmount = 0;
    }

    this.drainTimers(dt);

    // Controllers -> intents.
    for (const [id, ctrl] of this.controllers) {
      const f = this.byId(id);
      if (!f || f.dead) continue;
      ctrl.update(dt, this);
    }

    // Fighters.
    for (const f of this.fighters) f.update(dt, this);

    // Projectiles.
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.update(dt, this);
      if (p.dead) this.projectiles.splice(i, 1);
    }

    // Hazard zones.
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt;
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.25;
        for (const f of this.fighters) {
          if (f.dead || f.team === z.team) continue;
          if (vdist(f.pos, z.pos) > z.radius + f.radius) continue;
          if (f.z > 2.5) continue;
          f.takeTrueDamage(z.dps * 0.25, z.name || 'hazard', false);
          if (z.status) addStatus(f, Object.assign({}, z.status));
          if (z.tags.includes('fire')) addStatus(f, { type: 'burn', time: 1.4, power: z.dps * 0.4 });
        }
      }
      if (z.t >= z.duration) this.zones.splice(i, 1);
    }

    // Domains.
    for (let i = this.domains.length - 1; i >= 0; i--) {
      const d = this.domains[i];
      d.update(dt, this);
      if (d.closed) this.domains.splice(i, 1);
    }

    // Physics: separation, props, arena bounds.
    this.resolveCollisions(dt);

    // Pickups.
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.bob += dt * 3;
      for (const f of this.fighters) {
        if (f.dead || !f.isPlayer) continue;
        if (vdist(f.pos, p.pos) < 1.2) {
          this.equipTool(f, p.tool);
          this.pickups.splice(i, 1);
          this.audio('uiConfirm', { volume: 0.7 });
          this.notify(`Picked up ${getTool(p.tool).name}`, '#ffd166');
          break;
        }
      }
    }

    // Remove the long-dead.
    for (let i = this.fighters.length - 1; i >= 0; i--) {
      const f = this.fighters[i];
      if (f.dead && f.deathTime > 4.5) {
        this.controllers.delete(f.id);
        this.fighters.splice(i, 1);
      }
    }

    // Vow deadlines.
    for (const f of this.fighters) {
      if (f.deadlineTimer != null && !f.dead) {
        f.deadlineTimer -= dt;
        if (f.deadlineTimer <= 0) {
          this.breakVow(f, 'timeout');
          f.deadlineTimer = null;
        }
      }
    }

    this.updateMode(dt);
    this.updatePresentationTimers(rawDt);
  }

  drainTimers(dt) {
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) {
        this.timers.splice(i, 1);
        try { t.fn(); } catch (e) { /* keep the sim alive */ }
      }
    }
  }

  updatePresentationTimers(dt) {
    for (let i = this.banners.length - 1; i >= 0; i--) {
      this.banners[i].t -= dt;
      if (this.banners[i].t <= 0) this.banners.splice(i, 1);
    }
    for (let i = this.notifications.length - 1; i >= 0; i--) {
      this.notifications[i].t -= dt;
      if (this.notifications[i].t <= 0) this.notifications.splice(i, 1);
    }
    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].t -= dt;
      if (this.killFeed[i].t <= 0) this.killFeed.splice(i, 1);
    }
  }

  resolveCollisions(dt) {
    const fs = this.fighters;
    for (let i = 0; i < fs.length; i++) {
      const a = fs[i];
      if (a.dead) continue;
      for (let j = i + 1; j < fs.length; j++) {
        const b = fs[j];
        if (b.dead) continue;
        if (Math.abs(a.z - b.z) > 1.6) continue;
        const push = separate(a.pos, a.radius, b.pos, b.radius, 0.5);
        if (push.x || push.y) {
          const wa = 1 / Math.max(0.3, a.stats.weight ?? 1);
          const wb = 1 / Math.max(0.3, b.stats.weight ?? 1);
          const tot = wa + wb;
          a.pos.x += push.x * (wa / tot) * 2;
          a.pos.y += push.y * (wa / tot) * 2;
          b.pos.x -= push.x * (wb / tot) * 2;
          b.pos.y -= push.y * (wb / tot) * 2;
        }
      }

      // Props: collide, and slam into them at speed for bonus damage.
      for (const p of this.props) {
        if (p.destroyed) continue;
        const d = vdist(a.pos, p.pos);
        const minD = a.radius + p.radius;
        if (d >= minD) continue;
        const speed = vlen(a.vel);
        const dir = vnorm(vsub(a.pos, p.pos));
        a.pos.x = p.pos.x + dir.x * minD;
        a.pos.y = p.pos.y + dir.y * minD;
        if (speed > 9 && a.timeSinceHit < 0.5) {
          // Wall slam: knocked into cover.
          const mul = a.lastHitBy ? (this.byId(a.lastHitBy)?.tool?.wallSlam || 1) : 1;
          const dmg = clamp(speed * 1.1 * mul, 6, 40);
          a.takeTrueDamage(dmg, 'wall slam');
          a.poise -= 30;
          if (a.poise <= 0) stagger(this, a, { poise: 0 }, 0.8);
          this.damageProp(p, dmg * 2, a.pos);
          this.fx('slam', { pos: { x: a.pos.x, y: a.pos.y }, z: a.z + 1, angle: vangle(vscale(dir, -1)) });
          this.audio('hitHeavy', { volume: 0.9, pitch: 0.7 });
          this.shake(10, 0.3);
          a.vel.x *= -0.25;
          a.vel.y *= -0.25;
        } else {
          a.vel.x *= 0.6;
          a.vel.y *= 0.6;
        }
      }

      // Arena bounds / veil.
      const fromCenter = vsub(a.pos, this.arenaCenter);
      const dist = vlen(fromCenter);
      if (dist > this.arenaRadius - a.radius) {
        const dir = vnorm(fromCenter);
        a.pos.x = this.arenaCenter.x + dir.x * (this.arenaRadius - a.radius);
        a.pos.y = this.arenaCenter.y + dir.y * (this.arenaRadius - a.radius);
        a.vel.x *= 0.3;
        a.vel.y *= 0.3;
      }
      // Culling Game: outside the shrinking veil you burn.
      if (this.mode === 'culling' && dist > this.veilRadius) {
        a.takeTrueDamage(9 * dt, 'the veil', false);
        if (a.isPlayer && this.rng.chance(dt * 2)) this.notify('OUTSIDE THE VEIL', '#ff4d4d');
      }
    }
  }

  // -------------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------------

  updateMode(dt) {
    switch (this.mode) {
      case 'gauntlet': this.updateGauntlet(dt); break;
      case 'duel': this.updateDuel(dt); break;
      case 'culling': this.updateCulling(dt); break;
      case 'training': break;
      default: break;
    }
    if (this.player && this.player.dead && !this.over) {
      this.finish(false, 'You were exorcised.');
    }
  }

  updateGauntlet(dt) {
    const enemies = this.fighters.filter((f) => !f.dead && f.team !== this.player?.team && !f.decoy);
    if (enemies.length === 0) {
      this.waveTimer -= dt;
      if (this.waveTimer <= 0) {
        this.wave++;
        if (this.wave > WAVE_TABLE.length) {
          this.finish(true, 'Every curse on the manifest is exorcised.');
          return;
        }
        const entry = WAVE_TABLE[this.wave - 1];
        this.banner(entry.boss ? 'Special Grade' : `Wave ${this.wave}`, entry.boss ? '#ff4d4d' : '#8ad8ff', 2.2);
        for (const [id, count] of entry.spawns) {
          for (let i = 0; i < count; i++) {
            const ang = this.rng.angle();
            const r = this.arenaRadius * this.rng.range(0.55, 0.9);
            this.spawnCurse(id, { x: Math.cos(ang) * r, y: Math.sin(ang) * r, team: 1 });
          }
        }
        if (this.player) {
          this.player.heal(this.player.maxHp * 0.25);
          this.player.ce = this.player.maxCe;
        }
        this.waveTimer = 4;
      }
    }
  }

  updateDuel(dt) {
    const enemies = this.fighters.filter((f) => !f.dead && f.team !== this.player?.team && !f.isSummon && !f.decoy);
    if (enemies.length === 0 && !this.over) {
      this.finish(true, 'Opponent down.');
    }
  }

  updateCulling(dt) {
    // The veil closes steadily; being outside is fatal over time.
    this.veilTargetRadius = Math.max(9, this.arenaRadius - this.matchTime * 0.42);
    this.veilRadius = lerp(this.veilRadius, this.veilTargetRadius, 1 - Math.exp(-0.7 * dt));
    const alive = this.fighters.filter((f) => !f.dead && !f.isSummon && !f.decoy);
    this.aliveCount = alive.length;
    if (alive.length <= 1 && !this.over) {
      const winner = alive[0];
      this.finish(winner === this.player, winner === this.player ? 'Last sorcerer standing.' : 'Culled.');
    }
  }

  finish(victory, message) {
    this.over = true;
    this.result = {
      victory, message, time: this.matchTime, score: this.score,
      stats: Object.assign({}, this.stats),
      player: this.player ? {
        blackFlashes: this.player.blackFlashCount,
        bestChain: this.player.bestChain,
        parries: this.player.perfectParries,
        kills: this.player.kills,
        damage: Math.round(this.player.damageDealt),
      } : null,
    };
    this.event({ type: 'matchEnd', victory });
    this.banner(victory ? 'Exorcism Complete' : 'Defeat', victory ? '#8ef0bd' : '#ff4d4d', 4);
  }

  // -------------------------------------------------------------------------
  // Combat API used by fighters, projectiles, abilities and domains
  // -------------------------------------------------------------------------

  dealDamage(attacker, victim, hit) {
    const res = resolveDamage(this, attacker, victim, hit);
    if (res.hit && attacker) {
      attacker.damageDealt += res.damage;
      if (attacker.isPlayer) {
        this.stats.damage += res.damage;
        this.stats.maxCombo = Math.max(this.stats.maxCombo, attacker.combo.count);
        if (res.blackFlash) this.stats.blackFlashes++;
      }
      // Fighting inside someone else's domain wears the barrier down.
      const dom = victim.insideDomain;
      if (dom && dom.team !== attacker.team && !dom.closed) dom.damageBarrier(res.damage * 0.22, attacker);
      const ownDom = attacker.insideDomain;
      if (ownDom && ownDom.team !== attacker.team && !ownDom.closed) ownDom.damageBarrier(res.damage * 0.1, attacker);
    }
    if (res.parried && victim.isPlayer) this.stats.parries++;
    return res;
  }

  areaDamage(attacker, spec) {
    const hits = [];
    for (const f of this.fighters) {
      if (f.dead) continue;
      if (attacker && f.team === attacker.team && !spec.friendlyFire && !f.decoy) continue;
      if (spec.exclude && spec.exclude.has && spec.exclude.has(f.id)) continue;
      const d = vdist(f.pos, spec.pos);
      if (d > spec.radius + f.radius) continue;
      const falloff = 1 - clamp01((d - f.radius) / Math.max(0.5, spec.radius)) * 0.45;
      hits.push(this.dealDamage(attacker, f, {
        damage: spec.damage * falloff, poise: (spec.poise ?? spec.damage) * falloff,
        knock: spec.knock ?? 6, lift: spec.lift ?? 0, tags: spec.tags || ['technique'],
        status: spec.status ? Object.assign({}, spec.status) : null, burn: spec.burn,
        sureHit: !!spec.sureHit, ignoreReinforce: spec.ignoreReinforce || 0,
        pos: { x: f.pos.x, y: f.pos.y },
        angle: vangle(vsub(f.pos, spec.pos)),
        hitstop: 0.08, sourceName: spec.sourceName || '',
      }));
    }
    for (const p of this.props) {
      if (p.destroyed) continue;
      if (vdist(p.pos, spec.pos) < spec.radius + p.radius) this.damageProp(p, spec.damage, spec.pos);
    }
    return hits;
  }

  coneHit({ owner, origin, angle, range, halfArc, damage, poise, knock, lift, tags, status, sureHit }) {
    const targets = this.coneTargets(owner, origin, angle, range, halfArc);
    for (const f of targets) {
      this.dealDamage(owner, f, {
        damage, poise, knock, lift, tags: tags || ['technique'],
        status: status ? Object.assign({}, status) : null, sureHit: !!sureHit,
        pos: { x: f.pos.x, y: f.pos.y },
      });
    }
    return targets;
  }

  coneTargets(owner, origin, angle, range, halfArc) {
    return targetsInArc(this, owner, { origin, angle, range, halfArc });
  }

  nearestEnemy(pos, team, maxDist = 30) {
    let best = null, bestD = maxDist;
    for (const f of this.fighters) {
      if (f.dead || f.team === team) continue;
      const d = vdist(pos, f.pos);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best;
  }

  nearestInCone(owner, angle, range, halfArc) {
    const list = this.coneTargets(owner, owner.pos, angle, range, halfArc);
    return list[0] || null;
  }

  countSummons(owner) {
    return this.fighters.filter((f) => !f.dead && f.summonOwner === owner.id).length;
  }

  byId(id) {
    return this.fighters.find((f) => f.id === id) || null;
  }

  spawnProjectile(owner, spec) {
    const p = new Projectile(this, owner, spec);
    this.projectiles.push(p);
    return p;
  }

  spawnZone(owner, spec) {
    const z = Object.assign({
      t: 0, tick: 0, team: owner ? owner.team : 0, ownerId: owner?.id,
      duration: 4, radius: 3, dps: 10, tags: ['technique'], color: '#ff8a1e',
    }, spec);
    this.zones.push(z);
    return z;
  }

  spawnPickup(tool, pos) {
    this.pickups.push({ tool, pos: vec(pos.x, pos.y), bob: 0 });
  }

  after(delay, fn) { this.timers.push({ t: delay, fn }); }

  addStatus(f, status) { return addStatus(f, status); }
  techniqueById(id) { return getTechnique(id); }
  removeStatus(f, type) { if (f) f.removeStatus(type); }

  executeAbility(caster, ability, aim) {
    return executeAbility(this, caster, ability, aim);
  }

  openDomain(owner, spec) {
    if (owner.flags.noDomain) { this.breakVow(owner, 'domain'); return null; }
    const d = new Domain(this, owner, spec);
    this.domains.push(d);
    owner.domain = d;
    owner.flow = 0;
    this.audio('domainOpen', { volume: 1 });
    this.shake(18, 1.2);
    this.slowmo(0.3, 0.8);
    this.fx('domainOpen', {
      pos: { x: d.center.x, y: d.center.y }, radius: spec.radius,
      color: spec.color, color2: spec.color2, visual: spec.visual,
    });
    this.event({ type: 'domainOpen', fighter: owner.id, domain: spec.id });
    if (owner.isPlayer) this.stats.domains++;
    for (const f of this.fighters) f.domainWarned = false;
    return d;
  }

  /** The automatic counter-slash that Simple Domain fires at anything crossing it. */
  simpleDomainCounter(defender, attacker) {
    const def = ACTIONS.simpleCounter;
    this.fx('simpleCounter', {
      pos: { x: defender.pos.x, y: defender.pos.y }, z: defender.z + 0.9,
      radius: SIMPLE_DOMAIN_RADIUS,
    });
    this.audio('slash', { volume: 0.7, pitch: 1.2 });
    const targets = this.coneTargets(defender, defender.pos, defender.facing, SIMPLE_DOMAIN_RADIUS + 0.3, PI);
    for (const f of targets) {
      this.dealDamage(defender, f, {
        damage: def.damage, poise: def.poise, knock: def.knock,
        tags: ['technique', 'slash'], ignoreSimpleDomain: true,
        pos: { x: f.pos.x, y: f.pos.y }, sourceName: 'Simple Domain',
      });
    }
  }

  nullifyNearbyTechniques(pos, radius) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (vdist(p.pos, pos) < radius) {
        this.fx('nullify', { pos: { x: p.pos.x, y: p.pos.y } });
        this.projectiles.splice(i, 1);
      }
    }
    for (const d of this.domains) {
      if (vdist(d.center, pos) < d.radius) d.damageBarrier(60, null);
    }
  }

  nullifyFighterTechniques(f) {
    addStatus(f, { type: 'techniqueSealed', time: 4 });
    f.amplify.active = false;
    if (f.domain) f.domain.damageBarrier(80, null);
    this.fx('nullify', { pos: { x: f.pos.x, y: f.pos.y }, z: f.z + 1 });
  }

  swapPositions(a, b) {
    const ax = a.pos.x, ay = a.pos.y;
    a.pos.x = b.pos.x; a.pos.y = b.pos.y;
    b.pos.x = ax; b.pos.y = ay;
    this.audio('ui', { volume: 0.6, pitch: 1.5 });
  }

  blink(f, angle, dist) {
    const dest = this.clampToArena(vadd(f.pos, vfromAngle(angle, dist)), f.radius);
    this.fx('dashStreak', { from: { x: f.pos.x, y: f.pos.y }, to: dest, color: f.technique?.color, z: f.z + 1 });
    f.pos.x = dest.x;
    f.pos.y = dest.y;
    f.iframes = Math.max(f.iframes, 0.15);
  }

  cycleTool(f) {
    if (f.flags.noTool) { this.notify('Binding vow: no cursed tools', '#ff8a8a'); return; }
    const belt = f.toolBelt && f.toolBelt.length ? f.toolBelt : TOOL_LIST;
    const i = belt.indexOf(f.toolId);
    const next = belt[(i + 1) % belt.length];
    this.equipTool(f, next);
  }

  equipTool(f, toolId) {
    f.toolId = toolId;
    f.tool = getTool(toolId);
    if (!f.toolBelt.includes(toolId)) f.toolBelt.push(toolId);
    f.flags.pierceInfinity = !!(f.tool.pierceInfinity || f.technique?.id === 'heavenlyRestriction');
    this.audio('ui', { volume: 0.5, pitch: 1.2 });
    this.event({ type: 'tool', fighter: f.id, tool: toolId });
    if (f.isPlayer) this.notify(f.tool.name, f.tool.color);
  }

  damageProp(p, amount, from) {
    if (p.destroyed) return;
    p.hp -= amount;
    p.shakeT = 0.25;
    this.fx('propHit', { pos: { x: p.pos.x, y: p.pos.y }, color: p.color });
    if (p.hp <= 0) {
      p.destroyed = true;
      p.debris = 1;
      this.fx('propBreak', {
        pos: { x: p.pos.x, y: p.pos.y }, color: p.color,
        radius: p.radius, height: p.height, type: p.type,
      });
      this.audio('guardBreak', { volume: 0.5, pitch: 1.3, throttle: 60 });
      this.shake(6, 0.25);
    }
  }

  killFighter(victim, attacker, hit) {
    if (victim.dead) return;
    victim.dead = true;
    victim.hp = 0;
    victim.deathTime = 0;
    victim.state = 'dead';
    victim.simpleDomain.active = false;
    if (victim.domain) victim.domain.close('caster down');
    this.audio('death', { volume: 0.7 });
    this.fx('death', {
      pos: { x: victim.pos.x, y: victim.pos.y }, z: victim.z,
      color: victim.color, kind: victim.kind,
    });
    this.event({ type: 'death', victim: victim.id, attacker: attacker?.id });
    this.killFeed.push({
      text: `${attacker ? attacker.name : 'The veil'} exorcised ${victim.name}`,
      t: 5, color: attacker?.isPlayer ? '#ffd166' : '#9aa3ad',
    });
    if (attacker) {
      attacker.kills++;
      if (attacker.isPlayer) {
        this.stats.kills++;
        this.score += (GRADE_POWER[victim.grade] || 1) * 100;
        attacker.flow = clamp01(attacker.flow + 0.1);
      }
      if (attacker.technique?.passive?.onKill) {
        attacker.technique.passive.onKill({ world: this, self: attacker, victim });
      }
    }
    if (this.mode === 'culling' && !victim.isSummon) {
      // Drop whatever they were carrying.
      if (victim.toolId && victim.toolId !== 'fists') this.spawnPickup(victim.toolId, victim.pos);
    }
  }

  despawn(f, reason) {
    f.dead = true;
    f.deathTime = 3.6;
    this.fx('despawn', { pos: { x: f.pos.x, y: f.pos.y }, z: f.z, color: f.color });
  }

  breakVow(f, kind) {
    const vow = f.vows.find((v) => v.breakOn === kind);
    this.audio('domainBreak', { volume: 0.9 });
    this.banner('Binding Vow Broken', '#ff2d2d', 2.4);
    if (kind === 'timeout') {
      f.takeTrueDamage(f.maxHp * 10, 'a broken binding vow');
      return;
    }
    f.takeTrueDamage(f.maxHp * 0.3, 'a broken binding vow');
    f.ce = 0;
    addStatus(f, { type: 'techniqueSealed', time: 10 });
    if (vow) f.vows = f.vows.filter((v) => v !== vow);
  }

  // -------------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------------

  clampToArena(pos, pad = 0.5) {
    const from = vsub(pos, this.arenaCenter);
    const d = vlen(from);
    const max = this.arenaRadius - pad;
    if (d <= max) return { x: pos.x, y: pos.y };
    const dir = vnorm(from);
    return { x: this.arenaCenter.x + dir.x * max, y: this.arenaCenter.y + dir.y * max };
  }

  outOfBounds(pos, pad = 0) {
    return vdist(pos, this.arenaCenter) > this.arenaRadius + pad;
  }

  // -------------------------------------------------------------------------
  // Presentation queues (drained by the renderer / audio layer)
  // -------------------------------------------------------------------------

  event(e) { this.events.push(e); if (this.events.length > 400) this.events.shift(); }
  fx(type, data) { this.fxQueue.push(Object.assign({ type }, data)); }
  audio(name, opts) { this.audioQueue.push({ name, opts }); }
  shake(amount, time = 0.3) {
    this.shakeAmount = Math.max(this.shakeAmount, amount);
    this.shakeTime = Math.max(this.shakeTime, time);
  }
  hitstopFor(t) { this.hitstop = Math.max(this.hitstop, t); }
  slowmo(scale, time) {
    this.slowmoScale = Math.min(this.slowmoScale === 1 ? scale : Math.min(this.slowmoScale, scale), scale);
    this.slowmoTime = Math.max(this.slowmoTime, time);
    if (this.slowmoTime <= 0) this.slowmoScale = 1;
  }
  banner(text, color, time = 2) { this.banners.push({ text, color, t: time, max: time }); }
  notify(text, color = '#ffffff') {
    const last = this.notifications[this.notifications.length - 1];
    if (last && last.text === text && last.t > 1.2) return;
    this.notifications.push({ text, color, t: 2 });
    if (this.notifications.length > 5) this.notifications.shift();
  }
  damageNumber(pos, text, color) {
    this.event({ type: 'damage', kind: 'custom', pos: { x: pos.x, y: pos.y }, z: 1.5, text, color });
  }
}

// Vows are looked up lazily to avoid a circular import at module load.
import { VOWS } from '../data/vows.js';
const VOW_CACHE = VOWS;
