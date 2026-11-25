import type { Piece, SpecDef, GarmentType } from '../data/presets';
import { bbox, bezAt, bezTangent, dist, outlineLength, samplePoly, sliceSpan, toBeziers, type Pt } from './geometry';
import type { Attachment, Edits, Pleat } from '../data/edits';
import { outlinePolygon } from './shapes';
import { derivedGirths, EASE, RIB, frontOffset, neckBase } from '../data/draft';
import { migrateGarment, styleById } from '../data/catalog';
import { bodyFrame, type Body } from '../three/body';

export interface SpecValue {
  label: string;
  value: number; // cm
  a: Pt; // measurement line endpoints, piece-local
  b: Pt;
  vertical?: boolean;
}

export const findTag = (p: Piece, tag: string) => p.points.find((q) => q.tag === tag);

export function computeSpec(p: Piece, s: SpecDef, poly = samplePoly(p.points)): SpecValue | null {
  switch (s.kind) {
    case 'length': {
      const bb = bbox(poly);
      const x = bb.maxX + 5;
      return { label: s.label, value: bb.h, a: { x, y: bb.minY }, b: { x, y: bb.maxY }, vertical: true };
    }
    case 'slice': {
      const t = findTag(p, s.tag);
      if (!t) return null;
      const y = t.y + (s.dy ?? 0);
      const span = s.full ? sliceSpan(poly, y) : sliceSpan(poly, y, t.x);
      if (!span) return null;
      return { label: s.label, value: span.x2 - span.x1, a: { x: span.x1, y }, b: { x: span.x2, y } };
    }
    case 'mirror': {
      const t = findTag(p, s.tag);
      if (!t) return null;
      const m = p.points.find((q) => q.id === t.mirror && q.id !== t.id) ?? p.points.find((q) => q.tag === s.tag && q.id !== t.id);
      if (!m) return null;
      const off = s.off ?? 0;
      return { label: s.label, value: dist(t, m), a: { x: m.x, y: m.y + off }, b: { x: t.x, y: t.y + off } };
    }
    case 'dist': {
      const a = findTag(p, s.tags[0]);
      const b = findTag(p, s.tags[1]);
      if (!a || !b) return null;
      const off = s.off ?? 0;
      return { label: s.label, value: dist(a, b), a: { x: a.x, y: a.y + off }, b: { x: b.x, y: b.y + off } };
    }
    case 'vdist': {
      const a = findTag(p, s.tags[0]);
      const b = findTag(p, s.tags[1]);
      if (!a || !b) return null;
      const x = Math.min(a.x, b.x) - 4;
      return { label: s.label, value: Math.abs(b.y - a.y), a: { x, y: a.y }, b: { x, y: b.y }, vertical: true };
    }
  }
}

/** Piece measurements; with edits, also the fabric each pleat on the piece takes out of its edge. */
export function pieceSpecs(p: Piece, edits?: Edits): SpecValue[] {
  const poly = samplePoly(p.points);
  const rows = p.specs.map((s) => computeSpec(p, s, poly)).filter((v): v is SpecValue => !!v);
  for (const pl of edits?.pleats ?? []) {
    if (pl.pieceId !== p.id) continue;
    const g = pleatMarks(p, pl);
    if (g) rows.push({ label: `Pleat intake (${pl.type})`, value: pleatIntake(pl), a: g.a, b: g.b });
  }
  return rows;
}

/** Fabric a pleat takes out of its edge: a knife pleat 2 x depth, a box or inverted pleat (two folds) 4 x depth. */
export const pleatIntake = (pl: Pleat) => (pl.type === 'knife' ? 2 : 4) * Math.max(0, pl.depth);

/**
 * Where a pleat sits on its piece: a..b is the intake along the edge (the two points brought together),
 * folds are the fold lines (edge point and the end of the stitching, `length` into the piece), notches
 * are the edge marks a cutter snips.
 */
export function pleatMarks(p: Piece, pl: Pleat) {
  const si = p.points.findIndex((q) => q.id === pl.pointId);
  const bz = si >= 0 ? toBeziers(p.points)[si] : undefined;
  if (!bz || !(pl.depth > 0)) return null;
  const t = Math.max(0, Math.min(1, pl.t));
  const at = bezAt(bz, t), tg = bezTangent(bz, t);
  const tl = Math.hypot(tg.x, tg.y) || 1;
  const te = { x: (tg.x / tl) * (pl.direction < 0 ? -1 : 1), y: (tg.y / tl) * (pl.direction < 0 ? -1 : 1) };
  // into the piece: the side of the edge the piece lies on
  const poly = samplePoly(p.points);
  let n = { x: -te.y, y: te.x };
  const inside = (q: Pt) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const A = poly[i], B = poly[j]; if (A.y > q.y !== B.y > q.y && q.x < ((B.x - A.x) * (q.y - A.y)) / (B.y - A.y) + A.x) c = !c; } return c; };
  if (!inside({ x: at.x + n.x * 0.3, y: at.y + n.y * 0.3 })) n = { x: -n.x, y: -n.y };
  const I = pleatIntake(pl);
  const s0 = pl.type === 'knife' ? 0 : -I / 2;
  const P = (s: number) => ({ x: at.x + te.x * s, y: at.y + te.y * s });
  const a = P(s0), b = P(s0 + I);
  const notchAt = pl.type === 'knife' ? [0, I] : [-I / 2, 0, I / 2];
  const notches = notchAt.map((s) => P(s));
  const foldAt = pl.type === 'knife' ? [0, I / 2] : [-I / 4, I / 4];
  const folds = [...notchAt, ...foldAt].filter((v, i, all) => all.indexOf(v) === i).map((s) => { const q = P(s); return [q, { x: q.x + n.x * pl.length, y: q.y + n.y * pl.length }] as [Pt, Pt]; });
  return { a, b, notches, folds, n };
}

const famOf = (type: GarmentType) => styleById(migrateGarment(type)).family;
const isHat = (type: GarmentType) => ['bucket', 'cap'].includes(famOf(type));

/** Outline segments (index of their start point) between two points, the shorter way round, as outlineLength takes them. */
function edgeSegments(p: Piece, fromId: string, toId: string): number[] {
  const n = p.points.length;
  const ia = p.points.findIndex((q) => q.id === fromId), ib = p.points.findIndex((q) => q.id === toId);
  if (ia < 0 || ib < 0) return [];
  const fwd = (ib - ia + n) % n, back = (ia - ib + n) % n;
  const out: number[] = [];
  if (fwd <= back) for (let i = ia; i !== ib; i = (i + 1) % n) out.push(i);
  else for (let i = ib; i !== ia; i = (i + 1) % n) out.push(i);
  return out;
}

/** Pleat intake on an edge (cm): pleats folded into it shorten what gets sewn to the next piece. */
export function pleatIntakeOn(p: Piece, fromId: string, toId: string, edits?: Edits) {
  const pls = (edits?.pleats ?? []).filter((q) => q.pieceId === p.id);
  if (!pls.length) return 0;
  const segs = edgeSegments(p, fromId, toId);
  return pls.reduce((sum, pl) => sum + (segs.includes(p.points.findIndex((q) => q.id === pl.pointId)) ? pleatIntake(pl) : 0), 0);
}

/** Sewn length of an edge between two point ids (shorter way round), less the pleats folded into it. */
export function sewnLength(p: Piece, fromId: string, toId: string, edits?: Edits) {
  return outlineLength(p.points, fromId, toId) - pleatIntakeOn(p, fromId, toId, edits);
}

let reportEdits: Edits | undefined; // pleats taken into account by edgeLen while a seam report is built

/** Edge length along a piece between two keyed points (shorter way round), less pleat intake. */
function edgeLen(p: Piece | undefined, a: string, b: string) {
  if (!p) return 0;
  const pa = p.points.find((q) => q.key === a), pb = p.points.find((q) => q.key === b);
  return pa && pb ? sewnLength(p, pa.id, pb.id, reportEdits) : 0;
}

function specOf(pieces: Piece[], role: string, label: string) {
  const p = pieces.find((q) => q.role === role);
  if (!p) return 0;
  const s = p.specs.find((q) => q.label === label);
  return s ? computeSpec(p, s)?.value ?? 0 : 0;
}

/** Neckline a trim is sewn to: front + back neck, both sides, plus the placket top on a polo. */
function necklineLen(type: GarmentType, pieces: Piece[]) {
  const f = pieces.find((p) => p.role === 'front'), bk = pieces.find((p) => p.role === 'back');
  const fo = frontOffset(migrateGarment(type));
  const pl = pieces.find((p) => p.role === 'placket');
  const plTop = pl ? 2 * edgeLen(pl, 'placket.0', 'placket.1') : 0;
  return 2 * (edgeLen(f, `front.${fo}`, `front.${fo + 2}`) + edgeLen(bk, 'back.0', 'back.2')) + plTop;
}

/** Hat band = the six crown panel bases. */
const hatBand = (pieces: Piece[]) => 6 * specOf(pieces, 'crown', 'Panel base');
const crownDepth = (pieces: Piece[]) => edgeLen(pieces.find((p) => p.role === 'crown'), 'crown.0', 'crown.3');

/** Finished garment measurements, i.e. what a factory spec sheet lists. */
export function garmentSpecs(type: GarmentType, pieces: Piece[]): { label: string; value: number }[] {
  const get = (role: string, label: string) => specOf(pieces, role, label);
  const fam = famOf(type);
  if (fam === 'pants') {
    const rows = [
      { label: 'Waist circumference', value: 2 * (get('front', 'Waist') + get('back', 'Waist')) },
      { label: 'Hip circumference', value: 2 * (get('front', 'Hip') + get('back', 'Hip')) },
      { label: 'Thigh circumference', value: get('front', 'Thigh') + get('back', 'Thigh') },
      { label: 'Knee circumference', value: get('front', 'Knee') + get('back', 'Knee') },
      { label: 'Leg opening', value: get('front', 'Leg opening') + get('back', 'Leg opening') },
      { label: 'Front rise', value: get('front', 'Rise') },
      { label: 'Back rise', value: get('back', 'Rise') },
      { label: 'Outseam', value: get('front', 'Length') },
    ].filter((r) => r.label !== 'Knee circumference' || r.value > 0);
    const wb = pieces.find((p) => p.role === 'waistband');
    if (wb?.elastic) rows.push({ label: 'Waist elastic (relaxed)', value: wb.elastic });
    if (pieces.some((p) => p.role === 'cuff')) rows.push({ label: 'Ankle cuff', value: get('cuff', 'Cuff length') });
    return rows;
  }
  if (isHat(type)) {
    return [
      { label: 'Head band circumference', value: hatBand(pieces) },
      { label: 'Crown depth', value: crownDepth(pieces) },
      fam === 'cap' ? { label: 'Visor depth', value: get('brim', 'Visor depth') } : { label: 'Brim width', value: get('brim', 'Brim width') },
    ];
  }
  const short = fam === 'tee' || fam === 'polo';
  const rows = [
    { label: 'Chest circumference', value: get('front', 'Chest') + get('back', 'Chest') },
    { label: 'Waist circumference', value: get('front', 'Waist') + get('back', 'Waist') },
    { label: 'Hem circumference', value: get('front', 'Hem') + get('back', 'Hem') },
    { label: 'Shoulder width', value: get('back', 'Shoulder') },
    { label: 'Body length (CB)', value: get('back', 'Length') },
    { label: 'Sleeve length', value: get('sleeve', 'Length') },
    { label: 'Bicep circumference', value: get('sleeve', 'Bicep') },
    short ? { label: 'Sleeve opening', value: get('sleeve', 'Opening') } : { label: 'Cuff opening', value: get('sleeve', 'Cuff') },
  ];
  if (fam === 'tee') rows.push({ label: 'Neck opening', value: necklineLen(type, pieces) }, { label: 'Neckband length', value: get('neckband', 'Neckband length') });
  if (pieces.some((p) => p.role === 'placket')) rows.push({ label: 'Placket length', value: get('placket', 'Length') });
  return rows;
}

export interface FitRow {
  label: string;
  body: number | null; // body measurement (cm), null when not comparable
  garment: number;
  estimated?: boolean; // body value derived from other measurements
  length?: boolean; // a length, where a difference is a style choice rather than tightness
}

/** Body vs garment, i.e. where the ease comes from. */
export function fitTable(type: GarmentType, pieces: Piece[], b: Body): FitRow[] {
  const gs = Object.fromEntries(garmentSpecs(type, pieces).map((r) => [r.label, r.value]));
  const d = derivedGirths(b);
  const f = bodyFrame(b);
  const fam = famOf(type);
  const collar = pieces.find((p) => p.role === 'collar');
  const collarLen = collar ? computeSpec(collar, collar.specs[0])?.value ?? 0 : 0;
  if (fam === 'pants') {
    const front = pieces.find((p) => p.role === 'front');
    const inseam = front ? computeSpec(front, { label: 'Inseam', kind: 'vdist', tags: ['crotch', 'hem'] })?.value ?? 0 : 0;
    const wb = pieces.find((p) => p.role === 'waistband');
    const rows: FitRow[] = [
      { label: 'Waist', body: b.waist, garment: gs['Waist circumference'] },
      ...(wb?.elastic ? [{ label: 'Waist elastic', body: b.waist, garment: wb.elastic }] : []),
      { label: 'Hip', body: b.hips, garment: gs['Hip circumference'] },
      { label: 'Thigh', body: d.thigh, garment: gs['Thigh circumference'], estimated: b.thigh === undefined },
      ...(gs['Knee circumference'] ? [{ label: 'Knee', body: d.knee, garment: gs['Knee circumference'], estimated: true }] : []),
      // shorts end on the thigh, everything else at the ankle
      gs['Knee circumference']
        ? { label: 'Leg opening', body: d.ankle, garment: gs['Leg opening'], estimated: b.ankle === undefined }
        : { label: 'Leg opening', body: d.thigh, garment: gs['Leg opening'], estimated: b.thigh === undefined },
      ...(gs['Ankle cuff'] ? [{ label: 'Ankle cuff', body: d.ankle, garment: gs['Ankle cuff'], estimated: b.ankle === undefined }] : []),
      { length: true, label: 'Front rise', body: f.waistH - f.crotchH, garment: gs['Front rise'] + bandH(pieces), estimated: true },
      { length: true, label: 'Inseam', body: b.inseam, garment: inseam },
      { length: true, label: 'Outseam', body: f.waistH, garment: gs['Outseam'] + bandH(pieces), estimated: true },
    ];
    return rows;
  }
  if (isHat(type)) {
    return [
      { label: 'Head', body: d.head, garment: gs['Head band circumference'], estimated: b.head === undefined },
      { length: true, label: 'Crown depth', body: null, garment: gs['Crown depth'] },
    ];
  }
  if (fam === 'tee' || fam === 'polo') {
    return [
      { label: 'Chest', body: b.chest, garment: gs['Chest circumference'] },
      { label: 'Waist', body: b.waist, garment: gs['Waist circumference'] },
      { label: 'Hem / hips', body: b.hips, garment: gs['Hem circumference'] },
      { length: true, label: 'Shoulder', body: b.shoulder, garment: gs['Shoulder width'] },
      // a knit neckline sits at the base of the neck, which is wider than the neck measurement
      { label: 'Neck base', body: neckBase(b), garment: fam === 'tee' ? gs['Neck opening'] : collarLen, estimated: true },
      { length: true, label: 'Sleeve length', body: null, garment: gs['Sleeve length'] },
      { label: 'Bicep', body: d.bicep, garment: gs['Bicep circumference'], estimated: b.bicep === undefined },
      { label: 'Sleeve opening', body: d.bicep, garment: gs['Sleeve opening'], estimated: b.bicep === undefined },
    ];
  }
  const shirt = fam === 'shirt';
  return [
    { label: 'Chest', body: b.chest, garment: gs['Chest circumference'] },
    { label: 'Waist', body: b.waist, garment: gs['Waist circumference'] },
    { label: 'Hem / hips', body: b.hips, garment: gs['Hem circumference'] },
    { length: true, label: 'Shoulder', body: b.shoulder, garment: gs['Shoulder width'] },
    { label: 'Neck', body: b.neck, garment: collarLen },
    { length: true, label: 'Sleeve / arm', body: b.arm, garment: gs['Sleeve length'] + (shirt ? 6 : 0) },
    { label: 'Bicep', body: d.bicep, garment: gs['Bicep circumference'], estimated: b.bicep === undefined },
    { label: 'Cuff / wrist', body: d.wrist, garment: shirt ? collarCuff(pieces) : gs['Cuff opening'], estimated: b.wrist === undefined },
  ];
}

function bandH(pieces: Piece[]) {
  const wb = pieces.find((p) => p.role === 'waistband');
  return wb ? bbox(wb.points).h : 0;
}

function collarCuff(pieces: Piece[]) {
  const c = pieces.find((p) => p.role === 'cuff');
  return c ? computeSpec(c, c.specs[0])?.value ?? 0 : 0;
}

export interface SeamRow {
  label: string;
  a: number; // first edge length (cm)
  b: number; // edge it is sewn to
  ease?: number; // intended difference (cap ease, pleat, rib stretch); undefined means the two must match
  /** sewing lines the row covers: built-in seam ids (src/sim/seams.ts) or a custom seam id */
  seams?: string[];
  /** an attachment sewn onto a piece rather than a seam between two pieces */
  attachment?: string;
}

/**
 * Every sewing line with both edge lengths, like a seam-walking check on a cutting table.
 * With edits: pleat intake comes off the edges it is folded into, detached seams drop out,
 * custom seams and cloth attachments are added.
 */
export function seamReport(type: GarmentType, pieces: Piece[], edits?: Edits): SeamRow[] {
  reportEdits = edits;
  try {
    const rows = baseSeamRows(type, pieces);
    if (!edits) return rows;
    const off = new Set(edits.detachedSeams);
    const out = rows.filter((r) => !r.seams || !r.seams.every((id) => off.has(id)));
    const name = (id: string) => pieces.find((p) => p.id === id)?.name ?? 'piece';
    for (const cs of edits.customSeams) {
      const pa = pieces.find((p) => p.id === cs.a.pieceId), pb = pieces.find((p) => p.id === cs.b.pieceId);
      if (!pa || !pb) continue;
      out.push({ label: `Custom seam (${name(pa.id)} / ${name(pb.id)})`, a: sewnLength(pa, cs.a.fromId, cs.a.toId, edits), b: sewnLength(pb, cs.b.fromId, cs.b.toId, edits), seams: [cs.id] });
    }
    for (const r of attachmentReport(pieces, edits)) {
      if (r.kind === 'print') continue;
      out.push({ label: `${r.name} on ${r.host} (${r.stitched})`, a: r.sewnLength, b: r.sewnLength, attachment: r.id });
    }
    return out;
  } finally {
    reportEdits = undefined;
  }
}

export interface AttachmentRow {
  id: string;
  name: string;
  kind: Attachment['kind'];
  host: string;
  w: number;
  h: number;
  /** centre on the host piece, its local pattern coords (cm), and rotation (degrees) */
  x: number;
  y: number;
  rotation: number;
  /** artwork layers (emblem / print shapes) */
  layers: number;
  /** how it is sewn on, in plain words */
  stitched: string;
  /** stitched length (cm); 0 for a print */
  sewnLength: number;
  /** copies on the garment: a piece cut twice carries it on both sides unless one side is chosen */
  copies: number;
}

const perimeter = (pts: Pt[]) => pts.reduce((s, q, i) => s + dist(q, pts[(i + 1) % pts.length]), 0);

/** Attachments (pockets, patches, straps, prints) and user pieces patched on, for the spec sheet. */
export function attachmentReport(pieces: Piece[], edits?: Edits): AttachmentRow[] {
  const rows: AttachmentRow[] = [];
  for (const a of edits?.attachments ?? []) {
    const host = pieces.find((p) => p.id === a.pieceId);
    const poly = outlinePolygon(a.outline, a.w, a.h, a.points);
    const P = perimeter(poly);
    const top = poly.filter((q) => q.y < Math.min(...poly.map((r) => r.y)) + 0.05);
    const mouth = top.length >= 2 ? Math.max(...top.map((q) => q.x)) - Math.min(...top.map((q) => q.x)) : 0;
    const short = Math.min(a.w, a.h);
    const [stitched, sewn] = a.kind === 'pocket' ? ['3 sides, top open', P - mouth]
      : a.kind === 'strap' ? ['both ends', 2 * short]
      : a.kind === 'patch' ? ['all round', P]
      : ['printed', 0];
    const cut = host?.cut ?? 1;
    rows.push({
      id: a.id, name: a.name, kind: a.kind, host: host?.name ?? 'missing piece', w: a.w, h: a.h, x: a.x, y: a.y, rotation: a.rotation,
      layers: a.layers.length, stitched, sewnLength: sewn, copies: a.instance !== undefined ? 1 : cut,
    });
  }
  for (const p of pieces) {
    const pl = p.placement;
    if (p.role !== 'custom' || pl?.mode !== 'patch') continue;
    const host = pieces.find((q) => q.id === pl.hostPieceId);
    const bb = bbox(p.points);
    rows.push({
      id: p.id, name: p.name, kind: 'patch', host: host?.name ?? 'missing piece', w: bb.w, h: bb.h, x: pl.x ?? 0, y: pl.y ?? 0, rotation: pl.rotation ?? 0,
      layers: 0, stitched: 'all round', sewnLength: perimeter(samplePoly(p.points, 12)), copies: host?.cut ?? 1,
    });
  }
  return rows;
}

export interface PleatRow {
  id: string;
  piece: string;
  type: Pleat['type'];
  depth: number;
  intake: number;
  length: number;
  /** position on the outline: the point the pleat's segment starts at, and how far along it */
  at: string;
}

export function pleatReport(pieces: Piece[], edits?: Edits): PleatRow[] {
  return (edits?.pleats ?? []).flatMap((pl) => {
    const p = pieces.find((q) => q.id === pl.pieceId);
    if (!p) return [];
    const i = p.points.findIndex((q) => q.id === pl.pointId);
    return [{ id: pl.id, piece: p.name, type: pl.type, depth: pl.depth, intake: pleatIntake(pl), length: pl.length, at: `point ${i + 1}, ${Math.round(pl.t * 100)}% along` }];
  });
}

function baseSeamRows(type: GarmentType, pieces: Piece[]): SeamRow[] {
  const P = (role: string) => pieces.find((p) => p.role === role);
  const L = edgeLen;
  const style = migrateGarment(type);
  const fam = famOf(type);
  const f = P('front'), bk = P('back'), sl = P('sleeve');
  if (fam === 'pants') {
    const wb = P('waistband');
    const wbLen = wb ? computeSpec(wb, wb.specs[0])?.value ?? 0 : 0;
    const rows: SeamRow[] = [
      { label: 'Inseam (front / back)', a: L(f, 'front.6', 'front.8'), b: L(bk, 'back.6', 'back.8'), seams: ['inseam-r', 'inseam-l'] },
      { label: 'Outseam (front / back)', a: L(f, 'front.1', 'front.5'), b: L(bk, 'back.1', 'back.5'), seams: ['outseam-r', 'outseam-l'] },
      { label: 'Waist edge / waistband', a: 2 * (L(f, 'front.0', 'front.1') + L(bk, 'back.0', 'back.1')), b: wbLen, seams: ['waistband'] },
    ];
    const cuff = P('cuff');
    if (cuff) {
      // rib cuff is stretched onto the leg opening while sewing
      const open = L(f, 'front.5', 'front.6') + L(bk, 'back.5', 'back.6');
      rows.push({ label: 'Ankle cuff / leg opening (rib stretched on)', a: L(cuff, 'cuff.1', 'cuff.1m'), b: open, ease: (RIB.cuff - 1) * open, seams: ['cuff-r', 'cuff-l'] });
      rows.push({ label: 'Ankle cuff join', a: L(cuff, 'cuff.1', 'cuff.2'), b: L(cuff, 'cuff.1m', 'cuff.2m'), seams: ['cuff-join-r', 'cuff-join-l'] });
    }
    return rows;
  }
  if (isHat(type)) {
    const cr = P('crown'), br = P('brim');
    const band = 6 * L(cr, 'crown.3m', 'crown.3');
    const rows: SeamRow[] = [{ label: 'Crown panel seams (panel / next panel)', a: L(cr, 'crown.0', 'crown.3'), b: L(cr, 'crown.0', 'crown.3m'), seams: [1, 2, 3, 4, 5, 6].map((k) => `crown-${k}`) }];
    if (fam === 'bucket') {
      rows.push({ label: 'Crown band / brim', a: band, b: L(br, 'brim.0', 'brim.6') + L(br, 'brim.0', 'brim.6m'), seams: ['brim'] });
      rows.push({ label: 'Brim back seam', a: L(br, 'brim.6', 'brim.7'), b: L(br, 'brim.6m', 'brim.7m'), seams: ['brim-join'] });
    } else {
      rows.push({ label: 'Front half of band / visor', a: band / 2, b: L(br, 'brim.0', 'brim.3') + L(br, 'brim.0', 'brim.3m'), seams: ['visor'] });
    }
    return rows;
  }
  const fo = frontOffset(style);
  const F = (i: number, m = '') => `front.${i + fo}${m}`;
  const rows: SeamRow[] = [
    { label: 'Shoulder R (front / back)', a: L(f, F(2), F(3)), b: L(bk, 'back.2m', 'back.3m'), seams: ['shoulder-r'] },
    { label: 'Shoulder L (front / back)', a: L(f, F(2, 'm'), F(3, 'm')), b: L(bk, 'back.2', 'back.3'), seams: ['shoulder-l'] },
    { label: 'Side seam R (front / back)', a: L(f, F(5), F(7)), b: L(bk, 'back.5m', 'back.7m'), seams: ['side-r'] },
    { label: 'Side seam L (front / back)', a: L(f, F(5, 'm'), F(7, 'm')), b: L(bk, 'back.5', 'back.7'), seams: ['side-l'] },
    { label: 'Sleeve seam (underarm)', a: L(sl, 'sleeve.3', 'sleeve.4'), b: L(sl, 'sleeve.3m', 'sleeve.4m'), seams: ['underarm-r', 'underarm-l'] },
    {
      label: 'Sleeve cap / armhole', a: L(sl, 'sleeve.0', 'sleeve.3') + L(sl, 'sleeve.0', 'sleeve.3m'),
      b: L(f, F(3), F(5)) + L(bk, 'back.3m', 'back.5m'), ease: EASE[style].capEase,
      seams: ['sleeve-cap-front-r', 'sleeve-cap-back-r', 'sleeve-cap-front-l', 'sleeve-cap-back-l'],
    },
  ];
  const neck = necklineLen(type, pieces);
  const collar = P('collar');
  if (collar) rows.push({ label: 'Collar / neckline', a: L(collar, 'collar.1', 'collar.1m'), b: neck, seams: ['collar'] });
  const nb = P('neckband');
  if (nb) {
    rows.push({ label: 'Neckband / neckline (rib stretched on)', a: L(nb, 'neckband.1', 'neckband.1m'), b: neck, ease: (RIB.neckband - 1) * neck, seams: ['neckband'] });
    rows.push({ label: 'Neckband join', a: L(nb, 'neckband.1', 'neckband.2'), b: L(nb, 'neckband.1m', 'neckband.2m'), seams: ['neckband-join'] });
  }
  const pl = P('placket');
  if (pl) {
    rows.push({ label: 'Placket R / front opening', a: L(pl, 'placket.1', 'placket.2'), b: L(f, 'front.1', 'front.2'), seams: ['placket-r'] });
    rows.push({ label: 'Placket L / front opening', a: L(pl, 'placket.1m', 'placket.2m'), b: L(f, 'front.1m', 'front.2m'), seams: ['placket-l'] });
    rows.push({ label: 'Placket base / opening base', a: L(pl, 'placket.2', 'placket.2m'), b: L(f, 'front.1', 'front.1m'), seams: ['placket-base'] });
  }
  const cuff = P('cuff');
  if (cuff && sl) {
    const end = sl.points.filter((q) => q.tag === 'cuff');
    rows.push({ label: 'Sleeve end / cuff (pleat)', a: end.length === 2 ? Math.abs(end[0].x - end[1].x) : 0, b: computeSpec(cuff, cuff.specs[0])?.value ?? 0, ease: 6, seams: ['cuff-r', 'cuff-l'] });
  }
  return rows;
}

/** Placement outline of an attachment on its host piece (host local pattern coords, cm). */
export function attachmentOutline(a: Attachment, n = 48): Pt[] {
  const c = Math.cos((a.rotation * Math.PI) / 180), s = Math.sin((a.rotation * Math.PI) / 180);
  return outlinePolygon(a.outline, a.w, a.h, a.points, n).map((q) => ({ x: a.x + q.x * c - q.y * s, y: a.y + q.x * s + q.y * c }));
}

/** Placement outline of a user piece patched onto its host (host local pattern coords, cm), or null. */
export function patchOutline(p: Piece): { host: string; pts: Pt[] } | null {
  const pl = p.placement;
  if (p.role !== 'custom' || pl?.mode !== 'patch' || !pl.hostPieceId) return null;
  const bb = bbox(p.points), cx = bb.minX + bb.w / 2, cy = bb.minY + bb.h / 2;
  const r = ((pl.rotation ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { host: pl.hostPieceId, pts: samplePoly(p.points, 12).map((q) => ({ x: (pl.x ?? 0) + (q.x - cx) * c - (q.y - cy) * s, y: (pl.y ?? 0) + (q.x - cx) * s + (q.y - cy) * c })) };
}

/** Everything the cutting room marks on a piece for the edits: placement outlines with a centre mark, pleat folds and notches. */
export function placementMarks(p: Piece, pieces: Piece[], edits?: Edits) {
  const outlines: { name: string; kind: string; pts: Pt[]; centre: Pt }[] = [];
  for (const a of edits?.attachments ?? []) if (a.pieceId === p.id) outlines.push({ name: a.name, kind: a.kind, pts: attachmentOutline(a), centre: { x: a.x, y: a.y } });
  for (const q of pieces) {
    const po = patchOutline(q);
    if (po && po.host === p.id) outlines.push({ name: q.name, kind: 'patch', pts: po.pts, centre: { x: q.placement!.x ?? 0, y: q.placement!.y ?? 0 } });
  }
  const pleats = (edits?.pleats ?? []).filter((pl) => pl.pieceId === p.id).map((pl) => ({ pleat: pl, marks: pleatMarks(p, pl) })).filter((x) => x.marks);
  return { outlines, pleats: pleats as { pleat: Pleat; marks: NonNullable<ReturnType<typeof pleatMarks>> }[] };
}
