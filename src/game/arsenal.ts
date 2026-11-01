import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import { TRAITS, WEAPONS, weaponLevelMul } from '../data/weapons';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { untargetable } from './enemyAI';
import type { PlayerBullet, ShotStats } from './projectiles';

// Weapon signature traits (docs/武装.md): the per-enemy stacks they leave (shred, chill,
// overload...), and everything that happens when a weapon's shot hits, bounces, explodes or kills.
// The firing side (pulse rhythm, flame heat, rail charge) lives in Player.

const T = TRAITS;
const tmp = new THREE.Vector3();

// Weapon stacks and crowd control carried by one enemy.
export interface Marks {
  shred: number;      // smg: +2% damage taken per stack
  shredT: number;
  chill: number;      // frost: stacks toward freezing solid
  chillT: number;
  freezeT: number;    // frozen solid: can't move or attack
  stunT: number;      // stunned: can't move or attack
  arc: number;        // arc: hits toward the next overload
  slamDmg: number;    // shotgun: damage dealt if it hits a wall while still flying back
  slamT: number;
  shardDmg: number;   // frost: damage of each shard if it shatters
  spikes: THREE.Mesh[];  // anchor spikes stuck in this enemy
  spikeT: number;     // time until they detonate
  spikeDmg: number;   // their combined blast damage
  spikeLv: number;    // level of the spike gun that planted them
  locks: number;      // swarm missiles locked onto it
  lockMark: THREE.Mesh | null;
}

export const newMarks = (): Marks => ({
  shred: 0, shredT: 0, chill: 0, chillT: 0, freezeT: 0, stunT: 0, arc: 0, slamDmg: 0, slamT: 0, shardDmg: 0,
  spikes: [], spikeT: 0, spikeDmg: 0, spikeLv: 1, locks: 0, lockMark: null,
});

interface Scorch { x: number; z: number; r: number; dps: number; t: number; tick: number }

// Singularity gravity well.
interface Well {
  x: number; z: number; r: number;
  t: number; max: number;
  dmg: number;       // implosion damage
  tick: number;
  echo: boolean;     // Lv5 follow-up well (doesn't spawn another)
  lv: number;
  core: THREE.Mesh;
  disk: THREE.Mesh;
}

// Short-lived visuals owned here (blade swings).
interface Flash { mesh: THREE.Mesh; t: number; max: number }

const SPIKE_GEO = new THREE.ConeGeometry(0.07, 0.42, 5);
const PRISM_COLORS = [0xff4d6d, 0x5cff8a, 0x5cb8ff];

export class Arsenal {
  private scorches: Scorch[] = [];
  private wells: Well[] = [];
  private echoes: { x: number; z: number; t: number; dmg: number }[] = [];
  private flashes: Flash[] = [];
  private swings = 0;  // blade: swings toward the next wave (Lv5)
  private readonly lockMarks = new Set<THREE.Mesh>();

  constructor(private readonly g: Game) {}

  // --- stacks on enemies ---

  updateMarks(e: Enemy, dt: number): void {
    const m = e.marks;
    if (m.shredT > 0 && (m.shredT -= dt) <= 0) m.shred = 0;
    if (m.chillT > 0 && (m.chillT -= dt) <= 0) m.chill = 0;
    if (m.freezeT > 0) m.freezeT -= dt;
    if (m.stunT > 0) m.stunT -= dt;
    if (m.slamT > 0 && (m.slamT -= dt) <= 0) m.slamDmg = 0;
    if (m.spikes.length) {
      m.spikeT -= dt;
      // spikes blink faster as the fuse runs down
      const blink = Math.sin(m.spikeT * (40 - m.spikeT * 18)) > 0;
      for (const s of m.spikes) s.visible = blink || m.spikeT > 1;
      if (m.spikeT <= 0) this.detonateSpikes(e);
    }
    if (m.lockMark) m.lockMark.rotation.z += dt * 4;
  }

  // Frozen solid or stunned: the enemy neither moves nor attacks.
  disabled(e: Enemy): boolean {
    return e.marks.freezeT > 0 || e.marks.stunT > 0;
  }

  // Shred makes an enemy take more damage from every source.
  takenMul(e: Enemy): number {
    return 1 + e.marks.shred * T.smg.shredPer;
  }

  stun(e: Enemy, time: number): void {
    if (e.def.boss) return;
    e.marks.stunT = Math.max(e.marks.stunT, time * (1 - e.def.ccResist));
  }

  // --- shots ---

  // After a player bullet has dealt `dmg` to `e`.
  onHit(b: PlayerBullet, e: Enemy, dmg: number): void {
    const s = b.shot, lv = s.level ?? 1;
    if (s.weapon === 'prism' && (s.refract ?? 0) > 0) this.refract(b, e, lv);
    if (!s.weapon || s.child) return;
    const g = this.g, m = e.marks;
    switch (s.weapon) {
      case 'pulse':
        if (s.charged) {
          this.push(e.pos, T.pulse.pushRadius, 6, e);
          g.fx.shockwave(e.pos.x, e.pos.z, T.pulse.pushRadius, 0xbff8ff);
          if (lv >= 5) g.projectiles.explode(e.pos.clone(), T.pulse.burstRadius, dmg * T.pulse.burstMul, 0x4ff0ff, { quiet: true });
        }
        break;
      case 'smg':
        m.shred = Math.min(lv >= 3 ? T.smg.shredMaxLv3 : T.smg.shredMax, m.shred + 1);
        m.shredT = T.smg.shredTime;
        break;
      case 'shotgun': {
        const near = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z) < T.shotgun.nearRange;
        if (near) {
          e.vel.addScaledVector(tmp.copy(b.vel).normalize(), b.knock * (T.shotgun.nearKnock - 1) * e.def.mass);
          if (s.group && ++s.group.nearHits >= T.shotgun.quakeHits && lv >= 5 && !s.group.quaked) {
            s.group.quaked = true;
            this.quake();
          }
        }
        m.slamDmg += dmg * T.shotgun.slamMul;
        m.slamT = T.shotgun.slamWindow;
        break;
      }
      case 'frost':
        m.shardDmg = dmg * T.frost.shardMul;
        this.chill(e, 1);
        break;
      case 'arc': {
        const chainMul = lv >= 5 ? 1 : T.arc.chainMul;
        g.enemies.chainLightning(e, dmg * chainMul * g.player.elementMul, T.arc.chainTargets + (lv >= 3 ? 1 : 0));
        if (e.hp <= 0) break;
        if (m.arc >= (lv >= 5 ? T.arc.overloadHitsLv5 : T.arc.overloadHits)) {
          m.arc = 0;
          this.overload(e, dmg);
        } else {
          m.arc++;
        }
        break;
      }
      case 'rail':
        b.dmg *= 1 + T.rail.pierceRamp;
        break;
      case 'spike':
        this.stick(e, b, lv);
        break;
    }
  }

  // Rocket direct hit: the enemy the rocket touched takes extra damage before the blast.
  directHit(b: PlayerBullet, e: Enemy): void {
    if (b.shot.weapon !== 'rocket' || b.shot.child) return;
    const g = this.g;
    g.enemies.damage(e, b.dmg * T.rocket.directMul, { dir: tmp.copy(b.vel).normalize(), knock: 6 });
    g.floaters.say({ x: e.pos.x, y: e.def.y + 1.4, z: e.pos.z }, t('直击!'));
    sfx.deflect();
  }

  // A bullet ricocheted off a wall.
  onBounce(b: PlayerBullet): void {
    if (b.shot.weapon !== 'grenade' || b.shot.child) return;
    if (b.bounces <= T.grenade.maxBounces) {
      // each ricochet adds a ring: bigger, brighter grenade
      b.mesh.scale.multiplyScalar(1.12);
      this.g.fx.burst(b.mesh.position, 0xeaff9a, 6, 5, 0.12, 0.25);
      sfx.bounce(b.bounces);
    }
  }

  // Explosion radius / damage multipliers for a blast shot (grenade ricochets).
  blastScale(b: PlayerBullet): { radius: number; dmg: number } {
    if (b.shot.weapon !== 'grenade' || b.shot.child) return { radius: 1, dmg: 1 };
    const n = Math.min(T.grenade.maxBounces, b.bounces);
    return { radius: 1 + n * T.grenade.bounceRadius, dmg: 1 + n * T.grenade.bounceDmg };
  }

  // After a blast shot exploded at `pos`.
  onExplode(b: PlayerBullet, pos: THREE.Vector3, radius: number): void {
    const s = b.shot, lv = s.level ?? 1, g = this.g;
    if (s.child) return;
    if (s.weapon === 'grenade' && lv >= 5) {
      const w = WEAPONS.grenade;
      for (let i = 0; i < T.grenade.cluster; i++) {
        const a = Math.random() * Math.PI * 2;
        g.projectiles.firePlayer(tmp.set(pos.x, pos.y, pos.z), a, 9, { ...w, size: w.size * 0.6, life: 0.5 }, {
          dmg: b.dmg * T.grenade.clusterMul, pierce: 0, bounce: 1, blast: radius * 0.45, homing: false, weapon: 'grenade', level: lv, child: true,
        });
      }
    }
    if (s.weapon === 'rocket' && lv >= 5) {
      this.scorches.push({ x: pos.x, z: pos.z, r: radius * 0.6, dps: b.dmg * T.rocket.scorchDps, t: T.rocket.scorchTime, tick: 0 });
    }
  }

  // A shot's flight ended (wall, range) without exploding.
  onEnd(b: PlayerBullet, pos: THREE.Vector3): void {
    const s = b.shot;
    if (s.child) return;
    if (s.weapon === 'rail' && (s.level ?? 1) >= 5) {
      this.g.projectiles.explode(pos.clone(), T.rail.endRadius, s.dmg * T.rail.endMul, 0xd9c2ff, { quiet: true });
    }
    if (s.weapon === 'singularity') this.openWell(pos.x, pos.z, s.level ?? 1, b.dmg, false);
  }

  // Disc caught on its way back: the round goes back into the magazine.
  catchDisc(b: PlayerBullet): void {
    const g = this.g, p = g.player;
    const slot = p.slots.find(s => s.id === 'disc');
    if (slot && slot.mag < p.magSize('disc', slot.level)) slot.mag++;
    g.fx.burst(b.mesh.position, b.color, 8, 4, 0.14, 0.3);
    sfx.catchDisc();
  }

  // Plasma blade swing: hits everything in the arc in front, turns enemy bullets around.
  slash(facing: number, shot: ShotStats, lv: number): void {
    const g = this.g, p = g.player, w = WEAPONS.blade;
    const r = T.blade.radius * (lv >= 3 ? T.blade.radiusLv3 : 1), half = T.blade.arc / 2;
    let hit = false;
    for (const e of [...g.enemies.list]) {
      if (e.hp <= 0 || untargetable(e)) continue;
      const dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > r + e.r) continue;
      const off = Math.atan2(Math.sin(Math.atan2(dx, dz) - facing), Math.cos(Math.atan2(dx, dz) - facing));
      if (Math.abs(off) > half && d > e.r) continue;
      const crit = Math.random() < p.critChance;
      g.enemies.damage(e, shot.dmg * (crit ? p.critMul : 1), { dir: tmp.set(dx, 0, dz).normalize(), knock: w.knock, crit, weapon: 'blade' });
      g.fx.burst({ x: e.pos.x, y: 1, z: e.pos.z }, w.color, 6, 6, 0.12, 0.25, tmp);
      hit = true;
    }
    if (hit) { g.hud.hitMarker(false); g.fx.hitstop(0.04); }
    const reflected = g.projectiles.reflectEnemyBullets(p.pos, r + 0.3, facing, half, T.blade.reflectMul * p.dmgMul, w);
    if (reflected) sfx.reflect();
    // the swing itself: a glowing arc that fades out
    const geo = new THREE.RingGeometry(r * 0.45, r, 28, 1, facing - Math.PI / 2 - half, half * 2);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(w.color).multiplyScalar(1.6), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
    const arc = new THREE.Mesh(geo, mat);
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(p.pos.x, 1.1, p.pos.z);
    g.gfx.scene.add(arc);
    this.flashes.push({ mesh: arc, t: 0.16, max: 0.16 });
    // Lv5: every third swing also throws a cutting wave
    if (lv >= 5 && ++this.swings % T.blade.waveEvery === 0) {
      g.projectiles.firePlayer(tmp.set(p.pos.x, 1.2, p.pos.z), facing, w.speed, { ...w, size: 0.5, stretch: 2.4 }, { ...shot, child: true, pierce: 99 });
    }
  }

  // Swarm: put (another) lock on an enemy and show it.
  lock(e: Enemy): void {
    const m = e.marks;
    m.locks++;
    if (!m.lockMark) {
      m.lockMark = new THREE.Mesh(GEO.ring, glowMat(0xff3b3b, 2.2));
      m.lockMark.rotation.x = -Math.PI / 2;
      this.g.gfx.scene.add(m.lockMark);
      this.lockMarks.add(m.lockMark);
    }
    m.lockMark.scale.setScalar(e.r * (1.5 + m.locks * 0.25));
    m.lockMark.position.set(e.pos.x, 0.1, e.pos.z);
  }

  clearLocks(): void {
    for (const e of this.g.enemies.list) this.unlock(e);
  }

  // Keep lock rings under their enemies.
  followLocks(): void {
    for (const e of this.g.enemies.list) if (e.marks.lockMark) e.marks.lockMark.position.set(e.pos.x, 0.1, e.pos.z);
  }

  // --- enemies ---

  // An enemy hit a wall this frame; if a shotgun blast is still carrying it, it slams.
  onWall(e: Enemy): void {
    const m = e.marks, g = this.g;
    if (m.slamT <= 0 || m.slamDmg <= 0 || e.vel.lengthSq() < 16) return;
    const dmg = m.slamDmg;
    m.slamDmg = m.slamT = 0;
    g.enemies.damage(e, dmg, { crit: true });
    this.stun(e, T.shotgun.slamStun);
    g.fx.burst({ x: e.pos.x, y: 0.4, z: e.pos.z }, 0xd8c8a8, 14, 5, 0.16, 0.45);
    g.fx.shake(0.2);
    sfx.slam();
  }

  onKill(e: Enemy): void {
    const g = this.g, m = e.marks, p = g.player;
    if (m.freezeT > 0) this.shatter(e);
    if (m.spikes.length) this.detonateSpikes(e);
    this.unlock(e);
    // smg Lv5: a fully shredded enemy bursts into ricocheting rounds
    const smg = p.slots.find(s => s.id === 'smg');
    if (smg && smg.level >= 5 && m.shred >= T.smg.shredMaxLv3) {
      const w = WEAPONS.smg;
      for (let i = 0; i < T.smg.burstShots; i++) {
        g.projectiles.firePlayer(tmp.set(e.pos.x, 1.2, e.pos.z), (i / T.smg.burstShots) * Math.PI * 2, w.speed, w, {
          dmg: w.dmg * p.dmgMul * weaponLevelMul(smg.level), pierce: 0, bounce: 1, blast: 0, homing: false, weapon: 'smg', level: smg.level, child: true,
        });
      }
    }
  }

  update(dt: number): void {
    const g = this.g;
    this.followLocks();
    this.updateWells(dt);
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const f = this.flashes[i];
      f.t -= dt;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * Math.max(0, f.t / f.max);
      f.mesh.scale.setScalar(1 + (1 - f.t / f.max) * 0.15);
      if (f.t <= 0) {
        g.gfx.scene.remove(f.mesh);
        f.mesh.geometry.dispose();
        (f.mesh.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
      }
    }
    for (let i = this.scorches.length - 1; i >= 0; i--) {
      const s = this.scorches[i];
      s.t -= dt;
      s.tick -= dt;
      if (Math.random() < dt * 14) g.fx.burst({ x: s.x + (Math.random() - 0.5) * s.r * 2, y: 0.2, z: s.z + (Math.random() - 0.5) * s.r * 2 }, 0xff5a2a, 1, 1.5, 0.18, 0.5);
      if (s.tick <= 0) {
        s.tick = 0.25;
        for (const e of [...g.enemies.list]) {
          if (Math.hypot(e.pos.x - s.x, e.pos.z - s.z) < s.r + e.r) g.enemies.damage(e, s.dps * 0.25, { dot: true });
        }
      }
      if (s.t <= 0) this.scorches.splice(i, 1);
    }
  }

  clear(): void {
    const scene = this.g.gfx.scene;
    this.scorches.length = 0;
    for (const w of this.wells) scene.remove(w.core, w.disk);
    this.wells.length = 0;
    this.echoes.length = 0;
    for (const f of this.flashes) { scene.remove(f.mesh); f.mesh.geometry.dispose(); (f.mesh.material as THREE.Material).dispose(); }
    this.flashes.length = 0;
    this.swings = 0;
    for (const mark of this.lockMarks) scene.remove(mark);
    this.lockMarks.clear();
  }

  // --- trait effects ---

  // Frost: add chill stacks; at the cap a regular enemy freezes solid (bosses just slow down).
  private chill(e: Enemy, n: number): void {
    const m = e.marks;
    if (m.freezeT > 0) return;
    m.chill += n;
    m.chillT = T.frost.chillTime;
    if (m.chill < T.frost.chillMax) return;
    m.chill = 0;
    if (e.def.boss || e.def.noFreeze) {
      e.frostT = Math.max(e.frostT, T.frost.freeze);
      return;
    }
    m.freezeT = T.frost.freeze * (1 - e.def.ccResist * 0.5);
    this.g.fx.burst({ x: e.pos.x, y: e.def.y, z: e.pos.z }, 0xcff6ff, 16, 4, 0.18, 0.45);
    sfx.freeze();
  }

  private shatter(e: Enemy): void {
    const g = this.g, m = e.marks, w = WEAPONS.frost;
    const frost = g.player.slots.find(s => s.id === 'frost');
    for (let i = 0; i < T.frost.shards; i++) {
      g.projectiles.firePlayer(tmp.set(e.pos.x, 1.1, e.pos.z), (i / T.frost.shards) * Math.PI * 2 + Math.random() * 0.3, 22, { ...w, life: 0.4, size: w.size * 0.7 }, {
        dmg: m.shardDmg || w.dmg * T.frost.shardMul, pierce: 0, bounce: 0, blast: 0, homing: false, weapon: 'frost', child: true,
      });
    }
    g.fx.burst({ x: e.pos.x, y: e.def.y, z: e.pos.z }, 0xcff6ff, 24, 7, 0.2, 0.5);
    sfx.shatter();
    if (frost && frost.level >= 5) {
      for (const o of g.enemies.list) {
        if (o !== e && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < T.frost.spreadRadius + o.r) this.chill(o, T.frost.spreadChill);
      }
    }
  }

  private overload(e: Enemy, dmg: number): void {
    const g = this.g;
    g.enemies.damage(e, dmg * T.arc.overloadMul, { crit: true });
    this.stun(e, T.arc.overloadStun);
    for (const o of [...g.enemies.list]) {
      if (o !== e && o.hp > 0 && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < T.arc.overloadRadius + o.r) {
        g.enemies.damage(o, dmg * T.arc.overloadSplash);
        g.fx.lightning({ x: e.pos.x, y: e.def.y, z: e.pos.z }, { x: o.pos.x, y: o.def.y, z: o.pos.z }, 0xbfd4ff);
      }
    }
    g.fx.shockwave(e.pos.x, e.pos.z, T.arc.overloadRadius, 0x8fb8ff);
    g.fx.burst({ x: e.pos.x, y: e.def.y, z: e.pos.z }, 0xdfe9ff, 20, 6, 0.16, 0.35);
    sfx.overload();
  }

  // Prism: the light splits at the enemy it hit into colored rays that keep going.
  private refract(b: PlayerBullet, e: Enemy, lv: number): void {
    const g = this.g, w = WEAPONS.prism, n = lv >= 3 ? T.prism.raysLv3 : T.prism.rays;
    const heading = Math.atan2(b.vel.x, b.vel.z), speed = b.vel.length();
    for (let i = 0; i < n; i++) {
      const a = heading + (n === 1 ? 0 : -T.prism.angle + (2 * T.prism.angle * i) / (n - 1));
      const ray = g.projectiles.firePlayer(b.mesh.position.clone(), a, speed, { ...w, color: PRISM_COLORS[i % 3], size: w.size * 0.75, life: T.prism.life }, {
        dmg: b.dmg * T.prism.mul, pierce: 0, bounce: 0, blast: 0, homing: false, weapon: 'prism', level: lv, child: true, refract: (b.shot.refract ?? 1) - 1,
      });
      ray.hits.add(e);
    }
    sfx.refract(n);
  }

  // Anchor spike: stick into the enemy; the first one starts the fuse for all of them.
  private stick(e: Enemy, b: PlayerBullet, lv: number): void {
    const m = e.marks, p = this.g.player;
    if (m.spikes.length >= T.spike.maxSpikes) return;
    if (!m.spikes.length) m.spikeT = T.spike.delay;
    m.spikeLv = lv;
    m.spikeDmg += T.spike.blastDmg * p.dmgMul * weaponLevelMul(lv);
    const spike = new THREE.Mesh(SPIKE_GEO, glowMat(0xff3b5c, 2.4));
    // stuck in at the side it was hit from, pointing out
    const a = Math.atan2(-b.vel.x, -b.vel.z) - e.mesh.rotation.y + (Math.random() - 0.5) * 0.8;
    spike.position.set(Math.sin(a) * e.def.r * 0.9, (Math.random() - 0.3) * e.def.r, Math.cos(a) * e.def.r * 0.9);
    spike.lookAt(spike.position.clone().multiplyScalar(3));
    spike.rotateX(Math.PI / 2);
    e.mesh.add(spike);
    m.spikes.push(spike);
    sfx.stick();
  }

  private detonateSpikes(e: Enemy): void {
    const g = this.g, m = e.marks, n = m.spikes.length, lv = m.spikeLv;
    if (!n) return;
    const dmg = m.spikeDmg;
    for (const s of m.spikes) e.mesh.remove(s);
    m.spikes = [];
    m.spikeDmg = 0;
    const r = (T.spike.radius + (n - 1) * T.spike.radiusPer) * (lv >= 3 ? T.spike.radiusLv3 : 1);
    g.projectiles.explode(e.pos.clone(), r, dmg, 0xff3b5c, { quiet: n < 4 });
    // Lv5: the blast flings a fresh spike into each of the nearest enemies
    if (lv < 5) return;
    const w = WEAPONS.spike;
    const near = g.enemies.list
      .filter(o => o !== e && o.hp > 0 && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < T.spike.scatterRange)
      .sort((a, b) => Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) - Math.hypot(b.pos.x - e.pos.x, b.pos.z - e.pos.z))
      .slice(0, T.spike.scatter);
    for (const o of near) {
      g.projectiles.firePlayer(tmp.set(e.pos.x, 1.1, e.pos.z), Math.atan2(o.pos.x - e.pos.x, o.pos.z - e.pos.z), w.speed, w, {
        dmg: w.dmg * g.player.dmgMul, pierce: 0, bounce: 0, blast: 0, homing: false, weapon: 'spike', level: 1,
      });
    }
  }

  // The enemy can't be hit for a while (burrowed): spikes fall off, locks are lost.
  release(e: Enemy): void {
    const m = e.marks;
    for (const s of m.spikes) e.mesh.remove(s);
    m.spikes = [];
    m.spikeDmg = 0;
    this.unlock(e);
    const p = this.g.player, i = p.locks.indexOf(e);
    if (i >= 0) p.locks.splice(i, 1);
  }

  private unlock(e: Enemy): void {
    const m = e.marks;
    m.locks = 0;
    if (m.lockMark) { this.g.gfx.scene.remove(m.lockMark); this.lockMarks.delete(m.lockMark); m.lockMark = null; }
  }

  // Singularity: open a gravity well (or the smaller Lv5 echo).
  private openWell(x: number, z: number, lv: number, dmg: number, echo: boolean): void {
    const g = this.g, S = T.singularity;
    const r = echo ? S.echoRadius : S.radius * (lv >= 3 ? S.radiusLv3 : 1);
    const core = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0x050008 }));
    core.position.set(x, 1, z);
    core.scale.setScalar(0.5);
    const disk = new THREE.Mesh(GEO.ring, glowMat(0xa13dff, 2.6));
    disk.rotation.x = -Math.PI / 2;
    disk.position.set(x, 0.15, z);
    g.gfx.scene.add(core, disk);
    this.wells.push({ x, z, r, t: echo ? S.echoTime : S.time, max: echo ? S.echoTime : S.time, dmg, tick: 0, echo, lv, core, disk });
    g.fx.shockwave(x, z, r, 0xa13dff);
    sfx.well();
  }

  private updateWells(dt: number): void {
    const g = this.g, S = T.singularity;
    for (let i = this.wells.length - 1; i >= 0; i--) {
      const w = this.wells[i];
      w.t -= dt;
      w.tick -= dt;
      const grow = Math.min(1, (w.max - w.t) / 0.25);
      w.disk.scale.setScalar(w.r * 0.55 * grow);
      w.disk.rotation.z += dt * 5;
      w.core.scale.setScalar(0.35 + 0.25 * grow + Math.sin(w.t * 30) * 0.03);
      // particles spiral in from the rim
      for (let k = 0; k < 2; k++) {
        const a = Math.random() * Math.PI * 2;
        g.fx.burst({ x: w.x + Math.sin(a) * w.r, y: 0.6, z: w.z + Math.cos(a) * w.r }, 0xc77dff, 1, w.r * 2.2, 0.1, 0.45, tmp.set(-Math.sin(a + 0.6), 0, -Math.cos(a + 0.6)));
      }
      for (const e of g.enemies.list) {
        const dx = w.x - e.pos.x, dz = w.z - e.pos.z, d = Math.hypot(dx, dz);
        if (d > w.r + e.r || d < 0.4 || e.def.boss || e.def.anchored) continue;
        const pull = S.pull * 8 * dt * (e.elite ? 0.5 : 1);
        e.vel.x += dx / d * pull;
        e.vel.z += dz / d * pull;
      }
      if (w.tick <= 0) {
        w.tick = 0.25;
        for (const e of [...g.enemies.list]) {
          if (Math.hypot(w.x - e.pos.x, w.z - e.pos.z) < w.r + e.r) g.enemies.damage(e, w.dmg * S.dps * 0.25, { dot: true });
        }
      }
      if (w.t <= 0) {
        g.gfx.scene.remove(w.core, w.disk);
        this.wells.splice(i, 1);
        g.projectiles.explode(new THREE.Vector3(w.x, 0.8, w.z), w.echo ? S.echoRadius : S.implodeRadius, w.dmg, 0xa13dff);
        if (!w.echo && w.lv >= 5) this.echoes.push({ x: w.x, z: w.z, t: S.echoDelay, dmg: w.dmg * S.echoMul });
      }
    }
    for (let i = this.echoes.length - 1; i >= 0; i--) {
      const e = this.echoes[i];
      if ((e.t -= dt) > 0) continue;
      this.echoes.splice(i, 1);
      this.openWell(e.x, e.z, 5, e.dmg, true);
    }
  }

  // Shotgun Lv5: point-blank blast shoves everything nearby away and wipes close bullets.
  private quake(): void {
    const g = this.g, p = g.player.pos;
    this.push(p, T.shotgun.quakeRadius + 1, 14);
    g.projectiles.clearEnemyBulletsNear(p, T.shotgun.quakeRadius + 0.5);
    g.fx.shockwave(p.x, p.z, T.shotgun.quakeRadius + 1, 0xffb84d);
    g.fx.shake(0.4);
  }

  // Shove enemies away from `from` (no damage).
  private push(from: THREE.Vector3, radius: number, force: number, skip?: Enemy): void {
    for (const e of this.g.enemies.list) {
      if (e === skip) continue;
      const dx = e.pos.x - from.x, dz = e.pos.z - from.z, d = Math.hypot(dx, dz);
      if (d > radius + e.r || d < 0.001) continue;
      e.vel.x += dx / d * force * e.def.mass;
      e.vel.z += dz / d * force * e.def.mass;
    }
  }
}
