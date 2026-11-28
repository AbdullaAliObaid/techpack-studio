// Reshaping the outline of a pocket, patch, applique or shape attachment by its points on the chart.
//
// The first edit turns a preset outline (rect, rounded, pointed, circle, shield, or a single ring 'shape') into
// outline 'custom' with its points (Attachment.points, cm, the attachment's own coords centred on 0,0) and marks it
// outlineEdited. From then on the points are the cut shape: the simulation (src/sim/setup.ts) and the tech pack
// (attachmentOutline / attachmentOutlines in src/lib/specs.ts) use them as they are.
//
// Mirrored: an edited outline on the mirrored copy of a piece cut twice (the wearer's right) is cut as its mirror image,
// like the pocket on the other side of a pair of jeans. Artwork on it is never flipped. With symmetry on, a point and its
// mirror image about the attachment's own centre line move together, and a point on that line stays on it.

import type { Attachment } from './edits';
import { outlinePolygon, shapePolygon } from '../lib/shapes';
import type { Pt } from '../lib/geometry';

/** points a preset circle becomes on its first edit (enough to stay round, few enough to drag) */
const CIRCLE_POINTS = 16;
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Can its outline be reshaped by its points: pockets, patches and appliques, preset or shape outlines (not text). */
export function outlineEditable(a: Pick<Attachment, 'kind' | 'outline' | 'shape' | 'text'>): boolean {
  if (a.kind !== 'pocket' && a.kind !== 'patch' && a.kind !== 'applique') return false;
  // text is cut one piece per letter: its letters are not reshaped by points
  return !(a.shape === 'text' && (a.outline === 'shape' || a.kind === 'applique'));
}

/** The outline points as they are edited: the custom points, or the preset outline as points (cm, centred). */
export function editPoints(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text'>): Pt[] {
  if (a.outline === 'custom' && a.points?.length) return a.points;
  if (a.outline === 'shape' || (a.kind === 'applique' && a.shape)) {
    const rings = shapePolygon(a.shape ?? 'rect', a.w, a.h, a.text);
    if (rings.length) return rings.reduce((p, q) => (Math.abs(area(q)) > Math.abs(area(p)) ? q : p)).map((q) => ({ x: r2(q.x), y: r2(q.y) }));
  }
  return outlinePolygon(a.outline === 'shape' ? 'rect' : a.outline, a.w, a.h, undefined, CIRCLE_POINTS).map((q) => ({ x: r2(q.x), y: r2(q.y) }));
}

/** does the outline show mirrored on this copy (an edited outline on the mirrored copy of a pair) */
export const outlineMirrored = (a: Pick<Attachment, 'outlineEdited' | 'outline'>, mirroredCopy: boolean) => mirroredCopy && !!a.outlineEdited && a.outline === 'custom';

function area(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a.x * b.y - b.x * a.y; }
  return s / 2;
}

/** the index of point i's mirror image about x = 0 among pts, -1 if none; i itself when it is on the line */
export function mirrorIndex(pts: Pt[], i: number): number {
  const p = pts[i], tol = 1e-3 * Math.max(1, ...pts.map((q) => Math.abs(q.x)));
  if (Math.abs(p.x) < tol) return i;
  let best = -1, bd = tol * 10;
  pts.forEach((q, j) => { if (j === i) return; const d = Math.hypot(q.x + p.x, q.y - p.y); if (d < bd) { bd = d; best = j; } });
  return best;
}

/**
 * The patch that stores new points: outline 'custom', the points re-centred on 0,0 (the attachment's position moves by
 * the same amount, so nothing jumps), its size the points' box.
 */
export function withPoints(a: Pick<Attachment, 'x' | 'y' | 'rotation'>, pts: Pt[]): Partial<Attachment> {
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const c = Math.cos((a.rotation * Math.PI) / 180), s = Math.sin((a.rotation * Math.PI) / 180);
  return {
    outline: 'custom', outlineEdited: true,
    points: pts.map((q) => ({ x: r2(q.x - cx), y: r2(q.y - cy) })),
    w: r2(Math.max(...xs) - Math.min(...xs)), h: r2(Math.max(...ys) - Math.min(...ys)),
    x: r2(a.x + cx * c - cy * s), y: r2(a.y + cx * s + cy * c),
  };
}

/** Move outline point i to p (own coords); with symmetry its mirror image follows and a point on the centre line stays on it. */
export function moveOutlinePoint(a: Attachment, i: number, p: Pt, symmetric: boolean): Partial<Attachment> {
  const pts = editPoints(a).map((q) => ({ ...q }));
  if (!pts[i]) return {};
  const j = symmetric ? mirrorIndex(pts, i) : -1;
  pts[i] = { x: j === i ? 0 : p.x, y: p.y };
  if (j >= 0 && j !== i) pts[j] = { x: -p.x, y: p.y };
  return withPoints(a, pts);
}

/** Add a point on outline segment seg (from point seg to the next) at t; with symmetry its mirror image too. */
export function insertOutlinePoint(a: Attachment, seg: number, t: number, symmetric: boolean): { patch: Partial<Attachment>; index: number } {
  const pts = editPoints(a).map((q) => ({ ...q }));
  const n = pts.length;
  const A = pts[seg % n], B = pts[(seg + 1) % n];
  const at = { x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t };
  const out = [...pts.slice(0, seg + 1), at, ...pts.slice(seg + 1)];
  let index = seg + 1;
  if (symmetric) {
    // the mirrored segment runs from mirror(B) to mirror(A)
    const iB = mirrorIndex(pts, (seg + 1) % n), iA = mirrorIndex(pts, seg % n);
    if (iB >= 0 && iA >= 0 && (iB + 1) % n === iA && iB !== seg) {
      const k = iB < seg + 1 ? iB : iB + 1; // where mirror(B) sits in out
      out.splice(k + 1, 0, { x: -at.x, y: at.y });
      if (k + 1 <= index) index++;
    }
  }
  return { patch: withPoints(a, out), index };
}

/** Remove outline point i (keeps at least 3); with symmetry its mirror image too. */
export function removeOutlinePoint(a: Attachment, i: number, symmetric: boolean): Partial<Attachment> {
  const pts = editPoints(a);
  const j = symmetric ? mirrorIndex(pts, i) : -1;
  const out = pts.filter((_, k) => k !== i && !(j >= 0 && j !== i && k === j));
  if (out.length < 3) return {};
  return withPoints(a, out);
}

/** nearest point on the polygon outline to q: segment, parameter and distance (own coords) */
export function nearestOnPolygon(pts: Pt[], q: Pt): { seg: number; t: number; d: number } {
  let best = { seg: 0, t: 0, d: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1e-9;
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2));
    const d = Math.hypot(a.x + dx * t - q.x, a.y + dy * t - q.y);
    if (d < best.d) best = { seg: i, t, d };
  }
  return best;
}

