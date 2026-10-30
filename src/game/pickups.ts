import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import type { Game } from './game';
import { MODS } from '../data/depth';

type PickupKind = 'orb' | 'coin';

interface Pickup {
  kind: PickupKind;
  mesh: THREE.Mesh;
  vel: THREE.Vector3;  // initial scatter, decays quickly
  value: number;
  t: number;
}

const COLLECT_RANGE = 0.9;
const COIN_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.06, 12);
const MAX_COIN_ENTITIES = 8;  // larger drops are split into fewer, more valuable coins

// Health orbs and coins dropped by enemies. Both drift towards the player when close.
export class Pickups {
  private readonly items: Pickup[] = [];

  constructor(private readonly g: Game) {}

  spawnOrb(x: number, z: number): void {
    this.add('orb', x, z, BALANCE.orbHeal, new THREE.Mesh(GEO.orb, glowMat(0x55ff99, 2.5)));
  }

  spawnCoins(x: number, z: number, amount: number): void {
    const total = Math.max(1, Math.round(amount * this.g.player.coinMul));
    const n = Math.min(total, MAX_COIN_ENTITIES);
    for (let i = 0; i < n; i++) {
      const value = Math.floor(total / n) + (i < total % n ? 1 : 0);
      const mesh = new THREE.Mesh(COIN_GEO, glowMat(0xffd23f, 2));
      mesh.rotation.x = Math.PI / 2;
      this.add('coin', x, z, value, mesh, 5);
    }
  }

  update(dt: number): void {
    const player = this.g.player;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const p = this.items[i], pos = p.mesh.position;
      p.t += dt;
      p.vel.multiplyScalar(Math.exp(-5 * dt));
      pos.addScaledVector(p.vel, dt);
      this.g.room.collide(pos, 0.2);

      const range = p.kind === 'coin' ? BALANCE.coinMagnet * player.magnetMul : BALANCE.orbMagnet;
      const pull = p.kind === 'coin' ? 7 : 4;
      const dx = player.pos.x - pos.x, dz = player.pos.z - pos.z, d = Math.hypot(dx, dz);
      if (d < range && p.t > 0.25) {
        const s = Math.min(d, (range - d + 1) * pull * dt);
        pos.x += dx / d * s;
        pos.z += dz / d * s;
      }
      pos.y = (p.kind === 'coin' ? 0.45 : 0.6) + Math.sin(p.t * 5) * 0.12;
      if (p.kind === 'coin') p.mesh.rotation.z += dt * 6;
      else p.mesh.rotation.y += dt * 3;

      if (d < COLLECT_RANGE && p.t > 0.25) {
        this.collect(p);
        this.g.gfx.scene.remove(p.mesh);
        this.items.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const p of this.items) this.g.gfx.scene.remove(p.mesh);
    this.items.length = 0;
  }

  private add(kind: PickupKind, x: number, z: number, value: number, mesh: THREE.Mesh, scatter = 0): void {
    mesh.position.set(x, 0.6, z);
    this.g.gfx.scene.add(mesh);
    const a = Math.random() * Math.PI * 2, s = rand(0.3, 1) * scatter;
    this.items.push({ kind, mesh, vel: new THREE.Vector3(Math.sin(a) * s, 0, Math.cos(a) * s), value, t: 0 });
  }

  private collect(p: Pickup): void {
    const g = this.g, player = g.player, pos = p.mesh.position;
    if (p.kind === 'coin') {
      player.coins += p.value;
      sfx.coin();
      g.floaters.damage({ x: player.pos.x, y: 1.6, z: player.pos.z }, p.value, 'coin', player);
    } else {
      const value = Math.round(p.value * MODS.healMul);
      player.heal(value);
      sfx.pickup();
      g.floaters.damage({ x: player.pos.x, y: 1.6, z: player.pos.z }, value, 'heal', this);
      g.fx.burst(pos, 0x55ff99, 8, 4, 0.12, 0.35);
    }
  }
}
