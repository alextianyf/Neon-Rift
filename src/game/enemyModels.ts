import * as THREE from 'three';
import { GEO, glowMat, markShared } from '../core/assets';
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
  beamPhase: number;  // weaver boss: 0 off, 1 warning, 2 firing; mirror: which face is lit
  alpha: number;      // 0..1 how visible it is (phase assassin cloaking)
  variant: boolean;   // abyss variant
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

// Corroder: a flat octagonal slug with acid drops hanging under it.
function corroder(): EnemyVisual {
  const color = ENEMIES.corroder.color, mat = coreMaterial('corroder');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('corroder-core', () => new THREE.CylinderGeometry(0.55, 0.65, 0.32, 8)), mat));
  const dropMat = glowMat(color, 2.4);
  const drops: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const d = new THREE.Mesh(geo('corroder-drop', () => new THREE.SphereGeometry(0.09, 6, 4)), dropMat);
    const a = (i / 4) * Math.PI * 2 + 0.4;
    d.position.set(Math.sin(a) * 0.4, -0.22, Math.cos(a) * 0.4);
    drops.push(d);
    core.add(d);
  }
  const shell = new THREE.LineSegments(edges('corroder-shell', () => new THREE.CylinderGeometry(0.8, 0.9, 0.5, 8)), lineMat(color, 2.2));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * 0.8;
      shell.rotation.y -= dt * 0.5;
      core.scale.set(1 + Math.sin(s.t * 5) * 0.06, 1 - Math.sin(s.t * 5) * 0.08, 1 + Math.sin(s.t * 5) * 0.06);
      drops.forEach((d, i) => { d.position.y = -0.22 - ((s.t * 0.8 + i * 0.25) % 1) * 0.25; });
      glitch.update(dt, 1, [core], shell);
    },
  };
}

// Prism tower: an upright triangular prism; its three side panels fold out into gun arms when planted.
function tower(): EnemyVisual {
  const color = ENEMIES.tower.color, mat = coreMaterial('tower');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('tower-core', () => new THREE.CylinderGeometry(0.42, 0.5, 1.3, 3)), mat));
  const arms = new THREE.Group();
  const panels: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = (i / 3) * Math.PI * 2;
    const panel = new THREE.Mesh(geo('tower-panel', () => new THREE.BoxGeometry(0.12, 0.9, 0.6).translate(0, 0, 0.3)), mat);
    panel.position.z = 0.35;
    pivot.add(panel);
    panels.push(panel);
    arms.add(pivot);
  }
  core.add(arms);
  const shell = new THREE.LineSegments(edges('tower-shell', () => new THREE.CylinderGeometry(0.75, 0.85, 1.7, 3)), lineMat(color, 2.2));
  root.add(core, shell);
  const glitch = new Glitch();
  let open = 0;
  return {
    root, mat, shell,
    animate(dt, s) {
      const target = s.beamPhase === 2 ? 1 : s.beamPhase === 1 ? s.charge : 0;
      open += (target - open) * Math.min(1, dt * 10);
      for (const p of panels) p.rotation.x = -open * Math.PI / 2;  // fold out flat
      // while planted the arms point where the bullet streams go (world angle, not facing)
      if (s.beamPhase === 2) arms.rotation.y = s.beamAngle - root.rotation.y;
      shell.rotation.y += dt * (0.4 + open);
      glitch.update(dt, 0.8, [core], shell);
    },
  };
}

// Burrower: a drill cone with a glowing spiral; spins faster just before it dives.
function burrower(): EnemyVisual {
  const color = ENEMIES.burrower.color, mat = coreMaterial('burrower');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('burrower-core', () => new THREE.ConeGeometry(0.45, 1.1, 6).rotateX(Math.PI)), mat));
  const pts: number[] = [];
  for (let i = 0; i < 40; i++) {
    const k = i / 40, a = k * Math.PI * 6, r = 0.5 * (1 - k) + 0.05;
    const k2 = (i + 1) / 40, a2 = k2 * Math.PI * 6, r2 = 0.5 * (1 - k2) + 0.05;
    pts.push(Math.sin(a) * r, 0.55 - k * 1.1, Math.cos(a) * r, Math.sin(a2) * r2, 0.55 - k2 * 1.1, Math.cos(a2) * r2);
  }
  const spiral = new THREE.LineSegments(geo('burrower-spiral', () => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))), lineMat(color, 2.8));
  core.add(spiral);
  const shell = new THREE.LineSegments(edges('burrower-shell', () => new THREE.ConeGeometry(0.75, 1.5, 6).rotateX(Math.PI)), lineMat(color, 1.8));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * (3 + s.charge * 20);
      shell.rotation.y -= dt * 1.5;
      glitch.update(dt, 1.2, [core], shell);
    },
  };
}

// Replicator: a cell wrapped in membrane rings that bulges before it buds off a copy.
function replicator(): EnemyVisual {
  const color = ENEMIES.replicator.color, mat = coreMaterial('replicator');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('replicator-core', () => new THREE.IcosahedronGeometry(0.38, 1)), mat);
  const rings = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.LineSegments(edges('replicator-ring', () => new THREE.TorusGeometry(0.55, 0.02, 3, 24)), lineMat(color, 2));
    ring.rotation.set(i * 1.05, i * 0.7, 0);
    rings.add(ring);
  }
  const shell = new THREE.LineSegments(edges('replicator-shell', () => new THREE.IcosahedronGeometry(0.72, 0)), lineMat(color, 1.6));
  root.add(core, rings, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      rings.rotation.y += dt * 1.2;
      rings.rotation.x += dt * 0.7;
      const bulge = s.charge > 0.7 ? (s.charge - 0.7) * 1.2 : 0;
      core.scale.set(1 + bulge, 1 - bulge * 0.3, 1 + bulge * 0.4);
      shell.rotation.z += dt * 0.6;
      glitch.update(dt, 1 + bulge * 10, [core], shell);
    },
  };
}

// Linker: a half-moon with a bright node in its hollow, where the beam attaches.
function linker(): EnemyVisual {
  const color = ENEMIES.linker.color, mat = coreMaterial('linker');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('linker-moon', () => new THREE.TorusGeometry(0.42, 0.14, 6, 14, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2)), mat));
  const node = new THREE.Mesh(geo('linker-node', () => new THREE.OctahedronGeometry(0.14)), glowMat(0xcffaff, 2.4));
  core.add(node);
  const shell = new THREE.LineSegments(edges('linker-shell', () => new THREE.CylinderGeometry(0.7, 0.7, 0.5, 6)), lineMat(color, 2));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      node.rotation.y += dt * 4;
      node.scale.setScalar(1 + Math.sin(s.t * 8) * 0.2 + (s.enraged ? 0.5 : 0));
      core.rotation.z = Math.sin(s.t * 3) * 0.15;
      shell.rotation.y -= dt * (s.enraged ? 3 : 0.8);
      glitch.update(dt, s.enraged ? 4 : 1, [core], shell);
    },
  };
}

// Phase assassin: a long diamond blade with two fins; mostly see-through until it strikes.
function assassin(): EnemyVisual {
  const color = ENEMIES.assassin.color, mat = coreMaterial('assassin');
  mat.transparent = true;
  const edge = new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2), transparent: true });
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('assassin-blade', () => new THREE.OctahedronGeometry(0.5).scale(0.4, 0.5, 1.3)), mat));
  for (const side of [-1, 1]) {
    const fin = new THREE.Mesh(geo('assassin-fin', () => new THREE.ConeGeometry(0.12, 0.6, 3).rotateZ(Math.PI / 2)), mat);
    fin.position.set(side * 0.35, 0, -0.15);
    fin.scale.x = side;
    core.add(fin);
  }
  const shell = new THREE.LineSegments(edges('assassin-shell', () => new THREE.OctahedronGeometry(0.75).scale(0.5, 0.6, 1.3)), edge);
  root.add(core, shell);
  const glitch = new Glitch();
  const white = new THREE.Color(0xffffff).multiplyScalar(2.6), base = edge.color.clone();
  return {
    root, mat, shell,
    animate(dt, s) {
      mat.opacity = s.alpha;
      edge.opacity = Math.min(1, s.alpha * 1.6);
      edge.color.copy(base).lerp(white, s.charge);  // edges go white as it winds up the slash
      core.rotation.z += dt * (1 + s.charge * 12);
      glitch.update(dt, s.alpha < 1 ? 3 : 0.8, [core], shell);
    },
    dispose() { edge.dispose(); },
  };
}

// Mender: a cross with a slowly turning light core that pulses while it beams.
function mender(): EnemyVisual {
  const color = ENEMIES.mender.color, mat = coreMaterial('mender');
  const root = new THREE.Group(), core = new THREE.Group();
  const bar = geo('mender-bar', () => new THREE.BoxGeometry(1, 0.2, 0.2));
  const a = new THREE.Mesh(bar, mat), b = new THREE.Mesh(bar, mat);
  b.rotation.y = Math.PI / 2;
  core.add(a, b);
  const heart = new THREE.Mesh(geo('mender-heart', () => new THREE.IcosahedronGeometry(0.2, 0)), glowMat(0x5cffb0, 2.4));
  core.add(heart);
  const shell = new THREE.LineSegments(edges('mender-shell', () => new THREE.TorusGeometry(0.72, 0.04, 3, 4)), lineMat(color, 2));
  shell.rotation.x = Math.PI / 2;
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * 0.6;
      heart.rotation.x += dt * 2;
      heart.scale.setScalar(1 + s.charge * 0.5);
      shell.rotation.z += dt * 0.4;
      glitch.update(dt, 0.8, [core], shell);
    },
  };
}

// Mirror: a cube with a mirror panel on each side; the lit (reflecting) panel is bright white.
function mirror(): EnemyVisual {
  const color = ENEMIES.mirror.color, mat = coreMaterial('mirror');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('mirror-core', () => new THREE.BoxGeometry(0.85, 0.85, 0.85)), mat));
  const lit = glowMat(0xffffff, 2.6), dim = glowMat(0x4a5870, 1);
  const panels: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const p = new THREE.Mesh(geo('mirror-panel', () => new THREE.PlaneGeometry(0.78, 0.78)), dim);
    p.position.set(Math.sin(a) * 0.44, 0, Math.cos(a) * 0.44);  // face i points along the body's angle + i·90°
    p.rotation.y = a;
    panels.push(p);
    core.add(p);
  }
  const shell = new THREE.LineSegments(edges('mirror-shell', () => new THREE.BoxGeometry(1.15, 1.15, 1.15)), lineMat(color, 1.8));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      const flick = s.charge > 0 && Math.sin(s.t * 40) < 0;  // about to move on: the lit face flickers
      panels.forEach((p, i) => { p.material = i === s.beamPhase && !flick ? lit : dim; });
      shell.rotation.y -= dt * 0.3;
      glitch.update(dt, 0.6, [core], shell);
    },
  };
}

// Prism Colossus: a tall faceted crystal with a floating halo; its plates are separate enemies.
function colossus(): EnemyVisual {
  const color = ENEMIES.colossus.color, mat = coreMaterial('colossus');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('colossus-core', () => new THREE.OctahedronGeometry(1, 0).scale(0.9, 1.7, 0.9)), mat);
  const shell = new THREE.LineSegments(edges('colossus-shell', () => new THREE.OctahedronGeometry(1.45, 0).scale(0.9, 1.6, 0.9)), lineMat(color, 2.2));
  const halo = new THREE.LineSegments(edges('colossus-halo', () => new THREE.TorusGeometry(1.5, 0.04, 3, 8)), lineMat(0xffd27a, 1.6));
  halo.position.y = 1.9;
  root.add(core, shell, halo);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      core.rotation.y += dt * (s.enraged ? 1.6 : 0.6);
      shell.rotation.y -= dt * 0.3;
      halo.rotation.set(Math.PI / 2, 0, s.t * 0.8);
      glitch.update(dt, s.enraged ? 3 : 0.8, [core], shell);
    },
  };
}

// Prism plate: a wide glowing pane facing away from the colossus.
function prismPlate(): EnemyVisual {
  const color = ENEMIES.prismPlate.color, mat = coreMaterial('prismPlate');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('plate-core', () => new THREE.BoxGeometry(2, 1.5, 0.14)), mat);
  const shell = new THREE.LineSegments(edges('plate-shell', () => new THREE.BoxGeometry(2.2, 1.7, 0.3)), lineMat(color, 2));
  root.add(core, shell);
  return {
    root, mat, shell,
    animate(_dt, s) { core.position.y = Math.sin(s.t * 3) * 0.08; },
  };
}

// Burrow wyrm head: a drill-jawed cone.
function wyrm(): EnemyVisual {
  const color = ENEMIES.wyrm.color, mat = coreMaterial('wyrm');
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo('wyrm-head', () => new THREE.ConeGeometry(0.9, 1.9, 6).rotateX(Math.PI / 2)), mat));
  const jaws: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const jaw = new THREE.Mesh(geo('wyrm-jaw', () => new THREE.ConeGeometry(0.18, 1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.5)), glowMat(0xffb070, 2.2));
    jaw.position.set(side * 0.6, 0, 0.6);
    jaws.push(jaw);
    core.add(jaw);
  }
  const shell = new THREE.LineSegments(edges('wyrm-shell', () => new THREE.ConeGeometry(1.25, 2.4, 6).rotateX(Math.PI / 2)), lineMat(color, 2));
  root.add(core, shell);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      const open = 0.3 + Math.sin(s.t * (s.enraged ? 14 : 7)) * 0.25 + s.charge * 0.4;
      jaws.forEach((j, i) => { j.rotation.y = (i ? -1 : 1) * open; });
      core.rotation.z += dt * (2 + s.charge * 10);
      glitch.update(dt, s.enraged ? 3 : 0.8, [core], shell);
    },
  };
}

// Wyrm body segment: an armored ring with a glowing band.
function wyrmSeg(): EnemyVisual {
  const color = ENEMIES.wyrmSeg.color, mat = coreMaterial('wyrmSeg');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('seg-core', () => new THREE.DodecahedronGeometry(0.75, 0).scale(1, 0.85, 0.8)), mat);
  const band = new THREE.LineSegments(edges('seg-band', () => new THREE.TorusGeometry(0.8, 0.05, 3, 10)), lineMat(0xffb070, 2));
  const shell = new THREE.LineSegments(edges('seg-shell', () => new THREE.DodecahedronGeometry(0.95, 0)), lineMat(color, 1.6));
  root.add(core, band, shell);
  return {
    root, mat, shell,
    animate(dt, s) {
      band.rotation.z += dt * 2;
      core.scale.y = 0.85 + Math.sin(s.t * 6) * 0.05;
    },
  };
}

// Mirror Mind: a bright core inside four orbiting mirror shards. Only the real one casts a shadow
// and has the bright core; clones are a dimmer copy.
function mirrorMindVisual(real: boolean): EnemyVisual {
  const color = ENEMIES.mirrorMind.color, mat = coreMaterial(real ? 'mirrorMind' : 'mirrorClone');
  const root = new THREE.Group(), core = new THREE.Mesh(geo('mind-core', () => new THREE.IcosahedronGeometry(0.75, 0)), mat);
  const heart = new THREE.Mesh(geo('mind-heart', () => new THREE.OctahedronGeometry(0.3)), glowMat(0xffffff, real ? 2.6 : 1.1));
  const shards = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const s = new THREE.Mesh(geo('mind-shard', () => new THREE.BoxGeometry(0.9, 1.3, 0.08)), glowMat(0x6a7a98, 1.2));
    s.position.set(Math.sin(a) * 1.3, 0, Math.cos(a) * 1.3);
    s.rotation.y = a;
    shards.add(s);
  }
  const shell = new THREE.LineSegments(edges('mind-shell', () => new THREE.IcosahedronGeometry(1.05, 0)), lineMat(color, real ? 2 : 1.2));
  root.add(core, heart, shards, shell);
  if (real) {
    const shadow = new THREE.Mesh(geo('mind-shadow', () => new THREE.CircleGeometry(1.4, 20).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }));
    shadow.position.y = -ENEMIES.mirrorMind.y + 0.03;
    root.add(shadow);
  }
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      shards.rotation.y += dt * (s.enraged ? 2 : 1);
      core.rotation.y -= dt * 0.5;
      heart.rotation.x += dt * 3;
      heart.scale.setScalar(1 + s.charge * 0.6);
      glitch.update(dt, real ? 1 : 3, [core], shell);
    },
  };
}
const mirrorMind = () => mirrorMindVisual(true);
const mirrorClone = () => mirrorMindVisual(false);

// ---------------------------------------------------------------------------------------------
// Endless-strata enemies. Most are a core shape + a wireframe shell + a few decorations, so they
// share one builder; `extra` adds the pieces that make each one recognizable.

interface SimpleSpec {
  core: () => THREE.BufferGeometry;
  shell: () => THREE.BufferGeometry;
  extra?: (core: THREE.Group, color: number) => (dt: number, s: VisualState) => void;
  spin?: number;
  glitch?: number;
}

function simple(kind: EnemyKind, spec: SimpleSpec): EnemyVisual {
  const color = ENEMIES[kind].color, mat = coreMaterial(kind);
  const root = new THREE.Group(), core = new THREE.Group();
  core.add(new THREE.Mesh(geo(`${kind}-core`, spec.core), mat));
  const shell = new THREE.LineSegments(edges(`${kind}-shell`, spec.shell), lineMat(color, 2));
  root.add(core, shell);
  const anim = spec.extra?.(core, color);
  const glitch = new Glitch();
  return {
    root, mat, shell,
    animate(dt, s) {
      shell.rotation.y += dt * (spec.spin ?? 0.6);
      anim?.(dt, s);
      glitch.update(dt, spec.glitch ?? 1, [core], shell);
    },
  };
}

const orbit = (core: THREE.Group, n: number, r: number, size: number, color: number, k = 2.4) => {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = new THREE.Mesh(geo(`orb-${size}`, () => new THREE.OctahedronGeometry(size)), glowMat(color, k));
    m.position.set(Math.sin(a) * r, 0, Math.cos(a) * r);
    g.add(m);
  }
  core.add(g);
  return g;
};

// Rewinder: two octahedra slightly out of step, like a doubled signal.
const rewinder = () => simple('rewinder', {
  core: () => new THREE.OctahedronGeometry(0.45),
  shell: () => new THREE.OctahedronGeometry(0.75),
  extra(core) {
    const echo = new THREE.Mesh(geo('rewinder-echo', () => new THREE.OctahedronGeometry(0.45)), glowMat(0x7fb8b0, 0.9));
    core.add(echo);
    return (_dt, s) => { echo.position.set(Math.sin(s.t * 3) * 0.25, 0.1, Math.cos(s.t * 2) * 0.2); core.rotation.y = s.t; };
  },
});

// Missile nest: a hexagonal base with launch holes on top.
const missileNest = () => simple('missileNest', {
  core: () => new THREE.CylinderGeometry(0.75, 0.85, 0.5, 6),
  shell: () => new THREE.CylinderGeometry(1, 1.05, 0.7, 6),
  extra(core) {
    const holes = orbit(core, 3, 0.4, 0.12, 0xff8060);
    holes.position.y = 0.3;
    return (_dt, s) => { holes.rotation.y = s.t * 0.5; };
  },
});

const missile = () => simple('missile', {
  core: () => new THREE.ConeGeometry(0.18, 0.7, 5).rotateX(Math.PI / 2),
  shell: () => new THREE.ConeGeometry(0.26, 0.9, 5).rotateX(Math.PI / 2),
  spin: 0,
  extra(core) { return (dt) => { core.rotation.z += dt * 10; }; },
});

// Condenser: a six-point snowflake star.
const condenser = () => simple('condenser', {
  core: () => new THREE.OctahedronGeometry(0.3),
  shell: () => new THREE.IcosahedronGeometry(0.8, 0),
  extra(core, color) {
    for (let i = 0; i < 6; i++) {
      const arm = new THREE.Mesh(geo('condenser-arm', () => new THREE.BoxGeometry(0.1, 0.1, 0.7).translate(0, 0, 0.4)), glowMat(color, 2));
      arm.rotation.y = (i / 6) * Math.PI * 2;
      core.add(arm);
    }
    return (dt) => { core.rotation.y += dt * 0.8; };
  },
});

// Quaker: a wide trapezoid with a glowing ring at its feet.
const quaker = () => simple('quaker', {
  core: () => new THREE.CylinderGeometry(0.6, 1, 0.9, 4),
  shell: () => new THREE.CylinderGeometry(0.85, 1.3, 1.2, 4),
  spin: 0.2,
  extra(core, color) {
    const ring = new THREE.Mesh(GEO.ring, glowMat(color, 2));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -0.7;
    ring.scale.setScalar(1.3);
    core.add(ring);
    return (_dt, s) => { ring.scale.setScalar(1.3 + s.charge * 0.6); };
  },
});

// Light eater: a black ball with motes of light drawn inward. The one virus that doesn't glow.
function lightEater(): EnemyVisual {
  const mat = new THREE.MeshStandardMaterial({ color: 0x050308, emissive: 0x000000, roughness: 1, flatShading: true });
  const root = new THREE.Group(), core = new THREE.Mesh(geo('eater-core', () => new THREE.IcosahedronGeometry(0.6, 1)), mat);
  const motes = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(geo('eater-mote', () => new THREE.OctahedronGeometry(0.06)), glowMat(0x9a60ff, 2));
    motes.add(m);
  }
  const shell = new THREE.LineSegments(edges('eater-shell', () => new THREE.IcosahedronGeometry(0.85, 0)), lineMat(ENEMIES.lightEater.color, 1.2));
  root.add(core, motes, shell);
  return {
    root, mat, shell,
    animate(dt, s) {
      motes.children.forEach((m, i) => {
        const k = ((s.t * 0.5 + i / 10) % 1), a = i * 2.4 + s.t * 0.3, r = 1.6 * (1 - k) + 0.6;
        m.position.set(Math.sin(a) * r, Math.sin(i) * 0.4, Math.cos(a) * r);
      });
      shell.rotation.y -= dt * 0.4;
    },
  };
}

// Diver: a swept delta wing that folds into an arrowhead when it drops.
const diver = () => simple('diver', {
  core: () => new THREE.ConeGeometry(0.5, 1, 3).rotateX(Math.PI / 2).scale(1.6, 0.3, 1),
  shell: () => new THREE.ConeGeometry(0.7, 1.3, 3).rotateX(Math.PI / 2).scale(1.6, 0.35, 1),
  spin: 0,
  extra(core) { return (_dt, s) => { core.rotation.z = Math.sin(s.t * 2) * 0.2; }; },
});

// Hive core: a see-through honeycomb ball with a beating heart.
const hiveCore = () => simple('hiveCore', {
  core: () => new THREE.IcosahedronGeometry(0.35, 0),
  shell: () => new THREE.DodecahedronGeometry(0.85, 0),
  extra(core) { return (_dt, s) => { core.scale.setScalar(1 + Math.max(0, Math.sin(s.t * 6)) * 0.3); }; },
});

const worker = () => simple('worker', {
  core: () => new THREE.TetrahedronGeometry(0.3),
  shell: () => new THREE.TetrahedronGeometry(0.45),
  spin: 3,
  extra(core) { return (dt) => { core.rotation.x += dt * 5; }; },
});

// Devourer: a jaw that keeps opening and closing; it gets more corners as it eats.
const devourer = () => simple('devourer', {
  core: () => new THREE.CylinderGeometry(0.55, 0.55, 0.3, 5).rotateZ(Math.PI / 2),
  shell: () => new THREE.CylinderGeometry(0.8, 0.8, 0.5, 7).rotateZ(Math.PI / 2),
  extra(core, color) {
    const jaw = new THREE.Mesh(geo('devourer-jaw', () => new THREE.CylinderGeometry(0.55, 0.55, 0.3, 5).rotateZ(Math.PI / 2)), glowMat(color, 1.6));
    core.add(jaw);
    return (_dt, s) => { jaw.rotation.x = 0.3 + Math.abs(Math.sin(s.t * (4 + s.charge * 10))) * 0.8; };
  },
});

// Wall builder: an arm made of blocks.
const wallBuilder = () => simple('wallBuilder', {
  core: () => new THREE.BoxGeometry(0.6, 0.6, 0.6),
  shell: () => new THREE.BoxGeometry(0.9, 0.9, 0.9),
  extra(core, color) {
    const arm = new THREE.Group();
    for (let i = 1; i <= 3; i++) {
      const b = new THREE.Mesh(geo('builder-block', () => new THREE.BoxGeometry(0.25, 0.25, 0.25)), glowMat(color, 1.8));
      b.position.set(0.35, 0.2 + i * 0.25, 0);
      arm.add(b);
    }
    core.add(arm);
    return (_dt, s) => { arm.rotation.z = Math.sin(s.t * 2) * 0.4; };
  },
});

const wallBlock = () => simple('wallBlock', {
  core: () => new THREE.BoxGeometry(1.3, 1.5, 1.3),
  shell: () => new THREE.BoxGeometry(1.45, 1.65, 1.45),
  spin: 0,
  glitch: 0.2,
});

// Mortar: a long slanted barrel on a disc.
const mortar = () => simple('mortar', {
  core: () => new THREE.CylinderGeometry(0.6, 0.6, 0.25, 10),
  shell: () => new THREE.CylinderGeometry(0.8, 0.8, 0.4, 10),
  extra(core, color) {
    const barrel = new THREE.Mesh(geo('mortar-barrel', () => new THREE.CylinderGeometry(0.14, 0.18, 1.1, 6).translate(0, 0.55, 0)), glowMat(color, 1.8));
    barrel.rotation.x = 0.6;
    core.add(barrel);
    return () => {};
  },
});

// Thief: a sleek streamlined body; the loot pack on its back lights up once it has stolen.
const thief = () => simple('thief', {
  core: () => new THREE.OctahedronGeometry(0.4).scale(0.6, 0.6, 1.5),
  shell: () => new THREE.OctahedronGeometry(0.55).scale(0.6, 0.6, 1.5),
  spin: 0,
  extra(core) {
    const pack = new THREE.Mesh(geo('thief-pack', () => new THREE.BoxGeometry(0.3, 0.3, 0.3)), glowMat(0xffd23f, 2.6));
    pack.position.set(0, 0.35, -0.2);
    core.add(pack);
    return (_dt, s) => { pack.visible = s.charge > 0; };
  },
});

// Mimic: looks just like a health orb (slightly redder, with a twitch) until it shows its teeth.
function mimic(): EnemyVisual {
  const mat = coreMaterial('mimic');
  const root = new THREE.Group();
  const orb = new THREE.Group();
  const orbLook = new THREE.Mesh(GEO.orb, glowMat(0x50ff80, 2.2));
  const crateLook = new THREE.Mesh(geo('mimic-crate', () => new THREE.BoxGeometry(0.6, 0.4, 0.6)), glowMat(0xffd27a, 1.6));
  orb.add(orbLook, crateLook);
  const body = new THREE.Group();
  body.add(new THREE.Mesh(geo('mimic-body', () => new THREE.IcosahedronGeometry(0.45, 0)), mat));
  for (let i = 0; i < 8; i++) {
    const tooth = new THREE.Mesh(geo('mimic-tooth', () => new THREE.ConeGeometry(0.06, 0.3, 3)), glowMat(0xffffff, 2));
    const a = (i / 8) * Math.PI * 2;
    tooth.position.set(Math.sin(a) * 0.4, 0, Math.cos(a) * 0.4);
    tooth.rotation.set(Math.PI / 2, a, 0);
    body.add(tooth);
  }
  const shell = new THREE.LineSegments(edges('mimic-shell', () => new THREE.IcosahedronGeometry(0.65, 0)), lineMat(ENEMIES.mimic.color, 2));
  root.add(orb, body, shell);
  return {
    root, mat, shell,
    animate(dt, s) {
      const shown = s.beamPhase > 0;
      orb.visible = !shown;
      orbLook.visible = !s.variant;
      crateLook.visible = s.variant;
      body.visible = shell.visible = shown;
      // disguised: spins like a pickup, and every few seconds gives itself away with a twitch
      orb.rotation.y += dt * 2;
      orb.position.set(Math.sin(s.t * 40) * (s.t % 3.2 < 0.25 ? 0.08 : 0), Math.sin(s.t * 3) * 0.1, 0);
      body.rotation.y += dt * 4;
    },
  };
}

// Parasite: a tiny four-point star with pincers.
const parasite = () => simple('parasite', {
  core: () => new THREE.OctahedronGeometry(0.22).scale(1, 0.5, 1),
  shell: () => new THREE.OctahedronGeometry(0.34).scale(1, 0.5, 1),
  spin: 4,
  glitch: 2,
});

// Ring star: a small planet with a ring of eight orbs (gone while the ring is down).
const ringStar = () => simple('ringStar', {
  core: () => new THREE.IcosahedronGeometry(0.45, 1),
  shell: () => new THREE.IcosahedronGeometry(0.65, 0),
  extra(core, color) {
    const ring = orbit(core, 8, 2, 0.16, color, 2);
    return (_dt, s) => { ring.visible = s.beamPhase > 0; ring.rotation.y = s.beamAngle; };
  },
});

// Commander: a tall rhombus with a triangular light-flag on top (glows before the charge).
const commander = () => simple('commander', {
  core: () => new THREE.OctahedronGeometry(0.5).scale(0.7, 1.6, 0.7),
  shell: () => new THREE.OctahedronGeometry(0.75).scale(0.7, 1.5, 0.7),
  extra(core, color) {
    const flag = new THREE.Mesh(geo('flag', () => new THREE.ConeGeometry(0.3, 0.6, 3).rotateZ(Math.PI / 2).translate(0.3, 1.2, 0)), glowMat(color, 1.5));
    core.add(flag);
    return (_dt, s) => { flag.scale.setScalar(1 + s.charge * (0.4 + Math.sin(s.t * 30) * 0.2)); };
  },
});

// Boomerang: a crescent holding a matching blade (empty-handed while the blade is out).
const boomerang = () => simple('boomerang', {
  core: () => new THREE.TorusGeometry(0.45, 0.13, 5, 12, Math.PI * 1.3),
  shell: () => new THREE.TorusGeometry(0.6, 0.2, 3, 8, Math.PI * 1.3),
  extra(core, color) {
    const blade = new THREE.Mesh(geo('glaive', () => new THREE.TorusGeometry(0.3, 0.06, 3, 10, Math.PI)), glowMat(color, 2.2));
    blade.position.set(0.5, 0.2, 0);
    core.add(blade);
    return (dt, s) => { blade.visible = s.charge > 0; blade.rotation.z += dt * 3; };
  },
});

// Rift walker: a standing slit with flickering edges.
const riftWalker = () => simple('riftWalker', {
  core: () => new THREE.BoxGeometry(0.18, 1.6, 0.5),
  shell: () => new THREE.BoxGeometry(0.4, 2, 0.8),
  glitch: 4,
});

// Juggernaut: a core boxed in by four heavy plates; a broken plate shows the white core behind it.
function juggernaut(): EnemyVisual {
  const mat = coreMaterial('juggernaut');
  const root = new THREE.Group(), body = new THREE.Group();
  const heart = new THREE.Mesh(geo('jugg-core', () => new THREE.IcosahedronGeometry(0.75, 0)), glowMat(0xffffff, 1.3));
  body.add(heart);
  const plates: THREE.Mesh[] = [];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const p = new THREE.Mesh(geo('jugg-plate', () => new THREE.BoxGeometry(1.7, 1.4, 0.3)), mat);
    p.position.set(Math.sin(a) * 1.05, 0, Math.cos(a) * 1.05);
    p.rotation.y = a;
    plates.push(p);
    body.add(p);
  }
  const shell = new THREE.LineSegments(edges('jugg-shell', () => new THREE.BoxGeometry(2.6, 1.8, 2.6)), lineMat(ENEMIES.juggernaut.color, 1.6));
  root.add(body, shell);
  return {
    root, mat, shell,
    animate(_dt, s) {
      const intact = s.beamPhase >> 4;
      plates.forEach((p, i) => { p.visible = (intact & (1 << i)) !== 0; });
      heart.scale.setScalar(1 + Math.sin(s.t * 5) * 0.06);
    },
  };
}

// --- endless bosses ---

// Echo: concentric rings spreading out like sound.
const echo = () => simple('echo', {
  core: () => new THREE.IcosahedronGeometry(0.8, 0),
  shell: () => new THREE.IcosahedronGeometry(1.2, 0),
  extra(core, color) {
    const rings: THREE.LineSegments[] = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.LineSegments(edges('echo-ring', () => new THREE.TorusGeometry(1, 0.03, 3, 32)), lineMat(color, 2));
      r.rotation.x = Math.PI / 2;
      rings.push(r);
      core.add(r);
    }
    return (_dt, s) => rings.forEach((r, i) => { const k = (s.t * 0.6 + i / 3) % 1; r.scale.setScalar(1 + k * 1.8); r.position.y = -0.8 + k * 0.4; });
  },
});

// Eclipse Eye: nested polygons around a black-hole pupil; it squints shut when closed.
function eye(): EnemyVisual {
  const color = ENEMIES.eye.color, mat = coreMaterial('eye');
  const root = new THREE.Group(), lid = new THREE.Group();
  lid.add(new THREE.Mesh(geo('eye-ball', () => new THREE.SphereGeometry(1.2, 16, 10)), mat));
  const pupil = new THREE.Mesh(geo('eye-pupil', () => new THREE.CircleGeometry(0.55, 20)), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  pupil.position.set(0, 0.2, 1.21);
  lid.add(pupil);
  const rims: THREE.LineSegments[] = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.LineSegments(edges(`eye-rim${i}`, () => new THREE.TorusGeometry(0.7 + i * 0.3, 0.02, 3, 6 + i * 2)), lineMat(color, 2.2));
    r.position.z = 1.22;
    r.position.y = 0.2;
    rims.push(r);
    lid.add(r);
  }
  const shell = new THREE.LineSegments(edges('eye-shell', () => new THREE.IcosahedronGeometry(1.6, 0)), lineMat(color, 1.4));
  root.add(lid, shell);
  return {
    root, mat, shell,
    animate(dt, s) {
      lid.scale.y += ((s.beamPhase ? 1 : 0.15) - lid.scale.y) * Math.min(1, dt * 8);
      rims.forEach((r, i) => { r.rotation.z += dt * (i % 2 ? -1 : 1) * (1 + s.charge * 4); });
      pupil.scale.setScalar(1 + s.charge * 0.5);
      shell.rotation.y += dt * 0.2;
    },
  };
}

// Siege Fortress: a squat trapezoid keep (the turrets are separate).
const fortress = () => simple('fortress', {
  core: () => new THREE.CylinderGeometry(1.6, 2.2, 1.6, 4).rotateY(Math.PI / 4),
  shell: () => new THREE.CylinderGeometry(1.9, 2.6, 2, 4).rotateY(Math.PI / 4),
  spin: 0,
  glitch: 0.4,
  extra(core) {
    const heart = new THREE.Mesh(GEO.orb, glowMat(0xffd27a, 1.8));
    heart.position.y = 1.1;
    core.add(heart);
    return (dt) => { heart.rotation.y += dt * 2; };
  },
});

const turret = () => simple('turret', {
  core: () => new THREE.CylinderGeometry(0.5, 0.65, 0.8, 6),
  shell: () => new THREE.CylinderGeometry(0.7, 0.85, 1, 6),
  extra(core, color) {
    const barrel = new THREE.Mesh(geo('turret-barrel', () => new THREE.BoxGeometry(0.2, 0.2, 0.9).translate(0, 0.3, 0.45)), glowMat(color, 1.6));
    core.add(barrel);
    return (_dt, s) => { core.rotation.y = s.t * 0.7; };
  },
});

// Parasite Brood: a big see-through sac with something squirming inside.
const brood = () => simple('brood', {
  core: () => new THREE.IcosahedronGeometry(0.9, 1),
  shell: () => new THREE.IcosahedronGeometry(1.7, 1),
  spin: 0.15,
  extra(core, color) {
    const worms = orbit(core, 5, 0.6, 0.18, color, 2);
    return (_dt, s) => { worms.rotation.set(s.t * 0.8, s.t * 1.3, 0); core.scale.setScalar(1 + Math.sin(s.t * 2) * 0.08); };
  },
});

const sac = () => simple('sac', {
  core: () => new THREE.SphereGeometry(0.45, 10, 8).scale(1, 1.3, 1),
  shell: () => new THREE.SphereGeometry(0.6, 6, 5).scale(1, 1.3, 1),
  extra(core) { return (_dt, s) => { core.scale.setScalar(1 + s.charge * 0.35 + Math.sin(s.t * (6 + s.charge * 20)) * 0.05); }; },
});

// Rift Origin: a towering vertical rift, its color sliding between white, violet and magenta.
function origin(): EnemyVisual {
  const mat = coreMaterial('origin');
  const root = new THREE.Group();
  const slit = new THREE.Mesh(geo('origin-slit', () => new THREE.OctahedronGeometry(1, 0).scale(0.35, 2.6, 0.35)), mat);
  const shell = new THREE.LineSegments(edges('origin-shell', () => new THREE.OctahedronGeometry(1.4, 0).scale(0.6, 2.4, 0.6)), lineMat(0xffffff, 1.4));
  const halo = orbit(new THREE.Group(), 6, 1.6, 0.18, 0xd070ff, 2);
  root.add(slit, shell, halo.parent!);
  const c = new THREE.Color();
  return {
    root, mat, shell,
    animate(dt, s) {
      c.setHSL(0.78 + Math.sin(s.t * 0.7) * 0.08, 0.8, 0.6);
      mat.emissive.copy(c);
      halo.rotation.y += dt * (s.enraged ? 2 : 1);
      slit.scale.x = 1 + Math.sin(s.t * 9) * 0.1;
      shell.rotation.y -= dt * 0.5;
    },
  };
}

const riftCrystal = () => simple('riftCrystal', {
  core: () => new THREE.OctahedronGeometry(0.5).scale(0.7, 1.5, 0.7),
  shell: () => new THREE.OctahedronGeometry(0.75).scale(0.7, 1.5, 0.7),
  spin: 1.5,
  extra(core) { return (_dt, s) => { core.position.y = Math.sin(s.t * 2) * 0.2; }; },
});

const BUILDERS: Record<EnemyKind, () => EnemyVisual> = {
  riftCrystal, echo, eye, fortress, turret, brood, sac, origin,
  rewinder, missileNest, missile, condenser, quaker, lightEater, diver, hiveCore, worker, devourer, wallBuilder, wallBlock,
  mortar, thief, mimic, parasite, ringStar, commander, boomerang, riftWalker, juggernaut,
  colossus, prismPlate, wyrm, wyrmSeg, mirrorMind, mirrorClone,
  grunt, swarmer, bomber, splitter, shooter, sniper, shield, summoner, brute, corroder, tower, burrower, replicator,
  linker, assassin, mender, mirror, boss, boss2, boss3,
};

export function buildEnemyVisual(kind: EnemyKind): EnemyVisual {
  return BUILDERS[kind]?.() ?? fusedVisual(kind);
}

// A fusion looks like its first parent, with a smaller copy of the second riding on top.
function fusedVisual(kind: EnemyKind): EnemyVisual {
  const m = /^fusion:(\w+)\+(\w+):/.exec(kind);
  const a = BUILDERS[(m?.[1] ?? 'grunt') as EnemyKind](), b = BUILDERS[(m?.[2] ?? 'grunt') as EnemyKind]();
  b.root.scale.setScalar(0.5);
  b.root.position.y = 0.9;
  a.root.add(b.root);
  const color = ENEMIES[kind].color;
  a.mat.emissive.setHex(color);
  b.mat.emissive.setHex(color);
  return {
    root: a.root, mat: a.mat, shell: a.shell,
    animate(dt, s) { a.animate(dt, s); b.animate(dt, s); },
    dispose() { a.dispose?.(); b.dispose?.(); b.mat.dispose(); },
  };
}
