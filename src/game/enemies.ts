import * as THREE from 'three';
import { GEO, WHITE } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import { ENEMIES, type EnemyDef, type EnemyKind } from '../data/enemies';
import { BEHAVIORS, type AIFrame } from './enemyAI';
import type { Game } from './game';

export type AIState = 'move' | 'wind' | 'charge' | 'stun';

export interface Enemy {
  kind: EnemyKind;
  def: EnemyDef;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  base: THREE.Color;
  pos: THREE.Vector3;
  vel: THREE.Vector3;  // knockback velocity, decays over time
  hp: number;
  maxHp: number;
  r: number;
  cd: number;          // attack cooldown
  flash: number;       // remaining hit-flash time
  state: AIState;
  stateT: number;
  dir: THREE.Vector3;  // locked charge direction
  side: 1 | -1;        // strafe direction
  t: number;
  pattern: number;     // boss attack rotation
  burst: number;       // boss shots left in the current burst
  burstT: number;
  enraged: boolean;
  scale: number;       // visual scale this frame, set by behaviors for telegraphs
}

// Spawn telegraph: a pulsing ring on the floor before the enemy appears.
interface Marker {
  kind: EnemyKind;
  x: number;
  z: number;
  t: number;
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

const frame: AIFrame = { toP: new THREE.Vector3(), dist: 0, spd: 0, desired: new THREE.Vector3(), dt: 0 };

export class Enemies {
  readonly list: Enemy[] = [];
  private readonly markers: Marker[] = [];

  constructor(private readonly g: Game) {}

  get pending(): number {
    return this.markers.length;
  }

  get boss(): Enemy | undefined {
    return this.list.find(e => e.kind === 'boss');
  }

  addMarker(kind: EnemyKind, x: number, z: number, t = 0.75): void {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(ENEMIES[kind].color).multiplyScalar(2), transparent: true, opacity: 0.9, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(GEO.ring, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.04, z);
    mesh.scale.setScalar(ENEMIES[kind].r * 1.4);
    this.g.gfx.scene.add(mesh);
    this.markers.push({ kind, x, z, t, mesh });
  }

  spawn(kind: EnemyKind, x: number, z: number): void {
    const def = ENEMIES[kind];
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: def.color, emissiveIntensity: 1.4, roughness: 0.4, flatShading: true });
    const mesh = new THREE.Mesh(def.geo, mat);
    mesh.position.set(x, def.y, z);
    this.g.gfx.scene.add(mesh);
    const hp = def.hp * (1 + (this.g.room.n - 1) * BALANCE.scaling.enemyHpPerRoom);
    this.list.push({
      kind, def, mesh, mat, base: new THREE.Color(def.color),
      pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), hp, maxHp: hp, r: def.r,
      cd: rand(0.8, 1.8), flash: 0, state: 'move', stateT: 0, dir: new THREE.Vector3(),
      side: Math.random() < 0.5 ? -1 : 1, t: Math.random() * 10, pattern: 0, burst: 0, burstT: 0,
      enraged: false, scale: 1,
    });
    if (kind === 'boss') this.g.hud.showBossBar(true);
  }

  damage(e: Enemy, dmg: number, dir?: THREE.Vector3, knock = 0): void {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (dir) e.vel.addScaledVector(dir, knock * e.def.mass);
    sfx.hit();
    if (e.hp <= 0) this.kill(e);
  }

  update(dt: number): void {
    this.updateMarkers(dt);
    const g = this.g, player = g.player;
    const speedBonus = Math.min(BALANCE.scaling.enemySpeedMaxBonus, (g.room.n - 1) * BALANCE.scaling.enemySpeedPerRoom);

    for (const e of [...this.list]) {
      if (e.hp <= 0) continue;
      const def = e.def;
      e.t += dt;
      e.cd -= dt;
      e.flash -= dt;
      e.scale = 1;

      const { toP, desired } = frame;
      toP.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
      frame.dist = toP.length() || 0.001;
      toP.divideScalar(frame.dist);
      frame.spd = def.speed * (1 + speedBonus);
      frame.dt = dt;
      desired.set(0, 0, 0);
      BEHAVIORS[e.kind](e, frame, g);

      // soft separation so enemies don't stack on top of each other
      for (const o of this.list) {
        if (o === e) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = e.r + o.r;
        if (d < min && d > 0.001) {
          desired.x += dx / d * (min - d) * 8;
          desired.z += dz / d * (min - d) * 8;
        }
      }
      e.vel.multiplyScalar(Math.exp(-7 * dt));
      e.pos.x += (desired.x + e.vel.x) * dt;
      e.pos.z += (desired.z + e.vel.z) * dt;
      if (g.room.collide(e.pos, e.r) && e.state === 'charge') {
        e.state = 'stun';
        e.stateT = 0.8;
        g.fx.shake(0.35);
        sfx.boom();
        g.fx.burst({ x: e.pos.x, y: 0.6, z: e.pos.z }, def.color, 14, 6);
      }

      if (frame.dist < e.r + player.r) g.damagePlayer(e.state === 'charge' ? def.dmg * 1.4 : def.dmg, e.pos);

      e.mesh.position.set(
        e.pos.x + (e.state === 'wind' ? rand(-0.08, 0.08) : 0),
        def.y + (e.kind === 'shooter' ? Math.sin(e.t * 4) * 0.15 : 0),
        e.pos.z,
      );
      if (e.kind !== 'boss') e.mesh.rotation.y = Math.atan2(toP.x, toP.z) + (e.kind === 'shooter' ? e.t * 2 : 0);
      e.mesh.scale.setScalar(e.scale);
      const flashing = e.flash > 0;
      e.mat.emissive.copy(flashing ? WHITE : e.base);
      e.mat.emissiveIntensity = flashing || e.state === 'wind' ? 3 : e.enraged ? 2.2 + Math.sin(e.t * 12) : 1.4;
    }
  }

  clear(): void {
    for (const e of this.list) {
      this.g.gfx.scene.remove(e.mesh);
      e.mat.dispose();
    }
    for (const m of this.markers) {
      this.g.gfx.scene.remove(m.mesh);
      m.mesh.material.dispose();
    }
    this.list.length = 0;
    this.markers.length = 0;
  }

  private updateMarkers(dt: number): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i];
      m.t -= dt;
      m.mesh.rotation.z += dt * 4;
      m.mesh.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(m.t * 12));
      if (m.t > 0) continue;
      this.g.gfx.scene.remove(m.mesh);
      m.mesh.material.dispose();
      this.markers.splice(i, 1);
      this.spawn(m.kind, m.x, m.z);
      this.g.fx.burst({ x: m.x, y: 0.5, z: m.z }, ENEMIES[m.kind].color, 8, 5, 0.15, 0.4);
    }
  }

  private kill(e: Enemy): void {
    const g = this.g, def = e.def, big = e.kind === 'boss';
    g.score += def.score;
    g.gfx.scene.remove(e.mesh);
    e.mat.dispose();
    this.list.splice(this.list.indexOf(e), 1);

    g.fx.burst({ x: e.pos.x, y: def.y, z: e.pos.z }, def.color, big ? 80 : e.kind === 'brute' ? 30 : 16, big ? 16 : 9, big ? 0.4 : 0.22, big ? 1.2 : 0.6);
    g.fx.shake(big ? 1.2 : 0.2);
    g.fx.hitstop(big ? 0.25 : 0.03);
    if (big) sfx.boom(); else sfx.kill();
    if (g.player.leech) g.player.heal(g.player.leech);

    if (Math.random() < def.dropChance) {
      const spread = def.dropCount > 1 ? 1.5 : 0;
      for (let i = 0; i < def.dropCount; i++) g.pickups.spawnOrb(e.pos.x + rand(-spread, spread), e.pos.z + rand(-spread, spread));
    }
    if (big) {
      g.hud.showBossBar(false);
      g.gfx.flash(e.pos.x, 3, e.pos.z, 0xff3366, 200);
    }
  }
}
