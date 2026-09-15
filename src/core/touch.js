// Touch controls.
//
// A twin-stick layout drawn straight onto the game canvas: a floating movement
// stick wherever the left thumb lands, and an aim/attack stick on the right
// that fires while it is held. Everything else is a ring of buttons along the
// bottom-right, sized for a thumb rather than a cursor.
//
// This layer never replaces keyboard and mouse — it feeds the same Input
// object, so a keyboard, a mouse, a gamepad and a finger all work in the same
// session. On an iPad with a Magic Keyboard that matters.

import { clamp, clamp01, TAU, PI } from './math.js';

const STICK_R = 62;        // outer ring radius in CSS pixels
const KNOB_R = 27;
const DEAD = 0.14;

/** The action each bottom-right button fires, in draw order. */
const BUTTONS = [
  { action: 'ability1', label: '1', ring: 0 },
  { action: 'ability2', label: '2', ring: 0 },
  { action: 'ability3', label: '3', ring: 0 },
  { action: 'ability4', label: '4', ring: 0, max: true },
  { action: 'block', label: 'BLK', ring: 1, hold: true },
  { action: 'dash', label: 'DSH', ring: 1 },
  { action: 'jump', label: 'JMP', ring: 1 },
  { action: 'grab', label: 'GRB', ring: 1 },
  { action: 'domain', label: 'DOM', ring: 2, big: true },
  { action: 'simpleDomain', label: 'SD', ring: 2, hold: true },
  { action: 'amplify', label: 'AMP', ring: 2 },
  { action: 'rct', label: 'RCT', ring: 2, hold: true },
];

export class TouchControls {
  constructor(input, canvas) {
    this.input = input;
    this.canvas = canvas;
    this.enabled = false;
    this.active = false;          // has a touch ever happened
    this.width = 0;
    this.height = 0;
    this.moveTouch = null;        // {id, ox, oy, x, y}
    this.aimTouch = null;
    this.buttonTouches = new Map(); // touchId -> action
    this.layout = [];
    this.opacity = 0;
    this._listeners = [];
    if (canvas && typeof window !== 'undefined' && 'ontouchstart' in window) this.attach();
  }

  attach() {
    const el = this.canvas;
    const on = (type, fn) => {
      el.addEventListener(type, fn, { passive: false });
      this._listeners.push([type, fn]);
    };
    on('touchstart', (e) => this._start(e));
    on('touchmove', (e) => this._move(e));
    on('touchend', (e) => this._end(e));
    on('touchcancel', (e) => this._end(e));
    this.enabled = true;
  }

  destroy() {
    for (const [type, fn] of this._listeners) this.canvas.removeEventListener(type, fn);
    this._listeners.length = 0;
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this._layout();
  }

  /**
   * Button positions. Three arcs sweeping up from the bottom-right corner, so
   * the whole set is inside a thumb's reach from where a hand actually holds a
   * tablet.
   */
  _layout() {
    const w = this.width, h = this.height;
    const cx = w - 74;
    const cy = h - 74;
    const compact = Math.min(w, h) < 620;
    const scale = compact ? 0.84 : 1;
    const rings = [104, 172, 240].map((r) => r * scale);
    const counts = [4, 4, 4];
    const spans = [
      { from: -PI * 0.5, to: -PI * 0.96 },
      { from: -PI * 0.42, to: -PI * 1.0 },
      { from: -PI * 0.38, to: -PI * 1.02 },
    ];
    this.layout = [];
    let i = 0;
    for (let ring = 0; ring < 3; ring++) {
      const inRing = BUTTONS.filter((b) => b.ring === ring);
      for (let k = 0; k < inRing.length; k++) {
        const t = inRing.length === 1 ? 0.5 : k / (inRing.length - 1);
        const a = spans[ring].from + (spans[ring].to - spans[ring].from) * t;
        this.layout.push({
          def: inRing[k],
          x: cx + Math.cos(a) * rings[ring],
          y: cy + Math.sin(a) * rings[ring],
          r: (inRing[k].big ? 34 : 27) * scale,
        });
        i++;
      }
    }
  }

  // -------------------------------------------------------------------------

  _rect() { return this.canvas.getBoundingClientRect(); }

  _hitButton(x, y) {
    for (const b of this.layout) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r + 12) return b;
    }
    return null;
  }

  _start(e) {
    e.preventDefault();
    this.active = true;
    const r = this._rect();
    for (const t of e.changedTouches) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      const btn = this._hitButton(x, y);
      if (btn) {
        this.buttonTouches.set(t.identifier, btn.def.action);
        this.input.pressVirtual(btn.def.action);
        continue;
      }
      if (x < this.width * 0.45 && !this.moveTouch) {
        this.moveTouch = { id: t.identifier, ox: x, oy: y, x, y };
      } else if (!this.aimTouch) {
        this.aimTouch = { id: t.identifier, ox: x, oy: y, x, y, t0: performance.now(), moved: 0 };
        // Touching the right half aims there immediately.
        this.input.mouse.x = x;
        this.input.mouse.y = y;
        this.input.mouse.inWindow = true;
        this.input.pressVirtual('attack');
      }
    }
  }

  _move(e) {
    e.preventDefault();
    const r = this._rect();
    for (const t of e.changedTouches) {
      const x = t.clientX - r.left, y = t.clientY - r.top;
      if (this.moveTouch && t.identifier === this.moveTouch.id) {
        this.moveTouch.x = x;
        this.moveTouch.y = y;
      } else if (this.aimTouch && t.identifier === this.aimTouch.id) {
        this.aimTouch.moved += Math.hypot(x - this.aimTouch.x, y - this.aimTouch.y);
        this.aimTouch.x = x;
        this.aimTouch.y = y;
        this.input.mouse.x = x;
        this.input.mouse.y = y;
      }
    }
  }

  _end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const action = this.buttonTouches.get(t.identifier);
      if (action !== undefined) {
        this.buttonTouches.delete(t.identifier);
        this.input.releaseVirtual(action);
        continue;
      }
      if (this.moveTouch && t.identifier === this.moveTouch.id) this.moveTouch = null;
      if (this.aimTouch && t.identifier === this.aimTouch.id) {
        this.input.releaseVirtual('attack');
        this.aimTouch = null;
      }
    }
  }

  /** Feed the movement stick into Input before the simulation reads it. */
  update(dt) {
    if (!this.enabled) return;
    this.opacity = clamp01(this.opacity + (this.active ? dt * 3 : -dt * 2));
    if (!this.moveTouch) {
      this.input.touchStick.x = 0;
      this.input.touchStick.y = 0;
      return;
    }
    const dx = this.moveTouch.x - this.moveTouch.ox;
    const dy = this.moveTouch.y - this.moveTouch.oy;
    const len = Math.hypot(dx, dy);
    if (len < STICK_R * DEAD) {
      this.input.touchStick.x = 0;
      this.input.touchStick.y = 0;
      return;
    }
    const k = Math.min(1, (len - STICK_R * DEAD) / (STICK_R * (1 - DEAD))) / len;
    this.input.touchStick.x = dx * k;
    this.input.touchStick.y = dy * k;
  }

  // -------------------------------------------------------------------------
  // Drawing. Runs after the HUD so the controls sit on top of everything.
  // -------------------------------------------------------------------------

  draw(ctx, player) {
    if (!this.enabled || this.opacity <= 0.01) return;
    const a = this.opacity;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Movement stick.
    if (this.moveTouch) {
      const m = this.moveTouch;
      const dx = m.x - m.ox, dy = m.y - m.oy;
      const len = Math.hypot(dx, dy) || 1;
      const clampK = Math.min(1, STICK_R / len);
      ring(ctx, m.ox, m.oy, STICK_R, 'rgba(232,236,244,0.20)', 'rgba(10,12,18,0.30)', a);
      ring(ctx, m.ox + dx * clampK, m.oy + dy * clampK, KNOB_R,
        'rgba(232,236,244,0.55)', 'rgba(140,170,220,0.28)', a);
    }

    // Aim marker.
    if (this.aimTouch) {
      const t = this.aimTouch;
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, 20, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x - 28, t.y);
      ctx.lineTo(t.x - 12, t.y);
      ctx.moveTo(t.x + 12, t.y);
      ctx.lineTo(t.x + 28, t.y);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Buttons.
    const held = new Set(this.buttonTouches.values());
    for (const b of this.layout) {
      const def = b.def;
      const down = held.has(def.action);
      const ready = this._readyState(player, def.action);
      const alpha = a * (ready === false ? 0.32 : 1);
      const accent = def.max ? '#ff4d4d'
        : def.action === 'domain' ? '#cfa8ff'
        : def.action.startsWith('ability') ? '#8ad8ff'
        : '#e8ecf4';
      ring(ctx, b.x, b.y, b.r,
        down ? 'rgba(255,255,255,0.85)' : hexA(accent, 0.45),
        down ? hexA(accent, 0.45) : 'rgba(10,12,18,0.46)', alpha);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = down ? '#ffffff' : accent;
      ctx.font = `800 ${Math.round(b.r * (def.label.length > 2 ? 0.38 : 0.6))}px system-ui, sans-serif`;
      ctx.fillText(def.label, b.x, b.y + 1);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Grey a button out when the action is not currently available. */
  _readyState(p, action) {
    if (!p) return true;
    if (action.startsWith('ability')) {
      const i = +action.slice(-1) - 1;
      return p.abilityReady ? p.abilityReady(i) : true;
    }
    if (action === 'domain') return p.domainReady ? p.domainReady() : true;
    return true;
  }
}

function ring(ctx, x, y, r, stroke, fill, alpha) {
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function hexA(hex, a) {
  const h = hex.replace('#', '');
  const n = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return `rgba(${n[0]},${n[1]},${n[2]},${a})`;
}
