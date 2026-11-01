import { t } from '../core/i18n';
export type WeaponId = 'pulse' | 'smg' | 'shotgun' | 'arc' | 'frost' | 'flame' | 'grenade' | 'rocket' | 'rail'
  | 'disc' | 'blade' | 'prism' | 'spike' | 'swarm' | 'singularity';
export type Element = 'burn' | 'frost' | 'shock';

// Weapon tiers: standard (the mechs' starting weapons), advanced, elite. Higher tiers hit harder
// and bring stronger area / pierce effects. Target sustained single-target DPS at Lv1: 50 / 62 / 75.
// See docs/武装.md.
export type WeaponTier = 1 | 2 | 3;

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;       // the weapon's signature trait
  lv3: string;        // what Lv3 unlocks
  lv5: string;        // what Lv5 unlocks
  tier: WeaponTier;
  price: number;      // base shop price
  rate: number;       // seconds between shots
  mag: number;        // magazine size (shots)
  reserve: number;    // full reserve ammo when picked up; a mech's starting weapon has unlimited reserve
  reloadT: number;    // reload time, seconds
  dmg: number;
  speed: number;
  spread: number;     // half-angle of the fan for multi-projectile weapons, radians
  count: number;      // projectiles per shot
  color: number;
  size: number;
  knock: number;
  life: number;       // projectile lifetime, seconds
  recoil: number;
  shake: number;
  jitter?: number;    // random aim error per projectile, radians (default spread * 0.3)
  stretch?: number;   // tracer length relative to size (default 2.4)
  glow?: number;      // projectile brightness for bloom (default 3)
  flash?: number;     // muzzle flash light intensity (default 25)
  blast?: number;     // explosion radius; projectile explodes on impact or when it expires
  pierce?: number;    // enemies passed through before the projectile stops
  bounce?: number;    // wall ricochets
  drag?: number;      // velocity decay per second
  grow?: number;      // projectile scale growth per second
  element?: Element;
  elementChance?: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pulse: {
    id: 'pulse', name: t('脉冲枪'), tier: 1, price: 25,
    desc: t('连续射击时每第 4 发是充能脉冲：伤害 ×2.5、穿透 1 个敌人、命中时推开周围敌人'),
    lv3: t('充能脉冲变成每 3 发一次'), lv5: t('充能脉冲命中时引发电磁爆'),
    rate: 0.11, mag: 24, reserve: 96, reloadT: 1.2, dmg: 5.8, speed: 34, spread: 0.05, count: 1, color: 0x4ff0ff, size: 0.17, knock: 2, life: 0.9, recoil: 0.3, shake: 0.04,
  },
  smg: {
    id: 'smg', name: t('冲锋枪'), tier: 1, price: 25,
    desc: t('撕裂：命中叠层，每层让敌人受到的所有伤害 +2%（最多 10 层）· 持续开火 1 秒后散布减半'),
    lv3: t('撕裂最多 15 层'), lv5: t('满层撕裂的敌人死亡时迸出 8 发反弹子弹'),
    rate: 0.055, mag: 40, reserve: 200, reloadT: 1.4, dmg: 4.2, speed: 32, spread: 0, count: 1, jitter: 0.14, color: 0x7dff6a, size: 0.12, knock: 1, life: 0.6, recoil: 0.12, shake: 0.02,
    glow: 2, flash: 10,
  },
  shotgun: {
    id: 'shotgun', name: t('霰弹枪'), tier: 1, price: 30,
    desc: t('被击退撞墙的敌人受到 50% 撞击伤害并眩晕 0.4 秒 · 3 米内击退更强'),
    lv3: t('弹丸 +2'), lv5: t('近距离命中 5 发以上时震荡：推开周围敌人并清除近处子弹'),
    rate: 0.6, mag: 6, reserve: 30, reloadT: 1.6, dmg: 6, speed: 28, spread: 0.32, count: 7, color: 0xffb84d, size: 0.14, knock: 7, life: 0.36, recoil: 4, shake: 0.22,
  },
  frost: {
    id: 'frost', name: t('冰晶枪'), tier: 2, price: 35,
    desc: t('命中叠寒霜，叠满 5 层冻成冰块 1.2 秒 · 冰块被击杀时碎成 6 片冰刺'),
    lv3: t('穿透 +1'), lv5: t('冰块碎裂时给周围敌人叠 2 层寒霜'),
    rate: 0.18, mag: 20, reserve: 100, reloadT: 1.4, dmg: 15, speed: 26, spread: 0, count: 1, jitter: 0.03, color: 0x9ff3ff, size: 0.2, knock: 1.5, life: 0.9, recoil: 0.25, shake: 0.04,
    pierce: 1, element: 'frost', elementChance: 1,
  },
  arc: {
    id: 'arc', name: t('电弧枪'), tier: 2, price: 35,
    desc: t('每发连锁 3 个目标 · 同一敌人命中 3 次后，下一发引发过载：150% 伤害、眩晕并波及周围'),
    lv3: t('连锁 +1 目标'), lv5: t('连锁伤害 100%，过载只需命中 2 次'),
    rate: 0.25, mag: 12, reserve: 60, reloadT: 1.4, dmg: 16, speed: 42, spread: 0, count: 1, color: 0x8fb8ff, size: 0.16, knock: 2, life: 0.8, recoil: 0.4, shake: 0.06,
  },
  flame: {
    id: 'flame', name: t('烈焰喷射器'), tier: 2, price: 35,
    desc: t('升温：持续喷射 1.5 秒后伤害 +100% · 烧毁喷射范围内的敌方子弹'),
    lv3: t('射程 +25%'), lv5: t('升温速度翻倍，上限 +120%'),
    rate: 0.045, mag: 80, reserve: 320, reloadT: 1.8, dmg: 2.2, speed: 15, spread: 0, count: 1, jitter: 0.22, color: 0xff7a2a, size: 0.22, knock: 0.6, life: 0.42, recoil: 0.05, shake: 0.015,
    stretch: 1, glow: 1.4, flash: 4, pierce: 99, drag: 2.5, grow: 1.4, element: 'burn', elementChance: 0.3,
  },
  grenade: {
    id: 'grenade', name: t('弹跳榴弹'), tier: 2, price: 35,
    desc: t('每碰一次墙，爆炸伤害 +30%、范围 +10%（最多 3 次）· 直接撞到敌人立刻爆炸'),
    lv3: t('爆炸范围 +25%'), lv5: t('爆炸后散出 3 颗小榴弹'),
    rate: 0.75, mag: 4, reserve: 20, reloadT: 1.8, dmg: 38, speed: 17, spread: 0, count: 1, color: 0x9dff3a, size: 0.26, knock: 3, life: 1.1, recoil: 2, shake: 0.1,
    stretch: 1, bounce: 3, blast: 3, drag: 0.8,
  },
  rocket: {
    id: 'rocket', name: t('火箭炮'), tier: 3, price: 40,
    desc: t('直击：火箭直接命中的敌人受到双倍伤害 · 爆炸推开周围敌人'),
    lv3: t('弹匣 +1'), lv5: t('火箭轻微追踪，爆炸处留下 2 秒焦土'),
    rate: 0.95, mag: 3, reserve: 12, reloadT: 2.0, dmg: 28, speed: 17, spread: 0, count: 1, color: 0xff4dd2, size: 0.3, knock: 3, life: 2, recoil: 3, shake: 0.12,
    stretch: 1, blast: 3.4,
  },
  rail: {
    id: 'rail', name: t('磁轨炮'), tier: 3, price: 45,
    desc: t('按住蓄能、松开发射（蓄满 100%，未蓄满 60%）· 贯穿一切，每穿过一个敌人伤害 +15%'),
    lv3: t('蓄满时间 0.8 → 0.5 秒'), lv5: t('光束终点爆炸'),
    rate: 0.4, mag: 3, reserve: 12, reloadT: 2.2, dmg: 125, speed: 95, spread: 0, count: 1, color: 0xe6dcff, size: 0.16, knock: 12, life: 0.45, recoil: 5, shake: 0.35,
    stretch: 12, pierce: 99, glow: 1.6,
  },
  disc: {
    id: 'disc', name: t('光轮'), tier: 1, price: 25,
    desc: t('掷出 9 米后飞回，去程和回程都切割路径上的所有敌人 · 接住返回的光轮会退回这一发'),
    lv3: t('飞行距离 +30%，光轮变大'), lv5: t('每次同时掷出 2 个光轮（各 65% 伤害）'),
    rate: 0.6, mag: 4, reserve: 24, reloadT: 1.4, dmg: 18, speed: 18, spread: 0, count: 1, color: 0xff5ce1, size: 0.55, knock: 3, life: 3, recoil: 0.6, shake: 0.05,
    stretch: 1, glow: 1.15, flash: 8, pierce: 99,
  },
  blade: {
    id: 'blade', name: t('等离子刃'), tier: 2, price: 35,
    desc: t('近战：向准星方向挥出 120° 光刃，命中 3 米内所有敌人 · 扫到的敌方子弹会被反弹回去（2 倍伤害）'),
    lv3: t('挥砍范围 +25%'), lv5: t('每第 3 次挥砍放出一道穿透的剑气'),
    rate: 0.45, mag: 8, reserve: 80, reloadT: 1.2, dmg: 30, speed: 24, spread: 0, count: 1, color: 0x6dfcff, size: 0.3, knock: 6, life: 0.34, recoil: -1.2, shake: 0.08,
    stretch: 3, glow: 2.4, flash: 10, pierce: 99,
  },
  prism: {
    id: 'prism', name: t('棱镜枪'), tier: 2, price: 35,
    desc: t('折射：光弹命中后向前方折射出 2 道彩色光线（各 50% 伤害）'),
    lv3: t('折射光线 +1'), lv5: t('折射出的光线还会再折射一次'),
    rate: 0.2, mag: 18, reserve: 90, reloadT: 1.4, dmg: 17, speed: 38, spread: 0, count: 1, color: 0xf4f4ff, size: 0.17, knock: 1.5, life: 0.8, recoil: 0.3, shake: 0.04,
    stretch: 3.2, glow: 2.2,
  },
  spike: {
    id: 'spike', name: t('锚钉枪'), tier: 2, price: 35,
    desc: t('锚钉钉在敌人身上，1.5 秒后一起引爆 · 每多一根，爆炸范围更大（最多 6 根）'),
    lv3: t('爆炸范围 +30%'), lv5: t('引爆时向附近 3 个敌人各射出一根锚钉'),
    rate: 0.15, mag: 12, reserve: 60, reloadT: 1.5, dmg: 4, speed: 36, spread: 0, count: 1, jitter: 0.02, color: 0xff3b5c, size: 0.12, knock: 0.5, life: 0.7, recoil: 0.35, shake: 0.03,
    stretch: 3.5, glow: 2.4,
  },
  swarm: {
    id: 'swarm', name: t('蜂群导弹'), tier: 3, price: 45,
    desc: t('按住扫描锁定敌人（最多 6 个），松开向每个锁定发射一枚追踪导弹 · 没有锁定时直射 2 枚'),
    lv3: t('锁定上限 6 → 8'), lv5: t('导弹爆炸范围 +50%'),
    rate: 0.3, mag: 12, reserve: 48, reloadT: 2.0, dmg: 30, speed: 20, spread: 0.25, count: 1, color: 0xffa04d, size: 0.16, knock: 2, life: 2.2, recoil: 0.8, shake: 0.06,
    stretch: 2, glow: 2.6, flash: 14, blast: 1.2,
  },
  singularity: {
    id: 'singularity', name: t('奇点投射器'), tier: 3, price: 50,
    desc: t('发射奇点，展开 2.5 秒引力井，把周围敌人吸向中心并持续伤害，结束时坍缩爆炸 · 首领不会被吸动'),
    lv3: t('引力范围 +30%'), lv5: t('坍缩后再展开一个小奇点'),
    rate: 1.2, mag: 2, reserve: 8, reloadT: 2.6, dmg: 81, speed: 9, spread: 0, count: 1, color: 0xa13dff, size: 0.42, knock: 0, life: 1.2, recoil: 1.5, shake: 0.12,
    stretch: 1, glow: 2, flash: 20,
  },
};

// Numbers behind each weapon's signature trait (used by game/arsenal.ts and the player's firing code).
export const TRAITS = {
  pulse: { every: 4, everyLv3: 3, mul: 2.5, pushRadius: 1.4, burstRadius: 1.5, burstMul: 0.2 },
  smg: { shredPer: 0.02, shredMax: 10, shredMaxLv3: 15, shredTime: 2, tightenAfter: 1, burstShots: 8 },
  shotgun: { slamMul: 0.5, slamStun: 0.4, slamWindow: 0.35, nearRange: 3, nearKnock: 1.5, pelletsLv3: 2, quakeHits: 5, quakeRadius: 2 },
  frost: { chillMax: 5, chillTime: 2.5, freeze: 1.2, bossSlow: 0.5, shards: 6, shardMul: 0.4, spreadRadius: 2.5, spreadChill: 2 },
  arc: { chainTargets: 3, chainMul: 0.6, overloadHits: 3, overloadHitsLv5: 2, overloadMul: 1.5, overloadStun: 0.5, overloadRadius: 2, overloadSplash: 0.75 },
  flame: { heatTime: 1.5, heatMax: 1, heatMaxLv5: 1.2, coolDelay: 0.5, rangeLv3: 1.25, burnRadius: 0.8 },
  grenade: { bounceDmg: 0.3, bounceRadius: 0.1, maxBounces: 3, radiusLv3: 1.25, cluster: 3, clusterMul: 0.15 },
  rocket: { directMul: 2, magLv3: 1, homingTurn: 1.6, homingRange: 6, scorchTime: 2, scorchDps: 0.1 },
  rail: { charge: 0.8, chargeLv3: 0.5, minMul: 0.6, pierceRamp: 0.15, endRadius: 2.5, endMul: 0.5 },
  disc: { range: 9, rangeLv3: 1.3, sizeLv3: 1.3, returnSpeed: 20, catchRadius: 1.4, pairAngle: 0.21, pairMul: 0.65 },
  blade: { arc: Math.PI * 2 / 3, radius: 3, radiusLv3: 1.25, reflectMul: 2, waveEvery: 3 },
  prism: { rays: 2, raysLv3: 3, angle: 0.44, mul: 0.5, life: 0.35 },
  spike: { maxSpikes: 6, delay: 1.5, blastDmg: 18, radius: 1.2, radiusPer: 0.2, radiusLv3: 1.3, scatter: 3, scatterRange: 6 },
  swarm: { lockEvery: 0.25, blastLv5: 1.5, maxLocks: 6, maxLocksLv3: 8, lockRadius: 2.5, straight: 2, straightCd: 1.2, turn: 7 },
  singularity: { radius: 4, radiusLv3: 1.3, time: 2.5, pull: 9, dps: 0.3, implodeRadius: 3, echoDelay: 1, echoRadius: 2.5, echoTime: 1, echoMul: 0.5 },
};

export const MAX_WEAPON_SLOTS = 3;

// Picking up a weapon you already own levels it up instead, up to MAX_WEAPON_LEVEL.
export const MAX_WEAPON_LEVEL = 5;
export const weaponLevelMul = (level: number): number => 1 + 0.2 * (Math.min(level, MAX_WEAPON_LEVEL) - 1);
