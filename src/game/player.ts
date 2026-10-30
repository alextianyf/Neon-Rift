import * as THREE from 'three';
import { GEO } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import type { UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_SLOTS, STARTING_WEAPON, WEAPONS, weaponLevelMul, type WeaponDef, type WeaponId } from '../data/weapons';
import type { Game } from './game';
import { MechModel } from './mech';

const P = BALANCE.player;
const raycaster = new THREE.Raycaster();
// The cursor is projected onto a plane at cannon height (y = 1.45), where bullets fly.
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.45);
const aimPoint = new THREE.Vector3();
const moveDir = new THREE.Vector3();
// Height the eye treats as the mech's center on screen, and where its cannons point from.
const VISUAL_CENTER_Y = 1.0;
const CANNON_Y = 1.45;
const CANNON_REACH = 1.9;
const anchorNdc = new THREE.Vector3();
const probeNdc = new THREE.Vector3();
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export interface WeaponSlot {
  id: WeaponId;
  level: number;
}

export type WeaponGain =
  | { kind: 'added' }
  | { kind: 'levelup'; level: number }
  | { kind: 'swapped'; dropped: WeaponSlot };

export class Player {
  readonly mesh = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly aim = new THREE.Vector3(0, 0, -1);
  readonly dashDir = new THREE.Vector3(0, 0, -1);
  readonly r = P.radius;
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly shieldBubble: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private readonly mech = new MechModel();
  private nextArm: 0 | 1 = 0;
  private faceYaw = 0;  // body yaw as drawn; see screenFacing()

  hp = P.hp;
  maxHp = P.hp;
  speed = P.speed;
  dashCd = 0;
  dashT = 0;
  invuln = 0;
  fireCd = 0;
  coins = 0;
  slots: WeaponSlot[] = [];
  weapon = 0;  // index into slots
  buffs: string[] = [];
  private readonly upgrades = new Map<string, number>();

  // stats changed by upgrades
  dmgMul = 1;
  rateMul = 1;
  dashCdMul = 1;
  blastMul = 1;
  blastDmgMul = 1;
  extraShots = 0;
  pierce = 0;
  bounce = 0;
  leech = 0;
  critChance = P.critChance;
  critMul = P.critMul;
  burnChance = 0;
  frostChance = 0;
  shockChance = 0;
  elementMul = 1;
  coinMul = 1;
  magnetMul = 1;
  shieldMax = 0;
  shield = 0;
  homing = false;
  dashBlast = false;
  frenzy = false;

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({
      color: 0x4ff0ff, side: THREE.DoubleSide, transparent: true, opacity: 0.6,
    }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.03;
    this.shieldBubble = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({
      color: 0x66ccff, transparent: true, opacity: 0.18, depthWrite: false,
    }));
    this.shieldBubble.position.y = 1.2;
    this.shieldBubble.scale.setScalar(1.6);
    this.mesh.add(this.mech.root, this.ring, this.shieldBubble);
    scene.add(this.mesh);
    this.reset();
  }

  reset(): void {
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.aim.set(0, 0, -1);
    this.dashDir.set(0, 0, -1);
    this.hp = this.maxHp = P.hp;
    this.speed = P.speed;
    this.dashCd = this.dashT = this.invuln = this.fireCd = 0;
    this.coins = 0;
    this.slots = [{ id: STARTING_WEAPON, level: 1 }];
    this.weapon = 0;
    this.buffs = [];
    this.upgrades.clear();
    this.dmgMul = this.rateMul = this.dashCdMul = this.blastMul = this.blastDmgMul = 1;
    this.extraShots = this.pierce = this.bounce = this.leech = 0;
    this.critChance = P.critChance;
    this.critMul = P.critMul;
    this.burnChance = this.frostChance = this.shockChance = 0;
    this.elementMul = this.coinMul = this.magnetMul = 1;
    this.shieldMax = this.shield = 0;
    this.homing = this.dashBlast = this.frenzy = false;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);  // the title screen spins the model; facing is handled by the mech itself
    this.updateGunColor();
  }

  get dashCooldown(): number {
    return P.dashCooldown * this.dashCdMul;
  }

  get activeSlot(): WeaponSlot {
    return this.slots[this.weapon];
  }

  get weaponDef(): WeaponDef {
    return WEAPONS[this.activeSlot.id];
  }

  get fireRateMul(): number {
    return this.rateMul * (this.frenzy && this.hp < this.maxHp * 0.5 ? 1.5 : 1);
  }

  // 0..1, how far the current weapon's cooldown has recovered
  get reload(): number {
    const full = this.weaponDef.rate / this.fireRateMul;
    return 1 - Math.max(0, this.fireCd) / full;
  }

  upgradeCount(id: string): number {
    return this.upgrades.get(id) ?? 0;
  }

  get upgradeCounts(): ReadonlyMap<string, number> {
    return this.upgrades;
  }

  addUpgrade(u: UpgradeDef): void {
    u.apply(this);
    this.upgrades.set(u.id, this.upgradeCount(u.id) + 1);
    this.buffs.push(u.name);
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  owns(id: WeaponId): boolean {
    return this.slots.some(s => s.id === id);
  }

  // Owned weapon -> level up; free slot -> add; otherwise replace the active weapon.
  addWeapon(id: WeaponId): WeaponGain {
    const owned = this.slots.find(s => s.id === id);
    if (owned) {
      owned.level++;
      return { kind: 'levelup', level: owned.level };
    }
    if (this.slots.length < MAX_WEAPON_SLOTS) {
      this.slots.push({ id, level: 1 });
      this.weapon = this.slots.length - 1;
      this.updateGunColor();
      return { kind: 'added' };
    }
    const dropped = this.slots[this.weapon];
    this.slots[this.weapon] = { id, level: 1 };
    this.updateGunColor();
    return { kind: 'swapped', dropped };
  }

  // Returns true if the weapon actually changed.
  setWeapon(i: number): boolean {
    if (i === this.weapon || i < 0 || i >= this.slots.length) return false;
    this.weapon = i;
    this.updateGunColor();
    sfx.weaponSwitch(i);
    return true;
  }

  tryDash(dir: THREE.Vector3, g: Game): void {
    if (this.dashCd > 0 || this.dashT > 0) return;
    this.dashDir.copy(dir.lengthSq() > 0 ? dir : this.aim);
    this.dashT = P.dashDuration;
    this.invuln = Math.max(this.invuln, P.dashInvuln);
    this.dashCd = this.dashCooldown;
    sfx.dash();
    if (this.dashBlast) g.projectiles.explode(this.pos, P.dashBlastRadius * this.blastMul, P.dashBlastDmg * this.dmgMul * this.blastDmgMul, 0x4ff0ff);
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
    this.faceYaw = this.screenFacing(g);
    this.mech.update(dt, this.vel, this.faceYaw, this.speed, this.dashT > 0);
    // blink while invulnerable after taking a hit
    this.mesh.visible = !(this.invuln > 0 && this.dashT <= 0 && Math.floor(g.time * 20) % 2 === 0);
    this.ring.material.opacity = this.dashCd <= 0 ? 0.45 : 0.1;
    this.shieldBubble.visible = this.shield > 0;
    this.shieldBubble.material.opacity = 0.14 + Math.sin(g.time * 4) * 0.05;
    g.gfx.playerLight.position.set(this.pos.x, 3.5, this.pos.z + 1);
  }

  private fire(g: Game): void {
    const w = this.weaponDef;
    this.fireCd = w.rate / this.fireRateMul;
    const count = w.count + this.extraShots * (w.count > 1 ? 2 : 1);
    const spread = count > 1 ? Math.max(w.spread, 0.07 * (count - 1)) : 0;
    const jitter = w.jitter ?? w.spread * 0.3;
    // alternate between the two arm cannons
    const arm = this.nextArm;
    this.nextArm = arm === 0 ? 1 : 0;
    const yaw = this.faceYaw;
    const muzzle = this.mech.muzzle(arm, this.pos, yaw, new THREE.Vector3());
    // aim from the muzzle at the cursor so shots land on the crosshair; if the cursor
    // is on top of the mech, just fire straight ahead
    const dx = aimPoint.x - muzzle.x, dz = aimPoint.z - muzzle.z;
    const base = dx * this.aim.x + dz * this.aim.z > 0.5 ? Math.atan2(dx, dz) : yaw;
    const shot = {
      dmg: w.dmg * this.dmgMul * weaponLevelMul(this.activeSlot.level),
      pierce: (w.pierce ?? 0) + this.pierce,
      bounce: (w.bounce ?? 0) + this.bounce,
      blast: w.blast ? w.blast * this.blastMul : 0,
      homing: this.homing,
    };
    for (let i = 0; i < count; i++) {
      const a = base + (count > 1 ? -spread + 2 * spread * i / (count - 1) : 0) + rand(-1, 1) * jitter;
      const speed = w.speed * (w.count > 1 ? rand(0.85, 1.1) : 1);
      g.projectiles.firePlayer(muzzle, a, speed, w, shot);
    }
    this.vel.addScaledVector(this.aim, -w.recoil);
    g.fx.shake(w.shake);
    this.mech.kick(arm);
    // light the area ahead of the barrel, not the mech's own armor
    g.gfx.flash(muzzle.x + this.aim.x, muzzle.y, muzzle.z + this.aim.z, w.color, w.flash ?? 12);
    sfx.shoot[w.id]();
  }

  // The camera is tilted, so a world-space yaw toward the cursor looks rotated on screen
  // (tall parts drift relative to the feet). Instead, solve for the yaw whose cannons,
  // seen from the mech's visual center, point at the cursor on screen.
  private screenFacing(g: Game): number {
    const cam = g.gfx.camera, mouse = g.input.mouseNDC;
    let yaw = Math.atan2(this.aim.x, this.aim.z);
    anchorNdc.set(this.pos.x, VISUAL_CENTER_Y, this.pos.z).project(cam);
    const dx = (mouse.x - anchorNdc.x) * cam.aspect, dy = mouse.y - anchorNdc.y;
    if (Math.hypot(dx, dy) < 0.04) return yaw;  // cursor sits on the mech: keep the world aim
    const want = Math.atan2(dx, dy);
    for (let i = 0; i < 4; i++) {
      probeNdc.set(this.pos.x + Math.sin(yaw) * CANNON_REACH, CANNON_Y, this.pos.z + Math.cos(yaw) * CANNON_REACH).project(cam);
      const got = Math.atan2((probeNdc.x - anchorNdc.x) * cam.aspect, probeNdc.y - anchorNdc.y);
      // screen angle runs opposite to world yaw for this camera, hence the subtraction
      yaw -= wrapAngle(want - got);
    }
    return yaw;
  }

  private updateGunColor(): void {
    this.mech.setWeaponColor(this.weaponDef.color);
  }
}
