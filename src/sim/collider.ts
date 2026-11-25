// Fast body collider built from the same anatomical rings as the mannequin mesh.
// Each body part is a stack of shaped rings sampled into a table, so a collision query is just
// a couple of table lookups.

import { bodyFrame, type Body, type BRing } from '../three/body';

const NA = 72;

interface Part {
  y0: number;
  dy: number;
  rows: { a: number; b: number; cx: number; cz: number; m: Float32Array }[];
  // world -> local transform: translate then rotate about Z
  tx: number;
  ty: number;
  rot: number;
  sign: number; // local y = sign * (world-derived y)
  slope: boolean; // use the surface slope for the contact normal (off for near-vertical legs)
}

function makeRows(y0: number, y1: number, ring: (y: number) => BRing & { cx?: number }) {
  const rows: Part['rows'] = [];
  for (let y = y0; y <= y1 + 1e-6; y += 1) {
    const r = ring(y);
    const m = new Float32Array(NA + 1);
    for (let j = 0; j <= NA; j++) m[j] = r.shape(((j % NA) / NA) * Math.PI * 2);
    rows.push({ a: r.a, b: r.b, cx: r.cx ?? 0, cz: r.cz ?? 0, m });
  }
  return rows;
}

export class BodyCollider {
  parts: Part[] = [];
  thickness = 0.45;

  constructor(body: Body) {
    const f = bodyFrame(body);
    const torsoTop = f.neckH;
    // the pelvis underside is left out: below the crotch line the thighs carry the cloth
    const t0 = f.crotchH + 3.5;
    this.parts.push({ y0: t0, dy: 1, rows: makeRows(t0, torsoTop, (h) => f.torsoRing(h)), tx: 0, ty: 0, rot: 0, sign: 1, slope: true });
    this.parts.push({ y0: f.neckH - 2, dy: 1, rows: makeRows(f.neckH - 2, f.neckTop, (h) => f.neckRing(h)), tx: 0, ty: 0, rot: 0, sign: 1, slope: true });
    for (const side of [1, -1]) {
      this.parts.push({
        y0: f.ankleH - 3, dy: 1, rows: makeRows(f.ankleH - 3, f.crotchH, (h) => f.legRing(h, side)),
        tx: side * f.legX, ty: 0, rot: 0, sign: 1, slope: false,
      });
      // arms: rows indexed by distance s down the arm from the shoulder joint
      const s0 = -f.armDome * 0.98;
      this.parts.push({
        y0: s0, dy: 1, rows: makeRows(s0, f.armSeg, (s) => f.armRing(s, side)),
        tx: side * f.shoulderJoint.x, ty: f.shoulderJoint.y, rot: side * f.armAngle, sign: -1, slope: true,
      });
    }
  }

  /** Surface radius of a row at the angle of (dx, dz) from that row's centre. */
  private surf(part: Part, k: number, t: number, x: number, z: number) {
    const r0 = part.rows[k], r1 = part.rows[Math.min(k + 1, part.rows.length - 1)];
    const a = r0.a + (r1.a - r0.a) * t, b = r0.b + (r1.b - r0.b) * t;
    const cx = r0.cx + (r1.cx - r0.cx) * t, cz = r0.cz + (r1.cz - r0.cz) * t;
    const dx = x - cx, dz = z - cz;
    let th = Math.atan2(dz / b, dx / a);
    if (th < 0) th += Math.PI * 2;
    const jf = (th / (Math.PI * 2)) * NA;
    const j = Math.min(NA - 1, Math.floor(jf));
    const u = jf - j;
    const m0 = r0.m[j] + (r0.m[j + 1] - r0.m[j]) * u;
    const m1 = r1.m[j] + (r1.m[j + 1] - r1.m[j]) * u;
    const m = m0 + (m1 - m0) * t;
    const rs = Math.hypot(a * m * Math.cos(th), b * m * Math.sin(th)) + this.thickness;
    return { rs, rp: Math.hypot(dx, dz), dx, dz, cx, cz, R: Math.max(a, b) };
  }

  /**
   * Push the point (in place) out of the body along the shortest way out: sideways off the
   * surface, or along the part's axis (e.g. up onto the top of the shoulders). Returns true when it was inside.
   */
  project(p: Float32Array, i: number, out: { nx: number; ny: number; nz: number; depth: number }): boolean {
    out.depth = 0;
    let hit = false;
    for (const part of this.parts) {
      let x = p[i] - part.tx, y = p[i + 1] - part.ty;
      const z = p[i + 2];
      if (part.rot) {
        const c = Math.cos(-part.rot), s = Math.sin(-part.rot);
        const lx = x * c - y * s, ly = x * s + y * c;
        x = lx; y = ly;
      }
      const ly = part.sign * y; // table coordinate
      const fRow = (ly - part.y0) / part.dy;
      const last = part.rows.length - 1;
      if (fRow < 0 || fRow > last) continue;
      const k = Math.min(last - 1, Math.floor(fRow));
      const here = this.surf(part, k, fRow - k, x, z);
      if (here.rp > here.R * 1.5 + 2 || here.rp >= here.rs) continue;

      // candidate 1: radial
      let best = here.rs - here.rp;
      let mode = 0;
      let axial = 0;
      // candidate 2: along the axis, to the nearest row where the point is outside (or past the end)
      if (part.slope && best > 0.5) {
        for (const dir of [1, -1]) {
          for (let step = 1; step <= 8; step++) {
            const kk = Math.floor(fRow) + (dir > 0 ? step : 1 - step);
            if (kk < 0 || kk > last) break; // never escape through the open end of a part
            const ss = this.surf(part, Math.min(kk, last - 1), kk === last ? 1 : 0, x, z);
            if (ss.rp < ss.rs) continue;
            const dist = Math.abs(kk - fRow) * part.dy + this.thickness * 0.5;
            if (dist < best) { best = dist; mode = 1; axial = dir * dist; }
            break;
          }
        }
      }

      let nx = x, nyL = y, nz = z, nrx = 0, nry = 0, nrz = 0;
      if (mode === 0) {
        // push along the true surface normal, which tilts with the slope of the body (dr/dy)
        const kk = Math.min(last - 1, k + 1);
        const above = this.surf(part, kk, 0, x, z), below = this.surf(part, Math.max(0, kk - 1), 0, x, z);
        const g = part.slope ? (above.rs - below.rs) / part.dy : 0; // change of surface radius per unit of table coordinate
        const depth = here.rs - here.rp;
        const ux = here.rp > 1e-6 ? here.dx / here.rp : 0, uz = here.rp > 1e-6 ? here.dz / here.rp : 1;
        const inv = 1 / (1 + g * g);
        const dr = depth * inv, dt = -depth * g * inv;
        nx = x + ux * dr;
        nz = z + uz * dr;
        nyL = y + part.sign * dt;
        const nl = Math.sqrt(1 + g * g);
        nrx = ux / nl; nrz = uz / nl; nry = (part.sign * -g) / nl;
      } else {
        nyL = y + part.sign * axial;
        nry = part.sign * Math.sign(axial);
      }
      let wx = nx, wy = nyL, wnx = nrx, wny = nry;
      if (part.rot) {
        const ci = Math.cos(part.rot), si = Math.sin(part.rot);
        wx = nx * ci - nyL * si; wy = nx * si + nyL * ci;
        wnx = nrx * ci - nry * si; wny = nrx * si + nry * ci;
      }
      p[i] = wx + part.tx;
      p[i + 1] = wy + part.ty;
      p[i + 2] = nz;
      out.nx = wnx; out.ny = wny; out.nz = nrz;
      out.depth += best;
      hit = true;
    }
    return hit;
  }
}
