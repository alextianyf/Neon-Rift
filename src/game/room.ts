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
}

export interface SpawnEntry {
  kind: EnemyKind;
  delay: number;  // seconds after entering the room
}

const PORTAL_RADIUS = 1.4;

function edgeLines(geo: THREE.BufferGeometry, color: THREE.Color): THREE.LineSegments {
  return new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color }));
}

// One arena: walls, pillars, collision, the spawn plan and the exit portal.
// Coordinates: the room is centered on the origin, x in [-hw, hw], z in [-hh, hh].
export class Room {
  n = 1;
  hw = 15;
  hh = 10;
  obstacles: AABB[] = [];
  queue: SpawnEntry[] = [];
  time = 0;
  cleared = false;
  clearT = -1;
  readonly theme = new THREE.Color();
  private group: THREE.Group | null = null;
  private portal: THREE.Group | null = null;

  constructor(private readonly scene: THREE.Scene) {}

  get isBoss(): boolean {
    return this.n % BALANCE.rooms.bossEvery === 0;
  }

  build(n: number): void {
    this.dispose();
    this.n = n;
    const boss = this.isBoss;
    this.hw = boss ? 17 : 15;
    this.hh = boss ? 12 : 10;
    this.obstacles = [];
    this.theme.setHSL((0.52 + n * 0.13) % 1, 0.9, 0.55);
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
    const edgeCol = theme.clone().multiplyScalar(2.2);
    const walls: [number, number, number, number][] = [[0, -hh, hw * 2 + 1, 1], [0, hh, hw * 2 + 1, 1], [-hw, 0, 1, hh * 2 + 1], [hw, 0, 1, hh * 2 + 1]];
    for (const [x, z, w, d] of walls) {
      const geo = new THREE.BoxGeometry(w, 1.6, d);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, 0.8, z);
      const e = edgeLines(geo, edgeCol);
      e.position.copy(m.position);
      g.add(m, e);
    }

    const addPillar = (x: number, z: number, w: number, d: number) => {
      const h = rand(1.4, 2.8), geo = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(geo, wallMat);
      m.position.set(x, h / 2, z);
      const e = edgeLines(geo, edgeCol);
      e.position.copy(m.position);
      g.add(m, e);
      this.obstacles.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 });
    };
    if (boss) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) addPillar(sx * hw * 0.55, sz * hh * 0.5, 2, 2);
    } else {
      const count = 3 + Math.floor(Math.random() * 4);
      for (let tries = 0; this.obstacles.length < count && tries < 60; tries++) {
        const w = rand(1.2, 3.5), d = rand(1.2, 3.5);
        const x = rand(-hw + 3, hw - 3), z = rand(-hh + 3, hh - 3);
        if (Math.hypot(x, z) < 4.5) continue;            // keep center free for the portal
        if (Math.abs(x) < 4 && z > hh - 6) continue;     // keep player entry free
        const overlaps = this.obstacles.some(o =>
          x + w / 2 > o.x0 - 2 && x - w / 2 < o.x1 + 2 && z + d / 2 > o.z0 - 2 && z - d / 2 < o.z1 + 2);
        if (!overlaps) addPillar(x, z, w, d);
      }
    }
    this.scene.add(g);
    this.group = g;
  }

  // Fill the spawn queue for the current room and reset its timers.
  plan(): void {
    const n = this.n, R = BALANCE.rooms, q: SpawnEntry[] = [];
    if (this.isBoss) {
      q.push({ kind: 'boss', delay: 1.2 });
      for (let i = 0; i < 3; i++) q.push({ kind: 'grunt', delay: 2 + i * 0.4 });
    } else {
      const total = R.budgetBase + n * R.budgetPerRoom;
      let budget = total, spent = 0, t = 0.8;
      while (budget > 0) {
        let kind: EnemyKind = 'grunt';
        const r = Math.random();
        if (n >= R.shooterFromRoom && r < 0.35) kind = 'shooter';
        else if (n >= R.bruteFromRoom && r > 0.86) kind = 'brute';
        const cost = ENEMIES[kind].cost;
        budget -= cost;
        spent += cost;
        q.push({ kind, delay: t });
        t += rand(0.2, 0.6);
        if (spent >= total / 2 && spent - cost < total / 2) t += R.waveGap;
      }
    }
    this.queue = q;
    this.time = 0;
    this.cleared = false;
    this.clearT = -1;
  }

  // Pop every queued spawn whose delay has elapsed.
  takeDueSpawns(): SpawnEntry[] {
    const due: SpawnEntry[] = [];
    while (this.queue.length && this.queue[0].delay <= this.time) due.push(this.queue.shift()!);
    return due;
  }

  blocked(x: number, z: number, r: number): boolean {
    if (Math.abs(x) > this.hw - 0.5 - r || Math.abs(z) > this.hh - 0.5 - r) return true;
    for (const o of this.obstacles)
      if (x > o.x0 - r && x < o.x1 + r && z > o.z0 - r && z < o.z1 + r) return true;
    return false;
  }

  // Push a circle out of walls and pillars. Returns true if it touched anything.
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

  openPortal(): void {
    const g = new THREE.Group();
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
    return this.portal !== null && Math.hypot(p.x, p.z) < PORTAL_RADIUS;
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
