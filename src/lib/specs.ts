import type { Piece, SpecDef, GarmentType } from '../data/presets';
import { bbox, bezAt, bezTangent, dist, offsetInward, outlineLength, samplePoly, signedArea, sliceSpan, toBeziers, type Pt } from './geometry';
import type { Attachment, Edits, Face, Hardware, Pleat, WashSequence } from '../data/edits';
import { shownBox } from './clipLayers';
import { attachmentPolygons, attachmentShapes, outlinePolygon, SHAPES } from './shapes';
import { builtinSeams, faceLabel, faceOf, instanceLabel, crownCount } from '../sim/seams';
import { buttonholeSlots } from '../data/construction';
import { labelMaterial, labelSewing, labelSize } from '../data/labels';
import { FABRIC_CATEGORIES, FABRICS, PATTERNS, colorName, compositionOf, fabricById, fabricHex, fabricThickness, patternLabel, withPatternDefaults, type FabricRef } from '../data/fabrics';
import { patternEditsText } from '../data/patterns';
import { attachmentStack, stackOf, stackText } from '../data/stack';
import type { Note, Outfit, Project } from '../store';
import type { StyleId } from '../data/catalog';
import { derivedGirths, EASE, RIB, frontOffset, isSplitFront, neckBase, POCKET } from '../data/draft';
import { isHatFamily, migrateGarment, styleById } from '../data/catalog';
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
      const span = s.full || s.cf ? sliceSpan(poly, y) : sliceSpan(poly, y, t.x);
      if (!span) return null;
      const x1 = s.cf ? Math.max(0, span.x1) : span.x1; // a split front: from centre front, the extension left out
      return { label: s.label, value: span.x2 - x1, a: { x: x1, y }, b: { x: span.x2, y } };
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
const isHat = (type: GarmentType) => isHatFamily(famOf(type));

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

/** Hat band = the crown panel bases: six panels, or a five panel's front panel and four crown panels. */
const hatBand = (pieces: Piece[]) => pieces.some((p) => p.role === 'crownFront')
  ? 4 * specOf(pieces, 'crown', 'Panel base') + specOf(pieces, 'crownFront', 'Panel base')
  : 6 * specOf(pieces, 'crown', 'Panel base');
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
  if (fam === 'beanie') {
    const rows = [
      { label: 'Head band circumference', value: get('crown', 'Band width') },
      { label: 'Body length', value: get('crown', 'Body length') },
    ];
    if (pieces.some((p) => p.role === 'cuff')) rows.push({ label: 'Cuff height', value: get('cuff', 'Cuff height') });
    return rows;
  }
  if (fam === 'visor') {
    return [
      { label: 'Head band circumference', value: get('headband', 'Band length') + get('strap', 'Strap length') },
      { label: 'Band height', value: get('headband', 'Band height') },
      { label: 'Visor depth', value: get('brim', 'Visor depth') },
    ];
  }
  if (isHat(type)) {
    return [
      { label: 'Head band circumference', value: hatBand(pieces) },
      { label: 'Crown depth', value: crownDepth(pieces) },
      fam === 'cap' ? { label: 'Visor depth', value: get('brim', 'Visor depth') } : { label: 'Brim width', value: get('brim', 'Brim width') },
    ];
  }
  const short = fam === 'tee' || fam === 'polo';
  // a split front is one front cut twice, each measured centre front to side: the overlap is not ease
  const fr = pieces.find((p) => p.role === 'front');
  const nf = fr && isSplitFront(fr) ? 2 : 1;
  const rows = [
    { label: 'Chest circumference', value: nf * get('front', 'Chest') + get('back', 'Chest') },
    { label: 'Waist circumference', value: nf * get('front', 'Waist') + get('back', 'Waist') },
    { label: 'Hem circumference', value: nf * get('front', 'Hem') + get('back', 'Hem') },
    { label: 'Shoulder width', value: get('back', 'Shoulder') },
    { label: 'Body length (CB)', value: get('back', 'Length') },
    { label: 'Sleeve length', value: get('sleeve', 'Length') },
    { label: 'Bicep circumference', value: get('sleeve', 'Bicep') },
    short ? { label: 'Sleeve opening', value: get('sleeve', 'Opening') } : { label: 'Cuff opening', value: get('sleeve', 'Cuff') },
  ];
  if (fam === 'tee') rows.push({ label: 'Neck opening', value: necklineLen(type, pieces) }, { label: 'Neckband length', value: get('neckband', 'Neckband length') });
  if (pieces.some((p) => p.role === 'placket')) rows.push({ label: 'Placket length', value: get('placket', 'Length') });
  if (nf === 2) rows.push({ label: 'Button extension', value: get('front', 'Button extension') });
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
  if (fam === 'beanie' || fam === 'visor') {
    // knit and elastic: cut smaller than the head (negative ease) and stretched on
    return [
      { label: 'Head', body: d.head, garment: gs['Head band circumference'], estimated: b.head === undefined },
      fam === 'beanie'
        ? { length: true, label: 'Body length', body: null, garment: gs['Body length'] }
        : { length: true, label: 'Band height', body: null, garment: gs['Band height'] },
    ];
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
    const rows = [...baseSeamRows(type, pieces.filter((p) => !p.splitOf)), ...splitSeamRows(type, pieces)];
    if (!edits) return rows;
    const off = new Set(edits.detachedSeams);
    const out = rows.filter((r) => !r.seams || !r.seams.every((id) => off.has(id)));
    const name = (id: string) => pieces.find((p) => p.id === id)?.name ?? 'piece';
    for (const cs of edits.customSeams) {
      const pa = pieces.find((p) => p.id === cs.a.pieceId), pb = pieces.find((p) => p.id === cs.b.pieceId);
      if (!pa || !pb) continue;
      out.push({ label: `Custom seam (${name(pa.id)} / ${name(pb.id)})`, a: sewnLength(pa, cs.a.fromId, cs.a.toId, edits), b: sewnLength(pb, cs.b.fromId, cs.b.toId, edits), seams: [cs.id] });
    }
    for (const r of attachmentReport(pieces, edits, migrateGarment(type))) {
      if (r.kind === 'print' || r.sewnLength <= 0) continue;
      out.push({ label: `${r.name} on ${r.host} (${r.stitched})`, a: r.sewnLength, b: r.sewnLength, attachment: r.id });
    }
    return out;
  } finally {
    reportEdits = undefined;
  }
}

/**
 * Seams of the sides edited on their own (src/data/split.ts): every built-in seam that runs along a split copy, walked
 * with that copy's own outline (the rows above walk the other side). A seam of two halves (both halves of a sleeve cap)
 * is one row, with the intended ease of the row above that covers it.
 */
function splitSeamRows(type: GarmentType, pieces: Piece[]): SeamRow[] {
  const splits = pieces.filter((p) => p.splitOf);
  if (!splits.length) return [];
  const own = (e: { pieceId: string; instance?: number }) => splits.find((s) => s.splitOf === e.pieceId && s.side === (e.instance ?? 0));
  const main = pieces.filter((p) => !p.splitOf);
  const len = (list: { pieceId: string; fromId: string; toId: string; instance?: number }[]) => list.reduce((t, e) => {
    const p = own(e) ?? main.find((q) => q.id === e.pieceId);
    return t + (p ? sewnLength(p, e.fromId, e.toId, reportEdits) : 0);
  }, 0);
  const base = baseSeamRows(type, main);
  const groups = new Map<string, { label: string; ids: string[]; a: Parameters<typeof len>[0]; b: Parameters<typeof len>[0]; on: Piece }>();
  for (const bs of builtinSeams(migrateGarment(type), main, { collar: 'down' })) {
    const on = [...bs.a, ...bs.b].map(own).find((s): s is Piece => !!s);
    if (!on) continue;
    const k = bs.group ?? bs.id;
    const g = groups.get(k) ?? groups.set(k, { label: bs.group ? bs.label.replace(/, (front|back)$/, '') : bs.label, ids: [], a: [], b: [], on }).get(k)!;
    g.ids.push(bs.id); g.a.push(...bs.a); g.b.push(...bs.b);
  }
  return [...groups.values()].map((g) => {
    const ease = base.find((r) => r.seams?.some((id) => g.ids.includes(id)))?.ease;
    return { label: `${g.label} (${g.on.name}, edited on its own)`, a: len(g.a), b: len(g.b), ...(ease !== undefined ? { ease } : {}), seams: g.ids };
  });
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
  /** stitched length (cm) per copy; 0 for a print, embroidery or hardware */
  sewnLength: number;
  /** copies on the garment: a piece cut twice carries it on both sides unless one side is chosen */
  copies: number;
  /** which copy of the host it is on, in plain words: 'Right back leg', 'Both sleeves', 'Front' */
  side: string;
  /** cloth pieces cut per copy (an applique of text: one per letter); 0 when it adds no cloth */
  cutPieces: number;
  /** set when it sits on the inside face of its host (between the host and the body) */
  face?: 'inside';
}

/**
 * The built-in seam a point on a piece edge is sewn into: the seam whose edge on that piece passes nearest the point,
 * within `within` cm. Plain label ('Collar', 'Right side seam') or null.
 */
export function seamNear(style: StyleId | undefined, pieces: Piece[], host: Piece, at: Pt, within = 2): string | null {
  if (!style) return null;
  let best: { label: string; d: number } | null = null;
  for (const bs of builtinSeams(style, pieces, { collar: 'down' })) {
    for (const r of [...bs.a, ...bs.b]) {
      if (r.pieceId !== host.id) continue;
      const pts = host.points, n = pts.length, bz = toBeziers(pts);
      const ia = pts.findIndex((q) => q.id === r.fromId), ib = pts.findIndex((q) => q.id === r.toId);
      if (ia < 0 || ib < 0) continue;
      const fwd = (ib - ia + n) % n, back = (ia - ib + n) % n;
      const [s0, s1] = fwd <= back ? [ia, ib] : [ib, ia];
      for (let i = s0; i !== s1; i = (i + 1) % n) for (let k = 0; k <= 24; k++) {
        const d = dist(bezAt(bz[i], k / 24), at);
        if (d <= within && (!best || d < best.d)) best = { label: bs.label, d };
      }
    }
  }
  return best?.label ?? null;
}

/** How a tag is sewn on, in plain words for the spec sheet. */
function labelStitched(a: Attachment, tag: ReturnType<typeof labelSewing>, host: Piece | undefined, pieces: Piece[], style?: StyleId) {
  if (tag.method === 'all-round') return 'sewn all round';
  if (tag.method === 'loop') {
    const c = Math.cos((a.rotation * Math.PI) / 180), s = Math.sin((a.rotation * Math.PI) / 180), o = tag.open!;
    const q = { x: o.dir.x * o.half, y: o.dir.y * o.half };
    const seam = host ? seamNear(style, pieces, host, { x: a.x + q.x * c - q.y * s, y: a.y + q.x * s + q.y * c }) : null;
    return `folded loop, caught in the ${seam ? seam.toLowerCase() + ' seam' : 'edge seam'}`;
  }
  return a.label?.sewn === 'folded-loop' ? 'folded loop sewn at both ends (more than 1.5 cm from a seam)' : 'sewn at both ends';
}

const perimeter = (pts: Pt[]) => pts.reduce((s, q, i) => s + dist(q, pts[(i + 1) % pts.length]), 0);

/** copies of a host piece on the body (pieces cut twice are a pair; a crown has 6); without a style, from the cut count */
function hostCopies(style: StyleId | undefined, host: Piece | undefined) {
  if (!host) return 1;
  if (style) return instanceLabel(style, host) === host.name ? 1 : host.role === 'crown' ? crownCount(style) : 2;
  return host.cut;
}
function sideLabel(style: StyleId | undefined, host: Piece | undefined, instance: number | undefined) {
  if (!host) return 'missing piece';
  if (style) return instanceLabel(style, host, instance);
  if (host.cut <= 1) return host.name;
  return instance === undefined ? `${host.name}, every copy` : `${host.name}, ${instance === 1 ? 'right' : 'left'}`;
}

/** Attachments (pockets, patches, appliques, straps, embroidery, prints, hardware) and user pieces patched on, for the spec sheet. */
export function attachmentReport(pieces: Piece[], edits?: Edits, style?: StyleId): AttachmentRow[] {
  const rows: AttachmentRow[] = [];
  for (const a0 of edits?.attachments ?? []) {
    const a = a0.kind === 'label' ? { ...a0, ...labelSize(a0) } : a0;
    const host = pieces.find((p) => p.id === a.pieceId);
    const rings = attachmentPolygons(a);
    const poly = rings[0] ?? outlinePolygon(a.outline, a.w, a.h, a.points);
    const P = attachmentShapes(a).reduce((sum, sh) => sum + perimeter(sh.outer) + sh.holes.reduce((t, h) => t + perimeter(h), 0), 0);
    const top = poly.filter((q) => q.y < Math.min(...poly.map((r) => r.y)) + 0.05);
    const mouth = top.length >= 2 ? Math.max(...top.map((q) => q.x)) - Math.min(...top.map((q) => q.x)) : 0;
    const short = Math.min(a.w, a.h);
    const tag = a.kind === 'label' ? labelSewing(a, host) : null;
    const [stitched, sewn] = tag ? [labelStitched(a, tag, host, pieces, style), tag.method === 'all-round' ? P : tag.method === 'loop' ? tag.open!.along : 2 * short]
      : a.kind === 'pocket' ? ['3 sides, top open', P - mouth]
      : a.kind === 'strap' ? ['both ends', 2 * short]
      : a.kind === 'patch' ? ['all round', P]
      : a.kind === 'applique' ? ['satin stitch all round', P]
      : a.kind === 'embroidery' ? ['embroidered into the piece', 0]
      : a.kind === 'hardware' ? [a.hardware?.type === 'zipper' ? 'zip sewn in' : a.buttonhole ? 'buttonhole cut and stitched' : a.hardware?.type === 'button' ? 'sewn on' : 'set through the fabric', a.hardware?.type === 'zipper' ? 2 * a.h : 0]
      : ['printed', 0];
    const cloth = a.kind === 'pocket' || a.kind === 'patch' || a.kind === 'applique' || a.kind === 'strap' || (a.kind === 'label' && !labelMaterial(a).purchased);
    rows.push({
      id: a.id, name: a.name, kind: a.kind, host: host?.name ?? 'missing piece', w: a.w, h: a.h, x: a.x, y: a.y, rotation: a.rotation,
      layers: a.layers.length, stitched, sewnLength: sewn, copies: a.instance !== undefined ? 1 : hostCopies(style, host),
      side: sideLabel(style, host, a.instance), cutPieces: cloth ? rings.length : 0,
      ...(faceOf(a) === 'inside' ? { face: 'inside' as const } : {}),
    });
  }
  for (const p of pieces) {
    const pl = p.placement;
    if (p.role !== 'custom' || pl?.mode !== 'patch') continue;
    const host = pieces.find((q) => q.id === pl.hostPieceId);
    const bb = bbox(p.points);
    rows.push({
      id: p.id, name: p.name, kind: 'patch', host: host?.name ?? 'missing piece', w: bb.w, h: bb.h, x: pl.x ?? 0, y: pl.y ?? 0, rotation: pl.rotation ?? 0,
      layers: 0, stitched: 'all round', sewnLength: perimeter(samplePoly(p.points, 12)), copies: pl.instance !== undefined ? 1 : hostCopies(style, host),
      side: sideLabel(style, host, pl.instance), cutPieces: 1,
    });
  }
  return rows;
}

export interface TrimRow {
  /** 'hardware' | 'embroidery' | 'applique' | 'label' */
  kind: string;
  item: string;
  detail: string;
  /** piece and side, e.g. 'Right back leg' */
  placement: string;
  qty: number;
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const HW_NAME: Record<string, string> = { rivet: 'Rivet', eyelet: 'Eyelet', stud: 'Stud', button: 'Button', snap: 'Snap fastener', zipper: 'Zip' };
const PLASTIC_FINISH = new Set(['black', 'white']);
const TEETH: Record<string, string> = { metal: 'metal teeth', coil: 'nylon coil', molded: 'moulded plastic teeth' };
const PULLER: Record<string, string> = { standard: 'standard puller', ring: 'ring puller', tab: 'tab puller', cord: 'cord pull', custom: 'custom drawn puller' };

/** Trim detail for the BOM: shape (round or custom drawn), holes, finish, surface, colour and size; a zip's teeth, tape and puller. */
export function hardwareDetail(h: Hardware, a: Pick<Attachment, 'h' | 'sheen'>): string {
  const sheen = a.sheen ?? h.sheen ?? (PLASTIC_FINISH.has(h.finish) ? 'matte' : 'metallic');
  if (h.type === 'zipper') {
    const z = h.zipper;
    const parts = [`${round1(a.h)} cm long`, `${round1(h.size * 10)} mm tape`, h.open ? 'open' : 'closed'];
    if (z) {
      parts.unshift(z.teeth === 'metal' ? `${cap(h.finish)} metal teeth` : `${cap(TEETH[z.teeth] ?? z.teeth)}${z.teethColor ? ` ${z.teethColor}` : ''}`);
      parts.push(`tape ${z.tape}`, PULLER[z.puller] ?? z.puller);
      if (z.puller === 'custom' && z.pullerFinish) parts.push(`puller ${z.pullerFinish}`);
      if (z.pullerLayers?.length) parts.push(`puller artwork ${z.pullerLayers.length} layer${z.pullerLayers.length > 1 ? 's' : ''}`);
    } else parts.unshift(cap(h.finish));
    return parts.join(', ');
  }
  const parts: string[] = [];
  const designed = h.type === 'button' || h.type === 'snap' || h.type === 'stud';
  if (designed) parts.push(h.outline && h.outline.length >= 3 ? 'custom drawn shape' : 'round');
  const plastic = PLASTIC_FINISH.has(h.finish);
  parts.push(plastic ? `${h.finish} plastic` : cap(h.finish));
  if (h.color) parts.push(`colour ${h.color}`);
  if (designed || a.sheen || h.sheen) parts.push(sheen); // rivets and eyelets: only a chosen surface
  if (h.type === 'button') parts.push(h.holes === 'shank' ? 'shank' : h.holes === 0 ? 'no holes' : `${h.holes ?? 4} hole`);
  if (h.outline && h.outline.length >= 3) {
    const bb = bbox(h.outline);
    parts.push(`${round1(bb.w * 10)} x ${round1(bb.h * 10)} mm`);
  } else parts.push(`${round1(h.size * 10)} mm`);
  if (h.layers?.length) parts.push(`artwork ${h.layers.length} layer${h.layers.length > 1 ? 's' : ''}`);
  return parts.join(', ');
}

export interface LabelRow {
  id: string;
  name: string;
  /** material name and type */
  material: string;
  type: string;
  /** finished size (cm) and the cut size of the strip (a folded loop is cut twice as long) */
  w: number;
  h: number;
  cutW: number;
  cutH: number;
  sewn: string;
  /** host copy and face: 'Back, inside' */
  placement: string;
  x: number;
  y: number;
  color: string;
  sheen: string;
  /** artwork layers woven or printed on it */
  layers: number;
  /** bought finished (leather, rubber): a trim, not a cut piece */
  purchased: boolean;
  qty: number;
}

/** Clothing tags for the spec sheet, PDF and DXF: material, size, how they are sewn on and where. */
export function labelReport(pieces: Piece[], edits?: Edits, style?: StyleId): LabelRow[] {
  const rows: LabelRow[] = [];
  for (const a0 of edits?.attachments ?? []) {
    if (a0.kind !== 'label') continue;
    const a = { ...a0, ...labelSize(a0) };
    const host = pieces.find((p) => p.id === a.pieceId);
    const mat = labelMaterial(a), sew = labelSewing(a, host);
    const face = faceOf(a);
    const faceName = host && style ? faceLabel(style, host, face).toLowerCase() : face;
    rows.push({
      id: a.id, name: a.name, material: mat.name, type: a.label?.type ?? 'woven', w: a.w, h: a.h, cutW: sew.cut.w, cutH: sew.cut.h,
      sewn: labelStitched(a, sew, host, pieces, style), placement: `${sideLabel(style, host, a.instance)}, ${faceName}`, x: a.x, y: a.y,
      color: a.label?.color ?? 'white', sheen: a.sheen ?? 'matte', layers: a.layers.length, purchased: mat.purchased,
      qty: a.instance !== undefined ? 1 : hostCopies(style, host),
    });
  }
  return rows;
}

/**
 * Trims from the edits for the bill of materials: hardware by type, finish, size, count and placement;
 * embroidery with thread colour and size; appliques with fabric, shape and size. Identical trims on the
 * same placement are added up.
 */
export function trimsReport(pieces: Piece[], edits?: Edits, style?: StyleId): TrimRow[] {
  const rows: TrimRow[] = [];
  const push = (r: TrimRow) => {
    const same = rows.find((q) => q.kind === r.kind && q.item === r.item && q.detail === r.detail && q.placement === r.placement);
    if (same) same.qty += r.qty; else rows.push(r);
  };
  for (const a of edits?.attachments ?? []) {
    const host = pieces.find((p) => p.id === a.pieceId);
    const placement = sideLabel(style, host, a.instance);
    const copies = a.instance !== undefined ? 1 : hostCopies(style, host);
    if (a.kind === 'hardware' && a.hardware) {
      const h = a.hardware;
      const where = faceOf(a) === 'inside' && host && style ? `${placement}, ${faceLabel(style, host, 'inside').toLowerCase()}` : placement;
      if (h.type === 'zipper') {
        push({ kind: 'hardware', item: 'Zip', detail: hardwareDetail(h, a), placement: where, qty: copies });
      } else if (a.buttonhole) {
        // a buttonhole is a sewing operation, not a bought trim: as long as the button is wide, plus 3 mm
        push({ kind: 'buttonhole', item: 'Buttonhole', detail: `${round1(h.size * 10 + 3)} mm, ${h.holeStyle === 'keyhole' ? 'keyhole' : 'straight'}, ${h.holeDir === 'along' ? 'along the row' : 'across the row'}, stitched${a.thread ? `, thread ${a.thread}` : ', thread matched'}`, placement: where, qty: Math.max(1, Math.round(h.count ?? 1)) * copies });
      } else {
        push({ kind: 'hardware', item: HW_NAME[h.type] ?? cap(h.type), detail: hardwareDetail(h, a), placement: where, qty: Math.max(1, Math.round(h.count ?? 1)) * copies });
      }
    } else if (a.kind === 'label') {
      const r = labelReport(pieces, { ...edits!, attachments: [a] }, style)[0];
      push({ kind: 'label', item: `Label (${r.material.toLowerCase()})`, detail: `${round1(r.w)} x ${round1(r.h)} cm, ${r.sewn}, ${r.color}, ${r.sheen}${r.layers ? `, artwork ${r.layers} layer${r.layers > 1 ? 's' : ''}` : ''}${r.purchased ? ', bought finished' : ''}`, placement: r.placement, qty: r.qty });
    } else if (a.kind === 'embroidery') {
      push({ kind: 'embroidery', item: 'Embroidery', detail: `Thread ${a.thread ?? 'colour matched'}, ${round1(a.w)} x ${round1(a.h)} cm${a.text ? `, "${a.text}"` : ''}`, placement, qty: copies });
    } else if (a.kind === 'applique') {
      const fab = fabricById((a.fabric ?? host?.fabric)?.id ?? 'cotton');
      const shape = a.shape === 'text' ? `letters "${a.text ?? ''}"` : SHAPES[a.shape ?? 'rect']?.name.toLowerCase() ?? 'shape';
      push({ kind: 'applique', item: 'Applique', detail: `${fab.name}, ${shape}, ${round1(a.w)} x ${round1(a.h)} cm${a.thread ? `, thread ${a.thread}` : ''}`, placement, qty: copies });
    }
  }
  return rows;
}
const round1 = (v: number) => Math.round(v * 10) / 10;

export interface FabricInfo {
  fabric: string;
  category: string;
  /** card colour name, or 'Custom #rrggbb' */
  colour: string;
  /** ground colour as CSS hex (custom colour if set) */
  hex: string;
  gsm: number;
  /** 'Gingham, 0.8 cm repeat, woven'; undefined for a plain piece */
  pattern?: string;
  /** pattern colours, named from the fabric cards where they match: 'White / Navy' */
  colourway?: string;
  /** opacity, shift, hidden and recoloured colours; undefined when the pattern is as drawn */
  adjust?: string;
}

const hexName = (hex: string, prefer?: string) => {
  const h = hex.toLowerCase();
  const own = prefer ? fabricById(prefer).colors.find((c) => c.hex.toLowerCase() === h) : undefined;
  return own?.name ?? FABRICS.flatMap((f) => f.colors).find((c) => c.hex.toLowerCase() === h)?.name ?? h;
};

/** Everything a tech pack says about one piece fabric: fabric, category, colour (custom hex aware), pattern and colourway. */
export function fabricInfo(pf: FabricRef): FabricInfo {
  const f = fabricById(pf.id);
  const info: FabricInfo = { fabric: f.name, category: FABRIC_CATEGORIES.find((c) => c.id === f.category)?.name ?? '', colour: colorName(pf), hex: fabricHex(pf), gsm: f.gsm };
  if (pf.pattern && pf.pattern.id !== 'solid') {
    const p = withPatternDefaults(pf.pattern);
    info.pattern = patternLabel(p);
    info.colourway = p.colors.map((c) => hexName(c, pf.id)).join(' / ');
    info.adjust = patternEditsText(p, (h) => hexName(h, pf.id)) || undefined;
  }
  return info;
}

/** One line: 'Denim (Denim), Indigo; Gingham, 0.8 cm repeat, woven, colourway White / Navy'. */
export function fabricText(pf: FabricRef): string {
  const i = fabricInfo(pf);
  return `${i.fabric} (${i.category}), ${fabricDetail(pf)}`;
}

/** Colour and pattern only: 'Indigo; Gingham, 0.8 cm repeat, woven, colourway White / Navy'. */
export function fabricDetail(pf: FabricRef): string {
  const i = fabricInfo(pf);
  return `${i.colour}${i.pattern ? `; ${i.pattern}, colourway ${i.colourway}${i.adjust ? `; ${i.adjust}` : ''}` : ''}`;
}

/** Same fabric, colour and pattern: one row in a materials table. */
export const fabricKey = (pf: FabricRef) => `${pf.id}|${pf.hex ? pf.hex.toLowerCase() : pf.color}|${pf.pattern ? JSON.stringify(withPatternDefaults(pf.pattern)) : ''}`;

export interface CutRow { name: string; fabric: string; cut: number; note?: string; /** the cloth layers it is made of with total thickness and weight: 'Cotton Jersey + Leather lining, 1.7 mm, 1080 g/m2' */ stack?: string; /** total thickness (mm) and weight (g/m2) of its layer stack */ thickness?: number; gsm?: number; /** fabric with category, colour and pattern (fabricText) */ material?: string; /** colour and pattern (fabricDetail) */ detail?: string }

/** Cut list: every pattern piece with its cut count, then the cloth attachments (pockets, patches, straps, appliques). */
export function cutList(pieces: Piece[], edits?: Edits, style?: StyleId): CutRow[] {
  const rows: CutRow[] = pieces.filter((p) => !(p.role === 'custom' && p.placement?.mode === 'patch')).map((p) => {
    const inner = edits?.insideFabric?.[p.id];
    const material = fabricText(p.fabric), detail = fabricDetail(p.fabric);
    const S = stackOf(p, edits), st = { stack: stackText(S), thickness: round1(S.thickness), gsm: Math.round(S.gsm) };
    if (!inner) return { name: p.name, fabric: fabricById(p.fabric.id).name, cut: p.cut, material, detail, ...st };
    // the inside face in its own fabric (under collar, placket facing, lining look)
    const f = fabricById(inner.id), col = colorName(inner), pat = fabricInfo(inner).pattern;
    const what = style ? faceLabel(style, p, 'inside') : 'Inside';
    return { name: p.name, fabric: fabricById(p.fabric.id).name, cut: p.cut, material, detail, ...st, note: `Inside: ${f.name}${col ? `, ${col}` : ''}${pat ? `, ${pat}` : ''}${what !== 'Inside' ? ` (${what.toLowerCase()})` : ''}` };
  });
  const tags = labelReport(pieces, edits, style);
  for (const r of attachmentReport(pieces, edits, style)) {
    if (!r.cutPieces) continue;
    const a = edits?.attachments.find((q) => q.id === r.id);
    const tag = tags.find((t) => t.id === r.id);
    if (tag) { rows.push({ name: r.name, fabric: tag.material, cut: r.copies, note: `Label on ${tag.placement}, cut ${round1(tag.cutW)} x ${round1(tag.cutH)} cm` }); continue; }
    const up = pieces.find((p) => p.id === r.id);
    const ref = a?.fabric ?? up?.fabric ?? pieces.find((p) => p.name === r.host)?.fabric;
    const fab = fabricById(ref?.id ?? 'cotton');
    const S = a ? attachmentStack(a, ref?.id ?? fab.id) : up ? stackOf(up, edits) : undefined;
    const st = S ? { stack: stackText(S), thickness: round1(S.thickness), gsm: Math.round(S.gsm) } : {};
    const lined = a?.lining ? `, lined with ${fabricById(a.lining.id).name}` : '';
    rows.push({ name: r.name, fabric: fab.name, cut: r.cutPieces * r.copies, ...(ref ? { material: fabricText(ref), detail: fabricDetail(ref) } : {}), ...st, note: `${cap(r.kind)} on ${r.side}${r.cutPieces > 1 ? `, ${r.cutPieces} letters each` : ''}${lined}` });
  }
  return rows;
}

export interface PleatRow {
  id: string;
  piece: string;
  /** which copy of the piece: 'Right front leg', 'Both front legs' */
  side: string;
  type: Pleat['type'];
  depth: number;
  intake: number;
  length: number;
  /** position on the outline: the point the pleat's segment starts at, and how far along it */
  at: string;
}

export function pleatReport(pieces: Piece[], edits?: Edits, style?: StyleId): PleatRow[] {
  return (edits?.pleats ?? []).flatMap((pl) => {
    const p = pieces.find((q) => q.id === pl.pieceId);
    if (!p) return [];
    const i = p.points.findIndex((q) => q.id === pl.pointId);
    return [{ id: pl.id, piece: p.name, side: sideLabel(style, p, pl.instance), type: pl.type, depth: pl.depth, intake: pleatIntake(pl), length: pl.length, at: `point ${i + 1}, ${Math.round(pl.t * 100)}% along` }];
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
    // inside pieces (not simulated): walked to the edges they are sewn to
    const fly = L(f, 'front.0', 'front.11');
    const ff = P('flyFacing'), fs = P('flyShield');
    if (ff) rows.push({ label: 'Fly facing / fly opening', a: L(ff, 'flyFacing.4', 'flyFacing.0'), b: fly });
    if (fs) rows.push({ label: 'Fly shield / fly opening', a: L(fs, 'flyShield.4', 'flyShield.0'), b: fly });
    const pf = P('pocketFacing'), pb = P('pocketBag');
    if (pf && pb) {
      rows.push({ label: 'Pocket facing / front waist (side corner)', a: L(pf, 'pocketFacing.0', 'pocketFacing.1'), b: POCKET.facing });
      rows.push({ label: 'Pocket facing / pocket bag (side seam)', a: L(pf, 'pocketFacing.1', 'pocketFacing.4'), b: L(pb, 'pocketBag.1', 'pocketBag.4') });
    }
    return rows;
  }
  if (fam === 'beanie') {
    const cr = P('crown'), cu = P('cuff');
    const K = (i: number, m = '') => `crown.${i}${m}`;
    const rows: SeamRow[] = [
      { label: 'Front crown dart (side / side)', a: L(cr, K(0), K(3)), b: L(cr, K(0), K(3, 'm')), seams: ['dart-front'] },
      { label: 'Crown darts 1 (side / side)', a: L(cr, K(6), K(3)), b: L(cr, K(6), K(9)), seams: ['dart-r1', 'dart-l1'] },
      { label: 'Crown darts 2 (side / side)', a: L(cr, K(12), K(9)), b: L(cr, K(12), K(15)), seams: ['dart-r2', 'dart-l2'] },
      { label: 'Back seam (left / right)', a: L(cr, K(19), K(18)) + L(cr, K(18), K(15)), b: L(cr, K(19, 'm'), K(18, 'm')) + L(cr, K(18, 'm'), K(15, 'm')), seams: ['back'] },
    ];
    if (cu) {
      rows.push({ label: 'Cuff / body edge', a: L(cu, 'cuff.1m', 'cuff.1'), b: L(cr, K(19, 'm'), K(19)), seams: ['cuff'] });
      rows.push({ label: 'Cuff back seam', a: L(cu, 'cuff.1', 'cuff.2'), b: L(cu, 'cuff.1m', 'cuff.2m'), seams: ['cuff-join'] });
    }
    return rows;
  }
  if (fam === 'visor') {
    const hb = P('headband'), st = P('strap'), br = P('brim');
    const rows: SeamRow[] = [];
    if (st) {
      rows.push({ label: 'Band end / strap end, left', a: L(hb, 'headband.2', 'headband.3'), b: L(st, 'strap.1', 'strap.2'), seams: ['strap-r'] });
      rows.push({ label: 'Band end / strap end, right', a: L(hb, 'headband.2m', 'headband.3m'), b: L(st, 'strap.1m', 'strap.2m'), seams: ['strap-l'] });
    }
    if (br) rows.push({ label: 'Front of band / visor', a: L(hb, 'headband.4m', 'headband.4'), b: L(br, 'brim.0', 'brim.3') + L(br, 'brim.0', 'brim.3m'), seams: ['visor'] });
    return rows;
  }
  if (isHat(type) && P('crownFront')) {
    const cr = P('crown'), br = P('brim'), fp = P('crownFront');
    const rows: SeamRow[] = [
      { label: 'Front panel side / crown panel', a: L(fp, 'crownFront.0', 'crownFront.3'), b: L(cr, 'crown.0', 'crown.3m'), seams: ['crown-1', 'crown-5'] },
      { label: 'Crown panel seams (panel / next panel)', a: L(cr, 'crown.0', 'crown.3'), b: L(cr, 'crown.0', 'crown.3m'), seams: ['crown-2', 'crown-3', 'crown-4'] },
    ];
    const half = L(fp, 'crownFront.3m', 'crownFront.3') + L(cr, 'crown.4', 'crown.3') + L(cr, 'crown.3m', 'crown.4');
    rows.push({ label: 'Front half of band / visor', a: half, b: L(br, 'brim.0', 'brim.3') + L(br, 'brim.0', 'brim.3m'), seams: ['visor'] });
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
  // a split front: the right front is the second copy of the same piece (same keys); a closed front has "m" keys
  const split = !!f && isSplitFront(f);
  const FM = (i: number) => (split ? F(i) : F(i, 'm'));
  const rows: SeamRow[] = [
    { label: 'Shoulder R (front / back)', a: L(f, F(2), F(3)), b: L(bk, 'back.2m', 'back.3m'), seams: ['shoulder-r'] },
    { label: 'Shoulder L (front / back)', a: L(f, FM(2), FM(3)), b: L(bk, 'back.2', 'back.3'), seams: ['shoulder-l'] },
    { label: 'Side seam R (front / back)', a: L(f, F(5), F(7)), b: L(bk, 'back.5m', 'back.7m'), seams: ['side-r'] },
    { label: 'Side seam L (front / back)', a: L(f, FM(5), FM(7)), b: L(bk, 'back.5', 'back.7'), seams: ['side-l'] },
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
    rows.push({ label: 'Placket L / front opening', a: L(pl, 'placket.1', 'placket.2'), b: L(f, 'front.1m', 'front.2m'), seams: ['placket-l'] });
    rows.push({ label: 'Placket base / opening base (both strips)', a: L(pl, 'placket.2', 'placket.2m'), b: L(f, 'front.1', 'front.1m'), seams: ['placket-base', 'placket-base-l'] });
  }
  const fc = P('facing');
  if (fc && split) {
    // inside pieces: walked to the front edge, sewn with it (not simulated, they do not show)
    rows.push({ label: 'Front facing / front edge (each front)', a: L(fc, 'facing.6', 'facing.0'), b: L(f, 'front.ext0', 'front.ext1') });
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

/** Placement outlines of an attachment on its host (one per letter for a text applique), host local coords (cm). */
export function attachmentOutlines(a: Attachment): Pt[][] {
  const c = Math.cos((a.rotation * Math.PI) / 180), s = Math.sin((a.rotation * Math.PI) / 180);
  // outer rings and the counters (holes) of letters, each its own outline
  return attachmentShapes(a).flatMap((sh) => [sh.outer, ...sh.holes]).map((r) => r.map((q) => ({ x: a.x + q.x * c - q.y * s, y: a.y + q.x * s + q.y * c })));
}

/**
 * Hardware placement marks on a host piece (host local coords, cm): a point per trim (rivets, buttons ...)
 * and a line for a zip.
 */
export function hardwareMarks(p: Piece, edits?: Edits): { name: string; /** hardware type, or 'buttonhole' */ type: string; points: { at: Pt; r: number }[]; line?: [Pt, Pt]; builtin?: boolean;
  /** buttonholes: each hole's stitched outline (straight or keyhole), host coords */ slots?: Pt[][] }[] {
  const out: ReturnType<typeof hardwareMarks> = [];
  for (const a of edits?.attachments ?? []) {
    if (a.pieceId !== p.id || a.kind !== 'hardware' || !a.hardware) continue;
    const h = a.hardware, c = Math.cos((a.rotation * Math.PI) / 180), s = Math.sin((a.rotation * Math.PI) / 180);
    const T = (q: Pt): Pt => ({ x: a.x + q.x * c - q.y * s, y: a.y + q.x * s + q.y * c });
    if (h.type === 'zipper') { out.push({ name: a.name, type: h.type, points: [], line: [T({ x: 0, y: -a.h / 2 }), T({ x: 0, y: a.h / 2 })] }); continue; }
    const n = Math.max(1, Math.round(h.count ?? 1)), sp = h.spacing ?? Math.max(1.5, h.size * 2);
    out.push({ name: a.name, type: a.buttonhole ? 'buttonhole' : h.type, points: Array.from({ length: n }, (_, k) => ({ at: T({ x: (k - (n - 1) / 2) * sp, y: 0 }), r: Math.max(0.1, h.size / 2) })), ...(a.builtin ? { builtin: true } : {}), ...(a.buttonhole ? { slots: buttonholeSlots(a, true) } : {}) });
  }
  return out;
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
  for (const a of edits?.attachments ?? []) {
    if (a.pieceId !== p.id) continue;
    if (a.kind === 'hardware') continue; // hardware is marked as points (hardwareMarks), not an outline
    attachmentOutlines(a.kind === 'label' ? { ...a, ...labelSize(a) } : a).forEach((pts, i) => outlines.push({ name: i ? '' : a.name, kind: a.kind, pts, centre: { x: a.x, y: a.y } }));
  }
  for (const q of pieces) {
    const po = patchOutline(q);
    if (po && po.host === p.id) outlines.push({ name: q.name, kind: 'patch', pts: po.pts, centre: { x: q.placement!.x ?? 0, y: q.placement!.y ?? 0 } });
  }
  const pleats = (edits?.pleats ?? []).filter((pl) => pl.pieceId === p.id).map((pl) => ({ pleat: pl, marks: pleatMarks(p, pl) })).filter((x) => x.marks);
  return { outlines, pleats: pleats as { pleat: Pleat; marks: NonNullable<ReturnType<typeof pleatMarks>> }[] };
}


// =====================================================================================================
// Tech pack content builders (pure): what a manufacturer needs, as plain rows. exportPdf.ts only lays them out.
// =====================================================================================================

/** Roll width (cm) and marker waste factor behind every consumption estimate. */
export const FABRIC_WIDTH = 150;
export const MARKER_WASTE = 1.25;

/** Cut area of one piece (cm2): the sewing line grown by the 1 cm seam allowance. */
export function pieceCutArea(p: Piece): number {
  return Math.abs(signedArea(offsetInward(samplePoly(p.points, 12), -1)));
}

export interface FabricBomRow {
  key: string;
  /** outside = shell face; inside = a different fabric on the inside face of a piece; attachment = a pocket, patch or tag cut from its own cloth; lining = an attachment's own lining */
  face: 'outside' | 'inside' | 'attachment' | 'lining';
  faceLabel: string;
  fabric: string;
  category: string;
  gsm: number;
  /** thickness of one layer of this cloth (mm) */
  thickness: number;
  /** the layer stack of every piece the row covers that is made of more than one cloth: 'Front: Cotton Jersey + Leather lining, 1.7 mm, 1080 g/m2' */
  stacks: string[];
  composition: string;
  colour: string;
  hex: string;
  /** pattern name, repeat, colourway; undefined for a plain cloth */
  pattern?: string;
  repeat?: string;
  colourway?: string;
  /** opacity, shift, hidden and recoloured colours */
  adjust?: string;
  /** plain, woven in or printed on */
  construction: 'plain' | 'woven' | 'printed';
  finish: string;
  /** pieces (with cut counts) and attachments the row covers */
  where: string[];
  /** outside rows: pieces whose inside face is the same cloth (no inside fabric chosen) */
  insideToo: string[];
  pieces: number;
  areaCm2: number;
  /** metres of roll at FABRIC_WIDTH with MARKER_WASTE */
  metres: number;
  kg: number;
  ref: FabricRef;
}

const SHEEN_NAME: Record<string, string> = { matte: 'Matte', satin: 'Satin sheen', glossy: 'Glossy', metallic: 'Metallic' };

function bomBase(ref: FabricRef & { sheen?: string }) {
  const i = fabricInfo(ref), f = fabricById(ref.id);
  const pat = ref.pattern && ref.pattern.id !== 'solid' ? withPatternDefaults(ref.pattern) : undefined;
  return {
    fabric: i.fabric, category: i.category, gsm: i.gsm, thickness: fabricThickness(f.id), composition: compositionOf(f.id), colour: i.colour, hex: i.hex,
    ...(pat ? { pattern: PATTERNS[pat.id]?.name ?? pat.id, repeat: `${Math.round(pat.scale * 10) / 10} cm${pat.rotation ? `, at ${Math.round(pat.rotation)} deg` : ''}`, colourway: i.colourway, ...(i.adjust ? { adjust: i.adjust } : {}) } : {}),
    construction: (pat ? (pat.method ?? 'printed') : 'plain') as 'plain' | 'woven' | 'printed',
    finish: ref.sheen ? SHEEN_NAME[ref.sheen] ?? ref.sheen : 'Natural finish of the cloth',
  };
}

/**
 * Bill of materials for cloth, outside and inside faces kept apart: one row per fabric, colour, pattern and finish on
 * each face. Inside rows exist only where an inside fabric differs from the piece's outside fabric (under collar,
 * placket facing, lining look). Cloth attachments with their own fabric get rows too; those cut from the host fabric
 * add their area to its outside row.
 */
export function fabricBom(pieces: Piece[], edits?: Edits, style?: StyleId, width = FABRIC_WIDTH, waste = MARKER_WASTE): FabricBomRow[] {
  const rows = new Map<string, FabricBomRow>();
  const order: string[] = [];
  const add = (face: FabricBomRow['face'], ref: FabricRef & { sheen?: string }, where: string, area: number, count: number, insideToo?: string, stack?: string) => {
    const key = `${face}|${fabricKey(ref)}|${ref.sheen ?? ''}`;
    let r = rows.get(key);
    if (!r) {
      r = { key, face, faceLabel: face === 'outside' ? 'Outside (shell)' : face === 'inside' ? 'Inside face' : face === 'lining' ? 'Attachment lining' : 'Attachment cloth', ...bomBase(ref), stacks: [], where: [], insideToo: [], pieces: 0, areaCm2: 0, metres: 0, kg: 0, ref };
      rows.set(key, r);
      order.push(key);
    }
    if (!r.where.includes(where)) r.where.push(where);
    if (insideToo && !r.insideToo.includes(insideToo)) r.insideToo.push(insideToo);
    if (stack && !r.stacks.includes(stack)) r.stacks.push(stack);
    r.pieces += count;
    r.areaCm2 += area * count;
  };
  const patch = (p: Piece) => p.role === 'custom' && p.placement?.mode === 'patch';
  for (const p of pieces) {
    if (patch(p)) continue;
    const label = p.cut > 1 ? `${p.name} (x${p.cut})` : p.name;
    const inner = edits?.insideFabric?.[p.id];
    const differs = inner && fabricKey(inner) !== fabricKey(p.fabric);
    const S = stackOf(p, edits), st = S.plies.length > 1 ? `${p.name}: ${stackText(S)}` : undefined;
    add('outside', p.fabric, label, pieceCutArea(p), p.cut, differs ? undefined : p.name, st);
    if (differs) add('inside', inner, `${style ? faceLabel(style, p, 'inside') : 'Inside'}: ${p.name}${p.cut > 1 ? ` (x${p.cut})` : ''}`, pieceCutArea(p), p.cut, undefined, st);
  }
  // user pieces patched onto the garment, and cloth attachments
  const atts = attachmentReport(pieces, edits, style);
  for (const r of atts) {
    if (!r.cutPieces) continue;
    const a = edits?.attachments.find((q) => q.id === r.id);
    if (a?.kind === 'label') continue; // tags are a trim, listed with the trims
    const up = pieces.find((q) => q.id === r.id);
    const host = pieces.find((q) => q.name === r.host);
    const ref = (a?.fabric ?? up?.fabric ?? host?.fabric) as (FabricRef & { sheen?: string }) | undefined;
    if (!ref) continue;
    let area = 0;
    if (a) for (const sh of attachmentShapes(a)) area += Math.abs(signedArea(sh.outer)) - sh.holes.reduce((t, h) => t + Math.abs(signedArea(h)), 0) + perimeter(sh.outer);
    else if (up) area = pieceCutArea(up);
    const same = !up && host && fabricKey(ref) === fabricKey(host.fabric);
    const S = a ? attachmentStack(a, ref.id) : up ? stackOf(up, edits) : undefined;
    const st = S && S.plies.length > 1 ? `${r.name}: ${stackText(S)}` : undefined;
    const where = `${r.name} (${r.kind}${r.copies > 1 ? `, x${r.copies}` : ''})`;
    add(up || same ? 'outside' : 'attachment', same ? host.fabric : ref, where, area, r.copies, undefined, st);
    if (a?.lining) add('lining', { id: a.lining.id, color: a.lining.color, ...(a.lining.hex ? { hex: a.lining.hex } : {}) }, where, area, r.copies, undefined, st);
  }
  const out = order.map((k) => rows.get(k)!);
  for (const r of out) {
    r.metres = (r.areaCm2 / width / 100) * waste;
    r.kg = (r.areaCm2 / 10000) * (r.gsm / 1000) * waste;
  }
  const rank = { outside: 0, inside: 1, attachment: 2, lining: 3 } as const;
  return out.sort((a, b) => rank[a.face] - rank[b.face]);
}

/** A measured distance from a reference on the host piece to an item's centre (host local cm), with the line to draw. */
export interface PlaceRef { label: string; value: number; from: Pt; to: Pt }

/**
 * How far a point on a piece is from the usual references a factory measures from: the centre line or centre seam,
 * the shoulder point (HPS) or waist, and the hem or opening edge. All on the piece's own pattern coordinates; the
 * lines run straight across (horizontal) and straight down (vertical) like a measuring tape on the flat garment.
 */
export function placementRefs(style: StyleId | undefined, host: Piece | undefined, at: Pt): PlaceRef[] {
  if (!host) return [];
  const bb = bbox(samplePoly(host.points, 12));
  const tags = (t: string) => host.points.filter((q) => q.tag === t);
  const nearX = <T extends Pt>(list: T[]) => list.length ? list.reduce((a, b) => (Math.abs(b.x - at.x) < Math.abs(a.x - at.x) ? b : a)) : undefined;
  const refs: PlaceRef[] = [];
  const horiz = (label: string, x: number) => refs.push({ label, value: Math.abs(at.x - x), from: { x, y: at.y }, to: { x: at.x, y: at.y } });
  const vert = (label: string, y: number) => refs.push({ label, value: Math.abs(at.y - y), from: { x: at.x, y }, to: { x: at.x, y: at.y } });
  const fam = style ? styleById(migrateGarment(style)).family : undefined;
  const hps = nearX(tags('hps'));
  const hem = tags('hem');
  if ((host.role === 'front' || host.role === 'back') && hps) {
    horiz(host.role === 'front' ? 'From centre front' : 'From centre back', 0);
    vert('Down from shoulder point (HPS)', hps.y);
    if (hem.length) vert('Up from hem', Math.max(...hem.map((q) => q.y)));
  } else if (host.role === 'sleeve') {
    horiz('From sleeve centre line', 0);
    vert('Down from sleeve top', bb.minY);
    const cuff = tags('cuff');
    vert(fam === 'shirt' || fam === 'jacket' ? 'Up from cuff edge' : 'Up from sleeve opening', cuff.length ? Math.max(...cuff.map((q) => q.y)) : bb.maxY);
  } else if ((host.role === 'front' || host.role === 'back') && tags('waistC').length) {
    const wc = tags('waistC')[0], ws = tags('waistS')[0];
    horiz(host.role === 'front' ? 'From centre front seam' : 'From centre back seam', wc.x);
    if (ws) horiz('From outseam at waist', ws.x);
    vert('Down from waist edge', wc.y);
    if (hem.length) vert('Up from hem', Math.max(...hem.map((q) => q.y)));
  } else if (host.role === 'crown' || host.role === 'brim' || host.role === 'crownFront') {
    horiz('From panel centre line', 0);
    vert('From top edge', bb.minY);
    vert('From bottom edge', bb.maxY);
  } else {
    const cl = host.symmetric && host.role !== 'custom';
    if (cl) horiz('From centre line', 0);
    else horiz('From left edge', bb.minX), horiz('From right edge', bb.maxX);
    vert('From top edge', bb.minY);
    vert('From bottom edge', bb.maxY);
  }
  return refs.map((r) => ({ ...r, value: Math.round(r.value * 10) / 10 }));
}

export interface TrimDetail {
  /** callout number, shared by the photo, the placement map and the table */
  no: number;
  id: string;
  name: string;
  kind: Attachment['kind'];
  /** plain item name: 'Rivet', 'Chest patch', 'Woven label' */
  item: string;
  material: string;
  finish: string;
  colour: string;
  thread: string;
  stitch: string;
  method: string;
  qty: number;
  size: string;
  w: number;
  h: number;
  rotation: number;
  /** centre on the host (host local pattern cm) */
  at: Pt;
  host: string;
  hostId: string;
  instance?: number;
  /** 'Right front leg', 'Both sleeves' */
  side: string;
  face: Face;
  /** 'Outside', 'Under collar', 'Inside' */
  faceName: string;
  refs: PlaceRef[];
  /** artwork on the item, one line per layer */
  layers: { label: string; color: string; size: string }[];
  /** the cloth, for pockets, patches, appliques, straps */
  fabric?: string;
  /** outline(s) to draw on the host: one ring per letter, or none for hardware */
  outlines: Pt[][];
  /** hardware: each trim position and radius, or the zip line */
  points: { at: Pt; r: number }[];
  line?: [Pt, Pt];
  /** for the placement crop: the host piece outline, a custom piece's own outline for a user patch */
  note?: string;
}

const METAL = new Set(['silver', 'brass', 'copper', 'gunmetal']);
const mm = (cm: number) => `${round1(cm * 10)} mm`;
const hwMaterial = (h: Hardware) => (h.type === 'zipper' ? (h.zipper?.teeth === 'metal' ? 'Metal teeth on cloth tape' : h.zipper ? `${cap(TEETH[h.zipper.teeth] ?? h.zipper.teeth)} on cloth tape` : 'Zip') : METAL.has(h.finish) ? 'Metal' : 'Plastic');

function threadText(a: Attachment, style?: StyleId): string {
  if (a.thread) { const n = colorNameOfHex(a.thread); return n === a.thread ? a.thread : `${n} (${a.thread})`; }
  const t = style ? styleById(migrateGarment(style)).details.topstitch : undefined;
  if (t && t.color !== 'match') return `${colorNameOfHex(t.color)} (${t.color})`;
  return 'Matched to the fabric';
}
const colorNameOfHex = (h: string) => (/^#/.test(h) ? hexName(h) : h);

function stitchText(a: Attachment, style?: StyleId): string {
  const t = style ? styleById(migrateGarment(style)).details.topstitch : undefined;
  const top = t ? `Topstitch ${t.needles} needle lockstitch 301, ${round1(Math.min(t.offset, 0.5))} cm from the edge` : 'Lockstitch 301, 0.2 cm from the edge';
  switch (a.kind) {
    case 'pocket': return `${top}; bar tack at both top corners`;
    case 'patch': return top;
    case 'applique': return 'Satin stitch (zigzag 304), 0.3 cm wide, all round';
    case 'strap': return `${top}; bar tack at each end`;
    case 'label': return a.label?.sewn === 'all-round' ? top : 'Lockstitch 301 across the ends';
    case 'embroidery': return 'Satin stitch embroidery, stabiliser behind the cloth';
    case 'print': return 'No stitching. Printed ink';
    case 'hardware': {
      const h = a.hardware;
      if (!h) return '';
      if (h.type === 'zipper') return 'Lockstitch 301 along both tapes';
      if (h.type === 'button') return h.holes === 'shank' ? 'Machine sewn shank button, thread shank' : `Machine sewn, ${h.holes ?? 4} hole cross stitch, 6 stitches`;
      return 'No stitching. Set through the fabric with a press tool';
    }
  }
}

const KIND_ITEM: Record<Attachment['kind'], string> = { pocket: 'Pocket', patch: 'Patch', applique: 'Applique', strap: 'Strap', embroidery: 'Embroidery', print: 'Print', hardware: 'Hardware', label: 'Label' };

/** Artwork layers in plain words. */
function layerRows(layers: Attachment['layers']): TrimDetail['layers'] {
  return layers.map((l) => ({
    label: l.shape === 'text' ? `Text "${l.text ?? ''}"` : l.shape === 'image' ? 'Picture' : l.shape === 'path' ? 'Drawn shape' : SHAPES[l.shape]?.name ?? l.shape,
    color: l.color,
    size: l.clip ? (() => { const b = shownBox(l); return `${round1(b.x1 - b.x0)} x ${round1(b.y1 - b.y0)} cm`; })() : `${round1(l.w)} x ${round1(l.h)} cm`,
  }));
}

/**
 * One row per item a manufacturer has to place: every attachment (pocket, patch, applique, strap, embroidery, print,
 * hardware, label) and every user piece patched on. Numbered in the order of attachmentReport, with the measured
 * position from the usual references, the specs and the artwork layers.
 */
export function trimDetails(pieces: Piece[], edits?: Edits, style?: StyleId): TrimDetail[] {
  const out: TrimDetail[] = [];
  const rep = attachmentReport(pieces, edits, style);
  for (const r of rep) {
    const a0 = edits?.attachments.find((q) => q.id === r.id);
    const host = pieces.find((q) => q.name === r.host) ?? pieces.find((q) => q.id === a0?.pieceId);
    if (!a0) {
      // a user piece patched onto its host
      const up = pieces.find((q) => q.id === r.id)!;
      const hostP = pieces.find((q) => q.id === up.placement?.hostPieceId);
      const poly = patchOutline(up);
      out.push({
        no: out.length + 1, id: r.id, name: r.name, kind: 'patch', item: 'Patch', material: fabricText(up.fabric), finish: up.fabric.sheen ? SHEEN_NAME[up.fabric.sheen] ?? up.fabric.sheen : 'Natural', colour: `${colorName(up.fabric)} (${fabricHex(up.fabric)})`,
        thread: 'Matched to the fabric', stitch: stitchText({ kind: 'patch' } as Attachment, style), method: 'Sewn all round', qty: r.copies, size: `${round1(r.w)} x ${round1(r.h)} cm`, w: r.w, h: r.h, rotation: r.rotation,
        at: { x: r.x, y: r.y }, host: hostP?.name ?? r.host, hostId: hostP?.id ?? '', ...(up.placement?.instance !== undefined ? { instance: up.placement.instance } : {}), side: r.side, face: 'outside', faceName: 'Outside',
        refs: placementRefs(style, hostP, { x: r.x, y: r.y }), layers: [], fabric: fabricText(up.fabric), outlines: poly ? [poly.pts] : [], points: [],
      });
      continue;
    }
    const a = a0.kind === 'label' ? { ...a0, ...labelSize(a0) } : a0;
    const face = faceOf(a);
    const faceName = host && style ? faceLabel(style, host, face) : face === 'inside' ? 'Inside' : 'Outside';
    const base = { no: out.length + 1, id: a.id, name: a.name, kind: a.kind, w: a.w, h: a.h, rotation: a.rotation, at: { x: a.x, y: a.y }, host: host?.name ?? r.host, hostId: host?.id ?? a.pieceId, ...(a.instance !== undefined ? { instance: a.instance } : {}), side: r.side, face, faceName, refs: placementRefs(style, host, { x: a.x, y: a.y }), layers: layerRows(a.layers), qty: r.copies, stitch: stitchText(a, style), method: r.stitched[0].toUpperCase() + r.stitched.slice(1) };
    const sheen = a.sheen ? SHEEN_NAME[a.sheen] ?? a.sheen : undefined;
    if (a.kind === 'hardware' && a.hardware) {
      const h = a.hardware, m = hardwareMarks({ ...host!, id: a.pieceId }, { ...edits!, attachments: [a] })[0];
      const n = h.type === 'zipper' ? 1 : Math.max(1, Math.round(h.count ?? 1));
      out.push({
        ...base, item: HW_NAME[h.type] ?? cap(h.type), material: hwMaterial(h), finish: sheen ?? (h.sheen ? SHEEN_NAME[h.sheen] : METAL.has(h.finish) ? 'Polished metal' : 'Matte'), colour: h.color ?? (h.zipper ? `${cap(h.finish)} teeth, tape ${h.zipper.tape}` : cap(h.finish)),
        thread: h.type === 'button' ? 'Matched to the fabric' : 'None', size: h.type === 'zipper' ? `${round1(a.h)} cm long, ${mm(h.size)} tape` : n > 1 ? `${mm(h.size)} diameter, ${n} in a row, ${round1(h.spacing ?? Math.max(1.5, h.size * 2))} cm apart` : `${mm(h.size)} diameter`,
        qty: n * r.copies, fabric: undefined, outlines: [], points: m?.points ?? [], ...(m?.line ? { line: m.line } : {}), note: hardwareDetail(h, a),
      });
    } else if (a.kind === 'label') {
      const t = labelReport(pieces, { ...edits!, attachments: [a] }, style)[0], mat = labelMaterial(a);
      out.push({
        ...base, item: `${cap(a.label?.type ?? 'woven')} label`, material: mat.name, finish: `${cap(t.sheen)}${mat.purchased ? ', bought finished' : ''}`, colour: t.color, thread: threadText(a, style), size: `${round1(t.w)} x ${round1(t.h)} cm finished, ${round1(t.cutW)} x ${round1(t.cutH)} cm cut`,
        method: t.sewn[0].toUpperCase() + t.sewn.slice(1), outlines: attachmentOutlines(a), points: [],
      });
    } else if (a.kind === 'embroidery') {
      out.push({ ...base, item: 'Embroidery', material: 'Embroidery thread (rayon or polyester)', finish: sheen ?? 'Satin thread sheen', colour: a.thread ?? 'colour matched', thread: threadText(a, style), size: `${round1(a.w)} x ${round1(a.h)} cm${a.text ? `, "${a.text}"` : ''}`, outlines: attachmentOutlines(a), points: [] });
    } else if (a.kind === 'print') {
      out.push({ ...base, item: 'Print', material: 'Ink on the host fabric', finish: sheen ?? 'Matte', colour: a.layers.map((l) => l.color).filter((c, i, all) => all.indexOf(c) === i).join(', ') || 'see artwork', thread: 'None', size: `${round1(a.w)} x ${round1(a.h)} cm`, outlines: attachmentOutlines(a), points: [] });
    } else {
      const ref = (a.fabric ?? host?.fabric) as FabricRef | undefined;
      const shape = a.kind === 'applique' ? (a.shape === 'text' ? `letters "${a.text ?? ''}"` : SHAPES[a.shape ?? 'rect']?.name.toLowerCase()) : undefined;
      out.push({
        ...base, item: KIND_ITEM[a.kind], material: ref ? fabricText(ref) : 'Host fabric', finish: sheen ?? (host?.fabric.sheen ? SHEEN_NAME[host.fabric.sheen] : 'Natural'), colour: ref ? `${colorName(ref)} (${fabricHex(ref)})` : '', thread: threadText(a, style),
        size: `${round1(a.w)} x ${round1(a.h)} cm${shape ? `, ${shape}` : ''}`, fabric: ref ? fabricText(ref) : undefined, outlines: attachmentOutlines(a), points: [],
      });
    }
  }
  return out;
}

export interface ConstructionRow { label: string; type: string; stitch: string; allowance: string; note?: string }

/** Seams and the stitching a style calls for, in plain words for the construction page. */
export function constructionReport(type: GarmentType, pieces: Piece[], edits?: Edits) {
  const st = styleById(migrateGarment(type));
  const d = st.details;
  const knit = !!d.rib || st.family === 'tee' || st.family === 'polo';
  const top = d.topstitch ? `${d.topstitch.needles} needle topstitch, ${round1(d.topstitch.offset)} cm from the seam, thread ${d.topstitch.color === 'match' ? 'matched to the fabric' : colorNameOfHex(d.topstitch.color)}` : undefined;
  const base = knit ? 'Overlock 504' : 'Lockstitch 301 + overlock 504';
  const seams: ConstructionRow[] = seamReport(type, pieces, edits).map((r) => {
    const label = r.label.replace(' (front / back)', '');
    if (r.attachment) return { label, type: 'Attached piece', stitch: stitchText({ kind: 'patch' } as Attachment, type), allowance: '1 cm turned in' };
    const typeName = r.ease !== undefined ? 'Eased seam' : r.seams?.some((id) => id.startsWith('cuff-join') || id.includes('join')) ? 'Closed seam' : 'Plain seam';
    return { label, type: typeName, stitch: `${base}${top ? `; ${top}` : ''}`, allowance: '1 cm', ...(r.ease !== undefined ? { note: `Ease ${round1(r.ease)} cm distributed evenly` } : {}) };
  });
  const finishing: string[] = ['All raw edges overlocked (504) inside, 1 cm seam allowance unless noted'];
  if (d.hem) finishing.push(`Hem: ${d.hem.needles} needle ${knit ? 'coverstitch 406' : 'lockstitch 301'}, ${round1(d.hem.depth)} cm folded`);
  if (top) finishing.push(`Topstitching: ${top}`);
  const has = (r: string) => pieces.some((p) => p.role === r);
  if (!knit && (has('collar') || has('cuff') || has('placket') || has('waistband'))) finishing.push(`Fusible interfacing on ${['collar', 'cuff', 'placket', 'waistband'].filter(has).join(', ')} (recommended, light weight)`);
  if (d.buttons) finishing.push(`${d.buttons} button${d.buttons > 1 ? 's' : ''} with matching buttonholes down the front`);
  if (d.beltLoops) finishing.push(`${d.beltLoops} belt loops at the waistband`);
  if (d.rivets) finishing.push('Copper rivets at pocket corners and fly');
  for (const p of pieces) {
    const inner = edits?.insideFabric?.[p.id];
    if (inner && fabricKey(inner) !== fabricKey(p.fabric)) finishing.push(`${faceLabel(type, p, 'inside')} (${p.name}): ${fabricText(inner)}; outside is ${fabricText(p.fabric)}`);
  }
  for (const c of productionChecks(pieces, edits)) finishing.push(c.resolved ? `Wash sequence: ${c.answer}` : `TO CONFIRM: ${c.text}`);
  const collar = pieces.some((p) => p.role === 'collar') ? (edits?.collar === 'up' ? 'Collar shown popped up (under collar visible)' : 'Collar shown folded down') : undefined;
  const pleats = pleatReport(pieces, edits, type);
  const custom = (edits?.customSeams ?? []).flatMap((cs) => {
    const pa = pieces.find((q) => q.id === cs.a.pieceId), pb = pieces.find((q) => q.id === cs.b.pieceId);
    return pa && pb ? [{ label: `${pa.name} to ${pb.name}`, a: sewnLength(pa, cs.a.fromId, cs.a.toId, edits), b: sewnLength(pb, cs.b.fromId, cs.b.toId, edits), flip: !!cs.flip }] : [];
  });
  const byId = new Map(builtinSeams(type, pieces, { collar: edits?.collar ?? 'down' }).map((s) => [s.id, s.label]));
  const detached = (edits?.detachedSeams ?? []).map((id) => byId.get(id) ?? id);
  return { seams, finishing, collar, pleats, custom, detached, topstitch: top, hem: d.hem ? `${d.hem.needles} needle, ${round1(d.hem.depth)} cm` : undefined };
}

/* ---------- production checks ---------- */

/** genuine leathers: they cannot go through standard industrial denim or garment washes */
const GENUINE_LEATHER = new Set(['leather', 'suede']);
/** cotton and denim cloths that are normally washed (rinse, enzyme, stone, garment dye) */
const WASHED_COTTON = new Set(['denim', 'stretch-denim', 'selvedge-denim', 'raw-denim', 'white-denim', 'black-denim', 'canvas', 'duck', 'poplin', 'oxford', 'chambray', 'shirting-twill', 'flannel', 'seersucker', 'voile', 'jersey', 'rib', 'slub-jersey', 'pique', 'interlock', 'french-terry', 'fleece', 'waffle', 'corduroy', 'moleskin', 'waxed-cotton']);

export const WASH_SEQUENCE_TEXT: Record<WashSequence, string> = {
  prewash: 'Fabric panels are washed before the leather is sewn on. No wash after the leather is attached.',
  garment: 'Garment is washed with the leather attached. Leather must be certified wash resistant for the named wash.',
  none: 'No wash: fabric is used as delivered (raw), so nothing to wash around the leather.',
};

export interface ProductionCheck { id: string; title: string; text: string; resolved: boolean; answer?: string }

/** Things the factory must be told that the pattern alone cannot say. */
export function productionChecks(pieces: Piece[], edits?: Edits): ProductionCheck[] {
  const ids: string[] = [];
  for (const p of pieces) { ids.push(p.fabric.id); const inner = edits?.insideFabric?.[p.id]; if (inner) ids.push(inner.id); }
  for (const a of edits?.attachments ?? []) { if (a.fabric?.id) ids.push(a.fabric.id); if (a.lining?.id) ids.push(a.lining.id); }
  const leather = [...new Set(ids.filter((id) => GENUINE_LEATHER.has(id)))];
  const cotton = [...new Set(ids.filter((id) => WASHED_COTTON.has(id)))];
  const out: ProductionCheck[] = [];
  if (leather.length && cotton.length) {
    const denim = cotton.some((id) => id.includes('denim'));
    const ws = edits?.washSequence;
    out.push({
      id: 'leather-wash',
      title: `${denim ? 'Denim' : 'Cotton'} with genuine leather: wash sequence`,
      text: `This garment mixes ${denim ? 'denim or cotton' : 'cotton'} with genuine leather. Say whether the fabric panels are pre-washed before the leather is sewn on, as leather cannot go through standard industrial denim washes.`,
      resolved: !!ws,
      ...(ws ? { answer: WASH_SEQUENCE_TEXT[ws] } : {}),
    });
  }
  return out;
}

export interface NoteRow { no: number; text: string; piece: string }

/** Text notes of the project numbered for the pattern pages and the construction list. Ink and arrows stay on the chart. */
export function noteRows(notes: Note[] | undefined, pieces: Piece[]): NoteRow[] {
  return (notes ?? []).filter((n) => n.kind === 'text' && n.text?.trim()).map((n, i) => ({ no: i + 1, text: n.text!.trim(), piece: pieces.find((p) => p.id === n.pieceId)?.name ?? 'Chart' }));
}

// ---- outfits: several garments worn together (src/sim/outfit.ts) ----

export interface OutfitGarmentRow {
  projectId: string;
  name: string;
  /** catalog style name, e.g. 'Jeans' */
  style: string;
  category: string;
  /** 1 = next to the skin, counting outward (as worn, from Outfit.items layer order) */
  layer: number;
  /** tops: 'Tucked in' or 'Worn out'; empty for bottoms and headwear */
  wear: string;
  hidden: boolean;
  pieces: number;
  /** fabrics of this garment, one line each (fabricText) */
  fabrics: string[];
}
export interface OutfitMaterialRow extends Omit<FabricBomRow, 'where' | 'insideToo'> {
  /** 'Garment: piece' entries the row covers, across every garment */
  where: string[];
  /** garments using this cloth */
  garments: string[];
}
export interface OutfitTrimRow extends TrimRow { garment: string }
export interface OutfitReport {
  name: string;
  /** garments in layer order, skin side first; items whose project is missing are left out */
  garments: OutfitGarmentRow[];
  /** cloth across the whole outfit: same fabric, colour, pattern and face merged, metres and kg added up */
  materials: OutfitMaterialRow[];
  /** trims, labels, embroidery and appliques of every garment, with the garment they are on */
  trims: OutfitTrimRow[];
  totals: { garments: number; pieces: number; metres: number; kg: number; trims: number };
}

/**
 * Outfit summary for the tech pack: the garments with their layer and how a top is worn, the combined cloth bill of
 * materials (one row per fabric, colour and pattern across all garments) and every trim with its garment.
 * `projects`: the saved projects (any order; the open one should be its live copy).
 */
export function outfitReport(outfit: Outfit, projects: Project[]): OutfitReport {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const items = outfit.items.slice().sort((a, b) => a.layer - b.layer).filter((i) => byId.has(i.projectId));
  const garments: OutfitGarmentRow[] = [];
  const materials: OutfitMaterialRow[] = [];
  const trims: OutfitTrimRow[] = [];
  items.forEach((it, k) => {
    const p = byId.get(it.projectId)!;
    const style = styleById(migrateGarment(p.garment));
    const top = style.category === 'tops';
    garments.push({
      projectId: p.id, name: p.name, style: style.name, category: style.category, layer: k + 1,
      wear: top ? (it.tuck === 'in' ? 'Tucked in' : 'Worn out') : '', hidden: !!it.hidden, pieces: p.pieces.length,
      fabrics: [...new Set(p.pieces.map((q) => fabricText(q.fabric)))],
    });
    for (const r of fabricBom(p.pieces, p.edits, style.id)) {
      const where = r.where.map((w) => `${p.name}: ${w}`);
      const same = materials.find((m) => m.key === r.key && m.face === r.face);
      if (same) {
        same.where.push(...where);
        if (!same.garments.includes(p.name)) same.garments.push(p.name);
        same.pieces += r.pieces; same.areaCm2 += r.areaCm2; same.metres += r.metres; same.kg += r.kg;
      } else {
        const { insideToo: _i, where: _w, ...rest } = r;
        materials.push({ ...rest, where, garments: [p.name] });
      }
    }
    for (const t of trimsReport(p.pieces, p.edits, style.id)) trims.push({ ...t, garment: p.name });
  });
  for (const m of materials) { m.metres = Math.round(m.metres * 100) / 100; m.kg = Math.round(m.kg * 1000) / 1000; m.areaCm2 = Math.round(m.areaCm2); }
  return {
    name: outfit.name, garments, materials, trims,
    totals: {
      garments: garments.length, pieces: garments.reduce((s, g) => s + g.pieces, 0),
      metres: Math.round(materials.reduce((s, m) => s + m.metres, 0) * 100) / 100,
      kg: Math.round(materials.reduce((s, m) => s + m.kg, 0) * 1000) / 1000,
      trims: trims.reduce((s, t) => s + t.qty, 0),
    },
  };
}
