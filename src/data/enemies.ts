import { t } from '../core/i18n';
export type EnemyKind =
  | 'grunt' | 'swarmer' | 'bomber' | 'splitter' | 'shooter' | 'sniper' | 'shield' | 'summoner' | 'brute'
  | 'boss' | 'boss2' | 'boss3';

export interface EnemyDef {
  name: string;
  hp: number;          // base HP, scaled up per room (see BALANCE)
  speed: number;
  r: number;           // collision radius
  y: number;           // mesh height above the floor
  color: number;
  dmg: number;         // contact damage (bombers: explosion damage)
  score: number;
  cost: number;        // spawn budget cost when planning a room
  mass: number;        // knockback multiplier; lower is heavier
  ccResist: number;    // 0..1, how much frost slow is reduced
  dropChance: number;  // chance to drop health orbs on death
  dropCount: number;
  coins: [number, number];
  boss?: boolean;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: {
    name: t('冲锋兵'), hp: 30, speed: 4.4, r: 0.6, y: 0.55, color: 0xff3355, dmg: 12, score: 10, cost: 1,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 2],
  },
  swarmer: {
    name: t('蜂群体'), hp: 9, speed: 6.4, r: 0.38, y: 0.4, color: 0xff5a8c, dmg: 6, score: 4, cost: 0.35,
    mass: 1.4, ccResist: 0, dropChance: 0.02, dropCount: 1, coins: [0, 1],
  },
  bomber: {
    name: t('自爆虫'), hp: 18, speed: 5.2, r: 0.55, y: 0.55, color: 0xff4400, dmg: 22, score: 12, cost: 1.2,
    mass: 1, ccResist: 0, dropChance: 0.06, dropCount: 1, coins: [1, 2],
  },
  splitter: {
    name: t('分裂体'), hp: 48, speed: 3.4, r: 0.75, y: 0.7, color: 0xe0408a, dmg: 14, score: 18, cost: 1.6,
    mass: 0.7, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 3],
  },
  shooter: {
    name: t('射手'), hp: 24, speed: 3.2, r: 0.6, y: 0.9, color: 0xb455ff, dmg: 10, score: 15, cost: 1.5,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 3],
  },
  sniper: {
    name: t('狙击手'), hp: 30, speed: 2.8, r: 0.55, y: 1.0, color: 0xff2244, dmg: 10, score: 20, cost: 1.8,
    mass: 1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
  },
  shield: {
    name: t('护盾兵'), hp: 70, speed: 2.8, r: 0.75, y: 0.8, color: 0x8f6bff, dmg: 16, score: 25, cost: 2.2,
    mass: 0.6, ccResist: 0.2, dropChance: 0.12, dropCount: 1, coins: [2, 4],
  },
  summoner: {
    name: t('召唤者'), hp: 45, speed: 2.6, r: 0.65, y: 1.2, color: 0xd14dff, dmg: 8, score: 28, cost: 2.5,
    mass: 1, ccResist: 0, dropChance: 0.15, dropCount: 1, coins: [2, 4],
  },
  brute: {
    name: t('重装兵'), hp: 120, speed: 2.4, r: 1.1, y: 0.9, color: 0xff8a2a, dmg: 25, score: 35, cost: 3,
    mass: 0.35, ccResist: 0.3, dropChance: 0.5, dropCount: 1, coins: [3, 5],
  },
  boss: {
    name: t('核心守卫者'), hp: 1100, speed: 2.0, r: 2.0, y: 2.2, color: 0xff2266, dmg: 30, score: 400, cost: 0,
    mass: 0.05, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [25, 30], boss: true,
  },
  boss2: {
    name: t('织网者'), hp: 1500, speed: 2.6, r: 2.0, y: 1.6, color: 0xff3d9e, dmg: 30, score: 600, cost: 0,
    mass: 0.05, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [35, 40], boss: true,
  },
  boss3: {
    name: t('裂隙主宰'), hp: 2100, speed: 1.8, r: 2.2, y: 2.4, color: 0xa13dff, dmg: 35, score: 900, cost: 0,
    mass: 0.04, ccResist: 0.7, dropChance: 1, dropCount: 6, coins: [45, 55], boss: true,
  },
};

// Which enemies can appear from which sector depth, and how often. `pack` enemies arrive in groups.
export const SPAWN_TABLE: { kind: EnemyKind; from: number; weight: number; pack?: [number, number] }[] = [
  { kind: 'grunt', from: 1, weight: 30 },
  { kind: 'swarmer', from: 2, weight: 16, pack: [5, 9] },
  { kind: 'shooter', from: 2, weight: 18 },
  { kind: 'bomber', from: 3, weight: 12 },
  { kind: 'splitter', from: 4, weight: 10 },
  { kind: 'brute', from: 4, weight: 8 },
  { kind: 'shield', from: 5, weight: 9 },
  { kind: 'sniper', from: 6, weight: 8 },
  { kind: 'summoner', from: 7, weight: 6 },
];

// Bosses rotate every boss sector: 5 -> guardian, 10 -> weaver, 15 -> sovereign, then repeat.
const BOSS_ORDER: EnemyKind[] = ['boss', 'boss2', 'boss3'];
export const bossFor = (n: number): EnemyKind => BOSS_ORDER[(Math.max(1, Math.floor(n / 5)) - 1) % BOSS_ORDER.length];
