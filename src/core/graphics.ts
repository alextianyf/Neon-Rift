import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { rand } from './math';

// fairly steep (~70°) so tall objects don't drift far from their footprint on screen
const CAM_OFFSET = new THREE.Vector3(0, 21, 7.5);
const camTarget = new THREE.Vector3();

// Title screen "film" grade: teal shadows / warm highlights, a bit of contrast, vignette,
// slight chromatic fringing toward the edges, and animated grain.
const CinemaShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
    float rand(vec2 c) { return fract(sin(dot(c, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.012 * amount;
      vec3 c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      vec3 graded = mix(c * vec3(0.86, 1.0, 1.08), c * vec3(1.08, 1.0, 0.9), smoothstep(0.05, 0.6, l));
      graded = (graded - 0.5) * 1.08 + 0.5;
      graded *= mix(1.0, 1.0 - smoothstep(0.2, 0.85, r2 * 1.6), 0.75);
      graded += (rand(vUv * 731.0 + time) - 0.5) * 0.045;
      gl_FragColor = vec4(mix(c, max(graded, 0.0), amount), 1.0);
    }`,
};

export class Graphics {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
  readonly composer: EffectComposer;
  readonly playerLight = new THREE.PointLight(0xb8d4ff, 10, 14);
  // One reusable light for muzzle flashes and explosions; adding/removing lights forces shader recompiles.
  private readonly flashLight = new THREE.PointLight(0xffaa55, 0, 18);
  private readonly camLook = new THREE.Vector3();
  // title-screen only: depth of field and the film grade (off during play)
  private readonly bokeh: BokehPass;
  private readonly cinema = new ShaderPass(CinemaShader);

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
    this.bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.00045, maxblur: 0.006 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);
    // threshold high enough that lit surfaces (the mech's armor) don't bloom; only emissive/glow materials do
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.9, 0.5, 0.72));
    this.cinema.enabled = false;
    this.composer.addPass(this.cinema);
    this.composer.addPass(new OutputPass());

    addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
      this.composer.setSize(innerWidth, innerHeight);
    });
  }

  // Film look for the title screen: depth of field focused `focus` units ahead, grade, grain.
  cinematic(on: boolean, focus = 12): void {
    this.bokeh.enabled = this.cinema.enabled = on;
    (this.bokeh.uniforms as Record<string, THREE.IUniform>).focus.value = focus;
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
    if (this.cinema.enabled) this.cinema.uniforms.time.value = (this.cinema.uniforms.time.value + dt) % 100;
    this.composer.render();
  }
}
