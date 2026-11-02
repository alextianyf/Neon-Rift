import * as THREE from 'three';
import { sfx } from '../core/audio';
import type { WeaponDef } from '../data/weapons';
import type { Game } from './game';
import { MechModel } from './mech';
import type { ShotStats } from './projectiles';

// Phantom skill "幻影分身": two holograms flank the mech, copy every shot it fires at half damage,
// and draw the enemies' attention (enemies go for the nearest of the mech and its clones).
// A clone breaks after a few hits or when the skill runs out.

export const CLONES = {
  duration: 6,
  side: 2.2,       // distance to the mech's left and right
  dmg: 0.5,        // of the mech's own shot
  hits: 3,         // hits a clone takes before it breaks
  hurtGap: 0.3,    // a clone can't be hit again this soon
  lure: 1.5,       // enemies pick a clone over the mech while it's no more than this many times farther
};

interface Clone {
  model: MechModel;
  pos: THREE.Vector3;
  side: -1 | 1;
  hits: number;
  hurtT: number;
}

const tmp = new THREE.Vector3();

export class Clones {
  private readonly list: Clone[] = [];
  private ghost: THREE.Material | null = null;

  constructor(private readonly g: Game) {}

  get active(): boolean {
    return this.list.length > 0;
  }

  spawn(): void {
    this.clear();
    const p = this.g.player, def = p.mechDef;
    // dim, so the hologram stays under the bloom threshold and reads as a see-through copy
    this.ghost ??= new THREE.MeshBasicMaterial({ color: new THREE.Color(def.palette.accent).multiplyScalar(0.45), transparent: true, opacity: 0.45, depthWrite: false });
    for (const side of [-1, 1] as const) {
      const model = new MechModel(def.palette, def.scale, false, def.id);
      model.root.traverse(o => {
        if (!(o instanceof THREE.Mesh)) return;
        if (o.geometry instanceof THREE.CircleGeometry) o.visible = false;  // a hologram casts no shadow
        else o.material = this.ghost!;
      });
      const pos = this.slot(side, new THREE.Vector3());
      model.root.position.copy(pos);
      this.g.gfx.scene.add(model.root);
      this.list.push({ model, pos, side, hits: 0, hurtT: 0 });
      this.g.fx.burst({ x: pos.x, y: 1, z: pos.z }, def.palette.accent, 14, 5, 0.2, 0.4);
    }
    sfx.deploy();
  }

  update(dt: number): void {
    const p = this.g.player;
    if (!this.list.length) return;
    if (p.skillT <= 0) { this.clear(); return; }
    for (const c of this.list) {
      c.hurtT -= dt;
      this.slot(c.side, tmp);
      c.pos.lerp(tmp, Math.min(1, dt * 10));
      c.model.root.position.copy(c.pos);
      c.model.update(dt, p.vel, p.faceYaw, p.moveSpeed, false);
      c.model.root.visible = c.hurtT <= 0 || Math.sin(c.hurtT * 60) > 0;  // flicker when hit
    }
  }

  // Each clone fires its own copy of the mech's shot, aimed at the same point.
  fire(w: WeaponDef, shot: ShotStats, count: number, spread: number, aim: THREE.Vector3): void {
    const copy: ShotStats = { ...shot, dmg: shot.dmg * CLONES.dmg, child: true };
    for (const c of this.list) {
      const from = tmp.set(c.pos.x, 1.1 * this.g.player.mechDef.scale, c.pos.z);
      const base = Math.atan2(aim.x - from.x, aim.z - from.z);
      for (let i = 0; i < count; i++) {
        const a = base + (count > 1 ? -spread + 2 * spread * i / (count - 1) : 0);
        this.g.projectiles.firePlayer(from, a, w.speed, w, copy);
      }
    }
  }

  // The clone an enemy at (x, z) goes for instead of the mech, if any.
  lure(x: number, z: number, playerDist: number): THREE.Vector3 | null {
    let best: Clone | null = null, bd = playerDist * CLONES.lure;
    for (const c of this.list) {
      const d = Math.hypot(c.pos.x - x, c.pos.z - z);
      if (d < bd) { bd = d; best = c; }
    }
    return best?.pos ?? null;
  }

  // An enemy body or shot at (x, z) within reach r of a clone hits it. Returns true if one was hit.
  hitAt(x: number, z: number, r: number): boolean {
    for (const c of this.list) {
      if (Math.hypot(c.pos.x - x, c.pos.z - z) > r + 0.7) continue;
      if (c.hurtT > 0) return true;
      c.hurtT = CLONES.hurtGap;
      if (++c.hits >= CLONES.hits) this.remove(c);
      return true;
    }
    return false;
  }

  clear(): void {
    for (const c of [...this.list]) this.remove(c, false);
  }

  private remove(c: Clone, burst = true): void {
    if (burst) {
      this.g.fx.burst({ x: c.pos.x, y: 1, z: c.pos.z }, this.g.player.mechDef.palette.accent, 20, 7, 0.22, 0.5);
      sfx.shieldBlock();
    }
    this.g.gfx.scene.remove(c.model.root);
    this.list.splice(this.list.indexOf(c), 1);
  }

  private slot(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 {
    const p = this.g.player;
    return out.set(p.pos.x + p.aim.z * side * CLONES.side, 0, p.pos.z - p.aim.x * side * CLONES.side);
  }
}
