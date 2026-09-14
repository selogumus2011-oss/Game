// Arenas. Each one supplies a palette, a ground treatment, prop layout rules,
// weather and lighting. Props are destructible and used for wall-slams.

export const ARENAS = {
  shibuya: {
    id: 'shibuya', name: 'Shibuya Station, Halloween', jp: '渋谷事変',
    size: 56,
    ground: '#14161c', groundAlt: '#1b1e27', grid: '#22262f',
    fog: '#0a0b10', fogDensity: 0.55,
    ambient: '#5a6478', light: '#ff9d4d', lightIntensity: 0.5,
    weather: 'ash', timeOfDay: 'night',
    veil: true, veilColor: '#4a1020',
    props: [
      { type: 'pillar', count: 10, hp: 240, radius: 0.9, height: 4.2, color: '#2a2e38' },
      { type: 'car', count: 6, hp: 160, radius: 1.3, height: 1.5, color: '#3a3038' },
      { type: 'sign', count: 8, hp: 60, radius: 0.35, height: 3.4, color: '#d84a4a', emissive: '#ff6b6b' },
      { type: 'barrier', count: 12, hp: 80, radius: 0.5, height: 1.1, color: '#6a5a3a' },
    ],
    desc: 'Underground concourse under a sealed veil. Tight sightlines, hard pillars, and nowhere civilians could have gone.',
  },
  jujutsuHigh: {
    id: 'jujutsuHigh', name: 'Jujutsu High Training Grounds', jp: '呪術高専',
    size: 60,
    ground: '#161d18', groundAlt: '#1c261e', grid: '#26332a',
    fog: '#0c110d', fogDensity: 0.3,
    ambient: '#6a7a6a', light: '#cfe0b0', lightIntensity: 0.7,
    weather: 'leaves', timeOfDay: 'dusk',
    veil: false,
    props: [
      { type: 'tree', count: 16, hp: 120, radius: 0.7, height: 5.5, color: '#2a3a2a' },
      { type: 'rock', count: 8, hp: 200, radius: 1.0, height: 1.4, color: '#3a3a3e' },
      { type: 'torii', count: 3, hp: 300, radius: 1.1, height: 5, color: '#8a3a3a', emissive: '#c05050' },
    ],
    desc: 'Open training ground behind the school. Good sightlines, soft cover, and the trees do not stop much.',
  },
  shrine: {
    id: 'shrine', name: 'Ruined Shrine', jp: '廃神社',
    size: 50,
    ground: '#1d1414', groundAlt: '#241919', grid: '#2e2020',
    fog: '#120909', fogDensity: 0.6,
    ambient: '#7a4a4a', light: '#ff6b4a', lightIntensity: 0.65,
    weather: 'embers', timeOfDay: 'night',
    veil: true, veilColor: '#3a0a0a',
    props: [
      { type: 'pillar', count: 12, hp: 200, radius: 0.75, height: 4.5, color: '#3a2420' },
      { type: 'skullpile', count: 6, hp: 120, radius: 1.1, height: 1.6, color: '#c8b8a0' },
      { type: 'brazier', count: 8, hp: 50, radius: 0.4, height: 1.6, color: '#4a3020', emissive: '#ff7a2a' },
    ],
    desc: 'The King of Curses kept a shrine here once. Something in the ground still remembers it.',
  },
  cullingIsland: {
    id: 'cullingIsland', name: 'Culling Game Colony', jp: '死滅回游',
    size: 96,
    ground: '#161a20', groundAlt: '#1d2229', grid: '#252b34',
    fog: '#090c11', fogDensity: 0.45,
    ambient: '#5a6a80', light: '#9fc0e0', lightIntensity: 0.55,
    weather: 'rain', timeOfDay: 'night',
    veil: true, veilColor: '#2a1a4a', shrinking: true,
    props: [
      { type: 'building', count: 14, hp: 500, radius: 2.4, height: 7, color: '#242a33' },
      { type: 'car', count: 10, hp: 160, radius: 1.3, height: 1.5, color: '#333038' },
      { type: 'pillar', count: 8, hp: 240, radius: 0.9, height: 4.2, color: '#2a2e38' },
      { type: 'barrier', count: 16, hp: 80, radius: 0.5, height: 1.1, color: '#5a5a4a' },
    ],
    desc: 'A sealed colony with a shrinking barrier and nine other players. Points for kills. No rules beyond the ones you swore to.',
  },
  void: {
    id: 'void', name: 'Training Void', jp: '無の間',
    size: 44,
    ground: '#101218', groundAlt: '#151822', grid: '#1e2330',
    fog: '#06070b', fogDensity: 0.25,
    ambient: '#6a7a9a', light: '#b0c8ff', lightIntensity: 0.6,
    weather: 'none', timeOfDay: 'void',
    veil: false,
    props: [
      { type: 'pillar', count: 4, hp: 9999, radius: 0.8, height: 4, color: '#1e2330' },
    ],
    desc: 'Nothing but floor and a training dummy. Learn the timing here.',
  },
};

export const getArena = (id) => ARENAS[id] || ARENAS.shibuya;
export const ARENA_LIST = Object.keys(ARENAS);
