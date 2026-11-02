import * as THREE from 'three';

// An exit "portal" drawn as a rift torn into the floor: a jagged black fissure with a rim glowing in
// the destination's color, light deep inside it, hairline cracks branching out, embers drifting up.
// Visual only (Math.random is fine here: it never touches the seeded run RNG).

const EMBERS = 14;

function jagged(len: number, width: number, steps: number): THREE.Vector2[] {
  const top: THREE.Vector2[] = [], bottom: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps, x = (u - 0.5) * 2 * len;
    const w = width * Math.pow(Math.max(0, 1 - Math.pow(x / len, 2)), 0.6);
    top.push(new THREE.Vector2(x + (Math.random() - 0.5) * 0.12, w * (0.6 + Math.random() * 0.7)));
    bottom.push(new THREE.Vector2(x + (Math.random() - 0.5) * 0.12, -w * (0.6 + Math.random() * 0.7)));
  }
  return [...top, ...bottom.reverse()];
}

function flat(points: THREE.Vector2[], mat: THREE.Material, y: number, scale = 1): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(points.map(p => p.clone().multiplyScalar(scale)))), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y;
  return m;
}

// A thin zigzag strip from `a` heading out at `angle` for `len`.
function hairline(a: THREE.Vector2, angle: number, len: number): THREE.Vector2[] {
  const left: THREE.Vector2[] = [], right: THREE.Vector2[] = [];
  let x = a.x, y = a.y, ang = angle;
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const w = 0.045 * (1 - i / steps) + 0.006;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    left.push(new THREE.Vector2(x + nx * w, y + ny * w));
    right.push(new THREE.Vector2(x - nx * w, y - ny * w));
    ang += (Math.random() - 0.5) * 0.9;
    x += Math.cos(ang) * len / steps;
    y += Math.sin(ang) * len / steps;
  }
  return [...left, ...right.reverse()];
}

export class RiftCrack {
  readonly group = new THREE.Group();
  private readonly rim: THREE.MeshBasicMaterial;
  private readonly depth: THREE.MeshBasicMaterial;
  private readonly hairs: THREE.MeshBasicMaterial;
  private readonly embers: { m: THREE.Mesh; t: number; speed: number; x: number; z: number }[] = [];
  private flare = 0;   // brightens the rim when something drops in

  constructor(color: number) {
    const c = new THREE.Color(color);
    // kept under the bloom threshold mostly, so the jagged outline reads instead of a glowing blob
    this.rim = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.05), transparent: true, opacity: 0.95, depthWrite: false });
    this.depth = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.75), transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending });
    this.hairs = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.9), transparent: true, opacity: 0.7, depthWrite: false });
    const shape = jagged(1.55, 0.55, 14);
    // a soft glow on the floor around it, the rim, the black void, the glowing depth inside
    const halo = new THREE.Mesh(new THREE.CircleGeometry(2.3, 32), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.35), transparent: true, opacity: 0.14, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.rotation.x = -Math.PI / 2;
    halo.position.y = 0.015;
    halo.scale.set(1, 0.6, 1);
    this.group.add(
      halo,
      flat(shape, this.rim, 0.03, 1.12),
      flat(shape, new THREE.MeshBasicMaterial({ color: 0x010006 }), 0.035),
      flat(shape, this.depth, 0.04, 0.55),
    );
    // hairline cracks branching from the fissure's edges
    for (let i = 0; i < 7; i++) {
      const p = shape[Math.floor(Math.random() * shape.length)];
      const angle = Math.atan2(p.y, p.x * 0.4) + (Math.random() - 0.5) * 0.8;
      this.group.add(flat(hairline(p.clone().multiplyScalar(1.1), angle, 0.6 + Math.random() * 0.8), this.hairs, 0.025));
    }
    // embers rising out of the depths
    const emberMat = new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.8) });
    for (let i = 0; i < EMBERS; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), emberMat);
      this.group.add(m);
      this.embers.push({ m, t: Math.random(), speed: 0.5 + Math.random() * 0.6, x: (Math.random() - 0.5) * 2.4, z: (Math.random() - 0.5) * 0.5 });
    }
    this.group.rotation.y = Math.random() * Math.PI;
  }

  update(dt: number, time: number): void {
    this.flare = Math.max(0, this.flare - dt * 1.5);
    const pulse = 0.5 + Math.sin(time * 3) * 0.5;
    this.rim.opacity = 0.75 + pulse * 0.25;
    this.depth.opacity = 0.35 + pulse * 0.25 + this.flare * 0.6;
    this.hairs.opacity = 0.45 + Math.sin(time * 5 + 1) * 0.2 + this.flare * 0.4;
    for (const e of this.embers) {
      e.t += dt * e.speed * (1 + this.flare * 3);
      if (e.t > 1) { e.t -= 1; e.x = (Math.random() - 0.5) * 2.4; e.z = (Math.random() - 0.5) * 0.5; }
      e.m.position.set(e.x * (1 - e.t * 0.3), e.t * 1.8, e.z);
      e.m.scale.setScalar(1 - e.t);
    }
  }

  // Something just dropped in: the depths flare up.
  burst(): void {
    this.flare = 1;
  }
}
