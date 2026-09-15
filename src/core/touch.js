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

import { clamp, clamp01, TAU } from './math.js';

const STICK_R = 62;        // outer ring radius in CSS pixels
const KNOB_R = 27;
const DEAD = 0.14;

/** The action each bottom-right button fires. */
const BUTTONS = [
  { action: 'ability1', label: '1' },
  { action: 'ability2', label: '2' },
  { action: 'ability3', label: '3' },
  { action: 'ability4', label: '4', max: true },
  { action: 'block', label: 'BLK' },
  { action: 'dash', label: 'DSH' },
  { action: 'jump', label: 'JMP' },
  { action: 'grab', label: 'GRB' },
  { action: 'domain', label: 'DOM' },
  { action: 'simpleDomain', label: 'SD' },
  { action: 'amplify', label: 'AMP' },
  { action: 'rct', label: 'RCT' },
  { action: 'firstPerson', label: 'VIEW' },
];

// On a phone only two rows of buttons fit inside a thumb's reach, so the rack
// is paged: the four techniques are always there, and the row above swaps
// between the moves you press every few seconds and the ones you press every
// few minutes. VIEW is not on it at all — it is a settings toggle, not a
// combat key, and it is the first thing to cut when there are four slots.
const PAGE_ACTION = '_page';
const PAGE_BUTTON = { action: PAGE_ACTION, label: 'MORE', page: true };
// There is no Escape key on a phone, and without this there is no way out of a
// match. Deliberately in the far corner, away from the thumbs.
const PAUSE_ACTION = '_pause';
const PAUSE_BUTTON = { action: PAUSE_ACTION, label: '| |', pause: true, system: true };

// Rows, bottom first: the bottom-right is the easiest place for a right thumb
// to land, so the most-pressed buttons are nearest it.
const PHONE_PAGES = [
  ['domain', 'jump', 'dash', 'block'],
  ['rct', 'amplify', 'simpleDomain', 'grab'],
];
const PHONE_ROW0 = ['ability1', 'ability2', 'ability3', 'ability4'];
const TABLET_ROWS = [
  ['ability1', 'ability2', 'ability3', 'ability4', 'block'],
  ['dash', 'jump', 'grab', 'amplify', 'domain'],
  ['firstPerson', 'rct', 'simpleDomain'],
];

const defOf = (name) => (name === PAGE_ACTION ? PAGE_BUTTON : BUTTONS.find((b) => b.action === name));

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
    // Mirrors the game's view mode. In first person the right half of the
    // screen becomes a look pad rather than a point-to-aim surface.
    this.firstPerson = false;
    this.buttonTouches = new Map(); // touchId -> action
    this.layout = [];
    this.page = 0;                // which half of the phone button rack is up
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
   * Button positions: a block of them wedged into the bottom-right corner,
   * rows stacked bottom-up and right-aligned on the thumb.
   *
   * This used to be three arcs sweeping out of the corner, which looked better
   * in a mock-up and failed twice over. Thirteen buttons on arcs need about
   * 280px of reach and a thumb on a 390px screen has roughly 200, so on a
   * phone the domain button sat off the right edge of every viewport and the
   * four technique buttons overlapped into one blob. Solving the radii fixed
   * the geometry and left the reading order scattered: rings of four, four and
   * five interleave, so the numbers ended up shuffled in among the letters.
   * A grid packs tighter and reads in order.
   *
   * The size is solved rather than chosen. Buttons may take the right 55% of
   * the width — the rest belongs to the movement thumb — and the bottom 48% of
   * the height, and the largest that fits both wins. 44px across is the floor
   * on every touch platform; anything under it is a missed input.
   */
  _layout() {
    const w = this.width, h = this.height;
    this.layout = [];
    if (!w || !h) return;

    const phone = Math.min(w, h) < 500;
    const rows = phone
      ? [PHONE_ROW0, PHONE_PAGES[this.page], [PAGE_ACTION]]
      : TABLET_ROWS;
    const cols = Math.max(...rows.map((r) => r.length));
    const margin = 12;
    const maxW = w * 0.55 - margin;
    const maxH = h * 0.48;
    let r = 22, gap = 6;
    for (const [cr, cg] of [[34, 14], [31, 13], [28, 12], [26, 10], [24, 8], [22, 6]]) {
      const p = cr * 2 + cg;
      if (cols * p - cg <= maxW && rows.length * p - cg + margin <= maxH) { r = cr; gap = cg; break; }
    }
    const pitch = r * 2 + gap;
    const right = w - margin - r;
    const bottom = h - margin - r;
    for (let row = 0; row < rows.length; row++) {
      const names = rows[row];
      for (let k = 0; k < names.length; k++) {
        const def = defOf(names[k]);
        if (!def) continue;
        // Right-aligned, so a short row still hugs the thumb.
        this.layout.push({
          def, x: right - (names.length - 1 - k) * pitch, y: bottom - row * pitch, r,
        });
      }
    }
    this.layout.push({ def: PAUSE_BUTTON, x: 34, y: 34, r: 22 });

    // Last word on the matter: a button you cannot touch is worse than one
    // that is merely in an awkward place.
    for (const b of this.layout) {
      b.x = clamp(b.x, b.r + 4, w - b.r - 4);
      b.y = clamp(b.y, b.r + 4, h - b.r - 4);
    }
  }

  // -------------------------------------------------------------------------

  _rect() { return this.canvas.getBoundingClientRect(); }

  /**
   * The button under a finger, with a little slop around each one so a near
   * miss still counts. Packed tightly enough that the slop zones overlap, so
   * take the nearest rather than the first — otherwise a thumb between two
   * buttons always fires whichever happens to be earlier in the list.
   */
  _hitButton(x, y) {
    let best = null, bestD = Infinity;
    for (const b of this.layout) {
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < b.r + 12 && d < bestD) { best = b; bestD = d; }
    }
    return best;
  }

  /** Swap the phone button rack over to its other page. */
  _flipPage() {
    this.page = this.page === 1 ? 0 : 1;
    // Anything held on the row that just left must not stay held forever.
    for (const [id, act] of this.buttonTouches) {
      if (act === PAGE_ACTION) continue;
      this.input.releaseVirtual(act);
      this.buttonTouches.delete(id);
    }
    this._layout();
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
        if (btn.def.page) this._flipPage();
        else if (btn.def.pause) this.onPause?.();
        else this.input.pressVirtual(btn.def.action);
        continue;
      }
      if (x < this.width * 0.45 && !this.moveTouch) {
        this.moveTouch = { id: t.identifier, ox: x, oy: y, x, y };
      } else if (!this.aimTouch) {
        this.aimTouch = { id: t.identifier, ox: x, oy: y, x, y, t0: performance.now(), moved: 0 };
        // Touching the right half aims there immediately — except in first
        // person, where the aim is the view and a touch must not jerk it.
        if (!this.firstPerson) {
          this.input.mouse.x = x;
          this.input.mouse.y = y;
        }
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
        const dx = x - this.aimTouch.x;
        const dy = y - this.aimTouch.y;
        this.aimTouch.moved += Math.hypot(dx, dy);
        this.aimTouch.x = x;
        this.aimTouch.y = y;
        if (this.firstPerson) {
          // A drag is a look, not a point: the same delta a mouse would give.
          this.input.look.x += dx;
          this.input.look.y += dy;
        } else {
          this.input.mouse.x = x;
          this.input.mouse.y = y;
        }
      }
    }
  }

  _end(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const action = this.buttonTouches.get(t.identifier);
      if (action !== undefined) {
        this.buttonTouches.delete(t.identifier);
        if (action !== PAGE_ACTION && action !== PAUSE_ACTION) this.input.releaseVirtual(action);
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
      const label = def.page ? (this.page === 1 ? 'MAIN' : 'MORE') : def.label;
      // The pause key sits out of the way and stays out of the way visually.
      const av = alpha * (def.system ? 0.7 : 1);
      ring(ctx, b.x, b.y, b.r,
        down ? 'rgba(255,255,255,0.85)' : hexA(accent, def.system ? 0.26 : 0.45),
        down ? hexA(accent, 0.45) : 'rgba(10,12,18,0.46)', av);
      ctx.globalAlpha = av;
      ctx.fillStyle = down ? '#ffffff' : accent;
      ctx.font = `800 ${Math.round(b.r * (label.length > 2 ? 0.38 : 0.6))}px system-ui, sans-serif`;
      ctx.fillText(label, b.x, b.y + 1);
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
