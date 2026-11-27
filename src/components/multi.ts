// Multi select helpers shared by the chart and the inspector: where selected points are in chart space, which
// points a marquee covers, and the targets a drag snaps to. Chart space ("world") is what is drawn: each copy of a
// piece sits at its entry offset, the left copy mirrored. Stored space is the piece's own points (src/data).
import type { GroupMove, MultiItem } from '../store';
import type { Piece } from '../data/presets';
import type { StyleId } from '../data/catalog';
import type { Pt } from '../lib/geometry';
import { flipEntries, layoutEntries, toSource, toWorldPt, type Entry } from './sides';
import { linkedPoints } from './shims';
import type { Geo } from './chartLayout';
import type { Target } from './snap';

export const itemId = (i: { pieceId: string; pointId: string }) => `${i.pieceId}|${i.pointId}`;

/** the entries the chart draws for these settings (same call the chart makes) */
export function chartEntries(garment: StyleId, pieces: Piece[], both: boolean, face: 'outside' | 'inside'): Entry[] {
  const e = layoutEntries(garment, pieces, both);
  return face === 'inside' ? flipEntries(e) : e;
}

export interface Placed { item: MultiItem; entry: Entry; world: Pt; stored: Pt }

/** selected points with their chart position; items whose piece or point no longer exists are dropped */
export function placeItems(items: { pieceId: string; pointId: string; key?: string }[], entries: Entry[]): Placed[] {
  const out: Placed[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const id = itemId(it);
    if (seen.has(id)) continue;
    const en = entries.find((e) => e.key === it.key) ?? entries.find((e) => e.src.id === it.pieceId);
    const q = en?.src.points.find((p) => p.id === it.pointId);
    if (!en || !q) continue;
    seen.add(id);
    out.push({ item: { pieceId: it.pieceId, pointId: it.pointId, key: en.key }, entry: en, world: toWorldPt(en, q), stored: { x: q.x, y: q.y } });
  }
  return out;
}

/** points whose chart position is inside the rectangle. A stored point drawn on two copies counts once, first copy wins. */
export function pointsInRect(entries: Entry[], r: { x0: number; y0: number; x1: number; y1: number }): MultiItem[] {
  const out: MultiItem[] = [];
  const seen = new Set<string>();
  for (const en of entries) {
    if (en.src.role === 'custom' && en.src.placement?.mode === 'patch') continue; // patches are placed, not edited here
    for (const q of en.piece.points) {
      const x = en.offset.x + q.x, y = en.offset.y + q.y;
      if (x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1) continue;
      const id = en.src.id + '|' + q.id;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ pieceId: en.src.id, pointId: q.id, key: en.key });
    }
  }
  return out;
}

/** every point of one piece, picked on the copy `inst` */
export function allPointsOf(piece: Piece, inst: number): MultiItem[] {
  return piece.points.map((q) => ({ pieceId: piece.id, pointId: q.id, key: `${piece.id}:${inst}` }));
}

/**
 * Add the points that move with the selection under Total symmetry (the same point on every mating piece), each by
 * the same stored shift as the point it follows. Points that were moved explicitly are left alone.
 */
export function withLinked(pieces: Piece[], moves: GroupMove[], total: boolean): GroupMove[] {
  if (!total) return moves;
  const have = new Set(moves.map(itemId));
  const out = [...moves];
  for (const m of moves) {
    const p = pieces.find((x) => x.id === m.pieceId);
    const q = p?.points.find((x) => x.id === m.pointId);
    if (!p || !q) continue;
    const dx = m.x - q.x, dy = m.y - q.y;
    for (const l of linkedPoints(pieces, m.pieceId, m.pointId)) {
      const id = itemId(l);
      if (have.has(id)) continue;
      const lp = pieces.find((x) => x.id === l.pieceId)?.points.find((x) => x.id === l.pointId);
      if (!lp) continue;
      have.add(id);
      // the twin on the other side of the centre line moves the opposite way across
      const flip = Math.abs(q.x) > 1e-6 && Math.abs(lp.x) > 1e-6 && Math.sign(q.x) !== Math.sign(lp.x);
      out.push({ pieceId: l.pieceId, pointId: l.pointId, x: lp.x + (flip ? -dx : dx), y: lp.y + dy });
    }
  }
  return out;
}

/** stored positions that put each placed point at a new chart position */
export function movesFromWorld(placed: Placed[], world: Pt[]): GroupMove[] {
  return placed.map((p, i) => {
    const s = toSource(p.entry, world[i]);
    return { pieceId: p.item.pieceId, pointId: p.item.pointId, x: s.x, y: s.y };
  });
}

/**
 * What a drag can snap to: every point that is not moving (on any piece or copy), the grainline of each piece and the
 * centre line of symmetric ones. `moving` holds `piece|point` ids that move with the drag.
 */
export function snapTargets(entries: Entry[], geos: Map<string, Geo>, moving: Set<string>): Target[] {
  const out: Target[] = [];
  for (const en of entries) {
    const g = geos.get(en.key);
    const name = en.src.name;
    if (g) out.push({ x: en.offset.x + g.c.x, label: `Grainline of ${name}` });
    if (en.src.symmetric) out.push({ x: en.offset.x, label: `Centre line of ${name}` });
    for (const q of en.piece.points) {
      if (moving.has(en.src.id + '|' + q.id)) continue;
      out.push({ x: en.offset.x + q.x, y: en.offset.y + q.y, label: q.tag ? `Aligned to ${pretty(q.tag)}` : `Aligned to ${name}` });
    }
  }
  return out;
}

const pretty = (t: string) => { const s = t.replace(/[._-]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
