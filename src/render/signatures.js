// What each cursed technique looks like when it lands.
//
// Every technique already got an impact frame, but they all got the *same*
// impact frame in a different colour, which is why they read as interchangeable.
// In the show they do not: Cleave opens the air, Blue drags everything inward,
// Red throws it out, ice grows, lightning forks, a Straw Doll nail goes through
// and keeps going. The hit is the identity.
//
// So a signature names an archetype and tunes it. The archetypes are drawn out
// of the effect primitives the game already has — rings, bolts, cuts, bursts,
// shockwaves — combined so that each one has a distinct silhouette in the
// quarter-second it is on screen. Nothing here invents new drawing code; it
// decides what to play.
//
// Lookup order:
//
//   1. The ability's own `sig`, for the handful that are special even within
//      their technique (Purple is not Blue).
//   2. The technique's entry below.
//   3. The archetype implied by the ability's shape, so a technique nobody has
//      written an entry for still lands as something rather than as a generic
//      puff.

/**
 * Archetypes. `impact` scales the screen frame, `gash` tears the frame, and
 * `flash` is a full-screen pop: [colour, strength, seconds, mode].
 */
export const ARCHETYPES = {
  // A clean cut that was already there before you saw it.
  cut: { impact: 1.0, gash: true, flash: ['#ffffff', 0.22, 0.09, 'screen'] },
  // Space folding inward — Blue, gravity, anything that pulls.
  collapse: { impact: 0.9, gash: false, flash: ['#7fd7ff', 0.2, 0.14, 'screen'] },
  // Space thrown outward — Red, explosions, repulsion.
  burst: { impact: 1.0, gash: false, flash: ['#ffffff', 0.3, 0.1, 'screen'] },
  // A heavy blunt landing: dust, a ground ring, a hard stop.
  crush: { impact: 1.05, gash: false, flash: ['#000000', 0.22, 0.1, 'multiply'] },
  // Something goes through and out the other side.
  pierce: { impact: 0.8, gash: true, flash: null },
  // Fire, which keeps burning after the frame.
  scorch: { impact: 0.95, gash: false, flash: ['#ff8a1e', 0.26, 0.16, 'screen'] },
  // Ice, which grows instead of expanding.
  frost: { impact: 0.8, gash: false, flash: ['#a8e8ff', 0.22, 0.18, 'screen'] },
  // Lightning, which forks to anything nearby.
  arc: { impact: 0.85, gash: false, flash: ['#ffe066', 0.34, 0.07, 'screen'] },
  // A blow to the soul, which the body only notices afterwards.
  soul: { impact: 0.9, gash: false, flash: ['#7fd4a8', 0.2, 0.2, 'invert'] },
  // A word landing on someone who has to obey it.
  word: { impact: 0.75, gash: false, flash: ['#e8e0c8', 0.24, 0.12, 'screen'] },
  // Water, which arrives as weight rather than as a shape.
  surge: { impact: 0.85, gash: false, flash: ['#6fd0e8', 0.2, 0.14, 'screen'] },
  // A shikigami doing the hitting rather than the sorcerer.
  beast: { impact: 0.9, gash: true, flash: null },
};

/** Per-technique signatures, keyed by technique id. */
export const TECHNIQUE_SIGNATURES = {
  limitless: { arch: 'collapse', color: '#7fd7ff' },
  tenShadows: { arch: 'beast', color: '#8b7bd8' },
  shrine: { arch: 'cut', color: '#ff4d4d' },
  idleTransfiguration: { arch: 'soul', color: '#7fd4a8' },
  disasterFlames: { arch: 'scorch', color: '#ff8a1e' },
  bloodManipulation: { arch: 'pierce', color: '#e0344f' },
  heavenlyRestriction: { arch: 'cut', color: '#dfe3ea', impact: 0.85 },
  cursedSpeech: { arch: 'word', color: '#e8e0c8' },
  ratio: { arch: 'crush', color: '#d8c98a' },
  boogieWoogie: { arch: 'burst', color: '#ffb3d1', impact: 0.7 },
  strawDoll: { arch: 'pierce', color: '#ff9f6b' },
  projectionSorcery: { arch: 'cut', color: '#9fe870', impact: 0.8 },
  spiritManipulation: { arch: 'beast', color: '#6fd4c4' },
  deadlySentencing: { arch: 'crush', color: '#cfa8ff' },
  divergentFist: { arch: 'burst', color: '#ff6b5a' },
  copyTechnique: { arch: 'soul', color: '#b0e8ff', impact: 0.8 },
  iceFormation: { arch: 'frost', color: '#a8e8ff' },
  idleDeathGamble: { arch: 'burst', color: '#ffd166' },
  starRage: { arch: 'crush', color: '#c9a0ff' },
  electricDischarge: { arch: 'arc', color: '#ffe066' },
  disasterTides: { arch: 'surge', color: '#6fd0e8' },
  construction: { arch: 'pierce', color: '#e8c46a' },
  puppetManipulation: { arch: 'burst', color: '#9fb8c8', impact: 0.8 },
};

/**
 * Abilities whose read differs from the rest of their technique.
 *
 * Blue and Red are the same technique and opposite events; Purple is neither.
 * Keeping these here rather than in the data files means the presentation
 * layer owns presentation, and the simulation stays free of it.
 */
export const ABILITY_SIGNATURES = {
  blue: { arch: 'collapse', color: '#4da6ff', impact: 1.0 },
  red: { arch: 'burst', color: '#ff4d4d', impact: 1.1 },
  purple: { arch: 'burst', color: '#b06bff', impact: 1.35, gash: true },
  maximumMeteor: { arch: 'crush', color: '#ff7a1a', impact: 1.3, gash: true },
  supernova: { arch: 'burst', color: '#ff5a7a', impact: 1.2 },
  absoluteZero: { arch: 'frost', color: '#a8e8ff', impact: 1.2 },
  thunderclap: { arch: 'arc', color: '#fff2a0', impact: 1.0 },
  infiniteMass: { arch: 'crush', color: '#c9a0ff', impact: 1.3, gash: true },
  ultimateCannon: { arch: 'pierce', color: '#b8e8ff', impact: 1.25, gash: true },
  tsunami: { arch: 'surge', color: '#6fd0e8', impact: 1.2 },
  maxUzumaki: { arch: 'collapse', color: '#6fd4c4', impact: 1.3, gash: true },
  executionOrder: { arch: 'crush', color: '#cfa8ff', impact: 1.3, gash: true },
  divergentStrike: { arch: 'burst', color: '#ff6b5a', impact: 1.1 },
  hammerSmash: { arch: 'crush', color: '#ff9f6b', impact: 1.15 },
  perfectSecond: { arch: 'cut', color: '#9fe870', impact: 1.2, gash: true },
};

/** Fallback archetype from the shape of the ability, when nothing names one. */
function archFromKind(kind) {
  switch (kind) {
    case 'beam': return 'pierce';
    case 'projectile': return 'burst';
    case 'cone': return 'burst';
    case 'aoe': return 'crush';
    case 'summon': return 'beast';
    case 'melee':
    case 'dash': return 'burst';
    default: return 'burst';
  }
}

/**
 * Resolve the signature for a hit.
 *
 * `abilityId` and `techniqueId` may both be missing — an environmental hit, a
 * shikigami, a prop — in which case the caller still gets a usable archetype
 * so nothing ever lands without a frame.
 */
export function signatureFor({ abilityId, techniqueId, kind, color } = {}) {
  const spec = (abilityId && ABILITY_SIGNATURES[abilityId])
    || (techniqueId && TECHNIQUE_SIGNATURES[techniqueId])
    || { arch: archFromKind(kind) };
  const base = ARCHETYPES[spec.arch] || ARCHETYPES.burst;
  return {
    arch: spec.arch || 'burst',
    color: color || spec.color || '#ffffff',
    impact: spec.impact ?? base.impact,
    gash: spec.gash ?? base.gash,
    flash: spec.flash ?? base.flash,
  };
}
