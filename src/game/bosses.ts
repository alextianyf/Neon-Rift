import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import { rand } from '../core/math';
import type { EnemyKind } from '../data/enemies';
import type { WeaponId } from '../data/weapons';
import type { AIFrame } from './enemyAI';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { endlessBossDied, endlessTakenMul } from './bossesEndless';
import { formShielded } from './bossForms';

// Newer bosses (docs/敌人.md). Bosses made of several pieces (prism plates, wyrm segments, fortress
// turrets) spawn those pieces as separate enemies with `owner` set: the boss places them every frame,
// they share its damage guard, and they die with it.

type Behavior = (e: Enemy, f: AIFrame, g: Game) => void;

// Per-boss state that doesn't fit the shared enemy fields.
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

function spawnPart(owner: Enemy, g: Game, kind: EnemyKind, x: number, z: number, hpFrac: number): Enemy {
  g.enemies.spawn(kind, x, z, false, { hp: owner.maxHp * hpFrac, owner, noLoot: true, plain: true });
  const p = g.enemies.list[g.enemies.list.length - 1];
  p.spawnT = 0;
  return p;
}

const toward = (e: Enemy, g: Game) => Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z);

// ---------------------------------------------------------------------------------------------
// Prism Colossus: orbiting prism plates bounce shots back; only the gaps let shots reach the core.

const C = {
  slots: 8,            // plates sit in 8 slots around it; two opposite slots stay empty (the gaps)
  gaps: [0, 4],
  outerR: 3.1,
  innerR: 2.2,
  outerTurn: 0.7,
  innerTurn: -0.9,
  plateHp: 0.04,       // of the boss's max HP
  regrow: 8,
  beamWarn: 1,
  beamDur: 1.5,
  beamDmg: 22,
  beamTurn: 0.35,      // enraged: the beam sweeps
  flyTime: 2.2,
  flyDist: 9,
  orbs: 6,
};

interface PlateSlot { plate: Enemy | null; regrow: number; inner: boolean; at: number }
interface ColossusData { slots: PlateSlot[]; outer: number; inner: number; fly: number; fx: number; fz: number }

const colossus: Behavior = (e, f, g) => {
  const d = data<ColossusData>(e, () => ({
    slots: Array.from({ length: C.slots }, (_, i) => i).filter(i => !C.gaps.includes(i))
      .map(i => ({ plate: null, regrow: 0, inner: false, at: (i / C.slots) * Math.PI * 2 })),
    outer: 0, inner: 0, fly: 0, fx: 0, fz: 0,
  }));
  if (enrage(e, g, t('棱镜共振！'))) {
    // a second, inner ring turning the other way
    for (let i = 0; i < 4; i++) d.slots.push({ plate: null, regrow: 0, inner: true, at: (i / 4) * Math.PI * 2 + Math.PI / 4 });
  }
  d.outer += C.outerTurn * f.dt;
  d.inner += C.innerTurn * f.dt;
  if (d.fly > 0) d.fly = Math.max(0, d.fly - f.dt);
  const out = d.fly > 0 ? Math.sin(Math.PI * (1 - d.fly / C.flyTime)) * C.flyDist : 0;
  for (const s of d.slots) {
    if (s.plate && s.plate.hp <= 0) { s.plate = null; s.regrow = C.regrow; }
    if (!s.plate) {
      s.regrow -= f.dt;
      if (s.regrow > 0 || e.spawnT > 0) continue;
      s.plate = spawnPart(e, g, 'prismPlate', e.pos.x, e.pos.z, C.plateHp);
      g.fx.burst({ x: e.pos.x, y: 1.2, z: e.pos.z }, e.def.color, 8, 4, 0.14, 0.3);
    }
    const a = (s.inner ? d.inner : d.outer) + s.at, r = s.inner ? C.innerR : C.outerR;
    const fly = s.inner ? 0 : out;
    s.plate.pos.set(e.pos.x + Math.sin(a) * r + d.fx * fly, 0, e.pos.z + Math.cos(a) * r + d.fz * fly);
    s.plate.beamAngle = a;  // faces outward
  }

  const { toP, dist, spd, desired } = f;
  if (dist > 10) desired.copy(toP).multiplyScalar(spd);
  else if (dist < 7) desired.copy(toP).multiplyScalar(-spd * 0.6);
  else desired.set(-toP.z, 0, toP.x).multiplyScalar(spd * 0.5);
  if (g.lasers.busy(e) || d.fly > 0) { desired.multiplyScalar(0.3); return; }

  if (e.cd > 0) return;
  const pattern = e.pattern++ % 3;
  if (pattern === 0) {
    g.lasers.fire({ owner: e, angle: toward(e, g), warn: C.beamWarn, dur: C.beamDur, dmg: C.beamDmg, color: 0xf0a030, width: 0.6, offset: 1.5, turn: e.enraged ? C.beamTurn * (Math.random() < 0.5 ? -1 : 1) : 0 });
  } else if (pattern === 1) {
    // every plate in the outer ring flies at the player and back, like six discs
    d.fly = C.flyTime;
    d.fx = toP.x;
    d.fz = toP.z;
    sfx.deploy();
  } else {
    // slow orbs that each burst into three
    const a = toward(e, g);
    for (let i = 0; i < C.orbs; i++) {
      g.projectiles.fireEnemy(e.pos, a + (i - (C.orbs - 1) / 2) * 0.35, 4.5, 0xffd27a, 1.2, 14, 5, { split: { t: 1, n: 3, spread: 0.3 } });
    }
    sfx.enemyShot();
  }
  e.cd = e.enraged ? 1.9 : 2.5;
};

// ---------------------------------------------------------------------------------------------
// Burrow Wyrm: a head and ten body segments that follow its trail. Segments can be shot off.

const W = {
  segs: 10,
  gap: 1.15,
  segHp: 0.06,
  segLoss: 0.03,        // extra boss HP lost when a segment is destroyed
  chargeWarn: 1,
  chargeSpeed: 22,
  chargeTime: 1.6,
  diveTime: 0.5,
  underTime: 1.3,
  riseTime: 0.8,
  eruptR: 2.2,
  eruptShots: 14,
  volleyGap: 0.07,
  rage: 1.3,
  acidEvery: 0.15,      // enraged: one segment drips per tick, round robin
};

interface WyrmData { hist: { x: number; z: number }[]; segs: Enemy[]; acidT: number; acidI: number }

function placeSegments(e: Enemy, d: WyrmData): void {
  const h = d.hist;
  let i = h.length - 1, acc = 0, px = e.pos.x, pz = e.pos.z;
  d.segs.forEach((s, k) => {
    const want = (k + 1) * W.gap;
    while (i >= 0) {
      const step = Math.hypot(h[i].x - px, h[i].z - pz);
      if (acc + step >= want) {
        const r = (want - acc) / (step || 1);
        px += (h[i].x - px) * r;
        pz += (h[i].z - pz) * r;
        acc = want;
        break;
      }
      acc += step;
      px = h[i].x;
      pz = h[i].z;
      i--;
    }
    s.pos.set(px, 0, pz);
    s.beamAngle = Math.atan2(e.pos.x - px, e.pos.z - pz);
  });
}

const wyrm: Behavior = (e, f, g) => {
  const d = data<WyrmData>(e, () => {
    const segs: Enemy[] = [];
    for (let i = 0; i < W.segs; i++) segs.push(spawnPart(e, g, 'wyrmSeg', e.pos.x, e.pos.z, W.segHp));
    return { hist: [{ x: e.pos.x, z: e.pos.z }], segs, acidT: 0, acidI: 0 };
  });
  enrage(e, g, t('蠕虫狂暴！'));
  d.segs = d.segs.filter(s => s.hp > 0);
  e.stateT -= f.dt;
  const { toP, spd, desired } = f;
  const speed = spd * (e.enraged ? W.rage : 1);

  switch (e.state) {
    case 'move': {
      const weave = Math.sin(e.t * 2.2) * 0.6;
      desired.set(toP.x - toP.z * weave, 0, toP.z + toP.x * weave).normalize().multiplyScalar(speed);
      if (e.cd > 0) break;
      const pattern = e.pattern++ % 3;
      if (pattern === 0) {
        e.state = 'wind';
        e.stateT = W.chargeWarn;
        e.dir.copy(toP);
        g.lasers.fire({ owner: e, angle: Math.atan2(toP.x, toP.z), warn: W.chargeWarn, dur: 0.01, dmg: 0, len: 40 });
      } else if (pattern === 1) {
        e.state = 'dive';
        e.stateT = W.diveTime;
        g.arsenal.release(e);
        for (const s of d.segs) g.arsenal.release(s);
        sfx.burrow();
      } else {
        e.burst = d.segs.length;
        e.burstT = 0;
        e.cd = 2.2;
      }
      break;
    }
    case 'wind':
      e.charge = 1 - Math.max(0, e.stateT) / W.chargeWarn;
      if (e.stateT <= 0) { e.state = 'charge'; e.stateT = W.chargeTime; }
      break;
    case 'charge':  // hitting a wall stuns it (handled with the other chargers in Enemies)
      desired.copy(e.dir).multiplyScalar(W.chargeSpeed);
      if (Math.random() < 0.6) g.fx.burst({ x: e.pos.x, y: 0.4, z: e.pos.z }, e.def.color, 1, 1, 0.3, 0.3);
      if (e.stateT <= 0) { e.state = 'move'; e.cd = 1.6; }
      break;
    case 'stun':
      if (e.stateT <= 0) { e.state = 'move'; e.cd = 1.4; }
      break;
    case 'dive':
      e.scale = Math.max(0.05, e.stateT / W.diveTime);
      if (e.stateT <= 0) { e.state = 'under'; e.stateT = W.underTime; }
      break;
    case 'under':
      desired.copy(toP).multiplyScalar(speed * 2.6);
      if (Math.random() < 0.7) g.fx.burst({ x: e.pos.x + rand(-0.6, 0.6), y: 0.1, z: e.pos.z + rand(-0.6, 0.6) }, e.def.color, 1, 3, 0.16, 0.35);
      if (e.stateT <= 0 || f.dist < 1) {
        e.state = 'rise';
        e.stateT = W.riseTime;
        g.ground.warn(e.pos.x, e.pos.z, W.eruptR, W.riseTime);
      }
      break;
    case 'rise':
      if (e.stateT <= 0) {
        e.state = 'move';
        e.cd = 1.8;
        const p = g.player;
        if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < W.eruptR + p.r) g.damagePlayer(e.def.dmg, e.pos);
        const off = Math.random();
        for (let i = 0; i < W.eruptShots; i++) g.projectiles.fireEnemy(e.pos, off + (i / W.eruptShots) * Math.PI * 2, 7, e.def.color, 1);
        g.fx.shockwave(e.pos.x, e.pos.z, W.eruptR, e.def.color);
        g.fx.shake(0.5);
        sfx.erupt();
        d.hist = [{ x: e.pos.x, z: e.pos.z }];  // the body uncoils out of the hole
      }
      break;
  }

  // tail-to-head volley: one shot per segment, a wave running up the body
  if (e.burst > 0) {
    e.burstT -= f.dt;
    if (e.burstT <= 0 && d.segs.length) {
      e.burstT = W.volleyGap;
      const s = d.segs[Math.min(d.segs.length, e.burst) - 1];
      g.projectiles.fireEnemy(s.pos, toward(s, g), 9, e.def.color, 0.9);
      sfx.enemyShot();
      e.burst--;
    }
  }

  // body follows the head's trail; it is underground whenever the head is
  const last = d.hist[d.hist.length - 1];
  if (Math.hypot(e.pos.x - last.x, e.pos.z - last.z) > 0.15) {
    d.hist.push({ x: e.pos.x, z: e.pos.z });
    if (d.hist.length > 200) d.hist.shift();
  }
  placeSegments(e, d);
  const hidden = e.state === 'dive' || e.state === 'under' || e.state === 'rise';
  for (const s of d.segs) s.state = hidden ? 'under' : 'move';
  if (e.enraged && !hidden && d.segs.length) {
    d.acidT -= f.dt;
    if (d.acidT <= 0) {
      d.acidT = W.acidEvery;
      const s = d.segs[d.acidI++ % d.segs.length];
      g.ground.addPuddle(s.pos.x, s.pos.z, 0.8, 3);
    }
  }
};

// ---------------------------------------------------------------------------------------------
// Mirror Mind: copies the kind of weapon the player is holding, and splits off clones.

type Style = 'rapid' | 'spread' | 'blast' | 'beam' | 'melee';
const STYLE: Record<WeaponId, Style> = {
  pulse: 'rapid', smg: 'rapid', flame: 'rapid',
  shotgun: 'spread', prism: 'spread',
  grenade: 'blast', rocket: 'blast', swarm: 'blast', singularity: 'blast',
  rail: 'beam', arc: 'beam', frost: 'beam',
  blade: 'melee', disc: 'melee', spike: 'melee',
};
export const STYLE_NAME: Record<Style, string> = {
  rapid: t('连射'), spread: t('散射'), blast: t('爆炸'), beam: t('光束'), melee: t('近战'),
};
const M = {
  follow: 1,           // seconds after the player switches weapons
  cloneEvery: 12,
  clones: 2,
  clonesEnraged: 3,
  cd: 2.2,
  cdEnraged: 1.6,
};
interface MindData { style: Style; next: Style; switchT: number; cloneT: number }

const mirrorMind: Behavior = (e, f, g) => {
  const clone = e.kind === 'mirrorClone';
  const owner = clone ? e.owner : e;
  const held = STYLE[g.player.slots[g.player.weapon]?.id ?? 'pulse'];
  const d = data<MindData>(e, () => ({ style: held, next: held, switchT: 0, cloneT: M.cloneEvery * 0.6 }));
  if (!clone) {
    enrage(e, g, t('镜像过载！'));
    // follow the player's weapon after a short delay, and say so
    if (held !== d.next) { d.next = held; d.switchT = M.follow; }
    if (d.style !== d.next) {
      d.switchT -= f.dt;
      if (d.switchT <= 0) {
        d.style = d.next;
        g.hud.toast(t('镜像：{s}', { s: STYLE_NAME[d.style] }));
        sfx.blink();
      }
    }
    d.cloneT -= f.dt;
    if (d.cloneT <= 0) {
      d.cloneT = M.cloneEvery;
      const n = e.enraged ? M.clonesEnraged : M.clones;
      // the previous set shatters first, so clones never pile up
      for (const c of g.enemies.list.filter(c => c.owner === e && c.kind === 'mirrorClone')) g.enemies.kill(c);
      const made: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const [x, z] = g.room.findSpawn(g.player.pos, 6, e.r);
        made.push(spawnPart(e, g, 'mirrorClone', x, z, 0));
        made[i].hp = made[i].maxHp = 1;  // any hit shatters a clone
        g.fx.burst({ x, y: 1.5, z }, e.def.color, 16, 6, 0.18, 0.4);
      }
      if (e.enraged && made.length) {
        // swap places with one of its clones
        const c = made[Math.floor(Math.random() * made.length)], x = e.pos.x, z = e.pos.z;
        e.pos.copy(c.pos);
        c.pos.set(x, 0, z);
      }
      sfx.blink();
    }
  } else if (owner) {
    d.style = (data<MindData>(owner, () => d)).style;  // clones fight the way the original does
  }

  const { toP, dist, spd, desired } = f;
  e.stateT -= f.dt;
  if (e.state === 'charge') {
    desired.copy(e.dir).multiplyScalar(16);
    if (e.stateT <= 0 || dist < 2.2) {
      e.state = 'move';
      // slash around it, and spinning blades fly out
      const p = g.player;
      if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < 3 + p.r) g.damagePlayer(e.def.dmg, e.pos);
      g.fx.shockwave(e.pos.x, e.pos.z, 3, 0xe6f0ff);
      for (let i = 0; i < 6; i++) g.projectiles.fireEnemy(e.pos, (i / 6) * Math.PI * 2 + e.t, 7, 0xe6f0ff, 1);
      sfx.slash();
    }
    return;
  }
  if (e.state === 'wind') {
    e.charge = 1 - Math.max(0, e.stateT) / 0.5;
    if (e.stateT <= 0) { e.state = 'charge'; e.stateT = 0.8; }
    return;
  }
  if (dist > 9) desired.copy(toP).multiplyScalar(spd);
  else if (dist < 6) desired.copy(toP).multiplyScalar(-spd * 0.7);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * 0.7);

  if (e.burst > 0) {
    e.burstT -= f.dt;
    if (e.burstT <= 0) {
      e.burstT = 0.1;
      e.burst--;
      g.projectiles.fireEnemy(e.pos, toward(e, g) + rand(-0.06, 0.06), 13, 0xe6f0ff, 1.2);
      sfx.enemyShot();
    }
  }
  if (e.cd > 0 || g.lasers.busy(e)) return;
  e.cd = (e.enraged ? M.cdEnraged : M.cd) * (clone ? 2 : 1);  // clones attack half as often
  const a = toward(e, g), p = g.player;
  switch (d.style) {
    case 'rapid':
      e.burst = 8;
      e.burstT = 0;
      break;
    case 'spread':
      for (let i = 0; i < 9; i++) g.projectiles.fireEnemy(e.pos, a + (i - 4) * 0.15, 10, 0xe6f0ff, 1.2);
      sfx.enemyShot();
      break;
    case 'blast':
      for (let i = 0; i < 3; i++) {
        const x = p.pos.x + rand(-2.5, 2.5) * (i ? 1 : 0), z = p.pos.z + rand(-2.5, 2.5) * (i ? 1 : 0);
        if (!g.room.blocked(x, z, 0.5)) g.ground.bomb(x, z, 1.8, 1.1 + i * 0.25, e.def.dmg * 0.7, 0xe6f0ff);
      }
      break;
    case 'beam':
      g.lasers.fire({ owner: e, angle: a, warn: 0.9, dur: 0.8, dmg: 24, color: 0xc8d8ff, width: 0.5, offset: 1.4 });
      break;
    case 'melee':
      e.state = 'wind';
      e.stateT = 0.5;
      e.dir.copy(toP);
      break;
  }
};

// ---------------------------------------------------------------------------------------------
// Twin fights: when one boss falls the other enrages; if it isn't finished within 15s, the first
// one comes back once at 30% HP.

const TWIN = { revive: 15, reviveHp: 0.3 };
let pending: { kind: EnemyKind; x: number; z: number; maxHp: number; t: number } | null = null;
let revived = false;

export function updateBossFight(g: Game, dt: number): void {
  if (!pending) return;
  if (!g.enemies.bosses.length) { pending = null; return; }
  pending.t -= dt;
  if (pending.t > 0) return;
  const { kind, x, z, maxHp } = pending;
  pending = null;
  revived = true;
  g.enemies.spawn(kind, x, z, false, { hp: maxHp });
  const b = g.enemies.list[g.enemies.list.length - 1];
  b.hp = maxHp * TWIN.reviveHp;
  g.hud.toast(t('{n} 复活了！', { n: b.def.name }));
  g.fx.shockwave(x, z, 5, b.def.color);
}

export function resetBossFight(): void {
  pending = null;
  revived = false;
}

export function bossDied(e: Enemy, g: Game): void {
  if (e.owner) return;
  endlessBossDied(e, g);
  const rest = g.enemies.bosses.filter(b => b !== e && b.hp > 0);
  if (!rest.length || (g.room.bossPlan?.kinds.length ?? 1) < 2) return;
  for (const b of rest) b.enraged = true;
  g.hud.toast(t('共鸣！另一个首领狂暴了'));
  if (!revived) pending = { kind: e.kind, x: e.pos.x, z: e.pos.z, maxHp: e.maxHp, t: TWIN.revive };
}

// Boss pieces don't think: their owner places them.
const part: Behavior = () => {};

export const BOSS_AI: Partial<Record<EnemyKind, Behavior>> = {
  colossus, wyrm, mirrorMind, mirrorClone: mirrorMind, prismPlate: part, wyrmSeg: part, riftCrystal: part,
};

// A boss piece was destroyed. Wyrm segments take a chunk of the wyrm's HP with them.
export function bossPartLost(p: Enemy, g: Game): void {
  const o = p.owner;
  if (!o || o.hp <= 0) return;
  if (p.kind === 'wyrmSeg') {
    o.hp -= o.maxHp * W.segLoss;
    g.floaters.say({ x: p.pos.x, y: 1.5, z: p.pos.z }, t('体节断裂'));
    if (o.hp <= 0) g.enemies.kill(o);
  }
}

// Damage taken multiplier from a boss's own mechanics (eye facing you, eye closed...).
export function bossTakenMul(e: Enemy, g: Game): number {
  if (!e.def.boss) return 1;
  if (formShielded(e, g)) { g.fx.burst({ x: e.pos.x, y: 2, z: e.pos.z }, 0xd070ff, 2, 3, 0.1, 0.2); return 0; }
  return endlessTakenMul(e, g);
}

