// Parametric human driven by tailor measurements (all cm). Y is up, the body faces +Z.
// Cross sections are ellipses shaped by anatomical "bumps" (pecs, shoulder blades, glutes, calves...).
// Ring angle convention: 0 = +X (body's left side on screen right), PI/2 = front (+Z), 3PI/2 = back.

export interface Body {
  height: number;
  chest: number;
  waist: number;
  hips: number;
  shoulder: number;
  arm: number;
  inseam: number;
  neck: number;
  // optional: when left empty they are estimated from the main measurements
  thigh?: number;
  calf?: number;
  bicep?: number;
  wrist?: number;
  ankle?: number;
}

/** Girths that can be typed in or estimated from the main measurements. */
export function limbGirths(b: Body) {
  return {
    thigh: b.thigh ?? b.hips * 0.575,
    calf: b.calf ?? b.hips * 0.37,
    bicep: b.bicep ?? b.chest * 0.31,
    wrist: b.wrist ?? b.neck * 0.43,
    ankle: b.ankle ?? b.hips * 0.225,
  };
}

export const DEFAULT_BODY: Body = { height: 175, chest: 100, waist: 84, hips: 100, shoulder: 46, arm: 62, inseam: 80, neck: 39 };

export const BODY_FIELDS: { key: keyof Body; label: string; min: number; max: number; advanced?: boolean }[] = [
  { key: 'height', label: 'Height', min: 140, max: 210 },
  { key: 'chest', label: 'Chest', min: 70, max: 150 },
  { key: 'waist', label: 'Waist', min: 55, max: 150 },
  { key: 'hips', label: 'Hips', min: 70, max: 150 },
  { key: 'shoulder', label: 'Shoulder width', min: 34, max: 60 },
  { key: 'arm', label: 'Arm length', min: 45, max: 80 },
  { key: 'inseam', label: 'Inseam', min: 60, max: 100 },
  { key: 'neck', label: 'Neck', min: 30, max: 50 },
  { key: 'thigh', label: 'Thigh', min: 40, max: 85, advanced: true },
  { key: 'calf', label: 'Calf', min: 28, max: 55, advanced: true },
  { key: 'bicep', label: 'Bicep', min: 22, max: 50, advanced: true },
  { key: 'wrist', label: 'Wrist', min: 13, max: 22, advanced: true },
  { key: 'ankle', label: 'Ankle', min: 17, max: 32, advanced: true },
];

export const SKIN_TONES = [
  { name: 'Mannequin', hex: '#d9dce2' },
  { name: 'Light', hex: '#f0d2bd' },
  { name: 'Medium', hex: '#d4a483' },
  { name: 'Tan', hex: '#b5805b' },
  { name: 'Deep', hex: '#7d5238' },
  { name: 'Dark', hex: '#4e3325' },
];

export interface Ell {
  a: number; // half width (x)
  b: number; // half depth (z)
}

export type Shape = (theta: number) => number;

const TAU = Math.PI * 2;
const F = Math.PI / 2; // front
const B = (3 * Math.PI) / 2; // back

const g = (x: number, mu: number, s: number) => Math.exp(-0.5 * ((x - mu) / s) ** 2);
const angDiff = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
const ga = (th: number, mu: number, s: number) => Math.exp(-0.5 * (angDiff(th, mu) / s) ** 2);

export function maxOf(shape: Shape): number {
  let m = 0;
  for (let i = 0; i < 48; i++) m = Math.max(m, shape((i / 48) * TAU));
  return m;
}

/** Measured perimeter of a shaped ellipse ring (what a tape measure would read). */
export function perimeter(a: number, b: number, shape?: Shape, n = 160): number {
  let P = 0, px = 0, pz = 0;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * TAU;
    const m = shape ? shape(th) : 1;
    const x = a * m * Math.cos(th), z = b * m * Math.sin(th);
    if (i) P += Math.hypot(x - px, z - pz);
    px = x; pz = z;
  }
  return P;
}

/** A body cross section whose shaped perimeter equals C exactly. */
export interface BRing {
  a: number;
  b: number;
  shape: Shape;
  C: number;
  cz?: number;
}

/** What a tape measure reads around a shaped ring: it bridges hollows, so this is the convex hull perimeter. */
export function tapePerimeter(a: number, b: number, shape?: Shape, n = 180): number {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * TAU;
    const m = shape ? shape(th) : 1;
    pts.push([a * m * Math.cos(th), b * m * Math.sin(th)]);
  }
  return hullLength(pts);
}

/** Perimeter of the convex hull of 2D points (monotone chain). */
export function hullLength(pts: [number, number][]): number {
  if (pts.length < 3) return 0;
  const p = [...pts].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  const h = lower.slice(0, -1).concat(upper.slice(0, -1));
  let L = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length];
    L += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return L;
}

/** A body cross section scaled so a tape around it reads exactly C. */
export function normRing(a: number, b: number, shape: Shape, C: number): BRing {
  const s = C / tapePerimeter(a, b, shape);
  return { a: a * s, b: b * s, shape, C };
}

/** Ellipse half-axes from a circumference and a depth/width ratio (Ramanujan approximation). */
export function ellipseFromCirc(C: number, k: number): Ell {
  const f = 3 * (1 + k) - Math.sqrt((3 + k) * (1 + 3 * k));
  const a = C / (Math.PI * f);
  return { a, b: a * k };
}

export function ellipseCirc(e: Ell): number {
  const { a, b } = e;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Smooth interpolation through keyframes sorted by key ascending. */
export function makeCurve(keys: { k: number; v: number[] }[], floor = 0.2) {
  return (k: number): number[] => {
    if (k <= keys[0].k) return keys[0].v;
    const last = keys[keys.length - 1];
    if (k >= last.k) return last.v;
    let i = 0;
    while (keys[i + 1].k < k) i++;
    const k1 = keys[i], k2 = keys[i + 1];
    const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
    const t = (k - k1.k) / (k2.k - k1.k);
    return k1.v.map((_, j) => Math.max(floor, cr(k0.v[j], k1.v[j], k2.v[j], k3.v[j], t)));
  };
}

export interface BodyFrame {
  b: Body;
  H: number;
  neckH: number;
  shoulderH: number;
  chestH: number;
  waistH: number;
  hipH: number;
  crotchH: number;
  hipJointH: number;
  kneeH: number;
  ankleH: number;
  torsoBottom: number;
  torsoTop: number;
  torsoAt: (h: number) => Ell;
  torsoShape: (h: number, cloth?: boolean) => Shape;
  legAt: (h: number) => number;
  legShape: (h: number, side: number) => Shape;
  legMaxAt: (h: number) => number;
  armAt: (s: number) => number;
  armShape: (s: number, side: number) => Shape;
  armMaxAt: (s: number) => number;
  armFlat: (s: number) => [number, number];
  torsoRing: (h: number) => BRing;
  legRing: (h: number, side: number) => BRing;
  armRing: (s: number, side: number) => BRing;
  neckRing: (h: number) => BRing;
  neckMeasureH: number;
  neckTop: number;
  acromion: { x: number; y: number };
  acromionS: number;
  wrist: { x: number; y: number };
  armSeg: number;
  legX: number;
  shoulderJoint: { x: number; y: number };
  armAngle: number;
  armholeDepth: number;
  armDome: number;
  upperArm: number;
  foreArm: number;
  footLen: number;
  headH: number;
  wristR: number;
  kneeR: number;
  ankleR: number;
}

export function bodyFrame(b: Body): BodyFrame {
  const H = b.height;
  const shoulderH = 0.815 * H;
  const neckH = shoulderH + 0.014 * H;
  const crotchH = Math.min(b.inseam, 0.5 * H);
  const hipH = Math.max(0.52 * H, crotchH + 7);
  const waistH = Math.max(0.62 * H, hipH + 0.08 * H);
  const chestH = Math.max(0.72 * H, waistH + 0.08 * H);
  const hipJointH = crotchH + 0.05 * H;
  const kneeH = Math.min(0.285 * H, crotchH - 15);
  const ankleH = 0.045 * H;

  // ---------------- torso ----------------
  const chest = ellipseFromCirc(b.chest, 0.68);
  const under = ellipseFromCirc(b.chest * 0.62 + b.waist * 0.38, 0.7);
  const waist = ellipseFromCirc(b.waist, 0.72);
  const hip = ellipseFromCirc(b.hips, 0.76);
  const seat = ellipseFromCirc(b.hips * 0.97, 0.78);
  const crotch = ellipseFromCirc(b.hips * 0.86, 0.8);
  const neck = ellipseFromCirc(b.neck * 1.05, 0.92);
  const shA = b.shoulder / 2 - 4;

  const torsoBottom = crotchH - 2.5;
  const torsoTop = neckH;
  const torso = makeCurve([
    { k: torsoBottom - 6, v: [crotch.a * 0.3, crotch.b * 0.25] },
    { k: torsoBottom, v: [crotch.a * 0.32, crotch.b * 0.28] },
    { k: crotchH, v: [crotch.a * 0.7, crotch.b * 0.62] },
    { k: crotchH + 3.5, v: [crotch.a, crotch.b] },
    { k: (hipH + crotchH) / 2, v: [seat.a, seat.b] },
    { k: hipH, v: [hip.a, hip.b] },
    { k: hipH + (waistH - hipH) * 0.45, v: [hip.a * 0.55 + waist.a * 0.45, hip.b * 0.5 + waist.b * 0.5] },
    { k: waistH, v: [waist.a, waist.b] },
    { k: chestH - 0.045 * H, v: [under.a, under.b] },
    { k: chestH, v: [chest.a, chest.b] },
    { k: shoulderH - 0.03 * H, v: [Math.max(shA + 1, chest.a * 1.0), chest.b * 0.9] },
    { k: shoulderH - 0.008 * H, v: [shA, chest.b * 0.74] },
    { k: shoulderH + 0.004 * H, v: [shA * 0.82, chest.b * 0.62] },
    { k: neckH - 0.002 * H, v: [neck.a * 1.35, neck.b * 1.18] },
    { k: neckH, v: [neck.a, neck.b] },
  ]);
  const torsoAt = (h: number): Ell => {
    const [a, bb] = torso(h);
    return { a, b: bb };
  };

  const pecAmp = 0.06 + 0.12 * Math.max(0, b.chest / b.waist - 1.08);
  const gluteAmp = 0.07 + 0.18 * Math.max(0, b.hips / b.waist - 1.08);
  const torsoShape = (h: number, cloth = false): Shape => {
    const wPec = pecAmp * g(h, chestH - 0.014 * H, 0.026 * H);
    const wStern = 0.02 * g(h, chestH - 0.01 * H, 0.04 * H);
    const wScap = 0.05 * g(h, chestH + 0.025 * H, 0.032 * H);
    const wSpine = 0.035 * g(h, waistH + 0.05 * H, 0.09 * H);
    const wGlute = gluteAmp * g(h, (hipH + crotchH) / 2 - 0.004 * H, 0.032 * H);
    const wCleft = 0.06 * g(h, crotchH + 0.025 * H, 0.03 * H);
    const wAbs = 0.022 * g(h, waistH - 0.025 * H, 0.04 * H);
    const wClav = 0.035 * g(h, shoulderH - 0.012 * H, 0.012 * H);
    const wLat = 0.025 * g(h, chestH - 0.03 * H, 0.04 * H);
    const wTrap = 0.05 * g(h, shoulderH + 0.002 * H, 0.008 * H);
    return (th) => {
      let m = 1;
      m += wPec * (ga(th, F - 0.5, 0.36) + ga(th, F + 0.5, 0.36));
      m += wScap * (ga(th, B - 0.62, 0.42) + ga(th, B + 0.62, 0.42));
      m += wGlute * (ga(th, B - 0.48, 0.42) + ga(th, B + 0.48, 0.42));
      m += wAbs * ga(th, F, 0.6);
      m += wClav * (ga(th, F - 0.8, 0.35) + ga(th, F + 0.8, 0.35));
      m += wLat * (ga(th, 0, 0.5) + ga(th, Math.PI, 0.5));
      m += wTrap * ga(th, B, 0.9);
      if (!cloth) {
        m -= wStern * ga(th, F, 0.13);
        m -= wSpine * ga(th, B, 0.12);
        m -= wCleft * ga(th, B, 0.09);
      }
      return m;
    };
  };

  // ---------------- legs ----------------
  const lg = limbGirths(b);
  const thigh = lg.thigh / TAU;
  const kneeR = (lg.thigh * 0.64) / TAU;
  const calfR = lg.calf / TAU;
  const ankleR = lg.ankle / TAU;
  const leg = makeCurve([
    { k: ankleH - 5, v: [ankleR * 0.92] },
    { k: ankleH, v: [ankleR] },
    { k: ankleH + 0.06 * H, v: [ankleR * 1.12] },
    { k: kneeH - 0.07 * H, v: [calfR * 0.93] },
    { k: kneeH, v: [kneeR] },
    { k: kneeH + 0.06 * H, v: [kneeR * 1.12] },
    { k: (kneeH + crotchH) / 2 + 0.03 * H, v: [thigh * 0.9] },
    { k: crotchH, v: [thigh] },
    { k: hipJointH + 1, v: [thigh * 1.0] },
    { k: hipJointH + 4, v: [thigh * 0.8] },
  ]);
  const legAt = (h: number) => leg(h)[0];
  const thighMid = (crotchH + kneeH) / 2;
  const legShape = (h: number, side: number): Shape => {
    const outer = side > 0 ? 0 : Math.PI;
    const inner = side > 0 ? Math.PI : 0;
    const calfDir = side > 0 ? (5 * Math.PI) / 4 : (7 * Math.PI) / 4;
    const wQuad = 0.06 * g(h, thighMid + 0.03 * H, 0.08 * H);
    const wOut = 0.03 * g(h, thighMid + 0.02 * H, 0.1 * H);
    const wAdd = 0.05 * g(h, crotchH - 0.02 * H, 0.045 * H);
    const wCap = 0.08 * g(h, kneeH + 0.004 * H, 0.016 * H);
    const wPop = 0.035 * g(h, kneeH, 0.02 * H);
    const wCalf = 0.15 * g(h, kneeH - 0.065 * H, 0.045 * H);
    const wShin = 0.03 * g(h, (kneeH + ankleH) / 2, 0.06 * H);
    const wMall = 0.08 * g(h, ankleH + 0.004 * H, 0.01 * H);
    const wAch = 0.05 * g(h, ankleH + 0.02 * H, 0.03 * H);
    return (th) =>
      1 +
      wQuad * ga(th, F, 0.75) +
      wOut * ga(th, outer, 0.8) +
      wAdd * ga(th, inner, 0.65) +
      wCap * ga(th, F, 0.42) -
      wPop * ga(th, B, 0.5) +
      wCalf * ga(th, calfDir, 0.75) -
      wShin * ga(th, F, 0.5) +
      wMall * (ga(th, 0, 0.3) + ga(th, Math.PI, 0.3)) -
      wAch * (ga(th, B - 0.5, 0.25) + ga(th, B + 0.5, 0.25));
  };
  const legMaxAt = (h: number) => legAt(h) * Math.max(maxOf(legShape(h, 1)), 1);

  // ---------------- arms ----------------
  const bicep = lg.bicep / TAU;
  const R0 = bicep * 1.12;
  const acromion = { x: b.shoulder / 2, y: shoulderH };
  const joint = { x: b.shoulder / 2 - 0.55 * R0, y: shoulderH - 0.6 * R0 };
  // relaxed A-pose: open the arms just enough that they clear the torso at the chest line (like a fitting stance)
  let armAngle = (20 * Math.PI) / 180;
  for (let deg = 20; deg <= 40; deg++) {
    armAngle = (deg * Math.PI) / 180;
    const sc = (joint.y - chestH) / Math.cos(armAngle);
    const inner = joint.x + sc * Math.sin(armAngle) - bicep * 1.15;
    if (inner >= chest.a * 1.06 + 2.5) break;
  }
  const u = { x: Math.sin(armAngle), y: -Math.cos(armAngle) }; // down the arm
  const d = { x: acromion.x - joint.x, y: acromion.y - joint.y };
  const du = d.x * u.x + d.y * u.y;
  const L = du + Math.sqrt(du * du - (d.x * d.x + d.y * d.y) + b.arm * b.arm); // joint to wrist along the arm
  const wrist = { x: joint.x + L * u.x, y: joint.y + L * u.y };
  const upperArm = 0.56 * L;
  const foreArm = L - upperArm;
  const wristR = lg.wrist / TAU;
  const arm = makeCurve([
    { k: 0, v: [bicep * 1.12] },
    { k: 0.2 * L, v: [bicep] },
    { k: upperArm - 0.03 * L, v: [bicep * 0.82] },
    { k: upperArm + 0.08 * L, v: [bicep * 0.86] },
    { k: L - 0.12 * L, v: [wristR * 1.12] },
    { k: L, v: [wristR] },
    { k: L + 3, v: [wristR * 0.95] },
  ]);
  // shoulder end of the arm is a rounded dome (the deltoid cap) instead of a cone
  const dome = R0 * 0.8;
  const armAt = (s: number) => (s < 0 ? R0 * Math.sqrt(Math.max(0.04, 1 - (s / dome) ** 2)) : arm(s)[0]);
  const armShape = (s: number, side: number): Shape => {
    const outer = side > 0 ? 0 : Math.PI;
    const of = side > 0 ? Math.PI / 4 : (3 * Math.PI) / 4;
    const wDelt = 0.13 * g(s, 0.05 * L, 0.08 * L);
    const wBi = 0.08 * g(s, 0.3 * L, 0.09 * L);
    const wTri = 0.07 * g(s, 0.24 * L, 0.11 * L);
    const wElb = 0.08 * g(s, upperArm, 0.022 * L);
    const wFore = 0.09 * g(s, upperArm + 0.1 * L, 0.07 * L);
    return (th) =>
      1 + wDelt * ga(th, outer, 0.95) + wBi * ga(th, F, 0.6) + wTri * ga(th, B, 0.7) + wElb * ga(th, B, 0.35) + wFore * ga(th, of, 0.6);
  };
  const armMaxAt = (s: number) => armAt(s) * Math.max(maxOf(armShape(s, 1)), 1);
  /** forearm flattens toward the wrist: [x scale, z scale] */
  const armFlat = (s: number): [number, number] => {
    const t = Math.min(1, Math.max(0, (s - upperArm) / foreArm));
    return [1 - 0.2 * t, 1 + 0.16 * t];
  };

  const torsoRing = (h: number): BRing => {
    const e = torsoAt(h);
    return normRing(e.a, e.b, torsoShape(h), ellipseCirc(e));
  };
  const legRing = (h: number, side: number): BRing => {
    const r = legAt(h);
    return normRing(r, r, legShape(h, side), TAU * r);
  };
  const armRing = (s: number, side: number): BRing => {
    const r = armAt(s);
    const [fx, fz] = armFlat(s);
    return normRing(r * fx, r * fz, armShape(s, side), ellipseCirc({ a: r * fx, b: r * fz }));
  };
  // neck: the tape reading at neckMeasureH equals the neck measurement
  const neckTop = neckH + 0.06 * H;
  const neckMeasureH = neckH + 0.027 * H;
  const neckRing = (h: number): BRing => {
    const t = Math.max(0, (h - neckH) / (neckTop - neckH));
    const flare = 0.28 * Math.max(0, 1 - t / 0.45) ** 2;
    const C = b.neck * (1 + flare - 0.06 * (t - 0.45));
    const e = ellipseFromCirc(C, 0.9 + flare * 0.2);
    return { a: e.a, b: e.b, shape: () => 1, C, cz: 0.012 * H * t - flare * 2.2 };
  };

  return {
    torsoRing, legRing, armRing, neckRing, neckMeasureH, neckTop, acromion, acromionS: du, wrist, armSeg: L,
    b, H, neckH, shoulderH, chestH, waistH, hipH, crotchH, hipJointH, kneeH, ankleH, torsoBottom, torsoTop,
    torsoAt, torsoShape, legAt, legShape, legMaxAt, armAt, armShape, armMaxAt, armFlat,
    legX: hip.a * 0.46,
    shoulderJoint: joint,
    armAngle,
    armholeDepth: (shoulderH - chestH) * 0.85,
    armDome: dome,
    upperArm, foreArm,
    footLen: 0.152 * H,
    headH: H - (neckH + 0.029 * H),
    wristR, kneeR, ankleR,
  };
}

/** Rough "hull" around the hips and thighs below the crotch, used for long tops. */
export function hullAt(f: BodyFrame, h: number): Ell {
  const base = f.torsoAt(f.crotchH + 3.5);
  if (h >= f.crotchH + 3.5) return f.torsoAt(h);
  const t = Math.min(1, (f.torsoBottom - h) / 30);
  return { a: base.a * (1 - 0.04 * t), b: base.b * (1 - 0.04 * t) };
}
