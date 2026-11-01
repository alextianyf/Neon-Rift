import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import type { Enemy } from './enemies';
import type { Game } from './game';

// Telegraphed laser beams used by bosses and some enemies: a thin flickering warning line, then
// the beam itself. Beams stop at walls and pillars, can turn while firing, and die with their owner.

export interface LaserOpts {
  angle: number;
  warn: number;       // seconds of warning line
  dur: number;        // seconds of firing
  dmg: number;
  color?: number;
  width?: number;
  len?: number;
  turn?: number;      // rad/s while firing (and while warning, if `trackWarn`)
  owner?: Enemy;      // the beam follows it and ends when it dies
  x?: number;         // fixed origin when there is no owner
  z?: number;
  offset?: number;    // starts this far out from the origin
}

interface Laser extends Required<Omit<LaserOpts, 'owner' | 'x' | 'z'>> {
  owner: Enemy | null;
  x: number;
  z: number;
  t: number;
  firing: boolean;
  reach: number;
  warnMesh: THREE.Mesh;
  beamMesh: THREE.Mesh;
}

const WARN = 0xff3355;

export class Lasers {
  private readonly list: Laser[] = [];

  constructor(private readonly g: Game) {}

  fire(o: LaserOpts): void {
    const scene = this.g.gfx.scene;
    const warnMesh = new THREE.Mesh(GEO.particle, new THREE.MeshBasicMaterial({ color: WARN, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    const beamMesh = new THREE.Mesh(GEO.particle, glowMat(o.color ?? 0xff4dd2, 1.3));
    beamMesh.visible = false;
    scene.add(warnMesh, beamMesh);
    this.list.push({
      angle: o.angle, warn: o.warn, dur: o.dur, dmg: o.dmg, color: o.color ?? 0xff4dd2, width: o.width ?? 0.5,
      len: o.len ?? 18, turn: o.turn ?? 0, offset: o.offset ?? 0,
      owner: o.owner ?? null, x: o.x ?? o.owner?.pos.x ?? 0, z: o.z ?? o.owner?.pos.z ?? 0,
      t: o.warn, firing: false, reach: 0, warnMesh, beamMesh,
    });
  }

  // True while the given enemy has a beam warming up or firing (bosses wait for their beams).
  busy(owner: Enemy): boolean {
    return this.list.some(l => l.owner === owner);
  }

  update(dt: number): void {
    const g = this.g, p = g.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const l = this.list[i];
      if (l.owner) {
        if (l.owner.hp <= 0) { this.remove(i); continue; }
        l.x = l.owner.pos.x;
        l.z = l.owner.pos.z;
      }
      l.t -= dt;
      if (l.firing) l.angle += l.turn * dt;
      if (!l.firing && l.t <= 0) { l.firing = true; l.t = l.dur; sfx.zap(); }
      else if (l.firing && l.t <= 0) { this.remove(i); continue; }
      // the beam stops at the first wall or pillar
      const sx = Math.sin(l.angle), sz = Math.cos(l.angle);
      let reach = l.offset;
      while (reach < l.len && !g.room.shotBlocked(l.x + sx * reach, l.z + sz * reach)) reach += 0.4;
      l.reach = reach;
      const mid = (l.offset + reach) / 2, length = Math.max(0.01, reach - l.offset);
      for (const m of [l.warnMesh, l.beamMesh]) {
        m.position.set(l.x + sx * mid, 0.9, l.z + sz * mid);
        m.rotation.set(0, l.angle, 0);
      }
      l.warnMesh.visible = !l.firing;
      l.beamMesh.visible = l.firing;
      if (!l.firing) {
        l.warnMesh.scale.set(0.08, 0.05, length);
        (l.warnMesh.material as THREE.MeshBasicMaterial).opacity = 0.35 + Math.sin(l.t * 40) * 0.25;
        continue;
      }
      l.beamMesh.scale.set(l.width * (0.85 + Math.random() * 0.3), l.width * 0.6, length);
      const dx = p.pos.x - l.x, dz = p.pos.z - l.z, along = dx * sx + dz * sz, across = Math.abs(dx * sz - dz * sx);
      if (l.dmg > 0 && along > l.offset && along < reach && across < p.r + l.width / 2) g.damagePlayer(l.dmg, null);
    }
  }

  clear(): void {
    while (this.list.length) this.remove(0);
  }

  private remove(i: number): void {
    const l = this.list[i];
    this.g.gfx.scene.remove(l.warnMesh, l.beamMesh);
    (l.warnMesh.material as THREE.Material).dispose();
    this.list.splice(i, 1);
  }
}
