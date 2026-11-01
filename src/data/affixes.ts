import { t } from '../core/i18n';
import type { EnemyKind } from './enemies';

// Elite affixes: from sector 11 every elite rolls one, from sector 25 two (docs/敌人.md).
export type AffixId = 'swift' | 'shielded' | 'volatile' | 'reflect' | 'aura' | 'phase' | 'split' | 'tether'
  | 'rewind' | 'frost' | 'shadow' | 'hungry' | 'bulwark' | 'greedy' | 'parasitic' | 'command' | 'undying';

export interface AffixDef {
  name: string;
  desc: string;
  color: number;
  not?: EnemyKind[];  // enemies this affix can't go on
  from?: number;      // first sector it can roll in (the endless strata each add one)
}

export const AFFIXES: Record<AffixId, AffixDef> = {
  swift: { name: t('迅捷'), desc: t('移动和攻击速度 +30%'), color: 0x7dffd9, not: ['tower'] },
  shielded: { name: t('护盾'), desc: t('额外一层护盾（最大生命的 25%），3 秒没受伤就重新长满'), color: 0x6cb8ff },
  volatile: { name: t('爆裂'), desc: t('死后 0.8 秒爆炸，地面有预警圈'), color: 0xff6a3d, not: ['bomber'] },
  reflect: { name: t('反射'), desc: t('死亡时向四周射出 10 发子弹'), color: 0xc77dff },
  aura: { name: t('光环'), desc: t('5 米内的其他病毒体受到的伤害 -20%'), color: 0x5cff8a },
  phase: { name: t('相位'), desc: t('每受到最大生命 25% 的伤害就瞬移一次'), color: 0xb9a6ff, not: ['tower', 'burrower', 'assassin'] },
  split: { name: t('分裂'), desc: t('死后分出 2 个小号'), color: 0xff4dd2, not: ['replicator', 'splitter', 'linker'] },
  tether: { name: t('牵引'), desc: t('每 5 秒把附近的玩家拉过去'), color: 0xffd23f },
  rewind: { name: t('回溯'), desc: t('第一次血量掉到 30% 以下时，回到 3 秒前的位置和血量'), color: 0x7fd8d0, from: 16, not: ['rewinder'] },
  frost: { name: t('冰霜'), desc: t('碰到玩家时让玩家减速 30%，持续 1.5 秒'), color: 0x9fe8ff, from: 21 },
  shadow: { name: t('暗影'), desc: t('半透明，只有攻击和被命中时才完全显形'), color: 0x9a70d0, from: 26, not: ['assassin'] },
  hungry: { name: t('饥饿'), desc: t('每 8 秒吃掉身边一个普通敌人，回复 20% 生命'), color: 0xc060e0, from: 31, not: ['devourer'] },
  bulwark: { name: t('坚壁'), desc: t('每 6 秒在身前升起一段短墙'), color: 0xd0b060, from: 36, not: ['wallBuilder'] },
  greedy: { name: t('贪婪'), desc: t('碰到玩家时偷走 5 碎片，死后加倍掉出来'), color: 0xffd23f, from: 41 },
  parasitic: { name: t('寄生'), desc: t('死后放出 3 只寄生虫'), color: 0x60d040, from: 46, not: ['parasite'] },
  command: { name: t('号令'), desc: t('身边 8 米内的病毒体攻击速度 +25%'), color: 0xe0b040, from: 51 },
  undying: { name: t('不朽'), desc: t('第一次受到致命伤害时剩 1 点生命，并无敌 1 秒'), color: 0xffffff, from: 56 },
};

export const AFFIX = {
  fromSector: 11,
  twoFromSector: 25,
  swiftMul: 1.3,
  shieldFrac: 0.25,
  shieldRegenDelay: 3,
  volatileDelay: 0.8,
  volatileRadius: 2.5,
  volatileDmg: 20,
  reflectShots: 10,
  auraRadius: 5,
  auraReduce: 0.2,
  reduceMax: 0.4,      // damage reduction from all auras together
  phaseStep: 0.25,
  splitCount: 2,
  splitHp: 0.3,
  commandRange: 8,
  commandHaste: 1.25,
  tetherEvery: 5,
  tetherWarn: 0.6,
  tetherRange: 6,
  tetherPull: 16,
};

export function affixCount(sector: number): number {
  return sector >= AFFIX.twoFromSector ? 2 : sector >= AFFIX.fromSector ? 1 : 0;
}

export function rollAffixes(kind: EnemyKind, n: number, sector: number, rand: () => number = Math.random): AffixId[] {
  const pool = (Object.keys(AFFIXES) as AffixId[]).filter(id => !AFFIXES[id].not?.includes(kind) && sector >= (AFFIXES[id].from ?? 0));
  const out: AffixId[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
  return out;
}
