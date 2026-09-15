// Binding Vows.
//
// A vow is a contract with yourself. You give up something concrete and
// certain, and in exchange cursed energy gives you something back. Break the
// terms and the backlash is worse than whatever you gained.
//
// Pre-match vows are chosen in the loadout screen and cost "vow points".
// Impromptu vows are declared mid-fight (V) at a cost paid immediately.

export const VOWS = {
  revelation: {
    id: 'revelation', name: 'Revelation',
    cost: 1,
    terms: 'Reveal your cursed technique to your opponent before the fight.',
    gain: '+25% cursed technique output, +15% maximum cursed energy.',
    lore: 'Explaining your technique gives your opponent information. Cursed energy considers that a real loss, and pays you for it.',
    apply(f) { f.vowMods.techniqueOutput += 0.25; f.vowMods.maxCe += 0.15; f.flags.revealed = true; },
  },
  abstinence: {
    id: 'abstinence', name: 'Abstinence',
    cost: 2,
    terms: 'You may not use Reverse Cursed Technique for the entire match.',
    gain: '+35% maximum cursed energy, +60% cursed energy regeneration.',
    breakOn: 'rct',
    penalty: 'Cursed energy locked to zero for 10 seconds and technique sealed.',
    apply(f) { f.vowMods.maxCe += 0.35; f.vowMods.ceRegen += 0.6; f.flags.noRct = true; },
  },
  noDomain: {
    id: 'noDomain', name: 'Restraint of the Sure-Hit',
    cost: 2,
    terms: 'You may not expand a domain.',
    gain: '+45% cursed technique damage, +20% cursed energy regeneration.',
    breakOn: 'domain',
    penalty: 'The domain shatters on cast and you take 30% of your maximum health.',
    apply(f) { f.vowMods.techniqueOutput += 0.45; f.vowMods.ceRegen += 0.2; f.flags.noDomain = true; },
  },
  bareHands: {
    id: 'bareHands', name: 'Empty Hands',
    cost: 1,
    terms: 'You may not carry a cursed tool.',
    gain: '+30% physical damage, Black Flash window widened by 45%.',
    breakOn: 'tool',
    penalty: 'Physical damage halved for the rest of the match.',
    apply(f) { f.vowMods.physicalOutput += 0.3; f.vowMods.flashBand += 0.45; f.flags.noTool = true; },
  },
  timeLimit: {
    id: 'timeLimit', name: 'The Hour',
    cost: 3,
    terms: 'Win within 120 seconds.',
    gain: '+55% to every output stat and +40% movement speed.',
    breakOn: 'timeout',
    penalty: 'Immediate death when the clock runs out.',
    apply(f) {
      f.vowMods.techniqueOutput += 0.55;
      f.vowMods.physicalOutput += 0.55;
      f.vowMods.speed += 0.4;
      f.flags.deadline = 120;
    },
  },
  handicap: {
    id: 'handicap', name: 'Wounded Start',
    cost: 2,
    terms: 'Begin the match at 45% health.',
    gain: '+30% all damage, +25% reinforcement, Black Flash chains never decay.',
    apply(f) {
      f.vowMods.techniqueOutput += 0.3;
      f.vowMods.physicalOutput += 0.3;
      f.vowMods.reinforce += 0.25;
      f.flags.startWounded = true;
      f.flags.keepFlashChain = true;
    },
  },
  silence: {
    id: 'silence', name: 'Unspoken',
    cost: 1,
    terms: 'You may not announce your domain (no cast-time invulnerability window).',
    gain: 'Domain cast time reduced by 45% and the barrier gains 30% integrity.',
    apply(f) { f.vowMods.domainCast -= 0.45; f.vowMods.domainIntegrity += 0.3; f.flags.silentDomain = true; },
  },
  singleShot: {
    id: 'singleShot', name: 'One Blade Only',
    cost: 2,
    terms: 'Cursed technique abilities III and IV are locked.',
    gain: 'Abilities I and II cost 50% less and deal +60% damage.',
    apply(f) { f.vowMods.lockAbilities = [2, 3]; f.vowMods.cheapBasics = true; },
  },
  noHealing: {
    id: 'noHealing', name: 'No Quarter',
    cost: 1,
    terms: 'You cannot be healed by any source except Reverse Cursed Technique.',
    gain: '+20% maximum health and +35% poise.',
    apply(f) { f.vowMods.maxHp += 0.2; f.vowMods.poise += 0.35; f.flags.onlyRctHeal = true; },
  },
  throwAwayGuard: {
    id: 'throwAwayGuard', name: 'No Guard',
    cost: 2,
    terms: 'You cannot block. Parry still works.',
    gain: '+40% attack speed, +30% dash distance, perfect parries refund double cursed energy.',
    breakOn: 'block',
    apply(f) {
      f.vowMods.attackSpeed += 0.4;
      f.vowMods.dash += 0.3;
      f.vowMods.parryRefund += 1.0;
      f.flags.noBlock = true;
    },
  },
};

export const VOW_LIST = Object.values(VOWS);
export const MAX_VOW_POINTS = 4;

// ---------------------------------------------------------------------------
// Impromptu vows — declared mid-fight, paid for instantly.
// ---------------------------------------------------------------------------

export const IMPROMPTU_VOWS = [
  {
    id: 'bloodPrice', name: 'Blood for Power',
    terms: 'Pay 22% of your current health, right now.',
    gain: 'Cursed energy refilled completely and output raised 30% for 20 seconds.',
    available: (f) => f.hp > f.maxHp * 0.3,
    apply(f, world) {
      f.takeTrueDamage(f.hp * 0.22, 'a binding vow');
      f.ce = f.maxCe;
      world.addStatus(f, { type: 'buff', time: 20, output: 0.3 });
    },
  },
  {
    id: 'sealTechnique', name: 'Seal the Technique',
    terms: 'Lock your cursed technique for 25 seconds.',
    gain: 'Physical damage +80%, attack speed +35%, Black Flash window doubled.',
    available: (f) => !f.hasStatus('techniqueSealed'),
    apply(f, world) {
      world.addStatus(f, { type: 'techniqueSealed', time: 25 });
      world.addStatus(f, { type: 'buff', time: 25, physical: 0.8, attackSpeed: 0.35, flashBand: 0.5 });
    },
  },
  {
    id: 'stakeEverything', name: 'All or Nothing',
    terms: 'Your maximum health drops to 1 for 12 seconds. One hit ends you.',
    gain: 'Triple damage, immunity to stagger, all cooldowns cleared.',
    available: (f) => f.hp / f.maxHp > 0.15,
    apply(f, world) {
      world.addStatus(f, { type: 'glassCannon', time: 12 });
      world.addStatus(f, { type: 'buff', time: 12, output: 2.0, superArmor: true });
      f.clearCooldowns();
    },
  },
  {
    id: 'confess', name: 'Confession',
    terms: 'Your health is capped at its current value for the rest of the match.',
    gain: 'Flow gauge filled and Domain Expansion cost halved permanently.',
    available: (f) => !f.flags.confessed,
    apply(f, world) {
      f.maxHp = f.hp;
      f.flags.confessed = true;
      f.flow = 1;
      f.vowMods.domainCost = (f.vowMods.domainCost ?? 0) - 0.5;
    },
  },
  {
    id: 'restrainMovement', name: 'Rooted Stance',
    terms: 'Movement speed halved for 18 seconds.',
    gain: 'Reinforcement +60%, poise doubled, cursed energy regeneration tripled.',
    available: () => true,
    apply(f, world) {
      world.addStatus(f, { type: 'buff', time: 18, speed: -0.5, reinforce: 0.6, poise: 1.0, ceRegen: 2.0 });
    },
  },
];
