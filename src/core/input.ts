import * as THREE from 'three';

export interface InputHandlers {
  onKeyDown?(key: string, repeat: boolean): void;
  onRightClick?(): void;
  onWheel?(dir: 1 | -1): void;
  onBlur?(): void;
}

export class Input {
  readonly keys = new Set<string>();
  readonly mouseNDC = new THREE.Vector2();
  mouseDown = false;
  handlers: InputHandlers = {};

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
    });
    canvas.addEventListener('mousedown', e => {
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

  // Normalized WASD / arrow-key direction on the XZ plane (zero when idle).
  moveDir(out: THREE.Vector3): THREE.Vector3 {
    const k = this.keys;
    out.set(0, 0, 0);
    if (k.has('w') || k.has('arrowup')) out.z -= 1;
    if (k.has('s') || k.has('arrowdown')) out.z += 1;
    if (k.has('a') || k.has('arrowleft')) out.x -= 1;
    if (k.has('d') || k.has('arrowright')) out.x += 1;
    return out.lengthSq() > 0 ? out.normalize() : out;
  }
}
