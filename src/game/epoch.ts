import { t } from '../core/i18n';
import type { Game } from './game';

// Epochs (docs/敌人.md): sectors 150, 200, 250... end with the epoch boss (a four-phase Rift Origin).
// Beating it pays 100 crystals per epoch and offers one of three abyss boons, the only way to go past
// the stat caps (once per epoch, five at most per run). Cosmetic rewards wait for the mech rework.

export const EPOCH = { from: 150, every: 50, crystals: 100, maxBoons: 5 };

export type BoonId = 'dmgCap' | 'critCap' | 'rateCap' | 'speedCap' | 'hull';
export const BOONS: Record<BoonId, { name: string; desc: string }> = {
  dmgCap: { name: t('深渊之力'), desc: t('伤害池上限 +10%，并立即 +10% 伤害') },
  critCap: { name: t('深渊之眼'), desc: t('暴击率上限 +5%，并立即 +5% 暴击率') },
  rateCap: { name: t('深渊脉冲'), desc: t('射速上限 +10%') },
  speedCap: { name: t('深渊步伐'), desc: t('移速上限 +5%，并立即 +5% 移速') },
  hull: { name: t('深渊装甲'), desc: t('最大生命 +20%') },
};

export const isEpoch = (n: number) => n >= EPOCH.from && n % EPOCH.every === 0;
export const epochOf = (n: number) => Math.floor((n - EPOCH.from) / EPOCH.every) + 1;

// Apply a boon to the player (also used to restore them when a run resumes).
export function applyBoon(g: Game, id: BoonId): void {
  const p = g.player, c = p.capBoost;
  switch (id) {
    case 'dmgCap': c.dmg += 0.1; p.dmgBonus += 0.1; break;
    case 'critCap': c.crit += 0.05; p.critChance += 0.05; break;
    case 'rateCap': c.rate += 0.1; break;
    case 'speedCap': c.speed += 0.05; p.speed *= 1.05; break;
    case 'hull': p.maxHp = Math.round(p.maxHp * 1.2); p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.2); break;
  }
}

// After an epoch boss: crystals, a record of the epoch reached, then the boon pick.
// Returns true if it took over the flow and will call `then` itself.
export function endlessRewards(g: Game, n: number, then: () => void): boolean {
  if (!isEpoch(n) || g.room.kind !== 'boss') return false;
  const epoch = epochOf(n), crystals = EPOCH.crystals * epoch;
  g.progress.profile.crystals += crystals;
  g.progress.profile.maxEpoch = Math.max(g.progress.profile.maxEpoch ?? 0, epoch);
  g.progress.save();
  g.hud.toast(t('到达第 {n} 纪元 · +{c} 结晶', { n: epoch, c: crystals }));
  if (g.boons.length >= EPOCH.maxBoons) return false;
  const all = Object.keys(BOONS) as BoonId[];
  const offer: BoonId[] = [];
  while (offer.length < 3) offer.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
  g.sector.openChoice(t('纪元奖励 · 深渊强化（这局一直生效）'), offer.map(b => ({ name: BOONS[b].name, desc: BOONS[b].desc, rarity: 'legendary' as const })), i => {
    g.boons.push(offer[i]);
    applyBoon(g, offer[i]);
    g.hud.toast(t('深渊强化：{b}', { b: BOONS[offer[i]].name }));
    then();
  });
  return true;
}
