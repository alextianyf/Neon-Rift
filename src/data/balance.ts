// Global tuning knobs. Per-weapon, per-enemy and per-upgrade numbers live in their own files.
export const BALANCE = {
  player: {
    hp: 100,
    speed: 8.5,
    radius: 0.55,
    dashDuration: 0.17,
    dashSpeed: 26,
    dashCooldown: 3,       // seconds; mechs scale it (dashCdMul), floor in caps
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
    budgetBase: 5,         // spawn budget = (budgetBase + room * budgetPerRoom) * room-area factor
    budgetPerRoom: 3,
    budgetSlowFrom: 60,    // past this sector the budget grows slowly (deep sectors get harder through mechanics, not crowds)
    budgetPerRoomSlow: 0.3,
    nextWaveAt: 0.25,      // next wave starts when at most this fraction of the current wave is alive
    swarmFromRoom: 2,
    shooterFromRoom: 2,
    bruteFromRoom: 4,
    spawnMinDist: 8,       // enemies never spawn closer than this to the player
    weaponDropChance: 0.3, // after clearing a combat room (rooms 1-2 and bosses always drop one)
  },
  elites: {
    fromRoom: 4,
    chance: 0.08,          // + chancePerRoom per room after fromRoom, capped at maxChance
    chancePerRoom: 0.02,
    maxChance: 0.3,
    hp: 3,
    size: 1.3,
    dmg: 1.3,
    reward: 3,             // score and coin multiplier
  },
  hazards: {
    fromRoom: 4,           // first combat room with terrain hazards
    twoTypesFromRoom: 7,
    riftFromRoom: 6,       // unstable rifts can appear from here
    riftChance: 0.45,
    sludgeSlow: 0.5,
    acidPlayerDps: 10,
    acidEnemyDps: 20,
    barrelHp: 20,
    barrelRadius: 3.2,
    barrelDmg: 60,
    barrelPlayerDmg: 20,
    gridOff: 2.6,          // electric grid cycle, seconds
    gridWarn: 0.8,
    gridOn: 1.5,
    gridPlayerDmg: 15,
    gridEnemyDmg: 12,
    coverHp: 70,
    riftHp: 150,
    riftSpawnEvery: 4.5,
    riftReward: 8,
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
    thermalRadius: 2.4,    // burn + frost synergy explosion
    thermalDmg: 35,
  },
  shop: {
    healAmount: 40,
    healPrice: 15,
    ammoPrice: 12,         // refills every picked-up weapon's reserve
  },
  // Hard limits on stats that upgrades push, so late runs can't spam dashes or fire nonstop.
  caps: {
    dashCooldown: 2,       // seconds, minimum
    fireRateMul: 2.2,      // maximum fire-rate multiplier (everything combined: modules, skill, frenzy, sentinel)
    reloadTimeMul: 0.5,    // reload never gets faster than half the weapon's base reload time...
    reloadTime: 0.8,       // ...and never below this many seconds
    speedMul: 1.4,         // maximum move speed relative to the mech's base speed
    critChance: 0.6,
    dmgBonus: 2,           // all "+X% damage" sources add up into one pool, capped at +200%
  },
  // Bosses can never be burst down: each hit takes at most perHit of max HP, and damage is limited to
  // perSecond of max HP per second (a budget that refills over time). Every boss fight lasts ~8s or more.
  bossGuard: {
    perHit: 0.04,
    perSecond: 0.12,
  },
  // Endless mode (after the final sector): enemies keep scaling, steeply at first, then gently, so
  // that past sector 60 the challenge comes mostly from mechanics (mutations, abyss rules) instead of
  // raw numbers, and deep sectors stay reachable for a maxed build.
  endless: {
    fromSector: 15,
    hpGrowth: 1.04,        // enemy HP x1.04 per sector, compounding, on top of the sector-15 value...
    hpSlowFrom: 60,        // ...then from this sector on
    hpGrowthSlow: 1.015,   // only x1.015 per sector
    dmgPerSector: 0.03,    // enemy damage +3% per sector...
    dmgSlowFrom: 80,       // ...then from this sector on
    dmgPerSectorSlow: 0.01,// only +1% per sector
    dmgMax: 4,             // and never more than x4
    eliteCapStep: 0.05,    // elite chance cap +5% every 10 sectors...
    eliteCapMax: 0.5,      // ...up to 50%
  },
  // Rare loot from regular kills: a module, a weapon or ammo, dropped on the floor (press E).
  killDrops: {
    chance: 0.025,         // per kill, scaled by the enemy's spawn cost (swarmers ~0.35x, brutes 3x)
    eliteMul: 4,
    perSector: 2,          // at most this many kill drops per sector
    kind: { module: 50, weapon: 30, ammo: 20 },
    rarity: { common: 80, rare: 18, legendary: 2 },   // modules: the better, the rarer
    weaponTier: [70, 25, 5],                          // weapons by shop price: <=30, 35, >=40
  },
  combo: {
    window: 2.5,           // seconds between kills to keep the combo going
    scorePerKill: 0.05,    // +5% score per combo step
    maxBonus: 1,           // capped at +100%
  },
  orbHeal: 15,
  // Health orbs: each enemy's own drop chance x dropMul, elites +eliteBonus, and terrain drops some too.
  orbs: { dropMul: 2, eliteBonus: 0.6, barrel: 0.3, cover: 0.4, rift: 2 },  // barrel/cover: chance; rift: orbs per closed rift
  orbMagnet: 4.5,
  coinMagnet: 6,
};
