import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import type { PadButton } from '../core/input';
import { todayKey } from '../core/rng';
import { DEPTH_DESC } from '../data/depth';
import { MECHS, TALENTS, type MechId, type TalentId } from '../data/meta';
import { talentLevel, type CodexKind } from '../ui/profile';
import { loadRun } from '../ui/runsave';
import type { Game } from './game';

type CodexTab = CodexKind | 'history';
const CODEX_TABS: CodexTab[] = ['enemies', 'weapons', 'upgrades', 'history'];

// Title-screen menus: the title itself, the depth selector, the hangar and the codex.
export class Menus {
  private codexTab: CodexTab = 'enemies';

  constructor(private readonly g: Game) {
    const s = g.screens;
    s.onClick('startBtn', () => g.start(false));
    s.onClick('dailyBtn', () => g.start(true));
    s.onClick('continueBtn', () => { const save = loadRun(); if (save) g.start(save.daily, save); });
    s.onClick('hangarBtn', () => this.openHangar());
    s.onClick('hangarBack', () => this.closeHangar());
    s.onClick('codexBtn', () => this.openCodex());
    s.onClick('codexBack', () => this.closeCodex());
    s.onClick('depthDown', () => this.changeDepth(-1));
    s.onClick('depthUp', () => this.changeDepth(1));
    for (const el of document.querySelectorAll<HTMLElement>('#codexTabs [data-tab]')) {
      el.addEventListener('click', () => { this.codexTab = el.dataset.tab as CodexTab; this.renderCodex(); });
    }
    this.refreshTitle();
  }

  refreshTitle(): void {
    const pr = this.g.progress.profile;
    const d = pr.daily;
    const today = todayKey();
    this.g.screens.showTitleInfo(pr.crystals, MECHS[pr.selected].name, d && d.date === today ? d.best : null, today);
    const save = loadRun();
    this.g.screens.showContinue(save ? t('继续上一局 · 扇区 {n}', { n: String(save.room).padStart(2, '0') }) : null);
    this.g.screens.showDepth(pr.depth, pr.maxDepth, DEPTH_DESC, pr.wins);
  }

  // Gamepad on the title screen and its sub-menus.
  onPad(b: PadButton): void {
    const click = (id: string) => (document.getElementById(id) as HTMLButtonElement | null)?.click();
    const visible = (id: string) => !document.getElementById(id)?.classList.contains('hidden');
    if (visible('hangarScreen')) { if (b === 'b') click('hangarBack'); }
    else if (visible('codexScreen')) {
      if (b === 'b') click('codexBack');
      else if (b === 'lb' || b === 'rb') {
        this.codexTab = CODEX_TABS[(CODEX_TABS.indexOf(this.codexTab) + (b === 'rb' ? 1 : 3)) % 4];
        this.renderCodex();
      }
    }
    else if (b === 'a') click(visible('continueBtn') ? 'continueBtn' : 'startBtn');
    else if (b === 'start') click('startBtn');
    else if (b === 'back') click('codexBtn');
    else if (b === 'y') click('dailyBtn');
    else if (b === 'x') click('hangarBtn');
    else if (b === 'lb') this.changeDepth(-1);
    else if (b === 'rb') this.changeDepth(1);
  }

  private changeDepth(delta: number): void {
    const pr = this.g.progress.profile;
    const d = Math.max(0, Math.min(pr.maxDepth, pr.depth + delta));
    if (d === pr.depth) { sfx.denied(); return; }
    pr.depth = d;
    this.g.progress.save();
    sfx.weaponSwitch(d);
    this.refreshTitle();
  }

  private openCodex(): void {
    this.g.screens.toggle('titleScreen', false);
    this.renderCodex();
    this.g.screens.toggle('codexScreen', true);
  }

  private closeCodex(): void {
    this.g.screens.toggle('codexScreen', false);
    this.g.screens.toggle('titleScreen', true);
  }

  private renderCodex(): void {
    this.g.screens.showCodex(this.g.progress.profile, this.codexTab);
  }

  private openHangar(): void {
    this.g.screens.toggle('titleScreen', false);
    this.renderHangar();
    this.g.screens.toggle('hangarScreen', true);
  }

  private closeHangar(): void {
    this.g.screens.toggle('hangarScreen', false);
    this.g.player.setMech(MECHS[this.g.progress.profile.selected]);
    this.refreshTitle();
    this.g.screens.toggle('titleScreen', true);
  }

  private renderHangar(): void {
    const { progress, player } = this.g;
    const pr = progress.profile;
    this.g.screens.showHangar(pr, {
      unlock: (id: MechId) => {
        const def = MECHS[id];
        if (pr.crystals < def.cost || pr.mechs.includes(id)) { sfx.denied(); return; }
        pr.crystals -= def.cost;
        pr.mechs.push(id);
        pr.selected = id;
        progress.save();
        sfx.buy();
        this.renderHangar();
      },
      select: (id: MechId) => {
        pr.selected = id;
        progress.save();
        player.setMech(MECHS[id]);
        sfx.pickup();
        this.renderHangar();
      },
      buy: (id: TalentId) => {
        const def = TALENTS.find(x => x.id === id)!;
        const lvl = talentLevel(pr, id);
        if (lvl >= def.max || pr.crystals < def.cost(lvl)) { sfx.denied(); return; }
        pr.crystals -= def.cost(lvl);
        pr.talents[id] = lvl + 1;
        progress.save();
        sfx.buy();
        this.renderHangar();
      },
    });
  }
}
