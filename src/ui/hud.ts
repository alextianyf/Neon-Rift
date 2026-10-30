import { clamp } from '../core/math';
import { WEAPONS } from '../data/weapons';
import type { WeaponSlot } from '../game/player';
import { $ } from './dom';
import { weaponIcon } from './icons';
import type { BestRecord } from './storage';

export interface HudStats {
  hp: number;
  maxHp: number;
  shield: number;
  dashReady: number;      // 0..1
  reload: number;         // 0..1 for the active weapon
  room: number;
  roomLabel: string;
  score: number;
  coins: number;
  combo: number;
  comboLeft: number;      // 0..1 of the combo window remaining
  bossHp: number | null;  // 0..1, null when no boss is alive
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

export class Hud {
  private readonly root = $('hud');
  private readonly hpFill = $('hpFill');
  private readonly hpText = $('hpText');
  private readonly shieldPip = $('shieldPip');
  private readonly dashFill = $('dashFill');
  private readonly roomN = $('roomN');
  private readonly roomLabel = $('roomLabel');
  private readonly score = $('score');
  private readonly coins = $('coins');
  private readonly best = $('best');
  private readonly bossBar = $('bossBar');
  private readonly bossName = $('bossName');
  private readonly bossFill = $('bossFill');
  private readonly weapons = $('weapons');
  private readonly buffs = $('buffs');
  private readonly combo = $('combo');
  private readonly comboN = $('comboN');
  private readonly comboFill = $('comboFill');
  private readonly promptEl = $('prompt');
  private readonly toastEl = $('toast');
  private readonly vignette = $('vignette');
  private readonly fadeEl = $('fade');
  private readonly fadeText = $('fadeText');
  private readonly cross = $('cross');
  private toastTimer = 0;
  private hitTimer = 0;
  private reloadFill: HTMLElement | null = null;
  private lastCoins = -1;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(s: HudStats): void {
    this.hpFill.style.width = `${clamp(s.hp / s.maxHp, 0, 1) * 100}%`;
    this.hpText.textContent = `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
    this.shieldPip.classList.toggle('hidden', s.shield <= 0);
    this.vignette.classList.toggle('low', s.hp > 0 && s.hp < s.maxHp * 0.3);
    this.dashFill.style.width = `${clamp(s.dashReady, 0, 1) * 100}%`;
    if (this.reloadFill) this.reloadFill.style.width = `${clamp(s.reload, 0, 1) * 100}%`;
    this.roomN.textContent = String(s.room).padStart(2, '0');
    this.roomLabel.textContent = s.roomLabel;
    this.score.textContent = String(s.score);
    if (s.coins !== this.lastCoins) {
      if (this.lastCoins >= 0 && s.coins > this.lastCoins) this.bump(this.coins);
      this.coins.textContent = String(s.coins);
      this.lastCoins = s.coins;
    }
    this.combo.classList.toggle('hidden', s.combo < 3);
    if (s.combo >= 3) {
      this.comboN.textContent = String(s.combo);
      this.comboFill.style.width = `${clamp(s.comboLeft, 0, 1) * 100}%`;
    }
    if (s.bossHp !== null) this.bossFill.style.width = `${s.bossHp * 100}%`;
  }

  renderWeapons(slots: WeaponSlot[], active: number, maxSlots: number): void {
    const html: string[] = [];
    for (let i = 0; i < maxSlots; i++) {
      const s = slots[i];
      if (!s) {
        html.push(`<div class="slot empty"><kbd>${i + 1}</kbd><span class="wname">— 空槽 —</span></div>`);
        continue;
      }
      const w = WEAPONS[s.id];
      const stars = s.level > 1 ? `<span class="lv">Lv.${s.level}</span>` : '';
      html.push(
        `<div class="slot ${i === active ? 'on' : ''}" style="--wc:${hex(w.color)}">` +
        `<kbd>${i + 1}</kbd>${weaponIcon(s.id)}<span class="wname">${w.name}</span>${stars}` +
        `<div class="reload"><div></div></div></div>`,
      );
    }
    this.weapons.innerHTML = html.join('');
    this.reloadFill = this.weapons.querySelector('.slot.on .reload > div');
  }

  setBuffs(names: string[]): void {
    const counts = new Map<string, number>();
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
    this.buffs.textContent = [...counts].map(([n, c]) => (c > 1 ? `${n}×${c}` : n)).join(' · ');
  }

  showBest(best: BestRecord | null): void {
    this.best.textContent = best ? `扇区 ${best.room} / ${best.score}` : '-';
  }

  showBossBar(visible: boolean, name = ''): void {
    this.bossBar.classList.toggle('hidden', !visible);
    if (name) this.bossName.textContent = name;
  }

  prompt(html: string | null, affordable = true): void {
    this.promptEl.classList.toggle('hidden', html === null);
    if (html === null) return;
    if (this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html;
    this.promptEl.classList.toggle('poor', !affordable);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1400);
  }

  hitMarker(kill: boolean): void {
    this.cross.classList.remove('hit', 'kill');
    void this.cross.offsetWidth;  // restart the CSS animation
    this.cross.classList.add(kill ? 'kill' : 'hit');
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.cross.classList.remove('hit', 'kill'), kill ? 220 : 90);
  }

  hurtFlash(color: 'red' | 'blue' = 'red'): void {
    this.vignette.classList.toggle('blue', color === 'blue');
    this.vignette.style.opacity = '1';
    setTimeout(() => { this.vignette.style.opacity = ''; }, 180);
  }

  fade(on: boolean, label = ''): void {
    if (label) this.fadeText.textContent = label;
    this.fadeEl.classList.toggle('on', on);
  }

  private bump(el: HTMLElement): void {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}
