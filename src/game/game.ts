import * as THREE from 'three';
import { initAudio, setVolume, sfx } from '../core/audio';
import { Graphics } from '../core/graphics';
import { Input } from '../core/input';
import { BALANCE } from '../data/balance';
import { ENEMIES } from '../data/enemies';
import { ROLL_WEIGHTS, UPGRADES, rollUpgrades, type UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_SLOTS } from '../data/weapons';
import { Floaters } from '../ui/floaters';
import { Hud } from '../ui/hud';
import { Screens, type BuildEntry, type StatLine } from '../ui/screens';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { loadBest, saveBest } from '../ui/storage';
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

  constructor() {
    this.bindInput();
    this.screens.onClick('startBtn', () => this.start());
    this.screens.onClick('restartBtn', () => this.start());
    this.screens.onClick('resumeBtn', () => this.setPaused(false));
    this.screens.bindSettings(this.settings, s => this.applySettings(s));
    this.applySettings(this.settings);

    // backdrop for the title screen
    this.room.build(1);
    this.atmosphere.build(this.room);
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

  start(): void {
    initAudio();
    this.player.reset();
    this.score = this.kills = this.coinsEarned = this.combo = this.bestCombo = 0;
    this.comboT = 0;
    this.hud.setBuffs([]);
    this.hud.showBossBar(false);
    this.refreshWeapons();
    this.hud.showBest(loadBest());
    this.hud.show(true);
    this.screens.hideAll();
    this.screens.setCrosshair(true);
    this.enterRoom(1);
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
    if (this.player.hp <= 0) this.gameOver();
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
    if (p.hp <= 0) this.gameOver();
  }

  onEnemyKilled(e: Enemy): void {
    const C = BALANCE.combo;
    this.kills++;
    this.combo++;
    this.comboT = C.window;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
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
    this.checkClear(dt);
    if (this.state === 'play' && this.room.portalReached(this.player.pos)) this.goThroughPortal();
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
      const [x, z] = s.kind === 'boss'
        ? [0, -this.room.hh * 0.45]
        : this.room.findSpawn(this.player.pos, BALANCE.rooms.spawnMinDist, ENEMIES[s.kind].r);
      this.enemies.addMarker(s.kind, x, z, s.kind === 'boss' ? 1.5 : 0.75, s.count, s.elite);
    }
  }

  private enterRoom(n: number): void {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.interactables.clear();
    this.fx.clear();
    this.floaters.clear();
    this.hazards.clear();
    this.room.build(n);
    this.atmosphere.build(this.room);
    this.hazards.build();
    this.room.plan();
    this.player.pos.copy(this.room.entry);
    this.player.vel.set(0, 0, 0);
    this.player.shield = this.player.shieldMax;
    this.gfx.snapCamera(this.player.pos.x, this.player.pos.z);

    if (this.room.kind === 'shop') {
      this.interactables.setupShop();
      this.room.openPortal(0, -this.room.hh + 3.5);
      this.hud.toast('黑市终端 · 走近按 E 交易');
    } else {
      this.hud.toast(this.room.isBoss ? '⚠ 裂隙核心' : `扇区 ${String(n).padStart(2, '0')}`);
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
      if (room.isBoss || room.n <= 2 || Math.random() < BALANCE.rooms.weaponDropChance) {
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
    const boss = this.room.isBoss;
    this.upgradeChoices = rollUpgrades(this.player, BALANCE.rooms.upgradeChoices, boss ? ROLL_WEIGHTS.boss : ROLL_WEIGHTS.room);
    this.screens.showUpgrades(this.upgradeChoices, boss ? '核心战利品 · 选择一个模块' : '选择一个模块', i => this.pickUpgrade(i));
  }

  private pickUpgrade(i: number): void {
    const u = this.upgradeChoices[i];
    if (!u || this.state !== 'upgrade') return;
    this.applyUpgrade(u);
    this.screens.toggle('upgradeScreen', false);
    this.screens.setCrosshair(true);
    this.state = 'play';
    this.room.openPortal();
    sfx.portal();
    this.hud.toast('裂隙通道已开启');
  }

  private goThroughPortal(): void {
    this.state = 'transition';
    sfx.portal();
    this.hud.fade(true, `SECTOR ${String(this.room.n + 1).padStart(2, '0')} // 跃迁中`);
    setTimeout(() => {
      this.enterRoom(this.room.n + 1);
      this.hud.fade(false);
      this.state = 'play';
    }, 550);
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
    const summary = {
      room: this.room.n, score: this.score, kills: this.kills, coins: this.coinsEarned,
      bestCombo: this.bestCombo, isNewBest, buffs: this.player.buffs,
    };
    setTimeout(() => this.screens.showGameOver(summary), 900);
  }
}
