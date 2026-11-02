import * as THREE from 'three';
import { initAudio, setVolume, sfx } from '../core/audio';
import { Graphics } from '../core/graphics';
import { t } from '../core/i18n';
import { Input } from '../core/input';
import { duck, setMood, setMusicStyle, setMusicVolume } from '../core/music';
import { seedRun, todayKey } from '../core/rng';
import { BALANCE } from '../data/balance';
import { DEPTH_CRYSTAL_BONUS, DEPTH_DESC, FINAL_SECTOR, MODS, VICTORY_CRYSTALS, setDepth } from '../data/depth';
import { TEST, TEST_SECTOR } from '../core/testMode';
import type { BossLogEntry } from '../data/bossPlan';
import type { RoomKind } from '../data/map';
import { enemyDmgMul } from '../data/scaling';
import { DEFAULT_MECH, MECHS, crystalsFor, type MechDef } from '../data/meta';
import { UPGRADES, type UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_SLOTS, WEAPONS } from '../data/weapons';
import { Floaters } from '../ui/floaters';
import { Hud } from '../ui/hud';
import type { CodexKind } from '../ui/profile';
import { buildEntries, effectEntries, keyTip, statLines, statusIcons, weaponEntries } from '../ui/runStats';
import { effectCard, effectList, weaponCard } from '../ui/screens';
import { clearRun, saveRun, type RunSave } from '../ui/runsave';
import { Screens } from '../ui/screens';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { loadBest } from '../ui/storage';
import { Arsenal } from './arsenal';
import { Ground } from './ground';
import { Lasers } from './lasers';
import { Portals } from './portals';
import { Clones } from './clones';
import { OrbitalFx } from './orbitalFx';
import { Intro } from './intro';
import { TitleScene } from './titleScene';
import { X } from './partsEndless';
import { enemyTimeScale } from './abyss';
import { abyss, ambientDarkness, lawDark, lawDmgMul, lawState, lawTick, rewardMul } from './abyss';
import { currentFusions, resetFusions } from './fusion';
import { applyBoon, type BoonId } from './epoch';
import { AFFIXES } from '../data/affixes';
import { Atmosphere } from './atmosphere';
import { bindControls, placePadCrosshair } from './controls';
import { Effects } from './effects';
import { Enemies, type Enemy } from './enemies';
import { Hazards } from './hazards';
import { Interactables } from './interactables';
import { Menus } from './menus';
import { Perks } from './perks';
import { Pickups } from './pickups';
import { Player } from './player';
import { Progress } from './progress';
import { Projectiles } from './projectiles';
import { Room } from './room';
import { SectorFlow } from './sector';
import { Tutorial } from './tutorial';

export type GameState = 'title' | 'intro' | 'play' | 'paused' | 'upgrade' | 'portal' | 'hangar' | 'transition' | 'dead' | 'won';

const tmp = new THREE.Vector3();

// Owns every system and runs the state machine:
// title -> play -> (room cleared) upgrade -> play -> (portal) transition -> play ... -> dead / won
// Sector flow lives in sector.ts, input routing in controls.ts, title menus in menus.ts,
// and everything saved to the profile in progress.ts.
export class Game {
  state: GameState = 'title';
  time = 0;

  // this run
  score = 0;
  kills = 0;
  coinsEarned = 0;
  combo = 0;
  bestCombo = 0;
  bossKills = 0;
  runTime = 0;                   // seconds played this run
  depth = 0;                     // rift depth of the current run
  quickToggle = false;           // gamepad Back toggles the quick view (Tab is held instead)
  private quickOpen = false;
  endless = false;               // kept going after clearing the final sector
  god = false;                   // test link: the player takes no damage
  bossLog: BossLogEntry[] = [];  // bosses fought this run, for picking random and twin bosses
  boons: BoonId[] = [];          // epoch boons taken this run
  private comboT = 0;
  private crystalsAwarded = 0;   // crystals already paid out this run (on entering a shop, at victory)
  private runId = 0;

  readonly gfx = new Graphics();
  readonly hud = new Hud();
  readonly screens = new Screens();
  readonly floaters = new Floaters(this.gfx.camera);
  readonly input = new Input(this.gfx.renderer.domElement, this.screens.crosshair);
  readonly fx = new Effects(this.gfx.scene);
  readonly room = new Room(this.gfx.scene);
  readonly atmosphere = new Atmosphere(this.gfx.scene);
  readonly player = new Player(this.gfx.scene);
  readonly enemies = new Enemies(this);
  readonly projectiles = new Projectiles(this);
  readonly pickups = new Pickups(this);
  readonly interactables = new Interactables(this);
  readonly hazards = new Hazards(this);
  readonly perks = new Perks(this);
  readonly arsenal = new Arsenal(this);
  readonly ground = new Ground(this);
  readonly lasers = new Lasers(this);
  readonly portals = new Portals(this);
  readonly clones = new Clones(this);
  readonly orbital = new OrbitalFx(this);
  private readonly intro = new Intro(this);
  private introClick = false;  // the mouse was already down (a click skips only once)
  private readonly titleScene = new TitleScene(this);
  slippery = false;              // the whole floor is ice (abyss law)
  darkness = 0;                  // 0..1 how dark the arena is around the player (light eaters, the eye, laws)
  ambientDark = 0;               // darkness that doesn't come from light eaters (eye boss, abyss rules)
  readonly progress = new Progress();
  readonly sector = new SectorFlow(this);
  readonly menus = new Menus(this);
  private readonly tutorial = new Tutorial(this, this.progress.profile.seen, () => this.progress.save());

  private readonly clock = new THREE.Clock();
  private settings: Settings = loadSettings();

  constructor() {
    bindControls(this);
    this.screens.onClick('restartBtn', () => this.start());
    this.screens.onClick('portalGo', () => this.sector.answerPortal(true));
    this.screens.onClick('portalStay', () => this.sector.answerPortal(false));
    this.screens.onClick('menuBtn', () => this.toTitle());
    this.screens.onClick('winContinue', () => this.continueEndless());
    this.screens.onClick('winMenu', () => this.toTitle());
    this.screens.onClick('resumeBtn', () => this.setPaused(false));
    this.screens.onClick('quitBtn', () => { duck(false); this.toTitle(); });
    this.screens.bindSettings(this.settings, s => {
      if (s.hints && !this.settings.hints) this.tutorial.reset();
      this.applySettings({ ...this.settings, ...s });
    });
    this.applySettings(this.settings);
    this.hud.tipSource = key => this.hotbarTip(key);
    for (const id of ['musicBtn', 'musicBtnTitle']) this.screens.onClick(id, () => this.toggleMusic());
    // browsers only start audio after a gesture: the first click or key on the title starts the menu music
    const wake = () => {
      initAudio();
      setMusicVolume(this.musicLevel());
      if (this.state === 'title') setMood('menu');
      removeEventListener('pointerdown', wake);
      removeEventListener('keydown', wake);
    };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);
    this.buildBackdrop();
  }

  run(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.fx.consumeHitstop(Math.min(this.clock.getDelta(), 1 / 30));
      this.input.pollGamepad();
      document.body.classList.toggle('playing', this.state === 'play');
      if (this.input.usingPad && this.state === 'play') placePadCrosshair(this);
      if (this.state === 'play') this.update(dt);
      else if (this.state === 'transition') this.sector.updateFall(dt);
      else if (this.state === 'intro') {
        if (this.input.mouseDown && !this.introClick) this.skipIntro();
        this.introClick = this.input.mouseDown;
        if (this.intro.update(dt)) this.endIntro();
      }
      else if (this.state === 'title') {
        this.time += dt;
        this.titleScene.update(dt);
      }
      const frozen = this.state === 'paused' || this.state === 'upgrade' || this.state === 'portal' || this.state === 'hangar';
      if (!frozen) {
        this.fx.update(dt);
        this.room.updatePortal(dt, this.time);
        this.atmosphere.update(dt, this.time, this.player.pos);
      }
      this.updateQuickView();
      // the title scene and the deployment drop run their own camera
      if (this.state !== 'title' && this.state !== 'intro') this.gfx.updateCamera(dt, this.player.pos, this.player.aim, this.fx.shakeAmt);
      this.fx.decayShake(dt);
      this.floaters.update(frozen ? 0 : dt);
      this.gfx.render(dt);
    };
    loop();
  }

  // New run, or resume `save` from the start of the sector it was taken in.
  start(save?: RunSave): void {
    initAudio();
    this.titleScene.show(false);
    const profile = this.progress.profile;
    this.depth = save ? save.depth : profile.depth;
    this.endless = save?.endless ?? false;
    this.crystalsAwarded = save?.crystalsAwarded ?? 0;
    setDepth(this.depth);
    const mech = MECHS[save?.mech ?? profile.selected] ?? MECHS[DEFAULT_MECH];
    this.player.reset(mech, profile.talents);
    this.hud.setSkill(mech.skill, mech.skillName);
    this.score = this.kills = this.coinsEarned = this.combo = this.bestCombo = this.bossKills = 0;
    this.comboT = this.runTime = 0;
    this.runId = Date.now();
    this.bossLog = save?.bosses ?? [];
    abyss.mutations = [...(save?.mutations ?? [])];
    lawState.law = save?.law ?? null;
    lawState.t = 0;
    resetFusions(save?.fusions ?? []);
    this.boons = [];
    if (save) {
      for (const id of save.upgrades) {
        const u = UPGRADES.find(x => x.id === id);
        if (u) this.player.addUpgrade(u);
      }
      const p = this.player;
      p.hp = Math.min(save.hp, p.maxHp);
      p.coins = save.coins;
      p.revives = save.revives;
      p.restoreSlots(save.slots, save.weapon);
      for (const b of save.boons ?? []) { this.boons.push(b); applyBoon(this, b); }
      p.hp = Math.min(save.hp, p.maxHp);
      this.score = save.score;
      this.kills = save.kills;
      this.coinsEarned = save.coinsEarned;
      this.bestCombo = save.bestCombo;
      this.bossKills = save.bossKills;
      this.runTime = save.playTime;
    }
    this.hud.setModules(buildEntries(this.player));
    this.hud.showBossBar(false);
    this.refreshWeapons();
    this.hud.showBest(loadBest());
    this.hud.show(true);
    this.screens.hideAll();
    this.screens.setCrosshair(true);
    if (save) {
      seedRun(save.seed);
      this.sector.enter(save.room, save.kind);
      this.hud.toast(t('继续 · 扇区 {n}', { n: String(save.room).padStart(2, '0') }));
    } else {
      seedRun();
      const first = TEST ? TEST_SECTOR : 1;  // test link can start deeper (`&sector=N`)
      this.endless = first > FINAL_SECTOR;
      this.sector.enter(first, 'combat');
    }
    this.beginIntro();
  }

  // Every run starts with the deployment drop (intro.ts); the game waits until it lands.
  private beginIntro(): void {
    this.state = 'intro';
    this.introClick = this.input.mouseDown;
    this.hud.show(false);
    this.screens.setCrosshair(false);
    this.intro.begin();
  }

  skipIntro(): void {
    if (this.state === 'intro') this.intro.skip();
  }

  private endIntro(): void {
    this.state = 'play';
    this.hud.show(true);
    this.screens.setCrosshair(true);
    this.gfx.snapCamera(this.player.pos.x, this.player.pos.z);
  }

  // Snapshot taken on entering each sector; `seed` is the RNG state from before the sector was built.
  saveRunState(seed: number, room: number, kind: RoomKind): void {
    const p = this.player;
    saveRun({
      v: 1, depth: this.depth, endless: this.endless, seed, room, kind,
      score: this.score, kills: this.kills, coinsEarned: this.coinsEarned, bestCombo: this.bestCombo,
      bossKills: this.bossKills, crystalsAwarded: this.crystalsAwarded, playTime: this.runTime,
      mech: p.mechDef.id, hp: p.hp, coins: p.coins, revives: p.revives,
      slots: p.slots, weapon: p.weapon, upgrades: [...p.taken], bosses: this.bossLog, mutations: [...abyss.mutations],
      law: lawState.law, fusions: currentFusions(), boons: [...this.boons],
    });
  }

  // Remove every enemy, shot, pickup, hazard and portal label from the current sector.
  clearWorld(): void {
    this.sector.clear();
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.interactables.clear();
    this.hazards.clear();
    this.perks.clear();
    this.arsenal.clear();
    this.ground.clear();
    this.lasers.clear();
    this.portals.clear();
    this.clones.clear();
    this.orbital.clear();
  }

  setPaused(paused: boolean): void {
    this.state = paused ? 'paused' : 'play';
    this.input.mouseDown = false;
    this.input.releaseTouch();
    duck(paused);
    if (paused) this.screens.showPause(statLines(this.player), weaponEntries(this.player), effectEntries(this.player, this.boons));
    else this.screens.toggle('pauseScreen', false);
    this.screens.setCrosshair(!paused);
  }

  // Continuous damage (acid) that ignores invulnerability frames and doesn't grant any.
  drainPlayer(amount: number): void {
    if (this.state !== 'play' || this.god || this.player.barrierUp) return;
    this.player.hp -= amount * MODS.enemyDmg * enemyDmgMul(this.room.n);
    if (this.player.hp <= 0) this.onLethal();
  }

  damagePlayer(dmg: number, from: THREE.Vector3 | null): void {
    const p = this.player;
    if (p.invuln > 0 || this.state !== 'play' || this.god) return;
    if (p.shield > 0) {
      p.shield--;
      p.invuln = 0.6;
      sfx.shieldBlock();
      this.fx.burst({ x: p.pos.x, y: 0.8, z: p.pos.z }, 0x66ccff, 20, 8, 0.2, 0.5);
      this.hud.hurtFlash('blue');
      this.hud.toast(t('护盾抵挡'));
      return;
    }
    p.hp -= dmg * MODS.enemyDmg * enemyDmgMul(this.room.n) * lawDmgMul();
    p.invuln = BALANCE.player.hurtInvuln;
    this.combo = 0;
    this.fx.shake(0.55);
    this.fx.hitstop(0.08);
    sfx.hurt();
    if (from) {
      tmp.set(p.pos.x - from.x, 0, p.pos.z - from.z).normalize();
      p.vel.addScaledVector(tmp, BALANCE.player.hurtKnockback);
    }
    this.fx.burst({ x: p.pos.x, y: 0.8, z: p.pos.z }, 0x4ff0ff, 12, 7);
    this.hud.hurtFlash();
    if (p.hp <= 0) this.onLethal();
  }

  onEnemyKilled(e: Enemy): void {
    const C = BALANCE.combo;
    this.kills++;
    this.combo++;
    this.comboT = C.window;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    if (e.def.boss) this.bossKills++;
    const every = this.player.mechDef.killCdEvery;
    if (every && this.kills % every === 0) this.player.skillCd -= 1;  // legendary passive
    this.perks.onKill(e);
    if (!this.enemies.purging) this.arsenal.onKill(e);
    if (e.noLoot) return;  // replicator copies and split-offs
    if (!e.def.boss && !this.enemies.purging) this.interactables.rollKillDrop(e.pos.x, e.pos.z, e.def.cost, e.elite);
    const reward = e.elite ? BALANCE.elites.reward : 1;
    this.score += Math.round(e.def.score * reward * (1 + Math.min(C.maxBonus, this.combo * C.scorePerKill)));
    if (this.player.leech) {
      this.player.heal(this.player.leech);
    }
    this.hud.hitMarker(true);
  }

  discover(kind: CodexKind, id: string): void {
    this.progress.discover(kind, id);
  }

  applyUpgrade(u: UpgradeDef): void {
    this.discover('upgrades', u.id);
    this.player.addUpgrade(u);
    this.hud.setModules(buildEntries(this.player));
    sfx.pickup();
  }

  refreshWeapons(): void {
    for (const s of this.player.slots) this.discover('weapons', s.id);
    this.hud.renderWeapons(this.player.slots, this.player.weapon, MAX_WEAPON_SLOTS);
  }

  switchWeapon(i: number): void {
    if (this.player.setWeapon(i)) {
      this.arsenal.clearLocks();
      this.refreshWeapons();
    }
  }

  // Final sector cleared: pay out, unlock the next depth, and offer to keep going (endless).
  victory(): void {
    this.state = 'won';
    clearRun();
    this.tutorial.hide();
    setMood('menu');
    this.input.mouseDown = false;
    this.hud.prompt(null);
    const pr = this.progress;
    const crystals = this.runCrystals() + VICTORY_CRYSTALS;
    this.bankCrystals();
    pr.profile.crystals += VICTORY_CRYSTALS;
    pr.profile.wins++;
    this.recordRun(true);
    const unlocked = pr.unlockAfterWin(this.depth);
    pr.save();
    pr.recordBest(this.room.n, this.score);
    sfx.levelUp();
    this.fx.burst({ x: this.player.pos.x, y: 1, z: this.player.pos.z }, 0xffc83d, 60, 12, 0.3, 1.2);
    this.screens.showVictory({
      score: this.score, kills: this.kills, bestCombo: this.bestCombo, crystals, depth: this.depth,
      unlocked, unlockedDesc: unlocked !== null ? DEPTH_DESC[unlocked] : '', buffs: this.player.buffs,
    });
  }

  private update(dt: number): void {
    this.ambientDark = ambientDarkness() + lawDark();  // raised again below by whatever is darkening the arena this frame
    lawTick(this, dt);
    this.time += dt;
    this.runTime += dt;
    this.room.time += dt;
    const coinsBefore = this.player.coins;
    this.player.update(dt, this);
    this.sector.spawnDue();
    this.enemies.update(dt * enemyTimeScale());
    this.projectiles.update(dt);
    this.pickups.update(dt);
    this.interactables.update(dt);
    this.hazards.update(dt);
    this.perks.update(dt);
    this.arsenal.update(dt);
    this.ground.update(dt);
    this.lasers.update(dt);
    this.portals.update(dt);
    this.clones.update(dt);
    this.tutorial.update(dt);
    setMood(this.enemies.boss ? 'boss' : this.room.cleared ? 'calm' : 'combat');
    this.sector.update(dt);
    this.coinsEarned += Math.max(0, this.player.coins - coinsBefore);

    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    const bosses = this.enemies.bosses, p = this.player;
    const tags: { x: number; y: number; key: string; html: string }[] = [];
    for (const e of this.enemies.list) {
      if (!e.affixes.length || !e.mesh.visible) continue;
      const at = tmp.set(e.pos.x, e.def.y + e.r * 1.6 + 0.4, e.pos.z).project(this.gfx.camera);
      const key = e.affixes.join();
      tags.push({
        x: (at.x + 1) / 2 * innerWidth, y: (1 - at.y) / 2 * innerHeight, key,
        html: e.affixes.map(a => `<i style="color:#${AFFIXES[a].color.toString(16).padStart(6, '0')}">${AFFIXES[a].name}</i>`).join(''),
      });
    }
    this.hud.tags(tags);
    // darkness: standing in a light eater's aura (the eye boss and abyss rules add their own)
    const inShade = this.enemies.list.some(e => e.def.parts?.special === 'darkAura' && e.hp > 0 && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < X.darkR * (e.variant ? 0.6 + 0.4 * e.charge : 1));
    this.darkness += ((inShade ? 0.6 : 0) + this.ambientDark - this.darkness) * Math.min(1, dt * 4);
    const ps = tmp.set(p.pos.x, 1, p.pos.z).project(this.gfx.camera);
    this.hud.darkness(this.darkness, (ps.x + 1) / 2 * innerWidth, (1 - ps.y) / 2 * innerHeight);
    // gauge sits on the ground just in front of (below, on screen) the mech's feet
    const sp = tmp.set(p.pos.x, 0, p.pos.z + 1.2).project(this.gfx.camera);
    this.hud.mechGauge((sp.x + 1) / 2 * innerWidth, (1 - sp.y) / 2 * innerHeight, {
      dashCd: Math.max(0, p.dashCd), dashTotal: p.dashCooldown, skillCd: Math.max(0, p.skillCd), skillT: Math.max(0, p.skillT), skillDur: p.skillDur,
    });
    this.hud.update({
      hp: p.hp,
      maxHp: p.maxHp,
      shield: p.shield,
      dashCd: Math.max(0, p.dashCd),
      dashTotal: p.dashCooldown,
      skillCd: Math.max(0, p.skillCd),
      skillTotal: p.mechDef.skillCd,
      skillActive: p.skillT > 0,
      ring: p.reloadProgress !== null ? { p: p.reloadProgress, kind: 'reload' }
        : p.charge > 0 ? { p: p.charge / p.chargeTime, kind: 'charge' }
        : p.locks.length > 0 ? { p: p.locks.length / Math.max(1, p.maxLocks), kind: 'charge' }
        : p.heat > 0 ? { p: p.heat, kind: 'heat' } : null,
      slots: p.slots,
      magSize: s => p.magSize(s.id, s.level),
      pulse: p.pulseRhythm,
      statuses: statusIcons(p),
      room: this.room.n,
      roomLabel: this.room.label,
      score: this.score,
      coins: this.player.coins,
      combo: this.combo,
      comboLeft: this.comboT / BALANCE.combo.window,
      bossHp: bosses.length ? bosses.reduce((s, b) => s + Math.max(0, b.hp), 0) / bosses.reduce((s, b) => s + b.maxHp, 0) : null,
    });
  }

  // Out of HP: use the revive protocol if available, otherwise the run ends.
  private onLethal(): void {
    const p = this.player;
    if (p.revives <= 0) { this.gameOver(); return; }
    p.revives--;
    p.hp = p.maxHp * 0.5;
    p.invuln = 2;
    this.projectiles.clearEnemyBulletsNear(p.pos, 8);
    this.fx.burst({ x: p.pos.x, y: 1, z: p.pos.z }, 0x55ff99, 40, 10, 0.25, 0.8);
    this.fx.shockwave(p.pos.x, p.pos.z, 6, 0x55ff99);
    sfx.levelUp();
    this.hud.toast(t('复苏协议启动'));
  }

  private gameOver(): void {
    this.state = 'dead';
    clearRun();
    this.tutorial.hide();
    this.perks.clear();
    setMood('off');
    this.input.mouseDown = false;
    this.hud.prompt(null);
    this.player.mesh.visible = false;
    this.fx.burst({ x: this.player.pos.x, y: 0.8, z: this.player.pos.z }, 0x4ff0ff, 60, 14, 0.3, 1.2);
    sfx.boom();
    this.fx.shake(1.2);
    const pr = this.progress;
    const isNewBest = pr.recordBest(this.room.n, this.score);
    const crystals = this.runCrystals();  // shown as the run's total; only the part not banked yet is paid now
    this.bankCrystals();
    this.recordRun(false);
    pr.save();
    const summary = {
      room: this.room.n, score: this.score, kills: this.kills, coins: this.coinsEarned,
      bestCombo: this.bestCombo, isNewBest, buffs: this.player.buffs, crystals, depth: this.depth,
    };
    setTimeout(() => this.screens.showGameOver(summary), 900);
  }

  // Pay out the crystals earned so far that haven't been paid yet (so the hangar terminal can spend them).
  bankCrystals(): void {
    const due = this.runCrystals() - this.crystalsAwarded;
    if (due <= 0) return;
    this.progress.profile.crystals += due;
    this.crystalsAwarded += due;
    this.progress.save();
  }

  // Rebuild the player mid-run after a mech switch or a talent bought at the hangar terminal: a fresh
  // mech with the current talents, then modules, weapons and boons replayed the way a run save restores
  // them. Switching mechs swaps the starter weapon (keeping its level) and keeps the HP fraction.
  rebuildPlayer(mech: MechDef): void {
    const p = this.player, prev = p.mechDef;
    const hp = p.hp, maxHp = p.maxHp, coins = p.coins, revives = p.revives, shield = p.shield;
    const pos = p.pos.clone(), aim = p.aim.clone(), taken = [...p.taken];
    let slots = p.slots.map(s => ({ ...s })), weapon = p.weapon;
    p.reset(mech, this.progress.profile.talents);
    for (const id of taken) {
      const u = UPGRADES.find(x => x.id === id);
      if (u) p.addUpgrade(u);
    }
    if (mech !== prev) {
      const [old, ...rest] = slots;
      const dup = rest.find(s => s.id === mech.starter);
      const others = rest.filter(s => s !== dup);
      const level = Math.max(old.level, dup?.level ?? 1);
      slots = [{ id: mech.starter, level, mag: p.magSize(mech.starter, level), reserve: 0 }, ...others];
      // the old starter stays as a regular weapon if there's room
      if (slots.length < MAX_WEAPON_SLOTS) slots.push({ id: old.id, level: old.level, mag: old.mag, reserve: WEAPONS[old.id].reserve });
      weapon = 0;
    }
    p.restoreSlots(slots, weapon);
    for (const b of this.boons) applyBoon(this, b);
    p.hp = mech !== prev ? Math.max(1, Math.round(hp / maxHp * p.maxHp)) : Math.max(1, Math.min(p.maxHp, hp + p.maxHp - maxHp));
    p.coins = coins;
    p.revives = revives;
    p.shield = mech !== prev ? p.shieldMax : Math.min(shield, p.shieldMax);
    p.pos.copy(pos);
    p.aim.copy(aim);
    this.hud.setSkill(mech.skill, mech.skillName);
    this.hud.setModules(buildEntries(p));
    this.refreshWeapons();
  }

  // Crystals earned by the run so far, including the depth bonus.
  private runCrystals(): number {
    const base = crystalsFor({ score: this.score, room: this.room.n, bosses: this.bossKills });
    return Math.floor(base * (1 + this.depth * DEPTH_CRYSTAL_BONUS) * rewardMul());
  }

  private recordRun(won: boolean): void {
    this.progress.recordRun({
      id: this.runId, date: todayKey(), mech: this.player.mechDef.id, depth: this.depth,
      won, room: this.room.n, score: this.score, kills: this.kills, time: Math.round(this.runTime),
    });
  }

  private continueEndless(): void {
    this.endless = true;
    this.screens.toggle('winScreen', false);
    this.hud.toast(t('无尽模式 · 继续深入'));
    this.sector.openUpgrade();
  }

  // Hover text for the hotbar (weapon slots, module and status tiles, dash and skill keys).
  private hotbarTip(key: string): string | null {
    const p = this.player, [kind, n] = key.split(':'), i = Number(n);
    if (kind === 'dash' || kind === 'skill') return keyTip(p, kind);
    if (kind === 'weapon') { const w = weaponEntries(p)[i]; return w ? weaponCard(w) : null; }
    if (kind === 'mod') { const e = effectEntries(p, [])[i]; return e ? effectCard(e) : null; }
    if (kind === 'status') return statusIcons(p)[i]?.tip ?? null;
    return null;
  }

  // Held Tab (or the gamepad's Back button, toggled): weapons and effects without pausing.
  private updateQuickView(): void {
    const want = this.state === 'play' && (this.input.keys.has('tab') || this.quickToggle);
    if (want === this.quickOpen) return;
    this.quickOpen = want;
    this.hud.quickView(want
      ? `<div class="panel"><h3>${t('武装')}</h3>${weaponEntries(this.player).map(weaponCard).join('')}</div>` +
        `<div class="panel"><h3>${t('模块与效果')}</h3>${effectList(effectEntries(this.player, this.boons))}</div>`
      : null);
  }

  private musicLevel(): number {
    const s = this.settings;
    return s.musicOn ? s.music * s.volume : 0;
  }

  toggleMusic(): void {
    this.applySettings({ ...this.settings, musicOn: !this.settings.musicOn });
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    setVolume(s.volume);
    setMusicStyle(s.musicStyle);
    setMusicVolume(this.musicLevel());
    this.screens.showMusic(s.musicOn);
    this.fx.shakeScale = s.shake ? 1 : 0;
    this.floaters.enabled = s.damageNumbers;
    this.tutorial.enabled = s.hints;
    if (!s.hints) this.tutorial.hide();
  }

  private toTitle(): void {
    this.state = 'title';
    this.tutorial.hide();
    setMood('menu');
    this.screens.hideAll();
    this.hud.show(false);
    this.hud.prompt(null);
    this.clearWorld();
    this.buildBackdrop();
    this.menus.refreshTitle();
    this.screens.toggle('titleScreen', true);
  }

  // Behind the title screen: the hangar scene (titleScene.ts). Sector 1 is built too, out of view,
  // so the arena is ready when a run starts.
  private buildBackdrop(): void {
    this.room.build(1, 'combat');
    this.atmosphere.build(this.room);
    this.player.setMech(MECHS[this.progress.profile.selected]);
    this.player.pos.set(0, 0, 3);
    this.player.mesh.position.copy(this.player.pos);
    this.player.mesh.visible = false;
    this.titleScene.show(true);
  }
}
