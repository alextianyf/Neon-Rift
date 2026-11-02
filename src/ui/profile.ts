import { TEST, storageKey } from '../core/testMode';
import { MAX_DEPTH } from '../data/depth';
import { DEFAULT_MECH, MECHS, type MechId, type TalentId } from '../data/meta';

// Persistent player profile (localStorage): crystals, unlocks, talents, run history.
export interface Profile {
  crystals: number;
  mechs: MechId[];
  selected: MechId;
  talents: Partial<Record<TalentId, number>>;
  depth: number;      // selected rift depth
  maxDepth: number;   // highest unlocked depth
  wins: number;
  seen: string[];     // tutorial hints already shown
  codex: Record<CodexKind, string[]>;  // ids discovered
  history: RunRecord[];                // most recent first
  totals: { runs: number; kills: number; time: number };
  maxEpoch?: number;   // deepest abyss epoch reached (sector 150 = 1)
}

export type CodexKind = 'enemies' | 'weapons' | 'upgrades';

export interface RunRecord {
  id: number;         // run start timestamp
  date: string;
  mech: MechId;
  depth: number;
  won: boolean;
  room: number;
  score: number;
  kills: number;
  time: number;       // seconds
}

const KEY = storageKey('neonrift.profile');
const DEFAULT: Profile = { crystals: TEST ? 99999 : 0, mechs: TEST ? ['bastion', 'vanguard', 'phantom', 'apex'] : [DEFAULT_MECH], selected: DEFAULT_MECH, talents: {}, depth: 0, maxDepth: TEST ? MAX_DEPTH : 0, wins: 0, seen: [], codex: { enemies: [], weapons: [], upgrades: [] }, history: [], totals: { runs: 0, kills: 0, time: 0 } };

export function loadProfile(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Profile> | null;
    // the default mech is always owned (older profiles started with a different one)
    const mechs = [...(p?.mechs ?? DEFAULT.mechs)];
    if (!mechs.includes(DEFAULT_MECH)) mechs.unshift(DEFAULT_MECH);
    // the test link always has every mech, including ones added after its save was made
    if (TEST) for (const id of Object.keys(MECHS) as MechId[]) if (!mechs.includes(id)) mechs.push(id);
    return { ...DEFAULT, ...p, talents: { ...(p?.talents ?? {}) }, seen: [...(p?.seen ?? [])], mechs,
      codex: { enemies: [...(p?.codex?.enemies ?? [])], weapons: [...(p?.codex?.weapons ?? [])], upgrades: [...(p?.codex?.upgrades ?? [])] },
      history: [...(p?.history ?? [])], totals: { ...DEFAULT.totals, ...(p?.totals ?? {}) } };
  } catch {
    return {
      ...DEFAULT, talents: {}, seen: [], mechs: [...DEFAULT.mechs],
      codex: { enemies: [], weapons: [], upgrades: [] }, history: [], totals: { runs: 0, kills: 0, time: 0 },
    };
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
