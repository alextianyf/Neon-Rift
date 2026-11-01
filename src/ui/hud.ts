import { clamp } from '../core/math';
import type { SkillId } from '../data/meta';
import { RARITY_LABEL, type Rarity } from '../data/upgrades';
import { WEAPONS } from '../data/weapons';
import type { WeaponSlot } from '../game/player';
import { $ } from './dom';
import { skillIcon, weaponIcon } from './icons';
import type { BestRecord } from './storage';
import { LANG, t } from '../core/i18n';

// A timed or conditional effect shown in the buff row (overdrive, barrier, sentinel...).
export interface StatusIcon {
  html: string;          // glyph
  color: string;
  time: number | null;   // seconds left, or null for "while the condition holds"
}

export interface ModuleIcon {
  name: string;
  rarity: Rarity;
  count: number;
}

export interface HudStats {
  hp: number;
  maxHp: number;
  shield: number;
  dashCd: number;         // seconds left
  dashTotal: number;
  skillCd: number;
  skillTotal: number;
  skillActive: boolean;
  reload: number | null;  // 0..1 progress of the current reload
  slots: WeaponSlot[];
  magSize: (s: WeaponSlot) => number;
  statuses: StatusIcon[];
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
  private readonly gauge = $('mechGauge');
  private readonly gDash = this.gauge.querySelector<HTMLElement>('.gdash')!;
  private readonly gDashFill = this.gauge.querySelector<HTMLElement>('.gdash > div')!;
  private readonly gSkill = this.gauge.querySelector<HTMLElement>('.gskill')!;
  private readonly gSkillFill = this.gauge.querySelector<HTMLElement>('.gskill .bar > div')!;
  private readonly gSkillText = this.gauge.querySelector<HTMLElement>('.gskill span')!;
  private readonly hkDash = $('hkDash');
  private readonly hkSkill = $('hkSkill');
  private readonly statusTiles = $('statusTiles');
  private readonly moduleTiles = $('moduleTiles');
  private readonly roomN = $('roomN');
  private readonly roomLabel = $('roomLabel');
  private readonly score = $('score');
  private readonly coins = $('coins');
  private readonly best = $('best');
  private readonly bossBar = $('bossBar');
  private readonly bossName = $('bossName');
  private readonly bossFill = $('bossFill');
  private readonly weapons = $('weapons');
  private readonly combo = $('combo');
  private readonly comboN = $('comboN');
  private readonly comboFill = $('comboFill');
  private readonly promptEl = $('prompt');
  private readonly toastEl = $('toast');
  private readonly hintEl = $('hint');
  private readonly hintText = $('hintText');
  private readonly vignette = $('vignette');
  private readonly fadeEl = $('fade');
  private readonly fadeText = $('fadeText');
  private readonly cross = $('cross');
  private toastTimer = 0;
  private hitTimer = 0;
  private ammoEls: HTMLElement[] = [];
  private lastCoins = -1;
  private lastStatus = '';

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  update(s: HudStats): void {
    this.hpFill.style.width = `${clamp(s.hp / s.maxHp, 0, 1) * 100}%`;
    this.hpText.textContent = `${Math.max(0, Math.ceil(s.hp))} / ${s.maxHp}`;
    this.shieldPip.classList.toggle('hidden', s.shield <= 0);
    this.vignette.classList.toggle('low', s.hp > 0 && s.hp < s.maxHp * 0.3);
    this.cooldown(this.hkDash, s.dashCd, s.dashTotal);
    this.cooldown(this.hkSkill, s.skillCd, s.skillTotal);
    this.hkSkill.classList.toggle('active', s.skillActive);
    this.cross.classList.toggle('reloading', s.reload !== null);
    if (s.reload !== null) this.cross.style.setProperty('--rp', String(clamp(s.reload, 0, 1)));
    s.slots.forEach((slot, i) => {
      const el = this.ammoEls[i];
      if (!el) return;
      const text = `${slot.mag}<i>/${slot.starter ? '∞' : slot.reserve}</i>`;
      if (el.innerHTML !== text) el.innerHTML = text;
      el.classList.toggle('low', slot.mag <= Math.ceil(s.magSize(slot) * 0.25));
      el.classList.toggle('dry', slot.mag === 0 && !slot.starter && slot.reserve === 0);
    });
    const status = s.statuses.map(st =>
      `<div class="bt st" style="--bc:${st.color}">${st.html}${st.time !== null ? `<b>${st.time < 10 ? st.time.toFixed(1) : Math.ceil(st.time)}</b>` : ''}</div>`).join('');
    if (status !== this.lastStatus) {
      this.statusTiles.innerHTML = status;
      this.lastStatus = status;
    }
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
        html.push(`<div class="slot empty"><kbd>${i + 1}</kbd><span class="wname">${t('— 空槽 —')}</span></div>`);
        continue;
      }
      const w = WEAPONS[s.id];
      const stars = s.level > 1 ? `<span class="lv">Lv.${s.level}</span>` : '';
      html.push(
        `<div class="slot ${i === active ? 'on' : ''}${s.starter ? ' starter' : ''}" style="--wc:${hex(w.color)}">` +
        `<kbd>${i + 1}</kbd>${weaponIcon(s.id)}<span class="wname">${w.name}</span>${stars}` +
        `<span class="ammo"></span></div>`,
      );
    }
    this.weapons.innerHTML = html.join('');
    this.ammoEls = [...this.weapons.querySelectorAll<HTMLElement>('.ammo')];
  }

  setSkill(skill: SkillId, name: string): void {
    this.hkDash.querySelector('.ico')!.innerHTML = skillIcon('dash');
    this.hkSkill.querySelector('.ico')!.innerHTML = skillIcon(skill);
    this.hkSkill.querySelector('.hname')!.textContent = name;
  }

  // Installed modules as small tiles in the buff row: rarity colour, short label, stack count.
  setModules(mods: ModuleIcon[]): void {
    this.moduleTiles.innerHTML = mods.map(m => {
      const label = LANG === 'en' ? m.name.replace(/[^A-Za-z]/g, '').slice(0, 2) : [...m.name][0];
      return `<div class="bt mod ${m.rarity}" data-name="${m.name} · ${RARITY_LABEL[m.rarity]}">${label}${m.count > 1 ? `<b>${m.count}</b>` : ''}</div>`;
    }).join('');
  }

  showBest(best: BestRecord | null): void {
    this.best.textContent = best ? t('扇区 {a} / {b}', { a: best.room, b: best.score }) : '-';
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

  // Tutorial hint panel; null hides it.
  hint(html: string | null): void {
    if (html !== null) this.hintText.innerHTML = html;
    this.hintEl.classList.toggle('on', html !== null);
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

  // Small gauge just below the mech: dash recharge while cooling, and the skill's remaining
  // effect time (draining bar) or cooldown (seconds). Each part hides when ready.
  mechGauge(x: number, y: number, s: { dashCd: number; dashTotal: number; skillCd: number; skillT: number; skillDur: number }): void {
    this.gauge.style.transform = `translate(${x}px, ${y}px)`;
    const dashing = s.dashCd > 0;
    this.gDash.classList.toggle('on', dashing);
    if (dashing) this.gDashFill.style.width = `${(1 - clamp(s.dashCd / s.dashTotal, 0, 1)) * 100}%`;
    const active = s.skillT > 0 && s.skillDur > 0;
    this.gSkill.classList.toggle('on', active || s.skillCd > 0);
    this.gSkill.classList.toggle('active', active);
    const left = active ? s.skillT : s.skillCd;
    const text = active || s.skillCd > 0 ? `F ${left < 10 ? left.toFixed(1) : Math.ceil(left)}s` : '';
    if (this.gSkillText.textContent !== text) this.gSkillText.textContent = text;
    if (active) this.gSkillFill.style.width = `${clamp(s.skillT / s.skillDur, 0, 1) * 100}%`;
  }

  // Hotbar key: dark sweep over the icon plus the seconds left while cooling down.
  private cooldown(el: HTMLElement, left: number, total: number): void {
    const p = total > 0 ? clamp(left / total, 0, 1) : 0;
    el.style.setProperty('--p', String(p));
    el.classList.toggle('cooling', p > 0);
    const n = el.querySelector('.cdn')!;
    const text = p > 0 ? (left < 10 ? left.toFixed(1) : String(Math.ceil(left))) : '';
    if (n.textContent !== text) n.textContent = text;
  }

  private bump(el: HTMLElement): void {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}
