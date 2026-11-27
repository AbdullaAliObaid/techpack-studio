// Typed measurements: change the pattern so a measurement reads exactly the number the user typed.
//
// A target is a measurement the UI shows: an edge run between two outline points, a piece spec (collar length,
// placket length, chest width ...), a finished garment measurement, or a fit table row. Each target has
//  - read(pieces): the number the UI shows for it (cm), and
//  - a handle: the points that move, and which way, per cm of change (derived from the spec definition: widths move the
//    side points across, lengths move the hem or end points down, a run moves its end point along its chord).
// A secant solve finds how far to move the handle so read() equals the typed value. Smooth points carry no stored
// handles (curves are derived from neighbours), so moving points keeps every curve smooth, and points keep their keys.
// A point and its in-piece mirror always move together, so symmetric pieces stay symmetric.
//
// With total symmetry every handle point goes through linkedMoves (src/data/symmetry.ts), so mating pieces follow and
// the seams the edit touches are walked. The whole solve returns plain PointMoves; the store applies them as one undo step.

import { bbox, outlineLength, sliceSpan, samplePoly, type PPoint } from '../lib/geometry';
import { computeSpec, findTag, garmentSpecs } from '../lib/specs';
import type { Piece, SpecDef } from './presets';
import { migrateGarment, styleById, type StyleId } from './catalog';
import { frontOffset } from './draft';
import { applyMoves, linkedMoves, type PointMove } from './symmetry';

export type MeasureTarget =
  | { kind: 'edge'; pieceId: string; fromId: string; toId: string }
  | { kind: 'spec'; pieceId: string; label: string }
  | { kind: 'garment'; label: string }
  | { kind: 'fit'; label: string };

export interface MeasureOpts {
  /** run every move through total symmetry (mating pieces follow, seams are walked) */
  total?: boolean;
}

/** Stable id of a target, for pulses and editor state. */
export const targetKey = (t: MeasureTarget) =>
  t.kind === 'edge' ? `edge:${t.pieceId}:${t.fromId}:${t.toId}` : t.kind === 'spec' ? `spec:${t.pieceId}:${t.label}` : `${t.kind}:${t.label}`;

/** One point moved by (dx, dy) per cm of change. */
interface H { pieceId: string; pointId: string; dx: number; dy: number }
interface Res { read: (ps: Piece[]) => number | null; handle: H[] }

const onAxis = (p: PPoint) => p.mirror === p.id;

/** Keep one point of every in-piece mirror pair: moving a point moves its mirror too. */
function dedupe(piece: Piece, pts: PPoint[], dx: number, dy: number): H[] {
  const taken = new Set<string>();
  const out: H[] = [];
  for (const p of pts) {
    if (taken.has(p.id)) continue;
    taken.add(p.id);
    if (p.mirror && p.mirror !== p.id) taken.add(p.mirror);
    out.push({ pieceId: piece.id, pointId: p.id, dx, dy });
  }
  return out;
}

const unit = (x: number, y: number) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

function specHandle(p: Piece, s: SpecDef): H[] {
  const poly = samplePoly(p.points);
  switch (s.kind) {
    case 'mirror': {
      const t = findTag(p, s.tag);
      if (!t) return [];
      const m = p.points.find((q) => q.id === t.mirror && q.id !== t.id);
      const sign = !m || t.x >= m.x ? 1 : -1;
      // both ends move out together: half a cm each per cm
      return [{ pieceId: p.id, pointId: t.id, dx: m ? sign * 0.5 : sign, dy: 0 }];
    }
    case 'dist': {
      const a = findTag(p, s.tags[0]), b = findTag(p, s.tags[1]);
      if (!a || !b) return [];
      const d = unit(b.x - a.x, b.y - a.y);
      // the end on the centre line cannot move across it
      if (onAxis(b) && Math.abs(d.x) > Math.abs(d.y)) return [{ pieceId: p.id, pointId: a.id, dx: -d.x, dy: -d.y }];
      return [{ pieceId: p.id, pointId: b.id, dx: d.x, dy: d.y }];
    }
    case 'vdist': {
      const a = findTag(p, s.tags[0]), b = findTag(p, s.tags[1]);
      if (!a || !b) return [];
      // everything from the far end on moves, so the other lengths (the inseam when the rise changes) stay put
      const down = b.y >= a.y;
      const pts = p.points.filter((q) => (down ? q.y >= b.y - 1e-6 : q.y <= b.y + 1e-6));
      return dedupe(p, pts, 0, down ? 1 : -1);
    }
    case 'length': {
      const bb = bbox(poly);
      return dedupe(p, p.points.filter((q) => q.y >= bb.maxY - 0.02), 0, 1);
    }
    case 'slice': {
      const t = findTag(p, s.tag);
      if (!t) return [];
      const y = t.y + (s.dy ?? 0);
      const span = s.full ? sliceSpan(poly, y) : sliceSpan(poly, y, t.x);
      if (!span) return [];
      const m = p.points.find((q) => q.id === t.mirror && q.id !== t.id);
      if (m) return [{ pieceId: p.id, pointId: t.id, dx: (t.x >= m.x ? 1 : -1) * 0.5, dy: 0 }];
      const right = Math.abs(t.x - span.x2) < Math.abs(t.x - span.x1);
      return [{ pieceId: p.id, pointId: t.id, dx: right ? 1 : -1, dy: 0 }];
    }
  }
}

function edgeHandle(p: Piece, fromId: string, toId: string): H[] {
  const f = p.points.find((q) => q.id === fromId), t = p.points.find((q) => q.id === toId);
  if (!f || !t) return [];
  if (t.mirror === f.id && f.id !== t.id) return [{ pieceId: p.id, pointId: t.id, dx: (t.x >= f.x ? 1 : -1) * 0.5, dy: 0 }];
  const d = unit(t.x - f.x, t.y - f.y);
  const stuck = (q: PPoint, dx: number) => onAxis(q) && Math.abs(dx) > 0.7;
  if (stuck(t, d.x) && !stuck(f, d.x)) return [{ pieceId: p.id, pointId: f.id, dx: -d.x, dy: -d.y }];
  return [{ pieceId: p.id, pointId: t.id, dx: d.x, dy: d.y }];
}

const byKey = (p: Piece | undefined, key: string) => p?.points.find((q) => q.key === key);

/** Pieces and spec labels (or edges) a finished garment measurement is made of. */
type Comp = { role: string; label: string } | { role: string; edge: [string, string] };
const FB = (label: string): Comp[] => [{ role: 'front', label }, { role: 'back', label }];
const GARMENT: Record<string, Comp[]> = {
  'Chest circumference': FB('Chest'),
  'Waist circumference': FB('Waist'),
  'Hem circumference': FB('Hem'),
  'Hip circumference': FB('Hip'),
  'Thigh circumference': FB('Thigh'),
  'Knee circumference': FB('Knee'),
  'Leg opening': FB('Leg opening'),
  'Shoulder width': FB('Shoulder'),
  'Body length (CB)': [{ role: 'back', label: 'Length' }],
  'Sleeve length': [{ role: 'sleeve', label: 'Length' }],
  'Bicep circumference': [{ role: 'sleeve', label: 'Bicep' }],
  'Sleeve opening': [{ role: 'sleeve', label: 'Opening' }],
  'Cuff opening': [{ role: 'sleeve', label: 'Cuff' }],
  'Neckband length': [{ role: 'neckband', label: 'Neckband length' }],
  'Placket length': [{ role: 'placket', label: 'Length' }],
  'Front rise': [{ role: 'front', label: 'Rise' }],
  'Back rise': [{ role: 'back', label: 'Rise' }],
  Outseam: [{ role: 'front', label: 'Length' }, { role: 'back', label: 'Length' }],
  'Ankle cuff': [{ role: 'cuff', label: 'Cuff length' }],
  // every headwear block: crown panels (and a five panel front), a beanie body, a visor band and strap
  'Head band circumference': [
    { role: 'crown', label: 'Panel base' }, { role: 'crownFront', label: 'Panel base' }, { role: 'crown', label: 'Band width' },
    { role: 'cuff', label: 'Cuff width' }, { role: 'headband', label: 'Band length' }, { role: 'strap', label: 'Strap length' },
  ],
  'Body length': [{ role: 'crown', label: 'Body length' }],
  'Cuff height': [{ role: 'cuff', label: 'Cuff height' }],
  'Band height': [{ role: 'headband', label: 'Band height' }],
  'Crown depth': [{ role: 'crown', edge: ['crown.0', 'crown.3'] }],
  'Visor depth': [{ role: 'brim', label: 'Visor depth' }],
  'Brim width': [{ role: 'brim', label: 'Brim width' }],
};

function compHandle(pieces: Piece[], c: Comp): H[] {
  const p = pieces.find((q) => q.role === c.role);
  if (!p) return [];
  if ('edge' in c) {
    const a = byKey(p, c.edge[0]), b = byKey(p, c.edge[1]);
    return a && b ? edgeHandle(p, a.id, b.id) : [];
  }
  const def = p.specs.find((s) => s.label === c.label);
  return def ? specHandle(p, def) : [];
}

function garmentRes(style: StyleId, pieces: Piece[], label: string, off = 0): Res | null {
  const read = (ps: Piece[]) => { const r = garmentSpecs(style, ps).find((x) => x.label === label); return r ? r.value + off : null; };
  if (read(pieces) === null) return null;
  if (label === 'Neck opening') {
    // the neckline gets wider or narrower: the neck width points (high point shoulder) of front and back
    const fo = frontOffset(migrateGarment(style));
    const f = pieces.find((p) => p.role === 'front'), b = pieces.find((p) => p.role === 'back');
    const hs: H[] = [];
    for (const [p, key] of [[f, `front.${fo + 2}`], [b, 'back.2']] as const) {
      const q = byKey(p, key);
      if (p && q) hs.push({ pieceId: p.id, pointId: q.id, dx: q.x >= 0 ? 1 : -1, dy: 0 });
    }
    return hs.length ? { read, handle: hs } : null;
  }
  const comps = GARMENT[label];
  if (!comps) return null;
  const handle = comps.flatMap((c) => compHandle(pieces, c));
  return handle.length ? { read, handle } : null;
}

function specRes(pieces: Piece[], p: Piece | undefined, label: string, off = 0): Res | null {
  const def = p?.specs.find((s) => s.label === label);
  if (!p || !def) return null;
  const handle = specHandle(p, def);
  const id = p.id;
  return handle.length ? { read: (ps) => { const q = ps.find((x) => x.id === id); return q ? (computeSpec(q, def)?.value ?? 0) + off : null; }, handle } : null;
}

function fitRes(style: StyleId, pieces: Piece[], label: string): Res | null {
  const fam = styleById(migrateGarment(style)).family;
  const role = (r: string) => pieces.find((p) => p.role === r);
  const wb = role('waistband');
  const bandH = wb ? bbox(wb.points).h : 0;
  const G = (l: string, off = 0) => garmentRes(style, pieces, l, off);
  switch (label) {
    case 'Chest': return G('Chest circumference');
    case 'Waist': return G('Waist circumference');
    case 'Hem / hips': return G('Hem circumference');
    case 'Hip': return G('Hip circumference');
    case 'Thigh': return G('Thigh circumference');
    case 'Knee': return G('Knee circumference');
    case 'Leg opening': return G('Leg opening');
    case 'Ankle cuff': return G('Ankle cuff');
    case 'Shoulder': return G('Shoulder width');
    case 'Bicep': return G('Bicep circumference');
    case 'Sleeve opening': return G('Sleeve opening');
    case 'Sleeve length': return G('Sleeve length');
    case 'Sleeve / arm': return G('Sleeve length', fam === 'shirt' ? 6 : 0);
    case 'Neck base': return fam === 'tee' ? G('Neck opening') : specRes(pieces, role('collar'), 'Collar length');
    case 'Neck': return specRes(pieces, role('collar'), 'Collar length');
    case 'Cuff / wrist': return fam === 'shirt' ? specRes(pieces, role('cuff'), 'Cuff length') : G('Cuff opening');
    case 'Front rise': return G('Front rise', bandH);
    case 'Inseam': return specRes(pieces, role('front'), 'Inseam');
    case 'Outseam': return G('Outseam', bandH);
    case 'Head': return G('Head band circumference');
    case 'Crown depth': return G('Crown depth');
    case 'Body length': return G('Body length');
    case 'Band height': return G('Band height');
  }
  return null;
}

function resolve(style: StyleId, pieces: Piece[], t: MeasureTarget): Res | null {
  if (t.kind === 'edge') {
    const p = pieces.find((q) => q.id === t.pieceId);
    if (!p) return null;
    const handle = edgeHandle(p, t.fromId, t.toId);
    const { pieceId: id, fromId, toId } = t;
    return handle.length ? { read: (ps) => { const q = ps.find((x) => x.id === id); return q ? outlineLength(q.points, fromId, toId) : null; }, handle } : null;
  }
  if (t.kind === 'spec') return specRes(pieces, pieces.find((p) => p.id === t.pieceId), t.label);
  if (t.kind === 'garment') return garmentRes(style, pieces, t.label);
  return fitRes(style, pieces, t.label);
}

/** The number a target reads now (cm), or null when the garment has no such measurement. */
export function measureValue(style: StyleId, pieces: Piece[], t: MeasureTarget): number | null {
  return resolve(style, pieces, t)?.read(pieces) ?? null;
}

/** Can this target be typed into? (Elastic length and the like are not drawn geometry.) */
export const canEditMeasure = (style: StyleId, pieces: Piece[], t: MeasureTarget) => !!resolve(style, pieces, t);

function plainMoves(pieces: Piece[], hs: H[], s: number): PointMove[] {
  const acc = new Map<string, PointMove>();
  const add = (pieceId: string, pointId: string, dx: number, dy: number) => {
    const k = pieceId + '|' + pointId;
    const m = acc.get(k) ?? { pieceId, pointId, dx: 0, dy: 0 };
    m.dx += dx; m.dy += dy;
    acc.set(k, m);
  };
  for (const h of hs) {
    const p = pieces.find((q) => q.id === h.pieceId)?.points.find((q) => q.id === h.pointId);
    if (!p) continue;
    const axis = onAxis(p);
    add(h.pieceId, p.id, axis ? 0 : h.dx * s, h.dy * s);
    if (p.mirror && !axis) add(h.pieceId, p.mirror, -h.dx * s, h.dy * s);
  }
  return [...acc.values()];
}

function linkedAll(style: StyleId, pieces: Piece[], hs: H[], s: number): PointMove[] {
  const acc = new Map<string, PointMove>();
  let cur = pieces;
  for (const h of hs) {
    const mv = linkedMoves(style, cur, h.pieceId, h.pointId, h.dx * s, h.dy * s);
    cur = applyMoves(cur, mv);
    for (const m of mv) {
      const k = m.pieceId + '|' + m.pointId;
      const a = acc.get(k) ?? { pieceId: m.pieceId, pointId: m.pointId, dx: 0, dy: 0 };
      a.dx += m.dx; a.dy += m.dy;
      acc.set(k, a);
    }
  }
  return [...acc.values()];
}

/**
 * Point moves that make the target read `value` (cm). Empty when nothing needs to move or the target cannot be solved.
 * Apply with applyMoves() as one edit.
 */
export function setMeasurement(style: StyleId, pieces: Piece[], target: MeasureTarget, value: number, opts: MeasureOpts = {}): PointMove[] {
  if (!(value > 0) || !Number.isFinite(value)) return [];
  const res = resolve(style, pieces, target);
  if (!res) return [];
  const f0 = res.read(pieces);
  if (f0 === null || Math.abs(f0 - value) < 1e-5) return [];
  const moves = (s: number) => (opts.total ? linkedAll(style, pieces, res.handle, s) : plainMoves(pieces, res.handle, s));
  const f = (s: number) => res.read(applyMoves(pieces, moves(s))) ?? NaN;
  let s0 = 0, g0 = f0 - value;
  let s1 = value - f0, g1 = f(s1) - value;
  for (let it = 0; it < 10 && Math.abs(g1) > 2e-4; it++) {
    const den = g1 - g0;
    if (!Number.isFinite(den) || Math.abs(den) < 1e-9) break;
    const s2 = s1 - (g1 * (s1 - s0)) / den;
    if (!Number.isFinite(s2) || Math.abs(s2) > 80) break;
    s0 = s1; g0 = g1; s1 = s2; g1 = f(s1) - value;
  }
  if (!(Math.abs(g1) <= 0.04)) return [];
  return moves(s1).filter((m) => Math.abs(m.dx) > 1e-9 || Math.abs(m.dy) > 1e-9);
}
