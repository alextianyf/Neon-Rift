import * as THREE from 'three';
import type { PadButton, TouchAction } from '../core/input';
import type { Game } from './game';

const tmp = new THREE.Vector3();

// Routes keyboard, mouse, gamepad and touch input to game actions, by game state.
export function bindControls(g: Game): void {
  const dash = () => g.player.tryDash(g.input.moveDir(tmp), g);
  const cycleWeapon = (dir: number) => {
    const n = g.player.slots.length;
    g.switchWeapon((g.player.weapon + dir + n) % n);
  };

  const onPad = (b: PadButton) => {
    const click = (id: string) => (document.getElementById(id) as HTMLButtonElement | null)?.click();
    switch (g.state) {
      case 'play':
        if (b === 'a' || b === 'lt') dash();
        else if (b === 'x') g.interactables.interact();
        else if (b === 'y') g.player.trySkill(g);
        else if (b === 'b') g.player.startReload();
        else if (b === 'rb') cycleWeapon(1);
        else if (b === 'lb') cycleWeapon(-1);
        else if (b === 'start') g.setPaused(true);
        break;
      case 'portal':
        if (b === 'a') g.sector.answerPortal(true);
        else if (b === 'b') g.sector.answerPortal(false);
        break;
      case 'paused':
        if (b === 'start' || b === 'b') g.setPaused(false);
        else if (b === 'back') click('quitBtn');
        break;
      case 'upgrade':
        if (b === 'x') g.sector.pickUpgrade(0);
        else if (b === 'y') g.sector.pickUpgrade(1);
        else if (b === 'b') g.sector.pickUpgrade(2);
        break;
      case 'dead':
        if (b === 'a') click('restartBtn');
        else if (b === 'b') click('menuBtn');
        break;
      case 'won':
        if (b === 'a') click('winContinue');
        else if (b === 'b') click('winMenu');
        break;
      case 'title':
        g.menus.onPad(b);
        break;
    }
  };

  const onTouch = (a: TouchAction) => {
    if (g.state !== 'play') return;
    if (a === 'dash') dash();
    else if (a === 'skill') g.player.trySkill(g);
    else if (a === 'use') g.interactables.interact();
    else if (a === 'swap') cycleWeapon(1);
    else if (a === 'reload') g.player.startReload();
    else if (a === 'pause') g.setPaused(true);
  };

  g.input.handlers = {
    onKeyDown: (k, repeat) => {
      if (g.state === 'play') {
        if (/^[1-9]$/.test(k)) g.switchWeapon(+k - 1);
        if (k === 'q') cycleWeapon(1);
        if (k === ' ' && !repeat) dash();
        if (k === 'e' && !repeat) g.interactables.interact();
        if (k === 'f' && !repeat) g.player.trySkill(g);
        if (k === 'r' && !repeat) g.player.startReload();
        if (k === 'escape' || k === 'p') g.setPaused(true);
      } else if (g.state === 'portal' && !repeat) {
        if (k === 'e' || k === 'enter') g.sector.answerPortal(true);
        else if (k === 'escape') g.sector.answerPortal(false);
      } else if (g.state === 'paused' && (k === 'escape' || k === 'p')) {
        g.setPaused(false);
      } else if (g.state === 'upgrade' && /^[1-9]$/.test(k)) {
        g.sector.pickUpgrade(+k - 1);
      }
    },
    onRightClick: () => { if (g.state === 'play') dash(); },
    onWheel: dir => { if (g.state === 'play') cycleWeapon(dir); },
    onBlur: () => { if (g.state === 'play') g.setPaused(true); },
    onPad,
    onTouch,
  };
}

// With a gamepad the crosshair follows the stick's aim point instead of the mouse.
export function placePadCrosshair(g: Game): void {
  const v = tmp.copy(g.player.aimTarget).project(g.gfx.camera);
  g.screens.crosshair.style.transform = `translate(${(v.x + 1) / 2 * innerWidth}px, ${(1 - v.y) / 2 * innerHeight}px)`;
}
