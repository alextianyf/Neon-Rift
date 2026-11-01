import { ENEMIES, type EnemyKind } from './enemies';

// Which boss (or bosses) a boss sector gets (docs/敌人.md, "首领时间表").
// Main line: sector 5 is always the Weaver (an easy first boss), 10 and 15 pick one of a few. Endless: new bosses debut on the even strata,
// the rest of the boss sectors draw from bosses already fought this run, or put two in at once.

export interface BossPlan {
  kinds: EnemyKind[];  // two for a twin fight
  hpMul: number;
  fuse?: EnemyKind;    // sector 150+: this boss's moves are grafted onto the first one
  epoch?: boolean;     // sectors 150, 200, 250...: the four-phase epoch Origin
}

export const EPOCH_HP = 1.5;

export interface BossLogEntry { n: number; kind: EnemyKind }

const CHOICE: Record<number, EnemyKind[]> = {
  5: ['boss2'],
  10: ['boss', 'wyrm'],
  15: ['boss3', 'mirrorMind', 'colossus'],
};
// The first boss comes in lighter: the player has little more than the starting weapon by then.
const CHOICE_HP: Record<number, number> = { 5: 0.65 };
const DEBUT: Record<number, EnemyKind> = { 20: 'echo', 30: 'eye', 40: 'fortress', 50: 'brood', 60: 'origin' };
const ORIGIN: EnemyKind = 'origin';
const TWIN_SECTORS = [35, 45, 55];
export const TWIN_HP = 0.6;
// bosses that don't pair well (darkness hides the other's bullets, a fixed fortress...)
const NO_TWIN = new Set<string>(['eye', 'fortress', 'origin']);
const BAD_PAIRS: [string, string][] = [['boss2', 'mirrorMind']];

const exists = (k: EnemyKind) => k in ENEMIES;

function pick<T>(list: T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length)];
}

// Bosses fought before sector n, most recent last (duplicates removed, order of last fight kept).
function fought(log: BossLogEntry[], n: number): EnemyKind[] {
  const out: EnemyKind[] = [];
  for (const e of log) {
    if (e.n >= n) continue;
    const i = out.indexOf(e.kind);
    if (i >= 0) out.splice(i, 1);
    out.push(e.kind);
  }
  return out;
}

// A random boss already met, avoiding the last two boss fights.
function randomBoss(log: BossLogEntry[], n: number, rand: () => number, exclude: EnemyKind[] = []): EnemyKind {
  const seen = fought(log, n).filter(k => k !== ORIGIN && !exclude.includes(k));
  const recent = log.filter(e => e.n < n).slice(-2).map(e => e.kind);
  const fresh = seen.filter(k => !recent.includes(k));
  const pool = fresh.length ? fresh : seen.length ? seen : (['boss', 'boss2', 'boss3'] as EnemyKind[]).filter(k => !exclude.includes(k));
  return pick(pool, rand);
}

function twin(log: BossLogEntry[], n: number, rand: () => number): EnemyKind[] {
  const a = randomBoss(log, n, rand, fought(log, n).filter(k => NO_TWIN.has(k)));
  const bad = BAD_PAIRS.filter(p => p.includes(a)).map(p => (p[0] === a ? p[1] : p[0]) as EnemyKind);
  const b = randomBoss(log, n, rand, [a, ...bad, ...fought(log, n).filter(k => NO_TWIN.has(k))]);
  return a === b ? [a] : [a, b];
}

export function planBoss(n: number, log: BossLogEntry[], rand: () => number): BossPlan {
  const one = (k: EnemyKind): BossPlan => ({ kinds: [k], hpMul: 1 });
  const choice = CHOICE[n]?.filter(exists);
  if (choice?.length) return { kinds: [pick(choice, rand)], hpMul: CHOICE_HP[n] ?? 1 };
  const debut = DEBUT[n];
  if (debut && exists(debut)) return one(debut);
  if (n >= 150 && n % 50 === 0) return { kinds: [ORIGIN], hpMul: EPOCH_HP, epoch: true };
  if (n >= 60 && n % 20 === 0 && exists(ORIGIN)) return one(ORIGIN);
  if (n > 150) {
    // fusion boss: one boss's body and core mechanic, with another's signature moves;
    // HP is the two averaged, x1.2
    const a = randomBoss(log, n, rand);
    const bad = BAD_PAIRS.filter(p => p.includes(a)).map(p => (p[0] === a ? p[1] : p[0]) as EnemyKind);
    const b = randomBoss(log, n, rand, [a, ...bad]);
    if (b !== a) return { kinds: [a], hpMul: (ENEMIES[a].hp + ENEMIES[b].hp) / 2 * 1.2 / ENEMIES[a].hp, fuse: b };
    return one(a);
  }
  const isTwin = TWIN_SECTORS.includes(n) || (n > 60 && (n / 5) % 2 === 0);
  if (isTwin) {
    const kinds = twin(log, n, rand);
    if (kinds.length === 2) return { kinds, hpMul: TWIN_HP };
    return one(kinds[0]);
  }
  return one(randomBoss(log, n, rand));
}
