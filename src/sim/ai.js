// Enemy and duelist AI.
//
// Utility-based: every frame the controller scores a small set of behaviours
// against the current situation and commits to the winner for a short beat.
// Grade drives reaction time, parry frequency and how often the AI makes a
// deliberate mistake — a Grade 4 curse flails, a special grade reads you.

import {
  clamp, clamp01, lerp, vec, vadd, vsub, vscale, vnorm, vlen, vdist, vangle,
  vfromAngle, wrapAngle, TAU, PI,
} from '../core/math.js';
import { SIMPLE_DOMAIN_RADIUS } from './fighter.js';

const GRADE_SKILL = {
  4: { react: 0.42, parry: 0.02, dodge: 0.06, mistake: 0.35, aggression: 0.8, ability: 0.15 },
  3: { react: 0.34, parry: 0.06, dodge: 0.12, mistake: 0.26, aggression: 0.85, ability: 0.3 },
  2: { react: 0.26, parry: 0.14, dodge: 0.2, mistake: 0.18, aggression: 0.9, ability: 0.5 },
  1: { react: 0.18, parry: 0.28, dodge: 0.34, mistake: 0.1, aggression: 0.95, ability: 0.72 },
  special: { react: 0.11, parry: 0.44, dodge: 0.5, mistake: 0.04, aggression: 1.0, ability: 0.9 },
};

export class AIController {
  constructor(fighter, profile = 'brute', rng = null) {
    this.f = fighter;
    this.profile = profile;
    this.rng = rng;
    this.target = null;
    this.think = 0;
    this.behaviour = 'approach';
    this.behaviourTime = 0;
    this.strafeDir = (rng ? rng.next() : 0.5) < 0.5 ? 1 : -1;
    this.reactBuffer = [];
    this.awareness = 1;
    this.lastAbility = 0;
    this.abilityTimer = this.range(1, 3);
    this.aimError = 0;
    this.aimErrorTarget = 0;
    this.blockHold = 0;
    this.preferredRange = 2.4;
    this.commitTimer = 0;
  }

  get skill() {
    return GRADE_SKILL[this.f.grade] || GRADE_SKILL[3];
  }

  // All AI randomness comes from the world RNG so a seeded match replays exactly.
  rand() { return this.rng ? this.rng.next() : Math.random(); }
  range(a, b) { return a + this.rand() * (b - a); }
  chance(p) { return this.rand() < p; }

  pickTarget(world) {
    const f = this.f;
    let best = null;
    let bestScore = -Infinity;
    for (const o of world.fighters) {
      if (o.dead || o === f) continue;
      if (o.team === f.team) continue;
      if (o.decoy) { // decoys are convincing
        const d = vdist(f.pos, o.pos);
        if (d < 14) return o;
      }
      const d = vdist(f.pos, o.pos);
      let score = 120 - d * 3;
      if (o.isPlayer) score += 28;
      if (o.hpFraction < 0.3) score += 22;
      if (o.flags.stealth) score -= 45 * (1 - this.awareness);
      if (o.id === f.lastHitBy) score += 30;
      if (score > bestScore) { bestScore = score; best = o; }
    }
    return best;
  }

  update(dt, world) {
    const f = this.f;
    if (f.dead) return;
    if (!this.rng) this.rng = world.rng;
    const it = f.intent;

    // Awareness: Heavenly Restriction has no cursed energy to sense.
    this.think -= dt;
    this.behaviourTime += dt;
    this.commitTimer -= dt;
    this.abilityTimer -= dt;

    if (this.think <= 0) {
      this.think = this.skill.react * this.range(0.7, 1.35);
      this.target = this.pickTarget(world);
      this.chooseBehaviour(world);
    }

    const t = this.target;
    if (!t || t.dead) {
      it.move.x = 0; it.move.y = 0;
      it.block = false;
      this.wander(dt, world);
      return;
    }

    if (t.flags.stealth) {
      this.awareness = clamp01(this.awareness - dt * 0.55 + (f.timeSinceHit < 0.5 ? 1 : 0));
    } else {
      this.awareness = clamp01(this.awareness + dt * 2);
    }

    const toT = vsub(t.pos, f.pos);
    const dist = vlen(toT);
    const desired = vangle(toT);

    // Aim wobble so the AI does not have perfect tracking.
    this.aimErrorTarget = lerp(this.aimErrorTarget, this.range(-1, 1) * (0.34 * this.skill.mistake + (1 - this.awareness) * 0.8 + f.mods.accuracy * -1), 0.12);
    this.aimError = lerp(this.aimError, this.aimErrorTarget, clamp01(dt * 5));
    it.aim = desired + this.aimError;

    // Reset per-frame one-shots.
    it.attackTap = false;
    it.attackCharged = false;
    it.grab = false;
    it.dash = false;
    it.jump = false;
    it.ability = -1;
    it.domain = false;
    it.amplify = false;
    it.parryPressed = false;
    it.block = false;
    it.rct = false;
    it.simpleDomain = false;
    it.domainPush = false;

    this.defensiveLayer(dt, world, t, dist);
    this.movementLayer(dt, world, t, dist);
    this.offenceLayer(dt, world, t, dist);
  }

  chooseBehaviour(world) {
    const f = this.f;
    const t = this.target;
    if (!t) { this.behaviour = 'idle'; return; }
    const dist = vdist(f.pos, t.pos);
    const hp = f.hpFraction;
    const ce = f.ceFraction;

    const scores = {
      approach: 50 + (dist > 4 ? 30 : 0) + this.skill.aggression * 20,
      strafe: 26 + (dist < 5 ? 24 : 0),
      retreat: (hp < 0.3 ? 45 : 0) + (f.poise < f.maxPoise * 0.25 ? 30 : 0) + (dist < 2 ? 12 : 0),
      pressure: 40 + (t.state === 'stagger' ? 90 : 0) + (t.state === 'cast' ? 60 : 0) + (t.state === 'domainCast' ? 110 : 0),
      heal: (hp < 0.45 && f.stats.rct > 0.2 && ce > 0.4 && dist > 7 ? 85 : 0),
      zone: (this.profile === 'caster' ? 60 : 0) + (dist > 8 ? 20 : 0),
      flank: 20 + (this.profile === 'skirmisher' ? 34 : 0),
    };
    if (this.profile === 'swarm') scores.approach += 40;
    if (this.profile === 'brute') { scores.approach += 20; scores.retreat -= 20; }
    if (this.profile === 'hound') scores.approach += 50;
    if (this.profile === 'guard') { scores.approach -= 30; scores.strafe += 30; }
    if (this.profile === 'flyer') scores.zone += 40;

    let best = 'approach', bestScore = -Infinity;
    for (const [k, v] of Object.entries(scores)) {
      const jitter = this.range(0, 18);
      if (v + jitter > bestScore) { bestScore = v + jitter; best = k; }
    }
    if (best !== this.behaviour) { this.behaviour = best; this.behaviourTime = 0; }
    if (this.chance(0.3)) this.strafeDir *= -1;
  }

  // --- Defence -------------------------------------------------------------

  defensiveLayer(dt, world, t, dist) {
    const f = this.f;
    const it = f.intent;
    const sk = this.skill;

    // Inside an enemy domain: Simple Domain is the correct answer and the AI
    // knows it, if it is skilled enough.
    if (f.insideDomain && f.insideDomain.team !== f.team && f.maxCe > 0) {
      if (f.simpleDomain.mastered || f.grade === 1 || f.grade === 'special' || this.chance(0.6)) {
        it.simpleDomain = f.ce > 12;
      }
      if (f.domainReady() && this.chance(0.02)) it.domain = true;
      if (f.domain) it.domainPush = true;
    }

    // Threat detection: is the target winding up something that will hurt?
    const incoming = this.incomingThreat(world, t, dist);
    if (incoming) {
      const roll = this.rand();
      if (roll < sk.parry && dist < 3.4) {
        it.parryPressed = true;
        this.blockHold = 0.22;
      } else if (roll < sk.parry + sk.dodge) {
        it.dash = true;
        const away = vnorm(vsub(f.pos, t.pos));
        const side = { x: -away.y * this.strafeDir, y: away.x * this.strafeDir };
        it.move.x = away.x * 0.6 + side.x;
        it.move.y = away.y * 0.6 + side.y;
      } else if (roll < sk.parry + sk.dodge + 0.35 && !f.flags.noBlock) {
        this.blockHold = 0.4;
      }
    }
    if (this.blockHold > 0) {
      this.blockHold -= dt;
      it.block = true;
    }

    // Healing.
    if (this.behaviour === 'heal' && f.hpFraction < 0.55 && f.ce > f.maxCe * 0.3 && dist > 5) {
      it.rct = true;
    }

    // Amplification against a Limitless user.
    if (t.techniqueId === 'limitless' && dist < 5 && !f.amplify.active && f.ce > 45 && this.chance(dt * 0.6)) {
      it.amplify = true;
    }
  }

  incomingThreat(world, t, dist) {
    if (!t) return false;
    if (t.state === 'attack' && t.action) {
      const a = t.action;
      if (a.phase === 'startup') {
        const facing = Math.abs(wrapAngle(vangle(vsub(this.f.pos, t.pos)) - t.facing)) < 1.0;
        if (facing && dist < (a.def.range || 2) + 1.6) return true;
      }
    }
    if (t.state === 'cast' && dist < 16) return this.chance(0.5);
    for (const p of world.projectiles) {
      if (p.team === this.f.team) continue;
      const d = vdist(p.pos, this.f.pos);
      if (d < 5 && vlen(p.vel) > 1) {
        const toMe = vangle(vsub(this.f.pos, p.pos));
        if (Math.abs(wrapAngle(toMe - vangle(p.vel))) < 0.5) return true;
      }
    }
    return false;
  }

  // --- Movement ------------------------------------------------------------

  movementLayer(dt, world, t, dist) {
    const f = this.f;
    const it = f.intent;
    const toT = vsub(t.pos, f.pos);
    const dir = vlen(toT) > 0.01 ? vnorm(toT) : vec(1, 0);
    const side = { x: -dir.y * this.strafeDir, y: dir.x * this.strafeDir };

    let want = vec(0, 0);
    const reach = (f.stats.reach ?? 1) * 2.0 + (f.tool?.reach ?? 1) * 0.5;
    const ideal = this.profile === 'caster' ? 9 : this.profile === 'flyer' ? 7 : reach;

    switch (this.behaviour) {
      case 'approach':
      case 'pressure':
        if (dist > ideal * 0.9) want = dir;
        else if (dist < ideal * 0.55) want = vscale(dir, -1);
        else want = side;
        break;
      case 'strafe':
        want = vadd(vscale(side, 1), vscale(dir, dist > ideal ? 0.5 : -0.25));
        break;
      case 'retreat':
        want = vscale(dir, -1);
        break;
      case 'heal':
        want = vscale(dir, -1);
        break;
      case 'zone':
        if (dist < 7) want = vscale(dir, -1);
        else if (dist > 12) want = dir;
        else want = side;
        break;
      case 'flank':
        want = vadd(vscale(side, 1.2), vscale(dir, 0.35));
        break;
      default:
        want = vec(0, 0);
    }

    // Avoid walking into hazards and props.
    for (const z of world.zones) {
      if (z.team === f.team) continue;
      const d = vdist(f.pos, z.pos);
      if (d < z.radius + 1.5) {
        const away = vnorm(vsub(f.pos, z.pos));
        want = vadd(want, vscale(away, 1.6));
      }
    }
    for (const p of world.props) {
      if (p.destroyed) continue;
      const d = vdist(f.pos, p.pos);
      if (d < p.radius + 1.1) {
        const away = vnorm(vsub(f.pos, p.pos));
        want = vadd(want, vscale(away, 1.2));
      }
    }
    // Stay inside the veil.
    const edge = world.arenaRadius - vdist(f.pos, world.arenaCenter);
    if (edge < 4) {
      const inward = vnorm(vsub(world.arenaCenter, f.pos));
      want = vadd(want, vscale(inward, 2.2));
    }

    const l = vlen(want);
    if (l > 0.01) { want.x /= l; want.y /= l; }
    it.move.x = want.x;
    it.move.y = want.y;

    // Gap closers.
    if (dist > 7 && this.behaviour !== 'retreat' && this.behaviour !== 'heal' && this.chance(dt * 0.8) && f.ce > 20) {
      it.dash = true;
    }
    if (this.profile === 'hound' && dist > 4 && this.chance(dt * 1.6)) it.dash = true;
  }

  // --- Offence -------------------------------------------------------------

  offenceLayer(dt, world, t, dist) {
    const f = this.f;
    const it = f.intent;
    const sk = this.skill;
    if (this.behaviour === 'heal' && f.state === 'rct') return;
    if (f.state === 'cast' || f.state === 'domainCast') return;

    const reach = 2.1 * (f.stats.reach ?? 1) * (f.tool?.reach ?? 1);
    const punishing = t.state === 'stagger' || t.state === 'knockdown' || t.state === 'cast' || t.state === 'domainCast';

    // Abilities.
    if (this.abilityTimer <= 0 && f.technique && !f.actionFlags.noTechnique) {
      this.abilityTimer = this.range(1.0, 3.4) * (1.4 - sk.ability);
      const choices = [];
      f.abilityList().forEach((ab, i) => {
        if (!f.abilityReady(i)) return;
        let score = 30;
        if (ab.archetype === 'projectile' || ab.archetype === 'beam' || ab.archetype === 'command') {
          score += dist > 5 ? 40 : 5;
        }
        if (ab.archetype === 'melee' || ab.archetype === 'dashStrike') score += dist < 5 ? 40 : 10;
        if (ab.archetype === 'summon') score += 25 + (world.countSummons(f) < 2 ? 30 : -40);
        if (ab.archetype === 'buff') score += f.hpFraction < 0.7 ? 30 : 10;
        if (ab.ultimate) score += punishing ? 60 : -25;
        if (ab.requires?.hpBelow && f.hpFraction <= ab.requires.hpBelow) score += 60;
        score *= sk.ability;
        choices.push({ i, score: score + this.range(0, 20) });
      });
      choices.sort((a, b) => b.score - a.score);
      if (choices.length && choices[0].score > 28) {
        it.ability = choices[0].i;
        return;
      }
    }

    // Domain Expansion — special grades and grade 1s will open one when the
    // fight is going badly or the opening is huge.
    if (f.domainReady() && !f.domain) {
      const want = (f.hpFraction < 0.55 || punishing || t.hpFraction < 0.4);
      if (want && this.chance(dt * (f.grade === 'special' ? 0.5 : 0.2))) {
        it.domain = true;
        return;
      }
    }
    if (f.domain) it.domainPush = true;

    // Melee.
    if (dist <= reach + 0.7) {
      if (t.state === 'block' && this.chance(dt * 2.5)) { it.grab = true; return; }
      if (punishing && this.chance(dt * 6)) { it.attackCharged = true; return; }
      const rate = 2.6 * sk.aggression * (1 - sk.mistake * 0.5);
      if (this.chance(dt * rate)) {
        // The AI aims for Black Flash too: it will hold the next hit if the
        // timing band is about to open.
        if (f.canBlackFlash && f.flashWindow.active) {
          const fw = f.flashWindow;
          const untilBand = fw.start - fw.t;
          const startup = 0.11;
          if (untilBand > startup + 0.02) return;    // wait for the band
        }
        if (this.chance(0.18)) it.attackCharged = true;
        else it.attackTap = true;
      }
    } else if (dist < reach + 3 && this.chance(dt * 0.9) && f.ce > 15) {
      it.dash = true;
      it.attackTap = true;
    }
  }

  wander(dt, world) {
    const f = this.f;
    if (this.chance(dt * 0.4)) {
      this.wanderAngle = this.rand() * TAU;
    }
    if (this.wanderAngle == null) this.wanderAngle = this.rand() * TAU;
    const d = vfromAngle(this.wanderAngle);
    f.intent.move.x = d.x * 0.4;
    f.intent.move.y = d.y * 0.4;
    f.intent.aim = this.wanderAngle;
  }
}

/** Shikigami and other allied summons: simpler, loyal, relentless. */
export class SummonController extends AIController {
  constructor(fighter, profile, rng) {
    super(fighter, profile || 'hound', rng);
  }
  pickTarget(world) {
    const f = this.f;
    const owner = world.byId(f.summonOwner);
    let best = null, bestD = Infinity;
    for (const o of world.fighters) {
      if (o.dead || o.team === f.team) continue;
      let d = vdist(f.pos, o.pos);
      if (owner && o.id === owner.lastHitBy) d *= 0.5;
      if (owner && owner.intent.lockTarget === o.id) d *= 0.4;
      if (d < bestD) { bestD = d; best = o; }
    }
    // Stay near the summoner if nothing is close.
    if (owner && bestD > 22) return null;
    return best;
  }
  wander(dt, world) {
    const f = this.f;
    const owner = world.byId(f.summonOwner);
    if (!owner) { super.wander(dt, world); return; }
    const to = vsub(owner.pos, f.pos);
    const d = vlen(to);
    if (d > 3.5) {
      const dir = vnorm(to);
      f.intent.move.x = dir.x;
      f.intent.move.y = dir.y;
      f.intent.aim = vangle(dir);
    } else {
      f.intent.move.x = 0;
      f.intent.move.y = 0;
    }
  }
}
