import type { Game } from './game';

// First-time contextual hints. Each one shows once per profile, when its situation first comes up.
interface HintDef {
  id: string;
  text: string;
  pad?: string;                    // gamepad wording, when it differs
  when: (g: Game) => boolean;
}

const HINTS: HintDef[] = [
  {
    id: 'move', when: g => g.room.n === 1 && g.room.time > 0.6,
    text: '<kbd>WASD</kbd> 移动 · <kbd>鼠标</kbd> 瞄准 · <kbd>左键</kbd> 射击',
    pad: '<kbd>左摇杆</kbd> 移动 · <kbd>右摇杆</kbd> 瞄准 · <kbd>RT</kbd> 射击',
  },
  {
    id: 'dash', when: g => g.room.n === 1 && g.room.time > 8,
    text: '<kbd>空格</kbd> / <kbd>右键</kbd> 推进冲刺：冲刺途中无敌，可以穿过子弹',
    pad: '<kbd>A</kbd> / <kbd>LT</kbd> 推进冲刺：冲刺途中无敌，可以穿过子弹',
  },
  {
    id: 'skill', when: g => g.room.time > 15 && g.player.skillReady >= 1 && g.enemies.list.length > 0,
    text: '<kbd>F</kbd> 释放机体技能，冷却条在左上角',
    pad: '<kbd>Y</kbd> 释放机体技能，冷却条在左上角',
  },
  {
    id: 'weapon', when: g => g.interactables.hasFreeWeapon,
    text: '走近武装按 <kbd>E</kbd> 拾取 · 最多带 3 把，<kbd>1 2 3</kbd> / <kbd>Q</kbd> 切换 · 拾取同一把会升级',
    pad: '走近武装按 <kbd>X</kbd> 拾取 · 最多带 3 把，<kbd>LB</kbd> / <kbd>RB</kbd> 切换 · 拾取同一把会升级',
  },
  {
    id: 'portal', when: g => g.room.portals.length > 1,
    text: '两个传送门通往不同类型的扇区，看清标签再走 · 第 15 扇区的首领就是终点',
  },
  {
    id: 'shop', when: g => g.room.kind === 'shop',
    text: '敌人掉落的金色碎片可以在这里购买武装、模块和维修',
  },
  {
    id: 'challenge', when: g => g.room.kind === 'challenge',
    text: '挑战扇区：敌人源源不断，坚持到倒计时结束就算完成',
  },
  {
    id: 'elite', when: g => g.enemies.list.some(e => e.elite),
    text: '带金色光环的是精英：更硬、更痛，但分数和碎片翻好几倍',
  },
  {
    id: 'hazard', when: g => g.hazards.active && g.room.time > 1,
    text: '地形机关：泥沼减速、腐化池持续掉血、能量罐一打就炸、电网周期通电 · 敌人同样受影响',
  },
  {
    id: 'rift', when: g => g.hazards.openRifts > 0,
    text: '不稳定裂缝会不断涌出蜂群体，必须打掉它才能净化扇区',
  },
  {
    id: 'shield', when: g => g.enemies.list.some(e => e.kind === 'shield'),
    text: '护盾兵正面挡子弹：绕到背后打，或者用爆炸和磁轨炮',
  },
  {
    id: 'sniper', when: g => g.enemies.list.some(e => e.kind === 'sniper'),
    text: '狙击手瞄准时会拉出红线，红线锁定后立刻横移躲开',
  },
  {
    id: 'boss', when: g => !!g.enemies.boss,
    text: '首领战：留意攻击前的预警，冲刺的无敌帧是你最好的朋友',
  },
  {
    id: 'lowhp', when: g => g.player.hp < g.player.maxHp * 0.35,
    text: '生命偏低：击杀敌人有机会掉落绿色回复球，黑市也能维修',
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
    g.hud.hint(g.input.usingPad && h.pad ? h.pad : h.text);
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
