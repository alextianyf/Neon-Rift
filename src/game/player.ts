import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import { WEAPONS } from '../data/weapons';
import type { Game } from './game';

const P = BALANCE.player;
const raycaster = new THREE.Raycaster();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.75);  // y = 0.75, roughly gun height
const aimPoint = new THREE.Vector3();
const moveDir = new THREE.Vector3();

export class Player {
  readonly mesh = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly aim = new THREE.Vector3(0, 0, -1);
  readonly dashDir = new THREE.Vector3(0, 0, -1);
  readonly r = P.radius;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;

  hp = P.hp;
  maxHp = P.hp;
  speed = P.speed;
  dashCd = 0;
  dashT = 0;
  invuln = 0;
  weapon = 0;
  fireCd = 0;
  buffs: string[] = [];
  // stat multipliers changed by upgrades
  dmgMul = 1;
  rateMul = 1;
  dashCdMul = 1;
  blastMul = 1;
  extraShots = 0;
  pierce = 0;
  leech = 0;

  constructor(scene: THREE.Scene) {
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 0.5, 4, 10),
      new THREE.MeshStandardMaterial({ color: 0x0a2a33, emissive: 0x33e0ff, emissiveIntensity: 1.3, roughness: 0.3 }),
    );
    body.position.y = 0.75;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 1.0), glowMat(0xffffff, 1.6));
    gun.position.set(0.32, 0.8, 0.55);
    this.ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({
      color: new THREE.Color(0x4ff0ff).multiplyScalar(1.5), side: THREE.DoubleSide, transparent: true, opacity: 0.6,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.mesh.add(body, gun, this.ring);
    scene.add(this.mesh);
  }

  reset(): void {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.aim.set(0, 0, -1);
    this.dashDir.set(0, 0, -1);
    this.hp = this.maxHp = P.hp;
    this.speed = P.speed;
    this.dashCd = this.dashT = this.invuln = this.fireCd = 0;
    this.weapon = 0;
    this.buffs = [];
    this.dmgMul = this.rateMul = this.dashCdMul = this.blastMul = 1;
    this.extraShots = this.pierce = this.leech = 0;
    this.mesh.visible = true;
  }

  get dashCooldown(): number {
    return P.dashCooldown * this.dashCdMul;
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  // Returns true if the weapon actually changed.
  setWeapon(i: number): boolean {
    if (i === this.weapon) return false;
    this.weapon = i;
    sfx.weaponSwitch(i);
    return true;
  }

  tryDash(dir: THREE.Vector3): void {
    if (this.dashCd > 0 || this.dashT > 0) return;
    this.dashDir.copy(dir.lengthSq() > 0 ? dir : this.aim);
    this.dashT = P.dashDuration;
    this.invuln = Math.max(this.invuln, P.dashInvuln);
    this.dashCd = this.dashCooldown;
    sfx.dash();
  }

  update(dt: number, g: Game): void {
    raycaster.setFromCamera(g.input.mouseNDC, g.gfx.camera);
    if (raycaster.ray.intersectPlane(aimPlane, aimPoint)) {
      const dx = aimPoint.x - this.pos.x, dz = aimPoint.z - this.pos.z, l = Math.hypot(dx, dz);
      if (l > 0.3) this.aim.set(dx / l, 0, dz / l);
    }
    this.dashCd -= dt;
    this.invuln -= dt;
    this.fireCd -= dt;

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.pos.addScaledVector(this.dashDir, P.dashSpeed * dt);
      if (Math.random() < 0.8) g.fx.burst({ x: this.pos.x, y: 0.7, z: this.pos.z }, 0x4ff0ff, 1, 1, 0.25, 0.3);
      this.vel.copy(this.dashDir).multiplyScalar(this.speed);
    } else {
      const dir = g.input.moveDir(moveDir);
      const k = 1 - Math.exp(-14 * dt);
      this.vel.x += (dir.x * this.speed - this.vel.x) * k;
      this.vel.z += (dir.z * this.speed - this.vel.z) * k;
      this.pos.addScaledVector(this.vel, dt);
    }
    g.room.collide(this.pos, this.r);
    if (g.input.mouseDown && this.fireCd <= 0) this.fire(g);

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.y = Math.atan2(this.aim.x, this.aim.z);
    // blink while invulnerable after taking a hit
    this.mesh.visible = !(this.invuln > 0 && this.dashT <= 0 && Math.floor(g.time * 20) % 2 === 0);
    this.ring.material.opacity = this.dashCd <= 0 ? 0.7 : 0.15;
    g.gfx.playerLight.position.set(this.pos.x, 2.5, this.pos.z);
  }

  private fire(g: Game): void {
    const w = WEAPONS[this.weapon];
    this.fireCd = w.rate / this.rateMul;
    const count = w.count + this.extraShots * (w.count > 1 ? 2 : 1);
    const spread = count > 1 ? Math.max(w.spread, 0.07 * (count - 1)) : 0;
    const base = Math.atan2(this.aim.x, this.aim.z);
    const muzzle = new THREE.Vector3(this.pos.x + this.aim.x * 0.9, 0.8, this.pos.z + this.aim.z * 0.9);
    const stats = { dmg: w.dmg * this.dmgMul, pierce: this.pierce, blast: w.blast ? w.blast * this.blastMul : 0 };
    for (let i = 0; i < count; i++) {
      const a = base + (count > 1 ? -spread + 2 * spread * i / (count - 1) : 0) + rand(-1, 1) * w.spread * 0.3;
      const speed = w.speed * (w.count > 1 ? rand(0.85, 1.1) : 1);
      g.projectiles.firePlayer(muzzle, a, speed, w, stats);
    }
    this.vel.addScaledVector(this.aim, -w.recoil);
    g.fx.shake(w.shake);
    g.gfx.flash(muzzle.x, muzzle.y, muzzle.z, w.color, 25);
    sfx.shoot[w.sfx]();
  }
}
