// Run-level randomness. Level generation (rooms, waves, hazards, paths, loot) draws from here
// so a daily challenge can be replayed from the same seed; visual effects and enemy AI keep
// using Math.random.

let state = (Math.random() * 2 ** 32) >>> 0;

// mulberry32
export function rnd(): number {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export const rrand = (a: number, b: number): number => a + rnd() * (b - a);

export function seedRun(seed: number = (Math.random() * 2 ** 32) >>> 0): void {
  state = seed >>> 0;
}

export function shuffledR<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Today's date (local time) as YYYY-MM-DD and a seed derived from it.
export function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
