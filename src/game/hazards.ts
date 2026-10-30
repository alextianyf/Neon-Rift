import * as THREE from 'three';
import { disposeTree, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { rnd, rrand } from '../core/rng';
import { BALANCE } from '../data/balance';
import { isCombatKind } from '../data/map';
import type { AABB } from './room';
import type { Game } from './game';
import { Rift } from './rift';
import { t } from '../core/i18n';

// Terrain hazards. Rule: everything affects enemies as much as the player, so they are tools,
// not just traps (lure enemies into sludge, knock them into acid, blow up barrels near a crowd).

const H = BALANCE.hazards;
const SLUDGE_COLOR = 0x39ffb0;
const ACID_COLOR = 0xff2fa0;
const BARREL_COLOR = 0xffc83d;
const RIFT_COLOR = 0xb455ff;
const GRID_COLOR = 0x9fd8ff;
const COVER_COLOR = 0x6c8cff;

type ZoneKind = 'sludge' | 'acid';
type HazardType = ZoneKind | 'barrel' | 'grid' | 'cover';
type GridPhase = 'off' | 'warn' | 'on';

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

// Electric fence between two pylons that cycles off -> warning -> on.
interface Grid {
  x: number;  // midpoint, for spacing checks
  z: number;
  a: THREE.Vector3;
  b: THREE.Vector3;
  phase: GridPhase;
  timer: number;
  tick: number;
  group: THREE.Group;
  beam: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  pylons: AABB[];
}

// Crate that blocks shots from both sides until it's shot apart.
interface Cover {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
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

function distToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.z - a.z) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(p.x - (a.x + abx * t), p.z - (a.z + abz * t));
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
  private grids: Grid[] = [];
  private covers: Cover[] = [];
  private t = 0;
  private drainFlash = 0;

  constructor(private readonly g: Game) {}

  // Unstable rifts still open; the room can't be cleared until they're shut.
  get active(): boolean {
    return this.zones.length + this.barrels.length + this.rifts.length + this.grids.length + this.covers.length > 0;
  }

  get openRifts(): number {
    return this.rifts.filter(r => !r.closed).length;
  }

  build(): void {
    this.clear();
    const room = this.g.room, n = room.n;
    if (!isCombatKind(room.kind) || n < H.fromRoom) return;

    const types: HazardType[] = (['sludge', 'acid', 'barrel', 'grid', 'cover'] as HazardType[]).sort(() => rnd() - 0.5);
    const chosen = types.slice(0, n >= H.twoTypesFromRoom ? 2 : 1);
    const scale = (room.hw * room.hh) / (18 * 12);
    for (const type of chosen) {
      if (type === 'grid') {
        for (let i = 0, count = Math.max(1, Math.round(2 * scale)); i < count; i++) this.tryAddGrid();
      } else if (type === 'cover') {
        for (let i = 0, count = Math.round((4 + rnd() * 3) * scale); i < count; i++) {
          const spot = this.findSpot(1.2);
          if (spot) this.addCover(spot[0], spot[1]);
        }
      } else if (type === 'barrel') {
        for (let c = 0, clusters = Math.round(3 * scale); c < clusters; c++) {
          const spot = this.findSpot(1.6);
          if (!spot) continue;
          for (let i = 0, k = 2 + Math.floor(rnd() * 2); i < k; i++) {
            const x = spot[0] + rrand(-1, 1), z = spot[1] + rrand(-1, 1);
            if (!room.blocked(x, z, 0.5)) this.addBarrel(x, z);
          }
        }
      } else {
        for (let i = 0, count = Math.max(1, Math.round((2 + rnd()) * scale)); i < count; i++) {
          const r = type === 'sludge' ? rrand(2.5, 3.8) : rrand(1.8, 2.6);
          const spot = this.findSpot(r);
          if (spot) this.addZone(type, spot[0], spot[1], r);
        }
      }
    }
    if (n >= H.riftFromRoom && rnd() < H.riftChance) {
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
    if (this.hitCover(pos, dmg)) return true;
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

  // An enemy bullet at `pos`: cover soaks it up and takes damage.
  hitByEnemyShot(pos: THREE.Vector3, dmg: number): boolean {
    return this.hitCover(pos, dmg);
  }

  // Explosions set off nearby barrels (chain reactions) and smash cover.
  explodeAt(pos: THREE.Vector3, radius: number): void {
    for (const b of this.barrels)
      if (b.fuse <= 0 && Math.hypot(pos.x - b.x, pos.z - b.z) < radius + 0.4) b.fuse = rand(0.1, 0.22);
    for (const c of [...this.covers])
      if (Math.hypot(pos.x - c.x, pos.z - c.z) < radius + 0.7) this.damageCover(c, 40);
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

    for (const gr of this.grids) this.updateGrid(gr, dt);

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
    for (const gr of this.grids) {
      scene.remove(gr.group);
      disposeTree(gr.group);
      for (const a of gr.pylons) {
        const i = room.obstacles.indexOf(a);
        if (i >= 0) room.obstacles.splice(i, 1);
      }
    }
    for (const c of this.covers) this.removeCover(c);
    this.zones = [];
    this.barrels = [];
    this.rifts = [];
    this.grids = [];
    this.covers = [];
  }

  private findSpot(r: number): [number, number] | null {
    const room = this.g.room;
    for (let i = 0; i < 60; i++) {
      const x = rrand(-room.hw + r + 1, room.hw - r - 1), z = rrand(-room.hh + r + 1, room.hh - r - 1);
      if (!room.isFree(x, z, r * 0.6)) continue;
      const clash = [...this.zones, ...this.rifts, ...this.barrels, ...this.grids, ...this.covers].some(h =>
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

  // A fence between two pylons across open floor; skipped if no clear line is found.
  private tryAddGrid(): void {
    const room = this.g.room;
    for (let i = 0; i < 40; i++) {
      const spot = this.findSpot(1.2);
      if (!spot) return;
      const len = rrand(5, 9), ang = rnd() * Math.PI;
      const dx = Math.cos(ang) * len / 2, dz = Math.sin(ang) * len / 2;
      const a = new THREE.Vector3(spot[0] - dx, 0, spot[1] - dz), b = new THREE.Vector3(spot[0] + dx, 0, spot[1] + dz);
      // the whole line must be walkable and away from the hub and entry
      let ok = true;
      for (let k = 0; k <= 8 && ok; k++) {
        const t = k / 8;
        ok = room.isFree(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 0.6);
      }
      if (!ok) continue;
      this.addGrid(a, b);
      return;
    }
  }

  private addGrid(a: THREE.Vector3, b: THREE.Vector3): void {
    const g = this.g, room = g.room;
    const group = new THREE.Group();
    const pylons: AABB[] = [];
    for (const p of [a, b]) {
      const pylon = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 1.5, 8), new THREE.MeshStandardMaterial({ color: 0x1c2233, metalness: 0.6, roughness: 0.4 }));
      pylon.position.set(p.x, 0.75, p.z);
      const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.2), glowMat(GRID_COLOR, 2.2));
      top.position.set(p.x, 1.6, p.z);
      group.add(pylon, top);
      const box: AABB = { x0: p.x - 0.3, x1: p.x + 0.3, z0: p.z - 0.3, z1: p.z + 0.3 };
      room.obstacles.push(box);
      pylons.push(box);
    }
    const len = a.distanceTo(b);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, len), new THREE.MeshBasicMaterial({ color: new THREE.Color(GRID_COLOR).multiplyScalar(3), transparent: true, opacity: 0 }));
    beam.position.set((a.x + b.x) / 2, 0.9, (a.z + b.z) / 2);
    beam.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
    group.add(beam);
    g.gfx.scene.add(group);
    this.grids.push({ x: beam.position.x, z: beam.position.z, a, b, phase: 'off', timer: rrand(0.5, 2.5), tick: 0, group, beam, pylons });
  }

  private updateGrid(gr: Grid, dt: number): void {
    const g = this.g;
    gr.timer -= dt;
    if (gr.timer <= 0) {
      gr.phase = gr.phase === 'off' ? 'warn' : gr.phase === 'warn' ? 'on' : 'off';
      gr.timer = gr.phase === 'off' ? H.gridOff : gr.phase === 'warn' ? H.gridWarn : H.gridOn;
      if (gr.phase === 'on') sfx.zap();
    }
    const m = gr.beam.material;
    if (gr.phase === 'off') { m.opacity = 0; return; }
    if (gr.phase === 'warn') {
      m.opacity = Math.random() < 0.5 ? 0.15 : 0.5;  // flickering telegraph
      gr.beam.scale.set(0.4, 0.4, 1);
      return;
    }
    m.opacity = 0.85 + Math.random() * 0.15;
    gr.beam.scale.set(1 + Math.random() * 0.6, 1 + Math.random() * 0.6, 1);
    if (Math.random() < dt * 12) g.fx.lightning({ x: gr.a.x, y: 0.9, z: gr.a.z }, { x: gr.b.x, y: 0.9, z: gr.b.z }, GRID_COLOR);
    const p = g.player;
    if (distToSegment(p.pos, gr.a, gr.b) < p.r + 0.15) g.damagePlayer(H.gridPlayerDmg, null);
    gr.tick -= dt;
    if (gr.tick <= 0) {
      gr.tick = 0.3;
      for (const e of [...g.enemies.list])
        if (distToSegment(e.pos, gr.a, gr.b) < e.r + 0.15) g.enemies.damage(e, H.gridEnemyDmg, { dot: true });
    }
  }

  private addCover(x: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const w = rrand(1.2, 1.8), d = rrand(0.6, 1.0), h = 1.1;
    const [sx, sz] = rnd() < 0.5 ? [d, w] : [w, d];
    const geo = new THREE.BoxGeometry(sx, h, sz);
    const body = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x1b2135, metalness: 0.3, roughness: 0.6, emissive: 0x0a1020 }));
    body.position.y = h / 2;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: new THREE.Color(COVER_COLOR).multiplyScalar(2.2) }));
    edges.position.y = h / 2;
    group.add(body, edges);
    this.g.gfx.scene.add(group);
    const aabb: AABB = { x0: x - sx / 2, x1: x + sx / 2, z0: z - sz / 2, z1: z + sz / 2 };
    this.g.room.obstacles.push(aabb);
    const hp = H.coverHp * (1 + (this.g.room.n - 1) * 0.05);
    this.covers.push({ x, z, hp, maxHp: hp, group, aabb });
  }

  private hitCover(pos: THREE.Vector3, dmg: number): boolean {
    for (const c of this.covers) {
      const a = c.aabb;
      if (pos.x < a.x0 - 0.1 || pos.x > a.x1 + 0.1 || pos.z < a.z0 - 0.1 || pos.z > a.z1 + 0.1) continue;
      this.damageCover(c, dmg);
      this.g.fx.burst(pos, COVER_COLOR, 2, 4, 0.1, 0.2);
      return true;
    }
    return false;
  }

  private damageCover(c: Cover, dmg: number): void {
    c.hp -= dmg;
    c.group.scale.set(1, 0.6 + 0.4 * Math.max(0, c.hp / c.maxHp), 1);  // visibly crumbles
    if (c.hp > 0) return;
    this.g.fx.burst({ x: c.x, y: 0.6, z: c.z }, COVER_COLOR, 18, 6, 0.2, 0.6);
    sfx.kill();
    this.removeCover(c);
    this.covers.splice(this.covers.indexOf(c), 1);
  }

  private removeCover(c: Cover): void {
    this.g.gfx.scene.remove(c.group);
    disposeTree(c.group);
    const i = this.g.room.obstacles.indexOf(c.aabb);
    if (i >= 0) this.g.room.obstacles.splice(i, 1);
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
    g.hud.toast(t('不稳定裂缝已封闭'));
  }
}
