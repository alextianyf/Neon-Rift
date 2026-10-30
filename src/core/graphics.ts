import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { rand } from './math';

// fairly steep (~70°) so tall objects don't drift far from their footprint on screen
const CAM_OFFSET = new THREE.Vector3(0, 21, 7.5);
const camTarget = new THREE.Vector3();

export class Graphics {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
  readonly composer: EffectComposer;
  readonly playerLight = new THREE.PointLight(0xb8d4ff, 10, 14);
  // One reusable light for muzzle flashes and explosions; adding/removing lights forces shader recompiles.
  private readonly flashLight = new THREE.PointLight(0xffaa55, 0, 18);
  private readonly camLook = new THREE.Vector3();

  constructor() {
    const { renderer, scene, camera } = this;
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    document.body.prepend(renderer.domElement);

    scene.background = new THREE.Color(0x07060d);
    scene.fog = new THREE.Fog(0x07060d, 32, 70);
    scene.add(new THREE.HemisphereLight(0x8899ff, 0x110011, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(-8, 20, 10);
    scene.add(sun, this.playerLight, this.flashLight);

    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // threshold high enough that lit surfaces (the mech's armor) don't bloom; only emissive/glow materials do
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.9, 0.5, 0.72));
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });
  }

  flash(x: number, y: number, z: number, color: number, intensity: number): void {
    this.flashLight.position.set(x, y, z);
    this.flashLight.color.setHex(color);
    this.flashLight.intensity = intensity;
  }

  snapCamera(x: number, z: number): void {
    this.camLook.set(x, 0, z);
  }

  // Follow the target with a slight lead towards where the player is aiming.
  updateCamera(dt: number, target: THREE.Vector3, aim: THREE.Vector3, shake: number): void {
    camTarget.set(target.x + aim.x * 2, 0, target.z + aim.z * 1.5);
    this.camLook.lerp(camTarget, 1 - Math.exp(-6 * Math.max(dt, 1 / 120)));
    this.camera.position.copy(this.camLook).add(CAM_OFFSET);
    if (shake > 0.001) {
      this.camera.position.x += rand(-1, 1) * shake * 0.6;
      this.camera.position.z += rand(-1, 1) * shake * 0.6;
    }
    this.camera.lookAt(this.camLook);
  }

  render(dt: number): void {
    this.flashLight.intensity *= Math.exp(-14 * dt);
    this.composer.render();
  }
}
