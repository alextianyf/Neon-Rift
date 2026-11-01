import { t } from '../core/i18n';
import { FINAL_SECTOR } from '../data/depth';
import { ENEMIES, type EnemyKind } from '../data/enemies';
import { ROOM_INFO, type RoomKind } from '../data/map';
import { rollUpgrades } from '../data/upgrades';
import type { Game } from '../game/game';

// Test-link tools (only built when the page is opened with `?test`): jump to any sector,
// spawn any enemy next to the player, god mode, clear the room, hand out coins and random modules.
// F2 or the TEST button toggles the panel.
export function buildTestPanel(g: Game): void {
  const kinds = Object.keys(ENEMIES) as EnemyKind[];
  const rooms = Object.keys(ROOM_INFO) as RoomKind[];
  const box = document.createElement('div');
  box.id = 'testPanel';
  box.innerHTML = `
    <div class="tp-head">${t('测试面板')} <span class="dim">F2</span></div>
    <div class="tp-row">${t('扇区')} <input id="tpSector" type="number" min="1" max="999" value="1">
      <select id="tpRoom">${rooms.map(k => `<option value="${k}">${ROOM_INFO[k].name}</option>`).join('')}</select>
      <button class="mini" id="tpGo">${t('前往')}</button></div>
    <div class="tp-row"><select id="tpEnemy">${kinds.map(k => `<option value="${k}">${ENEMIES[k].name}</option>`).join('')}</select>
      ×<input id="tpCount" type="number" min="1" max="30" value="1">
      <label><input id="tpElite" type="checkbox"> ${t('精英')}</label>
      <button class="mini" id="tpSpawn">${t('刷出')}</button></div>
    <div class="tp-row"><label><input id="tpGod" type="checkbox"> ${t('无敌')}</label>
      <button class="mini" id="tpKill">${t('清场')}</button>
      <button class="mini" id="tpCoins">${t('+500 碎片')}</button></div>
    <div class="tp-row"><button class="mini" id="tpMods">${t('随机强化 ×5')}</button></div>
    <div class="tp-note dim">${t('测试存档与正式存档分开')}</div>`;
  const toggle = document.createElement('button');
  toggle.id = 'testToggle';
  toggle.className = 'mini';
  toggle.textContent = 'TEST';
  document.body.append(box, toggle);

  const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const num = (id: string, min: number) => Math.max(min, Math.floor(Number(el<HTMLInputElement>(id).value) || min));
  const inRun = () => g.state === 'play' || g.state === 'paused';
  // typing in the panel must not move the mech or trigger hotkeys
  for (const type of ['keydown', 'keyup'] as const) box.addEventListener(type, e => { if (e.key !== 'F2') e.stopPropagation(); });
  const show = (on: boolean) => box.classList.toggle('hidden', !on);
  show(false);
  toggle.onclick = () => show(box.classList.contains('hidden'));
  addEventListener('keydown', e => { if (e.key === 'F2') { e.preventDefault(); show(box.classList.contains('hidden')); } });

  el('tpGo').onclick = () => {
    const n = num('tpSector', 1);
    if (!inRun()) g.start(false);
    if (g.state === 'paused') g.setPaused(false);
    g.endless = n > FINAL_SECTOR;
    g.sector.enter(n, el<HTMLSelectElement>('tpRoom').value as RoomKind);
    g.state = 'play';
  };
  el('tpSpawn').onclick = () => {
    if (!inRun()) return g.hud.toast(t('先开始一局'));
    const kind = el<HTMLSelectElement>('tpEnemy').value as EnemyKind, elite = el<HTMLInputElement>('tpElite').checked;
    const count = Math.min(30, num('tpCount', 1)), p = g.player.pos;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2, d = 5 + Math.random() * 3;
      let x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      if (g.room.blocked(x, z, 0.8)) { x = p.x; z = p.z + 4; }
      g.enemies.spawn(kind, x, z, elite);
    }
  };
  el<HTMLInputElement>('tpGod').onchange = e => { g.god = (e.target as HTMLInputElement).checked; };
  el('tpKill').onclick = () => { for (const e of [...g.enemies.list]) g.enemies.damage(e, 1e9); };
  el('tpCoins').onclick = () => { g.player.coins += 500; };
  el('tpMods').onclick = () => {
    if (!inRun()) return g.hud.toast(t('先开始一局'));
    for (let i = 0; i < 5; i++) {
      const [u] = rollUpgrades(g.player, 1, { common: 2, rare: 2, legendary: 1 });
      if (u) g.applyUpgrade(u);
    }
    g.refreshWeapons();
  };
}
