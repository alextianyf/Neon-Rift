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
  dispose?(): void;                  // frees materials owned by this visual (beyond `mat`)
}

// Per-frame inputs the visuals react to.
export interface VisualState {
  t: number;
  charge: number;     // 0..1 attack telegraph (shooter about to fire, brute winding up)
  enraged: boolean;
  stunned: boolean;
  beamAngle: number;  // weaver boss: rotation of its laser beams
  beamPhase: number;  // weaver boss: 0 off, 1 warning, 2 firing
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

// Pulses faster and swells as its fuse burns down.
function bomber(): EnemyVisual {
  const color = ENEMIES.bomber.color, mat = coreMaterial('bomber');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('bomber-core', () => new THREE.DodecahedronGeometry(0.36, 0)), mat);
  const shell = new THREE.LineSegments(edges('bomber-shell', () => new THREE.IcosahedronGeometry(0.62, 0)), lineMat(color, 2.4));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      const rate = 6 + s.charge * 30;
      core.scale.setScalar(1 + Math.abs(Math.sin(s.t * rate)) * (0.12 + s.charge * 0.35));
      shell.rotation.y += dt * (2 + s.charge * 10);
      shell.rotation.x += dt * 1.3;
      glitch.update(dt, 1.5, [core], shell);
    },
  };
}

// Two cells mid-division inside a stretched cage; splits into a swarm on death.
function splitter(): EnemyVisual {
  const color = ENEMIES.splitter.color, mat = coreMaterial('splitter');
  const root = new THREE.Group(), core = new THREE.Group();
  for (const x of [-0.24, 0.24]) {
    const cell = new THREE.Mesh(geo('splitter-cell', () => new THREE.IcosahedronGeometry(0.34, 0)), mat);
    cell.position.x = x;
    core.add(cell);
  }
  const shell = new THREE.LineSegments(edges('splitter-shell', () => new THREE.BoxGeometry(1.4, 0.9, 0.9)), lineMat(color, 2.2));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      const gap = 1 + Math.sin(s.t * 3) * 0.25;
      core.children[0].position.x = -0.24 * gap;
      core.children[1].position.x = 0.24 * gap;
      core.rotation.y += dt * 1.5;
      shell.rotation.y -= dt * 0.7;
      glitch.update(dt, 1.2, [core], shell);
    },
  };
}

// Long, thin body with a laser sight that shows where the next shot goes.
function sniper(): EnemyVisual {
  const color = ENEMIES.sniper.color, mat = coreMaterial('sniper');
  const root = new THREE.Group();
  const core = new THREE.Mesh(geo('sniper-core', () => new THREE.OctahedronGeometry(0.3).scale(0.7, 0.7, 2)), mat);
  const shell = new THREE.LineSegments(edges('sniper-shell', () => new THREE.OctahedronGeometry(0.62).scale(1, 0.6, 1.4)), lineMat(color, 2.2));
  const laserMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2244).multiplyScalar(2.5), transparent: true, opacity: 0 });
  const laser = new THREE.Mesh(geo('sniper-laser', () => new THREE.BoxGeometry(0.05, 0.05, 1).translate(0, 0, 0.5)), laserMat);
  laser.scale.z = 30;
  root.add(core, shell, laser);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.z += dt * 4;
      shell.rotation.z -= dt * 1.5;
      laserMat.opacity = s.charge > 0 ? 0.25 + s.charge * 0.6 + (s.charge > 0.75 ? Math.random() * 0.3 : 0) : 0;
      laser.scale.x = laser.scale.y = 0.6 + s.charge * 1.6;
      glitch.update(dt, 1, [core], shell);
    },
    dispose: () => laserMat.dispose(),
  };
}

// Heavy unit behind a glowing energy plate on its front; shots from the front bounce off.
function shield(): EnemyVisual {
  const color = ENEMIES.shield.color, mat = coreMaterial('shield');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('shield-core', () => new THREE.BoxGeometry(0.75, 0.75, 0.75)), mat);
  const shell = new THREE.LineSegments(edges('shield-shell', () => new THREE.BoxGeometry(1.1, 1.1, 1.1)), lineMat(color, 2));
  const plateGeo = geo('shield-plate', () => new THREE.CylinderGeometry(1.15, 1.15, 1.3, 6, 1, true, -Math.PI / 3, (Math.PI * 2) / 3));
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  }));
  const plateEdges = new THREE.LineSegments(edges('shield-plate', () => new THREE.CylinderGeometry(1.15, 1.15, 1.3, 6, 1, true, -Math.PI / 3, (Math.PI * 2) / 3)), lineMat(color, 3));
  root.add(core, shell, plate, plateEdges);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * 1.2;
      (plate.material as THREE.MeshBasicMaterial).opacity = 0.28 + Math.sin(s.t * 5) * 0.08;
      glitch.update(dt, 0.8, [core], shell);
    },
    dispose: () => (plate.material as THREE.Material).dispose(),
  };
}

// Floats above the ground surrounded by orbiting crystals that spin up before a summon.
function summoner(): EnemyVisual {
  const color = ENEMIES.summoner.color, mat = coreMaterial('summoner');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('summoner-core', () => new THREE.OctahedronGeometry(0.42)), mat);
  const shell = new THREE.LineSegments(edges('summoner-shell', () => new THREE.TorusGeometry(0.9, 0.02, 3, 6)), lineMat(color, 2.4));
  shell.rotation.x = Math.PI / 2;
  const crystals: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const c = new THREE.Mesh(geo('summoner-crystal', () => new THREE.OctahedronGeometry(0.16).scale(1, 2.2, 1)), glowMat(color, 2.2));
    crystals.push(c);
    root.add(c);
  }
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * 2;
      shell.rotation.z += dt * (0.8 + s.charge * 6);
      const radius = 1.0 - s.charge * 0.4;
      crystals.forEach((c, i) => {
        const a = s.t * (1.5 + s.charge * 8) + (i / 4) * Math.PI * 2;
        c.position.set(Math.sin(a) * radius, Math.sin(s.t * 2 + i) * 0.2, Math.cos(a) * radius);
      });
      glitch.update(dt, 1, [core], shell);
    },
  };
}

// Weaver: spider-like core with legs and three laser emitters that sweep the arena.
function boss2(): EnemyVisual {
  const color = ENEMIES.boss2.color, mat = coreMaterial('boss2');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('boss2-core', () => new THREE.OctahedronGeometry(1.0)), mat);
  const shell = new THREE.LineSegments(edges('boss2-shell', () => new THREE.OctahedronGeometry(1.7)), lineMat(color, 2.4));
  // legs reaching to the floor
  const legPts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2, x = Math.sin(a), z = Math.cos(a);
    legPts.push(0, 0, 0, x * 1.8, 0.6, z * 1.8, x * 1.8, 0.6, z * 1.8, x * 2.8, -1.55, z * 2.8);
  }
  const legGeo = new THREE.BufferGeometry();
  legGeo.setAttribute('position', new THREE.Float32BufferAttribute(legPts, 3));
  const legs = new THREE.LineSegments(legGeo, lineMat(color, 2));
  const beams = new THREE.Group();
  const beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 0 });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(geo('boss2-beam', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5)), beamMat);
    b.rotation.y = (i / 3) * Math.PI * 2;
    b.scale.set(0.15, 0.15, 16);
    beams.add(b);
  }
  beams.position.y = -0.6;
  root.add(core, shell, legs, beams);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * (s.enraged ? 2.5 : 1.2);
      shell.rotation.y -= dt * 0.6;
      legs.rotation.y += dt * 0.3;
      beams.rotation.y = s.beamAngle;
      const w = s.beamPhase === 2 ? 0.45 + Math.random() * 0.15 : 0.1;
      for (const b of beams.children) b.scale.set(w, w, 16);
      beamMat.opacity = s.beamPhase === 0 ? 0 : s.beamPhase === 1 ? (Math.random() < 0.5 ? 0.15 : 0.45) : 0.9;
      glitch.update(dt, s.enraged ? 3 : 1, [core], shell);
    },
    dispose: () => { beamMat.dispose(); legGeo.dispose(); },
  };
}

// Sovereign: towering crystal with orbiting rings and a crown of spikes; teleports through rifts.
function boss3(): EnemyVisual {
  const color = ENEMIES.boss3.color, mat = coreMaterial('boss3');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('boss3-core', () => new THREE.OctahedronGeometry(1.1).scale(1, 1.8, 1)), mat);
  const shell = new THREE.LineSegments(edges('boss3-shell', () => new THREE.OctahedronGeometry(1.6).scale(1, 1.8, 1)), lineMat(color, 2.4));
  const ringA = new THREE.LineSegments(edges('boss3-ring', () => new THREE.TorusGeometry(2.6, 0.04, 3, 40)), lineMat(color, 2));
  const ringB = ringA.clone();
  const crown = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const spike = new THREE.Mesh(geo('boss3-spike', () => new THREE.ConeGeometry(0.14, 0.9, 4)), glowMat(color, 2.2));
    spike.position.set(Math.sin(a) * 0.9, 2.2, Math.cos(a) * 0.9);
    spike.rotation.set(Math.cos(a) * 0.4, 0, -Math.sin(a) * 0.4);
    crown.add(spike);
  }
  root.add(core, shell, ringA, ringB, crown);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      const speed = s.enraged ? 2 : 1;
      core.rotation.y += dt * 0.7 * speed;
      shell.rotation.y -= dt * 0.4 * speed;
      ringA.rotation.set(Math.PI / 2 + Math.sin(s.t * 0.7) * 0.5, s.t * 0.8 * speed, 0);
      ringB.rotation.set(Math.PI / 2 + Math.cos(s.t * 0.6) * 0.5, -s.t * 0.6 * speed, 0.6);
      crown.rotation.y += dt * 1.2 * speed;
      glitch.update(dt, s.enraged ? 4 : 1, [core], shell);
    },
  };
}

const BUILDERS: Record<EnemyKind, () => EnemyVisual> = { grunt, swarmer, bomber, splitter, shooter, sniper, shield, summoner, brute, boss, boss2, boss3 };

export function buildEnemyVisual(kind: EnemyKind): EnemyVisual {
  return BUILDERS[kind]();
}
