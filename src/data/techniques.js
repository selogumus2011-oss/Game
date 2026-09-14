// Cursed technique definitions.
//
// A technique is: a passive (always-on rule), four abilities, and a Domain
// Expansion. Abilities are data-driven through "archetypes" that the runtime
// knows how to execute (projectile / beam / aoe / buff / summon / dashStrike /
// command / zone / custom). Anything that needs bespoke behaviour supplies an
// `onCast` or `onHit` hook.
//
// Hook signature: fn(ctx) where ctx = {
//   world, self, target, ability, aim (radians), dir {x,y}, origin {x,y}
// }

import { TAU, PI, vfromAngle, vadd, vdist, clamp } from '../core/math.js';

// ---------------------------------------------------------------------------

export const TECHNIQUES = {

  // =========================================================================
  // LIMITLESS — 無下限呪術
  // =========================================================================
  limitless: {
    id: 'limitless',
    name: 'Limitless',
    jp: '無下限呪術',
    family: 'Inherited — Gojo Clan',
    color: '#7fd7ff', color2: '#1b6bff', aura: 'infinity',
    blurb: 'Bends the space between you and everything else. Convergence, divergence, and the imaginary mass that lives between them.',
    passive: {
      name: 'Infinity', jp: '無限',
      desc: 'An infinite series of space sits in front of you. Attacks decelerate forever and never arrive — while you can pay for it. Each negation burns cursed energy; a broken guard or a stagger drops it entirely.',
      meleeCost: 7, projectileCost: 4,
      onIncomingHit(ctx) {
        const { self, hit } = ctx;
        // Infinity cannot hold while your concentration is gone.
        if (self.state === 'stagger' || self.state === 'knockdown' || self.flags.burnout) return false;
        if (hit.pierceInfinity || hit.sureHit) return false;
        const cost = hit.projectile ? 4 : 7;
        if (self.ce < cost) return false;
        self.ce -= cost;
        self.infinityFlicker = 0.22;
        ctx.world.fx('infinity', { pos: hit.pos, angle: hit.angle, owner: self.id });
        ctx.world.audio('blocked', { volume: 0.5, pitch: 1.5 });
        return true; // fully negated
      },
      onUpdate(ctx) {
        // Passive reinforcement is cheaper because space does the work.
        ctx.self.mods.reinforce += 0.06;
      },
    },
    abilities: [
      {
        id: 'blue', name: 'Cursed Technique Lapse: Blue', jp: '術式順転「蒼」',
        desc: 'Multiply the limit by itself to force convergence — a sphere of negative space that drags everything toward its centre and crushes it.',
        archetype: 'projectile', cost: 26, cooldown: 3.2, castTime: 0.34, recovery: 0.28,
        tags: ['technique', 'space'],
        projectile: {
          speed: 15, radius: 1.45, life: 1.5, damage: 24, poise: 32, knock: -1,
          pull: 16, pullRadius: 5.2, pierce: 99, gravity: 0, vfx: 'orb_blue',
          color: '#39a9ff', glow: '#9fe4ff', trail: 0.7,
        },
        sfx: 'blue',
      },
      {
        id: 'red', name: 'Cursed Technique Reversal: Red', jp: '術式反転「赫」',
        desc: 'Reverse the output into positive energy. Divergence — pure repulsion delivered at the speed of a car crash.',
        archetype: 'projectile', cost: 38, cooldown: 5.5, castTime: 0.42, recovery: 0.38,
        tags: ['technique', 'space', 'reversed'],
        requires: { ceControl: 0.35 },
        projectile: {
          speed: 26, radius: 1.7, life: 1.1, damage: 44, poise: 70, knock: 20, lift: 4,
          pierce: 99, vfx: 'orb_red', color: '#ff3b2f', glow: '#ffcf6b', trail: 0.85,
          explode: { radius: 3.6, damage: 18, knock: 14 },
        },
        sfx: 'red',
      },
      {
        id: 'purple', name: 'Hollow Technique: Purple', jp: '虚式「茈」',
        desc: 'Collide convergence with divergence. What is left is imaginary mass — it does not push or pull, it simply deletes the space it passes through.',
        archetype: 'projectile', cost: 72, cooldown: 14, castTime: 0.95, recovery: 0.6,
        tags: ['technique', 'space', 'imaginary'], requires: { flow: 0.25 },
        ultimate: true,
        projectile: {
          speed: 20, radius: 2.4, life: 2.4, damage: 120, poise: 260, knock: 26,
          pierce: 999, sureHit: true, pierceInfinity: true, destroysProps: true,
          vfx: 'orb_purple', color: '#9a4cff', glow: '#ff6bd6', trail: 1,
          trench: true,
        },
        sfx: 'purple',
        onCast(ctx) {
          ctx.world.shake(14, 0.7);
          ctx.world.fx('charge_purple', { pos: ctx.origin, owner: ctx.self.id });
        },
      },
      {
        id: 'blueDash', name: 'Lapse Blue: Vault', jp: '順転「蒼」跳躍',
        desc: 'Fire a convergence point at your own feet and ride the collapse. Bends distance shut in a heartbeat.',
        archetype: 'dashStrike', cost: 18, cooldown: 2.4, castTime: 0.08, recovery: 0.18,
        distance: 8.5, iframes: 0.26, damage: 14, poise: 18, knock: 5,
        tags: ['technique', 'space', 'mobility'],
        sfx: 'blue',
      },
    ],
    domain: {
      id: 'unlimitedVoid', name: 'Unlimited Void', jp: '無量空処',
      desc: 'Infinite information — every possible perception, delivered at once and forever. The brain is handed too much to do and simply stops.',
      radius: 13, duration: 11, integrity: 260, cost: 92, drain: 6.5, castTime: 1.25,
      visual: 'void', color: '#8ad8ff', color2: '#2a2a66',
      sureHit: { type: 'overload', dps: 13, slow: 0.88, stunLock: true, ceDrain: 9 },
      refinement: 1.0,
      blurb: 'Sure-hit: perception overload. Targets inside are frozen by infinite information and bleed cursed energy.',
    },
  },

  // =========================================================================
  // TEN SHADOWS — 十種影法術
  // =========================================================================
  tenShadows: {
    id: 'tenShadows',
    name: 'Ten Shadows Technique',
    jp: '十種影法術',
    family: 'Inherited — Zenin Clan',
    color: '#8b7bd8', color2: '#221a3a', aura: 'shadow',
    blurb: 'Ten shikigami sleep in your shadow. Break one and it is gone forever — but its power passes to the survivors.',
    passive: {
      name: 'Shadow Reservoir', jp: '影溜まり',
      desc: 'Your shadow stores what you carry. Shikigami you have tamed regenerate over time, and standing still lets you sink into shadow to bleed off damage.',
      onUpdate(ctx) {
        const { self, dt } = ctx;
        self.shikigamiPool = Math.min(3, (self.shikigamiPool ?? 3) + dt * 0.12);
        if (self.state === 'block') ctx.self.mods.reinforce += 0.08;
      },
    },
    abilities: [
      {
        id: 'divineDogs', name: 'Divine Dogs: Totality', jp: '玉犬「渾」',
        desc: 'Black and white hunt as one animal. They chase independently and will not stop while you stand.',
        archetype: 'summon', cost: 24, cooldown: 8, castTime: 0.4, recovery: 0.25,
        summon: { kind: 'divineDog', count: 1, life: 26 },
        tags: ['technique', 'shikigami'], sfx: 'summon',
      },
      {
        id: 'nue', name: 'Nue', jp: '鵺',
        desc: 'A winged shikigami that carries lightning in its wings. Stuns on contact and lets you ride a short glide.',
        archetype: 'summon', cost: 20, cooldown: 7, castTime: 0.35, recovery: 0.25,
        summon: { kind: 'nue', count: 1, life: 22 },
        tags: ['technique', 'shikigami', 'lightning'], sfx: 'summon',
      },
      {
        id: 'maxElephant', name: 'Max Elephant', jp: '満象',
        desc: 'Volume that should not fit in this world. A flood of water with an elephant behind it.',
        archetype: 'aoe', cost: 42, cooldown: 11, castTime: 0.6, recovery: 0.5,
        radius: 6.2, damage: 40, poise: 90, knock: 16, forward: 4.5,
        tags: ['technique', 'shikigami', 'water'], vfx: 'water_burst', sfx: 'summon',
        onCast(ctx) { ctx.world.shake(10, 0.5); },
      },
      {
        id: 'mahoraga', name: 'Divine General Mahoraga', jp: '八握剣異戒神将魔虚羅',
        desc: 'The shikigami no one has tamed. It adapts to any phenomenon that touches it — including yours. Summoning it is a wager against your own life.',
        archetype: 'summon', cost: 90, cooldown: 60, castTime: 1.6, recovery: 0.9,
        summon: { kind: 'mahoraga', count: 1, life: 45, hostile: 'chaotic' },
        tags: ['technique', 'shikigami', 'forbidden'], ultimate: true,
        requires: { hpBelow: 0.45 },
        sfx: 'summon',
        onCast(ctx) {
          ctx.world.shake(20, 1.4);
          ctx.world.slowmo(0.3, 1.1);
          ctx.self.takeTrueDamage(14, 'the wager of an untamed shikigami');
          ctx.world.banner('魔虚羅', 'Divine General Mahoraga', '#c8b06a');
        },
      },
    ],
    domain: {
      id: 'chimeraShadowGarden', name: 'Chimera Shadow Garden', jp: '嵌合暗翳庭',
      desc: 'The shadow floods out and becomes the floor, the walls, the air. Inside it every shikigami is free and you can swim through the dark.',
      radius: 12, duration: 13, integrity: 220, cost: 88, drain: 5.5, castTime: 1.15,
      visual: 'shadowGarden', color: '#9f8fe8', color2: '#0b0713',
      sureHit: { type: 'shadowGrasp', dps: 9, slow: 0.55, snare: true },
      refinement: 0.85, incomplete: true,
      blurb: 'Incomplete domain — weaker binding, but shikigami cost nothing and you gain shadow-step mobility.',
      onTick(ctx) {
        if (ctx.owner.isPlayer && ctx.tickCount % 3 === 0) ctx.owner.ce += 2;
      },
    },
  },

  // =========================================================================
  // SHRINE — 伏魔御廚子 (Dismantle & Cleave)
  // =========================================================================
  shrine: {
    id: 'shrine',
    name: 'Shrine',
    jp: '御廚子',
    family: 'Cursed Womb — the King of Curses',
    color: '#ff4d4d', color2: '#2a0505', aura: 'ember',
    blurb: 'Two cuts. Dismantle divides whatever has no cursed energy. Cleave measures the target first and cuts to fit.',
    passive: {
      name: 'Malevolent Presence', jp: '悪意',
      desc: 'Fear is a weapon. Nearby enemies lose balance faster, and every hit you land converts more cursed energy than it should.',
      onUpdate(ctx) {
        ctx.self.mods.ceGain += 0.4;
        for (const f of ctx.world.fighters) {
          if (f.team === ctx.self.team || f.dead) continue;
          if (vdist(f.pos, ctx.self.pos) < 5) f.mods.poiseRegen -= 0.35;
        }
      },
    },
    abilities: [
      {
        id: 'dismantle', name: 'Dismantle', jp: '解',
        desc: 'A slash that divides anything without cursed energy in it. Fast, cheap, and it keeps coming.',
        archetype: 'beam', cost: 14, cooldown: 1.1, castTime: 0.16, recovery: 0.2,
        length: 11, width: 1.5, damage: 22, poise: 26, knock: 4, multi: 3, spread: 0.16,
        tags: ['technique', 'slash'], vfx: 'dismantle', color: '#ff6a5a', sfx: 'slash',
      },
      {
        id: 'cleave', name: 'Cleave', jp: '捌',
        desc: 'Adjust the cut to the target\'s toughness and cursed energy, then deliver exactly enough. Ignores reinforcement.',
        archetype: 'beam', cost: 30, cooldown: 4.5, castTime: 0.3, recovery: 0.32,
        length: 9, width: 2.4, damage: 34, poise: 60, knock: 9,
        ignoreReinforce: true, tags: ['technique', 'slash', 'adaptive'],
        vfx: 'cleave', color: '#ff2d55', sfx: 'slash',
        onHit(ctx) {
          // Cleave is measured against the target: tougher enemies take more.
          const extra = (ctx.victim.maxHp / 100) * 8;
          ctx.victim.takeTrueDamage(extra, 'Cleave');
        },
      },
      {
        id: 'fireArrow', name: 'Open: Fire Arrow', jp: '開«フーガ»',
        desc: 'The furnace of the shrine, released in a line. Everything it passes through keeps burning.',
        archetype: 'projectile', cost: 46, cooldown: 9, castTime: 0.7, recovery: 0.55,
        tags: ['technique', 'fire'], requires: { flow: 0.2 },
        projectile: {
          speed: 24, radius: 2.0, life: 1.6, damage: 62, poise: 120, knock: 16,
          pierce: 999, vfx: 'fire_arrow', color: '#ff7a1a', glow: '#ffe08a', trail: 1,
          burn: { dps: 9, time: 5 }, destroysProps: true, trench: true,
        },
        sfx: 'fire',
        onCast(ctx) { ctx.world.shake(12, 0.6); },
      },
      {
        id: 'worldCutting', name: 'World-Cutting Slash', jp: '世界を断つ斬撃',
        desc: 'Dismantle, but aimed at the world rather than the target. The cut keeps going after the arm has stopped.',
        archetype: 'beam', cost: 70, cooldown: 18, castTime: 0.75, recovery: 0.7,
        length: 30, width: 3.4, damage: 95, poise: 200, knock: 20, ultimate: true,
        sureHit: false, pierceInfinity: true, ignoreReinforce: true,
        tags: ['technique', 'slash', 'space'], vfx: 'worldcut', color: '#ff3131', sfx: 'slash',
        onCast(ctx) { ctx.world.shake(18, 1.0); ctx.world.slowmo(0.35, 0.6); },
      },
    ],
    domain: {
      id: 'malevolentShrine', name: 'Malevolent Shrine', jp: '伏魔御廚子',
      desc: 'A shrine of skulls with no walls. The barrier was traded away by binding vow — the sure-hit reaches everything within 140 metres instead.',
      radius: 17, duration: 10, integrity: 150, cost: 95, drain: 8, castTime: 1.35,
      visual: 'shrine', color: '#ff3b30', color2: '#140202', open: true,
      sureHit: { type: 'dismantleStorm', dps: 34, slow: 0.12, selfDamage: 0.15 },
      refinement: 1.15,
      blurb: 'Open barrier: no walls to hide behind, enormous radius, and the storm cuts allies too. You are not immune to your own shrine.',
    },
  },

  // =========================================================================
  // IDLE TRANSFIGURATION — 無為転変
  // =========================================================================
  idleTransfiguration: {
    id: 'idleTransfiguration',
    name: 'Idle Transfiguration',
    jp: '無為転変',
    family: 'Cursed Spirit — Disaster Curse',
    color: '#7fd4a8', color2: '#1a2b22', aura: 'patchwork',
    blurb: 'Touch the soul and reshape the body to match. Cursed energy reinforcement is irrelevant — you are not hitting the body.',
    passive: {
      name: 'Soul Perception', jp: '魂の形',
      desc: 'You see the shape of the soul. Your unarmed hits bypass a portion of reinforcement and inflict soul wounds that reverse cursed technique cannot easily mend.',
      onOutgoingHit(ctx) {
        ctx.hit.ignoreReinforce = Math.max(ctx.hit.ignoreReinforce || 0, 0.45);
        if (ctx.world.rng.chance(0.25)) ctx.world.addStatus(ctx.victim, { type: 'soulWound', time: 9, power: 0.14 });
      },
    },
    abilities: [
      {
        id: 'soulTouch', name: 'Transfigure: Touch', jp: '無為転変・接触',
        desc: 'A palm to the soul. The body follows whatever shape you decide on — usually a worse one.',
        archetype: 'melee', cost: 16, cooldown: 1.6, castTime: 0.18, recovery: 0.3,
        range: 2.1, halfArc: 0.8, damage: 26, poise: 20, knock: 2,
        ignoreReinforce: 1.0, status: { type: 'soulWound', time: 12, power: 0.3 },
        tags: ['technique', 'soul'], vfx: 'soul_touch', sfx: 'cast',
      },
      {
        id: 'bodyRepel', name: 'Body Repel', jp: '自閉円頓裹',
        desc: 'Reshape yourself instead. Shed wounds by detaching the damaged flesh — cheap healing with a real cost.',
        archetype: 'buff', cost: 30, cooldown: 12, castTime: 0.45, recovery: 0.4,
        tags: ['technique', 'soul', 'heal'],
        onCast(ctx) {
          const heal = ctx.self.maxHp * 0.22;
          ctx.self.hp = Math.min(ctx.self.maxHp, ctx.self.hp + heal);
          ctx.self.maxHp *= 0.94; // the discarded flesh is gone for good
          ctx.world.addStatus(ctx.self, { type: 'slow', time: 1.6, power: 0.3 });
          ctx.world.fx('body_repel', { pos: ctx.origin, owner: ctx.self.id });
          ctx.world.damageNumber(ctx.self.pos, '+' + Math.round(heal), '#7fd4a8');
        },
      },
      {
        id: 'transfigured', name: 'Transfigured Humans', jp: '改造人間',
        desc: 'Reshape the bystanders. They are not strong, but they do not stop and they do not think.',
        archetype: 'summon', cost: 34, cooldown: 14, castTime: 0.6, recovery: 0.5,
        summon: { kind: 'transfigured', count: 3, life: 30 },
        tags: ['technique', 'soul'], sfx: 'summon',
      },
      {
        id: 'polymorphicSoul', name: 'Polymorphic Soul Isomer', jp: '多重魂',
        desc: 'Fuse several souls into one body and let it loose. A one-shot monster that swings like a landslide.',
        archetype: 'summon', cost: 66, cooldown: 26, castTime: 0.9, recovery: 0.7,
        summon: { kind: 'isomer', count: 1, life: 34 }, ultimate: true,
        tags: ['technique', 'soul'], sfx: 'summon',
        onCast(ctx) { ctx.world.shake(12, 0.7); },
      },
    ],
    domain: {
      id: 'selfEmbodiment', name: 'Self-Embodiment of Perfection', jp: '自閉円頓裹',
      desc: 'Your own soul, turned inside out and made into a room. Everything that enters is touched directly.',
      radius: 11.5, duration: 12, integrity: 200, cost: 90, drain: 6, castTime: 1.2,
      visual: 'soulPalace', color: '#8ef0bd', color2: '#101c17',
      sureHit: { type: 'soulStrike', dps: 16, ignoreReinforce: true, transfigure: true },
      refinement: 0.95,
      blurb: 'Sure-hit: direct soul contact. Reinforcement does nothing, and long exposure transfigures the victim outright.',
    },
  },

  // =========================================================================
  // DISASTER FLAMES — 灰燼爆(Jogo)
  // =========================================================================
  disasterFlames: {
    id: 'disasterFlames',
    name: 'Disaster Flames',
    jp: '灰燼爆',
    family: 'Cursed Spirit — Disaster Curse',
    color: '#ff8a1e', color2: '#2b1100', aura: 'ember',
    blurb: 'The fear of the earth burning. Output measured in tens of thousands of degrees, with no interest in precision.',
    passive: {
      name: 'Volcanic Body', jp: '火山の躰',
      desc: 'Fire cannot hurt you and the ground you stand on cooks. Enemies in melee range take steady burn damage.',
      onUpdate(ctx) {
        ctx.self.resist.fire = 1;
        ctx.self.heatAura = 1;
        for (const f of ctx.world.fighters) {
          if (f.team === ctx.self.team || f.dead) continue;
          if (vdist(f.pos, ctx.self.pos) < 2.6) f.takeTrueDamage(6 * ctx.dt, 'volcanic heat');
        }
      },
    },
    abilities: [
      {
        id: 'emberInsects', name: 'Ember Insects', jp: '灰の蟲',
        desc: 'A swarm of burning insects that seek out whatever is moving and detonate on contact.',
        archetype: 'projectile', cost: 22, cooldown: 3.4, castTime: 0.3, recovery: 0.3,
        tags: ['technique', 'fire'],
        projectile: {
          speed: 11, radius: 0.5, life: 3.4, damage: 9, poise: 8, knock: 2,
          count: 7, spread: 0.55, homing: 3.0, vfx: 'ember', color: '#ffb03a',
          glow: '#ffe3a0', burn: { dps: 5, time: 4 }, explode: { radius: 1.6, damage: 6 },
        },
        sfx: 'fire',
      },
      {
        id: 'disasterPlumes', name: 'Disaster Plumes', jp: '禍々しき噴煙',
        desc: 'Erupt the ground beneath the target. Molten rock, then the pressure wave.',
        archetype: 'zone', cost: 30, cooldown: 6, castTime: 0.5, recovery: 0.4,
        radius: 3.6, duration: 4.5, dps: 16, poise: 12, atTarget: true, lift: 5,
        tags: ['technique', 'fire'], vfx: 'volcano', sfx: 'fire',
      },
      {
        id: 'maximumMeteor', name: 'Maximum: Meteor', jp: '極ノ番「隕」',
        desc: 'Compress every drop of output into one falling mass. The impact is not a technique any more — it is just physics.',
        archetype: 'projectile', cost: 78, cooldown: 22, castTime: 1.3, recovery: 0.9,
        tags: ['technique', 'fire', 'impact'], ultimate: true,
        projectile: {
          speed: 17, radius: 3.4, life: 3.2, damage: 105, poise: 240, knock: 24, lift: 6,
          pierce: 999, fromSky: true, vfx: 'meteor', color: '#ff5e00', glow: '#fff0b0',
          burn: { dps: 14, time: 8 }, explode: { radius: 7.5, damage: 46, knock: 20 },
          destroysProps: true,
        },
        sfx: 'fire',
        onCast(ctx) { ctx.world.shake(22, 1.6); ctx.world.banner('極ノ番', 'Maximum: Meteor', '#ff7a1a'); },
      },
      {
        id: 'pyroclastic', name: 'Pyroclastic Rush', jp: '火砕流',
        desc: 'Ride a wall of superheated ash forward. Leaves a burning trail and blinds anything caught in it.',
        archetype: 'dashStrike', cost: 24, cooldown: 5, castTime: 0.15, recovery: 0.3,
        distance: 9, iframes: 0.14, damage: 20, poise: 26, knock: 6,
        trail: { type: 'fire', dps: 10, duration: 3.5, radius: 1.6 },
        status: { type: 'blindAsh', time: 3, power: 0.5 },
        tags: ['technique', 'fire'], sfx: 'fire',
      },
    ],
    domain: {
      id: 'coffinOfTheIronMountain', name: 'Coffin of the Iron Mountain', jp: '蓋棺鉄囲山',
      desc: 'The inside of a volcano, sealed. There is no cool air left in the barrier.',
      radius: 12.5, duration: 11, integrity: 210, cost: 90, drain: 6, castTime: 1.2,
      visual: 'volcano', color: '#ff7a1a', color2: '#2a0d00',
      sureHit: { type: 'incinerate', dps: 22, burn: true, blind: 0.4 },
      refinement: 0.9,
      blurb: 'Sure-hit: continuous incineration. Ash blinds, and the heat climbs the longer you stay.',
    },
  },

  // =========================================================================
  // BLOOD MANIPULATION — 赤血操術
  // =========================================================================
  bloodManipulation: {
    id: 'bloodManipulation',
    name: 'Blood Manipulation',
    jp: '赤血操術',
    family: 'Cursed Womb — Death Painting',
    color: '#e0344f', color2: '#26060c', aura: 'blood',
    blurb: 'Your blood is ammunition, armour and a scalpel. Every technique here is paid for in the literal sense.',
    passive: {
      name: 'Blood Meter', jp: '血液量',
      desc: 'Techniques cost health as well as cursed energy, but landing hits returns blood to you. Low health sharpens everything — Convergence follows desperation.',
      onUpdate(ctx) {
        const low = 1 - ctx.self.hp / ctx.self.maxHp;
        ctx.self.mods.output += low * 0.3;
        ctx.self.mods.speed += low * 0.12;
      },
      onOutgoingHit(ctx) {
        ctx.self.hp = Math.min(ctx.self.maxHp, ctx.self.hp + ctx.hit.damage * 0.06);
      },
    },
    abilities: [
      {
        id: 'piercingBlood', name: 'Piercing Blood', jp: '穿血',
        desc: 'Pressurise blood past the point where it behaves like liquid. It cuts like a water jet with intent behind it.',
        archetype: 'beam', cost: 18, hpCost: 6, cooldown: 2.6, castTime: 0.28, recovery: 0.3,
        length: 16, width: 0.9, damage: 30, poise: 30, knock: 6, pierceInfinity: false,
        tags: ['technique', 'blood', 'pierce'], vfx: 'blood_beam', color: '#ff2d4f', sfx: 'slash',
        status: { type: 'bleed', time: 6, power: 4 },
      },
      {
        id: 'bloodEdge', name: 'Blood Edge', jp: '血刃',
        desc: 'Congeal a crescent and throw it. Curves back toward you on the return pass.',
        archetype: 'projectile', cost: 14, hpCost: 3, cooldown: 1.8, castTime: 0.2, recovery: 0.22,
        tags: ['technique', 'blood'],
        projectile: {
          speed: 19, radius: 0.9, life: 1.5, damage: 18, poise: 18, knock: 4,
          pierce: 3, boomerang: true, vfx: 'blood_edge', color: '#c8102e', glow: '#ff6b7a',
          status: { type: 'bleed', time: 5, power: 3 },
        },
        sfx: 'slash',
      },
      {
        id: 'flowingRedScale', name: 'Flowing Red Scale', jp: '流麗',
        desc: 'Raise your own blood pressure and density. Everything gets faster, harder and more expensive.',
        archetype: 'buff', cost: 26, hpCost: 10, cooldown: 16, castTime: 0.35, recovery: 0.3,
        buff: { time: 14, output: 0.32, speed: 0.2, reinforce: 0.14, ceGain: 0.3 },
        tags: ['technique', 'blood', 'buff'], vfx: 'red_scale', sfx: 'cast',
      },
      {
        id: 'supernova', name: 'Supernova', jp: '超新星',
        desc: 'Every drop you can spare, compressed to a point and released. Wide, unavoidable, and it will nearly kill you to throw.',
        archetype: 'projectile', cost: 60, hpCost: 26, cooldown: 24, castTime: 1.0, recovery: 0.8,
        tags: ['technique', 'blood'], ultimate: true,
        projectile: {
          speed: 13, radius: 3.0, life: 2.6, damage: 90, poise: 190, knock: 20,
          pierce: 999, vfx: 'supernova', color: '#ff1744', glow: '#ffd0d8',
          explode: { radius: 6.5, damage: 40, knock: 18 }, destroysProps: true,
        },
        sfx: 'red',
        onCast(ctx) { ctx.world.shake(16, 0.9); },
      },
    ],
    domain: {
      id: 'seaOfBlood', name: 'Flowing Red Sea', jp: '流血の海',
      desc: 'The barrier fills with your blood and every drop of it is still yours to command.',
      radius: 11, duration: 10, integrity: 190, cost: 88, drain: 6, castTime: 1.15,
      visual: 'bloodSea', color: '#ff2d4f', color2: '#1a0308',
      sureHit: { type: 'exsanguinate', dps: 18, bleed: true, healOwner: 6 },
      refinement: 0.9,
      blurb: 'Sure-hit: exsanguination. The blood you drain is returned to you as health.',
    },
  },

  // =========================================================================
  // HEAVENLY RESTRICTION — 天与呪縛
  // =========================================================================
  heavenlyRestriction: {
    id: 'heavenlyRestriction',
    name: 'Heavenly Restriction',
    jp: '天与呪縛',
    family: 'Innate Binding Vow',
    color: '#dfe3ea', color2: '#15171c', aura: 'none',
    blurb: 'Born with zero cursed energy. In exchange the body was given everything else — and no sorcerer can sense you coming.',
    noCursedEnergy: true,
    passive: {
      name: 'Absolute Body', jp: '身体能力の極致',
      desc: 'No cursed energy means no reinforcement and no Infinity to hide behind — but your physical ceiling is inhuman, cursed tools obey you completely, and your presence is invisible to cursed energy sense. Techniques cannot be sealed from you because you have none.',
      onUpdate(ctx) {
        ctx.self.mods.speed += 0.26;
        ctx.self.mods.output += 0.42;
        ctx.self.mods.poiseRegen += 0.5;
        ctx.self.mods.flashBand += 0.06;
        ctx.self.flags.pierceInfinity = true;
        ctx.self.flags.stealth = true;
      },
      onIncomingHit(ctx) {
        // No reinforcement at all — this fighter lives on spacing and parries.
        ctx.hit.reinforceMul = 0;
        return false;
      },
    },
    abilities: [
      {
        id: 'toolSwap', name: 'Cursed Tool: Draw', jp: '呪具展開',
        desc: 'Pull a different weapon out of the Inventory Curse. Each tool changes your entire moveset weight.',
        archetype: 'custom', cost: 0, cooldown: 0.6, castTime: 0.18, recovery: 0.12,
        tags: ['physical', 'tool'],
        onCast(ctx) { ctx.world.cycleTool(ctx.self); },
      },
      {
        id: 'invertedSpear', name: 'Inverted Spear of Heaven', jp: '天逆鉾',
        desc: 'A thrust with the spear that nullifies any cursed technique it touches — including the ones already in flight, and the ones holding a domain open.',
        archetype: 'melee', cost: 0, cooldown: 6, castTime: 0.22, recovery: 0.36,
        range: 3.1, halfArc: 0.45, damage: 30, poise: 44, knock: 8,
        pierceInfinity: true, nullifyTechnique: true,
        tags: ['physical', 'tool', 'nullify'], vfx: 'spear_thrust', sfx: 'slash',
        onHit(ctx) {
          ctx.world.addStatus(ctx.victim, { type: 'techniqueSealed', time: 5 });
          ctx.world.nullifyNearbyTechniques(ctx.victim.pos, 4);
          ctx.world.fx('nullify', { pos: ctx.victim.pos });
        },
      },
      {
        id: 'splitSoul', name: 'Split Soul Katana', jp: '分裂魂の刀',
        desc: 'A blade that cuts the soul instead of the body. Reinforcement is irrelevant; transfigured things come apart entirely.',
        archetype: 'melee', cost: 0, cooldown: 4, castTime: 0.2, recovery: 0.3,
        range: 2.5, halfArc: 0.7, damage: 26, poise: 30, knock: 5,
        ignoreReinforce: 1.0, tags: ['physical', 'tool', 'soul'],
        vfx: 'soul_cut', sfx: 'slash',
        onHit(ctx) {
          if (ctx.victim.kind === 'transfigured' || ctx.victim.kind === 'isomer') {
            ctx.victim.takeTrueDamage(ctx.victim.maxHp * 0.45, 'Split Soul Katana');
          }
          ctx.world.addStatus(ctx.victim, { type: 'soulWound', time: 8, power: 0.2 });
        },
      },
      {
        id: 'assassinRush', name: 'Zero Presence Rush', jp: '無気配',
        desc: 'Cover ground with no cursed energy to telegraph it. Nobody senses you until the impact.',
        archetype: 'dashStrike', cost: 0, cooldown: 5, castTime: 0.06, recovery: 0.2,
        distance: 11, iframes: 0.3, damage: 28, poise: 40, knock: 9,
        backstab: 2.0, tags: ['physical', 'mobility'], sfx: 'dash',
      },
    ],
    domain: null,
    ultimateDefense: 'fallingBlossom',
    blurbNoDomain: 'Cannot expand a domain — there is no cursed energy to build a barrier from. Compensates with mastered Simple Domain and Falling Blossom Emotion.',
  },

  // =========================================================================
  // CURSED SPEECH — 呪言師
  // =========================================================================
  cursedSpeech: {
    id: 'cursedSpeech',
    name: 'Cursed Speech',
    jp: '呪言',
    family: 'Inherited — Inumaki Clan',
    color: '#e8e0c8', color2: '#2a2418', aura: 'word',
    blurb: 'Words carrying cursed energy force reality to obey. The stronger the order, the more it costs your throat to give it.',
    passive: {
      name: 'Throat Burden', jp: '喉の負荷',
      desc: 'Every command damages your own throat. Throat strain reduces the power of the next word and, at maximum, silences you entirely until it heals. Reverse cursed technique clears it.',
      onUpdate(ctx) {
        const s = ctx.self;
        s.throat = Math.max(0, (s.throat ?? 0) - ctx.dt * 5.5);
        if (s.throat > 70) {
          s.mods.output -= 0.25;
          if (s.throat > 95) ctx.world.addStatus(s, { type: 'silenced', time: 0.2 });
        }
      },
    },
    abilities: [
      {
        id: 'dontMove', name: '"Don\'t Move"', jp: '「動くな」',
        desc: 'The body simply refuses the next instruction it is given. A short, absolute freeze.',
        archetype: 'command', cost: 12, throat: 14, cooldown: 4, castTime: 0.18, recovery: 0.25,
        range: 12, halfArc: 0.55, status: { type: 'stun', time: 1.5 }, damage: 4,
        tags: ['technique', 'command', 'sound'], vfx: 'word_dontmove', sfx: 'cast',
      },
      {
        id: 'blastAway', name: '"Blast Away"', jp: '「爆ぜろ」',
        desc: 'Everything in front of you is thrown backwards hard enough to break the wall it lands on.',
        archetype: 'command', cost: 20, throat: 22, cooldown: 5, castTime: 0.2, recovery: 0.3,
        range: 11, halfArc: 0.8, status: null, damage: 26, poise: 60, knock: 22, lift: 4,
        tags: ['technique', 'command', 'sound'], vfx: 'word_blast', sfx: 'red',
      },
      {
        id: 'crush', name: '"Crush"', jp: '「潰れろ」',
        desc: 'A flat order to collapse. Heavy damage, heavy throat cost, and it ignores reinforcement because the body obeys before it can brace.',
        archetype: 'command', cost: 34, throat: 40, cooldown: 9, castTime: 0.3, recovery: 0.45,
        range: 10, halfArc: 0.6, damage: 52, poise: 90, knock: 6,
        ignoreReinforce: 0.7, tags: ['technique', 'command', 'sound'],
        vfx: 'word_crush', sfx: 'hitHeavy',
      },
      {
        id: 'explode', name: '"Explode"', jp: '「破裂しろ」',
        desc: 'The most expensive word you own. It will tear your throat open — and whatever heard it will not be standing.',
        archetype: 'command', cost: 52, throat: 85, cooldown: 20, castTime: 0.45, recovery: 0.8,
        range: 13, halfArc: 0.9, damage: 96, poise: 220, knock: 16, ultimate: true,
        ignoreReinforce: 0.9, tags: ['technique', 'command', 'sound'],
        vfx: 'word_explode', sfx: 'purple',
        onCast(ctx) {
          ctx.self.takeTrueDamage(18, 'a ruptured throat');
          ctx.world.shake(16, 0.9);
        },
      },
    ],
    domain: {
      id: 'silentGrave', name: 'Domain: Cradle of Quiet Words', jp: '静語の揺籃',
      desc: 'Inside the barrier every word you speak is heard by the body directly, with nothing in between to refuse it.',
      radius: 11, duration: 10, integrity: 180, cost: 86, drain: 5.5, castTime: 1.1,
      visual: 'words', color: '#f0e6c8', color2: '#1a1710',
      sureHit: { type: 'compel', dps: 11, stunPulse: 2.4, throatFree: true },
      refinement: 0.88,
      blurb: 'Sure-hit: compulsion. Commands cost no throat inside, and the barrier pulses a stun every few seconds.',
    },
  },

  // =========================================================================
  // RATIO TECHNIQUE — 十劃呪法
  // =========================================================================
  ratio: {
    id: 'ratio',
    name: 'Ratio Technique',
    jp: '十劃呪法',
    family: 'Grade 1 Sorcerer — salaryman discipline',
    color: '#d8c98a', color2: '#1e1c14', aura: 'line',
    blurb: 'Draw a 7:3 line across anything and the point where they meet becomes a weak point. No flair, no waste, clock out at six.',
    passive: {
      name: 'Overtime Clause', jp: '時間外労働',
      desc: 'Efficiency over spectacle: your cursed energy costs are the lowest of any technique, and every weak point you hit refunds energy. After 90 seconds of fighting, Overtime begins — everything gets stronger and you get angrier.',
      onUpdate(ctx) {
        ctx.self.mods.costMul -= 0.25;
        if (ctx.world.matchTime > 90 && !ctx.self.flags.overtime) {
          ctx.self.flags.overtime = true;
          ctx.world.banner('時間外労働', 'Overtime', '#d8c98a');
        }
        if (ctx.self.flags.overtime) {
          ctx.self.mods.output += 0.35;
          ctx.self.mods.speed += 0.1;
        }
      },
    },
    abilities: [
      {
        id: 'ratioMark', name: 'Ratio: Mark', jp: '十劃',
        desc: 'Divide the target 7:3 and hold the line there. Anything striking that point lands a guaranteed critical.',
        archetype: 'command', cost: 8, cooldown: 2.5, castTime: 0.2, recovery: 0.2,
        range: 9, halfArc: 0.5, damage: 6,
        status: { type: 'weakPoint', time: 12, power: 1 },
        tags: ['technique', 'mark'], vfx: 'ratio_line', sfx: 'cast',
      },
      {
        id: 'collapse', name: 'Collapse', jp: '崩・十劃',
        desc: 'Strike the marked point with a blunt cleaver. Against a marked target this is not a hit, it is a demolition.',
        archetype: 'melee', cost: 14, cooldown: 3, castTime: 0.24, recovery: 0.34,
        range: 2.6, halfArc: 0.8, damage: 22, poise: 40, knock: 8,
        tags: ['technique', 'physical'], vfx: 'slash_heavy', sfx: 'swingHeavy',
        onHit(ctx) {
          if (ctx.victim.hasStatus('weakPoint')) {
            ctx.victim.takeTrueDamage(34, 'Ratio: Collapse');
            ctx.world.fx('crit', { pos: ctx.victim.pos });
            ctx.world.hitstopFor(0.16);
          }
        },
      },
      {
        id: 'sevenThree', name: 'Seven-Three Barrage', jp: '七対三の連撃',
        desc: 'Seven measured cuts, three heavy ones. Machine-precise, never wasteful.',
        archetype: 'melee', cost: 22, cooldown: 6, castTime: 0.3, recovery: 0.5,
        range: 2.8, halfArc: 1.1, damage: 11, poise: 14, knock: 2, multi: 10, multiDelay: 0.07,
        tags: ['technique', 'physical'], vfx: 'slash_rush', sfx: 'slash',
      },
      {
        id: 'overtimeFinish', name: 'Overtime: Full Clock', jp: '時間外・全力',
        desc: 'You are past six. Everything you have, in one swing, and no more talk about work-life balance.',
        archetype: 'melee', cost: 48, cooldown: 18, castTime: 0.5, recovery: 0.6,
        range: 3.4, halfArc: 1.3, damage: 68, poise: 150, knock: 16, lift: 4, ultimate: true,
        guardBreak: true, tags: ['technique', 'physical'], vfx: 'slash_smash', sfx: 'hitHeavy',
        onHit(ctx) {
          if (ctx.self.flags.overtime) ctx.victim.takeTrueDamage(30, 'Overtime');
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain — but no sorcerer converts cursed energy into results this efficiently.',
  },

  // =========================================================================
  // BOOGIE WOOGIE — ブギウギ
  // =========================================================================
  boogieWoogie: {
    id: 'boogieWoogie',
    name: 'Boogie Woogie',
    jp: 'ブギウギ',
    family: 'Grade 1 Sorcerer — Kyoto',
    color: '#ffb3d1', color2: '#2a1220', aura: 'clap',
    blurb: 'A clap swaps the positions of anything carrying cursed energy. Simple, stupid, and impossible to read.',
    passive: {
      name: 'Rhythm', jp: 'リズム',
      desc: 'Swapping builds rhythm. Each swap within a short window increases your output and swing speed; drop the beat and you lose the stack.',
      onUpdate(ctx) {
        const s = ctx.self;
        s.rhythm = Math.max(0, (s.rhythm ?? 0) - ctx.dt * 0.4);
        s.mods.output += Math.min(0.6, s.rhythm * 0.12);
        s.mods.speed += Math.min(0.25, s.rhythm * 0.05);
      },
    },
    abilities: [
      {
        id: 'clapSwap', name: 'Clap: Swap', jp: '手を叩く',
        desc: 'Trade places with whatever you are looking at. Instant, unblockable, and it does not care about Infinity — it moves you, not them.',
        archetype: 'custom', cost: 10, cooldown: 1.4, castTime: 0.12, recovery: 0.14,
        range: 15, tags: ['technique', 'space', 'mobility'], sfx: 'ui',
        onCast(ctx) {
          const t = ctx.world.nearestInCone(ctx.self, ctx.aim, 15, 0.7);
          if (!t) return false;
          ctx.world.swapPositions(ctx.self, t);
          ctx.self.rhythm = Math.min(5, (ctx.self.rhythm ?? 0) + 1);
          ctx.world.fx('clap', { pos: ctx.origin });
          ctx.world.fx('clap', { pos: t.pos });
          return true;
        },
      },
      {
        id: 'swapDecoy', name: 'Clap: Decoy', jp: '影武者',
        desc: 'Leave a cursed-energy double where you were standing. Attacks that hit it are wasted and you appear behind them.',
        archetype: 'custom', cost: 22, cooldown: 7, castTime: 0.16, recovery: 0.2,
        tags: ['technique', 'space'], sfx: 'cast',
        onCast(ctx) {
          ctx.world.spawnDecoy(ctx.self, 4.5);
          ctx.world.blink(ctx.self, ctx.aim + PI, 5);
        },
      },
      {
        id: 'blackFlashCombo', name: 'Boogie Rush', jp: 'ブギウギ乱舞',
        desc: 'Swap in, strike, swap out, strike again. The rhythm is the technique — the damage is just where it lands.',
        archetype: 'melee', cost: 26, cooldown: 8, castTime: 0.2, recovery: 0.4,
        range: 2.6, halfArc: 1.2, damage: 13, poise: 18, knock: 3, multi: 5, multiDelay: 0.1,
        tags: ['technique', 'physical'], vfx: 'slash_rush', sfx: 'slash',
        onHit(ctx) { ctx.self.flashWindow.band *= 1.12; },
      },
      {
        id: 'brotherhood', name: 'My Best Friend', jp: '親友',
        desc: 'Declare a bond mid-fight. You and your ally swap freely, share damage, and both hit like it matters.',
        archetype: 'buff', cost: 40, cooldown: 30, castTime: 0.5, recovery: 0.4,
        buff: { time: 18, output: 0.4, reinforce: 0.2, speed: 0.15 }, ultimate: true,
        tags: ['technique', 'buff'], sfx: 'vow',
        onCast(ctx) {
          ctx.world.banner('親友', 'Brotherhood', '#ffb3d1');
          for (const f of ctx.world.fighters) {
            if (f.team === ctx.self.team && f !== ctx.self && !f.dead) {
              ctx.world.addStatus(f, { type: 'buff', time: 18, output: 0.4, reinforce: 0.2 });
            }
          }
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain. Does not need one — nobody can hit what keeps changing address.',
  },

  // =========================================================================
  // STRAW DOLL — 芻霊呪法
  // =========================================================================
  strawDoll: {
    id: 'strawDoll',
    name: 'Straw Doll Technique',
    jp: '芻霊呪法',
    family: 'Inherited — Kugisaki',
    color: '#ff9f6b', color2: '#2a1810', aura: 'nail',
    blurb: 'Nails, a hammer, and a doll. Put a piece of the target in the doll and distance stops mattering.',
    passive: {
      name: 'Resonance Link', jp: '共鳴り',
      desc: 'Hits you land plant a fragment in the target. Fragments stack; Resonance converts them all into damage at any range, and Black Flash doubles the stack it plants.',
      onOutgoingHit(ctx) {
        const n = ctx.hit.blackFlash ? 2 : 1;
        ctx.world.addStatus(ctx.victim, { type: 'fragment', time: 20, power: n, stack: true, max: 8 });
      },
    },
    abilities: [
      {
        id: 'hairpin', name: 'Hairpin', jp: '簪',
        desc: 'Nails driven into cursed energy detonate the moment they land. Good against anything that expands.',
        archetype: 'projectile', cost: 16, cooldown: 2.2, castTime: 0.2, recovery: 0.24,
        tags: ['technique', 'explosive'],
        projectile: {
          speed: 22, radius: 0.4, life: 1.6, damage: 12, poise: 14, knock: 3,
          count: 3, spread: 0.18, vfx: 'nail', color: '#ffb27a', glow: '#ffe0c0',
          explode: { radius: 2.4, damage: 14, knock: 6 },
        },
        sfx: 'slash',
      },
      {
        id: 'nailBarrage', name: 'Nail Barrage', jp: '釘連射',
        desc: 'A wall of nails. Not subtle, but it covers ground and it keeps the pressure on.',
        archetype: 'projectile', cost: 22, cooldown: 4, castTime: 0.3, recovery: 0.35,
        tags: ['technique'],
        projectile: {
          speed: 26, radius: 0.3, life: 1.3, damage: 8, poise: 8, knock: 1.5,
          count: 9, spread: 0.42, vfx: 'nail', color: '#ffb27a', glow: '#ffe0c0',
        },
        sfx: 'slash',
      },
      {
        id: 'resonance', name: 'Resonance', jp: '共鳴り',
        desc: 'Strike the doll and every fragment you planted answers at once. Range is irrelevant; reinforcement is not.',
        archetype: 'custom', cost: 30, cooldown: 8, castTime: 0.5, recovery: 0.5,
        tags: ['technique', 'ranged'], vfx: 'resonance', sfx: 'hitHeavy',
        onCast(ctx) {
          let hit = 0;
          for (const f of ctx.world.fighters) {
            if (f.team === ctx.self.team || f.dead) continue;
            const frag = f.getStatus('fragment');
            if (!frag) continue;
            const dmg = 12 + frag.power * 11;
            ctx.world.dealDamage(ctx.self, f, {
              damage: dmg, poise: 26, tags: ['technique', 'resonance'],
              ignoreReinforce: 0.4, knock: 0, sureHit: true,
            });
            f.removeStatus('fragment');
            ctx.world.fx('resonance_hit', { pos: f.pos });
            hit++;
          }
          if (hit) ctx.world.hitstopFor(0.12);
          return hit > 0;
        },
      },
      {
        id: 'hammerSmash', name: 'Straw Doll: Full Strike', jp: '芻霊・全力',
        desc: 'Drive the nail all the way in. If the fragment count is high this ends the conversation.',
        archetype: 'melee', cost: 44, cooldown: 16, castTime: 0.42, recovery: 0.6,
        range: 2.4, halfArc: 0.9, damage: 38, poise: 100, knock: 12, ultimate: true,
        tags: ['technique', 'physical'], vfx: 'slash_smash', sfx: 'hitHeavy',
        onHit(ctx) {
          const frag = ctx.victim.getStatus('fragment');
          if (frag) {
            ctx.victim.takeTrueDamage(frag.power * 16, 'Resonance overload');
            ctx.victim.removeStatus('fragment');
          }
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain yet — but Resonance ignores every wall a domain could put between you.',
  },

  // =========================================================================
  // PROJECTION SORCERY — 投射呪法
  // =========================================================================
  projectionSorcery: {
    id: 'projectionSorcery',
    name: 'Projection Sorcery',
    jp: '投射呪法',
    family: 'Inherited — Zenin Clan',
    color: '#9fe870', color2: '#16220f', aura: 'frames',
    blurb: 'Divide one second into twenty-four frames, draw your movement into each, and the world is obliged to play it back.',
    passive: {
      name: '24 Frames', jp: '24分割',
      desc: 'Anything you touch that fails to keep pace with your framerate is frozen for exactly one second. Mistime your own movement and you freeze instead.',
      onOutgoingHit(ctx) {
        if (ctx.world.rng.chance(0.3)) ctx.world.addStatus(ctx.victim, { type: 'frozen', time: 1.0 });
      },
      onUpdate(ctx) { ctx.self.mods.speed += 0.18; },
    },
    abilities: [
      {
        id: 'frameRush', name: 'Frame Rush', jp: 'コマ送り',
        desc: 'Draw twenty-four frames of forward motion. You arrive before the animation of you leaving has finished.',
        archetype: 'dashStrike', cost: 18, cooldown: 2.2, castTime: 0.05, recovery: 0.16,
        distance: 12, iframes: 0.28, damage: 22, poise: 26, knock: 5,
        status: { type: 'frozen', time: 1.0 },
        tags: ['technique', 'mobility'], sfx: 'dash',
      },
      {
        id: 'freezeTouch', name: 'Projection: Seal', jp: '投射・停止',
        desc: 'Touch them out of sync. One full second where they are a still frame and you are not.',
        archetype: 'melee', cost: 24, cooldown: 6, castTime: 0.16, recovery: 0.28,
        range: 2.3, halfArc: 0.8, damage: 10, poise: 10, knock: 0,
        status: { type: 'frozen', time: 1.6 },
        tags: ['technique'], vfx: 'frame_seal', sfx: 'cast',
      },
      {
        id: 'afterimages', name: 'Afterimage Assault', jp: '残像斬',
        desc: 'Leave one hitting copy per frame along your path. They land in order, not at once.',
        archetype: 'melee', cost: 30, cooldown: 8, castTime: 0.22, recovery: 0.42,
        range: 3.0, halfArc: 1.4, damage: 9, poise: 10, knock: 1.5, multi: 8, multiDelay: 0.055,
        tags: ['technique', 'physical'], vfx: 'slash_rush', sfx: 'slash',
      },
      {
        id: 'perfectSecond', name: 'The Perfect Second', jp: '完全な一秒',
        desc: 'Draw all twenty-four frames of a single killing second in advance, then let the world catch up to them.',
        archetype: 'custom', cost: 62, cooldown: 24, castTime: 0.6, recovery: 0.7, ultimate: true,
        tags: ['technique', 'time'], sfx: 'purple',
        onCast(ctx) {
          ctx.world.banner('完全な一秒', 'The Perfect Second', '#9fe870');
          ctx.world.slowmo(0.18, 1.4);
          ctx.world.addStatus(ctx.self, { type: 'buff', time: 5, speed: 1.2, output: 0.5, frameStep: true });
          for (const f of ctx.world.fighters) {
            if (f.team !== ctx.self.team && !f.dead && vdist(f.pos, ctx.self.pos) < 14) {
              ctx.world.addStatus(f, { type: 'frozen', time: 1.6 });
            }
          }
        },
      },
    ],
    domain: null,
    blurbNoDomain: 'No domain — projection is already a rule the world is forced to obey.',
  },

  // =========================================================================
  // CURSED SPIRIT MANIPULATION — 呪霊操術 (boss / unlockable)
  // =========================================================================
  spiritManipulation: {
    id: 'spiritManipulation',
    name: 'Cursed Spirit Manipulation',
    jp: '呪霊操術',
    family: 'Special Grade — the Curse User',
    color: '#6fd4c4', color2: '#0d1f1d', aura: 'swarm',
    blurb: 'Defeat a curse and it becomes yours. Command what you have swallowed, or merge them all into something worse.',
    passive: {
      name: 'Absorption', jp: '取り込み',
      desc: 'Every curse you kill is added to your reserve. Reserve count raises your maximum cursed energy and feeds your summons.',
      onUpdate(ctx) { ctx.self.mods.maxCe += (ctx.self.spiritCount ?? 0) * 4; },
      onKill(ctx) {
        ctx.self.spiritCount = (ctx.self.spiritCount ?? 0) + 1;
        ctx.world.fx('absorb', { pos: ctx.victim.pos, target: ctx.self.id });
      },
    },
    abilities: [
      {
        id: 'releaseCurse', name: 'Release: Grade 2', jp: '呪霊放出',
        desc: 'Send out something you have already beaten. It fights the way it did when it was alive.',
        archetype: 'summon', cost: 26, cooldown: 6, castTime: 0.4, recovery: 0.3,
        summon: { kind: 'curseGrade2', count: 2, life: 28 }, tags: ['technique', 'summon'], sfx: 'summon',
      },
      {
        id: 'rainbowDragon', name: 'Rainbow Dragon', jp: '虹龍',
        desc: 'A long curse that swims through the air and through people.',
        archetype: 'projectile', cost: 34, cooldown: 8, castTime: 0.5, recovery: 0.4,
        tags: ['technique'],
        projectile: {
          speed: 18, radius: 1.4, life: 2.6, damage: 34, poise: 46, knock: 8,
          pierce: 999, homing: 1.4, vfx: 'dragon', color: '#6fd4c4', glow: '#d0fff6', trail: 0.8,
        },
        sfx: 'summon',
      },
      {
        id: 'maxUzumaki', name: 'Maximum: Uzumaki', jp: '極ノ番「うずまき」',
        desc: 'Compress every curse in the reserve into one sphere and throw the whole thing. The reserve is spent.',
        archetype: 'projectile', cost: 84, cooldown: 30, castTime: 1.4, recovery: 1.0, ultimate: true,
        tags: ['technique'],
        projectile: {
          speed: 15, radius: 3.2, life: 2.8, damage: 110, poise: 250, knock: 24,
          pierce: 999, vfx: 'uzumaki', color: '#6fd4c4', glow: '#ffffff',
          explode: { radius: 7, damage: 44, knock: 18 }, destroysProps: true,
        },
        sfx: 'purple',
        onCast(ctx) {
          ctx.world.shake(20, 1.2);
          ctx.self.spiritCount = 0;
          ctx.world.banner('極ノ番', 'Maximum: Uzumaki', '#6fd4c4');
        },
      },
      {
        id: 'spiritGuard', name: 'Bound Guardian', jp: '守護呪霊',
        desc: 'Bind a curse to your back. It eats the next several hits aimed at you.',
        archetype: 'buff', cost: 28, cooldown: 16, castTime: 0.4, recovery: 0.3,
        buff: { time: 14, shield: 70, reinforce: 0.12 }, tags: ['technique', 'buff'], sfx: 'summon',
      },
    ],
    domain: {
      id: 'wellsUnknown', name: 'Chamber of Unknown Depths', jp: '獄門の淵',
      desc: 'A pit with everything you have ever swallowed at the bottom of it, and no floor between them and the target.',
      radius: 12, duration: 11, integrity: 215, cost: 90, drain: 6, castTime: 1.2,
      visual: 'swarm', color: '#6fd4c4', color2: '#07110f',
      sureHit: { type: 'swarm', dps: 15, slow: 0.4, summonRate: 2.5 },
      refinement: 0.95,
      blurb: 'Sure-hit: the swarm. Continuous damage plus a curse released every few seconds at no cost.',
    },
  },

  // =========================================================================
  // DEADLY SENTENCING — 誅伏賜死 (boss)
  // =========================================================================
  deadlySentencing: {
    id: 'deadlySentencing',
    name: 'Deadly Sentencing',
    jp: '誅伏賜死',
    family: 'Special Grade — the Judge',
    color: '#cfa8ff', color2: '#1a1226', aura: 'court',
    blurb: 'A courtroom with a real judge. Confess and the sentence is light; be found guilty and the court takes everything you own.',
    passive: {
      name: 'Burden of Proof', jp: '立証責任',
      desc: 'Every attack the opponent lands is evidence. Accumulated evidence raises your Gavel damage and shortens your domain\'s cast.',
      onIncomingHit(ctx) {
        ctx.self.evidence = Math.min(20, (ctx.self.evidence ?? 0) + 1);
        return false;
      },
      onUpdate(ctx) { ctx.self.mods.output += Math.min(0.9, (ctx.self.evidence ?? 0) * 0.05); },
    },
    abilities: [
      {
        id: 'gavel', name: 'Judge\'s Gavel', jp: '木槌',
        desc: 'One swing carrying the weight of everything they have done so far.',
        archetype: 'melee', cost: 20, cooldown: 3, castTime: 0.3, recovery: 0.4,
        range: 2.8, halfArc: 1.0, damage: 26, poise: 56, knock: 10, guardBreak: true,
        tags: ['technique', 'physical'], vfx: 'slash_smash', sfx: 'hitHeavy',
      },
      {
        id: 'indictment', name: 'Indictment', jp: '起訴',
        desc: 'Name the crime out loud. The accused loses the ability to justify themselves — and their cursed energy regeneration with it.',
        archetype: 'command', cost: 24, cooldown: 8, castTime: 0.35, recovery: 0.35,
        range: 11, halfArc: 0.7, damage: 12,
        status: { type: 'indicted', time: 12, power: 1 },
        tags: ['technique', 'mark'], vfx: 'word_dontmove', sfx: 'cast',
      },
      {
        id: 'confiscate', name: 'Confiscation', jp: '没収',
        desc: 'Take the weapon out of their hands — and the technique out of their body, for a while.',
        archetype: 'command', cost: 40, cooldown: 18, castTime: 0.45, recovery: 0.5,
        range: 9, halfArc: 0.6, damage: 18,
        status: { type: 'techniqueSealed', time: 8 },
        tags: ['technique'], vfx: 'nullify', sfx: 'cast',
      },
      {
        id: 'executionOrder', name: 'Execution Order', jp: '死刑執行',
        desc: 'Sentence passed. Against a guilty target this is not damage, it is a verdict.',
        archetype: 'melee', cost: 60, cooldown: 26, castTime: 0.6, recovery: 0.8,
        range: 3.2, halfArc: 1.0, damage: 70, poise: 180, knock: 14, ultimate: true,
        ignoreReinforce: 0.6, tags: ['technique'], vfx: 'slash_smash', sfx: 'hitHeavy',
        onHit(ctx) {
          if (ctx.victim.hasStatus('indicted')) ctx.victim.takeTrueDamage(60, 'Execution Order');
        },
      },
    ],
    domain: {
      id: 'deadlySentencingDomain', name: 'Deadly Sentencing', jp: '誅伏賜死',
      desc: 'The barrier becomes a court. The judge is real, the sentence is binding, and the accused may plead.',
      radius: 12, duration: 12, integrity: 230, cost: 92, drain: 6, castTime: 1.3,
      visual: 'courtroom', color: '#cfa8ff', color2: '#100a1a',
      sureHit: { type: 'verdict', dps: 10, confiscate: true, sentence: 5 },
      refinement: 1.05,
      blurb: 'Sure-hit: the verdict. The court confiscates the target\'s cursed technique outright while the domain holds.',
    },
  },
};

export const PLAYABLE_TECHNIQUES = [
  'limitless', 'tenShadows', 'shrine', 'idleTransfiguration', 'disasterFlames',
  'bloodManipulation', 'heavenlyRestriction', 'cursedSpeech', 'ratio',
  'boogieWoogie', 'strawDoll', 'projectionSorcery', 'spiritManipulation', 'deadlySentencing',
];

export function getTechnique(id) {
  return TECHNIQUES[id] || TECHNIQUES.shrine;
}

export function abilityOf(techId, index) {
  const t = getTechnique(techId);
  return t.abilities[index] || null;
}
