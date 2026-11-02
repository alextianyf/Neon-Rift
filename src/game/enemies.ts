import * as THREE from 'three';
import { GEO, WHITE, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import { BALANCE } from '../data/balance';
import { ENEMIES, type EnemyDef, type EnemyKind } from '../data/enemies';
import type { Element } from '../data/weapons';
import { BEHAVIORS, untargetable, type AIFrame } from './enemyAI';
import { buildEnemyVisual, type EnemyVisual, type VisualState } from './enemyModels';
import { Rift } from './rift';
import type { Game } from './game';
import { MODS } from '../data/depth';
import { enemyHpMul } from '../data/scaling';
import { newMarks, type Marks } from './arsenal';
import type { WeaponId } from '../data/weapons';
import { t } from '../core/i18n';
import { AFFIX, AFFIXES, affixCount, rollAffixes, type AffixId } from '../data/affixes';
import { INVISIBLE_STATES, MEND_REDUCE, partsOnDeath } from './enemyParts';
import { bossDied, bossPartLost, bossTakenMul, resetBossFight, updateBossFight } from './bosses';
import { X, adjustDamage, affixTick, onDamaged, onDisabled, onKilled, onTouch, trackRewind } from './partsEndless';
import { lawHpMul, lawOnKill, rewardMul } from './abyss';
import { announceFusion } from './fusion';
import { abyssOnDeath, applySpawnMutations, extraAffixes, frenzyMul, isGhost } from './abyss';
import { FORMS_FROM, bossFormsTick, bossHaste, fuseBoss, fusedName, rollBossForms } from './bossForms';
import { rollVariant } from '../data/variants';

export type AIState = 'move' | 'wind' | 'charge' | 'stun' | 'fuse' | 'aim' | 'beam' | 'spiral' | 'tpout' | 'tpin'
  | 'planted' | 'pack' | 'dive' | 'under' | 'rise' | 'phase' | 'reveal'
  | 'air' | 'slam' | 'stuck' | 'lift' | 'latch' | 'disguise' | 'eat' | 'flee';

// Delayed explosion from a dying bomber; queued so chain reactions unfold over a few frames.
interface Blast {
  x: number;
  z: number;
  t: number;
  dmg: number;
  r: number;
  color: number;
}

const BOMBER_RADIUS = 2.6;
const BOMBER_ENEMY_DMG = 30;

export interface Enemy {
  kind: EnemyKind;
  def: EnemyDef;
  mesh: THREE.Group;   // visual root, positioned by gameplay code
  visual: EnemyVisual;
  mat: THREE.MeshStandardMaterial;
  base: THREE.Color;
  pos: THREE.Vector3;
  vel: THREE.Vector3;  // knockback velocity, decays over time
  hp: number;
  maxHp: number;
  r: number;
  cd: number;          // attack cooldown
  flash: number;       // remaining hit-flash time
  state: AIState;
  stateT: number;
  dir: THREE.Vector3;  // locked charge direction
  side: 1 | -1;        // strafe direction
  t: number;
  pattern: number;     // boss attack rotation
  burst: number;       // boss shots left in the current burst
  burstT: number;
  enraged: boolean;
  scale: number;       // visual scale this frame, set by behaviors for telegraphs
  burnT: number;
  burnDps: number;
  burnTick: number;
  frostT: number;
  spawnT: number;      // materialize animation; harmless until it reaches 0
  elite: boolean;
  size: number;        // visual and collision scale (elites are bigger)
  charge: number;      // 0..1 attack telegraph this frame, set by behaviors
  beamAngle: number;   // weaver lasers / sovereign spiral angle
  beamPhase: number;   // weaver lasers: 0 off, 1 warning, 2 firing
  guard: number;       // bosses: damage they can still take right now (see BALANCE.bossGuard)
  marks: Marks;        // weapon stacks and crowd control (see Arsenal)
  partT: number;       // timer for parts-built enemies (trail drops, replication, lost sight)
  gen: number;         // replicators: 0 original, 1+ copies
  noLoot: boolean;     // copies and split-offs give no score, coins or drops
  affixes: AffixId[];  // elite affixes
  shield: number;      // "shielded" affix: absorbs damage first
  shieldMax: number;
  shieldIdle: number;  // seconds since the last hit, for the shield regrowing
  shieldMesh: THREE.Mesh | null;
  phaseAt: number;     // "phase" affix: HP at which it blinks next
  tetherT: number;     // "tether" affix: countdown to the next pull
  link: Enemy | null;  // linkers: the other one of the pair
  lead: boolean;       // linkers: this one draws the beam
  beam: THREE.Mesh | null;  // linker beam / mender ray, owned by this enemy
  alpha: number;       // 0..1 visibility this frame (phase assassin), set by behaviors
  mended: number;      // > 0 while a mender is beaming it
  owner: Enemy | null; // boss parts: the boss they belong to
  alt: number;         // height above its usual hover (divers in the air)
  dmgMul: number;      // grows when a devourer eats
  variant: boolean;    // abyss variant (sector 60+): one behavior changed
  shrouded: boolean;   // inside a light eater's darkness: drawn dim
}

export interface SpawnOpts {
  hp?: number;         // exact max HP (copies)
  size?: number;
  gen?: number;
  noLoot?: boolean;
  plain?: boolean;     // no affixes even if elite
  solo?: boolean;      // linkers: don't bring a partner (it is the partner)
  hpMul?: number;      // scale the usual HP (twin bosses)
  owner?: Enemy;       // boss parts
}

export interface HitInfo {
  dir?: THREE.Vector3;
  knock?: number;
  crit?: boolean;
  dot?: boolean;       // damage over time: no flash, no knockback
  weapon?: WeaponId;   // which weapon's hit sound to play
}

// Spawn telegraph: a space-time rift that tears open before the enemy steps out.
interface Marker {
  kind: EnemyKind;
  rift: Rift;
  spawned: boolean;
  count: number;
  elite: boolean;
  hpMul: number;
}

const MATERIALIZE_TIME = 0.3;

const EL = BALANCE.elements;
const ELITE = BALANCE.elites;
const GUARD = BALANCE.bossGuard;
const BURN_COLOR = 0xff8a3d;
const FROST_COLOR = new THREE.Color(0x66ddff);
const SHOCK_COLOR = 0x8fb8ff;
const BURN_TINT = new THREE.Color(0xff7a2a);
const THERMAL_COLOR = 0xcff6ff;
const ICE_COLOR = new THREE.Color(0xdff8ff);
const SHRED_COLOR = new THREE.Color(0x7dff6a);
const HIVE_SHIELD = new THREE.Color(0xffd23f);
const VARIANT_TINT = new THREE.Color(0x8a0818);  // abyss variants: dark red
const tint = new THREE.Color();
const frame: AIFrame = { toP: new THREE.Vector3(), dist: 0, spd: 0, desired: new THREE.Vector3(), dt: 0 };
const vis: VisualState = { t: 0, charge: 0, enraged: false, stunned: false, beamAngle: 0, beamPhase: 0, alpha: 1, variant: false };

export class Enemies {
  readonly list: Enemy[] = [];
  private readonly markers: Marker[] = [];
  private readonly blasts: Blast[] = [];
  purging = false;  // the room is being wiped (challenge end): no splits, blasts or loot
  rallyT = 0;       // a commander's charge: every virus faster and rushing in
  replicas = 0;     // replicator copies made this sector (capped)
  readonly eliteDmg = ELITE.dmg;

  constructor(private readonly g: Game) {}

  // rifts that haven't released their enemy yet
  get pending(): number {
    return this.markers.filter(m => !m.spawned).length;
  }

  get boss(): Enemy | undefined {
    return this.list.find(e => e.def.boss);
  }

  addMarker(kind: EnemyKind, x: number, z: number, t = 0.75, count = 1, elite = false, hpMul = 1): void {
    const def = ENEMIES[kind];
    const height = def.boss ? 6 : Math.max(1.6, def.r * 2.6) * (count > 1 ? 1.4 : 1) * (elite ? 1.4 : 1);
    const color = elite ? 0xffc83d : def.color;
    this.markers.push({ kind, rift: new Rift(this.g.gfx.scene, x, z, height, t, color), spawned: false, count, elite, hpMul });
  }

  spawn(kind: EnemyKind, x: number, z: number, elite = false, opts: SpawnOpts = {}): void {
    const def = ENEMIES[kind];
    const visual = buildEnemyVisual(kind);
    const mesh = visual.root, mat = visual.mat;
    mesh.position.set(x, def.y, z);
    this.g.gfx.scene.add(mesh);
    const size = opts.size ?? (elite ? ELITE.size : 1);
    if (elite) {
      // golden aura on the ground marks an elite
      const aura = new THREE.Mesh(GEO.ring, glowMat(0xffc83d, 2.2));
      aura.rotation.x = -Math.PI / 2;
      aura.position.y = -def.y + 0.05;
      aura.scale.setScalar(def.r * 1.5);
      mesh.add(aura);
    }
    if (!def.part && !opts.owner) this.g.discover('enemies', kind);
    if (kind.startsWith('fusion:')) announceFusion(kind, this.g);
    const hp = opts.hp ?? def.hp * enemyHpMul(this.g.room.n) * (elite ? ELITE.hp : 1)
      * MODS.enemyHp * (def.boss ? MODS.bossHp : 1) * (opts.hpMul ?? 1) * (def.boss ? 1 : lawHpMul());
    const affixes = elite && !opts.plain ? rollAffixes(kind, affixCount(this.g.room.n) + extraAffixes(), this.g.room.n) : [];
    for (const a of affixes) this.g.discover('enemies', `affix:${a}`);
    const shieldMax = affixes.includes('shielded') ? hp * AFFIX.shieldFrac : 0;
    let shieldMesh: THREE.Mesh | null = null;
    if (shieldMax > 0) {
      shieldMesh = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({
        color: AFFIXES.shielded.color, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      shieldMesh.scale.setScalar(def.r * 1.35);
      mesh.add(shieldMesh);
    }
    this.list.push({
      kind, def, mesh, visual, mat, base: new THREE.Color(def.color),
      pos: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(), hp, maxHp: hp, guard: hp * GUARD.perSecond, r: def.r * size,
      cd: rand(0.8, 1.8), flash: 0, state: 'move', stateT: 0, dir: new THREE.Vector3(),
      side: Math.random() < 0.5 ? -1 : 1, t: Math.random() * 10, pattern: 0, burst: 0, burstT: 0,
      enraged: false, scale: 1, burnT: 0, burnDps: 0, burnTick: 0, frostT: 0, spawnT: MATERIALIZE_TIME,
      elite, size, charge: 0, beamAngle: 0, beamPhase: 0, marks: newMarks(),
      partT: 0, gen: opts.gen ?? 0, noLoot: !!opts.noLoot,
      affixes, shield: shieldMax, shieldMax, shieldIdle: 0, shieldMesh, phaseAt: hp * (1 - AFFIX.phaseStep), tetherT: AFFIX.tetherEvery,
      link: null, lead: false, beam: null, alpha: 1, mended: 0, owner: opts.owner ?? null,
      alt: 0, dmgMul: 1, variant: !def.boss && !def.part && !opts.plain && rollVariant(kind, this.g.room.n, Math.random), shrouded: false,
    });
    const made = this.list[this.list.length - 1];
    if (made.variant) this.g.discover('enemies', `variant:${kind}`);
    if (!def.boss && !def.part && !def.inert && !opts.plain) applySpawnMutations(made, this.g);
    if (kind === 'mimic') this.list[this.list.length - 1].state = 'disguise';
    mesh.scale.setScalar(0.01);
    if (kind === 'linker' && !opts.solo) this.pairLinker(this.list[this.list.length - 1], opts);
    if (def.boss) {
      rollBossForms(made, this.g);
      fuseBoss(made, this.g);
      const plan = this.g.room.bossPlan;
      const names = [...new Set(this.list.filter(b => b.def.boss).map(b => b.def.name))];
      const label = plan?.fuse ? fusedName(def.name, ENEMIES[plan.fuse].name)
        : plan?.epoch ? t('纪元首领 · {b}', { b: def.name }) : names.join(' · ');
      this.g.hud.showBossBar(true, (this.g.room.n >= FORMS_FROM && kind !== 'origin' ? t('异变·') : '') + label);
    }
  }

  // Dashing shakes off every parasite riding on the mech; they're stunned for a moment.
  shakeOff(): void {
    const p = this.g.player;
    for (const e of this.list) {
      if (e.state !== 'latch') continue;
      e.state = 'move';
      const a = Math.random() * Math.PI * 2;
      e.pos.set(p.pos.x + Math.sin(a) * 1.6, 0, p.pos.z + Math.cos(a) * 1.6);
      e.marks.stunT = 1;
    }
  }

  // Wall blocks stop enemy shots too.
  wallAt(x: number, z: number): boolean {
    return this.list.some(e => e.kind === 'wallBlock' && Math.hypot(e.pos.x - x, e.pos.z - z) < e.r);
  }

  // Every boss on the field (twin fights have two), and their HP together for the bar.
  get bosses(): Enemy[] {
    return this.list.filter(e => e.def.boss);
  }

  // Linkers arrive as a pair: the second one steps out next to the first.
  private pairLinker(a: Enemy, opts: SpawnOpts): void {
    const g = this.g;
    let x = a.pos.x + 2, z = a.pos.z;
    for (let i = 0; i < 8 && g.room.blocked(x, z, a.r); i++) {
      const ang = (i / 8) * Math.PI * 2;
      x = a.pos.x + Math.sin(ang) * 2;
      z = a.pos.z + Math.cos(ang) * 2;
    }
    this.spawn('linker', x, z, a.elite, { ...opts, solo: true });
    const b = this.list[this.list.length - 1];
    a.link = b;
    b.link = a;
    a.lead = true;
    if (a.variant) {
      // variant: a third one closes the triangle; each draws the beam to the next
      this.spawn('linker', a.pos.x, a.pos.z + 2, a.elite, { ...opts, solo: true });
      const c = this.list[this.list.length - 1];
      b.link = c;
      c.link = a;
      b.lead = c.lead = true;
      b.variant = c.variant = true;
      a.pattern = 0;
      b.pattern = 1;
      c.pattern = 2;
    }
  }

  damage(e: Enemy, dmg: number, hit: HitInfo = {}): void {
    if (e.hp <= 0 || untargetable(e)) return;
    dmg *= this.g.arsenal.takenMul(e) * this.auraMul(e) * bossTakenMul(e, this.g);
    dmg = adjustDamage(e, dmg, hit, this.g);
    if (dmg <= 0) { if (!hit.dot) e.flash = Math.max(e.flash, 0.04); return; }
    // no one-shots: cap each hit and the damage per second (a boss's parts share its allowance)
    const guarded = e.def.boss ? e : e.owner?.def.boss ? e.owner : null;
    if (guarded) {
      dmg = Math.min(dmg, guarded.maxHp * GUARD.perHit, guarded.guard);
      guarded.guard -= dmg;
      if (dmg <= 0) return;
    }
    e.shieldIdle = 0;
    if (e.shield > 0) {
      // the shield soaks damage first
      const soaked = Math.min(e.shield, dmg);
      e.shield -= soaked;
      dmg -= soaked;
      this.g.fx.burst({ x: e.pos.x, y: e.def.y + 0.4, z: e.pos.z }, AFFIXES.shielded.color, 2, 3, 0.1, 0.2);
      if (e.shield <= 0) { sfx.shieldBreak(); this.g.fx.shockwave(e.pos.x, e.pos.z, e.r * 1.6, AFFIXES.shielded.color); }
      if (dmg <= 0) {
        if (!hit.dot) e.flash = Math.max(e.flash, 0.04);
        return;
      }
    }
    e.hp -= dmg;
    const o = e.owner;
    if (o && e.def.share && o.hp > 0) {
      // hitting a boss's body segment hurts the boss too
      o.hp -= dmg * e.def.share;
      o.flash = Math.max(o.flash, 0.04);
      if (o.hp <= 0) this.kill(o);
    }
    if (e.affixes.includes('phase') && e.hp > 0 && e.hp <= e.phaseAt) this.blink(e);
    onDamaged(e, hit, this.g);
    const at = { x: e.pos.x, y: e.def.y + e.r, z: e.pos.z };
    this.g.floaters.damage(at, dmg, hit.crit ? 'crit' : hit.dot ? 'dot' : 'dmg', e);
    if (!hit.dot) {
      // throttled so rapid-fire weapons don't keep the enemy permanently white
      if (e.flash < -0.06) e.flash = 0.07;
      if (hit.dir) e.vel.addScaledVector(hit.dir, (hit.knock ?? 0) * e.def.mass);
      if (hit.crit) sfx.crit(); else if (hit.weapon) sfx.hitBy[hit.weapon](); else sfx.hit();
    }
    if (e.hp <= 0) this.kill(e);
  }

  // Elemental status from a hit; `baseDmg` is the hit's damage before crits.
  applyElement(e: Enemy, el: Element, baseDmg: number): void {
    const p = this.g.player;
    // fire meeting ice (either order) sets off a thermal shock
    if ((el === 'burn' && e.frostT > 0) || (el === 'frost' && e.burnT > 0)) {
      this.thermalShock(e, baseDmg);
      return;
    }
    if (el === 'burn') {
      e.burnT = EL.burnDuration;
      e.burnDps = Math.max(e.burnDps, EL.burnDps * p.dmgMul * p.elementMul);
    } else if (el === 'frost') {
      e.frostT = EL.frostDuration;
    } else {
      this.chainLightning(e, baseDmg * EL.shockDmg * p.elementMul);
    }
  }

  // Element synergy: burn + frost on one enemy explode into steam, clearing both statuses.
  private thermalShock(e: Enemy, baseDmg: number): void {
    const g = this.g, p = g.player;
    e.burnT = e.frostT = 0;
    e.burnDps = 0;
    const radius = EL.thermalRadius * p.synergyRadius;
    const dmg = (EL.thermalDmg + baseDmg) * p.elementMul * p.synergyMul;
    g.floaters.say({ x: e.pos.x, y: e.def.y + 1.2, z: e.pos.z }, t('热冲击!'));
    g.projectiles.explode(e.pos.clone(), radius, dmg, THERMAL_COLOR);
  }

  // Aura affix and menders: nearby allies take less damage, capped in total.
  private auraMul(e: Enemy): number {
    if (e.def.boss) return 1;
    let reduce = e.mended > 0 ? MEND_REDUCE : 0;
    for (const o of this.list) {
      if (o === e || o.hp <= 0 || !o.affixes.includes('aura')) continue;
      if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < AFFIX.auraRadius) reduce += AFFIX.auraReduce;
    }
    return 1 - Math.min(AFFIX.reduceMax, reduce);
  }

  // Phase affix: blink away to a spot near the player.
  private blink(e: Enemy): void {
    const g = this.g;
    e.phaseAt -= e.maxHp * AFFIX.phaseStep;
    g.fx.shockwave(e.pos.x, e.pos.z, 1.6, AFFIXES.phase.color);
    const [x, z] = g.room.findSpawn(g.player.pos, 5, e.r);
    e.pos.set(x, 0, z);
    e.vel.set(0, 0, 0);
    g.fx.burst({ x, y: 1, z }, AFFIXES.phase.color, 14, 6, 0.16, 0.4);
    sfx.blink();
  }

  // Per-frame affix effects that aren't hooked into damage or death.
  private updateAffixes(e: Enemy, dt: number, dist: number): void {
    const g = this.g;
    if (e.shieldMax > 0) {
      e.shieldIdle += dt;
      if (e.shieldIdle > AFFIX.shieldRegenDelay && e.shield < e.shieldMax) e.shield = Math.min(e.shieldMax, e.shield + e.shieldMax * dt);
      if (e.shieldMesh) {
        e.shieldMesh.visible = e.shield > 0;
        (e.shieldMesh.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.16 * e.shield / e.shieldMax;
      }
    }
    if (e.affixes.includes('tether')) {
      e.tetherT -= dt;
      if (e.tetherT <= AFFIX.tetherWarn && e.tetherT + dt > AFFIX.tetherWarn) g.ground.warn(e.pos.x, e.pos.z, AFFIX.tetherRange, AFFIX.tetherWarn, AFFIXES.tether.color);
      if (e.tetherT <= 0) {
        e.tetherT = AFFIX.tetherEvery;
        if (dist < AFFIX.tetherRange && g.player.invuln <= 0) {
          const p = g.player, d = Math.max(0.5, dist);
          p.vel.x += (e.pos.x - p.pos.x) / d * AFFIX.tetherPull;
          p.vel.z += (e.pos.z - p.pos.z) / d * AFFIX.tetherPull;
          g.fx.lightning({ x: e.pos.x, y: 1, z: e.pos.z }, { x: p.pos.x, y: 1, z: p.pos.z }, AFFIXES.tether.color);
          sfx.tether();
        }
      }
    }
  }

  update(dt: number): void {
    this.updateMarkers(dt);
    updateBossFight(this.g, dt);
    this.updateBlasts(dt);
    const g = this.g, player = g.player;
    this.rallyT -= dt;
    player.latched = this.list.filter(e => e.state === 'latch').length;
    const eaters = this.list.filter(e => e.def.parts?.special === 'darkAura' && e.hp > 0);
    const commanders = this.list.filter(e => e.affixes.includes('command'));
    const speedBonus = Math.min(BALANCE.scaling.enemySpeedMaxBonus, (g.room.n - 1) * BALANCE.scaling.enemySpeedPerRoom);

    for (const e of [...this.list]) {
      if (e.hp <= 0) continue;
      const def = e.def;
      this.updateStatus(e, dt);
      g.arsenal.updateMarks(e, dt);
      if (e.hp <= 0) continue;
      const disabled = g.arsenal.disabled(e);  // frozen solid or stunned

      const frozen = e.frostT > 0;
      const slow = (frozen ? 1 - (1 - EL.frostSlow) * (1 - def.ccResist) : 1) * g.hazards.slowAt(e.pos.x, e.pos.z);
      e.t += dt;
      if (def.boss) e.guard = Math.min(e.maxHp * GUARD.perSecond, e.guard + e.maxHp * GUARD.perSecond * dt);
      // swift affix; a commander-affix elite nearby speeds up attacks; a commander's charge speeds up everything
      const commanded = commanders.some(c => c !== e && Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < AFFIX.commandRange);
      const rally = this.rallyT > 0 && !def.boss && !def.part && !def.inert;
      const haste = (e.affixes.includes('swift') ? AFFIX.swiftMul : 1) * (commanded ? AFFIX.commandHaste : 1) * (rally ? 1.5 : 1) * frenzyMul(e) * bossHaste(e);
      e.shrouded = eaters.some(o => o !== e && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < X.darkR * (o.variant ? 0.6 + 0.4 * o.charge : 1));
      if (!disabled) e.cd -= dt * slow * haste;
      e.flash -= dt;
      e.mended -= dt;
      e.scale = 1;
      e.charge = 0;
      e.alpha = 1;

      const { toP, desired } = frame;
      toP.set(player.pos.x - e.pos.x, 0, player.pos.z - e.pos.z);
      frame.dist = toP.length() || 0.001;
      const playerDist = frame.dist;
      // phantom clones draw the enemies away from the mech
      const lure = g.clones.active ? g.clones.lure(e.pos.x, e.pos.z, playerDist) : null;
      if (lure) {
        toP.set(lure.x - e.pos.x, 0, lure.z - e.pos.z);
        frame.dist = toP.length() || 0.001;
      }
      toP.divideScalar(frame.dist);
      frame.spd = def.speed * (1 + speedBonus) * slow * haste;
      frame.dt = dt * slow * haste;
      desired.set(0, 0, 0);
      if (!disabled) BEHAVIORS[e.kind](e, frame, g);
      else {
        if (e.beam) e.beam.visible = false;  // a frozen or stunned linker/mender drops its beam
        onDisabled(e);
      }
      if (rally && !disabled && e.state === 'move') desired.copy(toP).multiplyScalar(frame.spd);
      if (e.affixes.includes('rewind')) trackRewind(e, g, dt);
      if (isGhost(e)) e.alpha = 0.45;
      if (e.affixes.includes('shadow')) e.alpha = e.state === 'wind' || e.state === 'aim' || e.flash > -0.4 ? 1 : 0.3;
      if (e.affixes.length && !disabled) { this.updateAffixes(e, dt, frame.dist); affixTick(e, g, dt); }
      if (def.boss) bossFormsTick(e, g, dt);

      // soft separation so enemies don't stack on top of each other
      // boss parts and wall blocks stay exactly where they're put
      const fixed = def.part || (def.anchored && def.speed === 0);
      for (const o of this.list) {
        if (o === e || untargetable(o) || fixed || o.def.part) continue;
        const dx = e.pos.x - o.pos.x, dz = e.pos.z - o.pos.z, d = Math.hypot(dx, dz), min = e.r + o.r;
        if (d < min && d > 0.001) {
          desired.x += dx / d * (min - d) * 8;
          desired.z += dz / d * (min - d) * 8;
        }
      }
      e.vel.multiplyScalar(Math.exp(-7 * dt));
      e.pos.x += (desired.x + e.vel.x) * dt;
      e.pos.z += (desired.z + e.vel.z) * dt;
      if (fixed) { e.vel.set(0, 0, 0); desired.set(0, 0, 0); }
      const hitWall = !fixed && g.room.collide(e.pos, e.r);
      if (hitWall) g.arsenal.onWall(e);
      if (hitWall && e.state === 'charge' && e.kind === 'brute' && e.variant && e.burst === 0) {
        // variant: bounces off the wall and charges again instead of being stunned
        e.burst = 1;
        e.dir.set(-e.dir.x, 0, -e.dir.z);
        e.stateT = 0.7;
        g.fx.shake(0.25);
      } else if (hitWall && e.state === 'charge') {
        e.burst = 0;
        e.state = 'stun';
        e.stateT = 0.8;
        g.fx.shake(0.35);
        sfx.boom();
        g.fx.burst({ x: e.pos.x, y: 0.6, z: e.pos.z }, def.color, 14, 6);
      }

      if (e.spawnT > 0) {
        e.spawnT -= dt;
        const k = 1 - Math.max(0, e.spawnT) / MATERIALIZE_TIME;
        e.scale *= k < 1 ? k * (1 + Math.sin(e.t * 60) * 0.15) : 1;  // glitchy flicker while forming
      } else if (lure && !disabled && frame.dist < e.r + 0.8 && e.kind !== 'bomber' && !untargetable(e)) {
        g.clones.hitAt(e.pos.x, e.pos.z, e.r);
      } else if (!disabled && playerDist < e.r + player.r && e.kind !== 'bomber' && !untargetable(e) && onTouch(e, g)) {
        g.damagePlayer((e.state === 'charge' ? def.dmg * 1.4 : def.dmg) * (e.elite ? ELITE.dmg : 1) * e.dmgMul, e.pos);
      }

      const floats = e.kind === 'shooter' || e.kind === 'summoner';
      e.mesh.position.set(
        e.pos.x + (e.state === 'wind' || e.state === 'fuse' ? rand(-0.08, 0.08) : 0),
        def.y + e.alt + (floats ? Math.sin(e.t * 4) * 0.15 : 0),
        e.pos.z,
      );
      if (!def.boss) {
        // a sniper's locked shot keeps pointing where it will fire; a shield faces where its shield is
        const face = (e.kind === 'sniper' && e.state === 'aim') || e.kind === 'shield' ? e.dir : toP;
        e.mesh.rotation.y = def.spins ? e.beamAngle : Math.atan2(face.x, face.z) + (e.kind === 'shooter' ? e.t * 2 : 0);
      }
      e.mesh.scale.setScalar(e.scale * e.size);
      e.mesh.visible = !INVISIBLE_STATES.has(e.state);
      vis.t = e.t;
      vis.charge = e.charge;
      vis.enraged = e.enraged;
      vis.stunned = e.state === 'stun' || e.marks.stunT > 0;
      vis.beamAngle = e.beamAngle;
      vis.beamPhase = def.spins ? e.pattern : e.beamPhase;
      vis.alpha = e.alpha;
      vis.variant = e.variant;
      if (e.kind !== 'assassin') {
        // generic see-through (shadow affix): fade the core, drop the outline
        const see = e.alpha < 0.99;
        if (see !== e.mat.transparent) { e.mat.transparent = see; e.mat.needsUpdate = true; }
        e.mat.opacity = e.alpha;
        e.visual.shell.visible = !see || e.alpha > 0.6;
      }
      e.visual.animate(dt, vis);
      this.paint(e);
    }
  }

  clear(): void {
    for (const e of this.list) this.removeVisual(e);
    for (const m of this.markers) m.rift.dispose(this.g.gfx.scene);
    this.list.length = 0;
    this.markers.length = 0;
    this.blasts.length = 0;
    this.replicas = 0;
    resetBossFight();
  }

  // End of a challenge: every enemy dissolves (still dropping its rewards) and pending rifts close.
  purge(): void {
    for (const m of this.markers) {
      if (!m.spawned) { m.spawned = true; m.rift.close(); }
    }
    this.purging = true;  // no splits or bomber blasts while the room is being wiped
    for (const e of [...this.list]) this.damage(e, e.hp + 1, { dot: true });
    this.purging = false;
  }

  private removeVisual(e: Enemy): void {
    this.g.gfx.scene.remove(e.mesh);
    e.mat.dispose();
    (e.shieldMesh?.material as THREE.Material | undefined)?.dispose();
    if (e.beam) this.g.gfx.scene.remove(e.beam);
    e.visual.dispose?.();
  }

  private updateBlasts(dt: number): void {
    const g = this.g;
    for (let i = this.blasts.length - 1; i >= 0; i--) {
      const b = this.blasts[i];
      b.t -= dt;
      if (b.t > 0) continue;
      this.blasts.splice(i, 1);
      const pos = new THREE.Vector3(b.x, 0, b.z);
      g.fx.burst({ x: b.x, y: 0.8, z: b.z }, b.color, 24, 9, 0.24, 0.5);
      g.fx.shockwave(b.x, b.z, b.r, b.color);
      g.fx.shake(0.4);
      g.gfx.flash(b.x, 2, b.z, b.color, 90);
      sfx.boom();
      g.hazards.explodeAt(pos, b.r);
      if (Math.hypot(g.player.pos.x - b.x, g.player.pos.z - b.z) < b.r + g.player.r) g.damagePlayer(b.dmg, pos);
      // the blast hurts other enemies too, which makes bombers a tool as well as a threat
      for (const e of [...this.list]) {
        const d = Math.hypot(e.pos.x - b.x, e.pos.z - b.z);
        if (d < b.r + e.r) this.damage(e, BOMBER_ENEMY_DMG, { dir: new THREE.Vector3(e.pos.x - b.x, 0, e.pos.z - b.z).normalize(), knock: 10 });
      }
    }
  }

  private updateStatus(e: Enemy, dt: number): void {
    if (e.frostT > 0) {
      e.frostT -= dt;
      if (Math.random() < dt * 6) this.g.fx.burst({ x: e.pos.x, y: e.def.y, z: e.pos.z }, 0x9ff3ff, 1, 1.5, 0.12, 0.4);
    }
    if (e.burnT > 0) {
      e.burnT -= dt;
      e.burnTick -= dt;
      if (Math.random() < dt * 10) this.g.fx.burst({ x: e.pos.x, y: e.def.y + 0.3, z: e.pos.z }, BURN_COLOR, 1, 1, 0.16, 0.35);
      if (e.burnTick <= 0) {
        e.burnTick = 0.3;
        this.damage(e, e.burnDps * 0.3, { dot: true });
      }
      if (e.burnT <= 0) e.burnDps = 0;
    }
  }

  // Lightning jumps from `from` to its nearest neighbours (`targets`, plus the superconduct bonus).
  chainLightning(from: Enemy, dmg: number, targets = EL.shockTargets): void {
    const p = this.g.player;
    const hit = this.list
      .filter(o => o !== from && o.hp > 0 && !untargetable(o) && Math.hypot(o.pos.x - from.pos.x, o.pos.z - from.pos.z) < EL.shockRange)
      .sort((a, b) => Math.hypot(a.pos.x - from.pos.x, a.pos.z - from.pos.z) - Math.hypot(b.pos.x - from.pos.x, b.pos.z - from.pos.z))
      .slice(0, targets + p.chainExtra);
    let prev = from;
    const fromPt = (e: Enemy) => ({ x: e.pos.x, y: e.def.y, z: e.pos.z });
    const spreadBurn = p.chainSpread && from.burnT > 0, spreadFrost = p.chainSpread && from.frostT > 0;
    for (const t of hit) {
      this.g.fx.lightning(fromPt(prev), fromPt(t), SHOCK_COLOR);
      // superconduct: frozen targets take double lightning damage
      const frozen = t.frostT > 0;
      this.damage(t, dmg * (frozen ? 2 : 1), { crit: frozen });
      if (t.hp > 0 && spreadBurn) this.applyElement(t, 'burn', dmg);
      if (t.hp > 0 && spreadFrost) this.applyElement(t, 'frost', dmg);
      prev = t;
    }
    if (hit.length) sfx.zap();
    else this.g.fx.burst(fromPt(from), SHOCK_COLOR, 4, 4, 0.12, 0.2);
  }

  private paint(e: Enemy): void {
    if (e.flash > 0) {
      e.mat.emissive.copy(WHITE);
      e.mat.emissiveIntensity = 2.4;
      return;
    }
    tint.copy(e.base);
    if (e.variant) tint.lerp(VARIANT_TINT, 0.65);
    if (e.marks.freezeT > 0) {
      e.mat.emissive.copy(ICE_COLOR);
      e.mat.emissiveIntensity = 2.2;
      return;
    }
    if (e.kind === 'worker' && e.owner) tint.lerp(HIVE_SHIELD, 0.5);
    if (e.marks.shred > 0) tint.lerp(SHRED_COLOR, Math.min(0.6, e.marks.shred * 0.04));
    if (e.marks.chill > 0) tint.lerp(ICE_COLOR, e.marks.chill * 0.12);
    if (e.marks.arc > 0 && Math.random() < 0.08 * e.marks.arc) this.g.fx.burst({ x: e.pos.x, y: e.def.y + 0.3, z: e.pos.z }, 0xbfd4ff, 1, 3, 0.08, 0.15);
    if (e.frostT > 0) tint.lerp(FROST_COLOR, 0.65);
    else if (e.burnT > 0) tint.lerp(BURN_TINT, 0.3);
    e.mat.emissive.copy(tint);
    e.mat.emissiveIntensity = (e.state === 'wind' ? 3 : e.enraged ? 2.3 + Math.sin(e.t * 12) * 0.6 : 1.6) * (e.shrouded ? 0.2 : 1);
  }

  private affixesOnDeath(e: Enemy): void {
    const g = this.g, a = e.affixes;
    if (a.includes('volatile')) {
      g.ground.warn(e.pos.x, e.pos.z, AFFIX.volatileRadius, AFFIX.volatileDelay, AFFIXES.volatile.color);
      this.blasts.push({ x: e.pos.x, z: e.pos.z, t: AFFIX.volatileDelay, dmg: AFFIX.volatileDmg, r: AFFIX.volatileRadius, color: AFFIXES.volatile.color });
    }
    if (a.includes('reflect')) {
      const off = Math.random();
      for (let i = 0; i < AFFIX.reflectShots; i++) g.projectiles.fireEnemy(e.pos, off + (i / AFFIX.reflectShots) * Math.PI * 2, 8, AFFIXES.reflect.color, 1);
    }
    if (a.includes('split')) {
      for (let i = 0; i < AFFIX.splitCount; i++) {
        const ang = (i / AFFIX.splitCount) * Math.PI * 2 + Math.random(), x = e.pos.x + Math.sin(ang), z = e.pos.z + Math.cos(ang);
        if (!g.room.blocked(x, z, 0.4)) this.spawn(e.kind, x, z, false, { hp: e.maxHp * AFFIX.splitHp, size: 0.75, noLoot: true, gen: 99 });
      }
    }
  }

  private updateMarkers(dt: number): void {
    const g = this.g;
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i], r = m.rift, def = ENEMIES[m.kind];
      r.update(dt, g.gfx.camera);
      if (r.open && Math.random() < dt * 25) {
        g.fx.burst({ x: r.x, y: rand(0.3, 1.6), z: r.z }, def.color, 1, 3, 0.1, 0.35);  // sparks off the tear
      }
      if (!m.spawned && r.progress >= 1) {
        m.spawned = true;
        r.close();
        // enemies with a field cap (turrets) fall back to a grunt when there are too many
        const cap = def.maxAlive, alive = cap ? this.list.filter(e => e.kind === m.kind).length : 0;
        for (let i = 0; i < m.count; i++) {
          const spread = m.count > 1 ? 1.2 : 0;
          const kind = cap && alive + i >= cap ? 'grunt' : m.kind;
          this.spawn(kind, r.x + rand(-spread, spread), r.z + rand(-spread, spread), m.elite, { hpMul: m.hpMul });
        }
        const big = !!def.boss;
        g.fx.burst({ x: r.x, y: 1, z: r.z }, def.color, big ? 50 : 14, big ? 12 : 6, big ? 0.3 : 0.16, 0.5);
        g.fx.shockwave(r.x, r.z, big ? 5 : 1.6, def.color);
        g.fx.shake(big ? 0.8 : 0.06);
        sfx.riftOpen(big);
      }
      if (r.done) {
        r.dispose(g.gfx.scene);
        this.markers.splice(i, 1);
      }
    }
  }

  kill(e: Enemy): void {
    const g = this.g, def = e.def, big = !!def.boss;
    g.fx.derez(e.visual.shell, def.color);
    this.removeVisual(e);
    this.list.splice(this.list.indexOf(e), 1);
    // a boss takes its plates, segments and clones with it; a lost part may cost the boss
    for (const p of this.list.filter(p => p.owner === e && (p.def.part || p.def.bound))) { p.noLoot = true; p.owner = null; this.kill(p); }
    onKilled(e, g);
    if (e.owner) bossPartLost(e, g);
    if (e.link) {
      // the other linker loses its beam and goes berserk (a triangle loses the beams to and from it)
      for (const o of this.list) if (o.link === e) { o.link = null; o.enraged = true; }
      if (!e.variant) { e.link.link = null; e.link.enraged = true; }
      e.link = null;
    }

    if (e.kind === 'bomber' && !this.purging) this.blasts.push({ x: e.pos.x, z: e.pos.z, t: 0.06, dmg: def.dmg * (e.elite ? ELITE.dmg : 1), r: BOMBER_RADIUS, color: def.color });
    if (!this.purging) {
      partsOnDeath(e, g);
      this.affixesOnDeath(e);
    }
    if (e.kind === 'splitter' && !this.purging) {
      // splits into a small swarm (variant: into bombers)
      for (let i = 0, n = e.variant ? 2 : e.elite ? 5 : 3; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.spawn(e.variant ? 'bomber' : 'swarmer', e.pos.x + Math.sin(a) * 0.8, e.pos.z + Math.cos(a) * 0.8);
      }
    }
    if (e.kind === 'swarmer' && e.variant && !this.purging) g.ground.bomb(e.pos.x, e.pos.z, 1, 0.6, 8, 0xffb060);  // variant: a spark
    if (!this.purging) { abyssOnDeath(e, g); lawOnKill(e, g); }

    const bits = big ? 80 : e.kind === 'brute' ? 30 : e.kind === 'swarmer' ? 7 : 16;
    g.fx.burst({ x: e.pos.x, y: def.y, z: e.pos.z }, def.color, bits, big ? 16 : 9, big ? 0.4 : 0.22, big ? 1.2 : 0.6);
    g.fx.shake(big ? 1.2 : 0.2);
    g.fx.hitstop(big ? 0.25 : 0.03);
    if (big) sfx.boom(); else sfx.kill();

    if (e.noLoot) {
      g.onEnemyKilled(e);
      return;
    }
    if (Math.random() < def.dropChance * BALANCE.orbs.dropMul + (e.elite ? BALANCE.orbs.eliteBonus : 0)) {
      const spread = def.dropCount > 1 ? 1.5 : 0;
      for (let i = 0; i < def.dropCount; i++) g.pickups.spawnOrb(e.pos.x + rand(-spread, spread), e.pos.z + rand(-spread, spread));
    }
    const coins = Math.round(rand(def.coins[0], def.coins[1]) * (e.elite ? ELITE.reward : 1) * rewardMul());
    if (coins > 0) g.pickups.spawnCoins(e.pos.x, e.pos.z, coins);
    if (big) bossDied(e, g);
    if (big && !this.bosses.length) {
      g.hud.showBossBar(false);
      g.gfx.flash(e.pos.x, 3, e.pos.z, 0xff3366, 200);
    }
    g.onEnemyKilled(e);
  }
}
