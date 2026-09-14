// Playable sorcerers. A character is a technique plus a body: stat spread,
// starting cursed tool, silhouette, and palette.
//
// ceControl drives Reverse Cursed Technique reliability, Black Flash window
// width, reinforcement quality and domain refinement. It is the single most
// important stat in the game.

const base = {
  maxHp: 260, maxCe: 100, ceControl: 0.5, ceRegen: 6.5,
  speed: 1.0, power: 1.0, weight: 1.0, reach: 1.0, poise: 100,
  grade: 2, rct: 0.4, domainSkill: 1.0,
};

const C = (o) => Object.assign({}, base, o);

export const CHARACTERS = {
  hollowSix: C({
    id: 'hollowSix', name: 'Satoru', title: 'The Honoured One',
    technique: 'limitless', tool: 'fists', grade: 'special',
    maxHp: 250, maxCe: 140, ceControl: 0.95, ceRegen: 9, speed: 1.18, power: 1.0,
    weight: 0.9, reach: 1.0, poise: 120, rct: 0.9, domainSkill: 1.25,
    quote: '"Throughout Heaven and Earth, I alone am the honoured one."',
    desc: 'Six Eyes plus Limitless: near-zero cursed energy waste, perfect Infinity uptime and the fastest domain in the game. Fragile only if you let his energy run dry.',
    appearance: {
      hair: '#f2f4f8', hairStyle: 'spiky', skin: '#f0d3bd', eyes: '#7fd7ff',
      uniform: '#141821', accent: '#7fd7ff', blindfold: true, scarf: false, height: 1.12, build: 0.95,
    },
    traits: ['Six Eyes — cursed energy costs reduced 40%', 'Infinity uptime is effectively permanent above 40 CE', 'Domain cast 25% faster'],
  }),

  shadowHeir: C({
    id: 'shadowHeir', name: 'Megumi', title: 'Heir of the Ten Shadows',
    technique: 'tenShadows', tool: 'katana', grade: 1,
    maxHp: 285, maxCe: 105, ceControl: 0.6, ceRegen: 6.8, speed: 1.0, power: 1.02,
    weight: 1.05, reach: 1.1, poise: 115, rct: 0.3, domainSkill: 0.9,
    quote: '"I am not a good person. I just decide who gets saved."',
    desc: 'Zoner and controller. Shikigami cover angles you cannot, and the incomplete Chimera Shadow Garden makes every summon free.',
    appearance: {
      hair: '#1b1b22', hairStyle: 'spiky', skin: '#e9c8ac', eyes: '#3d4a63',
      uniform: '#171a22', accent: '#8b7bd8', height: 1.05, build: 1.0,
    },
    traits: ['Summons persist between engagements', 'Blocking adds reinforcement', 'Mahoraga unlocks below 45% health'],
  }),

  kingOfCurses: C({
    id: 'kingOfCurses', name: 'Ryomen', title: 'King of Curses',
    technique: 'shrine', tool: 'fists', grade: 'special',
    maxHp: 340, maxCe: 130, ceControl: 0.9, ceRegen: 8, speed: 1.12, power: 1.35,
    weight: 1.15, reach: 1.12, poise: 160, rct: 0.85, domainSkill: 1.2,
    quote: '"Stand proud. You are strong."',
    desc: 'The highest raw damage in the roster with an open-barrier domain that fills the arena. Malevolent Shrine cuts your allies too — and you.',
    appearance: {
      hair: '#e8b0b0', hairStyle: 'wild', skin: '#f3d9c8', eyes: '#ff4d4d',
      uniform: '#1b0f0f', accent: '#ff4d4d', markings: true, height: 1.15, build: 1.15,
    },
    traits: ['Cleave scales with the target\'s maximum health', 'Malevolent Shrine has no barrier and a 17m radius', 'Nearby enemies lose poise faster'],
  }),

  patchwork: C({
    id: 'patchwork', name: 'Mahito', title: 'Curse of Human Hatred',
    technique: 'idleTransfiguration', tool: 'fists', grade: 'special',
    maxHp: 300, maxCe: 115, ceControl: 0.7, ceRegen: 7, speed: 1.06, power: 1.1,
    weight: 0.95, reach: 1.0, poise: 105, rct: 0.0, domainSkill: 1.0,
    quote: '"We are the same, you and I. You just cannot see your own shape."',
    desc: 'Ignores reinforcement entirely by hitting the soul. Cannot use Reverse Cursed Technique — heals by discarding flesh, permanently lowering maximum health.',
    appearance: {
      hair: '#8fa8c0', hairStyle: 'braid', skin: '#dfe7ee', eyes: '#7fd4a8',
      uniform: '#2a3038', accent: '#7fd4a8', stitches: true, height: 1.06, build: 1.0,
    },
    traits: ['Unarmed hits bypass 45% reinforcement', 'Cannot use RCT — Body Repel instead', 'Soul wounds block enemy healing'],
  }),

  volcanoCurse: C({
    id: 'volcanoCurse', name: 'Jogo', title: 'Disaster Flame',
    technique: 'disasterFlames', tool: 'fists', grade: 'special',
    maxHp: 290, maxCe: 125, ceControl: 0.62, ceRegen: 7.5, speed: 0.92, power: 1.2,
    weight: 1.2, reach: 0.95, poise: 130, rct: 0.2, domainSkill: 1.0,
    quote: '"This world is filthy with humans."',
    desc: 'Slow, immovable, immune to fire, and capable of the single largest non-domain attack in the game. Punishes anyone who tries to camp at range.',
    appearance: {
      hair: '#3b1a0a', hairStyle: 'none', skin: '#8a4a2a', eyes: '#ffb03a',
      uniform: '#2a1408', accent: '#ff8a1e', volcano: true, height: 1.08, build: 1.2,
    },
    traits: ['Immune to fire, burns anything in melee range', 'Maximum: Meteor falls from the sky and cannot be blocked', 'Heavy — very hard to knock down'],
  }),

  bloodBrother: C({
    id: 'bloodBrother', name: 'Choso', title: 'Death Painting, First',
    technique: 'bloodManipulation', tool: 'fists', grade: 1,
    maxHp: 310, maxCe: 100, ceControl: 0.68, ceRegen: 6.2, speed: 1.02, power: 1.08,
    weight: 1.05, reach: 1.05, poise: 118, rct: 0.55, domainSkill: 0.9,
    quote: '"I have a little brother. That is enough reason."',
    desc: 'Spends health as a second resource and gets stronger the closer to death he is. Piercing Blood is the longest-range precision attack in the roster.',
    appearance: {
      hair: '#2b2b33', hairStyle: 'bun', skin: '#e6c4a8', eyes: '#e0344f',
      uniform: '#221118', accent: '#e0344f', marks: true, height: 1.08, build: 1.05,
    },
    traits: ['Techniques cost health as well as cursed energy', 'Output rises as health falls', 'Hits restore blood (health)'],
  }),

  zeroPresence: C({
    id: 'zeroPresence', name: 'Toji', title: 'Sorcerer Killer',
    technique: 'heavenlyRestriction', tool: 'invertedSpear', grade: 'special',
    maxHp: 330, maxCe: 0, ceControl: 0.0, ceRegen: 0, speed: 1.3, power: 1.45,
    weight: 1.1, reach: 1.2, poise: 150, rct: 0.0, domainSkill: 0,
    quote: '"A sorcerer without cursed energy? No. A human who never needed it."',
    desc: 'Zero cursed energy: no Infinity, no reinforcement, no domain, no healing. In exchange, the highest physical ceiling in the game, permanent Infinity-piercing and total invisibility to cursed energy sense.',
    appearance: {
      hair: '#14141a', hairStyle: 'short', skin: '#dcb99b', eyes: '#2f3a44',
      uniform: '#0e1013', accent: '#dfe3ea', scar: true, height: 1.12, build: 1.14,
    },
    traits: ['Cannot be sensed — AI loses track of you constantly', 'Every attack pierces Infinity', 'No reinforcement: you live on parries and spacing'],
  }),

  quietWords: C({
    id: 'quietWords', name: 'Toge', title: 'Cursed Speech User',
    technique: 'cursedSpeech', tool: 'fists', grade: 1,
    maxHp: 245, maxCe: 110, ceControl: 0.72, ceRegen: 7, speed: 1.08, power: 0.9,
    weight: 0.92, reach: 1.0, poise: 92, rct: 0.45, domainSkill: 0.95,
    quote: '"...Salmon."',
    desc: 'Every ability is a ranged compulsion that ignores most defences — but each word tears your throat. Manage throat strain or be silenced at the worst moment.',
    appearance: {
      hair: '#f0f0f0', hairStyle: 'short', skin: '#efd6c0', eyes: '#8a6a4a',
      uniform: '#1a1d24', accent: '#e8e0c8', scarf: true, mouthMark: true, height: 1.03, build: 0.95,
    },
    traits: ['All abilities are ranged commands', 'Throat strain silences you at maximum', 'RCT instantly clears throat strain'],
  }),

  sevenThree: C({
    id: 'sevenThree', name: 'Kento', title: 'Grade 1, Salaryman',
    technique: 'ratio', tool: 'slaughterDemon', grade: 1,
    maxHp: 300, maxCe: 95, ceControl: 0.66, ceRegen: 6.4, speed: 0.98, power: 1.18,
    weight: 1.12, reach: 1.15, poise: 128, rct: 0.35, domainSkill: 0,
    quote: '"I will not be doing overtime. ...I will be doing overtime."',
    desc: 'The most cursed-energy-efficient character in the game. No domain, no tricks — weak points, clean hits, and a damage spike after 90 seconds.',
    appearance: {
      hair: '#d8c98a', hairStyle: 'short', skin: '#e8c8a8', eyes: '#4a4a4a',
      uniform: '#2a2a32', accent: '#d8c98a', goggles: true, tie: true, height: 1.1, build: 1.08,
    },
    traits: ['Cursed energy costs reduced 25%', 'Weak points grant guaranteed criticals', 'Overtime after 90s: +35% output'],
  }),

  clapDancer: C({
    id: 'clapDancer', name: 'Aoi', title: 'Boogie Woogie',
    technique: 'boogieWoogie', tool: 'fists', grade: 1,
    maxHp: 320, maxCe: 100, ceControl: 0.6, ceRegen: 6.8, speed: 1.12, power: 1.22,
    weight: 1.18, reach: 1.05, poise: 140, rct: 0.3, domainSkill: 0,
    quote: '"What kind of woman is your type?"',
    desc: 'Constant repositioning, huge physical stats, and a rhythm meter that rewards never standing still. The best Black Flash platform in the roster.',
    appearance: {
      hair: '#1a1a1a', hairStyle: 'buzz', skin: '#8a5a3a', eyes: '#2a2a2a',
      uniform: '#2a1220', accent: '#ffb3d1', muscle: true, height: 1.2, build: 1.3,
    },
    traits: ['Swapping builds Rhythm: up to +60% output', 'Enormous poise — trades hits willingly', 'Boogie Rush widens the Black Flash band per hit'],
  }),

  nailWitch: C({
    id: 'nailWitch', name: 'Nobara', title: 'Straw Doll User',
    technique: 'strawDoll', tool: 'nailHammer', grade: 3,
    maxHp: 255, maxCe: 100, ceControl: 0.64, ceRegen: 6.6, speed: 1.06, power: 1.0,
    weight: 0.96, reach: 1.05, poise: 98, rct: 0.35, domainSkill: 0,
    quote: '"I love myself when I am dressed up and confident."',
    desc: 'Plants fragments with every hit and cashes them in at any range with Resonance. Rewards aggressive pressure followed by a hard disengage.',
    appearance: {
      hair: '#c8783a', hairStyle: 'bob', skin: '#f0d0b8', eyes: '#8a5a2a',
      uniform: '#1d1a20', accent: '#ff9f6b', height: 1.02, build: 0.96,
    },
    traits: ['Every hit plants a Resonance fragment', 'Black Flash plants double fragments', 'Resonance is a sure-hit at unlimited range'],
  }),

  frameCutter: C({
    id: 'frameCutter', name: 'Naoya', title: 'Projection Sorcerer',
    technique: 'projectionSorcery', tool: 'katana', grade: 1,
    maxHp: 250, maxCe: 105, ceControl: 0.7, ceRegen: 7.2, speed: 1.35, power: 0.95,
    weight: 0.88, reach: 1.05, poise: 90, rct: 0.4, domainSkill: 0,
    quote: '"You cannot keep up. Nobody can."',
    desc: 'The fastest character in the game. Freezes anything that fails to match your framerate — but a mistimed movement freezes you instead.',
    appearance: {
      hair: '#3a3a44', hairStyle: 'slick', skin: '#e6c8ae', eyes: '#9fe870',
      uniform: '#161d14', accent: '#9fe870', height: 1.06, build: 0.94,
    },
    traits: ['Hits have a 30% chance to freeze for 1 second', 'Highest movement speed and dash frequency', 'Freezing yourself on a bad input is a real risk'],
  }),

  curseUser: C({
    id: 'curseUser', name: 'Suguru', title: 'Curse Manipulator',
    technique: 'spiritManipulation', tool: 'fists', grade: 'special',
    maxHp: 285, maxCe: 130, ceControl: 0.82, ceRegen: 7.4, speed: 1.04, power: 1.0,
    weight: 1.0, reach: 1.0, poise: 112, rct: 0.6, domainSkill: 1.05,
    quote: '"Curses are born from humans. So the answer was always obvious."',
    desc: 'Absorbs every curse you kill. The more you have eaten, the larger your cursed energy pool and the more the swarm can do for you.',
    appearance: {
      hair: '#1a1a22', hairStyle: 'bun', skin: '#e8cbb0', eyes: '#6fd4c4',
      uniform: '#101a19', accent: '#6fd4c4', robe: true, height: 1.1, build: 1.02,
    },
    traits: ['Killing curses permanently raises maximum cursed energy', 'Summons scale with reserve count', 'Maximum: Uzumaki consumes the entire reserve'],
  }),

  judge: C({
    id: 'judge', name: 'Hiromi', title: 'The Judge',
    technique: 'deadlySentencing', tool: 'playfulCloud', grade: 'special',
    maxHp: 275, maxCe: 110, ceControl: 0.75, ceRegen: 6.6, speed: 1.0, power: 1.05,
    weight: 1.15, reach: 1.15, poise: 120, rct: 0.5, domainSkill: 1.15,
    quote: '"Then let the court decide."',
    desc: 'Gets stronger every time he is hit. His domain confiscates the opponent\'s cursed technique outright — the only effect in the game that removes a technique.',
    appearance: {
      hair: '#2a2a34', hairStyle: 'messy', skin: '#dfc0a4', eyes: '#cfa8ff',
      uniform: '#1a1626', accent: '#cfa8ff', stubble: true, height: 1.1, build: 1.05,
    },
    traits: ['Damage scales with hits taken (Evidence)', 'Domain confiscates the enemy technique', 'Indicted targets stop regenerating cursed energy'],
  }),
};

export const ROSTER = Object.keys(CHARACTERS);
export const getCharacter = (id) => CHARACTERS[id] || CHARACTERS.kingOfCurses;

export const GRADE_LABEL = {
  4: 'Grade 4', 3: 'Grade 3', 2: 'Grade 2', 1: 'Grade 1',
  special: 'Special Grade',
};
