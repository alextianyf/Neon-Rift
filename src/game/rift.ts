import * as THREE from 'three';
import { GEO, disposeTree } from '../core/assets';
import { rand } from '../core/math';

const CLOSE_TIME = 0.3;
const VOID_COLOR = 0x05000c;

// Jagged vertical lens shape, unit height 2 (y in [-1, 1]) and half-width ~0.5.
function tearOutline(): THREE.Vector2[] {
  const pts: THREE.Vector2[] = [];
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    pts.push(new THREE.Vector2(Math.sin(Math.PI * s) * 0.5 * rand(0.55, 1.15), 1 - 2 * s));
  }
  for (let i = n - 1; i > 0; i--) {
    const s = i / n;
    pts.push(new THREE.Vector2(-Math.sin(Math.PI * s) * 0.5 * rand(0.55, 1.15), 1 - 2 * s));
  }
  return pts;
}

// A tear in space that opens before an enemy appears and seals shut afterwards.
// Phase 1 (opening): a thin line grows vertically, then splits open.
// Phase 2 (closing): after the enemy steps out it pinches shut.
export class Rift {
  readonly group = new THREE.Group();
  private readonly tear: THREE.Group;
  private readonly glow: THREE.Mesh<THREE.ShapeGeometry, THREE.MeshBasicMaterial>;
  private readonly edge: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private readonly ground: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private age = 0;
  private closeT = -1;

  constructor(
    scene: THREE.Scene,
    readonly x: number,
    readonly z: number,
    private readonly height: number,
    private readonly openTime: number,
    color: number,
  ) {
    const outline = tearOutline();
    const shapeGeo = new THREE.ShapeGeometry(new THREE.Shape(outline));
    const voidMesh = new THREE.Mesh(shapeGeo, new THREE.MeshBasicMaterial({ color: VOID_COLOR, side: THREE.DoubleSide }));
    this.glow = new THREE.Mesh(shapeGeo.clone(), new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(1.6), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.glow.scale.setScalar(1.35);
    this.glow.position.z = -0.01;
    voidMesh.position.z = 0.01;
    const edgeGeo = new THREE.BufferGeometry().setFromPoints(outline.map(p => new THREE.Vector3(p.x, p.y, 0.02)));
    this.edge = new THREE.LineLoop(edgeGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(color).multiplyScalar(3.5) }));

    this.tear = new THREE.Group();
    this.tear.add(this.glow, voidMesh, this.edge);
    this.tear.scale.set(0, 0, 1);

    this.ground = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.7, side: THREE.DoubleSide,
    }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = 0.04;
    this.ground.scale.setScalar(height * 0.45);

    this.group.position.set(x, 0, z);
    this.group.add(this.tear, this.ground);
    scene.add(this.group);
  }

  get open(): boolean {
    return this.closeT < 0;
  }

  get done(): boolean {
    return this.closeT >= CLOSE_TIME;
  }

  // 0..1 progress of the opening phase
  get progress(): number {
    return Math.min(1, this.age / this.openTime);
  }

  close(): void {
    this.closeT = 0;
  }

  update(dt: number, camera: THREE.Camera): void {
    this.age += dt;
    const h = this.height;
    let sx: number, sy: number;
    if (this.closeT < 0) {
      const k = this.progress;
      sy = Math.min(1, k * 3);                                // a thin line grows first...
      sx = k < 0.33 ? 0.06 : 0.06 + ((k - 0.33) / 0.67) * 0.94;  // ...then splits open
    } else {
      this.closeT += dt;
      const k = 1 - Math.min(1, this.closeT / CLOSE_TIME);
      sx = k * k;
      sy = 0.3 + 0.7 * k;
    }
    // crackle: wobble the outline every frame
    this.tear.scale.set(sx * h * 0.55 * rand(0.92, 1.08), sy * h * 0.5, 1);
    this.tear.position.y = h * 0.5 + 0.15;
    this.tear.quaternion.copy(camera.quaternion);  // always face the camera
    this.tear.rotateZ(rand(-0.04, 0.04));
    this.glow.material.opacity = 0.35 + Math.random() * 0.3;
    this.ground.rotation.z += dt * 3;
    this.ground.material.opacity = (this.closeT < 0 ? 0.4 + 0.4 * Math.abs(Math.sin(this.age * 10)) : 0.3) * Math.max(sx, 0.3);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    disposeTree(this.group);
  }
}
