import * as THREE from 'three';
import { initAudio, setVolume, sfx } from '../core/audio';
import { Graphics } from '../core/graphics';
import { Input } from '../core/input';
import { rnd, seedFromString, seedRun, todayKey } from '../core/rng';
import { BALANCE } from '../data/balance';
import { ENEMIES } from '../data/enemies';
import { ROOM_INFO, rollPaths, type RoomKind } from '../data/map';
import { MECHS, TALENTS, crystalsFor, type MechId, type TalentId } from '../data/meta';
import { ROLL_WEIGHTS, UPGRADES, rollUpgrades, type UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_SLOTS } from '../data/weapons';
import { Floaters, type Tag } from '../ui/floaters';
import { Hud } from '../ui/hud';
import { Screens, type BuildEntry, type StatLine } from '../ui/screens';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { loadBest, saveBest } from '../ui/storage';
import { loadProfile, saveProfile, talentLevel, type Profile } from '../ui/profile';
import { Atmosphere } from './atmosphere';
import { Effects } from './effects';
import { Enemies, type Enemy } from './enemies';
import { Hazards } from './hazards';
import { Interactables } from './interactables';
import { Pickups } from './pickups';
import { Player } from './player';
import { Projectiles } from './projectiles';
import { Room } from './room';

export type GameState = 'title' | 'play' | 'paused' | 'upgrade' | 'transition' | 'dead';

const tmp = new THREE.Vector3();
const pct = (v: number) => `${Math.round(v * 100)}%`;

// Owns every system and runs the state machine:
// title -> play -> (room cleared) upgrade -> play -> (portal) transition -> play ... -> dead
export class Game {
  state: GameState = 'title';
  time = 0;
  score = 0;
  kills = 0;
  coinsEarned = 0;
  combo = 0;
  bestCombo = 0;
  private comboT = 0;

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

  private readonly clock = new THREE.Clock();
  private upgradeChoices: UpgradeDef[] = [];
  private settings: Settings = loadSettings();
  private portalTags: Tag[] = [];
  private profile: Profile = loadProfile();
  private daily = false;
  bossKills = 0;
  private challengeSpawnT = 0;

  constructor() {
    this.bindInput();
    this.screens.onClick('startBtn', () => this.start(false));
    this.screens.onClick('dailyBtn', () => this.start(true));
    this.screens.onClick('restartBtn', () => this.start(this.daily));
    this.screens.onClick('hangarBtn', () => this.openHangar());
    this.screens.onClick('hangarBack', () => this.closeHangar());
    this.screens.onClick('menuBtn', () => this.toTitle());
    this.refreshTitle();
    this.screens.onClick('resumeBtn', () => this.setPaused(false));
    this.screens.bindSettings(this.settings, s => this.applySettings(s));
    this.applySettings(this.settings);

    // backdrop for the title screen
    this.room.build(1, 'combat');
    this.atmosphere.build(this.room);
    this.player.setMech(MECHS[this.profile.selected]);
    this.player.pos.set(0, 0, 3);
    this.player.mesh.position.copy(this.player.pos);
  }

  run(): void {
    const loop = () => {
      requestAnimationFrame(loop);
      const dt = this.fx.consumeHitstop(Math.min(this.clock.getDelta(), 1 / 30));
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

  start(daily: boolean): void {
    initAudio();
    this.daily = daily;
    seedRun(daily ? seedFromString(`neon-rift:${todayKey()}`) : undefined);
    const mech = MECHS[this.profile.selected];
    this.player.reset(mech, this.profile.talents);
    this.hud.setSkill(mech.skillName);
    this.score = this.kills = this.coinsEarned = this.combo = this.bestCombo = this.bossKills = 0;
    this.comboT = 0;
    this.hud.setBuffs([]);
    this.hud.showBossBar(false);
    this.refreshWeapons();
    this.hud.showBest(loadBest());
    this.hud.show(true);
    this.screens.hideAll();
    this.screens.setCrosshair(true);
    this.enterRoom(1, 'combat');
    this.state = 'play';
  }

  setPaused(paused: boolean): void {
    this.state = paused ? 'paused' : 'play';
    this.input.mouseDown = false;
    if (paused) this.screens.showPause(this.statLines(), this.buildEntries());
    else this.screens.toggle('pauseScreen', false);
    this.screens.setCrosshair(!paused);
  }

  // Continuous damage (acid) that ignores invulnerability frames and doesn't grant any.
  drainPlayer(amount: number): void {
    if (this.state !== 'play') return;
    this.player.hp -= amount;
    if (this.player.hp <= 0) this.onLethal();
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
    this.hud.toast('复苏协议启动');
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
      this.hud.toast('护盾抵挡');
      return;
    }
    p.hp -= dmg;
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
    const reward = e.elite ? BALANCE.elites.reward : 1;
    this.score += Math.round(e.def.score * reward * (1 + Math.min(C.maxBonus, this.combo * C.scorePerKill)));
    if (this.player.leech) {
      this.player.heal(this.player.leech);
    }
    this.hud.hitMarker(true);
  }

  applyUpgrade(u: UpgradeDef): void {
    this.player.addUpgrade(u);
    this.hud.setBuffs(this.player.buffs);
    sfx.pickup();
  }

  refreshWeapons(): void {
    this.hud.renderWeapons(this.player.slots, this.player.weapon, MAX_WEAPON_SLOTS);
  }

  private applySettings(s: Settings): void {
    this.settings = s;
    saveSettings(s);
    setVolume(s.volume);
    this.fx.shakeScale = s.shake ? 1 : 0;
    this.floaters.enabled = s.damageNumbers;
  }

  private bindInput(): void {
    this.input.handlers = {
      onKeyDown: (k, repeat) => {
        if (this.state === 'play') {
          if (/^[1-9]$/.test(k)) this.switchWeapon(+k - 1);
          if (k === 'q') this.switchWeapon((this.player.weapon + 1) % this.player.slots.length);
          if (k === ' ' && !repeat) this.player.tryDash(this.input.moveDir(tmp), this);
          if (k === 'e' && !repeat) this.interactables.interact();
          if (k === 'f' && !repeat) this.player.trySkill(this);
          if (k === 'escape' || k === 'p') this.setPaused(true);
        } else if (this.state === 'paused' && (k === 'escape' || k === 'p')) {
          this.setPaused(false);
        } else if (this.state === 'upgrade' && /^[1-9]$/.test(k)) {
          this.pickUpgrade(+k - 1);
        }
      },
      onRightClick: () => { if (this.state === 'play') this.player.tryDash(this.input.moveDir(tmp), this); },
      onWheel: dir => {
        const n = this.player.slots.length;
        if (this.state === 'play') this.switchWeapon((this.player.weapon + dir + n) % n);
      },
      onBlur: () => { if (this.state === 'play') this.setPaused(true); },
    };
  }

  private switchWeapon(i: number): void {
    if (this.player.setWeapon(i)) this.refreshWeapons();
  }

  private update(dt: number): void {
    this.time += dt;
    this.room.time += dt;
    const coinsBefore = this.player.coins;
    this.player.update(dt, this);
    this.spawnDue();
    this.enemies.update(dt);
    this.projectiles.update(dt);
    this.pickups.update(dt);
    this.interactables.update(dt);
    this.hazards.update(dt);
    if (this.room.kind === 'challenge') this.updateChallenge(dt);
    else this.checkClear(dt);
    const path = this.state === 'play' ? this.room.portalReached(this.player.pos) : null;
    if (path) this.goThroughPortal(path);
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

  private spawnDue(): void {
    for (const s of this.room.takeDueSpawns()) {
      const [x, z] = ENEMIES[s.kind].boss
        ? [0, -this.room.hh * 0.45]
        : this.room.findSpawn(this.player.pos, BALANCE.rooms.spawnMinDist, ENEMIES[s.kind].r);
      this.enemies.addMarker(s.kind, x, z, ENEMIES[s.kind].boss ? 1.5 : 0.75, s.count, s.elite);
    }
  }

  private enterRoom(n: number, kind: RoomKind): void {
    for (const t of this.portalTags) this.floaters.removeTag(t);
    this.portalTags = [];
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.interactables.clear();
    this.fx.clear();
    this.floaters.clear();
    this.hazards.clear();
    this.room.build(n, kind);
    this.atmosphere.build(this.room);
    this.hazards.build();
    this.room.plan();
    this.player.pos.copy(this.room.entry);
    this.player.vel.set(0, 0, 0);
    this.player.shield = this.player.shieldMax;
    this.gfx.snapCamera(this.player.pos.x, this.player.pos.z);

    this.challengeSpawnT = 1;
    const name = ROOM_INFO[kind].name;
    if (kind === 'shop') {
      this.interactables.setupShop();
      this.openPaths();
      this.hud.toast('黑市终端 · 走近按 E 交易');
    } else if (kind === 'treasure') {
      this.interactables.setupTreasure();
      this.openPaths();
      this.hud.toast('数据宝库 · 免费拾取');
    } else if (kind === 'boss') {
      this.hud.toast('⚠ 裂隙核心');
    } else {
      this.hud.toast(kind === 'combat' ? `扇区 ${String(n).padStart(2, '0')}` : name);
    }
  }

  private checkClear(dt: number): void {
    const room = this.room;
    const waveSpawned = room.queue.length === 0 && this.enemies.pending === 0;
    const alive = this.enemies.list.length;
    // next wave once the current one is mostly dead
    if (!room.cleared && waveSpawned && room.hasMoreWaves && alive <= Math.max(2, Math.floor(room.waveSize * BALANCE.rooms.nextWaveAt))) {
      room.startWave(room.wave + 1);
      this.hud.toast(`WAVE ${room.wave + 1} / ${room.waves.length}`);
    }
    if (!room.cleared && waveSpawned && !room.hasMoreWaves && alive === 0 && this.hazards.openRifts === 0) {
      room.cleared = true;
      room.clearT = 0.9;
      this.hud.toast('扇区已净化');
      sfx.clear();
      this.projectiles.clearEnemyBullets();
      if (room.isBoss || room.kind === 'elite' || room.n <= 2 || rnd() < BALANCE.rooms.weaponDropChance) {
        this.interactables.spawnWeaponDrop(room.lootSpot.x, room.lootSpot.z);
      }
    }
    if (room.clearT > 0) {
      room.clearT -= dt;
      if (room.clearT <= 0) this.openUpgrade();
    }
  }

  private openUpgrade(): void {
    this.state = 'upgrade';
    this.input.mouseDown = false;
    this.hud.prompt(null);
    const kind = this.room.kind;
    const weights = kind === 'boss' || kind === 'elite' ? ROLL_WEIGHTS.boss : kind === 'challenge' ? ROLL_WEIGHTS.challenge : ROLL_WEIGHTS.room;
    const title = kind === 'boss' ? '核心战利品 · 选择一个模块' : kind === 'challenge' ? '挑战完成 · 选择一个模块' : '选择一个模块';
    this.upgradeChoices = rollUpgrades(this.player, BALANCE.rooms.upgradeChoices, weights);
    this.screens.showUpgrades(this.upgradeChoices, title, i => this.pickUpgrade(i));
  }

  private pickUpgrade(i: number): void {
    const u = this.upgradeChoices[i];
    if (!u || this.state !== 'upgrade') return;
    this.applyUpgrade(u);
    this.screens.toggle('upgradeScreen', false);
    this.screens.setCrosshair(true);
    this.state = 'play';
    this.openPaths();
  }

  // Open the exit portals: one per offered next sector, each with a floating label.
  private openPaths(): void {
    const kinds = rollPaths(this.room.n + 1, this.room.kind);
    this.room.openPortals(kinds);
    for (const p of this.room.portals) {
      const info = ROOM_INFO[p.kind];
      const color = `#${info.color.toString(16).padStart(6, '0')}`;
      this.portalTags.push(this.floaters.addTag(p.pos.x, 0.3, p.pos.z + 1.9, `<b style="color:${color}">${info.name}</b><span class="price" style="color:#cfd8ef">${info.desc}</span>`));
    }
    sfx.portal();
    this.hud.toast(kinds.length > 1 ? '选择下一个扇区' : '裂隙通道已开启');
  }

  // Challenge sectors: survive the timer while enemies keep pouring in, then everything dissolves.
  private updateChallenge(dt: number): void {
    const room = this.room;
    if (!room.cleared) {
      room.challengeT -= dt;
      this.challengeSpawnT -= dt;
      if (this.challengeSpawnT <= 0) {
        // spawns speed up as the clock runs down
        this.challengeSpawnT = 0.7 + 0.9 * (room.challengeT / 30);
        const s = room.rollSpawn();
        const [x, z] = room.findSpawn(this.player.pos, BALANCE.rooms.spawnMinDist, ENEMIES[s.kind].r);
        this.enemies.addMarker(s.kind, x, z, 0.75, s.count, s.elite);
      }
      if (room.challengeT <= 0) {
        this.enemies.purge();
        room.cleared = true;
        room.clearT = 1.2;
        this.hud.toast('挑战完成');
        sfx.clear();
        this.projectiles.clearEnemyBullets();
      }
    }
    if (room.clearT > 0) {
      room.clearT -= dt;
      if (room.clearT <= 0) this.openUpgrade();
    }
  }

  private goThroughPortal(kind: RoomKind): void {
    this.state = 'transition';
    sfx.portal();
    this.hud.fade(true, `SECTOR ${String(this.room.n + 1).padStart(2, '0')} // ${ROOM_INFO[kind].name}`);
    setTimeout(() => {
      this.enterRoom(this.room.n + 1, kind);
      this.hud.fade(false);
      this.state = 'play';
    }, 550);
  }

  private toTitle(): void {
    this.state = 'title';
    this.screens.hideAll();
    this.hud.show(false);
    this.hud.prompt(null);
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.interactables.clear();
    this.hazards.clear();
    for (const t of this.portalTags) this.floaters.removeTag(t);
    this.portalTags = [];
    this.room.build(1, 'combat');
    this.atmosphere.build(this.room);
    this.player.setMech(MECHS[this.profile.selected]);
    this.player.pos.set(0, 0, 3);
    this.player.mesh.position.copy(this.player.pos);
    this.player.mesh.visible = true;
    this.refreshTitle();
    this.screens.toggle('titleScreen', true);
  }

  private refreshTitle(): void {
    const d = this.profile.daily;
    const today = todayKey();
    this.screens.showTitleInfo(this.profile.crystals, MECHS[this.profile.selected].name, d && d.date === today ? d.best : null, today);
  }

  private openHangar(): void {
    this.screens.toggle('titleScreen', false);
    this.renderHangar();
    this.screens.toggle('hangarScreen', true);
  }

  private closeHangar(): void {
    this.screens.toggle('hangarScreen', false);
    this.player.setMech(MECHS[this.profile.selected]);
    this.refreshTitle();
    this.screens.toggle('titleScreen', true);
  }

  private renderHangar(): void {
    this.screens.showHangar(this.profile, {
      unlock: (id: MechId) => {
        const def = MECHS[id];
        if (this.profile.crystals < def.cost || this.profile.mechs.includes(id)) { sfx.denied(); return; }
        this.profile.crystals -= def.cost;
        this.profile.mechs.push(id);
        this.profile.selected = id;
        saveProfile(this.profile);
        sfx.buy();
        this.renderHangar();
      },
      select: (id: MechId) => {
        this.profile.selected = id;
        saveProfile(this.profile);
        this.player.setMech(MECHS[id]);
        sfx.pickup();
        this.renderHangar();
      },
      buy: (id: TalentId) => {
        const def = TALENTS.find(t => t.id === id)!;
        const lvl = talentLevel(this.profile, id);
        if (lvl >= def.max || this.profile.crystals < def.cost(lvl)) { sfx.denied(); return; }
        this.profile.crystals -= def.cost(lvl);
        this.profile.talents[id] = lvl + 1;
        saveProfile(this.profile);
        sfx.buy();
        this.renderHangar();
      },
    });
  }

  private statLines(): StatLine[] {
    const p = this.player, w = p.weaponDef;
    return [
      { label: '当前武器', value: `${w.name} Lv.${p.activeSlot.level}` },
      { label: '伤害倍率', value: `×${p.dmgMul.toFixed(2)}` },
      { label: '射速倍率', value: `×${p.fireRateMul.toFixed(2)}` },
      { label: '暴击率 / 暴击伤害', value: `${pct(p.critChance)} / ×${p.critMul.toFixed(1)}` },
      { label: '点燃 / 冰冻 / 闪电', value: `${pct(p.burnChance)} / ${pct(p.frostChance)} / ${pct(p.shockChance)}` },
      { label: '穿透 / 反弹 / 多重', value: `${p.pierce} / ${p.bounce} / ${p.extraShots}` },
      { label: '移动速度', value: p.speed.toFixed(1) },
      { label: '冲刺冷却', value: `${p.dashCooldown.toFixed(2)}s` },
      { label: '生命', value: `${Math.ceil(p.hp)} / ${p.maxHp}` },
      { label: '数据碎片', value: String(p.coins) },
    ];
  }

  private buildEntries(): BuildEntry[] {
    const out: BuildEntry[] = [];
    for (const [id, count] of this.player.upgradeCounts) {
      const u = UPGRADES.find(x => x.id === id);
      if (u) out.push({ name: u.name, desc: u.desc, rarity: u.rarity, count });
    }
    const order = { legendary: 0, rare: 1, common: 2 };
    return out.sort((a, b) => order[a.rarity] - order[b.rarity]);
  }

  private gameOver(): void {
    this.state = 'dead';
    this.input.mouseDown = false;
    this.hud.prompt(null);
    this.player.mesh.visible = false;
    this.fx.burst({ x: this.player.pos.x, y: 0.8, z: this.player.pos.z }, 0x4ff0ff, 60, 14, 0.3, 1.2);
    sfx.boom();
    this.fx.shake(1.2);
    const best = loadBest();
    const isNewBest = !best || this.score > best.score;
    if (isNewBest) saveBest({ room: this.room.n, score: this.score });
    const crystals = crystalsFor({ score: this.score, room: this.room.n, bosses: this.bossKills });
    this.profile.crystals += crystals;
    if (this.daily) {
      const today = todayKey();
      const prev = this.profile.daily?.date === today ? this.profile.daily.best : 0;
      this.profile.daily = { date: today, best: Math.max(prev, this.score) };
    }
    saveProfile(this.profile);
    const summary = {
      room: this.room.n, score: this.score, kills: this.kills, coins: this.coinsEarned,
      bestCombo: this.bestCombo, isNewBest, buffs: this.player.buffs, crystals, daily: this.daily,
    };
    setTimeout(() => this.screens.showGameOver(summary), 900);
  }
}
