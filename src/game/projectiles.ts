import * as THREE from 'three';
import { GEO, glowMat, markShared } from '../core/assets';
import { sfx } from '../core/audio';
import { TRAITS, WEAPONS, type Element, type WeaponDef, type WeaponId } from '../data/weapons';
import type { Enemy } from './enemies';
import { untargetable } from './enemyAI';
import { mirrorReflects, reflectShot } from './enemyParts';
import { X, devourShot, ringUp } from './partsEndless';
import { enemyShotSpeedMul, enemyTimeScale, lawBounce, lawRangeMul } from './abyss';

// Mirrors bounce shots back, except these (railgun goes through, blades and flame aren't bullets to it).
// Explosive shells never reach the check: they burst on contact.
const UNREFLECTED = new Set<WeaponId | undefined>(['rail', 'blade', 'flame', 'singularity', undefined]);
import type { Game } from './game';

export interface PlayerBullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  knock: number;
  pierce: number;
  bounce: number;
  blast: number;
  drag: number;
  grow: number;
  homing: boolean;
  element?: Element;
  elementChance: number;
  color: number;
  hits: Set<Enemy>;
  bounces: number;    // wall ricochets so far
  shot: ShotStats;
  travel: number;     // disc: seconds of outward flight left
  returning: boolean; // disc: flying back to the player
  target: Enemy | null;  // swarm: the locked enemy this missile tracks
}

interface EnemyBullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  r: number;
  dmg: number;
  color: number;
  split?: EnemyShotSplit;
  bounce: number;     // wall ricochets left
  curve?: EnemyShotCurve;
  age: number;
}

// Extra behavior for an enemy shot.
export interface EnemyShotOpts {
  split?: EnemyShotSplit;
  bounce?: number;
  curve?: EnemyShotCurve;
}
// A thrown blade: flies out `reach` along `angle` and swings back on the other side, `width` wide.
export interface EnemyShotCurve {
  ox: number;
  oz: number;
  angle: number;
  reach: number;
  width: number;
  time: number;
}
export interface EnemyShotSplit {
  t: number;       // seconds until it splits
  n: number;       // into this many
  spread: number;  // radians between them
}

// Per-shot stats after the player's upgrades are applied, plus what the weapon's signature trait
// needs to know about the shot (see Arsenal).
export interface ShotStats {
  dmg: number;
  pierce: number;
  bounce: number;
  blast: number;
  homing: boolean;
  weapon?: WeaponId;
  level?: number;
  child?: boolean;          // spawned by a trait (shards, cluster bomblets...): never triggers traits again
  charged?: boolean;        // pulse: charged shot
  group?: ShotGroup;        // shotgun: pellets of one trigger pull
  homingTurn?: number;      // override the homing turn rate (rocket Lv5 tracks gently)
  refract?: number;         // prism: how many more times this light can split
  range?: number;           // disc: outward distance before it flies back
}

export interface ShotGroup { nearHits: number; quaked: boolean }

// Bullet shapes (unit size; scaled by the weapon's size / stretch). Everything else is a glowing sphere.
const SHAPES: Partial<Record<WeaponId, THREE.BufferGeometry>> = {
  frost: markShared(new THREE.OctahedronGeometry(1)),
  prism: markShared(new THREE.OctahedronGeometry(1)),
  disc: markShared(new THREE.TorusGeometry(1, 0.3, 6, 20).rotateX(Math.PI / 2)),
  spike: markShared(new THREE.ConeGeometry(0.6, 2, 5).rotateX(Math.PI / 2)),
  rocket: markShared(new THREE.ConeGeometry(0.7, 2.2, 6).rotateX(Math.PI / 2)),
  swarm: markShared(new THREE.ConeGeometry(0.6, 2.4, 5).rotateX(Math.PI / 2)),
};

// Trail left behind each frame by some weapons: [color, chance per frame, size, life].
const TRAILS: Partial<Record<WeaponId, [number, number, number, number]>> = {
  frost: [0xeafcff, 0.6, 0.12, 0.35],
  disc: [0xff5ce1, 0.6, 0.16, 0.12],
  prism: [0xffffff, 0.5, 0.07, 0.2],
  spike: [0xff3b5c, 0.3, 0.06, 0.15],
  rocket: [0x8a8a99, 0.8, 0.22, 0.5],
  swarm: [0xe8e8f0, 0.9, 0.12, 0.45],
  singularity: [0xc77dff, 1, 0.16, 0.4],
};
const PRISM_SPARK = [0xff4d6d, 0x5cff8a, 0x5cb8ff];

const ENEMY_BULLET_RADIUS = 0.28;
const ENEMY_BULLET_DMG = 10;
const HOMING_RANGE = 9;
const HOMING_TURN = 3.5;  // radians per second
const ELEMENTS: Element[] = ['burn', 'frost', 'shock'];
const tmpDir = new THREE.Vector3();

export class Projectiles {
  private readonly bullets: PlayerBullet[] = [];
  private readonly enemyBullets: EnemyBullet[] = [];
  private readonly pool: THREE.Mesh[] = [];  // hidden spare bullet meshes, still in the scene

  constructor(private readonly g: Game) {}

  firePlayer(origin: THREE.Vector3, angle: number, speed: number, w: WeaponDef, shot: ShotStats, target: Enemy | null = null): PlayerBullet {
    const m = this.acquire(glowMat(w.color, w.glow ?? 3), SHAPES[w.id]);
    m.scale.setScalar(w.size);
    m.scale.z = w.size * (w.stretch ?? 2.4);
    m.rotation.y = angle;
    m.position.copy(origin);
    const b: PlayerBullet = {
      mesh: m, vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed), life: w.life * lawRangeMul(),
      dmg: shot.dmg, knock: w.knock, pierce: shot.pierce, bounce: shot.bounce + lawBounce(), blast: shot.blast,
      drag: w.drag ?? 0, grow: w.grow ?? 0, homing: shot.homing,
      element: w.element, elementChance: w.elementChance ?? 0, color: w.color, hits: new Set(), bounces: 0, shot,
      travel: (shot.range ?? 0) / speed, returning: false, target,
    };
    this.bullets.push(b);
    return b;
  }

  // Plasma blade: enemy bullets inside the swing's arc turn around and become player shots.
  reflectEnemyBullets(center: THREE.Vector3, radius: number, facing: number, halfArc: number, dmgMul: number, w: WeaponDef): number {
    let n = 0;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const eb = this.enemyBullets[i], p = eb.mesh.position;
      const dx = p.x - center.x, dz = p.z - center.z;
      if (Math.hypot(dx, dz) > radius) continue;
      if (Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - facing), Math.cos(Math.atan2(dx, dz) - facing))) > halfArc) continue;
      const speed = Math.max(18, eb.vel.length() * 1.6);
      this.firePlayer(p.clone(), Math.atan2(-eb.vel.x, -eb.vel.z), speed, { ...w, size: 0.2, stretch: 3, life: 0.8, pierce: 0 }, {
        dmg: eb.dmg * dmgMul, pierce: 0, bounce: 0, blast: 0, homing: false, weapon: 'blade', child: true,
      });
      this.release(eb.mesh);
      this.enemyBullets.splice(i, 1);
      n++;
    }
    return n;
  }

  fireEnemy(pos: THREE.Vector3 | { x: number; z: number }, angle: number, speed: number, color: number, y = 0.8, dmg = ENEMY_BULLET_DMG, life = 4, opts: EnemyShotOpts = {}): void {
    const m = this.acquire(glowMat(color, 3));
    m.scale.setScalar(ENEMY_BULLET_RADIUS);
    if (speed > 20) m.scale.z = ENEMY_BULLET_RADIUS * 4;  // fast sniper rounds read as streaks
    m.rotation.y = angle;
    m.position.set(pos.x + Math.sin(angle) * 0.8, y, pos.z + Math.cos(angle) * 0.8);
    speed *= enemyShotSpeedMul();
    life *= lawRangeMul();
    this.enemyBullets.push({
      mesh: m, vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed), life, r: ENEMY_BULLET_RADIUS, dmg,
      color, split: opts.split, bounce: (opts.bounce ?? 0) + lawBounce(), curve: opts.curve, age: 0,
    });
  }

  // `quiet`: small trait explosions that go off often (pulse Lv5, rail Lv5) skip the big shake and boom.
  explode(pos: THREE.Vector3, radius: number, dmg: number, color = 0xff4dd2, opts: { quiet?: boolean } = {}): void {
    const g = this.g;
    g.fx.burst({ x: pos.x, y: 0.8, z: pos.z }, color, opts.quiet ? 10 : 26, radius * 4, 0.25, 0.55);
    g.fx.shockwave(pos.x, pos.z, radius, color);
    if (opts.quiet) {
      sfx.pop();
    } else {
      g.fx.burst({ x: pos.x, y: 0.8, z: pos.z }, 0xffcc66, 14, radius * 3, 0.2, 0.4);
      g.fx.shake(0.45);
      sfx.boom();
      g.gfx.flash(pos.x, 2, pos.z, color, 120);
    }
    g.hazards.explodeAt(pos, radius);
    for (const e of [...g.enemies.list]) {
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d >= radius + e.r) continue;
      const dir = new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z).normalize();
      g.enemies.damage(e, dmg * (1 - 0.5 * d / (radius + e.r)), { dir, knock: 14 });
    }
  }

  update(dt: number): void {
    this.updatePlayerBullets(dt);
    this.updateEnemyBullets(dt * enemyTimeScale());
  }

  // Reuse a spent bullet mesh if there is one; avoids allocating hundreds of meshes per second.
  private acquire(mat: THREE.Material, geo: THREE.BufferGeometry = GEO.sphere): THREE.Mesh {
    const m = this.pool.pop();
    if (m) {
      m.material = mat;
      m.geometry = geo;
      m.visible = true;
      m.rotation.set(0, 0, 0);
      return m;
    }
    const fresh = new THREE.Mesh(geo, mat);
    this.g.gfx.scene.add(fresh);
    return fresh;
  }

  private release(m: THREE.Mesh): void {
    m.visible = false;
    this.pool.push(m);
  }

  clearEnemyBulletsNear(pos: THREE.Vector3, radius: number): void {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i], p = b.mesh.position;
      if (Math.hypot(p.x - pos.x, p.z - pos.z) > radius) continue;
      this.g.fx.burst(p, 0x66ccff, 2, 3, 0.1, 0.2);
      this.release(b.mesh);
      this.enemyBullets.splice(i, 1);
    }
  }

  // Orbiting blades eat enemy bullets that touch them.
  clearEnemyBulletsAt(points: THREE.Vector3[], radius: number): void {
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const p = this.enemyBullets[i].mesh.position;
      if (!points.some(q => Math.hypot(p.x - q.x, p.z - q.z) < radius)) continue;
      this.release(this.enemyBullets[i].mesh);
      this.enemyBullets.splice(i, 1);
    }
  }

  clearEnemyBullets(): void {
    for (const b of this.enemyBullets) this.release(b.mesh);
    this.enemyBullets.length = 0;
  }

  clear(): void {
    for (const b of this.bullets) this.release(b.mesh);
    this.bullets.length = 0;
    this.clearEnemyBullets();
  }

  // Shield enemies deflect shots that hit their front (`e.dir`, which turns slowly toward the player).
  // Railgun-grade piercing goes straight through; explosions and elements go around it.
  private blockedByShield(b: PlayerBullet, e: Enemy): boolean {
    if (e.kind !== 'shield' || b.pierce >= 5 || e.dir.lengthSq() === 0 || e.burstT > 0) return false;  // variant: shield thrown
    const vl = b.vel.length() || 1;
    // bullet travelling against the shield's facing = hitting the front
    if ((b.vel.x * e.dir.x + b.vel.z * e.dir.z) / vl > -0.35) return false;
    this.g.fx.burst(b.mesh.position, e.def.color, 4, 6, 0.12, 0.25);
    sfx.deflect();
    return true;
  }

  private hitEnemy(b: PlayerBullet, e: Enemy): void {
    const g = this.g, p = g.player;
    const crit = Math.random() < p.critChance;
    const dir = tmpDir.copy(b.vel).normalize();
    const dmg = b.dmg * (crit ? p.critMul : 1);
    g.enemies.damage(e, dmg, { dir, knock: b.knock, crit, weapon: b.shot.weapon });
    g.hud.hitMarker(false);
    g.fx.burst(b.mesh.position, e.def.color, 3, 6, 0.12, 0.25, dir);
    g.arsenal.onHit(b, e, dmg);
    if (e.hp <= 0) return;
    const bonus: Record<Element, number> = { burn: p.burnChance, frost: p.frostChance, shock: p.shockChance };
    for (const el of ELEMENTS) {
      const chance = (b.element === el ? b.elementChance : 0) + bonus[el];
      if (chance > 0 && Math.random() < chance) g.enemies.applyElement(e, el, b.dmg);
    }
  }

  private trail(b: PlayerBullet): void {
    const g = this.g, pos = b.mesh.position, id = b.shot.weapon;
    if (b.shot.charged && Math.random() < 0.7) g.fx.mote(pos, 0xbff8ff, 0.16, 0.18);
    if (id === 'frost' || id === 'prism') b.mesh.rotation.z += 0.3;  // crystals tumble
    const tr = id ? TRAILS[id] : undefined;
    if (tr && Math.random() < tr[1]) {
      const color = id === 'prism' ? PRISM_SPARK[Math.floor(Math.random() * 3)] : tr[0];
      g.fx.mote(pos, color, tr[2], tr[3]);
    }
    if ((b.blast && !tr) && Math.random() < 0.7) g.fx.burst(pos, b.color, 1, 1, 0.15, 0.25);  // grenade sparks
    if (id === 'rocket' && Math.random() < 0.6) g.fx.mote(pos, 0xffd27a, 0.12, 0.1);         // exhaust flicker
  }

  // Disc: fly out, then home back to the player; catching it refunds the round.
  // Returns true when the disc is done (caught or expired).
  private flyDisc(b: PlayerBullet, dt: number): boolean {
    const g = this.g, p = g.player.pos, pos = b.mesh.position;
    b.mesh.rotation.y += dt * 22;
    if (!b.returning) {
      b.travel -= dt;
      if (b.travel <= 0) this.turnDisc(b);
      return false;
    }
    const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
    if (d < TRAITS.disc.catchRadius) {
      g.arsenal.catchDisc(b);
      return true;
    }
    const speed = TRAITS.disc.returnSpeed;
    b.vel.set(dx / d * speed, 0, dz / d * speed);
    return b.life <= 0;
  }

  private turnDisc(b: PlayerBullet): void {
    b.returning = true;
    b.hits.clear();  // the way back cuts everything again
    this.g.fx.burst(b.mesh.position, b.color, 5, 4, 0.12, 0.25);
  }

  // Swarm missile: curl toward its locked target, turning harder the longer it flies, so the volley
  // fans out wide first and then always lands.
  private steerTo(b: PlayerBullet, target: Enemy, dt: number): void {
    if (target.hp <= 0) { b.target = null; return; }
    const pos = b.mesh.position, age = WEAPONS.swarm.life - b.life;
    const cur = Math.atan2(b.vel.x, b.vel.z), want = Math.atan2(target.pos.x - pos.x, target.pos.z - pos.z);
    const diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
    const turn = TRAITS.swarm.turn * (1 + 6 * Math.min(1, age / 0.6));
    const a = cur + Math.sign(diff) * Math.min(Math.abs(diff), turn * dt);
    const speed = b.vel.length();
    b.vel.set(Math.sin(a) * speed, 0, Math.cos(a) * speed);
    b.mesh.rotation.y = a;
  }

  private steer(b: PlayerBullet, dt: number): void {
    const pos = b.mesh.position;
    let best: Enemy | null = null, bestD = HOMING_RANGE;
    for (const e of this.g.enemies.list) {
      if (b.hits.has(e)) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d < bestD) { bestD = d; best = e; }
    }
    if (!best) return;
    const cur = Math.atan2(b.vel.x, b.vel.z), want = Math.atan2(best.pos.x - pos.x, best.pos.z - pos.z);
    let diff = want - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));  // wrap to [-PI, PI]
    const a = cur + Math.sign(diff) * Math.min(Math.abs(diff), (b.shot.homingTurn ?? HOMING_TURN) * dt);
    const speed = b.vel.length();
    b.vel.set(Math.sin(a) * speed, 0, Math.cos(a) * speed);
    b.mesh.rotation.y = a;
  }

  private updatePlayerBullets(dt: number): void {
    const g = this.g;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], pos = b.mesh.position;
      const px = pos.x, pz = pos.z;
      if (b.shot.weapon === 'disc' && !b.shot.child) {
        if (this.flyDisc(b, dt)) {
          this.release(b.mesh);
          this.bullets.splice(i, 1);
          continue;
        }
      } else if (b.target) {
        this.steerTo(b, b.target, dt);
      } else if (b.homing) {
        this.steer(b, dt);
      }
      if (b.drag) b.vel.multiplyScalar(Math.exp(-b.drag * dt));
      if (b.grow) b.mesh.scale.multiplyScalar(1 + b.grow * dt);
      pos.addScaledVector(b.vel, dt);
      g.portals.warp(pos, b.vel);
      b.life -= dt;
      let dead = b.life <= 0;

      if (!dead && g.hazards.hitByShot(pos, b.dmg)) {
        dead = true;
      } else if (!dead && !b.returning && g.room.shotBlocked(pos.x, pos.z)) {
        if (b.shot.weapon === 'disc' && !b.shot.child) {
          pos.x = px;
          pos.z = pz;
          this.turnDisc(b);
        } else if (b.bounce > 0) {
          // reflect off whichever axis is blocked
          const hitX = g.room.shotBlocked(pos.x, pz), hitZ = g.room.shotBlocked(px, pos.z);
          if (hitX || !hitZ) b.vel.x *= -1;
          if (hitZ || !hitX) b.vel.z *= -1;
          pos.x = px;
          pos.z = pz;
          b.bounce--;
          b.bounces++;
          b.hits.clear();
          b.mesh.rotation.y = Math.atan2(b.vel.x, b.vel.z);
          g.fx.burst(pos, b.color, 3, 4, 0.1, 0.2);
          g.arsenal.onBounce(b);
        } else {
          dead = true;
          if (!b.blast) g.fx.burst(pos, b.color, 4, 5, 0.12, 0.25);
        }
      }

      if (b.shot.weapon === 'flame') g.ground.burnAt(pos.x, pos.z, Math.max(0.25, b.mesh.scale.x));
      if (!dead) {
        for (const e of [...g.enemies.list]) {
          if (b.hits.has(e) || e.hp <= 0 || untargetable(e)) continue;
          // a ring star's orbiting orbs stop shots (not explosions, the railgun or the singularity)
          if (ringUp(e) && !b.blast && !UNREFLECTED.has(b.shot.weapon) && Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) < X.ringR + 0.35) {
            g.fx.burst(pos, e.def.color, 3, 4, 0.1, 0.2);
            dead = true;
            break;
          }
          // flame puffs grow, so their hit radius follows the mesh
          if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) >= e.r + Math.max(0.25, b.mesh.scale.x)) continue;
          b.hits.add(e);
          if (b.blast) { g.arsenal.directHit(b, e); dead = true; break; }
          if (b.shot.weapon === 'singularity') { dead = true; break; }  // deploys its well; no contact damage
          if (this.blockedByShield(b, e)) { dead = true; break; }
          if (e.def.reflects && !UNREFLECTED.has(b.shot.weapon)) {
            // prism plate: bounces the shot back off its face and takes the hit
            const o = e.owner ?? e, nx = e.pos.x - o.pos.x, nz = e.pos.z - o.pos.z, nl = Math.hypot(nx, nz) || 1;
            reflectShot(e, g, pos, b.vel, nx / nl, nz / nl, b.dmg * 0.5);
            this.hitEnemy(b, e);
            dead = true;
            break;
          }
          if (e.def.mirrored && !UNREFLECTED.has(b.shot.weapon) && mirrorReflects(e, g, pos, b.vel)) { dead = true; break; }
          if (e.kind === 'devourer' && e.variant) devourShot(e, g);
          this.hitEnemy(b, e);
          if (b.pierce-- <= 0) { dead = true; break; }
        }
      }

      if (dead) {
        if (b.blast) {
          const k = g.arsenal.blastScale(b);
          this.explode(pos, b.blast * k.radius, b.dmg * 1.6 * g.player.blastDmgMul * k.dmg, b.color, { quiet: b.shot.child });
          g.arsenal.onExplode(b, pos, b.blast * k.radius);
        } else {
          g.arsenal.onEnd(b, pos);
        }
        this.release(b.mesh);
        this.bullets.splice(i, 1);
      } else {
        this.trail(b);
      }
    }
  }

  private updateEnemyBullets(dt: number): void {
    const g = this.g, player = g.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i], pos = b.mesh.position;
      const px = pos.x, pz = pos.z;
      b.age += dt;
      if (b.curve) {
        // out and back along a loop; it ignores walls (it's a blade, not a bullet)
        const c = b.curve, s = Math.min(1, b.age / c.time), fwd = Math.sin(Math.PI * s) * c.reach, side = Math.sin(2 * Math.PI * s) * c.width;
        pos.set(c.ox + Math.sin(c.angle) * fwd + Math.cos(c.angle) * side, pos.y, c.oz + Math.cos(c.angle) * fwd - Math.sin(c.angle) * side);
        b.mesh.rotation.y += dt * 20;
        b.vel.set(pos.x - px, 0, pos.z - pz).divideScalar(Math.max(dt, 1e-4));
      } else pos.addScaledVector(b.vel, dt);
      g.portals.warp(pos, b.vel);
      b.life -= dt;
      if (b.bounce > 0 && g.room.shotBlocked(pos.x, pos.z)) {
        // ricochet: flip whichever axis took it into the wall
        b.bounce--;
        if (g.room.shotBlocked(pos.x, pz)) b.vel.x *= -1;
        if (g.room.shotBlocked(px, pos.z)) b.vel.z *= -1;
        pos.set(px, pos.y, pz);
        b.mesh.rotation.y = Math.atan2(b.vel.x, b.vel.z);
      }
      if (b.split) {
        b.split.t -= dt;
        if (b.split.t <= 0) {
          const s = b.split, a = Math.atan2(b.vel.x, b.vel.z), speed = b.vel.length();
          for (let k = 0; k < s.n; k++) this.fireEnemy(pos, a + (k - (s.n - 1) / 2) * s.spread, speed, b.color, pos.y, b.dmg, b.life);
          b.life = 0;
        }
      }
      let dead = b.life <= 0 || g.hazards.hitByEnemyShot(pos, b.dmg) || (!b.curve && (g.room.shotBlocked(pos.x, pos.z) || g.enemies.wallAt(pos.x, pos.z)));
      if (!dead && g.clones.active && g.clones.hitAt(pos.x, pos.z, b.r)) dead = true;
      if (!dead && player.invuln <= 0 && Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z) < b.r + player.r * 0.8) {
        g.damagePlayer(b.dmg, pos);
        dead = true;
      }
      if (dead) {
        this.release(b.mesh);
        this.enemyBullets.splice(i, 1);
      }
    }
  }
}
