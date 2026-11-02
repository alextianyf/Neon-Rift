import * as THREE from 'three';

// Standard-mapping gamepad buttons we react to (edge-triggered).
export type PadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'start' | 'back';
const PAD_BUTTONS: [number, PadButton][] = [[0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [6, 'lt'], [8, 'back'], [9, 'start']];
const DEADZONE = 0.2;
const STICK_RADIUS = 56;  // px of thumb travel for a full touch-stick push

export type TouchAction = 'dash' | 'skill' | 'use' | 'swap' | 'reload' | 'pause';

// One on-screen stick: where the thumb landed and its current offset.
interface TouchStick {
  id: number;
  ox: number;
  oy: number;
  base: HTMLElement;
  knob: HTMLElement;
}

export interface InputHandlers {
  onKeyDown?(key: string, repeat: boolean): void;
  onRightClick?(): void;
  onWheel?(dir: 1 | -1): void;
  onBlur?(): void;
  onPad?(button: PadButton): void;
  onTouch?(action: TouchAction): void;
}

export class Input {
  readonly keys = new Set<string>();
  readonly mouseNDC = new THREE.Vector2();
  mouseDown = false;
  handlers: InputHandlers = {};
  // gamepad state, refreshed by pollGamepad() every frame
  readonly padMove = new THREE.Vector2();
  readonly padAim = new THREE.Vector2(0, -1);
  padFire = false;
  usingPad = false;  // last aim input came from a gamepad stick (switches back on mouse move)
  private prevPad: boolean[] = [];
  // touch twin-stick: left half of the screen moves, right half aims and fires
  usingTouch = false;
  readonly touchMove = new THREE.Vector2();
  touchFire = false;
  private moveStick: TouchStick | null = null;
  private aimStick: TouchStick | null = null;

  constructor(canvas: HTMLCanvasElement, crosshair: HTMLElement) {
    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'tab') e.preventDefault();
      this.keys.add(k);
      this.handlers.onKeyDown?.(k, e.repeat);
    });
    addEventListener('keyup', e => this.keys.delete(e.key.toLowerCase()));
    addEventListener('blur', () => {
      this.release();
      this.handlers.onBlur?.();
    });
    addEventListener('mousemove', e => {
      this.mouseNDC.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      crosshair.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      this.usingPad = false;
      if (this.usingTouch && e.movementX !== 0) {
        this.usingTouch = false;  // a real mouse moved: back to cursor aiming
        document.body.classList.remove('touch');
      }
    });
    canvas.addEventListener('mousedown', e => {
      this.usingPad = false;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.handlers.onRightClick?.();
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => this.handlers.onWheel?.(e.deltaY > 0 ? 1 : -1));
    this.bindTouch(canvas);
  }

  // Sticks or gamepad drive the aim directly instead of the mouse cursor.
  get stickAim(): boolean {
    return this.usingPad || this.usingTouch;
  }

  private bindTouch(canvas: HTMLCanvasElement): void {
    // stop the browser from also sending emulated mouse events / scrolling
    canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    canvas.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      if (!this.usingTouch) {
        this.usingTouch = true;
        document.body.classList.add('touch');
      }
      this.usingPad = false;
      const left = e.clientX < innerWidth / 2;
      if (left && !this.moveStick) this.moveStick = this.makeStick(e, 'move');
      else if (!left && !this.aimStick) this.aimStick = this.makeStick(e, 'aim');
    });
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'touch') return;
      for (const s of [this.moveStick, this.aimStick]) {
        if (!s || s.id !== e.pointerId) continue;
        let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        s.knob.style.transform = `translate(${dx}px, ${dy}px)`;
        if (s === this.moveStick) {
          this.touchMove.set(dx / STICK_RADIUS, dy / STICK_RADIUS);
          if (this.touchMove.length() < 0.15) this.touchMove.set(0, 0);
        } else if (len > 12) {
          this.padAim.set(dx, dy).normalize();
          this.touchFire = true;
        }
      }
    });
    const end = (e: PointerEvent) => {
      if (this.moveStick?.id === e.pointerId) {
        this.moveStick.base.remove();
        this.moveStick = null;
        this.touchMove.set(0, 0);
      }
      if (this.aimStick?.id === e.pointerId) {
        this.aimStick.base.remove();
        this.aimStick = null;
        this.touchFire = false;
      }
    };
    addEventListener('pointerup', end);
    addEventListener('pointercancel', end);
    for (const b of document.querySelectorAll<HTMLElement>('#touchUI [data-act]')) {
      b.addEventListener('pointerdown', e => {
        e.preventDefault();
        e.stopPropagation();
        this.handlers.onTouch?.(b.dataset.act as TouchAction);
      });
    }
  }

  private makeStick(e: PointerEvent, kind: 'move' | 'aim'): TouchStick {
    const base = document.createElement('div');
    base.className = `tstick ${kind}`;
    base.style.left = `${e.clientX}px`;
    base.style.top = `${e.clientY}px`;
    const knob = document.createElement('div');
    knob.className = 'knob';
    base.appendChild(knob);
    document.body.appendChild(base);
    return { id: e.pointerId, ox: e.clientX, oy: e.clientY, base, knob };
  }

  // Drop any held sticks (pause, menus).
  releaseTouch(): void {
    this.moveStick?.base.remove();
    this.aimStick?.base.remove();
    this.moveStick = this.aimStick = null;
    this.touchMove.set(0, 0);
    this.touchFire = false;
  }

  release(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.releaseTouch();
  }

  get firing(): boolean {
    return this.mouseDown || this.padFire || this.touchFire;
  }

  // Read the first connected gamepad: sticks, trigger and button presses.
  pollGamepad(): void {
    const pad = Array.from(navigator.getGamepads?.() ?? []).find(p => p && p.connected);
    if (!pad) {
      this.padMove.set(0, 0);
      this.padFire = false;
      return;
    }
    const dz = (v: number | undefined) => (v === undefined || Math.abs(v) < DEADZONE ? 0 : v);
    this.padMove.set(dz(pad.axes[0]), dz(pad.axes[1]));
    const ax = dz(pad.axes[2]), ay = dz(pad.axes[3]);
    if (Math.hypot(ax, ay) > 0.35) {
      this.padAim.set(ax, ay).normalize();
      this.usingPad = true;
    }
    if (this.padMove.lengthSq() > 0) this.usingPad = true;
    const pressed = pad.buttons.map(b => b.pressed);
    this.padFire = (pad.buttons[7]?.value ?? 0) > 0.3;
    for (const [i, name] of PAD_BUTTONS) if (pressed[i] && !this.prevPad[i]) this.handlers.onPad?.(name);
    this.prevPad = pressed;
  }

  // Normalized movement direction on the XZ plane from WASD / arrows / left stick (zero when idle).
  moveDir(out: THREE.Vector3): THREE.Vector3 {
    const k = this.keys;
    out.set(this.padMove.x + this.touchMove.x, 0, this.padMove.y + this.touchMove.y);
    if (k.has('w') || k.has('arrowup')) out.z -= 1;
    if (k.has('s') || k.has('arrowdown')) out.z += 1;
    if (k.has('a') || k.has('arrowleft')) out.x -= 1;
    if (k.has('d') || k.has('arrowright')) out.x += 1;
    return out.lengthSq() > 0 ? out.normalize() : out;
  }
}
