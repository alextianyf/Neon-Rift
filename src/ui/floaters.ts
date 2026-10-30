import * as THREE from 'three';
import { $ } from './dom';

export type FloaterKind = 'dmg' | 'crit' | 'dot' | 'heal' | 'coin';

interface PointLike {
  x: number;
  y?: number;
  z: number;
}

interface Floater {
  el: HTMLDivElement;
  kind: FloaterKind;
  x: number;
  y: number;
  z: number;
  age: number;
  life: number;
  value: number;
  key?: object;
}

// World-anchored label (shop prices, weapon names) that follows the camera projection.
export interface Tag {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
}

const LIFE: Record<FloaterKind, number> = { dmg: 0.6, crit: 0.9, dot: 0.7, heal: 0.9, coin: 0.9 };
// Hits from the same source within this window are merged into one rising number.
const MERGE_WINDOW: Record<FloaterKind, number> = { dmg: 0.12, crit: 0, dot: 0.45, heal: 0.3, coin: 0.5 };
const MAX_FLOATERS = 70;
const v = new THREE.Vector3();

// Floating damage numbers and world labels, drawn as DOM elements over the canvas.
export class Floaters {
  enabled = true;
  private readonly root = $('floaters');
  private readonly items: Floater[] = [];
  private readonly tags: Tag[] = [];
  private readonly pool: HTMLDivElement[] = [];
  private readonly byKey = new WeakMap<object, Floater>();

  constructor(private readonly camera: THREE.Camera) {}

  damage(at: PointLike, value: number, kind: FloaterKind, key?: object): void {
    if (!this.enabled && kind !== 'coin' && kind !== 'heal') return;
    const merge = key && MERGE_WINDOW[kind] > 0 ? this.byKey.get(key) : undefined;
    if (merge && merge.kind === kind && this.items.includes(merge) && merge.age < MERGE_WINDOW[kind]) {
      merge.value += value;
      merge.age = 0;
      merge.el.textContent = this.format(kind, merge.value);
      return;
    }
    if (this.items.length >= MAX_FLOATERS) this.release(this.items.shift()!);
    const el = this.pool.pop() ?? document.createElement('div');
    el.className = `floater ${kind}`;
    el.textContent = this.format(kind, value);
    this.root.appendChild(el);
    const f: Floater = { el, kind, x: at.x + (Math.random() - 0.5) * 0.6, y: at.y ?? 1, z: at.z, age: 0, life: LIFE[kind], value, key };
    this.items.push(f);
    if (key) this.byKey.set(key, f);
  }

  addTag(x: number, y: number, z: number, html: string): Tag {
    const el = document.createElement('div');
    el.className = 'tag';
    el.innerHTML = html;
    this.root.appendChild(el);
    const tag = { el, x, y, z };
    this.tags.push(tag);
    return tag;
  }

  removeTag(tag: Tag): void {
    tag.el.remove();
    const i = this.tags.indexOf(tag);
    if (i >= 0) this.tags.splice(i, 1);
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.age += dt;
      if (f.age >= f.life) {
        this.items.splice(i, 1);
        this.release(f);
        continue;
      }
      const k = f.age / f.life;
      const pop = f.kind === 'crit' ? 1 + Math.max(0, 0.15 - f.age) * 4 : 1;
      this.place(f.el, f.x, f.y + k * 1.2, f.z, pop);
      f.el.style.opacity = String(k > 0.7 ? (1 - k) / 0.3 : 1);
    }
    for (const t of this.tags) this.place(t.el, t.x, t.y, t.z, 1);
  }

  clear(): void {
    for (const f of this.items) this.release(f);
    this.items.length = 0;
  }

  private format(kind: FloaterKind, value: number): string {
    const n = Math.max(1, Math.round(value));
    if (kind === 'heal') return `+${n}`;
    if (kind === 'coin') return `+${n} 金`;
    return kind === 'crit' ? `${n}!` : String(n);
  }

  private place(el: HTMLElement, x: number, y: number, z: number, scale: number): void {
    v.set(x, y, z).project(this.camera);
    if (v.z > 1) { el.style.display = 'none'; return; }
    el.style.display = '';
    const sx = (v.x + 1) / 2 * innerWidth, sy = (1 - v.y) / 2 * innerHeight;
    el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%) scale(${scale})`;
  }

  private release(f: Floater): void {
    f.el.remove();
    this.pool.push(f.el);
  }
}
