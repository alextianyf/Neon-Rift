import * as THREE from 'three';
import { GEO } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import type { UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_SLOTS, WEAPONS, weaponLevelMul, type WeaponDef, type WeaponId } from '../data/weapons';
import type { Game } from './game';
import { MechModel } from './mech';
import { MECHS, type MechDef, type TalentId } from '../data/meta';
import { t } from '../core/i18n';

const P = BALANCE.player;
const CAP = BALANCE.caps;
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
  mag: number;      // rounds in the magazine
  reserve: number;  // spare rounds; unused for the starting weapon, which never runs dry
  starter?: true;   // the mech's starting weapon: unlimited reserve, can't be dropped
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
  private mech = new MechModel();
  mechDef: MechDef = MECHS.vanguard;
  skillCd = 0;
  skillT = 0;          // remaining time of the active skill effect
  skillDur = 0;        // full length of that effect, for the gauge under the mech
  revives = 0;
  private nextArm: 0 | 1 = 0;
  private faceYaw = 0;  // body yaw as drawn; see screenFacing()

  hp = P.hp;
  maxHp = P.hp;
  speed = P.speed;
  dashCd = 0;
  dashT = 0;
  invuln = 0;
  fireCd = 0;
  reloadT = 0;          // time left on the current reload (0 = not reloading)
  reloadTotal = 0;
  coins = 0;
  slots: WeaponSlot[] = [];
  weapon = 0;  // index into slots
  buffs: string[] = [];
  readonly taken: string[] = [];  // upgrade ids in pick order (for run saves)
  private readonly upgrades = new Map<string, number>();

  // stats changed by upgrades
  dmgMul = 1;
  rateMul = 1;
  reloadMul = 1;       // reload speed
  magMul = 1;          // magazine size
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
  synergyMul = 1;      // thermal shock damage
  synergyRadius = 1;   // thermal shock radius
  chainExtra = 0;      // extra chain-lightning targets
  chainSpread = false; // chains carry burn/frost to their targets
  // playstyle legendaries (see Perks for the ones with their own logic)
  flameTrail = false;  // dashing leaves burning ground
  rocketEvery = 0;     // every Nth shot also fires a rocket (0 = off)
  orbitals = 0;        // blades circling the mech
  killBlast = false;   // kills explode
  dashNova = false;    // dashing fires a ring of shots
  sentinel = false;    // standing still boosts damage and fire rate
  private shotCount = 0;
  private stillT = 0;
  private dryToastT = 0;

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

  // Start a run with the chosen mech and permanent talents.
  reset(mech: MechDef = MECHS.vanguard, talents: Partial<Record<TalentId, number>> = {}): void {
    if (mech !== this.mechDef) this.setMech(mech);
    this.pos.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.aim.set(0, 0, -1);
    this.dashDir.set(0, 0, -1);
    this.dashCd = this.dashT = this.invuln = this.fireCd = this.reloadT = 0;
    this.coins = 0;
    this.reloadMul = this.magMul = 1;
    this.slots = [{ id: mech.starter, level: 1, mag: WEAPONS[mech.starter].mag, reserve: 0, starter: true }];
    this.weapon = 0;
    this.buffs = [];
    this.taken.length = 0;
    this.upgrades.clear();
    this.dmgMul = this.rateMul = this.dashCdMul = this.blastMul = this.blastDmgMul = 1;
    this.extraShots = this.pierce = this.bounce = this.leech = 0;
    this.critChance = P.critChance;
    this.critMul = P.critMul;
    this.burnChance = this.frostChance = this.shockChance = 0;
    this.elementMul = this.coinMul = this.magnetMul = 1;
    this.shieldMax = this.shield = 0;
    this.homing = this.dashBlast = this.frenzy = this.chainSpread = false;
    this.flameTrail = this.killBlast = this.dashNova = this.sentinel = false;
    this.rocketEvery = this.orbitals = this.shotCount = this.stillT = 0;
    this.synergyMul = this.synergyRadius = 1;
    this.chainExtra = 0;
    this.mesh.visible = true;
    this.mesh.rotation.set(0, 0, 0);  // the title screen spins the model; facing is handled by the mech itself
    this.skillCd = this.skillT = 0;

    // mech base stats, then talents on top
    const t = (id: TalentId) => talents[id] ?? 0;
    this.hp = this.maxHp = mech.hp + t('armor') * 10;
    this.speed = mech.speed;
    this.dashCdMul = mech.dashCdMul * (1 - t('thrusters') * 0.06);
    this.dmgMul = mech.dmgMul * (1 + t('firepower') * 0.05);
    this.critChance += mech.critBonus;
    this.coinMul = 1 + t('salvage') * 0.1;
    this.coins = t('funding') * 15;
    this.shieldMax = this.shield = mech.shield;
    this.revives = t('revive');
    this.updateGunColor();
  }

  setMech(def: MechDef): void {
    this.mesh.remove(this.mech.root);
    this.mech = new MechModel(def.palette, def.scale);
    this.mesh.add(this.mech.root);
    this.mechDef = def;
    this.updateGunColor();
  }

  get skillReady(): number {
    return 1 - Math.max(0, this.skillCd) / this.mechDef.skillCd;
  }

  // Mech-specific active skill (F key / gamepad Y).
  trySkill(g: Game): void {
    if (this.skillCd > 0) return;
    const def = this.mechDef;
    this.skillCd = def.skillCd;
    if (def.skill === 'overdrive') {
      this.skillT = this.skillDur = 5;
      sfx.levelUp();
      g.hud.toast(t('过载射击'));
    } else if (def.skill === 'barrier') {
      this.skillT = this.skillDur = 3;
      this.invuln = Math.max(this.invuln, 3);
      g.projectiles.clearEnemyBulletsNear(this.pos, 6);
      g.fx.shockwave(this.pos.x, this.pos.z, 6, 0x66ccff);
      sfx.shieldBlock();
    } else {
      this.blink(g);
    }
  }

  get overdrive(): boolean {
    return this.mechDef.skill === 'overdrive' && this.skillT > 0;
  }

  // Phantom skill: dash-teleport toward the aim, shredding enemies along the path.
  private blink(g: Game): void {
    const start = this.pos.clone();
    let dist = 0;
    for (let d = 0.25; d <= 7; d += 0.25) {
      if (g.room.blocked(start.x + this.aim.x * d, start.z + this.aim.z * d, this.r)) break;
      dist = d;
    }
    const end = start.clone().addScaledVector(this.aim, dist);
    const abx = end.x - start.x, abz = end.z - start.z, len2 = abx * abx + abz * abz || 1;
    for (const e of [...g.enemies.list]) {
      const t = Math.max(0, Math.min(1, ((e.pos.x - start.x) * abx + (e.pos.z - start.z) * abz) / len2));
      if (Math.hypot(e.pos.x - (start.x + abx * t), e.pos.z - (start.z + abz * t)) < e.r + 0.7) {
        g.enemies.damage(e, 60 * this.dmgMul, { dir: this.aim.clone(), knock: 8 });
      }
    }
    g.fx.burst({ x: start.x, y: 1, z: start.z }, this.mechDef.palette.accent, 16, 6, 0.2, 0.4);
    g.fx.lightning({ x: start.x, y: 1, z: start.z }, { x: end.x, y: 1, z: end.z }, this.mechDef.palette.accent);
    this.pos.copy(end);
    this.invuln = Math.max(this.invuln, 0.5);
    g.fx.burst({ x: end.x, y: 1, z: end.z }, this.mechDef.palette.accent, 16, 6, 0.2, 0.4);
    sfx.dash();
    sfx.zap();
  }

  // Where the player is aiming in the world (cursor or gamepad target).
  get aimTarget(): THREE.Vector3 {
    return aimPoint;
  }

  get dashCooldown(): number {
    return Math.max(CAP.dashCooldown, P.dashCooldown * this.dashCdMul);
  }

  get moveSpeed(): number {
    return Math.min(this.speed, this.mechDef.speed * CAP.speedMul);
  }

  get activeSlot(): WeaponSlot {
    return this.slots[this.weapon];
  }

  get weaponDef(): WeaponDef {
    return WEAPONS[this.activeSlot.id];
  }

  get fireRateMul(): number {
    const mul = this.rateMul * (this.frenzy && this.hp < this.maxHp * 0.5 ? 1.5 : 1) * (this.overdrive ? 1.6 : 1) * (this.anchored ? 1.25 : 1);
    return Math.min(CAP.fireRateMul, mul);
  }

  // Reload time for a weapon after modules, never below the cap.
  reloadTime(w: WeaponDef): number {
    return Math.max(CAP.reloadTime, w.reloadT * Math.max(CAP.reloadTimeMul, 1 / this.reloadMul));
  }

  magSize(id: WeaponId): number {
    return Math.max(1, Math.round(WEAPONS[id].mag * this.magMul));
  }

  // 0..1 progress of the current reload, or null when not reloading.
  get reloadProgress(): number | null {
    return this.reloadT > 0 ? 1 - this.reloadT / this.reloadTotal : null;
  }

  // Sentinel module: planted for a moment.
  get anchored(): boolean {
    return this.sentinel && this.stillT > 0.5;
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
    this.taken.push(u.id);
  }

  // Restore weapons from a run save (saves from before ammo existed get full magazines).
  restoreSlots(slots: WeaponSlot[], active: number): void {
    this.slots = slots.map((s, i) => {
      const starter = i === 0 && s.id === this.mechDef.starter;
      const slot: WeaponSlot = { id: s.id, level: s.level, mag: s.mag ?? this.magSize(s.id), reserve: s.reserve ?? WEAPONS[s.id].reserve };
      if (starter) slot.starter = true;
      return slot;
    });
    this.weapon = Math.min(active, this.slots.length - 1);
    this.updateGunColor();
  }

  heal(n: number): void {
    this.hp = Math.min(this.maxHp, this.hp + n);
  }

  owns(id: WeaponId): boolean {
    return this.slots.some(s => s.id === id);
  }

  // Owned weapon -> level up and refill its ammo; free slot -> add; otherwise replace a weapon
  // (never the starting one, see replaceIndex). `ammo` carries over a dropped weapon's rounds.
  addWeapon(id: WeaponId, level = 1, ammo?: { mag: number; reserve: number }): WeaponGain {
    const owned = this.slots.find(s => s.id === id);
    if (owned) {
      owned.level += level;
      if (!owned.starter) owned.reserve = WEAPONS[id].reserve;
      owned.mag = this.magSize(id);
      if (owned === this.activeSlot) this.reloadT = 0;
      return { kind: 'levelup', level: owned.level };
    }
    const slot: WeaponSlot = { id, level, mag: ammo?.mag ?? this.magSize(id), reserve: ammo?.reserve ?? WEAPONS[id].reserve };
    this.reloadT = 0;
    if (this.slots.length < MAX_WEAPON_SLOTS) {
      this.slots.push(slot);
      this.weapon = this.slots.length - 1;
      this.updateGunColor();
      return { kind: 'added' };
    }
    const i = this.replaceIndex;
    const dropped = this.slots[i];
    this.slots[i] = slot;
    this.weapon = i;
    this.updateGunColor();
    return { kind: 'swapped', dropped };
  }

  // Which slot a new weapon replaces when all are full: the active one, unless that's the
  // starting weapon, in which case the other weapon with the least ammo left.
  get replaceIndex(): number {
    if (!this.activeSlot.starter) return this.weapon;
    let best = -1;
    this.slots.forEach((s, i) => {
      if (s.starter) return;
      if (best < 0 || s.mag + s.reserve <= this.slots[best].mag + this.slots[best].reserve) best = i;
    });
    return best;
  }

  // Shop ammo: refill every picked-up weapon's reserve.
  refillAmmo(): void {
    for (const s of this.slots) if (!s.starter) s.reserve = WEAPONS[s.id].reserve;
  }

  get needsAmmo(): boolean {
    return this.slots.some(s => !s.starter && s.reserve < WEAPONS[s.id].reserve);
  }

  // R key: reload the active weapon if it isn't full and there's ammo to load.
  startReload(): void {
    const s = this.activeSlot;
    if (this.reloadT > 0 || s.mag >= this.magSize(s.id) || (!s.starter && s.reserve <= 0)) return;
    this.reloadTotal = this.reloadT = this.reloadTime(this.weaponDef);
    sfx.reload();
  }

  private finishReload(): void {
    const s = this.activeSlot;
    const need = this.magSize(s.id) - s.mag;
    const take = s.starter ? need : Math.min(need, s.reserve);
    s.mag += take;
    if (!s.starter) s.reserve -= take;
  }

  // Returns true if the weapon actually changed.
  setWeapon(i: number): boolean {
    if (i === this.weapon || i < 0 || i >= this.slots.length) return false;
    this.weapon = i;
    this.reloadT = 0;  // switching cancels a reload
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
    if (this.dashNova) {
      const w = this.weaponDef;
      const shot = { dmg: w.dmg * this.dmgMul * weaponLevelMul(this.activeSlot.level) * 0.8, pierce: 1, bounce: 0, blast: 0, homing: false };
      const from = new THREE.Vector3(this.pos.x, CANNON_Y, this.pos.z);
      for (let i = 0; i < 12; i++) g.projectiles.firePlayer(from, (i / 12) * Math.PI * 2, Math.max(22, w.speed), { ...w, blast: undefined, life: 0.6 }, shot);
    }
    if (this.dashBlast) g.projectiles.explode(this.pos, P.dashBlastRadius * this.blastMul, P.dashBlastDmg * this.dmgMul * this.blastDmgMul, 0x4ff0ff);
  }

  update(dt: number, g: Game): void {
    if (g.input.stickAim) {
      // right stick aims directly; the aim point sits a fixed distance ahead
      this.aim.set(g.input.padAim.x, 0, g.input.padAim.y);
      aimPoint.set(this.pos.x + this.aim.x * 7, CANNON_Y, this.pos.z + this.aim.z * 7);
    } else {
      raycaster.setFromCamera(g.input.mouseNDC, g.gfx.camera);
      if (raycaster.ray.intersectPlane(aimPlane, aimPoint)) {
        const dx = aimPoint.x - this.pos.x, dz = aimPoint.z - this.pos.z, l = Math.hypot(dx, dz);
        if (l > 0.3) this.aim.set(dx / l, 0, dz / l);
      }
    }
    this.dashCd -= dt;
    this.invuln -= dt;
    this.fireCd -= dt;
    this.skillCd -= dt;
    this.skillT -= dt;
    this.dryToastT -= dt;
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; this.finishReload(); }
    }
    this.stillT = this.vel.lengthSq() < 0.5 && this.dashT <= 0 ? this.stillT + dt : 0;
    if (this.overdrive && Math.random() < dt * 20) {
      g.fx.burst({ x: this.pos.x, y: 1.4, z: this.pos.z }, this.mechDef.palette.accent, 1, 2, 0.12, 0.3);
    }

    if (this.dashT > 0) {
      this.dashT -= dt;
      this.pos.addScaledVector(this.dashDir, P.dashSpeed * dt);
      if (Math.random() < 0.8) g.fx.burst({ x: this.pos.x, y: 0.7, z: this.pos.z }, 0x4ff0ff, 1, 1, 0.25, 0.3);
      this.vel.copy(this.dashDir).multiplyScalar(this.moveSpeed);
    } else {
      const dir = g.input.moveDir(moveDir);
      const k = 1 - Math.exp(-14 * dt);
      const speed = this.moveSpeed * g.hazards.slowAt(this.pos.x, this.pos.z);
      this.vel.x += (dir.x * speed - this.vel.x) * k;
      this.vel.z += (dir.z * speed - this.vel.z) * k;
      this.pos.addScaledVector(this.vel, dt);
    }
    g.room.collide(this.pos, this.r);
    if (g.input.firing && this.fireCd <= 0 && this.reloadT <= 0) this.tryFire(g);

    this.mesh.position.copy(this.pos);
    this.faceYaw = g.input.stickAim ? Math.atan2(this.aim.x, this.aim.z) : this.screenFacing(g);
    this.mech.update(dt, this.vel, this.faceYaw, this.moveSpeed, this.dashT > 0);
    // blink while invulnerable after taking a hit
    this.mesh.visible = !(this.invuln > 0 && this.dashT <= 0 && Math.floor(g.time * 20) % 2 === 0);
    this.ring.material.opacity = this.dashCd <= 0 ? 0.45 : 0.1;
    this.ring.material.color.setHex(this.anchored ? 0xffc83d : 0x4ff0ff);
    this.shieldBubble.visible = this.shield > 0 || (this.mechDef.skill === 'barrier' && this.skillT > 0);
    this.shieldBubble.material.opacity = 0.14 + Math.sin(g.time * 4) * 0.05;
    g.gfx.playerLight.position.set(this.pos.x, 3.5, this.pos.z + 1);
  }

  // Fire if there's a round loaded; an empty magazine reloads, and a picked-up weapon that's
  // completely dry falls back to the starting weapon.
  private tryFire(g: Game): void {
    const s = this.activeSlot;
    if (this.overdrive) { this.fire(g); return; }  // overdrive doesn't use ammo
    if (s.mag > 0) {
      s.mag--;
      this.fire(g);
      if (s.mag === 0) this.startReload();
      return;
    }
    if (s.starter || s.reserve > 0) { this.startReload(); return; }
    if (this.dryToastT <= 0) {
      this.dryToastT = 1;
      sfx.denied();
      g.hud.toast(t('{w} 弹药耗尽', { w: this.weaponDef.name }));
    }
    const starter = this.slots.findIndex(x => x.starter);
    if (starter >= 0) g.switchWeapon(starter);
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
      dmg: w.dmg * this.dmgMul * weaponLevelMul(this.activeSlot.level) * (this.overdrive ? 1.2 : 1) * (this.anchored ? 1.5 : 1),
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
    this.shotCount++;
    if (this.rocketEvery && this.shotCount % this.rocketEvery === 0) {
      const r = WEAPONS.rocket;
      g.projectiles.firePlayer(muzzle, base, r.speed, r, {
        dmg: r.dmg * this.dmgMul, pierce: 0, bounce: 0, blast: (r.blast ?? 2) * this.blastMul, homing: this.homing,
      });
      sfx.shoot.rocket();
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
