// Soft skin: the mannequin's surface gives a little where cloth presses on it (a tight waistband, a cuff, a knit pulled
// close, a point pulled by hand), and springs back when the pressure goes.
//
// How it works (runs in the simulation worker, src/sim/worker.ts):
//   - The body collider (PosedCollider.soft, src/three/mesher.ts) reports, per cloth particle, how far the solver had to
//     push it out of the body this frame (summed over substeps) and the standing body point it touched. A particle
//     that keeps being pushed out is held against the body by cloth tension: that push is the contact pressure. A
//     garment just resting under its own weight pushes far less than a band stretched round the waist, so below a
//     threshold nothing happens: loose clothes and the bare body leave the skin exactly as measured.
//   - Above it, the particle asks for a dent under it, scaled by the tissue softness of that body region (soft over
//     belly, hips, seat, thighs, upper arms, chest; almost none over bone: head, collarbones, shoulder tops, elbows,
//     wrists, knees, shins, ankles) and capped at MAX_DEPTH. Each request is spread over the body vertices round the
//     particle with a smooth falloff, so the dent is a soft hollow rather than a pit per particle.
//   - Every vertex's dent follows its target: fast going in, a damped spring coming back out.
//   - The collider then uses the dented surface (per particle: the dent at its body vertex), so the cloth sits in the
//     dent instead of clipping into it; the display moves each body vertex in along its standing normal by its dent
//     (ClothView, worker 'skin' message).
import type { BodyFrame } from '../three/body';
import type { BodyMesh } from '../three/mesher';

/** deepest dent anywhere, over the softest tissue (cm) */
export const MAX_DEPTH = 1.3;
/** stretch (share of the fabric's safe stretch) below which cloth touching the skin does not press it in */
export const PRESS_THRESHOLD = 0.5;
/** dent (cm, before softness, at light pressure) per unit of stretch ratio above the threshold; it saturates at MAX_DEPTH */
export const PRESS_GAIN = 0.6;
/** dents shallower than this (cm) are not made at all: cloth that only just touches leaves the skin as measured */
export const MIN_DENT = 0.05;
/** radius over which one particle's push spreads on the skin (cm) */
const SPREAD = 3;
const CELL = 3;

/** Tissue softness 0..1 per standing body vertex, by region (see the header). */
export function tissueSoftness(mesh: Pick<BodyMesh, 'positions' | 'skinIndex' | 'skinWeight'>, f: BodyFrame, female = false): Float32Array {
  const P = mesh.positions, nv = P.length / 3, out = new Float32Array(nv);
  const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
    // main bone of this vertex
    let b = mesh.skinIndex[v * 4], w = mesh.skinWeight[v * 4];
    for (let q = 1; q < 4; q++) if (mesh.skinWeight[v * 4 + q] > w) { w = mesh.skinWeight[v * 4 + q]; b = mesh.skinIndex[v * 4 + q]; }
    let s = 0.5;
    if (b === 10) s = 0.04; // head and upper neck
    else if (b === 9) {
      // chest: soft over the pecs or bust and the flanks, firm over the collarbones, shoulder tops and spine
      s = female ? 0.75 : 0.55;
      const top = smooth(f.chestH + (f.shoulderH - f.chestH) * 0.45, f.shoulderH - 1, y);
      s *= 1 - 0.8 * top;
      if (Math.abs(x) < 3.5 && z < 0) s *= 0.4; // spine
      if (y > f.neckH - 3) s = 0.05;
      // waist side of the chest bone: the belly and love handles
      s = Math.max(s, 0.9 * (1 - smooth(f.waistH - 2, f.chestH - 4, y)));
    } else if (b === 0) {
      // pelvis: belly, hips and seat are the softest; the spine and the pelvic bone at the front less so
      s = 1;
      if (Math.abs(x) < 3.5 && z < 0 && y > f.hipH) s = 0.4;
      if (y < f.crotchH + 3) s = 0.6;
    } else if (b === 1 || b === 3 || b === 2 || b === 4) {
      // arms: distance down the arm from the shoulder joint
      const side = b <= 2 ? 1 : -1, ang = side * f.armAngle;
      const d = (x - side * f.shoulderJoint.x) * Math.sin(ang) - (y - f.shoulderJoint.y) * Math.cos(ang);
      if (b === 1 || b === 3) s = 0.7 * smooth(1, 6, d) * (1 - 0.8 * smooth(f.upperArm - 6, f.upperArm - 1, d));
      else s = 0.3 * (1 - smooth(f.upperArm + f.foreArm - 8, f.upperArm + f.foreArm - 3, d)) * smooth(f.upperArm + 1, f.upperArm + 6, d);
      s = Math.max(0.05, s);
    } else if (b === 5 || b === 7) {
      s = 0.9 * smooth(f.kneeH + 3, f.kneeH + 9, y);
      s = Math.max(0.08, s);
    } else if (b === 6 || b === 8) {
      // lower leg: calf behind, bone in front, firm at the knee and ankle
      s = z < -1 ? 0.45 : 0.08;
      s *= smooth(f.ankleH + 3, f.ankleH + 9, y) * (1 - smooth(f.kneeH - 6, f.kneeH - 1, y));
      s = Math.max(0.04, s);
    }
    out[v] = s;
  }
  return out;
}

export class SoftSkin {
  readonly nv: number;
  /** current dent per body vertex (cm, inward along the standing normal) */
  readonly dent: Float32Array;
  private vel: Float32Array;
  private target: Float32Array;
  private soft: Float32Array;
  private rest: Float32Array;
  private active = new Uint8Array(0);
  private list: number[] = [];
  /** body vertices by cell of a dense grid over the standing body: vertices of cell c are cellVerts[cellStart[c] .. cellStart[c + 1]) */
  private cellStart: Int32Array;
  private cellVerts: Int32Array;
  private g0 = [0, 0, 0];
  private gn = [0, 0, 0];
  /** per particle (sized by bind): the collider's arrays, and the body vertex under each particle (-1 none) */
  contact: { dent: Float32Array; press: Float32Array; q: Float32Array } = { dent: new Float32Array(0), press: new Float32Array(0), q: new Float32Array(0) };
  private vnear = new Int32Array(0);
  /** substeps per frame of the solver (pushes are summed over them) */
  substeps = 10;
  on = true;
  /** a dent changed since the last takeChanged() */
  private changed = false;

  constructor(mesh: Pick<BodyMesh, 'positions' | 'skinIndex' | 'skinWeight'>, f: BodyFrame, female = false) {
    const P = mesh.positions;
    this.nv = P.length / 3;
    this.rest = P.slice();
    this.dent = new Float32Array(this.nv);
    this.vel = new Float32Array(this.nv);
    this.target = new Float32Array(this.nv);
    this.active = new Uint8Array(this.nv);
    this.soft = tissueSoftness(mesh, f, female);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < this.nv; v++) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], P[v * 3 + a]); hi[a] = Math.max(hi[a], P[v * 3 + a]); }
    for (let a = 0; a < 3; a++) { this.g0[a] = lo[a] - CELL; this.gn[a] = Math.ceil((hi[a] - lo[a]) / CELL) + 3; }
    const nc = this.gn[0] * this.gn[1] * this.gn[2], cellOf = new Int32Array(this.nv);
    this.cellStart = new Int32Array(nc + 1);
    for (let v = 0; v < this.nv; v++) { cellOf[v] = this.cell(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); this.cellStart[cellOf[v] + 1]++; }
    for (let c = 0; c < nc; c++) this.cellStart[c + 1] += this.cellStart[c];
    const fill = this.cellStart.slice(0, nc);
    this.cellVerts = new Int32Array(this.nv);
    for (let v = 0; v < this.nv; v++) this.cellVerts[fill[cellOf[v]]++] = v;
  }

  private cell(x: number, y: number, z: number) {
    const i = Math.max(0, Math.min(this.gn[0] - 1, Math.floor((x - this.g0[0]) / CELL)));
    const j = Math.max(0, Math.min(this.gn[1] - 1, Math.floor((y - this.g0[1]) / CELL)));
    const k = Math.max(0, Math.min(this.gn[2] - 1, Math.floor((z - this.g0[2]) / CELL)));
    return i + this.gn[0] * (j + this.gn[1] * k);
  }

  /** arrays for a new cloth of n particles (a new build); dents already in the skin stay and spring back */
  bind(n: number) {
    this.contact = { dent: new Float32Array(n), press: new Float32Array(n), q: new Float32Array(n * 3) };
    this.vnear = new Int32Array(n).fill(-1);
  }

  /** the softness of body vertex v (for tests) */
  softness(v: number) { return this.soft[v]; }

  /**
   * One frame: turn this frame's contacts into dent targets, move the dents, hand the dents back to the collider.
   * ratio: per particle, how hard the cloth there is stretched as a share of its safe stretch (the Stretch-Risk-O-Meter
   * reading): cloth under tension wrapped round the body is what presses on it.
   */
  update(ratio: Float32Array | null) {
    const C = this.contact, n = C.press.length, R = this.rest, T = this.target;
    const S2 = SPREAD * SPREAD, gx = this.gn[0], gxy = this.gn[0] * this.gn[1];
    const anyDent = this.list.length > 0;
    if (this.on) for (let k = 0; k < n; k++) {
      const pr = C.press[k];
      if (!(pr > 0)) continue;
      C.press[k] = 0;
      const qx = C.q[k * 3], qy = C.q[k * 3 + 1], qz = C.q[k * 3 + 2];
      const r = ratio ? ratio[k] : 0;
      // tissue stiffens as it compresses: the dent saturates towards MAX_DEPTH
      const want = r > PRESS_THRESHOLD ? MAX_DEPTH * (1 - Math.exp(-((r - PRESS_THRESHOLD) * PRESS_GAIN) / MAX_DEPTH)) : 0;
      // still over the same body vertex: no search needed unless it presses
      const v0 = this.vnear[k];
      if (want <= 0) {
        if (!anyDent) { this.vnear[k] = -1; continue; }
        if (v0 >= 0) { const dx = R[v0 * 3] - qx, dy = R[v0 * 3 + 1] - qy, dz = R[v0 * 3 + 2] - qz; if (dx * dx + dy * dy + dz * dz < 1) continue; }
      }
      const c0 = this.cell(qx, qy, qz);
      let best = -1, bd = Infinity;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const c = c0 + di + dj * gx + dk * gxy;
        if (c < 0 || c >= this.cellStart.length - 1) continue;
        for (let e = this.cellStart[c], end = this.cellStart[c + 1]; e < end; e++) {
          const v = this.cellVerts[e];
          const dx = R[v * 3] - qx, dy = R[v * 3 + 1] - qy, dz = R[v * 3 + 2] - qz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bd) { bd = d2; best = v; }
          if (want > 0 && d2 < S2) {
            const fall = (1 - d2 / S2) ** 2;
            const t = want * this.soft[v] * fall;
            if (t > MIN_DENT && t > T[v]) { T[v] = t; if (!this.active[v]) { this.active[v] = 1; this.list.push(v); } }
          }
        }
      }
      this.vnear[k] = best;
    }
    else C.press.fill(0);
    // dents follow their targets: in quickly, back out on a damped spring
    const D = this.dent, V = this.vel, keep: number[] = [];
    for (const v of this.list) {
      const t = this.on ? Math.min(MAX_DEPTH * this.soft[v], T[v]) : 0;
      const d = D[v];
      let nd: number;
      if (t > d) { nd = d + (t - d) * 0.5; V[v] = 0; }
      else { V[v] = V[v] * 0.6 + (t - d) * 0.25; nd = Math.max(0, d + V[v]); }
      if (Math.abs(nd - d) > 1e-5) this.changed = true;
      D[v] = nd;
      T[v] = 0;
      if (nd > 1e-4 || Math.abs(V[v]) > 1e-5) keep.push(v); else { D[v] = 0; V[v] = 0; this.active[v] = 0; this.changed = true; }
    }
    this.list = keep;
    // the collider: the dent under each particle
    for (let k = 0; k < n; k++) { const v = this.vnear[k]; C.dent[k] = v >= 0 ? D[v] : 0; }
  }

  /** deepest dent now (cm) */
  maxDent() { let m = 0; for (const v of this.list) m = Math.max(m, this.dent[v]); return m; }

  /** true once after any dent changed (the display needs a new copy) */
  takeChanged() { const c = this.changed; this.changed = false; return c; }
}
