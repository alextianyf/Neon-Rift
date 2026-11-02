import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glowMat } from '../core/assets';
import { clamp } from '../core/math';
import { MECHS, type MechId, type MechPalette } from '../data/meta';

const FRAME_FLAT = new THREE.MeshStandardMaterial({ color: 0x252a35, metalness: 0.6, roughness: 0.45, emissive: 0x080b12, emissiveIntensity: 0.5, flatShading: true });
// Close-up variant (title screen): rounded, smooth-shaded, more metallic, so it reads from up close.
const FRAME_FINE = new THREE.MeshStandardMaterial({ color: 0x23272f, metalness: 0.85, roughness: 0.32 });
const SHADOW = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false });

// Two-tone armor with lighter top plates so the silhouette reads from above; the accent lights
// mark the player. Each mech type has its own palette.
function paletteMaterials(p: MechPalette, fine: boolean) {
  if (fine) {
    return {
      ARMOR: new THREE.MeshStandardMaterial({ color: p.armor, metalness: 0.55, roughness: 0.46 }),
      ARMOR_TOP: new THREE.MeshStandardMaterial({ color: p.armorTop, metalness: 0.45, roughness: 0.42 }),
      PAINT: new THREE.MeshStandardMaterial({ color: p.paint, metalness: 0.35, roughness: 0.35, emissive: new THREE.Color(p.paint).multiplyScalar(0.08) }),
      CYAN: p.accent,
    };
  }
  return {
    ARMOR: new THREE.MeshStandardMaterial({ color: p.armor, metalness: 0.35, roughness: 0.5, emissive: 0x141c2a, emissiveIntensity: 0.5, flatShading: true }),
    ARMOR_TOP: new THREE.MeshStandardMaterial({ color: p.armorTop, metalness: 0.25, roughness: 0.55, emissive: 0x1b2433, emissiveIntensity: 0.5, flatShading: true }),
    PAINT: new THREE.MeshStandardMaterial({ color: p.paint, metalness: 0.2, roughness: 0.5, emissive: new THREE.Color(p.paint).multiplyScalar(0.2), emissiveIntensity: 0.6, flatShading: true }),
    CYAN: p.accent,
  };
}

// Set while a close-up mech is being built: box() and plate() round their edges.
let fineBuild = false;

// Cannon muzzle in unscaled model space (right arm; the left arm mirrors x).
const MUZZLE = new THREE.Vector3(0.62, 1.12, 1.14);

type Pt = [number, number];

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const geo = fineBuild ? new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.22) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

// Extrude a top-down outline (x, z pairs) upward by `height`, base at `y`.
// Gives angular armor plates whose silhouette reads from the overhead camera.
function plate(outline: Pt[], height: number, mat: THREE.Material, y: number, bevel = 0.025): THREE.Mesh {
  const shape = new THREE.Shape(outline.map(([x, z]) => new THREE.Vector2(x, -z)));
  const b = fineBuild ? Math.max(bevel, Math.min(0.035, height * 0.3)) : bevel;
  const geo = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: b > 0, bevelSize: b, bevelThickness: b, bevelSegments: fineBuild ? 3 : 1 });
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  m.position.y = y;
  return m;
}

const UP = new THREE.Vector3(0, 1, 0);

// A box running from point a to point b (for angled limbs), `w` wide and `d` deep.
function strut(a: THREE.Vector3, b: THREE.Vector3, w: number, d: number, mat: THREE.Material): THREE.Mesh {
  const dir = b.clone().sub(a);
  const m = box(w, dir.length(), d, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
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

// A weapon mount: recoils on its own; `tint` meshes take the held weapon's color; shots leave from
// `muzzle` (model space). A mech can have one (the bastion's cannon) or two (fired alternately).
interface Arm {
  group: THREE.Group;
  kick: number;
  tint: THREE.Mesh[];
  muzzle: THREE.Vector3;
  rest: THREE.Vector3;  // the mount's position before recoil and bobbing
  hover?: number;       // floating mounts bob up and down (phase)
}

interface Flame { mesh: THREE.Mesh; x: number; y: number; z: number }

interface Mats { frame: THREE.Material; armor: THREE.Material; top: THREE.Material; paint: THREE.Material; glow: THREE.Material; accent: number }

// The player's mech, built from primitives: a shared pair of legs, and an upper body that each mech
// type builds its own way (buildBastion / buildVanguard / buildPhantom / buildApex), weapons included.
// Legs face the movement direction, the upper body faces the aim. Forward is +z.
export class MechModel {
  readonly root = new THREE.Group();
  private readonly lower = new THREE.Group();
  private readonly upper = new THREE.Group();
  private readonly pelvis: THREE.Mesh;
  private readonly legs: Leg[] = [];
  private readonly arms: Arm[] = [];
  private readonly flames: Flame[] = [];
  private phase = 0;
  private legYaw = 0;
  private t = 0;
  // secondary motion: parts that sway on their own (antennas), cloth-like chains (the phantom's scarf)
  private readonly sways: { obj: THREE.Object3D; base: number; amp: number; speed: number }[] = [];
  private readonly ribbons: THREE.Group[][] = [];
  private lean0 = 0;      // resting forward lean of the upper body
  private leanK = 0.08;   // extra lean at full running speed
  private kneeSign = 1;   // reverse-joint legs bend the other way
  // Singularity: halo, chest core, the shoulder cannon and the free right arm (both move for the skill)
  private halo: THREE.Object3D | null = null;
  private core: THREE.Object3D | null = null;
  private shoulderGun: { pivot: THREE.Group; tip: THREE.Object3D; rest: number; up: number } | null = null;
  private skillArm: THREE.Group | null = null;
  private skillOn = 0;    // 0..1, eases toward the target
  private skillTarget = 0;
  private slam = 0;       // a big recoil: rocks the body back and squats, then settles

  private readonly scale: number;

  // `fine`: the close-up build for the title screen and hangar (rounded parts, smooth metal, extra
  // mechanical detail). `style`: which mech's body to build.
  constructor(palette: MechPalette = MECHS.vanguard.palette, scale = MECHS.vanguard.scale, fine = false, style: MechId = 'vanguard') {
    this.scale = scale;
    fineBuild = fine;
    const FRAME = fine ? FRAME_FINE : FRAME_FLAT;
    const { ARMOR, ARMOR_TOP, PAINT, CYAN } = paletteMaterials(palette, fine);
    const m: Mats = { frame: FRAME, armor: ARMOR, top: ARMOR_TOP, paint: PAINT, glow: glowMat(CYAN, 1.6), accent: CYAN };

    const shadow = new THREE.Mesh(new THREE.CircleGeometry(style === 'bastion' ? 1.2 : 1.0, 24), SHADOW);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.02;
    this.root.add(shadow);

    // --- legs (all mechs) ---
    this.pelvis = plate([[-0.3, -0.18], [0.3, -0.18], [0.34, 0.05], [0.2, 0.2], [-0.2, 0.2], [-0.34, 0.05]], 0.2, FRAME, 0.84);
    this.lower.add(this.pelvis);
    const foot: Pt[] = [[-0.16, -0.22], [0.16, -0.22], [0.19, 0.16], [0, 0.32], [-0.19, 0.16]];
    if (style === 'phantom') this.raptorLegs(m);
    else for (const side of [-1, 1]) {
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
    this.upper.add(box(0.4, 0.22, 0.3, FRAME, 0, 1.0, 0));  // waist

    if (style === 'bastion') this.buildBastion(m);
    else if (style === 'phantom') this.buildPhantom(m);
    else if (style === 'apex') this.buildApex(m);
    else this.buildVanguard(m);

    // yaw first, then the run-lean pitch in the body's own frame (default XYZ would tilt around world X)
    this.upper.rotation.order = 'YXZ';
    this.root.add(this.lower, this.upper);
    if (fine) this.addDetail(style, m);
    fineBuild = false;
    // drawn larger than the 0.55 hitbox so the silhouette reads from the top-down camera
    this.root.scale.setScalar(scale);
  }

  // ---------------------------------------------------------------------------------------------
  // Shared parts

  private standardTorso(m: Mats, k = 1): void {
    const torso: Pt[] = [[-0.38, -0.3], [0.38, -0.3], [0.5, -0.05], [0.36, 0.3], [0, 0.4], [-0.36, 0.3], [-0.5, -0.05]].map(([x, z]) => [x * k, z] as Pt);
    this.upper.add(
      plate(torso, 0.42, m.armor, 1.08),
      plate(shrink(torso, 0.78, 0.02), 0.06, m.top, 1.53),
      box(0.04, 0.02, 0.34, m.glow, -0.12, 1.62, 0.0),
      box(0.04, 0.02, 0.34, m.glow, 0.12, 1.62, 0.0),
    );
  }

  private thrusters(m: Mats, x: number, y: number, z: number, r = 0.1): void {
    for (const side of [-1, 1]) {
      const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.4, 0.2, fineBuild ? 20 : 10), m.frame);
      nozzle.rotation.x = Math.PI / 2;
      nozzle.position.set(side * x, y, z);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(r, 0.5, 10), m.glow);
      flame.rotation.x = -Math.PI / 2;  // tip points backwards
      this.upper.add(nozzle, flame);
      this.flames.push({ mesh: flame, x: side * x, y, z: z - 0.1 });
    }
  }

  // A cannon arm: upper arm, housing, barrel, glowing muzzle ring and top stripe.
  private cannon(m: Mats, x: number, housing: [number, number, number], barrelR: number, barrelLen: number, muzzleZ: number): Arm {
    const group = new THREE.Group();
    group.position.x = x;
    const [hw, hh, hd] = housing;
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(barrelR, barrelR * 1.12, barrelLen, fineBuild ? 24 : 10), m.frame);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 1.12, muzzleZ - barrelLen / 2);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(barrelR * 1.2, barrelR * 0.35, 6, 16), glowMat(0xffffff, 2));
    ring.position.set(0, 1.12, muzzleZ);
    const stripe = box(hw * 0.2, 0.02, hd * 0.7, glowMat(0xffffff, 1.6), 0, 1.12 + hh / 2 + 0.01, 0.3);
    group.add(
      box(0.2, 0.3, 0.22, m.frame, 0, 1.24, -0.02),       // upper arm
      box(hw, hh, hd, m.armor, 0, 1.12, 0.3),               // housing
      box(hw * 0.8, 0.04, hd * 0.8, m.top, 0, 1.12 + hh / 2, 0.28),
      barrel, ring, stripe,
    );
    this.upper.add(group);
    const arm: Arm = { group, kick: 0, tint: [stripe, ring], muzzle: new THREE.Vector3(x, 1.12, muzzleZ), rest: group.position.clone() };
    this.arms.push(arm);
    return arm;
  }

  // ---------------------------------------------------------------------------------------------
  // Vanguard: the clean baseline. Twin arm cannons, wedge torso, mono-eye, reactor pack.
  private buildVanguard(m: Mats): void {
    const U = this.upper;
    this.standardTorso(m);
    U.add(plate([[-0.15, 0.12], [0.15, 0.12], [0.12, 0.36], [-0.12, 0.36]], 0.16, m.frame, 1.46, 0.015), box(0.22, 0.04, 0.03, m.glow, 0, 1.55, 0.37));
    const shoulder: Pt[] = [[0.42, -0.26], [0.8, -0.2], [0.88, 0.12], [0.72, 0.3], [0.44, 0.22]];
    for (const pts of [shoulder, mirror(shoulder)]) U.add(plate(pts, 0.32, m.armor, 1.38), plate(shrink(pts, 0.92, 0.01), 0.04, m.top, 1.74, 0.01));
    for (const side of [-1, 1]) U.add(box(0.05, 0.03, 0.3, m.paint, side * 0.8, 1.8, 0.0));  // hazard stripes
    this.cannon(m, MUZZLE.x, [0.26, 0.24, 0.52], 0.07, 0.6, MUZZLE.z);
    this.cannon(m, -MUZZLE.x, [0.26, 0.24, 0.52], 0.07, 0.6, MUZZLE.z);
    U.add(box(0.66, 0.42, 0.3, m.frame, 0, 1.32, -0.4));
    for (const x of [-0.16, 0, 0.16]) U.add(box(0.06, 0.02, 0.22, m.glow, x, 1.54, -0.4));
    this.thrusters(m, 0.2, 1.3, -0.6);
    const antenna = box(0.02, 0.02, 0.5, m.frame, -0.3, 1.72, -0.5);
    antenna.rotation.x = 0.5;
    // sensor crest, painted chevron, shoulder vents
    U.add(antenna, box(0.03, 0.12, 0.3, m.top, 0, 1.68, 0.18));
    for (const side of [-1, 1]) {
      const bar = box(0.2, 0.04, 0.02, m.paint, side * 0.08, 1.3, 0.41);
      bar.rotation.z = side * 0.5;
      U.add(bar);
      for (let i = 0; i < 3; i++) U.add(box(0.02, 0.03, 0.16, m.glow, side * (0.9 - i * 0.05), 1.6, -0.05));
    }
  }

  // Bastion: a walking fortress. Wide armored hull with the head sunk between huge pauldrons,
  // one heavy cannon on the right arm, a tower shield on the left, skirt armor, exhaust stacks.
  private buildBastion(m: Mats): void {
    const U = this.upper;
    for (const leg of this.legs) {
      leg.hip.scale.set(1.4, 1, 1.4);
      leg.knee.add(box(0.32, 0.34, 0.1, m.top, 0, -0.18, 0.21), box(0.26, 0.08, 0.36, m.frame, 0, -0.5, 0.06));  // shin guards, heavy boots
    }
    // skirt plates around the hips
    U.add(box(0.56, 0.24, 0.07, m.armor, 0, 0.86, 0.26), box(0.56, 0.24, 0.07, m.armor, 0, 0.86, -0.26));
    for (const side of [-1, 1]) U.add(box(0.07, 0.24, 0.42, m.armor, side * 0.44, 0.86, 0));
    // hull: a big armored block with a grille, a heavy top plate
    U.add(box(1.04, 0.6, 0.82, m.armor, 0, 1.33, 0), box(0.94, 0.07, 0.72, m.top, 0, 1.66, 0));
    for (let i = 0; i < 5; i++) U.add(box(0.5, 0.03, 0.03, m.frame, 0, 1.12 + i * 0.07, 0.42));
    U.add(box(0.12, 0.3, 0.03, m.paint, -0.36, 1.33, 0.415), box(0.12, 0.3, 0.03, m.paint, 0.36, 1.33, 0.415));
    // low armored head with a wide visor, between the shoulders
    U.add(box(0.36, 0.18, 0.28, m.frame, 0, 1.75, 0.18), box(0.3, 0.04, 0.03, m.glow, 0, 1.76, 0.33));
    // massive pauldrons
    for (const side of [-1, 1]) {
      U.add(
        box(0.46, 0.42, 0.66, m.armor, side * 0.72, 1.62, 0),
        box(0.42, 0.07, 0.6, m.top, side * 0.72, 1.86, 0),
        box(0.06, 0.32, 0.5, m.paint, side * 0.96, 1.62, 0),
      );
    }
    // left arm: heavy cannon with a muzzle brake
    const gun = this.cannon(m, -0.74, [0.4, 0.38, 0.8], 0.12, 0.55, 1.35);
    gun.group.add(box(0.3, 0.16, 0.14, m.frame, 0, 1.12, 1.25), box(0.42, 0.3, 0.26, m.frame, 0, 1.2, -0.05));
    // right arm: tower shield, raised in front
    const shield = new THREE.Group();
    shield.position.x = 0.8;
    // the face points forward (+z): wide and tall, thin front to back, held out ahead of the arm
    shield.add(
      box(0.24, 0.34, 0.26, m.frame, 0, 1.24, -0.02),
      box(0.18, 0.2, 0.4, m.frame, 0, 1.1, 0.25),          // forearm brace
      box(0.78, 1.04, 0.13, m.armor, -0.06, 1.0, 0.56),
      box(0.8, 0.08, 0.15, m.paint, -0.06, 1.46, 0.56),
      box(0.8, 0.08, 0.15, m.paint, -0.06, 0.54, 0.56),
      box(0.62, 0.03, 0.02, m.glow, -0.06, 1.12, 0.635),    // view slit
      box(0.03, 0.5, 0.02, m.glow, -0.36, 0.95, 0.635),
      box(0.03, 0.5, 0.02, m.glow, 0.24, 0.95, 0.635),
    );
    U.add(shield);
    this.leanK = 0.04;
    // reactor block, exhaust stacks, low thrusters
    U.add(box(0.76, 0.52, 0.38, m.frame, 0, 1.36, -0.56));
    for (const side of [-1, 1]) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.5, fineBuild ? 20 : 8), m.frame);
      stack.position.set(side * 0.24, 1.85, -0.58);
      U.add(stack, box(0.1, 0.02, 0.1, m.glow, side * 0.24, 2.1, -0.58));
    }
    this.thrusters(m, 0.22, 1.18, -0.78, 0.12);
  }

  // Phantom: a ninja-styled raider. Reverse-joint legs and a low, forward-leaning stance; a masked
  // head with swept-back antennas; layered plates on the shoulders; a long scarf that streams
  // behind it; a katana across the back; a compact SMG on each wrist, fired in turn.
  private raptorLegs(m: Mats): void {
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.kneeSign = -1;
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.24, 0.92, -0.02);
      const knee = new THREE.Group();
      knee.position.set(0, -0.4, 0.18);  // the knee sits forward of the hip...
      const toe: Pt[] = [[-0.09, -0.08], [0.09, -0.08], [0.08, 0.14], [0, 0.24], [-0.08, 0.14]];
      const claw = plate(toe, 0.06, m.frame, -0.52);
      claw.position.z = -0.1;
      claw.scale.set(1.35, 1, 1.25);
      knee.add(
        strut(V(0, 0, 0), V(0, -0.34, -0.24), 0.16, 0.18, m.armor),     // ...and the shin runs back to a high ankle
        strut(V(0, -0.06, -0.1), V(0, -0.28, -0.26), 0.17, 0.08, m.top),  // calf armor
        strut(V(0, -0.34, -0.24), V(0, -0.5, -0.1), 0.11, 0.13, m.frame),
        strut(V(0, -0.02, 0.02), V(0, -0.3, -0.16), 0.015, 0.02, m.glow),
        claw,
      );
      const guard = box(0.17, 0.24, 0.06, m.top, 0, 0.03, 0.09);  // knee guard
      guard.rotation.x = -0.4;
      knee.add(guard);
      // thick thigh, with a hanging tasset over it like a samurai's kusazuri
      const tasset = box(0.24, 0.26, 0.04, m.top, 0, -0.12, 0.16);
      tasset.rotation.x = 0.25;
      hip.add(strut(V(0, 0, 0), V(0, -0.4, 0.18), 0.22, 0.24, m.armor), tasset, knee);
      this.lower.add(hip);
      this.legs.push({ hip, knee });
    }
  }

  private buildPhantom(m: Mats): void {
    const U = this.upper;
    this.lean0 = 0.1;
    this.leanK = 0.2;
    // narrow chest and a sash at the waist
    const torso: Pt[] = [[-0.22, -0.2], [0.22, -0.2], [0.3, 0], [0.18, 0.26], [0, 0.36], [-0.18, 0.26], [-0.3, 0]];
    U.add(plate(torso, 0.36, m.armor, 1.12), plate(shrink(torso, 0.74, 0.03), 0.05, m.top, 1.5), box(0.5, 0.1, 0.34, m.paint, 0, 1.04, 0));
    for (const side of [-1, 1]) {
      const v = box(0.018, 0.018, 0.26, m.glow, side * 0.09, 1.38, 0.33);
      v.rotation.set(0, side * 0.6, side * 0.4);
      U.add(v);
    }
    // masked head: hood, pointed face plate, a single visor slit, swept-back antennas
    // (raised on a neck so it clears the chest from the front)
    U.add(box(0.1, 0.12, 0.1, m.frame, 0, 1.6, 0.12), box(0.22, 0.22, 0.26, m.frame, 0, 1.76, 0.16));
    U.add(plate([[-0.11, 0.24], [0.11, 0.24], [0.07, 0.36], [0, 0.43], [-0.07, 0.36]], 0.11, m.top, 1.65), box(0.19, 0.026, 0.02, m.glow, 0, 1.81, 0.295));
    // a short swept crest instead of long antennas (those read as an insect)
    const crest = new THREE.Group();
    crest.position.set(0, 1.86, 0.1);
    crest.rotation.x = 0.35;
    crest.add(box(0.03, 0.05, 0.3, m.top, 0, 0, -0.1), box(0.03, 0.015, 0.26, m.glow, 0, 0.03, -0.1));
    U.add(crest);
    this.sways.push({ obj: crest, base: 0.35, amp: 0.03, speed: 2.6 });
    // layered shoulder plates, hanging outward like a samurai's sode
    for (const side of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const plateM = box(0.2, 0.03, 0.24 - i * 0.03, i === 0 ? m.top : m.armor, side * (0.4 + i * 0.04), 1.54 - i * 0.07, 0);
        plateM.rotation.z = -side * (0.5 + i * 0.12);
        U.add(plateM);
      }
      U.add(box(0.16, 0.16, 0.2, m.frame, side * 0.34, 1.46, 0));
    }
    // scarf: two streamers from the neck
    for (const side of [-1, 1]) {
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = U;
      for (let i = 0; i < 7; i++) {
        const seg = new THREE.Group();
        if (i === 0) seg.position.set(side * 0.07, 1.66, -0.06);
        else seg.position.z = -0.17;
        const w = 0.11 - i * 0.008;
        seg.add(box(w, 0.015, 0.18, m.paint, 0, 0, -0.08), box(0.012, 0.018, 0.18, m.glow, side * w / 2, 0, -0.08));
        parent.add(seg);
        chain.push(seg);
        parent = seg;
      }
      this.ribbons.push(chain);
    }
    // katana across the back
    const sword = new THREE.Group();
    sword.position.set(0, 1.32, -0.27);
    sword.rotation.z = 0.75;
    sword.add(box(0.06, 0.95, 0.05, m.frame, 0, -0.05, 0), box(0.012, 0.85, 0.055, m.glow, 0.025, -0.05, 0), box(0.14, 0.025, 0.09, m.top, 0, 0.43, 0), box(0.045, 0.24, 0.045, m.paint, 0, 0.57, 0));
    U.add(sword);
    // a compact SMG on each wrist
    for (const side of [1, -1]) {
      const arm = new THREE.Group();
      arm.position.x = side * 0.46;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.015, 6, 14), glowMat(0xffffff, 2));
      ring.position.set(0, 1.0, 0.6);
      const stripe = box(0.02, 0.015, 0.22, glowMat(0xffffff, 1.6), 0, 1.06, 0.38);
      arm.add(
        box(0.14, 0.26, 0.18, m.frame, 0, 1.26, -0.02),
        box(0.14, 0.15, 0.34, m.armor, 0, 1.12, 0.18),
        box(0.08, 0.09, 0.34, m.frame, 0, 1.0, 0.43),
        box(0.05, 0.14, 0.05, m.frame, 0, 0.9, 0.36),  // magazine
        ring, stripe,
      );
      U.add(arm);
      this.arms.push({ group: arm, kick: 0, tint: [ring, stripe], muzzle: new THREE.Vector3(side * 0.46, 1.0, 0.62), rest: arm.position.clone() });
    }
    this.thrusters(m, 0.12, 1.3, -0.36, 0.07);
  }

  // Singularity: the artillery flagship and the showpiece. Tall and broad-shouldered, gold-trimmed;
  // a prism rifle in the left hand, the right hand left free (it points at the sky for the orbital
  // strike), a long cannon on the right shoulder that swings up and fires into the sky for the skill,
  // a satellite uplink array on the back, a crown, a pulsing chest core and a small halo.
  private buildApex(m: Mats): void {
    const U = this.upper;
    const gold = m.paint;
    for (const leg of this.legs) {
      leg.hip.scale.set(0.9, 1, 0.9);
      leg.hip.add(box(0.26, 0.05, 0.32, gold, 0, -0.02, 0));
      const spike = box(0.06, 0.22, 0.06, gold, 0, 0.06, 0.2);
      spike.rotation.x = 0.5;
      leg.knee.add(spike, box(0.3, 0.05, 0.36, gold, 0, -0.42, 0));
    }
    this.standardTorso(m, 1.02);
    U.add(box(0.56, 0.04, 0.04, gold, 0, 1.52, 0.36), box(0.04, 0.34, 0.04, gold, -0.3, 1.3, 0.33), box(0.04, 0.34, 0.04, gold, 0.3, 1.3, 0.33));
    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), glowMat(m.accent, 2.4));
    core.position.set(0, 1.32, 0.42);
    const socket = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.025, 8, 24), gold);
    socket.position.set(0, 1.32, 0.38);
    U.add(core, socket);
    this.core = core;
    // head: slim visor, a crown, a small halo
    U.add(plate([[-0.13, 0.12], [0.13, 0.12], [0.1, 0.36], [-0.1, 0.36]], 0.17, m.frame, 1.48, 0.015), box(0.18, 0.035, 0.03, m.glow, 0, 1.57, 0.37));
    for (const [x, h, r] of [[-0.11, 0.16, -0.25], [0, 0.26, 0], [0.11, 0.16, 0.25]] as const) {
      const spike = box(0.04, h, 0.04, gold, x, 1.66 + h / 2, 0.24);
      spike.rotation.z = -r;
      U.add(spike);
    }
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 8, 48), glowMat(m.accent, 1.8));
    halo.position.set(0, 1.86, -0.2);
    U.add(halo);
    this.halo = halo;
    // broad, gold-edged pauldrons; the right one carries the cannon mount
    const shoulder: Pt[] = [[0.42, -0.28], [0.84, -0.22], [0.92, 0.12], [0.76, 0.32], [0.44, 0.24]];
    for (const pts of [shoulder, mirror(shoulder)]) U.add(plate(pts, 0.3, m.armor, 1.4), plate(shrink(pts, 0.94, 0.01), 0.04, gold, 1.72, 0.01));
    // shoulder cannon: housing on a turret, a long barrel with glowing rings; rests pointing ahead,
    // swings up to the sky for the orbital strike
    const pivot = new THREE.Group();
    pivot.position.set(0.66, 1.9, -0.12);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.2, fineBuild ? 24 : 10), m.frame);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = 0.55;
    const tip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.03, 8, 20), glowMat(m.accent, 2));
    tip.position.z = 1.15;
    pivot.add(box(0.3, 0.24, 0.5, m.armor, 0, 0, 0), box(0.32, 0.04, 0.46, gold, 0, 0.13, 0), barrel, tip);
    for (const z of [0.35, 0.65, 0.95]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.015, 6, 20), glowMat(m.accent, 1.2));
      band.position.z = z;
      pivot.add(band);
    }
    U.add(box(0.2, 0.1, 0.2, m.frame, 0.66, 1.78, -0.12), pivot);
    this.shoulderGun = { pivot, tip, rest: -0.12, up: -1.5 };
    pivot.rotation.x = -0.12;
    // left hand: the prism rifle (the gun it fires)
    const rifle = new THREE.Group();
    rifle.position.x = -0.6;
    const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), glowMat(0xffffff, 2));
    prism.scale.set(1, 1, 1.8);
    prism.position.set(0, 1.1, 1.0);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.7, 6), m.frame);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 1.1, 0.6);
    const rail = box(0.02, 0.015, 0.6, glowMat(0xffffff, 1.6), 0, 1.18, 0.6);
    rifle.add(box(0.17, 0.3, 0.2, m.frame, 0, 1.24, -0.02), box(0.18, 0.18, 0.36, m.armor, 0, 1.1, 0.16), box(0.19, 0.04, 0.2, gold, 0, 1.2, 0.16), body, rail, prism);
    U.add(rifle);
    this.arms.push({ group: rifle, kick: 0, tint: [prism, rail], muzzle: new THREE.Vector3(-0.6, 1.1, 1.06), rest: rifle.position.clone() });
    // right hand: free, glowing palm; pivots at the shoulder to point at the sky
    const free = new THREE.Group();
    free.position.set(0.6, 1.36, 0);
    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), glowMat(m.accent, 1.8));
    palm.position.set(0, -0.5, 0.12);
    free.add(box(0.16, 0.3, 0.18, m.frame, 0, -0.12, 0), box(0.14, 0.32, 0.16, m.armor, 0, -0.36, 0.05), box(0.15, 0.04, 0.17, gold, 0, -0.24, 0.05), palm);
    U.add(free);
    this.skillArm = free;
    // satellite uplink on the back: a dish on a mast, two antennas with glowing tips
    const mast = new THREE.Group();
    mast.position.set(-0.2, 1.62, -0.46);
    const dishMat = (m.top as THREE.MeshStandardMaterial).clone();
    dishMat.side = THREE.DoubleSide;  // an open bowl: both faces show
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 12, 0, Math.PI * 2, 0, 1.0), dishMat);
    dish.rotation.x = -2.0;
    dish.position.y = 0.42;
    const feed = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat(m.accent, 2));
    feed.position.set(0, 0.5, 0.12);
    mast.add(box(0.05, 0.4, 0.05, m.frame, 0, 0.2, 0), dish, feed);
    U.add(mast);
    this.sways.push({ obj: mast, base: 0, amp: 0.03, speed: 1.2 });
    for (const [x, h] of [[0.1, 0.55], [0.24, 0.4]] as const) {
      const ant = new THREE.Group();
      ant.position.set(x, 1.62, -0.48);
      ant.rotation.x = -0.2;
      ant.add(box(0.02, h, 0.02, m.frame, 0, h / 2, 0), box(0.04, 0.04, 0.04, glowMat(m.accent, 2), 0, h, 0));
      U.add(ant);
      this.sways.push({ obj: ant, base: -0.2, amp: 0.06, speed: 2.4 + x });
    }
    U.add(box(0.56, 0.36, 0.24, m.frame, 0, 1.32, -0.4));
    this.thrusters(m, 0.18, 1.24, -0.57, 0.08);
  }

  // Singularity's skill pose: shoulder cannon up, right hand raised to the sky.
  skillPose(on: boolean): void {
    this.skillTarget = on ? 1 : 0;
  }

  // A heavy recoil (the orbital cannon firing): the body rocks back and sinks, then settles.
  recoil(): void {
    this.slam = 1;
  }

  // World position of the shoulder cannon's tip (for the beam it fires), or null.
  shoulderTip(out: THREE.Vector3): THREE.Vector3 | null {
    return this.shoulderGun ? this.shoulderGun.tip.getWorldPosition(out) : null;
  }

  // Mechanical detail that only shows up close: hydraulic pistons and joints on the legs; on the
  // vanguard (the title-screen star) chest seams, reactor fins and shoulder lights too.
  private addDetail(style: MechId, m: Mats): void {
    const steel = new THREE.MeshStandardMaterial({ color: 0x9aa3b0, metalness: 0.95, roughness: 0.18 });
    const seam = new THREE.MeshStandardMaterial({ color: 0x0b0d12, metalness: 0.4, roughness: 0.7 });
    const cyl = (r: number, len: number, mat: THREE.Material, seg = 20) => new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
    for (const leg of this.legs) {
      const hipJoint = cyl(0.13, 0.34, m.frame);
      hipJoint.rotation.z = Math.PI / 2;
      const kneeJoint = cyl(0.11, 0.36, m.frame);
      kneeJoint.rotation.z = Math.PI / 2;
      kneeJoint.position.y = 0.02;
      // piston behind the thigh: housing from the hip, polished rod into the knee
      const housing = cyl(0.045, 0.24, m.frame);
      housing.position.set(0, -0.12, -0.19);
      const rod = cyl(0.025, 0.24, steel);
      rod.position.set(0, -0.32, -0.19);
      leg.hip.add(hipJoint, housing, rod);
      const ankle = cyl(0.08, 0.26, m.frame);
      ankle.rotation.z = Math.PI / 2;
      ankle.position.y = -0.44;
      const shinRod = cyl(0.022, 0.3, steel);
      shinRod.position.set(0, -0.26, -0.21);
      leg.knee.add(kneeJoint, ankle, shinRod);
    }
    if (style !== 'vanguard') return;
    for (const x of [-0.24, 0.24]) this.upper.add(box(0.012, 0.3, 0.02, seam, x, 1.3, 0.4));
    this.upper.add(box(0.5, 0.012, 0.02, seam, 0, 1.2, 0.395), box(0.14, 0.05, 0.02, m.paint, 0.3, 1.42, 0.37));
    for (let i = 0; i < 5; i++) this.upper.add(box(0.56, 0.02, 0.06, m.frame, 0, 1.16 + i * 0.07, -0.57));
    for (const side of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), m.glow);
      lamp.position.set(side * 0.82, 1.62, 0.22);
      this.upper.add(lamp);
    }
  }

  setWeaponColor(hex: number): void {
    for (const a of this.arms) for (const m of a.tint) m.material = glowMat(hex, m.geometry instanceof THREE.TorusGeometry || m.geometry instanceof THREE.SphereGeometry ? 2 : 1.6);
  }

  // World position of a weapon's muzzle (side 0 / 1, fired alternately; a one-gun mech fires both
  // from the same barrel) for a given body position and aim yaw.
  muzzle(side: 0 | 1, pos: THREE.Vector3, yaw: number, out: THREE.Vector3): THREE.Vector3 {
    const S = this.scale, mz = this.arms[side % this.arms.length].muzzle;
    const x = mz.x * S, z = mz.z * S;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return out.set(pos.x + x * c + z * s, mz.y * S, pos.z - x * s + z * c);
  }

  // Attach an extra part to the upper body (model space, before scaling), so it turns with the torso.
  mount(obj: THREE.Object3D): void {
    this.upper.add(obj);
  }

  kick(side: 0 | 1): void {
    this.arms[side % this.arms.length].kick = 1;
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
      leg.knee.rotation.x = (dashing ? 0.9 : Math.max(0, -s) * 0.85 * amt) * this.kneeSign;
    });
    const bob = Math.abs(Math.sin(this.phase)) * 0.05 * amt;
    // standing still: slow breathing and a slight sway, so it never looks frozen
    const idle = 1 - amt;
    this.pelvis.position.y = 0.84 + bob;
    this.upper.position.y = bob + Math.sin(this.t * 1.8) * 0.012 * idle;
    this.upper.rotation.x = this.lean0 + amt * this.leanK + (dashing ? this.leanK : 0);  // lean into the run
    this.upper.rotation.z = Math.sin(this.t * 0.9) * 0.015 * idle;
    if (this.slam > 0) {
      this.slam = Math.max(0, this.slam - dt * 2.2);
      const k = this.slam * this.slam;
      this.upper.rotation.x -= k * 0.45;
      this.upper.position.y -= k * 0.12;
      this.pelvis.position.y -= k * 0.08;
    }
    for (const w of this.sways) w.obj.rotation.x = w.base + Math.sin(this.t * w.speed) * w.amp - amt * w.amp * 2;
    // scarf: hangs and ripples standing, streams out behind when running or dashing
    const stream = dashing ? 1 : amt;
    this.ribbons.forEach((chain, c) => chain.forEach((seg, i) => {
      const k = i / chain.length;
      // negative x tips a segment down (each one hangs from the one before)
      seg.rotation.x = -(i === 0 ? 1.1 - stream * 0.85 : 0.16 - stream * 0.14) + Math.sin(this.t * (4 + stream * 8) - i * 0.9 + c) * (0.06 + stream * 0.12) * (0.4 + k);
      seg.rotation.y = Math.sin(this.t * 2.3 - i * 0.7 + c * 2) * 0.12 * (0.3 + k);
    }));
    // skill pose (singularity): cannon swings up, the free arm points at the sky
    this.skillOn += (this.skillTarget - this.skillOn) * Math.min(1, dt * 6);
    if (this.shoulderGun) {
      const g = this.shoulderGun;
      g.pivot.rotation.x = g.rest + (g.up - g.rest) * this.skillOn;
      g.pivot.position.y = 1.9 - this.slam * this.slam * 0.12;  // the barrel slams down into its mount
    }
    if (this.skillArm) this.skillArm.rotation.x = -2.7 * this.skillOn + Math.sin(this.t * 1.3) * 0.04 * idle;

    if (this.halo) this.halo.rotation.z = this.t * 0.6;
    if (this.core) this.core.scale.setScalar(1 + Math.sin(this.t * 3) * 0.12);
    for (const a of this.arms) {
      a.kick = Math.max(0, a.kick - dt * 8);
      a.group.position.z = a.rest.z - a.kick * 0.2;
      if (a.hover === undefined) a.group.rotation.x = -a.kick * 0.12;  // the muzzle climbs with the recoil
      if (a.hover !== undefined) {
        a.group.position.y = a.rest.y + Math.sin(this.t * 2 + a.hover) * 0.05;
        a.group.rotation.z = this.t * 1.5;
      }
    }

    const thrust = dashing ? 2.4 : 0.5 + amt * 0.7;
    for (const f of this.flames) {
      const flicker = 0.85 + Math.sin(this.t * 40 + f.mesh.id) * 0.15;
      f.mesh.scale.set(1, thrust * flicker, 1);
      f.mesh.position.set(f.x, f.y, f.z - 0.25 * thrust * flicker);
    }
  }
}
