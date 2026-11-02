import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { glowMat } from '../core/assets';
import { MECHS, type MechId } from '../data/meta';
import { RARITY_COLOR } from '../data/upgrades';
import { MechModel } from '../game/mech';

// Hangar: a turntable preview of one mech in its own small canvas (close-up build, studio lighting).
// It only renders while the canvas is on screen.
export class MechPreview {
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private readonly ring: THREE.Mesh;
  private model: MechModel | null = null;
  private id: MechId | null = null;
  private running = false;
  private last = 0;
  private readonly still = new THREE.Vector3();

  constructor(private readonly host: HTMLElement) {
    const r = this.renderer;
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    host.prepend(r.domElement);
    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(r), 0.04).texture;
    pmrem.dispose();

    const key = new THREE.SpotLight(0xe6eeff, 60, 20, 0.6, 0.6, 2);
    key.position.set(2.5, 6, 4);
    const rimA = new THREE.PointLight(0x4ff0ff, 18, 10);
    rimA.position.set(-2.5, 3, -2.5);
    const rimB = new THREE.PointLight(0xff4dd2, 10, 10);
    rimB.position.set(2.5, 2.5, -2.5);
    this.scene.add(new THREE.HemisphereLight(0x8899ff, 0x0a0a14, 0.35), key, rimA, rimB);

    const pad = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.4, 0.12, 48), new THREE.MeshStandardMaterial({ color: 0x151922, metalness: 0.8, roughness: 0.35, envMapIntensity: 0.4 }));
    pad.position.y = -0.06;
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(1.36, 0.025, 6, 64), glowMat(0xffffff, 1));
    this.ring.rotation.x = Math.PI / 2;
    this.scene.add(pad, this.ring);
    this.camera.position.set(0, 2.1, 8.2);
    this.camera.lookAt(0, 1.3, 0);
  }

  show(id: MechId): void {
    if (id === this.id) return;
    this.id = id;
    if (this.model) this.scene.remove(this.model.root);
    const def = MECHS[id];
    // every mech at the same height on the turntable, whatever its in-game scale
    const model = new MechModel(def.palette, 1.2, true, id);
    model.root.traverse(o => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshStandardMaterial) o.material.envMapIntensity = 0.45;
    });
    model.update(0, this.still, 0, 2, false);
    this.scene.add(model.root);
    this.model = model;
    this.ring.material = glowMat(RARITY_COLOR[def.rarity], 1.2);
    this.start();
  }

  private start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      // stop once the hangar is closed; show() starts it again
      if (!this.host.offsetParent) { this.running = false; return; }
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.resize();
      if (this.model) {
        this.model.root.rotation.y += dt * 0.45;
        this.model.update(dt, this.still, Math.sin(now / 1600) * 0.35, 2, false);
      }
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const c = this.renderer.domElement;
    if (c.width === Math.round(w * this.renderer.getPixelRatio()) && c.height === Math.round(h * this.renderer.getPixelRatio())) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }
}
