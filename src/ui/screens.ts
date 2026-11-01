import { BALANCE } from '../data/balance';
import { MECHS, TALENTS, type MechId, type TalentId } from '../data/meta';
import { ENEMY_NOTES } from '../data/codex';
import { ENEMIES, type EnemyKind } from '../data/enemies';
import { RARITY_LABEL, UPGRADES, type UpgradeDef } from '../data/upgrades';
import { WEAPONS, type WeaponId } from '../data/weapons';
import { weaponIcon } from './icons';
import { talentLevel, type CodexKind, type Profile } from './profile';
import { $ } from './dom';
import type { Settings } from './settings';
import { joinList, t } from '../core/i18n';

export type OverlayId = 'titleScreen' | 'upgradeScreen' | 'pauseScreen' | 'deadScreen' | 'hangarScreen' | 'winScreen' | 'codexScreen' | 'portalScreen';
const OVERLAYS: OverlayId[] = ['titleScreen', 'upgradeScreen', 'pauseScreen', 'deadScreen', 'hangarScreen', 'winScreen', 'codexScreen', 'portalScreen'];
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

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
  depth: number;
}

export interface VictorySummary {
  score: number;
  kills: number;
  bestCombo: number;
  crystals: number;
  depth: number;
  unlocked: number | null;   // newly unlocked depth, if any
  unlockedDesc: string;
  buffs: string[];
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

  showPortal(title: string, desc: string, color: string): void {
    const title$ = $('portalTitle');
    title$.textContent = title;
    title$.style.color = color;
    $('portalDesc').textContent = desc;
    this.toggle('portalScreen', true);
    this.setCrosshair(false);
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
      : `<div class="dim">${t('尚未安装模块')}</div>`;
    this.toggle('pauseScreen', true);
    this.setCrosshair(false);
  }

  // Wire the settings controls; `onChange` receives the updated settings.
  bindSettings(initial: Settings, onChange: (s: Settings) => void): void {
    const vol = $('optVolume') as HTMLInputElement;
    const shake = $('optShake') as HTMLInputElement;
    const nums = $('optNumbers') as HTMLInputElement;
    const hints = $('optHints') as HTMLInputElement;
    const music = $('optMusic') as HTMLInputElement;
    vol.value = String(Math.round(initial.volume * 100));
    music.value = String(Math.round(initial.music * 100));
    shake.checked = initial.shake;
    nums.checked = initial.damageNumbers;
    hints.checked = initial.hints;
    const emit = () => onChange({
      ...initial,
      volume: +vol.value / 100, music: +music.value / 100, shake: shake.checked, damageNumbers: nums.checked, hints: hints.checked,
    });
    vol.addEventListener('input', emit);
    music.addEventListener('input', emit);
    hints.addEventListener('change', emit);
    shake.addEventListener('change', emit);
    nums.addEventListener('change', emit);
  }

  showTitleInfo(crystals: number, mechName: string, dailyBest: number | null, today: string): void {
    $('titleCrystals').textContent = String(crystals);
    $('titleMech').textContent = mechName;
    $('titleDaily').textContent = dailyBest !== null
      ? t('今日挑战（{d}）最佳：{b}', { d: today, b: dailyBest })
      : t('今日挑战（{d}）：尚未挑战', { d: today });
  }

  showCodex(profile: Profile, tab: CodexKind | 'history'): void {
    for (const el of document.querySelectorAll<HTMLElement>('#codexTabs [data-tab]')) el.classList.toggle('on', el.dataset.tab === tab);
    const known = (kind: CodexKind, id: string) => profile.codex[kind].includes(id);
    const unknown = `<div class="centry unknown"><b>？？？</b><div class="dim">${t('尚未遇到')}</div></div>`;
    let html = '';
    let count = '';
    if (tab === 'enemies') {
      const ids = Object.keys(ENEMIES) as EnemyKind[];
      count = `${ids.filter(id => known('enemies', id)).length} / ${ids.length}`;
      html = ids.map(id => {
        if (!known('enemies', id)) return unknown;
        const d = ENEMIES[id];
        return `<div class="centry" style="--cc:${hex(d.color)}"><b><i class="dot"></i>${d.name}${d.boss ? ` <span class="ctag">${t('首领')}</span>` : ''}</b>` +
          `<div class="dim">${ENEMY_NOTES[id]}</div><div class="cstat">${t('生命 {a} · 伤害 {b} · 分数 {c}', { a: d.hp, b: d.dmg, c: d.score })}</div></div>`;
      }).join('');
    } else if (tab === 'weapons') {
      const ids = Object.keys(WEAPONS) as WeaponId[];
      count = `${ids.filter(id => known('weapons', id)).length} / ${ids.length}`;
      html = ids.map(id => {
        if (!known('weapons', id)) return unknown;
        const w = WEAPONS[id];
        const dmg = `${w.dmg}${w.count > 1 ? ` ×${w.count}` : ''}`;
        return `<div class="centry" style="--cc:${hex(w.color)}"><b><span class="cicon">${weaponIcon(id)}</span>${w.name}</b>` +
          `<div class="dim">${w.desc}</div><div class="cstat">${t('伤害 {a} · 每秒 {b} 发', { a: dmg, b: (1 / w.rate).toFixed(1) })}</div></div>`;
      }).join('');
    } else if (tab === 'upgrades') {
      count = `${UPGRADES.filter(u => known('upgrades', u.id)).length} / ${UPGRADES.length}`;
      html = UPGRADES.map(u => known('upgrades', u.id)
        ? `<div class="centry ${u.rarity}"><b>${u.name} <span class="ctag">${RARITY_LABEL[u.rarity]}</span></b><div class="dim">${u.desc}</div></div>`
        : unknown).join('');
    } else {
      const tot = profile.totals;
      count = t('{n} 局', { n: tot.runs });
      const rows = profile.history.map(h =>
        `<tr class="${h.won ? 'won' : ''}"><td>${h.date}</td><td>${MECHS[h.mech]?.name ?? h.mech}</td><td>${h.daily ? t('每日') : h.depth}</td>` +
        `<td>${h.won ? t('★ 通关') : h.room}</td><td>${h.score}</td><td>${h.kills}</td><td>${fmtTime(h.time)}</td></tr>`).join('');
      const head = [t('日期'), t('机体'), t('深度'), t('扇区'), t('分数'), t('击杀'), t('时长')].map(s => `<th>${t(s)}</th>`).join('');
      html = `<div class="totals"><span>${t('总局数')} <b>${tot.runs}</b></span><span>${t('通关')} <b>${profile.wins}</b></span>` +
        `<span>${t('总击杀')} <b>${tot.kills}</b></span><span>${t('总时长')} <b>${fmtTime(tot.time)}</b></span></div>` +
        (rows ? `<table class="history"><tr>${head}</tr>${rows}</table>` : `<div class="dim">${t('还没有完成的对局')}</div>`);
    }
    $('codexCount').textContent = count;
    const list = $('codexList');
    list.className = tab === 'history' ? 'histwrap' : 'cgrid';
    list.innerHTML = html;
  }

  showContinue(label: string | null): void {
    const b = $('continueBtn');
    b.classList.toggle('hidden', label === null);
    if (label) b.textContent = label;
  }

  showDepth(depth: number, maxDepth: number, desc: string[], wins: number): void {
    $('depthN').textContent = String(depth);
    ($('depthDown') as HTMLButtonElement).disabled = depth <= 0;
    ($('depthUp') as HTMLButtonElement).disabled = depth >= maxDepth;
    const mods = desc.slice(1, depth + 1);
    $('depthDesc').textContent = maxDepth === 0
      ? t('通关第 15 扇区解锁更高的裂隙深度')
      : depth === 0
        ? t('标准难度 · 已通关 {n} 次', { n: wins })
        : `${mods.join(' · ')} · ${t('结晶 +{n}%', { n: depth * 20 })}`;
  }

  private statGrid(cells: [string, number][]): string {
    return `<div class="statgrid">${cells.map(([k, v]) => `<div><span>${t(k)}</span><b>${v}</b></div>`).join('')}</div>`;
  }

  showVictory(v: VictorySummary): void {
    $('winStats').innerHTML =
      this.statGrid([[t('裂隙深度'), v.depth], [t('分数'), v.score], [t('击杀'), v.kills], [t('最高连杀'), v.bestCombo]]) +
      `<div class="crystalgain">${t('+{n} 裂隙结晶（含通关奖励）', { n: v.crystals })}</div>` +
      (v.unlocked !== null ? `<div class="newbest">${t('★ 解锁裂隙深度 {n}：{d}', { n: v.unlocked, d: v.unlockedDesc })}</div>` : '') +
      `<div class="dim">${t('模块：')}${joinList(v.buffs) || t('无')}</div>`;
    this.toggle('winScreen', true);
    this.setCrosshair(false);
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
      const stats = t('生命 {hp} · 速度 {sp} · 冲刺冷却 {dc}s', { hp: def.hp, sp: def.speed, dc: +(BALANCE.player.dashCooldown * def.dashCdMul).toFixed(2) }) +
        (def.critBonus ? t(' · 暴击 +{n}%', { n: def.critBonus * 100 }) : '') +
        (def.shield ? t(' · 每扇区护盾 {n}', { n: def.shield }) : '');
      row.innerHTML =
        `<div class="mhead"><b>${def.name}</b><span class="dim">${def.desc}</span></div>` +
        `<div class="mstats">${stats}</div>` +
        `<div class="mstats">${t('初始武器：{w}（弹药无限，不可丢弃）', { w: WEAPONS[def.starter].name })}</div>` +
        `<div class="mskill">${t('技能 [F] <b>{name}</b>：{desc}（冷却 {cd}s）', { name: def.skillName, desc: def.skillDesc, cd: def.skillCd })}</div>`;
      const btn = document.createElement('button');
      btn.className = 'mini';
      if (selected) { btn.textContent = t('已选择'); btn.disabled = true; }
      else if (owned) { btn.textContent = t('选择'); btn.onclick = () => act.select(def.id); }
      else { btn.textContent = t('解锁 · {n} 结晶', { n: def.cost }); btn.disabled = profile.crystals < def.cost; btn.onclick = () => act.unlock(def.id); }
      row.appendChild(btn);
      mechList.appendChild(row);
    }
    const talentList = $('talentList');
    talentList.innerHTML = '';
    for (const tal of TALENTS) {
      const lvl = talentLevel(profile, tal.id), maxed = lvl >= tal.max;
      const row = document.createElement('div');
      row.className = 'talentrow';
      const pips = Array.from({ length: tal.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      row.innerHTML = `<div><b>${tal.name}</b> <span class="pips">${pips}</span><div class="dim">${tal.desc(Math.max(lvl, 1))}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'mini';
      if (maxed) { btn.textContent = t('已满级'); btn.disabled = true; }
      else { const c = tal.cost(lvl); btn.textContent = t('{n} 结晶', { n: c }); btn.disabled = profile.crystals < c; btn.onclick = () => act.buy(tal.id); }
      row.appendChild(btn);
      talentList.appendChild(row);
    }
  }

  showGameOver(run: RunSummary): void {
    const tag = run.daily ? t(' · 每日挑战') : run.depth ? t(' · 深度 {n}', { n: run.depth }) : '';
    $('deadStats').innerHTML =
      this.statGrid([[t('抵达扇区'), run.room], [t('分数'), run.score], [t('击杀'), run.kills], [t('最高连杀'), run.bestCombo], [t('获得碎片'), run.coins]]) +
      `<div class="crystalgain">${t('+{n} 裂隙结晶', { n: run.crystals })}${tag}</div>` +
      (run.isNewBest ? `<div class="newbest">${t('★ 新纪录')}</div>` : '') +
      `<div class="dim">${t('模块：')}${joinList(run.buffs) || t('无')}</div>`;
    this.toggle('deadScreen', true);
    this.setCrosshair(false);
  }
}
