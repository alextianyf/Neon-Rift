import type { SkillId } from '../data/meta';
import type { WeaponId } from '../data/weapons';

// Small line-art weapon glyphs for the HUD (stroke uses currentColor).
const PATHS: Record<WeaponId, string> = {
  pulse: 'M2 8h18M20 5v6M6 5h10M6 11h10',
  smg: 'M2 7h20M2 10h14M8 10v4M18 4v3',
  shotgun: 'M2 6h20M2 10h20M6 6v4M14 6v4',
  arc: 'M2 8h6l3-5 3 10 3-5h5',
  frost: 'M12 1v14M5 4l14 8M19 4L5 12',
  flame: 'M3 8h7M10 8c4-6 9-3 11 0-2 3-7 6-11 0z',
  grenade: 'M12 4a5 5 0 1 0 0.01 0M12 1v3M15 2l-2 2',
  rocket: 'M2 8h13l5-4v8l-5-4M6 5v6',
  rail: 'M1 6h22M1 10h22M5 4v8M19 4v8',
  disc: 'M12 8m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M12 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  blade: 'M3 13L19 3l2 2L7 15zM3 13l-1 2 2-1',
  prism: 'M4 13L12 2l8 11zM2 8h6M16 6l6-3M16 9l6 1M16 12l6 3',
  spike: 'M2 8h14M16 5l6 3-6 3zM5 6v4M9 6v4',
  swarm: 'M2 12l6-4M8 12l6-5M14 12l6-6M2 12h18',
  singularity: 'M12 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M3 8c3-6 15-6 18 0M3 8c3 6 15 6 18 0',
};

// Hotbar glyphs (24x24): the dash and each mech skill.
const SKILL_PATHS: Record<SkillId | 'dash', string> = {
  dash: 'M4 6l6 6-6 6M11 6l6 6-6 6M18 6v12',
  overdrive: 'M13 2L5 14h6l-2 8 8-12h-6z',
  barrier: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  clones: 'M12 4a3 3 0 1 0 0.01 0M7 21v-5a5 5 0 0 1 10 0v5M4 8a2 2 0 1 0 0.01 0M2 18v-3a3 3 0 0 1 3-3M20 8a2 2 0 1 0 0.01 0M22 18v-3a3 3 0 0 0 -3-3',
  orbital: 'M12 2v8M12 14v8M2 12h8M14 12h8M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
};

export function skillIcon(id: SkillId | 'dash'): string {
  return `<svg class="sicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${SKILL_PATHS[id]}"/></svg>`;
}

export function weaponIcon(id: WeaponId): string {
  return `<svg class="wicon" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[id]}"/></svg>`;
}
