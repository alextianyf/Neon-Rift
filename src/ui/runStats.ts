import { t } from '../core/i18n';
import { BALANCE } from '../data/balance';
import { RARITY_LABEL, UPGRADES } from '../data/upgrades';
import { MECHS } from '../data/meta';
import { WEAPONS, weaponLevelMul } from '../data/weapons';
import { LAWS, MUTATIONS, abyss, lawState } from '../game/abyss';
import { BOONS, type BoonId } from '../game/epoch';
import type { Player } from '../game/player';
import type { StatusIcon } from './hud';
import { skillIcon } from './icons';
import type { BuildEntry, EffectEntry, StatLine, WeaponEntry } from './screens';

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
  const mod = (id: string) => { const u = UPGRADES.find(x => x.id === id)!; return tipText(u.name, u.desc); };
  if (p.skillT > 0) out.push({ html: skillIcon(skill), color: '#ffd23f', time: p.skillT, tip: tipText(p.mechDef.skillName, p.mechDef.skillDesc) });
  if (p.anchored) out.push({ html: '▣', color: '#ffc83d', time: null, tip: mod('sentinel') });
  if (p.frenzy && p.hp < p.maxHp * 0.5) out.push({ html: '!', color: '#ff3355', time: null, tip: mod('frenzy') });
  if (p.shield > 0) out.push({ html: '◆', color: '#66ccff', time: null, tip: tipText(t('护盾'), t('抵挡下一次伤害（{n} 层）', { n: p.shield })) });
  return out;
}

// Pause screen: every carried weapon with its trait, level unlocks and current numbers.
export function weaponEntries(p: Player): WeaponEntry[] {
  return p.slots.map((s, i) => {
    const w = WEAPONS[s.id];
    const dmg = w.dmg * weaponLevelMul(s.level) * p.dmgMul;
    const per = w.count > 1 ? ` × ${w.count}` : '';
    return {
      name: w.name, level: s.level, color: w.color, active: i === p.weapon, starter: !!s.starter,
      desc: w.desc, lv3: w.lv3, lv5: w.lv5,
      numbers: t('单发伤害 {d}{per} · 每秒 {r} 发 · 弹匣 {m}', { d: dmg.toFixed(1), per, r: (p.fireRateMul / w.rate).toFixed(1), m: p.magSize(s.id, s.level) }),
    };
  });
}

// Pause screen: installed modules (legendaries first), then abyss boons, mutations and the current law.
export function effectEntries(p: Player, boons: BoonId[]): EffectEntry[] {
  const out: EffectEntry[] = buildEntries(p).map(b => ({ name: b.name, desc: b.desc, cls: b.rarity, tag: RARITY_LABEL[b.rarity], count: b.count }));
  const counts = new Map<BoonId, number>();
  for (const b of boons) counts.set(b, (counts.get(b) ?? 0) + 1);
  for (const [b, n] of counts) out.push({ name: BOONS[b].name, desc: BOONS[b].desc, cls: 'abyss', tag: t('深渊强化'), count: n });
  for (const m of abyss.mutations) out.push({ name: MUTATIONS[m].name, desc: MUTATIONS[m].desc, cls: 'abyss', tag: t('深渊异变'), count: 1 });
  if (lawState.law) out.push({ name: LAWS[lawState.law].name, desc: LAWS[lawState.law].desc, cls: 'abyss', tag: t('深渊法则'), count: 1 });
  return out;
}

function tipText(name: string, desc: string): string {
  return `<div class="eentry"><div class="ehead"><b>${name}</b></div><div class="edesc">${desc}</div></div>`;
}

// Hover text for the dash and skill keys on the hotbar.
export function keyTip(p: Player, key: 'dash' | 'skill'): string {
  if (key === 'dash') return tipText(t('推进冲刺'), t('朝移动方向冲刺，{i} 秒无敌 · 冷却 {cd}s', { i: BALANCE.player.dashInvuln, cd: p.dashCooldown.toFixed(2) }));
  const m = MECHS[p.mechDef.id];
  return tipText(m.skillName, `${m.skillDesc} · ${t('冷却 {n}s', { n: m.skillCd })}`);
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
