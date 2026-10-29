import type { UpgradeDef } from '../data/upgrades';
import { $ } from './dom';

export type OverlayId = 'titleScreen' | 'upgradeScreen' | 'pauseScreen' | 'deadScreen';
const OVERLAYS: OverlayId[] = ['titleScreen', 'upgradeScreen', 'pauseScreen', 'deadScreen'];

export interface RunSummary {
  room: number;
  score: number;
  isNewBest: boolean;
  buffs: string[];
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

  showUpgrades(choices: UpgradeDef[], onPick: (index: number) => void): void {
    const box = $('cards');
    box.innerHTML = '';
    choices.forEach((u, i) => {
      const el = document.createElement('div');
      el.className = 'card';
      el.innerHTML = `<div class="k">[${i + 1}]</div><div class="t">${u.name}</div><div class="d">${u.desc}</div>`;
      el.onclick = () => onPick(i);
      box.appendChild(el);
    });
    this.toggle('upgradeScreen', true);
    this.setCrosshair(false);
  }

  showGameOver(run: RunSummary): void {
    $('deadStats').innerHTML =
      `抵达房间 <b>${run.room}</b><br>分数 <b>${run.score}</b>` +
      (run.isNewBest ? '<br><span style="color:#ff4dd2">★ 新纪录</span>' : '') +
      `<br><span class="dim">强化：${run.buffs.join('、') || '无'}</span>`;
    this.toggle('deadScreen', true);
    this.setCrosshair(false);
  }
}
