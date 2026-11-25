import * as THREE from 'three';
import { fabricById } from '../data/fabrics';
import { fabricCanvas } from '../lib/textures';

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function fabricMaterial(fab: { id: string; color: number }) {
  const f = fabricById(fab.id);
  const hex = f.colors[fab.color]?.hex ?? f.colors[0].hex;
  const key = f.id + hex;
  let m = matCache.get(key);
  if (!m) {
    const tex = new THREE.CanvasTexture(fabricCanvas(f, hex));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: f.roughness, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

export const stretchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
