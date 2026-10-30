import * as THREE from 'three';
import { glowMat, markShared } from '../core/assets';
import { rand } from '../core/math';
import { ENEMIES, type EnemyKind } from '../data/enemies';

// Visual side of an enemy: a solid emissive core inside a rotating wireframe shell,
// with occasional glitch jitter. Gameplay code only moves/rotates/scales `root`
// and tints `mat`; everything else animates here.
export interface EnemyVisual {
  root: THREE.Group;
  mat: THREE.MeshStandardMaterial;   // core material, owned by this enemy (tinted on hit / status)
  shell: THREE.LineSegments;         // outer wireframe, also used for the death dissolve
  animate(dt: number, s: VisualState): void;
}

// Per-frame inputs the visuals react to.
export interface VisualState {
  t: number;
  charge: number;     // 0..1 attack telegraph (shooter about to fire, brute winding up)
  enraged: boolean;
  stunned: boolean;
}

const lineCache = new Map<string, THREE.LineBasicMaterial>();
function lineMat(hex: number, k: number): THREE.LineBasicMaterial {
  const key = `${hex}:${k}`;
  let m = lineCache.get(key);
  if (!m) {
    m = markShared(new THREE.LineBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }));
    lineCache.set(key, m);
  }
  return m;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = markShared(make());
    geoCache.set(key, g);
  }
  return g;
}
const edges = (key: string, make: () => THREE.BufferGeometry) => geo(`edges:${key}`, () => new THREE.EdgesGeometry(make()));

function coreMaterial(kind: EnemyKind): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: ENEMIES[kind].color, emissiveIntensity: 1.6, roughness: 0.4, flatShading: true });
}

// Brief positional jitter + flicker, the "corrupted data" look.
class Glitch {
  private timer = 0;
  update(dt: number, rate: number, parts: THREE.Object3D[], shell: THREE.Object3D): void {
    this.timer -= dt;
    if (this.timer <= 0 && Math.random() < dt * rate) this.timer = rand(0.05, 0.12);
    const on = this.timer > 0;
    for (const p of parts) p.position.set(on ? rand(-0.14, 0.14) : 0, p.position.y, on ? rand(-0.14, 0.14) : 0);
    shell.visible = !on || Math.random() < 0.5;
    shell.scale.x = on ? rand(1.05, 1.3) : 1;
  }
}

function grunt(): EnemyVisual {
  const color = ENEMIES.grunt.color, mat = coreMaterial('grunt');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('grunt-core', () => new THREE.IcosahedronGeometry(0.4, 0)), mat));
  // six spikes: the "virus" read
  const spikeGeo = geo('grunt-spike', () => new THREE.ConeGeometry(0.09, 0.42, 5).translate(0, 0.42, 0));
  for (const [rx, rz] of [[0, 0], [Math.PI, 0], [Math.PI / 2, 0], [-Math.PI / 2, 0], [0, Math.PI / 2], [0, -Math.PI / 2]]) {
    const s = new THREE.Mesh(spikeGeo, mat);
    s.rotation.set(rx, 0, rz);
    core.add(s);
  }
  const shell = new THREE.LineSegments(edges('grunt-shell', () => new THREE.BoxGeometry(1.05, 1.05, 1.05)), lineMat(color, 2.4));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * 2.2;
      core.rotation.x += dt * 1.1;
      shell.rotation.x += dt * 1.3;
      shell.rotation.z -= dt * 0.9;
      const pulse = 1 + Math.sin(s.t * 8) * 0.06;
      core.scale.setScalar(pulse);
      glitch.update(dt, 1.5, [core], shell);
    },
  };
}

// Tiny, fast and numerous: a spinning dart inside a wire tetrahedron.
function swarmer(): EnemyVisual {
  const color = ENEMIES.swarmer.color, mat = coreMaterial('swarmer');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('swarmer-core', () => new THREE.TetrahedronGeometry(0.24)), mat);
  const shell = new THREE.LineSegments(edges('swarmer-shell', () => new THREE.TetrahedronGeometry(0.46)), lineMat(color, 2.2));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt) {
      core.rotation.y += dt * 9;
      shell.rotation.x += dt * 4;
      shell.rotation.z += dt * 3;
      glitch.update(dt, 2, [core], shell);
    },
  };
}

function shooter(): EnemyVisual {
  const color = ENEMIES.shooter.color, mat = coreMaterial('shooter');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('shooter-core', () => new THREE.OctahedronGeometry(0.42)), mat);
  const shell = new THREE.LineSegments(edges('shooter-shell', () => new THREE.OctahedronGeometry(0.78)), lineMat(color, 2.4));
  const ring = new THREE.LineSegments(edges('shooter-ring', () => new THREE.TorusGeometry(0.95, 0.02, 3, 28)), lineMat(color, 1.8));
  ring.rotation.x = Math.PI / 2;
  const sats: THREE.Mesh[] = [];
  const satMat = glowMat(color, 2.2);
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(geo('shooter-sat', () => new THREE.TetrahedronGeometry(0.16)), satMat);
    sats.push(m);
    root.add(m);
  }
  root.add(core, shell, ring);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y -= dt * 3;
      shell.rotation.y += dt * 1.2;
      ring.rotation.z += dt * 0.8;
      // satellites orbit; they pull in and spin up while charging a shot
      const radius = 0.95 - s.charge * 0.55, speed = 2 + s.charge * 10;
      sats.forEach((m, i) => {
        const a = s.t * speed + (i / 3) * Math.PI * 2;
        m.position.set(Math.sin(a) * radius, Math.sin(s.t * 3 + i) * 0.12, Math.cos(a) * radius);
        m.rotation.x += dt * 5;
      });
      glitch.update(dt, 1.2, [core], shell);
    },
  };
}

function brute(): EnemyVisual {
  const color = ENEMIES.brute.color, mat = coreMaterial('brute');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('brute-core', () => new THREE.BoxGeometry(1.25, 1.0, 1.25)), mat));
  // battering ram wedge on the front
  const ram = new THREE.Mesh(geo('brute-ram', () => new THREE.ConeGeometry(0.55, 0.8, 4).rotateX(Math.PI / 2).rotateZ(Math.PI / 4)), mat);
  ram.position.set(0, 0, 0.95);
  core.add(ram);
  const shell = new THREE.LineSegments(edges('brute-shell', () => new THREE.BoxGeometry(2.0, 1.6, 2.0)), lineMat(color, 2.4));
  const plates = new THREE.LineSegments(edges('brute-plates', () => new THREE.BoxGeometry(2.4, 0.5, 1.2)), lineMat(color, 1.6));
  plates.position.y = 0.55;
  root.add(core, shell, plates);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      // shell swells and rattles while winding up a charge
      const swell = 1 + s.charge * 0.18 + (s.charge > 0 ? Math.sin(s.t * 50) * 0.03 : 0);
      shell.scale.set(swell, swell, swell);
      plates.rotation.y = Math.sin(s.t * 1.5) * 0.15;
      glitch.update(dt, s.stunned ? 12 : 0.8, [core], shell);
    },
  };
}

function boss(): EnemyVisual {
  const color = ENEMIES.boss.color, mat = coreMaterial('boss');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('boss-core', () => new THREE.IcosahedronGeometry(1.1, 0)), mat);
  const inner = new THREE.LineSegments(edges('boss-inner', () => new THREE.IcosahedronGeometry(1.75, 0)), lineMat(color, 2.6));
  const shell = new THREE.LineSegments(edges('boss-shell', () => new THREE.IcosahedronGeometry(2.45, 1)), lineMat(color, 1.6));
  const nodes: THREE.Mesh[] = [];
  const nodeMat = glowMat(color, 2.2);
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(geo('boss-node', () => new THREE.BoxGeometry(0.34, 0.34, 0.34)), nodeMat);
    nodes.push(m);
    root.add(m);
  }
  root.add(core, inner, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      const speed = s.enraged ? 2.2 : 1;
      core.rotation.y += dt * 0.8 * speed;
      core.rotation.x += dt * 0.5 * speed;
      inner.rotation.y -= dt * 1.1 * speed;
      inner.rotation.z += dt * 0.6 * speed;
      shell.rotation.y += dt * 0.35 * speed;
      nodes.forEach((m, i) => {
        const a = s.t * 0.9 * speed + (i / 6) * Math.PI * 2;
        m.position.set(Math.sin(a) * 3.0, Math.sin(s.t * 2 + i) * 0.4, Math.cos(a) * 3.0);
        m.rotation.y += dt * 3;
      });
      glitch.update(dt, s.enraged ? 4 : 1, [core, inner], shell);
    },
  };
}

const BUILDERS: Record<EnemyKind, () => EnemyVisual> = { grunt, swarmer, shooter, brute, boss };

export function buildEnemyVisual(kind: EnemyKind): EnemyVisual {
  return BUILDERS[kind]();
}
