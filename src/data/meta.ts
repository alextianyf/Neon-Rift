import { t } from '../core/i18n';
import type { WeaponId } from './weapons';
// Long-term progression: mechs to unlock and permanent talents, bought with rift crystals
// earned at the end of every run.

export type MechId = 'vanguard' | 'bastion' | 'phantom';
export type SkillId = 'overdrive' | 'barrier' | 'blink';

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

export const MECHS: Record<MechId, MechDef> = {
  vanguard: {
    id: 'vanguard', name: t('先锋'), desc: t('均衡的标准机体'), cost: 0,
    hp: 100, speed: 8.5, dashCdMul: 1, dmgMul: 1, critBonus: 0, shield: 0, starter: 'pulse',
    skill: 'overdrive', skillName: t('过载射击'), skillDesc: t('5 秒内射速 +60%、伤害 +20%，且不消耗弹药'), skillCd: 16,
    palette: { armor: 0x8e99ad, armorTop: 0xa4adbc, paint: 0xff7a1a, accent: 0x4ff0ff }, scale: 1.3,
  },
  bastion: {
    id: 'bastion', name: t('堡垒'), desc: t('重装机体：血厚、每扇区自带护盾，但更慢'), cost: 60,
    hp: 140, speed: 7.6, dashCdMul: 1.15, dmgMul: 1, critBonus: 0, shield: 1, starter: 'shotgun',
    skill: 'barrier', skillName: t('电磁屏障'), skillDesc: t('3 秒无敌，并清除周围的敌方子弹'), skillCd: 18,
    palette: { armor: 0x8a8f78, armorTop: 0xa8ad92, paint: 0xffc83d, accent: 0x66ccff }, scale: 1.45,
  },
  phantom: {
    id: 'phantom', name: t('幻影'), desc: t('轻型机体：快、冲刺冷却短、暴击高，但更脆'), cost: 80,
    hp: 80, speed: 9.8, dashCdMul: 0.8, dmgMul: 1, critBonus: 0.12, shield: 0, starter: 'smg',
    skill: 'blink', skillName: t('相位闪现'), skillDesc: t('向准星方向闪现，撕裂路径上的敌人'), skillCd: 7,
    palette: { armor: 0x5c5470, armorTop: 0x7a7090, paint: 0xff4dd2, accent: 0xc77dff }, scale: 1.2,
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

export const TALENTS: TalentDef[] = [
  { id: 'armor', name: t('装甲强化'), desc: l => t('最大生命 +{n}', { n: l * 10 }), max: 5, cost: l => 15 + l * 10 },
  { id: 'firepower', name: t('火控校准'), desc: l => t('伤害 +{n}%', { n: l * 5 }), max: 5, cost: l => 20 + l * 10 },
  { id: 'thrusters', name: t('推进优化'), desc: l => t('冲刺冷却 -{n}%', { n: l * 6 }), max: 4, cost: l => 15 + l * 10 },
  { id: 'salvage', name: t('碎片回收'), desc: l => t('碎片获取 +{n}%', { n: l * 10 }), max: 4, cost: l => 15 + l * 10 },
  { id: 'funding', name: t('启动资金'), desc: l => t('开局携带 {n} 碎片', { n: l * 15 }), max: 3, cost: l => 20 + l * 15 },
  { id: 'revive', name: t('复苏协议'), desc: l => (l ? t('每局可复活一次（50% 生命）') : t('解锁后每局可复活一次')), max: 1, cost: () => 120 },
];

// Crystals awarded for a run (never fewer than MIN_RUN_CRYSTALS, so even a short run helps the talents along).
export const MIN_RUN_CRYSTALS = 10;
export function crystalsFor(run: { score: number; room: number; bosses: number }): number {
  return Math.max(MIN_RUN_CRYSTALS, Math.floor(run.score / 60) + run.room * 2 + run.bosses * 15);
}
