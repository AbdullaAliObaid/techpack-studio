// Cloth solver: XPBD with "small steps" (many substeps, one constraint pass each), which is stable
// and fast enough for real time in the browser. Units: cm, seconds.
//
// Constraints
//   stretch: every mesh edge keeps its 2D pattern length (so the cloth is exactly the drawn size)
//   bend:    the two vertices across each interior edge keep their flat distance (fabric stiffness)
//   sew:     seam vertices on two pieces are pulled together (zero length), like CLO's sewing lines


export interface ClothParams {
  sewCompliance: number;
  friction: number;
  damping: number;
}

export class ClothSim {
  n: number;
  pos: Float32Array;
  prev: Float32Array;
  vel: Float32Array;
  invMass: Float32Array;
  // constraint storage: pairs + rest + compliance index
  ca: Uint32Array;
  cb: Uint32Array;
  rest: Float32Array;
  comp: Float32Array;
  /** max strain per stretch edge before it is clamped (strain limiting) */
  maxStrain: Float32Array;
  limitPasses = 3;
  nStretch: number;
  gravity = -981;
  substeps = 10;
  staticFriction = 1.0;
  maxMove = 1.2; // cm per substep, keeps early sewing from exploding
  collider: { project(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number }): boolean } | null = null;
  // self collision
  selfRadius = 0;
  panelOf: Uint16Array | null = null;
  uv: Float32Array | null = null; // 2D pattern coords, to skip neighbours on the same piece
  seamGroup: Int32Array | null = null; // vertices sewn together share a group
  nearSeam: Uint8Array | null = null; // within a few cm of a seam on its own piece
  private hashStart = new Int32Array(0);
  private hashItems = new Int32Array(0);
  params: ClothParams;
  sleeping = false;
  frames = 0;
  /** frames of the sewing phase: low gravity, no friction, so seams can close before the cloth settles */
  sewFrames = 45;

  /** stretch / bend entries: [a, b, rest, compliance] */
  constructor(n: number, stretch: [number, number, number, number][], bend: [number, number, number, number][], sew: [number, number][], params: ClothParams) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.invMass = new Float32Array(n).fill(1);
    const m = stretch.length + bend.length + sew.length;
    this.ca = new Uint32Array(m);
    this.cb = new Uint32Array(m);
    this.rest = new Float32Array(m);
    this.comp = new Float32Array(m);
    this.params = params;
    let k = 0;
    this.maxStrain = new Float32Array(stretch.length).fill(0.1);
    for (const [a, b, r, c] of stretch) { this.ca[k] = a; this.cb[k] = b; this.rest[k] = r; this.comp[k++] = c; }
    this.nStretch = k;
    for (const [a, b, r, c] of bend) { this.ca[k] = a; this.cb[k] = b; this.rest[k] = r; this.comp[k++] = c; }
    for (const [a, b] of sew) { this.ca[k] = a; this.cb[k] = b; this.rest[k] = 0; this.comp[k++] = params.sewCompliance; }
  }

  step(dt = 1 / 60) {
    if (this.sleeping) return;
    const h = dt / this.substeps;
    const { pos, prev, vel, invMass, ca, cb, rest, comp } = this;
    const n = this.n;
    const h2 = h * h;
    const damp = Math.pow(this.params.damping, 1 / this.substeps);
    const nrm = { nx: 0, ny: 0, nz: 0, depth: 0 };
    const sewing = this.frames < this.sewFrames;
    const fr = sewing ? 0 : this.params.friction;
    const grav = sewing ? 0 : this.gravity;
    const sfr = sewing ? 0 : this.staticFriction;
    let maxV = 0;
    for (let s = 0; s < this.substeps; s++) {
      for (let i = 0; i < n; i++) {
        if (!invMass[i]) continue;
        const j = i * 3;
        vel[j + 1] += grav * h;
        prev[j] = pos[j]; prev[j + 1] = pos[j + 1]; prev[j + 2] = pos[j + 2];
        pos[j] += vel[j] * h; pos[j + 1] += vel[j + 1] * h; pos[j + 2] += vel[j + 2] * h;
      }
      // one Gauss-Seidel pass over all constraints
      for (let c = 0; c < ca.length; c++) {
        const a = ca[c] * 3, b = cb[c] * 3;
        const wa = invMass[ca[c]], wb = invMass[cb[c]];
        const w = wa + wb;
        if (!w) continue;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const C = L - rest[c];
        if (L < 1e-7) continue;
        let lam = -C / (w + comp[c] / h2);
        if (lam > this.maxMove) lam = this.maxMove; else if (lam < -this.maxMove) lam = -this.maxMove;
        const ix = (dx / L) * lam, iy = (dy / L) * lam, iz = (dz / L) * lam;
        pos[a] -= ix * wa; pos[a + 1] -= iy * wa; pos[a + 2] -= iz * wa;
        pos[b] += ix * wb; pos[b + 1] += iy * wb; pos[b + 2] += iz * wb;
      }
      // strain limiting: fabric can only stretch so far, clamp edges past their limit
      for (let it = 0; it < this.limitPasses; it++) {
        const ms = this.maxStrain;
        for (let c = 0; c < this.nStretch; c++) {
          const a = ca[c] * 3, b = cb[c] * 3;
          const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
          const L2 = dx * dx + dy * dy + dz * dz;
          const Lmax = rest[c] * (1 + ms[c]);
          if (L2 <= Lmax * Lmax) continue;
          const L = Math.sqrt(L2);
          const corr = (L - Lmax) / L / 2;
          pos[a] += dx * corr; pos[a + 1] += dy * corr; pos[a + 2] += dz * corr;
          pos[b] -= dx * corr; pos[b + 1] -= dy * corr; pos[b + 2] -= dz * corr;
        }
      }
      if (this.selfRadius > 0 && (s & 1) === 1) this.selfCollide();
      // body collision with friction
      if (this.collider) {
        for (let i = 0; i < n; i++) {
          const j = i * 3;
          if (pos[j + 1] < 0.3) {
            // floor: cloth piles up instead of sinking
            pos[j + 1] = 0.3;
            pos[j] = prev[j] + (pos[j] - prev[j]) * 0.2;
            pos[j + 2] = prev[j + 2] + (pos[j + 2] - prev[j + 2]) * 0.2;
          }
          if (this.collider.project(pos, j, nrm)) {
            const mx = pos[j] - prev[j], my = pos[j + 1] - prev[j + 1], mz = pos[j + 2] - prev[j + 2];
            const dn = mx * nrm.nx + my * nrm.ny + mz * nrm.nz;
            const tx = mx - dn * nrm.nx, ty = my - dn * nrm.ny, tz = mz - dn * nrm.nz;
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            // position based friction: stick if the slide is small compared with the contact push
            const k = tl < sfr * nrm.depth ? 1 : Math.min(1, (fr * nrm.depth) / (tl || 1));
            pos[j] -= tx * k; pos[j + 1] -= ty * k; pos[j + 2] -= tz * k;
          }
        }
      }
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        vel[j] = ((pos[j] - prev[j]) / h) * damp;
        vel[j + 1] = ((pos[j + 1] - prev[j + 1]) / h) * damp;
        vel[j + 2] = ((pos[j + 2] - prev[j + 2]) / h) * damp;
        if (s === this.substeps - 1) maxV = Math.max(maxV, Math.abs(vel[j]) + Math.abs(vel[j + 1]) + Math.abs(vel[j + 2]));
      }
    }
    this.frames++;
    if (this.frames > this.sewFrames + 60 && maxV < 1.5) this.sleeping = true;
    if (this.frames > this.sewFrames + 330) this.sleeping = true;
    return maxV;
  }

  /** Keep cloth layers from passing through each other: particles closer than selfRadius are pushed apart. */
  private selfCollide() {
    const { pos, n, panelOf, uv, seamGroup, invMass } = this;
    const r = this.selfRadius, r2 = r * r, skip2 = (r * 4) ** 2;
    const T = 1 << 15;
    if (this.hashStart.length !== T + 1) { this.hashStart = new Int32Array(T + 1); this.hashItems = new Int32Array(n); }
    if (this.hashItems.length !== n) this.hashItems = new Int32Array(n);
    const start = this.hashStart.fill(0), items = this.hashItems;
    const key = (x: number, y: number, z: number) => ((Math.floor(x / r) * 92837111) ^ (Math.floor(y / r) * 689287499) ^ (Math.floor(z / r) * 283923481)) & (T - 1);
    const keys = new Int32Array(n);
    for (let i = 0; i < n; i++) { keys[i] = key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); start[keys[i]]++; }
    let acc = 0;
    for (let c = 0; c <= T; c++) { const v = start[c]; start[c] = acc; acc += c < T ? v : 0; }
    start[T] = n;
    const fill = new Int32Array(T);
    for (let i = 0; i < n; i++) items[start[keys[i]] + fill[keys[i]]++] = i;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const cx = Math.floor(x / r), cy = Math.floor(y / r), cz = Math.floor(z / r);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const h = (((cx + dx) * 92837111) ^ ((cy + dy) * 689287499) ^ ((cz + dz) * 283923481)) & (T - 1);
        const end = h + 1 < T ? start[h + 1] : n;
        for (let q = start[h]; q < end; q++) {
          const j = items[q];
          if (j <= i) continue;
          const ex = pos[j * 3] - x, ey = pos[j * 3 + 1] - y, ez = pos[j * 3 + 2] - z;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 >= r2 || d2 < 1e-10) continue;
          if (seamGroup && seamGroup[i] === seamGroup[j]) continue;
          if (this.nearSeam && this.nearSeam[i] && this.nearSeam[j] && panelOf && panelOf[i] !== panelOf[j]) continue; // the two sides of a seam
          if (panelOf && uv && panelOf[i] === panelOf[j]) {
            const du = uv[i * 2] - uv[j * 2], dv = uv[i * 2 + 1] - uv[j * 2 + 1];
            if (du * du + dv * dv < skip2) continue; // neighbours on the same piece
          }
          const d = Math.sqrt(d2), w = invMass[i] + invMass[j];
          const c = (r - d) / d / w;
          pos[i * 3] -= ex * c * invMass[i]; pos[i * 3 + 1] -= ey * c * invMass[i]; pos[i * 3 + 2] -= ez * c * invMass[i];
          pos[j * 3] += ex * c * invMass[j]; pos[j * 3 + 1] += ey * c * invMass[j]; pos[j * 3 + 2] += ez * c * invMass[j];
        }
      }
    }
  }

  /** Per-vertex stretch: average over incident edges of (length / rest - 1), compression ignored, then smoothed. */
  strain(out: Float32Array) {
    const { pos, ca, cb, rest, n } = this;
    const sum = new Float32Array(n), cnt = new Float32Array(n);
    for (let c = 0; c < this.nStretch; c++) {
      const a = ca[c] * 3, b = cb[c] * 3;
      const L = Math.hypot(pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]);
      const e = Math.max(0, L / rest[c] - 1);
      sum[ca[c]] += e; sum[cb[c]] += e; cnt[ca[c]]++; cnt[cb[c]]++;
    }
    for (let i = 0; i < n; i++) out[i] = cnt[i] ? sum[i] / cnt[i] : 0;
    // one smoothing pass over the mesh neighbourhood
    sum.fill(0); cnt.fill(0);
    for (let c = 0; c < this.nStretch; c++) {
      const a = ca[c], b = cb[c];
      sum[a] += out[b]; cnt[a]++; sum[b] += out[a]; cnt[b]++;
    }
    for (let i = 0; i < n; i++) out[i] = cnt[i] ? (out[i] + sum[i] / cnt[i]) / 2 : out[i];
  }

  /** Display copy with stitched seams closed exactly. */
  display(out: Float32Array) {
    out.set(this.pos);
    const { ca, cb, rest } = this;
    for (let c = this.nStretch; c < ca.length; c++) {
      if (rest[c] !== 0) continue;
      const a = ca[c] * 3, b = cb[c] * 3;
      for (let k = 0; k < 3; k++) {
        const m = (out[a + k] + out[b + k]) / 2;
        out[a + k] = m; out[b + k] = m;
      }
    }
  }
}
