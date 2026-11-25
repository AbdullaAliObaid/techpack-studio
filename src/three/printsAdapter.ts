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
}

export function vertexPattern(m: BuiltMsg, pieces: Piece[]): VertexPattern {
  if (m.vertexPiece && m.vertexPatternUv && m.pieceIds && m.vertexPiece.length === m.n && m.vertexPatternUv.length === m.n * 2) {
    return { vPiece: m.vertexPiece, vUV: m.vertexPatternUv, pieceIds: m.pieceIds };
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
