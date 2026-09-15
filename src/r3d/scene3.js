// The 3D scene renderer.
//
// Same public surface as the 2D Renderer — construct with a canvas, call
// resize(), render(world, cam, fx, dt) and autoQuality(fps) — so main.js can
// swap between them at runtime and the HUD keeps working against either camera.
//
// Everything in the world goes into one DrawList and is sorted once by view
// depth, then screen-space passes (impact frames, weather, veil, vignette,
// grain) run on top in 2D.

import { clamp, clamp01, lerp, TAU, PI, rand, randRange } from '../core/math.js';
import { Camera3, DrawList, matCompose, hexToRgb } from './core3.js';
import { drawMesh, drawOutline } from './geom3.js';
import { drawFighter3, makeShade } from './actors3.js';
import { drawGround3, drawProps3, drawVeil3, drawSky } from './arena3.js';
import { drawEffects3, drawImpactFrames, drawSpeedLines } from './fx3.js';
import { drawDomain3, setDomainQuality3 } from './domains3.js';
import { drawProjectiles3, drawSummonLinks3, drawTelegraphs3 } from './props3.js';
import { shade } from './models3.js';
import { pickDpr } from '../render/sprites.js';

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.dl = new DrawList();
    this.time = 0;
    this.weather = [];
    this.weatherKind = 'none';
    this.grainCanvas = null;
    this.grainPattern = null;
    this.vignetteCanvas = null;
    this.veilIntro = 0;
    this.veilIntroMax = 2.1;
    this.settings = {
      particles: 1, grain: true, vignette: true, chromatic: true,
      weather: true, shadows: true, showNames: true, bloom: true, grade: true,
    };
    this.quality = 1;
    this._fpsAvg = 60;
    this.q = { outlines: true, detail: 2 };
    // View-space key light: over the camera's left shoulder and slightly down.
    this.light = { x: -0.44, y: 0.62, z: 0.65 };
    this.shadeOpts = makeShade(this.light);
    this.resize();
  }

  resize() {
    const c = this.canvas;
    const w = c.clientWidth || window.innerWidth;
    const h = c.clientHeight || window.innerHeight;
    this.dpr = pickDpr(w, h);
    c.width = Math.floor(w * this.dpr);
    c.height = Math.floor(h * this.dpr);
    this.width = w;
    this.height = h;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._makeGrain();
    this._makeVignette();
  }

  autoQuality(fps) {
    this._fpsAvg = this._fpsAvg * 0.92 + fps * 0.08;
    const q = this._fpsAvg < 32 ? 0.35 : this._fpsAvg < 44 ? 0.7 : 1;
    if (q !== this.quality) {
      this.quality = q;
      this.q.outlines = q > 0.5;
      this.q.detail = q > 0.8 ? 2 : q > 0.5 ? 1 : 0;
      setDomainQuality3(q);
    }
  }

  _makeVignette() {
    const W = Math.max(2, Math.round(this.width));
    const H = Math.max(2, Math.round(this.height));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g2 = c.getContext('2d');
    const grd = g2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34,
      W / 2, H / 2, Math.max(W, H) * 0.74);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.55, 'rgba(4,6,12,0.18)');
    grd.addColorStop(1, 'rgba(3,4,9,0.78)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, W, H);
    this.vignetteCanvas = c;
  }

  _makeGrain() {
    const size = 128;
    const g = document.createElement('canvas');
    g.width = g.height = size;
    const gc = g.getContext('2d');
    const img = gc.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (Math.random() - 0.5) * 90;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 24;
    }
    gc.putImageData(img, 0, 0);
    this.grainCanvas = g;
    this.grainPattern = this.ctx.createPattern(g, 'repeat');
  }

  initWeather(arena) {
    this.weather.length = 0;
    const kind = arena.weather;
    this.weatherKind = kind;
    if (kind === 'none') return;
    const count = kind === 'rain' ? 220 : 140;
    for (let i = 0; i < count; i++) {
      this.weather.push({
        x: Math.random(), y: Math.random(),
        v: Math.random() * 0.5 + 0.5,
        s: Math.random() * 0.6 + 0.4,
        p: Math.random() * TAU,
      });
    }
  }

  // -------------------------------------------------------------------------

  render(world, cam, fx, dt) {
    const ctx = this.ctx;
    const W = this.width, H = this.height;
    this.time += dt;
    cam.resize(W, H);
    if (!cam.view || !cam.f) cam.commit();

    const S = this.shadeOpts;
    S.light = this.light;
    // Most surfaces should land on the lit side of the terminator; the shadow
    // band is an accent, not the default state of the world.
    S.ambient = 0.62;
    S.key = 0.46;
    S.rim = 0.34;

    drawSky(ctx, cam, world.arena, W, H);

    const dl = this.dl;
    dl.reset();

    drawGround3(dl, cam, world, S, this.q);

    // Domains own the ground they cover, so they go down before the props.
    for (const d of world.domains) {
      if (d.closed) continue;
      drawDomain3(dl, cam, d, S, this.q, this.time);
    }

    drawProps3(dl, cam, world, S, this.q, this.time);
    drawTelegraphs3(dl, cam, world, S, this.time);
    drawVeil3(dl, cam, world, S, this.time);

    for (const f of world.fighters) {
      drawFighter3(dl, cam, f, this.time, dt, fx, S, this.q);
    }
    drawSummonLinks3(dl, cam, world, S, this.time);
    drawProjectiles3(dl, cam, world, S, this.q, this.time);

    drawEffects3(dl, cam, fx, S, this.q, this.time, world);

    ctx.save();
    if (cam.roll) {
      ctx.translate(W / 2, H / 2);
      ctx.rotate(cam.roll);
      ctx.translate(-W / 2, -H / 2);
    }
    dl.flush(ctx);
    ctx.restore();

    this._nameplates(ctx, world, cam);
    this._weather(ctx, W, H, dt);
    drawImpactFrames(ctx, W, H, fx, cam);
    this._flashes(ctx, W, H, fx);
    if (world.player && world.player.state === 'dash') {
      drawSpeedLines(ctx, W, H, 0.45, '#ffffff', this.time * 3);
    }
    this._bloom(ctx, W, H);
    this._grade(ctx, W, H, world, this.drain || 0);
    this._veilIntro(ctx, W, H, dt, world);
    if (this.settings.vignette && this.vignetteCanvas) {
      ctx.drawImage(this.vignetteCanvas, 0, 0, W, H);
    }
    if (this.settings.grain && this.grainPattern && this.quality > 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.45;
      ctx.translate(-((Math.random() * 128) | 0), -((Math.random() * 128) | 0));
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(0, 0, W + 128, H + 128);
      ctx.restore();
    }
  }

  // -------------------------------------------------------------------------

  _nameplates(ctx, world, cam) {
    if (!this.settings.showNames || this.drain > 0.05) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '600 11px system-ui, sans-serif';
    for (const f of world.fighters) {
      if (f.dead || f.isPlayer) continue;
      if (!cam.visible(f.pos.x, f.pos.y, f.z + f.height, f.height)) continue;
      const p = cam.project(f.pos.x, f.pos.y, f.z + f.height + 0.42);
      if (p.d <= cam.near || p.d > 46) continue;
      const w = 34;
      const frac = clamp01(f.hp / f.maxHp);
      const alpha = clamp01((46 - p.d) / 14);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(p.x - w / 2, p.y, w, 3.5);
      ctx.fillStyle = f.team === (world.player?.team ?? 1) ? '#8ef0bd' : '#ff6b6b';
      ctx.fillRect(p.x - w / 2, p.y, w * frac, 3.5);
      if (p.d < 26) {
        ctx.fillStyle = 'rgba(232,236,244,0.85)';
        ctx.fillText(f.name, p.x, p.y - 4);
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  _weather(ctx, W, H, dt) {
    if (!this.settings.weather || !this.weather.length || this.quality < 0.5) return;
    const kind = this.weatherKind;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.weather) {
      if (kind === 'rain') {
        p.y += dt * p.v * 1.9;
        p.x += dt * 0.06;
      } else {
        p.y += dt * p.v * 0.16;
        p.x += Math.sin(this.time * 0.6 + p.p) * dt * 0.05;
      }
      if (p.y > 1) { p.y -= 1; p.x = Math.random(); }
      if (p.x > 1) p.x -= 1;
      const x = p.x * W, y = p.y * H;
      if (kind === 'rain') {
        ctx.strokeStyle = 'rgba(160,190,230,0.32)';
        ctx.lineWidth = p.s;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - 2, y + 16 * p.v);
        ctx.stroke();
      } else if (kind === 'embers') {
        ctx.fillStyle = `rgba(255,${(120 + p.s * 90) | 0},60,${0.35 * p.s})`;
        ctx.fillRect(x, y, 2 * p.s, 2 * p.s);
      } else if (kind === 'leaves') {
        ctx.fillStyle = `rgba(150,${(180 + p.s * 40) | 0},110,${0.25 * p.s})`;
        ctx.fillRect(x, y, 3 * p.s, 2 * p.s);
      } else {
        ctx.fillStyle = `rgba(170,170,160,${0.2 * p.s})`;
        ctx.fillRect(x, y, 2 * p.s, 2 * p.s);
      }
    }
    ctx.restore();
  }

  /**
   * Bloom, the cheap way.
   *
   * There is no shader to threshold with, so the frame is downsampled and then
   * multiplied by itself: squaring the values crushes the darks toward nothing
   * while leaving bright cursed energy almost intact, which is the threshold. A
   * blurred upscale added back on top is the glow. Two draws of a quarter-size
   * canvas, and it is what makes energy read as light rather than paint.
   */
  _bloom(ctx, W, H) {
    if (!this.settings.bloom || this.quality < 0.8) return;
    const bw = Math.max(2, Math.round(W * 0.2));
    const bh = Math.max(2, Math.round(H * 0.2));
    let b = this.bloomCanvas;
    if (!b || b.width !== bw || b.height !== bh) {
      b = this.bloomCanvas = document.createElement('canvas');
      b.width = bw; b.height = bh;
      this.bloomCtx = b.getContext('2d');
    }
    const bc = this.bloomCtx;
    bc.globalCompositeOperation = 'copy';
    bc.globalAlpha = 1;
    bc.drawImage(this.canvas, 0, 0, bw, bh);
    // Squaring once crushes darks; squaring twice leaves only what is genuinely
    // glowing, which is the point — bloom on the whole picture is just haze.
    bc.globalCompositeOperation = 'multiply';
    bc.drawImage(b, 0, 0);
    bc.drawImage(b, 0, 0);
    bc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.85;
    ctx.filter = 'blur(6px)';
    ctx.drawImage(b, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.restore();
  }

  /**
   * Colour grade, keyed to the later seasons rather than the early ones.
   *
   * That look is built on crushed blacks and a nearly colourless world with the
   * cursed energy as the only saturated thing in frame. Three passes get there
   * without a shader:
   *
   *   CONTRAST  the frame multiplied by itself at partial strength. Squaring is
   *             a real tone curve — darks fall away, brights barely move — and
   *             it costs one composited draw.
   *   DRAIN     a grey wash in 'saturation' mode pulls the colour out of the
   *             picture. Additive energy was drawn so bright that it survives,
   *             which is exactly the separation the show uses.
   *   KEY       a cool multiply and a warm screen put the two-tone back, and
   *             inside a domain both shift to that domain's colour.
   */
  _grade(ctx, W, H, world, drain = 0) {
    if (!this.settings.grade) return;
    const dom = world.player?.insideDomain;
    const inDom = dom && !dom.closed;
    ctx.save();

    // Squaring needs a copy: compositing a canvas onto itself reads the
    // destination while it is being written and bands the result.
    if (this.quality > 0.5) {
      const cw = Math.max(2, Math.round(W * 0.5));
      const ch = Math.max(2, Math.round(H * 0.5));
      let t = this.toneCanvas;
      if (!t || t.width !== cw || t.height !== ch) {
        t = this.toneCanvas = document.createElement('canvas');
        t.width = cw; t.height = ch;
        this.toneCtx = t.getContext('2d');
      }
      this.toneCtx.globalCompositeOperation = 'copy';
      this.toneCtx.drawImage(this.canvas, 0, 0, cw, ch);
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.42;
      ctx.drawImage(t, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    const desat = clamp01(0.3 + drain * 0.62);
    ctx.globalCompositeOperation = 'saturation';
    ctx.globalAlpha = desat;
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;

    const tint = inDom ? dom.spec.color2 || '#0a0a14' : '#0e1624';
    const c = hexToRgb(tint);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${196 + c[0] * 0.14 | 0},${202 + c[1] * 0.13 | 0},${222 + c[2] * 0.1 | 0})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.09;
    ctx.fillStyle = inDom ? dom.spec.color : '#3a2414';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  _flashes(ctx, W, H, fx) {
    for (const f of fx.flashes) {
      const k = clamp01(f.life / f.max);
      const c = hexToRgb(f.color);
      ctx.save();
      ctx.globalCompositeOperation = f.mode === 'screen' ? 'lighter' : 'source-over';
      ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(k * f.strength).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /** The veil dropping over the arena at the start of a match. */
  _veilIntro(ctx, W, H, dt, world) {
    if (this.veilIntro <= 0) return;
    this.veilIntro = Math.max(0, this.veilIntro - dt);
    const k = clamp01(this.veilIntro / this.veilIntroMax);
    const col = world.arena.veilColor || '#2a0a14';
    const c = hexToRgb(col);
    const drop = (1 - k) * H * 1.15;
    ctx.save();
    ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${(0.85 * k).toFixed(3)})`;
    ctx.fillRect(0, 0, W, Math.max(0, H - drop));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(255,255,255,${(0.3 * k).toFixed(3)})`;
    ctx.fillRect(0, Math.max(0, H - drop) - 3, W, 3);
    ctx.restore();
  }
}
