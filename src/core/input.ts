import * as THREE from 'three';

// Standard-mapping gamepad buttons we react to (edge-triggered).
export type PadButton = 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'start' | 'back';
const PAD_BUTTONS: [number, PadButton][] = [[0, 'a'], [1, 'b'], [2, 'x'], [3, 'y'], [4, 'lb'], [5, 'rb'], [6, 'lt'], [8, 'back'], [9, 'start']];
const DEADZONE = 0.2;

export interface InputHandlers {
  onKeyDown?(key: string, repeat: boolean): void;
  onRightClick?(): void;
  onWheel?(dir: 1 | -1): void;
  onBlur?(): void;
  onPad?(button: PadButton): void;
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

  constructor(canvas: HTMLCanvasElement, crosshair: HTMLElement) {
    addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (k === ' ') e.preventDefault();
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
    });
    canvas.addEventListener('mousedown', e => {
      this.usingPad = false;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.handlers.onRightClick?.();
    });
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseDown = false; });
    addEventListener('contextmenu', e => e.preventDefault());
    addEventListener('wheel', e => this.handlers.onWheel?.(e.deltaY > 0 ? 1 : -1));
  }

  release(): void {
    this.keys.clear();
    this.mouseDown = false;
  }

  get firing(): boolean {
    return this.mouseDown || this.padFire;
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
    out.set(this.padMove.x, 0, this.padMove.y);
    if (k.has('w') || k.has('arrowup')) out.z -= 1;
    if (k.has('s') || k.has('arrowdown')) out.z += 1;
    if (k.has('a') || k.has('arrowleft')) out.x -= 1;
    if (k.has('d') || k.has('arrowright')) out.x += 1;
    return out.lengthSq() > 0 ? out.normalize() : out;
  }
}
