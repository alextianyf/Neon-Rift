import type { Game } from './game';
import { t } from '../core/i18n';
import type { EnemyKind } from '../data/enemies';

// First-time contextual hints. Each one shows once per profile, when its situation first comes up.
interface HintDef {
  id: string;
  text: string;
  pad?: string;                    // gamepad wording, when it differs
  touch?: string;                  // touch-screen wording
  when: (g: Game) => boolean;
}

// One hint per enemy kind, shown the first time one is on the field.
function tipsFor(tips: Partial<Record<EnemyKind, string>>): HintDef[] {
  return (Object.keys(tips) as EnemyKind[]).map(k => ({
    id: k, text: tips[k]!, when: (g: Game) => g.enemies.list.some(e => e.kind === k && e.spawnT <= 0),
  }));
}

const HINTS: HintDef[] = [
  {
    id: 'move', when: g => g.room.n === 1 && g.room.time > 0.6,
    text: t('<kbd>WASD</kbd> 移动 · <kbd>鼠标</kbd> 瞄准 · <kbd>左键</kbd> 射击'),
    pad: t('<kbd>左摇杆</kbd> 移动 · <kbd>右摇杆</kbd> 瞄准 · <kbd>RT</kbd> 射击'),
    touch: t('左半屏拖动移动 · 右半屏拖动瞄准并自动射击'),
  },
  {
    id: 'dash', when: g => g.room.n === 1 && g.room.time > 8,
    text: t('<kbd>空格</kbd> / <kbd>右键</kbd> 推进冲刺：冲刺途中无敌，可以穿过子弹'),
    pad: t('<kbd>A</kbd> / <kbd>LT</kbd> 推进冲刺：冲刺途中无敌，可以穿过子弹'),
    touch: t('点右侧 <kbd>冲刺</kbd> 按钮：冲刺途中无敌，可以穿过子弹'),
  },
  {
    id: 'skill', when: g => g.room.time > 15 && g.player.skillReady >= 1 && g.enemies.list.length > 0,
    text: t('<kbd>F</kbd> 释放机体技能，冷却显示在屏幕下方'),
    pad: t('<kbd>Y</kbd> 释放机体技能，冷却显示在屏幕下方'),
    touch: t('点右侧 <kbd>技能</kbd> 按钮释放机体技能'),
  },
  {
    id: 'reload', when: g => g.player.reloadT > 0,
    text: t('弹匣打空会自动装弹，也可以随时按 <kbd>R</kbd> 装弹 · 初始武器弹药无限，拾取的武器备弹有限'),
    pad: t('弹匣打空会自动装弹，也可以随时按 <kbd>B</kbd> 装弹 · 初始武器弹药无限，拾取的武器备弹有限'),
    touch: t('弹匣打空会自动装弹，也可以点 <kbd>换弹</kbd> · 初始武器弹药无限，拾取的武器备弹有限'),
  },
  {
    id: 'weapon', when: g => g.interactables.hasFreeWeapon,
    text: t('走近武装按 <kbd>E</kbd> 拾取 · 最多带 3 把，<kbd>1 2 3</kbd> / <kbd>Q</kbd> 切换 · 拾取同一把会升级并补满弹药'),
    pad: t('走近武装按 <kbd>X</kbd> 拾取 · 最多带 3 把，<kbd>LB</kbd> / <kbd>RB</kbd> 切换 · 拾取同一把会升级并补满弹药'),
    touch: t('走近武装点 <kbd>拾取</kbd> · 最多带 3 把，点 <kbd>换枪</kbd> 切换 · 拾取同一把会升级并补满弹药'),
  },
  {
    id: 'portal', when: g => g.room.portals.length > 1,
    text: t('两个传送门通往不同类型的扇区，看清标签再走 · 第 15 扇区的首领就是终点'),
  },
  {
    id: 'shop', when: g => g.room.kind === 'shop',
    text: t('敌人掉落的金色碎片可以在这里购买武装、模块和维修'),
  },
  {
    id: 'challenge', when: g => g.room.kind === 'challenge',
    text: t('挑战扇区：敌人源源不断，坚持到倒计时结束就算完成'),
  },
  {
    id: 'elite', when: g => g.enemies.list.some(e => e.elite),
    text: t('带金色光环的是精英：更硬、更痛，但分数和碎片翻好几倍'),
  },
  {
    id: 'hazard', when: g => g.hazards.active && g.room.time > 1,
    text: t('地形机关：泥沼减速、腐化池持续掉血、能量罐一打就炸、电网周期通电 · 敌人同样受影响'),
  },
  {
    id: 'rift', when: g => g.hazards.openRifts > 0,
    text: t('不稳定裂缝会不断涌出蜂群体，必须打掉它才能净化扇区'),
  },
  {
    id: 'shield', when: g => g.enemies.list.some(e => e.kind === 'shield'),
    text: t('护盾兵正面挡子弹：绕到背后打，或者用爆炸和磁轨炮'),
  },
  {
    id: 'sniper', when: g => g.enemies.list.some(e => e.kind === 'sniper'),
    text: t('狙击手瞄准时会拉出红线，红线锁定后立刻横移躲开'),
  },
  {
    id: 'corroder', when: g => g.enemies.list.some(e => e.kind === 'corroder'),
    text: t('腐蚀者走过的地方会留下腐蚀液：别踩上去 · 烈焰喷射器能烧掉它'),
  },
  {
    id: 'tower', when: g => g.enemies.list.some(e => e.kind === 'tower' && e.state === 'planted'),
    text: t('棱镜塔展开后会旋转扫射：躲到障碍物后面挡住视线，或者从弹流的空隙钻过去'),
  },
  {
    id: 'burrower', when: g => g.enemies.list.some(e => e.kind === 'burrower' && e.state === 'rise'),
    text: t('地上的红圈是钻地者要破土的位置，马上走开'),
  },
  {
    id: 'replicator', when: g => g.enemies.list.some(e => e.kind === 'replicator'),
    text: t('复制者每 6 秒复制一次，趁它鼓起来之前打死'),
  },
  {
    id: 'linker', when: g => g.enemies.list.some(e => e.kind === 'linker' && e.lead && e.beam?.visible),
    text: t('链接体之间的激光碰到就会受伤：别被夹在中间，冲刺可以穿过去'),
  },
  {
    id: 'assassin', when: g => g.enemies.list.some(e => e.kind === 'assassin' && e.state === 'phase'),
    text: t('地上的紫色波纹是相位刺客要出现的位置，它会从你身后挥砍：马上冲刺'),
  },
  {
    id: 'mender', when: g => g.enemies.list.some(e => e.kind === 'mender' && e.beam?.visible),
    text: t('修复节点在给同伴回血和减伤：先越过前排打掉它'),
  },
  {
    id: 'mirror', when: g => g.enemies.list.some(e => e.kind === 'mirror'),
    text: t('镜面体发光的那一面会反弹子弹：从没发光的那一面打'),
  },
  {
    // mimics are announced before the first one could fool you
    id: 'mimic', when: g => g.room.n >= 41,
    text: t('从这里开始，有些回复球是假的：伪装体会时不时抖一下，光也偏红 · 可疑的先开一枪'),
  },
  ...tipsFor({
    rewinder: t('回溯体被打到 30% 以下会倒回残影的位置和血量：一口气打死它'),
    missileNest: t('导弹巢的导弹一打就碎，顺手把它们打下来'),
    condenser: t('冰面上会打滑：提前松开方向，或者用烈焰融化冰面'),
    quaker: t('震荡者跺地的冲击波可以用冲刺穿过去'),
    lightEater: t('吞光者周围是黑暗：先打掉它，视野就回来了'),
    diver: t('地上的影子是俯冲者要砸下来的位置：影子停住就走开，它落地后会卡住一会儿'),
    hiveCore: t('巢心活着时工蜂不会受伤：越过工蜂先打巢心'),
    devourer: t('吞噬者会吃掉同伴变强：击退、眩晕、冰冻能打断它'),
    wallBuilder: t('筑墙者的墙挡住双方的子弹：绕过去，或者把墙打掉'),
    mortar: t('迫击体躲在远处吊射：看落点圈，冲过去打它'),
    thief: t('窃能者偷了东西就跑：8 秒内追上打死，双倍还给你'),
    parasite: t('寄生虫吸在身上会减速、吸血：冲刺把它们甩掉'),
    ringStar: t('星环体的光环挡子弹：等光环炸开再打'),
    commander: t('统御者的旗帜发光后会吹冲锋号：优先打掉它，或者眩晕打断'),
    boomerang: t('回旋体的飞刃会沿地上画的路线飞回来：别站在线上'),
    riftWalker: t('传送门两头相通，子弹也能穿过去：注意另一头'),
    juggernaut: t('装甲巨兽从同一面集中打，打碎装甲以后伤害更高'),
  }),
  {
    id: 'affix', when: g => g.enemies.list.some(e => e.affixes.length > 0),
    text: t('精英头上的字是它的词缀，比如迅捷、护盾、爆裂 · 词缀说明可以在图鉴里查看'),
  },
  {
    id: 'boss', when: g => !!g.enemies.boss,
    text: t('首领战：留意攻击前的预警，冲刺的无敌帧是你最好的朋友'),
  },
  {
    id: 'lowhp', when: g => g.player.hp < g.player.maxHp * 0.35,
    text: t('生命偏低：击杀敌人有机会掉落绿色回复球，黑市也能维修'),
  },
];

const SHOW_TIME = 7;
const GAP = 1.5;

export class Tutorial {
  enabled = true;
  private t = 0;          // time left on the current hint
  private gap = 0;

  constructor(private readonly g: Game, private readonly seen: string[], private readonly save: () => void) {}

  update(dt: number): void {
    const g = this.g;
    if (this.t > 0) {
      this.t -= dt;
      if (this.t <= 0) { g.hud.hint(null); this.gap = GAP; }
      return;
    }
    if (!this.enabled || (this.gap -= dt) > 0) return;
    const h = HINTS.find(d => !this.seen.includes(d.id) && d.when(g));
    if (!h) return;
    this.seen.push(h.id);
    this.save();
    g.hud.hint(g.input.usingTouch && h.touch ? h.touch : g.input.usingPad && h.pad ? h.pad : h.text);
    this.t = SHOW_TIME;
  }

  // Hide whatever is showing (between runs / sectors keep the queue).
  hide(): void {
    this.t = 0;
    this.g.hud.hint(null);
  }

  // Turning hints back on replays them from the start.
  reset(): void {
    this.seen.length = 0;
    this.save();
  }
}
