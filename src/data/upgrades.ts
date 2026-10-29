import type { Player } from '../game/player';

export interface UpgradeDef {
  name: string;
  desc: string;
  apply(p: Player): void;
  available?(p: Player): boolean;  // omitted means always offered
}

export const UPGRADES: UpgradeDef[] = [
  { name: '过载弹芯', desc: '伤害 +25%', apply: p => { p.dmgMul *= 1.25; } },
  { name: '急速扳机', desc: '射速 +20%', apply: p => { p.rateMul *= 1.2; } },
  { name: '强化外壳', desc: '最大生命 +25，并回复 25', apply: p => { p.maxHp += 25; p.heal(25); } },
  { name: '轻量推进', desc: '移动速度 +12%', apply: p => { p.speed *= 1.12; } },
  { name: '相位冲刺', desc: '冲刺冷却 -30%', apply: p => { p.dashCdMul *= 0.7; } },
  { name: '分裂射击', desc: '每次射击多发射子弹', apply: p => { p.extraShots++; } },
  { name: '穿甲弹', desc: '子弹额外穿透 1 个敌人', apply: p => { p.pierce++; } },
  { name: '吸能核心', desc: '每次击杀回复 2 生命', apply: p => { p.leech += 2; } },
  { name: '高爆装药', desc: '火箭爆炸范围 +30%', apply: p => { p.blastMul *= 1.3; } },
  { name: '紧急维修', desc: '回满生命', apply: p => p.heal(Infinity), available: p => p.hp < p.maxHp * 0.8 },
];
