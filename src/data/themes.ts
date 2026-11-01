import { t } from '../core/i18n';
import { SPAWN_TABLE, type EnemyKind } from './enemies';
import { stratumAt } from './strata';

// Sector themes and the per-sector enemy pool (docs/敌人.md). Each sector draws a short roster
// instead of mixing every unlocked enemy, so a sector has a character and new enemies get seen.
export type ThemeId = 'swarm' | 'siege' | 'burrow' | 'hunt' | 'fortress' | 'mirrors'
  | 'echo' | 'tundra' | 'night' | 'hive' | 'siegeworks' | 'traps' | 'infest' | 'legion' | 'origin';

export interface ThemeDef {
  name: string;
  kinds: EnemyKind[];
  from: number;
}

export const THEMES: Record<ThemeId, ThemeDef> = {
  swarm: { name: t('蜂潮'), kinds: ['swarmer', 'summoner', 'replicator'], from: 4 },
  siege: { name: t('阵地'), kinds: ['tower', 'sniper', 'shield'], from: 6 },
  burrow: { name: t('地底'), kinds: ['burrower', 'corroder', 'bomber'], from: 7 },
  hunt: { name: t('猎杀'), kinds: ['assassin', 'linker', 'grunt'], from: 9 },
  fortress: { name: t('堡垒'), kinds: ['mender', 'brute', 'shield'], from: 10 },
  mirrors: { name: t('镜厅'), kinds: ['mirror', 'shooter', 'tower'], from: 12 },
  // one per endless stratum, built around its two new enemies
  echo: { name: t('回声'), kinds: ['rewinder', 'missileNest', 'shooter', 'sniper'], from: 16 },
  tundra: { name: t('冰原'), kinds: ['condenser', 'quaker', 'brute'], from: 21 },
  night: { name: t('永夜'), kinds: ['lightEater', 'diver', 'assassin'], from: 26 },
  hive: { name: t('虫巢'), kinds: ['hiveCore', 'devourer', 'swarmer', 'summoner'], from: 31 },
  siegeworks: { name: t('围城'), kinds: ['wallBuilder', 'mortar', 'tower', 'shield'], from: 36 },
  traps: { name: t('陷阱'), kinds: ['thief', 'mimic', 'bomber', 'corroder'], from: 41 },
  infest: { name: t('侵染'), kinds: ['parasite', 'ringStar', 'splitter', 'replicator'], from: 46 },
  legion: { name: t('军团'), kinds: ['commander', 'boomerang', 'grunt', 'linker'], from: 51 },
  origin: { name: t('本源'), kinds: ['riftWalker', 'juggernaut', 'summoner', 'mirror'], from: 56 },
};

export const POOL = {
  themeFrom: 4,
  themeChance: 0.75,   // the rest are an ordinary mix
  themeWeight: 3,
  maxKinds: 6,
  maxKindsEndless: 7,  // a stratum theme has 4 kinds, plus the grunt and the 2 newest
  newest: 2,           // the most recently unlocked kinds always make the roster...
  newestWeight: 2,     // ...and show up more often
  always: 'grunt' as EnemyKind,
};

export interface RosterEntry { kind: EnemyKind; weight: number; pack?: [number, number] }

// Theme for a combat sector, or null for a plain mix.
export function rollTheme(n: number, rand: () => number): ThemeId | null {
  if (n < POOL.themeFrom || rand() >= POOL.themeChance) return null;
  // inside a stratum, its own theme comes up half the time
  const st = stratumAt(n);
  if (st && rand() < 0.5) return st.theme;
  const ids = (Object.keys(THEMES) as ThemeId[]).filter(id => n >= THEMES[id].from);
  return ids.length ? ids[Math.floor(rand() * ids.length)] : null;
}

// Up to 6 kinds: the theme's, the 2 newest, the grunt as filler, then random others.
export function buildRoster(n: number, theme: ThemeId | null, eliteRoom: boolean, rand: () => number): RosterEntry[] {
  const open = SPAWN_TABLE.filter(s => n >= s.from && !(eliteRoom && s.pack));
  const has = (k: EnemyKind) => open.some(s => s.kind === k);
  const themed = theme ? THEMES[theme].kinds.filter(has) : [];
  // later entries in the table were added later, so they win ties on `from`. In endless mode the
  // boost only lasts for the stratum that introduced them (5 sectors).
  const newest = open.map((s, i) => ({ s, i })).filter(x => n <= 15 || n < x.s.from + 5)
    .sort((a, b) => b.s.from - a.s.from || b.i - a.i).slice(0, POOL.newest).map(x => x.s.kind);
  const picked = new Set<EnemyKind>([...themed, ...newest]);
  if (has(POOL.always)) picked.add(POOL.always);
  const rest = open.filter(s => !picked.has(s.kind));
  const max = n > 15 ? POOL.maxKindsEndless : POOL.maxKinds;
  while (picked.size < max && rest.length) picked.add(rest.splice(Math.floor(rand() * rest.length), 1)[0].kind);
  return open.filter(s => picked.has(s.kind)).map(s => ({
    kind: s.kind,
    pack: s.pack,
    // the grunt is the most common filler already, so a theme doesn't push it further
    weight: s.weight * (themed.includes(s.kind) && s.kind !== POOL.always ? POOL.themeWeight : 1) * (newest.includes(s.kind) ? POOL.newestWeight : 1),
  }));
}
