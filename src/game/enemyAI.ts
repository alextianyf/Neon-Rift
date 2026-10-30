import type * as THREE from 'three';
import { sfx } from '../core/audio';
import { rand } from '../core/math';
import type { EnemyKind } from '../data/enemies';
import type { Enemy } from './enemies';
import type { Game } from './game';

// Per-frame inputs for a behavior. A behavior writes its intended velocity into `desired`
// and may set `e.scale` for telegraph animations; movement and collision happen afterwards.
export interface AIFrame {
  toP: THREE.Vector3;  // unit vector towards the player
  dist: number;
  spd: number;         // move speed after room scaling
  desired: THREE.Vector3;
  dt: number;
}

type Behavior = (e: Enemy, f: AIFrame, g: Game) => void;

// Runs straight at the player.
const grunt: Behavior = (_e, f) => {
  f.desired.copy(f.toP).multiplyScalar(f.spd);
};

// Keeps mid range, strafes, and fires aimed shots. Swells up just before shooting.
const shooter: Behavior = (e, f, g) => {
  const { toP, dist, spd, desired } = f;
  if (dist > 10) desired.copy(toP).multiplyScalar(spd);
  else if (dist < 6) desired.copy(toP).multiplyScalar(-spd);
  else desired.set(-toP.z * e.side, 0, toP.x * e.side).multiplyScalar(spd * 0.8);
  if (Math.random() < f.dt * 0.3) e.side = e.side === 1 ? -1 : 1;
  if (e.cd < 0.35) e.scale = 1 + (0.35 - e.cd) * 1.4;
  if (e.cd <= 0) {
    if (dist < 17) {
      g.projectiles.fireEnemy(e.pos, Math.atan2(toP.x, toP.z), 11, 0xc77dff);
      sfx.enemyShot();
    }
    e.cd = rand(1.4, 2.1);
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

// Cycles ring burst -> aimed volleys -> summon minions. Faster and denser below 50% HP.
const boss: Behavior = (e, f, g) => {
  const { toP, dist, spd, desired } = f;
  if (!e.enraged && e.hp < e.maxHp * 0.5) {
    e.enraged = true;
    g.hud.toast('核心过载！');
    g.fx.shake(0.8);
  }
  if (dist > 8) desired.copy(toP).multiplyScalar(spd);
  else desired.set(-toP.z, 0, toP.x).multiplyScalar(spd * 0.7);

  if (e.cd <= 0) {
    const pattern = e.pattern++ % 3;
    if (pattern === 0) {
      const n = e.enraged ? 28 : 18, off = Math.random();
      for (let i = 0; i < n; i++) g.projectiles.fireEnemy(e.pos, off + i / n * Math.PI * 2, e.enraged ? 9 : 7.5, 0xff3377, 1.2);
      sfx.enemyShot();
      g.fx.shake(0.2);
    } else if (pattern === 1) {
      e.burst = e.enraged ? 5 : 3;
      e.burstT = 0;
    } else {
      const n = e.enraged ? 4 : 3;
      for (let i = 0; i < n; i++) {
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

export const BEHAVIORS: Record<EnemyKind, Behavior> = { grunt, shooter, brute, boss };
