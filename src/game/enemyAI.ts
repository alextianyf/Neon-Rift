import type * as THREE from 'three';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import type { EnemyKind } from '../data/enemies';
import type { Enemy } from './enemies';
import type { Game } from './game';

// Per-frame inputs for a behavior. A behavior writes its intended velocity into `desired`
// and may set `e.scale` / `e.charge` for telegraph animations; movement and collision happen afterwards.
export interface AIFrame {
  toP: THREE.Vector3;  // unit vector towards the player
  dist: number;
  spd: number;         // move speed after room scaling
  desired: THREE.Vector3;
  dt: number;
}

type Behavior = (e: Enemy, f: AIFrame, g: Game) => void;

const BOMBER_FUSE = 0.7;
const SNIPER_AIM = 1.2;
const SNIPER_LOCK = 0.35;   // the aim stops tracking this long before the shot, so it can be dodged
const WEAVER_WARN = 1.0;
const WEAVER_BEAM = 3.2;
const BEAM_LENGTH = 16;

function enrage(e: Enemy, g: Game, msg: string): void {
  if (e.enraged || e.hp >= e.maxHp * 0.5) return;
  e.enraged = true;
  g.hud.toast(msg);
  g.fx.shake(0.8);
}

// Keep a preferred distance band and strafe inside it.
function kite(e: Enemy, f: AIFrame, near: number, far: number, strafe = 0.8): void {
  const { toP, dist, spd, desired } = f;
  if (dist > far) desired.copy(toP).multiplyScalar(spd);
  else if (dist < near) desired.copy(toP).multiplyScalar(-spd);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * strafe);
}

function ring(g: Game, e: Enemy, n: number, speed: number, color: number, offset = Math.random(), y = 1.2): void {
  for (let i = 0; i < n; i++) g.projectiles.fireEnemy(e.pos, offset + (i / n) * Math.PI * 2, speed, color, y);
}

// Runs straight at the player.
const grunt: Behavior = (_e, f) => {
  f.desired.copy(f.toP).multiplyScalar(f.spd);
};

// Darts at the player in a zigzag so packs spread out instead of moving as one blob.
const swarmer: Behavior = (e, f) => {
  const { toP, spd, desired } = f;
  const weave = Math.sin(e.t * 7 + e.side * 2) * 0.6;
  desired.set(toP.x - toP.z * weave, 0, toP.z + toP.x * weave).normalize().multiplyScalar(spd);
};

// Rushes in, stops and lights a short fuse, then blows up (hurting other enemies too).
const bomber: Behavior = (e, f, g) => {
  e.stateT -= f.dt;
  if (e.state === 'move') {
    f.desired.copy(f.toP).multiplyScalar(f.spd);
    if (f.dist < 2.4) { e.state = 'fuse'; e.stateT = BOMBER_FUSE; sfx.enemyShot(); }
  } else if (e.state === 'fuse') {
    e.charge = 1 - Math.max(0, e.stateT) / BOMBER_FUSE;
    e.scale = 1 + e.charge * 0.35;
    if (e.stateT <= 0) g.enemies.damage(e, e.hp + 1, { dot: true });  // detonates via kill()
  }
};

// Slow brawler; splits into a swarm when destroyed (handled on death).
const splitter: Behavior = (_e, f) => {
  f.desired.copy(f.toP).multiplyScalar(f.spd);
};

// Keeps mid range, strafes, and fires aimed shots. Swells up just before shooting.
const shooter: Behavior = (e, f, g) => {
  kite(e, f, 6, 10);
  if (Math.random() < f.dt * 0.3) e.side = e.side === 1 ? -1 : 1;
  if (e.cd < 0.35) {
    e.charge = (0.35 - e.cd) / 0.35;
    e.scale = 1 + (0.35 - e.cd) * 1.4;
  }
  if (e.cd <= 0) {
    if (f.dist < 17) {
      g.projectiles.fireEnemy(e.pos, Math.atan2(f.toP.x, f.toP.z), 11, 0xc77dff);
      sfx.enemyShot();
    }
    e.cd = rand(1.4, 2.1);
  }
};

// Hangs back, paints the player with a laser, locks, then fires one fast, heavy round.
const sniper: Behavior = (e, f, g) => {
  e.stateT -= f.dt;
  if (e.state === 'aim') {
    e.charge = 1 - Math.max(0, e.stateT) / SNIPER_AIM;
    if (e.stateT > SNIPER_LOCK) e.dir.copy(f.toP);  // track until the lock
    if (e.stateT <= 0) {
      g.projectiles.fireEnemy(e.pos, Math.atan2(e.dir.x, e.dir.z), 32, 0xff2244, 1.0, 18);
      sfx.shoot.rail();
      e.state = 'move';
      e.cd = rand(2.6, 3.4);
    }
    return;  // stands still while aiming
  }
  kite(e, f, 11, 18, 0.5);
  if (e.cd <= 0 && f.dist < 24) { e.state = 'aim'; e.stateT = SNIPER_AIM; e.dir.copy(f.toP); }
};

// Advances behind its frontal shield (blocking is handled in projectiles).
const shield: Behavior = (_e, f) => {
  f.desired.copy(f.toP).multiplyScalar(f.dist > 2 ? f.spd : 0);
};

// Keeps its distance and opens small rifts that release swarms. A priority target.
const summoner: Behavior = (e, f, g) => {
  kite(e, f, 9, 13, 0.6);
  if (e.cd < 0.8) e.charge = (0.8 - e.cd) / 0.8;
  if (e.cd <= 0) {
    const a = Math.random() * Math.PI * 2, x = e.pos.x + Math.sin(a) * 2, z = e.pos.z + Math.cos(a) * 2;
    if (!g.room.blocked(x, z, 0.5)) g.enemies.addMarker('swarmer', x, z, 0.6, e.elite ? 5 : 3);
    e.cd = rand(4.5, 5.5);
  }
};

// Walks in, winds up, then charges in a straight line. Hitting a wall stuns it.
const brute: Behavior = (e, f, g) => {
  const { toP, dist, spd, desired } = f;
  e.stateT -= f.dt;
  switch (e.state) {
    case 'move':
      desired.copy(toP).multiplyScalar(spd);
      if (dist < 10 && e.cd <= 0) { e.state = 'wind'; e.stateT = 0.6; }
      break;
    case 'wind':
      e.dir.copy(toP);
      e.charge = 1;
      e.scale = 1 + (0.6 - e.stateT) * 0.25;
      if (e.stateT <= 0) { e.state = 'charge'; e.stateT = 0.7; }
      break;
    case 'charge':
      desired.copy(e.dir).multiplyScalar(17);
      if (Math.random() < 0.6) g.fx.burst({ x: e.pos.x, y: 0.4, z: e.pos.z }, e.def.color, 1, 1, 0.3, 0.3);
      if (e.stateT <= 0) { e.state = 'move'; e.cd = 2.5; }
      break;
    case 'stun':
      e.mesh.rotation.z = Math.sin(e.t * 30) * 0.1;
      if (e.stateT <= 0) { e.state = 'move'; e.cd = 2; e.mesh.rotation.z = 0; }
      break;
  }
};

// Guardian: cycles ring burst -> aimed volleys -> summon minions. Faster and denser below 50% HP.
const boss: Behavior = (e, f, g) => {
  const { toP, dist, spd, desired } = f;
  enrage(e, g, '核心过载！');
  if (dist > 8) desired.copy(toP).multiplyScalar(spd);
  else desired.set(-toP.z, 0, toP.x).multiplyScalar(spd * 0.7);

  if (e.cd <= 0) {
    const pattern = e.pattern++ % 3;
    if (pattern === 0) {
      ring(g, e, e.enraged ? 28 : 18, e.enraged ? 9 : 7.5, 0xff3377);
      sfx.enemyShot();
      g.fx.shake(0.2);
    } else if (pattern === 1) {
      e.burst = e.enraged ? 5 : 3;
      e.burstT = 0;
    } else {
      for (let i = 0, n = e.enraged ? 4 : 3; i < n; i++) {
        const a = Math.random() * Math.PI * 2, x = e.pos.x + Math.sin(a) * 4, z = e.pos.z + Math.cos(a) * 4;
        if (!g.room.blocked(x, z, 0.7)) g.enemies.addMarker('grunt', x, z, 0.8);
      }
    }
    e.cd = e.enraged ? 1.6 : 2.3;
  }
  if (e.burst > 0) {
    e.burstT -= f.dt;
    if (e.burstT <= 0) {
      e.burstT = 0.22;
      e.burst--;
      const a = Math.atan2(toP.x, toP.z);
      for (let k = -2; k <= 2; k++) g.projectiles.fireEnemy(e.pos, a + k * 0.16, 12, 0xffaa33, 1.2);
      sfx.enemyShot();
    }
  }
};

// Weaver: circles the arena; sweeps three rotating laser beams, scatters drifting mines,
// and calls in bombers. Lasers are telegraphed with a flickering warning first.
const boss2: Behavior = (e, f, g) => {
  enrage(e, g, '织网过载！');
  // patrol a circle around the room center
  const orbit = Math.atan2(e.pos.x, e.pos.z) + 0.6;
  const tx = Math.sin(orbit) * 6, tz = Math.cos(orbit) * 5;
  f.desired.set(tx - e.pos.x, 0, tz - e.pos.z).normalize().multiplyScalar(e.state === 'beam' ? f.spd * 0.3 : f.spd);

  if (e.state === 'beam') {
    e.stateT -= f.dt;
    e.beamAngle += f.dt * (e.enraged ? 1.4 : 0.9);
    if (e.beamPhase === 1 && e.stateT <= 0) { e.beamPhase = 2; e.stateT = WEAVER_BEAM; sfx.zap(); }
    else if (e.beamPhase === 2) {
      // damage along each beam
      const p = g.player, dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
      for (let i = 0; i < 3; i++) {
        const a = e.beamAngle + (i / 3) * Math.PI * 2, bx = Math.sin(a), bz = Math.cos(a);
        const along = dx * bx + dz * bz, across = Math.abs(dx * bz - dz * bx);
        if (along > 0 && along < BEAM_LENGTH && across < p.r + 0.35) g.damagePlayer(20, null);
      }
      if (e.stateT <= 0) { e.beamPhase = 0; e.state = 'move'; e.cd = 1.2; }
    }
    return;
  }

  if (e.cd <= 0) {
    const pattern = e.pattern++ % 3;
    if (pattern === 0) {
      e.state = 'beam';
      e.beamPhase = 1;
      e.stateT = WEAVER_WARN;
      e.beamAngle = Math.atan2(f.toP.x, f.toP.z) + Math.PI / 3;
    } else if (pattern === 1) {
      // slow drifting mines
      for (let i = 0, n = e.enraged ? 12 : 8; i < n; i++) {
        g.projectiles.fireEnemy(e.pos, (i / n) * Math.PI * 2 + Math.random() * 0.3, rand(1.8, 3.2), 0xff3d9e, 0.8, 15, 7);
      }
      sfx.enemyShot();
      e.cd = 2.2;
    } else {
      for (let i = 0, n = e.enraged ? 4 : 3; i < n; i++) {
        const [x, z] = g.room.findSpawn(g.player.pos, 6, 0.6);
        g.enemies.addMarker('bomber', x, z, 0.8);
      }
      e.cd = 2.6;
    }
  }
};

// Sovereign: phases out through a rift and reappears elsewhere, fires rotating spirals,
// and summons elite guards.
const boss3: Behavior = (e, f, g) => {
  enrage(e, g, '主宰觉醒！');
  e.stateT -= f.dt;
  if (e.state === 'tpout') {
    e.scale = Math.max(0.05, e.stateT / 0.6);
    if (e.stateT <= 0) {
      const [x, z] = g.room.findSpawn(g.player.pos, 9, 2.2);
      e.pos.set(x, 0, z);
      g.fx.shockwave(x, z, 4, e.def.color);
      e.state = 'tpin';
      e.stateT = 0.6;
    }
    return;
  }
  if (e.state === 'tpin') {
    e.scale = 1 - Math.max(0, e.stateT) / 0.6;
    if (e.stateT <= 0) {
      e.state = 'move';
      ring(g, e, e.enraged ? 32 : 24, 7, 0xa13dff);
      g.fx.burst({ x: e.pos.x, y: 2, z: e.pos.z }, e.def.color, 40, 10, 0.25, 0.6);
      sfx.riftOpen(true);
    }
    return;
  }
  if (e.state === 'spiral') {
    f.desired.set(0, 0, 0);
    e.burstT -= f.dt;
    if (e.burstT <= 0) {
      e.burstT = 0.09;
      e.beamAngle += 0.27;
      const arms = e.enraged ? 6 : 4;
      for (let i = 0; i < arms; i++) g.projectiles.fireEnemy(e.pos, e.beamAngle + (i / arms) * Math.PI * 2, 8, 0xc77dff, 1.4);
    }
    if (e.stateT <= 0) { e.state = 'move'; e.cd = 1.2; }
    return;
  }

  if (f.dist > 9) f.desired.copy(f.toP).multiplyScalar(f.spd);
  else f.desired.set(-f.toP.z, 0, f.toP.x).multiplyScalar(f.spd * 0.6);
  if (e.cd <= 0) {
    const pattern = e.pattern++ % 3;
    if (pattern === 0) { e.state = 'spiral'; e.stateT = 3; e.burstT = 0; }
    else if (pattern === 1) {
      e.state = 'tpout';
      e.stateT = 0.6;
      g.fx.shockwave(e.pos.x, e.pos.z, 4, e.def.color);
    } else {
      for (let i = 0; i < 2; i++) {
        const [x, z] = g.room.findSpawn(g.player.pos, 6, 0.7);
        g.enemies.addMarker('grunt', x, z, 0.9, 1, true);
      }
      e.cd = 1.5;
    }
  }
};

export const BEHAVIORS: Record<EnemyKind, Behavior> = {
  grunt, swarmer, bomber, splitter, shooter, sniper, shield, summoner, brute, boss, boss2, boss3,
};

// Enemies that can't be hit right now (sovereign phasing through a rift).
export const untargetable = (e: Enemy): boolean => e.state === 'tpout' || e.state === 'tpin';
