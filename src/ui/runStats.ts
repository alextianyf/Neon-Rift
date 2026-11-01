import { t } from '../core/i18n';
import { UPGRADES } from '../data/upgrades';
import type { Player } from '../game/player';
import type { BuildEntry, StatLine } from './screens';

const pct = (v: number) => `${Math.round(v * 100)}%`;

// Pause-screen readout of the mech's current stats.
export function statLines(p: Player): StatLine[] {
  const w = p.weaponDef;
  return [
    { label: t('当前武器'), value: `${w.name} Lv.${p.activeSlot.level}` },
    { label: t('伤害倍率'), value: `×${p.dmgMul.toFixed(2)}` },
    { label: t('射速倍率'), value: `×${p.fireRateMul.toFixed(2)}` },
    { label: t('暴击率 / 暴击伤害'), value: `${pct(p.critChance)} / ×${p.critMul.toFixed(1)}` },
    { label: t('点燃 / 冰冻 / 闪电'), value: `${pct(p.burnChance)} / ${pct(p.frostChance)} / ${pct(p.shockChance)}` },
    { label: t('穿透 / 反弹 / 多重'), value: `${p.pierce} / ${p.bounce} / ${p.extraShots}` },
    { label: t('移动速度'), value: p.speed.toFixed(1) },
    { label: t('冲刺冷却'), value: `${p.dashCooldown.toFixed(2)}s` },
    { label: t('生命'), value: `${Math.ceil(p.hp)} / ${p.maxHp}` },
    { label: t('数据碎片'), value: String(p.coins) },
  ];
}

// Installed modules, legendaries first.
export function buildEntries(p: Player): BuildEntry[] {
  const out: BuildEntry[] = [];
  for (const [id, count] of p.upgradeCounts) {
    const u = UPGRADES.find(x => x.id === id);
    if (u) out.push({ name: u.name, desc: u.desc, rarity: u.rarity, count });
  }
  const order = { legendary: 0, rare: 1, common: 2 };
  return out.sort((a, b) => order[a.rarity] - order[b.rarity]);
}
