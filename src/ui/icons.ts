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
};

// Hotbar glyphs (24x24): the dash and each mech skill.
const SKILL_PATHS: Record<SkillId | 'dash', string> = {
  dash: 'M4 6l6 6-6 6M11 6l6 6-6 6M18 6v12',
  overdrive: 'M13 2L5 14h6l-2 8 8-12h-6z',
  barrier: 'M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z',
  blink: 'M2 12h4M7 12h3M12 7l6 5-6 5M18 4v16',
};

export function skillIcon(id: SkillId | 'dash'): string {
  return `<svg class="sicon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${SKILL_PATHS[id]}"/></svg>`;
}

export function weaponIcon(id: WeaponId): string {
  return `<svg class="wicon" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${PATHS[id]}"/></svg>`;
}
