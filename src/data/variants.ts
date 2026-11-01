import { t } from '../core/i18n';
import type { EnemyKind } from './enemies';

// Abyss variants (docs/敌人.md, sectors 61-150): every enemy gets an "abyss" form that changes one
// behavior. Two unlock every 5 sectors in the order the enemies first appeared; once unlocked, each
// spawn of that kind has a 35% chance to be the variant (rising after sector 150).
export const VARIANTS: { kind: EnemyKind; desc: string }[] = [
  { kind: 'grunt', desc: t('冲到 3 米内时停顿 0.3 秒，然后猛扑一下') },
  { kind: 'swarmer', desc: t('死亡时留下一颗火花，0.6 秒后炸开') },
  { kind: 'shooter', desc: t('一次射三发扇形') },
  { kind: 'bomber', desc: t('点燃引信后跳向玩家的位置，有落点预警') },
  { kind: 'splitter', desc: t('分裂出自爆虫，不是蜂群体') },
  { kind: 'brute', desc: t('冲撞撞墙不会眩晕，而是反弹再冲一次') },
  { kind: 'shield', desc: t('会把盾牌像回旋刃一样扔出去，之后 3 秒没有盾') },
  { kind: 'sniper', desc: t('子弹会在墙上反弹一次，落点有预警') },
  { kind: 'summoner', desc: t('召唤冲锋兵，不是蜂群体') },
  { kind: 'corroder', desc: t('腐蚀液会慢慢流向玩家') },
  { kind: 'tower', desc: t('弹流换成一道旋转的激光，有预警') },
  { kind: 'burrower', desc: t('在地下移动时留下一串地刺，1 秒后刺出') },
  { kind: 'linker', desc: t('三只一组，围着玩家拉成三角形激光') },
  { kind: 'assassin', desc: t('连续瞬移两次，第一次是假动作') },
  { kind: 'mender', desc: t('同时修复两个目标') },
  { kind: 'mirror', desc: t('相对的两面同时发光') },
  { kind: 'replicator', desc: t('两个复制体碰到一起会融合成大号（生命相加）') },
  { kind: 'rewinder', desc: t('可以回溯两次') },
  { kind: 'missileNest', desc: t('导弹飞到一半分裂成 3 枚小导弹') },
  { kind: 'condenser', desc: t('冰面上会长出冰刺') },
  { kind: 'quaker', desc: t('冲击波反过来，从 10 米外向它收缩') },
  { kind: 'lightEater', desc: t('黑暗光环会一缩一放地脉动') },
  { kind: 'diver', desc: t('连续俯冲两次') },
  { kind: 'hiveCore', desc: t('工蜂围成一圈护住巢心，并绕着它转') },
  { kind: 'devourer', desc: t('也会吃掉玩家的子弹，每吃 10 发变大一次') },
  { kind: 'wallBuilder', desc: t('升起的墙会慢慢向玩家推进') },
  { kind: 'mortar', desc: t('炮弹落地后再弹起来一次，落点有第二个预警圈') },
  { kind: 'thief', desc: t('偷的是冲刺：被它碰到，冲刺立刻进入冷却') },
  { kind: 'mimic', desc: t('伪装成武装掉落，不是回复球') },
  { kind: 'parasite', desc: t('吸附 3 秒内没被甩掉就会爆炸') },
  { kind: 'ringStar', desc: t('两层护环，向相反方向转') },
  { kind: 'commander', desc: t('冲锋号同时让所有病毒体回复 10% 生命') },
  { kind: 'boomerang', desc: t('一次扔两把飞刃，交叉飞行') },
  { kind: 'riftWalker', desc: t('玩家踩进传送门也会被传送') },
  { kind: 'juggernaut', desc: t('打碎的装甲 10 秒后重新长出来') },
];

export const VARIANT = {
  from: 61,
  chance: 0.35,
  chancePer10: 0.05,   // after sector 150
  chanceMax: 0.6,
};

// Sector from which this kind can spawn as a variant (null: it has no variant).
export function variantFrom(kind: EnemyKind): number | null {
  const i = VARIANTS.findIndex(v => v.kind === kind);
  return i < 0 ? null : VARIANT.from + Math.floor(i / 2) * 5;
}

export function variantChance(n: number): number {
  if (n <= 150) return VARIANT.chance;
  return Math.min(VARIANT.chanceMax, VARIANT.chance + Math.floor((n - 150) / 10) * VARIANT.chancePer10);
}

export function rollVariant(kind: EnemyKind, n: number, rand: () => number): boolean {
  const from = variantFrom(kind);
  return from !== null && n >= from && rand() < variantChance(n);
}

export const variantNote = (kind: EnemyKind): string => VARIANTS.find(v => v.kind === kind)?.desc ?? '';
