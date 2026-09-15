// Domain Expansion cutscene.
//
// A domain expansion is the largest thing a sorcerer can do, and the show never
// treats it as another move coming out — it stops, cuts to the caster, lets them
// say the words, stamps the name, and only then closes the barrier. This plays
// that sequence over the live simulation: the camera is taken away from the
// follow rig, the world drops to a fraction of its speed, black bars come in,
// and the beats run on real time so the cast still costs almost nothing in
// game time.
//
//   SEAL    the shot cuts to a low angle on the caster, colour drains
//   CHANT   a slow orbit while the incantation types itself in
//   CALL    DOMAIN EXPANSION slams, the name stamps under it, everything whites out
//   CLOSE   the camera rockets back and up as the barrier unfolds
//
// The whole thing aborts instantly if the chant is interrupted, because a
// domain that got punched out of someone is not a cinematic.

import { clamp, clamp01, lerp, TAU, PI } from '../core/math.js';

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';


// Beat boundaries in seconds of real time.
const SEAL = 0.34;
const CHANT = 1.06;
const CALL = 1.44;
const CLOSE = 2.05;

export class DomainCinematic {
  constructor() {
    this.active = null;
    this.enabled = true;
  }

  /**
   * Begin the sequence. `caster` is the fighter chanting; `spec` its domain.
   * Returns false when the cutscene is switched off or one is already running.
   */
  start(caster, spec, world) {
    if (!this.enabled || this.active) return false;
    this.active = {
      id: caster.id, spec, world,
      casterName: caster.name,
      t: 0,
      // Orbit the caster from a side the camera is not already on, so the beat
      // reads as a cut to another shot rather than a zoom on the same one.
      side: (caster.id % 2 ? 1 : -1),
      aborted: false,
      opened: false,
      flash: 0,
      chars: 0,
    };
    // The chant runs at a fraction of world speed: cinematic in real time,
    // nearly free in game time, and the opponent cannot walk through it.
    world.slowmo(0.42, 2.2);
    return true;
  }

  /** True while the camera belongs to the cutscene. */
  get owningCamera() { return !!this.active && !this.active.aborted; }

  update(dt, world, cam) {
    const c = this.active;
    if (!c) return;
    c.t += dt;

    const caster = world.byId(c.id);
    // Interrupted, dead, or simply gone: drop the whole thing on the spot.
    if (!caster || caster.dead) { this.active = null; return; }
    if (caster.domain) c.opened = true;
    if (!c.opened && caster.state !== 'domainCast') {
      this.active = null;
      return;
    }
    if (c.t >= CLOSE) { this.active = null; return; }

    this._driveCamera(c, caster, cam);
  }

  _driveCamera(c, caster, cam) {
    // The 2D camera has no orbit to take over; it gets the letterbox and the
    // push-in and nothing else.
    if (cam.baseYaw === undefined) {
      if (c.t < CALL) cam.punchZoom(0.18);
      return;
    }
    const t = c.t;
    const px = caster.pos.x, py = caster.pos.y;
    const h = caster.height;
    let yaw, pitch, dist, lz, weight;

    if (t < SEAL) {
      // The cut: already at the close angle when the bars land, not swinging
      // into it. A cut is a cut.
      const k = clamp01(t / 0.08);
      yaw = cam.baseYaw + c.side * 1.15;
      pitch = 0.1;
      dist = 2.5;
      lz = h * 0.68;
      weight = k;
    } else if (t < CHANT) {
      // A slow creep around and up while they speak.
      const k = (t - SEAL) / (CHANT - SEAL);
      yaw = cam.baseYaw + c.side * (1.15 - k * 0.5);
      pitch = lerp(0.1, 0.28, k);
      dist = lerp(2.5, 4.2, k);
      lz = h * lerp(0.68, 0.8, k);
      weight = 1;
    } else if (t < CALL) {
      // The punch in on the name.
      const k = (t - CHANT) / (CALL - CHANT);
      yaw = cam.baseYaw + c.side * 0.65;
      pitch = lerp(0.28, 0.2, k);
      dist = lerp(4.2, 2.4, k * k);
      lz = h * 0.8;
      weight = 1;
    } else {
      // Rocket back and up over the barrier as it unfolds.
      const k = clamp01((t - CALL) / (CLOSE - CALL));
      const e = 1 - Math.pow(1 - k, 3);
      const R = c.spec.radius || 12;
      yaw = cam.baseYaw + c.side * lerp(0.65, 0.12, e);
      pitch = lerp(0.2, 0.95, e);
      dist = lerp(2.5, R * 1.5, e);
      lz = h * 0.8 + e * 2.4;
      // Hand the camera back over the last third rather than snapping.
      weight = 1 - clamp01((k - 0.62) / 0.38);
    }

    cam.override = {
      yaw, pitch, dist,
      lookAt: { x: px, y: py, z: lz },
      weight: clamp01(weight),
    };
  }

  // -------------------------------------------------------------------------
  // Drawing. Runs last, over the HUD.
  // -------------------------------------------------------------------------

  draw(ctx, W, H, dt) {
    const c = this.active;
    if (!c) return;
    const t = c.t;
    const spec = c.spec;

    // --- letterbox ----------------------------------------------------------
    const inK = clamp01(t / 0.13);
    const outK = clamp01((CLOSE - t) / 0.3);
    const bar = H * 0.13 * Math.min(inK, outK);
    if (bar > 0.5) {
      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, W, bar);
      ctx.fillRect(0, H - bar, W, bar);
      // A hairline in the technique's colour along each bar.
      ctx.fillStyle = hexA(spec.color, 0.5);
      ctx.fillRect(0, bar - 1.5, W, 1.5);
      ctx.fillRect(0, H - bar, W, 1.5);
      ctx.restore();
    }

    ctx.save();
    ctx.textAlign = 'center';

    // --- the incantation, typed in ------------------------------------------
    if (t > SEAL * 0.6 && t < CALL) {
      const k = clamp01((t - SEAL * 0.6) / (CHANT - SEAL * 0.6));
      const text = spec.chant || '';
      const n = Math.floor(text.length * Math.min(1, k * 1.25));
      const fade = clamp01((CALL - t) / 0.18);
      ctx.globalAlpha = fade;
      ctx.font = `500 ${Math.round(Math.min(21, W * 0.016))}px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      const line = text.slice(0, n);
      const y = H - bar - 34;
      ctx.shadowColor = 'rgba(0,0,0,0.9)';
      ctx.shadowBlur = 10;
      ctx.fillText(line, W / 2, y);
      // The caster's name above it, small.
      ctx.font = `700 ${Math.round(Math.min(13, W * 0.01))}px ${FONT}`;
      ctx.fillStyle = hexA(spec.color, 0.85);
      ctx.fillText(c.casterName || '', W / 2, y - 24);
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    }

    // --- The call, then the name -------------------------------------------
    if (t > CHANT) {
      const k = clamp01((t - CHANT) / 0.2);
      const out = clamp01((CLOSE - 0.25 - t) / 0.3);
      const a = Math.min(k, out);
      if (a > 0) {
        ctx.globalAlpha = a;
        // DOMAIN EXPANSION rides in from the left on a slight skew.
        const slide = (1 - k) * -W * 0.5;
        const big = Math.round(Math.min(52, W * 0.038));
        ctx.save();
        ctx.translate(W / 2 + slide, H * 0.42);
        ctx.rotate(-0.045);
        ctx.font = `900 ${big}px ${FONT}`;
        ctx.lineWidth = Math.max(4, big * 0.1);
        ctx.strokeStyle = '#000000';
        ctx.strokeText('DOMAIN EXPANSION', 0, 0);
        ctx.fillStyle = '#ffffff';
        ctx.fillText('DOMAIN EXPANSION', 0, 0);
        ctx.restore();

        // The domain's own name stamps a beat later, from the right.
        if (t > CHANT + 0.16) {
          const k2 = clamp01((t - CHANT - 0.16) / 0.16);
          const slide2 = (1 - k2) * W * 0.5;
          const mid = Math.round(Math.min(40, W * 0.03));
          ctx.save();
          ctx.globalAlpha = a;
          ctx.translate(W / 2 + slide2, H * 0.42 + big * 0.95);
          ctx.rotate(-0.045);
          ctx.font = `900 ${mid}px ${FONT}`;
          ctx.lineWidth = Math.max(3, mid * 0.1);
          ctx.strokeStyle = '#000000';
          ctx.strokeText(spec.name.toUpperCase(), 0, 0);
          ctx.fillStyle = spec.color;
          ctx.fillText(spec.name.toUpperCase(), 0, 0);
          ctx.font = `600 ${Math.round(mid * 0.26)}px ${FONT}`;
          ctx.fillStyle = 'rgba(255,255,255,0.75)';
          ctx.fillText(spec.blurbShort || 'SURE HIT', 0, mid * 0.55);
          ctx.restore();
        }
        ctx.globalAlpha = 1;
      }
    }

    // --- the white-out on the call ------------------------------------------
    if (t > CALL - 0.06 && t < CALL + 0.26) {
      const f = 1 - Math.abs(t - CALL) / 0.26;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = hexA('#ffffff', 0.9 * f * f);
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }

  /** How much the picture should drain toward monochrome, 0..1. */
  get drain() {
    const c = this.active;
    if (!c) return 0;
    if (c.t < SEAL) return clamp01(c.t / SEAL) * 0.85;
    if (c.t < CALL) return 0.85;
    return 0.85 * clamp01((CLOSE - c.t) / (CLOSE - CALL));
  }
}


// ---------------------------------------------------------------------------
// Black Flash
// ---------------------------------------------------------------------------
//
// A domain is a ceremony; a Black Flash is an accident. The show gives it a
// quarter of a second and no words: the frame stops dead on contact, space
// cracks black around the point of impact, and then everything carries on at
// speed. So this is built on the opposite principles to the domain cutscene —
// no letterbox creeping in, no chant, no orbit. A hard cut to the fist, a
// held frame, and out.
//
//   STOP    the world freezes on contact, black bloom out of the impact
//   CRACK   the camera is already tight on the fist; the crack spreads
//   OUT     snap back to the follow rig as the hit resolves
//
// It must never fight the domain cutscene for the camera: a Black Flash that
// lands during a domain expansion still gets its impact frames, it just does
// not get the shot.

const BF_STOP = 0.09;
const BF_CRACK = 0.30;
const BF_OUT = 0.52;

export class FlashCinematic {
  constructor() {
    this.active = null;
    this.enabled = true;
  }

  /**
   * `attacker` threw it, `victim` took it, `pos` is where they met.
   * Returns false when switched off, already running, or the chain is so long
   * that another full stop would be more annoying than exciting.
   */
  start(attacker, victim, pos, chain, world) {
    if (!this.enabled || this.active) return false;
    this.active = {
      id: attacker.id,
      victimId: victim ? victim.id : null,
      x: pos.x, y: pos.y, z: pos.z,
      chain: chain || 1,
      angle: attacker.facing,
      // Sit on the side the punch is travelling toward, so the fist comes at
      // the lens rather than away from it.
      side: attacker.id % 2 ? 1 : -1,
      t: 0,
    };
    // Almost a freeze. Short enough that the hit still feels connected to the
    // input that caused it.
    world.slowmo(0.1, 0.42);
    return true;
  }

  get owningCamera() { return !!this.active; }

  update(dt, world, cam) {
    const c = this.active;
    if (!c) return;
    c.t += dt;
    if (c.t >= BF_OUT) { this.active = null; return; }
    this._driveCamera(c, cam);
  }

  _driveCamera(c, cam) {
    // The 2D stack has no orbit; it gets the punch-in and the drawing.
    if (cam.baseYaw === undefined) { cam.punchZoom(0.3); return; }
    const t = c.t;
    let yaw, pitch, dist, weight;
    if (t < BF_CRACK) {
      // Already at the angle when the frame stops. Cutting into position over
      // a few frames would read as a swoop, and a swoop is the wrong verb.
      const k = clamp01(t / 0.05);
      yaw = cam.baseYaw + c.side * 0.85;
      pitch = 0.06;
      // Close, but not so close that the two fighters stop being readable —
      // an impact frame still has to show you who hit whom.
      dist = 3.4;
      weight = k;
    } else {
      // Ease out rather than cut: the world is already moving again and a cut
      // back would double the jolt.
      const k = clamp01((t - BF_CRACK) / (BF_OUT - BF_CRACK));
      const e = k * k;
      yaw = cam.baseYaw + c.side * lerp(0.85, 0.3, e);
      pitch = lerp(0.05, 0.3, e);
      dist = lerp(3.4, 5.6, e);
      weight = 1 - e;
    }
    cam.override = {
      yaw, pitch, dist,
      lookAt: { x: c.x, y: c.y, z: c.z },
      weight: clamp01(weight),
    };
  }

  draw(ctx, W, H, dt) {
    const c = this.active;
    if (!c) return;
    const t = c.t;
    const cx = W / 2;
    const cy = H * 0.46;

    ctx.save();
    ctx.textAlign = 'center';

    // --- the crack ----------------------------------------------------------
    // Black lightning out of the point of impact. Deterministic from the chain
    // count so the same hit draws the same crack every frame it is on screen
    // rather than crawling.
    const grow = clamp01(t / BF_CRACK);
    const fade = clamp01((BF_OUT - t) / 0.2);
    if (grow > 0 && fade > 0) {
      const R = Math.hypot(W, H) * 0.55 * grow;
      ctx.globalAlpha = fade;
      ctx.lineCap = 'round';
      let seed = c.chain * 9781 + 12345;
      const rnd = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      for (let i = 0; i < 9; i++) {
        const a0 = (i / 9) * TAU + c.chain * 0.4;
        ctx.strokeStyle = i % 3 === 0 ? 'rgba(255,45,45,0.85)' : 'rgba(6,4,8,0.92)';
        ctx.lineWidth = (i % 3 === 0 ? 5 : 9) * (1 - grow * 0.4);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        let x = cx, y = cy, a = a0;
        const steps = 5;
        for (let sIdx = 0; sIdx < steps; sIdx++) {
          a += (rnd() - 0.5) * 1.1;
          const seg = (R / steps) * (0.6 + rnd() * 0.8);
          x += Math.cos(a) * seg;
          y += Math.sin(a) * seg;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // --- the stopped frame --------------------------------------------------
    // A hard white pop on contact, one or two frames, then gone.
    if (t < 0.08) {
      const f = 1 - t / 0.08;
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,236,236,${0.85 * f * f})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }

    // --- the words ----------------------------------------------------------
    if (t > BF_STOP * 0.4) {
      const k = clamp01((t - BF_STOP * 0.4) / 0.08);
      const a = Math.min(1, k) * fade;
      const big = Math.round(Math.min(64, W * 0.05));
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(cx, cy + big * 0.2);
      // Slams in slightly oversized and settles, which is the whole trick.
      const pop = 1 + (1 - k) * 0.35;
      ctx.scale(pop, pop);
      ctx.rotate(-0.06);
      ctx.font = `900 ${big}px ${FONT}`;
      ctx.lineWidth = Math.max(5, big * 0.13);
      ctx.strokeStyle = '#000000';
      ctx.strokeText('BLACK FLASH', 0, 0);
      ctx.fillStyle = '#ff2d2d';
      ctx.fillText('BLACK FLASH', 0, 0);
      if (c.chain > 1) {
        const mid = Math.round(big * 0.42);
        ctx.font = `900 ${mid}px ${FONT}`;
        ctx.lineWidth = Math.max(3, mid * 0.12);
        ctx.strokeStyle = '#000000';
        ctx.strokeText(`CHAIN ${c.chain}`, 0, big * 0.78);
        ctx.fillStyle = '#ffd166';
        ctx.fillText(`CHAIN ${c.chain}`, 0, big * 0.78);
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Black Flash drains the picture the other way from a domain: toward red
   * rather than toward grey. The post stack only takes one number, so this
   * reports a mild drain and lets the impact frames carry the colour.
   */
  get drain() {
    const c = this.active;
    if (!c) return 0;
    return 0.45 * clamp01((BF_OUT - c.t) / BF_OUT);
  }
}

function hexA(hex, a) {
  const h = (hex || '#ffffff').replace('#', '');
  const n = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
}
