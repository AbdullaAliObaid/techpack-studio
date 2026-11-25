import * as THREE from 'three';

export interface Ring {
  y: number;
  a: number;
  b: number;
  cx?: number;
  cz?: number;
  color?: THREE.Color;
}

export const RING_N = 48;

/**
 * Builds a tube through elliptical rings. Faces on the front half (z > 0) go in group 0,
 * the back half in group 1, so front and back pattern pieces can wear different fabrics.
 */
export function ringsGeometry(input: Ring[], opts: { tile?: number; refCirc?: number } = {}): THREE.BufferGeometry {
  const rings = [...input].sort((p, q) => p.y - q.y);
  const N = RING_N;
  const tile = opts.tile ?? 6;
  const uRep = (opts.refCirc ?? 100) / tile;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const hasColor = rings.some((r) => r.color);
  for (const r of rings) {
    for (let j = 0; j <= N; j++) {
      const th = (j / N) * Math.PI * 2;
      pos.push((r.cx ?? 0) + r.a * Math.cos(th), r.y, (r.cz ?? 0) + r.b * Math.sin(th));
      uv.push((j / N) * uRep, r.y / tile);
      if (hasColor) {
        const c = r.color ?? new THREE.Color('#ffffff');
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const front: number[] = [];
  const back: number[] = [];
  const W = N + 1;
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * W + j, c = a + 1, b = a + W, d = b + 1;
      const target = j < N / 2 ? front : back;
      target.push(a, b, c, c, b, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex([...front, ...back]);
  g.addGroup(0, front.length, 0);
  g.addGroup(front.length, back.length, 1);
  g.computeVertexNormals();
  return g;
}

const STOPS: [number, string][] = [
  [0, '#2f6fdf'],
  [0.35, '#1fb5c9'],
  [0.6, '#f2c419'],
  [0.85, '#f97316'],
  [1, '#dc2626'],
  [1.5, '#7a1414'],
];

/** ratio = strain / fabric safe stretch. <= 0 relaxed (blue), 1 at the limit (red), beyond that deep red. */
export function riskColor(ratio: number): THREE.Color {
  if (ratio <= 0) return new THREE.Color('#4a86ec');
  for (let i = 0; i + 1 < STOPS.length; i++) {
    const [r1, c1] = STOPS[i];
    const [r2, c2] = STOPS[i + 1];
    if (ratio <= r2) return new THREE.Color(c1).lerp(new THREE.Color(c2), (ratio - r1) / (r2 - r1));
  }
  return new THREE.Color(STOPS[STOPS.length - 1][1]);
}
