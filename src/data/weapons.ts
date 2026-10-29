export type WeaponSfx = 'blaster' | 'shotgun' | 'rocket';

export interface WeaponDef {
  name: string;
  sfx: WeaponSfx;
  rate: number;    // seconds between shots
  dmg: number;
  speed: number;
  spread: number;  // half-angle of the fan, radians
  count: number;   // projectiles per shot
  color: number;
  size: number;
  knock: number;
  life: number;    // projectile lifetime, seconds
  recoil: number;
  shake: number;
  blast?: number;  // explosion radius; projectile explodes on impact when set
}

export const WEAPONS: WeaponDef[] = [
  { name: '脉冲枪', sfx: 'blaster', rate: 0.11, dmg: 11, speed: 34, spread: 0.05, count: 1, color: 0x4ff0ff, size: 0.17, knock: 2, life: 0.9, recoil: 0.3, shake: 0.04 },
  { name: '霰弹枪', sfx: 'shotgun', rate: 0.6, dmg: 9, speed: 28, spread: 0.32, count: 7, color: 0xffb84d, size: 0.14, knock: 7, life: 0.36, recoil: 4, shake: 0.22 },
  { name: '火箭炮', sfx: 'rocket', rate: 0.95, dmg: 30, speed: 17, spread: 0, count: 1, color: 0xff4dd2, size: 0.3, knock: 3, life: 2, recoil: 3, shake: 0.12, blast: 3.4 },
];
