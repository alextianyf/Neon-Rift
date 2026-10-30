// Run goal and rift depth (ascension). Clearing the final sector wins the run and unlocks the next
// depth; each depth stacks one more modifier on top of the previous ones.

export const FINAL_SECTOR = 15;
export const MAX_DEPTH = 5;
export const VICTORY_CRYSTALS = 40;       // flat bonus for clearing the final sector
export const DEPTH_CRYSTAL_BONUS = 0.2;   // +20% crystals per depth level

export interface DepthMods {
  enemyHp: number;
  enemyDmg: number;
  bossHp: number;
  eliteBonus: number;   // added to the elite chance (and elites appear from sector 2)
  healMul: number;      // health orb value
  priceMul: number;     // black market prices
}

export const DEPTH_DESC: string[] = [
  '标准难度',
  '病毒体生命 +25%',
  '病毒体伤害 +25%',
  '精英更常见，第 2 扇区起出现',
  '回复球效果 -40%，黑市价格 +25%',
  '首领生命 +50%，病毒体生命再 +15%',
];

// Live modifiers for the current run; set once at run start.
export const MODS: DepthMods = modsFor(0);

export function modsFor(depth: number): DepthMods {
  return {
    enemyHp: (depth >= 1 ? 1.25 : 1) * (depth >= 5 ? 1.15 : 1),
    enemyDmg: depth >= 2 ? 1.25 : 1,
    bossHp: depth >= 5 ? 1.5 : 1,
    eliteBonus: depth >= 3 ? 0.15 : 0,
    healMul: depth >= 4 ? 0.6 : 1,
    priceMul: depth >= 4 ? 1.25 : 1,
  };
}

export function setDepth(depth: number): void {
  Object.assign(MODS, modsFor(depth));
}
