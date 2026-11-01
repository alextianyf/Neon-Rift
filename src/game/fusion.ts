import { LANG, t } from '../core/i18n';
import { ENEMY_NOTES } from '../data/codex';
import { ENEMIES, SPAWN_TABLE, type AttackPart, type DeathPart, type EnemyDef, type EnemyKind, type EnemyParts, type MovePart, type SpecialPart } from '../data/enemies';
import { BEHAVIORS } from './enemyAI';
import { composeBehavior } from './enemyParts';

// Fusions (docs/敌人.md, sector 150+): every 5 sectors two new enemies are put together from the
// parts of two existing ones (movement, attack, special, death effect), each parent giving at least
// one. The id spells out the recipe ("fusion:burrower+bomber:burrow/erupt/-/acidPool"), so a
// fusion seen in any run can be rebuilt for the codex.

const MOVE_OK = new Set<MovePart>(['chase', 'deploy', 'burrow', 'stalk', 'skulk', 'kite', 'weave', 'swoop', 'forage', 'artillery', 'portalWalk']);
const ATTACK_OK = new Set<AttackPart>(['contact', 'spinStream', 'erupt', 'slash', 'mend', 'missiles', 'quake', 'devour', 'raiseWall', 'lob', 'ringBurst', 'rally', 'glaive', 'single', 'stomp']);
// attacks that only work with the movement they were built for
const NEEDS_MOVE: Partial<Record<AttackPart, MovePart>> = { spinStream: 'deploy', erupt: 'burrow', slash: 'stalk', devour: 'forage' };
const MOVE_NEEDS: Partial<Record<MovePart, AttackPart>> = { forage: 'devour' };

// Threat of each part; a fusion's total is capped so nothing ends up with every nasty trick at once.
const THREAT: Record<string, number> = {
  chase: 1, deploy: 2, burrow: 3, stalk: 3, skulk: 1, kite: 1, weave: 1, swoop: 3, forage: 2, artillery: 2, portalWalk: 2,
  contact: 0, spinStream: 3, erupt: 3, slash: 3, mend: 2, missiles: 3, quake: 3, devour: 2, raiseWall: 2, lob: 3, ringBurst: 3, rally: 2, glaive: 2, single: 1, stomp: 3,
  acidTrail: 1, replicate: 3, mirror: 2, rewind: 2, iceSheet: 2, darkAura: 2, hive: 3, armor: 3,
  acidPool: 1, lightBurst: 0, parasites: 2,
};
const THREAT_CAP = 9;

// Short phrases for the first-sighting hint ("drill-burrow · erupts").
const PART_TEXT: Record<string, string> = {
  chase: t('直冲'), deploy: t('架设炮台'), burrow: t('钻地追踪'), stalk: t('瞬移到身后'), skulk: t('躲在后排'), kite: t('保持距离'),
  weave: t('蛇形冲锋'), swoop: t('飞行俯冲'), forage: t('觅食'), artillery: t('远处吊射'), portalWalk: t('穿越传送门'),
  contact: t('接触伤害'), spinStream: t('旋转弹流'), erupt: t('破土爆发'), slash: t('挥砍'), mend: t('修复同伴'), missiles: t('追踪导弹'),
  quake: t('冲击波'), devour: t('吞噬同伴'), raiseWall: t('筑墙'), lob: t('迫击炮'), ringBurst: t('护环弹幕'), rally: t('冲锋号'),
  glaive: t('回旋刃'), single: t('单发射击'), stomp: t('冲撞跺地'),
  acidTrail: t('腐蚀液'), replicate: t('复制'), mirror: t('镜面反弹'), rewind: t('回溯'), iceSheet: t('冰面'), darkAura: t('黑暗光环'),
  hive: t('工蜂护卫'), armor: t('四面装甲'), acidPool: t('死后腐蚀液'), lightBurst: t('死后强光'), parasites: t('死后寄生虫'),
};

export interface FusionSpec { id: EnemyKind; from: number }

const fusionIds: EnemyKind[] = [];

const partsOf = (k: EnemyKind) => ENEMIES[k].parts;
const CANDIDATES = () => (Object.keys(ENEMIES) as EnemyKind[]).filter(k => {
  const d = ENEMIES[k], p = d.parts;
  return p && !d.boss && !d.part && !d.inert && !d.bound && !k.startsWith('fusion:') && k !== 'worker' && (MOVE_OK.has(p.move) || ATTACK_OK.has(p.attack) || p.special || p.death);
});

function mixColor(a: number, b: number): number {
  const ch = (s: number) => Math.round((((a >> s) & 255) + ((b >> s) & 255)) / 2) << s;
  return ch(16) | ch(8) | ch(0);
}

// "钻地者" + "自爆虫" -> "钻爆虫"; "Burrower" + "Bomber" -> "Burrber".
function fuseName(a: string, b: string): string {
  if (LANG === 'en') {
    const wa = a.split(' ').pop()!, wb = b.split(' ').pop()!;
    return wa.slice(0, Math.ceil(wa.length / 2)) + wb.slice(Math.floor(wb.length / 2)).toLowerCase();
  }
  return [...a][0] + [...b].slice(1).join('');
}

function encode(a: string, b: string, p: EnemyParts): EnemyKind {
  const recipe: string[] = [p.move, p.attack, p.special ?? '-', p.death ?? '-'];
  return ('fusion:' + a + '+' + b + ':' + recipe.join('/')) as EnemyKind;
}

// Register a fusion from its id (no-op if it's already known). Returns false for a malformed id.
export function ensureFusion(id: string): boolean {
  if (id in ENEMIES) return true;
  const m = /^fusion:(\w+)\+(\w+):(\w+)\/(\w+)\/(\w+|-)\/(\w+|-)$/.exec(id);
  if (!m) return false;
  const [, a, b, move, attack, special, death] = m as unknown as [string, EnemyKind, EnemyKind, MovePart, AttackPart, string, string];
  const A = ENEMIES[a], B = ENEMIES[b];
  if (!A || !B) return false;
  const parts: EnemyParts = { move, attack, special: special === '-' ? undefined : special as SpecialPart, death: death === '-' ? undefined : death as DeathPart };
  const threat = [move, attack, parts.special, parts.death].reduce((s, k) => s + (k ? THREAT[k] ?? 1 : 0), 0);
  const def: EnemyDef = {
    name: fuseName(A.name, B.name),
    hp: Math.round((A.hp + B.hp) / 2 * (1 + threat * 0.05)),
    speed: (A.speed + B.speed) / 2,
    r: Math.max(A.r, B.r) * 0.95,
    y: A.y,
    color: mixColor(A.color, B.color),
    dmg: Math.max(A.dmg, B.dmg),
    score: Math.round((A.score + B.score) * 0.75),
    cost: Math.round((A.cost + B.cost) / 2 * 1.2 * 10) / 10,
    mass: Math.min(A.mass, B.mass),
    ccResist: Math.max(A.ccResist, B.ccResist),
    dropChance: 0.15,
    dropCount: 1,
    coins: [Math.round((A.coins[0] + B.coins[0]) * 0.6), Math.round((A.coins[1] + B.coins[1]) * 0.6)],
    parts,
    anchored: move === 'deploy',
    spins: parts.special === 'armor' || parts.special === 'mirror',
    mirrored: parts.special === 'mirror',
    noFreeze: A.noFreeze || B.noFreeze,
  };
  (ENEMIES as Record<string, EnemyDef>)[id] = def;
  (BEHAVIORS as Record<string, unknown>)[id] = composeBehavior(parts);
  (ENEMY_NOTES as Record<string, string>)[id] = t('融合体：{a} × {b}。{p}', { a: A.name, b: B.name, p: describe(parts) });
  return true;
}

export function describe(p: EnemyParts): string {
  return [p.move, p.attack, p.special, p.death].filter(Boolean).map(k => PART_TEXT[k!] ?? k).join(' · ');
}

export const fusionParents = (id: string): [EnemyKind, EnemyKind] | null => {
  const m = /^fusion:(\w+)\+(\w+):/.exec(id);
  return m ? [m[1] as EnemyKind, m[2] as EnemyKind] : null;
};

// Make one new fusion. Returns its id, or null if nothing valid turned up.
function generate(rand: () => number, taken: Set<string>): EnemyKind | null {
  const pool = CANDIDATES();
  for (let tries = 0; tries < 60; tries++) {
    const a = pool[Math.floor(rand() * pool.length)], b = pool[Math.floor(rand() * pool.length)];
    if (a === b) continue;
    const pa = partsOf(a)!, pb = partsOf(b)!;
    const pick = <T>(x: T | undefined, y: T | undefined): [T | undefined, 'a' | 'b' | null] => {
      const opts: [T | undefined, 'a' | 'b' | null][] = [];
      if (x !== undefined) opts.push([x, 'a']);
      if (y !== undefined) opts.push([y, 'b']);
      if (!opts.length) return [undefined, null];
      return opts[Math.floor(rand() * opts.length)];
    };
    const moves = [pa.move, pb.move].filter(m => MOVE_OK.has(m));
    if (!moves.length) continue;
    const move = moves[Math.floor(rand() * moves.length)];
    const moveFrom = move === pa.move ? 'a' : 'b';
    const usable = [pa.attack, pb.attack].filter(at => ATTACK_OK.has(at) && (!NEEDS_MOVE[at] || NEEDS_MOVE[at] === move) && (!MOVE_NEEDS[move] || MOVE_NEEDS[move] === at));
    // a real attack beats plain contact damage when either parent has one
    const attacks = usable.some(at => at !== 'contact') ? usable.filter(at => at !== 'contact') : usable;
    const attack = attacks.length ? attacks[Math.floor(rand() * attacks.length)] : MOVE_NEEDS[move] ?? 'contact';
    const attackFrom = attack === pa.attack ? 'a' : attack === pb.attack ? 'b' : null;
    const [special, specialFrom] = pick(pa.special, pb.special);
    const [death, deathFrom] = pick(pa.death, pb.death);
    const from = [moveFrom, attack !== 'contact' ? attackFrom : null, specialFrom, deathFrom];
    if (!from.includes('a') || !from.includes('b')) continue;  // both parents must show
    const parts: EnemyParts = { move, attack, special, death };
    const threat = [move, attack, special, death].reduce((s, k) => s + (k ? THREAT[k] ?? 1 : 0), 0);
    if (threat > THREAT_CAP) { if (special) parts.special = undefined; else continue; }
    const id = encode(a, b, parts);
    if (taken.has(id) || !ensureFusion(id)) continue;
    return id;
  }
  return null;
}

// Entering sector n: from 150, every 5th sector brings two new fusions into the spawn pool.
export function fusionsFor(n: number, rand: () => number): EnemyKind[] {
  if (n < 150 || n % 5 !== 0 || fusionIds.some(id => SPAWN_TABLE.find(s => s.kind === id)?.from === n)) return [];
  const made: EnemyKind[] = [];
  for (let i = 0; i < 2; i++) {
    const id = generate(rand, new Set(fusionIds));
    if (!id) continue;
    addFusion({ id, from: n });
    made.push(id);
  }
  return made;
}

export function addFusion(s: FusionSpec): void {
  if (!ensureFusion(s.id) || fusionIds.includes(s.id)) return;
  fusionIds.push(s.id);
  SPAWN_TABLE.push({ kind: s.id, from: s.from, weight: 5 });
}

// New run: forget the previous run's fusions (their definitions stay registered for the codex).
export function resetFusions(specs: FusionSpec[] = []): void {
  for (let i = SPAWN_TABLE.length - 1; i >= 0; i--) if (SPAWN_TABLE[i].kind.startsWith('fusion:')) SPAWN_TABLE.splice(i, 1);
  fusionIds.length = 0;
  for (const s of specs) addFusion(s);
}

// First time a fusion shows up in a run: say what it's made of.
const announced = new Set<string>();
export function announceFusion(kind: EnemyKind, g: { hud: { toast(s: string): void } }): void {
  if (announced.has(kind)) return;
  announced.add(kind);
  const d = ENEMIES[kind];
  if (d.parts) g.hud.toast(`${d.name}：${describe(d.parts)}`);
}

export const currentFusions = (): FusionSpec[] => fusionIds.map(id => ({ id, from: SPAWN_TABLE.find(s => s.kind === id)?.from ?? 150 }));
