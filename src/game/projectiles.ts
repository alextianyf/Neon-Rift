import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import type { Element, WeaponDef } from '../data/weapons';
import type { Enemy } from './enemies';
import type { Game } from './game';

interface Bullet {
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
}

interface EnemyBullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  r: number;
  dmg: number;
}

// Per-shot stats after the player's upgrades are applied.
export interface ShotStats {
  dmg: number;
  pierce: number;
  bounce: number;
  blast: number;
  homing: boolean;
}

const ENEMY_BULLET_RADIUS = 0.28;
const ENEMY_BULLET_DMG = 10;
const HOMING_RANGE = 9;
const HOMING_TURN = 3.5;  // radians per second
const ELEMENTS: Element[] = ['burn', 'frost', 'shock'];
const tmpDir = new THREE.Vector3();

export class Projectiles {
  private readonly bullets: Bullet[] = [];
  private readonly enemyBullets: EnemyBullet[] = [];

  constructor(private readonly g: Game) {}

  firePlayer(origin: THREE.Vector3, angle: number, speed: number, w: WeaponDef, shot: ShotStats): void {
    const m = new THREE.Mesh(GEO.sphere, glowMat(w.color, w.glow ?? 3));
    m.scale.setScalar(w.size);
    m.scale.z = w.size * (w.stretch ?? 2.4);
    m.rotation.y = angle;
    m.position.copy(origin);
    this.g.gfx.scene.add(m);
    this.bullets.push({
      mesh: m, vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed), life: w.life,
      dmg: shot.dmg, knock: w.knock, pierce: shot.pierce, bounce: shot.bounce, blast: shot.blast,
      drag: w.drag ?? 0, grow: w.grow ?? 0, homing: shot.homing,
      element: w.element, elementChance: w.elementChance ?? 0, color: w.color, hits: new Set(),
    });
  }

  fireEnemy(pos: THREE.Vector3, angle: number, speed: number, color: number, y = 0.8): void {
    const m = new THREE.Mesh(GEO.sphere, glowMat(color, 3));
    m.scale.setScalar(ENEMY_BULLET_RADIUS);
    m.position.set(pos.x + Math.sin(angle) * 0.8, y, pos.z + Math.cos(angle) * 0.8);
    this.g.gfx.scene.add(m);
    this.enemyBullets.push({ mesh: m, vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed), life: 4, r: ENEMY_BULLET_RADIUS, dmg: ENEMY_BULLET_DMG });
  }

  explode(pos: THREE.Vector3, radius: number, dmg: number, color = 0xff4dd2): void {
    const g = this.g;
    g.fx.burst({ x: pos.x, y: 0.8, z: pos.z }, color, 26, radius * 4, 0.25, 0.55);
    g.fx.burst({ x: pos.x, y: 0.8, z: pos.z }, 0xffcc66, 14, radius * 3, 0.2, 0.4);
    g.fx.shockwave(pos.x, pos.z, radius, color);
    g.fx.shake(0.45);
    sfx.boom();
    g.gfx.flash(pos.x, 2, pos.z, color, 120);
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
    this.updateEnemyBullets(dt);
  }

  clearEnemyBullets(): void {
    for (const b of this.enemyBullets) this.g.gfx.scene.remove(b.mesh);
    this.enemyBullets.length = 0;
  }

  clear(): void {
    for (const b of this.bullets) this.g.gfx.scene.remove(b.mesh);
    this.bullets.length = 0;
    this.clearEnemyBullets();
  }

  private hitEnemy(b: Bullet, e: Enemy): void {
    const g = this.g, p = g.player;
    const crit = Math.random() < p.critChance;
    const dir = tmpDir.copy(b.vel).normalize();
    g.enemies.damage(e, b.dmg * (crit ? p.critMul : 1), { dir, knock: b.knock, crit });
    g.hud.hitMarker(false);
    g.fx.burst(b.mesh.position, e.def.color, 3, 6, 0.12, 0.25, dir);
    if (e.hp <= 0) return;
    const bonus: Record<Element, number> = { burn: p.burnChance, frost: p.frostChance, shock: p.shockChance };
    for (const el of ELEMENTS) {
      const chance = (b.element === el ? b.elementChance : 0) + bonus[el];
      if (chance > 0 && Math.random() < chance) g.enemies.applyElement(e, el, b.dmg);
    }
  }

  private steer(b: Bullet, dt: number): void {
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
    const a = cur + Math.sign(diff) * Math.min(Math.abs(diff), HOMING_TURN * dt);
    const speed = b.vel.length();
    b.vel.set(Math.sin(a) * speed, 0, Math.cos(a) * speed);
    b.mesh.rotation.y = a;
  }

  private updatePlayerBullets(dt: number): void {
    const g = this.g;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], pos = b.mesh.position;
      const px = pos.x, pz = pos.z;
      if (b.homing) this.steer(b, dt);
      if (b.drag) b.vel.multiplyScalar(Math.exp(-b.drag * dt));
      if (b.grow) b.mesh.scale.multiplyScalar(1 + b.grow * dt);
      pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0;

      if (!dead && g.hazards.hitByShot(pos, b.dmg)) {
        dead = true;
      } else if (!dead && g.room.shotBlocked(pos.x, pos.z)) {
        if (b.bounce > 0) {
          // reflect off whichever axis is blocked
          const hitX = g.room.shotBlocked(pos.x, pz), hitZ = g.room.shotBlocked(px, pos.z);
          if (hitX || !hitZ) b.vel.x *= -1;
          if (hitZ || !hitX) b.vel.z *= -1;
          pos.x = px;
          pos.z = pz;
          b.bounce--;
          b.hits.clear();
          b.mesh.rotation.y = Math.atan2(b.vel.x, b.vel.z);
          g.fx.burst(pos, b.color, 3, 4, 0.1, 0.2);
        } else {
          dead = true;
          if (!b.blast) g.fx.burst(pos, b.color, 4, 5, 0.12, 0.25);
        }
      }

      if (!dead) {
        for (const e of [...g.enemies.list]) {
          if (b.hits.has(e) || e.hp <= 0) continue;
          // flame puffs grow, so their hit radius follows the mesh
          if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) >= e.r + Math.max(0.25, b.mesh.scale.x)) continue;
          b.hits.add(e);
          if (b.blast) { dead = true; break; }
          this.hitEnemy(b, e);
          if (b.pierce-- <= 0) { dead = true; break; }
        }
      }

      if (dead) {
        if (b.blast) this.explode(pos, b.blast, b.dmg * 1.6 * g.player.blastDmgMul, b.color);
        g.gfx.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      } else if (b.blast && Math.random() < 0.7) {
        g.fx.burst(pos, b.color, 1, 1, 0.15, 0.25);  // rocket / grenade trail
      }
    }
  }

  private updateEnemyBullets(dt: number): void {
    const g = this.g, player = g.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i], pos = b.mesh.position;
      pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0 || g.room.shotBlocked(pos.x, pos.z);
      if (!dead && player.invuln <= 0 && Math.hypot(player.pos.x - pos.x, player.pos.z - pos.z) < b.r + player.r * 0.8) {
        g.damagePlayer(b.dmg, pos);
        dead = true;
      }
      if (dead) {
        g.gfx.scene.remove(b.mesh);
        this.enemyBullets.splice(i, 1);
      }
    }
  }
}
