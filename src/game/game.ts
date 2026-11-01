import * as THREE from 'three';
import { initAudio, setVolume, sfx } from '../core/audio';
import { Graphics } from '../core/graphics';
import { t } from '../core/i18n';
import { Input } from '../core/input';
import { duck, setMood, setMusicVolume } from '../core/music';
import { seedFromString, seedRun, todayKey } from '../core/rng';
import { BALANCE } from '../data/balance';
import { DEPTH_CRYSTAL_BONUS, DEPTH_DESC, MODS, VICTORY_CRYSTALS, setDepth } from '../data/depth';
import type { RoomKind } from '../data/map';
import { MECHS, crystalsFor } from '../data/meta';
import { UPGRADES, type UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_SLOTS } from '../data/weapons';
import { Floaters } from '../ui/floaters';
import { Hud } from '../ui/hud';
import type { CodexKind } from '../ui/profile';
import { buildEntries, statLines } from '../ui/runStats';
import { clearRun, saveRun, type RunSave } from '../ui/runsave';
import { Screens } from '../ui/screens';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { loadBest } from '../ui/storage';
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

export type GameState = 'title' | 'play' | 'paused' | 'upgrade' | 'transition' | 'dead' | 'won';

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
  daily = false;
  depth = 0;                     // rift depth of the current run
  endless = false;               // kept going after clearing the final sector
  private comboT = 0;
  private crystalsAwarded = 0;   // crystals already paid out this run (at victory)
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
  readonly progress = new Progress();
  readonly sector = new SectorFlow(this);
  readonly menus = new Menus(this);
  private readonly tutorial = new Tutorial(this, this.progress.profile.seen, () => this.progress.save());

  private readonly clock = new THREE.Clock();
  private settings: Settings = loadSettings();

  constructor() {
    bindControls(this);
    this.screens.onClick('restartBtn', () => this.start(this.daily));
    this.screens.onClick('menuBtn', () => this.toTitle());
    this.screens.onClick('winContinue', () => this.continueEndless());
    this.screens.onClick('winMenu', () => this.toTitle());
    this.screens.onClick('resumeBtn', () => this.setPaused(false));
    this.screens.onClick('quitBtn', () => { duck(false); this.toTitle(); });
    this.screens.bindSettings(this.settings, s => {
      if (s.hints && !this.settings.hints) this.tutorial.reset();
      this.applySettings(s);
    });
    this.applySettings(this.settings);
    // browsers only start audio after a gesture: the first click or key on the title starts the menu music
    const wake = () => {
      initAudio();
      setMusicVolume(this.settings.music * this.settings.volume);
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
      else if (this.state === 'title') {
        this.time += dt;
        this.player.mesh.rotation.y = this.time * 0.6;
      }
      if (this.state !== 'paused' && this.state !== 'upgrade') {
        this.fx.update(dt);
        this.room.updatePortal(dt, this.time);
        this.atmosphere.update(dt, this.time, this.player.pos);
      }
      this.gfx.updateCamera(dt, this.player.pos, this.player.aim, this.fx.shakeAmt);
      this.fx.decayShake(dt);
      this.floaters.update(this.state === 'paused' || this.state === 'upgrade' ? 0 : dt);
      this.gfx.render(dt);
    };
    loop();
  }

  // New run, or resume `save` from the start of the sector it was taken in.
  start(daily: boolean, save?: RunSave): void {
    initAudio();
    const profile = this.progress.profile;
    this.daily = daily;
    this.depth = save ? save.depth : daily ? 0 : profile.depth;
    this.endless = save?.endless ?? false;
    this.crystalsAwarded = save?.crystalsAwarded ?? 0;
    setDepth(this.depth);
    const mech = MECHS[save?.mech ?? profile.selected] ?? MECHS.vanguard;
    this.player.reset(mech, profile.talents);
    this.hud.setSkill(mech.skillName);
    this.score = this.kills = this.coinsEarned = this.combo = this.bestCombo = this.bossKills = 0;
    this.comboT = this.runTime = 0;
    this.runId = Date.now();
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
      this.score = save.score;
      this.kills = save.kills;
      this.coinsEarned = save.coinsEarned;
      this.bestCombo = save.bestCombo;
      this.bossKills = save.bossKills;
      this.runTime = save.playTime;
    }
    this.hud.setBuffs(this.player.buffs);
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
      seedRun(daily ? seedFromString(`neon-rift:${todayKey()}`) : undefined);
      this.sector.enter(1, 'combat');
    }
    this.state = 'play';
  }

  // Snapshot taken on entering each sector; `seed` is the RNG state from before the sector was built.
  saveRunState(seed: number, room: number, kind: RoomKind): void {
    const p = this.player;
    saveRun({
      v: 1, daily: this.daily, dailyDate: todayKey(), depth: this.depth, endless: this.endless, seed, room, kind,
      score: this.score, kills: this.kills, coinsEarned: this.coinsEarned, bestCombo: this.bestCombo,
      bossKills: this.bossKills, crystalsAwarded: this.crystalsAwarded, playTime: this.runTime,
      mech: p.mechDef.id, hp: p.hp, coins: p.coins, revives: p.revives,
      slots: p.slots, weapon: p.weapon, upgrades: [...p.taken],
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
  }

  setPaused(paused: boolean): void {
    this.state = paused ? 'paused' : 'play';
    this.input.mouseDown = false;
    this.input.releaseTouch();
    duck(paused);
    if (paused) this.screens.showPause(statLines(this.player), buildEntries(this.player));
    else this.screens.toggle('pauseScreen', false);
    this.screens.setCrosshair(!paused);
  }

  // Continuous damage (acid) that ignores invulnerability frames and doesn't grant any.
  drainPlayer(amount: number): void {
    if (this.state !== 'play') return;
    this.player.hp -= amount * MODS.enemyDmg;
    if (this.player.hp <= 0) this.onLethal();
  }

  damagePlayer(dmg: number, from: THREE.Vector3 | null): void {
    const p = this.player;
    if (p.invuln > 0 || this.state !== 'play') return;
    if (p.shield > 0) {
      p.shield--;
      p.invuln = 0.6;
      sfx.shieldBlock();
      this.fx.burst({ x: p.pos.x, y: 0.8, z: p.pos.z }, 0x66ccff, 20, 8, 0.2, 0.5);
      this.hud.hurtFlash('blue');
      this.hud.toast(t('护盾抵挡'));
      return;
    }
    p.hp -= dmg * MODS.enemyDmg;
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
    this.perks.onKill(e);
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
    this.hud.setBuffs(this.player.buffs);
    sfx.pickup();
  }

  refreshWeapons(): void {
    for (const s of this.player.slots) this.discover('weapons', s.id);
    this.hud.renderWeapons(this.player.slots, this.player.weapon, MAX_WEAPON_SLOTS);
  }

  switchWeapon(i: number): void {
    if (this.player.setWeapon(i)) this.refreshWeapons();
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
    this.crystalsAwarded = crystals - VICTORY_CRYSTALS;
    pr.profile.crystals += crystals;
    pr.profile.wins++;
    this.recordRun(true);
    const unlocked = this.daily ? null : pr.unlockAfterWin(this.depth);
    if (this.daily) pr.recordDaily(this.score);
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
    this.time += dt;
    this.runTime += dt;
    this.room.time += dt;
    const coinsBefore = this.player.coins;
    this.player.update(dt, this);
    this.sector.spawnDue();
    this.enemies.update(dt);
    this.projectiles.update(dt);
    this.pickups.update(dt);
    this.interactables.update(dt);
    this.hazards.update(dt);
    this.perks.update(dt);
    this.tutorial.update(dt);
    setMood(this.enemies.boss ? 'boss' : this.room.cleared ? 'calm' : 'combat');
    this.sector.update(dt);
    this.coinsEarned += Math.max(0, this.player.coins - coinsBefore);

    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }

    const boss = this.enemies.boss;
    this.hud.update({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      shield: this.player.shield,
      dashReady: 1 - this.player.dashCd / this.player.dashCooldown,
      reload: this.player.reload,
      skillReady: this.player.skillReady,
      skillActive: this.player.skillT > 0,
      room: this.room.n,
      roomLabel: this.room.label,
      score: this.score,
      coins: this.player.coins,
      combo: this.combo,
      comboLeft: this.comboT / BALANCE.combo.window,
      bossHp: boss ? boss.hp / boss.maxHp : null,
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
    const crystals = this.runCrystals() - this.crystalsAwarded;
    pr.profile.crystals += crystals;
    this.recordRun(false);
    if (this.daily) pr.recordDaily(this.score);
    pr.save();
    const summary = {
      room: this.room.n, score: this.score, kills: this.kills, coins: this.coinsEarned,
      bestCombo: this.bestCombo, isNewBest, buffs: this.player.buffs, crystals, daily: this.daily, depth: this.depth,
    };
    setTimeout(() => this.screens.showGameOver(summary), 900);
  }

  // Crystals earned by the run so far, including the depth bonus.
  private runCrystals(): number {
    const base = crystalsFor({ score: this.score, room: this.room.n, bosses: this.bossKills });
    return Math.floor(base * (1 + this.depth * DEPTH_CRYSTAL_BONUS));
  }

  private recordRun(won: boolean): void {
    this.progress.recordRun({
      id: this.runId, date: todayKey(), mech: this.player.mechDef.id, depth: this.depth, daily: this.daily,
      won, room: this.room.n, score: this.score, kills: this.kills, time: Math.round(this.runTime),
    });
  }

  private continueEndless(): void {
    this.endless = true;
    this.screens.toggle('winScreen', false);
    this.hud.toast(t('无尽模式 · 继续深入'));
    this.sector.openUpgrade();
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    setVolume(s.volume);
    setMusicVolume(s.music * s.volume);
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
    this.player.mesh.visible = true;
    this.menus.refreshTitle();
    this.screens.toggle('titleScreen', true);
  }

  // Sector 1 with the selected mech spinning in the middle, behind the title screen.
  private buildBackdrop(): void {
    this.room.build(1, 'combat');
    this.atmosphere.build(this.room);
    this.player.setMech(MECHS[this.progress.profile.selected]);
    this.player.pos.set(0, 0, 3);
    this.player.mesh.position.copy(this.player.pos);
  }
}
