import { t } from '../core/i18n';
export type WeaponId = 'pulse' | 'smg' | 'shotgun' | 'arc' | 'frost' | 'flame' | 'grenade' | 'rocket' | 'rail';
export type Element = 'burn' | 'frost' | 'shock';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  desc: string;
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
    id: 'pulse', name: t('脉冲枪'), desc: t('均衡的速射能量枪'), price: 0,
    rate: 0.11, mag: 24, reserve: 96, reloadT: 1.2, dmg: 11, speed: 34, spread: 0.05, count: 1, color: 0x4ff0ff, size: 0.17, knock: 2, life: 0.9, recoil: 0.3, shake: 0.04,
  },
  smg: {
    id: 'smg', name: t('冲锋枪'), desc: t('极高射速，精度较差'), price: 25,
    rate: 0.055, mag: 40, reserve: 200, reloadT: 1.4, dmg: 6, speed: 32, spread: 0, count: 1, jitter: 0.14, color: 0x7dff6a, size: 0.12, knock: 1, life: 0.6, recoil: 0.12, shake: 0.02,
    glow: 2, flash: 10,
  },
  shotgun: {
    id: 'shotgun', name: t('霰弹枪'), desc: t('近距离爆发，强力击退'), price: 30,
    rate: 0.6, mag: 6, reserve: 30, reloadT: 1.6, dmg: 9, speed: 28, spread: 0.32, count: 7, color: 0xffb84d, size: 0.14, knock: 7, life: 0.36, recoil: 4, shake: 0.22,
  },
  arc: {
    id: 'arc', name: t('电弧枪'), desc: t('命中时闪电链跳向附近敌人'), price: 35,
    rate: 0.32, mag: 12, reserve: 60, reloadT: 1.4, dmg: 15, speed: 42, spread: 0, count: 1, color: 0x8fb8ff, size: 0.16, knock: 2, life: 0.8, recoil: 0.4, shake: 0.06,
    element: 'shock', elementChance: 1,
  },
  frost: {
    id: 'frost', name: t('冰晶枪'), desc: t('穿透一个敌人并冻结减速'), price: 30,
    rate: 0.18, mag: 20, reserve: 100, reloadT: 1.4, dmg: 10, speed: 26, spread: 0, count: 1, jitter: 0.03, color: 0x9ff3ff, size: 0.2, knock: 1.5, life: 0.9, recoil: 0.25, shake: 0.04,
    pierce: 1, element: 'frost', elementChance: 1,
  },
  flame: {
    id: 'flame', name: t('烈焰喷射器'), desc: t('短程持续喷射，穿透并点燃敌人'), price: 35,
    rate: 0.045, mag: 80, reserve: 320, reloadT: 1.8, dmg: 3.5, speed: 15, spread: 0, count: 1, jitter: 0.22, color: 0xff7a2a, size: 0.22, knock: 0.6, life: 0.42, recoil: 0.05, shake: 0.015,
    stretch: 1, glow: 1.4, flash: 4, pierce: 99, drag: 2.5, grow: 1.4, element: 'burn', elementChance: 0.3,
  },
  grenade: {
    id: 'grenade', name: t('弹跳榴弹'), desc: t('碰墙反弹，触敌或到时爆炸'), price: 35,
    rate: 0.75, mag: 4, reserve: 20, reloadT: 1.8, dmg: 24, speed: 17, spread: 0, count: 1, color: 0x9dff3a, size: 0.26, knock: 3, life: 1.1, recoil: 2, shake: 0.1,
    stretch: 1, bounce: 3, blast: 3, drag: 0.8,
  },
  rocket: {
    id: 'rocket', name: t('火箭炮'), desc: t('大范围爆炸伤害'), price: 40,
    rate: 0.95, mag: 3, reserve: 12, reloadT: 2.0, dmg: 30, speed: 17, spread: 0, count: 1, color: 0xff4dd2, size: 0.3, knock: 3, life: 2, recoil: 3, shake: 0.12,
    stretch: 1, blast: 3.4,
  },
  rail: {
    id: 'rail', name: t('磁轨炮'), desc: t('贯穿一切的高能射线'), price: 45,
    rate: 1.1, mag: 3, reserve: 12, reloadT: 2.2, dmg: 75, speed: 95, spread: 0, count: 1, color: 0xffffff, size: 0.16, knock: 12, life: 0.45, recoil: 5, shake: 0.35,
    stretch: 12, pierce: 99,
  },
};

export const MAX_WEAPON_SLOTS = 3;

// Picking up a weapon you already own levels it up instead.
export const weaponLevelMul = (level: number): number => 1 + 0.25 * (level - 1);
