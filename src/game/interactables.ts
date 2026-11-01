import * as THREE from 'three';
import { GEO, disposeTree, glowMat, markShared } from '../core/assets';
import { sfx } from '../core/audio';
import { shuffledR } from '../core/rng';
import { BALANCE } from '../data/balance';
import { RARITY_LABEL, RARITY_PRICE, ROLL_WEIGHTS, rollUpgrades, type UpgradeDef } from '../data/upgrades';
import { MAX_WEAPON_LEVEL, WEAPONS, type WeaponId } from '../data/weapons';
import type { Tag } from '../ui/floaters';
import type { Game } from './game';
import { MODS } from '../data/depth';
import { t } from '../core/i18n';

export type Offer =
  | { kind: 'weapon'; id: WeaponId; level: number; ammo?: { mag: number; reserve: number } }  // ammo: a dropped weapon keeps its rounds
  | { kind: 'upgrade'; upgrade: UpgradeDef }
  | { kind: 'heal'; amount: number }
  | { kind: 'ammo' }
  | { kind: 'hangar' };  // terminal in every shop: talents and mechs, bought with rift crystals

interface Item {
  offer: Offer;
  price: number;  // 0 means a free floor pickup
  group: THREE.Group;
  icon: THREE.Object3D;
  pos: THREE.Vector3;
  tag: Tag;
  t: number;
}

const REACH = 1.8;
const RARITY_COLOR = { common: 0x9fb4ff, rare: 0xc77dff, legendary: 0xffc83d } as const;
const PEDESTAL_GEO = markShared(new THREE.CylinderGeometry(0.75, 0.9, 0.7, 16));

function offerColor(o: Offer): number {
  if (o.kind === 'weapon') return WEAPONS[o.id].color;
  if (o.kind === 'upgrade') return RARITY_COLOR[o.upgrade.rarity];
  if (o.kind === 'ammo') return 0xffd23f;
  if (o.kind === 'hangar') return 0x4ff0ff;
  return 0x55ff99;
}

function offerName(o: Offer): string {
  if (o.kind === 'weapon') return WEAPONS[o.id].name + (o.level > 1 ? ` Lv.${o.level}` : '');
  if (o.kind === 'upgrade') return o.upgrade.name;
  if (o.kind === 'ammo') return t('弹药补给');
  if (o.kind === 'hangar') return t('机库终端');
  return t('维修包');
}

function offerDesc(o: Offer): string {
  if (o.kind === 'weapon') return WEAPONS[o.id].desc;
  if (o.kind === 'upgrade') return `${RARITY_LABEL[o.upgrade.rarity]} · ${o.upgrade.desc}`;
  if (o.kind === 'ammo') return t('补满所有拾取武器的备用弹药');
  if (o.kind === 'hangar') return t('用裂隙结晶升级天赋、解锁或更换机体，永久生效，并立刻用在这一局');
  return t('回复 {n} 生命', { n: o.amount });
}

// Things the player walks up to and presses E on: weapon drops and shop items.
const KD = BALANCE.killDrops;
const MAXED_WEAPON_COINS = 10;

// Weighted pick with Math.random (combat loot must not touch the seeded run RNG).
function pickWeighted<T>(entries: [T, number][]): T {
  let r = Math.random() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of entries) if ((r -= w) <= 0) return v;
  return entries[0][0];
}

export class Interactables {
  private readonly items: Item[] = [];
  private focused: Item | null = null;
  private killDrops = 0;  // kill drops this sector

  constructor(private readonly g: Game) {}

  get hasFreeWeapon(): boolean {
    return this.items.some(it => it.price === 0 && it.offer.kind === 'weapon');
  }

  spawn(offer: Offer, x: number, z: number, price = 0): void {
    const g = this.g, color = offerColor(offer);
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    let iconY = 0.9;
    if (price > 0) {
      const ped = new THREE.Mesh(PEDESTAL_GEO, new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.6 }));
      ped.position.y = 0.35;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.04, 6, 32), glowMat(0xffd23f, 2));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.7;
      group.add(ped, rim);
      iconY = 1.35;
    } else {
      const ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.04;
      ring.scale.setScalar(1.3);
      group.add(ring);
    }

    let icon: THREE.Object3D;
    if (offer.kind === 'weapon') {
      icon = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 1.1), glowMat(color, 1.4));
    } else if (offer.kind === 'upgrade') {
      icon = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), glowMat(color, 2.2));
    } else if (offer.kind === 'ammo') {
      // three rounds standing side by side
      const rounds = new THREE.Group();
      for (const x of [-0.22, 0, 0.22]) {
        const r = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 8), glowMat(color, 1.8));
        r.position.x = x;
        rounds.add(r);
      }
      icon = rounds;
    } else if (offer.kind === 'hangar') {
      // a small console: a tilted screen on a post
      const term = new THREE.Group();
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.25), new THREE.MeshStandardMaterial({ color: 0x15131f, roughness: 0.6 }));
      post.position.y = -0.5;
      const screen = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, 0.06), glowMat(color, 1.6));
      screen.rotation.x = -0.5;
      term.add(post, screen);
      icon = term;
    } else {
      const cross = new THREE.Group();
      const mat = glowMat(color, 2.2);
      cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), mat), new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), mat));
      icon = cross;
    }
    icon.position.y = iconY;
    group.add(icon);
    g.gfx.scene.add(group);

    const priceHtml = price > 0 ? `<span class="price">${t('{n} 碎片', { n: price })}</span>` : '';
    const colorCss = `#${color.toString(16).padStart(6, '0')}`;
    const tag = g.floaters.addTag(x, iconY + 0.9, z, `<b style="color:${colorCss}">${offerName(offer)}</b>${priceHtml}`);
    this.items.push({ offer, price, group, icon, pos: group.position, tag, t: Math.random() * 10 });
  }

  spawnWeaponDrop(x: number, z: number): void {
    this.spawn({ kind: 'weapon', id: this.randomWeapon([]), level: 1 }, x, z);
  }

  // Rare loot when a regular enemy dies: a module (rarer the better), a weapon (pricier = rarer) or ammo.
  rollKillDrop(x: number, z: number, cost: number, elite: boolean): void {
    if (this.killDrops >= KD.perSector) return;
    if (Math.random() >= KD.chance * cost * (elite ? KD.eliteMul : 1)) return;
    const p = this.g.player;
    let kind = pickWeighted(Object.entries(KD.kind) as ['module' | 'weapon' | 'ammo', number][]);
    if (kind === 'ammo' && !p.needsAmmo) kind = 'module';
    let offer: Offer | null = null;
    if (kind === 'module') {
      const [upgrade] = rollUpgrades(p, 1, KD.rarity, Math.random);
      if (upgrade) offer = { kind: 'upgrade', upgrade };
    } else if (kind === 'weapon') {
      const tier = (w: WeaponId) => KD.weaponTier[WEAPONS[w].price <= 30 ? 0 : WEAPONS[w].price < 40 ? 1 : 2];
      const ids = (Object.keys(WEAPONS) as WeaponId[]).filter(id => id !== p.mechDef.starter);
      offer = { kind: 'weapon', id: pickWeighted(ids.map(id => [id, tier(id)] as [WeaponId, number])), level: 1 };
    } else {
      offer = { kind: 'ammo' };
    }
    if (!offer) return;
    this.killDrops++;
    this.spawn(offer, x, z);
    this.g.fx.burst({ x, y: 1, z }, offerColor(offer), 14, 5, 0.2, 0.5);
    sfx.pickup();
  }

  setupShop(): void {
    const visit = Math.floor(this.g.room.n / BALANCE.rooms.bossEvery);
    const scale = (1 + visit * BALANCE.scaling.shopPricePerVisit) * MODS.priceMul;
    const w1 = this.randomWeapon([]), w2 = this.randomWeapon([w1]);
    const [upgrade] = rollUpgrades(this.g.player, 1, ROLL_WEIGHTS.shop);
    const z = -1;
    this.spawn({ kind: 'weapon', id: w1, level: 1 }, -6, z, Math.round(WEAPONS[w1].price * scale));
    this.spawn({ kind: 'weapon', id: w2, level: 1 }, -2, z, Math.round(WEAPONS[w2].price * scale));
    if (upgrade) this.spawn({ kind: 'upgrade', upgrade }, 2, z, Math.round(RARITY_PRICE[upgrade.rarity] * scale));
    this.spawn({ kind: 'heal', amount: BALANCE.shop.healAmount }, 6, z, Math.round(BALANCE.shop.healPrice * scale));
    this.spawn({ kind: 'ammo' }, 0, z + 4, Math.round(BALANCE.shop.ammoPrice * scale));
    this.spawn({ kind: 'hangar' }, 6, z + 4);
  }

  // Treasure vault: a free weapon, a free module and a pile of shards.
  setupTreasure(): void {
    const [upgrade] = rollUpgrades(this.g.player, 1, ROLL_WEIGHTS.treasure);
    this.spawn({ kind: 'weapon', id: this.randomWeapon([]), level: 1 }, -3.5, 0.5);
    if (upgrade) this.spawn({ kind: 'upgrade', upgrade }, 3.5, 0.5);
    this.g.pickups.spawnCoins(0, 2.5, Math.round(15 + this.g.room.n * 2));
  }

  update(dt: number): void {
    const p = this.g.player;
    let best: Item | null = null, bestD = REACH;
    for (const it of this.items) {
      it.t += dt;
      it.icon.rotation.y += dt * 1.6;
      it.icon.position.y += Math.sin(it.t * 3) * 0.004;
      const d = Math.hypot(it.pos.x - p.pos.x, it.pos.z - p.pos.z);
      if (d < bestD) { bestD = d; best = it; }
    }
    this.focused = best;
    if (!best) {
      this.g.hud.prompt(null);
      return;
    }
    const o = best.offer;
    let verb = o.kind === 'hangar' ? t('打开') : best.price > 0 ? t('购买') : t('拾取');
    if (o.kind === 'weapon') {
      if (p.owns(o.id)) verb = p.slots.find(s => s.id === o.id)!.level >= MAX_WEAPON_LEVEL ? t('补充弹药') : best.price > 0 ? t('购买并升级') : t('升级');
      else if (p.slots.length >= 3) verb = t('{verb}并替换 {w}', { verb, w: WEAPONS[p.slots[p.replaceIndex].id].name });
    }
    const cost = best.price > 0 ? ` · ${t('{n} 碎片', { n: best.price })}` : '';
    let desc = offerDesc(o);
    if (o.kind === 'weapon') {
      // tell the player what the next level unlocks
      const owned = p.slots.find(s => s.id === o.id);
      const next = owned ? owned.level + o.level : o.level;
      const unlock = (owned ? owned.level < 3 : true) && next >= 3 ? 3 : (owned ? owned.level < 5 : true) && next >= 5 ? 5 : 0;
      if (unlock) desc += `<br>Lv.${unlock}：${unlock === 3 ? WEAPONS[o.id].lv3 : WEAPONS[o.id].lv5}`;
    }
    this.g.hud.prompt(`<kbd>E</kbd> ${verb} <b>${offerName(o)}</b>${cost}<div class="pdesc">${desc}</div>`, best.price <= p.coins);
  }

  interact(): void {
    const it = this.focused, g = this.g, p = g.player;
    if (!it) return;
    if (it.offer.kind === 'hangar') { g.menus.openRunHangar(); return; }
    if (it.price > p.coins) {
      sfx.denied();
      g.hud.toast(t('碎片不足'));
      return;
    }
    if (it.offer.kind === 'ammo' && !p.needsAmmo) {
      sfx.denied();
      g.hud.toast(t('弹药已满'));
      return;
    }
    p.coins -= it.price;
    if (it.price > 0) sfx.buy();
    this.remove(it);

    const o = it.offer;
    if (o.kind === 'weapon') {
      const res = p.addWeapon(o.id, o.level, o.ammo);
      if (res.kind === 'levelup') {
        sfx.levelUp();
        const w = WEAPONS[o.id];
        const unlocked = res.level === 3 ? w.lv3 : res.level === 5 ? w.lv5 : '';
        g.hud.toast(unlocked ? `${w.name} Lv.${res.level}：${unlocked}` : t('{w} 升级到 Lv.{n}，弹药补满', { w: w.name, n: res.level }));
      }
      else if (res.kind === 'maxed') {
        p.coins += MAXED_WEAPON_COINS;
        sfx.pickup();
        g.hud.toast(t('{w} 已满级：弹药补满，+{n} 碎片', { w: WEAPONS[o.id].name, n: MAXED_WEAPON_COINS }));
      }
      else { sfx.pickup(); g.hud.toast(t('获得 {w}', { w: WEAPONS[o.id].name })); }
      if (res.kind === 'swapped') {
        const d = res.dropped;
        this.spawn({ kind: 'weapon', id: d.id, level: d.level, ammo: { mag: d.mag, reserve: d.reserve } }, it.pos.x, it.pos.z);
      }
      g.refreshWeapons();
    } else if (o.kind === 'upgrade') {
      g.applyUpgrade(o.upgrade);
      g.hud.toast(o.upgrade.name);
    } else if (o.kind === 'ammo') {
      p.refillAmmo();
      sfx.pickup();
      g.hud.toast(t('弹药已补满'));
    } else {
      p.heal(o.amount);
      sfx.pickup();
      g.floaters.damage({ x: p.pos.x, y: 1.6, z: p.pos.z }, o.amount, 'heal', this);
    }
    g.fx.burst({ x: it.pos.x, y: 1.2, z: it.pos.z }, offerColor(o), 18, 6, 0.2, 0.5);
  }

  clear(): void {
    this.killDrops = 0;
    for (const it of [...this.items]) this.remove(it);
    this.focused = null;
    this.g.hud.prompt(null);
  }

  // Prefer weapons the player doesn't own yet; never the mech's starting weapon.
  private randomWeapon(exclude: WeaponId[]): WeaponId {
    const starter = this.g.player.mechDef.starter;
    const all = (Object.keys(WEAPONS) as WeaponId[]).filter(id => id !== starter && !exclude.includes(id));
    const fresh = all.filter(id => !this.g.player.owns(id));
    return shuffledR(fresh.length ? fresh : all)[0];
  }

  private remove(it: Item): void {
    this.g.gfx.scene.remove(it.group);
    disposeTree(it.group);
    this.g.floaters.removeTag(it.tag);
    this.items.splice(this.items.indexOf(it), 1);
    if (this.focused === it) this.focused = null;
  }
}
