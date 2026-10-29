export interface BestRecord {
  room: number;
  score: number;
}

const KEY = 'neonrift.best';

// localStorage can throw (private mode, blocked storage), so failures just mean "no record".
export function loadBest(): BestRecord | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as BestRecord | null;
  } catch {
    return null;
  }
}

export function saveBest(record: BestRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record));
  } catch {
    // ignore
  }
}
