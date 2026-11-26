// Chart layout: per piece geometry, plus where the text goes. Text is kept to a minimum (piece names, and
// measurements only for the selected piece or, with Measure on, the key ones). Every label is placed in screen
// space with simple collision avoidance against designs and other labels; a label that does not fit is dropped.
import type { Attachment } from '../data/edits';
import { bbox, bezLength, bezAt, bezTangent, centroid, offsetInward, pathD, pointInPoly, polyD, samplePoly, toBeziers, type Pt } from '../lib/geometry';
import { pieceSpecs } from '../lib/specs';
import { fmt, type Units } from '../lib/units';
import type { Pleat } from '../data/edits';
import { attWorld, frameOn, onCopy, type Entry } from './sides';

export const SEAM_ALLOWANCE_CM = 1;

export interface Geo {
  bz: ReturnType<typeof toBeziers>;
  d: string;
  poly: Pt[];
  bb: ReturnType<typeof bbox>;
  c: Pt;
  cut: string;
  specs: ReturnType<typeof pieceSpecs>;
}

export function computeGeo(en: Entry, pleats: Pleat[]): Geo {
  const p = en.piece;
  const bz = toBeziers(p.points);
  const poly = samplePoly(p.points);
  return {
    bz, d: pathD(bz), poly, bb: bbox(poly), c: centroid(poly), cut: polyD(offsetInward(poly, -SEAM_ALLOWANCE_CM)),
    specs: pieceSpecs(p, pleats.length ? { attachments: [], customSeams: [], detachedSeams: [], pleats } : undefined),
  };
}

/** Attachments drawn on a copy: the ones on the piece, then the designs sewn onto them. */
export function attsOnEntry(all: Attachment[], en: Entry): Attachment[] {
  const out: Attachment[] = [];
  const walk = (parentId: string, depth: number, top: boolean) => {
    for (const a of all) {
      if (a.pieceId !== parentId) continue;
      if (top && !onCopy(a.instance, en)) continue;
      out.push(a);
      if (depth < 4) walk(a.id, depth + 1, false);
    }
  };
  walk(en.src.id, 0, true);
  return out;
}

export interface Rect { x0: number; y0: number; x1: number; y1: number }
const hit = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const rectAt = (cx: number, cy: number, w: number, h: number): Rect => ({ x0: cx - w / 2, y0: cy - h / 2, x1: cx + w / 2, y1: cy + h / 2 });

export interface NameLabel { lines: string[]; x: number; y: number; show: boolean }
export interface MeasureLabel { key: string; a: Pt; b: Pt; vertical: boolean; text: string; lx: number; ly: number; sel: boolean }
export interface EdgeLabel { key: string; text: string; x: number; y: number }
export interface Layout {
  names: Map<string, NameLabel>;
  measures: Map<string, MeasureLabel[]>;
  edges: Map<string, EdgeLabel[]>;
}

const TEXT_W = (s: string, size = 11) => s.length * size * 0.58 + 2;

export function layoutChart(opts: {
  entries: Entry[]; geos: Map<string, Geo>; atts: Attachment[]; k: number; selKey: string | null; showMeasure: boolean; units: Units;
  hoverKey: string | null; bounds?: Rect | null; ghostRects?: { entry: Entry; cx: number; cy: number }[];
}): Layout {
  const { entries, geos, atts, k, selKey, showMeasure, units, hoverKey } = opts;
  const px = (n: number) => n / k;
  const names = new Map<string, NameLabel>();
  const measures = new Map<string, MeasureLabel[]>();
  const edges = new Map<string, EdgeLabel[]>();

  // everything a label must stay clear of, in world units: designs (never covered), then labels as they are placed
  const keep: Rect[] = [];
  for (const en of entries) {
    for (const a of attsOnEntry(atts, en)) {
      const pose = attWorld(atts, a, en);
      const r = Math.max(Math.hypot(a.w, a.h) / 2, px(11)) + px(3);
      keep.push(rectAt(pose.x, pose.y, r * 2, r * 2));
    }
  }
  for (const g of opts.ghostRects ?? []) keep.push(rectAt(g.entry.offset.x + g.cx, g.entry.offset.y + g.cy, px(40), px(30)));
  const bd = opts.bounds;
  const free = (r: Rect) => !keep.some((q) => hit(q, r)) && (!bd || (r.x0 > bd.x0 && r.x1 < bd.x1 && r.y0 > bd.y0 && r.y1 < bd.y1));

  // ---- piece names: one short line, in the middle of the piece, moved aside when a design sits there
  for (const en of entries) {
    const g = geos.get(en.key);
    if (!g) continue;
    const forced = en.key === selKey || en.key === hoverKey;
    const secondary = en.key === selKey && k >= 4;
    const wPx = g.bb.w * k, hPx = g.bb.h * k;
    let lines = [en.label];
    if (TEXT_W(en.label) > wPx * 0.94 && en.label.includes(', ')) lines = en.label.split(', ', 2);
    const tw = Math.max(...lines.map((l) => TEXT_W(l)));
    const th = lines.length * 13 + (secondary ? 13 : 0);
    const fits = tw <= wPx * 0.96 && th <= hPx * 0.9;
    let placed: NameLabel | null = null;
    if (fits || forced) {
      const offs = [0, -1, 1, -2, 2, -3, 3];
      outer: for (const oy of offs) {
        for (const ox of [0, -0.3, 0.3]) {
          const cx = g.c.x + px(ox * tw), cy = g.c.y + px(oy * (th + 4));
          const rl = rectAt(en.offset.x + cx, en.offset.y + cy, px(tw + 4), px(th + 2));
          const inside = pointInPoly(g.poly, { x: cx - px(tw / 2), y: cy }) && pointInPoly(g.poly, { x: cx + px(tw / 2), y: cy });
          if ((inside || forced) && free(rl)) { placed = { lines, x: cx, y: cy, show: true }; keep.push(rl); break outer; }
        }
      }
    }
    names.set(en.key, placed ?? { lines, x: g.c.x, y: g.c.y, show: false });
  }

  // ---- measurements: outside the outline, leader line to the measured span, never on top of anything
  const specsFor = (en: Entry) => {
    const g = geos.get(en.key)!;
    if (en.key === selKey) return g.specs.map((m) => ({ m, sel: true }));
    if (showMeasure && !en.mirror) return g.specs.slice(0, 2).map((m) => ({ m, sel: false }));
    return [];
  };
  const order = [...entries].sort((a, b) => (a.key === selKey ? -1 : 0) - (b.key === selKey ? -1 : 0));
  for (const en of order) {
    const g = geos.get(en.key);
    if (!g) continue;
    const list: MeasureLabel[] = [];
    if (g.bb.w * k >= 28 && g.bb.h * k >= 14) {
      for (const { m, sel } of specsFor(en)) {
        const text = `${m.label} ${fmt(m.value, units)}`;
        const tw = TEXT_W(text) + 4, th = 14;
        const mid = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 };
        const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y, L = Math.hypot(dx, dy) || 1;
        // outward: along the normal of the span, away from the middle of the piece, at least once out of the outline
        let nx = -dy / L, ny = dx / L;
        if ((mid.x + nx - g.c.x) ** 2 + (mid.y + ny - g.c.y) ** 2 < (mid.x - g.c.x) ** 2 + (mid.y - g.c.y) ** 2) { nx = -nx; ny = -ny; }
        if (Math.abs(nx) < 0.2 && Math.abs(ny) < 0.2) { nx = 0; ny = 1; }
        let done = false;
        // a span whose middle is deep inside the piece (a chest line): put the label past its end instead of far above
        const walk = (sd: number) => { let t = 0; while (t < 400 && pointInPoly(g.poly, { x: mid.x + sd * nx * px(t), y: mid.y + sd * ny * px(t) })) t += 3; return t; };
        if (Math.min(walk(1), walk(-1)) > 28) {
          for (const [end, sgn] of [[m.b, 1], [m.a, -1]] as const) {
            const cx = end.x + (dx / L) * sgn * px(10 + tw / 2), cy = end.y + (dy / L) * sgn * px(10 + tw / 2);
            const r = rectAt(en.offset.x + cx, en.offset.y + cy, px(tw), px(th));
            const onOther = entries.some((o) => { const og = geos.get(o.key); return o.key !== en.key && !!og && hit({ x0: o.offset.x + og.bb.minX, y0: o.offset.y + og.bb.minY, x1: o.offset.x + og.bb.maxX, y1: o.offset.y + og.bb.maxY }, r); });
            if (free(r) && !onOther) { keep.push(r); list.push({ key: m.label, a: m.a, b: m.b, vertical: !!m.vertical, text, lx: cx, ly: cy, sel }); done = true; break; }
          }
        }
        for (const side of done ? [] : [1, -1]) {
          // walk out of the outline first
          let t = 0;
          while (t < 400 && pointInPoly(g.poly, { x: mid.x + side * nx * px(t), y: mid.y + side * ny * px(t) })) t += 3;
          for (const extra of [10, 28, 46]) {
            const dist = t + extra + (Math.abs(ny) > 0.5 ? th / 2 : tw / 2);
            const cx = mid.x + side * nx * px(dist), cy = mid.y + side * ny * px(dist);
            const r = rectAt(en.offset.x + cx, en.offset.y + cy, px(tw), px(th));
            if (free(r)) { keep.push(r); list.push({ key: m.label, a: m.a, b: m.b, vertical: !!m.vertical, text, lx: cx, ly: cy, sel }); done = true; break; }
          }
          if (done) break;
        }
      }
    }
    measures.set(en.key, list);
  }

  // ---- edge lengths on the selected piece, only when zoomed in and there is room
  if (selKey && k >= 5) {
    const en = entries.find((e) => e.key === selKey);
    const g = en && geos.get(en.key);
    if (en && g) {
      const list: EdgeLabel[] = [];
      g.bz.forEach((b, i) => {
        const L = bezLength(b);
        if (L * k < 70) return;
        const m = bezAt(b, 0.5), tg = bezTangent(b, 0.5);
        let n = { x: -tg.y, y: tg.x };
        const nl = Math.hypot(n.x, n.y) || 1; n = { x: n.x / nl, y: n.y / nl };
        if ((m.x + n.x - g.c.x) ** 2 + (m.y + n.y - g.c.y) ** 2 < (m.x - g.c.x) ** 2 + (m.y - g.c.y) ** 2) n = { x: -n.x, y: -n.y };
        const text = fmt(L, units);
        const x = m.x + n.x * px(13), y = m.y + n.y * px(13);
        const r = rectAt(en.offset.x + x, en.offset.y + y, px(TEXT_W(text, 10) + 2), px(12));
        if (free(r)) { keep.push(r); list.push({ key: String(i), text, x, y }); }
      });
      edges.set(en.key, list);
    }
  }
  return { names, measures, edges };
}

export { frameOn };
