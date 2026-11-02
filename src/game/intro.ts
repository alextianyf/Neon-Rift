import * as THREE from 'three';
import { glowMat } from '../core/assets';
import { sfx } from '../core/audio';
import type { Game } from './game';

// Deployment drop at the start of every run: four helicopters lower the mech on cables into the
// arena, the cables let go a couple of meters up, the mech drops and slams down, the helicopters
// peel away while the camera swings into the gameplay view. Any key, click or button skips it.
// The game is frozen ('intro' state) until it ends.

const T = { descend: 2.0, release: 2.25, land: 2.55, end: 3.6 };
const HANG_FROM = 15;       // mech height when it comes into view
const HANG_TO = 2.2;        // ...when the cables let go
const HELI_ABOVE = 6;       // helicopters fly this far above the mech
const CAM_OFFSET = new THREE.Vector3(0, 21, 7.5);  // the gameplay camera (graphics.ts)
const SLOTS: [number, number][] = [[-3.4, -2.4], [3.4, -2.4], [-3.4, 2.4], [3.4, 2.4]];

interface Heli { root: THREE.Group; rotor: THREE.Object3D; tail: THREE.Object3D; slot: [number, number]; cable: THREE.Mesh; drift: number }

const smooth = (x: number) => x * x * (3 - 2 * x);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class Intro {
  private readonly group = new THREE.Group();
  private readonly helis: Heli[] = [];
  private t = 0;
  private landed = false;
  private readonly look = new THREE.Vector3();
  private readonly camA = new THREE.Vector3();
  private readonly camB = new THREE.Vector3();
  private readonly v = new THREE.Vector3();

  constructor(private readonly g: Game) {
    const body = new THREE.MeshStandardMaterial({ color: 0x2c323d, metalness: 0.5, roughness: 0.5 });
    const stripe = new THREE.MeshStandardMaterial({ color: 0xffc83d, roughness: 0.5 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x0c1824, metalness: 0.9, roughness: 0.15, emissive: 0x0a2a36 });
    // steel cables with a faint glow so they read against the dark
    const cableMat = new THREE.MeshStandardMaterial({ color: 0x8a94a6, metalness: 0.7, roughness: 0.3, emissive: 0x1d3a44 });
    for (const slot of SLOTS) {
      const root = new THREE.Group();
      // fuselage, cockpit glass, tail boom with a fin, skids, stub wings
      const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 1.3, 6, 12), body);
      hull.rotation.x = Math.PI / 2;
      const nose = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), glass);
      nose.rotation.x = Math.PI / 2;
      nose.position.z = 0.75;
      const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 1.9, 8), body);
      boom.rotation.x = Math.PI / 2;
      boom.position.set(0, 0.12, -1.6);
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.5, 0.3), body);
      fin.position.set(0, 0.36, -2.45);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.04, 6, 20), stripe);
      band.position.z = -0.2;
      root.add(hull, nose, boom, fin, band);
      for (const side of [-1, 1]) {
        const skid = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6), body);
        skid.rotation.x = Math.PI / 2;
        skid.position.set(side * 0.38, -0.55, 0);
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.3), body);
        wing.position.set(side * 0.6, -0.05, -0.1);
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glowMat(side < 0 ? 0xff3355 : 0x55ff99, 2.5));
        lamp.position.set(side * 0.92, -0.05, -0.1);
        root.add(skid, wing, lamp);
      }
      // main rotor: four blades and a faint blur disc; tail rotor
      const rotor = new THREE.Group();
      rotor.position.y = 0.6;
      for (let i = 0; i < 4; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.02, 0.14), body);
        blade.rotation.y = (i / 4) * Math.PI;
        rotor.add(blade);
      }
      const blur = new THREE.Mesh(new THREE.CircleGeometry(1.35, 32), new THREE.MeshBasicMaterial({ color: 0x9aa6b8, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      blur.rotation.x = -Math.PI / 2;
      rotor.add(blur, new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 8), body));
      const tail = new THREE.Group();
      tail.position.set(0.1, 0.36, -2.45);
      for (let i = 0; i < 2; i++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.6, 0.08), body);
        b.rotation.x = (i / 2) * Math.PI;
        tail.add(b);
      }
      root.add(rotor, tail);
      // the cable down to the mech
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1, 6), cableMat);
      this.group.add(root, cable);
      this.helis.push({ root, rotor, tail, slot, cable, drift: Math.random() * 10 });
    }
    this.group.visible = false;
    g.gfx.scene.add(this.group);
  }

  begin(): void {
    this.t = 0;
    this.landed = false;
    this.group.visible = true;
    for (const h of this.helis) h.cable.visible = true;
    this.place(0);
  }

  // First press: jump straight to the landing. Second press: straight into play.
  skip(): void {
    if (this.t < T.land - 0.01) this.t = T.land - 0.001;
    else this.t = T.end;
  }

  // Returns true when the drop is over and play can start.
  update(dt: number): boolean {
    this.t += dt;
    this.place(dt);
    if (this.t >= T.end) {
      this.group.visible = false;
      return true;
    }
    return false;
  }

  private place(dt: number): void {
    const g = this.g, p = g.player, t = this.t, base = p.pos;
    // mech height: lowered on the cables, then a free drop after release
    const down = smooth(clamp01(t / T.descend));
    let h = HANG_FROM + (HANG_TO - HANG_FROM) * down;
    if (t >= T.release) {
      const f = clamp01((t - T.release) / (T.land - T.release));
      h = HANG_TO * (1 - f * f);
    }
    p.mesh.position.set(base.x, Math.max(0, h), base.z);
    p.introPose(dt, t < T.land);
    if (!this.landed && t >= T.land) this.touchdown();

    // helicopters: hold formation above the mech, then climb away and scatter after the release
    const away = clamp01((t - T.release) / (T.end - T.release));
    const hangY = HANG_FROM + (HANG_TO - HANG_FROM) * down + HELI_ABOVE;
    for (const hl of this.helis) {
      const [sx, sz] = hl.slot;
      const bob = Math.sin(t * 2.2 + hl.drift) * 0.12;
      const spread = 1 + away * away * 6;
      hl.root.position.set(base.x + sx * spread, hangY + bob + away * away * 14, base.z + sz * spread);
      hl.root.rotation.set(0.12 + away * 0.3, Math.atan2(-sx, -sz) * away, Math.sin(t * 1.3 + hl.drift) * 0.05);
      hl.rotor.rotation.y += dt * 40;
      hl.tail.rotation.x += dt * 50;
      // cable from the belly to the mech's shoulders, until it lets go
      hl.cable.visible = t < T.release;
      if (hl.cable.visible) {
        const a = this.v.set(hl.root.position.x, hl.root.position.y - 0.5, hl.root.position.z);
        const b = this.camB.set(base.x + sx * 0.25, h + 2.4, base.z + sz * 0.2);
        hl.cable.position.copy(a).add(b).multiplyScalar(0.5);
        hl.cable.scale.set(1, a.distanceTo(b), 1);
        hl.cable.quaternion.setFromUnitVectors(UP, this.camA.copy(b).sub(a).normalize());
      }
    }
    if (t >= T.release && t - dt < T.release) {
      for (const hl of this.helis) g.fx.burst({ x: base.x + hl.slot[0] * 0.25, y: h + 2.4, z: base.z + hl.slot[1] * 0.2 }, 0xffd27a, 6, 3, 0.08, 0.3);
      sfx.deploy();
    }

    // camera: low and in front, looking up at the descent; then it swings into the gameplay view
    const toPlay = smooth(clamp01((t - T.land + 0.2) / (T.end - T.land + 0.2)));
    this.look.set(base.x, h + 1.4, base.z);
    // from inside the room (runs start at its edge), looking back at the mech's front; the handoff
    // then sweeps over its head into the gameplay view
    const toCenter = base.lengthSq() > 1 ? -1 : 0, dx = base.x * toCenter, dz = base.z * toCenter;
    const len = Math.hypot(dx, dz) || 1, fx = toCenter ? dx / len : 0, fz = toCenter ? dz / len : -1;
    this.camA.set(base.x + fx * 12 - fz * 4.5, 3.2 + h * 0.35, base.z + fz * 12 + fx * 4.5);
    this.camB.copy(base).add(CAM_OFFSET);
    const cam = g.gfx.camera;
    cam.position.copy(this.camA).lerp(this.camB, toPlay);
    const shake = g.fx.shakeAmt;
    if (shake > 0.001) { cam.position.x += (Math.random() - 0.5) * shake * 0.6; cam.position.z += (Math.random() - 0.5) * shake * 0.6; }
    cam.lookAt(this.look.lerp(this.v.set(base.x, 0, base.z), toPlay));
  }

  private touchdown(): void {
    const g = this.g, p = g.player.pos;
    this.landed = true;
    g.player.introLand();
    g.fx.shockwave(p.x, p.z, 5.5, 0x4ff0ff);
    g.fx.shockwave(p.x, p.z, 3, 0xffd27a);
    g.fx.burst({ x: p.x, y: 0.3, z: p.z }, 0x8a93a6, 40, 9, 0.18, 0.9);
    g.fx.burst({ x: p.x, y: 0.5, z: p.z }, 0xffd27a, 16, 6, 0.1, 0.4);
    g.gfx.flash(p.x, 2, p.z, 0x9fe8ff, 40);
    g.fx.shake(1.2);
    g.fx.hitstop(0.08);
    sfx.boom();
  }
}

const UP = new THREE.Vector3(0, 1, 0);
