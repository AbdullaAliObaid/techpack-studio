// Meshes the body field into one continuous surface (surface nets on a narrow band), snaps every vertex
// onto the exact implicit surface, and keeps the sampled grid so the cloth can collide with it.

import type { BodyField } from './bodyField';

export interface SDFGrid {
  ox: number; oy: number; oz: number; res: number;
  nx: number; ny: number; nz: number;
  data: Float32Array;
}

export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
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

  // quads -> triangles, split along the shorter diagonal
  const idx = new Uint32Array((quads.length / 4) * 6);
  let o = 0;
  const d2 = (a: number, b: number) => (P[a * 3] - P[b * 3]) ** 2 + (P[a * 3 + 1] - P[b * 3 + 1]) ** 2 + (P[a * 3 + 2] - P[b * 3 + 2]) ** 2;
  for (let q = 0; q < quads.length; q += 4) {
    const [a, b, c, d] = [quads[q], quads[q + 1], quads[q + 2], quads[q + 3]];
    if (d2(a, c) < d2(b, d)) { idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = a; idx[o++] = c; idx[o++] = d; }
    else { idx[o++] = a; idx[o++] = b; idx[o++] = d; idx[o++] = b; idx[o++] = c; idx[o++] = d; }
  }
  return { positions: P, normals: N, indices: idx, grid };
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
