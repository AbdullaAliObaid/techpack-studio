// Helpers for the edit tools: seam runs along outlines, pleat marks, attachment templates, pose limits.
import { bezAt, bezTangent, type Bez, type PPoint, type Pt } from '../lib/geometry';
import type { AttachKind, Attachment, Face, LabelType, Outline, Pleat, Sheen, ShapeLayer } from '../data/edits';
import type { StyleId } from '../data/catalog';
import type { Piece } from '../data/presets';
import * as seamsMod from '../sim/seams';
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
  { id: 'label', label: 'Tag' },
];
export const KIND_ICON: Record<AttachKind, string> = { pocket: 'pocket', patch: 'patch', applique: 'applique', strap: 'strap', embroidery: 'embroidery', print: 'print', hardware: 'hardware', label: 'tag' };
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

/* ---------- faces ---------- */

/**
 * Plain name of one face of a piece ("Top collar", "Under collar"). Uses faceLabel from src/sim/seams.ts when the
 * physics agent has added it, otherwise this local fallback.
 */
export function faceName(style: StyleId, piece: Piece | undefined, face: Face, collar?: 'down' | 'up'): string {
  const fn = (seamsMod as unknown as { faceLabel?: (s: StyleId, p: Piece, f: Face, c?: 'down' | 'up') => string }).faceLabel;
  if (piece && typeof fn === 'function') {
    try { const l = fn(style, piece, face, collar); if (l) return l; } catch { /* fall back */ }
  }
  const role = piece?.role;
  if (role === 'collar') return face === 'outside' ? 'Top collar' : 'Under collar';
  if (role === 'placket' || role === 'front') return face === 'outside' ? 'Outside' : /shirt|jacket|polo|button/i.test(style) || role === 'placket' ? 'Placket facing' : 'Inside';
  if (role === 'cuff') return face === 'outside' ? 'Outside cuff' : 'Inside cuff';
  if (role === 'brim') return face === 'outside' ? 'Top of brim' : 'Under brim';
  return face === 'outside' ? 'Outside' : 'Inside';
}

/** Which face of a piece shows when worn. Uses visibleFace from src/sim/seams.ts when present. */
export function visibleFaceOf(style: StyleId, piece: Piece, collar: 'down' | 'up' = 'down'): Face {
  const fn = (seamsMod as unknown as { visibleFace?: (s: StyleId, p: Piece, c: 'down' | 'up') => Face }).visibleFace;
  if (typeof fn === 'function') { try { return fn(style, piece, collar); } catch { /* fall back */ } }
  return 'outside';
}

/** A style has a collar piece the wearer can pop up. */
export const hasCollar = (pieces: Piece[]) => pieces.some((p) => p.role === 'collar');

/* ---------- surface look ---------- */

export const SHEEN_LABEL: Record<Sheen, string> = { matte: 'Matte', satin: 'Satin', glossy: 'Glossy', metallic: 'Metallic' };
export const CLOTH_SHEENS: Sheen[] = ['matte', 'satin', 'glossy'];
export const METAL_SHEENS: Sheen[] = ['matte', 'satin', 'glossy', 'metallic'];

/* ---------- tags ---------- */

export const LABEL_TYPES: { id: LabelType; name: string; blurb: string; color: string; sheen: Sheen }[] = [
  { id: 'woven', name: 'Woven', blurb: 'Fine threads woven into the design. Soft and flat.', color: '#f2f2f2', sheen: 'satin' },
  { id: 'printed', name: 'Printed', blurb: 'Ink printed on a flat strip.', color: '#ffffff', sheen: 'matte' },
  { id: 'satin', name: 'Satin', blurb: 'Smooth, shiny ribbon.', color: '#f2c94c', sheen: 'glossy' },
  { id: 'cotton', name: 'Cotton', blurb: 'Plain, natural and matte.', color: '#e8dcc2', sheen: 'matte' },
  { id: 'leather', name: 'Leather', blurb: 'Stiff and textured, usually stitched all round.', color: '#8a5a3c', sheen: 'satin' },
  { id: 'rubber', name: 'Rubber', blurb: 'Soft molded rubber with a slight shine.', color: '#2f2f33', sheen: 'glossy' },
];
export const SEWN_LABEL: Record<'ends' | 'all-round' | 'folded-loop', string> = { ends: 'Both ends', 'all-round': 'All round', 'folded-loop': 'Folded loop' };

/** Readable text colour on a tag colour. */
export function inkOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#111111';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

/* ---------- placing designs on pieces and on other designs ---------- */

/** Attachments that are a cloth panel and can carry designs of their own. */
export const canHostDesigns = (k: AttachKind) => k === 'pocket' || k === 'patch' || k === 'applique' || k === 'strap' || k === 'label';

/**
 * The target a new design goes onto, given what is selected: a selected pocket, patch, applique, strap or tag (or a design
 * already sewn onto one) hosts it; otherwise the selected piece. Returns the id (piece or attachment) and its kind.
 */
export function designHost(pieces: Piece[], atts: Attachment[], selPiece: string | null, selAttachment: string | null): { id: string; attachment: Attachment | null; piece: Piece | undefined } | null {
  const a = selAttachment ? atts.find((q) => q.id === selAttachment) : undefined;
  if (a) {
    if (canHostDesigns(a.kind)) return { id: a.id, attachment: a, piece: pieces.find((p) => p.id === rootPiece(atts, a)) };
    const parent = atts.find((q) => q.id === a.pieceId);
    if (parent) return { id: parent.id, attachment: parent, piece: pieces.find((p) => p.id === rootPiece(atts, parent)) };
    return { id: a.pieceId, attachment: null, piece: pieces.find((p) => p.id === a.pieceId) };
  }
  const p = pieces.find((q) => q.id === selPiece);
  return p ? { id: p.id, attachment: null, piece: p } : null;
}

/** The pattern piece an attachment finally sits on (follows designs sewn onto pockets and tags). */
export function rootPiece(atts: Attachment[], a: Attachment): string {
  let cur = a, n = 0;
  while (n++ < 6) { const parent = atts.find((q) => q.id === cur.pieceId); if (!parent) break; cur = parent; }
  return cur.pieceId;
}

/* ---------- freehand outlines ---------- */

type P = { x: number; y: number };

/** Ramer-Douglas-Peucker on an open polyline. */
function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts;
  let idx = 0, dmax = 0;
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i].x - dx * pts[i].y + b.x * a.y - b.y * a.x) / L;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)];
}

const chaikin = (pts: P[]): P[] => pts.flatMap((p, i) => { const q = pts[(i + 1) % pts.length]; return [{ x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 }, { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 }]; });

/** Normalise a closed outline: centred on its box, longest side 1. Returns [] when it is too small to use. */
export function normaliseOutline(pts: P[]): P[] {
  if (pts.length < 3) return [];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = Math.max(x1 - x0, y1 - y0);
  if (s < 1e-6) return [];
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return pts.map((p) => ({ x: Math.round(((p.x - cx) / s) * 1000) / 1000, y: Math.round(((p.y - cy) / s) * 1000) / 1000 }));
}

/** A freehand stroke (any units) to a clean, smooth, closed outline with the longest side 1. */
export function strokeToOutline(stroke: P[]): P[] {
  if (stroke.length < 4) return [];
  const xs = stroke.map((p) => p.x), ys = stroke.map((p) => p.y);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (size < 1e-6) return [];
  let pts = rdp(stroke, size * 0.02);
  // drop a closing duplicate
  if (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < size * 0.05) pts = pts.slice(0, -1);
  if (pts.length < 3) return [];
  pts = chaikin(chaikin(pts));
  return normaliseOutline(pts);
}

/** Scale an outline (longest side 1) to a size in cm. */
export const scaleOutline = (unit: P[], size: number): P[] => unit.map((p) => ({ x: Math.round(p.x * size * 1000) / 1000, y: Math.round(p.y * size * 1000) / 1000 }));

/* ---------- scaling an attachment (corner handle) ---------- */

const r2 = (n: number) => Math.round(n * 1000) / 1000;
const scaleLayers = (ls: ShapeLayer[] | undefined, s: number) => ls?.map((l) => ({ ...l, x: r2(l.x * s), y: r2(l.y * s), w: r2(l.w * s), h: r2(l.h * s) }));

/** Smallest and largest factor a corner drag may apply. */
export function scaleLimits(a: Attachment): [number, number] {
  if (a.hardware && a.hardware.type !== 'zipper') return [0.3 / a.hardware.size, 6 / a.hardware.size];
  const lo = a.hardware ? 0.4 / a.hardware.size : 0.5 / Math.min(a.w, a.h), hi = 90 / Math.max(a.w, a.h);
  return [lo, hi];
}

/** The patch that scales an attachment, artwork included, by s about its centre. */
export function scaleAttachment(a: Attachment, s: number): Partial<Attachment> {
  const patch: Partial<Attachment> = { w: r2(a.w * s), h: r2(a.h * s) };
  if (a.layers.length) patch.layers = scaleLayers(a.layers, s)!;
  if (a.points?.length) patch.points = a.points.map((p) => ({ x: r2(p.x * s), y: r2(p.y * s) }));
  const hw = a.hardware;
  if (hw) {
    const z = hw.zipper;
    const next = {
      ...hw, size: r2(hw.size * s),
      ...(hw.spacing !== undefined ? { spacing: r2(hw.spacing * s) } : {}),
      ...(hw.outline ? { outline: hw.outline.map((p) => ({ x: r2(p.x * s), y: r2(p.y * s) })) } : {}),
      ...(hw.layers ? { layers: scaleLayers(hw.layers, s) } : {}),
      ...(z ? { zipper: { ...z, ...(z.pullerOutline ? { pullerOutline: z.pullerOutline.map((p) => ({ x: r2(p.x * s), y: r2(p.y * s) })) } : {}), ...(z.pullerLayers ? { pullerLayers: scaleLayers(z.pullerLayers, s) } : {}) } } : {}),
    };
    patch.hardware = next;
    if (hw.type === 'zipper') { patch.w = next.size; patch.h = r2(a.h * s); }
    else { const n = Math.max(1, hw.count ?? 1); patch.w = n > 1 ? r2((n - 1) * (next.spacing ?? next.size * 2) + next.size) : next.size; patch.h = next.size; }
  }
  return patch;
}

/** Nudge in screen directions (right, down) in cm; copes with the mirrored left copy and a turned host. */
export function nudgePatch(atts: Attachment[], a: Attachment, dx: number, dy: number, mirrored: boolean): Partial<Attachment> {
  // chain of hosts: a design on a pocket moves in the pocket's frame
  const parent = atts.find((q) => q.id === a.pieceId);
  if (!parent) return { x: r2(a.x + (mirrored ? -dx : dx)), y: r2(a.y + dy) };
  let rot = 0, cur: Attachment | undefined = parent, n = 0;
  while (cur && n++ < 6) { rot += cur.rotation; const up: Attachment | undefined = atts.find((q) => q.id === cur!.pieceId); if (!up) { if (mirrored) rot = -rot; } cur = up; }
  const c = Math.cos((-rot * Math.PI) / 180), s = Math.sin((-rot * Math.PI) / 180);
  return { x: r2(a.x + c * dx - s * dy), y: r2(a.y + s * dx + c * dy) };
}

/* fallbacks for the fabrics agent's exports (categories, patterns, pattern tiles) and picture tracing */
export * from './shims';
export * from './uiData';
