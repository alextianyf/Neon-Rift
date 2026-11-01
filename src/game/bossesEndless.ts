import * as THREE from 'three';
import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import { rand } from '../core/math';
import type { EnemyKind } from '../data/enemies';
import type { AIFrame } from './enemyAI';
import { sight } from './enemyParts';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { raiseWall } from './partsEndless';

// The endless-mode bosses (docs/敌人.md): Echo (sector 20), Eclipse Eye (30), Siege Fortress (40),
// Parasite Brood (50) and the Rift Origin (60, then every 20 sectors).

type Behavior = (e: Enemy, f: AIFrame, g: Game) => void;

const DATA = new WeakMap<Enemy, unknown>();
function data<T>(e: Enemy, make: () => T): T {
  let d = DATA.get(e) as T | undefined;
  if (!d) { d = make(); DATA.set(e, d); }
  return d;
}

function enrage(e: Enemy, g: Game, msg: string): boolean {
  if (e.enraged || e.hp >= e.maxHp * 0.5) return false;
  e.enraged = true;
  g.hud.toast(msg);
  g.fx.shake(0.8);
  return true;
}

const toward = (e: { pos: THREE.Vector3 }, g: Game) => Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

function ring(g: Game, at: { x: number; z: number }, n: number, speed: number, color: number, offset = Math.random(), gap = 0, gapAt = 0): void {
  for (let i = 0; i < n; i++) {
    if (gap && ((i - gapAt + n) % n) < gap) continue;
    g.projectiles.fireEnemy(at, offset + (i / n) * Math.PI * 2, speed, color, 1.2);
  }
}

function spawnOwned(owner: Enemy, g: Game, kind: EnemyKind, x: number, z: number, hpFrac: number): Enemy {
  g.enemies.spawn(kind, x, z, false, { hp: owner.maxHp * hpFrac, owner, noLoot: true, plain: true });
  const p = g.enemies.list[g.enemies.list.length - 1];
  p.spawnT = 0;
  return p;
}

// Rewind to where it was `ago` seconds back (and that HP, capped).
interface Track { hist: { t: number; x: number; z: number; hp: number }[] }
function track(e: Enemy, d: Track): void {
  const last = d.hist[d.hist.length - 1];
  if (!last || e.t - last.t > 0.1) d.hist.push({ t: e.t, x: e.pos.x, z: e.pos.z, hp: e.hp });
  while (d.hist.length && e.t - d.hist[0].t > 4.5) d.hist.shift();
}

// ---------------------------------------------------------------------------------------------
// Echo: replays your own recent path as damaging afterimages, fires rings on a beat, rewinds.

const EC = { record: 4, every: 8, trail: 2, trailDmg: 15, beat: 0.5, rings: 6, ringShots: 20, gap: 4, healCap: 0.08 };
interface Echo { path: { x: number; z: number }[]; i: number; trail: { x: number; z: number; t: number }[] }
interface EchoData extends Track { player: { x: number; z: number }[]; echoes: Echo[]; echoT: number; rewinds: number[]; beats: number; beatT: number; gapAt: number }

const echoBoss: Behavior = (e, f, g) => {
  const d = data<EchoData>(e, () => ({ hist: [], player: [], echoes: [], echoT: EC.every * 0.5, rewinds: [0.5, 0.25], beats: 0, beatT: 0, gapAt: 0 }));
  enrage(e, g, t('回声叠加！'));
  track(e, d);
  // the player's path, sampled every 0.1 s for 4 s
  d.player.push({ x: g.player.pos.x, z: g.player.pos.z });
  if (d.player.length > EC.record / f.dt + 5) d.player.shift();

  const { toP, dist, spd, desired } = f;
  if (dist > 9) desired.copy(toP).multiplyScalar(spd);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * 0.7);

  // rewind at 50% and 25%: back 3 s, healing at most 8%
  const next = d.rewinds[0];
  if (next !== undefined && e.hp < e.maxHp * next) {
    d.rewinds.shift();
    const old = d.hist.find(h => e.t - h.t <= 3) ?? d.hist[0];
    if (old) {
      g.fx.shockwave(e.pos.x, e.pos.z, 3, e.def.color);
      e.pos.set(old.x, 0, old.z);
      e.hp = Math.min(Math.max(e.hp, old.hp), e.hp + e.maxHp * EC.healCap);
      g.floaters.say({ x: old.x, y: 3, z: old.z }, t('回溯'));
      sfx.blink();
    }
  }

  // echoes: afterimages walking your old path, leaving a trail that hurts
  d.echoT -= f.dt;
  if (d.echoT <= 0 && d.player.length > 10) {
    d.echoT = EC.every;
    d.echoes.push({ path: [...d.player], i: 0, trail: [] });
    if (e.enraged) d.echoes.push({ path: d.player.slice(Math.floor(d.player.length / 2)), i: 0, trail: [] });
    sfx.riftOpen(false);
  }
  const p = g.player;
  for (let k = d.echoes.length - 1; k >= 0; k--) {
    const ec = d.echoes[k];
    const at = ec.path[Math.min(ec.path.length - 1, ec.i)];
    if (ec.i < ec.path.length) {
      ec.trail.push({ x: at.x, z: at.z, t: e.t });
      g.fx.mote({ x: at.x, y: 0.6, z: at.z }, e.def.color, 0.35, EC.trail);
      ec.i++;
    }
    ec.trail = ec.trail.filter(tr => e.t - tr.t < EC.trail);
    if (!ec.trail.length && ec.i >= ec.path.length) { d.echoes.splice(k, 1); continue; }
    if (ec.trail.some(tr => Math.hypot(tr.x - p.pos.x, tr.z - p.pos.z) < 0.5 + p.r * 0.5)) g.damagePlayer(EC.trailDmg, null);
  }

  // beat rings with a gap that shifts every beat
  if (d.beats > 0) {
    d.beatT -= f.dt;
    if (d.beatT <= 0) {
      d.beatT = EC.beat;
      d.beats--;
      d.gapAt = (d.gapAt + 3 + Math.floor(Math.random() * 3)) % EC.ringShots;
      ring(g, e.pos, EC.ringShots, 6, e.def.color, 0, EC.gap, d.gapAt);
      sfx.enemyShot();
    }
    return;
  }
  if (e.cd > 0) return;
  e.cd = e.enraged ? 2 : 2.8;
  if (e.pattern++ % 2 === 0) { d.beats = EC.rings; d.beatT = 0; }
  else {
    // three sound nodes go off together
    for (let i = 0; i < 3; i++) {
      const x = p.pos.x + rand(-4, 4), z = p.pos.z + rand(-4, 4);
      if (!g.room.blocked(x, z, 0.5)) g.ground.bomb(x, z, 2, 1.5, e.def.dmg * 0.7, e.def.color);
    }
  }
};

// ---------------------------------------------------------------------------------------------
// Eclipse Eye: the arena goes dark; a cone of sight sweeps the floor. Stay in it too long and it
// locks on and fires. Pillars cast shadows you can hide in. Hitting it while it looks at you hurts it more.

const EY = { cone: Math.PI / 6, reach: 18, sweep: 0.5, lockAfter: 0.6, lockWarn: 0.8, closeTime: 3 };
interface EyeData { cones: THREE.Mesh[]; angle: number; seen: number; closed: number; looking: boolean }

function eyeCone(g: Game): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(EY.reach, 24, -EY.cone, EY.cone * 2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xb08cff, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  m.position.y = 0.05;
  g.gfx.scene.add(m);
  return m;
}

const eye: Behavior = (e, f, g) => {
  const d = data<EyeData>(e, () => ({ cones: [eyeCone(g)], angle: toward(e, g), seen: 0, closed: 0, looking: false }));
  if (enrage(e, g, t('双重凝视！'))) d.cones.push(eyeCone(g));
  g.ambientDark = Math.max(g.ambientDark, 0.8);
  f.desired.set(-f.toP.z * e.side, 0, f.toP.x * e.side).multiplyScalar(f.spd * 0.5);
  d.closed -= f.dt;
  const open = d.closed <= 0;
  e.beamPhase = open ? 1 : 0;
  d.angle += EY.sweep * f.dt;
  const p = g.player, pa = toward(e, g), pd = f.dist;
  d.looking = false;
  d.cones.forEach((c, i) => {
    const a = d.angle + i * Math.PI;
    c.visible = open;
    c.position.set(e.pos.x, 0.05, e.pos.z);
    c.rotation.y = a - Math.PI / 2;
    if (open && pd < EY.reach && Math.abs(wrap(pa - a)) < EY.cone && sight(g, e.pos.x, e.pos.z, p.pos.x, p.pos.z)) d.looking = true;
  });
  e.charge = d.looking ? Math.min(1, d.seen / EY.lockAfter) : 0;
  if (d.looking && !g.lasers.busy(e)) {
    d.seen += f.dt;
    if (d.seen >= EY.lockAfter) {
      d.seen = 0;
      g.lasers.fire({ owner: e, angle: pa, warn: EY.lockWarn, dur: 0.6, dmg: e.def.dmg, color: 0xc8a0ff, width: 0.8, offset: 2, len: EY.reach + 4 });
    }
  } else if (!d.looking) d.seen = Math.max(0, d.seen - f.dt);

  if (e.cd > 0 || g.lasers.busy(e)) return;
  e.cd = e.enraged ? 4 : 5;
  if (e.pattern++ % 2 === 0) {
    // closes for 3 s (takes half damage) and calls light eaters and divers
    d.closed = EY.closeTime;
    for (const k of ['lightEater', 'diver'] as EnemyKind[]) {
      const [x, z] = g.room.findSpawn(p.pos, 6, 0.7);
      g.enemies.addMarker(k, x, z, 0.8);
    }
  } else {
    // pupil burst: the room flashes, then a ring of shots
    g.gfx.flash(e.pos.x, 4, e.pos.z, 0xffffff, 400);
    g.ambientDark = 0;
    ring(g, e.pos, 24, 7, 0xc8a0ff);
    sfx.riftOpen(true);
  }
};

// ---------------------------------------------------------------------------------------------
// Siege Fortress: parked at the far wall with four turrets; the core is shielded until two fall.
// Fallen turrets are rebuilt once, after 20 s. At half HP it stands up and walks.

type Role = 'mortar' | 'gun' | 'walls' | 'missiles';
const ROLES: Role[] = ['mortar', 'gun', 'walls', 'missiles'];
const FO = { turretHp: 0.08, rebuild: 20, shockEvery: 10, stepEvery: 1.2 };
interface Slot { role: Role; turret: Enemy | null; rebuilt: boolean; gone: boolean; down: number; cd: number; burst: number }
interface FortData { slots: Slot[]; shockT: number; stepT: number }

const fortress: Behavior = (e, f, g) => {
  const d = data<FortData>(e, () => ({
    slots: ROLES.map((role, i) => ({ role, turret: null, rebuilt: false, gone: false, down: 0, cd: 1 + i * 0.7, burst: 0 })),
    shockT: FO.shockEvery, stepT: FO.stepEvery,
  }));
  enrage(e, g, t('要塞起身！'));
  const rate = e.enraged ? 1.3 : 1;
  if (e.enraged) {
    f.desired.copy(f.toP).multiplyScalar(f.spd);
    d.stepT -= f.dt;
    if (d.stepT <= 0) { d.stepT = FO.stepEvery; g.ground.shock(e.pos.x, e.pos.z, e.def.dmg * 0.5, { speed: 6, end: 5, color: e.def.color }); g.fx.shake(0.25); }
  }
  d.shockT -= f.dt;
  if (d.shockT <= 0) { d.shockT = FO.shockEvery; g.ground.shock(e.pos.x, e.pos.z, e.def.dmg * 0.6, { speed: 6, end: 12, color: e.def.color }); sfx.erupt(); }
  const p = g.player;
  d.slots.forEach((s, i) => {
    const ox = (i % 2 ? 1 : -1) * 2.4, oz = (i < 2 ? -1 : 1) * 1.6;
    if (s.turret && s.turret.hp <= 0) {
      // destroyed: rebuilt once after 20 s, gone for good the second time
      s.turret = null;
      if (s.rebuilt) s.gone = true;
      else s.down = FO.rebuild;
    }
    if (!s.turret) {
      if (s.gone || e.spawnT > 0) return;
      if (s.down > 0) {
        s.down -= f.dt;
        if (s.down > 0) return;
        s.rebuilt = true;
        g.hud.toast(t('炮台重建'));
      }
      s.turret = spawnOwned(e, g, 'turret', e.pos.x + ox, e.pos.z + oz, FO.turretHp);
      s.turret.pattern = i;
      return;
    }
    const tu = s.turret;
    tu.pos.set(e.pos.x + ox, 0, e.pos.z + oz);
    s.cd -= f.dt * rate;
    if (s.burst > 0) {
      s.burst -= f.dt;
      if (Math.random() < f.dt * 8) g.projectiles.fireEnemy(tu.pos, toward(tu, g) + rand(-0.12, 0.12), 11, 0xffb060, 1.2);
    }
    if (s.cd > 0) return;
    switch (s.role) {
      case 'mortar':
        s.cd = 3;
        for (let k = 0; k < 2; k++) g.ground.bomb(p.pos.x + rand(-2, 2) * k, p.pos.z + rand(-2, 2) * k, 1.6, 1.2, 18, 0xff8040);
        break;
      case 'gun':
        s.cd = 3;
        s.burst = 1.5;
        break;
      case 'walls':
        s.cd = 6;
        raiseWall(g, p.pos.x + rand(-3, 3), p.pos.z + rand(-3, 3), rand(-1, 1), rand(-1, 1) || 1, 3, e.maxHp * 0.02, null);
        break;
      case 'missiles':
        s.cd = 5;
        for (const side of [-1, 1]) {
          g.enemies.spawn('missile', tu.pos.x + side * 0.6, tu.pos.z, false, { hp: 1, noLoot: true, plain: true });
          const m = g.enemies.list[g.enemies.list.length - 1];
          m.spawnT = 0;
          m.partT = 0.001;
          m.beamAngle = toward(tu, g) + side * 0.8;
        }
        sfx.deploy();
        break;
    }
  });
};

function fortressShielded(e: Enemy): boolean {
  const d = DATA.get(e) as FortData | undefined;
  if (!d) return true;
  return d.slots.filter(s => !s.turret).length < 2;
}

// ---------------------------------------------------------------------------------------------
// Parasite Brood: lays egg sacs all over the arena that hatch parasites or devourers; below half
// HP it eats its own brood to heal (30% total at most).

const BR = { layEvery: 3, hatch: 6, hatchEnraged: 4, sacHp: 0.03, eatHeal: 0.03, eatCap: 0.3 };
interface BroodData { layT: number; healed: number }

const brood: Behavior = (e, f, g) => {
  const d = data<BroodData>(e, () => ({ layT: 1, healed: 0 }));
  enrage(e, g, t('母巢暴走！'));
  const { toP, dist, spd, desired } = f;
  if (dist > 10) desired.copy(toP).multiplyScalar(spd);
  else if (dist < 6) desired.copy(toP).multiplyScalar(-spd * 0.6);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * 0.6);

  d.layT -= f.dt * (e.enraged ? 2 : 1);
  if (d.layT <= 0) {
    d.layT = BR.layEvery;
    const [x, z] = g.room.findSpawn(e.pos, 3, 0.6);
    const sac = spawnOwned(e, g, 'sac', x, z, BR.sacHp);
    sac.stateT = e.enraged ? BR.hatchEnraged : BR.hatch;
  }
  // devour its own brood when hurt
  if (e.hp < e.maxHp * 0.5 && d.healed < BR.eatCap) {
    for (const o of g.enemies.list) {
      if ((o.kind !== 'parasite' && o.kind !== 'devourer') || Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > e.r + 1.5) continue;
      o.noLoot = true;
      g.enemies.kill(o);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * BR.eatHeal);
      d.healed += BR.eatHeal;
      g.floaters.say({ x: e.pos.x, y: 3, z: e.pos.z }, t('吞噬'));
      break;
    }
  }
  if (e.cd > 0 || g.lasers.busy(e)) return;
  e.cd = e.enraged ? 2.2 : 3;
  if (e.pattern++ % 2 === 0) {
    // spray a stream of parasites at the player
    const a = toward(e, g);
    for (let i = 0; i < 4; i++) {
      g.enemies.spawn('parasite', e.pos.x + Math.sin(a) * (2 + i), e.pos.z + Math.cos(a) * (2 + i), false, { noLoot: true, plain: true });
    }
    sfx.replicate();
  } else {
    // tentacles burst from the floor around the player and lash in a line
    const p = g.player.pos;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.random(), x = p.x + Math.sin(a) * 4, z = p.z + Math.cos(a) * 4;
      g.lasers.fire({ x, z, angle: Math.atan2(p.x - x, p.z - z), warn: 0.9, dur: 0.35, dmg: e.def.dmg * 0.7, color: 0x60d040, width: 0.9, len: 8 });
    }
  }
};

// Egg sac: hatches after its timer unless it's destroyed first.
const sac: Behavior = (e, f, g) => {
  e.stateT -= f.dt;
  e.charge = 1 - Math.max(0, e.stateT) / BR.hatch;
  if (e.stateT > 0) return;
  const devourers = Math.random() < 0.35;
  for (let i = 0; i < (devourers ? 2 : 3); i++) {
    const a = Math.random() * Math.PI * 2;
    g.enemies.spawn(devourers ? 'devourer' : 'parasite', e.pos.x + Math.sin(a) * 0.8, e.pos.z + Math.cos(a) * 0.8, false, { noLoot: true, plain: true });
  }
  g.fx.burst({ x: e.pos.x, y: 0.6, z: e.pos.z }, e.def.color, 16, 6, 0.18, 0.4);
  e.noLoot = true;
  e.owner = null;
  g.enemies.kill(e);
};

// ---------------------------------------------------------------------------------------------
// Rift Origin: three phases (a third of its HP each), borrowing three signature moves per phase
// from the bosses fought this run, plus its own rift collapse; phase 3 adds rift gates.

type Move = (e: Enemy, g: Game) => void;
export const SIGNATURE: Partial<Record<EnemyKind, Move>> = {
  boss: (e, g) => ring(g, e.pos, 28, 8, 0xff3377),
  boss2: (e, g) => { const a = toward(e, g) + Math.PI / 3; for (let i = 0; i < 3; i++) g.lasers.fire({ owner: e, angle: a + (i / 3) * Math.PI * 2, warn: 1, dur: 2.5, dmg: 20, color: 0xff3d9e, turn: 0.9, offset: 2 }); },
  boss3: (e) => { e.burst = 30; e.burstT = 0; },
  colossus: (e, g) => { const a = toward(e, g); for (let i = 0; i < 6; i++) g.projectiles.fireEnemy(e.pos, a + (i - 2.5) * 0.35, 4.5, 0xffd27a, 1.2, 14, 5, { split: { t: 1, n: 3, spread: 0.3 } }); },
  wyrm: (e, g) => { const p = g.player.pos; g.ground.warn(p.x, p.z, 2.2, 0.8); g.ground.bomb(p.x, p.z, 2.2, 0.8, e.def.dmg * 0.8, 0xc0603a); },
  mirrorMind: (e, g) => { const a = toward(e, g); for (let i = 0; i < 9; i++) g.projectiles.fireEnemy(e.pos, a + (i - 4) * 0.15, 10, 0xe6f0ff, 1.2); },
  echo: (e, g) => { const p = g.player.pos; for (let i = 0; i < 3; i++) g.ground.bomb(p.x + rand(-4, 4), p.z + rand(-4, 4), 2, 1.5, e.def.dmg * 0.6, 0x7fd8d0); },
  eye: (e, g) => g.lasers.fire({ owner: e, angle: toward(e, g), warn: 0.8, dur: 0.6, dmg: 26, color: 0xc8a0ff, width: 0.8, offset: 2 }),
  fortress: (e, g) => { const p = g.player.pos; for (let i = 0; i < 4; i++) g.ground.bomb(p.x + rand(-3, 3), p.z + rand(-3, 3), 1.6, 1.2, 18, 0xff8040); void e; },
  brood: (e, g) => { const a = toward(e, g); for (let i = 0; i < 4; i++) g.enemies.spawn('parasite', e.pos.x + Math.sin(a) * (2 + i), e.pos.z + Math.cos(a) * (2 + i), false, { noLoot: true, plain: true }); },
};
const OR = { phaseInvuln: 2, collapseTime: 8, collapseTo: 0.5 };
interface OriginData { phase: number; invuln: number; moves: Move[]; collapse: number; walls: THREE.Mesh[] }

function originMoves(g: Game): Move[] {
  const fought = [...new Set(g.bossLog.map(b => b.kind))].filter(k => SIGNATURE[k]);
  const pool = fought.length >= 3 ? fought : [...fought, ...(['boss', 'boss2', 'boss3'] as EnemyKind[]).filter(k => !fought.includes(k))];
  const out: Move[] = [];
  while (out.length < 3 && pool.length) out.push(SIGNATURE[pool.splice(Math.floor(Math.random() * pool.length), 1)[0]]!);
  return out;
}

const origin: Behavior = (e, f, g) => {
  const d = data<OriginData>(e, () => ({ phase: 0, invuln: 0, moves: originMoves(g), collapse: 0, walls: [] }));
  // the epoch Origin has four phases (a quarter of its HP each); the last uses two moves at a time
  const epoch = !!g.room.bossPlan?.epoch, phases = epoch ? 4 : 3;
  const phase = Math.min(phases - 1, Math.floor((1 - Math.max(0, e.hp) / e.maxHp) * phases));
  if (phase > d.phase) {
    d.phase = phase;
    d.invuln = OR.phaseInvuln;
    d.moves = originMoves(g);
    g.ground.shock(e.pos.x, e.pos.z, e.def.dmg * 0.6, { speed: 8, end: 16, color: e.def.color });
    g.hud.toast(t('{b} · 第 {n} 阶段', { b: e.def.name, n: phase + 1 }));
    g.fx.shake(1);
    if (phase === phases - 1 && epoch) g.hud.toast(t('纪元首领 · 最终阶段'));
    if (phase === 2) {
      // phase 3: two fixed rift gate pairs
      const hw = g.room.hw * 0.6, hh = g.room.hh * 0.6;
      g.portals.open(-hw, -hh, hw, hh, 999);
      g.portals.open(hw, -hh, -hw, hh, 999);
    }
  }
  d.invuln -= f.dt;
  const { toP, dist, spd, desired } = f;
  if (dist > 10) desired.copy(toP).multiplyScalar(spd);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * 0.6);

  // its own move: the rift walls close in to half the arena for 8 s
  if (d.collapse > 0) {
    d.collapse -= f.dt;
    const k = Math.min(1, (OR.collapseTime - d.collapse) / 2, d.collapse / 1.5);
    const hw = g.room.hw * (1 - (1 - OR.collapseTo) * k), hh = g.room.hh * (1 - (1 - OR.collapseTo) * k);
    if (!d.walls.length) {
      for (let i = 0; i < 4; i++) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(e.def.color).multiplyScalar(1.6), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
        g.gfx.scene.add(w);
        d.walls.push(w);
      }
    }
    const [n, s, w, ea] = d.walls;
    n.position.set(0, 1, -hh); n.scale.set(hw * 2, 1, 0.3);
    s.position.set(0, 1, hh); s.scale.set(hw * 2, 1, 0.3);
    w.position.set(-hw, 1, 0); w.scale.set(0.3, 1, hh * 2);
    ea.position.set(hw, 1, 0); ea.scale.set(0.3, 1, hh * 2);
    const p = g.player.pos;
    if (Math.abs(p.x) > hw - 0.3 || Math.abs(p.z) > hh - 0.3) g.damagePlayer(e.def.dmg * 0.5, null);
    if (d.collapse <= 0) { for (const m of d.walls) { g.gfx.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); } d.walls = []; }
  }

  // borrowed spiral (from the sovereign)
  if (e.burst > 0) {
    e.burstT -= f.dt;
    if (e.burstT <= 0) {
      e.burstT = 0.09;
      e.burst--;
      e.beamAngle += 0.27;
      for (let i = 0; i < 4; i++) g.projectiles.fireEnemy(e.pos, e.beamAngle + (i / 4) * Math.PI * 2, 8, 0xc77dff, 1.4);
    }
  }
  if (e.cd > 0 || g.lasers.busy(e) || e.burst > 0) return;
  e.cd = 2.6 - phase * 0.4;
  const pick = e.pattern++ % 4;
  if (pick === 3) {
    if (d.collapse <= 0) { d.collapse = OR.collapseTime; g.hud.toast(t('裂隙崩塌！')); sfx.riftOpen(true); }
  } else {
    d.moves[pick % d.moves.length]?.(e, g);
    if (epoch && phase === 3) d.moves[(pick + 1) % d.moves.length]?.(e, g);
  }
};

function originInvuln(e: Enemy): boolean {
  return ((DATA.get(e) as OriginData | undefined)?.invuln ?? 0) > 0;
}

// Boss pieces placed by their owner.
const part: Behavior = () => {};

export const ENDLESS_BOSS_AI: Partial<Record<EnemyKind, Behavior>> = { echo: echoBoss, eye, fortress, brood, origin, turret: part, sac };

// Damage multipliers from the endless bosses' own mechanics.
export function endlessTakenMul(e: Enemy, g: Game): number {
  switch (e.kind) {
    case 'eye': {
      const d = DATA.get(e) as EyeData | undefined;
      if (!d) return 1;
      if (d.closed > 0) return 0.5;
      return d.looking ? 1.5 : 1;  // risky but rewarding: shooting it while it stares at you
    }
    case 'fortress':
      if (fortressShielded(e)) { g.fx.burst({ x: e.pos.x, y: 2, z: e.pos.z }, 0x6cb8ff, 2, 3, 0.1, 0.2); return 0; }
      return 1;
    case 'origin':
      return originInvuln(e) ? 0 : 1;
  }
  return 1;
}

// Clean up meshes a boss left in the scene.
export function endlessBossDied(e: Enemy, g: Game): void {
  const d = DATA.get(e) as Partial<EyeData & OriginData> | undefined;
  for (const m of [...(d?.cones ?? []), ...(d?.walls ?? [])]) g.gfx.scene.remove(m);
  if (e.kind === 'origin') g.portals.clear();
}
