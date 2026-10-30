export type EnemyKind = 'grunt' | 'swarmer' | 'shooter' | 'brute' | 'boss';

export interface EnemyDef {
  name: string;
  hp: number;          // base HP, scaled up per room (see BALANCE)
  speed: number;
  r: number;           // collision radius
  y: number;           // mesh height above the floor
  color: number;
  dmg: number;         // contact damage
  score: number;
  cost: number;        // spawn budget cost when planning a room
  mass: number;        // knockback multiplier; lower is heavier
  ccResist: number;    // 0..1, how much frost slow is reduced
  dropChance: number;  // chance to drop health orbs on death
  dropCount: number;
  coins: [number, number];
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: {
    name: '冲锋兵', hp: 30, speed: 4.4, r: 0.6, y: 0.55, color: 0xff3355, dmg: 12, score: 10, cost: 1,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 2],
  },
  swarmer: {
    name: '蜂群体', hp: 9, speed: 6.4, r: 0.38, y: 0.4, color: 0xff5a8c, dmg: 6, score: 4, cost: 0.35,
    mass: 1.4, ccResist: 0, dropChance: 0.02, dropCount: 1, coins: [0, 1],
  },
  shooter: {
    name: '射手', hp: 24, speed: 3.2, r: 0.6, y: 0.9, color: 0xb455ff, dmg: 10, score: 15, cost: 1.5,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 3],
  },
  brute: {
    name: '重装兵', hp: 120, speed: 2.4, r: 1.1, y: 0.9, color: 0xff8a2a, dmg: 25, score: 35, cost: 3,
    mass: 0.35, ccResist: 0.3, dropChance: 0.5, dropCount: 1, coins: [3, 5],
  },
  boss: {
    name: '核心守卫者', hp: 1100, speed: 2.0, r: 2.0, y: 2.2, color: 0xff2266, dmg: 30, score: 400, cost: 0,
    mass: 0.05, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [25, 30],
  },
};
