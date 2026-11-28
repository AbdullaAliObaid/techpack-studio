// Edge trims (contrast thread, binding, piping): builders for the edge tool, the outline of an edge as a polyline for the
// chart and the 3D view, and the tech pack rows (thread colour and length, tape length and width, cord).

import type { Pt } from '../lib/geometry';
import { bezLength, bezAt, toBeziers, signedArea, samplePoly, norm } from '../lib/geometry';
import type { EdgeMethod, EdgeRef, EdgeTrim, Edits } from './edits';
import type { Piece } from './presets';
import type { StyleId } from './catalog';
import { instanceCount } from '../sim/seams';
import { uid } from '../lib/units';

export type EdgePreset = 'hem' | 'cuff';
export const EDGE_METHODS: { id: EdgeMethod; label: string }[] = [{ id: 'paint', label: 'Paint' }, { id: 'thread', label: 'Thread' }, { id: 'binding', label: 'Binding' }, { id: 'piping', label: 'Piping' }];
export const METHOD_NAME: Record<EdgeTrim['method'], string> = { thread: 'Contrast thread', binding: 'Binding', piping: 'Piping' };
export const TEX_OPTIONS = [{ id: '30', label: 'Fine' }, { id: '45', label: 'Regular' }, { id: '70', label: 'Heavy' }];
export const DEFAULT_WIDTH: Record<EdgeTrim['method'], number> = { thread: 0.3, binding: 0.8, piping: 0.3 };

export interface EdgeSettings { method: EdgeMethod; colour: string; width: number; tex: number; bothFaces: boolean }
export const DEFAULT_EDGE: EdgeSettings = { method: 'paint', colour: '#111111', width: 0.8, tex: 45, bothFaces: true };

/** the run of outline points from fromId to toId the short way round, as indices */
function runIndices(p: Piece, fromId: string, toId: string): number[] {
  const n = p.points.length, ia = p.points.findIndex((q) => q.id === fromId), ib = p.points.findIndex((q) => q.id === toId);
  if (ia < 0 || ib < 0 || ia === ib) return [];
  const fwd = (ib - ia + n) % n, back = (ia - ib + n) % n;
  const out: number[] = [];
  if (fwd <= back) for (let i = ia; i !== ib; i = (i + 1) % n) out.push(i);
  else for (let i = ib; i !== ia; i = (i + 1) % n) out.push(i);
  return out; // bezier indices (segment i runs from point i to i+1)
}

/** the edge as a polyline (cm, piece frame) in the order of its run, or [] when it no longer exists */
export function edgePolyline(p: Piece, e: Pick<EdgeRef, 'fromId' | 'toId'>, perSeg = 16): Pt[] {
  const idx = runIndices(p, e.fromId, e.toId);
  if (!idx.length) return [];
  const bz = toBeziers(p.points);
  // walk the run in outline order (ascending bezier index around the ring)
  const out: Pt[] = [];
  idx.forEach((i, k) => { for (let s = k ? 1 : 0; s <= perSeg; s++) out.push(bezAt(bz[i], s / perSeg)); });
  return out;
}

export const edgeLength = (p: Piece, e: Pick<EdgeRef, 'fromId' | 'toId'>) => runIndices(p, e.fromId, e.toId).reduce((s, i) => s + bezLength(toBeziers(p.points)[i], 48), 0);

/** +1 or -1: which side of a run's direction points into the piece */
export function inwardSign(p: Piece): number { return signedArea(samplePoly(p.points, 6)) > 0 ? 1 : -1; }

/** polyline moved d cm into the piece */
export function insetPolyline(p: Piece, line: Pt[], d: number): Pt[] {
  const sg = inwardSign(p);
  return line.map((q, i) => {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const t = norm({ x: b.x - a.x, y: b.y - a.y });
    return { x: q.x - t.y * sg * d, y: q.y + t.x * sg * d };
  });
}

/**
 * Runs of the outline between points that carry a tag (the hem is the stretch between its two corner points, with the
 * untagged centre point between them). Only short gaps count: the long way round the piece is not the hem.
 */
function taggedRuns(p: Piece, tag: string): { fromId: string; toId: string }[] {
  const n = p.points.length, at = p.points.flatMap((q, i) => (q.tag === tag ? [i] : []));
  if (at.length < 2) return [];
  const runs: { from: number; to: number }[] = [];
  at.forEach((a, k) => {
    const b = at[(k + 1) % at.length], steps = (b - a + n) % n;
    if (steps > 0 && steps <= Math.max(2, Math.floor(n / 4))) {
      const last = runs[runs.length - 1];
      if (last && last.to === a) last.to = b; else runs.push({ from: a, to: b });
    }
  });
  return runs.map((r) => ({ fromId: p.points[r.from].id, toId: p.points[r.to].id }));
}

const roleOf = (pieces: Piece[], ...roles: string[]) => pieces.find((p) => roles.includes(p.role));
const mateOf = (pieces: Piece[], p: Piece) => (p.role === 'front' ? roleOf(pieces, 'back') : p.role === 'back' ? roleOf(pieces, 'front') : undefined);

/** Edge trims for a quick edge (the hem, or the cuff end of sleeves). Total symmetry also trims the matching piece. */
export function presetEdgeTrims(pieces: Piece[], preset: EdgePreset, s: Pick<EdgeSettings, 'colour' | 'width' | 'tex' | 'bothFaces'> & { method: EdgeTrim['method'] }, total: boolean, selPieceId?: string | null): Omit<EdgeTrim, 'id'>[] {
  const sel = pieces.find((q) => q.id === selPieceId && (q.role === 'front' || q.role === 'back'));
  const hosts = preset === 'cuff'
    ? pieces.filter((q) => q.role === 'sleeve' || q.role === 'cuff')
    : [sel ?? roleOf(pieces, 'front')].filter((q): q is Piece => !!q).flatMap((q) => [q, ...(total ? [mateOf(pieces, q)].filter((m): m is Piece => !!m) : [])]);
  return hosts.flatMap((p) => taggedRuns(p, preset === 'cuff' ? 'cuff' : 'hem').map((r) => mk(p, r, s)));
}

/** an edge trim along the outline segment nearest a click (segment index from nearestOnOutline) */
export function segmentEdgeTrim(p: Piece, seg: number, s: Pick<EdgeSettings, 'colour' | 'width' | 'tex' | 'bothFaces'> & { method: EdgeTrim['method'] }): Omit<EdgeTrim, 'id'> {
  const n = p.points.length;
  return mk(p, { fromId: p.points[seg % n].id, toId: p.points[(seg + 1) % n].id }, s);
}

function mk(p: Piece, r: { fromId: string; toId: string }, s: Pick<EdgeSettings, 'colour' | 'width' | 'tex' | 'bothFaces'> & { method: EdgeTrim['method'] }): Omit<EdgeTrim, 'id'> {
  return {
    method: s.method, edge: { pieceId: p.id, fromId: r.fromId, toId: r.toId }, colour: s.colour,
    width: s.method === 'thread' ? DEFAULT_WIDTH.thread : s.width,
    ...(s.method === 'thread' ? { tex: s.tex } : {}),
    ...(s.method === 'piping' ? { face: 'outside' as const } : s.bothFaces ? {} : { face: 'outside' as const }),
    name: `${METHOD_NAME[s.method]} on ${p.name.toLowerCase()}`,
  };
}

export const withIds = (list: Omit<EdgeTrim, 'id'>[]): EdgeTrim[] => list.map((t) => ({ ...t, id: uid() }));

/** does an edge trim show on this face */
export function showsOn(t: EdgeTrim, face: 'outside' | 'inside'): boolean {
  const f = t.face ?? (t.method === 'piping' ? 'outside' : 'both');
  return f === 'both' || f === face;
}

/* ---------- tech pack ---------- */

export interface EdgeRow { kind: 'edge'; item: string; detail: string; placement: string; qty: number }
const r1 = (v: number) => Math.round(v * 10) / 10;
const hexName = (c: string) => c.toUpperCase();

/**
 * One row per method and colour: thread (colour, weight, length incl. take-up), binding tape (finished width, cut width,
 * length) and piping (cord diameter, length, bias cover). Lengths cover every copy of a piece cut twice.
 */
export function edgeTrimRows(style: StyleId | undefined, pieces: Piece[], edits?: Edits): EdgeRow[] {
  const rows = new Map<string, { t: EdgeTrim; len: number; where: Set<string>; runs: number }>();
  for (const t of edits?.edgeTrims ?? []) {
    const p = pieces.find((q) => q.id === t.edge.pieceId);
    if (!p) continue;
    const copies = t.edge.instance !== undefined ? 1 : style ? instanceCount(style, p) : p.cut;
    const key = [t.method, t.colour, t.method === 'thread' ? t.tex ?? 45 : t.width, t.face ?? ''].join('|');
    const row = rows.get(key) ?? { t, len: 0, where: new Set<string>(), runs: 0 };
    row.len += edgeLength(p, t.edge) * copies;
    row.runs += copies;
    row.where.add(p.name.toLowerCase());
    rows.set(key, row);
  }
  return [...rows.values()].map(({ t, len, where, runs }) => {
    const placement = [...where].join(', ');
    if (t.method === 'thread') {
      const m = (len * 3.5) / 100; // topstitch takes about 3.5 times the stitched length
      return { kind: 'edge' as const, item: 'Contrast thread', detail: `${hexName(t.colour)}, Tex ${t.tex ?? 45}, topstitch along the edge, ${r1(len)} cm stitched, about ${r1(m)} m of thread`, placement, qty: Math.max(1, Math.ceil(m / 100)) };
    }
    if (t.method === 'binding') {
      const L = len + 4 * runs;
      return { kind: 'edge' as const, item: 'Binding tape', detail: `${hexName(t.colour)}, ${r1(t.width * 10)} mm finished (cut ${r1(t.width * 40)} mm, double fold), folded over the edge, ${r1(L)} cm incl. 4 cm joins`, placement, qty: 1 };
    }
    const L = len + 2 * runs;
    return { kind: 'edge' as const, item: 'Piping', detail: `${hexName(t.colour)} cover, cord ${r1(t.width * 10)} mm, sewn into the seam, ${r1(L)} cm incl. 2 cm ends; bias cover cut ${r1(t.width * 10 * 3 + 2.5 * 10)} mm`, placement, qty: 1 };
  });
}
