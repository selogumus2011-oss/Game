// Cursed tools. A tool rewrites the physical layer: swing weight, reach,
// damage, and in several cases a rule of the game itself.

export const TOOLS = {
  fists: {
    id: 'fists', name: 'Bare Hands', jp: '素手',
    desc: 'Nothing between your cursed energy and their face. Widest Black Flash window of any loadout.',
    weight: 0.82, power: 1.0, reach: 0.95, poiseMul: 0.9,
    flashBand: 0.045, grade: 0, color: '#d9d9d9', shape: 'none',
  },
  katana: {
    id: 'katana', name: 'Standard Cursed Blade', jp: '呪具刀',
    desc: 'Issued to every sorcerer. Balanced, quick, cuts curses cleanly.',
    weight: 1.0, power: 1.15, reach: 1.18, poiseMul: 1.0,
    flashBand: 0, grade: 3, color: '#cfd6e0', shape: 'blade', length: 1.35,
  },
  playfulCloud: {
    id: 'playfulCloud', name: 'Playful Cloud', jp: '遊雲',
    desc: 'A three-section staff with no cursed technique in it at all — just a shocking amount of mass moving quickly.',
    weight: 1.45, power: 1.6, reach: 1.3, poiseMul: 1.9,
    flashBand: -0.01, grade: 1, color: '#e8c46a', shape: 'staff', length: 1.9,
    special: 'Enormous guard damage. Breaks blocks and props outright.',
    onHit(ctx) { ctx.hit.poise *= 1.5; },
  },
  invertedSpear: {
    id: 'invertedSpear', name: 'Inverted Spear of Heaven', jp: '天逆鉾',
    desc: 'Nullifies any cursed technique it touches. Infinity is a technique. So is a domain.',
    weight: 1.15, power: 1.25, reach: 1.55, poiseMul: 1.1,
    flashBand: 0, grade: 'special', color: '#b7c9d8', shape: 'spear', length: 2.3,
    special: 'Pierces Infinity, strips technique effects, damages domain barriers double.',
    pierceInfinity: true, nullify: true, domainDamage: 2.0,
  },
  splitSoul: {
    id: 'splitSoul', name: 'Split Soul Katana', jp: '分裂魂の刀',
    desc: 'Cuts the soul rather than the body. Cursed energy reinforcement has nothing to reinforce.',
    weight: 1.05, power: 1.2, reach: 1.2, poiseMul: 1.0,
    flashBand: 0, grade: 'special', color: '#a8f0d8', shape: 'blade', length: 1.4,
    special: 'Ignores 60% of reinforcement, applies soul wounds that block reverse cursed technique.',
    ignoreReinforce: 0.6, soul: true,
  },
  slaughterDemon: {
    id: 'slaughterDemon', name: 'Slaughter Demon', jp: '万里ノ鎖・屠坐魔',
    desc: 'A machete with a cursed technique sealed inside. Every third hit releases a cutting wave.',
    weight: 1.1, power: 1.3, reach: 1.15, poiseMul: 1.15,
    flashBand: 0, grade: 2, color: '#d68a6a', shape: 'cleaver', length: 1.3,
    special: 'Every third landed hit fires a cutting wave.',
    waveEvery: 3,
  },
  chainOfMiles: {
    id: 'chainOfMiles', name: 'Chain of a Thousand Miles', jp: '万里ノ鎖',
    desc: 'Restrains curses. On hit it roots the target and drags them toward you.',
    weight: 0.95, power: 0.85, reach: 2.4, poiseMul: 0.8,
    flashBand: 0, grade: 2, color: '#9aa3ad', shape: 'chain', length: 2.6,
    special: 'Roots the target for 1.2s and pulls them into melee range.',
    root: 1.2, pull: 6,
  },
  dragonBone: {
    id: 'dragonBone', name: 'Dragon-Bone', jp: '竜骨',
    desc: 'An enormous bone club. Slow, ugly, and it ends people.',
    weight: 1.75, power: 2.0, reach: 1.45, poiseMul: 2.2,
    flashBand: -0.015, grade: 1, color: '#e6ddc4', shape: 'club', length: 2.1,
    special: 'Devastating knockback; wall slams do double damage.',
    wallSlam: 2.0,
  },
  nailHammer: {
    id: 'nailHammer', name: 'Nail Hammer', jp: '金槌と釘',
    desc: 'A hammer and a fistful of nails. Cheap, and the fragments do the real work.',
    weight: 1.0, power: 1.0, reach: 1.05, poiseMul: 1.1,
    flashBand: 0.01, grade: 3, color: '#c8a27a', shape: 'hammer', length: 1.1,
    special: 'Plants an extra Resonance fragment on every hit.',
    fragmentBonus: 1,
  },
  blackRope: {
    id: 'blackRope', name: 'Black Rope', jp: '黒縄',
    desc: 'Disrupts the flow of cursed energy on contact. Hard to use, hard to fight.',
    weight: 0.9, power: 0.8, reach: 1.9, poiseMul: 0.9,
    flashBand: 0, grade: 2, color: '#4a4a55', shape: 'rope', length: 2.4,
    special: 'Drains 12 cursed energy from the target on hit and disrupts their regeneration.',
    ceDrain: 12,
  },
};

export const TOOL_LIST = Object.keys(TOOLS);
export const getTool = (id) => TOOLS[id] || TOOLS.fists;

/** Tools that can spawn as pickups in Culling Game mode, by rarity weight. */
export const LOOT_TABLE = [
  ['katana', 26], ['slaughterDemon', 16], ['chainOfMiles', 14], ['nailHammer', 12],
  ['blackRope', 12], ['playfulCloud', 8], ['dragonBone', 6], ['splitSoul', 4],
  ['invertedSpear', 2],
];
