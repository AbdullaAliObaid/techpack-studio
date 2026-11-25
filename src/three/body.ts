// Parametric mannequin driven by tailor measurements (all cm). Y is up, the body faces +Z.

export interface Body {
  height: number;
  chest: number;
  waist: number;
  hips: number;
  shoulder: number;
  arm: number;
  inseam: number;
  neck: number;
}

export const DEFAULT_BODY: Body = { height: 175, chest: 100, waist: 84, hips: 100, shoulder: 46, arm: 62, inseam: 80, neck: 39 };

export const BODY_FIELDS: { key: keyof Body; label: string; min: number; max: number }[] = [
  { key: 'height', label: 'Height', min: 140, max: 210 },
  { key: 'chest', label: 'Chest', min: 70, max: 150 },
  { key: 'waist', label: 'Waist', min: 55, max: 150 },
  { key: 'hips', label: 'Hips', min: 70, max: 150 },
  { key: 'shoulder', label: 'Shoulder width', min: 34, max: 60 },
  { key: 'arm', label: 'Arm length', min: 45, max: 80 },
  { key: 'inseam', label: 'Inseam', min: 60, max: 100 },
  { key: 'neck', label: 'Neck', min: 30, max: 50 },
];

export interface Ell {
  a: number; // half width (x)
  b: number; // half depth (z)
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
function makeCurve(keys: { k: number; v: number[] }[]) {
  return (k: number): number[] => {
    if (k <= keys[0].k) return keys[0].v;
    const last = keys[keys.length - 1];
    if (k >= last.k) return last.v;
    let i = 0;
    while (keys[i + 1].k < k) i++;
    const k1 = keys[i], k2 = keys[i + 1];
    const k0 = keys[Math.max(0, i - 1)], k3 = keys[Math.min(keys.length - 1, i + 2)];
    const t = (k - k1.k) / (k2.k - k1.k);
    return k1.v.map((_, j) => Math.max(0.2, cr(k0.v[j], k1.v[j], k2.v[j], k3.v[j], t)));
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
  kneeH: number;
  ankleH: number;
  torsoBottom: number;
  torsoTop: number;
  torsoAt: (h: number) => Ell;
  legAt: (h: number) => number;
  armAt: (s: number) => number;
  legX: number;
  shoulderJoint: { x: number; y: number };
  armAngle: number;
  armholeDepth: number;
}

export function bodyFrame(b: Body): BodyFrame {
  const H = b.height;
  const shoulderH = 0.815 * H;
  const neckH = shoulderH + 0.014 * H;
  const chestH = 0.72 * H;
  const waistH = 0.62 * H;
  const hipH = 0.52 * H;
  const crotchH = Math.min(b.inseam, hipH - 5);
  const kneeH = Math.min(0.285 * H, crotchH - 15);
  const ankleH = 0.045 * H;

  const chest = ellipseFromCirc(b.chest, 0.7);
  const under = ellipseFromCirc(b.chest * 0.65 + b.waist * 0.35, 0.72);
  const waist = ellipseFromCirc(b.waist, 0.74);
  const hip = ellipseFromCirc(b.hips, 0.78);
  const crotch = ellipseFromCirc(b.hips * 0.93, 0.8);
  const neck = ellipseFromCirc(b.neck * 1.1, 0.9);
  const shA = b.shoulder / 2 - 4;

  const torsoBottom = crotchH - 1;
  const torsoTop = neckH;
  const keys = [
    { k: torsoBottom - 14, v: [crotch.a * 0.95, crotch.b * 0.95] },
    { k: torsoBottom, v: [crotch.a * 0.9, crotch.b * 0.9] },
    { k: crotchH + 3, v: [crotch.a, crotch.b] },
    { k: hipH, v: [hip.a, hip.b] },
    { k: waistH, v: [waist.a, waist.b] },
    { k: chestH - 0.04 * H, v: [under.a, under.b] },
    { k: chestH, v: [chest.a, chest.b] },
    { k: shoulderH - 0.025 * H, v: [Math.max(shA + 0.8, chest.a * 0.97), chest.b * 0.9] },
    { k: shoulderH, v: [shA, chest.b * 0.72] },
    { k: neckH - 0.004 * H, v: [neck.a * 1.6, neck.b * 1.25] },
    { k: neckH, v: [neck.a, neck.b] },
  ];
  const torso = makeCurve(keys);
  const torsoAt = (h: number): Ell => {
    const [a, bb] = torso(h);
    return { a, b: bb };
  };

  const thigh = (b.hips * 0.57) / (2 * Math.PI);
  const kneeR = (b.hips * 0.37) / (2 * Math.PI);
  const calfR = (b.hips * 0.36) / (2 * Math.PI);
  const ankleR = (b.hips * 0.22) / (2 * Math.PI);
  const leg = makeCurve([
    { k: ankleH - 4, v: [ankleR * 0.95] },
    { k: ankleH, v: [ankleR] },
    { k: kneeH - 0.07 * H, v: [calfR] },
    { k: kneeH, v: [kneeR] },
    { k: (kneeH + crotchH) / 2, v: [thigh * 0.88] },
    { k: crotchH, v: [thigh] },
    { k: crotchH + 8, v: [thigh * 1.05] },
  ]);
  const legAt = (h: number) => leg(h)[0];

  const bicep = (b.chest * 0.31) / (2 * Math.PI);
  const wrist = (b.neck * 0.42) / (2 * Math.PI);
  const L = b.arm;
  const arm = makeCurve([
    { k: -bicep * 1.1, v: [bicep * 0.35] },
    { k: -bicep * 0.6, v: [bicep * 0.85] },
    { k: 0, v: [bicep * 1.1] },
    { k: 0.18 * L, v: [bicep] },
    { k: 0.48 * L, v: [bicep * 0.8] },
    { k: 0.62 * L, v: [bicep * 0.84] },
    { k: L, v: [wrist] },
  ]);
  const armAt = (s: number) => arm(s)[0];

  return {
    b, H, neckH, shoulderH, chestH, waistH, hipH, crotchH, kneeH, ankleH, torsoBottom, torsoTop, torsoAt, legAt, armAt,
    legX: hip.a * 0.47,
    shoulderJoint: { x: b.shoulder / 2 - 3, y: shoulderH - 3.5 },
    armAngle: (10 * Math.PI) / 180,
    armholeDepth: (shoulderH - chestH) * 0.85,
  };
}

/** Rough "hull" circumference around the hips and thighs below the crotch, used for long tops. */
export function hullAt(f: BodyFrame, h: number): Ell {
  if (h >= f.torsoBottom) return f.torsoAt(h);
  const base = f.torsoAt(f.crotchH + 3);
  const t = Math.min(1, (f.torsoBottom - h) / 30);
  return { a: base.a * (1 - 0.06 * t), b: base.b * (1 - 0.06 * t) };
}
