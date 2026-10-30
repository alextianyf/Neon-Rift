import type { Player } from '../game/player';

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

export const RARITY_LABEL: Record<Rarity, string> = { common: '普通', rare: '稀有', legendary: '传说' };
export const RARITY_PRICE: Record<Rarity, number> = { common: 20, rare: 35, legendary: 60 };

// Roll weights by context.
export const ROLL_WEIGHTS: Record<'room' | 'boss' | 'shop', Record<Rarity, number>> = {
  room: { common: 65, rare: 30, legendary: 5 },
  boss: { common: 0, rare: 60, legendary: 40 },
  shop: { common: 30, rare: 55, legendary: 15 },
};

export const UPGRADES: UpgradeDef[] = [
  // common
  { id: 'dmg', rarity: 'common', name: '过载弹芯', desc: '伤害 +20%', apply: p => { p.dmgMul *= 1.2; } },
  { id: 'rate', rarity: 'common', name: '急速扳机', desc: '射速 +15%', apply: p => { p.rateMul *= 1.15; } },
  { id: 'hull', rarity: 'common', name: '强化外壳', desc: '最大生命 +25，并回复 25', apply: p => { p.maxHp += 25; p.heal(25); } },
  { id: 'thrust', rarity: 'common', name: '轻量推进', desc: '移动速度 +10%', apply: p => { p.speed *= 1.1; } },
  { id: 'dash', rarity: 'common', name: '相位冲刺', desc: '冲刺冷却 -25%', max: 3, apply: p => { p.dashCdMul *= 0.75; } },
  { id: 'crit', rarity: 'common', name: '精准校准', desc: '暴击率 +8%', apply: p => { p.critChance += 0.08; } },
  { id: 'magnet', rarity: 'common', name: '磁力回收', desc: '金币获取 +30%，拾取范围增大', apply: p => { p.coinMul *= 1.3; p.magnetMul *= 1.4; } },
  { id: 'repair', rarity: 'common', name: '紧急维修', desc: '回满生命', apply: p => p.heal(Infinity), available: p => p.hp < p.maxHp * 0.8 },

  // rare
  { id: 'multi', rarity: 'rare', name: '分裂射击', desc: '每次射击多发射子弹', max: 3, apply: p => { p.extraShots++; } },
  { id: 'pierce', rarity: 'rare', name: '穿甲弹', desc: '子弹额外穿透 1 个敌人', apply: p => { p.pierce++; } },
  { id: 'leech', rarity: 'rare', name: '吸能核心', desc: '每次击杀回复 2 生命', apply: p => { p.leech += 2; } },
  { id: 'bounce', rarity: 'rare', name: '弹射弹道', desc: '子弹碰墙反弹 1 次', max: 3, apply: p => { p.bounce++; } },
  { id: 'critdmg', rarity: 'rare', name: '致命打击', desc: '暴击伤害 +50%', apply: p => { p.critMul += 0.5; } },
  { id: 'burn', rarity: 'rare', name: '燃烧弹头', desc: '命中时 15% 几率点燃敌人', apply: p => { p.burnChance += 0.15; } },
  { id: 'chill', rarity: 'rare', name: '寒霜涂层', desc: '命中时 15% 几率冻结减速', apply: p => { p.frostChance += 0.15; } },
  { id: 'shock', rarity: 'rare', name: '电弧线圈', desc: '命中时 12% 几率触发闪电链', apply: p => { p.shockChance += 0.12; } },
  { id: 'blast', rarity: 'rare', name: '高爆装药', desc: '爆炸范围 +30%，爆炸伤害 +20%', apply: p => { p.blastMul *= 1.3; p.blastDmgMul *= 1.2; } },

  // legendary
  { id: 'dashblast', rarity: 'legendary', name: '冲刺爆破', desc: '冲刺时在原地引发爆炸', max: 1, apply: p => { p.dashBlast = true; } },
  { id: 'shield', rarity: 'legendary', name: '能量护盾', desc: '每个房间抵挡一次伤害', max: 1, apply: p => { p.shieldMax = 1; p.shield = 1; } },
  { id: 'homing', rarity: 'legendary', name: '追踪弹头', desc: '子弹会自动追踪附近的敌人', max: 1, apply: p => { p.homing = true; } },
  {
    id: 'elements', rarity: 'legendary', name: '元素大师', desc: '所有元素几率 +10%，元素伤害翻倍', max: 1,
    apply: p => { p.burnChance += 0.1; p.frostChance += 0.1; p.shockChance += 0.1; p.elementMul *= 2; },
  },
  { id: 'frenzy', rarity: 'legendary', name: '狂热协议', desc: '生命低于 50% 时射速 +50%', max: 1, apply: p => { p.frenzy = true; } },
];

// Draw `n` distinct upgrades the player can still take, picking a rarity by weight first.
export function rollUpgrades(p: Player, n: number, weights: Record<Rarity, number>): UpgradeDef[] {
  const pool = UPGRADES.filter(u => (u.max === undefined || p.upgradeCount(u.id) < u.max) && (!u.available || u.available(p)));
  const picks: UpgradeDef[] = [];
  while (picks.length < n && pool.length) {
    const rarities = (Object.keys(weights) as Rarity[]).filter(r => weights[r] > 0 && pool.some(u => u.rarity === r));
    // fall back to any rarity when the weighted ones are exhausted
    const candidates = rarities.length ? rarities : [...new Set(pool.map(u => u.rarity))];
    const total = candidates.reduce((s, r) => s + (weights[r] || 1), 0);
    let roll = Math.random() * total;
    let rarity = candidates[0];
    for (const r of candidates) {
      roll -= weights[r] || 1;
      if (roll <= 0) { rarity = r; break; }
    }
    const options = pool.filter(u => u.rarity === rarity);
    const pick = options[Math.floor(Math.random() * options.length)];
    picks.push(pick);
    pool.splice(pool.indexOf(pick), 1);
  }
  return picks;
}
