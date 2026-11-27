// Meshes the body field into one continuous surface (surface nets on a narrow band), snaps every vertex
// onto the exact implicit surface, and keeps the sampled grid so the cloth can collide with it.

import type { BodyField } from './bodyField';
import type { BodyFrame } from './body';
import { NBONES } from '../sim/pose';
import { chainWeights } from './bodyField';

export interface SDFGrid {
  ox: number; oy: number; oz: number; res: number;
  nx: number; ny: number; nz: number;
  data: Float32Array;
  /** bone that owns the nearest surface (255 = far from the surface) */
  labels?: Uint8Array;
}

export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  skinIndex: Uint16Array;
  skinWeight: Float32Array;
  grid: SDFGrid;
}

export function sampleGrid(g: SDFGrid, x: number, y: number, z: number): number {
  const fx = (x - g.ox) / g.res, fy = (y - g.oy) / g.res, fz = (z - g.oz) / g.res;
  if (fx < 0 || fy < 0 || fz < 0 || fx >= g.nx - 1 || fy >= g.ny - 1 || fz >= g.nz - 1) return 10;
  const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
  const u = fx - i, v = fy - j, w = fz - k;
  const sx = 1, sy = g.nx, sz = g.nx * g.ny;
  const b = i + j * sy + k * sz, d = g.data;
  const c00 = d[b] * (1 - u) + d[b + sx] * u;
  const c10 = d[b + sy] * (1 - u) + d[b + sy + sx] * u;
  const c01 = d[b + sz] * (1 - u) + d[b + sz + sx] * u;
  const c11 = d[b + sz + sy] * (1 - u) + d[b + sz + sy + sx] * u;
  return (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
}

export function gridGrad(g: SDFGrid, x: number, y: number, z: number, out: Float64Array) {
  const e = g.res * 0.5;
  out[0] = (sampleGrid(g, x + e, y, z) - sampleGrid(g, x - e, y, z)) / (2 * e);
  out[1] = (sampleGrid(g, x, y + e, z) - sampleGrid(g, x, y - e, z)) / (2 * e);
  out[2] = (sampleGrid(g, x, y, z + e) - sampleGrid(g, x, y, z - e)) / (2 * e);
}

export function meshField(field: BodyField, res = 0.55): BodyMesh {
  const pad = 4;
  const [x0, y0, z0, x1, y1, z1] = field.box;
  const ox = x0 - pad, oy = Math.max(-2, y0 - pad), oz = z0 - pad;
  const nx = Math.ceil((x1 + pad - ox) / res) + 1;
  const ny = Math.ceil((y1 + pad - oy) / res) + 1;
  const nz = Math.ceil((z1 + pad - oz) / res) + 1;
  const sy = nx, sz = nx * ny;
  const data = new Float32Array(nx * ny * nz);

  // 1. coarse pass
  const C = 4; // coarse step in fine cells
  const cnx = Math.ceil((nx - 1) / C) + 1, cny = Math.ceil((ny - 1) / C) + 1, cnz = Math.ceil((nz - 1) / C) + 1;
  const coarse = new Float32Array(cnx * cny * cnz);
  for (let k = 0; k < cnz; k++) for (let j = 0; j < cny; j++) for (let i = 0; i < cnx; i++) {
    coarse[i + j * cnx + k * cnx * cny] = field.eval(ox + i * C * res, oy + j * C * res, oz + k * C * res, 4);
  }
  // 2. fill fine grid by interpolation, then evaluate exactly near the surface
  const near = new Uint8Array(cnx * cny * cnz);
  const band = C * res * 1.25;
  for (let k = 0; k < cnz - 1; k++) for (let j = 0; j < cny - 1; j++) for (let i = 0; i < cnx - 1; i++) {
    let mn = Infinity;
    for (let c = 0; c < 8; c++) mn = Math.min(mn, Math.abs(coarse[(i + (c & 1)) + (j + ((c >> 1) & 1)) * cnx + (k + (c >> 2)) * cnx * cny]));
    if (mn < band) near[i + j * cnx + k * cnx * cny] = 1;
  }
  const CI = new Int32Array(nx), U = new Float64Array(nx);
  for (let i = 0; i < nx; i++) { CI[i] = Math.min(cnx - 2, Math.floor(i / C)); U[i] = i / C - CI[i]; }
  for (let k = 0; k < nz; k++) {
    const ck = Math.min(cnz - 2, Math.floor(k / C)), w = k / C - ck;
    for (let j = 0; j < ny; j++) {
      const cj = Math.min(cny - 2, Math.floor(j / C)), v = j / C - cj;
      const bjk = cj * cnx + ck * cnx * cny, X = 1, Y = cnx, Z = cnx * cny;
      for (let i = 0; i < nx; i++) {
        const u = U[i];
        const b = CI[i] + bjk;
        const c00 = coarse[b] * (1 - u) + coarse[b + X] * u;
        const c10 = coarse[b + Y] * (1 - u) + coarse[b + Y + X] * u;
        const c01 = coarse[b + Z] * (1 - u) + coarse[b + Z + X] * u;
        const c11 = coarse[b + Z + Y] * (1 - u) + coarse[b + Z + Y + X] * u;
        data[i + j * sy + k * sz] = (c00 * (1 - v) + c10 * v) * (1 - w) + (c01 * (1 - v) + c11 * v) * w;
      }
    }
  }
  const done = new Uint8Array(nx * ny * nz);
  for (let ck = 0; ck < cnz - 1; ck++) for (let cj = 0; cj < cny - 1; cj++) for (let ci = 0; ci < cnx - 1; ci++) {
    if (!near[ci + cj * cnx + ck * cnx * cny]) continue;
    for (let k = ck * C; k <= Math.min(nz - 1, ck * C + C); k++) for (let j = cj * C; j <= Math.min(ny - 1, cj * C + C); j++) for (let i = ci * C; i <= Math.min(nx - 1, ci * C + C); i++) {
      const id = i + j * sy + k * sz;
      if (done[id]) continue;
      done[id] = 1;
      data[id] = field.eval(ox + i * res, oy + j * res, oz + k * res, 2);
    }
  }

  // 3. surface nets: one vertex per cell that the surface passes through
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1);
  const verts: number[] = [];
  const cidx = (i: number, j: number, k: number) => i + j * (nx - 1) + k * (nx - 1) * (ny - 1);
  const EA = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3], EB = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  const cv = new Float32Array(8);
  const CO = new Int32Array(8);
  for (let c = 0; c < 8; c++) CO[c] = (c & 1) + ((c >> 1) & 1) * sy + (c >> 2) * sz;
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) {
    const row = j * sy + k * sz;
    for (let i = 0; i < nx - 1; i++) {
    const base = i + row;
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = data[base + CO[c]];
      cv[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const a = EA[e], b = EB[e];
      if ((cv[a] < 0) === (cv[b] < 0)) continue;
      const t = cv[a] / (cv[a] - cv[b]);
      px += (a & 1) + (((b & 1) - (a & 1)) * t);
      py += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t);
      pz += (a >> 2) + (((b >> 2) - (a >> 2)) * t);
      n++;
    }
    cellVert[cidx(i, j, k)] = verts.length / 3;
    verts.push(ox + (i + px / n) * res, oy + (j + py / n) * res, oz + (k + pz / n) * res);
    }
  }
  const quads: number[] = [];
  const DSTEP = [1, sy, sz];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const id = i + j * sy + k * sz;
    const in0 = data[id] < 0;
    // edges along +x, +y, +z from this grid point
    for (let d = 0; d < 3; d++) {
      if (in0 === (data[id + DSTEP[d]] < 0)) continue;
      // the four cells around this edge
      let c0: number, c1: number, c2: number, c3: number;
      if (d === 0) { c0 = cidx(i, j - 1, k - 1); c1 = cidx(i, j, k - 1); c2 = cidx(i, j, k); c3 = cidx(i, j - 1, k); }
      else if (d === 1) { c0 = cidx(i - 1, j, k - 1); c1 = cidx(i - 1, j, k); c2 = cidx(i, j, k); c3 = cidx(i, j, k - 1); }
      else { c0 = cidx(i - 1, j - 1, k); c1 = cidx(i, j - 1, k); c2 = cidx(i, j, k); c3 = cidx(i - 1, j, k); }
      const q0 = cellVert[c0], q1 = cellVert[c1], q2 = cellVert[c2], q3 = cellVert[c3];
      if (q0 < 0 || q1 < 0 || q2 < 0 || q3 < 0) continue;
      if (in0) quads.push(q0, q1, q2, q3);
      else quads.push(q3, q2, q1, q0);
    }
  }

  const grid: SDFGrid = { ox, oy, oz, res, nx, ny, nz, data };

  // 4. snap vertices onto the exact surface (Newton steps on the analytic field)
  const nv = verts.length / 3;
  const P = new Float32Array(verts);
  const N = new Float32Array(nv * 3);
  const g = new Float64Array(3);
  for (let v = 0; v < nv; v++) {
    let x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    for (let it = 0; it < 3; it++) {
      const d = field.eval(x, y, z, 2);
      gridGrad(grid, x, y, z, g);
      const l2 = g[0] * g[0] + g[1] * g[1] + g[2] * g[2] || 1;
      x -= (d * g[0]) / l2; y -= (d * g[1]) / l2; z -= (d * g[2]) / l2;
      if (Math.abs(d) < 0.002) break;
    }
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    field.grad(x, y, z, g);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    N[v * 3] = g[0] / l; N[v * 3 + 1] = g[1] / l; N[v * 3 + 2] = g[2] / l;
  }

  // bone labels near the surface (for posed collisions) and skin weights per vertex (for animation)
  const labels = new Uint8Array(nx * ny * nz).fill(255);
  // label every voxel within 6 cm of the surface (deep enough to cover a whole limb), sampling on a
  // stride-2 lattice and filling the in-between voxels from their lattice neighbour
  const ST = 2;
  for (let k = 0; k < nz; k += ST) for (let j = 0; j < ny; j += ST) for (let i = 0; i < nx; i += ST) {
    const id = i + j * sy + k * sz;
    if (Math.abs(data[id]) > 6.5) continue;
    const b = field.boneAt(ox + i * res, oy + j * res, oz + k * res);
    for (let dk = 0; dk < ST && k + dk < nz; dk++) for (let dj = 0; dj < ST && j + dj < ny; dj++) for (let di = 0; di < ST && i + di < nx; di++) {
      const id2 = id + di + dj * sy + dk * sz;
      if (Math.abs(data[id2]) <= 6.5) labels[id2] = b;
    }
  }
  // exact labels right at the surface, where it matters most for joints
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const id = i + j * sy + k * sz;
    if (Math.abs(data[id]) > 1.2) continue;
    labels[id] = field.boneAt(ox + i * res, oy + j * res, oz + k * res);
  }
  grid.labels = labels;
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4);
  for (let v = 0; v < nv; v++) {
    const [bi, bw] = field.skin(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
    for (let q = 0; q < bi.length; q++) { skinIndex[v * 4 + q] = bi[q]; skinWeight[v * 4 + q] = bw[q]; }
  }

  // quads -> triangles, split along the shorter diagonal
  const idx = new Uint32Array((quads.length / 4) * 6);
  let o = 0;
  const d2 = (a: number, b: number) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  for (let q = 0; q < quads.length; q += 4) {
    const [a, b, c, d] = [quads[q], quads[q + 1], quads[q + 2], quads[q + 3]];
    if (d2(a, c) < d2(b, d)) { idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = a; idx[o++] = c; idx[o++] = d; }
    else { idx[o++] = a; idx[o++] = b; idx[o++] = d; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
  }
  return { positions: P, normals: N, indices: idx, skinIndex, skinWeight, grid };
}

/** Cloth collider on the sampled body field: works for every part, feet and hands included. */
export class GridCollider {
  thickness = 0.45;
  private g = new Float64Array(3);
  /** height band (legs, ankle to crotch) where contact pushes sideways only, so trousers cannot ratchet down the thighs */
  flat: [number, number] = [-1, -1];
  constructor(public grid: SDFGrid, flat?: [number, number]) {
    if (flat) this.flat = flat;
  }
  project(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number }): boolean {
    out.depth = 0;
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const d = sampleGrid(this.grid, x, y, z);
    if (d >= this.thickness) return false;
    gridGrad(this.grid, x, y, z, this.g);
    const l = Math.hypot(this.g[0], this.g[1], this.g[2]);
    if (l < 1e-6) return false;
    let nx = this.g[0] / l, ny = this.g[1] / l, nz = this.g[2] / l;
    if (y > this.flat[0] && y < this.flat[1]) {
      const hl = Math.hypot(nx, nz);
      if (hl > 0.3) { nx /= hl; nz /= hl; ny = 0; }
    }
    const depth = (this.thickness - d) / l;
    p[i] = x + nx * depth; p[i + 1] = y + ny * depth; p[i + 2] = z + nz * depth;
    out.nx = nx; out.ny = ny; out.nz = nz; out.depth = depth;
    return true;
  }
}

/** chain (0 torso, 1 / 2 arm +x / -x, 3 / 4 leg +x / -x) that each bone belongs to */
const CHAIN_OF = [0, 1, 1, 2, 2, 3, 3, 4, 4, 0, 0];
/** bones whose matrices a chain's skin weights use (see chainWeights) */
const CHAIN_BONES = [[0, 9, 10], [9, 1, 2], [9, 3, 4], [0, 5, 6], [0, 7, 8]];

/**
 * Collider for an animated body. With the body frame and `skinning` on it collides with exactly the surface that is drawn:
 * the display skins the standing body with blended bone matrices (linear blend skinning, chainWeights), so a
 * cloth point is mapped back to the standing body through the same blend (a few fixed point steps), checked
 * against the standing body's distance field there, and pushed out along the skinned surface normal.
 * Otherwise each bone carries its own rigid piece of the standing body (labels only), as the solver uses it.
 */
export class PosedCollider {
  thickness = 0.45;
  flat: [number, number] = [-1, -1];
  /** rounded caps over bending joints; the display check turns them off (they are not drawn) */
  useCaps = true;
  /**
   * collide with the skinned surface exactly as drawn (needs the body frame). The solver keeps the rigid
   * pieces (its tuning and the strain readings rest on them); the display check turns this on.
   */
  skinning = false;
  /**
   * Soft skin (src/sim/softSkin.ts): per cloth particle, how deep the skin under it is pressed in (cm), so the cloth sits
   * in the dent; and, from the solver, how far each particle was pushed out (summed over substeps) and the standing
   * body point it touched, which drive the dent. Null: hard skin.
   */
  soft: { dent: Float32Array; press: Float32Array; q: Float32Array } | null = null;
  /** which cloth particle a query is for when it is not p[i] of the simulation (the display lift); -1 = i / 3 */
  particle = -1;
  M = new Float64Array(NBONES * 12);
  Mprev = new Float64Array(NBONES * 12);
  Minv = new Float64Array(NBONES * 12);
  private g = new Float64Array(3);
  private q = new Float64Array(3);
  private A = new Float64Array(12);
  private Ap = new Float64Array(12);
  private wb = [0, 0, 0];
  private ww = new Float64Array(3);
  private f: BodyFrame | null = null;
  private arm: { jx: number; jy: number; s: number; c: number }[] = [];
  /** rounded caps over bending joints (knees, elbows) so the cloth cannot fall into the gap a bent joint opens */
  private caps: { bone: number; rest: number[]; r: number; pos: number[]; prev: number[] }[] = [];
  constructor(public grid: SDFGrid, flat?: [number, number], f?: BodyFrame) {
    if (flat) this.flat = flat;
    if (f) {
      this.f = f;
      for (const side of [1, -1]) {
        const ang = side * f.armAngle;
        this.arm.push({ jx: side * f.shoulderJoint.x, jy: f.shoulderJoint.y, s: Math.sin(ang), c: Math.cos(ang) });
      }
      for (const side of [1, -1]) {
        const k = side > 0 ? 0 : 1;
        const ua = side * f.armAngle;
        const el = [side * f.shoulderJoint.x + Math.sin(ua) * f.upperArm, f.shoulderJoint.y - Math.cos(ua) * f.upperArm, 0];
        const er = f.armRing(f.upperArm, side);
        this.caps.push({ bone: k === 0 ? 1 : 3, rest: el, r: Math.max(er.a, er.b) * 1.02, pos: [...el], prev: [...el] });
        const kn = [side * f.legX, f.kneeH, 0];
        this.caps.push({ bone: k === 0 ? 5 : 7, rest: kn, r: f.legRing(f.kneeH, side).a * 1.12, pos: [...kn], prev: [...kn] });
      }
    }
    for (let b = 0; b < NBONES; b++) { const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; this.M.set(I, b * 12); this.Mprev.set(I, b * 12); this.Minv.set(I, b * 12); }
  }
  setPose(M: Float64Array, Minv: Float64Array) {
    this.Mprev.set(this.M); this.M.set(M); this.Minv.set(Minv);
    for (const c of this.caps) {
      const o = c.bone * 12, [x, y, z] = c.rest;
      c.prev = c.pos;
      c.pos = [M[o] * x + M[o + 1] * y + M[o + 2] * z + M[o + 3], M[o + 4] * x + M[o + 5] * y + M[o + 6] * z + M[o + 7], M[o + 8] * x + M[o + 9] * y + M[o + 10] * z + M[o + 11]];
    }
  }

  /** blended matrix of chain c at standing body point (x, y, z) into out (and the previous pose into prev) */
  private blend(c: number, x: number, y: number, z: number, out: Float64Array, prev?: Float64Array) {
    const f = this.f!;
    let s = 0;
    if (c === 1 || c === 2) { const a = this.arm[c - 1]; s = (x - a.jx) * a.s - (y - a.jy) * a.c; }
    chainWeights(f, c, y, s, this.wb, this.ww);
    out.fill(0);
    if (prev) prev.fill(0);
    for (let k = 0; k < 3; k++) {
      const w = this.ww[k];
      if (w <= 0) continue;
      const o = this.wb[k] * 12;
      for (let e = 0; e < 12; e++) out[e] += w * this.M[o + e];
      if (prev) for (let e = 0; e < 12; e++) prev[e] += w * this.Mprev[o + e];
    }
  }

  /** solve A r = p for the standing point r (A is a blend of rigid matrices: invertible away from collapse) */
  private solve(A: Float64Array, x: number, y: number, z: number, r: Float64Array) {
    const a = A[0], b = A[1], c = A[2], d = A[4], e = A[5], f = A[6], g = A[8], h = A[9], k = A[10];
    const px = x - A[3], py = y - A[7], pz = z - A[11];
    const det = a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
    if (Math.abs(det) < 1e-4) return false;
    const id = 1 / det;
    r[0] = ((e * k - f * h) * px - (b * k - c * h) * py + (b * f - c * e) * pz) * id;
    r[1] = (-(d * k - f * g) * px + (a * k - c * g) * py - (a * f - c * d) * pz) * id;
    r[2] = ((d * h - e * g) * px - (a * h - b * g) * py + (a * e - b * d) * pz) * id;
    return true;
  }

  /** bit mask of the chains labelled in the 8 voxels round a point (0 when far from the surface) */
  private chainsNear(x: number, y: number, z: number) {
    const G = this.grid, L = G.labels!;
    const fx = (x - G.ox) / G.res, fy = (y - G.oy) / G.res, fz = (z - G.oz) / G.res;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= G.nx - 1 || j >= G.ny - 1 || k >= G.nz - 1) return 0;
    let m = 0;
    for (let c = 0; c < 8; c++) {
      const l = L[(i + (c & 1)) + (j + ((c >> 1) & 1)) * G.nx + (k + (c >> 2)) * G.nx * G.ny];
      if (l !== 255) m |= 1 << CHAIN_OF[l];
    }
    return m;
  }

  private label(x: number, y: number, z: number) {
    const G = this.grid;
    const gi = Math.round((x - G.ox) / G.res), gj = Math.round((y - G.oy) / G.res), gk = Math.round((z - G.oz) / G.res);
    if (gi < 0 || gj < 0 || gk < 0 || gi >= G.nx || gj >= G.ny || gk >= G.nz) return 255;
    return G.labels![gi + gj * G.nx + gk * G.nx * G.ny];
  }

  /**
   * Display only: move a point that is inside the body out along a fixed direction in a bone's standing frame
   * (front leg cloth forward out of the crease between thighs that touch, back leg cloth backward), so
   * neighbouring cloth points all leave on the same side. Returns true when the point was moved.
   */
  escape(p: Float32Array, i: number, bone: number, dx: number, dy: number, dz: number, margin: number, maxDist = 14): boolean {
    const o = bone * 12, Mi = this.Minv, M = this.M, G = this.grid;
    const x = p[i], y = p[i + 1], z = p[i + 2];
    const qx = Mi[o] * x + Mi[o + 1] * y + Mi[o + 2] * z + Mi[o + 3];
    const qy = Mi[o + 4] * x + Mi[o + 5] * y + Mi[o + 6] * z + Mi[o + 7];
    const qz = Mi[o + 8] * x + Mi[o + 9] * y + Mi[o + 10] * z + Mi[o + 11];
    if (sampleGrid(G, qx, qy, qz) >= margin) return false;
    let lo = 0, hi = -1;
    for (let s = 0.4; s <= maxDist; s += 0.4) {
      if (sampleGrid(G, qx + dx * s, qy + dy * s, qz + dz * s) >= margin) { hi = s; break; }
      lo = s;
    }
    if (hi < 0) return false;
    for (let it = 0; it < 4; it++) { const m = (lo + hi) / 2; if (sampleGrid(G, qx + dx * m, qy + dy * m, qz + dz * m) >= margin) hi = m; else lo = m; }
    const rx = qx + dx * hi, ry = qy + dy * hi, rz = qz + dz * hi;
    p[i] = M[o] * rx + M[o + 1] * ry + M[o + 2] * rz + M[o + 3];
    p[i + 1] = M[o + 4] * rx + M[o + 5] * ry + M[o + 6] * rz + M[o + 7];
    p[i + 2] = M[o + 8] * rx + M[o + 9] * ry + M[o + 10] * rz + M[o + 11];
    return true;
  }

  /** collide point i with chain c of the skinned body, starting the inverse skinning at the standing point q */
  /** collide point i with chain c of the skinned body, starting the inverse skinning at the standing point q */
  private skinned(p: Float32Array, i: number, c: number, qx: number, qy: number, qz: number, out: { nx: number; ny: number; nz: number; depth: number; vx?: number; vy?: number; vz?: number }, anyLabel = false): boolean {
    const G = this.grid, r = this.q, A = this.A, Ap = this.Ap;
    const x = p[i], y = p[i + 1], z = p[i + 2];
    // standing point r with blend(r) * r = p: fixed point steps from the rigid guess
    r[0] = qx; r[1] = qy; r[2] = qz;
    let ok = false;
    // most of the body is skinned to a single bone: then the rigid guess is already exact
    this.blend(c, qx, qy, qz, A);
    const ww = this.ww;
    const one = ww[0] > 0.9999 ? 0 : ww[1] > 0.9999 ? 1 : ww[2] > 0.9999 ? 2 : -1;
    if (one >= 0) {
      const o = this.wb[one] * 12, M = this.M;
      const ex = M[o] * qx + M[o + 1] * qy + M[o + 2] * qz + M[o + 3] - x, ey = M[o + 4] * qx + M[o + 5] * qy + M[o + 6] * qz + M[o + 7] - y, ez = M[o + 8] * qx + M[o + 9] * qy + M[o + 10] * qz + M[o + 11] - z;
      if (ex * ex + ey * ey + ez * ez < 1e-6) ok = true;
    }
    for (let it = 0; it < 6 && !ok; it++) {
      this.blend(c, r[0], r[1], r[2], A);
      const ox = r[0], oy = r[1], oz = r[2];
      if (!this.solve(A, x, y, z, r)) break;
      if (Math.abs(r[0] - ox) + Math.abs(r[1] - oy) + Math.abs(r[2] - oz) < 0.01) { ok = true; break; }
    }
    if (!ok) {
      // check the residual of the last step before trusting it
      this.blend(c, r[0], r[1], r[2], A);
      const ex = A[0] * r[0] + A[1] * r[1] + A[2] * r[2] + A[3] - x, ey = A[4] * r[0] + A[5] * r[1] + A[6] * r[2] + A[7] - y, ez = A[8] * r[0] + A[9] * r[1] + A[10] * r[2] + A[11] - z;
      if (ex * ex + ey * ey + ez * ez > 0.04) return false;
    }
    if (!anyLabel && !(this.chainsNear(r[0], r[1], r[2]) & (1 << c))) return false;
    const d = sampleGrid(G, r[0], r[1], r[2]);
    if (d >= this.thickness) return false;
    gridGrad(G, r[0], r[1], r[2], this.g);
    const l = Math.hypot(this.g[0], this.g[1], this.g[2]);
    if (l < 1e-6) return false;
    let nx = this.g[0] / l, ny = this.g[1] / l, nz = this.g[2] / l;
    if (c >= 3 && r[1] > this.flat[0] && r[1] < this.flat[1]) {
      const hl = Math.hypot(nx, nz);
      if (hl > 0.3) { nx /= hl; nz /= hl; ny = 0; }
    }
    const depth = (this.thickness - d) / l;
    const rx = r[0] + nx * depth, ry = r[1] + ny * depth, rz = r[2] + nz * depth;
    this.blend(c, r[0], r[1], r[2], A, Ap);
    const px = A[0] * rx + A[1] * ry + A[2] * rz + A[3], py = A[4] * rx + A[5] * ry + A[6] * rz + A[7], pz = A[8] * rx + A[9] * ry + A[10] * rz + A[11];
    const mx = px - x, my = py - y, mz = pz - z;
    p[i] = px; p[i + 1] = py; p[i + 2] = pz;
    // posed surface normal: the blend carries the standing normal round with the limb
    const tx = A[0] * nx + A[1] * ny + A[2] * nz, ty = A[4] * nx + A[5] * ny + A[6] * nz, tz = A[8] * nx + A[9] * ny + A[10] * nz;
    const tl = Math.hypot(tx, ty, tz) || 1;
    out.nx = tx / tl; out.ny = ty / tl; out.nz = tz / tl;
    out.depth += Math.sqrt(mx * mx + my * my + mz * mz);
    // how far this bit of skin moved this substep (for friction against a moving body)
    out.vx = px - (Ap[0] * rx + Ap[1] * ry + Ap[2] * rz + Ap[3]);
    out.vy = py - (Ap[4] * rx + Ap[5] * ry + Ap[6] * rz + Ap[7]);
    out.vz = pz - (Ap[8] * rx + Ap[9] * ry + Ap[10] * rz + Ap[11]);
    return true;
  }

  project(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number; vx?: number; vy?: number; vz?: number }): boolean {
    const S = this.soft;
    if (!S) return this.project0(p, i, out);
    // soft skin: the surface under this particle is pressed in by its dent
    const k = this.particle >= 0 ? this.particle : i / 3, t = this.thickness, dent = S.dent[k] || 0;
    this.thickness = t - dent;
    const hit = this.project0(p, i, out);
    this.thickness = t;
    if (hit && this.particle < 0 && this.lastHit) {
      S.press[k] += out.depth;
      S.q[k * 3] = this.q[0]; S.q[k * 3 + 1] = this.q[1]; S.q[k * 3 + 2] = this.q[2];
    }
    return hit;
  }

  /** true when the last project0 hit a body surface (not a joint cap); this.q then holds the standing body point */
  private lastHit = false;

  private project0(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number; vx?: number; vy?: number; vz?: number }): boolean {
    out.depth = 0;
    out.vx = 0; out.vy = 0; out.vz = 0;
    this.lastHit = false;
    const G = this.grid;
    let hit = false;
    let done = 0; // chains already handled for this point
    const r = this.q;
    for (let b = 0; b < NBONES; b++) {
      const o = b * 12, Mi = this.Minv;
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const qx = Mi[o] * x + Mi[o + 1] * y + Mi[o + 2] * z + Mi[o + 3];
      const qy = Mi[o + 4] * x + Mi[o + 5] * y + Mi[o + 6] * z + Mi[o + 7];
      const qz = Mi[o + 8] * x + Mi[o + 9] * y + Mi[o + 10] * z + Mi[o + 11];
      const lab = this.label(qx, qy, qz);
      if (lab === 255) continue;
      if (!this.f || !this.skinning) {
        // rigid pieces: this bone's own surface only
        if (lab !== b) continue;
        const d = sampleGrid(G, qx, qy, qz);
        if (d >= this.thickness) continue;
        gridGrad(G, qx, qy, qz, this.g);
        const l = Math.hypot(this.g[0], this.g[1], this.g[2]);
        if (l < 1e-6) continue;
        let nx = this.g[0] / l, ny = this.g[1] / l, nz = this.g[2] / l;
        if ((b >= 5) && qy > this.flat[0] && qy < this.flat[1]) {
          const hl = Math.hypot(nx, nz);
          if (hl > 0.3) { nx /= hl; nz /= hl; ny = 0; }
        }
        const depth = (this.thickness - d) / l;
        r[0] = qx + nx * depth; r[1] = qy + ny * depth; r[2] = qz + nz * depth;
        const M = this.M;
        p[i] = M[o] * r[0] + M[o + 1] * r[1] + M[o + 2] * r[2] + M[o + 3];
        p[i + 1] = M[o + 4] * r[0] + M[o + 5] * r[1] + M[o + 6] * r[2] + M[o + 7];
        p[i + 2] = M[o + 8] * r[0] + M[o + 9] * r[1] + M[o + 10] * r[2] + M[o + 11];
        out.nx = M[o] * nx + M[o + 1] * ny + M[o + 2] * nz;
        out.ny = M[o + 4] * nx + M[o + 5] * ny + M[o + 6] * nz;
        out.nz = M[o + 8] * nx + M[o + 9] * ny + M[o + 10] * nz;
        out.depth += depth;
        this.lastHit = true;
        const Pp = this.Mprev, q0 = r[0], q1 = r[1], q2 = r[2];
        out.vx = p[i] - (Pp[o] * q0 + Pp[o + 1] * q1 + Pp[o + 2] * q2 + Pp[o + 3]);
        out.vy = p[i + 1] - (Pp[o + 4] * q0 + Pp[o + 5] * q1 + Pp[o + 6] * q2 + Pp[o + 7]);
        out.vz = p[i + 2] - (Pp[o + 8] * q0 + Pp[o + 9] * q1 + Pp[o + 10] * q2 + Pp[o + 11]);
        hit = true;
        continue;
      }
      // skinned: every chain of the surface round this bone's view of the point (labels and skin weights may
      // disagree by half a voxel where chains meet, the armpit), each handled once
      let near = this.chainsNear(qx, qy, qz) | (1 << CHAIN_OF[lab]);
      // the seat: where the hip bends far, skin moving with the pelvis lies over voxels labelled thigh, so the
      // pelvis surface is checked there too, without the label test
      const seat = b === 0 && (near & 24) !== 0 && qy > this.f.crotchH - 6 && qy < this.f.hipJointH + 6;
      if (seat) near |= 1;
      for (let c = 0; c < 5; c++) {
        if (!(near & (1 << c)) || (done & (1 << c))) continue;
        const cb = CHAIN_BONES[c];
        if (cb[0] !== b && cb[1] !== b && cb[2] !== b) continue;
        done |= 1 << c;
        if (this.skinned(p, i, c, qx, qy, qz, out, seat && c === 0)) { hit = true; this.lastHit = true; }
      }
    }
    if (this.useCaps) for (const c of this.caps) {
      const dx = p[i] - c.pos[0], dy = p[i + 1] - c.pos[1], dz = p[i + 2] - c.pos[2];
      const d = Math.hypot(dx, dy, dz), R = c.r + this.thickness;
      if (d >= R || d < 1e-6) continue;
      const k = R / d;
      p[i] = c.pos[0] + dx * k; p[i + 1] = c.pos[1] + dy * k; p[i + 2] = c.pos[2] + dz * k;
      out.nx = dx / d; out.ny = dy / d; out.nz = dz / d;
      out.depth += R - d;
      out.vx = c.pos[0] - c.prev[0]; out.vy = c.pos[1] - c.prev[1]; out.vz = c.pos[2] - c.prev[2];
      hit = true;
    }
    return hit;
  }
}
