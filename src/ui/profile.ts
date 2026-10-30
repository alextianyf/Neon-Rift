import type { MechId, TalentId } from '../data/meta';

// Persistent player profile (localStorage): crystals, unlocks, talents and daily bests.
export interface Profile {
  crystals: number;
  mechs: MechId[];
  selected: MechId;
  talents: Partial<Record<TalentId, number>>;
  daily: { date: string; best: number } | null;
  depth: number;      // selected rift depth
  maxDepth: number;   // highest unlocked depth
  wins: number;
  seen: string[];     // tutorial hints already shown
}

const KEY = 'neonrift.profile';
const DEFAULT: Profile = { crystals: 0, mechs: ['vanguard'], selected: 'vanguard', talents: {}, daily: null, depth: 0, maxDepth: 0, wins: 0, seen: [] };

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null;
    return { ...DEFAULT, ...p, talents: { ...(p?.talents ?? {}) }, seen: [...(p?.seen ?? [])], mechs: [...(p?.mechs ?? DEFAULT.mechs)] };
  } catch {
    return { ...DEFAULT, talents: {}, seen: [], mechs: [...DEFAULT.mechs] };
  }
}

export function saveProfile(p: Profile): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // ignore
  }
}

export const talentLevel = (p: Profile, id: TalentId): number => p.talents[id] ?? 0;
