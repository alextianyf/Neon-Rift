import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glowMat } from '../core/assets';
import { clamp } from '../core/math';
import { MECHS } from '../data/meta';
import type { Game } from './game';
import { MechModel } from './mech';

// Title screen backdrop: a looping hangar scene. The mech stands dark on its pad while two robot
// arms weld its legs; the pilot rides the gantry lift up, walks the catwalk and climbs into the
// chest hatch; the mech powers up from the feet, flexes and test-fires, then strides forward.
// Built far away from the arena so the two never share the screen.

const ORIGIN = new THREE.Vector3(0, 0, -400);
const S = 3;                 // mech scale: about 5.6 units tall next to a 1-unit pilot
const LOOP = 24;             // seconds
const CATWALK_Y = 3.55;
const CATWALK_Z = 1.9;
const LIFT_X = -5.4;
const CATWALK_LEN = 5.1;     // from the lift to just past the hatch (x = 0)
const PILOT = 0.32;          // pilot scale: a 1.9 m suit becomes about 0.6, comfortably inside the hatch opening
const RAIL_H = 0.36;         // catwalk railing: waist height for the pilot
// Long lens: a narrow field of view with the camera pulled back keeps proportions natural and
// flattens the background, like a film camera. Key positions below are for a 50° lens and get
// pushed out along the view line by LENS.
const FOV = 30;
const LENS = Math.tan((50 / 2) * Math.PI / 180) / Math.tan((FOV / 2) * Math.PI / 180);
const FOG = new THREE.Fog(0x05070d, 24, 62);
const WELD_LIGHT_OFFSET = new THREE.Vector3(0, 0.2, 0.6);

// Volumetric-looking light cone: brightest at the lamp, fading toward the floor and at the edges.
const SHAFT_SHADER = {
  // NaN-safe on purpose: the cone's tip has a zero-length normal, and a NaN pixel here would be
  // smeared into black blocks by the bloom pass.
  vertexShader: `varying float vY; varying float vRim;
    void main() {
      vY = uv.y;
      vec3 n = normalMatrix * normal;
      float len = length(n);
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vRim = len > 1e-4 ? abs(dot(n / len, normalize(-mv.xyz))) : 0.0;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform vec3 color; uniform float strength; varying float vY; varying float vRim;
    void main() {
      float y = clamp(vY, 0.0, 1.0), r = clamp(vRim, 0.0, 1.0);
      gl_FragColor = vec4(color, strength * pow(y, 1.6) * r * r);
    }`,
};

// Camera keys: time, position, look-at (hangar space). `cut` jumps straight to the key.
interface Key { t: number; pos: [number, number, number]; look: [number, number, number]; cut?: boolean }
const KEYS: Key[] = [
  { t: 0, pos: [10, 2.0, 11], look: [0, 2.8, 0] },
  { t: 5.8, pos: [6.2, 1.3, 6.2], look: [1.4, 1.5, 1.0] },
  // boarding: follow the pilot along the catwalk, end close on the hatch
  { t: 6, pos: [-1.6, 4.7, 6.4], look: [-4.2, 4.0, 1.9], cut: true },
  { t: 9, pos: [1.7, 4.5, 5.3], look: [-0.4, 4.0, 1.8] },
  { t: 10.6, pos: [1.3, 4.3, 4.4], look: [0, 3.95, 1.4] },
  { t: 11, pos: [0, 0.7, 9.5], look: [0, 3.7, 0], cut: true },
  { t: 14, pos: [0, 1.5, 10.5], look: [0, 3.5, 0] },
  { t: 14.4, pos: [5.2, 2.8, 9.4], look: [0, 3.2, 0], cut: true },
  { t: 18.6, pos: [-5.2, 2.8, 9.4], look: [0, 3.2, 0] },
  { t: 19, pos: [0, 2.3, 15.5], look: [0, 3.0, 2.0], cut: true },
  { t: 24, pos: [0, 2.7, 13.6], look: [0, 3.4, 3.8] },
];

const smooth = (x: number) => x * x * (3 - 2 * x);
const phase = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);

interface Glow { mat: THREE.MeshBasicMaterial; base: THREE.Color; y: number }
// The pilot's joints, posed every frame.
interface Suit { body: THREE.Group; torso: THREE.Group; hips: THREE.Group[]; knees: THREE.Group[]; shoulders: THREE.Group[]; elbows: THREE.Group[] }
interface Welder { base: THREE.Group; upper: THREE.Group; lower: THREE.Group; tip: THREE.Object3D; target: THREE.Vector3; rest: THREE.Vector3 }

export class TitleScene {
  private readonly group = new THREE.Group();
  private readonly mech = new MechModel(MECHS.vanguard.palette, S, true);
  private readonly env: THREE.Texture;
  private readonly dust: THREE.Points;
  private readonly shafts: THREE.ShaderMaterial[] = [];
  private savedFog: THREE.FogBase | null = null;
  private readonly fill: { light: THREE.Light; base: number }[] = [];
  private readonly glows: Glow[] = [];
  private readonly hatch = new THREE.Group();
  private readonly pilot = new THREE.Group();
  private readonly suit: Suit;
  private visorMat: THREE.MeshStandardMaterial | null = null;
  private readonly lift: THREE.Mesh;
  private readonly catwalk = new THREE.Group();
  private readonly welders: Welder[] = [];
  private readonly weldLight = new THREE.PointLight(0xa8d8ff, 0, 8);
  private readonly fade: HTMLElement | null = document.getElementById('titleFade');
  private t = 0;
  private sparkT = 0;
  private firedAt = -1;
  private readonly vel = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(private readonly g: Game) {
    this.group.position.copy(ORIGIN);
    const pmrem = new THREE.PMREMGenerator(g.gfx.renderer);
    this.env = pmrem.fromScene(new RoomEnvironment(g.gfx.renderer), 0.04).texture;
    pmrem.dispose();
    this.buildHangar();
    this.dust = this.buildAtmosphere();
    this.buildMech();
    this.lift = this.buildGantry();
    this.suit = this.buildPilot();
    this.buildWelders();
    this.group.add(this.weldLight);
    // a soft reflection, not a mirror: the studio environment is much brighter than the hangar
    this.group.traverse(o => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.material.envMapIntensity = 0.3;
    });
    if (this.visorMat) this.visorMat.envMapIntensity = 1.6;  // the helmet visor is a mirror
    g.gfx.scene.add(this.group);
    this.show(false);
  }

  show(on: boolean): void {
    if (on === this.group.visible && on) { this.t = 0; return; }
    const gfx = this.g.gfx, scene = gfx.scene, cam = gfx.camera;
    this.group.visible = on;
    gfx.cinematic(on);
    // reflections from a studio environment only while the hangar is up (it would light the arena too)
    scene.environment = on ? this.env : null;
    if (on) { this.savedFog = scene.fog; scene.fog = FOG; } else if (this.savedFog) scene.fog = this.savedFog;
    // the game's flat ambient and sun light would wash out the contrast here
    if (!this.fill.length) for (const o of scene.children) if (o instanceof THREE.HemisphereLight || o instanceof THREE.DirectionalLight) this.fill.push({ light: o, base: o.intensity });
    for (const f of this.fill) f.light.intensity = f.base * (on ? 0.2 : 1);
    cam.fov = on ? FOV : 50;
    if (!on) cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.t = 0;
    if (this.fade) this.fade.style.opacity = '0';
  }

  update(dt: number): void {
    this.t = (this.t + dt) % LOOP;
    const t = this.t;
    this.animateWelders(t, dt);
    this.animatePilot(t);
    this.animateMech(t, dt);
    this.animateAtmosphere(t, dt);
    this.placeCamera(t);
    if (this.fade) this.fade.style.opacity = String(t < 0.6 ? 1 - t / 0.6 : t > LOOP - 1 ? t - (LOOP - 1) : 0);
  }

  // ---------------------------------------------------------------------------------------------
  // Set dressing

  private buildHangar(): void {
    const G = this.group;
    const metal = new THREE.MeshStandardMaterial({ color: 0x161a22, metalness: 0.7, roughness: 0.5 });
    const wall = new THREE.MeshStandardMaterial({ color: 0x0f121a, metalness: 0.5, roughness: 0.7 });
    // polished deck: picks up the lights through the environment reflections
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 40), new THREE.MeshStandardMaterial({ color: 0x0a0d12, metalness: 0.9, roughness: 0.26 }));
    floor.rotation.x = -Math.PI / 2;
    G.add(floor);
    void metal;
    const grid = new THREE.GridHelper(60, 30, 0x16424c, 0x0b1a20);
    grid.position.y = 0.01;
    G.add(grid);

    // the mech's pad: dark disc with a glowing rim and hazard ticks
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.8, 0.18, 48), new THREE.MeshStandardMaterial({ color: 0x1b1f28, metalness: 0.8, roughness: 0.4 }));
    pad.position.y = 0.09;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.04, 6, 64), glowMat(0x4ff0ff, 1.4));
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.19;
    G.add(pad, rim);
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 0.16), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x111111 : 0xffc83d, roughness: 0.6 }));
      tick.position.set(Math.sin(a) * 3.25, 0.19, Math.cos(a) * 3.25);
      tick.rotation.y = a;
      G.add(tick);
    }

    // back wall with light strips and a big bay door frame
    const back = new THREE.Mesh(new THREE.PlaneGeometry(60, 22), wall);
    back.position.set(0, 11, -9);
    G.add(back);
    for (const x of [-14, -9, 9, 14]) G.add(this.strip(x, 6, -8.9, 0.12, 10, 0x2a8fa0, 1.2));
    const door = new THREE.Mesh(new THREE.BoxGeometry(12, 0.3, 0.3), glowMat(0xff4dd2, 0.9));
    door.position.set(0, 12.5, -8.8);
    G.add(door);
    for (const x of [-6, 6]) G.add(this.strip(x, 6.2, -8.8, 0.3, 12.6, 0xff4dd2, 0.9));
    for (let i = 0; i < 6; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(11.6, 1.6, 0.1), new THREE.MeshStandardMaterial({ color: 0x1a1f2a, metalness: 0.6, roughness: 0.5 }));
      slat.position.set(0, 1 + i * 1.95, -8.85);
      G.add(slat);
    }
    // ceiling light bars
    for (const z of [-4, 2, 8]) G.add(this.strip(0, 13, z, 16, 0.15, 0xcfe0ff, 1.4, 0.4));
    // side pillars
    for (const x of [-16, 16]) for (const z of [-6, 4]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(1.2, 14, 1.2), wall);
      p.position.set(x, 7, z);
      G.add(p, this.strip(x + (x < 0 ? 0.62 : -0.62), 7, z, 0.06, 12, 0x4ff0ff, 1));
    }
    // a few crates and a tool cart for scale
    const crate = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, metalness: 0.4, roughness: 0.6 });
    for (const [x, z, s] of [[7.5, -3, 1.2], [8.6, -2.4, 0.9], [7.9, -1.6, 0.7], [-8.2, -4, 1.4]] as const) {
      const c = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crate);
      c.position.set(x, s / 2, z);
      c.rotation.y = x * 0.3;
      G.add(c);
    }

    // hard key from above-front: a pool of light on the pad, the rest of the hangar falls off to dark
    const key = new THREE.SpotLight(0xdbe6ff, 400, 40, 0.42, 0.55, 2);
    key.position.set(3, 13, 8);
    key.target.position.set(0, 1.5, 0);
    // colored rims from behind pick out the silhouette
    const rimC = new THREE.PointLight(0x4ff0ff, 70, 16);
    rimC.position.set(-4.5, 7.5, -5.5);
    const rimM = new THREE.PointLight(0xff4dd2, 45, 18);
    rimM.position.set(6.5, 7.5, -6.5);
    const warm = new THREE.PointLight(0xff8a3d, 22, 18);
    warm.position.set(-7, 2.5, 4);
    G.add(key, key.target, rimC, rimM, warm);
  }

  private buildAtmosphere(): THREE.Points {
    const G = this.group;
    // light shafts from the ceiling lamps, one on the mech
    for (const [x, z, r, c, k] of [[0, 0.6, 3.2, 0xcfe0ff, 0.12], [-7, -1, 2.2, 0x4ff0ff, 0.07], [7, 3, 2.4, 0xffb070, 0.06]] as const) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { color: { value: new THREE.Color(c) }, strength: { value: k } },
        vertexShader: SHAFT_SHADER.vertexShader, fragmentShader: SHAFT_SHADER.fragmentShader,
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      });
      const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 12.6, 40, 1, true), mat);
      cone.position.set(x, 6.6, z);
      G.add(cone);
      this.shafts.push(mat);
    }
    // a second mech parked in the dark at the back, for depth and scale
    const parked = new MechModel({ armor: 0x30343c, armorTop: 0x3a3f48, paint: 0x5a3a1a, accent: 0x1a4a55 }, 3.1, true);
    const dim = new THREE.MeshBasicMaterial({ color: 0x0d3a44 });
    parked.root.traverse(o => { if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial && !o.material.transparent) o.material = dim; });
    parked.update(0, this.vel, -0.3, 2, false);
    parked.root.position.set(-11.5, 0, -5);
    parked.root.rotation.y = 0.5;
    G.add(parked.root);
    // cables hanging from the ceiling rig
    const cable = new THREE.MeshStandardMaterial({ color: 0x0b0d12, metalness: 0.5, roughness: 0.6 });
    for (const [x, z, len] of [[-3.2, -1.5, 6], [3.4, -1.2, 5], [2.4, -2.4, 7.5], [-6, 1.5, 4.5]] as const) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), cable);
      c.position.set(x, 13 - len / 2, z);
      G.add(c);
    }
    // dust drifting in the light
    const n = 600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 18, Math.random() * 11, (Math.random() - 0.5) * 14], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xbcd4ff, size: 0.045, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    G.add(dust);
    return dust;
  }

  private animateAtmosphere(t: number, dt: number): void {
    const pos = this.dust.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + dt * (0.08 + (i % 7) * 0.02);
      if (y > 11) y = 0;
      pos.setXYZ(i, pos.getX(i) + Math.sin(t * 0.3 + i) * dt * 0.05, y, pos.getZ(i));
    }
    pos.needsUpdate = true;
    // the key light's shaft dips while the mech's reactor surges on
    const surge = t > 11.2 && t < 13.8 ? 0.6 + Math.random() * 0.4 : 1;
    this.shafts[0].uniforms.strength.value = 0.12 * surge;
  }

  private strip(x: number, y: number, z: number, w: number, h: number, color: number, k: number, d = 0.08): THREE.Mesh {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glowMat(color, k));
    m.position.set(x, y, z);
    return m;
  }

  // The mech, with its own copies of the glow materials so it can power up without touching the
  // shared ones the player's mech uses, plus a chest hatch the pilot climbs through.
  private buildMech(): void {
    const m = this.mech;
    this.group.add(m.root);
    // hatch: hinged at its top edge on the chest front; behind it a dark doorway the pilot steps
    // through (anything past the doorway plane is hidden, so it reads as an opening in the armor)
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.04), new THREE.MeshStandardMaterial({ color: 0xa4adbc, metalness: 0.35, roughness: 0.5, flatShading: true }));
    panel.position.set(0, -0.15, 0.02);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.05), glowMat(0x4ff0ff, 1.6));
    edge.position.set(0, -0.28, 0.03);
    this.hatch.add(panel, edge);
    this.hatch.position.set(0, 1.5, 0.41);
    const doorway = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.27), new THREE.MeshBasicMaterial({ color: 0x02080d }));
    doorway.position.set(0, 1.35, 0.415);
    m.mount(this.hatch);
    m.mount(doorway);
    for (const [w, h, x, y] of [[0.32, 0.012, 0, 1.488], [0.32, 0.012, 0, 1.212], [0.012, 0.28, -0.155, 1.35], [0.012, 0.28, 0.155, 1.35]] as const) {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), glowMat(0x4ff0ff, 1.2));
      frame.position.set(x, y, 0.418);
      m.mount(frame);
    }
    m.setWeaponColor(0x4ff0ff);
    m.update(0, this.vel, 0, 2, false);
    m.root.updateMatrixWorld(true);
    m.root.traverse(o => {
      if (!(o instanceof THREE.Mesh) || !(o.material instanceof THREE.MeshBasicMaterial) || o.material.transparent) return;
      const mat = o.material.clone();
      o.material = mat;
      // the camera is close here, so the in-game glow strength would blow out the bloom
      this.glows.push({ mat, base: mat.color.clone().multiplyScalar(0.5), y: o.getWorldPosition(this.tmp).y - ORIGIN.y });
    });
  }

  // Gantry on the mech's left: a lattice tower with a lift, and a catwalk to the chest hatch.
  private buildGantry(): THREE.Mesh {
    const G = this.group;
    const yellow = new THREE.MeshStandardMaterial({ color: 0xc99a2e, metalness: 0.5, roughness: 0.5 });
    const steel = new THREE.MeshStandardMaterial({ color: 0x2a303c, metalness: 0.7, roughness: 0.45 });
    const tower = new THREE.Group();
    tower.position.set(LIFT_X - 0.9, 0, CATWALK_Z);
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 6.4, 0.12), yellow);
      post.position.set(x, 3.2, z);
      tower.add(post);
    }
    for (let y = 0.8; y < 6.4; y += 1.1) {
      for (const [w, d, x, z] of [[1.3, 0.08, 0, -0.6], [1.3, 0.08, 0, 0.6], [0.08, 1.3, -0.6, 0], [0.08, 1.3, 0.6, 0]] as const) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, d), yellow);
        bar.position.set(x, y, z);
        tower.add(bar);
      }
    }
    tower.add(this.strip(0, 6.45, 0, 1.3, 0.06, 0xffc83d, 1.6, 1.3));
    G.add(tower);

    const lift = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.1), steel);
    lift.position.set(LIFT_X, 0.06, CATWALK_Z);
    lift.add(this.strip(0, 0.07, 0.5, 1.0, 0.03, 0xffc83d, 1.4, 0.04));
    G.add(lift);

    // the catwalk is a group so it can slide back into the tower
    const deck = new THREE.Mesh(new THREE.BoxGeometry(CATWALK_LEN, 0.12, 0.9), steel);
    deck.position.set(CATWALK_LEN / 2, 0, 0);
    this.catwalk.add(deck);
    for (const z of [-0.42, 0.42]) {
      // the rail on the mech's side stops short of the end: that's where the pilot crosses
      const len = z < 0 ? CATWALK_LEN - 1 : CATWALK_LEN;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), yellow);
      rail.position.set(len / 2, RAIL_H, z);
      const glow = this.strip(CATWALK_LEN / 2, 0.08, z, CATWALK_LEN, 0.03, 0x4ff0ff, 1.2, 0.03);
      this.catwalk.add(rail, glow);
      for (let x = 0.2; x < len; x += 0.9) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.035, RAIL_H, 0.035), yellow);
        post.position.set(x, RAIL_H / 2, z);
        this.catwalk.add(post);
      }
    }
    this.catwalk.position.set(LIFT_X + 0.55, CATWALK_Y - 0.06, CATWALK_Z);
    G.add(this.catwalk);
    return lift;
  }

  // The pilot in a pressure suit, modeled at human size (meters, origin at the feet) and scaled to
  // fit the hatch: soft white fabric, grey joint rings, a life-support pack, a mirrored visor.
  private buildPilot(): Suit {
    const fabric = new THREE.MeshStandardMaterial({ color: 0xb9bdc5, roughness: 0.85 });  // off-white: pure white blooms under the key light
    const joint = new THREE.MeshStandardMaterial({ color: 0x8a919c, metalness: 0.35, roughness: 0.45 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x4d535e, metalness: 0.2, roughness: 0.6 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.6 });
    this.visorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a0c, metalness: 1, roughness: 0.06, emissive: 0x041c22 });
    const capsule = (r: number, len: number, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 8, 20), mat);
      m.position.y = y;
      return m;
    };
    const ring = (r: number, tube: number, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 10, 28), mat);
      m.rotation.x = Math.PI / 2;
      m.position.y = y;
      return m;
    };
    const rbox = (w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.3), mat);
      m.position.set(x, y, z);
      return m;
    };

    const body = new THREE.Group();
    body.scale.setScalar(PILOT);
    // hips and belt
    const pelvis = capsule(0.13, 0.12, fabric, 0.98);
    pelvis.rotation.z = Math.PI / 2;
    pelvis.scale.set(1, 1, 0.85);
    body.add(pelvis, ring(0.17, 0.025, dark, 1.06));

    const torso = new THREE.Group();
    torso.position.y = 1.05;
    const chest = capsule(0.19, 0.22, fabric, 0.27);
    chest.scale.set(1.08, 1, 0.78);
    const panel = rbox(0.2, 0.13, 0.06, joint, 0, 0.3, 0.15);
    for (const [x, c] of [[-0.05, 0x4ff0ff], [0, 0xffa040], [0.05, 0x7dff6a]] as const) {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), glowMat(c, 2));
      led.position.set(x, 0.32, 0.183);
      torso.add(led);
    }
    const pack = rbox(0.36, 0.46, 0.2, fabric, 0, 0.3, -0.2);
    torso.add(chest, panel, pack, ring(0.11, 0.028, joint, 0.55), rbox(0.04, 0.3, 0.02, glowMat(0x4ff0ff, 1.2), 0, 0.3, -0.305));
    for (const x of [-0.1, 0.1]) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 16), joint);
      tank.position.set(x, 0.32, -0.32);
      torso.add(tank);
    }
    // helmet: white shell, mirrored gold visor facing forward, a small lamp on the side
    const helmet = new THREE.Group();
    helmet.position.y = 0.72;
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 20), fabric);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.163, 32, 16, Math.PI / 2 - 0.95, 1.9, 0.7, 1.05), this.visorMat);
    const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 12), glowMat(0xdff6ff, 2.2));
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0.15, 0.04, 0.05);
    helmet.add(shell, visor, lamp, ring(0.15, 0.015, joint, -0.1));
    torso.add(helmet);

    const shoulders: THREE.Group[] = [], elbows: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.25, 0.43, 0);
      const elbow = new THREE.Group();
      elbow.position.y = -0.3;
      const glove = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), dark);
      glove.scale.set(1, 1.25, 0.8);
      glove.position.y = -0.31;
      elbow.add(ring(0.058, 0.017, joint, 0), capsule(0.056, 0.17, fabric, -0.14), ring(0.06, 0.016, orange, -0.24), glove);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 14), fabric);
      shoulder.add(cap, capsule(0.062, 0.19, fabric, -0.15), elbow);
      torso.add(shoulder);
      shoulders.push(shoulder);
      elbows.push(elbow);
    }
    body.add(torso);

    const hips: THREE.Group[] = [], knees: THREE.Group[] = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1, 0.98, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.43;
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), joint);
      pad.scale.set(1, 1, 0.7);
      pad.position.z = 0.03;
      knee.add(pad, capsule(0.072, 0.26, fabric, -0.2), rbox(0.13, 0.12, 0.27, dark, 0, -0.47, 0.04));
      hip.add(capsule(0.082, 0.28, fabric, -0.2), knee);
      body.add(hip);
      hips.push(hip);
      knees.push(knee);
    }
    this.pilot.add(body);
    this.group.add(this.pilot);
    return { body, torso, hips, knees, shoulders, elbows };
  }

  // Walk cycle (`stride` 0..1) at phase `ph`, plus a crouch and a forward lean for climbing in.
  private posePilot(ph: number, stride: number, crouch: number, lean: number, t: number): void {
    const S = this.suit;
    S.hips.forEach((h, i) => {
      const s = Math.sin(ph + i * Math.PI);
      h.rotation.x = -s * 0.5 * stride - crouch * 1.0;
      S.knees[i].rotation.x = Math.max(0, s) * 0.85 * stride + crouch * 1.8;
      S.shoulders[i].rotation.x = s * 0.45 * stride - crouch * 0.6;
      S.elbows[i].rotation.x = -0.25 - stride * 0.25 - crouch * 0.5;
    });
    S.torso.rotation.x = lean + stride * 0.06;
    // bob with the steps, sink into the crouch, breathe when standing still
    S.body.position.y = (Math.abs(Math.sin(ph)) * 0.03 * stride - crouch * 0.36 + Math.sin(t * 2) * 0.004 * (1 - stride)) * PILOT;
  }

    // Two floor-mounted robot arms with welding torches.
  private buildWelders(): void {
    const yellow = new THREE.MeshStandardMaterial({ color: 0xd8a330, metalness: 0.45, roughness: 0.5 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x252a35, metalness: 0.7, roughness: 0.4 });
    for (const [bx, bz, tx, ty, tz] of [[3.4, 2.4, 1.0, 1.7, 0.4], [-2.6, 3.0, -0.9, 0.9, 0.5]] as const) {
      const base = new THREE.Group();
      base.position.set(bx, 0, bz);
      const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 0.3, 16), dark);
      foot.position.y = 0.15;
      const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.5, 12), yellow);
      turret.position.y = 0.5;
      base.add(foot, turret);
      const upper = new THREE.Group();
      upper.position.y = 0.75;
      const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.22), yellow);
      l1.position.y = 0.8;
      upper.add(l1);
      const lower = new THREE.Group();
      lower.position.y = 1.6;
      const l2 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4, 0.16), yellow);
      l2.position.y = 0.7;
      const torch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.06, 0.3, 8), dark);
      torch.position.y = 1.5;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glowMat(0xbfe6ff, 3));
      tip.position.y = 1.66;
      lower.add(l2, torch, tip);
      upper.add(lower);
      base.add(upper);
      this.group.add(base);
      this.welders.push({ base, upper, lower, tip, target: new THREE.Vector3(tx, ty, tz), rest: new THREE.Vector3(bx * 0.75, 2.6, bz + 0.4) });
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Animation

  // Two-link arm aimed at a point: turn the base toward it, then bend shoulder and elbow to reach.
  private aimWelder(w: Welder, target: THREE.Vector3): void {
    const L1 = 1.6, L2 = 1.66;
    const dx = target.x - w.base.position.x, dz = target.z - w.base.position.z;
    w.base.rotation.y = Math.atan2(dx, dz);
    const r = Math.hypot(dx, dz), h = target.y - 0.75;
    const d = clamp(Math.hypot(r, h), 0.3, L1 + L2 - 0.01);
    const elbow = Math.acos(clamp((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2), -1, 1));
    const reach = Math.atan2(r, h);  // from straight up toward the target
    const inner = Math.acos(clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1));
    w.upper.rotation.x = reach - inner;
    w.lower.rotation.x = Math.PI - elbow;
  }

  private animateWelders(t: number, dt: number): void {
    const welding = t < 9.5;
    const k = welding ? 1 : smooth(phase(t, 9.5, 11));
    let lit = 0;
    for (const [i, w] of this.welders.entries()) {
      // the torch wanders along a short seam while it works
      const seam = Math.sin(t * 0.7 + i * 2) * 0.25;
      const target = this.tmp.set(w.target.x, w.target.y + seam, w.target.z).lerp(w.rest, k);
      this.aimWelder(w, target);
      w.tip.visible = welding;  // torch off once the arms pull back
      if (!welding) continue;
      lit = Math.max(lit, 0.6 + Math.random() * 0.4);
    }
    this.weldLight.intensity = lit * (Math.random() < 0.15 ? 1.5 : 6);
    if (!welding) return;
    this.sparkT -= dt;
    if (this.sparkT > 0) return;
    this.sparkT = 0.05;
    for (const w of this.welders) {
      const p = w.tip.getWorldPosition(this.tmp);
      this.weldLight.position.copy(p).sub(ORIGIN).add(WELD_LIGHT_OFFSET);  // just off the seam, so it lights the mech more than the arm
      this.g.fx.burst(p, Math.random() < 0.7 ? 0xffc86a : 0xcfe8ff, 3, 3.5, 0.06, 0.45);
    }
  }

  private animatePilot(t: number): void {
    const P = this.pilot, lift = this.lift;
    // the lift rises with the pilot, waits, then drops back down once the hatch closes
    const up = smooth(phase(t, 3.6, 6)) * (1 - smooth(phase(t, 12, 14)));
    lift.position.y = 0.06 + up * (CATWALK_Y - 0.06);
    // catwalk slides back into the tower after boarding, and comes back out for the next loop
    const out = 1 - smooth(phase(t, 11.5, 13)) + smooth(phase(t, 22, 23.5));
    this.catwalk.scale.x = clamp(out, 0.05, 1);
    // the hatch swings out and folds up to stand above the doorway, out of the pilot's way; it opens
    // while the pilot is still well down the catwalk (its arc reaches about 0.9 out from the chest)
    // and closes once they're inside
    this.hatch.rotation.x = -2.85 * smooth(phase(t, 7.2, 8.2)) * (1 - smooth(phase(t, 10.7, 11.5)));

    // the doorway sits on the chest front; the mech crouches a little while it's powered down
    const doorZ = 0.415 * S + this.mech.root.position.z;
    let stride = 0, crouch = 0, lean = 0, ph = 0;
    if (t < 6) {
      P.position.set(LIFT_X, lift.position.y + 0.06, CATWALK_Z);
      P.rotation.y = Math.PI / 2;
    } else if (t < 9) {
      // walk the catwalk to the hatch
      const k = phase(t, 6, 9), x = LIFT_X + smooth(k) * -LIFT_X;
      P.position.set(x, CATWALK_Y, CATWALK_Z);
      P.rotation.y = Math.PI / 2;
      stride = Math.min(1, k * 6, (1 - k) * 6);
      ph = (x - LIFT_X) * 5.5;
    } else if (t < 9.35) {
      // turn to face the mech
      P.position.set(0, CATWALK_Y, CATWALK_Z);
      P.rotation.y = Math.PI / 2 + smooth(phase(t, 9, 9.35)) * Math.PI / 2;
    } else if (t < 9.8) {
      // two steps to the edge of the catwalk
      const k = phase(t, 9.35, 9.8);
      P.position.set(0, CATWALK_Y, CATWALK_Z - smooth(k) * (CATWALK_Z - doorZ - 0.22));
      P.rotation.y = Math.PI;
      stride = Math.sin(k * Math.PI);
      ph = k * Math.PI * 2;
    } else {
      // duck through the doorway: crouch, lean in, step across; past the doorway plane they're hidden
      const k = smooth(phase(t, 9.8, 10.6));
      P.position.set(0, CATWALK_Y, doorZ + 0.22 - k * 0.75);
      P.rotation.y = Math.PI;
      crouch = Math.min(1, k * 2.2) * 0.6;
      lean = Math.min(1, k * 2) * 0.45;
      stride = k > 0.3 ? 0.5 : 0;
      ph = k * Math.PI * 3;
    }
    P.visible = t < 10.6;
    this.posePilot(ph, stride, crouch, lean, t);
  }

    private animateMech(t: number, dt: number): void {
    const m = this.mech;
    // power-up: lights come on from the feet up, with a flash when the visor lights
    const power = smooth(phase(t, 11.2, 13.6)) * (t > LOOP - 0.8 ? 1 - phase(t, LOOP - 0.8, LOOP) : 1);
    const reach = power * 6.5;
    for (const gl of this.glows) {
      const on = clamp((reach - gl.y) / 0.8, 0, 1);
      const flicker = on > 0 && on < 1 ? 0.5 + Math.random() * 0.5 : 1;
      gl.mat.color.copy(gl.base).multiplyScalar(0.06 + 0.94 * on * flicker);
    }
    // torso sweep left and right, then back to center
    let yaw = 0;
    if (t > 14.2 && t < 18.6) yaw = Math.sin((t - 14.2) / 4.4 * Math.PI * 2) * 0.55;
    // test fire: alternating cannons, two short bursts
    if (t < this.firedAt) this.firedAt = -1;  // the loop wrapped
    for (const at of [15.3, 15.55, 15.8, 17.0, 17.25, 17.5]) {
      if (this.firedAt < at && t >= at) this.fire(at === 15.3 || at === 15.8 || at === 17.25 ? 0 : 1, yaw);
    }
    this.firedAt = t;
    // stride forward toward the camera, then stop
    const walking = t > 19 && t < 22;
    this.vel.set(0, 0, walking ? 1.6 : 0);
    m.root.position.z = clamp(t - 19, 0, 3) * 1.6;
    // hunched while dormant, straightening as it powers up
    m.root.position.y = -0.25 * (1 - power);
    m.update(dt, this.vel, yaw, 1.6, false);
  }

  private fire(side: 0 | 1, yaw: number): void {
    const m = this.mech;
    m.kick(side);
    const local = m.muzzle(side, this.tmp.set(0, 0, m.root.position.z), yaw, new THREE.Vector3());
    const p = local.add(ORIGIN);
    this.g.gfx.flash(p.x, p.y, p.z, 0x4ff0ff, 60);
    this.g.fx.burst(p, 0x4ff0ff, 10, 7, 0.1, 0.25, new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)));
    this.g.fx.shake(0.25);
  }

  private placeCamera(t: number): void {
    let i = 0;
    while (i < KEYS.length - 1 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const k = b.cut || b === a ? 0 : smooth(phase(t, a.t, b.t));
    const cam = this.g.gfx.camera;
    this.look.set(a.look[0] + (b.look[0] - a.look[0]) * k, a.look[1] + (b.look[1] - a.look[1]) * k, a.look[2] + (b.look[2] - a.look[2]) * k);
    cam.position.set(a.pos[0] + (b.pos[0] - a.pos[0]) * k, a.pos[1] + (b.pos[1] - a.pos[1]) * k, a.pos[2] + (b.pos[2] - a.pos[2]) * k);
    cam.position.sub(this.look).multiplyScalar(LENS).add(this.look).add(ORIGIN);
    this.look.add(ORIGIN);
    this.g.gfx.cinematic(true, cam.position.distanceTo(this.look));
    // a touch of handheld drift
    cam.position.x += Math.sin(t * 0.9) * 0.08;
    cam.position.y += Math.sin(t * 1.3) * 0.05;
    const shake = this.g.fx.shakeAmt;
    if (shake > 0.001) cam.position.x += (Math.random() - 0.5) * shake * 0.4;
    cam.lookAt(this.look);
    // the menu sits on the left: shift the picture so the action reads on the right
    const w = innerWidth, h = innerHeight;
    cam.setViewOffset(w, h, w > 900 ? -w * 0.16 : 0, 0, w, h);
  }
}
