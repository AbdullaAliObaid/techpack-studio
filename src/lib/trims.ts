// Plain SVG symbols for hardware trims, for the 2D pattern chart. Dependency free.
// Unit space: centimetres, origin at the attachment centre, x along the attachment's w direction (the row), y along h
// (down the garment when unrotated). The caller applies the attachment's translate and rotate.
// Every entry is one SVG path string. Draw them stroked with no fill (or fill the ones that carry fillRule).

import { rowSlots, type Attachment, type Hardware } from '../data/edits';
import * as shapesLib from './shapes';

/** Outline rings (cm, centred) of an attachment: one ring per cut piece (an applique word gives one per letter). */
export function attachmentRings(a: shapesLib.AttachShapeSrc): { x: number; y: number }[][] {
  const rings = shapesLib.attachmentPolygons(a);
  return rings.length ? rings : [shapesLib.outlinePolygon(a.outline, a.w, a.h, a.points)];
}

/** Every ring of an attachment, the counters (holes) too: for drawing the cut edge and for edge stitching. */
export function attachmentAllRings(a: shapesLib.AttachShapeSrc): { x: number; y: number }[][] {
  return shapesLib.attachmentShapes(a).flatMap((s) => [s.outer, ...s.holes]);
}

/** The largest outline ring of an attachment. */
export function attachmentPolygon(a: shapesLib.AttachShapeSrc): { x: number; y: number }[] {
  const area = (r: { x: number; y: number }[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0));
  return attachmentRings(a).reduce((b, r) => (area(r) > area(b) ? r : b));
}

export interface GlyphPath { d: string; fillRule?: 'evenodd' | 'nonzero'; /** labelGlyph: how to draw it (outline: solid, stitch: dashed, fold: dotted) */ role?: 'outline' | 'stitch' | 'fold' }

const f = (v: number) => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000);
const circle = (cx: number, cy: number, r: number) =>
  `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
const line = (x0: number, y0: number, x1: number, y1: number) => `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;

/** Centre offsets (cm, along x) of each trim in a row, centred on 0. */
export function hardwareRow(hw: Hardware): number[] {
  if (hw.type === 'zipper') return [0];
  const n = Math.max(1, Math.min(60, Math.round(hw.count ?? 1)));
  const gap = hw.spacing ?? hw.size * 2.2;
  return rowSlots(hw).map((i) => f((i - (n - 1) / 2) * gap));
}

const poly = (pts: { x: number; y: number }[], dx = 0, dy = 0) => pts.map((p, i) => `${i ? 'L' : 'M'}${f(p.x + dx)} ${f(p.y + dy)}`).join('') + 'Z';

/** Extent (cm) of a drawn outline: the larger of its width and height. */
export function outlineExtent(pts: { x: number; y: number }[]): number {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return Math.max(x1 - x0, y1 - y0, 0.1);
}

/** Hole centres (cm, relative to the trim centre) for a button with 2 or 4 holes, from the size of its outline. */
export function holeOffsets(holes: Hardware['holes'], radius: number): { x: number; y: number }[] {
  const d = radius * 0.34;
  if (holes === 2) return [{ x: -d, y: 0 }, { x: d, y: 0 }];
  if (holes === 4) return [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => ({ x: x * d * 0.8, y: y * d * 0.8 }));
  return [];
}

function drawn(hw: Hardware, cx: number): GlyphPath[] {
  const o = hw.outline!;
  const ext = outlineExtent(o);
  const out: GlyphPath[] = [{ d: poly(o, cx, 0) }, { d: poly(o.map((p) => ({ x: p.x * 0.82, y: p.y * 0.82 })), cx, 0) }];
  const hr = Math.max(0.03, ext * 0.045);
  if (hw.type === 'button' || hw.type === 'snap') for (const h of holeOffsets(hw.holes ?? 4, ext / 2)) out.push({ d: circle(cx + h.x, h.y, hr) });
  if (hw.type === 'button' && hw.holes === 'shank') out.push({ d: circle(cx, 0, hr * 1.4) });
  return out;
}

function one(hw: Hardware, cx: number): GlyphPath[] {
  if (hw.outline && hw.outline.length > 2) return drawn(hw, cx);
  const r = Math.max(0.1, hw.size / 2);
  switch (hw.type) {
    case 'rivet':
      // outer rim, domed cap, and a cross so it reads as a rivet at small sizes
      return [{ d: circle(cx, 0, r) }, { d: circle(cx, 0, r * 0.55) }, { d: line(cx - r * 0.4, 0, cx + r * 0.4, 0) + line(cx, -r * 0.4, cx, r * 0.4) }];
    case 'eyelet':
      // double ring: metal ring with the hole in the middle (even odd keeps the hole open when filled)
      return [{ d: circle(cx, 0, r) + circle(cx, 0, r * 0.5), fillRule: 'evenodd' }];
    case 'stud':
      return [{ d: circle(cx, 0, r) }, { d: `M${f(cx)} ${f(-r * 0.6)}L${f(cx + r * 0.6)} 0L${f(cx)} ${f(r * 0.6)}L${f(cx - r * 0.6)} 0Z` }];
    case 'snap':
      return [{ d: circle(cx, 0, r) }, { d: circle(cx, 0, r * 0.62) }, { d: circle(cx, 0, r * 0.2) }];
    case 'button': {
      const holes = hw.holes === undefined ? 4 : hw.holes;
      const hs = holes === 'shank' ? [{ x: 0, y: 0 }] : holeOffsets(holes, r);
      const hr = holes === 'shank' ? r * 0.16 : r * 0.1;
      return [{ d: circle(cx, 0, r) }, { d: circle(cx, 0, r * 0.72) }, ...(hs.length ? [{ d: hs.map((q) => circle(cx + q.x, q.y, hr)).join('') }] : [])];
    }
    default:
      return [];
  }
}

/** The puller drawn below the slider at y0 (cm): standard bar, ring, wide tab, cord with a tip, or the user's drawn shape. */
export function pullerGlyph(hw: Hardware, y0: number): GlyphPath[] {
  const z = hw.zipper;
  const type = z?.puller ?? 'standard';
  switch (type) {
    case 'ring': return [{ d: line(0, y0, 0, y0 + 0.25) }, { d: circle(0, y0 + 0.25 + 0.5, 0.5) }];
    case 'tab': return [{ d: `M-0.4 ${f(y0)}H0.4V${f(y0 + 1.9)}H-0.4Z` }, { d: circle(0, y0 + 0.35, 0.09) }];
    case 'cord': return [{ d: `M0 ${f(y0)}C0.5 ${f(y0 + 0.6)} -0.5 ${f(y0 + 1.2)} 0 ${f(y0 + 1.8)}` }, { d: `M-0.14 ${f(y0 + 1.8)}H0.14V${f(y0 + 2.4)}H-0.14Z` }];
    case 'custom': {
      const o = z?.pullerOutline;
      if (o && o.length > 2) {
        let top = Infinity;
        for (const p of o) top = Math.min(top, p.y);
        return [{ d: poly(o, 0, y0 - top) }];
      }
      return [{ d: line(0, y0, 0, y0 + 0.95) }];
    }
    default: return [{ d: `M-0.28 ${f(y0)}H0.28V${f(y0 + 1.3)}H-0.28Z` }];
  }
}

/**
 * Paths for a clothing tag (kind 'label') in its own frame: the cut outline, the stitching its `label.sewn` asks
 * for (role 'stitch': draw dashed), and the fold line of a folded loop (role 'fold': dotted). Centred on 0,0, cm.
 */
export function labelGlyph(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text' | 'label'>): GlyphPath[] {
  const ring = attachmentPolygon(a);
  const out: GlyphPath[] = [{ d: poly(ring), role: 'outline' }];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const i = 0.15, sewn = a.label?.sewn ?? 'ends';
  const long = x1 - x0 >= y1 - y0; // long axis along x: the ends are the left and right edges
  if (sewn === 'all-round') {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, sx = Math.max(0.1, (x1 - x0 - 2 * i) / (x1 - x0 || 1)), sy = Math.max(0.1, (y1 - y0 - 2 * i) / (y1 - y0 || 1));
    out.push({ d: poly(ring.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy }))), role: 'stitch' });
  } else {
    const ends = long
      ? [line(x0 + i, y0 + i, x0 + i, y1 - i), line(x1 - i, y0 + i, x1 - i, y1 - i)]
      : [line(x0 + i, y0 + i, x1 - i, y0 + i), line(x0 + i, y1 - i, x1 - i, y1 - i)];
    for (const d of ends) out.push({ d, role: 'stitch' });
    if (sewn === 'folded-loop') out.push({ d: long ? line((x0 + x1) / 2, y0, (x0 + x1) / 2, y1) : line(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2), role: 'fold' });
  }
  return out;
}

/**
 * Paths for a hardware attachment, the whole row for count + spacing. Zippers draw along y for `length` cm (the
 * attachment's h): two tape edges, the join line and alternating teeth ticks; open shows the two sides apart.
 */
export function hardwareGlyph(hw: Hardware, length = 10): GlyphPath[] {
  if (hw.type === 'zipper') {
    const half = length / 2, w = Math.max(0.4, hw.size) / 2;
    const gap = hw.open ? w * 0.9 : 0;
    const out: GlyphPath[] = [
      { d: line(-(gap + w), -half, -(gap + w), half) + line(gap + w, -half, gap + w, half) },
    ];
    // teeth: short ticks stepping down both sides, staggered like a real coil
    let ticks = '';
    for (let y = -half + 0.25, i = 0; y <= half; y += 0.5, i++) {
      const side = i % 2 ? 1 : -1;
      ticks += line(side * gap, y, side * (gap + w * 0.6), y);
    }
    out.push({ d: ticks });
    out.push({ d: gap ? line(-gap, -half, -gap, half) + line(gap, -half, gap, half) : line(0, -half, 0, half) });
    // slider and puller: at the top when closed, near the bottom when open
    const sy = hw.open ? half * 0.56 : -half + 0.7;
    out.push({ d: `M${f(-w * 0.8)} ${f(sy - 0.45)}H${f(w * 0.8)}V${f(sy + 0.45)}H${f(-w * 0.8)}Z` });
    out.push(...pullerGlyph(hw, sy + 0.45));
    return out;
  }
  return hardwareRow(hw).flatMap((x) => one(hw, x));
}
