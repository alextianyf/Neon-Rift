import { t } from '../core/i18n';
import type { AffixId } from './affixes';
import type { EnemyKind } from './enemies';
import type { ThemeId } from './themes';

// Rift strata (docs/敌人.md): from sector 16, every 5 sectors is a new stratum with 2 new enemies,
// a theme built around them and a new elite affix. The even strata end with a new boss.
export interface Stratum {
  from: number;
  name: string;
  enemies: EnemyKind[];
  theme: ThemeId;
  affix: AffixId;
}

export const STRATA: Stratum[] = [
  { from: 16, name: t('回声层'), enemies: ['rewinder', 'missileNest'], theme: 'echo', affix: 'rewind' },
  { from: 21, name: t('冰封层'), enemies: ['condenser', 'quaker'], theme: 'tundra', affix: 'frost' },
  { from: 26, name: t('暗域层'), enemies: ['lightEater', 'diver'], theme: 'night', affix: 'shadow' },
  { from: 31, name: t('蜂巢层'), enemies: ['hiveCore', 'devourer'], theme: 'hive', affix: 'hungry' },
  { from: 36, name: t('工事层'), enemies: ['wallBuilder', 'mortar'], theme: 'siegeworks', affix: 'bulwark' },
  { from: 41, name: t('窃能层'), enemies: ['thief', 'mimic'], theme: 'traps', affix: 'greedy' },
  { from: 46, name: t('寄生层'), enemies: ['parasite', 'ringStar'], theme: 'infest', affix: 'parasitic' },
  { from: 51, name: t('统御层'), enemies: ['commander', 'boomerang'], theme: 'legion', affix: 'command' },
  { from: 56, name: t('本源层'), enemies: ['riftWalker', 'juggernaut'], theme: 'origin', affix: 'undying' },
];

export function stratumAt(n: number): Stratum | null {
  let s: Stratum | null = null;
  for (const x of STRATA) if (n >= x.from) s = x;
  return s && n < s.from + 5 ? s : null;
}
