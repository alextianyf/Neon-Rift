import { t } from '../core/i18n';
import { BALANCE } from '../data/balance';
import { UPGRADES } from '../data/upgrades';
import type { Player } from '../game/player';
import type { StatusIcon } from './hud';
import { skillIcon } from './icons';
import type { BuildEntry, StatLine } from './screens';

const pct = (v: number) => `${Math.round(v * 100)}%`;
const CAP = BALANCE.caps;
const capped = (on: boolean) => (on ? ` (${t('已达上限')})` : '');

// Pause-screen readout of the mech's current stats.
export function statLines(p: Player): StatLine[] {
  const w = p.weaponDef;
  return [
    { label: t('当前武器'), value: `${w.name} Lv.${p.activeSlot.level}` },
    { label: t('伤害倍率'), value: `×${p.dmgMul.toFixed(2)}${capped(p.dmgBonus >= CAP.dmgBonus)}` },
    { label: t('射速倍率'), value: `×${p.fireRateMul.toFixed(2)}${capped(p.fireRateMul >= CAP.fireRateMul)}` },
    { label: t('装弹时间'), value: `${p.reloadTime(w).toFixed(2)}s${capped(1 / p.reloadMul <= CAP.reloadTimeMul || p.reloadTime(w) <= CAP.reloadTime)}` },
    { label: t('弹匣'), value: `${p.activeSlot.mag} / ${p.magSize(w.id, p.activeSlot.level)} · ${p.activeSlot.starter ? t('备弹无限') : t('备弹 {n}', { n: p.activeSlot.reserve })}` },
    { label: t('暴击率 / 暴击伤害'), value: `${pct(p.critChance)}${capped(p.critChance >= CAP.critChance)} / ×${p.critMul.toFixed(1)}` },
    { label: t('点燃 / 冰冻 / 闪电'), value: `${pct(p.burnChance)} / ${pct(p.frostChance)} / ${pct(p.shockChance)}` },
    { label: t('穿透 / 反弹 / 多重'), value: `${p.pierce} / ${p.bounce} / ${p.extraShots}` },
    { label: t('移动速度'), value: `${p.moveSpeed.toFixed(1)}${capped(p.speed >= p.mechDef.speed * CAP.speedMul)}` },
    { label: t('冲刺冷却'), value: `${p.dashCooldown.toFixed(2)}s${capped(p.dashCooldown <= CAP.dashCooldown)}` },
    { label: t('生命'), value: `${Math.ceil(p.hp)} / ${p.maxHp}` },
    { label: t('数据碎片'), value: String(p.coins) },
  ];
}

// Timed / conditional effects for the buff row above the hotbar.
export function statusIcons(p: Player): StatusIcon[] {
  const out: StatusIcon[] = [];
  const skill = p.mechDef.skill;
  if (p.skillT > 0 && skill !== 'blink') out.push({ html: skillIcon(skill), color: '#ffd23f', time: p.skillT });
  if (p.anchored) out.push({ html: '▣', color: '#ffc83d', time: null });
  if (p.frenzy && p.hp < p.maxHp * 0.5) out.push({ html: '!', color: '#ff3355', time: null });
  if (p.shield > 0) out.push({ html: '◆', color: '#66ccff', time: null });
  return out;
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
