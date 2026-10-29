import * as THREE from 'three';
import { initAudio, sfx } from '../core/audio';
import { Graphics } from '../core/graphics';
import { Input } from '../core/input';
import { shuffled } from '../core/math';
import { BALANCE } from '../data/balance';
import { ENEMIES } from '../data/enemies';
import { UPGRADES, type UpgradeDef } from '../data/upgrades';
import { WEAPONS } from '../data/weapons';
import { Hud } from '../ui/hud';
import { Screens } from '../ui/screens';
import { loadBest, saveBest } from '../ui/storage';
import { Effects } from './effects';
import { Enemies } from './enemies';
import { Pickups } from './pickups';
import { Player } from './player';
import { Projectiles } from './projectiles';
import { Room } from './room';

export type GameState = 'title' | 'play' | 'paused' | 'upgrade' | 'transition' | 'dead';

const tmp = new THREE.Vector3();

// Owns every system and runs the state machine:
// title -> play -> (room cleared) upgrade -> play -> (portal) transition -> play ... -> dead
export class Game {
  state: GameState = 'title';
  time = 0;
  score = 0;

  readonly gfx = new Graphics();
  readonly hud = new Hud();
  readonly screens = new Screens();
  readonly input = new Input(this.gfx.renderer.domElement, this.screens.crosshair);
  readonly fx = new Effects(this.gfx.scene);
  readonly room = new Room(this.gfx.scene);
  readonly player = new Player(this.gfx.scene);
  readonly enemies = new Enemies(this);
  readonly projectiles = new Projectiles(this);
  readonly pickups = new Pickups(this);

  private readonly clock = new THREE.Clock();
  private upgradeChoices: UpgradeDef[] = [];

  constructor() {
    this.bindInput();
    this.screens.onClick('startBtn', () => this.start());
    this.screens.onClick('restartBtn', () => this.start());
    this.screens.onClick('resumeBtn', () => this.setPaused(false));

    // backdrop for the title screen
    this.room.build(1);
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
      }
      this.gfx.updateCamera(dt, this.player.pos, this.player.aim, this.fx.shakeAmt);
      this.fx.decayShake(dt);
      this.gfx.render(dt);
    };
    loop();
  }

  start(): void {
    initAudio();
    this.player.reset();
    this.score = 0;
    this.hud.setBuffs([]);
    this.hud.showBossBar(false);
    this.hud.renderWeapons(WEAPONS, 0);
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
    this.screens.toggle('pauseScreen', paused);
    this.screens.setCrosshair(!paused);
  }

  damagePlayer(dmg: number, from: THREE.Vector3 | null): void {
    const p = this.player;
    if (p.invuln > 0 || this.state !== 'play') return;
    p.hp -= dmg;
    p.invuln = BALANCE.player.hurtInvuln;
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

  private bindInput(): void {
    const n = WEAPONS.length;
    this.input.handlers = {
      onKeyDown: (k, repeat) => {
        if (this.state === 'play') {
          if (/^[1-9]$/.test(k) && +k <= n) this.switchWeapon(+k - 1);
          if (k === 'q') this.switchWeapon((this.player.weapon + 1) % n);
          if (k === ' ' && !repeat) this.player.tryDash(this.input.moveDir(tmp));
          if (k === 'escape' || k === 'p') this.setPaused(true);
        } else if (this.state === 'paused' && (k === 'escape' || k === 'p')) {
          this.setPaused(false);
        } else if (this.state === 'upgrade' && /^[1-9]$/.test(k)) {
          this.pickUpgrade(+k - 1);
        }
      },
      onRightClick: () => { if (this.state === 'play') this.player.tryDash(this.input.moveDir(tmp)); },
      onWheel: dir => { if (this.state === 'play') this.switchWeapon((this.player.weapon + dir + n) % n); },
      onBlur: () => { if (this.state === 'play') this.setPaused(true); },
    };
  }

  private switchWeapon(i: number): void {
    if (this.player.setWeapon(i)) this.hud.renderWeapons(WEAPONS, i);
  }

  private update(dt: number): void {
    this.time += dt;
    this.room.time += dt;
    this.player.update(dt, this);
    this.spawnDue();
    this.enemies.update(dt);
    this.projectiles.update(dt);
    this.pickups.update(dt);
    this.checkClear(dt);
    if (this.state === 'play' && this.room.portalReached(this.player.pos)) this.goThroughPortal();

    const boss = this.enemies.boss;
    this.hud.update({
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      dashReady: 1 - this.player.dashCd / this.player.dashCooldown,
      room: this.room.n,
      score: this.score,
      bossHp: boss ? boss.hp / boss.maxHp : null,
    });
  }

  private spawnDue(): void {
    for (const s of this.room.takeDueSpawns()) {
      const [x, z] = s.kind === 'boss'
        ? [0, -this.room.hh * 0.45]
        : this.room.findSpawn(this.player.pos, BALANCE.rooms.spawnMinDist, ENEMIES[s.kind].r);
      this.enemies.addMarker(s.kind, x, z, s.kind === 'boss' ? 1.5 : 0.75);
    }
  }

  private enterRoom(n: number): void {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.fx.clear();
    this.room.build(n);
    this.room.plan();
    this.player.pos.set(0, 0, this.room.hh - 2.5);
    this.player.vel.set(0, 0, 0);
    this.gfx.snapCamera(this.player.pos.x, this.player.pos.z);
    this.hud.toast(this.room.isBoss ? '⚠ 首领房间' : `房间 ${n}`);
  }

  private checkClear(dt: number): void {
    const room = this.room;
    if (!room.cleared && room.queue.length === 0 && this.enemies.pending === 0 && this.enemies.list.length === 0) {
      room.cleared = true;
      room.clearT = 0.9;
      this.hud.toast('房间清空！');
      sfx.clear();
      this.projectiles.clearEnemyBullets();
    }
    if (room.clearT > 0) {
      room.clearT -= dt;
      if (room.clearT <= 0) this.openUpgrade();
    }
  }

  private openUpgrade(): void {
    this.state = 'upgrade';
    this.input.mouseDown = false;
    const pool = UPGRADES.filter(u => !u.available || u.available(this.player));
    this.upgradeChoices = shuffled(pool).slice(0, BALANCE.rooms.upgradeChoices);
    this.screens.showUpgrades(this.upgradeChoices, i => this.pickUpgrade(i));
  }

  private pickUpgrade(i: number): void {
    const u = this.upgradeChoices[i];
    if (!u || this.state !== 'upgrade') return;
    u.apply(this.player);
    this.player.buffs.push(u.name);
    this.hud.setBuffs(this.player.buffs);
    this.screens.toggle('upgradeScreen', false);
    this.screens.setCrosshair(true);
    this.state = 'play';
    sfx.pickup();
    this.room.openPortal();
    sfx.portal();
    this.hud.toast('传送门已开启');
  }

  private goThroughPortal(): void {
    this.state = 'transition';
    sfx.portal();
    this.hud.fade(true);
    setTimeout(() => {
      this.enterRoom(this.room.n + 1);
      this.hud.fade(false);
      this.state = 'play';
    }, 300);
  }

  private gameOver(): void {
    this.state = 'dead';
    this.input.mouseDown = false;
    this.player.mesh.visible = false;
    this.fx.burst({ x: this.player.pos.x, y: 0.8, z: this.player.pos.z }, 0x4ff0ff, 60, 14, 0.3, 1.2);
    sfx.boom();
    this.fx.shake(1.2);
    const best = loadBest();
    const isNewBest = !best || this.score > best.score;
    if (isNewBest) saveBest({ room: this.room.n, score: this.score });
    const summary = { room: this.room.n, score: this.score, isNewBest, buffs: this.player.buffs };
    setTimeout(() => this.screens.showGameOver(summary), 900);
  }
}
