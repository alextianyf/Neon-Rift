// Global tuning knobs. Per-weapon, per-enemy and per-upgrade numbers live in their own files.
export const BALANCE = {
  player: {
    hp: 100,
    speed: 8.5,
    radius: 0.55,
    dashDuration: 0.17,
    dashSpeed: 26,
    dashCooldown: 0.9,
    dashInvuln: 0.28,
    hurtInvuln: 0.8,
    hurtKnockback: 12,
    critChance: 0.05,
    critMul: 2,
    dashBlastRadius: 3,
    dashBlastDmg: 40,
  },
  rooms: {
    bossEvery: 5,          // rooms 5, 10, 15...
    shopOffset: 3,         // shop when room % bossEvery === shopOffset: rooms 3, 8, 13...
    upgradeChoices: 3,
    budgetBase: 5,         // spawn budget = budgetBase + room * budgetPerRoom
    budgetPerRoom: 3,
    waveGap: 3.5,          // seconds of breathing room between the two waves
    shooterFromRoom: 2,
    bruteFromRoom: 4,
    spawnMinDist: 8,       // enemies never spawn closer than this to the player
    weaponDropChance: 0.3, // after clearing a combat room (rooms 1-2 and bosses always drop one)
  },
  scaling: {
    enemyHpPerRoom: 0.09,
    enemySpeedPerRoom: 0.025,
    enemySpeedMaxBonus: 0.35,
    shopPricePerVisit: 0.15,
  },
  elements: {
    burnDuration: 3,
    burnDps: 7,            // multiplied by the player's damage and element multipliers
    frostDuration: 2,
    frostSlow: 0.45,       // speed multiplier while frozen
    shockTargets: 3,
    shockRange: 5.5,
    shockDmg: 0.6,         // fraction of the hit's damage dealt to each chained enemy
  },
  shop: {
    healAmount: 40,
    healPrice: 15,
  },
  combo: {
    window: 2.5,           // seconds between kills to keep the combo going
    scorePerKill: 0.05,    // +5% score per combo step
    maxBonus: 1,           // capped at +100%
  },
  orbHeal: 15,
  orbMagnet: 4.5,
  coinMagnet: 6,
};
