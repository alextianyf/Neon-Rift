import type { MechId, TalentId } from '../data/meta';

// Persistent player profile (localStorage): crystals, unlocks, talents and daily bests.
export interface Profile {
  crystals: number;
  mechs: MechId[];
  selected: MechId;
  talents: Partial<Record<TalentId, number>>;
  daily: { date: string; best: number } | null;
}

const KEY = 'neonrift.profile';
const DEFAULT: Profile = { crystals: 0, mechs: ['vanguard'], selected: 'vanguard', talents: {}, daily: null };

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null;
    return { ...DEFAULT, ...p, talents: { ...(p?.talents ?? {}) } };
  } catch {
    return { ...DEFAULT };
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
