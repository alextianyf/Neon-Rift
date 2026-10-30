import * as THREE from 'three';
import { disposeTree, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import type { AABB } from './room';
import type { Game } from './game';
import { Rift } from './rift';

// Terrain hazards. Rule: everything affects enemies as much as the player, so they are tools,
// not just traps (lure enemies into sludge, knock them into acid, blow up barrels near a crowd).

const H = BALANCE.hazards;
const SLUDGE_COLOR = 0x39ffb0;
const ACID_COLOR = 0xff2fa0;
const BARREL_COLOR = 0xffc83d;
const RIFT_COLOR = 0xb455ff;

type ZoneKind = 'sludge' | 'acid';
type HazardType = ZoneKind | 'barrel';

interface Zone {
  kind: ZoneKind;
  x: number;
  z: number;
  r: number;
  group: THREE.Group;
  swirl: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  tick: number;
}

interface Barrel {
  x: number;
  z: number;
  hp: number;
  fuse: number;  // > 0 once triggered; explodes when it runs out (gives chain reactions a beat)
  group: THREE.Group;
  aabb: AABB;
}

interface UnstableRift {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  rift: Rift;
  spawnT: number;
  closed: boolean;
}

function circleLine(r: number, color: number, k: number, y: number): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
  }
  return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) }));
}

export class Hazards {
  private zones: Zone[] = [];
  private barrels: Barrel[] = [];
  private rifts: UnstableRift[] = [];
  private t = 0;
  private drainFlash = 0;

  constructor(private readonly g: Game) {}

  // Unstable rifts still open; the room can't be cleared until they're shut.
  get openRifts(): number {
    return this.rifts.filter(r => !r.closed).length;
  }

  build(): void {
    this.clear();
    const room = this.g.room, n = room.n;
    if (room.kind !== 'combat' || n < H.fromRoom) return;

    const types: HazardType[] = ['sludge', 'acid', 'barrel'].sort(() => Math.random() - 0.5) as HazardType[];
    const chosen = types.slice(0, n >= H.twoTypesFromRoom ? 2 : 1);
    const scale = (room.hw * room.hh) / (18 * 12);
    for (const type of chosen) {
      if (type === 'barrel') {
        for (let c = 0, clusters = Math.round(3 * scale); c < clusters; c++) {
          const spot = this.findSpot(1.6);
          if (!spot) continue;
          for (let i = 0, k = 2 + Math.floor(Math.random() * 2); i < k; i++) {
            const x = spot[0] + rand(-1, 1), z = spot[1] + rand(-1, 1);
            if (!room.blocked(x, z, 0.5)) this.addBarrel(x, z);
          }
        }
      } else {
        for (let i = 0, count = Math.max(1, Math.round((2 + Math.random()) * scale)); i < count; i++) {
          const r = type === 'sludge' ? rand(2.5, 3.8) : rand(1.8, 2.6);
          const spot = this.findSpot(r);
          if (spot) this.addZone(type, spot[0], spot[1], r);
        }
      }
    }
    if (n >= H.riftFromRoom && Math.random() < H.riftChance) {
      const spot = this.findSpot(1.5);
      if (spot) this.addRift(spot[0], spot[1]);
    }
  }

  // Movement speed multiplier at a point (sludge).
  slowAt(x: number, z: number): number {
    for (const zone of this.zones)
      if (zone.kind === 'sludge' && Math.hypot(x - zone.x, z - zone.z) < zone.r) return H.sludgeSlow;
    return 1;
  }

  // A player bullet at `pos`: returns true if a barrel or unstable rift absorbed it.
  hitByShot(pos: THREE.Vector3, dmg: number): boolean {
    for (const b of this.barrels) {
      if (b.fuse > 0 || Math.hypot(pos.x - b.x, pos.z - b.z) > 0.55) continue;
      b.hp -= dmg;
      b.group.scale.setScalar(1.12);
      this.g.fx.burst(pos, BARREL_COLOR, 3, 4, 0.12, 0.25);
      if (b.hp <= 0) b.fuse = 0.05;
      return true;
    }
    for (const r of this.rifts) {
      if (r.closed || Math.hypot(pos.x - r.x, pos.z - r.z) > 1.0) continue;
      r.hp -= dmg;
      this.g.floaters.damage({ x: r.x, y: 2.4, z: r.z }, dmg, 'dmg', r);
      this.g.fx.burst(pos, RIFT_COLOR, 3, 5, 0.12, 0.25);
      this.g.hud.hitMarker(false);
      if (r.hp <= 0) this.closeRift(r);
      return true;
    }
    return false;
  }

  // Explosions set off nearby barrels (chain reactions).
  explodeAt(pos: THREE.Vector3, radius: number): void {
    for (const b of this.barrels)
      if (b.fuse <= 0 && Math.hypot(pos.x - b.x, pos.z - b.z) < radius + 0.4) b.fuse = rand(0.1, 0.22);
  }

  update(dt: number): void {
    const g = this.g, p = g.player;
    this.t += dt;

    for (const z of this.zones) {
      z.swirl.rotation.z += dt * (z.kind === 'acid' ? 0.8 : 0.3);
      z.swirl.material.opacity = (z.kind === 'acid' ? 0.35 : 0.22) + Math.sin(this.t * 2 + z.x) * 0.08;
      if (Math.random() < dt * z.r * 1.5) {
        const a = Math.random() * Math.PI * 2, d = Math.random() * z.r;
        g.fx.burst({ x: z.x + Math.cos(a) * d, y: 0.2, z: z.z + Math.sin(a) * d }, z.kind === 'acid' ? ACID_COLOR : SLUDGE_COLOR, 1, 0.6, 0.12, 0.6);
      }
      if (z.kind !== 'acid') continue;
      // acid: drain the player continuously, tick damage on enemies
      if (Math.hypot(p.pos.x - z.x, p.pos.z - z.z) < z.r) {
        g.drainPlayer(H.acidPlayerDps * dt);
        this.drainFlash -= dt;
        if (this.drainFlash <= 0) { this.drainFlash = 0.45; g.hud.hurtFlash(); }
      }
      z.tick -= dt;
      if (z.tick <= 0) {
        z.tick = 0.4;
        for (const e of [...g.enemies.list])
          if (Math.hypot(e.pos.x - z.x, e.pos.z - z.z) < z.r + e.r * 0.5) g.enemies.damage(e, H.acidEnemyDps * 0.4, { dot: true });
      }
    }

    for (const b of [...this.barrels]) {
      b.group.scale.lerp(new THREE.Vector3(1, 1, 1), 1 - Math.exp(-12 * dt));
      if (b.fuse > 0) {
        b.fuse -= dt;
        b.group.position.x = b.x + rand(-0.05, 0.05);
        if (b.fuse <= 0) this.detonate(b);
      }
    }

    for (const r of [...this.rifts]) {
      r.rift.update(dt, g.gfx.camera);
      if (r.closed) {
        if (r.rift.done) {
          r.rift.dispose(g.gfx.scene);
          this.rifts.splice(this.rifts.indexOf(r), 1);
        }
        continue;
      }
      if (Math.random() < dt * 20) g.fx.burst({ x: r.x, y: rand(0.4, 2.4), z: r.z }, RIFT_COLOR, 1, 3, 0.1, 0.35);
      // keeps leaking swarms while the room is being fought
      r.spawnT -= dt;
      if (r.spawnT <= 0 && g.state === 'play') {
        r.spawnT = H.riftSpawnEvery;
        for (let i = 0; i < 3; i++) g.enemies.spawn('swarmer', r.x + rand(-1, 1), r.z + rand(-1, 1));
        g.fx.burst({ x: r.x, y: 1, z: r.z }, RIFT_COLOR, 10, 5, 0.15, 0.4);
        sfx.riftOpen(false);
      }
    }
  }

  clear(): void {
    const scene = this.g.gfx.scene, room = this.g.room;
    for (const z of this.zones) { scene.remove(z.group); disposeTree(z.group); }
    for (const b of this.barrels) {
      scene.remove(b.group);
      disposeTree(b.group);
      const i = room.obstacles.indexOf(b.aabb);
      if (i >= 0) room.obstacles.splice(i, 1);
    }
    for (const r of this.rifts) r.rift.dispose(scene);
    this.zones = [];
    this.barrels = [];
    this.rifts = [];
  }

  private findSpot(r: number): [number, number] | null {
    const room = this.g.room;
    for (let i = 0; i < 60; i++) {
      const x = rand(-room.hw + r + 1, room.hw - r - 1), z = rand(-room.hh + r + 1, room.hh - r - 1);
      if (!room.isFree(x, z, r * 0.6)) continue;
      const clash = [...this.zones, ...this.rifts, ...this.barrels].some(h =>
        Math.hypot(h.x - x, h.z - z) < r + ('r' in h ? h.r : 1.5) + 1);
      if (!clash) return [x, z];
    }
    return null;
  }

  private addZone(kind: ZoneKind, x: number, z: number, r: number): void {
    const color = kind === 'acid' ? ACID_COLOR : SLUDGE_COLOR;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const base = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color: kind === 'acid' ? 0x2a0620 : 0x06231c }));
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.02;
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 7), new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true,
    }));
    swirl.rotation.x = -Math.PI / 2;
    swirl.position.y = 0.03;
    group.add(base, swirl, circleLine(r, color, 2.4, 0.04), circleLine(r * 0.6, color, 0.9, 0.035));
    this.g.gfx.scene.add(group);
    this.zones.push({ kind, x, z, r, group, swirl, tick: 0 });
  }

  private addBarrel(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 12), new THREE.MeshStandardMaterial({ color: 0x2a2410, metalness: 0.5, roughness: 0.5, emissive: 0x1a1200 }));
    body.position.y = 0.55;
    const bandMat = glowMat(BARREL_COLOR, 1.8);
    for (const y of [0.3, 0.8]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.04, 6, 20), bandMat);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      group.add(band);
    }
    const cap = new THREE.Mesh(new THREE.CircleGeometry(0.3, 6), bandMat);
    cap.rotation.x = -Math.PI / 2;
    cap.position.y = 1.11;
    group.add(body, cap);
    this.g.gfx.scene.add(group);
    const aabb: AABB = { x0: x - 0.42, x1: x + 0.42, z0: z - 0.42, z1: z + 0.42 };
    this.g.room.obstacles.push(aabb);
    this.barrels.push({ x, z, hp: H.barrelHp, fuse: 0, group, aabb });
  }

  private detonate(b: Barrel): void {
    const g = this.g, room = g.room;
    this.barrels.splice(this.barrels.indexOf(b), 1);
    g.gfx.scene.remove(b.group);
    disposeTree(b.group);
    const i = room.obstacles.indexOf(b.aabb);
    if (i >= 0) room.obstacles.splice(i, 1);
    const pos = new THREE.Vector3(b.x, 0, b.z);
    g.projectiles.explode(pos, H.barrelRadius, H.barrelDmg * (1 + (room.n - 1) * 0.08), BARREL_COLOR);
    if (Math.hypot(g.player.pos.x - b.x, g.player.pos.z - b.z) < H.barrelRadius) g.damagePlayer(H.barrelPlayerDmg, pos);
  }

  private addRift(x: number, z: number): void {
    const hp = H.riftHp * (1 + (this.g.room.n - 1) * BALANCE.scaling.enemyHpPerRoom);
    // opens over ~1s and then stays open until destroyed
    const rift = new Rift(this.g.gfx.scene, x, z, 3.2, 1, RIFT_COLOR);
    this.rifts.push({ x, z, hp, maxHp: hp, rift, spawnT: 2.5, closed: false });
  }

  private closeRift(r: UnstableRift): void {
    const g = this.g;
    r.closed = true;
    r.rift.close();
    g.fx.burst({ x: r.x, y: 1.4, z: r.z }, RIFT_COLOR, 40, 9, 0.22, 0.7);
    g.fx.shockwave(r.x, r.z, 3, RIFT_COLOR);
    g.fx.shake(0.5);
    sfx.boom();
    g.pickups.spawnCoins(r.x, r.z, H.riftReward);
    g.score += 60;
    g.hud.toast('不稳定裂缝已封闭');
  }
}
