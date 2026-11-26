// Helpers for the edit tools: seam runs along outlines, pleat marks, attachment templates, pose limits.
import { bezAt, bezTangent, type Bez, type PPoint, type Pt } from '../lib/geometry';
import type { AttachKind, Attachment, Outline, Pleat, ShapeLayer } from '../data/edits';
import { uid } from '../lib/units';
import * as poseModule from '../sim/pose';

/* ---------- seam runs ---------- */

/** Segment indices of the run between two outline points, taking the shorter way round (same rule as outlineLength). */
export function runIndices(points: PPoint[], fromId?: string, toId?: string): number[] {
  if (!fromId || !toId) return [];
  const n = points.length;
  const ia = points.findIndex((p) => p.id === fromId), ib = points.findIndex((p) => p.id === toId);
  if (ia < 0 || ib < 0 || ia === ib) return [];
  const fwd = (ib - ia + n) % n, back = (ia - ib + n) % n;
  const out: number[] = [];
  if (fwd <= back) for (let i = ia; i !== ib; i = (i + 1) % n) out.push(i);
  else for (let i = ib; i !== ia; i = (i + 1) % n) out.push(i);
  return out;
}

export function runD(bz: Bez[], idx: number[]): string {
  return idx.map((i, j) => `${j === 0 ? `M${bz[i].p0.x},${bz[i].p0.y}` : ''}C${bz[i].c1.x},${bz[i].c1.y} ${bz[i].c2.x},${bz[i].c2.y} ${bz[i].p1.x},${bz[i].p1.y}`).join('');
}

export function runMid(bz: Bez[], idx: number[]): Pt | null {
  if (!idx.length) return null;
  return bezAt(bz[idx[Math.floor(idx.length / 2)]], idx.length % 2 ? 0.5 : 0);
}

/* ---------- pleats ---------- */

export interface PleatMarks {
  lines: { a: Pt; b: Pt; fold: boolean }[];
  arrows: { from: Pt; to: Pt }[];
  notches: { a: Pt; b: Pt }[];
  anchor: Pt;
}

/** Fold lines (solid), placement lines (dashed), direction arrows and edge notches for one pleat. */
export function pleatMarks(pl: Pleat, points: PPoint[], bz: Bez[], centre: Pt): PleatMarks | null {
  const i = points.findIndex((p) => p.id === pl.pointId);
  if (i < 0) return null;
  const P = bezAt(bz[i], pl.t), T = bezTangent(bz[i], pl.t);
  let N = { x: -T.y, y: T.x };
  if (N.x * (centre.x - P.x) + N.y * (centre.y - P.y) < 0) N = { x: -N.x, y: -N.y };
  const at = (s: number, along: number): Pt => ({ x: P.x + T.x * s + N.x * along, y: P.y + T.y * s + N.y * along });
  const d = pl.depth, L = pl.length, mid = L * 0.5;
  let folds: number[] = [], places: number[] = [];
  let arrowFrom: number[] = [], arrowTo: number[] = [];
  if (pl.type === 'knife') {
    const s = pl.direction * d;
    folds = [0]; places = [s]; arrowFrom = [0]; arrowTo = [s];
  } else if (pl.type === 'box') {
    folds = [-d, d]; places = [-2 * d, 2 * d]; arrowFrom = [-d, d]; arrowTo = [-2 * d, 2 * d];
  } else {
    folds = [-2 * d, 2 * d]; places = [-d, d]; arrowFrom = [-2 * d, 2 * d]; arrowTo = [-d, d];
  }
  return {
    lines: [...folds.map((s) => ({ a: at(s, 0), b: at(s, L), fold: true })), ...places.map((s) => ({ a: at(s, 0), b: at(s, L), fold: false }))],
    arrows: arrowFrom.map((s, k) => ({ from: at(s, mid), to: at(arrowTo[k], mid) })),
    notches: [...folds, ...places].map((s) => ({ a: at(s, 0), b: at(s, -0.9) })),
    anchor: P,
  };
}

/* ---------- attachment templates ---------- */

export type AttachTemplate = Omit<Attachment, 'id' | 'pieceId' | 'x' | 'y'>;

export const KINDS: { id: AttachKind; label: string }[] = [
  { id: 'pocket', label: 'Pocket' },
  { id: 'patch', label: 'Patch' },
  { id: 'applique', label: 'Applique' },
  { id: 'strap', label: 'Strap' },
  { id: 'embroidery', label: 'Embroidery' },
  { id: 'print', label: 'Print' },
  { id: 'hardware', label: 'Hardware' },
];
export const KIND_ICON: Record<AttachKind, string> = { pocket: 'pocket', patch: 'patch', applique: 'applique', strap: 'strap', embroidery: 'embroidery', print: 'print', hardware: 'hardware', label: 'patch' };
export const KIND_LABEL: Record<AttachKind, string> = { pocket: 'Pocket', patch: 'Patch', applique: 'Appliqué', strap: 'Strap', embroidery: 'Embroidery', print: 'Print', hardware: 'Hardware', label: 'Tag' };
export const KIND_BLURB: Record<AttachKind, string> = {
  pocket: 'Cloth sewn on three sides, top open.',
  patch: 'Cloth sewn on all round.',
  strap: 'A strip sewn at both ends, like a belt loop.',
  print: 'No extra cloth. Ink printed onto the piece.',
  applique: 'A shape or letters cut from fabric and stitched down all round.',
  embroidery: 'Thread stitched into the piece.',
  hardware: 'Metal trim fixed through the fabric.',
  label: 'A clothing tag with your design, sewn inside or out.',
};
export const OUTLINE_LIST: { id: Exclude<Outline, 'custom'>; label: string }[] = [
  { id: 'rect', label: 'Square' },
  { id: 'rounded', label: 'Rounded' },
  { id: 'pointed', label: 'Pointed' },
  { id: 'circle', label: 'Circle' },
  { id: 'shield', label: 'Shield' },
];
export const OUTLINE_LABEL: Record<Outline, string> = { rect: 'Square', rounded: 'Rounded', pointed: 'Pointed', circle: 'Circle', shield: 'Shield', shape: 'Shape', custom: 'Custom' };

/** Colours offered for artwork. They are user content, not interface colours. */
export const PALETTE = ['#ffffff', '#f2c94c', '#f2994a', '#eb5757', '#bb6bd9', '#2f80ed', '#56ccf2', '#27ae60', '#828282', '#111111'];

export function layer(shape: ShapeLayer['shape'], over: Partial<ShapeLayer> = {}): ShapeLayer {
  return { id: uid(), shape, x: 0, y: 0, w: 4, h: 4, rotation: 0, color: PALETTE[1], opacity: 1, ...over };
}

export function stripeLayers(w: number, h: number, count = 3): ShapeLayer[] {
  const bh = h / (count * 2 + 1);
  return Array.from({ length: count }, (_, i) => layer('stripe', { x: 0, y: -h / 2 + bh * (1.5 + i * 2), w, h: bh, color: i % 2 ? PALETTE[0] : PALETTE[2] }));
}
/* ---------- pose limits ---------- */

export interface JointDef { key: string; side: 0 | 1 | null; label: string }
export type Limits = Record<string, [number, number]>; // degrees

const FALLBACK_LIMITS: Limits = {
  shFlex: [-60, 170], shAbd: [-30, 170], shHoriz: [-45, 90], elbow: [0, 145],
  hipFlex: [-30, 120], hipAbd: [-25, 45], knee: [0, 140],
  spineBend: [-30, 30], spineTwist: [-40, 40], headTurn: [-70, 70],
};

/** POSE_LIMITS from src/sim/pose.ts when another agent has added it, otherwise sensible defaults. Always degrees. */
export function poseLimits(): Limits {
  let raw = (poseModule as unknown as Record<string, unknown>).POSE_LIMITS as Record<string, unknown> | undefined;
  // pose.ts exports an array of { key, range: [min, max] radians }
  if (Array.isArray(raw)) raw = Object.fromEntries((raw as { key: string; range: [number, number] }[]).map((l) => [l.key, l.range]));
  const out: Limits = { ...FALLBACK_LIMITS };
  if (!raw || typeof raw !== 'object') return out;
  for (const k of Object.keys(FALLBACK_LIMITS)) {
    const v = raw[k] as unknown;
    let lo: number | undefined, hi: number | undefined;
    if (Array.isArray(v) && v.length >= 2) [lo, hi] = [Number(v[0]), Number(v[1])];
    else if (v && typeof v === 'object') { lo = Number((v as { min?: number }).min); hi = Number((v as { max?: number }).max); }
    if (lo === undefined || hi === undefined || !isFinite(lo) || !isFinite(hi)) continue;
    // values under about 7 are radians
    if (Math.max(Math.abs(lo), Math.abs(hi)) < 7) { lo *= 180 / Math.PI; hi *= 180 / Math.PI; }
    out[k] = [Math.round(lo), Math.round(hi)];
  }
  return out;
}

export const JOINT_LABEL: Record<string, string> = {
  shFlex: 'Raise forward', shAbd: 'Raise sideways', shHoriz: 'Swing across', elbow: 'Bend elbow',
  hipFlex: 'Lift forward', hipAbd: 'Swing out', knee: 'Bend knee',
  spineBend: 'Lean', spineTwist: 'Twist', headTurn: 'Turn head',
};
