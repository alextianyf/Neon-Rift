import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import type { WeaponDef } from '../data/weapons';
import type { Enemy } from './enemies';
import type { Game } from './game';

interface Bullet {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  dmg: number;
  knock: number;
  pierce: number;
  blast: number;
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

export interface ShotStats {
  dmg: number;
  pierce: number;
  blast: number;
}

const ENEMY_BULLET_RADIUS = 0.28;
const ENEMY_BULLET_DMG = 10;

export class Projectiles {
  private readonly bullets: Bullet[] = [];
  private readonly enemyBullets: EnemyBullet[] = [];

  constructor(private readonly g: Game) {}

  firePlayer(origin: THREE.Vector3, angle: number, speed: number, w: WeaponDef, stats: ShotStats): void {
    const m = new THREE.Mesh(GEO.sphere, glowMat(w.color, 3));
    m.scale.setScalar(w.size);
    if (!w.blast) m.scale.z = w.size * 2.4;  // stretch into a tracer
    m.rotation.y = angle;
    m.position.copy(origin);
    this.g.gfx.scene.add(m);
    this.bullets.push({
      mesh: m, vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed), life: w.life,
      dmg: stats.dmg, knock: w.knock, pierce: stats.pierce, blast: stats.blast, color: w.color, hits: new Set(),
    });
  }

  fireEnemy(pos: THREE.Vector3, angle: number, speed: number, color: number, y = 0.8): void {
    const m = new THREE.Mesh(GEO.sphere, glowMat(color, 3));
    m.scale.setScalar(ENEMY_BULLET_RADIUS);
    m.position.set(pos.x + Math.sin(angle) * 0.8, y, pos.z + Math.cos(angle) * 0.8);
    this.g.gfx.scene.add(m);
    this.enemyBullets.push({ mesh: m, vel: new THREE.Vector3(Math.sin(angle) * speed, 0, Math.cos(angle) * speed), life: 4, r: ENEMY_BULLET_RADIUS, dmg: ENEMY_BULLET_DMG });
  }

  explode(pos: THREE.Vector3, radius: number, dmg: number): void {
    const g = this.g;
    g.fx.burst({ x: pos.x, y: 0.8, z: pos.z }, 0xff4dd2, 26, radius * 4, 0.25, 0.55);
    g.fx.burst({ x: pos.x, y: 0.8, z: pos.z }, 0xffcc66, 14, radius * 3, 0.2, 0.4);
    g.fx.shockwave(pos.x, pos.z, radius, 0xff4dd2);
    g.fx.shake(0.45);
    sfx.boom();
    g.gfx.flash(pos.x, 2, pos.z, 0xff66cc, 120);
    for (const e of [...g.enemies.list]) {
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d >= radius + e.r) continue;
      const dir = new THREE.Vector3(e.pos.x - pos.x, 0, e.pos.z - pos.z).normalize();
      g.enemies.damage(e, dmg * (1 - 0.5 * d / (radius + e.r)), dir, 14);
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

  private updatePlayerBullets(dt: number): void {
    const g = this.g;
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i], pos = b.mesh.position;
      pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0;
      if (!dead && g.room.blocked(pos.x, pos.z, 0)) {
        dead = true;
        if (!b.blast) g.fx.burst(pos, b.color, 4, 5, 0.12, 0.25);
      }
      if (!dead) {
        for (const e of [...g.enemies.list]) {
          if (b.hits.has(e) || e.hp <= 0) continue;
          if (Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) >= e.r + 0.25) continue;
          b.hits.add(e);
          if (b.blast) { dead = true; break; }
          const dir = b.vel.clone().normalize();
          g.enemies.damage(e, b.dmg, dir, b.knock);
          g.fx.burst(pos, e.def.color, 3, 6, 0.12, 0.25, dir);
          if (b.pierce-- <= 0) { dead = true; break; }
        }
      }
      if (dead) {
        if (b.blast) this.explode(pos, b.blast, b.dmg * 1.6);
        g.gfx.scene.remove(b.mesh);
        this.bullets.splice(i, 1);
      } else if (b.blast && Math.random() < 0.7) {
        g.fx.burst(pos, 0xff4dd2, 1, 1, 0.15, 0.25);  // rocket trail
      }
    }
  }

  private updateEnemyBullets(dt: number): void {
    const g = this.g, player = g.player;
    for (let i = this.enemyBullets.length - 1; i >= 0; i--) {
      const b = this.enemyBullets[i], pos = b.mesh.position;
      pos.addScaledVector(b.vel, dt);
      b.life -= dt;
      let dead = b.life <= 0 || g.room.blocked(pos.x, pos.z, 0);
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
