import * as THREE from 'three';
import { GEO, disposeTree, glowMat, markShared } from '../core/assets';
import { sfx } from '../core/audio';
import { shuffled } from '../core/math';
import { BALANCE } from '../data/balance';
import { RARITY_LABEL, RARITY_PRICE, ROLL_WEIGHTS, rollUpgrades, type UpgradeDef } from '../data/upgrades';
import { STARTING_WEAPON, WEAPONS, type WeaponId } from '../data/weapons';
import type { Tag } from '../ui/floaters';
import type { Game } from './game';

export type Offer =
  | { kind: 'weapon'; id: WeaponId; level: number }
  | { kind: 'upgrade'; upgrade: UpgradeDef }
  | { kind: 'heal'; amount: number };

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
  return 0x55ff99;
}

function offerName(o: Offer): string {
  if (o.kind === 'weapon') return WEAPONS[o.id].name + (o.level > 1 ? ` Lv.${o.level}` : '');
  if (o.kind === 'upgrade') return o.upgrade.name;
  return '维修包';
}

function offerDesc(o: Offer): string {
  if (o.kind === 'weapon') return WEAPONS[o.id].desc;
  if (o.kind === 'upgrade') return `${RARITY_LABEL[o.upgrade.rarity]} · ${o.upgrade.desc}`;
  return `回复 ${o.amount} 生命`;
}

// Things the player walks up to and presses E on: weapon drops and shop items.
export class Interactables {
  private readonly items: Item[] = [];
  private focused: Item | null = null;

  constructor(private readonly g: Game) {}

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
    } else {
      const cross = new THREE.Group();
      const mat = glowMat(color, 2.2);
      cross.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), mat), new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), mat));
      icon = cross;
    }
    icon.position.y = iconY;
    group.add(icon);
    g.gfx.scene.add(group);

    const priceHtml = price > 0 ? `<span class="price">${price} 碎片</span>` : '';
    const colorCss = `#${color.toString(16).padStart(6, '0')}`;
    const tag = g.floaters.addTag(x, iconY + 0.9, z, `<b style="color:${colorCss}">${offerName(offer)}</b>${priceHtml}`);
    this.items.push({ offer, price, group, icon, pos: group.position, tag, t: Math.random() * 10 });
  }

  spawnWeaponDrop(x: number, z: number): void {
    this.spawn({ kind: 'weapon', id: this.randomWeapon([]), level: 1 }, x, z);
  }

  setupShop(): void {
    const visit = Math.floor(this.g.room.n / BALANCE.rooms.bossEvery);
    const scale = 1 + visit * BALANCE.scaling.shopPricePerVisit;
    const w1 = this.randomWeapon([]), w2 = this.randomWeapon([w1]);
    const [upgrade] = rollUpgrades(this.g.player, 1, ROLL_WEIGHTS.shop);
    const z = -1;
    this.spawn({ kind: 'weapon', id: w1, level: 1 }, -6, z, Math.round(WEAPONS[w1].price * scale));
    this.spawn({ kind: 'weapon', id: w2, level: 1 }, -2, z, Math.round(WEAPONS[w2].price * scale));
    if (upgrade) this.spawn({ kind: 'upgrade', upgrade }, 2, z, Math.round(RARITY_PRICE[upgrade.rarity] * scale));
    this.spawn({ kind: 'heal', amount: BALANCE.shop.healAmount }, 6, z, Math.round(BALANCE.shop.healPrice * scale));
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
    let verb = best.price > 0 ? '购买' : '拾取';
    if (o.kind === 'weapon') {
      if (p.owns(o.id)) verb = best.price > 0 ? '购买并升级' : '升级';
      else if (p.slots.length >= 3) verb = `${verb}并替换 ${WEAPONS[p.activeSlot.id].name}`;
    }
    const cost = best.price > 0 ? ` · ${best.price} 碎片` : '';
    this.g.hud.prompt(`<kbd>E</kbd> ${verb} <b>${offerName(o)}</b>${cost}<div class="pdesc">${offerDesc(o)}</div>`, best.price <= p.coins);
  }

  interact(): void {
    const it = this.focused, g = this.g, p = g.player;
    if (!it) return;
    if (it.price > p.coins) {
      sfx.denied();
      g.hud.toast('碎片不足');
      return;
    }
    p.coins -= it.price;
    if (it.price > 0) sfx.buy();
    this.remove(it);

    const o = it.offer;
    if (o.kind === 'weapon') {
      const res = p.addWeapon(o.id);
      for (let i = 1; i < o.level; i++) p.addWeapon(o.id);
      if (res.kind === 'levelup') { sfx.levelUp(); g.hud.toast(`${WEAPONS[o.id].name} 升级到 Lv.${res.level}`); }
      else { sfx.pickup(); g.hud.toast(`获得 ${WEAPONS[o.id].name}`); }
      if (res.kind === 'swapped') this.spawn({ kind: 'weapon', id: res.dropped.id, level: res.dropped.level }, it.pos.x, it.pos.z);
      g.refreshWeapons();
    } else if (o.kind === 'upgrade') {
      g.applyUpgrade(o.upgrade);
      g.hud.toast(o.upgrade.name);
    } else {
      p.heal(o.amount);
      sfx.pickup();
      g.floaters.damage({ x: p.pos.x, y: 1.6, z: p.pos.z }, o.amount, 'heal', this);
    }
    g.fx.burst({ x: it.pos.x, y: 1.2, z: it.pos.z }, offerColor(o), 18, 6, 0.2, 0.5);
  }

  clear(): void {
    for (const it of [...this.items]) this.remove(it);
    this.focused = null;
    this.g.hud.prompt(null);
  }

  // Prefer weapons the player doesn't own yet.
  private randomWeapon(exclude: WeaponId[]): WeaponId {
    const all = (Object.keys(WEAPONS) as WeaponId[]).filter(id => id !== STARTING_WEAPON && !exclude.includes(id));
    const fresh = all.filter(id => !this.g.player.owns(id));
    return shuffled(fresh.length ? fresh : all)[0];
  }

  private remove(it: Item): void {
    this.g.gfx.scene.remove(it.group);
    disposeTree(it.group);
    this.g.floaters.removeTag(it.tag);
    this.items.splice(this.items.indexOf(it), 1);
    if (this.focused === it) this.focused = null;
  }
}
