// "Edit this side only": one copy of a piece cut twice (a placket strip, a sleeve, a front leg) split off into a piece
// of its own, so its outline can differ from the other side. "Match other side" joins it back.
//
// The split piece (Piece.splitOf = the piece it came from, Piece.side = the copy it stands in for) keeps the role,
// point ids and keys of its piece. So the built-in seams (src/sim/seams.ts, stable ids) still name the piece it came
// from with that copy's instance, regrading moves it by its keys like any piece, and the simulation (src/sim/setup.ts)
// meshes that copy from the split piece's own points: foldSplits turns a project with split pieces back into pieces
// cut twice plus the shape of each split copy.
//
// The piece it came from is cut once less (Piece.cut) and lists the copies split off (Piece.splitSides). Symmetry
// never mirrors across a split pair: each side is its own stored piece.

import type { Piece } from './presets';
import type { Attachment, EdgeRef, Edits, Pleat } from './edits';
import { instanceCount, instanceLabel } from '../sim/seams';
import type { StyleId } from './catalog';
import { uid } from '../lib/units';

/** the other copy of a pair */
const other = (side: number) => (side === 0 ? 1 : 0);

/** Can this copy be split off: a piece placed as a left and right pair, not split already. */
export function canSplit(style: StyleId, p: Piece | undefined, side: number): boolean {
  return !!p && !p.splitOf && instanceCount(style, p) === 2 && (side === 0 || side === 1) && !(p.splitSides ?? []).includes(side);
}

/** The piece standing in for copy `side` of piece `id`, if that copy is split off. */
export const splitPiece = (pieces: Piece[], id: string, side: number) => pieces.find((p) => p.splitOf === id && p.side === side);

type Moved = { pieces: Piece[]; edits: Edits };

/** something placed on copy `side` of piece `from` (or on every copy): which piece and copy it is on after a split */
function onSplit<T extends { pieceId: string; instance?: number }>(list: T[], from: string, to: string, side: number, idOf: (t: T) => T): T[] {
  const out: T[] = [];
  for (const t of list) {
    if (t.pieceId !== from) { out.push(t); continue; }
    if (t.instance === side) { const { instance: _i, ...rest } = t; void _i; out.push({ ...(rest as T), pieceId: to }); continue; }
    if (t.instance === undefined) {
      // on both sides: now one on each, the split side gets its own copy
      out.push({ ...t, instance: other(side) });
      const { instance: _i, ...rest } = t; void _i;
      out.push(idOf({ ...(rest as T), pieceId: to }));
      continue;
    }
    out.push(t);
  }
  return out;
}

const edgeTo = (e: EdgeRef, from: string, to: string, side: number): EdgeRef => {
  if (e.pieceId !== from || e.instance !== side) return e;
  const { instance: _i, ...rest } = e; void _i;
  return { ...rest, pieceId: to };
};
const edgeBack = (e: EdgeRef, s: Piece): EdgeRef => (e.pieceId === s.id ? { ...e, pieceId: s.splitOf!, instance: s.side } : e);

/** Split copy `side` of piece `id` into its own piece. Returns the new piece id (null when it cannot be split). */
export function splitSide(style: StyleId, pieces: Piece[], edits: Edits, id: string, side: number): Moved & { id: string | null } {
  const p = pieces.find((q) => q.id === id);
  if (!p || !canSplit(style, p, side)) return { pieces, edits, id: null };
  const nid = uid();
  const s: Piece = {
    ...p, id: nid, name: instanceLabel(style, p, side), cut: 1, splitOf: p.id, side,
    points: p.points.map((q) => ({ ...q })), specs: p.specs.map((q) => ({ ...q })), splitSides: undefined,
    ...(p.placement ? { placement: { ...p.placement } } : {}),
  };
  const at = pieces.indexOf(p);
  const next = pieces.map((q) => (q === p ? { ...p, cut: Math.max(1, p.cut - 1), splitSides: [...(p.splitSides ?? []), side] } : q));
  next.splice(at + 1, 0, s);
  const cloneId = <T extends { id: string }>(t: T): T => ({ ...t, id: uid() });
  const e: Edits = {
    ...edits,
    attachments: onSplit<Attachment>(edits.attachments, id, nid, side, cloneId),
    pleats: onSplit<Pleat>(edits.pleats, id, nid, side, cloneId),
    customSeams: edits.customSeams.map((c) => ({ ...c, a: edgeTo(c.a, id, nid, side), b: edgeTo(c.b, id, nid, side) })),
    ...(edits.edgeTrims ? { edgeTrims: edits.edgeTrims.map((t) => ({ ...t, edge: edgeTo(t.edge, id, nid, side) })) } : {}),
  };
  // user pieces patched on that copy go with it
  const moved = next.map((q) => (q.placement?.hostPieceId === id && q.placement.instance === side ? { ...q, placement: { ...q.placement, hostPieceId: nid, instance: undefined } } : q));
  return { pieces: moved, edits: e, id: nid };
}

/** "Match other side": drop the split piece; its copy takes the other side's shape again. Its edits go back on that copy. */
export function rejoinSide(pieces: Piece[], edits: Edits, splitId: string): Moved & { id: string | null } {
  const s = pieces.find((q) => q.id === splitId && q.splitOf);
  const p = s && pieces.find((q) => q.id === s.splitOf);
  if (!s || !p) return { pieces, edits, id: null };
  const side = s.side ?? 1;
  const next = pieces
    .filter((q) => q !== s)
    .map((q) => (q === p ? { ...p, cut: p.cut + 1, splitSides: (p.splitSides ?? []).filter((k) => k !== side) } : q))
    .map((q) => (q.placement?.hostPieceId === s.id ? { ...q, placement: { ...q.placement, hostPieceId: p.id, instance: side } } : q))
    .map((q) => (q.id === p.id && !q.splitSides?.length ? (({ splitSides: _x, ...r }) => (void _x, r as Piece))(q) : q));
  const back = <T extends { pieceId: string; instance?: number }>(t: T): T => (t.pieceId === s.id ? { ...t, pieceId: p.id, instance: side } : t);
  const e: Edits = {
    ...edits,
    attachments: edits.attachments.map(back),
    pleats: edits.pleats.map(back),
    customSeams: edits.customSeams.map((c) => ({ ...c, a: edgeBack(c.a, s), b: edgeBack(c.b, s) })),
    ...(edits.edgeTrims ? { edgeTrims: edits.edgeTrims.map((t) => ({ ...t, edge: edgeBack(t.edge, s) })) } : {}),
  };
  return { pieces: next, edits: e, id: p.id };
}

/**
 * A project with split sides as the simulation and seam report read it: the split pieces folded back into the piece
 * they came from (cut twice again), every edit on a split piece moved onto that copy, and the outline of each split
 * copy (own: piece id -> copy -> the split piece).
 */
export function foldSplits(pieces: Piece[], edits: Edits): { pieces: Piece[]; edits: Edits; own: Map<string, Map<number, Piece>> } {
  const own = new Map<string, Map<number, Piece>>();
  const splits = pieces.filter((p) => p.splitOf && pieces.some((q) => q.id === p.splitOf));
  if (!splits.length) return { pieces, edits, own };
  for (const s of splits) (own.get(s.splitOf!) ?? own.set(s.splitOf!, new Map()).get(s.splitOf!)!).set(s.side ?? 1, s);
  const byId = new Map(splits.map((s) => [s.id, s]));
  const back = <T extends { pieceId: string; instance?: number }>(t: T): T => { const s = byId.get(t.pieceId); return s ? { ...t, pieceId: s.splitOf!, instance: s.side } : t; };
  const edge = (e: EdgeRef): EdgeRef => { const s = byId.get(e.pieceId); return s ? { ...e, pieceId: s.splitOf!, instance: s.side } : e; };
  const folded = pieces
    .filter((p) => !byId.has(p.id))
    .map((p) => {
      const pl = p.placement, s = pl?.hostPieceId ? byId.get(pl.hostPieceId) : undefined;
      const q = s ? { ...p, placement: { ...pl!, hostPieceId: s.splitOf!, instance: s.side } } : p;
      const n = own.get(p.id)?.size ?? 0;
      return n ? { ...q, cut: q.cut + n } : q;
    });
  return {
    pieces: folded,
    edits: {
      ...edits,
      attachments: edits.attachments.map(back),
      pleats: edits.pleats.map(back),
      customSeams: edits.customSeams.map((c) => ({ ...c, a: edge(c.a), b: edge(c.b) })),
      ...(edits.edgeTrims ? { edgeTrims: edits.edgeTrims.map((t) => ({ ...t, edge: edge(t.edge) })) } : {}),
      ...(edits.finish ? { finish: { ...edits.finish, pieces: edits.finish.pieces.map(back) } } : {}),
    },
    own,
  };
}

/** Points of copy `instance` of a piece: the split piece's own when that copy is split off. */
export function copyPoints(own: Map<string, Map<number, Piece>>, p: Piece, instance: number) {
  return own.get(p.id)?.get(instance)?.points ?? p.points;
}
