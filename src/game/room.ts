import * as THREE from 'three';
import { disposeTree } from '../core/assets';
import { clamp, rand } from '../core/math';
import { BALANCE } from '../data/balance';
import { ENEMIES, type EnemyKind } from '../data/enemies';

export interface AABB {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  low?: boolean;  // pits: block movement but not shots
}

export interface SpawnEntry {
  kind: EnemyKind;
  delay: number;   // seconds after the wave starts
  count: number;   // enemies released by this rift (swarms come in packs)
  elite: boolean;
}

export type RoomKind = 'combat' | 'boss' | 'shop';
export type RoomSize = 'small' | 'medium' | 'large';
export type Layout = 'arena' | 'pit' | 'lshape' | 'lanes';

const SIZES: Record<RoomSize, [number, number]> = { small: [14, 9], medium: [18, 12], large: [22, 15] };
const PORTAL_RADIUS = 1.4;

function edgeLines(geo: THREE.BufferGeometry, color: THREE.Color): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
}

function pick<T>(weights: [T, number][]): T {
  let r = Math.random() * weights.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of weights) if ((r -= w) <= 0) return v;
  return weights[0][0];
}

// One arena: walls, layout, collision, the wave plan and the exit portal.
// Coordinates: the room is centered on the origin, x in [-hw, hw], z in [-hh, hh].
export class Room {
  n = 1;
  hw = 15;
  hh = 10;
  size: RoomSize = 'medium';
  layout: Layout = 'arena';
  obstacles: AABB[] = [];
  waves: SpawnEntry[][] = [];
  wave = 0;             // index of the current wave
  waveSize = 0;         // enemies in the current wave
  queue: SpawnEntry[] = [];
  time = 0;             // seconds since the current wave started
  cleared = false;
  clearT = -1;
  readonly theme = new THREE.Color();
  readonly hub = new THREE.Vector3();      // free spot for the exit portal
  readonly lootSpot = new THREE.Vector3(); // free spot for the weapon drop
  readonly portalPos = new THREE.Vector3();
  private group: THREE.Group | null = null;
  private portal: THREE.Group | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  get kind(): RoomKind {
    const k = this.n % BALANCE.rooms.bossEvery;
    return k === 0 ? 'boss' : k === BALANCE.rooms.shopOffset ? 'shop' : 'combat';
  }

  get isBoss(): boolean {
    return this.kind === 'boss';
  }

  get entry(): THREE.Vector3 {
    return new THREE.Vector3(0, 0, this.hh - 2.5);
  }

  get label(): string {
    if (this.kind === 'combat' && this.waves.length > 1) return `净化中 · 波次 ${Math.min(this.wave + 1, this.waves.length)}/${this.waves.length}`;
    return { combat: '净化中', boss: '裂隙核心', shop: '黑市终端' }[this.kind];
  }

  build(n: number): void {
    this.dispose();
    this.n = n;
    const boss = this.isBoss, shop = this.kind === 'shop';
    if (boss) { this.size = 'large'; this.layout = 'arena'; }
    else if (shop) { this.size = 'small'; this.layout = 'arena'; }
    else if (n === 1) { this.size = 'medium'; this.layout = 'arena'; }
    else {
      this.size = pick<RoomSize>([['small', 3], ['medium', 4], ['large', 3]]);
      this.layout = this.size === 'small'
        ? pick<Layout>([['arena', 3], ['lanes', 1]])
        : pick<Layout>([['arena', 2], ['pit', 2], ['lshape', 2], ['lanes', 2]]);
    }
    [this.hw, this.hh] = boss ? [21, 15] : shop ? [15, 10] : SIZES[this.size];
    this.obstacles = [];
    this.hub.set(0, 0, 0);
    this.lootSpot.set(0, 0, 3);
    this.theme.setHSL(shop ? 0.13 : (0.52 + n * 0.13) % 1, 0.9, 0.55);
    const { hw, hh, theme } = this;
    const g = new THREE.Group();

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, hh * 2), new THREE.MeshStandardMaterial({ color: 0x0d0c16, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    g.add(floor);

    const pts: number[] = [];
    for (let x = -hw; x <= hw; x += 2) pts.push(x, 0.01, -hh, x, 0.01, hh);
    for (let z = -hh; z <= hh; z += 2) pts.push(-hw, 0.01, z, hw, 0.01, z);
    const grid = new THREE.BufferGeometry();
    grid.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(grid, new THREE.LineBasicMaterial({ color: theme.clone().multiplyScalar(0.3) })));

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.7 });
    const edgeCol = theme.clone().multiplyScalar(4.5);
    const block = (x: number, z: number, w: number, d: number, h: number) => {
      const geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, h / 2, z);
      const e = edgeLines(geo, edgeCol);
      e.position.copy(m.position);
      g.add(m, e);
      this.obstacles.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    };

    // outer walls (not in `obstacles`; the room bounds handle them)
    for (const [x, z, w, d] of [[0, -hh, hw * 2 + 1, 1], [0, hh, hw * 2 + 1, 1], [-hw, 0, 1, hh * 2 + 1], [hw, 0, 1, hh * 2 + 1]]) {
      block(x, z, w, d, 1.6);
      this.obstacles.pop();
    }

    // layout features
    if (this.layout === 'pit') {
      const w = hw * 0.55, d = hh * 0.5, z = 0.5;
      this.addPit(g, 0, z, w, d);
      this.hub.set(0, 0, -hh + 3.5);
      this.lootSpot.set(4, 0, -hh + 3.5);
    } else if (this.layout === 'lshape') {
      // a solid block fills one far corner, turning the room into an L
      const sx = Math.random() < 0.5 ? 1 : -1;
      const x0 = hw * 0.32, z1 = -hh * 0.3;
      block(sx * (x0 + hw) / 2, (-hh + z1) / 2, hw - x0, z1 + hh, 2.6);
    } else if (this.layout === 'lanes') {
      // two long walls with a gap in the middle split the room into lanes
      for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
        const x0 = 3.2, x1 = hw * 0.78;
        block(sx * (x0 + x1) / 2, sz * hh * 0.42, x1 - x0, 0.9, 1.9);
      }
    }

    // scattered pillars, fewer when the layout already has features
    if (boss) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) block(sx * hw * 0.55, sz * hh * 0.5, 2, 2, rand(1.4, 2.8));
    } else if (shop) {
      for (const sx of [-1, 1]) block(sx * (hw - 3), -hh + 3, 1.5, 1.5, rand(1.4, 2.8));
    } else {
      const base = this.layout === 'arena' ? 5 : 2;
      const count = Math.round((base + Math.random() * 4) * (hw * hh) / (18 * 12));
      for (let tries = 0, placed = 0; placed < count && tries < 150; tries++) {
        const w = rand(1.2, 3.2), d = rand(1.2, 3.2);
        const x = rand(-hw + 3, hw - 3), z = rand(-hh + 3, hh - 3);
        if (!this.isFree(x, z, Math.max(w, d) / 2 + 2)) continue;
        block(x, z, w, d, rand(1.4, 2.8));
        placed++;
      }
    }
    this.scene.add(g);
    this.group = g;
  }

  // True if a circle at (x, z) stays clear of obstacles, the hub, the loot spot and the player entry.
  isFree(x: number, z: number, r: number): boolean {
    if (this.blocked(x, z, r)) return false;
    for (const p of [this.hub, this.lootSpot]) if (Math.hypot(x - p.x, z - p.z) < r + 3.5) return false;
    const e = this.entry;
    return Math.hypot(x - e.x, z - e.z) >= r + 3;
  }

  // Build the wave plan for the current room and start the first wave.
  plan(): void {
    const n = this.n, R = BALANCE.rooms, E = BALANCE.elites;
    this.waves = [];
    if (this.kind === 'boss') {
      this.waves = [[{ kind: 'boss', delay: 1.2, count: 1, elite: false }, { kind: 'grunt', delay: 2, count: 3, elite: false }]];
    } else if (this.kind === 'combat') {
      const area = clamp((this.hw * this.hh) / (18 * 12), 0.6, 1.6);
      const total = (R.budgetBase + n * R.budgetPerRoom) * area;
      const waveCount = this.size === 'small' ? 2 : this.size === 'large' ? 3 : n >= 6 ? 3 : 2;
      const eliteChance = n >= E.fromRoom ? Math.min(E.maxChance, E.chance + (n - E.fromRoom) * E.chancePerRoom) : 0;
      for (let w = 0; w < waveCount; w++) {
        // later waves are a bit heavier
        let budget = total / waveCount * (0.8 + 0.4 * w / Math.max(1, waveCount - 1));
        const wave: SpawnEntry[] = [];
        let t = 0.6;
        while (budget > 0) {
          const r = Math.random();
          let kind: EnemyKind = 'grunt', count = 1;
          if (n >= R.swarmFromRoom && r < 0.25) { kind = 'swarmer'; count = 5 + Math.floor(Math.random() * 5); }
          else if (n >= R.shooterFromRoom && r < 0.5) kind = 'shooter';
          else if (n >= R.bruteFromRoom && r > 0.88) kind = 'brute';
          const elite = kind !== 'swarmer' && Math.random() < eliteChance;
          budget -= ENEMIES[kind].cost * count * (elite ? 2.5 : 1);
          wave.push({ kind, delay: t, count, elite });
          t += rand(0.25, 0.7);
        }
        this.waves.push(wave);
      }
    }
    this.cleared = this.kind === 'shop';
    this.clearT = -1;
    this.startWave(0);
  }

  startWave(i: number): void {
    this.wave = i;
    this.queue = [...(this.waves[i] ?? [])];
    this.waveSize = this.queue.reduce((s, e) => s + e.count, 0);
    this.time = 0;
  }

  get hasMoreWaves(): boolean {
    return this.wave < this.waves.length - 1;
  }

  // Pop every queued spawn whose delay has elapsed.
  takeDueSpawns(): SpawnEntry[] {
    const due: SpawnEntry[] = [];
    while (this.queue.length && this.queue[0].delay <= this.time) due.push(this.queue.shift()!);
    return due;
  }

  // Movement blocking: walls, pillars and pits.
  blocked(x: number, z: number, r: number): boolean {
    if (Math.abs(x) > this.hw - 0.5 - r || Math.abs(z) > this.hh - 0.5 - r) return true;
    for (const o of this.obstacles)
      if (x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r) return true;
    return false;
  }

  // Shot blocking: like blocked(), but projectiles fly over pits.
  shotBlocked(x: number, z: number): boolean {
    if (Math.abs(x) > this.hw - 0.5 || Math.abs(z) > this.hh - 0.5) return true;
    for (const o of this.obstacles)
      if (!o.low && x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1) return true;
    return false;
  }

  // Push a circle out of walls, pillars and pits. Returns true if it touched anything.
  collide(p: THREE.Vector3, r: number): boolean {
    let hit = false;
    const lx = this.hw - 0.5 - r, lz = this.hh - 0.5 - r;
    if (Math.abs(p.x) > lx) { p.x = clamp(p.x, -lx, lx); hit = true; }
    if (Math.abs(p.z) > lz) { p.z = clamp(p.z, -lz, lz); hit = true; }
    for (const o of this.obstacles) {
      const cx = clamp(p.x, o.x0, o.x1), cz = clamp(p.z, o.z0, o.z1);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = cx + dx / d * r;
        p.z = cz + dz / d * r;
      } else {
        // center is inside the box: push out through the nearest face
        const l = p.x - o.x0, rr = o.x1 - p.x, t = p.z - o.z0, b = o.z1 - p.z, m = Math.min(l, rr, t, b);
        if (m === l) p.x = o.x0 - r;
        else if (m === rr) p.x = o.x1 + r;
        else if (m === t) p.z = o.z0 - r;
        else p.z = o.z1 + r;
      }
    }
    return hit;
  }

  findSpawn(from: THREE.Vector3, minDist: number, r: number): [number, number] {
    for (let i = 0; i < 40; i++) {
      const x = rand(-this.hw + 1.5, this.hw - 1.5), z = rand(-this.hh + 1.5, this.hh - 1.5);
      if (!this.blocked(x, z, r) && Math.hypot(x - from.x, z - from.z) >= minDist) return [x, z];
    }
    return [from.x > 0 ? -this.hw + 2 : this.hw - 2, -this.hh + 2];
  }

  openPortal(x = this.hub.x, z = this.hub.z): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    this.portalPos.set(x, 0, z);
    const col = new THREE.Color(0x4ff0ff).multiplyScalar(2.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.12, 8, 40), new THREE.MeshBasicMaterial({ color: col }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.15;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.35 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.05;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.1, 1.1, 6, 24, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    beam.position.y = 3;
    g.add(ring, disc, beam);
    this.scene.add(g);
    this.portal = g;
  }

  updatePortal(dt: number, time: number): void {
    if (!this.portal) return;
    const [ring, disc] = this.portal.children as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[];
    ring.rotation.z += dt * 2;
    disc.material.opacity = 0.25 + Math.sin(time * 5) * 0.12;
  }

  portalReached(p: THREE.Vector3): boolean {
    return this.portal !== null && Math.hypot(p.x - this.portalPos.x, p.z - this.portalPos.z) < PORTAL_RADIUS;
  }

  // A rectangular hole into the void: blocks walking, not shooting.
  private addPit(g: THREE.Group, x: number, z: number, w: number, d: number): void {
    const cover = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color: 0x020107 }));
    cover.rotation.x = -Math.PI / 2;
    cover.position.set(x, 0.02, z);
    g.add(cover);
    // nested rims that dim toward the middle fake the depth of the abyss
    for (let i = 0; i < 5; i++) {
      const k = 1 - i * 0.12;
      const rim = edgeLines(new THREE.BoxGeometry(w * k, 0.01, d * k), new THREE.Color(0xb455ff).multiplyScalar(i === 0 ? 3 : 1.2 - i * 0.22));
      rim.position.set(x, 0.03, z);
      g.add(rim);
    }
    this.obstacles.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, low: true });
  }

  private dispose(): void {
    for (const obj of [this.group, this.portal]) {
      if (!obj) continue;
      this.scene.remove(obj);
      disposeTree(obj);
    }
    this.group = null;
    this.portal = null;
  }
}
