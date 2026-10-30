import { rnd } from '../core/rng';
import { t } from '../core/i18n';

// Sector types and how the branching path between sectors is rolled.
export type RoomKind = 'combat' | 'elite' | 'treasure' | 'challenge' | 'shop' | 'boss';

export interface RoomInfo {
  name: string;
  desc: string;
  color: number;
}

export const ROOM_INFO: Record<RoomKind, RoomInfo> = {
  combat: { name: t('战斗扇区'), desc: t('清除病毒体'), color: 0x4ff0ff },
  elite: { name: t('精英扇区'), desc: t('全是精英，必掉武装'), color: 0xffc83d },
  treasure: { name: t('数据宝库'), desc: t('没有敌人，免费武装与模块'), color: 0x55ff99 },
  challenge: { name: t('挑战扇区'), desc: t('坚持 30 秒，奖励高阶模块'), color: 0xff4dd2 },
  shop: { name: t('黑市终端'), desc: t('用碎片交易'), color: 0xffd23f },
  boss: { name: t('裂隙核心'), desc: t('首领战'), color: 0xff2266 },
};

export const BOSS_EVERY = 5;
export const CHALLENGE_TIME = 30;

// Combat-like sectors have enemies, waves and terrain hazards.
export const isCombatKind = (k: RoomKind): boolean => k === 'combat' || k === 'elite' || k === 'challenge';

// The 1-2 sector types offered when leaving the current sector.
export function rollPaths(nextN: number, current: RoomKind): RoomKind[] {
  if (nextN % BOSS_EVERY === 0) return ['boss'];
  const beforeBoss = nextN % BOSS_EVERY === BOSS_EVERY - 1;
  const pool: [RoomKind, number][] = [['combat', 45]];
  if (nextN >= 3) pool.push(['elite', 18], ['treasure', 10]);
  if (nextN >= 4) pool.push(['challenge', 12]);
  if (nextN >= 2 && current !== 'shop') pool.push(['shop', beforeBoss ? 45 : 15]);
  const picks: RoomKind[] = [];
  while (picks.length < 2 && pool.length) {
    let r = rnd() * pool.reduce((s, [, w]) => s + w, 0);
    const i = pool.findIndex(([, w]) => (r -= w) <= 0);
    picks.push(pool[i][0]);
    pool.splice(i, 1);
  }
  return picks;
}
