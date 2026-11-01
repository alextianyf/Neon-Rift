import { t } from '../core/i18n';
import { LANG } from '../core/i18n';
import type { EnemyKind } from '../data/enemies';
import { SIGNATURE } from './bossesEndless';
import type { Enemy } from './enemies';
import type { Game } from './game';

// Mutated boss forms (docs/敌人.md, sector 60+): every boss except the Rift Origin comes with one
// extra effect (two from sector 100).

export type BossFormId = 'clone' | 'guards' | 'hasty' | 'aftermath' | 'riftShield';

export const BOSS_FORMS: Record<BossFormId, { name: string; desc: string }> = {
  clone: { name: t('分身'), desc: t('多一个分身，生命 25%，招式相同但频率减半') },
  guards: { name: t('护卫'), desc: t('出场和半血时各召唤 2 个精英护卫') },
  hasty: { name: t('急躁'), desc: t('所有招式冷却 -25%') },
  aftermath: { name: t('余波'), desc: t('每个招式结束后在原地留下 3 秒的危险区') },
  riftShield: { name: t('裂隙护盾'), desc: t('半血时出现护盾，打掉场上 3 颗裂隙水晶才会消失') },
};

export const FORMS_FROM = 60;
export const TWO_FORMS_FROM = 100;
const NO_FORMS = new Set<EnemyKind>(['origin']);

interface FormState { forms: BossFormId[]; lastCd: number; halfDone: boolean; clone: boolean }
const STATE = new WeakMap<Enemy, FormState>();
let cloning = false;

// Called once when a boss spawns.
export function rollBossForms(e: Enemy, g: Game): void {
  const n = g.room.n;
  if (cloning || n < FORMS_FROM || NO_FORMS.has(e.kind) || STATE.has(e)) return;
  const all = Object.keys(BOSS_FORMS) as BossFormId[];
  const forms: BossFormId[] = [];
  for (let i = 0; i < (n >= TWO_FORMS_FROM ? 2 : 1); i++) forms.push(all.splice(Math.floor(Math.random() * all.length), 1)[0]);
  STATE.set(e, { forms, lastCd: e.cd, halfDone: false, clone: false });
  g.hud.toast(t('异变形态：{f}', { f: forms.map(f => BOSS_FORMS[f].name).join(' · ') }));
  if (forms.includes('clone')) {
    cloning = true;  // the clone doesn't get forms (or clones) of its own
    g.enemies.spawn(e.kind, e.pos.x + 4, e.pos.z, false, { hp: e.maxHp * 0.25 });
    cloning = false;
    const c = g.enemies.list[g.enemies.list.length - 1];
    STATE.set(c, { forms: [], lastCd: 0, halfDone: true, clone: true });
  }
  if (forms.includes('guards')) callGuards(e, g);
}

function callGuards(e: Enemy, g: Game): void {
  for (let i = 0; i < 2; i++) {
    const [x, z] = g.room.findSpawn(g.player.pos, 6, 0.8);
    g.enemies.addMarker(Math.random() < 0.5 ? 'brute' : 'shield', x, z, 0.9, 1, true);
  }
  void e;
}

// Fusion boss: the grafted boss's signature move, every few seconds.
const FUSED = new WeakMap<Enemy, { from: EnemyKind; t: number }>();
export function fuseBoss(e: Enemy, g: Game): void {
  const plan = g.room.bossPlan;
  if (!plan?.fuse || plan.kinds[0] !== e.kind || FUSED.has(e)) return;
  FUSED.set(e, { from: plan.fuse, t: 3 });
}

export function fusedName(a: string, b: string): string {
  return LANG === 'en' ? `${a.split(' ')[0]}-${b.split(' ').pop()}` : [...b].slice(0, 2).join('') + [...a].slice(-2).join('');
}

export function bossFormsTick(e: Enemy, g: Game, dt: number): void {
  const fz = FUSED.get(e);
  if (fz) {
    fz.t -= dt;
    if (fz.t <= 0 && !g.lasers.busy(e)) { fz.t = 4.5; SIGNATURE[fz.from]?.(e, g); }
  }
  const s = STATE.get(e);
  if (!s || s.clone) return;
  // aftermath: whenever the boss starts a new attack (its cooldown resets), the spot it stood on turns hazardous
  if (s.forms.includes('aftermath') && e.cd > s.lastCd + 0.5) g.ground.addPuddle(e.pos.x, e.pos.z, 2, 3);
  s.lastCd = e.cd;
  if (!s.halfDone && e.hp < e.maxHp * 0.5) {
    s.halfDone = true;
    if (s.forms.includes('guards')) callGuards(e, g);
    if (s.forms.includes('riftShield')) {
      for (let i = 0; i < 3; i++) {
        const [x, z] = g.room.findSpawn(e.pos, 5, 0.8);
        g.enemies.spawn('riftCrystal', x, z, false, { hp: e.maxHp * 0.03, owner: e, noLoot: true, plain: true });
      }
      g.hud.toast(t('裂隙护盾：打掉 3 颗裂隙水晶'));
    }
  }
}

// Cooldown speed: hasty bosses attack more often, clones half as often.
export function bossHaste(e: Enemy): number {
  const s = STATE.get(e);
  if (!s) return 1;
  if (s.clone) return 0.5;
  return s.forms.includes('hasty') ? 1 / 0.75 : 1;
}

// A rift-shielded boss takes nothing while any of its crystals stands.
export function formShielded(e: Enemy, g: Game): boolean {
  const s = STATE.get(e);
  if (!s?.forms.includes('riftShield') || !s.halfDone) return false;
  return g.enemies.list.some(c => c.kind === 'riftCrystal' && c.owner === e && c.hp > 0);
}
