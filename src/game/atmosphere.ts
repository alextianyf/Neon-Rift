import * as THREE from 'three';
import { disposeTree, markShared } from '../core/assets';
import { rand } from '../core/math';
import type { Room } from './room';

// Purely visual ambience for a room: drifting rift fog, floating data motes, data pulses
// running along the floor grid, rift scars on the floor, a glow under the player, and
// wireframe debris floating in the void outside the walls. Nothing here affects gameplay.

const RIFT_PURPLE = 0x7a3cff;

function radialTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return markShared(new THREE.CanvasTexture(c));
}

// Soft, lumpy cloud made of a few overlapping blobs so fog patches don't look like perfect circles.
function cloudTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 9; i++) {
    const x = 128 + rand(-55, 55), y = 128 + rand(-55, 55), r = rand(45, 90);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return markShared(new THREE.CanvasTexture(c));
}

let textures: { cloud: THREE.Texture; dot: THREE.Texture; glow: THREE.Texture } | null = null;
function tex() {
  textures ??= {
    cloud: cloudTexture(),
    dot: radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)'),
    glow: radialTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)'),
  };
  return textures;
}

interface FogPatch { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; vx: number; vz: number; spin: number; base: number; phase: number }
interface Pulse { mesh: THREE.Mesh; axis: 'x' | 'z'; speed: number; line: number }
interface Debris { obj: THREE.Object3D; spin: THREE.Vector3; bob: number; y: number }

export class Atmosphere {
  private group: THREE.Group | null = null;
  private fog: FogPatch[] = [];
  private pulses: Pulse[] = [];
  private debris: Debris[] = [];
  private scars: THREE.LineBasicMaterial[] = [];
  private motes: THREE.Points | null = null;
  private moteSpeed: Float32Array = new Float32Array(0);
  private playerGlow: THREE.Mesh | null = null;
  private hw = 15;
  private hh = 10;

  constructor(private readonly scene: THREE.Scene) {}

  build(room: Room): void {
    this.dispose();
    const { hw, hh } = room, theme = room.theme, t = tex();
    this.hw = hw;
    this.hh = hh;
    const g = new THREE.Group();

    // drifting rift fog, layered at a few heights
    const fogColor = theme.clone().lerp(new THREE.Color(RIFT_PURPLE), 0.55);
    const area = hw * hh;
    for (let i = 0, n = Math.round(area / 18); i < n; i++) {
      const size = rand(7, 14);
      const mat = new THREE.MeshBasicMaterial({ map: t.cloud, color: fogColor, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.rotation.z = rand(0, Math.PI * 2);
      mesh.position.set(rand(-hw, hw), rand(0.3, 2.2), rand(-hh, hh));
      g.add(mesh);
      const a = rand(0, Math.PI * 2), sp = rand(0.25, 0.7);
      this.fog.push({ mesh, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, spin: rand(-0.08, 0.08), base: rand(0.12, 0.22), phase: rand(0, 10) });
    }

    // floating data motes
    const count = Math.round(area * 1.1);
    const pos = new Float32Array(count * 3);
    this.moteSpeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand(-hw, hw);
      pos[i * 3 + 1] = rand(0.2, 7);
      pos[i * 3 + 2] = rand(-hh, hh);
      this.moteSpeed[i] = rand(0.15, 0.6);
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({
      map: t.dot, color: theme.clone().multiplyScalar(1.4), size: 0.14, transparent: true, opacity: 0.75,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    g.add(this.motes);

    // data pulses travelling along the floor grid lines; kept dim and thin so they never read as bullets
    const pulseMat = new THREE.MeshBasicMaterial({ color: theme.clone().multiplyScalar(0.9), transparent: true, opacity: 0.7 });
    const pulseGeo = new THREE.BoxGeometry(0.05, 0.01, 0.6);
    for (let i = 0; i < Math.round(area / 20); i++) {
      const mesh = new THREE.Mesh(pulseGeo, pulseMat);
      const p: Pulse = { mesh, axis: 'z', speed: 0, line: 0 };
      this.resetPulse(p, true);
      g.add(mesh);
      this.pulses.push(p);
    }

    // rift scars: glowing jagged cracks on the floor
    for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) {
      const pts: THREE.Vector3[] = [];
      let x = rand(-hw + 2, hw - 2), z = rand(-hh + 2, hh - 2), a = rand(0, Math.PI * 2);
      for (let k = 0; k < 7; k++) {
        pts.push(new THREE.Vector3(x, 0.025, z));
        a += rand(-0.9, 0.9);
        const step = rand(0.4, 0.9);
        x += Math.cos(a) * step;
        z += Math.sin(a) * step;
      }
      const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(0xb455ff).multiplyScalar(2.4), transparent: true, opacity: 0.8 });
      g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      this.scars.push(mat);
    }

    // soft light pool under the player
    this.playerGlow = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({
      map: t.glow, color: 0x4ff0ff, transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.playerGlow.rotation.x = -Math.PI / 2;
    this.playerGlow.position.y = 0.015;
    g.add(this.playerGlow);

    // wireframe debris drifting in the void beyond the walls
    const debrisColor = theme.clone().lerp(new THREE.Color(RIFT_PURPLE), 0.5).multiplyScalar(0.9);
    const shapes = [() => new THREE.IcosahedronGeometry(1, 0), () => new THREE.OctahedronGeometry(1), () => new THREE.BoxGeometry(1.4, 1.4, 1.4), () => new THREE.TetrahedronGeometry(1.2)];
    for (let i = 0; i < 14; i++) {
      const side = Math.random();
      // mostly beyond the far (north) wall and the sides, which is what the camera sees
      const x = side < 0.35 ? -hw - rand(5, 22) : side < 0.7 ? hw + rand(5, 22) : rand(-hw - 10, hw + 10);
      const z = side < 0.7 ? rand(-hh - 20, hh) : -hh - rand(6, 26);
      const y = rand(-8, 3);
      const obj = new THREE.LineSegments(new THREE.EdgesGeometry(shapes[i % shapes.length]()), new THREE.LineBasicMaterial({ color: debrisColor }));
      obj.scale.setScalar(rand(1.2, 4.5));
      obj.position.set(x, y, z);
      obj.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      g.add(obj);
      this.debris.push({ obj, spin: new THREE.Vector3(rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3)), bob: rand(0, 10), y });
    }

    this.scene.add(g);
    this.group = g;
  }

  update(dt: number, time: number, player: THREE.Vector3): void {
    if (!this.group) return;
    const { hw, hh } = this;

    for (const f of this.fog) {
      const p = f.mesh.position;
      p.x += f.vx * dt;
      p.z += f.vz * dt;
      // wrap around the room so the fog keeps flowing
      if (p.x > hw + 4) p.x = -hw - 4; else if (p.x < -hw - 4) p.x = hw + 4;
      if (p.z > hh + 4) p.z = -hh - 4; else if (p.z < -hh - 4) p.z = hh + 4;
      f.mesh.rotation.z += f.spin * dt;
      f.mesh.material.opacity = f.base * (0.6 + 0.4 * Math.sin(time * 0.5 + f.phase));
    }

    if (this.motes) {
      const pos = this.motes.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < this.moteSpeed.length; i++) {
        arr[i * 3 + 1] += this.moteSpeed[i] * dt;
        arr[i * 3] += Math.sin(time * 0.7 + i) * 0.1 * dt;
        if (arr[i * 3 + 1] > 7) arr[i * 3 + 1] = 0.2;
      }
      pos.needsUpdate = true;
    }

    for (const p of this.pulses) {
      const m = p.mesh.position;
      if (p.axis === 'z') m.z += p.speed * dt; else m.x += p.speed * dt;
      if (Math.abs(m.x) > hw || Math.abs(m.z) > hh) this.resetPulse(p, false);
    }

    const flicker = 0.55 + 0.35 * Math.sin(time * 3) + (Math.random() < 0.03 ? 0.4 : 0);
    for (const s of this.scars) s.opacity = flicker;

    if (this.playerGlow) this.playerGlow.position.set(player.x, 0.015, player.z);

    for (const d of this.debris) {
      d.obj.rotation.x += d.spin.x * dt;
      d.obj.rotation.y += d.spin.y * dt;
      d.obj.rotation.z += d.spin.z * dt;
      d.obj.position.y = d.y + Math.sin(time * 0.4 + d.bob) * 0.8;
    }
  }

  private resetPulse(p: Pulse, anywhere: boolean): void {
    const { hw, hh } = this;
    p.axis = Math.random() < 0.5 ? 'x' : 'z';
    p.speed = rand(3, 8) * (Math.random() < 0.5 ? -1 : 1);
    const m = p.mesh;
    // grid lines sit on even coordinates
    if (p.axis === 'z') {
      p.line = Math.round(rand(-hw, hw) / 2) * 2;
      m.rotation.y = 0;
      m.position.set(p.line, 0.03, anywhere ? rand(-hh, hh) : p.speed > 0 ? -hh : hh);
    } else {
      p.line = Math.round(rand(-hh, hh) / 2) * 2;
      m.rotation.y = Math.PI / 2;
      m.position.set(anywhere ? rand(-hw, hw) : p.speed > 0 ? -hw : hw, 0.03, p.line);
    }
  }

  private dispose(): void {
    if (this.group) {
      this.scene.remove(this.group);
      disposeTree(this.group);
    }
    this.group = null;
    this.fog = [];
    this.pulses = [];
    this.debris = [];
    this.scars = [];
    this.motes?.geometry.dispose();
    (this.motes?.material as THREE.Material | undefined)?.dispose();
    this.motes = null;
    this.playerGlow = null;
  }
}
