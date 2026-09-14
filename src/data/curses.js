// Cursed spirits, shikigami and summons.
//
// These share the Fighter class with the player — the difference is the stat
// block, the silhouette used by the renderer, and the AI profile.

const C = (o) => Object.assign({
  grade: 4, maxHp: 70, maxCe: 30, ceRegen: 3, ceControl: 0.15,
  speed: 0.9, power: 1, weight: 1, reach: 1, poise: 40, radius: 0.5,
  shape: 'blob', color: '#6b5a7a', color2: '#2a2333', eyeColor: '#ffd166',
  actions: ['clawSwipe'], technique: null, ai: 'brute', scale: 1,
  xp: 10, canBlackFlash: false, canDomain: false, rct: 0,
}, o);

export const CURSES = {
  // --- Fodder ---------------------------------------------------------------
  larva: C({
    id: 'larva', name: 'Cursed Larva', jp: '呪霊・幼体', grade: 4,
    maxHp: 46, speed: 1.05, power: 0.7, poise: 22, radius: 0.42, scale: 0.8,
    shape: 'blob', color: '#5f5470', eyeColor: '#ffe066', ai: 'swarm', xp: 6,
    desc: 'Barely a curse. Fear of the dark with teeth attached.',
  }),
  grinner: C({
    id: 'grinner', name: 'Grinning Mouth', jp: '嗤い口', grade: 4,
    maxHp: 62, speed: 1.0, power: 0.85, poise: 30, radius: 0.5,
    shape: 'mouth', color: '#7a4f5a', eyeColor: '#ff8a8a', actions: ['bite'],
    ai: 'swarm', xp: 8, desc: 'Only a mouth. It laughs while it bites.',
  }),
  // --- Grade 3 --------------------------------------------------------------
  mantis: C({
    id: 'mantis', name: 'Scythe Curse', jp: '鎌呪霊', grade: 3,
    maxHp: 105, maxCe: 45, speed: 1.15, power: 1.05, poise: 48, radius: 0.55, reach: 1.35,
    shape: 'mantis', color: '#5a7a5f', color2: '#1e2a1f', eyeColor: '#c8ff8a',
    actions: ['clawSwipe', 'lunge'], ai: 'skirmisher', xp: 18,
    desc: 'Long reach, fast commitment. Punish the lunge recovery.',
  }),
  wraith: C({
    id: 'wraith', name: 'Veil Wraith', jp: '帳の亡霊', grade: 3,
    maxHp: 90, maxCe: 60, speed: 1.2, power: 0.9, poise: 36, radius: 0.5,
    shape: 'wraith', color: '#4a4a72', color2: '#16162a', eyeColor: '#a0b4ff',
    actions: ['clawSwipe'], ai: 'caster', ranged: true, xp: 20,
    desc: 'Fires cursed energy bolts and refuses to close distance.',
  }),
  // --- Grade 2 --------------------------------------------------------------
  hulkCurse: C({
    id: 'hulkCurse', name: 'Rampart Curse', jp: '壁呪霊', grade: 2,
    maxHp: 220, maxCe: 50, speed: 0.75, power: 1.4, weight: 1.9, poise: 140, radius: 0.85, scale: 1.45,
    shape: 'hulk', color: '#6b6357', color2: '#2a2620', eyeColor: '#ffb03a',
    actions: ['clawSwipe', 'stomp'], ai: 'brute', xp: 35, canBlackFlash: false,
    desc: 'Heavy, armoured, huge poise. Guard-break it or go around it.',
  }),
  serpent: C({
    id: 'serpent', name: 'Coil Curse', jp: '蛇呪霊', grade: 2,
    maxHp: 170, maxCe: 70, speed: 1.25, power: 1.1, poise: 70, radius: 0.6, reach: 1.6, scale: 1.2,
    shape: 'serpent', color: '#4f6a7a', color2: '#16232a', eyeColor: '#8ae8ff',
    actions: ['bite', 'tailWhip'], ai: 'skirmisher', xp: 38,
    desc: 'Sweeping tail with a huge arc. Jump it or stay outside 3.5m.',
  }),
  // --- Grade 1 --------------------------------------------------------------
  fingerBearer: C({
    id: 'fingerBearer', name: 'Finger Bearer', jp: '指喰い', grade: 1,
    maxHp: 380, maxCe: 110, ceControl: 0.4, speed: 1.05, power: 1.5, weight: 1.5,
    poise: 190, radius: 0.9, scale: 1.55,
    shape: 'fingerBearer', color: '#7a5a4a', color2: '#2a1a14', eyeColor: '#ff4d4d',
    actions: ['clawSwipe', 'lunge', 'stomp'], ai: 'brute', xp: 90,
    canBlackFlash: true, desc: 'It swallowed a finger. It is closer to a special grade than it should be.',
  }),
  hanged: C({
    id: 'hanged', name: 'Hanged Curse', jp: '吊された呪霊', grade: 1,
    maxHp: 300, maxCe: 130, ceControl: 0.5, speed: 1.1, power: 1.15, poise: 120, radius: 0.65,
    shape: 'hanged', color: '#5a4a6a', color2: '#1d1526', eyeColor: '#d8a0ff',
    actions: ['clawSwipe', 'bite'], ai: 'caster', ranged: true,
    technique: 'spiritManipulation', xp: 95,
    desc: 'Uses an actual cursed technique. Treat it as a sorcerer.',
  }),
  // --- Special grade --------------------------------------------------------
  disasterCurse: C({
    id: 'disasterCurse', name: 'Disaster Curse', jp: '特級・災禍', grade: 'special',
    maxHp: 650, maxCe: 170, ceControl: 0.75, speed: 1.15, power: 1.6, weight: 1.4,
    poise: 260, radius: 0.95, scale: 1.6, rct: 0.5,
    shape: 'special', color: '#7a2a3a', color2: '#1a0a10', eyeColor: '#ff3b30',
    actions: ['clawSwipe', 'lunge', 'stomp'], ai: 'duelist',
    technique: 'disasterFlames', canBlackFlash: true, canDomain: true, xp: 320,
    desc: 'A special grade with a domain. Bring Simple Domain or die inside the barrier.',
  }),

  // --- Shikigami & summons --------------------------------------------------
  divineDog: C({
    id: 'divineDog', name: 'Divine Dog: Totality', jp: '玉犬「渾」', grade: 2,
    maxHp: 120, maxCe: 0, speed: 1.5, power: 1.1, poise: 55, radius: 0.5, scale: 1.0,
    shape: 'dog', color: '#2a2a34', color2: '#e8e8f0', eyeColor: '#8b7bd8',
    actions: ['bite', 'lunge'], ai: 'hound', summon: true, xp: 0,
    desc: 'Black and white fused into one animal. Hunts independently.',
  }),
  nue: C({
    id: 'nue', name: 'Nue', jp: '鵺', grade: 2,
    maxHp: 95, maxCe: 0, speed: 1.6, power: 0.95, poise: 40, radius: 0.55, scale: 1.1,
    shape: 'nue', color: '#3a3548', color2: '#1a1722', eyeColor: '#b0d8ff',
    actions: ['clawSwipe'], ai: 'flyer', summon: true, flying: true, xp: 0,
    desc: 'Shocks on contact and stays in the air where melee cannot reach.',
  }),
  toad: C({
    id: 'toad', name: 'Toad', jp: '蝦蟇', grade: 3,
    maxHp: 140, maxCe: 0, speed: 0.8, power: 0.8, weight: 1.6, poise: 90, radius: 0.7, scale: 1.2,
    shape: 'toad', color: '#4a6a4a', color2: '#1a2a1a', eyeColor: '#ffe066',
    actions: ['bite'], ai: 'guard', summon: true, xp: 0,
    desc: 'Blocks for you and pulls enemies in with its tongue.',
  }),
  greatSerpent: C({
    id: 'greatSerpent', name: 'Great Serpent', jp: '大蛇', grade: 2,
    maxHp: 160, maxCe: 0, speed: 1.3, power: 1.2, poise: 70, radius: 0.6, reach: 1.7, scale: 1.3,
    shape: 'serpent', color: '#3a4a6a', color2: '#141c2a', eyeColor: '#8ae8ff',
    actions: ['bite', 'tailWhip'], ai: 'hound', summon: true, xp: 0,
    desc: 'Long reach, constant pressure.',
  }),
  mahoraga: C({
    id: 'mahoraga', name: 'Divine General Mahoraga', jp: '魔虚羅', grade: 'special',
    maxHp: 900, maxCe: 100, ceControl: 0.8, speed: 1.2, power: 2.0, weight: 2.0,
    poise: 400, radius: 1.1, scale: 1.9, rct: 0.8,
    shape: 'mahoraga', color: '#3a3a44', color2: '#c8b06a', eyeColor: '#ffd166',
    actions: ['clawSwipe', 'stomp', 'lunge'], ai: 'adaptive', summon: true,
    canBlackFlash: true, adapts: true, xp: 500,
    desc: 'The wheel turns. Every phenomenon that touches it is adapted to and then ignored — including yours.',
  }),
  transfigured: C({
    id: 'transfigured', name: 'Transfigured Human', jp: '改造人間', grade: 3,
    maxHp: 80, maxCe: 0, speed: 1.2, power: 0.9, poise: 30, radius: 0.5, scale: 0.95,
    shape: 'transfigured', color: '#8a8a9a', color2: '#3a3a4a', eyeColor: '#7fd4a8',
    actions: ['clawSwipe'], ai: 'swarm', summon: true, xp: 0,
    desc: 'It used to be a person. It does not stop and it does not feel anything.',
  }),
  isomer: C({
    id: 'isomer', name: 'Polymorphic Soul Isomer', jp: '多重魂', grade: 1,
    maxHp: 320, maxCe: 0, speed: 0.95, power: 1.6, weight: 1.7, poise: 170, radius: 0.9, scale: 1.5,
    shape: 'isomer', color: '#6a7a8a', color2: '#2a3038', eyeColor: '#7fd4a8',
    actions: ['clawSwipe', 'stomp'], ai: 'brute', summon: true, xp: 0,
    desc: 'Several souls in one body, all of them screaming.',
  }),
  curseGrade2: C({
    id: 'curseGrade2', name: 'Bound Curse', jp: '使役呪霊', grade: 2,
    maxHp: 130, maxCe: 0, speed: 1.15, power: 1.0, poise: 60, radius: 0.55,
    shape: 'blob', color: '#4a6a68', color2: '#16201f', eyeColor: '#6fd4c4',
    actions: ['clawSwipe', 'bite'], ai: 'swarm', summon: true, xp: 0,
    desc: 'A curse that already lost once.',
  }),
  rika: C({
    id: 'rika', name: 'Rika', jp: '里香', grade: 'special',
    maxHp: 420, maxCe: 0, speed: 1.25, power: 1.7, weight: 1.6,
    poise: 220, radius: 0.95, scale: 1.7, rct: 0.4,
    shape: 'rika', color: '#c85a80', color2: '#2a0a16', eyeColor: '#ffd0e0',
    actions: ['bite', 'clawSwipe', 'stomp'], ai: 'hound', summon: true,
    canBlackFlash: true, xp: 0,
    desc: 'A special grade cursed spirit that was a girl once and has not stopped loving anybody since.',
  }),
  garuda: C({
    id: 'garuda', name: 'Bomb: Garuda', jp: '迦楼羅', grade: 2,
    maxHp: 70, maxCe: 0, speed: 1.7, power: 1.4, poise: 25, radius: 0.5, scale: 1.0,
    shape: 'nue', color: '#c9a0ff', color2: '#1a1226', eyeColor: '#e8d0ff',
    actions: ['clawSwipe'], ai: 'flyer', summon: true, flying: true, xp: 0,
    desc: 'A shikigami carrying more mass than it has volume. It stops being a shikigami on contact.',
  }),
  tideFish: C({
    id: 'tideFish', name: 'Tide Shikigami', jp: '式神・魚', grade: 3,
    maxHp: 55, maxCe: 0, speed: 1.6, power: 0.85, poise: 20, radius: 0.42, scale: 0.9,
    shape: 'fish', color: '#6fd0e8', color2: '#0d222a', eyeColor: '#d8f8ff',
    actions: ['bite'], ai: 'swarm', summon: true, flying: true, xp: 0,
    desc: 'Swims through air the way it swims through water, which is to say straight at you.',
  }),
  puppet: C({
    id: 'puppet', name: 'Puppet', jp: '傀儡', grade: 3,
    maxHp: 120, maxCe: 0, speed: 0.95, power: 0.9, weight: 1.4, poise: 80, radius: 0.55, scale: 1.05,
    shape: 'puppet', color: '#9fb8c8', color2: '#1e262e', eyeColor: '#b8e8ff',
    actions: ['clawSwipe'], ai: 'guard', summon: true, xp: 0,
    desc: 'A hollow body built to take the hit that was meant for the operator.',
  }),
  decoy: C({
    id: 'decoy', name: 'Cursed Double', jp: '影武者', grade: 4,
    maxHp: 1, maxCe: 0, speed: 0, power: 0, poise: 1, radius: 0.45,
    shape: 'decoy', color: '#ffb3d1', color2: '#2a1220', eyeColor: '#ffffff',
    actions: [], ai: 'none', summon: true, xp: 0, decoy: true,
    desc: 'A shell of cursed energy shaped like you.',
  }),
};

export const getCurse = (id) => CURSES[id] || CURSES.larva;

export const GRADE_POWER = { 4: 0.6, 3: 0.85, 2: 1.15, 1: 1.6, special: 2.4 };

/** Wave composition for the Gauntlet mode. */
export const WAVE_TABLE = [
  { wave: 1, spawns: [['larva', 4]] },
  { wave: 2, spawns: [['larva', 4], ['grinner', 2]] },
  { wave: 3, spawns: [['grinner', 3], ['mantis', 2]] },
  { wave: 4, spawns: [['mantis', 3], ['wraith', 2]] },
  { wave: 5, spawns: [['hulkCurse', 1], ['mantis', 2], ['larva', 4]] },
  { wave: 6, spawns: [['serpent', 2], ['wraith', 3]] },
  { wave: 7, spawns: [['hulkCurse', 2], ['serpent', 2]] },
  { wave: 8, spawns: [['fingerBearer', 1], ['grinner', 4]] },
  { wave: 9, spawns: [['hanged', 1], ['mantis', 3], ['wraith', 2]] },
  { wave: 10, spawns: [['disasterCurse', 1]], boss: true },
  { wave: 11, spawns: [['fingerBearer', 2], ['serpent', 3]] },
  { wave: 12, spawns: [['hanged', 2], ['hulkCurse', 2]] },
  { wave: 13, spawns: [['disasterCurse', 1], ['fingerBearer', 1]], boss: true },
  { wave: 14, spawns: [['mahoraga', 1]], boss: true },
];
