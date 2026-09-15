// Projectiles: cursed energy orbs, blood crescents, nails, meteors, dragons.
// One class with enough switches to cover every technique in the game.

import {
  clamp, clamp01, vec, vadd, vsub, vscale, vnorm, vlen, vdist, vangle,
  vfromAngle, wrapAngle, rand, TAU,
} from '../core/math.js';
import { addStatus } from './status.js';

let pid = 1;

export class Projectile {
  constructor(world, owner, spec) {
    this.id = pid++;
    this.world = world;
    this.ownerId = owner ? owner.id : null;
    this.owner = owner;
    this.team = spec.team ?? (owner ? owner.team : 0);
    // Captured at spawn: only a shot the player fired collides generously.
    this.ownerAssist = owner?.aimAssist ?? 0;

    this.pos = vec(spec.pos?.x ?? (owner ? owner.pos.x : 0), spec.pos?.y ?? (owner ? owner.pos.y : 0));
    const angle = spec.angle ?? (owner ? owner.facing : 0);
    const speed = spec.speed ?? 14;
    this.vel = spec.vel ? vec(spec.vel.x, spec.vel.y) : vfromAngle(angle, speed);
    this.angle = angle;
    this.speed = speed;
    this.z = spec.z ?? (owner ? owner.z + 1.0 : 1.0);
    this.vz = spec.vz ?? 0;
    this.gravity = spec.gravity ?? 0;

    this.radius = spec.radius ?? 0.6;
    this.damage = spec.damage ?? 10;
    this.poise = spec.poise ?? 10;
    this.knock = spec.knock ?? 3;
    this.lift = spec.lift ?? 0;
    this.pull = spec.pull ?? 0;
    this.pullRadius = spec.pullRadius ?? 0;
    this.life = spec.life ?? 2;
    this.maxLife = this.life;
    this.pierce = spec.pierce ?? 0;
    this.homing = spec.homing ?? 0;
    this.boomerang = !!spec.boomerang;
    this.explode = spec.explode || null;
    this.burn = spec.burn || null;
    this.status = spec.status || null;
    this.tags = spec.tags || ['technique'];
    this.sureHit = !!spec.sureHit;
    this.pierceInfinity = !!spec.pierceInfinity;
    this.ignoreReinforce = spec.ignoreReinforce || 0;
    this.destroysProps = !!spec.destroysProps;
    this.trench = !!spec.trench;
    this.sourceName = spec.sourceName || '';

    this.vfx = spec.vfx || 'orb';
    this.color = spec.color || '#8ad8ff';
    this.glow = spec.glow || '#ffffff';
    this.trailAmount = spec.trail ?? 0.4;
    this.scaleT = 0;

    this.hitSet = new Set();
    this.dead = false;
    this.age = 0;
    this.trail = [];
    this.onHit = spec.onHit || null;
    this.onExpire = spec.onExpire || null;
    this.ability = spec.ability || null;

    if (spec.fromSky) {
      this.z = 26;
      this.vz = -spec.speed;
      this.vel = vscale(vnorm(this.vel), 2);
      this.gravity = 6;
    }
  }

  update(dt, world) {
    this.age += dt;
    this.life -= dt;
    this.scaleT = clamp01(this.age / 0.12);

    // Homing toward the nearest valid enemy.
    if (this.homing > 0) {
      const target = world.nearestEnemy(this.pos, this.team, 30);
      if (target) {
        const want = vangle(vsub(target.pos, this.pos));
        const cur = vangle(this.vel);
        const turn = wrapAngle(want - cur);
        const step = clamp(turn, -this.homing * dt, this.homing * dt);
        const sp = vlen(this.vel);
        this.vel = vfromAngle(cur + step, sp);
      }
    }

    // Boomerang: reverse once past the midpoint of its life.
    if (this.boomerang && this.age > this.maxLife * 0.45 && !this.reversed) {
      this.reversed = true;
      this.vel = vscale(this.vel, -1);
      this.hitSet.clear();
    }

    // Gravity / vertical travel.
    if (this.gravity) {
      this.vz -= this.gravity * dt;
      this.z += this.vz * dt;
      if (this.z <= 0.2 && this.vz < 0) {
        this.z = 0.2;
        this.detonate(world);
        return;
      }
    }

    const prevX = this.pos.x;
    const prevY = this.pos.y;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.angle = vangle(this.vel);

    // Convergence pull (Blue).
    if (this.pull && this.pullRadius) {
      for (const f of world.fighters) {
        if (f.dead || f.team === this.team) continue;
        const d = vdist(f.pos, this.pos);
        if (d < this.pullRadius && d > 0.05) {
          const dir = vnorm(vsub(this.pos, f.pos));
          const strength = this.pull * (1 - d / this.pullRadius) * dt;
          f.vel.x += dir.x * strength / Math.max(0.4, f.stats.weight ?? 1);
          f.vel.y += dir.y * strength / Math.max(0.4, f.stats.weight ?? 1);
        }
      }
      for (const p of world.particlesSim) {
        const d = vdist(p, this.pos);
        if (d < this.pullRadius) {
          const dir = vnorm(vsub(this.pos, p));
          p.x += dir.x * this.pull * 0.3 * dt;
          p.y += dir.y * this.pull * 0.3 * dt;
        }
      }
    }

    // Trail sampling for the renderer.
    if (this.trailAmount > 0) {
      this.trail.push({ x: this.pos.x, y: this.pos.y, z: this.z, t: 0.32 * this.trailAmount });
      if (this.trail.length > 26) this.trail.shift();
    }
    for (let i = this.trail.length - 1; i >= 0; i--) {
      this.trail[i].t -= dt;
      if (this.trail[i].t <= 0) this.trail.splice(i, 1);
    }

    // Fighter collisions.
    //
    // Tested against the segment travelled this frame rather than the point we
    // ended on. A 40 m/s beam covers two thirds of a metre per frame, which is
    // wider than a person: a point test lets it pass clean through someone and
    // read to the player as the game dropping the hit.
    const slack = this.ownerAssist * 0.5;
    for (const f of world.fighters) {
      if (f.dead || this.hitSet.has(f.id)) continue;
      if (f.team === this.team && !f.decoy) continue;
      if (this.owner === f) continue;
      const reach = this.radius + f.radius + slack;
      if (segDist(prevX, prevY, this.pos.x, this.pos.y, f.pos.x, f.pos.y) > reach) continue;
      if (Math.abs((f.z + f.height * 0.5) - this.z) > 2.2 + this.radius + slack) continue;
      this.hitSet.add(f.id);
      this.hitFighter(f, world);
      if (this.dead) return;
    }

    // Prop collisions.
    if (this.destroysProps || this.explode) {
      for (const p of world.props) {
        if (p.destroyed) continue;
        if (vdist(p.pos, this.pos) > this.radius + p.radius) continue;
        world.damageProp(p, this.damage * 0.8, this.pos);
        if (!this.destroysProps) { this.detonate(world); return; }
      }
    }

    // A "trench" projectile scars the ground it passes over.
    if (this.trench && world.rng.chance(dt * 30)) {
      world.fx('scar', { pos: { x: this.pos.x, y: this.pos.y }, radius: this.radius * 1.3, color: this.color });
    }

    if (this.life <= 0) this.detonate(world);
    if (world.outOfBounds(this.pos, 6)) this.dead = true;
  }

  hitFighter(f, world) {
    const res = world.dealDamage(this.owner, f, {
      damage: this.damage, poise: this.poise, knock: this.knock, lift: this.lift,
      tags: this.tags, projectile: true, sureHit: this.sureHit,
      pierceInfinity: this.pierceInfinity, ignoreReinforce: this.ignoreReinforce,
      status: this.status ? Object.assign({}, this.status) : null,
      burn: this.burn, pos: { x: this.pos.x, y: this.pos.y },
      angle: this.angle, hitstop: 0.06, sourceName: this.sourceName,
      physical: this.tags.includes('physical'),
    });
    if (this.onHit) this.onHit({ world, self: this.owner, victim: f, projectile: this, result: res });
    world.fx('impact', { pos: { x: this.pos.x, y: this.pos.y }, z: this.z, color: this.color, size: this.radius });
    if (this.explode) { this.detonate(world); return; }
    if (this.pierce > 0) this.pierce--;
    else this.dead = true;
  }

  detonate(world) {
    if (this.dead) return;
    this.dead = true;
    if (this.explode) {
      const e = this.explode;
      world.areaDamage(this.owner, {
        pos: { x: this.pos.x, y: this.pos.y }, z: this.z, radius: e.radius,
        damage: e.damage, poise: e.poise ?? this.poise * 0.6, knock: e.knock ?? 8,
        lift: e.lift ?? 2, tags: this.tags, burn: this.burn,
        status: this.status ? Object.assign({}, this.status) : null,
        sourceName: this.sourceName, exclude: this.hitSet,
      });
      world.fx('explosion', {
        pos: { x: this.pos.x, y: this.pos.y }, z: this.z,
        radius: e.radius, color: this.color, glow: this.glow,
      });
      world.shake(clamp(e.radius * 2.2, 4, 20), 0.4);
      world.audio('hitHeavy', { volume: 0.8, pitch: 0.7 });
    }
    if (this.onExpire) this.onExpire({ world, projectile: this });
  }
}

/** Closest distance from point (px,py) to the segment (ax,ay)-(bx,by). */
function segDist(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-9) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
