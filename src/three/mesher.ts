// Meshes the body field into one continuous surface (surface nets on a narrow band), snaps every vertex
// onto the exact implicit surface, and keeps the sampled grid so the cloth can collide with it.

import type { BodyField } from './bodyField';
import type { BodyFrame } from './body';
import { NBONES } from '../sim/pose';

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
  for (let k = 0; k < nz; k++) {
    const ck = Math.min(cnz - 2, Math.floor(k / C)), w = k / C - ck;
    for (let j = 0; j < ny; j++) {
      const cj = Math.min(cny - 2, Math.floor(j / C)), v = j / C - cj;
      for (let i = 0; i < nx; i++) {
        const ci = Math.min(cnx - 2, Math.floor(i / C)), u = i / C - ci;
        const b = ci + cj * cnx + ck * cnx * cny, X = 1, Y = cnx, Z = cnx * cny;
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
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const v = data[(i + (c & 1)) + (j + ((c >> 1) & 1)) * sy + (k + (c >> 2)) * sz];
      cv[c] = v;
      if (v < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let px = 0, py = 0, pz = 0, n = 0;
    for (const [a, b] of E) {
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
  const quads: number[] = [];
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const v0 = data[i + j * sy + k * sz];
    // edges along +x, +y, +z from this grid point
    const dirs: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (const [dx, dy, dz] of dirs) {
      const v1 = data[(i + dx) + (j + dy) * sy + (k + dz) * sz];
      if ((v0 < 0) === (v1 < 0)) continue;
      // the four cells around this edge
      let c: number[];
      if (dx) c = [cidx(i, j - 1, k - 1), cidx(i, j, k - 1), cidx(i, j, k), cidx(i, j - 1, k)];
      else if (dy) c = [cidx(i - 1, j, k - 1), cidx(i - 1, j, k), cidx(i, j, k), cidx(i, j, k - 1)];
      else c = [cidx(i - 1, j - 1, k), cidx(i, j - 1, k), cidx(i, j, k), cidx(i - 1, j, k)];
      const q = c.map((x) => cellVert[x]);
      if (q.some((x) => x < 0)) continue;
      if (v0 < 0) quads.push(q[0], q[1], q[2], q[3]);
      else quads.push(q[3], q[2], q[1], q[0]);
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

/**
 * Collider for an animated body: each bone carries its own piece of the standing body. A cloth point is
 * taken back into each bone's standing frame, checked against that bone's surface only, and moved forward again.
 */
export class PosedCollider {
  thickness = 0.45;
  flat: [number, number] = [-1, -1];
  M = new Float64Array(NBONES * 12);
  Mprev = new Float64Array(NBONES * 12);
  Minv = new Float64Array(NBONES * 12);
  private g = new Float64Array(3);
  private q = new Float64Array(3);
  /** rounded caps over bending joints (knees, elbows) so the cloth cannot fall into the gap a bent joint opens */
  private caps: { bone: number; rest: number[]; r: number; pos: number[]; prev: number[] }[] = [];
  constructor(public grid: SDFGrid, flat?: [number, number], f?: BodyFrame) {
    if (flat) this.flat = flat;
    if (f) {
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

  project(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number; vx?: number; vy?: number; vz?: number }): boolean {
    out.depth = 0;
    out.vx = 0; out.vy = 0; out.vz = 0;
    const G = this.grid, L = G.labels!;
    let hit = false;
    for (let b = 0; b < NBONES; b++) {
      const o = b * 12, Mi = this.Minv;
      const x = p[i], y = p[i + 1], z = p[i + 2];
      const qx = Mi[o] * x + Mi[o + 1] * y + Mi[o + 2] * z + Mi[o + 3];
      const qy = Mi[o + 4] * x + Mi[o + 5] * y + Mi[o + 6] * z + Mi[o + 7];
      const qz = Mi[o + 8] * x + Mi[o + 9] * y + Mi[o + 10] * z + Mi[o + 11];
      const gi = Math.round((qx - G.ox) / G.res), gj = Math.round((qy - G.oy) / G.res), gk = Math.round((qz - G.oz) / G.res);
      if (gi < 0 || gj < 0 || gk < 0 || gi >= G.nx || gj >= G.ny || gk >= G.nz) continue;
      if (L[gi + gj * G.nx + gk * G.nx * G.ny] !== b) continue;
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
      this.q[0] = qx + nx * depth; this.q[1] = qy + ny * depth; this.q[2] = qz + nz * depth;
      const M = this.M;
      p[i] = M[o] * this.q[0] + M[o + 1] * this.q[1] + M[o + 2] * this.q[2] + M[o + 3];
      p[i + 1] = M[o + 4] * this.q[0] + M[o + 5] * this.q[1] + M[o + 6] * this.q[2] + M[o + 7];
      p[i + 2] = M[o + 8] * this.q[0] + M[o + 9] * this.q[1] + M[o + 10] * this.q[2] + M[o + 11];
      out.nx = M[o] * nx + M[o + 1] * ny + M[o + 2] * nz;
      out.ny = M[o + 4] * nx + M[o + 5] * ny + M[o + 6] * nz;
      out.nz = M[o + 8] * nx + M[o + 9] * ny + M[o + 10] * nz;
      out.depth += depth;
      // how far this bit of skin moved this substep (for friction against a moving body)
      const Pp = this.Mprev, q0 = this.q[0], q1 = this.q[1], q2 = this.q[2];
      out.vx = p[i] - (Pp[o] * q0 + Pp[o + 1] * q1 + Pp[o + 2] * q2 + Pp[o + 3]);
      out.vy = p[i + 1] - (Pp[o + 4] * q0 + Pp[o + 5] * q1 + Pp[o + 6] * q2 + Pp[o + 7]);
      out.vz = p[i + 2] - (Pp[o + 8] * q0 + Pp[o + 9] * q1 + Pp[o + 10] * q2 + Pp[o + 11]);
      hit = true;
    }
    for (const c of this.caps) {
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
