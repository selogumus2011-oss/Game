// Keyboard / mouse / gamepad input with an action buffer.
//
// Combat games live or die on input feel, so this layer provides:
//   * edge detection (pressed / released this frame)
//   * a rolling input buffer so an attack pressed during recovery still comes out
//   * hold detection (light tap vs. charged heavy on the same button)
//   * gamepad support with deadzones

import { clamp, vec } from './math.js';

export const ACTIONS = {
  attack: 'Light / hold for Heavy',
  block: 'Block (tap = Parry)',
  dash: 'Dash / Step (i-frames)',
  jump: 'Jump / Air dash',
  grab: 'Grab (beats Block)',
  simpleDomain: 'Simple Domain',
  rct: 'Reverse Cursed Technique (hold)',
  domain: 'Domain Expansion',
  amplify: 'Domain Amplification',
  ability1: 'Cursed Technique I',
  ability2: 'Cursed Technique II',
  ability3: 'Cursed Technique III',
  ability4: 'Cursed Technique IV (Max)',
  tool: 'Swap cursed tool',
  vow: 'Impromptu Binding Vow',
  lock: 'Lock-on toggle',
  codex: 'Codex / pause',
};

export const DEFAULT_BINDS = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['Mouse0'],
  block: ['Mouse2', 'KeyQ'],
  dash: ['ShiftLeft', 'ShiftRight'],
  jump: ['Space'],
  grab: ['KeyF'],
  simpleDomain: ['KeyE'],
  rct: ['KeyR'],
  domain: ['KeyX'],
  amplify: ['KeyZ'],
  ability1: ['Digit1'],
  ability2: ['Digit2'],
  ability3: ['Digit3'],
  ability4: ['Digit4'],
  tool: ['KeyC'],
  vow: ['KeyV'],
  lock: ['KeyT'],
  codex: ['Tab'],
};

const BUFFER_WINDOW = 0.22; // seconds an unconsumed press stays actionable

export class Input {
  constructor(canvas, binds = DEFAULT_BINDS) {
    this.canvas = canvas;
    this.binds = JSON.parse(JSON.stringify(binds));
    this.held = new Set();
    this.justPressed = new Set();
    this.justReleased = new Set();
    this.holdStart = new Map();
    this.buffer = []; // {action, t}
    this.mouse = { x: 0, y: 0, worldX: 0, worldY: 0, inWindow: false };
    this.wheel = 0;
    this.time = 0;
    this.gamepadIndex = null;
    this.stick = vec(0, 0);
    this.aimStick = vec(0, 0);
    this.touchStick = vec(0, 0);
    this.usingGamepad = false;
    this.usingTouch = false;
    this.enabled = true;
    this._listeners = [];
    if (canvas) this._attach();
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn]);
  }

  _attach() {
    const canvas = this.canvas;
    this._on(window, 'keydown', (e) => {
      if (!this.enabled) return;
      if (e.code === 'Tab' || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return;
      this._press(e.code);
    });
    this._on(window, 'keyup', (e) => this._release(e.code));
    this._on(window, 'blur', () => this.clear());
    this._on(canvas, 'mousedown', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this._press('Mouse' + e.button);
    });
    this._on(window, 'mouseup', (e) => this._release('Mouse' + e.button));
    this._on(canvas, 'contextmenu', (e) => e.preventDefault());
    this._on(window, 'mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.inWindow = true;
      this.usingGamepad = false;
    });
    this._on(canvas, 'wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    this._on(window, 'gamepadconnected', (e) => { this.gamepadIndex = e.gamepad.index; });
    this._on(window, 'gamepaddisconnected', () => { this.gamepadIndex = null; });
  }

  destroy() {
    for (const [t, type, fn] of this._listeners) t.removeEventListener(type, fn);
    this._listeners.length = 0;
  }

  _press(code) {
    if (this.held.has(code)) return;
    this.held.add(code);
    this.justPressed.add(code);
    this.holdStart.set(code, this.time);
    if (code.startsWith('Touch:')) {
      this.buffer.push({ action: code.slice(6), t: this.time, consumed: false });
      return;
    }
    for (const [action, codes] of Object.entries(this.binds)) {
      if (codes.includes(code)) this.buffer.push({ action, t: this.time, consumed: false });
    }
  }

  _release(code) {
    if (!this.held.has(code)) return;
    this.held.delete(code);
    this.justReleased.add(code);
  }

  /**
   * Press an action directly, with no key behind it. The on-screen controls
   * feed through here so a finger, a key, a mouse button and a gamepad all
   * arrive at the same buffer and the same edge detection.
   */
  pressVirtual(action) {
    if (!this.enabled) return;
    this.usingTouch = true;
    this.usingGamepad = false;
    this._press('Touch:' + action);
  }

  releaseVirtual(action) {
    this._release('Touch:' + action);
  }

  clear() {
    this.held.clear();
    this.justPressed.clear();
    this.justReleased.clear();
    this.buffer.length = 0;
    this.touchStick.x = 0;
    this.touchStick.y = 0;
  }

  /** Call once per frame *before* the simulation reads input. */
  update(dt) {
    this.time += dt;
    this._pollGamepad();
    // Expire stale buffered presses.
    const cutoff = this.time - BUFFER_WINDOW;
    this.buffer = this.buffer.filter((b) => !b.consumed && b.t >= cutoff);
  }

  /** Call once per frame *after* the simulation reads input. */
  lateUpdate() {
    this.justPressed.clear();
    this.justReleased.clear();
    this.wheel = 0;
  }

  _pollGamepad() {
    if (this.gamepadIndex === null || typeof navigator === 'undefined' || !navigator.getGamepads) return;
    const gp = navigator.getGamepads()[this.gamepadIndex];
    if (!gp) return;
    const dz = (v) => (Math.abs(v) < 0.22 ? 0 : (v - Math.sign(v) * 0.22) / 0.78);
    this.stick.x = dz(gp.axes[0] || 0);
    this.stick.y = dz(gp.axes[1] || 0);
    this.aimStick.x = dz(gp.axes[2] || 0);
    this.aimStick.y = dz(gp.axes[3] || 0);
    if (Math.abs(this.stick.x) + Math.abs(this.stick.y) + Math.abs(this.aimStick.x) > 0.1) this.usingGamepad = true;
    const map = {
      0: 'jump', 1: 'dash', 2: 'grab', 3: 'simpleDomain',
      4: 'ability1', 5: 'attack', 6: 'block', 7: 'attack',
      8: 'vow', 9: 'codex', 10: 'rct', 11: 'domain',
      12: 'ability4', 13: 'ability3', 14: 'ability2', 15: 'amplify',
    };
    gp.buttons.forEach((btn, i) => {
      const action = map[i];
      if (!action) return;
      const code = 'Pad' + i;
      if (btn.pressed && !this.held.has(code)) {
        this.usingGamepad = true;
        this.held.add(code);
        this.justPressed.add(code);
        this.holdStart.set(code, this.time);
        this.buffer.push({ action, t: this.time, consumed: false });
      } else if (!btn.pressed && this.held.has(code)) {
        this.held.delete(code);
        this.justReleased.add(code);
      }
    });
    // Track the pad->action mapping so down()/held checks work.
    this._padMap = map;
  }

  _codesFor(action) {
    const codes = (this.binds[action] || []).concat('Touch:' + action);
    if (!this._padMap) return codes;
    const pads = [];
    for (const [i, a] of Object.entries(this._padMap)) if (a === action) pads.push('Pad' + i);
    return codes.concat(pads);
  }

  /** Is any key bound to `action` currently held? */
  down(action) {
    for (const c of this._codesFor(action)) if (this.held.has(c)) return true;
    return false;
  }

  /** Was `action` pressed this exact frame? */
  pressed(action) {
    for (const c of this._codesFor(action)) if (this.justPressed.has(c)) return true;
    return false;
  }

  released(action) {
    for (const c of this._codesFor(action)) if (this.justReleased.has(c)) return true;
    return false;
  }

  /** How long has `action` been held (seconds, 0 if not held)? */
  heldTime(action) {
    let best = 0;
    for (const c of this._codesFor(action)) {
      if (this.held.has(c)) best = Math.max(best, this.time - (this.holdStart.get(c) ?? this.time));
    }
    return best;
  }

  /** Consume a buffered press. Returns true once per press. */
  consume(action, window = BUFFER_WINDOW) {
    for (const b of this.buffer) {
      if (b.action === action && !b.consumed && this.time - b.t <= window) {
        b.consumed = true;
        return true;
      }
    }
    return false;
  }

  /** Peek without consuming. */
  buffered(action, window = BUFFER_WINDOW) {
    return this.buffer.some((b) => b.action === action && !b.consumed && this.time - b.t <= window);
  }

  dropBuffer(action) {
    for (const b of this.buffer) if (b.action === action) b.consumed = true;
  }

  /** Normalised movement vector from WASD or left stick. */
  moveVector() {
    let x = 0, y = 0;
    if (this.down('left')) x -= 1;
    if (this.down('right')) x += 1;
    if (this.down('up')) y -= 1;
    if (this.down('down')) y += 1;
    if (Math.abs(this.stick.x) > 0 || Math.abs(this.stick.y) > 0) {
      x = this.stick.x;
      y = this.stick.y;
    }
    if (Math.abs(this.touchStick.x) > 0 || Math.abs(this.touchStick.y) > 0) {
      x = this.touchStick.x;
      y = this.touchStick.y;
    }
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    return { x, y, len: clamp(len, 0, 1) };
  }
}
