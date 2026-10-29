import * as THREE from 'three';

// Geometries shared by every instance; never dispose these.
export const GEO = {
  particle: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(1, 10, 8),
  ring: new THREE.RingGeometry(0.7, 0.95, 28),
  orb: new THREE.OctahedronGeometry(0.32),
};

export const WHITE = new THREE.Color(0xffffff);

const glowCache = new Map<string, THREE.MeshBasicMaterial>();

// Unlit material with an over-bright color so it shows up in the bloom pass. Cached and shared.
export function glowMat(hex: number, k = 2.5): THREE.MeshBasicMaterial {
  const key = `${hex}:${k}`;
  let mat = glowCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) });
    glowCache.set(key, mat);
  }
  return mat;
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}
