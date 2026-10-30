import * as THREE from 'three';
import { WHITE } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import { ENEMIES, type EnemyDef, type EnemyKind } from '../data/enemies';
import type { Element } from '../data/weapons';
import { BEHAVIORS, type AIFrame } from './enemyAI';
import { Rift } from './rift';
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
  burnT: number;
  burnDps: number;
  burnTick: number;
  frostT: number;
  spawnT: number;      // materialize animation; harmless until it reaches 0
}

export interface HitInfo {
  dir?: THREE.Vector3;
  knock?: number;
  crit?: boolean;
  dot?: boolean;       // damage over time: no flash, no knockback
}

// Spawn telegraph: a space-time rift that tears open before the enemy steps out.
interface Marker {
  kind: EnemyKind;
  rift: Rift;
  spawned: boolean;
}

const MATERIALIZE_TIME = 0.3;

const EL = BALANCE.elements;
const BURN_COLOR = 0xff8a3d;
const FROST_COLOR = new THREE.Color(0x66ddff);
const SHOCK_COLOR = 0x8fb8ff;
const BURN_TINT = new THREE.Color(0xff7a2a);
const tint = new THREE.Color();
const frame: AIFrame = { toP: new THREE.Vector3(), dist: 0, spd: 0, desired: new THREE.Vector3(), dt: 0 };

export class Enemies {
  readonly list: Enemy[] = [];
  private readonly markers: Marker[] = [];

  constructor(private readonly g: Game) {}

  // rifts that haven't released their enemy yet
  get pending(): number {
    return this.markers.filter(m => !m.spawned).length;
  }

  get boss(): Enemy | undefined {
    return this.list.find(e => e.kind === 'boss');
  }

  addMarker(kind: EnemyKind, x: number, z: number, t = 0.75): void {
    const def = ENEMIES[kind];
    const height = kind === 'boss' ? 6 : Math.max(1.6, def.r * 2.6);
    this.markers.push({ kind, rift: new Rift(this.g.gfx.scene, x, z, height, t, def.color), spawned: false });
  }

  spawn(kind: EnemyKind, x: number, z: number): void {
    const def = ENEMIES[kind];
    const mat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: def.color, emissiveIntensity: 1.6, roughness: 0.4, flatShading: true });
    const mesh = new THREE.Mesh(def.geo, mat);
    mesh.position.set(x, def.y, z);
    this.g.gfx.scene.add(mesh);
    const hp = def.hp * (1 + (this.g.room.n - 1) * BALANCE.scaling.enemyHpPerRoom);
    this.list.push({
      kind, def, mesh, mat, base: new THREE.Color(def.color),
      pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), hp, maxHp: hp, r: def.r,
      cd: rand(0.8, 1.8), flash: 0, state: 'move', stateT: 0, dir: new THREE.Vector3(),
      side: Math.random() < 0.5 ? -1 : 1, t: Math.random() * 10, pattern: 0, burst: 0, burstT: 0,
      enraged: false, scale: 1, burnT: 0, burnDps: 0, burnTick: 0, frostT: 0, spawnT: MATERIALIZE_TIME,
    });
    mesh.scale.setScalar(0.01);
    if (kind === 'boss') this.g.hud.showBossBar(true, def.name);
  }

  damage(e: Enemy, dmg: number, hit: HitInfo = {}): void {
    if (e.hp <= 0) return;
    e.hp -= dmg;
    const at = { x: e.pos.x, y: e.def.y + e.r, z: e.pos.z };
    this.g.floaters.damage(at, dmg, hit.crit ? 'crit' : hit.dot ? 'dot' : 'dmg', e);
    if (!hit.dot) {
      // throttled so rapid-fire weapons don't keep the enemy permanently white
      if (e.flash < -0.06) e.flash = 0.07;
      if (hit.dir) e.vel.addScaledVector(hit.dir, (hit.knock ?? 0) * e.def.mass);
      if (hit.crit) sfx.crit(); else sfx.hit();
    }
    if (e.hp <= 0) this.kill(e);
  }

  // Elemental status from a hit; `baseDmg` is the hit's damage before crits.
  applyElement(e: Enemy, el: Element, baseDmg: number): void {
    const p = this.g.player;
    if (el === 'burn') {
      e.burnT = EL.burnDuration;
      e.burnDps = Math.max(e.burnDps, EL.burnDps * p.dmgMul * p.elementMul);
    } else if (el === 'frost') {
      e.frostT = EL.frostDuration;
    } else {
      this.chainLightning(e, baseDmg * EL.shockDmg * p.elementMul);
    }
  }

  update(dt: number): void {
    this.updateMarkers(dt);
    const g = this.g, player = g.player;
    const speedBonus = Math.min(BALANCE.scaling.enemySpeedMaxBonus, (g.room.n - 1) * BALANCE.scaling.enemySpeedPerRoom);

    for (const e of [...this.list]) {
      if (e.hp <= 0) continue;
      const def = e.def;
      this.updateStatus(e, dt);
      if (e.hp <= 0) continue;

      const frozen = e.frostT > 0;
      const slow = frozen ? 1 - (1 - EL.frostSlow) * (1 - def.ccResist) : 1;
      e.t += dt;
      e.cd -= dt * slow;
      e.flash -= dt;
      e.scale = 1;

      const { toP, desired } = frame;
      toP.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
      frame.dist = toP.length() || 0.001;
      toP.divideScalar(frame.dist);
      frame.spd = def.speed * (1 + speedBonus) * slow;
      frame.dt = dt * slow;
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

      if (e.spawnT > 0) {
        e.spawnT -= dt;
        const k = 1 - Math.max(0, e.spawnT) / MATERIALIZE_TIME;
        e.scale *= k < 1 ? k * (1 + Math.sin(e.t * 60) * 0.15) : 1;  // glitchy flicker while forming
      } else if (frame.dist < e.r + player.r) g.damagePlayer(e.state === 'charge' ? def.dmg * 1.4 : def.dmg, e.pos);

      e.mesh.position.set(
        e.pos.x + (e.state === 'wind' ? rand(-0.08, 0.08) : 0),
        def.y + (e.kind === 'shooter' ? Math.sin(e.t * 4) * 0.15 : 0),
        e.pos.z,
      );
      if (e.kind !== 'boss') e.mesh.rotation.y = Math.atan2(toP.x, toP.z) + (e.kind === 'shooter' ? e.t * 2 : 0);
      e.mesh.scale.setScalar(e.scale);
      this.paint(e);
    }
  }

  clear(): void {
    for (const e of this.list) {
      this.g.gfx.scene.remove(e.mesh);
      e.mat.dispose();
    }
    for (const m of this.markers) m.rift.dispose(this.g.gfx.scene);
    this.list.length = 0;
    this.markers.length = 0;
  }

  private updateStatus(e: Enemy, dt: number): void {
    if (e.frostT > 0) {
      e.frostT -= dt;
      if (Math.random() < dt * 6) this.g.fx.burst({ x: e.pos.x, y: e.def.y, z: e.pos.z }, 0x9ff3ff, 1, 1.5, 0.12, 0.4);
    }
    if (e.burnT > 0) {
      e.burnT -= dt;
      e.burnTick -= dt;
      if (Math.random() < dt * 10) this.g.fx.burst({ x: e.pos.x, y: e.def.y + 0.3, z: e.pos.z }, BURN_COLOR, 1, 1, 0.16, 0.35);
      if (e.burnTick <= 0) {
        e.burnTick = 0.3;
        this.damage(e, e.burnDps * 0.3, { dot: true });
      }
      if (e.burnT <= 0) e.burnDps = 0;
    }
  }

  private chainLightning(from: Enemy, dmg: number): void {
    const targets = this.list
      .filter(o => o !== from && o.hp > 0 && Math.hypot(o.pos.x - from.pos.x, o.pos.z - from.pos.z) < EL.shockRange)
      .sort((a, b) => Math.hypot(a.pos.x - from.pos.x, a.pos.z - from.pos.z) - Math.hypot(b.pos.x - from.pos.x, b.pos.z - from.pos.z))
      .slice(0, EL.shockTargets);
    let prev = from;
    const fromPt = (e: Enemy) => ({ x: e.pos.x, y: e.def.y, z: e.pos.z });
    for (const t of targets) {
      this.g.fx.lightning(fromPt(prev), fromPt(t), SHOCK_COLOR);
      this.damage(t, dmg, {});
      prev = t;
    }
    if (targets.length) sfx.zap();
    else this.g.fx.burst(fromPt(from), SHOCK_COLOR, 4, 4, 0.12, 0.2);
  }

  private paint(e: Enemy): void {
    if (e.flash > 0) {
      e.mat.emissive.copy(WHITE);
      e.mat.emissiveIntensity = 2.4;
      return;
    }
    tint.copy(e.base);
    if (e.frostT > 0) tint.lerp(FROST_COLOR, 0.65);
    else if (e.burnT > 0) tint.lerp(BURN_TINT, 0.3);
    e.mat.emissive.copy(tint);
    e.mat.emissiveIntensity = e.state === 'wind' ? 3 : e.enraged ? 2.3 + Math.sin(e.t * 12) * 0.6 : 1.6;
  }

  private updateMarkers(dt: number): void {
    const g = this.g;
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i], r = m.rift, def = ENEMIES[m.kind];
      r.update(dt, g.gfx.camera);
      if (r.open && Math.random() < dt * 25) {
        g.fx.burst({ x: r.x, y: rand(0.3, 1.6), z: r.z }, def.color, 1, 3, 0.1, 0.35);  // sparks off the tear
      }
      if (!m.spawned && r.progress >= 1) {
        m.spawned = true;
        r.close();
        this.spawn(m.kind, r.x, r.z);
        const big = m.kind === 'boss';
        g.fx.burst({ x: r.x, y: 1, z: r.z }, def.color, big ? 50 : 14, big ? 12 : 6, big ? 0.3 : 0.16, 0.5);
        g.fx.shockwave(r.x, r.z, big ? 5 : 1.6, def.color);
        g.fx.shake(big ? 0.8 : 0.06);
        sfx.riftOpen(big);
      }
      if (r.done) {
        r.dispose(g.gfx.scene);
        this.markers.splice(i, 1);
      }
    }
  }

  private kill(e: Enemy): void {
    const g = this.g, def = e.def, big = e.kind === 'boss';
    g.gfx.scene.remove(e.mesh);
    e.mat.dispose();
    this.list.splice(this.list.indexOf(e), 1);

    g.fx.burst({ x: e.pos.x, y: def.y, z: e.pos.z }, def.color, big ? 80 : e.kind === 'brute' ? 30 : 16, big ? 16 : 9, big ? 0.4 : 0.22, big ? 1.2 : 0.6);
    g.fx.shake(big ? 1.2 : 0.2);
    g.fx.hitstop(big ? 0.25 : 0.03);
    if (big) sfx.boom(); else sfx.kill();

    if (Math.random() < def.dropChance) {
      const spread = def.dropCount > 1 ? 1.5 : 0;
      for (let i = 0; i < def.dropCount; i++) g.pickups.spawnOrb(e.pos.x + rand(-spread, spread), e.pos.z + rand(-spread, spread));
    }
    g.pickups.spawnCoins(e.pos.x, e.pos.z, Math.round(rand(def.coins[0], def.coins[1])));
    if (big) {
      g.hud.showBossBar(false);
      g.gfx.flash(e.pos.x, 3, e.pos.z, 0xff3366, 200);
    }
    g.onEnemyKilled(e);
  }
}
