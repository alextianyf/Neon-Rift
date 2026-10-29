// Global tuning knobs. Per-weapon and per-enemy numbers live in weapons.ts / enemies.ts.
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
  },
  rooms: {
    bossEvery: 5,
    upgradeChoices: 3,
    budgetBase: 3,         // spawn budget = budgetBase + room * budgetPerRoom
    budgetPerRoom: 2.2,
    waveGap: 3.5,          // seconds of breathing room between the two waves
    shooterFromRoom: 2,
    bruteFromRoom: 3,
    spawnMinDist: 8,       // enemies never spawn closer than this to the player
  },
  scaling: {
    enemyHpPerRoom: 0.09,
    enemySpeedPerRoom: 0.025,
    enemySpeedMaxBonus: 0.35,
  },
  orbHeal: 15,
};
