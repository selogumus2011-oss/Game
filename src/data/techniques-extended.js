// Second wave of cursed techniques. Same schema as techniques.js — kept in its
// own module so neither file becomes unreadable.
//
// These lean harder on the source material's specific rules: a fist that lands
// twice, a sorcerer who copies whatever hits him, a gambler whose domain is a
// pachinko parlour, a body that converts cursed energy into lightning.

import { TAU, PI, clamp, clamp01, vdist, vsub, vnorm, vangle, vfromAngle, vadd } from '../core/math.js';

export const EXTRA_TECHNIQUES = {

  // =========================================================================
  // DIVERGENT FIST
  // =========================================================================
  divergentFist: {
    id: 'divergentFist',
    name: 'Divergent Fist',
    family: 'No innate technique — raw output and a vessel',
    color: '#ff6b5a', color2: '#2a1010', aura: 'ember',
    blurb: 'No inherited technique at all. Just a body that should not exist and a fist that lands twice — once with the punch, once with the cursed energy a fraction of a second behind it.',
    passive: {
      name: 'Divergent Fist',
      desc: 'Your cursed energy is always a beat behind your body. Every physical hit lands a second, delayed impact — and because that gap is exactly what Black Flash measures, your timing band is the widest in the game.',
      onPreHit(ctx) {
        ctx.self.mods.flashBand += 0.18;
      },
      onOutgoingHit(ctx) {
        const { world, self, victim, hit } = ctx;
        if (!hit.physical || hit.divergent) return;
        // The cursed energy arrives a fraction of a second after the fist.
        const dmg = hit.damage * 0.45;
        world.after(0.16, () => {
          if (victim.dead || self.dead) return;
          world.dealDamage(self, victim, {
            damage: dmg, poise: hit.poise * 0.5, knock: 3.5, tags: ['technique'],
            divergent: true, noFlash: true, hitstop: 0.04,
            pos: { x: victim.pos.x, y: victim.pos.y }, sourceName: 'Divergent Fist',
          });
          world.fx('divergent', { pos: { x: victim.pos.x, y: victim.pos.y }, z: victim.z + 1 });
        });
      },
      onUpdate(ctx) {
        ctx.self.mods.physical += 0.18;
        ctx.self.mods.poiseRegen += 0.25;
      },
    },
    abilities: [
      {
        id: 'divergentStrike', name: 'Divergent Fist: Full',
        desc: 'Commit the whole body. The second impact arrives hard enough to fold the target around it.',
        archetype: 'melee', cost: 16, cooldown: 3, castTime: 0.22, recovery: 0.34,
        range: 2.3, halfArc: 0.75, damage: 24, poise: 40, knock: 9,
        tags: ['physical'], vfx: 'slash_heavy', sfx: 'swingHeavy',
        onHit(ctx) {
          ctx.world.after(0.18, () => {
            if (ctx.victim.dead) return;
            ctx.world.dealDamage(ctx.self, ctx.victim, {
              damage: 22, poise: 34, knock: 12, lift: 3, tags: ['technique'],
              divergent: true, noFlash: true, hitstop: 0.12,
              pos: { x: ctx.victim.pos.x, y: ctx.victim.pos.y }, sourceName: 'Divergent Fist',
            });
            ctx.world.shake(9, 0.3);
          });
        },
      },
      {
        id: 'manjiKick', name: 'Manji Kick',
        desc: 'A rising kick that puts them in the air where nothing can help them.',
        archetype: 'melee', cost: 12, cooldown: 4, castTime: 0.18, recovery: 0.36,
        range: 2.2, halfArc: 0.9, damage: 18, poise: 30, knock: 3, lift: 8.5,
        tags: ['physical'], vfx: 'slash_rise', sfx: 'swingHeavy',
      },
      {
        id: 'blackFlashFocus', name: 'Focus',
        desc: 'Stop thinking about the fight and start feeling the gap between the fist and the energy. For a few seconds the window is impossible to miss.',
        archetype: 'buff', cost: 30, cooldown: 22, castTime: 0.3, recovery: 0.25,
        buff: { time: 9, flashBand: 1.2, output: 0.2, attackSpeed: 0.15 },
        tags: ['buff'], vfx: 'buffAura', sfx: 'cast',
        onCast(ctx) { ctx.world.banner('Focus — the window widens', '#ff6b5a', 1.6); },
      },
      {
        id: 'vesselRelease', name: 'Vessel: Partial Release',
        desc: 'Let the King of Curses steer for one swing. It costs you flesh and you do not get it back.',
        archetype: 'melee', cost: 40, cooldown: 30, castTime: 0.45, recovery: 0.7,
        range: 4.2, halfArc: 1.5, damage: 72, poise: 160, knock: 16, ultimate: true,
        ignoreReinforce: 0.5, tags: ['technique', 'slash'], vfx: 'worldcut', sfx: 'slash',
        onCast(ctx) {
          ctx.self.takeTrueDamage(ctx.self.maxHp * 0.1, 'the vessel giving ground');
          ctx.world.slowmo(0.3, 0.7);
          ctx.world.shake(16, 0.8);
          ctx.world.banner('Partial Release', '#ff4d4d', 1.8);
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain — no innate technique to build a barrier out of. Everything here is the body, the timing and the second impact.',
  },

  // =========================================================================
  // COPY (and the cursed spirit that follows you)
  // =========================================================================
  copyTechnique: {
    id: 'copyTechnique',
    name: 'Copy',
    family: 'Special Grade — descendant of Sugawara no Michizane',
    color: '#b0e8ff', color2: '#101c26', aura: 'infinity',
    blurb: 'You have no technique of your own. You have everyone else\'s — and a special grade cursed spirit that loved you enough to stay.',
    passive: {
      name: 'Copy',
      desc: 'Any cursed technique that touches you is learned. The last technique used against you is stored and can be cast back with ability III. Your cursed energy reserve is bottomless, so you can afford to fight with a borrowed technique forever.',
      onIncomingHit(ctx) {
        const a = ctx.attacker;
        if (a && a.techniqueId && a.techniqueId !== 'copyTechnique' && (ctx.hit.tags || []).includes('technique')) {
          if (ctx.self.copiedTechnique !== a.techniqueId) {
            ctx.self.copiedTechnique = a.techniqueId;
            ctx.world.fx('copy', { pos: { x: ctx.self.pos.x, y: ctx.self.pos.y }, z: ctx.self.z + 1.2 });
            if (ctx.self.isPlayer) ctx.world.notify(`Copied: ${a.technique.name}`, '#b0e8ff');
          }
        }
        return false;
      },
      onUpdate(ctx) {
        ctx.self.mods.ceRegen += 6;
        ctx.self.mods.maxCe += 60;
      },
    },
    abilities: [
      {
        id: 'rikaManifest', name: 'Rika: Manifest',
        desc: 'She was never exorcised. She was waiting. Call her out and she fights beside you.',
        archetype: 'summon', cost: 42, cooldown: 24, castTime: 0.6, recovery: 0.4,
        summon: { kind: 'rika', count: 1, life: 26 },
        tags: ['technique', 'shikigami'], sfx: 'summon',
        onCast(ctx) {
          ctx.world.banner('Rika', '#ff8ab0', 1.8);
          ctx.world.shake(10, 0.6);
        },
      },
      {
        id: 'rikaBleed', name: 'Rika: Devour',
        desc: 'She bites through whatever is in front of you and gives the energy back.',
        archetype: 'beam', cost: 26, cooldown: 4, castTime: 0.3, recovery: 0.3,
        length: 10, width: 2.6, damage: 32, poise: 50, knock: 8,
        tags: ['technique'], vfx: 'cleave', color: '#ff8ab0', sfx: 'slash',
        onHit(ctx) { ctx.self.gainCe(9); },
      },
      {
        id: 'castCopied', name: 'Copied Technique',
        desc: 'Cast the last technique that was used on you, with your own reserve behind it.',
        archetype: 'custom', cost: 22, cooldown: 5, castTime: 0.3, recovery: 0.3,
        tags: ['technique'], sfx: 'cast',
        onCast(ctx) {
          const id = ctx.self.copiedTechnique;
          if (!id) {
            if (ctx.self.isPlayer) ctx.world.notify('Nothing copied yet — let a technique hit you', '#ff8a8a');
            return false;
          }
          const src = ctx.world.techniqueById(id);
          const ab = src?.abilities?.[0];
          if (!ab) return false;
          ctx.world.notify(`${src.name}: ${ab.name}`, src.color);
          ctx.world.executeAbility(ctx.self, ab, ctx.aim);
          return true;
        },
      },
      {
        id: 'pureLove', name: 'Rika: Complete Manifestation',
        desc: 'All of her, all at once. Cursed energy without a ceiling for as long as you can hold her.',
        archetype: 'buff', cost: 70, cooldown: 45, castTime: 0.8, recovery: 0.6, ultimate: true,
        buff: { time: 16, output: 0.7, reinforce: 0.3, speed: 0.2, ceRegen: 14 },
        tags: ['technique', 'buff'], vfx: 'buffAura', sfx: 'purple',
        onCast(ctx) {
          ctx.world.banner('Complete Manifestation', '#ff8ab0', 2.4);
          ctx.world.shake(18, 1.1);
          ctx.world.slowmo(0.3, 0.8);
          ctx.world.spawnSummon(ctx.self, 'rika', { life: 16 });
        },
      },
    ],
    domain: {
      id: 'authenticMutualLove', name: 'Authentic Mutual Love',
      desc: 'A barrier made out of the only thing that was ever really yours. Inside it she is everywhere and the sentence has already been passed.',
      radius: 12, duration: 11, integrity: 250, cost: 90, drain: 6, castTime: 1.2,
      visual: 'love', color: '#ff8ab0', color2: '#1a0c14',
      chant: 'You will not be lonely. I am here.',
      sureHit: { type: 'devour', dps: 17, ceDrain: 6, healOwner: 5 },
      refinement: 1.05,
      blurb: 'Sure-hit: devouring. Drains cursed energy from everyone inside and feeds it back to you as health.',
    },
  },

  // =========================================================================
  // ICE FORMATION
  // =========================================================================
  iceFormation: {
    id: 'iceFormation',
    name: 'Ice Formation',
    family: 'Ancient sorcerer — the King of Curses\' cook',
    color: '#a8e8ff', color2: '#0e1a22', aura: 'frost',
    blurb: 'Freeze the air, the ground and the blood in the target. Patient, precise, and entirely without urgency.',
    passive: {
      name: 'Frost Calm',
      desc: 'The air around you is below freezing. Enemies in range are slowed continuously, and ice cannot touch you. Chilled targets take more damage from every source.',
      onUpdate(ctx) {
        const { self, world, dt } = ctx;
        self.resist.ice = 1;
        self.frostAura = 1;
        for (const f of world.fighters) {
          if (f.team === self.team || f.dead) continue;
          if (vdist(f.pos, self.pos) < 5.5) {
            world.addStatus(f, { type: 'chilled', time: 0.6, power: 0.3 });
          }
        }
      },
    },
    abilities: [
      {
        id: 'iceFang', name: 'Ice Fang',
        desc: 'A spear of ice driven up out of the ground under them.',
        archetype: 'projectile', cost: 18, cooldown: 2.2, castTime: 0.24, recovery: 0.26,
        tags: ['technique', 'ice'],
        projectile: {
          speed: 22, radius: 0.8, life: 1.4, damage: 26, poise: 34, knock: 5,
          pierce: 2, vfx: 'ice', color: '#a8e8ff', glow: '#ffffff', trail: 0.5,
          status: { type: 'chilled', time: 4, power: 0.45 },
        },
        sfx: 'slash',
      },
      {
        id: 'frostField', name: 'Frost Calm: Field',
        desc: 'Freeze the ground itself. Anything standing on it loses its footing and its heat.',
        archetype: 'zone', cost: 26, cooldown: 7, castTime: 0.45, recovery: 0.4,
        radius: 5.2, duration: 7, dps: 9, poise: 10, forward: 4,
        status: { type: 'chilled', time: 2.5, power: 0.55 },
        tags: ['technique', 'ice'], vfx: 'zone', color: '#a8e8ff', sfx: 'cast',
      },
      {
        id: 'icefall', name: 'Ice Formation: Icefall',
        desc: 'A ceiling of ice, then no ceiling.',
        archetype: 'aoe', cost: 46, cooldown: 12, castTime: 0.7, recovery: 0.5,
        radius: 6.5, damage: 52, poise: 110, knock: 10, atTarget: true,
        status: { type: 'root', time: 1.4 },
        tags: ['technique', 'ice'], vfx: 'burst', color: '#a8e8ff', sfx: 'hitHeavy',
        onCast(ctx) { ctx.world.shake(12, 0.6); },
      },
      {
        id: 'absoluteZero', name: 'Ice Formation: Absolute',
        desc: 'Stop every molecule in a wide circle. Nothing that is frozen can reverse a cursed technique.',
        archetype: 'aoe', cost: 74, cooldown: 26, castTime: 1.0, recovery: 0.8,
        radius: 9, damage: 66, poise: 200, knock: 4, ultimate: true,
        status: { type: 'frozen', time: 2.2 },
        tags: ['technique', 'ice'], vfx: 'burst', color: '#d8f4ff', sfx: 'purple',
        onCast(ctx) {
          ctx.world.banner('Absolute Zero', '#a8e8ff', 2);
          ctx.world.shake(18, 1);
          ctx.world.slowmo(0.35, 0.6);
        },
      },
    ],
    domain: {
      id: 'frozenSanctuary', name: 'Frozen Sanctuary',
      desc: 'A garden of ice with no season after it. Everything inside slows toward a stop.',
      radius: 12, duration: 12, integrity: 235, cost: 88, drain: 5.5, castTime: 1.15,
      visual: 'ice', color: '#a8e8ff', color2: '#0a141c',
      chant: 'Rest here. It will not hurt for long.',
      sureHit: { type: 'freeze', dps: 12, slow: 0.7, chill: true },
      refinement: 1.0,
      blurb: 'Sure-hit: deep freeze. Continuous chill that stacks into an outright freeze if you stay.',
    },
  },

  // =========================================================================
  // IDLE DEATH GAMBLE
  // =========================================================================
  idleDeathGamble: {
    id: 'idleDeathGamble',
    name: 'Idle Death Gamble',
    family: 'Grade 1 — expelled, unbothered',
    color: '#ffd166', color2: '#23190a', aura: 'jackpot',
    blurb: 'A technique that is literally gambling. Build the odds, pull the lever, and if it lands you cannot die for four minutes and eleven seconds.',
    passive: {
      name: 'Private Pure Love Train',
      desc: 'Damage dealt and taken both feed the reels. At a full meter you can spin — and a jackpot grants unlimited reverse cursed technique, so every wound closes as fast as it opens.',
      onUpdate(ctx) {
        const s = ctx.self;
        s.jackpotMeter = clamp(s.jackpotMeter ?? 0, 0, 100);
        if (s.hasStatus('jackpot')) {
          s.mods.output += 0.5;
          s.mods.speed += 0.2;
        }
      },
      onOutgoingHit(ctx) {
        ctx.self.jackpotMeter = clamp((ctx.self.jackpotMeter ?? 0) + ctx.hit.damage * 0.18, 0, 100);
      },
      onIncomingHit(ctx) {
        ctx.self.jackpotMeter = clamp((ctx.self.jackpotMeter ?? 0) + 4, 0, 100);
        return false;
      },
    },
    abilities: [
      {
        id: 'overflow', name: 'Overflow',
        desc: 'Cursed energy dumped into the fist with no finesse whatsoever.',
        archetype: 'melee', cost: 14, cooldown: 2.4, castTime: 0.2, recovery: 0.3,
        range: 2.4, halfArc: 0.85, damage: 22, poise: 36, knock: 8,
        tags: ['physical'], vfx: 'slash_heavy', sfx: 'swingHeavy',
      },
      {
        id: 'reelRush', name: 'Reel Rush',
        desc: 'A fast string of hits. Every one of them feeds the reels.',
        archetype: 'melee', cost: 20, cooldown: 6, castTime: 0.2, recovery: 0.44,
        range: 2.5, halfArc: 1.1, damage: 10, poise: 12, knock: 2, multi: 7, multiDelay: 0.07,
        tags: ['physical'], vfx: 'slash_rush', sfx: 'slash',
        onHit(ctx) { ctx.self.jackpotMeter = clamp((ctx.self.jackpotMeter ?? 0) + 3, 0, 100); },
      },
      {
        id: 'spin', name: 'Spin the Reels',
        desc: 'Pull the lever early. Cheap, fast, and usually nothing — but sometimes it is not nothing.',
        archetype: 'custom', cost: 20, cooldown: 8, castTime: 0.35, recovery: 0.3,
        tags: ['technique'], sfx: 'ui',
        onCast(ctx) {
          const roll = ctx.world.rng.next();
          const meter = ctx.self.jackpotMeter ?? 0;
          const odds = 0.12 + meter / 320;
          ctx.world.fx('reels', { pos: { x: ctx.self.pos.x, y: ctx.self.pos.y }, z: ctx.self.z + 2 });
          if (roll < odds) {
            ctx.world.addStatus(ctx.self, { type: 'buff', time: 10, output: 0.35, attackSpeed: 0.25, regen: 6 });
            ctx.world.banner('Hit — the reels pay out', '#ffd166', 1.6);
            ctx.self.jackpotMeter = clamp(meter + 25, 0, 100);
          } else {
            ctx.world.notify('No pay-out', '#9aa3ad');
            ctx.self.jackpotMeter = clamp(meter + 12, 0, 100);
          }
          return true;
        },
      },
      {
        id: 'jackpot', name: 'JACKPOT',
        desc: 'Four minutes and eleven seconds of unlimited reverse cursed technique. You do not stop, and you do not stay down.',
        archetype: 'custom', cost: 30, cooldown: 60, castTime: 0.6, recovery: 0.6, ultimate: true,
        tags: ['technique'], sfx: 'purple',
        requires: { jackpotMeter: 100 },
        onCast(ctx) {
          ctx.self.jackpotMeter = 0;
          ctx.world.addStatus(ctx.self, { type: 'jackpot', time: 25 });
          ctx.world.addStatus(ctx.self, { type: 'buff', time: 25, output: 0.5, speed: 0.2, regen: 22, reinforce: 0.2 });
          ctx.world.banner('JACKPOT — unlimited reversal', '#ffd166', 3);
          ctx.world.shake(20, 1.4);
          ctx.world.slowmo(0.25, 1);
          ctx.world.fx('jackpot', { pos: { x: ctx.self.pos.x, y: ctx.self.pos.y }, z: ctx.self.z });
        },
      },
    ],
    domain: {
      id: 'idleDeathGambleDomain', name: 'Idle Death Gamble',
      desc: 'The barrier is a pachinko parlour, and the target has to watch the reels. Everyone inside is on the machine, and the house owns the odds.',
      radius: 11.5, duration: 11, integrity: 210, cost: 86, drain: 5.5, castTime: 1.1,
      visual: 'pachinko', color: '#ffd166', color2: '#1a1206',
      chant: 'Nothing personal. The odds are just mine in here.',
      sureHit: { type: 'gamble', dps: 11, stunPulse: 3, jackpotGain: 9 },
      refinement: 0.95,
      blurb: 'Sure-hit: forced spectation. Stuns on every reel stop and fills your jackpot meter the whole time.',
    },
  },

  // =========================================================================
  // STAR RAGE
  // =========================================================================
  starRage: {
    id: 'starRage',
    name: 'Star Rage',
    family: 'Special Grade — the one asking the real question',
    color: '#c9a0ff', color2: '#160f22', aura: 'mass',
    blurb: 'Add virtual mass to yourself and to anything you touch. A punch with a black hole behind it still looks like a punch.',
    passive: {
      name: 'Virtual Mass',
      desc: 'Mass accumulates as a combo runs. Every consecutive hit adds weight — more knockback, more guard damage, and a hard cap you will never reach in one string.',
      onPreHit(ctx) {
        const stacks = Math.min(12, ctx.self.combo.count);
        ctx.hit.knock *= 1 + stacks * 0.12;
        ctx.hit.poise *= 1 + stacks * 0.14;
        ctx.hit.damage *= 1 + stacks * 0.035;
      },
      onUpdate(ctx) {
        ctx.self.mods.poiseRegen += 0.3;
        ctx.self.stats.weight = Math.max(ctx.self.stats.weight, 1.2);
      },
    },
    abilities: [
      {
        id: 'massPunch', name: 'Mass Punch',
        desc: 'Load the fist, then let go of the weight all at once.',
        archetype: 'melee', cost: 18, cooldown: 3, castTime: 0.3, recovery: 0.38,
        range: 2.5, halfArc: 0.8, damage: 28, poise: 54, knock: 14, guardBreak: true,
        tags: ['physical'], vfx: 'slash_smash', sfx: 'hitHeavy',
      },
      {
        id: 'gravityWell', name: 'Gravity Well',
        desc: 'Drop a point of enormous mass and let everything fall toward it.',
        archetype: 'projectile', cost: 28, cooldown: 7, castTime: 0.4, recovery: 0.35,
        tags: ['technique', 'gravity'],
        projectile: {
          speed: 10, radius: 1.3, life: 2.6, damage: 16, poise: 20, knock: 0,
          pull: 20, pullRadius: 7, pierce: 99, vfx: 'orb_purple',
          color: '#8a5aff', glow: '#e0c8ff', trail: 0.7,
          explode: { radius: 4.5, damage: 30, knock: 12 },
        },
        sfx: 'blue',
      },
      {
        id: 'garuda', name: 'Bomb: Garuda',
        desc: 'A shikigami made of mass. It follows the target and then stops being a shikigami.',
        archetype: 'summon', cost: 40, cooldown: 16, castTime: 0.6, recovery: 0.4,
        summon: { kind: 'garuda', count: 1, life: 18 },
        tags: ['technique', 'shikigami'], sfx: 'summon',
      },
      {
        id: 'infiniteMass', name: 'Star Rage: Infinite Mass',
        desc: 'Put an impossible amount of mass behind one strike. Hitting a person with a star is not a technique problem, it is a physics problem.',
        archetype: 'melee', cost: 68, cooldown: 26, castTime: 0.7, recovery: 0.9,
        range: 3.0, halfArc: 0.9, damage: 88, poise: 240, knock: 30, lift: 5, ultimate: true,
        guardBreak: true, ignoreReinforce: 0.35,
        tags: ['physical', 'gravity'], vfx: 'slash_smash', sfx: 'hitHeavy',
        onCast(ctx) {
          ctx.world.shake(22, 1.2);
          ctx.world.slowmo(0.25, 0.8);
          ctx.world.banner('Infinite Mass', '#c9a0ff', 1.8);
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain — mass does not need a barrier to be inevitable.',
  },

  // =========================================================================
  // ELECTRIC DISCHARGE
  // =========================================================================
  electricDischarge: {
    id: 'electricDischarge',
    name: 'Electric Discharge',
    family: 'Special Grade — four hundred years bored',
    color: '#ffe066', color2: '#1d1a08', aura: 'lightning',
    blurb: 'Convert every drop of cursed energy into electricity and run it through your own nervous system. Fast, loud, and utterly unconcerned with dying.',
    passive: {
      name: 'Mythical Beast Amber',
      desc: 'Your body is the conductor. Movement and attack speed are the highest in the game, and every hit arcs to a second target nearby.',
      onUpdate(ctx) {
        ctx.self.mods.speed += 0.3;
        ctx.self.mods.attackSpeed += 0.22;
        ctx.self.resist.lightning = 1;
      },
      onOutgoingHit(ctx) {
        const { world, self, victim, hit } = ctx;
        if (hit.chained || hit.damage < 4) return;
        let best = null, bestD = 7;
        for (const f of world.fighters) {
          if (f.dead || f === victim || f.team === self.team) continue;
          const d = vdist(f.pos, victim.pos);
          if (d < bestD) { bestD = d; best = f; }
        }
        if (!best) return;
        world.dealDamage(self, best, {
          damage: hit.damage * 0.4, poise: 10, knock: 2, tags: ['technique', 'lightning'],
          chained: true, noFlash: true, hitstop: 0.02,
          pos: { x: best.pos.x, y: best.pos.y }, sourceName: 'Arc',
        });
        world.fx('arc', {
          from: { x: victim.pos.x, y: victim.pos.y }, to: { x: best.pos.x, y: best.pos.y },
          z: victim.z + 1,
        });
      },
    },
    abilities: [
      {
        id: 'thunderclap', name: 'Thunderclap',
        desc: 'A line of discharge that arrives before the sound does.',
        archetype: 'beam', cost: 20, cooldown: 2.4, castTime: 0.18, recovery: 0.24,
        length: 14, width: 1.4, damage: 30, poise: 36, knock: 6,
        status: { type: 'stun', time: 0.5 },
        tags: ['technique', 'lightning'], vfx: 'beam', color: '#ffe066', sfx: 'red',
      },
      {
        id: 'overcharge', name: 'Overcharge',
        desc: 'Push more current through yourself than the body is rated for.',
        archetype: 'buff', cost: 26, cooldown: 16, castTime: 0.3, recovery: 0.25,
        buff: { time: 12, speed: 0.35, attackSpeed: 0.3, output: 0.25 },
        hpCost: 8, tags: ['buff', 'lightning'], vfx: 'buffAura', sfx: 'cast',
      },
      {
        id: 'chainBolt', name: 'Chain Bolt',
        desc: 'A bolt that refuses to stop at the first thing it hits.',
        archetype: 'projectile', cost: 24, cooldown: 5, castTime: 0.25, recovery: 0.3,
        tags: ['technique', 'lightning'],
        projectile: {
          speed: 30, radius: 0.7, life: 1.4, damage: 20, poise: 22, knock: 3,
          pierce: 5, homing: 2.2, vfx: 'bolt', color: '#ffe066', glow: '#ffffff', trail: 0.9,
          status: { type: 'stun', time: 0.35 },
        },
        sfx: 'red',
      },
      {
        id: 'amberRelease', name: 'Mythical Beast Amber: Release',
        desc: 'Stop insulating. Everything within reach is inside the circuit, including you.',
        archetype: 'aoe', cost: 62, cooldown: 24, castTime: 0.8, recovery: 0.8,
        radius: 8.5, damage: 70, poise: 180, knock: 16, ultimate: true,
        status: { type: 'stun', time: 1.2 },
        tags: ['technique', 'lightning'], vfx: 'burst', color: '#ffe066', sfx: 'purple',
        onCast(ctx) {
          ctx.self.takeTrueDamage(14, 'your own current');
          ctx.world.shake(20, 1);
          ctx.world.banner('Mythical Beast Amber', '#ffe066', 2);
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain. Four hundred years of looking for a good fight, and none of them needed one.',
  },

  // =========================================================================
  // DISASTER TIDES
  // =========================================================================
  disasterTides: {
    id: 'disasterTides',
    name: 'Disaster Tides',
    family: 'Cursed Spirit — Disaster Curse',
    color: '#6fd0e8', color2: '#0b1a20', aura: 'tide',
    blurb: 'The fear of the sea. Shikigami made of water, an endless shoreline, and nothing to hold on to.',
    passive: {
      name: 'Tide Wall',
      desc: 'A standing wall of water absorbs incoming projectiles. Ranged techniques lose most of their force before they reach you.',
      onIncomingHit(ctx) {
        if (ctx.hit.projectile && !ctx.hit.sureHit) {
          ctx.hit.damage *= 0.5;
          ctx.world.fx('splash', { pos: ctx.hit.pos, z: ctx.self.z + 1 });
        }
        return false;
      },
      onUpdate(ctx) { ctx.self.resist.fire = Math.max(ctx.self.resist.fire || 0, 0.6); },
    },
    abilities: [
      {
        id: 'waveCrash', name: 'Wave',
        desc: 'A wall of water thrown forward with a curse riding it.',
        archetype: 'projectile', cost: 20, cooldown: 3, castTime: 0.3, recovery: 0.28,
        tags: ['technique', 'water'],
        projectile: {
          speed: 16, radius: 1.8, life: 1.6, damage: 24, poise: 40, knock: 12,
          pierce: 99, vfx: 'wave', color: '#6fd0e8', glow: '#d8f8ff', trail: 0.8,
        },
        sfx: 'summon',
      },
      {
        id: 'shikigamiShoal', name: 'Shikigami: Shoal',
        desc: 'Fish that swim through air and through people.',
        archetype: 'summon', cost: 30, cooldown: 9, castTime: 0.5, recovery: 0.4,
        summon: { kind: 'tideFish', count: 3, life: 20 },
        tags: ['technique', 'shikigami'], sfx: 'summon',
      },
      {
        id: 'undertow', name: 'Undertow',
        desc: 'Pull everything toward you and take their footing with it.',
        archetype: 'aoe', cost: 28, cooldown: 8, castTime: 0.5, recovery: 0.4,
        radius: 7, damage: 20, poise: 40, knock: -14, forward: 0,
        status: { type: 'slow', time: 2.5, power: 0.45 },
        tags: ['technique', 'water'], vfx: 'water_burst', color: '#6fd0e8', sfx: 'blue',
      },
      {
        id: 'tsunami', name: 'Tsunami',
        desc: 'The whole shoreline arrives at once.',
        archetype: 'aoe', cost: 68, cooldown: 22, castTime: 0.9, recovery: 0.8,
        radius: 10, damage: 72, poise: 190, knock: 22, lift: 4, forward: 5, ultimate: true,
        tags: ['technique', 'water'], vfx: 'water_burst', color: '#6fd0e8', sfx: 'purple',
        onCast(ctx) { ctx.world.shake(20, 1.2); ctx.world.banner('Tsunami', '#6fd0e8', 1.8); },
      },
    ],
    domain: {
      id: 'captivatingSkandha', name: 'Horizon of the Captivating Skandha',
      desc: 'A shoreline with no far side. Walk as long as you like — the water is always the same depth and the shikigami never run out.',
      radius: 13, duration: 12, integrity: 225, cost: 90, drain: 6, castTime: 1.2,
      visual: 'tide', color: '#6fd0e8', color2: '#07161c',
      chant: 'There is no shore. There was never a shore.',
      sureHit: { type: 'drown', dps: 13, slow: 0.5, summonRate: 3.5 },
      refinement: 1.0,
      blurb: 'Sure-hit: drowning. Continuous damage, heavy slow, and a shikigami released every few seconds for free.',
    },
  },

  // =========================================================================
  // CONSTRUCTION
  // =========================================================================
  construction: {
    id: 'construction',
    name: 'Construction',
    family: 'Ancient sorcerer — reincarnated, in love, and armed',
    color: '#e8c46a', color2: '#211a0c', aura: 'forge',
    blurb: 'Turn cursed energy into matter. Anything you can picture clearly enough, you can build — and you build weapons.',
    passive: {
      name: 'Perfect Construction',
      desc: 'Cursed energy becomes steel. You constantly maintain plating over your body: a shield that rebuilds itself whenever you are not being hit.',
      onUpdate(ctx) {
        const { self, dt } = ctx;
        self.plating = clamp((self.plating ?? 0) + (self.timeSinceHit > 2 ? dt * 14 : 0), 0, 90);
        ctx.self.mods.reinforce += Math.min(0.2, (self.plating ?? 0) / 450);
      },
      onIncomingHit(ctx) {
        const s = ctx.self;
        const absorbed = Math.min(s.plating ?? 0, ctx.hit.damage * 0.5);
        if (absorbed > 0) {
          s.plating -= absorbed;
          ctx.hit.damage -= absorbed;
          ctx.world.fx('plating', { pos: ctx.hit.pos, z: ctx.self.z + 1 });
        }
        return false;
      },
    },
    abilities: [
      {
        id: 'spikeField', name: 'Construct: Spikes',
        desc: 'Build a field of steel spikes out of the ground where they are standing.',
        archetype: 'zone', cost: 22, cooldown: 6, castTime: 0.4, recovery: 0.35,
        radius: 4.2, duration: 5, dps: 16, poise: 14, atTarget: true,
        status: { type: 'bleed', time: 4, power: 4 },
        tags: ['technique', 'construct'], vfx: 'zone', color: '#e8c46a', sfx: 'cast',
      },
      {
        id: 'steelBarrage', name: 'Construct: Barrage',
        desc: 'Build the ammunition as you fire it.',
        archetype: 'projectile', cost: 24, cooldown: 4, castTime: 0.3, recovery: 0.3,
        tags: ['technique', 'construct'],
        projectile: {
          speed: 26, radius: 0.5, life: 1.5, damage: 14, poise: 16, knock: 3,
          count: 5, spread: 0.3, vfx: 'shard', color: '#e8c46a', glow: '#fff0c0',
        },
        sfx: 'slash',
      },
      {
        id: 'perfectBlade', name: 'Construct: Perfect Blade',
        desc: 'Build a weapon that fits this exact fight, then throw the last one away.',
        archetype: 'buff', cost: 30, cooldown: 18, castTime: 0.4, recovery: 0.3,
        buff: { time: 16, output: 0.35, attackSpeed: 0.2, reinforce: 0.1 },
        tags: ['buff', 'construct'], vfx: 'buffAura', sfx: 'cast',
        onCast(ctx) { ctx.self.plating = 90; },
      },
      {
        id: 'sublimeArt', name: 'Sublime Art: Mode — Sphere',
        desc: 'A perfect sphere of constructed steel, dropped from directly above.',
        archetype: 'projectile', cost: 66, cooldown: 24, castTime: 1.0, recovery: 0.8,
        tags: ['technique', 'construct', 'impact'], ultimate: true,
        projectile: {
          speed: 18, radius: 2.8, life: 3, damage: 92, poise: 220, knock: 20, lift: 5,
          pierce: 999, fromSky: true, vfx: 'sphere', color: '#e8c46a', glow: '#fff4cc',
          explode: { radius: 6.5, damage: 40, knock: 18 }, destroysProps: true,
        },
        sfx: 'fire',
        onCast(ctx) { ctx.world.shake(20, 1.2); ctx.world.banner('Sublime Art', '#e8c46a', 1.8); },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain — everything gets built by hand here, including the way out.',
  },

  // =========================================================================
  // PUPPET MANIPULATION
  // =========================================================================
  puppetManipulation: {
    id: 'puppetManipulation',
    name: 'Puppet Manipulation',
    family: 'Heavenly Restriction — inverted',
    color: '#9fb8c8', color2: '#141a20', aura: 'gear',
    blurb: 'The opposite trade to Heavenly Restriction: a body that barely works, and a cursed energy reserve large enough that it never had to.',
    passive: {
      name: 'Inverted Restriction',
      desc: 'Enormous cursed energy and the longest range in the game, paid for with a fragile body: low health, low poise, and you cannot take a hit the way anyone else can. Fight from behind the puppets.',
      onUpdate(ctx) {
        ctx.self.mods.maxCe += 90;
        ctx.self.mods.ceRegen += 5;
        ctx.self.mods.technique += 0.25;
        ctx.self.mods.damageTaken += 0.3;
      },
    },
    abilities: [
      {
        id: 'puppetGuard', name: 'Puppet: Guard',
        desc: 'Send a puppet out to be hit instead of you.',
        archetype: 'summon', cost: 26, cooldown: 8, castTime: 0.4, recovery: 0.3,
        summon: { kind: 'puppet', count: 2, life: 24 },
        tags: ['technique', 'construct'], sfx: 'summon',
      },
      {
        id: 'missileBarrage', name: 'Missile Barrage',
        desc: 'Puppets are hollow. This is what they are hollow for.',
        archetype: 'projectile', cost: 28, cooldown: 5, castTime: 0.35, recovery: 0.35,
        tags: ['technique'],
        projectile: {
          speed: 18, radius: 0.6, life: 2.4, damage: 16, poise: 18, knock: 4,
          count: 6, spread: 0.5, homing: 2.4, vfx: 'missile', color: '#9fb8c8', glow: '#e0f0ff',
          explode: { radius: 2.2, damage: 12, knock: 6 },
        },
        sfx: 'fire',
      },
      {
        id: 'absoluteMode', name: 'Ultimate Mechamaru: Absolute',
        desc: 'Drop the remote body and pilot the real one. Everything gets faster and nothing gets safer.',
        archetype: 'buff', cost: 40, cooldown: 26, castTime: 0.5, recovery: 0.4,
        buff: { time: 15, output: 0.5, speed: 0.3, attackSpeed: 0.3, reinforce: 0.2 },
        tags: ['buff'], vfx: 'buffAura', sfx: 'cast',
        onCast(ctx) { ctx.world.banner('Absolute Mode', '#9fb8c8', 1.8); },
      },
      {
        id: 'ultimateCannon', name: 'Ultimate Cannon',
        desc: 'Everything in the reserve, down one barrel, in one second.',
        archetype: 'beam', cost: 76, cooldown: 26, castTime: 1.1, recovery: 1.0,
        length: 26, width: 3.2, damage: 96, poise: 220, knock: 18, ultimate: true,
        tags: ['technique'], vfx: 'worldcut', color: '#b8e8ff', sfx: 'purple',
        onCast(ctx) {
          ctx.world.shake(22, 1.3);
          ctx.world.slowmo(0.3, 0.7);
          ctx.world.banner('Ultimate Cannon', '#b8e8ff', 1.8);
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain — the body could never hold one open. The reserve goes into range instead.',
  },
};
