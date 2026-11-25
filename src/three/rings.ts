import * as THREE from 'three';

export interface Ring {
  y: number;
  a: number;
  b: number;
  cx?: number;
  cz?: number;
  color?: THREE.Color;
  /** radial multiplier by angle (anatomy bumps) */
  shape?: (theta: number) => number;
}

export const RING_N = 48;

/**
 * Builds a smooth tube through elliptical rings. Faces on the front half (z > 0) go in group 0,
 * the back half in group 1, so front and back pattern pieces can wear different fabrics.
 */
export function ringsGeometry(input: Ring[], opts: { tile?: number; refCirc?: number; N?: number; capTop?: boolean; capBottom?: boolean } = {}): THREE.BufferGeometry {
  const rings = [...input].sort((p, q) => p.y - q.y);
  const N = opts.N ?? RING_N;
  const tile = opts.tile ?? 6;
  const uRep = (opts.refCirc ?? 100) / tile;
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const hasColor = rings.some((r) => r.color);
  const white = new THREE.Color('#ffffff');
  for (const r of rings) {
    for (let j = 0; j <= N; j++) {
      const th = ((j % N) / N) * Math.PI * 2;
      const m = r.shape ? r.shape(th) : 1;
      pos.push((r.cx ?? 0) + r.a * m * Math.cos(th), r.y, (r.cz ?? 0) + r.b * m * Math.sin(th));
      uv.push((j / N) * uRep, r.y / tile);
      if (hasColor) {
        const c = r.color ?? white;
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
      (j < N / 2 ? front : back).push(a, b, c, c, b, d);
    }
  }
  // close the ends with a fan so the tube looks solid
  const addCap = (ri: number, up: boolean) => {
    const r = rings[ri];
    const center = pos.length / 3;
    pos.push(r.cx ?? 0, r.y, r.cz ?? 0);
    uv.push(0, 0);
    if (hasColor) {
      const c = r.color ?? white;
      col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < N; j++) {
      const a = ri * W + j, c = a + 1;
      (j < N / 2 ? front : back).push(...(up ? [a, center, c] : [a, c, center]));
    }
  };
  if (opts.capTop && rings.length) addCap(rings.length - 1, true);
  if (opts.capBottom && rings.length) addCap(0, false);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (hasColor) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex([...front, ...back]);
  g.addGroup(0, front.length, 0);
  g.addGroup(front.length, back.length, 1);
  g.computeVertexNormals();
  // weld normals across the UV seam so there is no visible line down the side
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < rings.length; i++) {
    const a = i * W, z = i * W + N;
    const x = nrm.getX(a) + nrm.getX(z), y = nrm.getY(a) + nrm.getY(z), w = nrm.getZ(a) + nrm.getZ(z);
    const l = Math.hypot(x, y, w) || 1;
    nrm.setXYZ(a, x / l, y / l, w / l);
    nrm.setXYZ(z, x / l, y / l, w / l);
  }
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
