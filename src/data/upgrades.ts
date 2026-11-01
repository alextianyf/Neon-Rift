import { rnd } from '../core/rng';
import { BALANCE } from './balance';
import type { Player } from '../game/player';
import { t } from '../core/i18n';

export type Rarity = 'common' | 'rare' | 'legendary';

export interface UpgradeDef {
  id: string;
  name: string;
  desc: string;
  rarity: Rarity;
  max?: number;                    // how many times it can be taken; unlimited when omitted
  apply(p: Player): void;
  available?(p: Player): boolean;  // extra condition for being offered
}

const CAP = BALANCE.caps;

export const RARITY_LABEL: Record<Rarity, string> = { common: t('普通'), rare: t('稀有'), legendary: t('传说') };
export const RARITY_PRICE: Record<Rarity, number> = { common: 20, rare: 35, legendary: 60 };

// Roll weights by context.
export const ROLL_WEIGHTS: Record<'room' | 'boss' | 'shop' | 'challenge' | 'treasure', Record<Rarity, number>> = {
  room: { common: 65, rare: 30, legendary: 5 },
  boss: { common: 0, rare: 60, legendary: 40 },
  shop: { common: 30, rare: 55, legendary: 15 },
  challenge: { common: 0, rare: 40, legendary: 60 },
  treasure: { common: 20, rare: 60, legendary: 20 },
};

export const UPGRADES: UpgradeDef[] = [
  // common
  { id: 'dmg', rarity: 'common', name: t('过载弹芯'), desc: t('伤害 +20%'), max: 5, apply: p => { p.dmgBonus += 0.2; }, available: p => p.dmgBonus < CAP.dmgBonus },
  { id: 'rate', rarity: 'common', name: t('急速扳机'), desc: t('射速 +15%'), apply: p => { p.rateMul *= 1.15; }, available: p => p.rateMul < CAP.fireRateMul },
  { id: 'reload', rarity: 'common', name: t('快速装填'), desc: t('装弹速度 +25%'), apply: p => { p.reloadMul *= 1.25; }, available: p => 1 / p.reloadMul > CAP.reloadTimeMul },
  { id: 'mag', rarity: 'common', name: t('扩容弹匣'), desc: t('弹匣容量 +30%'), max: 3, apply: p => { p.magMul *= 1.3; } },
  { id: 'hull', rarity: 'common', name: t('强化外壳'), desc: t('最大生命 +25，并回复 25'), max: 4, apply: p => { p.maxHp += 25; p.heal(25); } },
  { id: 'thrust', rarity: 'common', name: t('轻量推进'), desc: t('移动速度 +10%'), apply: p => { p.speed *= 1.1; }, available: p => p.speed < p.mechDef.speed * CAP.speedMul },
  { id: 'dash', rarity: 'common', name: t('相位冲刺'), desc: t('冲刺冷却 -25%'), max: 3, apply: p => { p.dashCdMul *= 0.75; }, available: p => p.dashCooldown > CAP.dashCooldown },
  { id: 'crit', rarity: 'common', name: t('精准校准'), desc: t('暴击率 +8%'), apply: p => { p.critChance = Math.min(CAP.critChance, p.critChance + 0.08); }, available: p => p.critChance < CAP.critChance },
  { id: 'magnet', rarity: 'common', name: t('磁力回收'), desc: t('碎片获取 +30%，拾取范围增大'), apply: p => { p.coinMul *= 1.3; p.magnetMul *= 1.4; } },
  { id: 'repair', rarity: 'common', name: t('紧急维修'), desc: t('回满生命'), apply: p => p.heal(Infinity), available: p => p.hp < p.maxHp * 0.8 },

  // rare
  { id: 'multi', rarity: 'rare', name: t('分裂射击'), desc: t('每次射击多发射子弹'), max: 3, apply: p => { p.extraShots++; } },
  { id: 'pierce', rarity: 'rare', name: t('穿甲弹'), desc: t('子弹额外穿透 1 个敌人'), apply: p => { p.pierce++; } },
  { id: 'leech', rarity: 'rare', name: t('吸能核心'), desc: t('每次击杀回复 2 生命'), max: 3, apply: p => { p.leech += 2; } },
  { id: 'bounce', rarity: 'rare', name: t('弹射弹道'), desc: t('子弹碰墙反弹 1 次'), max: 3, apply: p => { p.bounce++; } },
  { id: 'critdmg', rarity: 'rare', name: t('致命打击'), desc: t('暴击伤害 +50%'), max: 3, apply: p => { p.critMul += 0.5; } },
  { id: 'burn', rarity: 'rare', name: t('燃烧弹头'), desc: t('命中时 15% 几率点燃敌人'), apply: p => { p.burnChance += 0.15; } },
  { id: 'chill', rarity: 'rare', name: t('寒霜涂层'), desc: t('命中时 15% 几率冻结减速'), apply: p => { p.frostChance += 0.15; } },
  { id: 'shock', rarity: 'rare', name: t('电弧线圈'), desc: t('命中时 12% 几率触发闪电链'), apply: p => { p.shockChance += 0.12; } },
  { id: 'thermal', rarity: 'rare', name: t('热冲击协议'), desc: t('燃烧 + 冰冻触发的热冲击伤害 ×2、范围 +30%'), max: 2, apply: p => { p.synergyMul *= 2; p.synergyRadius *= 1.3; } },
  { id: 'conduct', rarity: 'rare', name: t('超导链路'), desc: t('闪电链 +2 目标，并把燃烧 / 冰冻传给被连锁的敌人'), max: 1, apply: p => { p.chainExtra += 2; p.chainSpread = true; } },
  { id: 'blast', rarity: 'rare', name: t('高爆装药'), desc: t('爆炸范围 +30%，爆炸伤害 +20%'), apply: p => { p.blastMul *= 1.3; p.blastDmgMul *= 1.2; } },

  // legendary
  { id: 'dashblast', rarity: 'legendary', name: t('冲刺爆破'), desc: t('冲刺时在原地引发爆炸'), max: 1, apply: p => { p.dashBlast = true; } },
  { id: 'shield', rarity: 'legendary', name: t('能量护盾'), desc: t('每个扇区抵挡一次伤害'), max: 1, apply: p => { p.shieldMax = 1; p.shield = 1; } },
  { id: 'homing', rarity: 'legendary', name: t('追踪弹头'), desc: t('子弹会自动追踪附近的敌人'), max: 1, apply: p => { p.homing = true; } },
  {
    id: 'elements', rarity: 'legendary', name: t('元素大师'), desc: t('所有元素几率 +10%，元素伤害翻倍'), max: 1,
    apply: p => { p.burnChance += 0.1; p.frostChance += 0.1; p.shockChance += 0.1; p.elementMul *= 2; },
  },
  { id: 'frenzy', rarity: 'legendary', name: t('狂热协议'), desc: t('生命低于 50% 时射速 +50%'), max: 1, apply: p => { p.frenzy = true; } },
  // legendary: change how you play
  { id: 'flametrail', rarity: 'legendary', name: t('烈焰轨迹'), desc: t('冲刺留下燃烧的地面，点燃踩上去的敌人'), max: 1, apply: p => { p.flameTrail = true; } },
  { id: 'rocket5', rarity: 'legendary', name: t('第五发'), desc: t('每第 5 次射击额外发射一枚火箭'), max: 1, apply: p => { p.rocketEvery = 5; } },
  { id: 'orbit', rarity: 'legendary', name: t('卫星刃'), desc: t('2 片光刃环绕机体，切割敌人并吞掉敌方子弹（可叠加）'), max: 2, apply: p => { p.orbitals += 2; } },
  { id: 'killblast', rarity: 'legendary', name: t('连锁殉爆'), desc: t('被击杀的敌人会爆炸，波及周围的敌人'), max: 1, apply: p => { p.killBlast = true; } },
  { id: 'nova', rarity: 'legendary', name: t('相位新星'), desc: t('冲刺时向四周射出 12 发当前武装的子弹'), max: 1, apply: p => { p.dashNova = true; } },
  { id: 'sentinel', rarity: 'legendary', name: t('驻守模式'), desc: t('站定 0.5 秒后伤害 +50%、射速 +25%（脚下光环变金色）'), max: 1, apply: p => { p.sentinel = true; } },
  {
    id: 'glass', rarity: 'legendary', name: t('玻璃大炮'), desc: t('伤害 +60%，但最大生命减半'), max: 1,
    apply: p => { p.dmgBonus += 0.6; p.maxHp = Math.max(30, Math.round(p.maxHp * 0.5)); p.hp = Math.min(p.hp, p.maxHp); },
  },
];

// Draw `n` distinct upgrades the player can still take, picking a rarity by weight first.
// `rand` defaults to the seeded run RNG; combat-time rolls pass Math.random so the run's sector layouts stay fixed.
export function rollUpgrades(p: Player, n: number, weights: Record<Rarity, number>, rand: () => number = rnd): UpgradeDef[] {
  const pool = UPGRADES.filter(u => (u.max === undefined || p.upgradeCount(u.id) < u.max) && (!u.available || u.available(p)));
  const picks: UpgradeDef[] = [];
  while (picks.length < n && pool.length) {
    const rarities = (Object.keys(weights) as Rarity[]).filter(r => weights[r] > 0 && pool.some(u => u.rarity === r));
    // fall back to any rarity when the weighted ones are exhausted
    const candidates = rarities.length ? rarities : [...new Set(pool.map(u => u.rarity))];
    const total = candidates.reduce((s, r) => s + (weights[r] || 1), 0);
    let roll = rand() * total;
    let rarity = candidates[0];
    for (const r of candidates) {
      roll -= weights[r] || 1;
      if (roll <= 0) { rarity = r; break; }
    }
    const options = pool.filter(u => u.rarity === rarity);
    const pick = options[Math.floor(rand() * options.length)];
    picks.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return picks;
}
