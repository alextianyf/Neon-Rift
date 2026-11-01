import * as THREE from 'three';
import { GEO, markShared } from '../core/assets';
import { sfx } from '../core/audio';
import type { Game } from './game';

// Things enemies leave on the floor: corrosive puddles (hurt and slow the player, not the viruses)
// and attack warnings (a ring that lights up where something is about to hit).

const ACID_COLOR = 0x6fe02a;
const ACID = { slow: 0.7, dps: 8 };
const MAX_PUDDLES = 90;
const DISC = markShared(new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2));

interface Puddle {
  x: number;
  z: number;
  flow: boolean;  // creeps toward the player (variant corroders)
  r: number;
  t: number;     // life left
  age: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

interface Warning {
  x: number;
  z: number;
  r: number;
  t: number;
  max: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

const additive = (hex: number) => new THREE.MeshBasicMaterial({
  color: hex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
});

// Slippery ice sheet from a condenser: the player slides on it (see Player).
interface Ice {
  x: number;
  z: number;
  r: number;
  t: number;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

// A shockwave ring spreading out (or closing in): touching its edge hurts unless dashing.
interface Shock {
  x: number;
  z: number;
  r: number;
  speed: number;   // negative: closing in
  end: number;     // radius where it stops
  dmg: number;
  hit: boolean;
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
}

const ICE_COLOR = 0x9fe8ff;
const SHOCK_WIDTH = 0.5;

// A shell on its way down: a warning ring now, a blast when it lands.
interface Bomb {
  x: number;
  z: number;
  r: number;
  t: number;
  dmg: number;
  color: number;
}

export class Ground {
  private readonly puddles: Puddle[] = [];
  private readonly warnings: Warning[] = [];
  private readonly bombs: Bomb[] = [];
  private readonly ice: Ice[] = [];
  private readonly shocks: Shock[] = [];
  private hurtFlash = 0;

  constructor(private readonly g: Game) {}

  addPuddle(x: number, z: number, r: number, life: number, flow = false): void {
    if (this.g.room.blocked(x, z, 0.2)) return;
    // a puddle already here (the corroder stood still) just lasts longer and grows to the new size
    const near = this.puddles.find(p => Math.hypot(p.x - x, p.z - z) < Math.max(p.r, r) * 0.6);
    if (near) {
      near.t = Math.max(near.t, life);
      near.r = Math.max(near.r, r);
      near.mesh.scale.setScalar(near.r);
      return;
    }
    if (this.puddles.length >= MAX_PUDDLES) this.remove(this.puddles, 0);
    const mesh = new THREE.Mesh(DISC, additive(ACID_COLOR));
    mesh.position.set(x, 0.04, z);
    mesh.scale.setScalar(r);
    this.g.gfx.scene.add(mesh);
    this.puddles.push({ x, z, r, t: life, age: 0, mesh, flow });
  }

  // A ring that fills in over `time`, marking where an attack will land.
  warn(x: number, z: number, r: number, time: number, color = 0xff3355): void {
    const mesh = new THREE.Mesh(GEO.ring, additive(color));
    const fill = new THREE.Mesh(DISC, additive(color));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.06, z);
    mesh.scale.setScalar(r / 0.95);
    fill.position.set(x, 0.05, z);
    this.g.gfx.scene.add(mesh, fill);
    this.warnings.push({ x, z, r, t: time, max: time, mesh, fill });
  }

  // Ice spikes (variant condensers): a few small spots inside the sheet that stab up after a beat.
  spikes(x: number, z: number, r: number, dmg: number): void {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.random() * r * 0.8;
      this.bomb(x + Math.sin(a) * d, z + Math.cos(a) * d, 0.6, 1, dmg, ICE_COLOR);
    }
  }

  // Lobbed shell: ring for `delay` seconds, then a blast that hurts the player (and only the player).
  bomb(x: number, z: number, r: number, delay: number, dmg: number, color = 0xff6a3d): void {
    this.warn(x, z, r, delay, color);
    this.bombs.push({ x, z, r, t: delay, dmg, color });
  }

  addIce(x: number, z: number, r: number, life: number): void {
    if (this.g.room.blocked(x, z, 0.2)) return;
    const near = this.ice.find(p => Math.hypot(p.x - x, p.z - z) < Math.max(p.r, r) * 0.6);
    if (near) { near.t = Math.max(near.t, life); return; }
    if (this.ice.length >= 30) this.remove(this.ice, 0);
    const mesh = new THREE.Mesh(DISC, additive(ICE_COLOR));
    mesh.position.set(x, 0.035, z);
    mesh.scale.setScalar(r);
    this.g.gfx.scene.add(mesh);
    this.ice.push({ x, z, r, t: life, mesh });
  }

  iceAt(x: number, z: number): boolean {
    return this.ice.some(p => Math.hypot(x - p.x, z - p.z) < p.r);
  }

  // A ring that spreads from (x, z) out to `end` (or, with a negative speed, closes in from `r`).
  shock(x: number, z: number, dmg: number, opts: { speed?: number; r?: number; end?: number; color?: number } = {}): void {
    const mesh = new THREE.Mesh(GEO.ring, additive(opts.color ?? 0x8fd0ff));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    this.g.gfx.scene.add(mesh);
    this.shocks.push({ x, z, r: opts.r ?? 0.5, speed: opts.speed ?? 6, end: opts.end ?? 10, dmg, hit: false, mesh });
  }

  // Flame burns puddles away (and melts ice).
  burnAt(x: number, z: number, r: number): void {
    for (let i = this.ice.length - 1; i >= 0; i--) {
      const p = this.ice[i];
      if (Math.hypot(p.x - x, p.z - z) < p.r + r) this.remove(this.ice, i);
    }
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      if (Math.hypot(p.x - x, p.z - z) < p.r + r) {
        this.g.fx.burst({ x: p.x, y: 0.3, z: p.z }, 0xffd27a, 3, 3, 0.12, 0.3);
        this.remove(this.puddles, i);
      }
    }
  }

  // Player move speed multiplier (puddles slow the player, never the viruses that made them).
  slowAt(x: number, z: number): number {
    return this.puddles.some(p => Math.hypot(x - p.x, z - p.z) < p.r) ? ACID.slow : 1;
  }

  update(dt: number): void {
    const g = this.g, pl = g.player;
    let inAcid = false;
    for (let i = this.puddles.length - 1; i >= 0; i--) {
      const p = this.puddles[i];
      p.t -= dt;
      p.age += dt;
      if (p.t <= 0) { this.remove(this.puddles, i); continue; }
      const k = Math.min(1, p.t / 0.6, p.age / 0.15);  // quick fade in, slow fade out
      p.mesh.material.opacity = 0.28 * k;
      if (p.flow) {
        const dx = pl.pos.x - p.x, dz = pl.pos.z - p.z, d = Math.hypot(dx, dz) || 1;
        p.x += dx / d * 0.8 * dt;
        p.z += dz / d * 0.8 * dt;
        p.mesh.position.set(p.x, 0.04, p.z);
      }
      if (Math.hypot(pl.pos.x - p.x, pl.pos.z - p.z) < p.r) inAcid = true;
      if (Math.random() < dt * p.r * 2) g.fx.mote({ x: p.x + (Math.random() - 0.5) * p.r, y: 0.15, z: p.z + (Math.random() - 0.5) * p.r }, ACID_COLOR, 0.1, 0.4);
    }
    if (inAcid && g.state === 'play') {
      g.drainPlayer(ACID.dps * dt);
      sfx.sizzle();
      this.hurtFlash -= dt;
      if (this.hurtFlash <= 0) { this.hurtFlash = 0.5; g.hud.hurtFlash(); }
    }
    for (let i = this.ice.length - 1; i >= 0; i--) {
      const p = this.ice[i];
      p.t -= dt;
      if (p.t <= 0) { this.remove(this.ice, i); continue; }
      p.mesh.material.opacity = 0.2 * Math.min(1, p.t / 0.6);
    }
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.r += s.speed * dt;
      if (s.speed > 0 ? s.r >= s.end : s.r <= s.end) { this.remove(this.shocks, i); continue; }
      s.mesh.scale.setScalar(s.r / 0.82);
      s.mesh.material.opacity = 0.8;
      const d = Math.hypot(pl.pos.x - s.x, pl.pos.z - s.z);
      if (!s.hit && Math.abs(d - s.r) < SHOCK_WIDTH + pl.r * 0.5 && pl.invuln <= 0 && g.state === 'play') {
        s.hit = true;
        g.damagePlayer(s.dmg, new THREE.Vector3(s.x, 0, s.z));
      }
    }
    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.bombs.splice(i, 1);
      if (Math.hypot(pl.pos.x - b.x, pl.pos.z - b.z) < b.r + pl.r) g.damagePlayer(b.dmg, new THREE.Vector3(b.x, 0, b.z));
      g.fx.shockwave(b.x, b.z, b.r, b.color);
      g.fx.burst({ x: b.x, y: 0.5, z: b.z }, b.color, 14, b.r * 4, 0.2, 0.4);
      sfx.pop();
    }
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      const w = this.warnings[i];
      w.t -= dt;
      if (w.t <= 0) { this.remove(this.warnings, i); continue; }
      const k = 1 - w.t / w.max;
      w.mesh.material.opacity = 0.5 + Math.sin(k * k * 40) * 0.3;
      w.fill.material.opacity = 0.25 * k;
      w.fill.scale.setScalar(w.r * k);
    }
  }

  clear(): void {
    while (this.puddles.length) this.remove(this.puddles, 0);
    while (this.warnings.length) this.remove(this.warnings, 0);
    while (this.ice.length) this.remove(this.ice, 0);
    while (this.shocks.length) this.remove(this.shocks, 0);
    this.bombs.length = 0;
  }

  private remove(list: (Puddle | Warning | Ice | Shock)[], i: number): void {
    const d = list[i];
    this.g.gfx.scene.remove(d.mesh);
    d.mesh.material.dispose();
    if ('fill' in d) { this.g.gfx.scene.remove(d.fill); d.fill.material.dispose(); }
    list.splice(i, 1);
  }
}
