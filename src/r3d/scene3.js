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
import { Camera3, DrawList, matCompose, hexToRgb, setFogColor } from './core3.js';
import { drawMesh, drawOutline } from './geom3.js';
import { drawFighter3, makeShade } from './actors3.js';
import { drawGround3, drawProps3, drawVeil3, drawSky } from './arena3.js';
import { drawEffects3, drawImpactFrames, drawSpeedLines } from './fx3.js';
import { drawDomain3, setDomainQuality3 } from './domains3.js';
import { drawProjectiles3, drawSummonLinks3, drawTelegraphs3 } from './props3.js';
import { shade } from './models3.js';
import { pickDpr, softSprite } from '../render/sprites.js';
import { GLBackend, detectGpu } from './gl/backend.js';

/**
 * The horizon colour for an arena, as rgb.
 *
 * Deliberately the same expression drawSky() uses for its horizon stop, so the
 * ground fades into exactly the band of sky it meets rather than into a
 * slightly different colour, which shows up as a seam along the skyline.
 */
/** The open domain the camera is standing in, if any. */
function domainAt(world, x, y) {
  for (const d of world.domains) {
    if (d.closed) continue;
    const dx = x - d.center.x, dy = y - d.center.y;
    if (dx * dx + dy * dy < d.radius * d.radius) return d;
  }
  return null;
}

const domainHazeCache = new Map();
function domainHaze(d) {
  const id = d.spec.id;
  let v = domainHazeCache.get(id);
  if (!v) {
    // Darker than the domain's own accent: the air is not the light source,
    // it is what the light has to travel through.
    v = hexToRgb(shade(d.spec.color || '#202028', 0.42));
    domainHazeCache.set(id, v);
  }
  return v;
}

const hazeCache = new Map();
function hazeRgb(arena) {
  const id = arena?.id || 'default';
  let v = hazeCache.get(id);
  if (!v) {
    v = hexToRgb(shade(arena?.fog || '#0a0b10', 2.2));
    hazeCache.set(id, v);
  }
  return v;
}

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
    this.q = { outlines: true, inkScale: 1, detail: 2 };
    // View-space key light: over the camera's left shoulder and slightly down.
    this.light = { x: -0.44, y: 0.62, z: 0.65 };
    this.shadeOpts = makeShade(this.light);

    // The GPU path.
    //
    // It renders into a canvas that is never in the document: the frame is
    // blitted onto the 2D one before anything else is drawn. That keeps every
    // screen-space pass downstream — bloom, the grade, weather, the vignette,
    // the whole HUD — working against a single 2D canvas exactly as before,
    // which is the difference between a contained change and a rewrite of the
    // presentation layer.
    //
    // A machine without WebGL2 keeps the software rasteriser. It is not dead
    // weight: it is the fallback, and it is also the reference — when the two
    // disagree about what a frame should look like, it is right.
    this.gpu = null;
    this.gpuError = null;
    // ?gpu=1 forces it on and ?gpu=0 off, which is how the harnesses exercise
    // both paths on a machine that would otherwise only ever pick one.
    const forced = typeof location !== 'undefined'
      ? new URLSearchParams(location.search).get('gpu') : null;
    const detected = detectGpu();
    const want = forced === '1' ? true : forced === '0' ? false : detected.ok;
    this.gpuInfo = detected;
    if (want && forced !== '0') {
      try {
        this.glCanvas = document.createElement('canvas');
        this.gpu = new GLBackend(this.glCanvas);
      } catch (e) {
        this.gpu = null;
        this.gpuError = e.message;
      }
    }
    if (!this.gpu && !this.gpuError) this.gpuError = detected.reason;
    this.useGpu = !!this.gpu;

    this.resize();
  }

  /** Switch backends at runtime. Returns whether the GPU path is now on. */
  setGpu(on) {
    this.useGpu = !!(on && this.gpu);
    this.resize();
    return this.useGpu;
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
    if (this.gpu) this.gpu.resize(w, h, this.dpr);
    this._makeGrain();
    this._makeVignette();
  }

  /**
   * Shed work when the frame is struggling.
   *
   * The ink outline is never what gets shed. It used to be the first thing to
   * go, which meant that on any machine under about 32fps the game quietly
   * stopped being cel-shaded at all — not a lower-fidelity version of the art
   * direction but a different one, flat-shaded low-poly 3D. Fidelity is a
   * dial; the line is the drawing. Particles, level of detail, domain
   * tessellation and the mote field all give up far more milliseconds per unit
   * of damage done to the look.
   *
   * At the lowest tier the line gets thinner rather than absent, since the
   * outline pass costs roughly what its width costs in fill.
   */
  autoQuality(fps) {
    this._fpsAvg = this._fpsAvg * 0.92 + fps * 0.08;
    const q = this._fpsAvg < 32 ? 0.35 : this._fpsAvg < 44 ? 0.7 : 1;
    if (q !== this.quality) {
      this.quality = q;
      this.q.outlines = true;
      this.q.inkScale = q > 0.5 ? 1 : 0.7;
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
    // Chosen so a surface facing the key lands exactly on 1.0 — the authored
    // colour, flat — and one facing away lands in the deep shadow band. The
    // numbers are the whole cel look: get them wrong and every surface sits
    // between two bands and reads as a gradient.
    S.ambient = 0.42;
    S.key = 0.58;
    S.rim = 0.34;

    // The haze the distance blends toward. Normally it matches the horizon band
    // of the sky, so far geometry meets the sky instead of stopping dead
    // against it — but a domain is a different space, and the air inside it is
    // that space's air. Standing in Malevolent Shrine, distance should go red
    // and black; standing in Unlimited Void it should go white.
    const here = domainAt(world, cam.pos.x, cam.pos.y);
    const haze = here ? domainHaze(here) : hazeRgb(world.arena);
    setFogColor(haze);
    drawSky(ctx, cam, world.arena, W, H);

    const dl = this.dl;
    dl.reset();

    // On the GPU path the draw calls below go to the backend instead of into
    // the list; `dl` still collects the things that are not meshes — sprites,
    // particles, world-space text — and they are painted over the blit.
    const gpu = this.useGpu ? this.gpu : null;
    dl.gpu = gpu;
    if (gpu) {
      gpu.setFogColor(haze);
      gpu.begin(cam, S);
    }

    drawGround3(dl, cam, world, S, this.q);

    // Domains own the ground they cover, so they go down before the props.
    for (const d of world.domains) {
      if (d.closed) continue;
      drawDomain3(dl, cam, d, S, this.q, this.time);
    }

    // Everything standing on the ground breathes the same air. Without this a
    // distant prop is a hard silhouette against a hazed floor, which reads as
    // a sticker rather than as distance.
    S.fogNear = 26;
    S.fogFar = 96;
    drawProps3(dl, cam, world, S, this.q, this.time);
    S.fogNear = undefined;
    drawTelegraphs3(dl, cam, world, S, this.time);
    drawVeil3(dl, cam, world, S, this.time);

    S.fogNear = 30;
    S.fogFar = 105;
    for (const f of world.fighters) {
      drawFighter3(dl, cam, f, this.time, dt, fx, S, this.q);
    }
    S.fogNear = undefined;
    drawSummonLinks3(dl, cam, world, S, this.time);
    drawProjectiles3(dl, cam, world, S, this.q, this.time);

    drawEffects3(dl, cam, fx, S, this.q, this.time, world);
    this._motes(dl, cam, world, dt);

    ctx.save();
    if (cam.roll) {
      ctx.translate(W / 2, H / 2);
      ctx.rotate(cam.roll);
      ctx.translate(-W / 2, -H / 2);
    }
    if (gpu) {
      gpu.end();
      // Over the sky, under everything the draw list still holds. The roll is
      // applied to the blit rather than baked into the projection so that a
      // rolled camera turns the sky and the 3D together, the way it did when
      // both were painted through the same 2D transform.
      ctx.drawImage(this.glCanvas, 0, 0, W, H);
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

  /**
   * Ambient cursed energy.
   *
   * The air in this show is never empty — there is always something drifting
   * through it, and its absence is most of what made this look like a diorama
   * rather than a place. These are world-space points so they sort against
   * geometry and parallax correctly; a screen-space overlay reads as dirt on
   * the lens instead of as motes in the room.
   *
   * They live in a box that follows the camera's focus and wrap around inside
   * it, so the count is fixed however far you walk.
   */
  _motes(dl, cam, world, dt) {
    if (this.quality < 0.4) return;
    const R = 19;
    const H = 8;
    if (!this.motes) {
      this.motes = [];
      const n = 260;
      for (let i = 0; i < n; i++) {
        this.motes.push({
          x: randRange(-R, R), y: randRange(-R, R), z: randRange(0.2, H),
          vx: randRange(-0.14, 0.14), vy: randRange(-0.14, 0.14),
          vz: randRange(0.05, 0.4),
          r: randRange(0.022, 0.07),
          ph: rand() * TAU,
          sp: randRange(0.6, 2.1),
        });
      }
    }
    const cx = cam.lookAt.x;
    const cy = cam.lookAt.y;
    // A domain tints the air it encloses; outside one it is the arena's own
    // cursed-energy colour.
    const dom = world.domains.find((d) => !d.closed);
    const tint = dom ? dom.spec.color : (world.arena?.light || '#9fb4d0');
    // Squared so the field thins fast when the frame is already struggling:
    // atmosphere is the first thing that should go, not the last.
    const qq = clamp01(this.quality);
    const n = Math.round(this.motes.length * qq * qq);
    for (let i = 0; i < n; i++) {
      const m = this.motes[i];
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.z += m.vz * dt;
      if (m.z > H) { m.z = 0.15; m.x = cx + randRange(-R, R); m.y = cy + randRange(-R, R); }
      // Wrap inside the box rather than respawning, so nothing pops in view.
      let dx = m.x - cx, dy = m.y - cy;
      if (dx > R) m.x -= R * 2; else if (dx < -R) m.x += R * 2;
      if (dy > R) m.y -= R * 2; else if (dy < -R) m.y += R * 2;

      cam.project(m.x, m.y, m.z, this._mp || (this._mp = { x: 0, y: 0, d: 0 }));
      const p = this._mp;
      if (p.d <= cam.near || p.d > 60) continue;
      // Breathe, so the field shimmers instead of sitting there.
      const a = 0.24 + 0.26 * (0.5 + 0.5 * Math.sin(this.time * m.sp + m.ph));
      const px = Math.max(1, m.r * cam.f / p.d);
      dl.sprite(p.d, p.x, p.y, px * 9, px * 9, softSprite(tint), a, true);
    }
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

    // An S-curve, not a crush.
    //
    // This used to multiply the picture by itself, which darkens everything
    // and the midtones hardest — the whole frame came out murky and the cast
    // came out darker than the floor they stand on. A curve wants to deepen
    // the shadows *and* lift the highlights, which is two passes: multiply
    // with a copy pulls the darks down, screen with the same copy pushes the
    // brights up, and between them the midtones sit roughly where they were.
    // Net result is contrast, which is what the show has and this did not.
    //
    // Both need the copy: compositing a canvas onto itself reads the
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
      // Multiply pulls the darks down, screen pushes the brights up, and
      // between them the midtones stay put. `overlay` is the same curve in one
      // composite and was tried first — it is several times slower than these
      // two put together in a software rasteriser, and lands darker.
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.34;
      ctx.drawImage(t, 0, 0, W, H);
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.34;
      ctx.drawImage(t, 0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    // Colour is only pulled out for a domain, which drains it deliberately.
    // The flat thirty percent that used to apply always was fighting the
    // palette: this show's nights are saturated — deep blues, hot reds — and
    // desaturating them by default throws away the thing that carries them.
    const desat = clamp01(drain * 0.85);
    if (desat > 0.01) {
      ctx.globalCompositeOperation = 'saturation';
      ctx.globalAlpha = desat;
      ctx.fillStyle = '#808080';
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    const tint = inDom ? dom.spec.color2 || '#0a0a14' : '#0e1624';
    const c = hexToRgb(tint);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgb(${216 + c[0] * 0.11 | 0},${221 + c[1] * 0.1 | 0},${236 + c[2] * 0.07 | 0})`;
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
