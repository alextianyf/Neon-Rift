import * as THREE from 'three';

export type EnemyKind = 'grunt' | 'shooter' | 'brute' | 'boss';

export interface EnemyDef {
  hp: number;          // base HP, scaled up per room (see BALANCE)
  speed: number;
  r: number;           // collision radius
  y: number;           // mesh height above the floor
  color: number;
  dmg: number;         // contact damage
  score: number;
  cost: number;        // spawn budget cost when planning a room
  mass: number;        // knockback multiplier; lower is heavier
  dropChance: number;  // chance to drop health orbs on death
  dropCount: number;
  geo: THREE.BufferGeometry;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: {
    hp: 30, speed: 4.4, r: 0.6, y: 0.55, color: 0xff3355, dmg: 12, score: 10, cost: 1,
    mass: 1, dropChance: 0.1, dropCount: 1, geo: new THREE.BoxGeometry(1.1, 1.1, 1.1),
  },
  shooter: {
    hp: 24, speed: 3.2, r: 0.6, y: 0.9, color: 0xb455ff, dmg: 10, score: 15, cost: 1.5,
    mass: 1, dropChance: 0.1, dropCount: 1, geo: new THREE.OctahedronGeometry(0.72),
  },
  brute: {
    hp: 120, speed: 2.4, r: 1.1, y: 0.9, color: 0xff8a2a, dmg: 25, score: 35, cost: 3,
    mass: 0.35, dropChance: 0.5, dropCount: 1, geo: new THREE.BoxGeometry(2, 1.8, 2),
  },
  boss: {
    hp: 1100, speed: 2.0, r: 2.0, y: 2.2, color: 0xff2266, dmg: 30, score: 400, cost: 0,
    mass: 0.05, dropChance: 1, dropCount: 5, geo: new THREE.IcosahedronGeometry(2.1, 0),
  },
};
