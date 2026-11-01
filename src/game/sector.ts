import { sfx } from '../core/audio';
import { t } from '../core/i18n';
import { duck } from '../core/music';
import { rnd, rngState } from '../core/rng';
import { BALANCE } from '../data/balance';
import { FINAL_SECTOR } from '../data/depth';
import { ENEMIES } from '../data/enemies';
import { ROOM_INFO, rollPaths, type RoomKind } from '../data/map';
import { THEMES } from '../data/themes';
import { planBoss } from '../data/bossPlan';
import { LAWS, MUTATIONS, addMutation, lawFor, lawSetup, lawState, mutationDue, offerMutations } from './abyss';
import { fusionsFor } from './fusion';
import { endlessRewards } from './epoch';
import { stratumAt } from '../data/strata';
import { AFFIXES } from '../data/affixes';
import { ROLL_WEIGHTS, rollUpgrades, type Rarity, type UpgradeDef } from '../data/upgrades';
import type { Tag } from '../ui/floaters';
import type { Game } from './game';

// One sector from entry to exit: build it, spawn its waves, detect the clear,
// offer a module, then open the portals to the next sector.
export class SectorFlow {
  private portalTags: Tag[] = [];
  private challengeSpawnT = 0;
  private choices: UpgradeDef[] = [];
  private pendingPortal: RoomKind | null = null;
  private portalArmed = true;
  private twinSlot = 0;
  private custom: { n: number; onPick: (i: number) => void } | null = null;  // false after cancelling, until the player steps off the portal

  constructor(private readonly g: Game) {}

  enter(n: number, kind: RoomKind): void {
    const g = this.g;
    const seed = rngState();  // saved so a resumed run rebuilds this exact sector
    g.clearWorld();
    g.fx.clear();
    g.floaters.clear();
    g.room.build(n, kind);
    g.atmosphere.build(g.room);
    g.hazards.build();
    // deep abyss: a law per 5 sectors, two new fusions every 5
    const law = lawFor(n, rnd);
    if (law !== lawState.law) { lawState.law = law; if (law) g.hud.toast(t('深渊法则：{l} · {d}', { l: LAWS[law].name, d: LAWS[law].desc })); }
    const fused = fusionsFor(n, rnd);
    if (fused.length) g.hud.toast(t('新融合体：{f}', { f: fused.map(k => ENEMIES[k].name).join(t('、')) }));
    if (kind === 'boss') {
      g.room.bossPlan = planBoss(n, g.bossLog, rnd);
      g.bossLog = [...g.bossLog.filter(b => b.n < n), ...g.room.bossPlan.kinds.map(k => ({ n, kind: k }))];
    }
    g.room.plan();
    lawSetup(g);
    g.player.pos.copy(g.room.entry);
    g.player.vel.set(0, 0, 0);
    g.player.shield = g.player.shieldMax;
    g.gfx.snapCamera(g.player.pos.x, g.player.pos.z);

    this.challengeSpawnT = 1;
    if (kind === 'shop') {
      g.bankCrystals();  // before the run save below, so a resumed run doesn't pay them twice
      g.interactables.setupShop();
      this.openPaths();
      g.hud.toast(t('黑市终端 · 走近按 E 交易'));
    } else if (kind === 'treasure') {
      g.interactables.setupTreasure();
      this.openPaths();
      g.hud.toast(t('数据宝库 · 免费拾取'));
    } else if (kind === 'boss') {
      g.hud.toast(t('⚠ 裂隙核心'));
    } else {
      const theme = g.room.enemyTheme;
      const label = kind === 'combat' ? t('扇区 {n}', { n: String(n).padStart(2, '0') }) : ROOM_INFO[kind].name;
      g.hud.toast(theme ? `${label} · ${THEMES[theme].name}` : label);
    }
    // entering a new rift stratum: name it and what's new in it
    const st = stratumAt(n);
    if (st && n === st.from) {
      const names = st.enemies.map(k => ENEMIES[k].name).join(t('、'));
      g.hud.toast(t('进入{s} · 新敌人：{e} · 新词缀：{a}', { s: st.name, e: names, a: AFFIXES[st.affix].name }));
    }
    g.saveRunState(seed, n, kind);
  }

  // Remove the portal labels (the rest of the world is cleared by the caller).
  clear(): void {
    for (const tag of this.portalTags) this.g.floaters.removeTag(tag);
    this.portalTags = [];
  }

  spawnDue(): void {
    const g = this.g;
    for (const s of g.room.takeDueSpawns()) {
      // bosses step out at the far side; twins side by side
      const twin = ENEMIES[s.kind].boss && (s.hpMul ?? 1) < 1 ? (this.twinSlot++ % 2 ? 6 : -6) : 0;
      const [x, z] = ENEMIES[s.kind].boss
        ? [twin, -g.room.hh * 0.45]
        : g.room.findSpawn(g.player.pos, BALANCE.rooms.spawnMinDist, ENEMIES[s.kind].r);
      if (s.kind === 'mimic') {
        // mimics don't come through a rift: they're just lying there, looking like a health orb
        g.enemies.spawn('mimic', x, z, s.elite);
        continue;
      }
      g.enemies.addMarker(s.kind, x, z, ENEMIES[s.kind].boss ? 1.5 : 0.75, s.count, s.elite, s.hpMul);
    }
  }

  update(dt: number): void {
    const g = this.g;
    if (g.room.kind === 'challenge') this.updateChallenge(dt);
    else this.checkClear(dt);
    if (g.state !== 'play') return;
    const path = g.room.portalReached(g.player.pos);
    if (!path) this.portalArmed = true;
    else if (this.portalArmed) this.askPortal(path);
  }

  // Portals ask before warping, so walking over one while grabbing loot doesn't end the sector.
  private askPortal(kind: RoomKind): void {
    const g = this.g, info = ROOM_INFO[kind];
    this.pendingPortal = kind;
    g.state = 'portal';
    g.input.mouseDown = false;
    g.input.releaseTouch();
    g.hud.prompt(null);
    g.screens.showPortal(t('进入 {name}？', { name: info.name }), info.desc, `#${info.color.toString(16).padStart(6, '0')}`);
  }

  answerPortal(go: boolean): void {
    const g = this.g, kind = this.pendingPortal;
    if (g.state !== 'portal' || !kind) return;
    this.pendingPortal = null;
    g.screens.toggle('portalScreen', false);
    g.screens.setCrosshair(true);
    g.state = 'play';
    if (go) this.goThroughPortal(kind);
    else this.portalArmed = false;
  }

  openUpgrade(): void {
    const g = this.g;
    g.state = 'upgrade';
    g.input.mouseDown = false;
    g.input.releaseTouch();
    g.hud.prompt(null);
    const kind = g.room.kind;
    const weights = kind === 'boss' || kind === 'elite' ? ROLL_WEIGHTS.boss : kind === 'challenge' ? ROLL_WEIGHTS.challenge : ROLL_WEIGHTS.room;
    const title = kind === 'boss' ? t('核心战利品 · 选择一个模块') : kind === 'challenge' ? t('挑战完成 · 选择一个模块') : t('选择一个模块');
    duck(true);
    this.choices = rollUpgrades(g.player, BALANCE.rooms.upgradeChoices, weights);
    g.screens.showUpgrades(this.choices, title, i => this.pickUpgrade(i));
  }

  pickUpgrade(i: number): void {
    const g = this.g;
    if (this.custom) {
      if (g.state !== 'upgrade' || i < 0 || i >= this.custom.n) return;
      const pick = this.custom.onPick;
      this.custom = null;
      duck(false);
      g.screens.toggle('upgradeScreen', false);
      g.screens.setCrosshair(true);
      g.state = 'play';
      pick(i);
      return;
    }
    const u = this.choices[i];
    if (!u || g.state !== 'upgrade') return;
    g.applyUpgrade(u);
    duck(false);
    g.screens.toggle('upgradeScreen', false);
    g.screens.setCrosshair(true);
    g.state = 'play';
    this.openPaths();
  }

  private checkClear(dt: number): void {
    const g = this.g, room = g.room;
    const waveSpawned = room.queue.length === 0 && g.enemies.pending === 0;
    // walls, missiles and still-disguised mimics don't hold up the clear
    const alive = g.enemies.list.filter(e => !e.def.inert && e.state !== 'disguise').length;
    // next wave once the current one is mostly dead
    if (!room.cleared && waveSpawned && room.hasMoreWaves && alive <= Math.max(2, Math.floor(room.waveSize * BALANCE.rooms.nextWaveAt))) {
      room.startWave(room.wave + 1);
      g.hud.toast(`WAVE ${room.wave + 1} / ${room.waves.length}`);
    }
    if (!room.cleared && waveSpawned && !room.hasMoreWaves && alive === 0 && g.hazards.openRifts === 0) {
      room.cleared = true;
      room.clearT = 0.9;
      for (const e of g.enemies.list.filter(e => e.def.inert || e.state === 'disguise')) { e.noLoot = true; g.enemies.kill(e); }
      g.hud.toast(t('扇区已净化'));
      sfx.clear();
      g.projectiles.clearEnemyBullets();
      if (room.isBoss || room.kind === 'elite' || room.n <= 2 || rnd() < BALANCE.rooms.weaponDropChance) {
        g.interactables.spawnWeaponDrop(room.lootSpot.x, room.lootSpot.z);
      }
    }
    if (room.clearT > 0) {
      room.clearT -= dt;
      if (room.clearT <= 0) {
        if (room.isBoss && room.n === FINAL_SECTOR && !g.endless) g.victory();
        else this.afterClear();
      }
    }
  }

  // Challenge sectors: survive the timer while enemies keep pouring in, then everything dissolves.
  private updateChallenge(dt: number): void {
    const g = this.g, room = g.room;
    if (!room.cleared) {
      room.challengeT -= dt;
      this.challengeSpawnT -= dt;
      if (this.challengeSpawnT <= 0) {
        // spawns speed up as the clock runs down
        this.challengeSpawnT = 0.7 + 0.9 * (room.challengeT / 30);
        const s = room.rollSpawn();
        const [x, z] = room.findSpawn(g.player.pos, BALANCE.rooms.spawnMinDist, ENEMIES[s.kind].r);
        g.enemies.addMarker(s.kind, x, z, 0.75, s.count, s.elite);
      }
      if (room.challengeT <= 0) {
        g.enemies.purge();
        room.cleared = true;
        room.clearT = 1.2;
        g.hud.toast(t('挑战完成'));
        sfx.clear();
        g.projectiles.clearEnemyBullets();
      }
    }
    if (room.clearT > 0) {
      room.clearT -= dt;
      if (room.clearT <= 0) this.afterClear();
    }
  }

  // Between clearing a sector and the module pick: abyss mutations (and epoch rewards) come first.
  private afterClear(): void {
    const g = this.g, n = g.room.n;
    if (endlessRewards(g, n, () => this.openUpgrade())) return;
    if (!mutationDue(n)) { this.openUpgrade(); return; }
    const offer = offerMutations();
    this.openChoice(t('深渊异变 · 选择一个（之后一直生效）'), offer.map(m => ({ name: MUTATIONS[m].name, desc: MUTATIONS[m].desc, rarity: 'legendary' as const })), i => {
      addMutation(offer[i]);
      g.hud.toast(t('异变生效：{m}', { m: MUTATIONS[offer[i]].name }));
      this.openUpgrade();
    });
  }

  // A choice screen that isn't a module pick (mutations, abyss boons): same cards, custom outcome.
  openChoice(title: string, cards: { name: string; desc: string; rarity: Rarity }[], onPick: (i: number) => void): void {
    const g = this.g;
    g.state = 'upgrade';
    g.input.mouseDown = false;
    g.input.releaseTouch();
    g.hud.prompt(null);
    duck(true);
    this.custom = { n: cards.length, onPick };
    g.screens.showUpgrades(cards as unknown as UpgradeDef[], title, i => this.pickUpgrade(i));
  }

  // Open the exit portals: one per offered next sector, each with a floating label.
  private openPaths(): void {
    const g = this.g;
    const kinds = rollPaths(g.room.n + 1, g.room.kind);
    g.room.openPortals(kinds);
    for (const p of g.room.portals) {
      const info = ROOM_INFO[p.kind];
      const color = `#${info.color.toString(16).padStart(6, '0')}`;
      this.portalTags.push(g.floaters.addTag(p.pos.x, 0.3, p.pos.z + 1.9, `<b style="color:${color}">${info.name}</b><span class="price" style="color:#cfd8ef">${info.desc}</span>`));
    }
    sfx.portal();
    g.hud.toast(kinds.length > 1 ? t('选择下一个扇区') : t('裂隙通道已开启'));
  }

  private goThroughPortal(kind: RoomKind): void {
    const g = this.g;
    g.state = 'transition';
    sfx.portal();
    g.hud.fade(true, `SECTOR ${String(g.room.n + 1).padStart(2, '0')} // ${ROOM_INFO[kind].name}`);
    setTimeout(() => {
      this.enter(g.room.n + 1, kind);
      g.hud.fade(false);
      g.state = 'play';
    }, 550);
  }
}
