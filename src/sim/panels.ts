// Pattern piece -> flat cloth mesh. Rest lengths come straight from the 2D pattern, so the simulated
// garment is exactly as big as the drawing.

import Delaunator from 'delaunator';
import { bezAt, bezLength, pointInPoly, toBeziers, type PPoint, type Pt } from '../lib/geometry';

export interface PanelMesh {
  uv: Pt[]; // 2D rest positions (cm, pattern space)
  tris: number[]; // vertex index triples
  boundary: number[]; // boundary vertex indices in outline order
  segStart: number[]; // boundary index where each outline segment starts (= that outline point)
  pointIds: string[]; // outline point ids, segStart[i] belongs to pointIds[i]
  /** vertex indices round each hole cut out of the panel (counters of cut letters), in the order given */
  holeLoops?: number[][];
}

function distToPolyline(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
}

export function meshPanel(points: PPoint[], h: number, holes: Pt[][] = []): PanelMesh {
  const uv: Pt[] = [];
  const boundary: number[] = [];
  const segStart: number[] = [];
  toBeziers(points).forEach((b) => {
    segStart.push(boundary.length);
    const n = Math.max(1, Math.ceil(bezLength(b) / h));
    for (let i = 0; i < n; i++) {
      boundary.push(uv.length);
      uv.push(bezAt(b, i / n));
    }
  });
  const outline = boundary.map((i) => uv[i]);
  // holes: vertices round each, no interior points or triangles inside
  const holeLoops: number[][] = holes.filter((r) => r.length >= 3).map((r) => {
    const loop: number[] = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / h));
      for (let k = 0; k < n; k++) { loop.push(uv.length); uv.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }); }
    }
    return loop;
  });
  const holePolys = holeLoops.map((l) => l.map((i) => uv[i]));

  // interior: triangular lattice
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const dy = h * 0.866;
  for (let row = 0, y = minY + dy / 2; y < maxY; y += dy, row++) {
    for (let x = minX + (row % 2 ? h / 2 : 0); x < maxX; x += h) {
      const p = { x, y };
      if (pointInPoly(outline, p) && distToPolyline(p, outline) > 0.55 * h && !holePolys.some((hp) => pointInPoly(hp, p) || distToPolyline(p, hp) <= 0.55 * h)) uv.push(p);
    }
  }

  const d = Delaunator.from(uv.map((p) => [p.x, p.y]));
  const tris: number[] = [];
  const maxE = 2.2 * h;
  for (let i = 0; i < d.triangles.length; i += 3) {
    const a = d.triangles[i], b = d.triangles[i + 1], c = d.triangles[i + 2];
    const A = uv[a], B = uv[b], C = uv[c];
    const cen = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
    if (!pointInPoly(outline, cen) || holePolys.some((hp) => pointInPoly(hp, cen))) continue;
    const e = Math.max(Math.hypot(A.x - B.x, A.y - B.y), Math.hypot(B.x - C.x, B.y - C.y), Math.hypot(C.x - A.x, C.y - A.y));
    if (e > maxE) continue;
    tris.push(a, b, c);
  }
  return { uv, tris, boundary, segStart, pointIds: points.map((p) => p.id), ...(holeLoops.length ? { holeLoops } : {}) };
}

/** Boundary vertex path between two outline points, taking the shorter way round. */
export function seamPath(m: PanelMesh, fromId: string, toId: string): number[] {
  const ia = m.pointIds.indexOf(fromId), ib = m.pointIds.indexOf(toId);
  if (ia < 0 || ib < 0) return [];
  const N = m.boundary.length;
  const a = m.segStart[ia], b = m.segStart[ib];
  const fwd: number[] = [];
  for (let i = a; ; i = (i + 1) % N) {
    fwd.push(m.boundary[i]);
    if (i === b) break;
  }
  const back: number[] = [];
  for (let i = a; ; i = (i - 1 + N) % N) {
    back.push(m.boundary[i]);
    if (i === b) break;
  }
  return fwd.length <= back.length ? fwd : back;
}

/** Arc-length parameter (0..1) of each vertex along a path. */
export function pathParams(uv: Pt[], path: number[]): number[] {
  const acc = [0];
  for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(uv[path[i]].x - uv[path[i - 1]].x, uv[path[i]].y - uv[path[i - 1]].y));
  const L = acc[acc.length - 1] || 1;
  return acc.map((v) => v / L);
}
