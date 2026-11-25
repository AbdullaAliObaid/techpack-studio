// The whole body as one smooth implicit surface (signed distance field). Anatomical parts
// (torso, neck, head, arms, legs, hands, feet) are distance fields built from the same rings as the
// measurements, joined with a smooth union so limbs flow into the torso like a real mannequin.
// The field is used twice: meshed into the body you see, and sampled as the cloth collision surface.
// A calibration pass measures the final surface like a tape and corrects it to the exact girths.

import { bodyFrame, hullLength, makeCurve, type Body, type BodyFrame, type BRing, type Shape } from './body';

const TAU = Math.PI * 2;
const NA = 72;

interface Row { a: number; b: number; cx: number; cz: number; m: Float32Array }

interface Tube {
  kind: 'tube';
  y0: number;
  rows: Row[];
  /** world point -> [radial x, axial, radial z] in the tube's frame */
  map: (x: number, y: number, z: number, o: Float64Array) => void;
  box: number[];
  group: number;
  scale?: (ax: number) => number;
}
interface Capsule { kind: 'cap'; a: number[]; b: number[]; r0: number; r1: number; box: number[]; group: number }
interface Ellipsoid { kind: 'ell'; c: number[]; r: number[]; box: number[]; group: number }
type Part = Tube | Capsule | Ellipsoid;

function rowsFrom(y0: number, y1: number, step: number, ring: (y: number) => BRing & { cx?: number }): Row[] {
  const rows: Row[] = [];
  for (let y = y0; y <= y1 + 1e-6; y += step) {
    const r = ring(y);
    const m = new Float32Array(NA + 1);
    for (let j = 0; j <= NA; j++) m[j] = r.shape(((j % NA) / NA) * TAU);
    rows.push({ a: r.a, b: r.b, cx: r.cx ?? 0, cz: r.cz ?? 0, m });
  }
  return rows;
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};

// head profile, same as the old mannequin head
const HEAD = makeCurve(
  [
    { k: 0, v: [0.05, 0.05, 0.2] }, { k: 0.04, v: [0.15, 0.13, 0.15] }, { k: 0.12, v: [0.22, 0.22, 0.09] },
    { k: 0.24, v: [0.27, 0.32, 0.04] }, { k: 0.4, v: [0.31, 0.39, 0.015] }, { k: 0.58, v: [0.335, 0.425, 0] },
    { k: 0.75, v: [0.34, 0.435, -0.012] }, { k: 0.88, v: [0.3, 0.385, -0.02] }, { k: 0.96, v: [0.2, 0.25, -0.02] },
    { k: 1, v: [0.04, 0.05, -0.02] },
  ],
  -1,
);
function headShape(t: number): Shape {
  const g = (x: number, mu: number, s: number) => Math.exp(-0.5 * ((x - mu) / s) ** 2);
  const ga = (th: number, mu: number, s: number) => {
    let d = (th - mu) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return Math.exp(-0.5 * (d / s) ** 2);
  };
  const F = Math.PI / 2, B = (3 * Math.PI) / 2;
  const nose = 0.12 * g(t, 0.42, 0.07) + 0.05 * g(t, 0.36, 0.03);
  const brow = 0.035 * g(t, 0.62, 0.04), eyes = 0.045 * g(t, 0.55, 0.035), cheek = 0.035 * g(t, 0.42, 0.06);
  const lips = 0.03 * g(t, 0.25, 0.03), chin = 0.05 * g(t, 0.08, 0.05), occ = 0.04 * g(t, 0.55, 0.12);
  return (th) =>
    1 + nose * ga(th, F, 0.13) + brow * ga(th, F, 0.7) - eyes * (ga(th, F - 0.38, 0.16) + ga(th, F + 0.38, 0.16)) +
    cheek * (ga(th, F - 0.7, 0.35) + ga(th, F + 0.7, 0.35)) + lips * ga(th, F, 0.3) + chin * ga(th, F, 0.35) + occ * ga(th, B, 0.8);
}

export interface Calibration { torso: [number, number][]; neck: number }

export class BodyField {
  f: BodyFrame;
  parts: Part[] = [];
  box: number[];
  private o = new Float64Array(3);
  cal: Calibration = { torso: [], neck: 1 };

  constructor(public body: Body, cal?: Calibration) {
    this.f = bodyFrame(body);
    if (cal) this.cal = cal;
    this.build();
    this.box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const p of this.parts) for (let i = 0; i < 3; i++) {
      this.box[i] = Math.min(this.box[i], p.box[i]);
      this.box[i + 3] = Math.max(this.box[i + 3], p.box[i + 3]);
    }
  }

  private torsoScale(h: number) {
    const t = this.cal.torso;
    if (!t.length) return 1;
    if (h <= t[0][0]) return 1 + (t[0][1] - 1) * Math.max(0, 1 - (t[0][0] - h) / 8);
    for (let i = 0; i + 1 < t.length; i++) {
      if (h <= t[i + 1][0]) {
        const u = (h - t[i][0]) / (t[i + 1][0] - t[i][0]);
        return t[i][1] + (t[i + 1][1] - t[i][1]) * u;
      }
    }
    const l = t[t.length - 1];
    return 1 + (l[1] - 1) * Math.max(0, 1 - (h - l[0]) / 8);
  }

  private build() {
    const f = this.f, H = f.H;
    const P = this.parts;
    const bx = (rows: Row[], pad = 2) => rows.reduce((m, r) => Math.max(m, Math.max(r.a, r.b) * 1.35 + Math.abs(r.cz) + pad), 0);

    // torso (group 0 = main body)
    const tr = rowsFrom(f.torsoBottom, f.neckH + 3, 0.5, (h) => {
      const r = f.torsoRing(h);
      const s = this.torsoScale(h);
      return { ...r, a: r.a * s, b: r.b * s };
    });
    const tR = bx(tr);
    P.push({ kind: 'tube', y0: f.torsoBottom, rows: tr, group: 0, box: [-tR, f.torsoBottom - 4, -tR, tR, f.neckH + 5, tR], map: (x, y, z, o) => { o[0] = x; o[1] = y; o[2] = z; } } as Tube);
    // stretch rows to 0.5 cm spacing
    (P[P.length - 1] as Tube & { dy?: number }).dy = 0.5;

    const nk = rowsFrom(f.neckH - 4, f.neckTop, 0.5, (h) => {
      const r = f.neckRing(h);
      return { ...r, a: r.a * this.cal.neck, b: r.b * this.cal.neck };
    });
    P.push({ kind: 'tube', y0: f.neckH - 4, rows: nk, group: 0, box: [-12, f.neckH - 6, -12, 12, f.neckTop + 2, 14], map: (x, y, z, o) => { o[0] = x; o[1] = y; o[2] = z; } } as Tube);
    (P[P.length - 1] as Tube & { dy?: number }).dy = 0.5;

    // head
    const Hh = f.headH, hy = f.neckH + 0.034 * H, hz = 0.016 * H;
    const hd = rowsFrom(0, Hh, Hh / 60, (y) => {
      const t = y / Hh;
      const [a, b, cz] = HEAD(t);
      return { a: a * Hh, b: b * Hh, shape: headShape(t), C: 0, cz: cz * Hh };
    });
    P.push({ kind: 'tube', y0: 0, rows: hd, group: 0, box: [-0.45 * Hh, hy - 1, hz - 0.6 * Hh, 0.45 * Hh, hy + Hh + 1, hz + 0.65 * Hh], map: (x, y, z, o) => { o[0] = x; o[1] = y - hy; o[2] = z - hz; } } as Tube);
    (P[P.length - 1] as Tube & { dy?: number }).dy = Hh / 60;
    for (const side of [1, -1]) {
      P.push({ kind: 'ell', c: [side * 0.325 * Hh, hy + 0.5 * Hh, hz - 0.03 * Hh], r: [0.032 * Hh, 0.1 * Hh, 0.062 * Hh], group: 3, box: [side * 0.325 * Hh - 2, hy + 0.35 * Hh, hz - 3, side * 0.325 * Hh + 2, hy + 0.65 * Hh, hz + 3] });
    }

    for (const side of [1, -1]) {
      // arm: one tube from the shoulder dome to just past the wrist, in the arm's own frame
      const jx = side * f.shoulderJoint.x, jy = f.shoulderJoint.y, ang = side * f.armAngle;
      const ca = Math.cos(-ang), sa = Math.sin(-ang);
      const s0 = -f.armDome * 0.98;
      const ar = rowsFrom(s0, f.armSeg + 1.5, 0.5, (s) => f.armRing(s, side));
      const armMap = (x: number, y: number, z: number, o: Float64Array) => {
        const dx = x - jx, dy = y - jy;
        o[0] = dx * ca - dy * sa;
        o[1] = -(dx * sa + dy * ca);
        o[2] = z;
      };
      const wx = jx + Math.sin(ang) * f.armSeg, wy = jy - Math.cos(ang) * f.armSeg;
      P.push({ kind: 'tube', y0: s0, rows: ar, group: 4, map: armMap, box: [Math.min(jx, wx) - 9, wy - 3, -9, Math.max(jx, wx) + 9, jy + 8, 9] } as Tube);
      (P[P.length - 1] as Tube & { dy?: number }).dy = 0.5;

      // hand: palm tube + finger capsules (group 1 = hands, finer blend)
      const sc = H / 175, palmL = 9.8 * sc;
      const toWorld = (lx: number, ly: number, lz: number) => {
        // hand local: origin at the wrist, -y down the arm
        const c = Math.cos(ang), s = Math.sin(ang);
        const ax = lx, ay = ly - f.armSeg;
        return [jx + ax * c - ay * s, jy + ax * s + ay * c, lz];
      };
      const pr: Row[] = [];
      const w0 = f.wristR * 1.05;
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const b = w0 + (4.3 * sc - w0) * Math.min(1, t * 1.6);
        const a = (1.75 - 0.35 * t) * sc;
        const m = new Float32Array(NA + 1).fill(1);
        pr.push({ a, b, cx: -side * 0.2 * sc * t, cz: 0, m });
      }
      const palmMap = (x: number, y: number, z: number, o: Float64Array) => {
        armMap(x, y, z, o);
        o[1] = (o[1] - f.armSeg) / (palmL / 12); // axial in row units
      };
      const hb = toWorld(0, -palmL - 9 * sc, 0);
      const wpt = toWorld(0, 0, 0);
      const hbox = [Math.min(hb[0], wpt[0]) - 7, Math.min(hb[1], wpt[1]) - 4, -7, Math.max(hb[0], wpt[0]) + 7, Math.max(hb[1], wpt[1]) + 3, 8];
      P.push({ kind: 'tube', y0: 0, rows: pr, group: 1, map: palmMap, box: hbox } as Tube);
      (P[P.length - 1] as Tube & { dy?: number }).dy = 1;
      const fingers: [number, number, number][] = [[2.95, 7.0, 0.84], [0.98, 7.8, 0.88], [-0.98, 7.3, 0.82], [-2.85, 5.9, 0.72]];
      const curl = -side;
      for (const [zf, len, r] of fingers) {
        const L1 = len * sc * 0.55, L2 = len * sc * 0.45, R = r * sc;
        const base = [-side * 0.25 * sc, -palmL + 0.4 * sc, zf * sc];
        const a1 = curl * 0.18, a2 = curl * 0.5;
        const k1 = [base[0] + Math.sin(a1) * L1, base[1] - Math.cos(a1) * L1, base[2]];
        const k2 = [k1[0] + Math.sin(a2) * L2, k1[1] - Math.cos(a2) * L2, k1[2]];
        const A = toWorld(base[0], base[1], base[2]), Bp = toWorld(k1[0], k1[1], k1[2]), C = toWorld(k2[0], k2[1], k2[2]);
        P.push({ kind: 'cap', a: A, b: Bp, r0: R, r1: R * 0.95, group: 1, box: hbox });
        P.push({ kind: 'cap', a: Bp, b: C, r0: R * 0.95, r1: R * 0.82, group: 1, box: hbox });
      }
      {
        const t0 = [-side * 0.7 * sc, -2.6 * sc, 3.4 * sc];
        const t1 = [t0[0] - side * 1.5 * sc, t0[1] - 3.4 * sc, t0[2] + 2.2 * sc];
        const t2 = [t1[0] - side * 0.9 * sc, t1[1] - 2.2 * sc, t1[2] + 0.9 * sc];
        P.push({ kind: 'cap', a: toWorld(t0[0], t0[1], t0[2]), b: toWorld(t1[0], t1[1], t1[2]), r0: 1.1 * sc, r1: 1.0 * sc, group: 1, box: hbox });
        P.push({ kind: 'cap', a: toWorld(t1[0], t1[1], t1[2]), b: toWorld(t2[0], t2[1], t2[2]), r0: 1.0 * sc, r1: 0.85 * sc, group: 1, box: hbox });
      }

      // leg (group 2 = legs: smaller blend into the torso so the hip girth stays exact)
      const lx = side * f.legX;
      const lg = rowsFrom(f.ankleH - 5, f.hipJointH + 4, 0.5, (h) => f.legRing(h, side));
      const lR = bx(lg, 1);
      P.push({ kind: 'tube', y0: f.ankleH - 5, rows: lg, group: 2, box: [lx - lR, f.ankleH - 7, -lR, lx + lR, f.hipJointH + 6, lR], map: (x, y, z, o) => { o[0] = x - lx; o[1] = y; o[2] = z; } } as Tube);
      (P[P.length - 1] as Tube & { dy?: number }).dy = 0.5;

      // foot: rings along its length, flat sole on the floor
      const FL = f.footLen;
      const fc = makeCurve([
        { k: 0, v: [0.1, 0.1] }, { k: 0.06, v: [0.15, 0.15] }, { k: 0.2, v: [0.16, 0.18] }, { k: 0.42, v: [0.165, 0.13] },
        { k: 0.68, v: [0.19, 0.085] }, { k: 0.86, v: [0.18, 0.065] }, { k: 0.97, v: [0.12, 0.045] }, { k: 1, v: [0.05, 0.03] },
      ], 0.01);
      const fr: Row[] = [];
      for (let i = 0; i <= 40; i++) {
        const [a, b] = fc(i / 40);
        fr.push({ a: a * FL, b: b * FL, cx: 0, cz: b * FL, m: new Float32Array(NA + 1).fill(1) });
      }
      const yaw = side * 0.1, cy = Math.cos(-yaw), sy = Math.sin(-yaw);
      const hz0 = -0.24 * FL;
      const footMap = (x: number, y: number, z: number, o: Float64Array) => {
        const dx = x - lx, dz = z - hz0;
        const rx = dx * cy + dz * sy, rz = -dx * sy + dz * cy; // undo the toe-out yaw
        o[0] = rx; o[1] = rz / (FL / 40); o[2] = y; // ring "z" is height above the floor
      };
      P.push({ kind: 'tube', y0: 0, rows: fr, group: 0, map: footMap, box: [lx - 8, -1, hz0 - 2, lx + 8, 0.4 * FL, hz0 + FL + 3] } as Tube);
      (P[P.length - 1] as Tube & { dy?: number }).dy = 1;
    }
  }

  private partDist(p: Part, x: number, y: number, z: number): number {
    if (p.kind === 'cap') {
      const [ax, ay, az] = p.a, [bx, by, bz] = p.b;
      const vx = bx - ax, vy = by - ay, vz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy + (z - az) * vz) / (vx * vx + vy * vy + vz * vz)));
      return Math.hypot(x - ax - vx * t, y - ay - vy * t, z - az - vz * t) - (p.r0 + (p.r1 - p.r0) * t);
    }
    if (p.kind === 'ell') {
      const q = Math.hypot((x - p.c[0]) / p.r[0], (y - p.c[1]) / p.r[1], (z - p.c[2]) / p.r[2]);
      return (q - 1) * Math.min(p.r[0], p.r[1], p.r[2]);
    }
    const o = this.o;
    p.map(x, y, z, o);
    const dy = (p as Tube & { dy: number }).dy;
    const fRow = (o[1] - p.y0) / dy;
    const last = p.rows.length - 1;
    const fc = Math.max(0, Math.min(last, fRow));
    const k = Math.min(last - 1, Math.floor(fc));
    const t = fc - k;
    const r0 = p.rows[k], r1 = p.rows[k + 1];
    const a = r0.a + (r1.a - r0.a) * t, b = r0.b + (r1.b - r0.b) * t;
    const dx = o[0] - (r0.cx + (r1.cx - r0.cx) * t), dz = o[2] - (r0.cz + (r1.cz - r0.cz) * t);
    let th = Math.atan2(dz / b, dx / a);
    if (th < 0) th += TAU;
    const jf = (th / TAU) * NA;
    const j = Math.min(NA - 1, Math.floor(jf));
    const u = jf - j;
    const m = (r0.m[j] + (r0.m[j + 1] - r0.m[j]) * u) * (1 - t) + (r1.m[j] + (r1.m[j + 1] - r1.m[j]) * u) * t;
    const rs = Math.hypot(a * m * Math.cos(th), b * m * Math.sin(th));
    const radial = Math.hypot(dx, dz) - rs;
    const over = fRow < 0 ? -fRow * dy : fRow > last ? (fRow - last) * dy : 0;
    return over > 0 ? Math.hypot(Math.max(radial, 0), over) : radial;
  }

  /** Signed distance (negative inside). */
  eval(x: number, y: number, z: number, band = 6): number {
    let main = 1e9, hand = 1e9, leg = 1e9, ear = 1e9, arm = 1e9;
    for (const p of this.parts) {
      const bb = p.box;
      if (x < bb[0] - band || x > bb[3] + band || y < bb[1] - band || y > bb[4] + band || z < bb[2] - band || z > bb[5] + band) continue;
      const d = this.partDist(p, x, y, z);
      if (p.group === 0) main = smin(main, d, 2.4);
      else if (p.group === 1) hand = smin(hand, d, 0.5);
      else if (p.group === 2) leg = smin(leg, d, 2.0);
      else if (p.group === 4) arm = Math.min(arm, d);
      else ear = Math.min(ear, d);
    }
    let d = smin(main, leg, 1.0);
    d = smin(d, arm, 1.1);
    d = smin(d, hand, 0.9);
    d = smin(d, ear, 0.35);
    return d;
  }

  grad(x: number, y: number, z: number, out: Float64Array) {
    const e = 0.05;
    out[0] = (this.eval(x + e, y, z) - this.eval(x - e, y, z)) / (2 * e);
    out[1] = (this.eval(x, y + e, z) - this.eval(x, y - e, z)) / (2 * e);
    out[2] = (this.eval(x, y, z + e) - this.eval(x, y, z - e)) / (2 * e);
  }

  /** Tape reading around the body at height h (convex hull of the surface section), from a centre point. */
  girthAt(h: number, cx = 0, cz = 0, maxR = 30): number {
    const pts: [number, number][] = [];
    for (let i = 0; i < 180; i++) {
      const th = (i / 180) * TAU;
      const dx = Math.cos(th), dz = Math.sin(th);
      // march out to the first sign change, then bisect
      let lo = 0, hi = 0;
      for (let r = 0.5; r <= maxR; r += 0.5) {
        if (this.eval(cx + dx * r, h, cz + dz * r) > 0) { hi = r; break; }
        lo = r;
      }
      if (!hi) continue;
      for (let it = 0; it < 22; it++) {
        const mid = (lo + hi) / 2;
        if (this.eval(cx + dx * mid, h, cz + dz * mid) > 0) hi = mid; else lo = mid;
      }
      const r = (lo + hi) / 2;
      pts.push([dx * r, dz * r]);
    }
    return hullLength(pts);
  }
}

/** Build a field whose surface tape-measures exactly to the body's girths. */
export function calibratedField(body: Body): BodyField {
  const f = bodyFrame(body);
  const marks: [number, number][] = [[f.hipH, body.hips], [f.waistH, body.waist], [f.chestH, body.chest]];
  let cal: Calibration = { torso: marks.map(([h]) => [h, 1]), neck: 1 };
  let field = new BodyField(body, cal);
  for (let it = 0; it < 3; it++) {
    cal = {
      torso: cal.torso.map(([h, s], i) => [h, s * (marks[i][1] / field.girthAt(h))]),
      neck: cal.neck * (body.neck / field.girthAt(f.neckMeasureH, 0, f.neckRing(f.neckMeasureH).cz ?? 0, 12)),
    };
    field = new BodyField(body, cal);
  }
  return field;
}
