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
  staticFriction = 0.5;
  maxMove = 1.2; // cm per substep, keeps early sewing from exploding
  /**
   * Blow-up guards. No cloth point moves faster than maxSpeed (cm/s, about 17 cm per substep) between substeps: a drape, a seam closing (peaks about 6000 cm/s on baggy jeans) or a
   * running body stays well under it, so it only acts on a point that something is throwing (a constraint fight).
   * Once sewn, a cloth layer (attachment on its host, the fall of a collar on its stand) is pushed back out by at most
   * layerStep per substep: a host triangle that twists can not fling the point lying on it. If a frame still ends with a
   * position that is not a finite number or is absurdly far off (any coordinate past maxCoord cm), the cloth is put
   * back where it was at the end of the last good frame, at rest (recoveries counts how often).
   */
  maxSpeed = 10000;
  layerStep = 0.1;
  maxCoord = 2000;
  recoveries = 0;
  private good: Float32Array | null = null;
  collider: { project(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number; vx?: number; vy?: number; vz?: number }): boolean } | null = null;
  // self collision
  selfRadius = 0;
  panelOf: Uint16Array | null = null;
  uv: Float32Array | null = null; // 2D pattern coords, to skip neighbours on the same piece
  seamGroup: Int32Array | null = null; // vertices sewn together share a group
  nearSeam: Uint8Array | null = null; // within a few cm of a seam on its own piece
  /** per particle: a panel it never self collides with (an attachment and its host lie flat on each other), -1 none */
  skipPanel: Int32Array | null = null;
  /**
   * cloth layers (attachments on their host): particle a stays at least `gap` on the outer side of the host
   * triangle h0 h1 h2 at barycentric w0 w1 w2. idx: a, h0, h1, h2 per entry; w: w0, w1, w2, gap, sign per entry
   * (sign turns the triangle's winding normal outward).
   */
  layerIdx: Int32Array | null = null;
  layerW: Float32Array | null = null;
  private hashStart = new Int32Array(0);
  private hashItems = new Int32Array(0);
  params: ClothParams;
  sleeping = false;
  /** keep simulating (body is moving) */
  awake = false;
  /** called before each substep (k of n), e.g. to move the body smoothly between frames */
  substepHook: ((k: number, n: number) => void) | null = null;
  frames = 0;
  /**
   * Cloth that rides on a body part, like a hat on the head: every substep each particle in from..to is moved with the
   * rigid motion of `bone` (carrySource.M against carrySource.Mprev, 3x4 rows per bone, src/sim/pose.ts), so the cloth
   * is simulated in that bone's frame. Gravity, the body and the seams still act on it; a head that drops faster than
   * gravity (the bob of a walk) no longer throws the hat up and off. Velocities stay relative to the bone. Set by
   * setup for hats when the collider is posed (PosedCollider); empty otherwise.
   */
  carry: { from: number; to: number; bone: number }[] = [];
  carrySource: { M: Float64Array; Mprev: Float64Array } | null = null;
  private carryD: Float32Array | null = null;
  /**
   * Outfits (src/sim/outfit.ts): per particle the garment it belongs to. Particles of different garments always
   * collide (the "two sides of a seam" skip only applies within one garment) and keep crossRadius apart.
   */
  garmentOf: Uint8Array | null = null;
  crossRadius = 0;
  /**
   * Outfit layer contacts, rebuilt every frame by contactHook: particle a keeps at least gap on the sign side of the
   * triangle h0 h1 h2 (same packing as layerIdx / layerW), with friction against that triangle.
   */
  contactIdx: Int32Array | null = null;
  contactW: Float32Array | null = null;
  contactCount = 0;
  /** friction between garments (0 slides freely, 1 sticks) */
  contactFriction = 0.25;
  /** called at the start of every frame (outfits rebind their layer contacts here) */
  frameHook: (() => void) | null = null;
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
    const nrm = { nx: 0, ny: 0, nz: 0, depth: 0, vx: 0, vy: 0, vz: 0 };
    const sewing = this.frames < this.sewFrames;
    const fr = sewing ? 0 : this.params.friction;
    const grav = sewing ? 0 : this.gravity;
    const sfr = sewing ? 0 : this.staticFriction;
    let maxV = 0;
    const vMax = this.maxSpeed, vMax2 = vMax * vMax;
    if (!this.good) this.good = pos.slice();
    if (this.frameHook) this.frameHook();
    const carryD = this.carry.length && this.carrySource ? (this.carryD ??= new Float32Array(n * 3)) : null;
    for (let s = 0; s < this.substeps; s++) {
      if (this.substepHook) this.substepHook(s, this.substeps);
      for (let i = 0; i < n; i++) {
        if (!invMass[i]) continue;
        const j = i * 3;
        vel[j + 1] += grav * h;
        prev[j] = pos[j]; prev[j + 1] = pos[j + 1]; prev[j + 2] = pos[j + 2];
        pos[j] += vel[j] * h; pos[j + 1] += vel[j + 1] * h; pos[j + 2] += vel[j + 2] * h;
      }
      if (carryD) this.carryStep(carryD);
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
      if (this.contactCount) this.contacts(sewing ? 0.6 : 0.15);
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
            // slide relative to the skin underneath (the body may be moving)
            const mx = pos[j] - prev[j] - (nrm.vx ?? 0), my = pos[j + 1] - prev[j + 1] - (nrm.vy ?? 0), mz = pos[j + 2] - prev[j + 2] - (nrm.vz ?? 0);
            const dn = mx * nrm.nx + my * nrm.ny + mz * nrm.nz;
            const tx = mx - dn * nrm.nx, ty = my - dn * nrm.ny, tz = mz - dn * nrm.nz;
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            // position based friction: stick if the slide is small compared with the contact push
            const k = tl < sfr * nrm.depth ? 1 : Math.min(1, (fr * nrm.depth) / (tl || 1));
            pos[j] -= tx * k; pos[j + 1] -= ty * k; pos[j + 2] -= tz * k;
          }
        }
      }
      // while sewing (no gravity) a layer may be put right in one go, so folds and pockets start on the right side
      if (this.layerIdx) this.layers(pos, sewing ? Infinity : this.layerStep);
      for (let i = 0; i < n; i++) {
        const j = i * 3;
        let vx = (pos[j] - prev[j]) / h, vy = (pos[j + 1] - prev[j + 1]) / h, vz = (pos[j + 2] - prev[j + 2]) / h;
        if (carryD) { vx -= carryD[j] / h; vy -= carryD[j + 1] / h; vz -= carryD[j + 2] / h; }
        const v2 = vx * vx + vy * vy + vz * vz;
        if (v2 > vMax2) {
          // thrown: keep the direction, limit the step (and the speed it carries into the next substep)
          const k = vMax / Math.sqrt(v2);
          vx *= k; vy *= k; vz *= k;
          pos[j] = prev[j] + vx * h; pos[j + 1] = prev[j + 1] + vy * h; pos[j + 2] = prev[j + 2] + vz * h;
        }
        vel[j] = vx * damp;
        vel[j + 1] = vy * damp;
        vel[j + 2] = vz * damp;
        if (s === this.substeps - 1) maxV = Math.max(maxV, Math.abs(vel[j]) + Math.abs(vel[j + 1]) + Math.abs(vel[j + 2]));
      }
    }
    this.frames++;
    // a frame that went wrong (not a number, or flung absurdly far): back to the last good frame, at rest
    let ok = true;
    const M = this.maxCoord;
    for (let j = 0; j < pos.length; j++) { const p = pos[j]; if (!(p > -M && p < M)) { ok = false; break; } }
    if (ok) this.good!.set(pos);
    else {
      this.recoveries++;
      pos.set(this.good!); prev.set(pos); vel.fill(0);
      maxV = 0;
    }
    if (!this.awake && this.frames > this.sewFrames + 60 && maxV < 1.5) this.sleeping = true;
    if (!this.awake && this.frames > this.sewFrames + 330) this.sleeping = true;
    return maxV;
  }

  /** Keep cloth layers from passing through each other: particles closer than selfRadius are pushed apart. */
  private selfCollide() {
    const { pos, n, panelOf, uv, seamGroup, invMass, garmentOf } = this;
    const r = this.selfRadius, r2 = r * r, skip2 = (r * 4) ** 2;
    const cr = Math.min(r, this.crossRadius), cr2 = cr * cr;
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
          if (garmentOf && garmentOf[i] !== garmentOf[j]) {
            // two garments of an outfit: the layer contacts keep them on the right side, this only keeps points apart
            if (d2 >= cr2) continue;
            const d = Math.sqrt(d2), w = invMass[i] + invMass[j];
            if (!w) continue;
            const c = (cr - d) / d / w;
            pos[i * 3] -= ex * c * invMass[i]; pos[i * 3 + 1] -= ey * c * invMass[i]; pos[i * 3 + 2] -= ez * c * invMass[i];
            pos[j * 3] += ex * c * invMass[j]; pos[j * 3 + 1] += ey * c * invMass[j]; pos[j * 3 + 2] += ez * c * invMass[j];
            continue;
          }
          if (seamGroup && seamGroup[i] === seamGroup[j]) continue;
          if (this.nearSeam && this.nearSeam[i] && this.nearSeam[j] && panelOf && panelOf[i] !== panelOf[j]) continue; // the two sides of a seam
          if (this.skipPanel && panelOf && (this.skipPanel[i] === panelOf[j] || this.skipPanel[j] === panelOf[i])) continue; // attachment on its host
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

  /** move the carried particles with their bone's motion over the last substep (see carry) */
  private carryStep(d: Float32Array) {
    const { M, Mprev } = this.carrySource!;
    const pos = this.pos;
    for (const c of this.carry) {
      const o = c.bone * 12;
      // D = M * inverse(Mprev); Mprev is rigid, so its inverse is the transposed rotation
      const R = [0, 0, 0, 0, 0, 0, 0, 0, 0], t = [0, 0, 0];
      const P = (r: number, k: number) => Mprev[o + r * 4 + k];
      const pt = [P(0, 3), P(1, 3), P(2, 3)];
      let ok = true;
      for (let r = 0; r < 3; r++) {
        for (let k = 0; k < 3; k++) {
          let v = 0;
          for (let m = 0; m < 3; m++) v += M[o + r * 4 + m] * P(k, m);
          R[r * 3 + k] = v;
        }
      }
      for (let r = 0; r < 3; r++) t[r] = M[o + r * 4 + 3] - (R[r * 3] * pt[0] + R[r * 3 + 1] * pt[1] + R[r * 3 + 2] * pt[2]);
      // a pose that jumps (a rebuild after a movement) is not a motion to follow
      if (Math.abs(t[0]) + Math.abs(t[1]) + Math.abs(t[2]) > 30) ok = false;
      for (let i = c.from; i < c.to; i++) {
        const j = i * 3;
        if (!ok || !this.invMass[i]) { d[j] = d[j + 1] = d[j + 2] = 0; continue; }
        const x = pos[j], y = pos[j + 1], z = pos[j + 2];
        const nx = R[0] * x + R[1] * y + R[2] * z + t[0], ny = R[3] * x + R[4] * y + R[5] * z + t[1], nz = R[6] * x + R[7] * y + R[8] * z + t[2];
        d[j] = nx - x; d[j + 1] = ny - y; d[j + 2] = nz - z;
        pos[j] = nx; pos[j + 1] = ny; pos[j + 2] = nz;
      }
    }
  }

  /**
   * Outfit layer contacts (see contactIdx): the particle is pushed onto the right side of its triangle by at most step
   * cm, and its slide along the triangle is damped by contactFriction (relative to the triangle's own motion).
   */
  private contacts(step: number) {
    const I = this.contactIdx!, W = this.contactW!, pos = this.pos, prev = this.prev, fr = this.contactFriction;
    for (let e = 0, k = 0; e < this.contactCount * 4; e += 4, k += 5) {
      const a = I[e] * 3, h0 = I[e + 1] * 3, h1 = I[e + 2] * 3, h2 = I[e + 3] * 3;
      const ux = pos[h1] - pos[h0], uy = pos[h1 + 1] - pos[h0 + 1], uz = pos[h1 + 2] - pos[h0 + 2];
      const vx = pos[h2] - pos[h0], vy = pos[h2 + 1] - pos[h0 + 1], vz = pos[h2 + 2] - pos[h0 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) continue;
      const sg = W[k + 4] / l;
      nx *= sg; ny *= sg; nz *= sg;
      const w0 = W[k], w1 = W[k + 1], w2 = W[k + 2];
      const px = pos[h0] * w0 + pos[h1] * w1 + pos[h2] * w2, py = pos[h0 + 1] * w0 + pos[h1 + 1] * w1 + pos[h2 + 1] * w2, pz = pos[h0 + 2] * w0 + pos[h1 + 2] * w1 + pos[h2 + 2] * w2;
      const d = (pos[a] - px) * nx + (pos[a + 1] - py) * ny + (pos[a + 2] - pz) * nz;
      let c = W[k + 3] - d;
      if (c <= 0) continue;
      if (c > step) c = step;
      // both layers give way, by mass: the point one way, the triangle under it the other
      const im = this.invMass, wa = im[I[e]], wt = im[I[e + 1]] * w0 * w0 + im[I[e + 2]] * w1 * w1 + im[I[e + 3]] * w2 * w2;
      const sum = wa + wt;
      if (!sum) continue;
      const ca = (c * wa) / sum, ct = (c * wt) / sum;
      pos[a] += nx * ca; pos[a + 1] += ny * ca; pos[a + 2] += nz * ca;
      if (ct > 0) {
        const l2 = w0 * w0 * im[I[e + 1]] + w1 * w1 * im[I[e + 2]] + w2 * w2 * im[I[e + 3]];
        for (const [hi, wi] of [[h0, w0 * im[I[e + 1]]], [h1, w1 * im[I[e + 2]]], [h2, w2 * im[I[e + 3]]]] as [number, number][]) {
          const m = (ct * wi) / l2;
          pos[hi] -= nx * m; pos[hi + 1] -= ny * m; pos[hi + 2] -= nz * m;
        }
      }
      if (fr <= 0) continue;
      // friction: the slide of the particle relative to the triangle under it this substep, tangential part
      const mx = pos[a] - prev[a] - ((pos[h0] - prev[h0]) * w0 + (pos[h1] - prev[h1]) * w1 + (pos[h2] - prev[h2]) * w2);
      const my = pos[a + 1] - prev[a + 1] - ((pos[h0 + 1] - prev[h0 + 1]) * w0 + (pos[h1 + 1] - prev[h1 + 1]) * w1 + (pos[h2 + 1] - prev[h2 + 1]) * w2);
      const mz = pos[a + 2] - prev[a + 2] - ((pos[h0 + 2] - prev[h0 + 2]) * w0 + (pos[h1 + 2] - prev[h1 + 2]) * w1 + (pos[h2 + 2] - prev[h2 + 2]) * w2);
      const dn = mx * nx + my * ny + mz * nz;
      const tx = mx - dn * nx, ty = my - dn * ny, tz = mz - dn * nz;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      const f = tl < fr * c ? 1 : Math.min(1, (fr * c) / (tl || 1));
      pos[a] -= tx * f; pos[a + 1] -= ty * f; pos[a + 2] -= tz * f;
    }
  }

  /**
   * Keep every attachment particle on the outer side of its host cloth (moves the attachment only), by at most `step`
   * cm; entries from..to (default all).
   */
  layers(pos: Float32Array, step = Infinity, from = 0, to = Infinity) {
    const I = this.layerIdx!, W = this.layerW!;
    const end = Math.min(I.length, to * 4);
    for (let e = from * 4, k = from * 5; e < end; e += 4, k += 5) {
      const a = I[e] * 3, h0 = I[e + 1] * 3, h1 = I[e + 2] * 3, h2 = I[e + 3] * 3;
      const ux = pos[h1] - pos[h0], uy = pos[h1 + 1] - pos[h0 + 1], uz = pos[h1 + 2] - pos[h0 + 2];
      const vx = pos[h2] - pos[h0], vy = pos[h2 + 1] - pos[h0 + 1], vz = pos[h2 + 2] - pos[h0 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) continue;
      const sg = W[k + 4] / l;
      nx *= sg; ny *= sg; nz *= sg;
      const w0 = W[k], w1 = W[k + 1], w2 = W[k + 2];
      const px = pos[h0] * w0 + pos[h1] * w1 + pos[h2] * w2, py = pos[h0 + 1] * w0 + pos[h1 + 1] * w1 + pos[h2 + 1] * w2, pz = pos[h0 + 2] * w0 + pos[h1 + 2] * w1 + pos[h2 + 2] * w2;
      const d = (pos[a] - px) * nx + (pos[a + 1] - py) * ny + (pos[a + 2] - pz) * nz;
      let c = W[k + 3] - d;
      if (c <= 0) continue;
      if (c > step) c = step;
      pos[a] += nx * c; pos[a + 1] += ny * c; pos[a + 2] += nz * c;
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
