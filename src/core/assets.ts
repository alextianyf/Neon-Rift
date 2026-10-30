import * as THREE from 'three';

// Resources reused across many objects; disposeTree() leaves these alone.
const shared = new WeakSet<object>();

export function markShared<T extends object>(resource: T): T {
  shared.add(resource);
  return resource;
}

export const GEO = {
  particle: markShared(new THREE.BoxGeometry(1, 1, 1)),
  sphere: markShared(new THREE.SphereGeometry(1, 10, 8)),
  ring: markShared(new THREE.RingGeometry(0.7, 0.95, 28)),
  orb: markShared(new THREE.OctahedronGeometry(0.32)),
};

export const WHITE = new THREE.Color(0xffffff);

const glowCache = new Map<string, THREE.MeshBasicMaterial>();

// Unlit material with an over-bright color so it shows up in the bloom pass. Cached and shared.
export function glowMat(hex: number, k = 2.5): THREE.MeshBasicMaterial {
  const key = `${hex}:${k}`;
  let mat = glowCache.get(key);
  if (!mat) {
    mat = markShared(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }));
    glowCache.set(key, mat);
  }
  return mat;
}

// Free the GPU resources owned by an object tree, skipping shared ones.
export function disposeTree(root: THREE.Object3D): void {
  root.traverse(o => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      if (!shared.has(o.geometry)) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!shared.has(m)) m.dispose();
    }
  });
}
