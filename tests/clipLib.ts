// Helpers for tests/clip.ts: the skinned body mesh as drawn, and point to mesh distances.
import type { BodyMesh } from '../src/three/mesher';

// ---------------------------------------------------------------------------------------------
// skinned body mesh + signed distance (nearest triangle, sign from the interpolated normal)
// ---------------------------------------------------------------------------------------------
export class PosedBody {
  P: Float32Array; // posed positions
  N: Float32Array; // posed vertex normals (outward)
  idx: Uint32Array;
  private cell = 1.5;
  private map = new Map<number, number[]>();
  constructor(mesh: Pick<BodyMesh, 'positions' | 'normals' | 'indices' | 'skinIndex' | 'skinWeight'>, M: Float64Array) {
    const R = mesh.positions, nv = R.length / 3;
    this.idx = mesh.indices;
    const P = (this.P = new Float32Array(R.length));
    for (let v = 0; v < nv; v++) {
      const x = R[v * 3], y = R[v * 3 + 1], z = R[v * 3 + 2];
      let px = 0, py = 0, pz = 0;
      for (let q = 0; q < 4; q++) {
        const w = mesh.skinWeight[v * 4 + q];
        if (!w) continue;
        const o = mesh.skinIndex[v * 4 + q] * 12;
        px += w * (M[o] * x + M[o + 1] * y + M[o + 2] * z + M[o + 3]);
        py += w * (M[o + 4] * x + M[o + 5] * y + M[o + 6] * z + M[o + 7]);
        pz += w * (M[o + 8] * x + M[o + 9] * y + M[o + 10] * z + M[o + 11]);
      }
      P[v * 3] = px; P[v * 3 + 1] = py; P[v * 3 + 2] = pz;
    }
    // area weighted vertex normals, oriented like the rest normals (the field gradient points outward)
    const N = (this.N = new Float32Array(R.length));
    const I = this.idx;
    let agree = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
      const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) { N[k] += nx; N[k + 1] += ny; N[k + 2] += nz; }
    }
    for (let v = 0; v < nv; v++) agree += N[v * 3] * mesh.normals[v * 3] + N[v * 3 + 1] * mesh.normals[v * 3 + 1] + N[v * 3 + 2] * mesh.normals[v * 3 + 2] > 0 ? 1 : -1;
    const s = agree >= 0 ? 1 : -1;
    for (let v = 0; v < nv; v++) {
      const l = Math.hypot(N[v * 3], N[v * 3 + 1], N[v * 3 + 2]) || 1;
      N[v * 3] *= s / l; N[v * 3 + 1] *= s / l; N[v * 3 + 2] *= s / l;
    }
    const C = this.cell;
    for (let t = 0; t < I.length; t += 3) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let e = 0; e < 3; e++) {
        const k = I[t + e] * 3;
        x0 = Math.min(x0, P[k]); x1 = Math.max(x1, P[k]); y0 = Math.min(y0, P[k + 1]); y1 = Math.max(y1, P[k + 1]); z0 = Math.min(z0, P[k + 2]); z1 = Math.max(z1, P[k + 2]);
      }
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(y0 / C); j <= Math.floor(y1 / C); j++) for (let k = Math.floor(z0 / C); k <= Math.floor(z1 / C); k++) {
        const h = this.key(i, j, k);
        let l = this.map.get(h);
        if (!l) this.map.set(h, (l = []));
        l.push(t);
      }
    }
  }
  private key(i: number, j: number, k: number) { return ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512); }

  /** signed distance (cm, negative inside) and the outward normal at the nearest surface point; NaN far from the body */
  signed(x: number, y: number, z: number, out?: { nx: number; ny: number; nz: number }, maxR = 6): number {
    const C = this.cell, ci = Math.floor(x / C), cj = Math.floor(y / C), ck = Math.floor(z / C);
    let best = Infinity, bt = -1, bu = 0, bv = 0, bw = 0;
    const seen = new Set<number>();
    for (let ring = 1; ring <= Math.ceil(maxR / C); ring++) {
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) for (let k = ck - ring; k <= ck + ring; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== ring && ring > 1) continue;
        const l = this.map.get(this.key(i, j, k));
        if (!l) continue;
        for (const t of l) {
          if (seen.has(t)) continue;
          seen.add(t);
          const r = closestOnTri(this.P, this.idx[t] * 3, this.idx[t + 1] * 3, this.idx[t + 2] * 3, x, y, z);
          if (r.d2 < best) { best = r.d2; bt = t; bu = r.u; bv = r.v; bw = r.w; }
        }
      }
      // anything in a further ring is at least (ring) cells away
      if (bt >= 0 && Math.sqrt(best) <= ring * C) break;
    }
    if (bt < 0) return NaN;
    const N = this.N, a = this.idx[bt] * 3, b = this.idx[bt + 1] * 3, c = this.idx[bt + 2] * 3;
    const nx = N[a] * bu + N[b] * bv + N[c] * bw, ny = N[a + 1] * bu + N[b + 1] * bv + N[c + 1] * bw, nz = N[a + 2] * bu + N[b + 2] * bv + N[c + 2] * bw;
    const P = this.P;
    const qx = P[a] * bu + P[b] * bv + P[c] * bw, qy = P[a + 1] * bu + P[b + 1] * bv + P[c + 1] * bw, qz = P[a + 2] * bu + P[b + 2] * bv + P[c + 2] * bw;
    const s = (x - qx) * nx + (y - qy) * ny + (z - qz) * nz;
    if (out) { const l = Math.hypot(nx, ny, nz) || 1; out.nx = nx / l; out.ny = ny / l; out.nz = nz / l; }
    return (s >= 0 ? 1 : -1) * Math.sqrt(best);
  }
}

/** closest point on triangle (Ericson), barycentric u, v, w for corners a, b, c */
export function closestOnTri(P: ArrayLike<number>, a: number, b: number, c: number, px: number, py: number, pz: number) {
  const abx = P[b] - P[a], aby = P[b + 1] - P[a + 1], abz = P[b + 2] - P[a + 2];
  const acx = P[c] - P[a], acy = P[c + 1] - P[a + 1], acz = P[c + 2] - P[a + 2];
  const apx = px - P[a], apy = py - P[a + 1], apz = pz - P[a + 2];
  const res = (u: number, v: number, w: number) => {
    const qx = P[a] * u + P[b] * v + P[c] * w, qy = P[a + 1] * u + P[b + 1] * v + P[c + 1] * w, qz = P[a + 2] * u + P[b + 2] * v + P[c + 2] * w;
    return { u, v, w, d2: (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2 };
  };
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return res(1, 0, 0);
  const bpx = px - P[b], bpy = py - P[b + 1], bpz = pz - P[b + 2];
  const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return res(0, 1, 0);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return res(1 - v, v, 0); }
  const cpx = px - P[c], cpy = py - P[c + 1], cpz = pz - P[c + 2];
  const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return res(0, 0, 1);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return res(1 - w, 0, w); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return res(0, 1 - w, w); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return res(1 - v - w, v, w);
}

