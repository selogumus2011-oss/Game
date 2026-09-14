// Scene renderer. Draws the arena, entities and effects in depth order and
// applies a small post stack (vignette, grain, chromatic aberration, flashes).

import {
  clamp, clamp01, lerp, TAU, PI, rand, randRange, chance, noise1, fbm1, vdist, vangle, vsub,
} from '../core/math.js';
import { FLATTEN, HEIGHT } from './camera.js';
import { drawFighter, drawShadow, drawAura, hexA, shade } from './characters.js';
import { drawDomainFloor, drawDomainDome, drawDomainOverlay, setDomainQuality } from './domainVisuals.js';
import { SIMPLE_DOMAIN_RADIUS } from '../sim/fighter.js';
import { glowSprite, softSprite, blit, pickDpr } from './sprites.js';
import { flashWindowPhase } from '../sim/combat.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.dpr = 1;
    this.weather = [];
    this.time = 0;
    this.grainCanvas = null;
    this.settings = {
      particles: 1, grain: true, vignette: true, chromatic: true,
      weather: true, shadows: true, showNames: true,
    };
    // Adaptive quality: the renderer steps itself down on slow machines rather
    // than letting the frame rate collapse.
    this.quality = 1;
    this._fpsAvg = 60;
    this.vignetteCanvas = null;
    this.grainPattern = null;
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

  /** Baked once per resize — a full-screen radial gradient per frame is costly. */
  _makeVignette() {
    const W = Math.max(2, Math.round(this.width));
    const H = Math.max(2, Math.round(this.height));
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g2 = c.getContext('2d');
    const grd = g2.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.62)');
    g2.fillStyle = grd;
    g2.fillRect(0, 0, W, H);
    this.vignetteCanvas = c;
  }

  /** Called each frame with the measured frame rate to pick a quality tier. */
  autoQuality(fps) {
    this._fpsAvg = this._fpsAvg * 0.92 + fps * 0.08;
    const q = this._fpsAvg < 34 ? 0.35 : this._fpsAvg < 46 ? 0.7 : 1;
    if (q !== this.quality) {
      this.quality = q;
      setDomainQuality(q);
    }
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
      img.data[i + 3] = 26;
    }
    gc.putImageData(img, 0, 0);
    this.grainCanvas = g;
    this.grainPattern = this.ctx.createPattern(g, 'repeat');
  }

  initWeather(arena) {
    this.weather.length = 0;
    const kind = arena.weather;
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
    this.weatherKind = kind;
  }

  render(world, cam, fx, dt) {
    const ctx = this.ctx;
    const W = this.width, H = this.height;
    this.time += dt;
    const t = this.time;

    this.dt = dt;
    ctx.save();
    cam.applyTransform(ctx);

    this.drawBackground(ctx, world, cam, W, H);
    this.drawGround(ctx, world, cam, W, H);
    this.drawDecals(ctx, fx, cam);
    this.drawZones(ctx, world, cam, t);

    for (const d of world.domains) drawDomainFloor(ctx, cam, d, t);

    this.drawFlatRings(ctx, fx, cam);
    this.drawSimpleDomains(ctx, world, cam, t);
    this.drawVeil(ctx, world, cam, t);

    if (this.settings.shadows) {
      for (const f of world.fighters) if (cam.visible(f.pos.x, f.pos.y)) drawShadow(ctx, cam, f);
      for (const p of world.props) if (!p.destroyed) this.drawPropShadow(ctx, cam, p);
    }

    this.drawEntities(ctx, world, cam, fx, t);

    for (const d of world.domains) drawDomainDome(ctx, cam, d, t);

    this.drawAirFx(ctx, fx, cam, t);

    for (const d of world.domains) drawDomainOverlay(ctx, cam, d, t, W, H);

    this.drawLockOn(ctx, world, cam, t);
    this.drawWeather(ctx, world, cam, dt, W, H);
    this.drawDamageNumbers(ctx, fx, cam);

    ctx.restore();

    this.drawPost(ctx, world, fx, cam, W, H, dt);
  }

  // -------------------------------------------------------------------------

  drawBackground(ctx, world, cam, W, H) {
    const a = world.arena;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, shade(a.fog, 0.75));
    g.addColorStop(0.55, a.fog);
    g.addColorStop(1, shade(a.ground, 0.8));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  drawGround(ctx, world, cam, W, H) {
    const a = world.arena;
    const s = cam.scale;
    const c = cam.project(0, 0, 0);
    const R = world.arenaRadius * s;

    // Arena disc.
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, R);
    g.addColorStop(0, a.groundAlt);
    g.addColorStop(0.75, a.ground);
    g.addColorStop(1, shade(a.ground, 0.55));
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, R, R * FLATTEN, 0, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();

    // Grid: reads as tiling and gives the 3/4 view its depth cue.
    const step = 4;
    ctx.strokeStyle = hexA(a.grid, 0.55);
    ctx.lineWidth = 1;
    const x0 = Math.floor((cam.x - W / s) / step) * step;
    const x1 = cam.x + W / s;
    const y0 = Math.floor((cam.y - H / (s * FLATTEN)) / step) * step;
    const y1 = cam.y + H / (s * FLATTEN);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      const p1 = cam.project(x, y0, 0);
      const p2 = cam.project(x, y1, 0);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    for (let y = y0; y <= y1; y += step) {
      const p1 = cam.project(x0, y, 0);
      const p2 = cam.project(x1, y, 0);
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
    }
    ctx.stroke();

    this.drawGroundDetail(ctx, world, cam, a);

    // Ambient light pool under the camera.
    blit(ctx, softSprite(a.ambient), c.x, c.y, R * 0.9, 0.2 * (a.lightIntensity ?? 0.5), FLATTEN);
    ctx.restore();

    // Edge falloff.
    ctx.save();
    ctx.strokeStyle = hexA(a.fog, 0.9);
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, R + 15, (R + 15) * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  /** Static per-arena floor texture: tiles, grass tufts, cracked stone, tarmac. */
  drawGroundDetail(ctx, world, cam, a) {
    const marks = world.groundMarks;
    if (!marks) return;
    const style = a.floor || 'tiles';
    if (style === 'void') return;
    const s = cam.scale;
    for (const m of marks) {
      if (!cam.visible(m.x, m.y, m.r + 2)) continue;
      const p = cam.project(m.x, m.y, 0);
      const r = m.r * s;
      switch (style) {
        case 'tiles': {
          // Concourse slabs: axis-aligned so the floor reads as tiling.
          const w = r * 2.2, h = r * 1.5 * FLATTEN;
          if (m.kind > 0.9) {
            ctx.fillStyle = hexA(a.light, 0.05);            // lit panel
          } else if (m.kind > 0.55) {
            ctx.fillStyle = hexA(a.groundAlt, 0.5);         // clean slab
          } else {
            ctx.fillStyle = hexA('#000000', 0.2);           // scuffed slab
          }
          ctx.fillRect(p.x - w / 2, p.y - h / 2, w, h);
          ctx.strokeStyle = hexA('#000000', 0.25);
          ctx.lineWidth = 1;
          ctx.strokeRect(p.x - w / 2, p.y - h / 2, w, h);
          break;
        }
        case 'grass': {
          ctx.fillStyle = hexA(m.kind > 0.5 ? '#2c3a26' : '#1e2a1c', 0.5);
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * 0.55 * FLATTEN, m.a, 0, TAU);
          ctx.fill();
          if (m.kind > 0.7) {
            ctx.strokeStyle = hexA('#3f5236', 0.4);
            ctx.lineWidth = 1;
            for (let i = -2; i <= 2; i++) {
              ctx.beginPath();
              ctx.moveTo(p.x + i * r * 0.3, p.y);
              ctx.lineTo(p.x + i * r * 0.3 + r * 0.1, p.y - r * 0.45);
              ctx.stroke();
            }
          }
          break;
        }
        case 'stone': {
          ctx.strokeStyle = hexA('#000000', 0.35);
          ctx.lineWidth = Math.max(1, r * 0.08);
          ctx.beginPath();
          ctx.moveTo(p.x - Math.cos(m.a) * r, p.y - Math.sin(m.a) * r * FLATTEN);
          ctx.lineTo(p.x + Math.cos(m.a) * r, p.y + Math.sin(m.a) * r * FLATTEN);
          ctx.stroke();
          if (m.kind > 0.86) {
            ctx.fillStyle = hexA('#5a2018', 0.3);
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, r * 0.6, r * 0.35 * FLATTEN, m.a, 0, TAU);
            ctx.fill();
          }
          break;
        }
        default: { // asphalt
          if (m.kind > 0.9) {
            // Road markings.
            ctx.fillStyle = hexA('#c8c0a0', 0.16);
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(m.a);
            ctx.fillRect(-r, -r * 0.1, r * 2, r * 0.2);
            ctx.restore();
          } else {
            ctx.fillStyle = hexA(m.tone > 0 ? '#2a3038' : '#0d1015', 0.3);
            ctx.beginPath();
            ctx.ellipse(p.x, p.y, r, r * 0.5 * FLATTEN, m.a, 0, TAU);
            ctx.fill();
          }
          break;
        }
      }
    }
  }

  drawDecals(ctx, fx, cam) {
    ctx.save();
    for (const d of fx.decals) {
      if (!cam.visible(d.x, d.y, 4)) continue;
      const p = cam.project(d.x, d.y, 0);
      const r = d.r * cam.scale;
      const fade = clamp01(d.life / Math.min(d.max, 3));
      ctx.globalAlpha = d.alpha * fade;
      if (d.style === 'blood') {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * 0.55, d.angle, 0, TAU);
        ctx.fill();
      } else if (d.style === 'scorch') {
        blit(ctx, softSprite(d.color), p.x, p.y, r * 1.3, d.alpha * fade * 1.6, FLATTEN);
        ctx.globalAlpha = d.alpha * fade;
      } else if (d.style === 'gouge') {
        ctx.strokeStyle = hexA(d.color, 0.5);
        ctx.lineWidth = Math.max(1, r * 0.5);
        ctx.beginPath();
        ctx.moveTo(p.x - r, p.y - r * 0.2);
        ctx.lineTo(p.x + r, p.y + r * 0.2);
        ctx.stroke();
      } else {
        ctx.fillStyle = hexA(d.color, 0.7);
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, r, r * FLATTEN, d.angle, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawZones(ctx, world, cam, t) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const z of world.zones) {
      if (!cam.visible(z.pos.x, z.pos.y, z.radius + 2)) continue;
      const p = cam.project(z.pos.x, z.pos.y, 0);
      const r = z.radius * cam.scale;
      const fade = clamp01(Math.min(z.t / 0.3, (z.duration - z.t) / 0.5));
      const pulse = 0.7 + 0.3 * Math.sin(t * 6 + z.pos.x);
      blit(ctx, softSprite(z.color), p.x, p.y, r, 0.8 * fade * pulse, FLATTEN);
      // Licking flames along the rim.
      if (z.tags.includes('fire')) {
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU + t * 0.6;
          const rr = r * (0.75 + noise1(i + t * 3, 7) * 0.3);
          const x = p.x + Math.cos(a) * rr;
          const y = p.y + Math.sin(a) * rr * FLATTEN;
          blit(ctx, glowSprite('#ffd166'), x, y, r * 0.3, 0.5 * fade);
        }
      }
    }
    ctx.restore();
  }

  drawSimpleDomains(ctx, world, cam, t) {
    ctx.save();
    for (const f of world.fighters) {
      if (!f.simpleDomain.active || f.dead) continue;
      const p = cam.project(f.pos.x, f.pos.y, 0);
      const r = SIMPLE_DOMAIN_RADIUS * cam.scale;
      ctx.globalCompositeOperation = 'lighter';
      blit(ctx, softSprite('#a8d8ff'), p.x, p.y, r * 1.1, 0.5, FLATTEN);
      ctx.strokeStyle = hexA('#cfe8ff', 0.6 + Math.sin(t * 8) * 0.15);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * FLATTEN, 0, 0, TAU);
      ctx.stroke();
      // Rotating guard marks.
      ctx.strokeStyle = hexA('#ffffff', 0.35);
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 8; i++) {
        const a = t * 1.6 + (i / 8) * TAU;
        const x1 = p.x + Math.cos(a) * r * 0.86;
        const y1 = p.y + Math.sin(a) * r * 0.86 * FLATTEN;
        const x2 = p.x + Math.cos(a) * r;
        const y2 = p.y + Math.sin(a) * r * FLATTEN;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  drawVeil(ctx, world, cam, t) {
    const a = world.arena;
    if (!a.veil && world.mode !== 'culling') return;
    const radius = world.mode === 'culling' ? world.veilRadius : world.arenaRadius;
    const p = cam.project(0, 0, 0);
    const r = radius * cam.scale;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(a.veilColor || '#4a1020', 0.55 + Math.sin(t * 2) * 0.1);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = hexA('#ffffff', 0.14);
    ctx.lineWidth = 1.4;
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = -t * 24;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * FLATTEN, 0, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  drawPropShadow(ctx, cam, p) {
    const s = cam.project(p.pos.x, p.pos.y, 0);
    const r = p.radius * cam.scale;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r * 1.15, r * 0.5, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawEntities(ctx, world, cam, fx, t) {
    // Depth sort by world y so things overlap correctly in the 3/4 view.
    const list = [];
    for (const p of world.props) {
      if (p.destroyed && p.debris <= 0) continue;
      if (cam.visible(p.pos.x, p.pos.y, 8)) list.push({ y: p.pos.y, kind: 'prop', o: p });
    }
    for (const f of world.fighters) {
      if (cam.visible(f.pos.x, f.pos.y, 6)) list.push({ y: f.pos.y, kind: 'fighter', o: f });
    }
    for (const pr of world.projectiles) {
      if (cam.visible(pr.pos.x, pr.pos.y, 8)) list.push({ y: pr.pos.y, kind: 'proj', o: pr });
    }
    for (const pk of world.pickups) {
      if (cam.visible(pk.pos.x, pk.pos.y, 4)) list.push({ y: pk.pos.y, kind: 'pickup', o: pk });
    }
    list.sort((a, b) => a.y - b.y);

    for (const item of list) {
      if (item.kind === 'prop') this.drawProp(ctx, cam, item.o, t);
      else if (item.kind === 'fighter') this.drawFighterFull(ctx, cam, world, item.o, fx, t);
      else if (item.kind === 'proj') this.drawProjectile(ctx, cam, item.o, t);
      else this.drawPickup(ctx, cam, item.o, t);
    }
  }

  drawProp(ctx, cam, p, t) {
    if (p.destroyed) {
      const s = cam.project(p.pos.x, p.pos.y, 0);
      const r = p.radius * cam.scale;
      ctx.save();
      ctx.fillStyle = shade(p.color, 0.5);
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r * 1.1, r * 0.45, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
      return;
    }
    const shakeX = p.shakeT > 0 ? Math.sin(t * 60) * p.shakeT * 6 : 0;
    p.shakeT = Math.max(0, p.shakeT - 1 / 60);

    const base = cam.project(p.pos.x, p.pos.y, 0);
    const top = cam.project(p.pos.x, p.pos.y, p.height);
    const r = p.radius * cam.scale;
    const hp = clamp01(p.hp / p.maxHp);

    ctx.save();
    ctx.translate(shakeX, 0);

    switch (p.type) {
      case 'tree': {
        const h = base.y - top.y;
        // Trunk runs from the ground to the underside of the canopy.
        ctx.fillStyle = shade('#3a2a1c', 1);
        ctx.beginPath();
        ctx.moveTo(base.x - r * 0.32, base.y);
        ctx.lineTo(base.x - r * 0.16, base.y - h * 0.72);
        ctx.lineTo(base.x + r * 0.16, base.y - h * 0.72);
        ctx.lineTo(base.x + r * 0.32, base.y);
        ctx.closePath();
        ctx.fill();
        const cy = base.y - h * 0.78;
        for (let i = 0; i < 4; i++) {
          const a = p.rot + i * 1.7;
          ctx.fillStyle = shade(p.color, 0.75 + i * 0.16);
          ctx.beginPath();
          ctx.ellipse(base.x + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.35 - i * r * 0.18,
            r * 1.25, r * 0.9, 0, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'torii': {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = r * 0.34;
        ctx.beginPath();
        ctx.moveTo(base.x - r, base.y);
        ctx.lineTo(base.x - r * 0.9, top.y + 8);
        ctx.moveTo(base.x + r, base.y);
        ctx.lineTo(base.x + r * 0.9, top.y + 8);
        ctx.stroke();
        ctx.lineWidth = r * 0.28;
        ctx.beginPath();
        ctx.moveTo(base.x - r * 1.4, top.y);
        ctx.lineTo(base.x + r * 1.4, top.y);
        ctx.moveTo(base.x - r * 1.1, top.y + 14);
        ctx.lineTo(base.x + r * 1.1, top.y + 14);
        ctx.stroke();
        break;
      }
      case 'car': {
        const h = Math.max(14, base.y - top.y);
        // Wheels first so the body sits on them.
        ctx.fillStyle = '#0d0e12';
        for (const wx of [-r * 1.0, r * 1.0]) {
          ctx.beginPath();
          ctx.ellipse(base.x + wx, base.y - h * 0.12, r * 0.34, r * 0.34, 0, 0, TAU);
          ctx.fill();
        }
        const body = ctx.createLinearGradient(0, base.y - h * 1.6, 0, base.y);
        body.addColorStop(0, shade(p.color, 1.35));
        body.addColorStop(1, shade(p.color, 0.6));
        ctx.fillStyle = body;
        roundRect(ctx, base.x - r * 1.55, base.y - h, r * 3.1, h, r * 0.35);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        // Cabin.
        ctx.fillStyle = shade(p.color, 1.1);
        roundRect(ctx, base.x - r * 0.95, base.y - h * 1.75, r * 1.9, h * 0.8, r * 0.28);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = hexA('#8ad8ff', 0.3);
        roundRect(ctx, base.x - r * 0.82, base.y - h * 1.66, r * 1.64, h * 0.5, r * 0.18);
        ctx.fill();
        break;
      }
      case 'brazier': {
        ctx.fillStyle = p.color;
        ctx.fillRect(base.x - r * 0.4, top.y, r * 0.8, base.y - top.y);
        ctx.globalCompositeOperation = 'lighter';
        blit(ctx, glowSprite(p.emissive || '#ff7a2a'), base.x, top.y - Math.abs(Math.sin(t * 7)) * 4, r * 2.6, 0.9);
        ctx.globalCompositeOperation = 'source-over';
        break;
      }
      case 'sign': {
        ctx.strokeStyle = '#4a4a52';
        ctx.lineWidth = r * 0.5;
        ctx.beginPath();
        ctx.moveTo(base.x, base.y);
        ctx.lineTo(base.x, top.y);
        ctx.stroke();
        ctx.fillStyle = p.color;
        ctx.fillRect(base.x - r * 2.2, top.y - 6, r * 4.4, r * 2.4);
        if (p.emissive) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = hexA(p.emissive, 0.35);
          ctx.fillRect(base.x - r * 2.4, top.y - 8, r * 4.8, r * 2.8);
          ctx.globalCompositeOperation = 'source-over';
        }
        break;
      }
      case 'skullpile': {
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * TAU + p.rot;
          const x = base.x + Math.cos(a) * r * 0.6;
          const y = base.y - Math.abs(Math.sin(a)) * r * 0.5 - (i % 3) * r * 0.25;
          ctx.fillStyle = shade(p.color, 0.8 + (i % 3) * 0.1);
          ctx.beginPath();
          ctx.ellipse(x, y, r * 0.3, r * 0.34, 0, 0, TAU);
          ctx.fill();
          ctx.fillStyle = '#14161c';
          ctx.beginPath();
          ctx.arc(x - r * 0.1, y, r * 0.06, 0, TAU);
          ctx.arc(x + r * 0.1, y, r * 0.06, 0, TAU);
          ctx.fill();
        }
        break;
      }
      case 'building': {
        const h = base.y - top.y;
        const w = r * 2.1;
        const face = ctx.createLinearGradient(base.x - w / 2, 0, base.x + w / 2, 0);
        face.addColorStop(0, shade(p.color, 0.55));
        face.addColorStop(0.5, shade(p.color, 1.0));
        face.addColorStop(1, shade(p.color, 0.45));
        ctx.fillStyle = face;
        ctx.fillRect(base.x - w / 2, top.y, w, h);
        // Roof.
        ctx.fillStyle = shade(p.color, 1.4);
        ctx.beginPath();
        ctx.moveTo(base.x - w / 2, top.y);
        ctx.lineTo(base.x - w / 2 + r * 0.4, top.y - r * 0.45);
        ctx.lineTo(base.x + w / 2 + r * 0.4, top.y - r * 0.45);
        ctx.lineTo(base.x + w / 2, top.y);
        ctx.closePath();
        ctx.fill();
        // Windows: a stable lit/dark pattern seeded from the prop id.
        const cols = 4, rows = Math.max(2, Math.round(h / (r * 0.75)));
        const wx = w / (cols + 1), wy = h / (rows + 1);
        for (let cx2 = 0; cx2 < cols; cx2++) {
          for (let ry = 0; ry < rows; ry++) {
            const lit = ((p.id * 7 + cx2 * 13 + ry * 29) % 5) === 0;
            ctx.fillStyle = lit ? hexA(p.emissive || '#ffd08a', 0.5) : 'rgba(0,0,0,0.45)';
            ctx.fillRect(base.x - w / 2 + wx * (cx2 + 0.6), top.y + wy * (ry + 0.6), wx * 0.55, wy * 0.5);
          }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(base.x - w / 2, top.y, w, h);
        break;
      }
      case 'barrier': {
        const h = Math.max(10, base.y - top.y);
        ctx.fillStyle = shade(p.color, 1.05);
        ctx.fillRect(base.x - r * 1.6, base.y - h, r * 3.2, h);
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(base.x - r * 1.6, base.y - h, r * 3.2, h);
        // Hazard stripes.
        ctx.save();
        ctx.beginPath();
        ctx.rect(base.x - r * 1.6, base.y - h, r * 3.2, h);
        ctx.clip();
        ctx.strokeStyle = hexA('#f0f0e0', 0.55);
        ctx.lineWidth = Math.max(2, r * 0.5);
        for (let i = -3; i < 6; i++) {
          ctx.beginPath();
          ctx.moveTo(base.x - r * 1.6 + i * r * 0.9, base.y);
          ctx.lineTo(base.x - r * 1.6 + i * r * 0.9 + h, base.y - h);
          ctx.stroke();
        }
        ctx.restore();
        break;
      }
      default: {
        // Generic prism: pillars, rocks, buildings.
        const h = base.y - top.y;
        const grd = ctx.createLinearGradient(base.x - r, 0, base.x + r, 0);
        grd.addColorStop(0, shade(p.color, 0.65));
        grd.addColorStop(0.45, shade(p.color, 1.05));
        grd.addColorStop(1, shade(p.color, 0.5));
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.moveTo(base.x - r, base.y);
        ctx.lineTo(base.x - r, top.y);
        ctx.lineTo(base.x + r, top.y);
        ctx.lineTo(base.x + r, base.y);
        ctx.closePath();
        ctx.fill();
        // Top face.
        ctx.fillStyle = shade(p.color, 1.35);
        ctx.beginPath();
        ctx.ellipse(base.x, top.y, r, r * 0.45, 0, 0, TAU);
        ctx.fill();
        // Damage cracks.
        if (hp < 0.8) {
          ctx.strokeStyle = hexA('#000000', 0.55);
          ctx.lineWidth = 1.4;
          const cracks = Math.round((1 - hp) * 6);
          for (let i = 0; i < cracks; i++) {
            const x = base.x + ((i * 37) % 100) / 100 * r * 2 - r;
            ctx.beginPath();
            ctx.moveTo(x, top.y + 4);
            ctx.lineTo(x + (i % 2 ? 5 : -5), base.y - h * 0.4);
            ctx.lineTo(x + (i % 2 ? -3 : 3), base.y);
            ctx.stroke();
          }
        }
        break;
      }
    }
    ctx.restore();
  }

  drawFighterFull(ctx, cam, world, f, fx, t) {
    // Motion trail.
    if (f.trail.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const tr of f.trail) {
        const a = clamp01(tr.t / 0.28) * 0.22;
        const p = cam.project(tr.x, tr.y, tr.z);
        ctx.globalAlpha = a;
        ctx.fillStyle = f.technique?.color || f.color;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y - f.height * cam.scale * HEIGHT * 0.45, f.radius * cam.scale * 0.8,
          f.height * cam.scale * HEIGHT * 0.45, 0, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // Backlight: a soft rim behind the silhouette keeps dark fighters legible
    // against dark ground without an expensive outline pass.
    if (!f.dead) {
      const bp = cam.project(f.pos.x, f.pos.y, f.z);
      const bh = f.height * cam.scale * HEIGHT;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      blit(ctx, softSprite(f.technique?.color || f.eyeColor || '#ffffff'),
        bp.x, bp.y - bh * 0.5, bh * 0.62, f.isPlayer ? 0.28 : 0.2);
      ctx.restore();
    }

    drawAura(ctx, cam, f, t);
    drawFighter(ctx, cam, f, t, this.dt || 1 / 60, fx);

    if (!f.dead) this.drawFighterOverlay(ctx, cam, world, f, t);
  }

  drawFighterOverlay(ctx, cam, world, f, t) {
    const p = cam.project(f.pos.x, f.pos.y, f.z);
    const hpx = cam.scale * HEIGHT;
    const top = p.y - f.height * hpx - 12;

    // Player gets a ground marker instead of a bar.
    if (f.isPlayer) {
      ctx.save();
      ctx.strokeStyle = hexA(f.technique?.color || '#ffffff', 0.35);
      ctx.lineWidth = 1.5;
      const r = f.radius * cam.scale * 1.5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * FLATTEN, 0, 0, TAU);
      ctx.stroke();
      // Facing wedge.
      ctx.fillStyle = hexA(f.technique?.color || '#ffffff', 0.18);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      const a0 = f.facing - 0.22, a1 = f.facing + 0.22;
      ctx.lineTo(p.x + Math.cos(a0) * r * 2.2, p.y + Math.sin(a0) * r * 2.2 * FLATTEN);
      ctx.lineTo(p.x + Math.cos(a1) * r * 2.2, p.y + Math.sin(a1) * r * 2.2 * FLATTEN);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      return;
    }

    if (f.decoy) return;

    // Enemy health / poise bars.
    const w = clamp(f.radius * cam.scale * 3.4, 34, 90);
    const hpFrac = f.hpFraction;
    const poiseFrac = clamp01(f.poise / f.maxPoise);
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(p.x - w / 2 - 1, top - 1, w + 2, 7);
    ctx.fillStyle = f.team === (world.player?.team ?? 0) ? '#6fd4c4' : (f.grade === 'special' ? '#ff4d4d' : '#e0e0e0');
    ctx.fillRect(p.x - w / 2, top, w * hpFrac, 4);
    ctx.fillStyle = hexA('#ffd166', 0.85);
    ctx.fillRect(p.x - w / 2, top + 4, w * poiseFrac, 2);

    if (this.settings.showNames) {
      ctx.font = '600 10px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = hexA('#ffffff', 0.7);
      ctx.fillText(f.name, p.x, top - 5);
    }

    // Status pips.
    const bad = f.statuses.filter((s) => s.type !== 'buff').slice(0, 6);
    if (bad.length) {
      let x = p.x - (bad.length * 7) / 2;
      for (const s of bad) {
        ctx.fillStyle = STATUS_COLOR[s.type] || '#ffffff';
        ctx.fillRect(x, top + 8, 5, 3);
        x += 7;
      }
    }

    // Wind-up telegraph: a bright arc so attacks are readable.
    if (f.state === 'attack' && f.action && f.action.phase === 'startup') {
      const def = f.action.def;
      const prog = clamp01(f.action.t / def.startup);
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = hexA(def.guardBreak ? '#ff4d4d' : '#ffd166', 0.25 + prog * 0.35);
      ctx.lineWidth = 2;
      const r = def.range * cam.scale;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, r, r * FLATTEN, 0, f.facing - def.arc, f.facing + def.arc);
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (f.state === 'cast' && f.cast) {
      // A shrinking ring while a technique charges: the window to interrupt.
      const ab = f.cast.ability;
      const dur = Math.max(0.01, ab.castTime || 0.2);
      const prog = clamp01(f.cast.t / dur);
      const col = ab.ultimate ? '#ff4d4d' : (f.technique?.color || '#ffd166');
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const rr = lerp(2.6, 0.8, prog) * cam.scale;
      ctx.strokeStyle = hexA(col, 0.25 + prog * 0.5);
      ctx.lineWidth = 2 + prog * 3;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rr, rr * FLATTEN, 0, 0, TAU);
      ctx.stroke();
      // Arc above the head showing how far along the cast is.
      ctx.strokeStyle = hexA(col, 0.85);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, top - 16, 9, -PI / 2, -PI / 2 + prog * TAU);
      ctx.stroke();
      if (ab.ultimate) {
        ctx.font = `800 9px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ff6b6b';
        ctx.fillText('MAX', p.x, top - 28);
      }
      ctx.restore();
    }
    if (f.state === 'domainCast') {
      const prog = clamp01(f.domainCast ? f.domainCast.t / f.domainCast.dur : 0);
      ctx.strokeStyle = '#ff4d4d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, top - 18, 10, -PI / 2, -PI / 2 + prog * TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawProjectile(ctx, cam, pr, t) {
    const p = cam.project(pr.pos.x, pr.pos.y, pr.z);
    const s = cam.scale;
    const r = pr.radius * s * lerp(0.4, 1, pr.scaleT);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Trail.
    if (pr.trail.length > 1) {
      ctx.strokeStyle = hexA(pr.color, 0.35);
      ctx.lineWidth = r * 0.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < pr.trail.length; i++) {
        const q = cam.project(pr.trail[i].x, pr.trail[i].y, pr.trail[i].z);
        if (i === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
    }

    // Core.
    blit(ctx, glowSprite(pr.color), p.x, p.y, r * 2.4, 0.95);
    blit(ctx, glowSprite(pr.glow || '#ffffff'), p.x, p.y, r * 1.1, 0.9);

    // Shape flourishes per visual.
    switch (pr.vfx) {
      case 'orb_purple':
        ctx.strokeStyle = hexA('#ffffff', 0.8);
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r * (1.1 + i * 0.3), r * (0.5 + i * 0.2), t * 3 + i, 0, TAU);
          ctx.stroke();
        }
        break;
      case 'orb_blue':
        ctx.strokeStyle = hexA('#ffffff', 0.5);
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU + t * 2;
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(a) * r * 2.4, p.y + Math.sin(a) * r * 2.4);
          ctx.lineTo(p.x + Math.cos(a) * r * 1.1, p.y + Math.sin(a) * r * 1.1);
          ctx.stroke();
        }
        break;
      case 'nail':
        ctx.strokeStyle = pr.color;
        ctx.lineWidth = Math.max(1.5, r * 0.5);
        ctx.beginPath();
        ctx.moveTo(p.x - Math.cos(pr.angle) * r * 3, p.y - Math.sin(pr.angle) * r * 3 * FLATTEN);
        ctx.lineTo(p.x + Math.cos(pr.angle) * r * 2, p.y + Math.sin(pr.angle) * r * 2 * FLATTEN);
        ctx.stroke();
        break;
      case 'blood_edge':
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 1.4, pr.angle - 1.2, pr.angle + 1.2);
        ctx.arc(p.x, p.y, r * 0.7, pr.angle + 1.2, pr.angle - 1.2, true);
        ctx.fill();
        break;
      case 'meteor':
        ctx.fillStyle = hexA('#2a1408', 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.85, 0, TAU);
        ctx.fill();
        for (let i = 0; i < 10; i++) {
          const a = rand() * TAU;
          ctx.fillStyle = hexA('#ff7a1a', 0.5);
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, r * 0.2, 0, TAU);
          ctx.fill();
        }
        break;
      case 'ice':
        // A crystal shard aligned with its flight path.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(pr.angle);
        ctx.fillStyle = hexA('#d8f4ff', 0.9);
        ctx.beginPath();
        ctx.moveTo(r * 2.4, 0);
        ctx.lineTo(0, -r * 0.8);
        ctx.lineTo(-r * 1.2, 0);
        ctx.lineTo(0, r * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = hexA('#ffffff', 0.8);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
        break;
      case 'bolt': {
        // Lightning: a jagged line redrawn every frame.
        ctx.strokeStyle = hexA('#ffffff', 0.95);
        ctx.lineWidth = Math.max(1.5, r * 0.4);
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const off = i === 0 || i === 6 ? 0 : (rand() - 0.5) * r * 3;
          const x = p.x - Math.cos(pr.angle) * r * 4 * (1 - t) + -Math.sin(pr.angle) * off;
          const y = p.y - Math.sin(pr.angle) * r * 4 * FLATTEN * (1 - t) + Math.cos(pr.angle) * off * FLATTEN;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.strokeStyle = hexA(pr.color, 0.6);
        ctx.lineWidth = Math.max(3, r);
        ctx.stroke();
        break;
      }
      case 'shard':
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(pr.angle + t * 6);
        ctx.fillStyle = pr.color;
        ctx.fillRect(-r * 1.6, -r * 0.35, r * 3.2, r * 0.7);
        ctx.restore();
        break;
      case 'missile':
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(pr.angle);
        ctx.fillStyle = pr.color;
        ctx.beginPath();
        ctx.moveTo(r * 1.8, 0);
        ctx.lineTo(-r * 1.2, -r * 0.55);
        ctx.lineTo(-r * 1.2, r * 0.55);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = hexA('#ffb03a', 0.8);
        ctx.beginPath();
        ctx.arc(-r * 1.5, 0, r * 0.5 * (0.7 + Math.sin(t * 40) * 0.3), 0, TAU);
        ctx.fill();
        ctx.restore();
        break;
      case 'sphere':
        // Constructed steel: a solid ball with a hard highlight.
        ctx.fillStyle = '#5a4a2a';
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = hexA(pr.glow || '#ffffff', 0.8);
        ctx.beginPath();
        ctx.arc(p.x - r * 0.3, p.y - r * 0.3, r * 0.3, 0, TAU);
        ctx.fill();
        break;
      case 'wave':
        // A wall of water: a wide crescent facing the direction of travel.
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(pr.angle);
        ctx.fillStyle = hexA(pr.color, 0.7);
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.5, -1.25, 1.25);
        ctx.arc(0, 0, r * 0.5, 1.25, -1.25, true);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = hexA('#ffffff', 0.6);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.restore();
        break;
      case 'dragon': {
        // A long body drawn along its own trail.
        ctx.strokeStyle = hexA(pr.color, 0.85);
        ctx.lineCap = 'round';
        for (let pass = 0; pass < 2; pass++) {
          ctx.lineWidth = r * (pass ? 0.8 : 1.8);
          ctx.strokeStyle = hexA(pass ? '#ffffff' : pr.color, pass ? 0.5 : 0.85);
          ctx.beginPath();
          for (let i = 0; i < pr.trail.length; i++) {
            const q = cam.project(pr.trail[i].x, pr.trail[i].y, pr.trail[i].z);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          }
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }
        ctx.fillStyle = hexA('#ffffff', 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.6, 0, TAU);
        ctx.fill();
        break;
      }
      case 'uzumaki':
      case 'supernova': {
        // Compressed mass: nested counter-rotating spirals.
        for (let k = 0; k < 3; k++) {
          ctx.strokeStyle = hexA(k % 2 ? '#ffffff' : pr.color, 0.5);
          ctx.lineWidth = 2;
          ctx.beginPath();
          for (let i = 0; i <= 30; i++) {
            const th = (i / 30) * TAU * 1.6 + t * (k % 2 ? 4 : -4) + k;
            const rr = r * (0.25 + (i / 30) * 0.95);
            const x = p.x + Math.cos(th) * rr;
            const y = p.y + Math.sin(th) * rr * FLATTEN;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        break;
      }
      case 'fire_arrow':
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(pr.angle);
        for (let i = 0; i < 7; i++) {
          const off = -i * r * 0.8;
          const k = 1 - i / 7;
          ctx.fillStyle = hexA(i < 2 ? '#fff0c0' : pr.color, 0.55 * k);
          ctx.beginPath();
          ctx.ellipse(off, Math.sin(t * 30 + i) * r * 0.2, r * 1.1 * k, r * 0.8 * k, 0, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
        break;
      default:
        ctx.fillStyle = hexA('#ffffff', 0.85);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 0.45, 0, TAU);
        ctx.fill();
        break;
    }
    ctx.restore();
  }

  drawPickup(ctx, cam, pk, t) {
    const p = cam.project(pk.pos.x, pk.pos.y, 0.5 + Math.sin(pk.bob) * 0.15);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    blit(ctx, glowSprite('#ffd166'), p.x, p.y, 26, 0.75);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(p.x - 8, p.y + 6);
    ctx.lineTo(p.x + 8, p.y - 6);
    ctx.stroke();
    ctx.restore();
  }

  // -------------------------------------------------------------------------
  // Effects passes
  // -------------------------------------------------------------------------

  drawFlatRings(ctx, fx, cam) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of fx.rings) {
      if (!r.flat) continue;
      const p = cam.project(r.x, r.y, r.z);
      const rad = (r.current ?? r.r) * cam.scale;
      const a = clamp01(r.life / r.max) * (r.alpha ?? 1);
      ctx.strokeStyle = hexA(r.color, a * 0.8);
      ctx.lineWidth = Math.max(1, r.width * cam.scale * a);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, rad, rad * FLATTEN, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawAirFx(ctx, fx, cam, t) {
    const ctx2 = ctx;
    ctx2.save();
    ctx2.globalCompositeOperation = 'lighter';

    // Cuts: flash, hold, then open. See Effects.cut for the staging.
    for (const c of fx.cuts) {
      if (c.delay > 0) continue;
      const k = clamp01(c.life / c.max);
      const age = 1 - k;
      const p = cam.project(c.x, c.y, c.z);
      const s = cam.scale;
      const half = c.len * 0.5 * s;
      const dx = Math.cos(c.angle) * half;
      const dy = Math.sin(c.angle) * half * FLATTEN;
      ctx2.save();
      ctx2.translate(p.x, p.y);
      ctx2.rotate(Math.atan2(dy, dx));
      const L = Math.hypot(dx, dy);
      if (age < 0.16) {
        const f = 1 - age / 0.16;
        ctx2.fillStyle = hexA('#ffffff', f);
        ctx2.fillRect(-L, -1 - f, L * 2, 2 + f * 2);
      } else {
        const open = 1 - Math.pow(1 - clamp01((age - 0.16) / 0.5), 2.6);
        const fade = clamp01(k / 0.55);
        const gap = open * c.width * s * 0.5;
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.fillStyle = hexA('#05010a', fade * 0.85);
        ctx2.fillRect(-L, -gap, L * 2, gap * 2);
        ctx2.globalCompositeOperation = 'lighter';
        ctx2.fillStyle = hexA(c.color, fade);
        ctx2.fillRect(-L, -gap - 1.5, L * 2, 3);
        ctx2.fillRect(-L, gap - 1.5, L * 2, 3);
        if (open < 0.7) {
          ctx2.fillStyle = hexA('#ffffff', fade * (1 - open / 0.7));
          ctx2.fillRect(-L, -1.5, L * 2, 3);
        }
      }
      ctx2.restore();
    }
    ctx2.globalCompositeOperation = 'lighter';

    // Beams — each technique's line is drawn the way that technique cuts.
    for (const b of fx.beams) {
      const a = clamp01(b.life / b.max);
      const p1 = cam.project(b.from.x, b.from.y, b.z);
      const p2 = cam.project(b.to.x, b.to.y, b.z);
      const w = b.width * cam.scale * (0.4 + a * 0.8);
      const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      const nx = -Math.sin(ang), ny = Math.cos(ang);
      const line = (off, width, col, alpha) => {
        ctx2.strokeStyle = hexA(col, alpha);
        ctx2.lineCap = 'round';
        ctx2.lineWidth = Math.max(0.8, width);
        ctx2.beginPath();
        ctx2.moveTo(p1.x + nx * off, p1.y + ny * off);
        ctx2.lineTo(p2.x + nx * off, p2.y + ny * off);
        ctx2.stroke();
      };

      switch (b.style) {
        case 'dismantle':
          // Three parallel cuts, the middle one deepest.
          line(-w * 0.7, w * 0.22, b.color, 0.6 * a);
          line(0, w * 0.4, b.color, 0.9 * a);
          line(w * 0.7, w * 0.22, b.color, 0.6 * a);
          line(0, w * 0.12, '#ffffff', a);
          break;
        case 'cleave': {
          // One heavy cut with a torn, uneven edge.
          ctx2.fillStyle = hexA(b.color, 0.75 * a);
          ctx2.beginPath();
          const steps = 10;
          for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const edge = w * 0.5 * (0.5 + noise1(i * 1.7, 4) * 0.9) * Math.sin(t * PI);
            ctx2.lineTo(lerp(p1.x, p2.x, t) + nx * edge, lerp(p1.y, p2.y, t) + ny * edge);
          }
          for (let i = steps; i >= 0; i--) {
            const t = i / steps;
            const edge = -w * 0.5 * (0.5 + noise1(i * 2.3, 9) * 0.9) * Math.sin(t * PI);
            ctx2.lineTo(lerp(p1.x, p2.x, t) + nx * edge, lerp(p1.y, p2.y, t) + ny * edge);
          }
          ctx2.closePath();
          ctx2.fill();
          line(0, w * 0.16, '#ffffff', a);
          break;
        }
        case 'worldcut': {
          // A cut aimed at the world: huge, with the air folding around it.
          const grd = ctx2.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          grd.addColorStop(0, hexA(b.color, 0.1 * a));
          grd.addColorStop(0.3, hexA(b.color, 0.9 * a));
          grd.addColorStop(1, hexA('#ffffff', 0.5 * a));
          ctx2.strokeStyle = grd;
          ctx2.lineCap = 'butt';
          ctx2.lineWidth = w * (1.4 + (1 - a) * 1.2);
          ctx2.beginPath();
          ctx2.moveTo(p1.x, p1.y);
          ctx2.lineTo(p2.x, p2.y);
          ctx2.stroke();
          line(0, w * 0.3, '#ffffff', a);
          // Displaced air on either side.
          for (const side of [-1, 1]) {
            ctx2.strokeStyle = hexA('#ffffff', 0.25 * a);
            ctx2.lineWidth = 1.5;
            ctx2.beginPath();
            for (let i = 0; i <= 12; i++) {
              const t = i / 12;
              const bulge = side * w * (1.2 + Math.sin(t * PI) * 1.6) * (1 - a * 0.4);
              const x = lerp(p1.x, p2.x, t) + nx * bulge;
              const y = lerp(p1.y, p2.y, t) + ny * bulge;
              if (i === 0) ctx2.moveTo(x, y);
              else ctx2.lineTo(x, y);
            }
            ctx2.stroke();
          }
          break;
        }
        case 'blood_beam': {
          // A pressurised jet, narrow and fast, shedding droplets.
          line(0, w * 0.5, b.color, 0.85 * a);
          line(0, w * 0.16, '#ffd8dc', a);
          for (let i = 0; i < 8; i++) {
            const t = (i / 8 + (1 - a)) % 1;
            const off = (noise1(i * 3.1, 6) - 0.5) * w * 2.4;
            ctx2.fillStyle = hexA(b.color, 0.7 * a);
            ctx2.beginPath();
            ctx2.arc(lerp(p1.x, p2.x, t) + nx * off, lerp(p1.y, p2.y, t) + ny * off, 2.2, 0, TAU);
            ctx2.fill();
          }
          break;
        }
        default: {
          const grd = ctx2.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          grd.addColorStop(0, hexA(b.color, 0.15 * a));
          grd.addColorStop(0.25, hexA(b.color, 0.85 * a));
          grd.addColorStop(1, hexA('#ffffff', 0.2 * a));
          ctx2.strokeStyle = grd;
          ctx2.lineCap = 'round';
          ctx2.lineWidth = w;
          ctx2.beginPath();
          ctx2.moveTo(p1.x, p1.y);
          ctx2.lineTo(p2.x, p2.y);
          ctx2.stroke();
          line(0, w * 0.28, '#ffffff', 0.9 * a);
          break;
        }
      }
    }

    // Slash arcs.
    for (const arc of fx.arcs) {
      const a = clamp01(arc.life / arc.max);
      const p = cam.project(arc.x, arc.y, arc.z);
      const r = arc.range * cam.scale;
      const spread = arc.arc;
      const sweep = lerp(-spread, spread, 1 - a);
      ctx2.save();
      ctx2.translate(p.x, p.y);
      ctx2.scale(1, FLATTEN);
      ctx2.strokeStyle = hexA(arc.color, 0.85 * a);
      ctx2.lineWidth = Math.max(1.5, arc.width * cam.scale * a);
      ctx2.lineCap = 'round';
      if (arc.style === 'circle') {
        ctx2.beginPath();
        ctx2.arc(0, 0, r, 0, TAU);
        ctx2.stroke();
      } else if (arc.style === 'sound') {
        for (let i = 0; i < 3; i++) {
          ctx2.globalAlpha = a * (0.5 - i * 0.12);
          ctx2.beginPath();
          ctx2.arc(0, 0, r * (0.4 + i * 0.3) * (1.2 - a * 0.2), arc.angle - spread, arc.angle + spread);
          ctx2.stroke();
        }
        ctx2.globalAlpha = 1;
      } else {
        ctx2.beginPath();
        ctx2.arc(0, 0, r, arc.angle - spread, arc.angle + sweep);
        ctx2.stroke();
        // Inner highlight.
        ctx2.strokeStyle = hexA('#ffffff', 0.6 * a);
        ctx2.lineWidth = Math.max(1, arc.width * cam.scale * a * 0.35);
        ctx2.beginPath();
        ctx2.arc(0, 0, r * 0.94, arc.angle - spread, arc.angle + sweep);
        ctx2.stroke();
      }
      ctx2.restore();
    }

    // Non-flat rings (shockwave spheres).
    for (const r of fx.rings) {
      if (r.flat) continue;
      const p = cam.project(r.x, r.y, r.z);
      const rad = (r.current ?? r.r) * cam.scale;
      const a = clamp01(r.life / r.max) * (r.alpha ?? 1);
      ctx2.strokeStyle = hexA(r.color, a * 0.9);
      ctx2.lineWidth = Math.max(1, r.width * cam.scale * a);
      ctx2.beginPath();
      ctx2.arc(p.x, p.y, rad, 0, TAU);
      ctx2.stroke();
    }

    // Lightning.
    for (const b of fx.bolts) {
      const a = clamp01(b.life / b.max);
      ctx2.strokeStyle = hexA(b.color, a);
      ctx2.lineWidth = Math.max(1, b.width * cam.scale * a);
      ctx2.beginPath();
      for (let i = 0; i < b.pts.length; i++) {
        const q = cam.project(b.pts[i].x, b.pts[i].y, b.pts[i].z);
        if (i === 0) ctx2.moveTo(q.x, q.y);
        else ctx2.lineTo(q.x, q.y);
      }
      ctx2.stroke();
    }

    // Particles.
    for (const pt of fx.particles) {
      const a = clamp01(pt.life / pt.max);
      const p = cam.project(pt.x, pt.y, pt.z);
      const size = pt.size * cam.scale * (0.4 + a * 0.8);
      if (pt.kind === 'smoke') {
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.fillStyle = hexA(pt.color, a * 0.28);
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, size * 2.2, 0, TAU);
        ctx2.fill();
        ctx2.globalCompositeOperation = 'lighter';
      } else if (pt.kind === 'chunk' || pt.kind === 'shard') {
        ctx2.globalCompositeOperation = 'source-over';
        ctx2.save();
        ctx2.translate(p.x, p.y);
        ctx2.rotate(pt.rot);
        ctx2.fillStyle = hexA(pt.color, a);
        ctx2.fillRect(-size, -size * 0.6, size * 2, size * 1.2);
        ctx2.restore();
        ctx2.globalCompositeOperation = 'lighter';
      } else if (pt.stretch > 0) {
        const len = Math.hypot(pt.vx, pt.vy) * pt.stretch * 0.06 * cam.scale;
        const ang = Math.atan2(pt.vy * FLATTEN, pt.vx);
        ctx2.strokeStyle = hexA(pt.color, a);
        ctx2.lineWidth = Math.max(1, size);
        ctx2.lineCap = 'round';
        ctx2.beginPath();
        ctx2.moveTo(p.x, p.y);
        ctx2.lineTo(p.x - Math.cos(ang) * len, p.y - Math.sin(ang) * len);
        ctx2.stroke();
      } else {
        if (pt.glow > 0) blit(ctx2, glowSprite(pt.color), p.x, p.y, size * 3, a * pt.glow);
        ctx2.fillStyle = hexA(pt.color, a);
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, Math.max(0.6, size), 0, TAU);
        ctx2.fill();
      }
    }

    // Kanji / symbol bursts.
    ctx2.globalCompositeOperation = 'lighter';
    ctx2.textAlign = 'center';
    for (const s of fx.sprites) {
      const a = clamp01(s.life / s.max);
      const p = cam.project(s.x, s.y, s.z + (1 - a) * 1.2);
      const size = s.size * (s.style === 'flash' ? lerp(1.5, 1, a) : 1);
      ctx2.save();
      ctx2.globalAlpha = a;
      ctx2.font = `900 ${size}px "Noto Sans JP", system-ui, sans-serif`;
      ctx2.fillStyle = s.color;
      if (this.quality > 0.5) {
        ctx2.shadowColor = s.color;
        ctx2.shadowBlur = 18;
      }
      ctx2.fillText(s.text, p.x, p.y);
      ctx2.restore();
    }
    ctx2.restore();
  }

  drawDamageNumbers(ctx, fx, cam) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const n of fx.numbers) {
      const a = clamp01(n.life / n.max);
      const p = cam.project(n.x, n.y, n.z);
      const scale = n.crit ? lerp(1.5, 1, clamp01((1 - a) * 3)) : 1;
      ctx.globalAlpha = a;
      ctx.font = `${n.weight} ${Math.round(n.size * scale)}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(n.text, p.x, p.y);
      ctx.fillStyle = n.color;
      ctx.fillText(n.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawLockOn(ctx, world, cam, t) {
    const p = world.player;
    if (!p || !p.intent.lockTarget) return;
    const target = world.fighters.find((f) => f.id === p.intent.lockTarget);
    if (!target || target.dead) return;
    const sp = cam.project(target.pos.x, target.pos.y, target.z + target.height * 0.55);
    const r = 20 + Math.sin(t * 4) * 2;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,209,102,0.85)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const a = t * 0.8 + i * (TAU / 4);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, a, a + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,209,102,0.9)';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawWeather(ctx, world, cam, dt, W, H) {
    if (!this.settings.weather || !this.weather.length || this.quality < 0.5) return;
    const kind = this.weatherKind;
    ctx.save();
    for (const p of this.weather) {
      p.y += (kind === 'rain' ? 1.6 : 0.18) * p.v * dt;
      p.x += (kind === 'rain' ? 0.12 : 0.06) * Math.sin(this.time * 0.5 + p.p) * dt;
      if (p.y > 1.1) { p.y = -0.1; p.x = Math.random(); }
      const x = ((p.x * W) + cam.x * -2) % W;
      const y = p.y * H;
      const xx = x < 0 ? x + W : x;
      if (kind === 'rain') {
        ctx.strokeStyle = `rgba(170,200,235,${0.3 * p.s})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(xx, y);
        ctx.lineTo(xx - 3, y + 16 * p.v);
        ctx.stroke();
      } else if (kind === 'embers') {
        ctx.fillStyle = `rgba(255,150,60,${0.5 * p.s})`;
        ctx.beginPath();
        ctx.arc(xx, H - ((p.y * H * 1.2) % H), 1.6 * p.s, 0, TAU);
        ctx.fill();
      } else if (kind === 'leaves') {
        ctx.fillStyle = `rgba(160,180,120,${0.28 * p.s})`;
        ctx.save();
        ctx.translate(xx, y);
        ctx.rotate(this.time * p.v * 2 + p.p);
        ctx.fillRect(-3, -1.5, 6, 3);
        ctx.restore();
      } else { // ash
        ctx.fillStyle = `rgba(205,200,195,${0.38 * p.s})`;
        ctx.beginPath();
        ctx.arc(xx, y, 1.8 * p.s, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // -------------------------------------------------------------------------

  /** The veil (帳) dropping over the arena at the start of a fight. */
  drawVeilIntro(ctx, W, H, dt) {
    if (!(this.veilIntro > 0)) return;
    this.veilIntro -= dt;
    const t = clamp01(1 - this.veilIntro / this.veilIntroMax);
    ctx.save();
    // The curtain falls, then lifts away from the middle.
    const fall = clamp01(t / 0.45);
    const lift = clamp01((t - 0.55) / 0.45);
    const top = -H + H * fall * (1 + lift);
    ctx.globalAlpha = 1 - lift * 0.9;
    const g = ctx.createLinearGradient(0, top, 0, top + H);
    g.addColorStop(0, '#05060a');
    g.addColorStop(0.82, '#0b0714');
    g.addColorStop(1, 'rgba(40,10,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, H);
    // The seam of the veil.
    ctx.strokeStyle = hexA('#6a2aa0', 0.8 * (1 - lift));
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, top + H);
    ctx.lineTo(W, top + H);
    ctx.stroke();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = hexA('#8a3ad0', 0.25 * (1 - lift));
    ctx.fillRect(0, top + H - 26, W, 26);
    ctx.globalCompositeOperation = 'source-over';
    // 帳.
    if (fall > 0.5) {
      ctx.globalAlpha = clamp01((fall - 0.5) * 3) * (1 - lift);
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.round(H * 0.16)}px "Noto Sans JP", system-ui, sans-serif`;
      ctx.fillStyle = '#b06ae0';
      ctx.fillText('帳', W / 2, H * 0.52);
      ctx.font = `700 14px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.fillText('THE VEIL DESCENDS', W / 2, H * 0.58);
    }
    ctx.restore();
  }

  /** Radial manga speed lines — used for dashes and impact frames. */
  drawSpeedLines(ctx, W, H, strength, color, seed, fx = W / 2, fy = H / 2) {
    if (strength <= 0.01) return;
    const cx = fx, cy = fy;
    const R = Math.hypot(W, H) * 0.62;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = hexA(color, 0.5 * strength);
    for (let i = 0; i < 54; i++) {
      const a = (i / 54) * TAU + seed;
      const inner = R * (0.34 + noise1(i * 1.7, 3) * 0.3) * (1.1 - strength * 0.35);
      ctx.lineWidth = (0.6 + noise1(i * 0.9, 11) * 3.2) * strength;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Ragged white gashes across the frame — reserved for the biggest hits. */
  drawImpactGashes(ctx, W, H, k, strength, color, seed) {
    const n = Math.round(3 + strength * 3);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = seed * 2.3 + i * 1.97;
      const cx = W * (0.5 + Math.cos(a * 3.1) * 0.32);
      const cy = H * (0.5 + Math.sin(a * 2.3) * 0.3);
      const len = Math.hypot(W, H) * (0.3 + (i % 3) * 0.16) * (0.4 + k * 0.6);
      const w = (5 + (i % 4) * 7) * strength * k;
      ctx.globalAlpha = 0.5 * k * strength;
      ctx.fillStyle = i % 3 === 0 ? color : '#ffffff';
      ctx.beginPath();
      ctx.moveTo(cx - Math.cos(a) * len, cy - Math.sin(a) * len);
      ctx.lineTo(cx - Math.sin(a) * w, cy + Math.cos(a) * w);
      ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
      ctx.lineTo(cx + Math.sin(a) * w * 0.4, cy - Math.cos(a) * w * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  drawPost(ctx, world, fx, cam, W, H, dt) {
    // Domain colour wash for whoever is inside one.
    const player = world.player;
    if (player && player.insideDomain && !player.insideDomain.closed) {
      const d = player.insideDomain;
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = hexA(d.spec.color2 || '#000000', 0.35);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.8);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, hexA(d.spec.color, 0.22));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Flashes.
    for (const f of fx.flashes) {
      const a = clamp01(f.life / f.max) * f.strength;
      ctx.save();
      if (f.mode === 'invert') {
        ctx.globalCompositeOperation = 'difference';
        ctx.fillStyle = hexA(f.color, a);
      } else if (f.mode === 'multiply') {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = hexA(f.color, a);
      } else {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hexA(f.color, a);
      }
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Low health pulse.
    if (player && !player.dead && player.hpFraction < 0.3) {
      const pulse = 0.12 + Math.sin(this.time * 5) * 0.05;
      ctx.save();
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.75);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(190,20,30,${pulse * (1 - player.hpFraction / 0.3)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Burnout desaturation hint.
    if (player && player.flags.burnout) {
      ctx.save();
      ctx.globalCompositeOperation = 'saturation';
      ctx.fillStyle = 'hsl(0,0%,50%)';
      ctx.globalAlpha = 0.5;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    // Impact frames: the panel-border moment on a big connection.
    for (const im of fx.impacts) {
      const k = clamp01(im.life / im.max);
      let fxp = W / 2, fyp = H / 2;
      if (im.focus) {
        const p = cam.project(im.focus.x, im.focus.y, im.focus.z ?? 1.3);
        fxp = p.x; fyp = p.y;
      }
      this.drawSpeedLines(ctx, W, H, k * im.strength, im.color, im.seed, fxp, fyp);
      if (im.gash) this.drawImpactGashes(ctx, W, H, k, im.strength, im.color, im.seed);
      if (im.flash) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = hexA(im.color, 0.16 * k * im.strength);
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }
    }

    // Dash speed lines.
    if (player && player.state === 'dash') {
      this.drawSpeedLines(ctx, W, H, 0.5, '#ffffff', this.time * 3);
    }

    this.drawVeilIntro(ctx, W, H, dt);

    // Vignette (baked).
    if (this.settings.vignette && this.vignetteCanvas) {
      ctx.drawImage(this.vignetteCanvas, 0, 0, W, H);
    }

    // Film grain (cached pattern, skipped on the low quality tier).
    if (this.settings.grain && this.grainPattern && this.quality > 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.translate(-((Math.random() * 128) | 0), -((Math.random() * 128) | 0));
      ctx.fillStyle = this.grainPattern;
      ctx.fillRect(0, 0, W + 128, H + 128);
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const STATUS_COLOR = {
  slow: '#7aa6d8', stun: '#ffd166', frozen: '#9fe870', root: '#9aa3ad',
  burn: '#ff8a1e', bleed: '#e0344f', soulWound: '#7fd4a8', weakPoint: '#d8c98a',
  fragment: '#ff9f6b', techniqueSealed: '#b7c9d8', silenced: '#e8e0c8',
  indicted: '#cfa8ff', blindAsh: '#8a8a7a', glassCannon: '#ff4d4d',
  transfiguring: '#7fd4a8', adaptation: '#c8b06a', overdrive: '#ff3b30',
  rctActive: '#8ef0bd', shield: '#6fd4c4',
};
