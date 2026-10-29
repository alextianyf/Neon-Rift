import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { rand } from '../core/math';

export interface PointLike {
  x: number;
  y?: number;
  z: number;
}

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  grow?: number;  // set for shockwave rings, which own their material
}

const MAX_PARTICLES = 600;

// Particles, screen shake and hitstop: the "juice" that makes hits feel good.
export class Effects {
  shakeAmt = 0;
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
      this.particles.push({ mesh: m, vel: new THREE.Vector3(Math.sin(a) * s, rand(1, 5), Math.cos(a) * s), life, max: life, size: sz });
    }
  }

  shockwave(x: number, z: number, radius: number, color: number): void {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(GEO.ring, mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    this.scene.add(ring);
    this.particles.push({ mesh: ring, vel: new THREE.Vector3(), life: 0.3, max: 0.3, size: 0, grow: radius });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(1.3, this.shakeAmt + amount);
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
      if (p.grow) {
        p.mesh.scale.setScalar(p.grow * (1 - k) + 0.3);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = k;
        continue;
      }
      p.vel.y -= 16 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < 0.05) {
        p.mesh.position.y = 0.05;
        p.vel.y *= -0.4;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      p.mesh.scale.setScalar(p.size * k);
      p.mesh.rotation.x += dt * 8;
    }
  }

  clear(): void {
    for (const p of this.particles) this.remove(p);
    this.particles.length = 0;
  }

  private remove(p: Particle): void {
    this.scene.remove(p.mesh);
    if (p.grow) (p.mesh.material as THREE.Material).dispose();
  }
}
