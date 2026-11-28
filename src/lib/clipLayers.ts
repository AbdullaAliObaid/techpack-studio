// Clip artwork to the outline it is drawn on. A tag, patch, applique or pocket has a base outline; whatever a layer
// has outside it is cut off when the design is applied, so every view (3D, chart, tech pack, DXF) shows the same thing.
//
//   Vector shapes against a convex outline: really intersected (Sutherland-Hodgman per ring), stored as a 'path' layer
//     of just the part inside. Layers fully inside stay as they are.
//   Pictures, text, and anything against a concave outline (a heart, cut letters): kept, with `clip` = the outline
//     rings (attachment coords, even-odd) that every renderer applies as a clip path.
//   Layers fully outside are dropped.

import type { Attachment, ShapeLayer } from '../data/edits';
import { attachmentShapes, pathRings, shapePolygon } from './shapes';
import { labelSize } from '../data/labels';

export interface P2 { x: number; y: number }
export interface ClipRegion { outer: P2[]; holes: P2[][] }

const area = (r: P2[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const q = r[(i + 1) % r.length]; s += r[i].x * q.y - q.x * r[i].y; } return s / 2; };

export function isConvex(r: P2[]): boolean {
  let sign = 0;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], c = r[(i + 2) % r.length];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) continue;
    if (sign && Math.sign(z) !== sign) return false;
    sign = Math.sign(z);
  }
  return true;
}

/** Sutherland-Hodgman: `subject` cut to the convex `clip` ring (either winding). */
export function clipToConvex(subject: P2[], clip: P2[]): P2[] {
  const ccw = area(clip) > 0;
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p: P2) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * (ccw ? 1 : -1);
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length], sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp > 0 && sq < 0) || (sp < 0 && sq > 0)) { const t = sp / (sp - sq); out.push({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }); }
    }
  }
  return out;
}

const inRing = (r: P2[], p: P2) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c;
  return c;
};
const inRegion = (R: ClipRegion[], p: P2) => R.some((s) => inRing(s.outer, p) && !s.holes.some((h) => inRing(h, p)));
const segX = (a: P2, b: P2, c: P2, d: P2) => {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};
/** do the closed rings `A` touch any region R (inside it, or crossing its edge, or holding it)? */
function touches(A: P2[], R: ClipRegion[]): boolean {
  if (A.some((p) => inRegion(R, p))) return true;
  for (const s of R) {
    if (inRing(A, s.outer[0])) return true;
    for (const ring of [s.outer, ...s.holes]) for (let i = 0; i < ring.length; i++) for (let j = 0; j < A.length; j++) if (segX(ring[i], ring[(i + 1) % ring.length], A[j], A[(j + 1) % A.length])) return true;
  }
  return false;
}

/** the rings of a vector layer in attachment coords (cm), or null for text and pictures */
export function layerRings(l: ShapeLayer): P2[][] | null {
  if (l.shape === 'text' || l.shape === 'image') return null;
  const base = l.shape === 'path' ? (l.path ? pathRings(l.path).map((r) => r.map((q) => ({ x: q.x * l.w, y: q.y * l.h }))) : []) : shapePolygon(l.shape, l.w, l.h);
  const r = (l.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r), f = l.flipX ? -1 : 1;
  return base.map((ring) => ring.map((q) => ({ x: l.x + q.x * f * c - q.y * s, y: l.y + q.x * f * s + q.y * c })));
}
/** the 4 corners of a layer's box in attachment coords */
const boxOf = (l: ShapeLayer): P2[] => {
  const r = (l.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: l.x + (u * l.w * c) / 2 - (v * l.h * s) / 2, y: l.y + (u * l.w * s) / 2 + (v * l.h * c) / 2 }));
};

const r3 = (v: number) => Math.round(v * 1000) / 1000;

export interface ClipResult { layers: ShapeLayer[]; dropped: number; changed: boolean }

/** Cut every layer to the region. Layers keep their order and ids. */
export function clipLayers(layers: ShapeLayer[], region: ClipRegion[]): ClipResult {
  const convex = region.length === 1 && region[0].holes.length === 0 && isConvex(region[0].outer) ? region[0].outer : null;
  const clipRings = region.flatMap((s) => [s.outer, ...s.holes]).map((r) => r.map((q) => ({ x: r3(q.x), y: r3(q.y) })));
  const out: ShapeLayer[] = [];
  let dropped = 0, changed = false;
  for (const l0 of layers) {
    const { clip: _c, ...l } = l0;
    void _c;
    if (l0.clip) changed = true; // recomputed below
    const rings = layerRings(l);
    if (rings && convex) {
      const pts = rings.flat();
      if (pts.every((p) => inRing(convex, p))) { out.push(l0.clip ? l : l0); continue; }
      const cut = rings.map((r) => clipToConvex(r, convex)).filter((r) => r.length >= 3 && Math.abs(area(r)) > 1e-4);
      if (!cut.length) { dropped++; changed = true; continue; }
      const xs = cut.flat().map((p) => p.x), ys = cut.flat().map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const w = Math.max(0.01, x1 - x0), h = Math.max(0.01, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const path = cut.map((r) => 'M' + r.map((p) => `${Math.round(((p.x - cx) / w) * 10000) / 10000} ${Math.round(((p.y - cy) / h) * 10000) / 10000}`).join('L') + 'Z').join('');
      out.push({ ...l, shape: 'path', path, x: r3(cx), y: r3(cy), w: r3(w), h: r3(h), rotation: 0, flipX: undefined });
      changed = true;
      continue;
    }
    const parts: P2[][] = rings ? rings.filter((r) => r.length >= 3) : [boxOf(l)];
    if (!parts.some((r) => touches(r, region))) { dropped++; changed = true; continue; }
    const crosses = parts.some((r) => region.some((s) => [s.outer, ...s.holes].some((q) => r.some((_, i) => q.some((__, j) => segX(r[i], r[(i + 1) % r.length], q[j], q[(j + 1) % q.length]))))));
    if (!crosses && parts.every((r) => r.every((p) => inRegion(region, p)))) { out.push(l0.clip ? l : l0); continue; }
    out.push({ ...l, clip: clipRings });
    changed = true;
  }
  return { layers: out, dropped, changed };
}

/** the outline region of an attachment kind that has one (cloth, tag, pocket), else null: prints and stitching are free */
export function clipRegionOf(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text'> & Partial<Pick<Attachment, 'font' | 'outlineRings' | 'outlineKey' | 'label'>>): ClipRegion[] | null {
  if (a.kind !== 'patch' && a.kind !== 'applique' && a.kind !== 'label' && a.kind !== 'pocket') return null;
  const sized = a.kind === 'label' ? { ...a, ...labelSize(a as Attachment) } : a;
  return attachmentShapes(sized);
}

/** an attachment's layers cut to its outline */
export function clipAttachmentLayers(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text' | 'layers'> & Partial<Pick<Attachment, 'font' | 'outlineRings' | 'outlineKey' | 'label'>>): ClipResult {
  const region = clipRegionOf(a);
  return region ? clipLayers(a.layers, region) : { layers: a.layers, dropped: 0, changed: false };
}

/**
 * How far the artwork of an attachment reaches from its centre (cm, both sides, so a box of this size holds it all):
 * clipped layers stop at their outline.
 */
export function artworkExtent(a: Pick<Attachment, 'w' | 'h' | 'layers'>): number {
  let ext = Math.max(a.w, a.h, 0.5);
  for (const l of a.layers) {
    if (l.clip) { const xs = l.clip.flat().map((p) => Math.abs(p.x)), ys = l.clip.flat().map((p) => Math.abs(p.y)); ext = Math.max(ext, Math.max(...xs) * 2, Math.max(...ys) * 2); continue; }
    ext = Math.max(ext, Math.abs(l.x) * 2 + l.w, Math.abs(l.y) * 2 + l.h);
  }
  return ext;
}

/** bounding box of what a layer shows (cm, attachment coords): its clip when it has one */
export function shownBox(l: ShapeLayer): { x0: number; y0: number; x1: number; y1: number } {
  const b = boxOf(l), xs = b.map((p) => p.x), ys = b.map((p) => p.y);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  if (l.clip?.length) {
    const cx = l.clip.flat().map((p) => p.x), cy = l.clip.flat().map((p) => p.y);
    return { x0: Math.max(box.x0, Math.min(...cx)), y0: Math.max(box.y0, Math.min(...cy)), x1: Math.min(box.x1, Math.max(...cx)), y1: Math.min(box.y1, Math.max(...cy)) };
  }
  return box;
}

/** the layer area inside the outline (cm2, rings of vector layers, evenodd by ring sign ignored: sum of outer areas) */
export const layerArea = (l: ShapeLayer): number => (layerRings(l) ?? [boxOf(l)]).reduce((s, r) => s + Math.abs(area(r)), 0);
