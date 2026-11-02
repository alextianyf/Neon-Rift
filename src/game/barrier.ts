import * as THREE from 'three';
import { glowMat } from '../core/assets';

// Bastion's "电磁屏障" made visible: an energy dome with bright edges and scan bands scrolling up,
// two tilted rings orbiting the mech, a pulsing ring on the ground. It pops in when cast and
// flickers through the last second as a warning. Attached to the player's mesh (follows it).

export const BARRIER = {
  duration: 4.5,
  radius: 1.9,     // dome radius in world units; enemy shots that reach it are stopped
  height: 1.2,     // dome center above the ground
  warn: 1,         // seconds of flicker before it drops
};

const DOME_SHADER = {
  vertexShader: `varying vec3 vN; varying vec3 vV; varying float vY;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = normalize(-mv.xyz);
      vY = position.y;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `uniform vec3 color; uniform float time; uniform float alpha; varying vec3 vN; varying vec3 vV; varying float vY;
    void main() {
      float rim = pow(1.0 - clamp(abs(dot(vN, vV)), 0.0, 1.0), 2.2);
      float bands = smoothstep(0.82, 1.0, sin(vY * 14.0 - time * 5.0));
      float a = (0.02 + rim * 0.55 + bands * 0.12 * (0.3 + rim)) * alpha;
      gl_FragColor = vec4(color * (0.6 + rim), clamp(a, 0.0, 1.0));
    }`,
};

export class BarrierFx {
  readonly group = new THREE.Group();
  private readonly dome: THREE.Mesh;
  private readonly domeMat: THREE.ShaderMaterial;
  private readonly rings: THREE.Mesh[] = [];
  private readonly floor: THREE.Mesh;
  private readonly floorMat: THREE.MeshBasicMaterial;
  private age = 0;

  constructor(color = 0x66ccff) {
    this.domeMat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(color).multiplyScalar(0.8) }, time: { value: 0 }, alpha: { value: 1 } },
      vertexShader: DOME_SHADER.vertexShader, fragmentShader: DOME_SHADER.fragmentShader,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), this.domeMat);
    this.dome.position.y = BARRIER.height;
    for (const [tilt, r] of [[0.5, 1.15], [-0.7, 1.05]] as const) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(BARRIER.radius * r, 0.03, 8, 64), glowMat(color, 1.8));
      ring.rotation.x = Math.PI / 2 + tilt;
      ring.position.y = BARRIER.height;
      this.rings.push(ring);
    }
    this.floorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.1), transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.floor = new THREE.Mesh(new THREE.RingGeometry(BARRIER.radius * 0.92, BARRIER.radius * 1.02, 64), this.floorMat);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0.05;
    this.group.add(this.dome, ...this.rings, this.floor);
    this.group.visible = false;
  }

  // `left`: seconds of barrier remaining (0 hides it).
  update(dt: number, left: number): void {
    if (left <= 0) { this.group.visible = false; this.age = 0; return; }
    this.group.visible = true;
    this.age += dt;
    const pop = Math.min(1, this.age / 0.15);
    const s = BARRIER.radius * (pop < 1 ? 1.25 - 0.25 * pop : 1);  // overshoots, then settles
    this.dome.scale.setScalar(s);
    // flicker while it's running out
    const fade = left < BARRIER.warn ? (Math.sin(this.age * 30) > -0.2 ? 0.9 : 0.25) : 1;
    this.domeMat.uniforms.time.value = this.age;
    this.domeMat.uniforms.alpha.value = pop * fade;
    this.rings[0].rotation.z += dt * 2.2;
    this.rings[1].rotation.z -= dt * 1.6;
    this.rings[0].rotation.y = Math.sin(this.age * 1.3) * 0.25;
    for (const r of this.rings) r.visible = fade > 0.5;
    this.floorMat.opacity = (0.4 + Math.sin(this.age * 6) * 0.2) * fade;
    this.floor.scale.setScalar(1 + Math.sin(this.age * 6) * 0.03);
  }
}
