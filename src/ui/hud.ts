import { clamp } from '../core/math';
import type { WeaponDef } from '../data/weapons';
import { $ } from './dom';
import type { BestRecord } from './storage';

export interface HudStats {
  hp: number;
  maxHp: number;
  dashReady: number;  // 0..1
  room: number;
  score: number;
  bossHp: number | null;  // 0..1, null when no boss is alive
}

export class Hud {
  private readonly root = $('hud');
  private readonly hpFill = $('hpFill');
  private readonly hpText = $('hpText');
  private readonly dashFill = $('dashFill');
  private readonly roomN = $('roomN');
  private readonly score = $('score');
  private readonly best = $('best');
  private readonly bossBar = $('bossBar');
  private readonly bossFill = $('bossFill');
  private readonly weapons = $('weapons');
  private readonly buffs = $('buffs');
  private readonly toastEl = $('toast');
  private readonly vignette = $('vignette');
  private readonly fadeEl = $('fade');
  private toastTimer = 0;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(s: HudStats): void {
    this.hpFill.style.width = `${clamp(s.hp / s.maxHp, 0, 1) * 100}%`;
    this.hpText.textContent = `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
    this.dashFill.style.width = `${clamp(s.dashReady, 0, 1) * 100}%`;
    this.roomN.textContent = String(s.room);
    this.score.textContent = String(s.score);
    if (s.bossHp !== null) this.bossFill.style.width = `${s.bossHp * 100}%`;
  }

  renderWeapons(weapons: WeaponDef[], active: number): void {
    this.weapons.innerHTML = weapons
      .map((w, i) => `<div class="slot ${i === active ? 'on' : ''}"><kbd>${i + 1}</kbd>${w.name}</div>`)
      .join('');
  }

  setBuffs(names: string[]): void {
    this.buffs.textContent = names.join(' · ');
  }

  showBest(best: BestRecord | null): void {
    this.best.textContent = best ? `房间 ${best.room} / ${best.score} 分` : '-';
  }

  showBossBar(visible: boolean): void {
    this.bossBar.classList.toggle('hidden', !visible);
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 1400);
  }

  hurtFlash(): void {
    this.vignette.style.opacity = '1';
    setTimeout(() => { this.vignette.style.opacity = '0'; }, 180);
  }

  fade(on: boolean): void {
    this.fadeEl.classList.toggle('on', on);
  }
}
