import { t } from '../core/i18n';
import type { WeaponId } from './weapons';
import type { Rarity } from './upgrades';
// Long-term progression: mechs to unlock and permanent talents, bought with rift crystals
// earned at the end of every run.

export type MechId = 'vanguard' | 'bastion' | 'phantom' | 'apex';
export type SkillId = 'overdrive' | 'barrier' | 'clones' | 'orbital';

export interface MechPalette {
  armor: number;
  armorTop: number;
  paint: number;
  accent: number;
}

export interface MechDef {
  id: MechId;
  name: string;
  desc: string;
  cost: number;        // crystals to unlock
  rarity: Rarity;      // hangar color and tag, same palette as modules
  needsWin?: boolean;  // can only be unlocked after beating the sector 15 boss once
  killCdEvery?: number; // passive: every this many kills, the skill cooldown drops by 1s
  hp: number;
  speed: number;
  dashCdMul: number;
  dmgMul: number;
  critBonus: number;
  shield: number;      // free shield charges per sector
  starter: WeaponId;   // starting weapon: unlimited reserve ammo, can't be dropped
  skill: SkillId;
  skillName: string;
  skillDesc: string;
  skillCd: number;
  palette: MechPalette;
  scale: number;
}

// The free mech every profile starts with.
export const DEFAULT_MECH: MechId = 'bastion';

// Listed in the hangar in this order, cheapest first.
export const MECHS: Record<MechId, MechDef> = {
  bastion: {
    id: 'bastion', name: t('堡垒'), desc: t('重装机体：血厚、每扇区自带护盾，但更慢'), cost: 0, rarity: 'common',
    hp: 140, speed: 7.6, dashCdMul: 1.15, dmgMul: 1, critBonus: 0, shield: 1, starter: 'shotgun',
    skill: 'barrier', skillName: t('电磁屏障'), skillDesc: t('3 秒无敌，并清除周围的敌方子弹'), skillCd: 18,
    palette: { armor: 0x8a8f78, armorTop: 0xa8ad92, paint: 0xffc83d, accent: 0x66ccff }, scale: 1.45,
  },
  vanguard: {
    id: 'vanguard', name: t('先锋'), desc: t('均衡的标准机体，爆发强'), cost: 100, rarity: 'rare',
    hp: 100, speed: 8.5, dashCdMul: 1, dmgMul: 1, critBonus: 0, shield: 0, starter: 'pulse',
    skill: 'overdrive', skillName: t('过载射击'), skillDesc: t('5 秒内射速 +60%、伤害 +20%，且不消耗弹药'), skillCd: 16,
    palette: { armor: 0x8e99ad, armorTop: 0xa4adbc, paint: 0xff7a1a, accent: 0x4ff0ff }, scale: 1.3,
  },
  phantom: {
    id: 'phantom', name: t('幻影'), desc: t('轻型机体：快、冲刺冷却短、暴击高，但更脆'), cost: 200, rarity: 'rare',
    hp: 80, speed: 9.8, dashCdMul: 0.8, dmgMul: 1, critBonus: 0.12, shield: 0, starter: 'smg',
    skill: 'clones', skillName: t('幻影分身'), skillDesc: t('6 秒内左右各出现一个分身，复制你的每一发子弹（50% 伤害），并吸引敌人火力；分身被打 3 下就消失'), skillCd: 15,
    palette: { armor: 0x6a6282, armorTop: 0x9188b0, paint: 0xff4dd2, accent: 0xc77dff }, scale: 1.2,
  },
  apex: {
    id: 'apex', name: t('奇点'), desc: t('传说机体：各项属性均衡偏高，击杀加速技能冷却'), cost: 600, rarity: 'legendary', needsWin: true, killCdEvery: 10,
    hp: 110, speed: 9, dashCdMul: 0.9, dmgMul: 1, critBonus: 0.08, shield: 0, starter: 'prism',
    skill: 'orbital', skillName: t('轨道湮灭'), skillDesc: t('锁定屏幕内所有敌人，1 秒后轨道光束同时轰击（伤害相当于当前武器 6 秒的输出），并清空全场敌方子弹'), skillCd: 25,
    palette: { armor: 0xc9ced8, armorTop: 0xe6e9ef, paint: 0xffc83d, accent: 0xffe27a }, scale: 1.35,
  },
};

export type TalentId = 'armor' | 'firepower' | 'thrusters' | 'salvage' | 'funding' | 'revive';

export interface TalentDef {
  id: TalentId;
  name: string;
  desc: (level: number) => string;
  max: number;
  cost: (level: number) => number;  // price of going from `level` to `level + 1`
}

// Each level costs 1.5x the one before (docs/机体与天赋.md).
const TALENT_STEP = 1.5;
const escalating = (base: number) => (l: number) => Math.round(base * TALENT_STEP ** l);

export const TALENTS: TalentDef[] = [
  { id: 'armor', name: t('装甲强化'), desc: l => t('最大生命 +{n}', { n: l * 10 }), max: 5, cost: escalating(20) },
  { id: 'firepower', name: t('火控校准'), desc: l => t('伤害 +{n}%', { n: l * 5 }), max: 5, cost: escalating(25) },
  { id: 'thrusters', name: t('推进优化'), desc: l => t('冲刺冷却 -{n}%', { n: l * 6 }), max: 4, cost: escalating(20) },
  { id: 'salvage', name: t('碎片回收'), desc: l => t('碎片获取 +{n}%', { n: l * 10 }), max: 4, cost: escalating(20) },
  { id: 'funding', name: t('启动资金'), desc: l => t('开局携带 {n} 碎片', { n: l * 15 }), max: 3, cost: escalating(25) },
  { id: 'revive', name: t('复苏协议'), desc: l => (l ? t('每局可复活一次（50% 生命）') : t('解锁后每局可复活一次')), max: 1, cost: () => 200 },
];

// Crystals awarded for a run (never fewer than MIN_RUN_CRYSTALS, so even a short run helps the talents along).
export const MIN_RUN_CRYSTALS = 10;
export function crystalsFor(run: { score: number; room: number; bosses: number }): number {
  return Math.max(MIN_RUN_CRYSTALS, Math.floor(run.score / 60) + run.room * 2 + run.bosses * 15);
}
