// Status effects. Every per-frame stat change in the game funnels through the
// `mods` accumulator so nothing permanently corrupts a fighter's base stats.

import { clamp } from '../core/math.js';

export const STATUS_META = {
  slow: { name: 'Slowed', color: '#7aa6d8', bad: true },
  stun: { name: 'Stunned', color: '#ffd166', bad: true },
  frozen: { name: 'Frozen Frame', color: '#9fe870', bad: true },
  root: { name: 'Rooted', color: '#9aa3ad', bad: true },
  burn: { name: 'Burning', color: '#ff8a1e', bad: true },
  bleed: { name: 'Bleeding', color: '#e0344f', bad: true },
  soulWound: { name: 'Soul Wound', color: '#7fd4a8', bad: true },
  weakPoint: { name: 'Weak Point', color: '#d8c98a', bad: true },
  fragment: { name: 'Resonance Fragment', color: '#ff9f6b', bad: true },
  techniqueSealed: { name: 'Technique Sealed', color: '#b7c9d8', bad: true },
  silenced: { name: 'Silenced', color: '#e8e0c8', bad: true },
  indicted: { name: 'Indicted', color: '#cfa8ff', bad: true },
  blindAsh: { name: 'Blinded', color: '#8a8a7a', bad: true },
  glassCannon: { name: 'All or Nothing', color: '#ff4d4d', bad: true },
  transfiguring: { name: 'Transfiguring', color: '#7fd4a8', bad: true },
  domainDrain: { name: 'Sure-Hit', color: '#ff3b30', bad: true },
  buff: { name: 'Empowered', color: '#ffd166', bad: false },
  shield: { name: 'Guardian', color: '#6fd4c4', bad: false },
  adaptation: { name: 'Adapted', color: '#c8b06a', bad: false },
  rctActive: { name: 'Reversing', color: '#8ef0bd', bad: false },
  overdrive: { name: 'Flow State', color: '#ff3b30', bad: false },
};

/** Add or refresh a status on a fighter. */
export function addStatus(f, s) {
  if (!s || !s.type || f.dead) return null;
  if (f.resist && f.resist[s.type] >= 1) return null;
  const existing = f.statuses.find((x) => x.type === s.type);
  if (existing) {
    if (s.stack) {
      existing.power = Math.min(s.max ?? 99, (existing.power || 0) + (s.power || 1));
      existing.time = Math.max(existing.time, s.time || 0);
    } else {
      Object.assign(existing, s);
      existing.time = Math.max(existing.time, s.time || 0);
    }
    existing.maxTime = Math.max(existing.maxTime || 0, existing.time);
    return existing;
  }
  const st = Object.assign({ time: 1, power: 1 }, s);
  st.maxTime = st.time;
  f.statuses.push(st);
  return st;
}

export function removeStatus(f, type) {
  const i = f.statuses.findIndex((s) => s.type === type);
  if (i >= 0) f.statuses.splice(i, 1);
}

export function getStatus(f, type) {
  return f.statuses.find((s) => s.type === type) || null;
}

export function hasStatus(f, type) {
  return f.statuses.some((s) => s.type === type);
}

/**
 * Tick every status: apply damage-over-time, accumulate stat mods, expire.
 * Called once per fighter per simulation step, before movement.
 */
export function updateStatuses(f, dt, world) {
  const mods = f.mods;
  for (let i = f.statuses.length - 1; i >= 0; i--) {
    const s = f.statuses[i];
    s.time -= dt;

    switch (s.type) {
      case 'slow':
        mods.speed -= clamp(s.power, 0, 0.95);
        break;
      case 'stun':
      case 'frozen':
        f.actionLock = true;
        mods.speed -= 1;
        break;
      case 'root':
        mods.speed -= 1;
        break;
      case 'burn':
        f.takeTrueDamage((s.power || 6) * dt, 'burning', false);
        if (world && world.rng.chance(dt * 10)) world.fx('ember', { pos: f.pos, z: f.z });
        break;
      case 'bleed':
        f.takeTrueDamage((s.power || 4) * dt, 'bleeding', false);
        if (world && world.rng.chance(dt * 6)) world.fx('bloodDrip', { pos: f.pos, z: f.z });
        break;
      case 'soulWound':
        mods.healingTaken -= clamp(s.power, 0, 0.9);
        mods.damageTaken += clamp(s.power * 0.5, 0, 0.5);
        break;
      case 'weakPoint':
        mods.critTaken += 0.6;
        break;
      case 'techniqueSealed':
        f.actionFlags.noTechnique = true;
        break;
      case 'silenced':
        f.actionFlags.noTechnique = true;
        break;
      case 'indicted':
        mods.ceRegen -= 1.0;
        break;
      case 'blindAsh':
        mods.accuracy -= clamp(s.power, 0, 0.8);
        break;
      case 'glassCannon':
        f.hp = Math.min(f.hp, 1);
        break;
      case 'transfiguring':
        f.takeTrueDamage(10 * dt, 'transfiguration', false);
        break;
      case 'adaptation':
        mods.damageTaken -= clamp(s.power, 0, 0.9);
        break;
      case 'rctActive':
        mods.speed -= 0.55;
        break;
      case 'overdrive':
        mods.output += 0.25;
        mods.flashBand += 0.09;
        mods.ceRegen += 2;
        break;
      case 'buff':
        if (s.output) mods.output += s.output;
        if (s.physical) mods.physical += s.physical;
        if (s.technique) mods.technique += s.technique;
        if (s.speed) mods.speed += s.speed;
        if (s.reinforce) mods.reinforce += s.reinforce;
        if (s.ceRegen) mods.ceRegen += s.ceRegen;
        if (s.ceGain) mods.ceGain += s.ceGain;
        if (s.attackSpeed) mods.attackSpeed += s.attackSpeed;
        if (s.flashBand) mods.flashBand += s.flashBand;
        if (s.poise) mods.poiseMax += s.poise;
        if (s.superArmor) f.actionFlags.superArmor = true;
        if (s.frameStep) f.actionFlags.frameStep = true;
        break;
      default:
        break;
    }

    if (s.time <= 0) {
      if (s.type === 'transfiguring') {
        // Surviving a full transfiguration means the body is remade badly.
        f.maxHp *= 0.85;
        f.hp = Math.min(f.hp, f.maxHp);
      }
      f.statuses.splice(i, 1);
    }
  }
}

/** Absorb damage with a shield status; returns the remaining damage. */
export function absorbShield(f, amount) {
  const sh = getStatus(f, 'shield');
  if (!sh) return amount;
  const absorbed = Math.min(sh.shield || 0, amount);
  sh.shield -= absorbed;
  if (sh.shield <= 0) removeStatus(f, 'shield');
  return amount - absorbed;
}
