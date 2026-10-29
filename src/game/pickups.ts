import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { BALANCE } from '../data/balance';
import type { Game } from './game';

interface Pickup {
  mesh: THREE.Mesh;
  t: number;
}

const MAGNET_RANGE = 4.5;
const COLLECT_RANGE = 0.9;

// Health orbs dropped by enemies. They drift towards the player when close.
export class Pickups {
  private readonly items: Pickup[] = [];

  constructor(private readonly g: Game) {}

  spawnOrb(x: number, z: number): void {
    const mesh = new THREE.Mesh(GEO.orb, glowMat(0x55ff99, 2.5));
    mesh.position.set(x, 0.6, z);
    this.g.gfx.scene.add(mesh);
    this.items.push({ mesh, t: 0 });
  }

  update(dt: number): void {
    const player = this.g.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i], pos = p.mesh.position;
      p.t += dt;
      const dx = player.pos.x - pos.x, dz = player.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d < MAGNET_RANGE) {
        const s = (MAGNET_RANGE - d) * 4 * dt;
        pos.x += dx / d * s;
        pos.z += dz / d * s;
      }
      pos.y = 0.6 + Math.sin(p.t * 5) * 0.15;
      p.mesh.rotation.y += dt * 3;
      if (d < COLLECT_RANGE) {
        player.heal(BALANCE.orbHeal);
        sfx.pickup();
        this.g.fx.burst(pos, 0x55ff99, 8, 4, 0.12, 0.35);
        this.g.gfx.scene.remove(p.mesh);
        this.items.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const p of this.items) this.g.gfx.scene.remove(p.mesh);
    this.items.length = 0;
  }
}
