import { todayKey } from '../core/rng';
import { HISTORY_LIMIT } from '../data/codex';
import { MAX_DEPTH } from '../data/depth';
import { loadProfile, saveProfile, type CodexKind, type Profile, type RunRecord } from '../ui/profile';
import { loadBest, saveBest } from '../ui/storage';

// The persistent side of play: codex discoveries, run history, daily and all-time bests, depth unlocks.
export class Progress {
  readonly profile: Profile = loadProfile();

  save(): void {
    saveProfile(this.profile);
  }

  // Codex: remember an enemy / weapon / module the first time it shows up.
  discover(kind: CodexKind, id: string): void {
    const list = this.profile.codex[kind];
    if (list.includes(id)) return;
    list.push(id);
    this.save();
  }

  // Add (or update, after an endless continuation) a run's line in the history.
  recordRun(rec: RunRecord): void {
    const pr = this.profile;
    const i = pr.history.findIndex(h => h.id === rec.id);
    if (i >= 0) {
      const prev = pr.history[i];
      pr.totals.kills += rec.kills - prev.kills;
      pr.totals.time += rec.time - prev.time;
      pr.history[i] = { ...rec, won: prev.won || rec.won };
    } else {
      pr.totals.runs++;
      pr.totals.kills += rec.kills;
      pr.totals.time += rec.time;
      pr.history.unshift(rec);
      pr.history.length = Math.min(pr.history.length, HISTORY_LIMIT);
    }
  }

  recordDaily(score: number): void {
    const today = todayKey();
    const prev = this.profile.daily?.date === today ? this.profile.daily.best : 0;
    this.profile.daily = { date: today, best: Math.max(prev, score) };
  }

  // Returns true when this is a new all-time best.
  recordBest(room: number, score: number): boolean {
    const best = loadBest();
    const isNew = !best || score > best.score;
    if (isNew) saveBest({ room, score });
    return isNew;
  }

  // Winning at the highest unlocked depth unlocks (and selects) the next one; returns it, or null.
  unlockAfterWin(depth: number): number | null {
    const pr = this.profile;
    if (depth < pr.maxDepth || depth >= MAX_DEPTH) return null;
    pr.maxDepth = pr.depth = depth + 1;
    return depth + 1;
  }
}
