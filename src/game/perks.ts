import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import type { Enemy } from './enemies';
import { untargetable } from './enemyAI';
import type { Game } from './game';

// Playstyle-changing legendary modules that need their own per-frame logic:
// flame trail, orbiting blades and kill explosions. The flags live on Player.

const TRAIL_LIFE = 2.6;
const TRAIL_RADIUS = 1.1;
const TRAIL_TICK = 0.25;
const ORBIT_RADIUS = 2.4;
const ORBIT_SPEED = 3.2;      // radians per second
const ORBIT_HIT_CD = 0.3;     // per enemy per blade
const KILL_BLAST_RADIUS = 2.3;

interface TrailPoint { x: number; z: number; t: number }
interface Blast { x: number; z: number; dmg: number }

export class Perks {
  private trail: TrailPoint[] = [];
  private trailDrop = 0;
  private trailTick = 0;
  private readonly blades: THREE.Mesh[] = [];
  private orbitA = 0;
  private readonly bladeHits = new WeakMap<Enemy, number>();
  private blasts: Blast[] = [];

  constructor(private readonly g: Game) {}

  clear(): void {
    this.trail = [];
    this.blasts = [];
    for (const b of this.blades) b.visible = false;
  }

  onKill(e: Enemy): void {
    const p = this.g.player;
    if (p.killBlast) this.blasts.push({ x: e.pos.x, z: e.pos.z, dmg: 22 * p.dmgMul * p.blastDmgMul });
  }

  update(dt: number): void {
    const g = this.g, p = g.player;
    this.updateTrail(dt);
    this.updateBlades(dt, p.orbitals);

    // kill explosions are resolved a frame later so chains don't recurse inside damage()
    if (this.blasts.length) {
      const now = this.blasts;
      this.blasts = [];
      for (const b of now.slice(0, 8)) this.killBlast(b);
    }
    if (p.flameTrail && p.dashT > 0) {
      this.trailDrop -= dt;
      if (this.trailDrop <= 0) {
        this.trailDrop = 0.03;
        this.trail.push({ x: p.pos.x, z: p.pos.z, t: TRAIL_LIFE });
      }
    }
  }

  private updateTrail(dt: number): void {
    if (!this.trail.length) return;
    const g = this.g, p = g.player;
    for (const pt of this.trail) {
      pt.t -= dt;
      if (Math.random() < dt * 9) g.fx.burst({ x: pt.x, y: 0.2, z: pt.z }, Math.random() < 0.5 ? 0xff7a1a : 0xffc83d, 1, 1.5, 0.18, 0.5);
    }
    this.trail = this.trail.filter(pt => pt.t > 0);
    this.trailTick -= dt;
    if (this.trailTick > 0) return;
    this.trailTick = TRAIL_TICK;
    for (const e of g.enemies.list) {
      if (e.hp <= 0 || untargetable(e)) continue;
      if (this.trail.some(pt => Math.hypot(e.pos.x - pt.x, e.pos.z - pt.z) < TRAIL_RADIUS + e.r)) {
        g.enemies.applyElement(e, 'burn', 14 * p.dmgMul);
      }
    }
  }

  private updateBlades(dt: number, count: number): void {
    const g = this.g, p = g.player;
    while (this.blades.length < count) {
      const m = new THREE.Mesh(GEO.orb, glowMat(0x9ff8ff, 1.4));
      m.scale.set(1.1, 0.3, 1.1);
      g.gfx.scene.add(m);
      this.blades.push(m);
    }
    this.orbitA += dt * ORBIT_SPEED;
    this.blades.forEach((m, i) => {
      m.visible = i < count && g.state === 'play';
      if (!m.visible) return;
      const a = this.orbitA + (i / count) * Math.PI * 2;
      m.position.set(p.pos.x + Math.sin(a) * ORBIT_RADIUS, 1.1, p.pos.z + Math.cos(a) * ORBIT_RADIUS);
      m.rotation.y += dt * 12;
      for (const e of g.enemies.list) {
        if (e.hp <= 0 || untargetable(e)) continue;
        if (Math.hypot(e.pos.x - m.position.x, e.pos.z - m.position.z) > e.r + 0.45) continue;
        const key = (this.bladeHits.get(e) ?? -1);
        if (g.time - key < ORBIT_HIT_CD) continue;
        this.bladeHits.set(e, g.time);
        g.enemies.damage(e, 16 * p.dmgMul, { dir: new THREE.Vector3(e.pos.x - p.pos.x, 0, e.pos.z - p.pos.z).normalize(), knock: 5 });
        g.fx.burst(m.position, 0x4ff0ff, 3, 4, 0.1, 0.2);
      }
    });
    if (count > 0) g.projectiles.clearEnemyBulletsAt(this.blades.slice(0, count).map(b => b.position), 0.55);
  }

  private killBlast(b: Blast): void {
    const g = this.g, r = KILL_BLAST_RADIUS * g.player.blastMul;
    g.fx.burst({ x: b.x, y: 0.8, z: b.z }, 0xff4dd2, 12, r * 3, 0.2, 0.4);
    g.fx.shockwave(b.x, b.z, r, 0xff4dd2);
    sfx.zap();
    for (const e of [...g.enemies.list]) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.pos.x - b.x, e.pos.z - b.z);
      if (d < r + e.r) g.enemies.damage(e, b.dmg, { dir: new THREE.Vector3(e.pos.x - b.x, 0, e.pos.z - b.z).normalize(), knock: 8 });
    }
  }
}
