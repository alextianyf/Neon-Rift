import { BALANCE } from './balance';

// How enemies scale with sector depth. Linear through the main run (sectors 1-15), compounding in
// early endless mode, then a gentle slope so the deep abyss is hard through mechanics, not HP walls.
const S = BALANCE.scaling, E = BALANCE.endless;

const linearHp = (n: number) => 1 + (n - 1) * S.enemyHpPerRoom;

export function enemyHpMul(n: number): number {
  if (n <= E.fromSector) return linearHp(n);
  const steep = Math.min(n, E.hpSlowFrom) - E.fromSector, gentle = Math.max(0, n - E.hpSlowFrom);
  return linearHp(E.fromSector) * E.hpGrowth ** steep * E.hpGrowthSlow ** gentle;
}

export function enemyDmgMul(n: number): number {
  const steep = Math.max(0, Math.min(n, E.dmgSlowFrom) - E.fromSector), gentle = Math.max(0, n - E.dmgSlowFrom);
  return Math.min(E.dmgMax, 1 + steep * E.dmgPerSector + gentle * E.dmgPerSectorSlow);
}

// Extra room on the elite chance cap in endless mode.
export function eliteCapBonus(n: number): number {
  if (n <= E.fromSector) return 0;
  return Math.min(E.eliteCapMax - BALANCE.elites.maxChance, Math.floor((n - E.fromSector) / 10) * E.eliteCapStep);
}
