import { MECHS, TALENTS, type MechId, type TalentId } from '../data/meta';
import { RARITY_LABEL, type UpgradeDef } from '../data/upgrades';
import { talentLevel, type Profile } from './profile';
import { $ } from './dom';
import type { Settings } from './settings';

export type OverlayId = 'titleScreen' | 'upgradeScreen' | 'pauseScreen' | 'deadScreen' | 'hangarScreen';
const OVERLAYS: OverlayId[] = ['titleScreen', 'upgradeScreen', 'pauseScreen', 'deadScreen', 'hangarScreen'];

export interface RunSummary {
  room: number;
  score: number;
  kills: number;
  coins: number;
  bestCombo: number;
  isNewBest: boolean;
  buffs: string[];
  crystals: number;
  daily: boolean;
}

export interface HangarActions {
  unlock(id: MechId): void;
  select(id: MechId): void;
  buy(id: TalentId): void;
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
      : '<div class="dim">尚未安装模块</div>';
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

  showTitleInfo(crystals: number, mechName: string, dailyBest: number | null, today: string): void {
    $('titleCrystals').textContent = String(crystals);
    $('titleMech').textContent = mechName;
    $('titleDaily').textContent = dailyBest !== null ? `今日挑战（${today}）最佳：${dailyBest}` : `今日挑战（${today}）：尚未挑战`;
  }

  showHangar(profile: Profile, act: HangarActions): void {
    $('hangarCrystals').textContent = String(profile.crystals);
    const mechList = $('mechList');
    mechList.innerHTML = '';
    for (const def of Object.values(MECHS)) {
      const owned = profile.mechs.includes(def.id), selected = profile.selected === def.id;
      const accent = `#${def.palette.accent.toString(16).padStart(6, '0')}`;
      const row = document.createElement('div');
      row.className = `mechrow${selected ? ' selected' : ''}`;
      row.style.setProperty('--mc', accent);
      row.innerHTML =
        `<div class="mhead"><b>${def.name}</b><span class="dim">${def.desc}</span></div>` +
        `<div class="mstats">生命 ${def.hp} · 速度 ${def.speed} · 冲刺冷却 ×${def.dashCdMul}${def.critBonus ? ` · 暴击 +${def.critBonus * 100}%` : ''}${def.shield ? ` · 每扇区护盾 ${def.shield}` : ''}</div>` +
        `<div class="mskill">技能 [F] <b>${def.skillName}</b>：${def.skillDesc}（冷却 ${def.skillCd}s）</div>`;
      const btn = document.createElement('button');
      btn.className = 'mini';
      if (selected) { btn.textContent = '已选择'; btn.disabled = true; }
      else if (owned) { btn.textContent = '选择'; btn.onclick = () => act.select(def.id); }
      else { btn.textContent = `解锁 · ${def.cost} 结晶`; btn.disabled = profile.crystals < def.cost; btn.onclick = () => act.unlock(def.id); }
      row.appendChild(btn);
      mechList.appendChild(row);
    }
    const talentList = $('talentList');
    talentList.innerHTML = '';
    for (const t of TALENTS) {
      const lvl = talentLevel(profile, t.id), maxed = lvl >= t.max;
      const row = document.createElement('div');
      row.className = 'talentrow';
      const pips = Array.from({ length: t.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      row.innerHTML = `<div><b>${t.name}</b> <span class="pips">${pips}</span><div class="dim">${t.desc(Math.max(lvl, 1))}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'mini';
      if (maxed) { btn.textContent = '已满级'; btn.disabled = true; }
      else { const c = t.cost(lvl); btn.textContent = `${c} 结晶`; btn.disabled = profile.crystals < c; btn.onclick = () => act.buy(t.id); }
      row.appendChild(btn);
      talentList.appendChild(row);
    }
  }

  showGameOver(run: RunSummary): void {
    $('deadStats').innerHTML =
      `<div class="statgrid">` +
      `<div><span>抵达扇区</span><b>${run.room}</b></div>` +
      `<div><span>分数</span><b>${run.score}</b></div>` +
      `<div><span>击杀</span><b>${run.kills}</b></div>` +
      `<div><span>最高连杀</span><b>${run.bestCombo}</b></div>` +
      `<div><span>获得碎片</span><b>${run.coins}</b></div>` +
      `</div>` +
      `<div class="crystalgain">+${run.crystals} 裂隙结晶${run.daily ? ' · 每日挑战' : ''}</div>` +
      (run.isNewBest ? '<div class="newbest">★ 新纪录</div>' : '') +
      `<div class="dim">模块：${run.buffs.join('、') || '无'}</div>`;
    this.toggle('deadScreen', true);
    this.setCrosshair(false);
  }
}
