// Frame data for the physical combat layer.
//
// Every melee action is described the way a fighting game describes a move:
// startup / active / recovery, hit shape, damage, poise (guard) damage,
// knockback, and which moves it can be cancelled into. The simulation never
// hard-codes a swing; it always reads one of these.

/**
 * @typedef {Object} Action
 * @property {number} startup   seconds before the hitbox turns on
 * @property {number} active    seconds the hitbox is live
 * @property {number} recovery  seconds of endlag
 * @property {number} damage    base damage before every multiplier
 * @property {number} poise     guard / balance damage
 * @property {number} range     metres from the fighter's centre
 * @property {number} arc       half-angle of the swing in radians
 */

const A = (o) => Object.assign({
  kind: 'light',
  startup: 0.1, active: 0.07, recovery: 0.2,
  damage: 8, poise: 10, ceCost: 0,
  range: 1.8, arc: 0.9, offset: 0.35, height: 1.6,
  knock: 2.4, lift: 0, pull: 0,
  step: 0, stepTime: 0.12,
  hitstop: 0.055,
  physical: true,          // eligible for Black Flash
  cancelAt: 0.62,          // fraction of total time after which cancels open
  next: null,
  vfx: 'slash', sfx: 'swing', hitSfx: 'hit',
  airOk: false, groundOnly: true,
  guardBreak: false, unblockable: false,
  spike: false, launcher: false, sweep: false,
  multi: 1,
}, o);

export const ACTIONS = {
  // --- Standing light chain -------------------------------------------------
  light1: A({
    id: 'light1', name: 'Jab', startup: 0.085, active: 0.07, recovery: 0.17,
    damage: 7, poise: 9, range: 1.75, arc: 0.85, knock: 2.0, step: 3.0,
    next: 'light2', vfx: 'slash_r', hitstop: 0.05,
  }),
  light2: A({
    id: 'light2', name: 'Cross', startup: 0.075, active: 0.07, recovery: 0.19,
    damage: 8.5, poise: 11, range: 1.85, arc: 0.9, knock: 2.4, step: 3.2,
    next: 'light3', vfx: 'slash_l', hitstop: 0.055,
  }),
  light3: A({
    id: 'light3', name: 'Spin Elbow', startup: 0.12, active: 0.09, recovery: 0.24,
    damage: 11, poise: 15, range: 2.0, arc: 1.5, knock: 3.4, step: 3.6,
    next: 'light4', vfx: 'slash_spin', sweep: true, hitstop: 0.07,
  }),
  light4: A({
    id: 'light4', name: 'Rising Kick', startup: 0.15, active: 0.1, recovery: 0.34,
    damage: 14, poise: 20, range: 2.05, arc: 1.0, knock: 3.0, lift: 6.2,
    step: 2.6, launcher: true, vfx: 'slash_rise', sfx: 'swingHeavy',
    hitSfx: 'hitHeavy', hitstop: 0.1, cancelAt: 0.72,
  }),

  // --- Heavy (charge on the same button) -----------------------------------
  heavy: A({
    kind: 'heavy', id: 'heavy', name: 'Heavy Strike',
    startup: 0.26, active: 0.11, recovery: 0.36,
    damage: 22, poise: 38, range: 2.3, arc: 1.15, knock: 7.5, step: 4.2,
    guardBreak: true, vfx: 'slash_heavy', sfx: 'swingHeavy', hitSfx: 'hitHeavy',
    hitstop: 0.12, cancelAt: 0.8,
  }),
  heavyCharged: A({
    kind: 'heavy', id: 'heavyCharged', name: 'Charged Smash',
    startup: 0.34, active: 0.13, recovery: 0.44,
    damage: 38, poise: 70, range: 2.6, arc: 1.35, knock: 12, lift: 3.0, step: 5.0,
    guardBreak: true, vfx: 'slash_smash', sfx: 'swingHeavy', hitSfx: 'hitHeavy',
    hitstop: 0.17, cancelAt: 0.85,
  }),

  // --- Dash attack ----------------------------------------------------------
  dashAttack: A({
    kind: 'heavy', id: 'dashAttack', name: 'Rushing Palm',
    startup: 0.1, active: 0.1, recovery: 0.3,
    damage: 16, poise: 26, range: 2.2, arc: 0.95, knock: 6.5, step: 11, stepTime: 0.16,
    vfx: 'slash_rush', sfx: 'swingHeavy', hitSfx: 'hitHeavy', hitstop: 0.09,
  }),

  // --- Aerials --------------------------------------------------------------
  air1: A({
    id: 'air1', name: 'Air Slash', startup: 0.08, active: 0.08, recovery: 0.16,
    damage: 8, poise: 10, range: 1.9, arc: 1.0, knock: 1.4, lift: 1.6,
    airOk: true, groundOnly: false, next: 'air2', vfx: 'slash_l',
  }),
  air2: A({
    id: 'air2', name: 'Air Chain', startup: 0.08, active: 0.08, recovery: 0.18,
    damage: 9.5, poise: 12, range: 1.95, arc: 1.05, knock: 1.5, lift: 1.8,
    airOk: true, groundOnly: false, next: 'airFinish', vfx: 'slash_r',
  }),
  airFinish: A({
    id: 'airFinish', name: 'Falling Axe', startup: 0.13, active: 0.12, recovery: 0.3,
    damage: 18, poise: 26, range: 2.1, arc: 1.2, knock: 3.0, lift: -9,
    airOk: true, groundOnly: false, spike: true, vfx: 'slash_smash',
    sfx: 'swingHeavy', hitSfx: 'hitHeavy', hitstop: 0.14,
  }),

  // --- Grab -----------------------------------------------------------------
  grab: A({
    kind: 'grab', id: 'grab', name: 'Seize', startup: 0.14, active: 0.1, recovery: 0.36,
    damage: 4, poise: 0, range: 1.7, arc: 0.7, knock: 0,
    unblockable: true, vfx: 'grab', sfx: 'swing', hitstop: 0.05, physical: true,
  }),
  throw: A({
    kind: 'grab', id: 'throw', name: 'Slam', startup: 0.22, active: 0.06, recovery: 0.42,
    damage: 20, poise: 44, range: 1.6, arc: 3.14, knock: 9, lift: 4,
    unblockable: true, vfx: 'slam', sfx: 'swingHeavy', hitSfx: 'hitHeavy', hitstop: 0.16,
  }),

  // --- Counters -------------------------------------------------------------
  parryCounter: A({
    kind: 'heavy', id: 'parryCounter', name: 'Riposte',
    startup: 0.06, active: 0.09, recovery: 0.22,
    damage: 17, poise: 30, range: 2.1, arc: 1.1, knock: 5.5, step: 4.5,
    vfx: 'slash_counter', sfx: 'swingHeavy', hitSfx: 'hitHeavy', hitstop: 0.12,
  }),
  simpleCounter: A({
    kind: 'special', id: 'simpleCounter', name: 'Simple Domain Counter',
    startup: 0.0, active: 0.06, recovery: 0.0,
    damage: 9, poise: 22, range: 2.35, arc: 3.14159, knock: 5,
    vfx: 'slash_circle', sfx: 'slash', hitstop: 0.05, physical: false,
  }),

  // --- Curse / summon basic attacks ----------------------------------------
  clawSwipe: A({
    id: 'clawSwipe', name: 'Claw', startup: 0.22, active: 0.09, recovery: 0.34,
    damage: 11, poise: 14, range: 2.1, arc: 1.1, knock: 3.4, step: 3.5,
    vfx: 'claw', hitstop: 0.06,
  }),
  bite: A({
    id: 'bite', name: 'Bite', startup: 0.18, active: 0.08, recovery: 0.3,
    damage: 13, poise: 18, range: 1.7, arc: 0.8, knock: 4, step: 5.5,
    vfx: 'claw', hitstop: 0.07,
  }),
  lunge: A({
    kind: 'heavy', id: 'lunge', name: 'Lunge', startup: 0.3, active: 0.14, recovery: 0.45,
    damage: 17, poise: 30, range: 2.3, arc: 0.9, knock: 7, step: 13, stepTime: 0.2,
    vfx: 'claw', sfx: 'swingHeavy', hitSfx: 'hitHeavy', hitstop: 0.1,
  }),
  stomp: A({
    kind: 'heavy', id: 'stomp', name: 'Stomp', startup: 0.42, active: 0.12, recovery: 0.5,
    damage: 26, poise: 55, range: 3.0, arc: 3.14159, knock: 9, lift: 3,
    guardBreak: true, vfx: 'shock', sfx: 'swingHeavy', hitSfx: 'hitHeavy', hitstop: 0.15,
  }),
  tailWhip: A({
    id: 'tailWhip', name: 'Tail Whip', startup: 0.24, active: 0.12, recovery: 0.36,
    damage: 14, poise: 22, range: 3.2, arc: 1.9, knock: 6, sweep: true,
    vfx: 'slash_spin', hitstop: 0.08,
  }),
};

export const LIGHT_CHAIN = ['light1', 'light2', 'light3', 'light4'];
export const AIR_CHAIN = ['air1', 'air2', 'airFinish'];

export function actionTotal(a) {
  return a.startup + a.active + a.recovery;
}

/** Frame data scaled by a weapon's weight / a fighter's speed stat. */
export function scaleAction(action, { weight = 1, power = 1, reach = 1 } = {}) {
  if (weight === 1 && power === 1 && reach === 1) return action;
  return Object.assign({}, action, {
    startup: action.startup * weight,
    recovery: action.recovery * (0.6 + 0.4 * weight),
    damage: action.damage * power,
    poise: action.poise * (0.5 + 0.5 * weight) * power,
    range: action.range * reach,
    knock: action.knock * (0.7 + 0.3 * weight),
  });
}
