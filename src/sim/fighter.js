// The Fighter: every combatant in the game, player or AI, sorcerer or curse.
//
// A fighter never reads input directly. A controller (player input or the AI)
// fills in `intent` each frame and the fighter decides what is legal from its
// current state. That keeps the whole combat model testable headlessly.

import {
  clamp, clamp01, lerp, damp, vec, vadd, vsub, vscale, vnorm, vlen, vdist,
  vfromAngle, vangle, wrapAngle, angleDamp, rand, chance, TAU, PI,
} from '../core/math.js';
import { ACTIONS, LIGHT_CHAIN, AIR_CHAIN, actionTotal, scaleAction } from '../data/actions.js';
import { getTool } from '../data/tools.js';
import { getTechnique } from '../data/techniques.js';
import { addStatus, removeStatus, getStatus, hasStatus, updateStatuses } from './status.js';
import {
  dealDamage, targetsInArc, openFlashWindow, closeFlashWindow, stagger, reinforcement, FLASH,
} from './combat.js';
import { assistedAim, hitGenerosity } from './assist.js';

export const GRAVITY = 24;
export const SIMPLE_DOMAIN_RADIUS = 2.21; // two shaku two sun one bu, the canonical radius

/**
 * How much Flow a domain costs to open. A domain is the centrepiece of the
 * game, so the bar to reach one is deliberately low — the interesting decision
 * is *when* you open it and what the other player does about it, not whether
 * you ever get to.
 */
export const DOMAIN_FLOW = 0.22;

/** Cooldown cap on the first ability slot of every technique. */
export const FIRST_ABILITY_COOLDOWN = 0.1;

let nextId = 1;

const emptyIntent = () => ({
  move: { x: 0, y: 0 },
  aim: 0,
  attackTap: false,
  attackCharged: false,
  grab: false,
  block: false,
  parryPressed: false,
  dash: false,
  jump: false,
  ability: -1,
  domain: false,
  simpleDomain: false,
  amplify: false,
  rct: false,
  vow: false,
  tool: false,
  lockTarget: null,
});

export class Fighter {
  constructor(spec, world) {
    this.id = nextId++;
    this.world = world;
    this.spec = spec;
    this.name = spec.name || 'Sorcerer';
    this.title = spec.title || '';
    this.team = spec.team ?? 1;
    this.isPlayer = !!spec.isPlayer;
    this.kind = spec.kind || 'sorcerer';
    this.grade = spec.grade ?? 2;
    this.summonOwner = spec.summonOwner ?? null;
    this.decoy = !!spec.decoy;
    this.appearance = spec.appearance || {};
    this.shape = spec.shape || 'humanoid';
    this.scale = spec.scale ?? 1;
    this.color = spec.color || '#d9d9d9';
    this.color2 = spec.color2 || '#2a2a32';
    this.eyeColor = spec.eyeColor || '#ffd166';

    // --- Stats -------------------------------------------------------------
    this.stats = Object.assign({
      maxHp: 260, maxCe: 100, ceControl: 0.5, ceRegen: 6.5,
      speed: 1, power: 1, weight: 1, reach: 1, poise: 100, rct: 0.4, domainSkill: 1,
    }, spec.stats || {});

    this.vowMods = {
      techniqueOutput: 0, physicalOutput: 0, maxCe: 0, maxHp: 0, ceRegen: 0,
      reinforce: 0, speed: 0, poise: 0, flashBand: 0, attackSpeed: 0, dash: 0,
      parryRefund: 0, domainCast: 0, domainIntegrity: 0, domainCost: 0,
      lockAbilities: [], cheapBasics: false,
    };
    this.flags = {};
    this.vows = [];

    this.maxHp = this.stats.maxHp;
    this.hp = this.maxHp;
    this.maxCe = this.stats.maxCe;
    this.ce = this.maxCe;
    this.maxPoise = this.stats.poise;
    this.poise = this.maxPoise;
    this.flow = 0;
    this.throat = 0;

    // --- Kit ---------------------------------------------------------------
    this.techniqueId = spec.technique || null;
    this.technique = this.techniqueId ? getTechnique(this.techniqueId) : null;
    this.toolId = spec.tool || 'fists';
    this.tool = getTool(this.toolId);
    this.toolBelt = spec.toolBelt || [this.toolId];
    this.basicActions = spec.actions || LIGHT_CHAIN;

    // --- Transform ---------------------------------------------------------
    this.pos = vec(spec.x ?? 0, spec.y ?? 0);
    this.vel = vec(0, 0);
    this.z = 0;
    this.vz = 0;
    this.facing = spec.facing ?? 0;
    this.aim = this.facing;
    // 0 for everything the AI drives; the world raises it for the player only,
    // from the settings slider. Assist that cuts both ways is not assist.
    this.aimAssist = 0;
    this.radius = spec.radius ?? 0.45;
    this.height = 1.75 * (this.appearance.height ?? 1) * this.scale;
    this.airborne = false;
    this.airDashes = 1;
    this.flying = !!spec.flying;

    // --- State machine -----------------------------------------------------
    this.state = 'idle';
    this.stateTime = 0;
    this.action = null;
    this.chainIndex = -1;
    this.chainWindow = 0;
    this.cast = null;
    this.staggerTime = 0;
    this.dead = false;
    this.deathTime = 0;
    this.invulnerable = false;
    this.actionLock = false;
    this.actionFlags = {};

    // --- Combat timers -----------------------------------------------------
    this.iframes = 0;
    this.parryTimer = 0;
    this.parryCooldown = 0;
    this.parrySuccess = 0;
    this.poiseRecoverDelay = 0;
    this.timeSinceHit = 99;
    this.timeSinceDealt = 99;
    this.lastHitBy = null;
    this.lastHitTime = -99;
    this.combo = { count: 0, timer: 0, damage: 0 };
    this.wounds = { arms: 0, legs: 0 };
    this.cooldowns = {};
    this.burnoutTimer = 0;
    this.domainBurnout = 0;
    this.infinityFlicker = 0;
    this.hitLag = 0;

    // --- Black Flash -------------------------------------------------------
    this.canBlackFlash = spec.canBlackFlash ?? (this.isPlayer || this.grade === 1 || this.grade === 'special' || this.kind === 'sorcerer');
    this.flashWindow = { active: false, t: 0, dur: 0, start: 0, band: 0, chain: 0, failScale: 1, failTimer: 0 };
    this.blackFlashCount = 0;
    this.bestChain = 0;
    this.perfectParries = 0;

    // --- Defensive techniques ----------------------------------------------
    this.simpleDomain = { active: false, counterCd: 0, t: 0, mastered: !!spec.simpleDomainMastered };
    this.amplify = { active: false, t: 0 };
    this.domain = null;         // the domain this fighter currently holds open
    this.insideDomain = null;   // the domain currently affecting this fighter

    // --- Misc --------------------------------------------------------------
    this.statuses = [];
    this.resist = Object.assign({}, spec.resist || {});
    this.adapts = !!spec.adapts;
    this.adaptation = {};
    this.spiritCount = 0;
    this.shikigamiPool = 3;
    this.rhythm = 0;
    this.evidence = 0;
    this.kills = 0;
    this.damageDealt = 0;
    this.damageTaken = 0;
    this.intent = emptyIntent();
    this.mods = {};
    this.anim = { walk: 0, swing: 0, lean: 0, breathe: (world?.rng ? world.rng.next() : 0) * TAU, hurt: 0, cast: 0 };
    this.trail = [];
    this.resetMods();

    if (spec.ai) this.aiProfile = spec.ai;
    if (spec.summon) this.isSummon = true;
    this.life = spec.life ?? 0; // summon lifespan, 0 = permanent
  }

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  resetMods() {
    this.mods = {
      speed: 0, output: 0, physical: 0, technique: 0, reinforce: 0,
      ceRegen: 0, ceGain: 0, poiseRegen: 0, poiseMax: 0, costMul: 0,
      maxCe: 0, attackSpeed: 0, flashBand: 0, dash: 0, damageTaken: 0,
      healingTaken: 0, critTaken: 0, accuracy: 0,
    };
    this.actionFlags = {};
    this.actionLock = false;
  }

  get moveSpeed() {
    const base = 5.4 * (this.stats.speed ?? 1);
    const woundMul = 1 - clamp01(this.wounds.legs * 0.35);
    const m = 1 + this.mods.speed + this.vowMods.speed;
    return Math.max(0.4, base * woundMul * m);
  }

  get ceFraction() { return this.maxCe > 0 ? clamp01(this.ce / this.maxCe) : 0; }
  get hpFraction() { return clamp01(this.hp / Math.max(1, this.maxHp)); }
  get reinforcement() { return reinforcement(this); }
  get alive() { return !this.dead; }
  get center() { return { x: this.pos.x, y: this.pos.y, z: this.z + this.height * 0.5 }; }

  costMultiplier() {
    let m = 1 + this.mods.costMul;
    if (this.flags.sixEyes) m *= 0.6;
    if (this.techniqueId === 'limitless' && this.stats.ceControl > 0.9) m *= 0.6; // Six Eyes
    return Math.max(0.15, m);
  }

  hasStatus(t) { return hasStatus(this, t); }
  getStatus(t) { return getStatus(this, t); }
  removeStatus(t) { removeStatus(this, t); }
  clearCooldowns() { this.cooldowns = {}; }

  // -------------------------------------------------------------------------
  // Resources
  // -------------------------------------------------------------------------

  spendCe(amount) {
    const cost = amount * this.costMultiplier();
    if (this.ce < cost) return false;
    this.ce -= cost;
    return true;
  }

  canAfford(amount) { return this.ce >= amount * this.costMultiplier(); }

  gainCe(n) { this.ce = clamp(this.ce + n, 0, this.maxCe); }

  heal(amount, { rct = false, source = '' } = {}) {
    if (this.dead) return 0;
    if (this.flags.onlyRctHeal && !rct) return 0;
    const mult = 1 + this.mods.healingTaken;
    const healed = Math.max(0, amount * mult);
    const before = this.hp;
    this.hp = Math.min(this.maxHp, this.hp + healed);
    return this.hp - before;
  }

  takeTrueDamage(amount, source = '', showNumber = true) {
    if (this.dead || amount <= 0) return;
    this.hp -= amount;
    this.damageTaken += amount;
    if (showNumber && this.world) {
      this.world.event({
        type: 'damage', kind: 'dot', victim: this.id, damage: amount,
        pos: { x: this.pos.x, y: this.pos.y }, z: this.z + 1.2, sourceName: source,
      });
    }
    if (this.hp <= 0 && this.world) this.world.killFighter(this, null, { sourceName: source });
  }

  addWound(kind) {
    this.wounds[kind] = clamp01((this.wounds[kind] || 0) + 0.34);
    if (this.world) {
      this.world.event({ type: 'wound', victim: this.id, kind });
      if (this.isPlayer) this.world.notify(kind === 'arms' ? 'ARM DAMAGED' : 'LEG DAMAGED', '#ff8a8a');
    }
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Frame data for an action id, scaled by the equipped tool and buffs. */
  getAction(id) {
    const raw = ACTIONS[id];
    if (!raw) return null;
    const t = this.tool || {};
    let a = scaleAction(raw, {
      weight: raw.kind === 'special' ? 1 : (t.weight ?? 1),
      power: t.power ?? 1,
      reach: (t.reach ?? 1) * (this.stats.reach ?? 1),
    });
    const speedMul = 1 / (1 + this.mods.attackSpeed + this.vowMods.attackSpeed);
    if (speedMul !== 1) {
      a = Object.assign({}, a, {
        startup: a.startup * speedMul,
        active: a.active,
        recovery: a.recovery * speedMul,
      });
    }
    if (t.poiseMul) a = Object.assign({}, a, { poise: a.poise * t.poiseMul });
    return a;
  }

  canAct() {
    if (this.dead || this.actionLock) return false;
    if (this.state === 'stagger' || this.state === 'knockdown' || this.state === 'grabbed') return false;
    if (this.state === 'cast' || this.state === 'domainCast') return false;
    if (this.state === 'attack') {
      const a = this.action;
      if (!a) return true;
      const total = actionTotal(a.def);
      return a.t >= total * a.def.cancelAt;
    }
    if (this.state === 'dash') return this.stateTime > 0.14;
    return true;
  }

  /** Start a melee action. Returns true if it came out. */
  startAction(id, { chain = false } = {}) {
    const def = this.getAction(id);
    if (!def) return false;
    if (def.groundOnly && this.z > 0.3 && !def.airOk) return false;
    this.state = 'attack';
    this.stateTime = 0;
    this.action = {
      def, t: 0, phase: 'startup', hitSet: new Set(),
      multiFired: 0, nextMulti: 0, chain,
    };
    this.anim.swing = 0;
    if (!chain) this.combo.timer = Math.max(this.combo.timer, 1.4);
    // Commit-time aim assist: the swing goes where you were pointing, nudged
    // the last few degrees onto whatever you were plainly pointing at. It has
    // to happen before the step, so a lunge travels down the corrected line
    // rather than sliding past the target it just locked.
    if (this.world && this.aimAssist > 0) {
      this.aim = assistedAim(this.world, this, this.aim, def.range || 2, this.aimAssist);
    }
    if (def.step) {
      const d = vfromAngle(this.aim);
      this.vel.x = d.x * def.step;
      this.vel.y = d.y * def.step;
      this.stepTimer = def.stepTime;
    }
    this.facing = this.aim;
    if (this.world) {
      const pitch = 0.9 + (this.world.rng ? this.world.rng.next() : 0.5) * 0.25;
      this.world.audio(def.sfx || 'swing', { volume: 0.5, throttle: 30, pitch });
    }
    return true;
  }

  /** The light chain this fighter actually owns. Curses and shikigami have
   *  their own movesets (claw, bite, tail whip) rather than the human chain. */
  lightChain() {
    if (this.basicActions && this.basicActions !== LIGHT_CHAIN && this.basicActions.length) {
      return this.basicActions.filter((id) => {
        const a = ACTIONS[id];
        return a && a.kind !== 'heavy';
      });
    }
    return LIGHT_CHAIN;
  }

  /** The heavy option this fighter owns, if any. */
  heavyAction() {
    if (this.basicActions && this.basicActions !== LIGHT_CHAIN && this.basicActions.length) {
      const heavy = this.basicActions.find((id) => ACTIONS[id] && ACTIONS[id].kind === 'heavy');
      return heavy || this.basicActions[this.basicActions.length - 1];
    }
    return null;
  }

  /** Advance the light chain (or start it). */
  pressLight() {
    const airborne = this.z > 0.35;
    const own = this.lightChain();
    const chainList = airborne && own === LIGHT_CHAIN ? AIR_CHAIN : own;
    if (this.state === 'attack' && this.action) {
      const cur = this.action.def;
      const nextId = cur.next;
      if (nextId && this.canAct()) {
        return this.startAction(nextId, { chain: true });
      }
      return false;
    }
    if (!this.canAct()) return false;
    if (chainList.length === 0) return false;
    if (this.state === 'dash' && this.stateTime < 0.22 && own === LIGHT_CHAIN) return this.startAction('dashAttack');
    // Curses with several attacks pick one at random rather than chaining.
    const pick = own === LIGHT_CHAIN || airborne
      ? chainList[0]
      : chainList[Math.floor((this.world?.rng.next() ?? 0) * chainList.length)];
    return this.startAction(pick);
  }

  pressHeavy(charged) {
    if (!this.canAct()) return false;
    const own = this.heavyAction();
    if (own) return this.startAction(own);
    if (this.z > 0.35) return this.startAction('airFinish');
    return this.startAction(charged ? 'heavyCharged' : 'heavy');
  }

  pressGrab() {
    if (!this.canAct() || this.z > 0.35) return false;
    return this.startAction('grab');
  }

  tryDash(dirVec) {
    if (this.dead || this.actionLock) return false;
    if (this.state === 'stagger' || this.state === 'knockdown') return false;
    if (this.dashCooldown > 0) return false;
    const airborne = this.z > 0.3;
    if (airborne && this.airDashes <= 0) return false;
    const cost = airborne ? 12 : 8;
    if (this.maxCe > 0 && !this.spendCe(cost)) return false;
    const d = vlen(dirVec) > 0.1 ? vnorm(dirVec) : vfromAngle(this.aim);
    const dist = 9.5 * (1 + this.mods.dash + this.vowMods.dash);
    this.state = 'dash';
    this.stateTime = 0;
    this.action = null;
    this.vel.x = d.x * dist;
    this.vel.y = d.y * dist;
    this.iframes = 0.15;
    this.dashCooldown = 0.34;
    if (airborne) this.airDashes--;
    this.facing = vangle(d);
    if (this.world) {
      this.world.audio('dash', { volume: 0.4, throttle: 60 });
      this.world.fx('dashTrail', { pos: this.pos, z: this.z, angle: this.facing, owner: this.id });
    }
    return true;
  }

  tryJump() {
    if (!this.canAct()) return false;
    if (this.z > 0.2) return false;
    this.vz = 8.2;
    this.airborne = true;
    this.airDashes = 1;
    this.state = 'air';
    this.stateTime = 0;
    return true;
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  update(dt, world) {
    this.world = world;
    this.resetMods();

    if (this.dead) {
      this.deathTime += dt;
      this.vel.x = damp(this.vel.x, 0, 6, dt);
      this.vel.y = damp(this.vel.y, 0, 6, dt);
      this.integrate(dt, world);
      return;
    }

    // Timers.
    this.stateTime += dt;
    this.timeSinceHit += dt;
    this.timeSinceDealt += dt;
    this.iframes = Math.max(0, this.iframes - dt);
    this.parryTimer = Math.max(0, this.parryTimer - dt);
    this.parryCooldown = Math.max(0, this.parryCooldown - dt);
    this.parrySuccess = Math.max(0, this.parrySuccess - dt);
    this.dashCooldown = Math.max(0, (this.dashCooldown || 0) - dt);
    this.poiseRecoverDelay = Math.max(0, this.poiseRecoverDelay - dt);
    this.burnoutTimer = Math.max(0, this.burnoutTimer - dt);
    this.domainBurnout = Math.max(0, this.domainBurnout - dt);
    this.infinityFlicker = Math.max(0, this.infinityFlicker - dt);
    this.simpleDomain.counterCd = Math.max(0, this.simpleDomain.counterCd - dt);
    this.combo.timer -= dt;
    if (this.combo.timer <= 0 && this.combo.count > 0) {
      world.event({ type: 'comboEnd', fighter: this.id, hits: this.combo.count, damage: this.combo.damage });
      this.combo.count = 0;
      this.combo.damage = 0;
    }
    for (const k of Object.keys(this.cooldowns)) {
      this.cooldowns[k] -= dt;
      if (this.cooldowns[k] <= 0) delete this.cooldowns[k];
    }
    this.flags.burnout = this.burnoutTimer > 0;

    // Black Flash window.
    const fw = this.flashWindow;
    if (fw.active) {
      fw.t += dt;
      if (!fw.ticked && fw.t >= fw.start) {
        fw.ticked = true;
        if (this.isPlayer) world.audio('flashTick', { volume: 0.5 });
      }
      if (fw.t > fw.dur) {
        fw.active = false;
        fw.chain = 0;
      }
    }
    if (fw.failTimer > 0) {
      fw.failTimer -= dt;
      if (fw.failTimer <= 0) fw.failScale = 1;
    }
    if (this.timeSinceDealt > 3 && fw.chain > 0 && !this.flags.keepFlashChain) fw.chain = 0;

    // Statuses and passives fill in `mods`.
    updateStatuses(this, dt, world);
    if (this.technique?.passive?.onUpdate) {
      this.technique.passive.onUpdate({ world, self: this, dt });
    }
    this.mods.reinforce += this.vowMods.reinforce;
    this.mods.ceRegen += this.vowMods.ceRegen * this.stats.ceRegen;

    // Derived maxima.
    this.maxCe = Math.max(0, this.stats.maxCe * (1 + this.vowMods.maxCe) + this.mods.maxCe);
    this.maxPoise = this.stats.poise * (1 + this.vowMods.poise) + this.mods.poiseMax * this.stats.poise;
    this.ce = Math.min(this.ce, this.maxCe);

    // Life timer for summons.
    if (this.life > 0) {
      this.life -= dt;
      if (this.life <= 0) { world.despawn(this, 'expired'); return; }
    }

    // Defensive techniques (drain first — they can force you out).
    this.updateSimpleDomain(dt, world);
    this.updateAmplification(dt, world);

    // Intent -> state machine.
    this.applyIntent(dt, world);
    this.updateState(dt, world);

    // Regeneration.
    this.regen(dt, world);

    // Physics.
    this.integrate(dt, world);

    // Animation bookkeeping.
    const speed = vlen(this.vel);
    this.anim.walk += dt * (2 + speed * 1.1);
    this.anim.breathe += dt * 1.6;
    this.anim.hurt = Math.max(0, this.anim.hurt - dt * 3);
    this.anim.lean = damp(this.anim.lean, clamp(speed / 9, 0, 1), 8, dt);
    if (this.state === 'attack' && this.action) {
      this.anim.swing = clamp01(this.action.t / Math.max(0.01, actionTotal(this.action.def)));
    } else {
      this.anim.swing = damp(this.anim.swing, 0, 12, dt);
    }

    // Motion trail used by the renderer for fast movement.
    if (speed > 7 || this.state === 'dash') {
      this.trail.push({ x: this.pos.x, y: this.pos.y, z: this.z, t: 0.28, facing: this.facing });
      if (this.trail.length > 14) this.trail.shift();
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].t -= dt;
      if (this.trail[i].t <= 0) this.trail.splice(i, 1);
    }
  }

  regen(dt, world) {
    // Cursed energy.
    if (this.maxCe > 0) {
      let regen = this.stats.ceRegen + this.mods.ceRegen;
      if (this.state === 'attack') regen *= 0.35;
      else if (this.state === 'cast' || this.state === 'domainCast') regen = 0;
      else if (this.state === 'block') regen *= 0.5;
      else if (vlen(this.vel) > 1.5) regen *= 0.7;
      if (this.flags.burnout) regen *= 0.25;
      if (this.hasStatus('indicted')) regen = 0;
      if (this.domain) regen = 0;
      this.ce = clamp(this.ce + regen * dt, 0, this.maxCe);
    }

    // Poise.
    if (this.poiseRecoverDelay <= 0 && this.state !== 'stagger') {
      const rate = this.maxPoise * (0.35 + this.mods.poiseRegen) * (this.state === 'block' ? 0.45 : 1);
      this.poise = clamp(this.poise + rate * dt, 0, this.maxPoise);
    }

    // Flow decays unless you keep the pressure on.
    const decay = this.timeSinceDealt > 2.5 ? 0.055 : 0.012;
    this.flow = clamp01(this.flow - decay * dt);
  }

  integrate(dt, world) {
    // Horizontal friction depends on what you are doing. Grounded friction is
    // high on purpose: a fighting game wants you to stop when you let go, not
    // to coast, and every frame of slide is a frame you did not control.
    let friction = 15;
    if (this.state === 'dash') friction = 4.0;
    else if (this.state === 'attack') friction = 11;
    else if (this.state === 'stagger' || this.state === 'knockdown') friction = 3.2;
    if (this.z > 0.1) friction = 1.1;

    this.vel.x = damp(this.vel.x, 0, friction, dt);
    this.vel.y = damp(this.vel.y, 0, friction, dt);

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Vertical.
    if (this.flying) {
      const target = 2.4;
      this.z = damp(this.z, target, 3, dt);
      this.vz = 0;
    } else if (this.z > 0 || this.vz > 0) {
      this.vz -= GRAVITY * dt;
      this.z += this.vz * dt;
      if (this.z <= 0) {
        const impact = -this.vz;
        this.z = 0;
        this.vz = 0;
        this.airborne = false;
        this.airDashes = 1;
        if (impact > 6) {
          world.fx('landDust', { pos: this.pos, power: impact });
          world.audio('land', { volume: clamp(impact / 22, 0.15, 0.7), throttle: 60 });
          if (impact > 13 && this.state !== 'dash') {
            this.poise -= impact * 1.6;
            if (this.poise <= 0) stagger(world, this, { poise: 0 }, 0.7);
          }
        }
        if (this.state === 'air') this.state = 'idle';
      }
    }
  }

  // -------------------------------------------------------------------------
  // Intent handling
  // -------------------------------------------------------------------------

  applyIntent(dt, world) {
    const it = this.intent;
    if (this.dead) return;

    // Aim.
    if (typeof it.aim === 'number' && isFinite(it.aim)) {
      this.aim = it.aim;
      if (this.canAct() || this.state === 'block' || this.state === 'idle' || this.state === 'move') {
        // Turning is near-instant when idle so the character always faces what
        // you are pointing at; it slows while guarding, where committing to a
        // direction is the whole point of the stance.
        const turnRate = this.state === 'block' ? 11 : 34;
        this.facing = angleDamp(this.facing, this.aim, turnRate, dt);
      }
    }

    // Blocking / parry.
    const wantsBlock = it.block && !this.flags.noBlock;
    if (it.parryPressed && !this.flags.noBlock && this.parryCooldown <= 0 && this.canAct()) {
      this.parryTimer = 0.19;
      this.parryCooldown = 0.5;
      world.fx('parryFlash', { pos: this.pos, z: this.z + 1, owner: this.id });
    }
    if (wantsBlock && this.canAct() && this.z < 0.3 && this.state !== 'dash') {
      if (this.state !== 'block') { this.state = 'block'; this.stateTime = 0; }
    } else if (this.state === 'block' && !wantsBlock) {
      this.state = 'idle';
    }

    // Reverse Cursed Technique (hold).
    this.updateRct(dt, world, it.rct);
    if (this.state === 'rct') return;

    // Movement.
    const canMove = this.state === 'idle' || this.state === 'move' || this.state === 'block' ||
      this.state === 'air' || (this.state === 'attack' && this.action && this.action.t > actionTotal(this.action.def) * 0.85);
    if (canMove && !this.hasStatus('root')) {
      const mv = it.move;
      const mag = Math.hypot(mv.x, mv.y);
      if (mag > 0.05) {
        let sp = this.moveSpeed;
        if (this.state === 'block') sp *= 0.42;
        if (this.simpleDomain.active) sp *= 0.45;
        if (this.z > 0.2) sp *= 0.72;
        // Reaching top speed should take a couple of frames, not a fifth of a
        // second. The friction above still has to be beaten, so the target is
        // overshot by the amount friction will immediately eat.
        const accel = this.z > 0.2 ? 5 : 26;
        const tx = (mv.x / Math.max(mag, 1)) * sp;
        const ty = (mv.y / Math.max(mag, 1)) * sp;
        const friction = this.z > 0.1 ? 1.1 : (this.state === 'attack' ? 11 : 15);
        const k = 1 + friction / accel;
        this.vel.x = damp(this.vel.x, tx * k, accel, dt);
        this.vel.y = damp(this.vel.y, ty * k, accel, dt);
        if (this.state === 'idle') this.state = 'move';
      } else if (this.state === 'move') {
        this.state = 'idle';
      }
    }

    // Dash / jump.
    if (it.dash) this.tryDash(it.move);
    if (it.jump) this.tryJump();

    // Attacks.
    if (it.attackCharged) this.pressHeavy(true);
    else if (it.attackTap) this.pressLight();
    if (it.grab) this.pressGrab();

    // Technique abilities.
    if (it.ability >= 0) this.tryAbility(it.ability, world);

    // Domain Expansion / Amplification.
    if (it.domain) this.tryDomain(world);
    if (it.amplify) this.tryAmplify(world);
    if (it.tool) world.cycleTool(this);

    // Reset one-shot intents; the controller re-arms them each frame.
    it.attackTap = false;
    it.attackCharged = false;
    it.grab = false;
    it.dash = false;
    it.jump = false;
    it.ability = -1;
    it.domain = false;
    it.amplify = false;
    it.parryPressed = false;
    it.tool = false;
    it.vow = false;
  }

  updateState(dt, world) {
    switch (this.state) {
      case 'attack': this.updateAttack(dt, world); break;
      case 'dash':
        if (this.stateTime < 0.15) this.iframes = Math.max(this.iframes, 0.02);
        if (this.stateTime > 0.3) this.state = this.z > 0.2 ? 'air' : 'idle';
        break;
      case 'stagger':
        this.staggerTime -= dt;
        if (this.staggerTime <= 0) {
          this.state = this.z > 0.2 ? 'air' : 'idle';
          this.poise = this.maxPoise * 0.35;
          this.iframes = Math.max(this.iframes, 0.12);
        }
        break;
      case 'cast': this.updateCast(dt, world); break;
      case 'domainCast': this.updateDomainCast(dt, world); break;
      default: break;
    }
  }

  updateAttack(dt, world) {
    const a = this.action;
    if (!a) { this.state = 'idle'; return; }
    a.t += dt;
    const def = a.def;
    const total = actionTotal(def);

    if (this.stepTimer > 0) {
      this.stepTimer -= dt;
    }

    if (a.phase === 'startup' && a.t >= def.startup) {
      a.phase = 'active';
      a.activeStart = a.t;
    }
    if (a.phase === 'active') {
      const multi = def.multi || 1;
      if (multi > 1) {
        if (a.t >= a.nextMulti && a.multiFired < multi) {
          a.multiFired++;
          a.nextMulti = a.t + (def.multiDelay || 0.07);
          a.hitSet.clear();
          this.performSwing(world, def, a);
        }
      } else if (!a.fired) {
        a.fired = true;
        this.performSwing(world, def, a);
      } else {
        // The hitbox stays live for its whole active window against new targets.
        this.performSwing(world, def, a, true);
      }
      if (a.t >= def.startup + def.active) a.phase = 'recovery';
    }
    if (a.t >= total) {
      this.state = this.z > 0.3 ? 'air' : 'idle';
      this.action = null;
    }
  }

  performSwing(world, def, a, sweepOnly = false) {
    const origin = vadd(this.pos, vfromAngle(this.facing, def.offset || 0));
    const slack = hitGenerosity(this, this.aimAssist);
    const targets = targetsInArc(world, this, {
      origin, angle: this.facing,
      range: def.range + slack.range, halfArc: def.arc + slack.arc,
      heightRange: def.spike ? 4 : 3,
    });
    let connected = false;
    for (const t of targets) {
      if (a.hitSet.has(t.id)) continue;
      a.hitSet.add(t.id);
      const res = world.dealDamage(this, t, {
        damage: def.damage, poise: def.poise, knock: def.knock, lift: def.lift,
        pull: def.pull, physical: def.physical, tags: ['physical'],
        unblockable: def.unblockable, guardBreak: def.guardBreak,
        hitstop: def.hitstop, hitSfx: def.hitSfx, actionId: def.id,
        sourceName: def.name, pos: { x: t.pos.x, y: t.pos.y },
        pierceInfinity: this.flags.pierceInfinity || this.tool?.pierceInfinity,
        ignoreReinforce: this.tool?.ignoreReinforce || 0,
      });
      if (res.hit || res.blocked || res.parried) connected = true;
      if (res.hit && def.id === 'grab') this.beginThrow(t, world);
      if (res.hit && this.tool?.root) {
        addStatus(t, { type: 'root', time: this.tool.root });
        const pull = vnorm(vsub(this.pos, t.pos));
        t.vel.x += pull.x * (this.tool.pull || 4);
        t.vel.y += pull.y * (this.tool.pull || 4);
      }
    }
    if (connected && !sweepOnly) {
      this.toolHitCount = (this.toolHitCount || 0) + 1;
      if (this.tool?.waveEvery && this.toolHitCount % this.tool.waveEvery === 0) {
        world.spawnProjectile(this, {
          pos: { x: this.pos.x, y: this.pos.y }, angle: this.facing, speed: 20,
          radius: 0.8, damage: def.damage * 0.7, poise: def.poise * 0.5, knock: 3,
          life: 0.7, pierce: 3, vfx: 'wave', color: this.tool.color, tags: ['technique'],
        });
      }
    }
    if (!connected && !sweepOnly && !a.whiffed) {
      a.whiffed = true;
      world.fx('whiff', { pos: origin, angle: this.facing, range: def.range, owner: this.id });
    }
  }

  beginThrow(target, world) {
    if (!target || target.dead) return;
    target.state = 'grabbed';
    target.stateTime = 0;
    target.grabbedBy = this.id;
    this.grabbing = target.id;
    this.startAction('throw');
    world.event({ type: 'grab', attacker: this.id, victim: target.id });
    // The throw itself resolves through the normal swing at close range.
    setTimeoutSim(world, 0.22, () => {
      if (target.dead) return;
      const dir = vfromAngle(this.facing);
      target.state = 'knockdown';
      target.staggerTime = 1.1;
      target.vel.x = dir.x * 12;
      target.vel.y = dir.y * 12;
      target.vz = 5;
      world.dealDamage(this, target, {
        damage: 20, poise: 60, knock: 4, lift: 3, physical: true, tags: ['physical'],
        unblockable: true, hitstop: 0.14, sourceName: 'Slam',
      });
      this.grabbing = null;
    });
  }

  // -------------------------------------------------------------------------
  // Technique casting
  // -------------------------------------------------------------------------

  abilityList() {
    if (!this.technique) return [];
    return this.technique.abilities || [];
  }

  abilityReady(index) {
    const ab = this.abilityList()[index];
    if (!ab) return false;
    if (this.actionFlags.noTechnique) return false;
    if (this.vowMods.lockAbilities.includes(index)) return false;
    if (this.cooldowns['ab' + index] > 0) return false;
    let cost = ab.cost;
    if (this.vowMods.cheapBasics && index < 2) cost *= 0.5;
    if (!this.canAfford(cost)) return false;
    if (ab.hpCost && this.hp <= ab.hpCost * 1.2) return false;
    const req = ab.requires;
    if (req) {
      if (req.flow && this.flow < req.flow) return false;
      if (req.ceControl && this.stats.ceControl < req.ceControl) return false;
      if (req.hpBelow && this.hpFraction > req.hpBelow) return false;
      if (req.jackpotMeter && (this.jackpotMeter ?? 0) < req.jackpotMeter) return false;
    }
    if (ab.throat && this.throat > 100 - ab.throat * 0.4) return false;
    return true;
  }

  abilityBlockReason(index) {
    const ab = this.abilityList()[index];
    if (!ab) return 'No ability';
    if (this.actionFlags.noTechnique) return 'Technique sealed';
    if (this.vowMods.lockAbilities.includes(index)) return 'Locked by binding vow';
    if (this.cooldowns['ab' + index] > 0) return `Cooling down ${this.cooldowns['ab' + index].toFixed(1)}s`;
    if (!this.canAfford(ab.cost)) return 'Not enough cursed energy';
    if (ab.hpCost && this.hp <= ab.hpCost * 1.2) return 'Not enough blood';
    if (ab.requires?.flow && this.flow < ab.requires.flow) return 'Flow too low';
    if (ab.requires?.hpBelow && this.hpFraction > ab.requires.hpBelow) return 'Requires low health';
    if (ab.requires?.jackpotMeter && (this.jackpotMeter ?? 0) < ab.requires.jackpotMeter) {
      return `Reels ${Math.round(this.jackpotMeter ?? 0)}% / 100%`;
    }
    if (ab.throat && this.throat > 100 - ab.throat * 0.4) return 'Throat too strained';
    return 'Ready';
  }

  tryAbility(index, world) {
    if (!this.canAct()) return false;
    const ab = this.abilityList()[index];
    if (!ab || !this.abilityReady(index)) {
      if (this.isPlayer) {
        world.notify(this.abilityBlockReason(index), '#ff8a8a');
        world.audio('warn', { volume: 0.4 });
      }
      return false;
    }
    let cost = ab.cost;
    if (this.vowMods.cheapBasics && index < 2) cost *= 0.5;
    if (!this.spendCe(cost)) return false;
    if (ab.hpCost) this.takeTrueDamage(ab.hpCost, ab.name, false);
    if (ab.throat) this.throat = Math.min(120, this.throat + ab.throat);
    // The first slot of every technique is the bread-and-butter opener. It is
    // meant to be spammable — cursed energy is the real limiter on it, not a
    // timer — so it comes back almost immediately whatever the data says.
    this.cooldowns['ab' + index] = index === 0
      ? Math.min(FIRST_ABILITY_COOLDOWN, ab.cooldown || 0)
      : (ab.cooldown || 0);

    this.state = 'cast';
    this.stateTime = 0;
    // Same nudge as a swing, sized to the ability's own reach so a long beam
    // gets no more help finding a distant target than a short one does.
    if (this.aimAssist > 0) {
      this.aim = assistedAim(world, this, this.aim, ab.range || 10, this.aimAssist);
    }
    this.cast = { ability: ab, index, t: 0, fired: false, aim: this.aim };
    this.facing = this.aim;
    this.anim.cast = 0;
    world.audio(ab.sfx || 'cast', { volume: 0.7 });
    world.fx('castCharge', { pos: this.pos, z: this.z, owner: this.id, color: this.technique.color, time: ab.castTime });
    world.event({
      type: 'abilityStart', fighter: this.id, ability: ab.id,
      label: ab.name, ultimate: !!ab.ultimate,
      color: this.technique?.color || this.color,
      pos: { x: this.pos.x, y: this.pos.y }, z: this.z + this.height + 0.4,
    });
    return true;
  }

  updateCast(dt, world) {
    const c = this.cast;
    if (!c) { this.state = 'idle'; return; }
    c.t += dt;
    const ab = c.ability;
    if (!c.fired && c.t >= (ab.castTime || 0)) {
      c.fired = true;
      world.executeAbility(this, ab, c.aim);
    }
    if (c.t >= (ab.castTime || 0) + (ab.recovery || 0.2)) {
      this.state = this.z > 0.3 ? 'air' : 'idle';
      this.cast = null;
    }
  }

  // -------------------------------------------------------------------------
  // Domains
  // -------------------------------------------------------------------------

  domainSpec() {
    return this.technique?.domain || null;
  }

  domainReady() {
    const d = this.domainSpec();
    if (!d) return false;
    if (this.flags.noDomain) return false;
    if (this.actionFlags.noTechnique) return false;
    if (this.domainBurnout > 0) return false;
    if (this.domain) return false;
    const cost = d.cost * (1 + (this.vowMods.domainCost ?? 0));
    if (!this.canAfford(cost)) return false;
    if (this.flow < DOMAIN_FLOW) return false;
    return true;
  }

  domainBlockReason() {
    const d = this.domainSpec();
    if (!d) return this.technique?.blurbNoDomain || 'No domain';
    if (this.flags.noDomain) return 'Forbidden by binding vow';
    if (this.actionFlags.noTechnique) return 'Technique sealed';
    if (this.domainBurnout > 0) return `Domain burnout ${this.domainBurnout.toFixed(0)}s`;
    if (this.domain) return 'Domain already open';
    if (this.flow < DOMAIN_FLOW) {
      return `Flow ${Math.round(this.flow * 100)}% / ${Math.round(DOMAIN_FLOW * 100)}%`;
    }
    if (!this.canAfford(d.cost)) return 'Not enough cursed energy';
    return 'Ready';
  }

  tryDomain(world) {
    if (!this.domainReady()) {
      if (this.isPlayer) {
        world.notify(this.domainBlockReason(), '#ff8a8a');
        world.audio('warn', { volume: 0.4 });
      }
      return false;
    }
    const d = this.domainSpec();
    // The chant is short enough to actually land in a fight. It is still long
    // enough that a heavy hit through it is a real punish.
    const castTime = Math.max(0.2,
      d.castTime * 0.62 * (1 + this.vowMods.domainCast) / (this.stats.domainSkill || 1));
    this.state = 'domainCast';
    this.stateTime = 0;
    this.domainCast = { t: 0, dur: castTime, spec: d };
    this.vel.x = 0; this.vel.y = 0;
    world.audio('cast', { volume: 0.9, pitch: 0.7 });
    world.fx('domainCharge', { pos: this.pos, z: this.z, owner: this.id, color: d.color, time: castTime });
    world.event({ type: 'domainCast', fighter: this.id, domain: d.id });
    // No banner here: the domain cut-in in the HUD is the announcement.
    return true;
  }

  updateDomainCast(dt, world) {
    const c = this.domainCast;
    if (!c) { this.state = 'idle'; return; }
    c.t += dt;
    // Getting hit hard during the chant is the classic domain interrupt.
    if (this.poise < this.maxPoise * 0.25) {
      this.domainCast = null;
      this.state = 'stagger';
      this.staggerTime = 1.0;
      this.ce *= 0.4;
      this.domainBurnout = 10;
      world.notify('DOMAIN INTERRUPTED', '#ff4d4d');
      world.audio('domainBreak', { volume: 0.9 });
      world.event({ type: 'domainInterrupt', fighter: this.id });
      return;
    }
    if (c.t >= c.dur) {
      this.domainCast = null;
      const cost = c.spec.cost * (1 + (this.vowMods.domainCost ?? 0));
      this.spendCe(cost);
      world.openDomain(this, c.spec);
      this.state = 'idle';
    }
  }

  updateSimpleDomain(dt, world) {
    const want = this.intent.simpleDomain && !this.dead && this.maxCe > 0;
    const sd = this.simpleDomain;
    const drain = sd.mastered ? 11 : 18;
    if (want && this.ce > 1 && this.state !== 'stagger' && this.state !== 'knockdown') {
      if (!sd.active) {
        sd.active = true;
        sd.t = 0;
        world.audio('simpleDomain', { volume: 0.7 });
        world.fx('simpleDomainOpen', { pos: this.pos, z: this.z, owner: this.id });
        world.event({ type: 'simpleDomain', fighter: this.id, on: true });
        if (this.isPlayer) world.notify('SIMPLE DOMAIN', '#a8d8ff');
      }
      sd.t += dt;
      this.ce = Math.max(0, this.ce - drain * dt);
      if (this.ce <= 0) sd.active = false;
    } else if (sd.active) {
      sd.active = false;
      world.event({ type: 'simpleDomain', fighter: this.id, on: false });
    }
  }

  updateAmplification(dt, world) {
    const amp = this.amplify;
    if (amp.active) {
      amp.t -= dt;
      this.mods.reinforce += 0.1;
      if (amp.t <= 0) {
        amp.active = false;
        world.event({ type: 'amplify', fighter: this.id, on: false });
      }
    }
  }

  tryAmplify(world) {
    if (this.amplify.active || this.maxCe <= 0) return false;
    if (this.actionFlags.noTechnique) return false;
    if (!this.spendCe(30)) {
      if (this.isPlayer) world.notify('Not enough cursed energy', '#ff8a8a');
      return false;
    }
    this.amplify.active = true;
    this.amplify.t = 2.8;
    this.flags.pierceInfinity = true;
    world.audio('cast', { volume: 0.8, pitch: 1.3 });
    world.fx('amplify', { pos: this.pos, z: this.z, owner: this.id });
    world.event({ type: 'amplify', fighter: this.id, on: true });
    if (this.isPlayer) world.notify('DOMAIN AMPLIFICATION', '#cfa8ff');
    return true;
  }

  // -------------------------------------------------------------------------
  // Reverse Cursed Technique
  // -------------------------------------------------------------------------

  updateRct(dt, world, wants) {
    const skill = this.stats.rct ?? 0;
    if (wants && !this.flags.noRct && skill > 0 && this.ce > 2 && this.canAct() && this.hp < this.maxHp * 1.0) {
      if (this.state !== 'rct') {
        this.state = 'rct';
        this.stateTime = 0;
        this.rctTime = 0;
        addStatus(this, { type: 'rctActive', time: 99 });
        world.audio('rct', { volume: 0.6 });
        world.event({ type: 'rct', fighter: this.id, on: true });
        if (this.isPlayer) world.notify('REVERSE CURSED TECHNIQUE', '#8ef0bd');
      }
      this.rctTime += dt;
      // Multiplying two cursed energies to make positive energy is expensive and
      // the conversion rate is entirely down to control.
      const control = this.stats.ceControl ?? 0.4;
      const drain = 26 * dt;
      const spend = Math.min(this.ce, drain);
      this.ce -= spend;
      const efficiency = 0.35 + skill * 0.7 + control * 0.5;
      const healed = this.heal(spend * efficiency * 0.75, { rct: true });
      this.rctHealed = (this.rctHealed || 0) + healed;
      // Wounds and throat strain close too.
      this.wounds.arms = Math.max(0, this.wounds.arms - dt * 0.35 * (0.4 + skill));
      this.wounds.legs = Math.max(0, this.wounds.legs - dt * 0.35 * (0.4 + skill));
      this.throat = Math.max(0, this.throat - dt * 55);
      if (this.burnoutTimer > 0) this.burnoutTimer = Math.max(0, this.burnoutTimer - dt * 2);
      this.removeStatus('soulWound');
      if (world.rng.chance(dt * 6)) world.fx('rctSpark', { pos: this.pos, z: this.z + 0.8, owner: this.id });
      // Poor control backfires: the energy reverses the wrong way.
      if (control < 0.45 && world.rng.chance(dt * (0.5 - control) * 0.8)) {
        this.takeTrueDamage(9, 'failed reversal');
        world.fx('rctFail', { pos: this.pos, z: this.z + 1 });
        world.audio('warn', { volume: 0.6 });
        if (this.isPlayer) world.notify('REVERSAL FAILED', '#ff4d4d');
      }
      if (this.ce <= 0) this.endRct(world);
    } else if (this.state === 'rct') {
      this.endRct(world);
    }
  }

  endRct(world) {
    this.state = 'idle';
    this.removeStatus('rctActive');
    world.event({ type: 'rct', fighter: this.id, on: false });
  }
}

// Tiny scheduler used for delayed effects inside the simulation (throws, etc).
export function setTimeoutSim(world, delay, fn) {
  world.timers.push({ t: delay, fn });
}
