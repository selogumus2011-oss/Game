// Bootstrap: wires input -> simulation -> presentation, and owns the app state
// machine (menu / playing / paused).

import { Loop, FIXED_DT } from './core/loop.js';
import { Input } from './core/input.js';
import { TouchControls } from './core/touch.js';
import { audio } from './core/audio.js';
import { clamp, clamp01, vangle, vsub, TAU, rand, randRange } from './core/math.js';
import { World } from './sim/world.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Camera3 } from './r3d/core3.js';
import { Renderer3D } from './r3d/scene3.js';
import { Effects } from './render/effects.js';
import { Hud } from './render/hud.js';
import { DomainCinematic, FlashCinematic } from './render/cinematic.js';
import { UI } from './ui/menus.js';
import { ROSTER, CHARACTERS } from './data/characters.js';
import { TECHNIQUES } from './data/techniques.js';
import { getArena } from './data/arenas.js';
import { LOOT_TABLE } from './data/tools.js';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.uiRoot = document.getElementById('ui');
    this.input = new Input(this.canvas);
    this.touch = new TouchControls(this.input, this.canvas);
    // Both presentation stacks run off the same simulation; the settings screen
    // swaps between them live and the HUD works against either camera.
    this.renderer2d = new Renderer(this.canvas);
    this.camera2d = new Camera(this.canvas);
    this.renderer3d = new Renderer3D(this.canvas);
    this.camera3d = new Camera3();
    this.mode3d = true;
    this.renderer = this.renderer3d;
    this.camera = this.camera3d;
    this.effects = new Effects();
    this.hud = new Hud();
    this.cinematic = new DomainCinematic();
    this.flashCine = new FlashCinematic();
    this.world = null;
    this.state = 'menu';
    this.chargeStart = -1;
    this.chargeFired = false;
    this.settings = null;
    this.firstPerson = false;
    // Radians of turn per pixel of mouse movement.
    this.lookSensitivity = 0.0026;

    this.ui = new UI(this.uiRoot, {
      onStart: (sel) => this.startMatch(sel),
      onResume: () => this.resume(),
      onQuit: () => this.quitToMenu(),
      onSettings: (s) => this.applySettings(s),
      onHover: () => audio.play('ui', { volume: 0.3, throttle: 40 }),
    });
    this.applySettings(this.ui.settings);

    this.loop = new Loop({
      update: (dt) => this.update(dt),
      render: (dt) => this.render(dt),
    });

    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.camera2d.resize(this.renderer.width, this.renderer.height);
      this.camera3d.resize(this.renderer.width, this.renderer.height);
    });
    this.camera2d.resize(this.renderer.width, this.renderer.height);
    this.camera3d.resize(this.renderer.width, this.renderer.height);

    // Audio needs a user gesture.
    const unlock = () => {
      audio.init();
      audio.resume();
      audio.setVolume(this.ui.settings.masterVolume);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    window.addEventListener('keydown', (e) => this.onKey(e));

    document.getElementById('boot')?.remove();
    this.ui.showTitle();
    this.loop.start();
  }

  applySettings(s) {
    this.settings = s;
    audio.setVolume(s.masterVolume);
    audio.sfxVolume = s.sfxVolume;
    if (audio.sfxGain) audio.sfxGain.gain.value = s.sfxVolume;
    this.effects.quality = s.particles;
    this.aimAssist = s.aimAssist ?? 0.7;
    this.lookSensitivity = (s.lookSensitivity ?? 1) * 0.0026;
    if (this.world) {
      this.world.aimAssist = this.aimAssist;
      if (this.world.player) this.world.player.aimAssist = this.aimAssist;
    }
    this.cinematic.enabled = s.cutscenes !== false;
    this.flashCine.enabled = s.cutscenes !== false;
    this.setRenderMode(s.render3d !== false);
    if (!!s.firstPerson !== this.firstPerson) this.setFirstPerson(!!s.firstPerson);
    for (const r of [this.renderer2d, this.renderer3d]) {
      r.settings.grain = s.grain;
      r.settings.showNames = s.showNames;
    }
  }

  /**
   * First or third person.
   *
   * The pointer lock is requested rather than taken: browsers only grant it
   * inside a user gesture, so Input holds the wish and redeems it on the next
   * click. Until then the camera is already in first person and the aim falls
   * back to the ground-plane cursor, which is playable if not ideal.
   */
  setFirstPerson(on) {
    if (!this.mode3d) on = false;
    this.firstPerson = on;
    const cam = this.camera3d;
    // Enter looking where the body is already facing, so the switch does not
    // spin you round.
    if (on && this.world?.player) cam.fpvYaw = this.world.player.aim;
    cam.setFirstPerson(on);
    this.input.setPointerLock(on);
    this.touch.firstPerson = on;
    if (this.settings) this.settings.firstPerson = on;
    this.world?.notify(on ? 'FIRST PERSON' : 'THIRD PERSON', '#8ad8ff');
  }

  /** Swap presentation stacks, carrying the framing across so it does not jump. */
  setRenderMode(on3d) {
    if (on3d === this.mode3d && this.renderer) return;
    this.mode3d = on3d;
    if (!on3d && this.firstPerson) this.setFirstPerson(false);
    const prev = this.camera;
    this.renderer = on3d ? this.renderer3d : this.renderer2d;
    this.camera = on3d ? this.camera3d : this.camera2d;
    this.renderer.resize();
    this.camera.resize(this.renderer.width, this.renderer.height);
    if (prev && prev !== this.camera) this.camera.snapTo(prev.x ?? 0, prev.y ?? 0);
    if (this.world) this.renderer.initWeather(this.world.arena);
  }

  onKey(e) {
    if (e.code === 'Escape') {
      if (this.state === 'playing') this.pause();
      else if (this.state === 'paused' && this.ui.screen === 'pause') this.resume();
    }
    if (e.code === 'Enter' && this.world && this.world.over) {
      this.quitToMenu();
    }
    if (e.code === 'Tab' && this.state === 'playing') {
      e.preventDefault();
      this.pause();
      this.ui.showCodex(() => this.ui.showPause());
    }
  }

  // -------------------------------------------------------------------------
  // Match lifecycle
  // -------------------------------------------------------------------------

  startMatch(sel) {
    this.effects.clear();
    audio.stopAllDrones();
    const world = new World({
      mode: sel.mode,
      arena: sel.arena,
      difficulty: sel.difficulty,
      seed: (Math.random() * 0xffffffff) >>> 0,
    });
    this.world = world;
    world.aimAssist = this.aimAssist ?? 0.7;

    const p = world.spawnPlayer(sel.character, { vows: sel.vows, tool: sel.tool, x: 0, y: 0, team: 0 });
    p.facing = -Math.PI / 2;

    switch (sel.mode) {
      case 'duel': {
        const pool = ROSTER.filter((id) => id !== sel.character);
        const foe = pool[Math.floor(Math.random() * pool.length)];
        const e = world.spawnSorcerer(foe, { team: 1, x: 0, y: -12 });
        e.facing = Math.PI / 2;
        const me = CHARACTERS[sel.character];
        const them = CHARACTERS[foe];
        this.hud.showVersus(
          { name: me.name, title: me.title, technique: TECHNIQUES[me.technique].name, color: me.appearance.accent },
          { name: them.name, title: them.title, technique: TECHNIQUES[them.technique].name, color: them.appearance.accent },
        );
        break;
      }
      case 'culling': {
        const pool = ROSTER.filter((id) => id !== sel.character).sort(() => Math.random() - 0.5);
        const n = 7;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU + 0.4;
          const r = world.arenaRadius * 0.72;
          world.spawnSorcerer(pool[i % pool.length], {
            team: i + 2, x: Math.cos(a) * r, y: Math.sin(a) * r,
          });
        }
        // Cursed tools on the ground.
        const total = LOOT_TABLE.reduce((s, [, w]) => s + w, 0);
        for (let i = 0; i < 10; i++) {
          let roll = Math.random() * total;
          let tool = 'katana';
          for (const [id, w] of LOOT_TABLE) { roll -= w; if (roll <= 0) { tool = id; break; } }
          const a = Math.random() * TAU;
          const r = Math.sqrt(Math.random()) * (world.arenaRadius - 6);
          world.spawnPickup(tool, { x: Math.cos(a) * r, y: Math.sin(a) * r });
        }
        world.banner('Culling Game — 8 players', '#cfa8ff', 3);
        break;
      }
      case 'training': {
        // Three dummies at different ranges, so you can practise a swing, a
        // mid-range technique and a long beam without walking between reps.
        // They are deliberately fat: a training dummy you can miss is a
        // training dummy that teaches you nothing.
        const spots = [{ x: 0, y: -6 }, { x: -7, y: -11 }, { x: 8, y: -14 }];
        for (const [i, spot] of spots.entries()) {
          const dummy = world.spawnCurse('hulkCurse', { x: spot.x, y: spot.y, team: 1 });
          dummy.name = i === 0 ? 'Training Dummy' : `Training Dummy ${i + 1}`;
          dummy.stats.maxHp = 99999;
          dummy.maxHp = dummy.hp = 99999;
          dummy.stats.poise = 250;
          dummy.radius = Math.max(dummy.radius, 1.15);
          world.controllers.delete(dummy.id);
        }
        const partner = world.spawnSorcerer('sevenThree', { team: 1, x: 6, y: -8 });
        partner.name = 'Sparring Partner';
        world.banner('Training — learn the Black Flash band', '#8ad8ff', 3);
        break;
      }
      default: {
        world.banner('Exorcism — survive every wave', '#8ad8ff', 2.6);
        break;
      }
    }

    this.renderer.initWeather(world.arena);
    // The veil drops over the arena before the fight starts.
    this.renderer.veilIntro = 2.1;
    this.renderer.veilIntroMax = 2.1;
    this.camera.snapTo(p.pos.x, p.pos.y);
    this.camera.zoom = 1.6;
    this.state = 'playing';
    this.input.clear();
    this.hud.controlsFade = 16;
    audio.init();
    audio.resume();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    audio.stopAllDrones();
    this.ui.showPause();
  }

  resume() {
    this.state = 'playing';
    this.input.enabled = true;
    this.input.clear();
    this.ui.hide();
  }

  quitToMenu() {
    this.state = 'menu';
    this.input.enabled = true;
    this.world = null;
    this.effects.clear();
    audio.stopAllDrones();
    this.ui.showTitle();
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt) {
    this.input.update(dt);
    this.touch.resize(this.renderer.width, this.renderer.height);
    this.touch.update(dt);
    this.hud.touchMode = this.touch.active;

    if (this.state === 'playing' && this.world) {
      const w = this.world;
      if (!w.over) this.readPlayerInput(dt, w);
      w.update(dt);
      this.drainWorld(w);
      // The cutscene claims the camera before the follow rig reads it.
      this.cinematic.update(dt, w, this.camera);
      // A Black Flash landing inside a domain expansion still gets its impact
      // frames; it just does not get to take the shot away from the domain.
      if (!this.cinematic.owningCamera) this.flashCine.update(dt, w, this.camera);
      else this.flashCine.active = null;
      this.camera.update(dt, w, w.player, this.input);
      this.updateDrones(w);
    } else if (this.state === 'menu') {
      this.camera.update(dt, { fighters: [], domains: [], mode: 'menu' }, null, this.input);
    }

    this.effects.update(dt);
    this.input.lateUpdate();
  }

  readPlayerInput(dt, world) {
    const p = world.player;
    if (!p || p.dead) return;
    const it = p.intent;
    const input = this.input;

    // First person is only offered by the 3D stack — the 2.5D renderer has no
    // eye to sit behind.
    if (input.consume('firstPerson') && this.mode3d) this.setFirstPerson(!this.firstPerson);
    const fpv = this.firstPerson && this.mode3d;

    // Lock-on: T cycles the nearest live enemy, and aim snaps to it.
    if (input.consume('lock')) this.toggleLock(world, p);
    let locked = it.lockTarget ? world.byId(it.lockTarget) : null;
    if (locked && (locked.dead || Math.hypot(locked.pos.x - p.pos.x, locked.pos.y - p.pos.y) > 26)) {
      locked = null;
      it.lockTarget = null;
    }

    if (fpv) {
      // Mouse look. The cursor is locked, so the camera's own yaw is the aim —
      // no unprojecting onto a ground plane the player may not even be looking
      // at. A stick or a drag on the right half of a tablet feeds the same call.
      const cam = this.camera3d;
      const sens = this.lookSensitivity;
      if (input.pointerLocked) cam.look(-input.look.x * sens, -input.look.y * sens);
      else if (input.usingTouch) cam.look(-input.look.x * sens * 1.6, -input.look.y * sens * 1.6);
      if (input.usingGamepad && (Math.abs(input.aimStick.x) > 0.15 || Math.abs(input.aimStick.y) > 0.15)) {
        cam.look(-input.aimStick.x * 2.6 * dt, input.aimStick.y * 1.8 * dt);
      }
      // Lock-on still wins: it points the whole view, not just the swing.
      if (locked) {
        const want = vangle(vsub(locked.pos, p.pos));
        let d = want - cam.fpvYaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        cam.fpvYaw += d * Math.min(1, dt * 9);
      }
      it.aim = cam.fpvYaw;
    } else if (locked) {
      it.aim = vangle(vsub(locked.pos, p.pos));
    } else if (input.usingGamepad && (Math.abs(input.aimStick.x) > 0.2 || Math.abs(input.aimStick.y) > 0.2)) {
      it.aim = Math.atan2(input.aimStick.y, input.aimStick.x);
    } else {
      const m = this.camera.unproject(input.mouse.x, input.mouse.y);
      const d = vsub(m, p.pos);
      if (Math.hypot(d.x, d.y) > 0.25) it.aim = vangle(d);
    }

    const mv = input.moveVector();
    it.move.x = mv.x;
    it.move.y = mv.y;

    // Light tap vs. charged heavy on the same button.
    if (input.pressed('attack')) {
      this.chargeStart = input.time;
      this.chargeFired = false;
    }
    if (input.down('attack') && !this.chargeFired && this.chargeStart >= 0) {
      if (input.time - this.chargeStart > 0.26) {
        it.attackCharged = true;
        this.chargeFired = true;
        input.dropBuffer('attack');
      }
    }
    if (input.released('attack')) {
      if (!this.chargeFired && this.chargeStart >= 0) it.attackTap = true;
      this.chargeStart = -1;
      this.chargeFired = false;
    }
    // Buffered taps (pressed and released inside a single frame batch).
    if (!it.attackTap && !it.attackCharged && input.consume('attack', 0.05) && this.chargeStart < 0) {
      it.attackTap = true;
    }

    it.block = input.down('block');
    if (input.pressed('block')) it.parryPressed = true;
    if (input.consume('dash')) it.dash = true;
    if (input.consume('jump')) it.jump = true;
    if (input.consume('grab')) it.grab = true;
    for (let i = 0; i < 4; i++) {
      if (input.consume('ability' + (i + 1))) { it.ability = i; break; }
    }
    if (input.consume('domain')) it.domain = true;
    it.domainPush = input.down('domain');
    if (input.consume('amplify')) it.amplify = true;
    if (input.consume('tool')) it.tool = true;
    it.simpleDomain = input.down('simpleDomain');
    it.rct = input.down('rct');

    if (input.consume('vow')) this.openVowPicker(world, p);
  }

  /** Cycle lock-on through enemies by screen proximity to the crosshair. */
  toggleLock(world, p) {
    if (p.intent.lockTarget) {
      p.intent.lockTarget = null;
      world.notify('Lock released', '#9aa3ad');
      return;
    }
    const m = this.camera.unproject(this.input.mouse.x, this.input.mouse.y);
    let best = null, bestScore = Infinity;
    for (const f of world.fighters) {
      if (f.dead || f.team === p.team || f.decoy) continue;
      const d = Math.hypot(f.pos.x - p.pos.x, f.pos.y - p.pos.y);
      if (d > 24) continue;
      const toCursor = Math.hypot(f.pos.x - m.x, f.pos.y - m.y);
      const score = d * 0.4 + toCursor;
      if (score < bestScore) { bestScore = score; best = f; }
    }
    if (best) {
      p.intent.lockTarget = best.id;
      world.notify(`Locked: ${best.name}`, '#ffd166');
      world.audio('ui', { volume: 0.5, pitch: 1.4 });
    } else {
      world.notify('No target', '#9aa3ad');
    }
  }

  openVowPicker(world, p) {
    this.state = 'paused';
    this.input.enabled = false;
    this.ui.showImpromptuVows(p, (vow) => {
      this.state = 'playing';
      this.input.enabled = true;
      this.input.clear();
      if (!vow) return;
      vow.apply(p, world);
      world.audio('vow', { volume: 1 });
      world.banner(vow.name, '#ffd166', 2.2);
      world.fx('buffAura', { pos: { x: p.pos.x, y: p.pos.y }, color: '#ffd166' });
      p.vows.push(vow);
    });
  }

  /** Move everything the simulation produced into the presentation layer. */
  drainWorld(w) {
    for (const e of w.fxQueue) this.effects.handle(e);
    w.fxQueue.length = 0;

    for (const a of w.audioQueue) audio.play(a.name, a.opts);
    w.audioQueue.length = 0;

    for (const ev of w.events) {
      if (ev.type === 'damage') {
        const isPlayerVictim = w.player && ev.victim === w.player.id;
        const isPlayerAttacker = w.player && ev.attacker === w.player.id;
        if (ev.kind === 'dot' && ev.damage < 3) continue;
        const text = ev.text || String(Math.max(1, Math.round(ev.damage)));
        let color = '#ffffff';
        let size = 15;
        let weight = 700;
        if (ev.blackFlash) { color = '#ff2d2d'; size = 34; weight = 900; }
        else if (ev.crit) { color = '#ffd166'; size = 21; weight = 800; }
        else if (ev.kind === 'block') { color = '#9fc0e0'; size = 12; }
        else if (isPlayerVictim) { color = '#ff8a8a'; size = 17; }
        else if (ev.kind === 'dot') { color = '#c8a0a0'; size = 12; weight = 600; }
        this.effects.number(ev.pos.x, ev.pos.y, ev.z ?? 1.4, text, ev.color || color, {
          size, weight, crit: !!ev.blackFlash || !!ev.crit,
        });
        if (ev.blackFlash && isPlayerAttacker) this.camera.punchZoom(0.22);

        // Cursed techniques get an impact frame when they connect. Black Flash
        // already has its own, and chip damage does not earn one — the weight
        // comes from how much of the victim's health the hit actually took.
        if (!ev.blackFlash && ev.kind !== 'dot' && ev.kind !== 'block' &&
            ev.tags && ev.tags.includes('technique')) {
          const victim = w.byId(ev.victim);
          const attacker = w.byId(ev.attacker);
          const frac = victim ? ev.damage / Math.max(1, victim.maxHp) : 0;
          const weight = frac * 5.2 + (ev.crit ? 0.2 : 0) +
            (isPlayerVictim || isPlayerAttacker ? 0.12 : -0.1);
          this.effects.techniqueImpact(ev.pos, ev.z,
            ev.color || attacker?.technique?.color || null, weight, {
              abilityId: ev.abilityId,
              techniqueId: ev.techniqueId || attacker?.technique?.id,
              angle: ev.angle,
            });
        }
      } else if (ev.type === 'abilityStart') {
        // Name the technique as it comes out, the way the show does.
        if (ev.label) {
          this.effects.sprite({
            x: ev.pos.x, y: ev.pos.y, z: ev.z,
            text: ev.label.toUpperCase(), color: ev.color,
            size: ev.ultimate ? 24 : 17, life: ev.ultimate ? 1.1 : 0.8,
            style: ev.ultimate ? 'flash' : 'callout',
          });
        }
        if (ev.ultimate) {
          // An ultimate coming out is worth a frame on its own, focused on the
          // caster, before whatever it does on contact.
          this.effects.impact(0.7, ev.color || '#ffffff', false, 0.3,
            { x: ev.pos.x, y: ev.pos.y, z: ev.z ?? 1.4 });
          if (w.player && ev.fighter === w.player.id) this.camera.punchZoom(0.12);
        }
      } else if (ev.type === 'domainCast') {
        // Announce the expansion the moment the chant starts.
        const caster = w.byId(ev.fighter);
        const spec = caster?.domainSpec();
        if (spec) {
          // The cutscene draws its own title cards, so the flat HUD cut-in is
          // only the fallback for when cutscenes are switched off.
          if (!this.cinematic.start(caster, spec, w)) {
            this.hud.showDomainCutin({
              en: spec.name, chant: spec.chant,
              color: spec.color, name: caster.name,
            });
          }
        }
      } else if (ev.type === 'domainOpen') {
        this.camera.punchZoom(-0.14);
      } else if (ev.type === 'parry') {
        this.camera.punchZoom(0.1);
      } else if (ev.type === 'blackflash') {
        const att = w.byId(ev.attacker);
        const vic = w.byId(ev.victim);
        // The cut is the player's moment. An enemy landing one on you gets the
        // impact frames and the screen shake, but the camera stays where it is.
        const mine = w.player && ev.attacker === w.player.id;
        const at = vic
          ? { x: vic.pos.x, y: vic.pos.y, z: vic.z + vic.height * 0.62 }
          : { x: att?.pos.x ?? 0, y: att?.pos.y ?? 0, z: 1.2 };
        const took = mine && att
          && this.flashCine.start(att, vic, at, ev.chain, w);
        if (!took) {
          // No cut: the callout still has to land, so it goes into the world
          // where the old one always was.
          this.effects.sprite({
            x: at.x, y: at.y, z: at.z + 0.9, text: 'BLACK FLASH',
            color: '#ff2d2d', size: 64, life: 1.1, style: 'flash',
          });
        }
        this.camera.punchZoom(0.26);
      }
    }
    w.events.length = 0;

    if (w.shakeAmount > 0) {
      this.camera.addTrauma(w.shakeAmount * (this.settings?.shake ?? 1));
      w.shakeAmount = 0;
    }
  }

  /** Continuous audio layers driven by ongoing state. */
  updateDrones(w) {
    const p = w.player;
    if (!p) return;
    // Domain drone.
    const dom = w.domains[0];
    if (dom) {
      audio.startDrone('domain', {
        gain: 0.1,
        voices: [
          { freq: 34, type: 'sine', cutoff: 200, lfo: 0.2, lfoAmt: 30 },
          { freq: 51, type: 'sawtooth', cutoff: 320, q: 6, lfo: 0.13, lfoAmt: 80 },
        ],
        noise: { freq: 180, gain: 0.05, type: 'lowpass' },
      });
    } else {
      audio.stopDrone('domain', 0.8);
    }
    // Simple Domain hum.
    if (p.simpleDomain.active) {
      audio.startDrone('simple', {
        gain: 0.05,
        voices: [{ freq: 320, type: 'triangle', cutoff: 900, lfo: 5, lfoAmt: 120 }],
      });
    } else {
      audio.stopDrone('simple', 0.2);
    }
    // Reverse cursed technique shimmer.
    if (p.state === 'rct') {
      audio.startDrone('rct', {
        gain: 0.05,
        voices: [
          { freq: 523, type: 'sine', cutoff: 1800, lfo: 3, lfoAmt: 60 },
          { freq: 784, type: 'sine', cutoff: 2200, lfo: 4.5, lfoAmt: 40 },
        ],
      });
    } else {
      audio.stopDrone('rct', 0.3);
    }
  }

  render(dt) {
    const r = this.renderer;
    const ctx = r.ctx;
    if (this.state === 'menu' || !this.world) {
      this.renderMenuBackdrop(ctx, r.width, r.height, dt);
      return;
    }
    r.autoQuality(this.loop.fps);
    // The cutscene drains the colour out of the world while it plays.
    r.drain = Math.max(this.cinematic.drain, this.flashCine.drain);
    this.effects.quality = (this.settings?.particles ?? 1) * r.quality;
    r.render(this.world, this.camera, this.effects, dt);
    // The HUD steps aside for a cutscene — it is a different kind of shot.
    this.hud.cinematicHidden = !!this.cinematic.active || !!this.flashCine.active;
    this.hud.draw(ctx, this.world, this.camera, r.width, r.height, dt);
    this.cinematic.draw(ctx, r.width, r.height, dt);
    this.flashCine.draw(ctx, r.width, r.height, dt);
    if (!this.cinematic.active) this.touch.draw(ctx, this.world.player);
    if (this.state === 'paused') {
      ctx.save();
      ctx.fillStyle = 'rgba(4,5,8,0.55)';
      ctx.fillRect(0, 0, r.width, r.height);
      ctx.restore();
    }
  }

  renderMenuBackdrop(ctx, W, H, dt) {
    const t = performance.now() / 1000;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0b12');
    g.addColorStop(0.6, '#0e1019');
    g.addColorStop(1, '#141020');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Slow drifting cursed energy.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 42; i++) {
      const x = ((i * 137.5 + t * (12 + (i % 7) * 5)) % (W + 200)) - 100;
      const y = (Math.sin(i * 1.7 + t * 0.35) * 0.4 + 0.5) * H;
      const r = 40 + (i % 5) * 30;
      const a = 0.025 + (i % 3) * 0.012;
      const col = i % 3 === 0 ? '#7fd7ff' : i % 3 === 1 ? '#9a4cff' : '#ff3b30';
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, hexAlpha(col, a));
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    // Floating glyphs.
    ctx.font = '900 48px system-ui, sans-serif';
    const glyphs = ['CURSED', 'DOMAIN', 'FLASH', 'VOW', 'REVERSAL', 'BARRIER'];
    for (let i = 0; i < glyphs.length; i++) {
      const x = ((i * 220 + t * 8) % (W + 300)) - 150;
      const y = H * (0.2 + ((i * 37) % 60) / 100);
      ctx.globalAlpha = 0.035 + 0.02 * Math.sin(t + i);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(glyphs[i], x, y);
    }
    ctx.restore();

    // Vignette + grain to match the in-game look.
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.7)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
    if (this.renderer.grainCanvas) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.translate(-(Math.random() * 128 | 0), -(Math.random() * 128 | 0));
      ctx.fillStyle = ctx.createPattern(this.renderer.grainCanvas, 'repeat');
      ctx.fillRect(0, 0, W + 128, H + 128);
      ctx.restore();
    }
  }
}

function hexAlpha(hex, a) {
  const h = hex.replace('#', '');
  const n = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
}

window.addEventListener('DOMContentLoaded', () => {
  window.game = new Game();
});
