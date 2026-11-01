import * as THREE from 'three';
import { GEO } from '../core/assets';
import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import { rand } from '../core/math';
import type { AttackPart, DeathPart, MovePart, SpecialPart } from '../data/enemies';
import type { AIFrame } from './enemyAI';
import type { Enemy, HitInfo } from './enemies';
import type { Game } from './game';

// Parts for the endless-strata enemies (docs/敌人.md, sectors 16-60). Same contract as enemyParts.ts:
// movement, attack, special ability, death effect. Hooks at the bottom let these enemies react to
// damage, touching the player and dying, which the shared enemy code calls for every enemy.

type Part = (e: Enemy, f: AIFrame, g: Game) => void;
interface Attack { tick?: Part; fire: Part }

export const X = {
  rewindWindow: 3,      // seconds of history a rewinder can jump back to
  rewindAt: 0.3,        // HP fraction that triggers it
  missileEvery: 4,
  missileSpeed: 4.5,
  missileTurn: 2.2,
  missileLife: 6,
  missileR: 1.5,
  iceEvery: 3,
  iceR: 2.5,
  iceLife: 6,
  quakeEvery: 3.5,
  quakeCrouch: 0.6,
  quakeSpeed: 6,
  quakeReach: 10,
  darkR: 6,
  diverAlt: 6,
  diverAir: 1.2,
  diverLock: 0.35,      // the shadow stops following this long before the drop
  diverFall: 0.25,
  diverStuck: 1.5,
  diverLift: 0.4,
  diverR: 1.8,
  workers: 5,
  workerOrphanSpeed: 0.7,
  eatTime: 1,
  eatMax: 4,
  eatGrow: 1.25,
  eatGain: 1.3,
  wallEvery: 5,
  wallLife: 8,
  wallBlocks: 3,
  wallHp: 0.5,          // of the builder's max HP, split across the blocks
  mortarNear: 14,
  mortarFar: 20,
  mortarFlee: 6,
  mortarEvery: 3,
  mortarShells: 3,
  mortarR: 1.6,
  mortarDelay: 1.2,
  stealFrac: 0.3,
  stealCoins: 10,
  thiefFlee: 8,
  mimicReveal: 2,
  latchMax: 3,
  latchDps: 4,
  ringR: 2,
  ringUp: 4,
  ringDown: 1.5,
  ringShots: 8,
  rallyEvery: 6,
  rallyWarn: 1,
  rallyTime: 1.5,
  glaiveEvery: 3,
  glaiveTime: 2.4,
  glaiveReach: 9,
  glaiveWidth: 2.2,
  gateEvery: 6,
  gateLife: 5,
  armorFrac: 0.15,
  armorAbsorb: 0.8,
  coreExposed: 1.5,
  armorTurn: 1,
};

// Per-enemy state the shared fields don't cover.
const MEM = new WeakMap<Enemy, Record<string, unknown>>();
// Each mechanic keeps its own slot (`key`), since one enemy can have several (an elite rewinder
// with the greedy affix...).
export function mem<T extends object>(e: Enemy, key: string, make: () => T): T {
  let all = MEM.get(e);
  if (!all) { all = {}; MEM.set(e, all); }
  if (!(key in all)) all[key] = make();
  return all[key] as T;
}
const peek = <T>(e: Enemy, key: string) => MEM.get(e)?.[key] as T | undefined;

const dmgOf = (e: Enemy, g: Game) => e.def.dmg * (e.elite ? g.enemies.eliteDmg : 1) * e.dmgMul;
const toward = (e: Enemy, g: Game) => Math.atan2(g.player.pos.x - e.pos.x, g.player.pos.z - e.pos.z);

function kite(e: Enemy, f: AIFrame, near: number, far: number, strafe = 0.8): void {
  const { toP, dist, spd, desired } = f;
  if (dist > far) desired.copy(toP).multiplyScalar(spd);
  else if (dist < near) desired.copy(toP).multiplyScalar(-spd);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * strafe);
}

function spawnChild(g: Game, kind: Parameters<Game['enemies']['spawn']>[0], x: number, z: number, opts: Parameters<Game['enemies']['spawn']>[4] = {}): Enemy {
  g.enemies.spawn(kind, x, z, false, { noLoot: true, plain: true, ...opts });
  return g.enemies.list[g.enemies.list.length - 1];
}

// ---------------------------------------------------------------------------------------------
// Rewind (rewinder, the "rewind" affix): keeps 3 seconds of positions and HP; the first time HP
// drops under 30% it jumps back to where (and how healthy) it was 3 seconds ago.

interface RewindMem { hist: { t: number; x: number; z: number; hp: number }[]; left: number; ghost: THREE.Mesh | null; sample: number }

export function trackRewind(e: Enemy, g: Game, dt: number, uses = 1): void {
  const m = mem<RewindMem>(e, 'rewind', () => ({ hist: [], left: uses, ghost: null, sample: 0 }));
  m.sample -= dt;
  if (m.sample <= 0) {
    m.sample = 0.1;
    m.hist.push({ t: e.t, x: e.pos.x, z: e.pos.z, hp: e.hp });
    while (m.hist.length && e.t - m.hist[0].t > X.rewindWindow) m.hist.shift();
  }
  if (m.left <= 0) { if (m.ghost) m.ghost.visible = false; return; }
  if (!m.ghost) {
    m.ghost = new THREE.Mesh(GEO.orb, new THREE.MeshBasicMaterial({ color: e.def.color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
    g.gfx.scene.add(m.ghost);
  }
  const old = m.hist[0];
  if (old) {
    m.ghost.visible = e.mesh.visible;
    m.ghost.position.set(old.x, e.def.y, old.z);
    m.ghost.scale.setScalar(e.r * 1.6);
  }
}

function tryRewind(e: Enemy, g: Game): void {
  const m = peek<RewindMem>(e, 'rewind');
  if (!m || m.left <= 0 || e.hp <= 0 || e.hp > e.maxHp * X.rewindAt || g.arsenal.disabled(e)) return;
  const old = m.hist[0];
  if (!old) return;
  m.left--;
  g.fx.burst({ x: e.pos.x, y: 1, z: e.pos.z }, e.def.color, 12, 6, 0.16, 0.35);
  e.pos.set(old.x, 0, old.z);
  e.vel.set(0, 0, 0);
  e.hp = Math.max(e.hp, old.hp);
  g.arsenal.release(e);
  g.fx.shockwave(old.x, old.z, 1.5, e.def.color);
  g.floaters.say({ x: old.x, y: 2, z: old.z }, t('回溯'));
  sfx.blink();
}

// ---------------------------------------------------------------------------------------------
// Movement

export const ENDLESS_MOVES: Partial<Record<MovePart, Part>> = {
  kite(e, f) { kite(e, f, 7, 11); },

  // Missiles: turn toward the player at a limited rate.
  home(e, f, g) {
    if (e.partT === 0) e.beamAngle = toward(e, g);
    const want = toward(e, g), d = Math.atan2(Math.sin(want - e.beamAngle), Math.cos(want - e.beamAngle));
    e.beamAngle += Math.max(-X.missileTurn * f.dt, Math.min(X.missileTurn * f.dt, d));
    f.desired.set(Math.sin(e.beamAngle), 0, Math.cos(e.beamAngle)).multiplyScalar(X.missileSpeed);
  },

  weave(e, f) {
    const o = e.owner;
    if (e.variant && o && o.hp > 0) {
      // variant: the workers form a ring around their core and circle it
      const a = e.beamAngle + e.t * 1.2, tx = o.pos.x + Math.sin(a) * 2.2, tz = o.pos.z + Math.cos(a) * 2.2;
      f.desired.set(tx - e.pos.x, 0, tz - e.pos.z).multiplyScalar(6);
      return;
    }
    const { toP, desired } = f, spd = f.spd * (e.gen ? X.workerOrphanSpeed : 1);
    const w = Math.sin(e.t * 7 + e.side * 2) * 0.6;
    desired.set(toP.x - toP.z * w, 0, toP.z + toP.x * w).normalize().multiplyScalar(spd);
  },

  // Diver: high in the air (can't be hit) while its shadow tracks the player, then drops onto it,
  // sticks in the floor for a moment, and takes off again.
  swoop(e, f, g) {
    const m = mem(e, 'diver', () => ({ tx: g.player.pos.x, tz: g.player.pos.z, shadow: null as THREE.Mesh | null }));
    if (!m.shadow) {
      m.shadow = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
      g.gfx.scene.add(m.shadow);
      e.state = 'air';
      e.stateT = X.diverAir;
      e.alt = X.diverAlt;
    }
    e.stateT -= f.dt;
    const p = g.player.pos;
    switch (e.state) {
      case 'air': {
        if (e.stateT > X.diverLock) {
          const k = 1 - Math.exp(-4 * f.dt);
          m.tx += (p.x - m.tx) * k;
          m.tz += (p.z - m.tz) * k;
        }
        e.pos.set(m.tx, 0, m.tz);  // hovers right above its shadow
        const grow = 1 - Math.max(0, e.stateT) / X.diverAir;
        m.shadow.visible = true;
        m.shadow.position.set(m.tx, 0.03, m.tz);
        m.shadow.scale.set(X.diverR * (0.4 + 0.6 * grow), 0.01, X.diverR * (0.4 + 0.6 * grow));
        if (e.stateT <= 0) { e.state = 'slam'; e.stateT = X.diverFall; }
        break;
      }
      case 'slam':
        e.alt = X.diverAlt * Math.max(0, e.stateT / X.diverFall);
        if (e.stateT <= 0) {
          e.alt = 0;
          m.shadow.visible = false;
          const pl = g.player;
          if (Math.hypot(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z) < X.diverR + pl.r) g.damagePlayer(dmgOf(e, g), e.pos);
          g.fx.shockwave(e.pos.x, e.pos.z, X.diverR, e.def.color);
          g.fx.shake(0.3);
          sfx.erupt();
          e.state = 'stuck';
          // variant: the first drop only pauses for a beat before the second
          const second = e.variant && !e.burst;
          e.burst = second ? 1 : 0;
          e.stateT = second ? 0.25 : X.diverStuck;
        }
        break;
      case 'stuck':
        if (e.stateT <= 0) { e.state = 'lift'; e.stateT = X.diverLift; g.arsenal.release(e); }
        break;
      case 'lift':
        e.alt = X.diverAlt * (1 - Math.max(0, e.stateT) / X.diverLift);
        if (e.stateT <= 0) { e.state = 'air'; e.stateT = e.burst ? X.diverAir * 0.6 : X.diverAir; m.tx = e.pos.x; m.tz = e.pos.z; }
        break;
      default:
        e.state = 'air';
        e.stateT = X.diverAir;
    }
  },

  // Devourer: walks to the weakest ally nearby and eats it; with nothing to eat, goes for the player.
  forage(e, f, g) {
    e.stateT -= f.dt;
    if (e.state === 'eat') return;  // standing still, chewing (see the devour attack)
    const prey = preyFor(e, g, 10);
    if (!prey || e.gen >= X.eatMax) { f.desired.copy(f.toP).multiplyScalar(f.spd); return; }
    const dx = prey.pos.x - e.pos.x, dz = prey.pos.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d < e.r + prey.r + 0.4) {
      e.state = 'eat';
      e.stateT = X.eatTime;
      mem(e, 'prey', () => ({ prey: null as Enemy | null })).prey = prey;
      return;
    }
    f.desired.set(dx / d, 0, dz / d).multiplyScalar(f.spd);
  },

  // Mortar: keeps far away, and runs if the player closes in.
  artillery(e, f) {
    if (f.dist < X.mortarFlee) f.desired.copy(f.toP).multiplyScalar(-f.spd * 1.4);
    else kite(e, f, X.mortarNear, X.mortarFar, 0.5);
  },

  // Thief: rushes in; once it has stolen something it runs, and escapes after 8 seconds.
  thieve(e, f, g) {
    e.charge = e.state === 'flee' ? 1 : 0;  // the loot pack on its back lights up
    if (e.state !== 'flee') { f.desired.copy(f.toP).multiplyScalar(f.spd); return; }
    e.stateT -= f.dt;
    f.desired.copy(f.toP).multiplyScalar(-f.spd);
    if (e.stateT <= 0) {
      // slips into a rift with the loot
      g.fx.burst({ x: e.pos.x, y: 1, z: e.pos.z }, e.def.color, 16, 6, 0.18, 0.4);
      g.hud.toast(t('窃能者逃走了'));
      e.noLoot = true;
      mem(e, 'loot', () => ({ loot: null as Loot | null })).loot = null;
      g.enemies.kill(e);
    }
  },

  // Mimic: sits still disguised as a health orb until the player comes close (or shoots it).
  lurk(e, f, g) {
    if (e.state === 'disguise') {
      e.partT += f.dt;
      if (f.dist < X.mimicReveal) reveal(e, g, true);
      return;
    }
    f.desired.copy(f.toP).multiplyScalar(f.spd);
  },

  // Parasite: rushes the player and rides on the mech once it touches (see onTouch).
  latch(e, f, g) {
    if (e.state !== 'latch') { f.desired.copy(f.toP).multiplyScalar(f.spd); return; }
    const p = g.player.pos, a = e.side * 2 + e.gen * 2.1;
    e.pos.set(p.x + Math.sin(a) * 0.55, 0, p.z + Math.cos(a) * 0.55);
    e.vel.set(0, 0, 0);
    g.drainPlayer(dmgOf(e, g) * f.dt);
    e.partT += f.dt;
    if (!e.variant && e.partT > 6) {
      // gorged: it lets go by itself (and is dazed), so a sector can't stall on parasites nobody shakes off
      e.state = 'move';
      e.pos.x += 1.4;
      e.marks.stunT = 1;
      return;
    }
    if (e.variant && e.partT > 3) {
      g.damagePlayer(15, e.pos);
      g.fx.shockwave(e.pos.x, e.pos.z, 1.2, e.def.color);
      e.noLoot = true;
      g.enemies.kill(e);
    }
  },

  // Wall block: stands for 8 seconds (the variant creeps toward the player), then crumbles.
  inert(e, f, g) {
    e.partT += f.dt;
    if (e.variant && e.dir.lengthSq() > 0) {
      e.pos.addScaledVector(e.dir, 0.6 * f.dt);
      g.room.moveBlock(e);
    }
    if (e.partT > X.wallLife) { e.noLoot = true; g.enemies.kill(e); }
  },

  // Rift walker: opens a gate pair, walks into the near end and steps out of the far one.
  portalWalk(e, f, g) {
    const m = mem(e, 'gate', () => ({ t: X.gateEvery * 0.5, gx: 0, gz: 0, bx: 0, bz: 0, going: false }));
    m.t -= f.dt;
    if (m.going) {
      const dx = m.gx - e.pos.x, dz = m.gz - e.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.8) {
        g.fx.burst({ x: e.pos.x, y: 1, z: e.pos.z }, e.def.color, 10, 5, 0.14, 0.3);
        e.pos.set(m.bx, 0, m.bz);
        g.arsenal.release(e);
        m.going = false;
        sfx.blink();
      } else f.desired.set(dx / d, 0, dz / d).multiplyScalar(f.spd * 1.3);
      return;
    }
    kite(e, f, 6, 10);
    if (m.t > 0 || e.spawnT > 0) return;
    m.t = X.gateEvery;
    const a = Math.random() * Math.PI * 2;
    const ax = e.pos.x + Math.sin(a) * 2, az = e.pos.z + Math.cos(a) * 2;
    const [bx, bz] = g.room.findSpawn(g.player.pos, 5, 1);
    if (g.room.blocked(ax, az, 1)) return;
    g.portals.open(ax, az, bx, bz, X.gateLife, e.variant);
    Object.assign(m, { gx: ax, gz: az, bx, bz, going: true });
    sfx.riftOpen(false);
  },
};

// ---------------------------------------------------------------------------------------------
// Attacks

interface Loot { coins: number; ammo: number; weapon: string }

export const ENDLESS_ATTACKS: Partial<Record<AttackPart, Attack>> = {
  missiles: {
    tick(e, f, g) {
      e.partT += f.dt;
      if (e.partT < X.missileEvery || e.spawnT > 0) return;
      e.partT = 0;
      ENDLESS_ATTACKS.missiles!.fire(e, f, g);
    },
    fire(e, _f, g) {
      for (const side of [-1, 1]) {
        const m = spawnChild(g, 'missile', e.pos.x + side * 0.6, e.pos.z, { hp: 1 });  // always one hit
        m.spawnT = 0;
        m.beamAngle = toward(e, g) + side * 0.8;
        m.partT = 0.001;
        m.variant = e.variant;
      }
      sfx.deploy();
    },
  },

  // Missile: blows up next to the player, or when its fuel runs out.
  detonate: {
    tick(e, f, g) {
      e.partT += f.dt;
      if (e.variant && !e.gen && e.partT > X.missileLife * 0.4) {
        // variant: splits into three small missiles halfway
        for (const k of [-1, 0, 1]) {
          const c = spawnChild(g, 'missile', e.pos.x, e.pos.z, { size: 0.7, gen: 1, hp: 1 });
          c.spawnT = 0;
          c.beamAngle = e.beamAngle + k * 0.5;
          c.partT = e.partT;
        }
        e.noLoot = true;
        g.enemies.kill(e);
        return;
      }
      if (f.dist < 0.9 + e.r || e.partT > X.missileLife) ENDLESS_ATTACKS.detonate!.fire(e, f, g);
    },
    fire(e, _f, g) {
      const pl = g.player, r = X.missileR * e.size;
      if (Math.hypot(pl.pos.x - e.pos.x, pl.pos.z - e.pos.z) < r + pl.r) g.damagePlayer(dmgOf(e, g), e.pos);
      g.fx.shockwave(e.pos.x, e.pos.z, r, e.def.color);
      sfx.pop();
      e.noLoot = true;
      g.enemies.kill(e);
    },
  },

  // Quaker: crouches, then stamps out a ring that spreads across the floor (dash through it).
  quake: {
    tick(e, f, g) {
      const m = mem(e, 'quake', () => ({ second: 0 }));
      if (m.second > 0) {
        m.second -= f.dt;
        if (m.second <= 0) g.ground.shock(e.pos.x, e.pos.z, dmgOf(e, g), { speed: X.quakeSpeed, end: X.quakeReach, color: e.def.color });
      }
      e.stateT -= f.dt;
      if (e.state === 'wind') {
        f.desired.set(0, 0, 0);
        e.charge = 1 - Math.max(0, e.stateT) / X.quakeCrouch;
        e.scale = 1 - e.charge * 0.15;
        if (e.stateT <= 0) { e.state = 'move'; ENDLESS_ATTACKS.quake!.fire(e, f, g); }
        return;
      }
      if (e.cd <= 0 && f.dist < X.quakeReach + 2) { e.state = 'wind'; e.stateT = X.quakeCrouch; e.cd = X.quakeEvery; }
    },
    fire(e, _f, g) {
      const m = mem(e, 'quake', () => ({ second: 0 }));
      if (e.variant) {
        // variant: the ring closes in from 10 m instead
        g.ground.warn(e.pos.x, e.pos.z, X.quakeReach, 0.5, e.def.color);
        g.ground.shock(e.pos.x, e.pos.z, dmgOf(e, g), { speed: -X.quakeSpeed, r: X.quakeReach, end: 0.6, color: e.def.color });
      } else {
        g.ground.shock(e.pos.x, e.pos.z, dmgOf(e, g), { speed: X.quakeSpeed, end: X.quakeReach, color: e.def.color });
      }
      if (e.elite) m.second = 0.5;
      g.fx.shake(0.35);
      sfx.erupt();
    },
  },

  devour: {
    tick(e, _f, g) {
      if (e.state !== 'eat') return;
      e.charge = 1 - Math.max(0, e.stateT) / X.eatTime;
      if (e.stateT > 0) return;
      e.state = 'move';
      const prey = mem(e, 'prey', () => ({ prey: null as Enemy | null })).prey;
      if (!prey || prey.hp <= 0 || Math.hypot(prey.pos.x - e.pos.x, prey.pos.z - e.pos.z) > e.r + prey.r + 1) return;
      eat(e, prey, g, X.eatGain);
    },
    fire() {},
  },

  raiseWall: {
    tick(e, f, g) {
      e.partT += f.dt;
      if (e.partT < X.wallEvery || e.spawnT > 0 || f.dist < 3) return;
      e.partT = 0;
      ENDLESS_ATTACKS.raiseWall!.fire(e, f, g);
    },
    fire(e, f, g) {
      // across the line to the player, 40% of the way there
      const p = g.player.pos, cx = e.pos.x + (p.x - e.pos.x) * 0.4, cz = e.pos.z + (p.z - e.pos.z) * 0.4;
      raiseWall(g, cx, cz, f.toP.x, f.toP.z, X.wallBlocks, e.maxHp * X.wallHp / X.wallBlocks, e.variant ? e : null);
    },
  },

  lob: {
    tick(e, f, g) {
      if (e.cd > 0 || e.spawnT > 0) return;
      e.cd = X.mortarEvery;
      ENDLESS_ATTACKS.lob!.fire(e, f, g);
    },
    fire(e, _f, g) {
      const p = g.player.pos;
      for (let i = 0; i < X.mortarShells; i++) {
        const x = p.x + (i ? rand(-2.2, 2.2) : 0), z = p.z + (i ? rand(-2.2, 2.2) : 0);
        if (g.room.blocked(x, z, 0.3)) continue;
        g.ground.bomb(x, z, X.mortarR, X.mortarDelay + i * 0.15, dmgOf(e, g), e.def.color);
        // variant: each shell bounces once more, a little further on
        if (e.variant) g.ground.bomb(x + (x - e.pos.x) * 0.15, z + (z - e.pos.z) * 0.15, X.mortarR, X.mortarDelay + 0.8 + i * 0.15, dmgOf(e, g), e.def.color);
      }
      sfx.deploy();
    },
  },

  // Ring star: eight orbs circle it and stop shots; every 4 s they burst outward.
  ringBurst: {
    tick(e, f, g) {
      e.partT += f.dt;
      const up = ringUp(e);
      e.beamPhase = up ? 1 : 0;
      e.beamAngle += f.dt * 2;
      if (up && e.partT >= X.ringUp) {
        e.partT = -X.ringDown;  // negative while the ring is down
        ENDLESS_ATTACKS.ringBurst!.fire(e, f, g);
      }
    },
    fire(e, _f, g) {
      const rings = e.variant ? [1, -1] : [1];
      for (const dir of rings) {
        for (let i = 0; i < X.ringShots; i++) {
          const a = e.beamAngle * dir + (i / X.ringShots) * Math.PI * 2;
          g.projectiles.fireEnemy({ x: e.pos.x + Math.sin(a) * X.ringR, z: e.pos.z + Math.cos(a) * X.ringR }, a, 7, e.def.color, 1, dmgOf(e, g));
        }
      }
      sfx.enemyShot();
    },
  },

  // Commander: sounds the charge (flag glows 1 s first): every virus speeds up and rushes in.
  rally: {
    tick(e, f, g) {
      e.partT += f.dt;
      if (e.partT >= X.rallyEvery - X.rallyWarn) e.charge = 1;
      if (e.partT < X.rallyEvery) return;
      e.partT = 0;
      ENDLESS_ATTACKS.rally!.fire(e, f, g);
    },
    fire(e, _f, g) {
      g.enemies.rallyT = X.rallyTime;
      if (e.variant) for (const o of g.enemies.list) if (!o.def.boss && o.hp > 0) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * 0.1);
      g.fx.shockwave(e.pos.x, e.pos.z, 8, e.def.color);
      g.hud.toast(t('冲锋号！'));
      sfx.tether();
    },
  },

  glaive: {
    tick(e, f, g) {
      const m = mem(e, 'glaive', () => ({ out: 0 }));
      m.out -= f.dt;
      e.charge = m.out > 0 ? 0 : 1;  // the blade in hand glows when it's back
      if (m.out > 0 || e.cd > 0 || e.spawnT > 0) return;
      e.cd = X.glaiveEvery;
      m.out = X.glaiveTime;
      ENDLESS_ATTACKS.glaive!.fire(e, f, g);
    },
    fire(e, _f, g) {
      const a = toward(e, g);
      const throwOne = (side: number, angle: number) => {
        g.projectiles.fireEnemy(e.pos, angle, 0, e.def.color, 1, dmgOf(e, g), X.glaiveTime, {
          curve: { ox: e.pos.x, oz: e.pos.z, angle, reach: X.glaiveReach, width: X.glaiveWidth * side, time: X.glaiveTime },
        });
        // the way back is drawn on the floor
        for (let k = 1; k <= 6; k++) {
          const s = 0.5 + k / 12, fwd = Math.sin(Math.PI * s) * X.glaiveReach, sd = Math.sin(2 * Math.PI * s) * X.glaiveWidth * side;
          g.ground.warn(e.pos.x + Math.sin(angle) * fwd + Math.cos(angle) * sd, e.pos.z + Math.cos(angle) * fwd - Math.sin(angle) * sd, 0.35, X.glaiveTime * 0.6, e.def.color);
        }
      };
      throwOne(e.side, a);
      if (e.variant) throwOne(-e.side, a);  // variant: two blades crossing
      sfx.slash();
    },
  },

  single: {
    tick(e, f, g) {
      if (e.cd > 0 || e.spawnT > 0 || f.dist > 16) return;
      e.cd = 1.6;
      ENDLESS_ATTACKS.single!.fire(e, f, g);
    },
    fire(e, _f, g) {
      g.projectiles.fireEnemy(e.pos, toward(e, g), 10, e.def.color, 1, dmgOf(e, g));
      sfx.enemyShot();
    },
  },

  // Juggernaut: alternates a charge and a stamp that sends out a ring.
  stomp: {
    tick(e, f, g) {
      e.stateT -= f.dt;
      if (e.state === 'wind') {
        e.charge = 1;
        if (e.stateT > 0) return;
        if (e.pattern % 2) { e.state = 'charge'; e.stateT = 0.8; e.dir.copy(f.toP); }
        else { e.state = 'move'; g.ground.shock(e.pos.x, e.pos.z, dmgOf(e, g), { speed: 7, end: 9, color: 0xdfe6ff }); g.fx.shake(0.4); sfx.erupt(); }
        return;
      }
      if (e.state === 'charge') {
        f.desired.copy(e.dir).multiplyScalar(12);
        if (e.stateT <= 0) e.state = 'move';
        return;
      }
      if (e.state === 'stun') { if (e.stateT <= 0) e.state = 'move'; return; }
      if (e.cd <= 0 && f.dist < 10) { e.cd = 3.2; e.pattern++; e.state = 'wind'; e.stateT = 0.7; }
    },
    fire() {},
  },
};

// ---------------------------------------------------------------------------------------------
// Special abilities

export const ENDLESS_SPECIALS: Partial<Record<SpecialPart, Part>> = {
  rewind(e, f, g) { trackRewind(e, g, f.dt, e.variant ? 2 : 1); },

  iceSheet(e, f, g) {
    e.partT += f.dt;
    if (e.partT < X.iceEvery || e.spawnT > 0) return;
    e.partT = 0;
    g.ground.addIce(e.pos.x, e.pos.z, X.iceR, X.iceLife);
    if (e.variant) g.ground.spikes(e.pos.x, e.pos.z, X.iceR, dmgOf(e, g));
  },

  // The darkness itself is applied by Enemies/Game (enemies inside go dim, the player's view shrinks).
  darkAura(e) {
    e.charge = e.variant ? (Math.sin(e.t * 2) + 1) / 2 : 1;  // variant: the darkness pulses
  },

  // Hive core: arrives with five shielded workers.
  hive(e, _f, g) {
    const m = mem(e, 'hive', () => ({ made: false }));
    if (m.made || e.spawnT > 0) return;
    m.made = true;
    for (let i = 0; i < X.workers; i++) {
      const a = (i / X.workers) * Math.PI * 2, r = e.variant ? 2.2 : 1.6;
      const w = spawnChild(g, 'worker', e.pos.x + Math.sin(a) * r, e.pos.z + Math.cos(a) * r, { owner: e, noLoot: false });
      w.beamAngle = a;
      w.variant = e.variant;
    }
  },

  // Juggernaut: four armor plates, each tracked on its own (see adjustDamage). Turns slowly.
  armor(e, f, g) {
    const m = mem(e, 'armor', () => ({ sides: [1, 1, 1, 1].map(() => e.maxHp * X.armorFrac), regrow: [0, 0, 0, 0] }));
    const want = toward(e, g), d = Math.atan2(Math.sin(want - e.beamAngle), Math.cos(want - e.beamAngle));
    e.beamAngle += Math.max(-X.armorTurn * f.dt, Math.min(X.armorTurn * f.dt, d));
    if (e.variant) {
      // variant: broken plates grow back after 10 s
      m.sides.forEach((hp, i) => {
        if (hp > 0) return;
        m.regrow[i] += f.dt;
        if (m.regrow[i] > 10) { m.sides[i] = e.maxHp * X.armorFrac; m.regrow[i] = 0; }
      });
    }
    e.pattern = (e.pattern & ~0xf0) | (m.sides.reduce((bits, hp, i) => bits | (hp > 0 ? 1 << i : 0), 0) << 4);
  },
};

export const ENDLESS_DEATHS: Partial<Record<DeathPart, (e: Enemy, g: Game) => void>> = {
  // A burst of light when a light eater dies.
  lightBurst(e, g) {
    g.gfx.flash(e.pos.x, 3, e.pos.z, 0xffffff, 260);
    g.fx.burst({ x: e.pos.x, y: 1, z: e.pos.z }, 0xffffff, 30, 10, 0.2, 0.6);
  },
  // Parasitic affix uses the same: three parasites burst out.
  parasites(e, g) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      const p = spawnChild(g, 'parasite', e.pos.x + Math.sin(a), e.pos.z + Math.cos(a));
      p.spawnT = 0.2;
    }
  },
};

// ---------------------------------------------------------------------------------------------
// Shared helpers

export function ringUp(e: Enemy): boolean {
  return e.def.parts?.attack === 'ringBurst' && e.partT >= 0;
}

function preyFor(e: Enemy, g: Game, range: number): Enemy | null {
  let best: Enemy | null = null;
  for (const o of g.enemies.list) {
    if (o === e || o.hp <= 0 || o.def.boss || o.def.part || o.def.inert || o.kind === e.kind || o.spawnT > 0) continue;
    if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > range) continue;
    if (!best || o.hp < best.hp) best = o;
  }
  return best;
}

// Eat another enemy: it's gone (no loot), the eater grows.
export function eat(e: Enemy, prey: Enemy, g: Game, gain: number): void {
  prey.noLoot = true;
  g.fx.burst({ x: prey.pos.x, y: 0.8, z: prey.pos.z }, prey.def.color, 14, 5, 0.16, 0.35);
  g.enemies.kill(prey);
  if (gain > 1) {
    e.gen++;
    e.size *= X.eatGrow;
    e.r = e.def.r * e.size;
    e.maxHp *= gain;
    e.hp *= gain;
    e.dmgMul *= gain;
  }
  sfx.pop();
}

// A line of wall blocks across the direction (dx, dz), centered on (cx, cz).
export function raiseWall(g: Game, cx: number, cz: number, dx: number, dz: number, blocks: number, hp: number, pushBy: Enemy | null): void {
  const px = -dz, pz = dx, p = g.player.pos;
  for (let i = 0; i < blocks; i++) {
    const k = (i - (blocks - 1) / 2) * 1.4, x = cx + px * k, z = cz + pz * k;
    if (g.room.blocked(x, z, 0.8) || Math.hypot(p.x - x, p.z - z) < 1.4) continue;
    const b = spawnChild(g, 'wallBlock', x, z, { hp });
    b.spawnT = 0.15;
    if (pushBy) b.dir.set(dx, 0, dz);  // variant: the wall creeps toward the player
    b.variant = !!pushBy;
    g.room.addBlock(b);
  }
  sfx.deploy();
}

function reveal(e: Enemy, g: Game, bite: boolean): void {
  if (e.state !== 'disguise') return;
  e.state = 'move';
  e.beamPhase = 1;
  g.fx.burst({ x: e.pos.x, y: 0.8, z: e.pos.z }, e.def.color, 16, 6, 0.16, 0.35);
  if (bite && g.player.invuln <= 0) g.damagePlayer(dmgOf(e, g), e.pos);
  sfx.slash();
}

// ---------------------------------------------------------------------------------------------
// Hooks called by Enemies for every enemy (cheap checks first).

// Scale incoming damage. Returns the damage that actually lands.
export function adjustDamage(e: Enemy, dmg: number, hit: HitInfo, g: Game): number {
  if (e.kind === 'worker' && e.owner && e.owner.hp > 0) {
    g.fx.burst({ x: e.pos.x, y: e.def.y + 0.3, z: e.pos.z }, 0xffd23f, 2, 3, 0.1, 0.2);
    return 0;  // shielded while its hive core lives
  }
  if (e.def.parts?.special === 'armor') {
    const m = mem(e, 'armor', () => ({ sides: [1, 1, 1, 1].map(() => e.maxHp * X.armorFrac), regrow: [0, 0, 0, 0] }));
    if (!hit.dir) return dmg * 0.5;  // burns and the like seep through
    // which face got hit: the one whose outward normal points back along the shot
    let best = 0, bestDot = -2;
    for (let i = 0; i < 4; i++) {
      const a = e.beamAngle + i * Math.PI / 2, dot = -(Math.sin(a) * hit.dir.x + Math.cos(a) * hit.dir.z);
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    if (m.sides[best] <= 0) return dmg * X.coreExposed;
    m.sides[best] -= dmg;
    if (m.sides[best] <= 0) {
      g.floaters.say({ x: e.pos.x, y: 2.5, z: e.pos.z }, t('装甲破碎'));
      sfx.shieldBreak();
    }
    return dmg * (1 - X.armorAbsorb);
  }
  if (e.affixes.includes('undying')) {
    const m = mem(e, 'undying', () => ({ undying: 1, invT: 0 }));
    if (m.invT > e.t) return 0;
    if (m.undying > 0 && dmg >= e.hp) {
      m.undying = 0;
      m.invT = e.t + 1;
      g.floaters.say({ x: e.pos.x, y: 2, z: e.pos.z }, t('不朽'));
      return Math.max(0, e.hp - 1);
    }
  }
  return dmg;
}

export function onDamaged(e: Enemy, hit: HitInfo, g: Game): void {
  if (e.kind === 'mimic') reveal(e, g, false);
  if (e.state === 'eat' && (hit.knock ?? 0) > 4) e.state = 'move';
  tryRewind(e, g);
}

// Called while it can't act (frozen solid, stunned): breaks off whatever it was doing.
export function onDisabled(e: Enemy): void {
  if (e.state === 'eat') e.state = 'move';
  if (e.def.parts?.attack === 'rally') { e.partT = 0; e.charge = 0; }
}

// The enemy is touching the player. Returns false if the usual contact damage shouldn't apply.
export function onTouch(e: Enemy, g: Game): boolean {
  const p = g.player;
  switch (e.kind) {
    case 'missile':
    case 'wallBlock':
      return false;
    case 'mimic':
      return e.state !== 'disguise';
    case 'parasite':
      if (e.state === 'latch' || e.marks.stunT > 0 || p.invuln > 0 || p.latched >= X.latchMax) return false;
      e.state = 'latch';
      e.gen = p.latched;
      e.partT = 0;
      g.arsenal.release(e);
      sfx.slash();
      return false;
    case 'thief':
      if (e.state === 'flee' || p.invuln > 0) return true;
      steal(e, g);
      return true;
  }
  if (e.affixes.includes('greedy') && p.invuln <= 0 && p.coins > 0) {
    const m = mem(e, 'greed', () => ({ greed: 0 }));
    const n = Math.min(5, p.coins);
    p.coins -= n;
    m.greed += n;
    g.floaters.say({ x: p.pos.x, y: 2, z: p.pos.z }, `-${n}`);
  }
  if (e.affixes.includes('frost') && p.invuln <= 0) p.chillT = 1.5;
  return true;
}

function steal(e: Enemy, g: Game): void {
  const p = g.player, slot = p.slots[p.weapon], m = mem(e, 'loot', () => ({ loot: null as Loot | null }));
  if (e.variant) {
    // variant: steals the dash instead
    p.dashCd = Math.max(p.dashCd, p.dashCooldown);
    g.hud.toast(t('冲刺被偷了！'));
  } else if (slot.starter) {
    const n = Math.min(X.stealCoins, p.coins);
    p.coins -= n;
    m.loot = { coins: n, ammo: 0, weapon: slot.id };
    g.hud.toast(t('碎片被偷了！追上它'));
  } else {
    const n = Math.floor(slot.mag * X.stealFrac);
    slot.mag -= n;
    m.loot = { coins: 0, ammo: n, weapon: slot.id };
    g.hud.toast(t('弹药被偷了！追上它'));
  }
  e.state = 'flee';
  e.stateT = X.thiefFlee;
  e.charge = 1;
  sfx.pickup();
}

// Death effects that depend on what happened in the enemy's life (stolen loot, greed...).
export function onKilled(e: Enemy, g: Game): void {
  const ghost = peek<RewindMem>(e, 'rewind')?.ghost, shadow = peek<{ shadow: THREE.Mesh | null }>(e, 'diver')?.shadow;
  if (ghost) g.gfx.scene.remove(ghost);
  if (shadow) g.gfx.scene.remove(shadow);
  const m = { loot: peek<{ loot: Loot | null }>(e, 'loot')?.loot, greed: peek<{ greed: number }>(e, 'greed')?.greed };
  if (m.loot && !e.noLoot) {
    // caught the thief: everything comes back twice over
    const p = g.player;
    if (m.loot.coins) g.pickups.spawnCoins(e.pos.x, e.pos.z, m.loot.coins * 2);
    const slot = p.slots.find(s => s.id === m.loot!.weapon);
    if (slot && m.loot.ammo) slot.reserve += m.loot.ammo * 2;
    g.hud.toast(t('追回了被偷的东西（双倍）'));
  }
  if (m.greed) g.pickups.spawnCoins(e.pos.x, e.pos.z, Math.round(m.greed * 1.5));
  if (e.kind === 'wallBlock') g.room.removeBlock(e);
  if (e.def.parts?.special === 'hive') {
    for (const w of g.enemies.list) if (w.owner === e && w.kind === 'worker') { w.owner = null; w.gen = 1; }
  }
  if (e.affixes.includes('parasitic') && !g.enemies.purging) ENDLESS_DEATHS.parasites!(e, g);
}

export const ENDLESS_HIDDEN = ['air', 'slam', 'lift', 'latch'];

// Variant devourer: swallows the shots that hit it, and grows every 10.
export function devourShot(e: Enemy, g: Game): void {
  e.burst++;
  if (e.burst % 10 === 0 && e.gen < X.eatMax) {
    e.gen++;
    e.size *= 1.12;
    e.r = e.def.r * e.size;
    e.maxHp *= 1.15;
    e.hp *= 1.15;
    g.floaters.say({ x: e.pos.x, y: 2, z: e.pos.z }, t('吞噬'));
  }
}

// Per-frame effects of the stratum affixes that aren't hooked into damage, touch or death.
export function affixTick(e: Enemy, g: Game, dt: number): void {
  const m = mem(e, 'affix', () => ({ hungryT: 8, wallT: 6 }));
  if (e.affixes.includes('hungry')) {
    m.hungryT -= dt;
    const prey = m.hungryT <= 0 ? preyFor(e, g, 3) : null;
    if (prey && !prey.elite) {
      m.hungryT = 8;
      eat(e, prey, g, 1);
      e.hp = Math.min(e.maxHp, e.hp + e.maxHp * 0.2);
    }
  }
  if (e.affixes.includes('bulwark')) {
    m.wallT -= dt;
    if (m.wallT <= 0) {
      m.wallT = 6;
      const p = g.player.pos, dx = p.x - e.pos.x, dz = p.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
      if (d > 3) raiseWall(g, e.pos.x + dx / d * 1.8, e.pos.z + dz / d * 1.8, dx / d, dz / d, 1, e.maxHp * 0.2, null);
    }
  }
}
