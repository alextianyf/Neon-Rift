import { t } from '../core/i18n';
import { rnd } from '../core/rng';
import type { EnemyKind } from '../data/enemies';
import type { Enemy } from './enemies';
import type { Game } from './game';

// Abyss mutations (docs/敌人.md, sector 65+): every 5 sectors the player picks one of two global
// rules, which then stay for the rest of the run (6 at most; a seventh replaces the oldest). Each
// active mutation adds 5% to shard and crystal income. Other systems ask this module what applies.

export type MutationId = 'acid' | 'fastShots' | 'swarm' | 'doubleAffix' | 'wraith' | 'carapace'
  | 'nightfall' | 'unstable' | 'eliteTide' | 'frenzy' | 'barrage' | 'symbiosis';

export const MUTATIONS: Record<MutationId, { name: string; desc: string }> = {
  acid: { name: t('酸蚀'), desc: t('病毒体死亡时留下一小滩腐蚀液（2 秒）') },
  fastShots: { name: t('疾弹'), desc: t('敌方子弹速度 +15%') },
  swarm: { name: t('群聚'), desc: t('成群出现的敌人每群 +2 只') },
  doubleAffix: { name: t('双重词缀'), desc: t('精英多带 1 个词缀') },
  wraith: { name: t('怨灵'), desc: t('被击杀的敌人有 10% 几率以 50% 生命的残影复活一次（不掉东西）') },
  carapace: { name: t('甲壳'), desc: t('20% 的普通敌人带一层护盾（最大生命的 15%）') },
  nightfall: { name: t('夜幕'), desc: t('场地变暗，玩家周围的视野缩小') },
  unstable: { name: t('不稳定'), desc: t('病毒体死亡时小范围爆炸（半径 1.2，不会连锁）') },
  eliteTide: { name: t('精英潮'), desc: t('精英几率上限 +10%') },
  frenzy: { name: t('狂热'), desc: t('所有病毒体生命低于 30% 时速度 +30%') },
  barrage: { name: t('弹幕'), desc: t('射手、狙击手、棱镜塔的弹数 +1') },
  symbiosis: { name: t('共生'), desc: t('修复节点、统御者、巢心出现的几率翻倍') },
};

export const ABYSS = {
  mutationsFrom: 65,
  every: 5,
  maxMutations: 6,
  rewardPer: 0.05,
};

// The run's active mutations, set by Game when a run starts or resumes.
export const abyss = { mutations: [] as MutationId[] };
const has = (m: MutationId) => abyss.mutations.includes(m);

export const mutationDue = (n: number) => n >= ABYSS.mutationsFrom && n % ABYSS.every === 0;

// Two different mutations to choose from (re-picking an active one is allowed only if nothing else is left).
export function offerMutations(): MutationId[] {
  const all = Object.keys(MUTATIONS) as MutationId[];
  const fresh = all.filter(m => !has(m));
  const pool = fresh.length >= 2 ? fresh : all;
  const a = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
  const b = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
  return [a, b];
}

export function addMutation(m: MutationId): void {
  abyss.mutations = abyss.mutations.filter(x => x !== m);
  abyss.mutations.push(m);
  while (abyss.mutations.length > ABYSS.maxMutations) abyss.mutations.shift();
}

// --- what each mutation does, asked for by the code it affects ---

export const extraAffixes = () => (has('doubleAffix') ? 1 : 0);
export const extraShots = () => (has('barrage') ? 1 : 0);
export const enemyShotSpeedMul = () => (has('fastShots') ? 1.15 : 1);
export const packBonus = () => (has('swarm') ? 2 : 0);
export const eliteCapPlus = () => (has('eliteTide') ? 0.1 : 0);
export const ambientDarkness = () => (has('nightfall') ? 0.3 : 0);
export const rewardMul = () => 1 + abyss.mutations.length * ABYSS.rewardPer;
export const frenzyMul = (e: Enemy) => (has('frenzy') && !e.def.boss && e.hp < e.maxHp * 0.3 ? 1.3 : 1);
export const spawnWeightMul = (k: EnemyKind) => (has('symbiosis') && (k === 'mender' || k === 'commander' || k === 'hiveCore') ? 2 : 1);

const ghosts = new WeakSet<Enemy>();
export const isGhost = (e: Enemy) => ghosts.has(e);

// Carapace: a fifth of ordinary enemies spawn with a shield layer.
export function applySpawnMutations(e: Enemy, g: Game): void {
  if (!has('carapace') || e.elite || Math.random() >= 0.2 || e.shieldMax > 0) return;
  e.shieldMax = e.shield = e.maxHp * 0.15;
  void g;
}

export function abyssOnDeath(e: Enemy, g: Game): void {
  if (e.def.boss || e.def.part || e.def.inert) return;
  if (has('acid')) g.ground.addPuddle(e.pos.x, e.pos.z, 0.8, 2);
  if (has('unstable')) g.ground.bomb(e.pos.x, e.pos.z, 1.2, 0.25, 10, 0xff8040);
  if (has('wraith') && !e.noLoot && !ghosts.has(e) && Math.random() < 0.1) {
    g.enemies.spawn(e.kind, e.pos.x, e.pos.z, false, { hp: e.maxHp * 0.5, noLoot: true, plain: true, solo: true });
    const ghost = g.enemies.list[g.enemies.list.length - 1];
    ghosts.add(ghost);
    g.floaters.say({ x: e.pos.x, y: 2, z: e.pos.z }, t('怨灵'));
  }
}

// Pause screen: the active mutations.
export function abyssLines(): { label: string; value: string }[] {
  if (!abyss.mutations.length) return [];
  return [{ label: t('深渊异变'), value: abyss.mutations.map(m => MUTATIONS[m].name).join(' · ') }];
}

// ---------------------------------------------------------------------------------------------
// Abyss laws (sector 150+): one rule per 5-sector stretch, then the next one (they don't stack).

export type LawId = 'lowGravity' | 'iceField' | 'night' | 'collapse' | 'mirrorWalls' | 'timeLapse'
  | 'riftGates' | 'gravityTide' | 'bloodMoon' | 'surge' | 'static' | 'mirrorImage';

export const LAWS: Record<LawId, { name: string; desc: string }> = {
  lowGravity: { name: t('低重力'), desc: t('双方的子弹都会慢慢下坠，射程变短') },
  iceField: { name: t('冰原'), desc: t('整个场地都是冰面，所有人都会打滑') },
  night: { name: t('永夜'), desc: t('全场黑暗，只有玩家周围亮着') },
  collapse: { name: t('坍缩'), desc: t('每 20 秒，场地边缘塌陷一圈，10 秒后恢复') },
  mirrorWalls: { name: t('镜墙'), desc: t('所有墙壁都会反弹双方的子弹一次') },
  timeLapse: { name: t('时滞'), desc: t('每 10 秒全场慢动作 2 秒（敌人和子弹慢，玩家正常）') },
  riftGates: { name: t('裂隙门'), desc: t('场上有 2 对固定的传送门，所有子弹都能穿过') },
  gravityTide: { name: t('引力潮'), desc: t('场地中央有一个缓慢的引力井，把所有东西往中间吸') },
  bloodMoon: { name: t('血月'), desc: t('敌人伤害 +30%，击杀回复 2 生命') },
  surge: { name: t('狂潮'), desc: t('敌人数量 +50%，生命 -30%') },
  static: { name: t('静电'), desc: t('地上随机出现电场，站在上面的敌人和玩家都会被电') },
  mirrorImage: { name: t('镜像'), desc: t('每个敌人死后，在对称的位置出现一个它的残影（30% 生命）') },
};

export const LAW_FROM = 150;
export const lawState = { law: null as LawId | null, t: 0, fields: [] as { x: number; z: number; t: number; tick: number }[] };
const law = (l: LawId) => lawState.law === l;

// Entering sector n: a new law at the start of each 5-sector stretch (never the same twice in a row).
export function lawFor(n: number, rand: () => number): LawId | null {
  if (n < LAW_FROM) return null;
  if (n % 5 !== 0 && lawState.law) return lawState.law;
  const ids = (Object.keys(LAWS) as LawId[]).filter(l => l !== lawState.law);
  return ids[Math.floor(rand() * ids.length)];
}

export const lawRangeMul = () => (law('lowGravity') ? 0.6 : 1);
export const lawBounce = () => (law('mirrorWalls') ? 1 : 0);
export const lawDmgMul = () => (law('bloodMoon') ? 1.3 : 1);
export const lawBudgetMul = () => (law('surge') ? 1.5 : 1);
export const lawHpMul = () => (law('surge') ? 0.7 : 1);
export const lawDark = () => (law('night') ? 0.7 : 0);

// Enemy time runs slow for 2 s out of every 10 under the time-lapse law.
export function enemyTimeScale(): number {
  return law('timeLapse') && lawState.t % 10 > 8 ? 0.35 : 1;
}

export function lawOnKill(e: Enemy, g: Game): void {
  if (law('bloodMoon')) g.player.hp = Math.min(g.player.maxHp, g.player.hp + 2);
  if (law('mirrorImage') && !e.noLoot && !e.def.boss && !e.def.part && !e.def.inert && !ghosts.has(e)) {
    const x = -e.pos.x, z = -e.pos.z;
    if (g.room.blocked(x, z, e.r)) return;
    g.enemies.spawn(e.kind, x, z, false, { hp: e.maxHp * 0.3, noLoot: true, plain: true, solo: true });
    ghosts.add(g.enemies.list[g.enemies.list.length - 1]);
  }
}

// Sector start under a law: gates go up.
export function lawSetup(g: Game): void {
  lawState.fields = [];
  if (law('riftGates')) {
    const hw = g.room.hw * 0.55, hh = g.room.hh * 0.55;
    g.portals.open(-hw, 0, hw, 0, Infinity);
    g.portals.open(0, -hh, 0, hh, Infinity);
  }
}

export function lawTick(g: Game, dt: number): void {
  lawState.t += dt;
  g.slippery = law('iceField');
  const p = g.player;
  if (law('gravityTide')) {
    const pull = (pos: { x: number; z: number }, k: number) => {
      const d = Math.hypot(pos.x, pos.z) || 1;
      pos.x -= pos.x / d * k * dt;
      pos.z -= pos.z / d * k * dt;
    };
    pull(p.pos, 1.6);
    for (const e of g.enemies.list) if (!e.def.boss && !e.def.anchored) pull(e.pos, 1.2);
  }
  if (law('collapse')) {
    // 10 s of every 20: the outer band of the floor gives way
    const on = lawState.t % 20 > 10;
    if (on && (Math.abs(p.pos.x) > g.room.hw * 0.7 || Math.abs(p.pos.z) > g.room.hh * 0.7)) g.drainPlayer(12 * dt);
    if (on && Math.random() < dt * 30) {
      const side = Math.random() < 0.5, s = Math.random() < 0.5 ? -1 : 1;
      const x = side ? s * g.room.hw * (0.72 + Math.random() * 0.25) : (Math.random() * 2 - 1) * g.room.hw;
      const z = side ? (Math.random() * 2 - 1) * g.room.hh : s * g.room.hh * (0.72 + Math.random() * 0.25);
      g.fx.mote({ x, y: 0.2, z }, 0xff3355, 0.3, 0.6);
    }
  }
  if (law('static')) {
    if (Math.random() < dt / 4) {
      const [x, z] = g.room.findSpawn(p.pos, 0, 1);
      lawState.fields.push({ x, z, t: 3, tick: 0 });
      g.ground.warn(x, z, 2, 3, 0x88ccff);
    }
    for (let i = lawState.fields.length - 1; i >= 0; i--) {
      const f = lawState.fields[i];
      f.t -= dt;
      f.tick -= dt;
      if (f.t <= 0) { lawState.fields.splice(i, 1); continue; }
      if (f.tick > 0) continue;
      f.tick = 0.5;
      if (Math.hypot(p.pos.x - f.x, p.pos.z - f.z) < 2 + p.r) g.damagePlayer(8, null);
      for (const e of [...g.enemies.list]) if (!e.def.boss && Math.hypot(e.pos.x - f.x, e.pos.z - f.z) < 2) g.enemies.damage(e, e.maxHp * 0.05, { dot: true });
    }
  }
}

export function lawLines(): { label: string; value: string }[] {
  return lawState.law ? [{ label: t('深渊法则'), value: LAWS[lawState.law].name }] : [];
}
