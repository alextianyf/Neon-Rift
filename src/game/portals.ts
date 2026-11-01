import * as THREE from 'three';
import { GEO } from '../core/assets';
import type { Game } from './game';

// Paired rift gates (rift walkers, the origin boss, the "rift gate" abyss law). Shots that fly into
// one end come out of the other with the same heading; some sources also carry the player through.

interface Gate {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  t: number;          // life left; Infinity for fixed gates
  carriesPlayer: boolean;
  meshes: THREE.Mesh[];
}

export const GATE_R = 0.9;
const COLOR = 0xd9b8ff;

export class Portals {
  private readonly gates: Gate[] = [];
  private playerCd = 0;

  constructor(private readonly g: Game) {}

  get list(): readonly Gate[] {
    return this.gates;
  }

  open(ax: number, az: number, bx: number, bz: number, life: number, carriesPlayer = false): void {
    const meshes = [ax, bx].map((x, i) => {
      const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: new THREE.Color(COLOR).multiplyScalar(2), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      m.position.set(x, 1.1, i ? bz : az);
      m.scale.set(GATE_R * 1.1, GATE_R * 1.6, 1);
      this.g.gfx.scene.add(m);
      return m;
    });
    this.gates.push({ ax, az, bx, bz, t: life, carriesPlayer, meshes });
  }

  // If `pos` is inside a gate, move it out of the other end along `dir`. Returns true if it did.
  warp(pos: THREE.Vector3, dir: { x: number; z: number }): boolean {
    for (const gt of this.gates) {
      const inA = Math.hypot(pos.x - gt.ax, pos.z - gt.az) < GATE_R, inB = !inA && Math.hypot(pos.x - gt.bx, pos.z - gt.bz) < GATE_R;
      if (!inA && !inB) continue;
      const l = Math.hypot(dir.x, dir.z) || 1, out = GATE_R + 0.15;
      pos.x = (inA ? gt.bx : gt.ax) + dir.x / l * out;
      pos.z = (inA ? gt.bz : gt.az) + dir.z / l * out;
      return true;
    }
    return false;
  }

  update(dt: number): void {
    const g = this.g, p = g.player;
    this.playerCd -= dt;
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const gt = this.gates[i];
      gt.t -= dt;
      if (gt.t <= 0) { this.remove(i); continue; }
      gt.meshes.forEach((m, k) => {
        m.lookAt(g.gfx.camera.position.x, m.position.y, g.gfx.camera.position.z);
        m.rotateZ(g.time * (k ? -2 : 2));
        (m.material as THREE.MeshBasicMaterial).opacity = Math.min(1, gt.t / 0.4) * (0.7 + Math.sin(g.time * 9) * 0.2);
      });
      if (gt.carriesPlayer && this.playerCd <= 0) {
        const v = p.vel.lengthSq() > 0.1 ? p.vel : p.aim;
        if (this.warp(p.pos, v)) { this.playerCd = 0.6; g.fx.burst({ x: p.pos.x, y: 1, z: p.pos.z }, COLOR, 12, 5, 0.15, 0.3); }
      }
    }
  }

  clear(): void {
    while (this.gates.length) this.remove(0);
  }

  private remove(i: number): void {
    for (const m of this.gates[i].meshes) {
      this.g.gfx.scene.remove(m);
      (m.material as THREE.Material).dispose();
    }
    this.gates.splice(i, 1);
  }
}
