// Visual effects: particles, slash arcs, shockwaves, lightning, ink splatter,
// ground scars and floating damage numbers.
//
// The simulation never touches this file — it pushes named events into
// world.fxQueue and this layer decides what they look like.

import {
  clamp, clamp01, lerp, vec, vadd, vsub, vscale, vnorm, vlen, vdist, vangle,
  vfromAngle, wrapAngle, rand, randRange, randInt, chance, pick, TAU, PI,
  easeOutCubic, easeOutQuint, noise1,
} from '../core/math.js';

const MAX_PARTICLES = 2600;

export class Effects {
  constructor() {
    this.particles = [];
    this.arcs = [];       // slash arcs / crescents
    this.rings = [];      // expanding shockwaves
    this.beams = [];
    this.bolts = [];      // lightning
    this.numbers = [];
    this.decals = [];     // ground scars, blood pools, craters
    this.sprites = [];    // one-off symbols: kanji bursts, seals
    this.flashes = [];    // fullscreen colour flashes
    this.impacts = [];    // manga impact frames (radial speed lines)
    this.cuts = [];       // slashes that flash, hold, then open
    this.quality = 1;     // 0.4 .. 1.4, scales particle counts
  }

  clear() {
    this.particles.length = 0;
    this.arcs.length = 0;
    this.rings.length = 0;
    this.beams.length = 0;
    this.bolts.length = 0;
    this.numbers.length = 0;
    this.decals.length = 0;
    this.sprites.length = 0;
    this.flashes.length = 0;
    this.impacts.length = 0;
    this.cuts.length = 0;
  }

  /**
   * A manga impact frame: radial speed lines plus a colour wash. `focus` is an
   * optional world point the lines converge on — passing the hit position makes
   * the frame read as "this is where it landed" instead of a generic flash.
   * `gash` adds the ragged white slashes reserved for the biggest hits.
   */
  impact(strength, color, flash = true, time = 0.3, focus = null, gash = false) {
    this.impacts.push({
      life: time, max: time, strength, color, flash, gash,
      focus: focus ? { x: focus.x, y: focus.y, z: focus.z ?? 1.3 } : null,
      seed: rand() * TAU,
    });
    if (this.impacts.length > 4) this.impacts.shift();
  }

  /**
   * The frame a cursed technique earns when it connects. Scaled by how much the
   * hit actually mattered so ordinary chip damage does not get the treatment.
   */
  techniqueImpact(pos, z, color, weight) {
    const s = clamp01(weight);
    if (s < 0.18) return;
    this.impact(0.3 + s * 0.65, color || '#ffffff', s > 0.45,
      0.22 + s * 0.22, { x: pos.x, y: pos.y, z: z ?? 1.3 }, s > 0.7);
  }

  // -------------------------------------------------------------------------
  // Spawners
  // -------------------------------------------------------------------------

  particle(o) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(Object.assign({
      x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
      life: 0.6, max: 0.6, size: 0.12, grow: 0,
      color: '#ffffff', glow: 0, drag: 2.4, gravity: 0,
      kind: 'dot', spin: 0, rot: 0, fade: 1, additive: true,
      trailLen: 0, stretch: 0,
    }, o));
  }

  burst(x, y, z, count, opts = {}) {
    const n = Math.max(1, Math.round(count * this.quality));
    for (let i = 0; i < n; i++) {
      const a = opts.angle != null ? opts.angle + randRange(-(opts.spread ?? PI), opts.spread ?? PI) : rand() * TAU;
      const sp = randRange(opts.speedMin ?? 1, opts.speedMax ?? 6);
      this.particle(Object.assign({
        x, y, z,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        vz: randRange(opts.vzMin ?? 0.4, opts.vzMax ?? 4),
        life: randRange(opts.lifeMin ?? 0.25, opts.lifeMax ?? 0.7),
        size: randRange(opts.sizeMin ?? 0.05, opts.sizeMax ?? 0.16),
        color: opts.colors ? pick(opts.colors) : (opts.color || '#ffffff'),
        gravity: opts.gravity ?? 9,
        drag: opts.drag ?? 2.2,
        glow: opts.glow ?? 0.6,
        kind: opts.kind || 'dot',
        stretch: opts.stretch ?? 0,
      }, opts.extra || {}));
    }
    for (const p of this.particles) if (p.max === undefined) p.max = p.life;
  }

  arc(o) {
    this.arcs.push(Object.assign({
      x: 0, y: 0, z: 1, angle: 0, range: 2, arc: 1,
      life: 0.22, max: 0.22, color: '#ffffff', width: 0.22,
      style: 'slash', inner: 0.35, chain: 0,
    }, o));
  }

  ring(o) {
    this.rings.push(Object.assign({
      x: 0, y: 0, z: 0, r: 0.2, target: 3, life: 0.4, max: 0.4,
      color: '#ffffff', width: 0.12, style: 'ring', flat: true, alpha: 1,
    }, o));
  }

  beam(o) {
    this.beams.push(Object.assign({
      from: vec(), to: vec(), z: 1, width: 1, life: 0.26, max: 0.26,
      color: '#ffffff', style: 'beam',
    }, o));
  }

  bolt(x1, y1, z1, x2, y2, z2, o = {}) {
    const segs = o.segments ?? 8;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const j = i === 0 || i === segs ? 0 : randRange(-1, 1) * (o.jag ?? 0.5);
      const k = i === 0 || i === segs ? 0 : randRange(-1, 1) * (o.jag ?? 0.5);
      pts.push({
        x: lerp(x1, x2, t) + j,
        y: lerp(y1, y2, t) + j * 0.5,
        z: lerp(z1, z2, t) + k,
      });
    }
    this.bolts.push(Object.assign({
      pts, life: 0.16, max: 0.16, color: '#ffffff', width: 0.06, glow: 1,
    }, o));
  }

  number(x, y, z, text, color, opts = {}) {
    this.numbers.push(Object.assign({
      x, y, z, text, color, life: 1.0, max: 1.0,
      vx: randRange(-0.6, 0.6), vy: randRange(-0.3, 0.1), vz: randRange(2.4, 3.6),
      size: 15, weight: 700, crit: false, outline: '#000000',
    }, opts));
  }

  decal(o) {
    this.decals.push(Object.assign({
      x: 0, y: 0, r: 1, life: 14, max: 14, color: '#000000',
      style: 'scar', angle: rand() * TAU, alpha: 0.5,
    }, o));
    if (this.decals.length > 260) this.decals.shift();
  }

  sprite(o) {
    this.sprites.push(Object.assign({
      x: 0, y: 0, z: 1.5, text: '', color: '#ffffff', life: 0.9, max: 0.9,
      size: 40, style: 'kanji', rot: 0,
    }, o));
  }

  flash(color, strength, time, mode = 'screen') {
    this.flashes.push({ color, strength, life: time, max: time, mode });
  }

  /**
   * A cut through the world.
   *
   * A slash in this show is not a glowing sword arc — it is a line that was
   * already there. The drawing gives you a hairline flash, a held beat where
   * nothing happens, and then the cut opens: the gap spreads, the edges light
   * up, and whatever was on the line comes apart. Those three stages are the
   * whole effect, and the pause in the middle is what sells it.
   */
  cut(o) {
    this.cuts.push(Object.assign({
      x: 0, y: 0, z: 1.1, angle: 0, len: 8, width: 0.5,
      tilt: 0,                 // roll of the cut plane about the stroke axis
      lean: 0,                 // swing of the stroke itself about the strike
      delay: 0,                // stagger, so a set of cuts lands in sequence
      life: 0.5, max: 0.5, color: '#ff4d4d', style: 'dismantle',
    }, o));
    if (this.cuts.length > 40) this.cuts.shift();
  }

  /**
   * Dismantle arrives as a lattice, not a single stroke: a fan of parallel cuts
   * crossed by a second fan at right angles. Cleave is one heavy stroke.
   */
  cutFan(x, y, z, angle, o = {}) {
    const n = o.count ?? 3;
    const len = o.len ?? 8;
    const cross = o.cross ?? false;
    const slash = (o.slash ?? 3.2);     // how wide a single stroke reads

    // The strokes run ACROSS the strike, stepped along its length. Cuts laid
    // along the beam are almost invisible when the beam points away from the
    // camera — they foreshorten to a sliver — whereas a stroke across it reads
    // at any angle, which is also how the show draws them.
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
      this.cut(Object.assign({}, o, {
        x: x + Math.cos(angle) * t * len * 0.3,
        y: y + Math.sin(angle) * t * len * 0.3,
        z: z + t * (o.rise ?? 0.2),
        angle: angle + PI / 2,
        len: slash,
        // Diagonal, alternating: parallel horizontal bars look like a fence,
        // opposed diagonals look like something was cut. The swing is about the
        // strike's own axis, which is what tips the stroke on screen — rolling
        // the plane instead would only turn it edge-on to the camera.
        lean: (0.7 + t * (o.fan ?? 0.18)) * (i % 2 ? 1 : -1),
        tilt: (o.tilt ?? 0) + t * 0.12,
        delay: i * (o.stagger ?? 0.03),
      }));
    }
    if (!cross) return;
    // The crossing half of the lattice: the same strokes leaning the other way.
    const m = Math.max(2, n);
    for (let i = 0; i < m; i++) {
      const t = m === 1 ? 0 : (i / (m - 1) - 0.5) * 2;
      this.cut(Object.assign({}, o, {
        x: x + Math.cos(angle) * t * len * 0.24,
        y: y + Math.sin(angle) * t * len * 0.24,
        z: z + t * 0.14,
        angle: angle + PI / 2,
        len: slash * 0.92,
        lean: -(0.7 - t * 0.18) * (i % 2 ? 1 : -1),
        tilt: (o.tilt ?? 0) - t * 0.12,
        delay: 0.06 + i * (o.stagger ?? 0.03),
      }));
    }
  }

  // -------------------------------------------------------------------------
  // Event translation
  // -------------------------------------------------------------------------

  handle(e) {
    const p = e.pos || { x: 0, y: 0 };
    const z = e.z ?? 1;
    const col = e.color || '#ffffff';

    switch (e.type) {
      // --- impacts -------------------------------------------------------
      case 'impact':
        this.burst(p.x, p.y, z, 10, { color: col, speedMax: 7, sizeMax: 0.14, glow: 1 });
        this.ring({ x: p.x, y: p.y, z, r: 0.1, target: (e.size || 0.6) * 2.2, life: 0.2, color: col, flat: false, width: 0.08 });
        break;
      case 'hitSpark':
        this.burst(p.x, p.y, z, 12, { color: '#fff2c0', angle: e.angle, spread: 1.1, speedMax: 9 });
        break;
      case 'block':
        this.burst(p.x, p.y, z, 14, { color: '#cfe6ff', angle: e.angle, spread: 0.8, speedMax: 8, sizeMax: 0.1 });
        this.arc({ x: p.x, y: p.y, z, angle: (e.angle ?? 0) + PI, range: 1.2, arc: 0.9, color: '#dff0ff', life: 0.18, style: 'guard' });
        break;
      case 'parry':
        this.impact(0.55, '#ffe9a0', false, 0.24);
        this.flash('#ffe9a0', 0.35, 0.16);
        this.ring({ x: p.x, y: p.y, z, r: 0.2, target: 4.5, life: 0.42, color: '#ffe9a0', width: 0.16, flat: false });
        this.ring({ x: p.x, y: p.y, z, r: 0.2, target: 2.6, life: 0.3, color: '#ffffff', width: 0.1, flat: false });
        this.burst(p.x, p.y, z, 26, { color: '#ffe9a0', speedMax: 12, lifeMax: 0.5, glow: 1, stretch: 0.6 });
        this.sprite({ x: p.x, y: p.y, z: z + 0.6, text: 'PARRY', color: '#ffe9a0', size: 34, life: 0.7 });
        break;
      case 'parryFlash':
        this.ring({ x: p.x, y: p.y, z, r: 1.4, target: 0.6, life: 0.2, color: '#ffd166', width: 0.06, flat: false, alpha: 0.7 });
        break;
      case 'guardBreak':
        this.impact(0.6, '#ffb3b3', false, 0.26);
        this.flash('#ff6b6b', 0.25, 0.2);
        this.burst(p.x, p.y, z, 30, { color: '#ffb3b3', speedMax: 10, lifeMax: 0.8 });
        this.sprite({ x: p.x, y: p.y, z: z + 0.8, text: 'GUARD BREAK', color: '#ff6b6b', size: 40, life: 0.8 });
        break;
      case 'dodge':
        this.burst(p.x, p.y, z + 0.4, 8, { color: '#9fe870', speedMax: 4, lifeMax: 0.35, gravity: 1 });
        break;

      // --- black flash ---------------------------------------------------
      case 'blackflash': {
        // Black Flash gets the strongest impact frame in the game, focused on
        // the point of contact rather than the screen centre, and with the
        // gash pass on: it is the one hit that is allowed to tear the frame.
        this.impact(1, '#ff2d2d', true, 0.5, { x: p.x, y: p.y, z }, true);
        // A second, shorter frame a beat later in black, so the red frame is
        // followed by the dark one rather than fading out of it.
        this.impact(0.72, '#120008', false, 0.3, { x: p.x, y: p.y, z }, true);
        // Four strokes crossing the impact, which is what the crack actually
        // is. They run across the punch rather than along it, staggered so the
        // set lands in sequence instead of all at once.
        const bfAngle = e.angle ?? 0;
        for (let i = 0; i < 4; i++) {
          const life = randRange(0.32, 0.5);
          this.cut({
            x: p.x, y: p.y, z,
            angle: bfAngle + Math.PI / 2,
            lean: (i - 1.5) * 0.42,
            tilt: randRange(-0.3, 0.3),
            len: randRange(4.5, 7.5),
            width: randRange(0.12, 0.3),
            color: i % 2 ? '#ff2d2d' : '#0a0206',
            delay: i * 0.022,
            life, max: life,
          });
        }
        this.flash('#ff2d2d', 0.55, 0.3, 'invert');
        this.flash('#000000', 0.5, 0.22, 'multiply');
        this.ring({ x: p.x, y: p.y, z, r: 0.3, target: 9, life: 0.55, color: '#ff2d2d', width: 0.4, flat: false });
        this.ring({ x: p.x, y: p.y, z, r: 0.3, target: 6, life: 0.42, color: '#120000', width: 0.9, flat: false });
        this.ring({ x: p.x, y: p.y, z: 0, r: 0.5, target: 11, life: 0.6, color: '#ff2d2d', width: 0.25, flat: true });
        for (let i = 0; i < 22; i++) {
          const a = rand() * TAU;
          const d = randRange(1.2, 5.5);
          this.bolt(p.x, p.y, z, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, z + randRange(-1.2, 2.2), {
            color: i % 3 === 0 ? '#ffffff' : '#ff2d2d', width: randRange(0.04, 0.12),
            life: randRange(0.12, 0.34), jag: 0.7, segments: 7,
          });
        }
        this.burst(p.x, p.y, z, 60, {
          colors: ['#ff2d2d', '#1a0000', '#ffffff', '#ff7a5a'],
          speedMax: 20, lifeMax: 0.9, sizeMax: 0.3, glow: 1, stretch: 0.9, gravity: 4,
        });
        // The callout is raised by whoever handles the event, because it
        // depends on whether the cut-in took the shot — two of them on screen
        // at once is worse than none.
        this.decal({ x: p.x, y: p.y, r: 3.4, color: '#3a0505', style: 'scorch', alpha: 0.55 });
        break;
      }

      // --- cursed energy / techniques -------------------------------------
      case 'infinity':
        this.ring({ x: p.x, y: p.y, z: 1.1, r: 0.2, target: 2.0, life: 0.32, color: '#7fd7ff', width: 0.07, flat: false });
        this.burst(p.x, p.y, 1.1, 6, { color: '#7fd7ff', speedMax: 2, lifeMax: 0.4, gravity: 0 });
        break;
      case 'nullify':
        this.ring({ x: p.x, y: p.y, z: 1, r: 2.4, target: 0.2, life: 0.3, color: '#b7c9d8', width: 0.1, flat: false });
        this.burst(p.x, p.y, 1, 14, { color: '#b7c9d8', speedMax: 5, lifeMax: 0.4 });
        break;
      case 'amplify':
      case 'amplifyNegate':
        this.ring({ x: p.x, y: p.y, z: 1, r: 0.3, target: 2.2, life: 0.4, color: '#cfa8ff', width: 0.12, flat: false });
        this.burst(p.x, p.y, 1, 16, { color: '#cfa8ff', speedMax: 4, lifeMax: 0.6, gravity: -1 });
        break;
      case 'simpleDomainOpen':
        this.ring({ x: p.x, y: p.y, z: 0.05, r: 0.2, target: 2.21, life: 0.5, color: '#a8d8ff', width: 0.14, flat: true });
        this.sprite({ x: p.x, y: p.y, z: 2.4, text: 'SIMPLE DOMAIN', color: '#a8d8ff', size: 24, life: 1.0 });
        break;
      case 'simpleCounter':
        this.arc({ x: p.x, y: p.y, z, angle: rand() * TAU, range: e.radius || 2.21, arc: PI, color: '#cfe8ff', life: 0.2, width: 0.1, style: 'circle' });
        break;
      case 'simpleNegate':
      case 'sureHitBlocked':
        this.burst(p.x, p.y, z, 6, { color: '#a8d8ff', speedMax: 3, lifeMax: 0.3 });
        break;
      case 'fallingBlossom':
        this.burst(p.x, p.y, z, 10, { colors: ['#ffb3d1', '#ffffff'], speedMax: 4, lifeMax: 0.8, gravity: 2, kind: 'petal' });
        break;

      // --- domains --------------------------------------------------------
      case 'domainCharge': {
        // Cursed energy spiralling in, plus a seal drawing itself on the ground.
        for (let i = 0; i < Math.round(26 * this.quality); i++) {
          const a = rand() * TAU;
          const d = randRange(5, 11);
          const tangential = 5.5;
          this.particle({
            x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, z: randRange(0, 4.5),
            vx: -Math.cos(a) * 7 - Math.sin(a) * tangential,
            vy: -Math.sin(a) * 7 + Math.cos(a) * tangential,
            vz: randRange(1.5, 4),
            life: randRange(0.5, 1.1), size: 0.13, color: e.color || '#ffffff',
            glow: 1, gravity: -1.5, drag: 0.5, stretch: 0.5,
          });
        }
        this.ring({ x: p.x, y: p.y, z: 0.03, r: 3.2, target: 1.1, life: 0.5, color: e.color || '#ffffff', width: 0.1, flat: true, alpha: 0.7 });
        break;
      }
      case 'domainOpen': {
        const R = e.radius;
        this.impact(0.95, e.color || '#ffffff', true, 0.65,
          { x: p.x, y: p.y, z: 1.6 }, true);
        // The space is cut open before the barrier appears in it: a ring of
        // slashes facing outward, each one opening onto the dark.
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + 0.2;
          this.cut({
            x: p.x + Math.cos(a) * R * 0.55, y: p.y + Math.sin(a) * R * 0.55,
            z: 1.5 + (i % 3) * 0.9,
            angle: a + PI / 2, lean: (i % 2 ? 1 : -1) * 0.75, tilt: 0,
            len: R * 0.62, width: 1.4, color: e.color || '#ffffff',
            style: 'domain', delay: i * 0.028, life: 0.8, max: 0.8,
          });
        }
        this.flash(e.color || '#ffffff', 0.5, 0.6);
        this.flash('#ffffff', 0.35, 0.16);
        // Ground shock racing out ahead of the barrier.
        this.ring({ x: p.x, y: p.y, z: 0, r: 0.5, target: R * 1.25, life: 0.55, color: '#ffffff', width: 0.6, flat: true });
        this.ring({ x: p.x, y: p.y, z: 0, r: 0.5, target: R * 1.05, life: 1.0, color: e.color, width: 0.45, flat: true });
        this.ring({ x: p.x, y: p.y, z: 2, r: 0.5, target: R, life: 0.9, color: '#ffffff', width: 0.3, flat: false });
        // A column of energy up the centre as the barrier locks.
        for (let i = 0; i < Math.round(50 * this.quality); i++) {
          const a = rand() * TAU;
          const rr = randRange(0, R * 0.2);
          this.particle({
            x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr, z: randRange(0, 1),
            vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.5, vz: randRange(8, 22),
            life: randRange(0.6, 1.3), size: randRange(0.1, 0.3), color: i % 3 ? e.color : '#ffffff',
            glow: 1, gravity: 3, drag: 0.7,
          });
        }
        // Debris torn off the ground along the expanding edge.
        for (let i = 0; i < Math.round(40 * this.quality); i++) {
          const a = rand() * TAU;
          this.particle({
            x: p.x + Math.cos(a) * R * randRange(0.55, 1), y: p.y + Math.sin(a) * R * randRange(0.55, 1), z: 0.1,
            vx: Math.cos(a) * randRange(1, 5), vy: Math.sin(a) * randRange(1, 5), vz: randRange(3, 9),
            life: randRange(0.7, 1.4), size: randRange(0.1, 0.3), color: e.color2 || '#8a8a7a',
            glow: 0.2, gravity: 14, drag: 1, kind: 'chunk', spin: randRange(-6, 6),
          });
        }
        this.burst(p.x, p.y, 1, 60, {
          color: e.color, speedMax: 18, lifeMax: 1.4, sizeMax: 0.3, glow: 1, gravity: -2,
        });
        break;
      }
      case 'domainShatter': {
        // The barrier comes apart in panels: shards distributed over the whole
        // hemisphere, thrown outward, then an implosion as the space closes.
        this.impact(1, e.color, true, 0.5);
        this.flash('#ffffff', 0.6, 0.35);
        const R = e.radius;
        for (let i = 0; i < Math.round(90 * this.quality); i++) {
          const a = rand() * TAU;
          const lat = Math.acos(randRange(0, 1));        // bias toward the ground
          const rr = R * Math.sin(lat);
          const zz = R * 0.9 * Math.cos(lat);
          this.particle({
            x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr, z: 0.2 + zz,
            vx: Math.cos(a) * randRange(5, 18), vy: Math.sin(a) * randRange(5, 18),
            vz: randRange(-1, 7),
            life: randRange(0.8, 1.9), size: randRange(0.16, 0.5), color: i % 4 === 0 ? '#ffffff' : e.color,
            glow: 0.75, gravity: 13, drag: 0.7, kind: 'shard', spin: randRange(-9, 9),
          });
        }
        // Outward shock, then the space snapping shut.
        this.ring({ x: p.x, y: p.y, z: 0, r: R * 0.2, target: R * 1.5, life: 0.5, color: '#ffffff', width: 0.5, flat: true });
        this.ring({ x: p.x, y: p.y, z: R * 0.5, r: R * 0.2, target: R * 1.2, life: 0.45, color: e.color, width: 0.4, flat: false });
        this.ring({ x: p.x, y: p.y, z: 0, r: R * 1.3, target: 0.4, life: 0.9, color: e.color, width: 0.3, flat: true });
        for (let i = 0; i < Math.round(26 * this.quality); i++) {
          const a = rand() * TAU;
          this.particle({
            x: p.x + Math.cos(a) * R * 1.1, y: p.y + Math.sin(a) * R * 1.1, z: randRange(0.4, 4),
            vx: -Math.cos(a) * randRange(6, 12), vy: -Math.sin(a) * randRange(6, 12), vz: randRange(0, 2),
            life: randRange(0.5, 1.0), size: randRange(0.1, 0.24), color: '#ffffff',
            glow: 1, gravity: 0, drag: 1.2,
          });
        }
        this.decal({ x: p.x, y: p.y, r: R * 0.8, color: e.color2 || '#0a0a12', style: 'scorch', alpha: 0.4, life: 10 });
        break;
      }
      case 'domainClose': {
        // A controlled release: the interior drains back into the caster.
        const R = e.radius;
        this.ring({ x: p.x, y: p.y, z: 0, r: R, target: 0.3, life: 0.7, color: e.color, width: 0.3, flat: true });
        this.ring({ x: p.x, y: p.y, z: R * 0.4, r: R, target: 0.3, life: 0.6, color: e.color, width: 0.2, flat: false });
        for (let i = 0; i < Math.round(34 * this.quality); i++) {
          const a = rand() * TAU;
          const rr = R * Math.sqrt(rand());
          this.particle({
            x: p.x + Math.cos(a) * rr, y: p.y + Math.sin(a) * rr, z: randRange(0.2, R * 0.6),
            vx: -Math.cos(a) * rr * 1.5, vy: -Math.sin(a) * rr * 1.5, vz: randRange(-0.5, 1.5),
            life: randRange(0.4, 0.9), size: randRange(0.08, 0.2), color: e.color,
            glow: 0.9, gravity: 0, drag: 0.4,
          });
        }
        break;
      }
      case 'clashSpark':
        this.burst(p.x, p.y, randRange(0.5, 3), 4, { color: e.color || '#ffffff', speedMax: 8, lifeMax: 0.3, glow: 1 });
        break;
      case 'voidTick':
        if (chance(0.5)) this.burst(p.x, p.y, z, 2, { color: '#8ad8ff', speedMax: 1.4, lifeMax: 0.5, gravity: -1 });
        break;
      case 'shrineSlash':
        this.arc({ x: p.x, y: p.y, z, angle: e.angle, range: randRange(1.6, 3.4), arc: randRange(0.4, 1.1), color: '#ff4d4d', life: 0.16, width: 0.1 });
        break;
      case 'wordPulse':
        this.ring({ x: p.x, y: p.y, z: 0.1, r: 0.2, target: e.radius, life: 0.5, color: '#f0e6c8', width: 0.18, flat: true });
        break;

      // --- movement -------------------------------------------------------
      case 'dashTrail':
        this.burst(p.x, p.y, (e.z ?? 0) + 0.4, 8, {
          color: '#ffffff', angle: (e.angle ?? 0) + PI, spread: 0.5,
          speedMax: 4, lifeMax: 0.3, sizeMax: 0.1, glow: 0.3, gravity: 0,
        });
        break;
      case 'dashStreak':
        this.beam({ from: e.from, to: e.to, z: e.z ?? 1, width: 0.5, life: 0.2, color: e.color || '#ffffff', style: 'streak' });
        break;
      case 'landDust':
        this.burst(p.x, p.y, 0.05, Math.min(18, 4 + (e.power || 4)), {
          color: '#8a8a7a', speedMax: 3 + (e.power || 4) * 0.2, lifeMax: 0.7,
          vzMin: 0.1, vzMax: 1.2, gravity: 3, glow: 0, kind: 'smoke', sizeMax: 0.3,
        });
        this.ring({ x: p.x, y: p.y, z: 0.02, r: 0.2, target: 1.4 + (e.power || 0) * 0.1, life: 0.3, color: '#9a9a8a', width: 0.05, flat: true, alpha: 0.5 });
        break;
      case 'whiff':
        this.arc({ x: p.x, y: p.y, z: 1.1, angle: e.angle, range: e.range || 2, arc: 0.8, color: '#ffffff', life: 0.14, width: 0.05, style: 'whiff' });
        break;
      case 'slam':
        this.burst(p.x, p.y, z, 22, { color: '#c8c8b8', angle: e.angle, spread: 1.4, speedMax: 10, lifeMax: 0.7, kind: 'smoke' });
        this.ring({ x: p.x, y: p.y, z, r: 0.2, target: 3, life: 0.3, color: '#ffffff', width: 0.12, flat: false });
        break;

      // --- fire / blood / misc -------------------------------------------
      case 'explosion':
        this.flash(e.glow || '#ffd08a', 0.3, 0.2);
        this.ring({ x: p.x, y: p.y, z, r: 0.3, target: e.radius * 1.4, life: 0.5, color: e.color, width: 0.35, flat: false });
        this.ring({ x: p.x, y: p.y, z: 0.05, r: 0.3, target: e.radius * 1.8, life: 0.6, color: e.color, width: 0.2, flat: true, alpha: 0.6 });
        this.burst(p.x, p.y, z, 46, {
          colors: [e.color, e.glow || '#ffffff', '#2a1a10'], speedMax: e.radius * 3.4,
          lifeMax: 1.0, sizeMax: 0.34, glow: 1, gravity: 6,
        });
        this.decal({ x: p.x, y: p.y, r: e.radius * 0.8, color: '#1a0e08', style: 'scorch', alpha: 0.5 });
        break;
      case 'ember':
        this.particle({
          x: p.x + randRange(-0.4, 0.4), y: p.y + randRange(-0.4, 0.4), z: (e.z ?? 0) + randRange(0.2, 1.4),
          vx: randRange(-0.5, 0.5), vy: randRange(-0.5, 0.5), vz: randRange(1, 2.5),
          life: randRange(0.4, 0.9), size: 0.07, color: pick(['#ff8a1e', '#ffd166', '#ff4d2d']),
          glow: 1, gravity: -1.4, drag: 1,
        });
        break;
      case 'bloodDrip':
        this.particle({
          x: p.x + randRange(-0.3, 0.3), y: p.y + randRange(-0.3, 0.3), z: (e.z ?? 0) + randRange(0.4, 1.4),
          vx: randRange(-1, 1), vy: randRange(-1, 1), vz: randRange(0.4, 1.6),
          life: 0.7, size: 0.08, color: '#c8102e', glow: 0.2, gravity: 12, drag: 0.5,
          onGround: 'blood',
        });
        break;
      case 'rctSpark':
        this.particle({
          x: p.x + randRange(-0.5, 0.5), y: p.y + randRange(-0.5, 0.5), z: (e.z ?? 1) + randRange(-0.4, 0.6),
          vx: 0, vy: 0, vz: randRange(1.4, 2.6), life: 0.7, size: 0.1,
          color: '#8ef0bd', glow: 1, gravity: -1, drag: 1.4,
        });
        break;
      case 'rctFail':
        this.burst(p.x, p.y, z, 14, { color: '#ff4d4d', speedMax: 5, lifeMax: 0.5 });
        break;
      case 'crit':
        this.ring({ x: p.x, y: p.y, z: 1.2, r: 0.2, target: 2.4, life: 0.25, color: '#d8c98a', width: 0.14, flat: false });
        this.sprite({ x: p.x, y: p.y, z: 2.2, text: 'CRITICAL', color: '#d8c98a', size: 26, life: 0.6 });
        break;
      case 'adapt':
        this.ring({ x: p.x, y: p.y, z: 1, r: 0.3, target: 3.2, life: 0.7, color: '#c8b06a', width: 0.16, flat: false });
        this.sprite({ x: p.x, y: p.y, z: 2.6, text: 'ADAPTED', color: '#c8b06a', size: 34, life: 1.1 });
        break;
      case 'absorb':
        this.burst(p.x, p.y, 1, 18, { color: '#6fd4c4', speedMax: 3, lifeMax: 0.8, gravity: -2 });
        break;
      case 'resonance_hit':
        this.ring({ x: p.x, y: p.y, z: 1, r: 0.2, target: 3, life: 0.35, color: '#ff9f6b', width: 0.16, flat: false });
        this.burst(p.x, p.y, 1, 20, { color: '#ff9f6b', speedMax: 8, lifeMax: 0.6 });
        break;
      case 'body_repel':
        this.burst(p.x, p.y, 1, 26, { colors: ['#7fd4a8', '#dfe7ee'], speedMax: 7, lifeMax: 0.8, kind: 'chunk' });
        break;

      // --- world ----------------------------------------------------------
      case 'propHit':
        this.burst(p.x, p.y, 1, 8, { color: e.color || '#8a8a8a', speedMax: 5, lifeMax: 0.5, kind: 'chunk', gravity: 14 });
        break;
      case 'propBreak':
        this.burst(p.x, p.y, 0.8, 26, {
          color: e.color || '#8a8a8a', speedMax: 9, lifeMax: 1.4, sizeMax: 0.35,
          kind: 'chunk', gravity: 16, glow: 0,
        });
        this.burst(p.x, p.y, 0.4, 14, { color: '#6a6a6a', speedMax: 4, lifeMax: 1.2, kind: 'smoke', sizeMax: 0.5, gravity: -0.5 });
        this.decal({ x: p.x, y: p.y, r: (e.radius || 1) * 1.4, color: '#14161c', style: 'rubble', alpha: 0.6 });
        break;
      case 'scar':
        this.decal({ x: p.x, y: p.y, r: e.radius || 0.6, color: e.color || '#000000', style: 'gouge', alpha: 0.35, life: 9 });
        break;
      case 'death':
        this.burst(p.x, p.y, (e.z ?? 0) + 0.8, 34, {
          color: e.color || '#8a8a8a', speedMax: 7, lifeMax: 1.3, sizeMax: 0.28,
          gravity: e.kind === 'curse' ? -2 : 8, glow: e.kind === 'curse' ? 0.8 : 0.2,
          kind: e.kind === 'curse' ? 'smoke' : 'chunk',
        });
        if (e.kind === 'curse') {
          this.ring({ x: p.x, y: p.y, z: 0.6, r: 0.3, target: 3, life: 0.6, color: e.color, width: 0.14, flat: false });
        } else {
          this.decal({ x: p.x, y: p.y, r: 1.4, color: '#5a0a12', style: 'blood', alpha: 0.55 });
        }
        break;
      case 'despawn':
        this.burst(p.x, p.y, (e.z ?? 0) + 0.6, 16, { color: e.color, speedMax: 3, lifeMax: 0.7, gravity: -3, kind: 'smoke' });
        break;
      case 'summonPop':
      case 'summonCircle':
        this.ring({ x: p.x, y: p.y, z: 0.04, r: 0.2, target: e.radius || 2.4, life: 0.5, color: e.color || '#8b7bd8', width: 0.12, flat: true });
        this.burst(p.x, p.y, 0.3, 18, { color: e.color || '#8b7bd8', speedMax: 4, lifeMax: 0.7, gravity: -3 });
        break;
      case 'zoneOpen':
        this.ring({ x: p.x, y: p.y, z: 0.04, r: 0.2, target: e.radius || 3, life: 0.5, color: e.color, width: 0.14, flat: true });
        break;
      case 'buffAura':
        this.ring({ x: p.x, y: p.y, z: 0.05, r: 2.4, target: 0.3, life: 0.5, color: e.color, width: 0.14, flat: true });
        this.burst(p.x, p.y, 0.4, 22, { color: e.color, speedMax: 2, lifeMax: 0.9, gravity: -3 });
        break;
      case 'castCharge':
        for (let i = 0; i < 10; i++) {
          const a = rand() * TAU;
          const d = randRange(1.4, 3.2);
          this.particle({
            x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, z: (e.z ?? 0) + randRange(0.3, 2),
            vx: -Math.cos(a) * 4, vy: -Math.sin(a) * 4, vz: randRange(0, 1),
            life: randRange(0.2, 0.5), size: 0.09, color: e.color || '#ffffff', glow: 1, drag: 1, gravity: 0,
          });
        }
        break;
      case 'charge_purple':
        this.ring({ x: p.x, y: p.y, z: 1.2, r: 3.4, target: 0.4, life: 0.6, color: '#9a4cff', width: 0.2, flat: false });
        this.ring({ x: p.x, y: p.y, z: 1.2, r: 3.0, target: 0.4, life: 0.6, color: '#ff6bd6', width: 0.14, flat: false });
        break;
      case 'beam': {
        const vfx = e.vfx || 'beam';
        const mid = e.focus
          ? { x: e.focus.x, y: e.focus.y }
          : { x: (e.from.x + e.to.x) / 2, y: (e.from.y + e.to.y) / 2 };
        const ang = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x);
        const len = vdist(e.from, e.to);
        if (vfx === 'dismantle' || vfx === 'cleave' || vfx === 'worldcut') {
          // These are cuts, not beams. Dismantle comes as a lattice; Cleave is
          // one measured stroke; the World-Cutting Slash is a cut that keeps
          // going after the arm has stopped.
          const heavy = vfx !== 'dismantle';
          this.cutFan(mid.x, mid.y, e.focus ? e.focus.z : 1.2, ang, {
            len,
            slash: vfx === 'worldcut' ? 11 : vfx === 'cleave' ? 6 : 4.2,
            width: (e.width || 1) * (heavy ? 0.85 : 0.45),
            color: e.color || '#ff4d4d',
            style: vfx,
            count: vfx === 'dismantle' ? 3 : vfx === 'cleave' ? 1 : 2,
            cross: vfx === 'dismantle',
            rise: 0.18, fan: 0.2,
            life: heavy ? 0.7 : 0.55,
            max: heavy ? 0.7 : 0.55,
            stagger: 0.035,
          });
          this.impact(heavy ? 0.85 : 0.45, e.color || '#ff4d4d', heavy, heavy ? 0.34 : 0.2,
            { x: mid.x, y: mid.y, z: 1.2 }, vfx === 'worldcut');
          if (heavy) this.flash('#ffffff', 0.3, 0.1);
          break;
        }
        this.beam({ from: e.from, to: e.to, z: 1.1, width: e.width || 1, life: e.life || 0.28, color: e.color || '#ffffff', style: vfx });
        break;
      }
      case 'word':
      case 'word_dontmove':
      case 'word_blast':
      case 'word_crush':
      case 'word_explode':
        this.arc({ x: p.x, y: p.y, z: 1.4, angle: e.angle, range: e.range || 10, arc: e.arc || 0.6, color: e.color || '#f0e6c8', life: 0.34, width: 0.3, style: 'sound' });
        this.sprite({ x: p.x + Math.cos(e.angle || 0) * 2.4, y: p.y + Math.sin(e.angle || 0) * 2.4, z: 2.2, text: e.text || 'CURSED SPEECH', color: e.color || '#f0e6c8', size: 30, life: 0.9 });
        break;

      case 'divergent':
        this.ring({ x: p.x, y: p.y, z, r: 0.2, target: 2.6, life: 0.28, color: '#ff6b5a', width: 0.16, flat: false });
        this.burst(p.x, p.y, z, 14, { color: '#ff6b5a', speedMax: 9, lifeMax: 0.4, glow: 1 });
        break;
      case 'arc':
        this.bolt(e.from.x, e.from.y, e.z ?? 1, e.to.x, e.to.y, e.z ?? 1, {
          color: '#ffe066', width: 0.08, life: 0.2, jag: 0.5, segments: 9,
        });
        break;
      case 'copy':
        this.ring({ x: p.x, y: p.y, z, r: 2.4, target: 0.3, life: 0.4, color: '#b0e8ff', width: 0.12, flat: false });
        this.sprite({ x: p.x, y: p.y, z: z + 0.6, text: 'COPIED', color: '#b0e8ff', size: 24, life: 0.8 });
        break;
      case 'splash':
        this.burst(p.x, p.y, z, 12, { color: '#6fd0e8', speedMax: 5, lifeMax: 0.4, glow: 0.6 });
        break;
      case 'plating':
        this.burst(p.x, p.y, z, 8, { color: '#e8c46a', speedMax: 4, lifeMax: 0.35, kind: 'chunk', gravity: 12 });
        break;
      case 'reels':
        this.sprite({ x: p.x, y: p.y, z, text: '7 7 7', color: '#ffd166', size: 26, life: 0.9 });
        break;
      case 'jackpot':
        this.impact(0.9, '#ffd166', true, 0.5);
        this.ring({ x: p.x, y: p.y, z: 0.05, r: 0.3, target: 9, life: 0.8, color: '#ffd166', width: 0.3, flat: true });
        this.burst(p.x, p.y, 0.6, 70, { colors: ['#ffd166', '#ffffff', '#ff9f6b'], speedMax: 14, lifeMax: 1.4, glow: 1, gravity: 5 });
        this.sprite({ x: p.x, y: p.y, z: z + 1.6, text: 'JACKPOT', color: '#ffd166', size: 52, life: 1.4, style: 'flash' });
        break;
      default:
        // Slash family and anything unrecognised: draw a crescent so new
        // techniques always look like something.
        if (e.type.startsWith('slash') || e.type === 'claw' || e.type === 'cleave' ||
            e.type === 'dismantle' || e.type === 'worldcut' || e.type === 'soul_cut' ||
            e.type === 'spear_thrust' || e.type === 'grab' || e.type === 'shock') {
          this.arc({
            x: p.x, y: p.y, z: z, angle: e.angle ?? 0,
            range: e.range || 2.2, arc: e.arc || 0.9,
            color: col, life: 0.2, width: e.type.includes('heavy') || e.type.includes('smash') ? 0.32 : 0.18,
            style: e.type,
          });
          if (e.type.includes('heavy') || e.type.includes('smash')) {
            this.burst(p.x, p.y, z, 8, { color: col, angle: e.angle, spread: 0.7, speedMax: 6, lifeMax: 0.3 });
          }
        } else if (e.radius) {
          this.ring({ x: p.x, y: p.y, z, r: 0.2, target: e.radius, life: 0.4, color: col, width: 0.14, flat: false });
          this.burst(p.x, p.y, z, 20, { color: col, speedMax: e.radius * 2, lifeMax: 0.7, glow: 0.8 });
        } else {
          this.burst(p.x, p.y, z, 8, { color: col, speedMax: 4, lifeMax: 0.4 });
        }
        break;
    }
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  update(dt) {
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps.splice(i, 1); continue; }
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.gravity * dt;
      p.z += p.vz * dt;
      if (p.z < 0) {
        p.z = 0;
        p.vz *= -0.25;
        p.vx *= 0.6;
        p.vy *= 0.6;
        if (p.onGround === 'blood' && Math.abs(p.vz) < 0.4) {
          this.decal({ x: p.x, y: p.y, r: randRange(0.15, 0.4), color: '#7a0a16', style: 'blood', alpha: 0.5, life: 20 });
          p.life = 0;
        }
      }
      p.rot += p.spin * dt;
      if (p.grow) p.size += p.grow * dt;
    }

    // Cuts hold before they age: the delay is the beat between the flash and
    // the world coming apart, and nothing about the cut moves during it.
    for (let i = this.cuts.length - 1; i >= 0; i--) {
      const c = this.cuts[i];
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.life -= dt;
      if (c.life <= 0) this.cuts.splice(i, 1);
    }

    for (const list of [this.arcs, this.rings, this.beams, this.bolts, this.numbers, this.sprites, this.flashes, this.impacts]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        o.life -= dt;
        if (o.life <= 0) list.splice(i, 1);
      }
    }
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      r.current = lerp(r.r, r.target, easeOutQuint(t));
    }
    for (const n of this.numbers) {
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      n.vz -= 7 * dt;
      n.z += n.vz * dt;
      if (n.z < 0.2) { n.z = 0.2; n.vz = 0; }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      this.decals[i].life -= dt;
      if (this.decals[i].life <= 0) this.decals.splice(i, 1);
    }
  }

  get count() {
    return this.particles.length + this.arcs.length + this.rings.length +
      this.beams.length + this.bolts.length + this.sprites.length;
  }
}
