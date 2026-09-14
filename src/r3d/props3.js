// Projectiles, zones, pickups, summon tethers and attack telegraphs in 3D.
//
// Every technique's projectile gets a shape rather than a glow blob, because in
// 3D a cursed energy orb, a blood crescent and a falling meteor are all
// different objects and should read as different objects.

import { clamp, clamp01, lerp, TAU, PI, noise1, rand } from '../core/math.js';
import { matCompose, matMul, hexToRgb } from './core3.js';
import {
  MeshBuilder, taperedBox, box, cylinder, cone, sphere, prism, disc, ringMesh,
  plane, drawMesh, drawOutline,
} from './geom3.js';
import { cached, shade } from './models3.js';
import { glowSprite, softSprite } from '../render/sprites.js';

const tmp = new Float32Array(16);
const proj = { x: 0, y: 0, d: 0 };
const proj2 = { x: 0, y: 0, d: 0 };

const sphereUnit = () => cached('prSphere', () => sphere(1, 14, 9, '#ffffff'));
const ringUnit = () => cached('prRing', () => ringMesh(0.82, 1, 24, '#ffffff', 1));
const discUnit = () => cached('prDisc', () => disc(1, 20, '#ffffff', 1));
const coneUnit = () => cached('prCone', () => cone(1, 1, 6, '#ffffff'));
const boxUnit = () => cached('prBox', () => box(1, 1, 1, '#ffffff', { z0: 0 }));

/** A double-ended crystal, used for ice and energy shards. */
const shardUnit = () => cached('prShard', () => {
  const b = new MeshBuilder();
  b.merge(cone(1, 1, 5, '#ffffff'), null);
  b.merge(cone(1, 0.5, 5, '#e8e8f4'), matCompose(0, 0, 0, PI, 0, 0));
  return b.build();
});

/** A crescent blade lying in the XY plane, pointing along +x. */
const crescentUnit = () => cached('prCrescent', () => {
  const b = new MeshBuilder();
  const seg = 12, span = 2.3;
  const inner = [], outer = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = -span * 0.5 + span * t;
    const taper = Math.sin(t * PI);
    inner.push(b.vert(Math.cos(a) * lerp(1, 0.4, taper), Math.sin(a) * lerp(1, 0.4, taper), 0));
    outer.push(b.vert(Math.cos(a), Math.sin(a), 0));
  }
  for (let i = 0; i < seg; i++) {
    b.quad(inner[i], outer[i], outer[i + 1], inner[i + 1], '#ffffff', true, 1);
  }
  return b.build();
});

const tintOf = (color, gain = 1) => {
  const c = hexToRgb(color);
  return [c[0] / 190 * gain, c[1] / 190 * gain, c[2] / 190 * gain];
};

// ---------------------------------------------------------------------------
// Projectiles
// ---------------------------------------------------------------------------

export function drawProjectiles3(dl, cam, world, S, q, time) {
  S.additive = true;
  for (const pr of world.projectiles) {
    if (!cam.visible(pr.pos.x, pr.pos.y, pr.z, pr.radius * 3 + 2)) continue;
    drawProjectile3(dl, cam, pr, S, q, time);
  }
  drawZones3(dl, cam, world, S, time);
  drawPickups3(dl, cam, world, S, time);
  S.additive = false;
  S.alpha = 1;
  S.tint = null;
}

function drawProjectile3(dl, cam, pr, S, q, time) {
  const r = pr.radius * lerp(0.4, 1, pr.scaleT);
  const x = pr.pos.x, y = pr.pos.y, z = pr.z;
  const a = pr.angle;
  const tint = tintOf(pr.color, 1.6);
  const glow = tintOf(pr.glow || '#ffffff', 1.8);

  // Trail: a ribbon of shrinking spheres along the recorded path.
  if (pr.trail && pr.trail.length > 1) {
    S.tint = tint;
    for (let i = 1; i < pr.trail.length; i++) {
      const t = i / pr.trail.length;
      const p = pr.trail[i];
      S.alpha = 0.32 * t;
      const rr = r * 0.7 * t;
      matCompose(p.x, p.y, p.z, 0, 0, 0, rr, rr, rr, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
    }
  }

  S.alpha = 1;
  switch (pr.vfx) {
    case 'ice':
    case 'shard':
      S.tint = tint;
      matCompose(x, y, z, 0, PI / 2, a + (pr.vfx === 'shard' ? time * 6 : 0),
        r * 0.7, r * 0.7, r * 2.6, tmp);
      drawMesh(dl, cam, shardUnit(), tmp, S);
      S.alpha = 0.4;
      S.tint = glow;
      matCompose(x, y, z, 0, 0, 0, r * 1.5, r * 1.5, r * 1.5, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
      break;

    case 'nail':
      S.tint = tint;
      matCompose(x, y, z, 0, PI / 2, a, r * 0.32, r * 0.32, r * 3.4, tmp);
      drawMesh(dl, cam, coneUnit(), tmp, S);
      break;

    case 'missile':
    case 'bolt':
      S.tint = tint;
      matCompose(x, y, z, 0, PI / 2, a, r * 0.6, r * 0.6, r * 3, tmp);
      drawMesh(dl, cam, coneUnit(), tmp, S);
      if (pr.vfx === 'bolt') {
        // A jagged discharge trailing the head.
        let prev = null;
        for (let i = 0; i <= 6; i++) {
          const t = i / 6;
          const off = i === 0 || i === 6 ? 0 : (noise1(i * 3 + time * 40, pr.id) - 0.5) * r * 3;
          const px = x - Math.cos(a) * r * 4 * (1 - t) - Math.sin(a) * off;
          const py = y - Math.sin(a) * r * 4 * (1 - t) + Math.cos(a) * off;
          cam.project(px, py, z + off * 0.4, proj);
          if (prev && proj.d > cam.near) {
            dl.line(proj.d - 0.05, prev.x, prev.y, proj.x, proj.y, '#ffffff',
              Math.max(1.5, r * 12 / proj.d), true, 0.9);
          }
          prev = proj.d > cam.near ? { x: proj.x, y: proj.y } : null;
        }
      }
      break;

    case 'slash':
    case 'cleave':
    case 'dismantle':
    case 'wave':
    case 'worldcut':
      S.tint = tint;
      matCompose(x, y, z, 0, 0.35, a, r * 2.2, r * 2.2, 1, tmp);
      drawMesh(dl, cam, crescentUnit(), tmp, S);
      S.alpha = 0.5;
      matCompose(x, y, z, 0, 0.35, a, r * 1.7, r * 1.7, 1, tmp);
      drawMesh(dl, cam, crescentUnit(), tmp, S);
      break;

    case 'meteor':
    case 'volcano': {
      S.additive = false;
      S.tint = [1, 0.8, 0.7];
      matCompose(x, y, z, time * 2, time * 3, 0, r, r, r, tmp);
      drawMesh(dl, cam, cached('prRock', () => sphere(1, 7, 5, '#2a1408')), tmp, S);
      S.additive = true;
      S.tint = tint;
      S.alpha = 0.6;
      matCompose(x, y, z, 0, 0, 0, r * 1.9, r * 1.9, r * 1.9, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
      break;
    }

    case 'dragon': {
      // A serpent of cursed energy: a chain of spheres that undulates.
      S.tint = tint;
      for (let i = 0; i < 7; i++) {
        const back = i * r * 0.9;
        const w = Math.sin(time * 9 - i * 0.8) * r * 0.7;
        const rr = r * (1.1 - i * 0.1);
        S.alpha = 0.85 - i * 0.08;
        matCompose(x - Math.cos(a) * back - Math.sin(a) * w,
          y - Math.sin(a) * back + Math.cos(a) * w,
          z + Math.cos(time * 7 - i * 0.6) * r * 0.3,
          0, 0, 0, rr, rr, rr, tmp);
        drawMesh(dl, cam, sphereUnit(), tmp, S);
      }
      break;
    }

    case 'supernova':
    case 'sphere':
    case 'uzumaki': {
      S.tint = tint;
      S.alpha = 0.9;
      matCompose(x, y, z, 0, 0, time * 2, r, r, r, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
      S.alpha = 0.35;
      matCompose(x, y, z, 0, 0, -time * 1.4, r * 1.6, r * 1.6, r * 1.6, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
      // Orbiting rings — the compression that makes it a Hollow, not a ball.
      for (let i = 0; i < 3; i++) {
        S.alpha = 0.5;
        const rr = r * (1.5 + i * 0.35);
        matCompose(x, y, z, PI / 2.6 + i * 0.6, time * (1.4 + i * 0.5), time * 0.8,
          rr, rr, 1, tmp);
        drawMesh(dl, cam, ringUnit(), tmp, S);
      }
      break;
    }

    case 'claw':
    case 'grab':
      S.tint = tint;
      for (let i = -1; i <= 1; i++) {
        matCompose(x, y, z + i * r * 0.5, 0, PI / 2, a + i * 0.16,
          r * 0.16, r * 0.16, r * 3, tmp);
        drawMesh(dl, cam, coneUnit(), tmp, S);
      }
      break;

    default: {
      // Cursed energy orb: a bright core inside a soft shell.
      S.tint = glow;
      S.alpha = 0.95;
      matCompose(x, y, z, 0, 0, time, r * 0.55, r * 0.55, r * 0.55, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
      S.tint = tint;
      S.alpha = 0.45;
      matCompose(x, y, z, 0, 0, -time * 0.7, r, r, r, tmp);
      drawMesh(dl, cam, sphereUnit(), tmp, S);
      break;
    }
  }
  S.alpha = 1;
}

// ---------------------------------------------------------------------------

function drawZones3(dl, cam, world, S, time) {
  for (const z of world.zones) {
    if (!cam.visible(z.pos.x, z.pos.y, 0, z.radius + 2)) continue;
    const fade = clamp01(Math.min(z.t / 0.3, (z.duration - z.t) / 0.5));
    const pulse = 0.7 + 0.3 * Math.sin(time * 6 + z.pos.x);
    S.tint = tintOf(z.color, 1.4);
    S.alpha = 0.35 * fade * pulse;
    matCompose(z.pos.x, z.pos.y, 0.09, 0, 0, 0, z.radius, z.radius, 1, tmp);
    drawMesh(dl, cam, discUnit(), tmp, S);
    S.alpha = 0.7 * fade;
    matCompose(z.pos.x, z.pos.y, 0.1, 0, 0, time * 0.5, z.radius, z.radius, 1, tmp);
    drawMesh(dl, cam, ringUnit(), tmp, S);
    // Fire zones lick upward.
    if (z.tags && z.tags.includes('fire')) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU + time * 0.6;
        const rr = z.radius * (0.72 + noise1(i + time * 3, 7) * 0.3);
        const h = 0.6 + noise1(i * 2 + time * 5, 3) * 1.4;
        S.alpha = 0.22 * fade;
        matCompose(z.pos.x + Math.cos(a) * rr, z.pos.y + Math.sin(a) * rr, 0.1,
          0, 0, a, 0.18, 0.18, h, tmp);
        drawMesh(dl, cam, coneUnit(), tmp, S);
      }
    }
  }
}

function drawPickups3(dl, cam, world, S, time) {
  if (!world.pickups) return;
  for (const p of world.pickups) {
    const bob = Math.sin(time * 2 + p.pos.x) * 0.12;
    S.tint = tintOf(p.tool?.color || '#cfd6e0', 1.5);
    S.alpha = 0.8;
    matCompose(p.pos.x, p.pos.y, 0.9 + bob, 0, 0, time, 0.16, 0.16, 0.8, tmp);
    drawMesh(dl, cam, boxUnit(), tmp, S);
    S.alpha = 0.35;
    matCompose(p.pos.x, p.pos.y, 0.06, 0, 0, -time * 0.6, 0.9, 0.9, 1, tmp);
    drawMesh(dl, cam, ringUnit(), tmp, S);
  }
}

// ---------------------------------------------------------------------------
// Tethers and telegraphs
// ---------------------------------------------------------------------------

/** A line of cursed energy from a summoner to each of their shikigami. */
export function drawSummonLinks3(dl, cam, world, S, time) {
  for (const f of world.fighters) {
    if (f.dead || !f.summonOwner) continue;
    const owner = world.byId(f.summonOwner);
    if (!owner || owner.dead) continue;
    cam.project(owner.pos.x, owner.pos.y, owner.z + owner.height * 0.5, proj);
    cam.project(f.pos.x, f.pos.y, f.z + f.height * 0.5, proj2);
    if (proj.d <= cam.near || proj2.d <= cam.near) continue;
    const col = owner.technique?.color || '#8b7bd8';
    dl.line((proj.d + proj2.d) * 0.5, proj.x, proj.y, proj2.x, proj2.y, col,
      1.5, true, 0.2 + Math.sin(time * 3 + f.id) * 0.06);
  }
}

/**
 * Attack readability. A wind-up draws its reach on the floor, a cast draws a
 * shrinking ring, and a domain cast draws a rising column — all in world space
 * so distance reads correctly.
 */
export function drawTelegraphs3(dl, cam, world, S, time) {
  S.additive = true;
  for (const f of world.fighters) {
    if (f.dead) continue;

    if (f.state === 'attack' && f.action && f.action.phase === 'startup') {
      const def = f.action.def;
      const prog = clamp01(f.action.t / def.startup);
      const col = def.guardBreak ? '#ff4d4d' : '#ffd166';
      S.tint = tintOf(col, 1.5);
      S.alpha = 0.22 + prog * 0.35;
      // A wedge on the floor covering exactly the arc that will connect.
      const mesh = wedgeMesh(def.arc);
      const r = def.range;
      matCompose(f.pos.x, f.pos.y, 0.095, 0, 0, f.facing, r, r, 1, tmp);
      drawMesh(dl, cam, mesh, tmp, S);
    }

    if (f.state === 'cast' && f.cast) {
      const ab = f.cast.ability;
      const dur = Math.max(0.01, ab.castTime || 0.2);
      const prog = clamp01(f.cast.t / dur);
      const col = ab.ultimate ? '#ff4d4d' : (f.technique?.color || '#ffd166');
      S.tint = tintOf(col, 1.6);
      S.alpha = 0.3 + prog * 0.5;
      const rr = lerp(2.6, 0.8, prog);
      matCompose(f.pos.x, f.pos.y, 0.1, 0, 0, time * 3, rr, rr, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
    }

    if (f.state === 'domainCast') {
      const prog = clamp01(f.domainCast ? f.domainCast.t / f.domainCast.dur : 0);
      const spec = f.domainCast?.spec;
      const col = spec?.color || '#ff4d4d';
      S.tint = tintOf(col, 1.8);
      // The hands come together and the space starts to fold: a column of
      // light rising out of the caster, widening as the chant finishes.
      S.alpha = 0.25 + prog * 0.45;
      const rr = 0.7 + prog * 1.6;
      matCompose(f.pos.x, f.pos.y, 0.1, 0, 0, -time * 4, rr, rr, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
      S.alpha = 0.16 + prog * 0.3;
      matCompose(f.pos.x, f.pos.y, 0.1, 0, 0, time * 1.5,
        rr * 0.8, rr * 0.8, 3 + prog * 7, tmp);
      drawMesh(dl, cam, cached('prCyl', () => cylinder(1, 0.6, 1, 10, '#ffffff')), tmp, S);
      // Ground cracks racing out to where the barrier will land.
      const R = (spec?.radius || 12) * prog;
      S.alpha = 0.5 * prog;
      matCompose(f.pos.x, f.pos.y, 0.11, 0, 0, 0, R, R, 1, tmp);
      drawMesh(dl, cam, ringUnit(), tmp, S);
    }
  }
  S.additive = false;
  S.alpha = 1;
  S.tint = null;
}

/** A floor wedge spanning ±arc about +x, cached per quantised angle. */
function wedgeMesh(arc) {
  const q = Math.round(arc * 12) / 12;
  return cached(`wedge:${q}`, () => {
    const b = new MeshBuilder();
    const seg = 14;
    const inner = [], outer = [];
    for (let i = 0; i <= seg; i++) {
      const a = -q + (q * 2) * (i / seg);
      inner.push(b.vert(Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0));
      outer.push(b.vert(Math.cos(a), Math.sin(a), 0));
    }
    for (let i = 0; i < seg; i++) {
      b.quad(inner[i], outer[i], outer[i + 1], inner[i + 1], '#ffffff', true, 1);
    }
    return b.build();
  });
}
