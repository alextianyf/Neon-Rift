import { RARITY_LABEL, type UpgradeDef } from '../data/upgrades';
import { $ } from './dom';
import type { Settings } from './settings';

export type OverlayId = 'titleScreen' | 'upgradeScreen' | 'pauseScreen' | 'deadScreen';
const OVERLAYS: OverlayId[] = ['titleScreen', 'upgradeScreen', 'pauseScreen', 'deadScreen'];

export interface RunSummary {
  room: number;
  score: number;
  kills: number;
  coins: number;
  bestCombo: number;
  isNewBest: boolean;
  buffs: string[];
}

export interface StatLine {
  label: string;
  value: string;
}

export interface BuildEntry {
  name: string;
  desc: string;
  rarity: UpgradeDef['rarity'];
  count: number;
}

// Full-screen overlays (title, upgrade pick, pause, game over) plus the custom crosshair.
export class Screens {
  readonly crosshair = $('cross');

  onClick(buttonId: string, fn: () => void): void {
    $(buttonId).addEventListener('click', fn);
  }

  toggle(id: OverlayId, visible: boolean): void {
    $(id).classList.toggle('hidden', !visible);
  }

  hideAll(): void {
    for (const id of OVERLAYS) this.toggle(id, false);
  }

  setCrosshair(visible: boolean): void {
    this.crosshair.classList.toggle('hidden', !visible);
  }

  showUpgrades(choices: UpgradeDef[], title: string, onPick: (index: number) => void): void {
    $('upgradeTitle').textContent = title;
    const box = $('cards');
    box.innerHTML = '';
    choices.forEach((u, i) => {
      const el = document.createElement('div');
      el.className = `card ${u.rarity}`;
      el.innerHTML = `<div class="k">[${i + 1}] ${RARITY_LABEL[u.rarity]}</div><div class="t">${u.name}</div><div class="d">${u.desc}</div>`;
      el.onclick = () => onPick(i);
      box.appendChild(el);
    });
    this.toggle('upgradeScreen', true);
    this.setCrosshair(false);
  }

  showPause(stats: StatLine[], build: BuildEntry[]): void {
    $('statList').innerHTML = stats.map(s => `<div class="statrow"><span>${s.label}</span><b>${s.value}</b></div>`).join('');
    $('buildList').innerHTML = build.length
      ? build.map(b => `<div class="buildrow ${b.rarity}" title="${b.desc}"><span>${b.name}</span>${b.count > 1 ? `<b>×${b.count}</b>` : ''}</div>`).join('')
      : '<div class="dim">还没有强化</div>';
    this.toggle('pauseScreen', true);
    this.setCrosshair(false);
  }

  // Wire the settings controls; `onChange` receives the updated settings.
  bindSettings(initial: Settings, onChange: (s: Settings) => void): void {
    const vol = $('optVolume') as HTMLInputElement;
    const shake = $('optShake') as HTMLInputElement;
    const nums = $('optNumbers') as HTMLInputElement;
    vol.value = String(Math.round(initial.volume * 100));
    shake.checked = initial.shake;
    nums.checked = initial.damageNumbers;
    const emit = () => onChange({ volume: +vol.value / 100, shake: shake.checked, damageNumbers: nums.checked });
    vol.addEventListener('input', emit);
    shake.addEventListener('change', emit);
    nums.addEventListener('change', emit);
  }

  showGameOver(run: RunSummary): void {
    $('deadStats').innerHTML =
      `<div class="statgrid">` +
      `<div><span>抵达房间</span><b>${run.room}</b></div>` +
      `<div><span>分数</span><b>${run.score}</b></div>` +
      `<div><span>击杀</span><b>${run.kills}</b></div>` +
      `<div><span>最高连杀</span><b>${run.bestCombo}</b></div>` +
      `<div><span>获得金币</span><b>${run.coins}</b></div>` +
      `</div>` +
      (run.isNewBest ? '<div class="newbest">★ 新纪录</div>' : '') +
      `<div class="dim">强化：${run.buffs.join('、') || '无'}</div>`;
    this.toggle('deadScreen', true);
    this.setCrosshair(false);
  }
}
