// HUD: resource bars, the Black Flash timing ring, ability rack, domain state,
// combo counter, banners, kill feed and the minimap.

import { clamp, clamp01, lerp, TAU, PI, vdist } from '../core/math.js';
import { hexA } from './characters.js';
import { flashWindowPhase, FLASH } from '../sim/combat.js';
import { DOMAIN_FLOW } from '../sim/fighter.js';
import { bestTarget } from '../sim/assist.js';
import { FLATTEN, HEIGHT } from './camera.js';
import { STATUS_META } from '../sim/status.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const JP = '"Noto Sans JP", system-ui, sans-serif';

export class Hud {
  constructor() {
    this.time = 0;
    this.hpSmooth = 1;
    this.ceSmooth = 1;
    this.hpChip = 1;
    this.comboShake = 0;
    this.showControls = true;
    this.controlsFade = 14;
    this.cutin = null;   // domain expansion announcement
    this.vs = null;      // opening name cards
  }

  /** The domain expansion announcement: split panels, calligraphy, the chant. */
  showDomainCutin({ en, chant, color, name, glyph }) {
    this.cutin = { en, chant, color, name, glyph: glyph || 'DOMAIN EXPANSION', t: 2.6, max: 2.6 };
  }

  showVersus(left, right) {
    // Delayed so the veil finishes falling before the cards slide in.
    this.vs = { left, right, t: 3.0, max: 3.0, delay: 1.3 };
  }

  draw(ctx, world, cam, W, H, dt) {
    this.time += dt;
    const p = world.player;
    if (!p || this.hidden || this.cinematicHidden) return;

    // A phone is not a small desktop. Panels laid out for 1280×760 cover a
    // third of a 844×390 screen each and land on top of one another; below
    // this the HUD shrinks and rearranges rather than just overflowing.
    this.small = Math.min(W, H) < 500;

    this.hpSmooth = lerp(this.hpSmooth, p.hpFraction, 1 - Math.exp(-14 * dt));
    this.hpChip = lerp(this.hpChip, p.hpFraction, 1 - Math.exp(-3 * dt));
    this.ceSmooth = lerp(this.ceSmooth, p.ceFraction, 1 - Math.exp(-16 * dt));

    ctx.save();
    ctx.textBaseline = 'alphabetic';

    if (cam?.firstPerson) this.drawCrosshair(ctx, world, cam, p, W, H);
    this.drawFlashRing(ctx, world, cam, p);
    this.drawVitals(ctx, world, p, W, H);
    this.drawAbilities(ctx, world, p, W, H);
    // On touch the on-screen buttons already say all of this, and they live
    // in exactly the same corner.
    if (!this.touchMode) this.drawDefensives(ctx, world, p, W, H);
    this.drawCombo(ctx, world, p, W, H, dt);
    this.drawTopBar(ctx, world, W, H);
    this.drawBossBars(ctx, world, W, H);
    this.drawDomainStatus(ctx, world, p, W, H);
    this.drawKillFeed(ctx, world, W, H);
    this.drawNotifications(ctx, world, W, H);
    this.drawBanners(ctx, world, W, H);
    this.drawMinimap(ctx, world, cam, W, H);
    this.drawStatuses(ctx, p, W, H);
    if (this.controlsFade > 0 && !this.vs && !this.cutin) {
      this.controlsFade -= dt;
      this.drawControlsHint(ctx, W, H, clamp01(this.controlsFade / 3));
    }
    this.drawVersus(ctx, W, H, dt);
    this.drawCutin(ctx, W, H, dt);
    if (world.over) this.drawResult(ctx, world, W, H);

    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Black Flash timing ring — the most important widget in the game.
  // -------------------------------------------------------------------------

  /**
   * First person needs a point of aim, and this one doubles as a tell.
   *
   * It opens while you are in recovery and closes as you come back to neutral,
   * so the moment you can act again is readable without looking at the HUD —
   * and it goes red the instant something is in range of the swing you are
   * holding, which is what sells the aim assist as help rather than magic.
   */
  drawCrosshair(ctx, world, cam, p, W, H) {
    const cx = W / 2;
    const cy = H / 2;
    const busy = p.state === 'attack' || p.state === 'cast';
    const spread = busy ? 9 : 0;
    const hot = !!bestTarget(world, p, p.aim, 3.4);
    const color = hot ? '#ff5d5d' : 'rgba(255,255,255,0.8)';
    const gap = 4 + spread;
    const len = 7;
    ctx.save();
    ctx.globalAlpha = cam.fpv;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.moveTo(cx + dx * gap, cy + dy * gap);
      ctx.lineTo(cx + dx * (gap + len), cy + dy * (gap + len));
    }
    ctx.stroke();
    // Centre dot, so a still crosshair still has a point.
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, 1.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawFlashRing(ctx, world, cam, p) {
    const phase = flashWindowPhase(p);
    const pos = cam.project(p.pos.x, p.pos.y, p.z);
    const cx = pos.x;
    const cy = pos.y - p.height * cam.scale * HEIGHT - 34;
    const r = 26;

    if (!phase) {
      // Idle: a faint hint that the mechanic exists.
      if (p.timeSinceDealt < 4) {
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }

    ctx.save();
    ctx.translate(cx, cy);

    // Track.
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.stroke();

    // The band: hitting inside this is a Black Flash.
    const a0 = -PI / 2 + phase.bandStart * TAU;
    const a1 = -PI / 2 + phase.bandEnd * TAU;
    const inBand = phase.t >= phase.bandStart && phase.t <= phase.bandEnd;
    ctx.strokeStyle = inBand ? '#ff2d2d' : 'rgba(255,45,45,0.55)';
    ctx.lineWidth = inBand ? 9 : 6;
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = inBand ? 22 : 8;
    ctx.beginPath();
    ctx.arc(0, 0, r, a0, a1);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Needle.
    const na = -PI / 2 + phase.t * TAU;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(Math.cos(na) * (r - 9), Math.sin(na) * (r - 9));
    ctx.lineTo(Math.cos(na) * (r + 9), Math.sin(na) * (r + 9));
    ctx.stroke();

    // Chain counter.
    if (phase.chain > 0) {
      ctx.font = `900 15px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff2d2d';
      ctx.fillText('×' + phase.chain, 0, 5);
    }
    if (inBand) {
      ctx.globalAlpha = 0.9;
      ctx.font = `800 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText('NOW', 0, r + 20);
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  /**
   * How much the bottom-left stack shrinks on a small screen, and the
   * transform that does it. Everything down there is anchored to the corner
   * and measured relative to it, so one scale about that corner is enough.
   */
  _shrinkCorner(ctx, W, H) {
    if (!this.small) return 1;
    // The touch button block claims the right 55% of a phone's width, so the
    // panel has to finish inside the rest of it — in portrait the full-size
    // bars ran straight under the technique buttons.
    const s = Math.min(0.66, (W * 0.44) / 336);
    ctx.translate(26, H);
    ctx.scale(s, s);
    ctx.translate(-26, -H);
    return s;
  }

  drawVitals(ctx, world, p, W, H) {
    const x = 26;
    const y = H - 118;
    const w = 300;

    // Portrait block.
    ctx.save();
    this._shrinkCorner(ctx, W, H);
    ctx.fillStyle = 'rgba(10,12,16,0.72)';
    roundRect(ctx, x - 12, y - 34, w + 24, 118, 10);
    ctx.fill();
    ctx.strokeStyle = hexA(p.technique?.color || '#ffffff', 0.25);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = `700 14px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.fillText(p.name, x, y - 14);
    const nameW = ctx.measureText(p.name).width;
    ctx.font = `500 11px ${FONT}`;
    ctx.fillStyle = hexA(p.technique?.color || '#ffffff', 0.8);
    ctx.fillText(p.technique ? p.technique.name : 'No technique', x + nameW + 12, y - 14);

    // Health.
    bar(ctx, x, y, w, 14, this.hpChip, '#5a1520', 1);
    bar(ctx, x, y, w, 14, this.hpSmooth, p.hasStatus('glassCannon') ? '#ff2d2d' : '#e64a52', 1, '#ff9a9a');
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillText(`${Math.ceil(Math.max(0, p.hp))} / ${Math.round(p.maxHp)}`, x + 6, y + 11);

    // Cursed energy.
    if (p.maxCe > 0) {
      const ceCol = p.flags.burnout ? '#7a5a2a' : '#3aa0ff';
      bar(ctx, x, y + 20, w, 11, this.ceSmooth, ceCol, 1, '#9fd8ff');
      ctx.font = `700 10px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`CE ${Math.round(p.ce)}`, x + 6, y + 29);
      // Reinforcement read-out: how much damage your energy is eating.
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(`reinforce ${Math.round(p.reinforcement * 100)}%`, x + w - 6, y + 29);
      ctx.textAlign = 'left';
    } else {
      ctx.font = `700 10px ${FONT}`;
      ctx.fillStyle = 'rgba(220,225,235,0.7)';
      ctx.fillText('HEAVENLY RESTRICTION — no cursed energy', x + 2, y + 29);
    }

    // Flow / domain readiness.
    const flowCol = p.flow >= DOMAIN_FLOW ? '#ff8a3a' : '#8a6a4a';
    bar(ctx, x, y + 36, w, 8, p.flow, flowCol, 1, '#ffd08a');
    ctx.font = `700 9px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(`FLOW ${Math.round(p.flow * 100)}%`, x + 5, y + 43);
    if (p.flow >= DOMAIN_FLOW && p.domainSpec()) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffd166';
      ctx.fillText('DOMAIN READY [X]', x + w - 5, y + 43);
      ctx.textAlign = 'left';
    }

    // Poise / guard.
    bar(ctx, x, y + 49, w, 6, clamp01(p.poise / p.maxPoise), '#c8a24a', 0.85);

    // Throat strain (Cursed Speech only).
    if (p.techniqueId === 'cursedSpeech') {
      bar(ctx, x, y + 58, w, 6, clamp01(p.throat / 100), p.throat > 70 ? '#ff4d4d' : '#c86a6a', 0.9);
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('THROAT', x + 4, y + 64);
    }

    // Wounds.
    if (p.wounds.arms > 0 || p.wounds.legs > 0) {
      ctx.font = `700 10px ${FONT}`;
      ctx.fillStyle = '#ff8a8a';
      const parts = [];
      if (p.wounds.arms > 0) parts.push(`ARMS ${Math.round(p.wounds.arms * 100)}%`);
      if (p.wounds.legs > 0) parts.push(`LEGS ${Math.round(p.wounds.legs * 100)}%`);
      ctx.fillText('WOUNDED · ' + parts.join(' · '), x, y + 74);
    }
    ctx.restore();
  }

  /**
   * The technique rack, as a list rather than a rack.
   *
   * On a phone the four cards sat across the bottom middle, directly on top of
   * the vitals panel and duplicating the on-screen 1–4 buttons a centimetre to
   * their right. The buttons keep the input; this keeps the information the
   * buttons cannot fit — what each one is, what it costs, and how long until
   * it comes back.
   */
  _drawAbilitiesCompact(ctx, p, W, H) {
    const abilities = p.abilityList();
    const w = Math.min(168, W * 0.44);
    const rowH = 15, gap = 3;
    const x = 12;
    // Clear of the touch layer's pause button, which owns the top-left corner.
    let y = this.touchMode ? 64 : 12;
    const col = p.technique?.color || '#ffffff';

    ctx.save();
    ctx.textBaseline = 'middle';
    for (let i = 0; i < abilities.length; i++) {
      const ab = abilities[i];
      const ready = p.abilityReady(i);
      const cd = p.cooldowns['ab' + i] || 0;
      const cdFrac = cd > 0 ? clamp01(cd / (ab.cooldown || 1)) : 0;
      const mid = y + rowH / 2;

      ctx.fillStyle = 'rgba(10,12,16,0.72)';
      roundRect(ctx, x, y, w, rowH, 4);
      ctx.fill();
      // The cooldown fills back in from the left, so the row is a progress bar.
      if (cdFrac > 0) {
        ctx.fillStyle = hexA(col, 0.18);
        ctx.fillRect(x, y, w * (1 - cdFrac), rowH);
      }
      roundRect(ctx, x, y, w, rowH, 4);
      ctx.strokeStyle = ready ? hexA(col, 0.7) : 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (ab.ultimate) {
        ctx.fillStyle = '#ffd166';
        ctx.fillRect(x, y + 2, 2, rowH - 4);
      }

      ctx.textAlign = 'left';
      ctx.font = `800 9px ${FONT}`;
      ctx.fillStyle = ready ? hexA(col, 0.95) : 'rgba(255,255,255,0.3)';
      ctx.fillText(String(i + 1), x + 6, mid);
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = ready ? '#ffffff' : 'rgba(255,255,255,0.32)';
      ctx.fillText(fitText(ctx, shortName(ab.name).toUpperCase(), w - 46), x + 16, mid);

      ctx.textAlign = 'right';
      if (cd > 0.05) {
        ctx.fillStyle = '#ffd166';
        ctx.fillText(cd.toFixed(1), x + w - 6, mid);
      } else {
        ctx.fillStyle = p.canAfford(ab.cost) ? 'rgba(120,200,255,0.9)' : 'rgba(255,120,120,0.9)';
        ctx.fillText(String(Math.round(ab.cost * p.costMultiplier())), x + w - 6, mid);
      }
      y += rowH + gap;
    }
    ctx.restore();
  }

  drawAbilities(ctx, world, p, W, H) {
    // Wherever the on-screen buttons are up they already carry 1–4, so the
    // card rack would be the same four techniques drawn a second time a
    // centimetre to their left.
    if (this.small || this.touchMode) { this._drawAbilitiesCompact(ctx, p, W, H); return; }
    const abilities = p.abilityList();
    const size = 52;
    const gap = 8;
    const total = abilities.length * (size + gap) - gap;
    const x0 = W / 2 - total / 2;
    const y = H - 76;

    ctx.save();
    for (let i = 0; i < abilities.length; i++) {
      const ab = abilities[i];
      const x = x0 + i * (size + gap);
      const ready = p.abilityReady(i);
      const cd = p.cooldowns['ab' + i] || 0;
      const cdFrac = cd > 0 ? clamp01(cd / (ab.cooldown || 1)) : 0;

      ctx.fillStyle = ready ? 'rgba(18,22,30,0.9)' : 'rgba(12,14,18,0.85)';
      roundRect(ctx, x, y, size, size, 8);
      ctx.fill();
      ctx.strokeStyle = ready ? hexA(p.technique?.color || '#ffffff', 0.8) : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = ready ? 2 : 1;
      ctx.stroke();

      // Cooldown sweep.
      if (cdFrac > 0) {
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, x, y, size, size, 8);
        ctx.clip();
        ctx.fillStyle = 'rgba(0,0,0,0.66)';
        ctx.fillRect(x, y, size, size * cdFrac);
        ctx.restore();
        ctx.font = `800 15px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(cd.toFixed(1), x + size / 2, y + size / 2 + 5);
      } else {
        // The card used to carry a single kanji, so 15px centred was plenty.
        // A word needs the size chosen to fit instead — and a long one needs
        // to wrap rather than be cut down to "Dis…".
        ctx.textAlign = 'center';
        ctx.fillStyle = ready ? (p.technique?.color || '#ffffff') : 'rgba(255,255,255,0.28)';
        // The label may lean a couple of pixels into the gap between cards;
        // that is cheaper than ellipsising a nine-letter technique name.
        drawFitWrapped(ctx, shortName(ab.name).toUpperCase(), x + size / 2, y + size / 2,
          size + gap - 6, 15, 7);
      }

      // Key + cost.
      ctx.font = `700 9px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText(String(i + 1), x + 5, y + 12);
      ctx.textAlign = 'right';
      ctx.fillStyle = p.canAfford(ab.cost) ? 'rgba(120,200,255,0.85)' : 'rgba(255,120,120,0.85)';
      ctx.fillText(String(Math.round(ab.cost * p.costMultiplier())), x + size - 5, y + size - 5);
      if (ab.ultimate) {
        ctx.fillStyle = '#ffd166';
        ctx.textAlign = 'right';
        ctx.fillText('MAX', x + size - 5, y + 12);
      }
      // The technique's own name goes under the card only when the card had to
      // show a cooldown instead of it.
      if (cd > 0.05) {
        ctx.font = `600 9px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(fitText(ctx, shortName(ab.name), size + gap - 2), x + size / 2, y + size + 12);
      }
    }
    ctx.restore();
  }

  drawDefensives(ctx, world, p, W, H) {
    const x = W - 26;
    const y = H - 118;
    const items = [
      {
        key: 'E', label: 'Simple Domain',
        active: p.simpleDomain.active,
        ready: p.maxCe > 0 && p.ce > 12,
        color: '#a8d8ff',
        note: p.simpleDomain.mastered ? 'MASTERED' : '',
      },
      {
        key: 'Z', label: 'Amplification',
        active: p.amplify.active,
        ready: p.maxCe > 0 && p.canAfford(30),
        color: '#cfa8ff',
        note: p.amplify.active ? p.amplify.t.toFixed(1) + 's' : '',
      },
      {
        key: 'R', label: 'Reverse CT',
        active: p.state === 'rct',
        ready: p.stats.rct > 0 && !p.flags.noRct && p.ce > 2,
        color: '#8ef0bd',
        note: p.flags.noRct ? 'VOW' : (p.stats.rct <= 0 ? 'N/A' : ''),
      },
      {
        key: 'X', label: 'Domain Expansion',
        active: !!p.domain,
        ready: p.domainReady(),
        color: p.technique?.domain?.color || '#ffffff',
        note: p.domainBlockReason(),
      },
    ];

    ctx.save();
    ctx.textAlign = 'right';
    let yy = y;
    for (const it of items) {
      const alpha = it.active ? 1 : (it.ready ? 0.85 : 0.32);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = it.active ? hexA(it.color, 0.22) : 'rgba(10,12,16,0.6)';
      roundRect(ctx, x - 252, yy - 13, 252, 24, 6);
      ctx.fill();
      ctx.strokeStyle = it.active ? it.color : hexA('#ffffff', 0.1);
      ctx.lineWidth = it.active ? 1.6 : 1;
      ctx.stroke();

      ctx.font = `800 10px ${FONT}`;
      ctx.fillStyle = it.color;
      ctx.textAlign = 'left';
      ctx.fillText(it.key, x - 244, yy + 4);
      ctx.font = `600 11px ${FONT}`;
      ctx.fillStyle = it.active ? '#ffffff' : 'rgba(255,255,255,0.75)';
      ctx.fillText(fitText(ctx, it.label, 114), x - 228, yy + 4);
      if (it.note && !it.ready) {
        ctx.font = `500 9px ${FONT}`;
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(255,160,160,0.8)';
        ctx.fillText(fitText(ctx, it.note, 100), x - 8, yy + 4);
      }
      yy += 28;
    }
    ctx.globalAlpha = 1;

    // Tool.
    ctx.textAlign = 'right';
    ctx.font = `700 11px ${FONT}`;
    ctx.fillStyle = hexA(p.tool?.color || '#ffffff', 0.9);
    ctx.fillText(`[C] ${p.tool?.name || 'Bare Hands'}`, x, yy + 6);
    ctx.restore();
  }

  drawCombo(ctx, world, p, W, H, dt) {
    if (p.combo.count < 2) { this.comboShake = 0; return; }
    const x = W - 60;
    const y = H * 0.36;
    this.comboShake = lerp(this.comboShake, 0, 1 - Math.exp(-8 * dt));
    if (p.timeSinceDealt < 0.05) this.comboShake = 1;
    const sh = this.comboShake * 5;

    ctx.save();
    ctx.textAlign = 'right';
    ctx.translate(Math.sin(this.time * 60) * sh, 0);
    const scale = 1 + this.comboShake * 0.14;
    ctx.font = `900 ${Math.round(42 * scale)}px ${FONT}`;
    ctx.fillStyle = p.combo.count >= 20 ? '#ff2d2d' : p.combo.count >= 10 ? '#ffd166' : '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillText(String(p.combo.count), x, y);
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('HITS', x, y + 16);
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`${Math.round(p.combo.damage)} dmg`, x, y + 32);
    // Combo timer.
    const frac = clamp01(p.combo.timer / 2.2);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillRect(x - 90 * frac, y + 38, 90 * frac, 3);
    ctx.restore();
  }

  drawTopBar(ctx, world, W, H) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 12px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    const mins = Math.floor(world.matchTime / 60);
    const secs = Math.floor(world.matchTime % 60);
    ctx.fillText(`${mins}:${String(secs).padStart(2, '0')}`, W / 2, 26);

    let sub = '';
    if (world.mode === 'gauntlet') sub = `WAVE ${world.wave}`;
    else if (world.mode === 'culling') sub = `${world.aliveCount ?? '?'} REMAIN · VEIL ${Math.round(world.veilRadius)}m`;
    else if (world.mode === 'duel') sub = 'DUEL';
    else sub = 'TRAINING';
    ctx.font = `800 11px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(sub, W / 2, 42);

    if (world.score) {
      ctx.font = `700 11px ${FONT}`;
      ctx.fillStyle = '#ffd166';
      ctx.fillText(`${Math.round(world.score)} pts`, W / 2, 58);
    }

    // Deadline vow.
    const p = world.player;
    if (p && p.deadlineTimer != null) {
      ctx.font = `900 20px ${FONT}`;
      ctx.fillStyle = p.deadlineTimer < 20 ? '#ff2d2d' : '#ffd166';
      ctx.fillText(`VOW ${p.deadlineTimer.toFixed(1)}`, W / 2, 84);
    }
    ctx.restore();
  }

  drawBossBars(ctx, world, W, H) {
    const p = world.player;
    if (!p) return;
    // Only show special grades that are actually part of the fight in front of
    // you — a free-for-all can have six on the board at once.
    const bosses = world.fighters
      .filter((f) => !f.dead && f.grade === 'special' && f.team !== p.team && !f.isSummon)
      .map((f) => ({ f, d: vdist(f.pos, p.pos) }))
      .filter((o) => o.d < 26 || o.f.id === p.lastHitBy || o.f.domain)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2)
      .map((o) => o.f);
    if (!bosses.length) return;
    ctx.save();
    let y = 74;
    for (const b of bosses) {
      const w = Math.min(560, W * 0.55);
      const x = W / 2 - w / 2;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, x - 2, y - 2, w + 4, 20, 4);
      ctx.fill();
      bar(ctx, x, y, w, 16, b.hpFraction, '#8a1020', 1, '#ff5a5a');
      ctx.font = `800 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${b.name} — SPECIAL GRADE`, W / 2, y + 12);
      if (b.domain) {
        ctx.font = `700 10px ${FONT}`;
        ctx.fillStyle = '#ff4d4d';
        ctx.fillText(`DOMAIN — barrier ${Math.round(b.domain.integrity)} / ${Math.round(b.domain.maxIntegrity)}`, W / 2, y + 30);
        y += 16;
      }
      y += 30;
    }
    ctx.restore();
  }

  /**
   * Everything the player needs to read a domain at a glance: whose it is, how
   * long it holds, how close the barrier is to breaking, whether the sure-hit
   * is currently reaching them, and who is winning a clash.
   */
  drawDomainStatus(ctx, world, p, W, H) {
    if (!world.domains.length) return;
    const mine = world.domains.find((d) => d.ownerId === p.id);
    const against = world.domains.find((d) => d.team !== p.team && d.contains(p.pos));
    if (!mine && !against) return;

    ctx.save();
    ctx.textAlign = 'center';
    let y = 142;

    const panel = (d, hostile) => {
      const w = Math.min(460, W * 0.42);
      const x = W / 2 - w / 2;
      ctx.fillStyle = 'rgba(6,8,12,0.78)';
      roundRect(ctx, x - 8, y - 18, w + 16, hostile ? 76 : 58, 8);
      ctx.fill();
      ctx.strokeStyle = hexA(d.spec.color, 0.5);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = `800 12px ${FONT}`;
      ctx.fillStyle = d.spec.color;
      ctx.fillText(d.spec.name.toUpperCase(), W / 2, y - 2);
      ctx.font = `600 10px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(hostile ? `${d.owner?.name ?? '?'} — ${d.spec.name}` : d.spec.name, W / 2, y + 11);

      // Labels above the bar so nothing overprints it.
      ctx.font = `700 9px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText(`BARRIER ${Math.round(Math.max(0, d.integrity))}`, x, y + 21);
      ctx.textAlign = 'right';
      const left = Math.max(0, d.duration - d.t);
      ctx.fillText(`${left.toFixed(1)}s LEFT`, x + w, y + 21);
      ctx.textAlign = 'center';

      // Barrier integrity: for a hostile domain this is your escape route.
      bar(ctx, x, y + 24, w, 9, d.integrityFrac, hostile ? '#ff8a4a' : d.spec.color, 1, '#ffffff');
      // Duration track underneath.
      bar(ctx, x, y + 35, w, 4, clamp01(1 - d.t / d.duration), 'rgba(255,255,255,0.35)', 0.8);

      if (hostile) {
        const guarded = p.simpleDomain.active;
        ctx.font = `800 10px ${FONT}`;
        ctx.fillStyle = guarded ? '#a8d8ff' : '#ff4d4d';
        ctx.fillText(
          guarded ? 'SURE-HIT NEUTRALISED — Simple Domain holding' : 'SURE-HIT — hold E for Simple Domain',
          W / 2, y + 51);
      }
      y += hostile ? 92 : 74;
    };

    if (against) panel(against, true);
    if (mine) panel(mine, false);

    // Clash: a tug-of-war between two barriers.
    const clashing = (mine && mine.clashWith) ? mine : null;
    if (clashing) {
      const w = Math.min(380, W * 0.34);
      const x = W / 2 - w / 2;
      const push = clamp(clashing.clashPressure / 3, -1, 1);
      ctx.fillStyle = 'rgba(6,8,12,0.75)';
      roundRect(ctx, x - 8, y - 16, w + 16, 40, 8);
      ctx.fill();
      ctx.font = `800 11px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('DOMAIN CLASH', W / 2, y - 2);
      // Centre-out bar: right is you winning.
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      roundRect(ctx, x, y + 6, w, 10, 5);
      ctx.fill();
      const half = w / 2;
      const len = Math.abs(push) * half;
      ctx.fillStyle = push >= 0 ? '#8ef0bd' : '#ff4d4d';
      ctx.fillRect(W / 2 + (push >= 0 ? 0 : -len), y + 6, len, 10);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(W / 2 - 1, y + 4, 2, 14);
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText(push >= 0 ? 'HOLD X TO PUSH — you are winning' : 'HOLD X TO PUSH — you are losing', W / 2, y + 30);
    }
    ctx.restore();
  }

  drawKillFeed(ctx, world, W, H) {
    ctx.save();
    ctx.textAlign = 'right';
    const box = this._minimapBox(W, H);
    ctx.font = `600 ${this.small ? 9 : 11}px ${FONT}`;
    let y = box.y + box.size + 28;   // clear of the minimap in the top-right corner
    const step = this.small ? 12 : 16;
    for (const k of world.killFeed.slice(-5)) {
      ctx.globalAlpha = clamp01(k.t / 1.2);
      ctx.fillStyle = k.color;
      ctx.fillText(k.text, W - box.m, y);
      y += step;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawNotifications(ctx, world, W, H) {
    ctx.save();
    ctx.textAlign = 'center';
    let y = H * 0.3;
    for (const n of world.notifications) {
      const a = clamp01(n.t / 0.6);
      ctx.globalAlpha = a;
      ctx.font = `800 15px ${FONT}`;
      ctx.fillStyle = n.color;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 6;
      ctx.fillText(n.text, W / 2, y);
      y += 22;
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawBanners(ctx, world, W, H) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const b of world.banners) {
      const t = 1 - b.t / b.max;
      const inA = clamp01(t / 0.12);
      const outA = clamp01(b.t / 0.35);
      const a = Math.min(inA, outA);
      ctx.globalAlpha = a;
      const yy = H * 0.26 + (1 - inA) * -20;
      const text = (b.text || '').toUpperCase();
      // A headline has to fit the screen it is printed on. At a fixed 34px
      // "TRAINING — LEARN THE BLACK FLASH BAND" is twice the width of a phone
      // and ran off both edges at once.
      const size = Math.round(34 + inA * 4);
      const maxW = W * 0.88;
      ctx.font = `900 ${size}px ${FONT}`;
      let tw = ctx.measureText(text).width;
      if (tw > maxW) {
        ctx.font = `900 ${Math.max(12, Math.floor(size * (maxW / tw)))}px ${FONT}`;
        tw = ctx.measureText(text).width;
      }
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 26;
      ctx.fillText(text, W / 2, yy);
      ctx.shadowBlur = 0;
      // A banner used to be two lines, a Japanese headline over its English.
      // There is only the one line now, so the subtitle is gone and the
      // underline moves up to sit against it.
      ctx.fillStyle = hexA(b.color, 0.7);
      const lw = Math.min(260, tw) * clamp01(t * 3);
      ctx.fillRect(W / 2 - lw / 2, yy + size * 0.4, lw, 2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** Where the minimap sits, so the kill feed can stay clear of it. */
  _minimapBox(W, H) {
    const size = this.small ? Math.round(Math.min(86, Math.min(W, H) * 0.26)) : 132;
    const m = this.small ? 12 : 26;
    return { size, x: W - size - m, y: m, m };
  }

  drawMinimap(ctx, world, cam, W, H) {
    const { size, x, y } = this._minimapBox(W, H);
    const scale = size / (world.arenaRadius * 2.1);
    const cx = x + size / 2;
    const cy = y + size / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(8,10,14,0.7)';
    roundRect(ctx, x, y, size, size, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, size, size, 8);
    ctx.clip();

    // Veil.
    const vr = (world.mode === 'culling' ? world.veilRadius : world.arenaRadius) * scale;
    ctx.strokeStyle = 'rgba(255,80,110,0.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, vr, 0, TAU);
    ctx.stroke();

    // Props.
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    for (const p of world.props) {
      if (p.destroyed) continue;
      ctx.fillRect(cx + p.pos.x * scale - 1, cy + p.pos.y * scale - 1, 2, 2);
    }
    // Domains.
    for (const d of world.domains) {
      ctx.strokeStyle = hexA(d.spec.color, 0.7);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx + d.center.x * scale, cy + d.center.y * scale, d.radius * scale, 0, TAU);
      ctx.stroke();
    }
    // Fighters.
    for (const f of world.fighters) {
      if (f.dead) continue;
      const fx = cx + f.pos.x * scale;
      const fy = cy + f.pos.y * scale;
      if (f.isPlayer) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(fx + Math.cos(f.facing) * 5, fy + Math.sin(f.facing) * 5);
        ctx.lineTo(fx + Math.cos(f.facing + 2.4) * 4, fy + Math.sin(f.facing + 2.4) * 4);
        ctx.lineTo(fx + Math.cos(f.facing - 2.4) * 4, fy + Math.sin(f.facing - 2.4) * 4);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillStyle = f.team === world.player?.team ? '#6fd4c4'
          : f.grade === 'special' ? '#ff4d4d' : '#e8a0a0';
        ctx.beginPath();
        ctx.arc(fx, fy, f.grade === 'special' ? 3.4 : 2.2, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
    ctx.restore();
  }

  drawStatuses(ctx, p, W, H) {
    if (!p.statuses.length) return;
    ctx.save();
    // Stacked on top of the vitals block, so it rides the same shrink.
    this._shrinkCorner(ctx, W, H);
    const x = 26;
    let y = H - 178;
    ctx.textAlign = 'left';
    for (const s of p.statuses.slice(0, 8)) {
      const meta = STATUS_META[s.type] || { name: s.type, color: '#ffffff' };
      const frac = clamp01(s.time / Math.max(0.01, s.maxTime || 1));
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, x, y - 10, 128, 14, 3);
      ctx.fill();
      ctx.fillStyle = hexA(meta.color, 0.35);
      ctx.fillRect(x, y - 10, 128 * frac, 14);
      ctx.font = `700 9px ${FONT}`;
      ctx.fillStyle = meta.color;
      const label = s.power > 1 && s.type === 'fragment' ? `${meta.name} ×${s.power}` : meta.name;
      ctx.fillText(label, x + 5, y);
      y -= 17;
    }
    ctx.restore();
  }

  drawControlsHint(ctx, W, H, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.75;
    ctx.textAlign = 'left';
    ctx.font = `600 11px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    // A ten-line legend is a reference card on a desktop and a blindfold on a
    // phone — it covered the player, the vitals and half the arena. There the
    // buttons are already labelled, so this only has to say what is not
    // written on one.
    const lines = this.small ? [
      'LEFT half  drag to move',
      'RIGHT half hold to attack',
      'MORE  the rest of the buttons',
      '',
      'BLACK FLASH — land your next hit',
      'while the ring’s red band is lit.',
    ] : this.touchMode ? [
      'LEFT half   drag to move',
      'RIGHT half  touch to aim, hold to attack',
      '1-4         cursed techniques',
      'BLK block   DSH dash   JMP jump   GRB grab',
      'SD  Simple Domain     AMP Amplification',
      'RCT Reverse Cursed Technique',
      'DOM Domain Expansion',
      '',
      'BLACK FLASH — land your next hit',
      'while the red band on the ring is lit.',
    ] : [
      'WASD  move          Mouse  aim',
      'LMB   light  ·  hold for heavy',
      'RMB   block  ·  TAP = PARRY',
      'Shift dash   Space jump   F grab',
      '1-4   cursed technique',
      'E     Simple Domain',
      'Z     Domain Amplification',
      'R     Reverse Cursed Technique',
      'X     Domain Expansion',
      'V     binding vow    C  cursed tool',
      'T     lock-on        Tab codex   Esc pause',
      '',
      'BLACK FLASH — land your next hit',
      'while the red band on the ring is lit.',
    ];
    const fs = this.small ? 9 : 11;
    const step = this.small ? 12 : 15;
    const boxW = this.small ? Math.min(196, W * 0.5) : 268;
    const x = this.small ? 12 : 18;
    // Sit the card just above the vitals block rather than across the middle
    // of the screen, where on a phone the fight is.
    let y = this.small ? H - 104 - lines.length * step : H * 0.30;
    ctx.fillStyle = 'rgba(6,8,12,0.55)';
    roundRect(ctx, x, y - 20, boxW, lines.length * step + 16, 8);
    ctx.fill();
    ctx.font = `600 ${fs}px ${FONT}`;
    for (const l of lines) {
      ctx.fillStyle = l.startsWith('BLACK') ? '#ff6b6b' : 'rgba(255,255,255,0.8)';
      ctx.fillText(l, x + 10, y - 4);
      y += step;
    }
    ctx.restore();
  }

  /**
   * Domain expansion cut-in. Two diagonal panels wipe in from opposite edges,
   * the technique name lands between them, and the caster's line sits under it.
   */
  drawCutin(ctx, W, H, dt) {
    const c = this.cutin;
    if (!c) return;
    c.t -= dt;
    if (c.t <= 0) { this.cutin = null; return; }
    const t = 1 - c.t / c.max;
    const wipeIn = clamp01(t / 0.16);
    const hold = clamp01((0.86 - t) / 0.14);
    const a = Math.min(wipeIn, hold);
    if (a <= 0) return;

    const bandH = H * 0.24;
    const cy = H * 0.40;
    const skew = H * 0.09;
    ctx.save();
    ctx.globalAlpha = a;

    // Upper panel slides in from the left, lower from the right.
    const offA = (1 - wipeIn) * -W;
    const offB = (1 - wipeIn) * W;
    const panel = (yTop, yBot, off, fill) => {
      ctx.beginPath();
      ctx.moveTo(off, yTop);
      ctx.lineTo(off + W, yTop - skew);
      ctx.lineTo(off + W, yBot - skew);
      ctx.lineTo(off, yBot);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    panel(cy - bandH * 0.5, cy + bandH * 0.04, offA, 'rgba(6,7,11,0.93)');
    panel(cy + bandH * 0.06, cy + bandH * 0.62, offB, 'rgba(6,7,11,0.86)');

    // Accent rails.
    ctx.strokeStyle = hexA(c.color, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(offA, cy + bandH * 0.04);
    ctx.lineTo(offA + W, cy + bandH * 0.04 - skew);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offB, cy + bandH * 0.06);
    ctx.lineTo(offB + W, cy + bandH * 0.06 - skew);
    ctx.stroke();

    // Text.
    ctx.textAlign = 'center';
    const push = (1 - wipeIn) * 40;
    ctx.save();
    ctx.translate(W / 2 + push, 0);
    ctx.font = `900 13px ${FONT}`;
    ctx.fillStyle = hexA(c.color, 0.85);
    ctx.fillText('DOMAIN EXPANSION', 0, cy - bandH * 0.3);
    ctx.font = `900 ${Math.round(Math.min(46, W * 0.037))}px ${FONT}`;
    ctx.fillStyle = c.color;
    ctx.shadowColor = c.color;
    ctx.shadowBlur = 26;
    ctx.fillText((c.en || '').toUpperCase(), 0, cy - bandH * 0.02);
    ctx.shadowBlur = 0;
    // The name used to appear twice, once in Japanese and once in English.
    // With one name there is one line, and the chant moves up into the gap.
    if (c.chant) {
      ctx.font = `500 italic 13px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(`"${c.chant}"`, 0, cy + bandH * 0.26);
    }
    if (c.name) {
      ctx.font = `700 12px ${FONT}`;
      ctx.fillStyle = hexA(c.color, 0.8);
      ctx.fillText(c.name, 0, cy + bandH * 0.44);
    }
    ctx.restore();
    ctx.restore();
  }

  /** Opening name cards, the way a fight is introduced on screen. */
  drawVersus(ctx, W, H, dt) {
    const v = this.vs;
    if (!v) return;
    if (v.delay > 0) { v.delay -= dt; return; }
    v.t -= dt;
    if (v.t <= 0) { this.vs = null; return; }
    const t = 1 - v.t / v.max;
    const inA = clamp01(t / 0.14);
    const outA = clamp01((1 - t) / 0.2);
    const a = Math.min(inA, outA);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'left';

    const cardH = 62;
    const slideL = (1 - inA) * -320;
    const slideR = (1 - inA) * 320;

    const card = (side, who, y) => {
      const x = side < 0 ? 40 + slideL : W - 40 - 360 + slideR;
      ctx.fillStyle = 'rgba(6,7,11,0.86)';
      roundRect(ctx, x, y, 360, cardH, 8);
      ctx.fill();
      ctx.fillStyle = who.color;
      ctx.fillRect(side < 0 ? x : x + 356, y, 4, cardH);
      ctx.font = `900 22px ${FONT}`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(who.name, x + 16, y + 28);
      ctx.font = `600 11px ${FONT}`;
      ctx.fillStyle = hexA(who.color, 0.9);
      ctx.fillText(who.title, x + 16, y + 44);
      ctx.font = `600 10px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.fillText(who.technique, x + 16, y + 57);
    };

    card(-1, v.left, H * 0.4 - cardH - 10);
    card(1, v.right, H * 0.4 + 10);

    ctx.textAlign = 'center';
    ctx.font = `900 30px ${FONT}`;
    ctx.fillStyle = '#ff2d2d';
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = 22;
    ctx.globalAlpha = a * clamp01((t - 0.1) * 6);
    ctx.fillText('VS', W / 2, H * 0.4 + 12);
    ctx.restore();
  }

  drawResult(ctx, world, W, H) {
    const r = world.result;
    if (!r) return;
    ctx.save();
    ctx.fillStyle = 'rgba(4,5,8,0.78)';
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.font = `900 46px ${FONT}`;
    ctx.fillStyle = r.victory ? '#8ef0bd' : '#ff4d4d';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 30;
    ctx.fillText(r.victory ? 'EXORCISM COMPLETE' : 'DEFEAT', W / 2, H / 2 - 60);
    ctx.shadowBlur = 0;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(r.message, W / 2, H / 2 - 24);

    const st = r.player || {};
    const rows = [
      ['Time', `${Math.floor(r.time / 60)}:${String(Math.floor(r.time % 60)).padStart(2, '0')}`],
      ['Damage dealt', String(st.damage ?? 0)],
      ['Exorcised', String(st.kills ?? 0)],
      ['Black Flashes', String(st.blackFlashes ?? 0)],
      ['Best chain', `×${st.bestChain ?? 0}`],
      ['Perfect parries', String(st.parries ?? 0)],
      ['Longest combo', String(r.stats.maxCombo ?? 0)],
      ['Domains opened', String(r.stats.domains ?? 0)],
      ['Score', String(Math.round(r.score))],
    ];
    ctx.font = `600 14px ${FONT}`;
    let y = H / 2 + 12;
    for (const [k, v] of rows) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(k, W / 2 - 12, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(v, W / 2 + 12, y);
      y += 21;
    }
    ctx.textAlign = 'center';
    ctx.font = `700 13px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Press ENTER to return to the menu', W / 2, y + 24);
    ctx.restore();
  }
}

// --- helpers ----------------------------------------------------------------

function bar(ctx, x, y, w, h, frac, color, alpha = 1, highlight) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  const fw = Math.max(0, w * clamp01(frac));
  if (fw > 1) {
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.clip();
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, highlight || color);
    g.addColorStop(0.5, color);
    g.addColorStop(1, shadeHex(color, 0.7));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, fw, h);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * Split a label into the pieces a line break may fall between.
 *
 * A space is consumed by the break; a hyphen stays attached to the piece
 * before it, so "World-Cutting Slash" can wrap as "WORLD-" / "CUTTING" /
 * "SLASH" rather than being cut down to "WORLD-CU…".
 */
function breakPieces(text) {
  const out = [];
  let cur = '';
  for (const ch of text) {
    if (ch === ' ') { if (cur) out.push(cur); cur = ''; }
    else if (ch === '-') { out.push(cur + '-'); cur = ''; }
    else cur += ch;
  }
  if (cur) out.push(cur);
  return out.length ? out : [text];
}

/** Greedy wrap of `pieces` into lines no wider than maxW at the current font. */
function wrapPieces(ctx, pieces, maxW) {
  const lines = [];
  let line = '';
  for (const piece of pieces) {
    const joiner = line && !line.endsWith('-') ? ' ' : '';
    const merged = line + joiner + piece;
    if (!line) { line = piece; continue; }
    if (ctx.measureText(merged).width <= maxW) line = merged;
    else { lines.push(line); line = piece; }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draw a label centred in a box, shrinking and wrapping until it fits.
 *
 * Steps down from maxSize and takes the first size whose greedy wrap comes in
 * at or under maxLines with every line inside maxW. Names here run from
 * "Cleave" to "World-Cutting Slash", so one rule has to cover both.
 */
function drawFitWrapped(ctx, text, cx, cy, maxW, maxSize, minSize, maxLines = 3) {
  const pieces = breakPieces(text);
  let best = null;
  for (let size = maxSize; size >= minSize; size--) {
    ctx.font = `800 ${size}px ${FONT}`;
    const lines = wrapPieces(ctx, pieces, maxW);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxW)) {
      best = { size, lines };
      break;
    }
  }
  if (!best) {
    ctx.font = `800 ${minSize}px ${FONT}`;
    best = { size: minSize, lines: wrapPieces(ctx, pieces, maxW).slice(0, maxLines) };
    best.lines = best.lines.map((l) => fitText(ctx, l, maxW));
  }
  ctx.font = `800 ${best.size}px ${FONT}`;
  const lh = best.size * 1.06;
  const top = cy - ((best.lines.length - 1) * lh) / 2 + best.size * 0.34;
  for (let i = 0; i < best.lines.length; i++) ctx.fillText(best.lines[i], cx, top + i * lh);
}

/** Trim a label with an ellipsis until it fits `maxW` pixels. */
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** Drop a qualifier prefix so "Open: Fire Arrow" reads as "Fire Arrow". */
function shortName(name) {
  const i = name.indexOf(': ');
  return i > 0 && i < name.length - 4 ? name.slice(i + 2) : name;
}

function shadeHex(hex, mul) {
  if (!hex || hex[0] !== '#') return hex;
  const h = hex.slice(1);
  const p = h.length === 3
    ? h.split('').map((c) => parseInt(c + c, 16))
    : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return `rgb(${p.map((v) => Math.round(clamp(v * mul, 0, 255))).join(',')})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
