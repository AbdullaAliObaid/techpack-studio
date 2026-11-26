// Per cloth vertex: which pattern piece it belongs to and where it sits on that piece's flat pattern (cm).
// The sewing agent adds `vPiece`, `vUV` and `pieceIds` to the worker 'built' message. Until that lands (or if it is
// absent) we recover the same data from what the message already has: per panel groups and the scaled panel uv,
// matched to the pieces by outline bounding box. This is the only place that knows about either shape.

import type { Piece } from '../data/presets';

export interface VertexPattern {
  /** index into pieceIds per vertex, NONE when the vertex is on no known piece */
  vPiece: Uint16Array;
  /** x, y per vertex, piece local pattern coords (cm) */
  vUV: Float32Array;
  pieceIds: string[];
  /** per placed panel (same order as the cloth geometry groups); absent when the worker did not send them */
  panels?: PanelInfo[];
  /** per vertex: index into panels */
  vPanel?: Uint16Array;
  /** per pieceIds entry: how many placed copies of that piece there are (cloth attachment panels count as one) */
  copies?: number[];
}

export interface PanelInfo {
  start: number;
  count: number;
  pieceIndex: number;
  /** placed copy of a piece cut more than once (0 right, 1 left); for an attachment panel, its host's copy */
  instance: number;
  /** pattern x runs the other way round on this panel's outside: artwork must be flipped to read correctly */
  flip: boolean;
  /** +1 when the front faces of the cloth geometry are the outside, -1 when the back faces are (from the worker) */
  front: number;
  /** attachment id for a cloth attachment panel */
  attachId?: string;
}

export const NONE = 0xffff;

interface BuiltMsg {
  n: number;
  uv: Float32Array;
  index: Uint32Array;
  groups: { start: number; count: number; panel: number }[];
  vPiece?: Uint16Array;
  vUV?: Float32Array;
  /** names used by the worker (src/sim/worker.ts) */
  vertexPiece?: Uint16Array;
  vertexPatternUv?: Float32Array;
  pieceIds?: string[];
  panels?: { start: number; count: number; pieceIndex: number; instance: number; mirror: boolean }[];
  attachmentPanels?: { attachmentId: string; start: number; count: number; hostPieceId: string; hostInstance: number }[];
  /** +1 / -1 per panel: outward side relative to the mesh triangle order (not the mirrored render order) */
  panelSign?: number[];
}

export function vertexPattern(m: BuiltMsg, pieces: Piece[]): VertexPattern {
  if (m.vertexPiece && m.vertexPatternUv && m.pieceIds && m.vertexPiece.length === m.n && m.vertexPatternUv.length === m.n * 2) {
    return withPanels({ vPiece: m.vertexPiece, vUV: m.vertexPatternUv, pieceIds: m.pieceIds }, m);
  }
  if (m.vPiece && m.vUV && m.pieceIds && m.vPiece.length === m.n && m.vUV.length === m.n * 2) {
    return { vPiece: m.vPiece, vUV: m.vUV, pieceIds: m.pieceIds };
  }
  return fallback(m, pieces);
}

function fallback(m: BuiltMsg, pieces: Piece[]): VertexPattern {
  const vPiece = new Uint16Array(m.n).fill(NONE);
  const vUV = new Float32Array(m.n * 2);
  const pieceIds = pieces.map((p) => p.id);
  const boxes = pieces.map((p) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of p.points) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    return { x0, x1, y0, y1 };
  });
  // one entry per panel; the worker writes uv = (+-x / 6, -y / 6) with the sign flipped for mirrored panels
  const byPanel = new Map<number, Set<number>>();
  for (const g of m.groups) {
    const s = byPanel.get(g.panel) ?? new Set<number>();
    for (let i = g.start; i < g.start + g.count; i++) s.add(m.index[i]);
    byPanel.set(g.panel, s);
  }
  for (const verts of byPanel.values()) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const v of verts) { const x = m.uv[v * 2] * 6, y = -m.uv[v * 2 + 1] * 6; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    let best = -1, bestSign = 1, bestErr = Infinity;
    boxes.forEach((b, i) => {
      for (const sg of [1, -1]) {
        const a0 = sg > 0 ? x0 : -x1, a1 = sg > 0 ? x1 : -x0;
        const err = Math.abs(a0 - b.x0) + Math.abs(a1 - b.x1) + Math.abs(y0 - b.y0) + Math.abs(y1 - b.y1);
        if (err < bestErr) { bestErr = err; best = i; bestSign = sg; }
      }
    });
    if (best < 0) continue;
    for (const v of verts) {
      vPiece[v] = best;
      vUV[v * 2] = m.uv[v * 2] * 6 * bestSign;
      vUV[v * 2 + 1] = -m.uv[v * 2 + 1] * 6;
    }
  }
  return { vPiece, vUV, pieceIds };
}

function withPanels(v: VertexPattern, m: BuiltMsg): VertexPattern {
  if (!m.panels) return v;
  const att = new Map((m.attachmentPanels ?? []).map((a) => [a.start, a]));
  const hostMirror = (pieceId: string, instance: number) => {
    const k = v.pieceIds.indexOf(pieceId);
    return !!m.panels!.find((q) => q.pieceIndex === k && q.instance === instance && !att.has(q.start))?.mirror;
  };
  const vPanel = new Uint16Array(m.n);
  const copies = v.pieceIds.map(() => 0);
  const panels: PanelInfo[] = m.panels.map((q, k) => {
    const a = att.get(q.start);
    for (let i = q.start; i < q.start + q.count; i++) vPanel[i] = k;
    if (!a) copies[q.pieceIndex]++;
    else copies[q.pieceIndex] = 1;
    const mirror = a ? hostMirror(a.hostPieceId, a.hostInstance) : q.mirror;
    const sign = m.panelSign?.[k] ?? 0;
    return {
      start: q.start, count: q.count, pieceIndex: q.pieceIndex,
      instance: a ? a.hostInstance : q.instance, flip: mirror,
      // the render index order is swapped on mirrored cloth panels (attachment panels are never swapped)
      front: sign === 0 ? 0 : sign * (q.mirror ? -1 : 1),
      attachId: a?.attachmentId,
    };
  });
  return { ...v, panels, vPanel, copies };
}
