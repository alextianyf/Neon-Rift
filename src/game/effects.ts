import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { rand } from '../core/math';

export interface PointLike {
  x: number;
  y?: number;
  z: number;
}

type ParticleKind = 'bit' | 'ring' | 'line' | 'derez';

interface Particle {
  kind: ParticleKind;
  obj: THREE.Mesh | THREE.Line;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;   // bits: start scale; rings: final radius
  base?: THREE.Vector3;  // derez: starting scale
}

const MAX_PARTICLES = 700;

// Particles, lightning, screen shake and hitstop: the "juice" that makes hits feel good.
export class Effects {
  shakeAmt = 0;
  shakeScale = 1;  // 0 disables screen shake (settings)
  private hitstopT = 0;
  private readonly particles: Particle[] = [];

  constructor(private readonly scene: THREE.Scene) {}

  burst(pos: PointLike, hex: number, n: number, speed = 8, size = 0.18, life = 0.5, dir?: THREE.Vector3): void {
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const m = new THREE.Mesh(GEO.particle, glowMat(hex));
      m.position.set(pos.x, Math.max(pos.y ?? 0.6, 0.4), pos.z);
      const a = dir ? Math.atan2(dir.x, dir.z) + rand(-0.6, 0.6) : Math.random() * Math.PI * 2;
      const s = rand(0.3, 1) * speed;
      const sz = size * rand(0.6, 1.3);
      m.scale.setScalar(sz);
      this.scene.add(m);
      this.particles.push({ kind: 'bit', obj: m, vel: new THREE.Vector3(Math.sin(a) * s, rand(1, 5), Math.cos(a) * s), life, max: life, size: sz });
    }
  }

  shockwave(x: number, z: number, radius: number, color: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(GEO.ring, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    this.scene.add(ring);
    this.particles.push({ kind: 'ring', obj: ring, vel: new THREE.Vector3(), life: 0.3, max: 0.3, size: radius });
  }

  // Jagged bolt between two points, used by chain lightning.
  lightning(a: PointLike, b: PointLike, color: number): void {
    const pts: THREE.Vector3[] = [];
    const segs = 7, ay = a.y ?? 0.8, by = b.y ?? 0.8;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len;  // perpendicular on the ground plane
    for (let i = 0; i <= segs; i++) {
      const t = i / segs, off = i === 0 || i === segs ? 0 : rand(-0.45, 0.45);
      pts.push(new THREE.Vector3(a.x + dx * t + nx * off, ay + (by - ay) * t + rand(-0.2, 0.2), a.z + dz * t + nz * off));
    }
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    this.scene.add(line);
    this.particles.push({ kind: 'line', obj: line, vel: new THREE.Vector3(), life: 0.16, max: 0.16, size: 0 });
  }

  // Death "data dissolve": a copy of the enemy's wireframe shell flattens and widens as it fades.
  derez(shell: THREE.LineSegments, color: number): void {
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true });
    const ghost = new THREE.LineSegments(shell.geometry, mat);
    shell.getWorldPosition(ghost.position);
    shell.getWorldQuaternion(ghost.quaternion);
    shell.getWorldScale(ghost.scale);
    this.scene.add(ghost);
    this.particles.push({ kind: 'derez', obj: ghost, vel: new THREE.Vector3(), life: 0.28, max: 0.28, size: 0, base: ghost.scale.clone() });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.3, this.shakeAmt + amount * this.shakeScale);
  }

  hitstop(seconds: number): void {
    this.hitstopT = Math.max(this.hitstopT, seconds);
  }

  // Returns the dt the simulation should advance by: 0 while a hitstop freeze is active.
  consumeHitstop(dt: number): number {
    if (this.hitstopT <= 0) return dt;
    this.hitstopT -= dt;
    return 0;
  }

  decayShake(dt: number): void {
    this.shakeAmt *= Math.exp(-9 * Math.max(dt, 1 / 120));
  }

  update(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.remove(p);
        this.particles.splice(i, 1);
        continue;
      }
      const k = p.life / p.max;
      if (p.kind === 'ring') {
        p.obj.scale.setScalar(p.size * (1 - k) + 0.3);
        (p.obj.material as THREE.MeshBasicMaterial).opacity = k;
      } else if (p.kind === 'line') {
        (p.obj.material as THREE.LineBasicMaterial).opacity = k;
      } else if (p.kind === 'derez' && p.base) {
        const spread = 1 + (1 - k) * 0.9;
        p.obj.scale.set(p.base.x * spread, p.base.y * Math.max(0.05, k * k), p.base.z * spread);
        (p.obj.material as THREE.LineBasicMaterial).opacity = k;
      } else {
        const o = p.obj;
        p.vel.y -= 16 * dt;
        o.position.addScaledVector(p.vel, dt);
        if (o.position.y < 0.05) {
          o.position.y = 0.05;
          p.vel.y *= -0.4;
          p.vel.x *= 0.7;
          p.vel.z *= 0.7;
        }
        o.scale.setScalar(p.size * k);
        o.rotation.x += dt * 8;
      }
    }
  }

  clear(): void {
    for (const p of this.particles) this.remove(p);
    this.particles.length = 0;
  }

  private remove(p: Particle): void {
    this.scene.remove(p.obj);
    // derez ghosts share the enemy's geometry, so only their material is theirs
    if (p.kind === 'ring' || p.kind === 'derez') (p.obj.material as THREE.Material).dispose();
    if (p.kind === 'line') {
      p.obj.geometry.dispose();
      (p.obj.material as THREE.Material).dispose();
    }
  }
}
