import * as THREE from 'three';
import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import type { Enemy } from './enemies';
import type { Game } from './game';

// Singularity's "轨道湮灭", the show. Damage and timing live in player.ts; this is only what you see.
// Charge (the warn second): a banner, a reticle and a red targeting laser on every locked enemy,
// energy gathering into the shoulder cannon. Fire: a beam from the cannon into the sky, pillars of
// light slamming down on the targets with ground blasts and scorch rings, a white flash.

const GOLD = 0xffd27a, CORE = 0xfff4dc, LASER = 0xff3355;
const SKY = 34;              // how high the pillars reach
const PILLAR_LIFE = 0.55;
const SCORCH_LIFE = 1.8;

function additive(color: number, k = 1, opacity = 1): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
}

interface Lock { e: Enemy; reticle: THREE.Group; laser: THREE.Mesh; mats: THREE.MeshBasicMaterial[] }
interface Burn { obj: THREE.Object3D; mats: THREE.MeshBasicMaterial[]; t: number; life: number; kind: 'pillar' | 'scorch' | 'up' }

export class OrbitalFx {
  private locks: Lock[] = [];
  private readonly burns: Burn[] = [];
  private charge: { orb: THREE.Mesh; mat: THREE.MeshBasicMaterial; sparks: THREE.Mesh[] } | null = null;
  private chargeT = 0;
  private readonly banner: HTMLElement;
  private readonly flash: HTMLElement;

  constructor(private readonly g: Game) {
    this.banner = document.createElement('div');
    this.banner.id = 'orbitalBanner';
    this.flash = document.createElement('div');
    this.flash.id = 'orbitalFlash';
    document.body.append(this.banner, this.flash);
  }

  // Charge: reticles and lasers on the targets, the banner; update() gathers energy at the cannon.
  lock(targets: Enemy[]): void {
    this.clearLocks();
    const scene = this.g.gfx.scene;
    for (const e of targets) {
      const mats = [additive(GOLD, 0.85, 0.85), additive(GOLD, 0.7, 0.6), additive(LASER, 1.0, 0.45)];
      const reticle = new THREE.Group();
      const outer = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), mats[0]);
      const inner = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.46, 32), mats[1]);
      reticle.add(outer, inner);
      for (let i = 0; i < 4; i++) {
        const tick = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.38), mats[0]);
        const a = (i / 4) * Math.PI * 2;
        tick.position.set(Math.sin(a) * 0.72, Math.cos(a) * 0.72, 0);
        tick.rotation.z = -a;
        reticle.add(tick);
      }
      reticle.rotation.x = -Math.PI / 2;
      const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, SKY, 6, 1, true), mats[2]);
      scene.add(reticle, laser);
      this.locks.push({ e, reticle, laser, mats });
    }
    // gathering energy at the cannon's muzzle
    const mat = additive(GOLD, 2, 0.95);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), mat);
    orb.scale.setScalar(0.01);
    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 10; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), mat);
      sparks.push(s);
      scene.add(s);
    }
    scene.add(orb);
    this.charge = { orb, mat, sparks };
    this.chargeT = 0;
    this.banner.innerHTML = `<b>ORBITAL STRIKE</b><span>${t('轨道湮灭 · 锁定 {n} 个目标', { n: targets.length })}</span>`;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth;  // restart the animation
    this.banner.classList.add('on');
    sfx.riftOpen(true);
  }

  // Fire: the beam up from `tip`, pillars down on `hits`.
  fire(tip: THREE.Vector3 | null, hits: THREE.Vector3[]): void {
    const scene = this.g.gfx.scene, fx = this.g.fx;
    this.clearLocks();
    this.clearCharge();
    if (tip) {
      const mats = [additive(CORE, 1.6), additive(GOLD, 0.9, 0.6)];
      const up = new THREE.Group();
      up.position.set(tip.x, tip.y + SKY / 2, tip.z);
      up.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, SKY, 12, 1, true), mats[0]), new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, SKY, 16, 1, true), mats[1]));
      scene.add(up);
      this.burns.push({ obj: up, mats, t: 0, life: 0.45, kind: 'up' });
      fx.burst(tip, GOLD, 26, 7, 0.16, 0.5);
    }
    for (const p of hits) {
      const mats = [additive(CORE, 1.15), additive(GOLD, 0.55, 0.5), additive(0x4ff0ff, 0.35, 0.22)];
      const pillar = new THREE.Group();
      pillar.position.set(p.x, SKY / 2, p.z);
      pillar.add(
        new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, SKY, 12, 1, true), mats[0]),
        new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, SKY, 16, 1, true), mats[1]),
        new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, SKY, 20, 1, true), mats[2]),
      );
      scene.add(pillar);
      this.burns.push({ obj: pillar, mats, t: 0, life: PILLAR_LIFE, kind: 'pillar' });
      // ground blast: rings, debris, a glowing scorch that fades
      fx.shockwave(p.x, p.z, 4.5, GOLD);
      fx.shockwave(p.x, p.z, 2.6, 0x4ff0ff);
      fx.burst({ x: p.x, y: 0.6, z: p.z }, GOLD, 34, 11, 0.2, 0.8);
      fx.burst({ x: p.x, y: 0.4, z: p.z }, 0xffffff, 12, 6, 0.12, 0.4);
      const smats = [additive(0xff8a3d, 1.3, 0.8), additive(GOLD, 1.2, 0.6)];
      const scorch = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.5, 40), smats[0]);
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.85, 32), smats[1]);
      ring.rotation.x = disc.rotation.x = -Math.PI / 2;
      scorch.add(ring, disc);
      scorch.position.set(p.x, 0.04, p.z);
      scene.add(scorch);
      this.burns.push({ obj: scorch, mats: smats, t: 0, life: SCORCH_LIFE, kind: 'scorch' });
    }
    const c = hits[0] ?? tip;
    if (c) this.g.gfx.flash(c.x, 6, c.z, GOLD, 60);
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
    sfx.boom();
    setTimeout(() => sfx.boom(), 90);
  }

  update(dt: number, tip: THREE.Vector3 | null): void {
    // reticles shrink onto the targets and spin; lasers flicker
    this.chargeT += dt;
    const k = Math.min(1, this.chargeT);
    for (const l of this.locks) {
      const s = (1.7 - 0.7 * k) * (l.e.r + 0.4);  // closes in onto the target
      l.reticle.position.set(l.e.pos.x, 0.06, l.e.pos.z);
      l.reticle.scale.setScalar(s);
      l.reticle.rotation.z += dt * (2 + k * 6);
      l.laser.position.set(l.e.pos.x, SKY / 2, l.e.pos.z);
      l.mats[2].opacity = 0.25 + Math.random() * 0.3;
      l.reticle.visible = l.e.hp > 0;
      l.laser.visible = l.e.hp > 0;
    }
    if (this.charge && tip) {
      this.charge.orb.position.copy(tip);
      this.charge.orb.scale.setScalar(0.05 + 0.3 * k + Math.sin(this.chargeT * 40) * 0.03);
      this.charge.sparks.forEach((s, i) => {
        // sparks spiral in toward the muzzle
        const a = this.chargeT * 7 + (i / this.charge!.sparks.length) * Math.PI * 2, r = 1.4 * (1 - ((this.chargeT * 2 + i * 0.1) % 1));
        s.position.set(tip.x + Math.cos(a) * r, tip.y + Math.sin(a * 1.3) * r * 0.5, tip.z + Math.sin(a) * r);
      });
    }
    for (let i = this.burns.length - 1; i >= 0; i--) {
      const b = this.burns[i];
      b.t += dt;
      const f = b.t / b.life;
      if (f >= 1) {
        this.g.gfx.scene.remove(b.obj);
        for (const m of b.mats) m.dispose();
        this.burns.splice(i, 1);
        continue;
      }
      if (b.kind === 'pillar') {
        // slams down from the sky in the first instant, then thins out
        const drop = Math.min(1, b.t / 0.08);
        const w = f < 0.15 ? 1 + (0.15 - f) * 3 : 1 - (f - 0.15) / 0.85;
        b.obj.scale.set(w, drop, w);
        b.obj.position.y = SKY - (SKY / 2) * drop;
        b.mats.forEach((m, j) => { m.opacity = (j === 0 ? 1 : j === 1 ? 0.5 : 0.22) * (1 - f * f); });
      } else if (b.kind === 'up') {
        const w = 1.4 - f;
        b.obj.scale.set(w, 1, w);
        for (const m of b.mats) m.opacity = 1 - f;
      } else {
        b.obj.scale.setScalar(1 + f * 0.4);
        b.mats.forEach((m, j) => { m.opacity = (j === 0 ? 0.8 : 0.6) * (1 - f); });
      }
    }
  }

  clear(): void {
    this.clearLocks();
    this.clearCharge();
    for (const b of this.burns) { this.g.gfx.scene.remove(b.obj); for (const m of b.mats) m.dispose(); }
    this.burns.length = 0;
    this.banner.classList.remove('on');
  }

  private clearLocks(): void {
    for (const l of this.locks) {
      this.g.gfx.scene.remove(l.reticle, l.laser);
      for (const m of l.mats) m.dispose();
    }
    this.locks = [];
  }

  private clearCharge(): void {
    if (!this.charge) return;
    this.g.gfx.scene.remove(this.charge.orb, ...this.charge.sparks);
    this.charge.mat.dispose();
    this.charge = null;
  }
}
