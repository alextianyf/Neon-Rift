import * as THREE from 'three';
import { GEO, glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import type { AttackPart, DeathPart, EnemyParts, MovePart, SpecialPart } from '../data/enemies';
import type { AIFrame } from './enemyAI';
import type { Enemy } from './enemies';
import type { Game } from './game';
import { extraShots } from './abyss';
import { ENDLESS_ATTACKS, ENDLESS_DEATHS, ENDLESS_HIDDEN, ENDLESS_MOVES, ENDLESS_SPECIALS } from './partsEndless';

// Enemy behavior parts. Newer enemies are a movement + an attack + optionally a special ability and
// a death effect, so that any two enemies can later be fused by mixing their parts. Parts talk to each
// other only through the enemy's state fields; a movement part may set off the attack (`fireAttack`),
// e.g. a burrower erupting.

type Part = (e: Enemy, f: AIFrame, g: Game) => void;
interface Attack {
  tick?: Part;  // runs every frame, fires on its own schedule
  fire: Part;   // one attack, also callable by movement parts
}

const P = {
  towerRange: 11,
  towerDeploy: 1,
  towerPack: 0.6,
  towerLostSight: 2,
  streamArms: 3,
  streamTurn: 1.2,     // rad/s
  streamEvery: 0.5,    // per arm
  streamSpeed: 8,
  surfaceTime: 2.5,
  diveTime: 0.4,
  underTime: 2,
  riseTime: 0.8,
  eruptRadius: 1.5,
  eruptShots: 8,
  trailEvery: 0.4,
  trailRadius: 0.7,
  trailLife: 3,
  poolRadius: 1.6,
  poolLife: 4,
  replicateEvery: 6,
  replicaHp: 0.6,
  replicaSize: 0.8,
  maxGen: 2,
  linkRange: 9,        // the beam snaps beyond this
  linkRelink: 1,       // seconds before a snapped beam reconnects
  linkFlank: 3.5,      // how far to either side of the player each linker aims for
  linkWidth: 0.25,
  linkRage: 1.4,       // speed once its partner is dead
  stalkNear: 5,
  stalkFar: 8,
  stalkAlpha: 0.3,
  blinkEvery: 4,
  blinkBehind: 1.8,   // inside the slash's reach
  blinkWarn: 0.6,
  slashWind: 0.3,
  slashRadius: 2,
  slashArc: Math.PI / 3,  // half of the 120° fan
  revealTime: 1.5,
  mendRange: 8,
  mendRate: 0.05,      // of the target's max HP per second
  mendBehind: 2.5,
  mirrorTurn: 0.8,     // rad/s
  mirrorSwap: 2,       // seconds per lit face
  mirrorFlicker: 0.4,  // warning before the lit face moves on
  mirrorCooldown: 0.12,  // at most one reflected shot per this long (shotgun pellets don't make a wall)
};
export const MEND_REDUCE = 0.25;  // damage taken by an enemy a mender is beaming
const LINK_COLOR = 0x8fe8ff;
const MEND_COLOR = 0x3fdc95;
const MIRROR_SHOT = 0xe6f0ff;

// A glowing bar from a to b, owned by `e` (linker beam, mender ray). Hidden when `on` is false.
function beam(e: Enemy, g: Game, on: boolean, a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, glow: number): void {
  if (!e.beam) {
    if (!on) return;
    e.beam = new THREE.Mesh(GEO.particle, glowMat(color, glow));
    g.gfx.scene.add(e.beam);
  }
  e.beam.visible = on;
  if (!on) return;
  const dx = b.x - a.x, dz = b.z - a.z;
  e.beam.position.set((a.x + b.x) / 2, 0.7, (a.z + b.z) / 2);
  e.beam.rotation.set(0, Math.atan2(dx, dz), 0);
  e.beam.scale.set(width * (0.8 + Math.random() * 0.4), width, Math.hypot(dx, dz));
}

// Distance from point p to the segment a-b on the floor plane.
function segDist(px: number, pz: number, a: THREE.Vector3, b: THREE.Vector3): number {
  const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
  const k = Math.max(0, Math.min(1, ((px - a.x) * dx + (pz - a.z) * dz) / l2));
  return Math.hypot(px - (a.x + dx * k), pz - (a.z + dz * k));
}

// The ally a mender is beaming: the toughest one in range (never a boss or another mender).
function mendTarget(e: Enemy, g: Game, not: Enemy | null = null): Enemy | null {
  let best: Enemy | null = null;
  for (const o of g.enemies.list) {
    if (o === e || o === not || o.hp <= 0 || o.def.boss || o.kind === 'mender' || o.spawnT > 0 || HIDDEN_STATES.has(o.state)) continue;
    if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) > P.mendRange) continue;
    if (!best || o.maxHp > best.maxHp) best = o;
  }
  return best;
}
export const REPLICAS_PER_SECTOR = 8;

// True if nothing blocks a shot from a to b.
export function sight(g: Game, ax: number, az: number, bx: number, bz: number): boolean {
  const d = Math.hypot(bx - ax, bz - az), steps = Math.ceil(d / 0.5);
  for (let i = 1; i < steps; i++) {
    const k = i / steps;
    if (g.room.shotBlocked(ax + (bx - ax) * k, az + (bz - az) * k)) return false;
  }
  return true;
}

// --- movement ---

const MOVES: Partial<Record<MovePart, Part>> = {
  chase(_e, f) {
    f.desired.copy(f.toP).multiplyScalar(f.spd);
  },

  // Walk until the player is in range and in sight, unfold (1s), then stay put and fire.
  // Packs up and moves on after losing sight of the player for a while.
  deploy(e, f, g) {
    const seen = sight(g, e.pos.x, e.pos.z, g.player.pos.x, g.player.pos.z);
    e.stateT -= f.dt;
    switch (e.state) {
      case 'move':
        e.beamPhase = 0;
        f.desired.copy(f.toP).multiplyScalar(f.spd);
        if (seen && f.dist < P.towerRange && e.spawnT <= 0) { e.state = 'wind'; e.stateT = P.towerDeploy; sfx.deploy(); }
        break;
      case 'wind':
        e.beamPhase = 1;
        e.charge = 1 - Math.max(0, e.stateT) / P.towerDeploy;
        if (e.stateT <= 0) { e.state = 'planted'; e.partT = 0; e.beamAngle = Math.atan2(f.toP.x, f.toP.z); }
        break;
      case 'planted':
        e.beamPhase = 2;
        e.partT = seen ? 0 : e.partT + f.dt;
        if (e.partT > P.towerLostSight) { e.state = 'pack'; e.stateT = P.towerPack; sfx.deploy(); }
        break;
      case 'pack':
        e.beamPhase = 1;
        e.charge = Math.max(0, e.stateT) / P.towerPack;
        if (e.stateT <= 0) e.state = 'move';
        break;
    }
  },

  // Surface (chase) -> dive -> tunnel toward the player unseen -> stop under the warning ring -> erupt.
  burrow(e, f, g) {
    e.stateT -= f.dt;
    switch (e.state) {
      case 'move':
        f.desired.copy(f.toP).multiplyScalar(f.spd * 0.6);
        if (e.stateT <= -P.surfaceTime) {  // stateT counts down from 0 while surfaced
          e.state = 'dive';
          e.stateT = P.diveTime;
          g.arsenal.release(e);
          sfx.burrow();
        }
        break;
      case 'dive':
        e.scale = Math.max(0.05, e.stateT / P.diveTime);
        if (e.stateT <= 0) { e.state = 'under'; e.stateT = P.underTime; }
        break;
      case 'under':
        f.desired.copy(f.toP).multiplyScalar(f.spd);
        if (e.variant) {
          // variant: leaves a line of spikes that stab up a second later
          e.burstT -= f.dt;
          if (e.burstT <= 0) { e.burstT = 0.3; g.ground.bomb(e.pos.x, e.pos.z, 0.6, 1, e.def.dmg * 0.6, e.def.color); }
        }
        if (Math.random() < 0.6) g.fx.burst({ x: e.pos.x + rand(-0.4, 0.4), y: 0.1, z: e.pos.z + rand(-0.4, 0.4) }, e.def.color, 1, 2, 0.14, 0.35);
        if (e.stateT <= 0 || f.dist < 0.8) {
          e.state = 'rise';
          e.stateT = P.riseTime;
          g.ground.warn(e.pos.x, e.pos.z, P.eruptRadius * e.size, P.riseTime);
        }
        break;
      case 'rise':
        if (Math.random() < 0.8) g.fx.burst({ x: e.pos.x + rand(-0.6, 0.6), y: 0.1, z: e.pos.z + rand(-0.6, 0.6) }, e.def.color, 1, 3, 0.16, 0.3);
        if (e.stateT <= 0) {
          e.state = 'move';
          e.stateT = 0;
          fireAttack(e, f, g);
        }
        break;
    }
  },

  // Linkers come in pairs and advance side by side, spread out across the player's path, so the beam
  // between them sweeps over the player like a wall: go around the ends or dash through.
  // Alone, the survivor just rushes in, faster.
  flank(e, f, g) {
    const o = e.link;
    if (!o) {
      f.desired.copy(f.toP).multiplyScalar(f.spd * P.linkRage);
      return;
    }
    if (e.variant) {
      // variant: three linkers circle the player, a triangle of beams turning around them
      const p = g.player.pos, a = e.t * 0.6 + e.pattern * Math.PI * 2 / 3;
      const tx = p.x + Math.sin(a) * 4.5, tz = p.z + Math.cos(a) * 4.5;
      f.desired.set(tx - e.pos.x, 0, tz - e.pos.z).multiplyScalar(2);
      const v = f.desired.length();
      if (v > f.spd * 1.2) f.desired.multiplyScalar(f.spd * 1.2 / v);
      return;
    }
    const p = g.player.pos, mx = (e.pos.x + o.pos.x) / 2, mz = (e.pos.z + o.pos.z) / 2;
    // the lead keeps the wall's heading; it only turns once the wall has swept past the player,
    // so the wall doesn't fold up while it is right on top of them
    const lead = e.lead ? e : o, md = Math.hypot(p.x - mx, p.z - mz);
    if (e.lead && (md > 3 || lead.dir.lengthSq() === 0)) lead.dir.set((p.x - mx) / (md || 1), 0, (p.z - mz) / (md || 1));
    const dx = lead.dir.x, dz = lead.dir.z;
    // each stays at its own end, even when the wall turns around (no crossing over)
    const leadSide = (lead.pos.x - mx) * -dz + (lead.pos.z - mz) * dx >= 0 ? 1 : -1;
    const side = e.lead ? leadSide : -leadSide;
    // keep to its end of the wall, and the wall as a whole walks at the player
    const tx = mx - dz * side * P.linkFlank, tz = mz + dx * side * P.linkFlank;
    f.desired.set((tx - e.pos.x) * 2 + dx * f.spd * 0.8, 0, (tz - e.pos.z) * 2 + dz * f.spd * 0.8);
    const v = f.desired.length();
    if (v > f.spd) f.desired.multiplyScalar(f.spd / v);
  },

  // Phase assassin: drifts around half-seen at mid range; every few seconds blinks to just behind
  // the player (ripple first), winds up, slashes, and stays fully visible for a moment after.
  stalk(e, f, g) {
    const p = g.player;
    e.stateT -= f.dt;
    const marked = e.frostT > 0 || e.marks.chill > 0 || e.marks.shred > 0;  // frost and shred keep it visible
    switch (e.state) {
      case 'move': {
        e.alpha = marked ? 1 : P.stalkAlpha;
        const { toP, dist, spd, desired } = f;
        if (dist > P.stalkFar) desired.copy(toP).multiplyScalar(spd);
        else if (dist < P.stalkNear) desired.copy(toP).multiplyScalar(-spd);
        else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * 0.8);
        e.partT += f.dt;
        if (e.partT < P.blinkEvery || e.spawnT > 0) break;
        // behind = opposite the way the player is aiming
        let x = p.pos.x - p.aim.x * P.blinkBehind, z = p.pos.z - p.aim.z * P.blinkBehind;
        if (g.room.blocked(x, z, e.r)) [x, z] = [p.pos.x - toP.x * P.blinkBehind, p.pos.z - toP.z * P.blinkBehind];
        if (g.room.blocked(x, z, e.r)) { e.partT = 0; break; }
        e.dir.set(x, 0, z);
        e.state = 'phase';
        e.stateT = P.blinkWarn;
        g.arsenal.release(e);
        g.ground.warn(x, z, 0.9, P.blinkWarn, e.def.color);
        g.fx.burst({ x: e.pos.x, y: 0.8, z: e.pos.z }, e.def.color, 10, 5, 0.14, 0.35);
        sfx.phaseOut();
        break;
      }
      case 'phase':
        if (e.stateT <= 0 && e.variant && !e.burst) {
          // variant: the first blink was a feint; it flickers there and blinks again, behind you
          e.burst = 1;
          e.pos.copy(e.dir);
          g.fx.burst({ x: e.pos.x, y: 0.8, z: e.pos.z }, e.def.color, 8, 4, 0.14, 0.3);
          const x = p.pos.x - p.aim.x * P.blinkBehind, z = p.pos.z - p.aim.z * P.blinkBehind;
          if (!g.room.blocked(x, z, e.r)) e.dir.set(x, 0, z);
          e.stateT = 0.45;
          g.ground.warn(e.dir.x, e.dir.z, 0.9, 0.45, e.def.color);
          sfx.phaseOut();
          break;
        }
        if (e.stateT <= 0) {
          e.burst = 0;
          e.pos.copy(e.dir);
          e.vel.set(0, 0, 0);
          e.state = 'wind';
          e.stateT = P.slashWind;
          e.beamAngle = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);  // the slash goes where the player was
          g.fx.burst({ x: e.pos.x, y: 0.8, z: e.pos.z }, e.def.color, 14, 6, 0.16, 0.4);
          sfx.phaseIn();
        }
        break;
      case 'wind':
        e.alpha = 1;
        e.charge = 1 - Math.max(0, e.stateT) / P.slashWind;
        if (e.stateT <= 0) {
          fireAttack(e, f, g);
          e.state = 'reveal';
          e.stateT = P.revealTime;
          e.partT = 0;
        }
        break;
      case 'reveal':  // stands still, fully visible: the window to punish it
        e.alpha = 1;
        if (e.stateT <= 0) e.state = 'move';
        break;
    }
  },

  // Mender: stays behind the ally it is beaming, on the far side from the player.
  skulk(e, f, g) {
    const tgt = mendTarget(e, g), p = g.player.pos;
    if (tgt && f.dist > P.stalkNear) {
      const ax = tgt.pos.x - p.x, az = tgt.pos.z - p.z, ad = Math.hypot(ax, az) || 1;
      const tx = tgt.pos.x + ax / ad * P.mendBehind, tz = tgt.pos.z + az / ad * P.mendBehind;
      const dx = tx - e.pos.x, dz = tz - e.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.5) f.desired.set(dx / d, 0, dz / d).multiplyScalar(f.spd);
    } else if (f.dist < 9) {
      f.desired.copy(f.toP).multiplyScalar(-f.spd);  // nobody to hide behind, or the player is close: back off
    }
  },
};

// --- attacks ---

const ATTACKS: Partial<Record<AttackPart, Attack>> = {
  // Touching the player hurts (handled by Enemies for every enemy); nothing extra to fire.
  contact: { fire() {} },

  // Three arms of bullets sweeping around while planted.
  spinStream: {
    tick(e, f, g) {
      if (e.state !== 'planted') return;
      if (e.variant) {
        // variant: one sweeping laser instead of bullet streams
        if (!g.lasers.busy(e)) g.lasers.fire({ owner: e, angle: e.beamAngle, warn: 0.8, dur: 4, dmg: e.def.dmg * 1.5, color: e.def.color, width: 0.35, turn: P.streamTurn * 0.8, offset: 1, len: 14 });
        return;
      }
      e.beamAngle += P.streamTurn * f.dt;
      if (e.cd <= 0) { ATTACKS.spinStream!.fire(e, f, g); e.cd = P.streamEvery; }
    },
    fire(e, _f, g) {
      const arms = P.streamArms + extraShots();
      for (let i = 0; i < arms; i++) {
        g.projectiles.fireEnemy(e.pos, e.beamAngle + (i / arms) * Math.PI * 2, P.streamSpeed, e.def.color, 1, e.def.dmg);
      }
      sfx.towerShot();
    },
  },

  // Bursting out of the ground: hits everything on top and throws a ring of shots.
  erupt: {
    fire(e, _f, g) {
      const r = P.eruptRadius * e.size, p = g.player;
      if (Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) < r + p.r) g.damagePlayer(e.def.dmg * (e.elite ? g.enemies.eliteDmg : 1), e.pos);
      const off = Math.random();
      for (let i = 0; i < P.eruptShots; i++) g.projectiles.fireEnemy(e.pos, off + (i / P.eruptShots) * Math.PI * 2, 7, e.def.color, 0.8);
      g.fx.shockwave(e.pos.x, e.pos.z, r, e.def.color);
      g.fx.burst({ x: e.pos.x, y: 0.6, z: e.pos.z }, e.def.color, 22, 8, 0.2, 0.5);
      g.fx.shake(0.3);
      sfx.erupt();
    },
  },

  // Linker pair: the lead one draws the beam; touching it hurts. Snaps when they drift too far apart.
  link: {
    tick(e, f, g) {
      const o = e.link;
      if (!e.lead) return;
      if (!o || o.hp <= 0) { beam(e, g, false, e.pos, e.pos, LINK_COLOR, 0, 0); return; }
      const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
      if (d > P.linkRange && e.partT <= 0) {
        e.partT = P.linkRelink;
        g.fx.burst({ x: (e.pos.x + o.pos.x) / 2, y: 0.7, z: (e.pos.z + o.pos.z) / 2 }, LINK_COLOR, 8, 5, 0.12, 0.3);
      }
      if (e.partT > 0) e.partT -= f.dt;
      const on = e.partT <= 0 && d <= P.linkRange && e.spawnT <= 0 && o.spawnT <= 0;
      beam(e, g, on, e.pos, o.pos, LINK_COLOR, 0.1, 1.4);  // drawn thinner than it hits
      if (!on) return;
      sfx.linkHum();
      const pl = g.player;
      if (segDist(pl.pos.x, pl.pos.z, e.pos, o.pos) < pl.r + P.linkWidth) ATTACKS.link!.fire(e, f, g);
    },
    fire(e, _f, g) {
      g.damagePlayer(e.def.dmg * (e.elite ? g.enemies.eliteDmg : 1), null);
    },
  },

  // Phase assassin's slash: a 120° fan in front of it.
  slash: {
    fire(e, _f, g) {
      const pl = g.player, r = P.slashRadius * e.size + pl.r;
      const dx = pl.pos.x - e.pos.x, dz = pl.pos.z - e.pos.z, a = Math.atan2(dx, dz) - e.beamAngle;
      if (Math.hypot(dx, dz) < r && Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < P.slashArc) {
        g.damagePlayer(e.def.dmg * (e.elite ? g.enemies.eliteDmg : 1), e.pos);
      }
      for (let i = -3; i <= 3; i++) {
        const k = e.beamAngle + (i / 3) * P.slashArc;
        g.fx.burst({ x: e.pos.x + Math.sin(k) * r * 0.8, y: 0.8, z: e.pos.z + Math.cos(k) * r * 0.8 }, 0xf2e8ff, 3, 3, 0.12, 0.25);
      }
      sfx.slash();
    },
  },

  // Mender's ray: heals the target and makes it take less damage (see Enemies.auraMul).
  mend: {
    tick(e, f, g) {
      const tgt = e.spawnT > 0 ? null : mendTarget(e, g);
      beam(e, g, !!tgt, e.pos, tgt?.pos ?? e.pos, MEND_COLOR, 0.06, 1.1);
      if (!tgt) return;
      for (const o of e.variant ? [tgt, mendTarget(e, g, tgt)] : [tgt]) {
        if (!o) continue;
        o.hp = Math.min(o.maxHp, o.hp + o.maxHp * P.mendRate * f.dt);
        o.mended = 0.2;
      }
      e.charge = 0.5 + Math.sin(e.t * 6) * 0.5;
      if (Math.random() < f.dt * 8) g.fx.mote({ x: tgt.pos.x + rand(-0.5, 0.5), y: tgt.def.y + rand(0, 0.8), z: tgt.pos.z + rand(-0.5, 0.5) }, MEND_COLOR, 0.12, 0.5);
      sfx.mend();
    },
    fire() {},
  },
};

// Shots coming in on a mirror's lit face bounce back as enemy shots. Returns true if this one did.
export function mirrorReflects(e: Enemy, g: Game, pos: THREE.Vector3, vel: THREE.Vector3): boolean {
  const a = e.beamAngle + e.pattern * Math.PI / 2, nx = Math.sin(a), nz = Math.cos(a);
  const vl = Math.hypot(vel.x, vel.z) || 1;
  const into = -(vel.x * nx + vel.z * nz) / vl;
  // variant: the opposite face is lit too
  if (into < Math.SQRT1_2 && !(e.variant && -into >= Math.SQRT1_2)) return false;  // came in on a dark face
  const s = into >= Math.SQRT1_2 ? 1 : -1;
  reflectShot(e, g, pos, vel, nx * s, nz * s, e.def.dmg * (e.elite ? g.enemies.eliteDmg : 1));
  return true;
}

// Bounce a player shot off a surface with normal (nx, nz) as an enemy shot. `e.burstT` throttles it
// so a shotgun blast doesn't come back as a wall of pellets.
export function reflectShot(e: Enemy, g: Game, pos: THREE.Vector3, vel: THREE.Vector3, nx: number, nz: number, dmg: number): void {
  if (e.burstT <= 0) {
    e.burstT = P.mirrorCooldown;
    const dot = vel.x * nx + vel.z * nz, rx = vel.x - 2 * dot * nx, rz = vel.z - 2 * dot * nz;
    g.projectiles.fireEnemy(pos, Math.atan2(rx, rz), 10, MIRROR_SHOT, 0.8, dmg);
  }
  g.fx.burst(pos, MIRROR_SHOT, 4, 6, 0.12, 0.25);
  sfx.mirror();
}

// --- special abilities ---

const SPECIALS: Partial<Record<SpecialPart, Part>> = {
  acidTrail(e, f, g) {
    e.partT -= f.dt;
    if (e.partT <= 0 && e.spawnT <= 0) {
      e.partT = P.trailEvery;
      g.ground.addPuddle(e.pos.x, e.pos.z, P.trailRadius * e.size, P.trailLife, e.variant);
    }
  },

  // Buds off a copy every few seconds; copies can copy once more. Capped per sector.
  replicate(e, f, g) {
    if (e.variant && e.gen > 0) {
      const o = g.enemies.list.find(o => o !== e && o.kind === e.kind && o.gen > 0 && o.hp > 0 && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < e.r + o.r);
      if (o) {
        // two copies touching fuse into one bigger copy (their HP added)
        e.maxHp += o.maxHp;
        e.hp += o.hp;
        e.size = Math.min(1.6, e.size * 1.25);
        e.r = e.def.r * e.size;
        e.gen = P.maxGen;
        o.noLoot = true;
        g.enemies.kill(o);
        g.fx.burst({ x: e.pos.x, y: 0.6, z: e.pos.z }, e.def.color, 16, 5, 0.18, 0.4);
        return;
      }
    }
    if (e.gen >= P.maxGen) return;
    e.partT += f.dt;
    const k = e.partT / P.replicateEvery;
    e.charge = k;
    if (k > 0.8) e.scale = 1 + (k - 0.8) * 1.2;
    if (k < 1) return;
    e.partT = 0;
    if (g.enemies.replicas >= REPLICAS_PER_SECTOR) return;
    g.enemies.replicas++;
    const a = Math.random() * Math.PI * 2, x = e.pos.x + Math.sin(a) * 1.2, z = e.pos.z + Math.cos(a) * 1.2;
    if (g.room.blocked(x, z, e.r)) return;
    g.enemies.spawn(e.kind, x, z, false, { hp: e.maxHp * P.replicaHp, size: e.size * P.replicaSize, gen: e.gen + 1, noLoot: true, plain: true });
    g.fx.burst({ x, y: 0.6, z }, e.def.color, 12, 4, 0.16, 0.4);
    sfx.replicate();
  },

  // Mirror: the body turns slowly; one face at a time is lit (reflective), and the lit face moves on
  // every 2 seconds, flickering just before.
  mirror(e, f) {
    e.beamAngle += P.mirrorTurn * f.dt;
    e.burstT -= f.dt;
    e.partT += f.dt;
    if (e.partT >= P.mirrorSwap) { e.partT = 0; e.pattern = (e.pattern + 1) % 4; }
    e.charge = e.partT > P.mirrorSwap - P.mirrorFlicker ? 1 : 0;
  },
};

// --- death effects ---

const DEATHS: Partial<Record<DeathPart, (e: Enemy, g: Game) => void>> = {
  acidPool(e, g) {
    g.ground.addPuddle(e.pos.x, e.pos.z, P.poolRadius * e.size, P.poolLife);
  },
};

export function fireAttack(e: Enemy, f: AIFrame, g: Game): void {
  const a = e.def.parts?.attack;
  if (a) (ATTACKS[a as keyof typeof ATTACKS] ?? ENDLESS_ATTACKS[a])!.fire(e, f, g);
}

export function composeBehavior(parts: EnemyParts): Part {
  const move = (MOVES[parts.move as keyof typeof MOVES] ?? ENDLESS_MOVES[parts.move])!;
  const attack = (ATTACKS[parts.attack as keyof typeof ATTACKS] ?? ENDLESS_ATTACKS[parts.attack])!;
  const special = parts.special ? (SPECIALS[parts.special as keyof typeof SPECIALS] ?? ENDLESS_SPECIALS[parts.special])! : null;
  return (e, f, g) => {
    move(e, f, g);
    attack.tick?.(e, f, g);
    special?.(e, f, g);
  };
}

export function partsOnDeath(e: Enemy, g: Game): void {
  const d = e.def.parts?.death;
  if (d) (DEATHS[d as keyof typeof DEATHS] ?? ENDLESS_DEATHS[d])!(e, g);
}

// States in which a part makes the enemy impossible to hit.
export const HIDDEN_STATES = new Set(['dive', 'under', 'rise', 'phase', ...ENDLESS_HIDDEN]);
// ...and the ones in which it isn't drawn at all.
export const INVISIBLE_STATES = new Set(['under', 'rise', 'phase']);
