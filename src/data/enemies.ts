import { t } from '../core/i18n';
export type EnemyKind =
  | 'grunt' | 'swarmer' | 'bomber' | 'splitter' | 'shooter' | 'sniper' | 'shield' | 'summoner' | 'brute'
  | 'corroder' | 'tower' | 'burrower' | 'replicator' | 'linker' | 'assassin' | 'mender' | 'mirror'
  | 'boss' | 'boss2' | 'boss3' | 'colossus' | 'wyrm' | 'mirrorMind'
  | 'prismPlate' | 'wyrmSeg' | 'mirrorClone'
  | 'rewinder' | 'missileNest' | 'missile' | 'condenser' | 'quaker' | 'lightEater' | 'diver' | 'hiveCore' | 'worker'
  | 'devourer' | 'wallBuilder' | 'wallBlock' | 'mortar' | 'thief' | 'mimic' | 'parasite' | 'ringStar' | 'commander'
  | 'boomerang' | 'riftWalker' | 'juggernaut'
  | 'echo' | 'eye' | 'fortress' | 'brood' | 'origin' | 'turret' | 'sac' | 'riftCrystal';

// Newer enemies are assembled from four interchangeable parts (see src/game/enemyParts.ts), so that
// deep endless sectors can later fuse two enemies into a new one by mixing their parts.
export type MovePart = 'chase' | 'deploy' | 'burrow' | 'flank' | 'stalk' | 'skulk'
  | 'kite' | 'home' | 'weave' | 'swoop' | 'forage' | 'artillery' | 'thieve' | 'lurk' | 'latch' | 'portalWalk' | 'inert';
export type AttackPart = 'contact' | 'spinStream' | 'erupt' | 'link' | 'slash' | 'mend'
  | 'missiles' | 'detonate' | 'quake' | 'devour' | 'raiseWall' | 'lob' | 'ringBurst' | 'rally' | 'glaive' | 'single' | 'stomp';
export type SpecialPart = 'acidTrail' | 'replicate' | 'mirror' | 'rewind' | 'iceSheet' | 'darkAura' | 'hive' | 'armor';
export type DeathPart = 'acidPool' | 'lightBurst' | 'parasites';
export interface EnemyParts {
  move: MovePart;
  attack: AttackPart;
  special?: SpecialPart;
  death?: DeathPart;
}

export interface EnemyDef {
  name: string;
  hp: number;          // base HP, scaled up per room (see BALANCE)
  speed: number;
  r: number;           // collision radius
  y: number;           // mesh height above the floor
  color: number;
  dmg: number;         // contact damage (bombers: explosion damage)
  score: number;
  cost: number;        // spawn budget cost when planning a room
  mass: number;        // knockback multiplier; lower is heavier
  ccResist: number;    // 0..1, how much frost slow is reduced
  dropChance: number;  // chance to drop health orbs on death
  dropCount: number;
  coins: [number, number];
  boss?: boolean;
  parts?: EnemyParts;  // built from parts instead of a hand-written behavior
  anchored?: boolean;  // can't be knocked back or pulled (planted turrets)
  maxAlive?: number;   // at most this many on the field at once
  spins?: boolean;     // the body turns on its own (mirror) instead of facing the player
  part?: boolean;      // a piece of a boss (plate, segment, turret): placed by its owner, shares its damage guard
  share?: number;      // part: this fraction of the damage it takes also hits the owner
  reflects?: boolean;  // every shot that hits it bounces back (prism plates)
  mirrored?: boolean;  // shots on its lit face bounce back (mirror)
  bound?: boolean;     // dies with its owner even though it moves on its own (mirror clones)
  inert?: boolean;     // doesn't count toward clearing the sector, and goes when it's cleared (walls, missiles)
  noFreeze?: boolean;  // frost slows it instead of freezing it solid
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  grunt: {
    name: t('冲锋兵'), hp: 30, speed: 4.4, r: 0.6, y: 0.55, color: 0xff3355, dmg: 12, score: 10, cost: 1,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 2],
  },
  swarmer: {
    name: t('蜂群体'), hp: 9, speed: 6.4, r: 0.38, y: 0.4, color: 0xff5a8c, dmg: 6, score: 4, cost: 0.35,
    mass: 1.4, ccResist: 0, dropChance: 0.02, dropCount: 1, coins: [0, 1],
  },
  bomber: {
    name: t('自爆虫'), hp: 18, speed: 5.2, r: 0.55, y: 0.55, color: 0xff4400, dmg: 22, score: 12, cost: 1.2,
    mass: 1, ccResist: 0, dropChance: 0.06, dropCount: 1, coins: [1, 2],
  },
  splitter: {
    name: t('分裂体'), hp: 48, speed: 3.4, r: 0.75, y: 0.7, color: 0xe0408a, dmg: 14, score: 18, cost: 1.6,
    mass: 0.7, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 3],
  },
  shooter: {
    name: t('射手'), hp: 24, speed: 3.2, r: 0.6, y: 0.9, color: 0xb455ff, dmg: 10, score: 15, cost: 1.5,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 3],
  },
  sniper: {
    name: t('狙击手'), hp: 30, speed: 2.8, r: 0.55, y: 1.0, color: 0xff2244, dmg: 10, score: 20, cost: 1.8,
    mass: 1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
  },
  shield: {
    name: t('护盾兵'), hp: 70, speed: 2.8, r: 0.75, y: 0.8, color: 0x8f6bff, dmg: 16, score: 25, cost: 2.2,
    mass: 0.6, ccResist: 0.2, dropChance: 0.12, dropCount: 1, coins: [2, 4],
  },
  summoner: {
    name: t('召唤者'), hp: 45, speed: 2.6, r: 0.65, y: 1.2, color: 0xd14dff, dmg: 8, score: 28, cost: 2.5,
    mass: 1, ccResist: 0, dropChance: 0.15, dropCount: 1, coins: [2, 4],
  },
  brute: {
    name: t('重装兵'), hp: 120, speed: 2.4, r: 1.1, y: 0.9, color: 0xff8a2a, dmg: 25, score: 35, cost: 3,
    mass: 0.35, ccResist: 0.3, dropChance: 0.5, dropCount: 1, coins: [3, 5],
  },
  corroder: {
    name: t('腐蚀者'), hp: 34, speed: 3.6, r: 0.65, y: 0.35, color: 0x52c41f, dmg: 10, score: 14, cost: 1.3,
    mass: 0.9, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 2],
    parts: { move: 'chase', attack: 'contact', special: 'acidTrail', death: 'acidPool' },
  },
  tower: {
    name: t('棱镜塔'), hp: 60, speed: 2.4, r: 0.7, y: 0.8, color: 0xf0a020, dmg: 8, score: 24, cost: 2,
    mass: 0, ccResist: 0, dropChance: 0.12, dropCount: 1, coins: [2, 4], anchored: true, maxAlive: 3,
    parts: { move: 'deploy', attack: 'spinStream' },
  },
  burrower: {
    name: t('钻地者'), hp: 40, speed: 5, r: 0.6, y: 0.6, color: 0xd9763a, dmg: 18, score: 22, cost: 1.8,
    mass: 0.8, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
    parts: { move: 'burrow', attack: 'erupt' },
  },
  replicator: {
    name: t('复制者'), hp: 30, speed: 3, r: 0.6, y: 0.6, color: 0xff3dc8, dmg: 10, score: 16, cost: 1.6,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 3],
    parts: { move: 'chase', attack: 'contact', special: 'replicate' },
  },
  linker: {
    name: t('链接体'), hp: 32, speed: 3.4, r: 0.55, y: 0.6, color: 0x2f9be0, dmg: 15, score: 14, cost: 2.4,
    mass: 1, ccResist: 0, dropChance: 0.08, dropCount: 1, coins: [1, 2],
    parts: { move: 'flank', attack: 'link' },
  },
  assassin: {
    name: t('相位刺客'), hp: 26, speed: 6, r: 0.5, y: 0.7, color: 0xa07ae8, dmg: 20, score: 20, cost: 1.6,
    mass: 1.1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [1, 3],
    parts: { move: 'stalk', attack: 'slash' },
  },
  mender: {
    name: t('修复节点'), hp: 40, speed: 3, r: 0.6, y: 1.0, color: 0x1fc48a, dmg: 6, score: 26, cost: 2.2,
    mass: 1, ccResist: 0, dropChance: 0.12, dropCount: 1, coins: [2, 4], maxAlive: 2,
    parts: { move: 'skulk', attack: 'mend' },
  },
  mirror: {
    name: t('镜面体'), hp: 55, speed: 2.6, r: 0.75, y: 0.8, color: 0x8fa3c0, dmg: 14, score: 24, cost: 2.2,
    mass: 0.6, ccResist: 0.1, dropChance: 0.12, dropCount: 1, coins: [2, 4], spins: true, mirrored: true,
    parts: { move: 'chase', attack: 'contact', special: 'mirror' },
  },
  boss: {
    name: t('核心守卫者'), hp: 1100, speed: 2.0, r: 2.0, y: 2.2, color: 0xff2266, dmg: 30, score: 400, cost: 0,
    mass: 0.05, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [25, 30], boss: true,
  },
  boss2: {
    name: t('织网者'), hp: 1500, speed: 2.6, r: 2.0, y: 1.6, color: 0xff3d9e, dmg: 30, score: 600, cost: 0,
    mass: 0.05, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [35, 40], boss: true,
  },
  boss3: {
    name: t('裂隙主宰'), hp: 2100, speed: 1.8, r: 2.2, y: 2.4, color: 0xa13dff, dmg: 35, score: 900, cost: 0,
    mass: 0.04, ccResist: 0.7, dropChance: 1, dropCount: 6, coins: [45, 55], boss: true,
  },
  colossus: {
    name: t('棱镜巨像'), hp: 1200, speed: 1.6, r: 1.6, y: 1.8, color: 0xc08830, dmg: 28, score: 450, cost: 0,
    mass: 0.05, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [25, 30], boss: true,
  },
  wyrm: {
    name: t('噬地蠕虫'), hp: 1600, speed: 3.2, r: 1.2, y: 0.9, color: 0xc0603a, dmg: 28, score: 650, cost: 0,
    mass: 0, ccResist: 0.6, dropChance: 1, dropCount: 5, coins: [35, 40], boss: true, anchored: true,
  },
  mirrorMind: {
    name: t('镜像主机'), hp: 2200, speed: 2.4, r: 1.5, y: 1.8, color: 0x9fb4e0, dmg: 30, score: 950, cost: 0,
    mass: 0.04, ccResist: 0.7, dropChance: 1, dropCount: 6, coins: [45, 55], boss: true,
  },
  // boss pieces (HP is set from the boss's)
  prismPlate: {
    name: t('棱镜板'), hp: 1, speed: 0, r: 1.1, y: 1.1, color: 0x9a7030, dmg: 18, score: 0, cost: 0,
    mass: 0, ccResist: 1, dropChance: 0, dropCount: 0, coins: [0, 0], anchored: true, part: true, reflects: true, spins: true,
  },
  wyrmSeg: {
    name: t('蠕虫体节'), hp: 1, speed: 0, r: 0.9, y: 0.7, color: 0xa8502f, dmg: 16, score: 0, cost: 0,
    mass: 0, ccResist: 1, dropChance: 0, dropCount: 0, coins: [0, 0], anchored: true, part: true, share: 0.6, spins: true,
  },
  mirrorClone: {
    name: t('镜像分身'), hp: 1, speed: 2.4, r: 1.5, y: 1.8, color: 0x9fb4e0, dmg: 20, score: 0, cost: 0,
    mass: 0.3, ccResist: 0, dropChance: 0, dropCount: 0, coins: [0, 0], bound: true,
  },
  // endless bosses
  echo: {
    name: t('回响者'), hp: 2000, speed: 2.6, r: 1.5, y: 1.8, color: 0x7fd8d0, dmg: 28, score: 1000, cost: 0,
    mass: 0.04, ccResist: 0.7, dropChance: 1, dropCount: 6, coins: [45, 55], boss: true,
  },
  eye: {
    name: t('蚀光之眼'), hp: 2200, speed: 1.6, r: 1.8, y: 2.2, color: 0xa080f0, dmg: 26, score: 1100, cost: 0,
    mass: 0.03, ccResist: 0.7, dropChance: 1, dropCount: 6, coins: [50, 60], boss: true,
  },
  fortress: {
    name: t('攻城要塞'), hp: 2400, speed: 1.2, r: 2.2, y: 1.6, color: 0xb09050, dmg: 30, score: 1200, cost: 0,
    mass: 0, ccResist: 0.8, dropChance: 1, dropCount: 6, coins: [55, 65], boss: true, anchored: true,
  },
  brood: {
    name: t('寄生母巢'), hp: 2200, speed: 1.8, r: 2, y: 1.6, color: 0x70c040, dmg: 26, score: 1200, cost: 0,
    mass: 0.03, ccResist: 0.7, dropChance: 1, dropCount: 6, coins: [55, 65], boss: true,
  },
  origin: {
    name: t('裂隙本源'), hp: 3000, speed: 2, r: 1.8, y: 2.4, color: 0xd070ff, dmg: 32, score: 1600, cost: 0,
    mass: 0.02, ccResist: 0.8, dropChance: 1, dropCount: 8, coins: [70, 90], boss: true,
  },
  turret: {
    name: t('要塞炮台'), hp: 1, speed: 0, r: 0.9, y: 1.2, color: 0x9a8a60, dmg: 0, score: 0, cost: 0,
    mass: 0, ccResist: 1, dropChance: 0, dropCount: 0, coins: [0, 0], anchored: true, part: true,
  },
  riftCrystal: {
    name: t('裂隙水晶'), hp: 1, speed: 0, r: 0.7, y: 1, color: 0xd070ff, dmg: 0, score: 0, cost: 0,
    mass: 0, ccResist: 1, dropChance: 0, dropCount: 0, coins: [0, 0], anchored: true, part: true,
  },
  sac: {
    name: t('孵化囊'), hp: 1, speed: 0, r: 0.6, y: 0.5, color: 0x8ad050, dmg: 0, score: 0, cost: 0,
    mass: 0, ccResist: 1, dropChance: 0, dropCount: 0, coins: [0, 0], anchored: true, bound: true,
  },
  // endless strata (sectors 16-60)
  rewinder: {
    name: t('回溯体'), hp: 50, speed: 3.4, r: 0.6, y: 0.7, color: 0x7fb8b0, dmg: 12, score: 22, cost: 1.8,
    mass: 1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
    parts: { move: 'chase', attack: 'contact', special: 'rewind' },
  },
  missileNest: {
    name: t('导弹巢'), hp: 70, speed: 2, r: 0.8, y: 0.6, color: 0xb03030, dmg: 8, score: 26, cost: 2.4,
    mass: 0.6, ccResist: 0, dropChance: 0.12, dropCount: 1, coins: [2, 4], maxAlive: 3,
    parts: { move: 'kite', attack: 'missiles' },
  },
  missile: {
    name: t('追踪导弹'), hp: 1, speed: 4.5, r: 0.35, y: 0.9, color: 0xff5040, dmg: 15, score: 0, cost: 0,
    mass: 1, ccResist: 0, dropChance: 0, dropCount: 0, coins: [0, 0], inert: true,
    parts: { move: 'home', attack: 'detonate' },
  },
  condenser: {
    name: t('冷凝体'), hp: 45, speed: 3, r: 0.6, y: 0.8, color: 0x60b8e0, dmg: 10, score: 18, cost: 1.6,
    mass: 1, ccResist: 0.2, dropChance: 0.08, dropCount: 1, coins: [1, 3], noFreeze: true,
    parts: { move: 'kite', attack: 'contact', special: 'iceSheet' },
  },
  quaker: {
    name: t('震荡者'), hp: 110, speed: 2.2, r: 1, y: 0.8, color: 0x5878b0, dmg: 16, score: 30, cost: 2.6,
    mass: 0.4, ccResist: 0.2, dropChance: 0.3, dropCount: 1, coins: [2, 4],
    parts: { move: 'chase', attack: 'quake' },
  },
  lightEater: {
    name: t('吞光者'), hp: 55, speed: 2.8, r: 0.7, y: 0.9, color: 0x6a40a0, dmg: 8, score: 24, cost: 2,
    mass: 0.9, ccResist: 0, dropChance: 0.12, dropCount: 1, coins: [2, 3],
    parts: { move: 'kite', attack: 'contact', special: 'darkAura', death: 'lightBurst' },
  },
  diver: {
    name: t('俯冲者'), hp: 35, speed: 5.5, r: 0.6, y: 0.6, color: 0xd04030, dmg: 20, score: 20, cost: 1.8,
    mass: 1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [1, 3],
    parts: { move: 'swoop', attack: 'contact' },
  },
  hiveCore: {
    name: t('巢心'), hp: 80, speed: 3.2, r: 0.75, y: 0.9, color: 0xd8a020, dmg: 6, score: 34, cost: 3,
    mass: 0.9, ccResist: 0, dropChance: 0.3, dropCount: 1, coins: [3, 5], maxAlive: 1,
    parts: { move: 'skulk', attack: 'contact', special: 'hive' },
  },
  worker: {
    name: t('工蜂'), hp: 9, speed: 6.4, r: 0.38, y: 0.4, color: 0xc89020, dmg: 6, score: 3, cost: 0,
    mass: 1.4, ccResist: 0, dropChance: 0.02, dropCount: 1, coins: [0, 1],
    parts: { move: 'weave', attack: 'contact' },
  },
  devourer: {
    name: t('吞噬者'), hp: 60, speed: 3.6, r: 0.7, y: 0.7, color: 0x8a3aa0, dmg: 14, score: 26, cost: 2.2,
    mass: 0.8, ccResist: 0, dropChance: 0.15, dropCount: 1, coins: [2, 4],
    parts: { move: 'forage', attack: 'devour' },
  },
  wallBuilder: {
    name: t('筑墙者'), hp: 50, speed: 3, r: 0.6, y: 0.8, color: 0xb09040, dmg: 8, score: 22, cost: 2,
    mass: 0.9, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
    parts: { move: 'kite', attack: 'raiseWall' },
  },
  wallBlock: {
    name: t('墙'), hp: 1, speed: 0, r: 0.75, y: 0.8, color: 0x8a7840, dmg: 0, score: 0, cost: 0,
    mass: 0, ccResist: 1, dropChance: 0, dropCount: 0, coins: [0, 0], anchored: true, inert: true,
    parts: { move: 'inert', attack: 'contact' },
  },
  mortar: {
    name: t('迫击体'), hp: 40, speed: 2.6, r: 0.6, y: 0.7, color: 0x708030, dmg: 18, score: 22, cost: 2,
    mass: 1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
    parts: { move: 'artillery', attack: 'lob' },
  },
  thief: {
    name: t('窃能者'), hp: 28, speed: 7.5, r: 0.5, y: 0.6, color: 0xd0a030, dmg: 6, score: 18, cost: 1.6,
    mass: 1.2, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 4],
    parts: { move: 'thieve', attack: 'contact' },
  },
  mimic: {
    name: t('伪装体'), hp: 40, speed: 4, r: 0.55, y: 0.5, color: 0xc03040, dmg: 18, score: 20, cost: 1.5,
    mass: 1, ccResist: 0, dropChance: 0.2, dropCount: 1, coins: [2, 3], maxAlive: 2,
    parts: { move: 'lurk', attack: 'contact' },
  },
  parasite: {
    name: t('寄生虫'), hp: 12, speed: 6.5, r: 0.35, y: 0.35, color: 0x60d040, dmg: 4, score: 6, cost: 0.6,
    mass: 1.4, ccResist: 0, dropChance: 0.02, dropCount: 1, coins: [0, 1],
    parts: { move: 'latch', attack: 'contact' },
  },
  ringStar: {
    name: t('星环体'), hp: 60, speed: 2.6, r: 0.6, y: 0.9, color: 0xc8b060, dmg: 10, score: 26, cost: 2.2,
    mass: 0.9, ccResist: 0, dropChance: 0.12, dropCount: 1, coins: [2, 4],
    parts: { move: 'kite', attack: 'ringBurst' },
  },
  commander: {
    name: t('统御者'), hp: 90, speed: 2.4, r: 0.7, y: 1.1, color: 0xb09030, dmg: 10, score: 36, cost: 3,
    mass: 0.8, ccResist: 0, dropChance: 0.3, dropCount: 1, coins: [3, 5], maxAlive: 1,
    parts: { move: 'skulk', attack: 'rally' },
  },
  boomerang: {
    name: t('回旋体'), hp: 45, speed: 3.2, r: 0.6, y: 0.8, color: 0x7050c0, dmg: 14, score: 22, cost: 1.8,
    mass: 1, ccResist: 0, dropChance: 0.1, dropCount: 1, coins: [2, 3],
    parts: { move: 'kite', attack: 'glaive' },
  },
  riftWalker: {
    name: t('裂隙行者'), hp: 50, speed: 4, r: 0.55, y: 1, color: 0xb090e0, dmg: 14, score: 28, cost: 2.4,
    mass: 1, ccResist: 0, dropChance: 0.12, dropCount: 1, coins: [2, 4],
    parts: { move: 'portalWalk', attack: 'single' },
  },
  juggernaut: {
    name: t('装甲巨兽'), hp: 400, speed: 1.6, r: 1.4, y: 1.1, color: 0x707888, dmg: 30, score: 90, cost: 6,
    mass: 0.15, ccResist: 0.4, dropChance: 0.8, dropCount: 2, coins: [6, 10], maxAlive: 1, spins: true,
    parts: { move: 'chase', attack: 'stomp', special: 'armor' },
  },
};

// Which enemies can appear from which sector depth, and how often. `pack` enemies arrive in groups.
export const SPAWN_TABLE: { kind: EnemyKind; from: number; weight: number; pack?: [number, number] }[] = [
  { kind: 'grunt', from: 1, weight: 30 },
  { kind: 'swarmer', from: 2, weight: 16, pack: [5, 9] },
  { kind: 'shooter', from: 2, weight: 18 },
  { kind: 'bomber', from: 3, weight: 12 },
  { kind: 'splitter', from: 4, weight: 10 },
  { kind: 'brute', from: 4, weight: 8 },
  { kind: 'shield', from: 5, weight: 9 },
  { kind: 'sniper', from: 6, weight: 8 },
  { kind: 'summoner', from: 7, weight: 6 },
  { kind: 'corroder', from: 3, weight: 10 },
  { kind: 'tower', from: 6, weight: 7 },
  { kind: 'burrower', from: 7, weight: 7 },
  { kind: 'replicator', from: 13, weight: 5 },
  { kind: 'linker', from: 8, weight: 6 },
  { kind: 'assassin', from: 9, weight: 6 },
  { kind: 'mender', from: 10, weight: 5 },
  { kind: 'mirror', from: 12, weight: 5 },
  { kind: 'rewinder', from: 16, weight: 6 },
  { kind: 'missileNest', from: 16, weight: 5 },
  { kind: 'condenser', from: 21, weight: 6 },
  { kind: 'quaker', from: 21, weight: 5 },
  { kind: 'lightEater', from: 26, weight: 5 },
  { kind: 'diver', from: 26, weight: 6 },
  { kind: 'hiveCore', from: 31, weight: 4 },
  { kind: 'devourer', from: 31, weight: 5 },
  { kind: 'wallBuilder', from: 36, weight: 5 },
  { kind: 'mortar', from: 36, weight: 6 },
  { kind: 'thief', from: 41, weight: 5 },
  { kind: 'mimic', from: 41, weight: 3 },
  { kind: 'parasite', from: 46, weight: 6, pack: [3, 3] },
  { kind: 'ringStar', from: 46, weight: 5 },
  { kind: 'commander', from: 51, weight: 3 },
  { kind: 'boomerang', from: 51, weight: 6 },
  { kind: 'riftWalker', from: 56, weight: 4 },
  { kind: 'juggernaut', from: 56, weight: 2 },
];
