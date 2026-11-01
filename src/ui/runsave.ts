import type { BossLogEntry } from '../data/bossPlan';
import type { LawId, MutationId } from '../game/abyss';
import type { FusionSpec } from '../game/fusion';
import type { BoonId } from '../game/epoch';
import { storageKey } from '../core/testMode';
import type { RoomKind } from '../data/map';
import type { MechId } from '../data/meta';
import type { WeaponSlot } from '../game/player';

// Snapshot of a run taken when entering each sector, so closing the page doesn't lose it.
// Resuming rebuilds the sector from scratch with the player as they entered it.
export interface RunSave {
  v: 1;
  daily: boolean;
  dailyDate: string;
  depth: number;
  endless: boolean;
  seed: number;
  room: number;
  kind: RoomKind;
  score: number;
  kills: number;
  coinsEarned: number;
  bestCombo: number;
  bossKills: number;
  crystalsAwarded: number;
  playTime: number;
  mech: MechId;
  hp: number;
  coins: number;
  revives: number;
  slots: WeaponSlot[];
  weapon: number;
  upgrades: string[];   // ids in the order they were taken
  bosses?: BossLogEntry[];  // bosses fought so far (older saves don't have it)
  mutations?: MutationId[];
  law?: LawId | null;
  fusions?: FusionSpec[];
  boons?: BoonId[];
}

const KEY = storageKey('neonrift.run');

export function loadRun(): RunSave | null {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? 'null') as RunSave | null;
    return s && s.v === 1 ? s : null;
  } catch {
    return null;
  }
}

export function saveRun(s: RunSave): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
