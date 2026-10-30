import * as THREE from 'three';
import { glowMat } from '../core/assets';
import { clamp } from '../core/math';
import { MECHS, type MechPalette } from '../data/meta';

const FRAME = new THREE.MeshStandardMaterial({ color: 0x252a35, metalness: 0.6, roughness: 0.45, emissive: 0x080b12, emissiveIntensity: 0.5, flatShading: true });
const SHADOW = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });

// Two-tone armor with lighter top plates so the silhouette reads from above; the accent lights
// mark the player. Each mech type has its own palette.
function paletteMaterials(p: MechPalette) {
  return {
    ARMOR: new THREE.MeshStandardMaterial({ color: p.armor, metalness: 0.35, roughness: 0.5, emissive: 0x141c2a, emissiveIntensity: 0.5, flatShading: true }),
    ARMOR_TOP: new THREE.MeshStandardMaterial({ color: p.armorTop, metalness: 0.25, roughness: 0.55, emissive: 0x1b2433, emissiveIntensity: 0.5, flatShading: true }),
    PAINT: new THREE.MeshStandardMaterial({ color: p.paint, metalness: 0.2, roughness: 0.5, emissive: new THREE.Color(p.paint).multiplyScalar(0.2), emissiveIntensity: 0.6, flatShading: true }),
    CYAN: p.accent,
  };
}

// Cannon muzzle in unscaled model space (right arm; the left arm mirrors x).
const MUZZLE = new THREE.Vector3(0.62, 1.12, 1.14);

type Pt = [number, number];

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// Extrude a top-down outline (x, z pairs) upward by `height`, base at `y`.
// Gives angular armor plates whose silhouette reads from the overhead camera.
function plate(outline: Pt[], height: number, mat: THREE.Material, y: number, bevel = 0.025): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

const mirror = (pts: Pt[]): Pt[] => pts.map(([x, z]) => [-x, z] as Pt).reverse();
const shrink = (pts: Pt[], k: number, dz = 0): Pt[] => pts.map(([x, z]) => [x * k, z * k + dz] as Pt);

// Wrap angle difference to [-PI, PI] so turning always takes the short way round.
function turnTowards(cur: number, target: number, maxStep: number): number {
  const diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
  return cur + clamp(diff, -maxStep, maxStep);
}

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group;
}

interface Arm {
  group: THREE.Group;
  kick: number;
  stripe: THREE.Mesh;
  ring: THREE.Mesh;
}

// The player's mech, built from primitives. Symmetric twin arm cannons fire alternately,
// so the body always squares up to the target. Legs face the movement direction, the
// upper body faces the aim. Forward is +z.
export class MechModel {
  readonly root = new THREE.Group();
  private readonly lower = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly pelvis: THREE.Mesh;
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private phase = 0;
  private legYaw = 0;
  private t = 0;

  private readonly scale: number;

  constructor(palette: MechPalette = MECHS.vanguard.palette, scale = MECHS.vanguard.scale) {
    this.scale = scale;
    const { ARMOR, ARMOR_TOP, PAINT, CYAN } = paletteMaterials(palette);
    const cyan = glowMat(CYAN, 1.6);

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.0, 24), SHADOW);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow);

    // --- lower body ---
    this.pelvis = plate([[-0.3, -0.18], [0.3, -0.18], [0.34, 0.05], [0.2, 0.2], [-0.2, 0.2], [-0.34, 0.05]], 0.2, FRAME, 0.84);
    this.lower.add(this.pelvis);
    const foot: Pt[] = [[-0.16, -0.22], [0.16, -0.22], [0.19, 0.16], [0, 0.32], [-0.19, 0.16]];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.3, 0.9, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.42;
      hip.add(box(0.24, 0.46, 0.3, ARMOR, 0, -0.2, 0), knee);
      knee.add(
        box(0.28, 0.46, 0.34, ARMOR, 0, -0.22, -0.02),
        box(0.22, 0.16, 0.08, ARMOR_TOP, 0, -0.02, 0.16),   // knee plate
        plate(foot, 0.1, FRAME, -0.5, 0.015),
      );
      this.lower.add(hip);
      this.legs.push({ hip, knee });
    }

    // --- torso: layered wedge armor ---
    const torso: Pt[] = [[-0.38, -0.3], [0.38, -0.3], [0.5, -0.05], [0.36, 0.3], [0, 0.4], [-0.36, 0.3], [-0.5, -0.05]];
    this.upper.add(
      box(0.4, 0.22, 0.3, FRAME, 0, 1.0, 0),          // waist
      plate(torso, 0.42, ARMOR, 1.08),
      plate(shrink(torso, 0.78, 0.02), 0.06, ARMOR_TOP, 1.53),
      // vent lines on the chest top
      box(0.04, 0.02, 0.34, cyan, -0.12, 1.62, 0.0),
      box(0.04, 0.02, 0.34, cyan, 0.12, 1.62, 0.0),
    );

    // low, sunk-in head with a mono-eye visor
    this.upper.add(
      plate([[-0.15, 0.12], [0.15, 0.12], [0.12, 0.36], [-0.12, 0.36]], 0.16, FRAME, 1.46, 0.015),
      box(0.22, 0.04, 0.03, cyan, 0, 1.55, 0.37),
    );

    // heavy shoulder armor
    const shoulder: Pt[] = [[0.42, -0.26], [0.8, -0.2], [0.88, 0.12], [0.72, 0.3], [0.44, 0.22]];
    for (const pts of [shoulder, mirror(shoulder)]) {
      this.upper.add(plate(pts, 0.32, ARMOR, 1.38), plate(shrink(pts, 0.92, 0.01), 0.04, ARMOR_TOP, 1.74, 0.01));
    }
    for (const side of [-1, 1]) {
      this.upper.add(box(0.05, 0.03, 0.3, PAINT, side * 0.8, 1.8, 0.0));  // hazard stripe
    }

    // twin arm cannons
    for (const side of [1, -1]) {
      const group = new THREE.Group();
      group.position.x = side * MUZZLE.x;
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.6, 10), FRAME);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 1.12, 0.82);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.025, 6, 14), glowMat(0xffffff, 2));
      ring.position.set(0, 1.12, MUZZLE.z);
      const stripe = box(0.05, 0.02, 0.36, glowMat(0xffffff, 1.6), 0, 1.255, 0.3);
      group.add(
        box(0.2, 0.3, 0.22, FRAME, 0, 1.24, -0.02),     // upper arm
        box(0.26, 0.24, 0.52, ARMOR, 0, 1.12, 0.3),     // cannon housing
        box(0.2, 0.04, 0.4, ARMOR_TOP, 0, 1.25, 0.28),
        barrel, ring, stripe,
      );
      this.upper.add(group);
      this.arms.push({ group, kick: 0, stripe, ring });
    }

    // reactor backpack: glowing grille on top, two thrusters
    this.upper.add(box(0.66, 0.42, 0.3, FRAME, 0, 1.32, -0.4));
    for (const x of [-0.16, 0, 0.16]) this.upper.add(box(0.06, 0.02, 0.22, cyan, x, 1.54, -0.4));
    for (const side of [-1, 1]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.2, 10), FRAME);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * 0.2, 1.3, -0.6);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 10), cyan);
      flame.rotation.x = -Math.PI / 2;  // tip points backwards
      this.upper.add(nozzle, flame);
      this.flames.push(flame);
    }
    const antenna = box(0.02, 0.02, 0.5, FRAME, -0.3, 1.72, -0.5);
    antenna.rotation.x = 0.5;
    this.upper.add(antenna);

    // yaw first, then the run-lean pitch in the body's own frame (default XYZ would tilt around world X)
    this.upper.rotation.order = 'YXZ';
    this.root.add(this.lower, this.upper);
    // drawn larger than the 0.55 hitbox so the silhouette reads from the top-down camera
    this.root.scale.setScalar(scale);
  }

  setWeaponColor(hex: number): void {
    for (const a of this.arms) {
      a.stripe.material = glowMat(hex, 1.6);
      a.ring.material = glowMat(hex, 2);
    }
  }

  // World position of a cannon's muzzle (0 = right, 1 = left) for a given body position and aim yaw.
  muzzle(side: 0 | 1, pos: THREE.Vector3, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const S = this.scale;
    const x = (side === 0 ? MUZZLE.x : -MUZZLE.x) * S, z = MUZZLE.z * S;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return out.set(pos.x + x * c + z * s, MUZZLE.y * S, pos.z - x * s + z * c);
  }

  kick(side: 0 | 1): void {
    this.arms[side].kick = 1;
  }

  update(dt: number, vel: THREE.Vector3, aimYaw: number, maxSpeed: number, dashing: boolean): void {
    this.t += dt;
    const speed = Math.hypot(vel.x, vel.z);
    const amt = clamp(speed / maxSpeed, 0, 1);

    if (speed > 0.5) this.legYaw = turnTowards(this.legYaw, Math.atan2(vel.x, vel.z), dt * 12);
    this.lower.rotation.y = this.legYaw;
    this.upper.rotation.y = aimYaw;

    this.phase += dt * speed * 1.5;
    this.legs.forEach((leg, i) => {
      const s = Math.sin(this.phase + i * Math.PI);
      leg.hip.rotation.x = dashing ? -0.5 : s * 0.6 * amt;
      leg.knee.rotation.x = dashing ? 0.9 : Math.max(0, -s) * 0.85 * amt;
    });
    const bob = Math.abs(Math.sin(this.phase)) * 0.05 * amt;
    this.pelvis.position.y = 0.84 + bob;
    this.upper.position.y = bob;
    this.upper.rotation.x = amt * 0.08;  // lean into the run

    for (const a of this.arms) {
      a.kick = Math.max(0, a.kick - dt * 8);
      a.group.position.z = -a.kick * 0.2;
    }

    const thrust = dashing ? 2.4 : 0.5 + amt * 0.7;
    for (const f of this.flames) {
      const flicker = 0.85 + Math.sin(this.t * 40 + f.id) * 0.15;
      f.scale.set(1, thrust * flicker, 1);
      f.position.set(f === this.flames[0] ? -0.2 : 0.2, 1.3, -0.7 - 0.25 * thrust * flicker);
    }
  }
}
