// Plain SVG symbols for hardware trims, for the 2D pattern chart. Dependency free.
// Unit space: centimetres, origin at the attachment centre, x along the attachment's w direction (the row), y along h
// (down the garment when unrotated). The caller applies the attachment's translate and rotate.
// Every entry is one SVG path string. Draw them stroked with no fill (or fill the ones that carry fillRule).

import type { Attachment, Hardware } from '../data/edits';
import * as shapesLib from './shapes';

/** Outline rings (cm, centred) of an attachment: one ring per cut piece (an applique word gives one per letter). */
export function attachmentRings(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text'>): { x: number; y: number }[][] {
  const rings = shapesLib.attachmentPolygons(a);
  return rings.length ? rings : [shapesLib.outlinePolygon(a.outline, a.w, a.h, a.points)];
}

/** The largest outline ring of an attachment. */
export function attachmentPolygon(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text'>): { x: number; y: number }[] {
  const area = (r: { x: number; y: number }[]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p.x * q.y - q.x * p.y; }, 0));
  return attachmentRings(a).reduce((b, r) => (area(r) > area(b) ? r : b));
}

export interface GlyphPath { d: string; fillRule?: 'evenodd' | 'nonzero' }

const f = (v: number) => (Math.abs(v) < 1e-6 ? 0 : Math.round(v * 1000) / 1000);
const circle = (cx: number, cy: number, r: number) =>
  `M${f(cx - r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx + r)} ${f(cy)}A${f(r)} ${f(r)} 0 1 0 ${f(cx - r)} ${f(cy)}Z`;
const line = (x0: number, y0: number, x1: number, y1: number) => `M${f(x0)} ${f(y0)}L${f(x1)} ${f(y1)}`;

/** Centre offsets (cm, along x) of each trim in a row, centred on 0. */
export function hardwareRow(hw: Hardware): number[] {
  if (hw.type === 'zipper') return [0];
  const n = Math.max(1, Math.min(60, Math.round(hw.count ?? 1)));
  const gap = hw.spacing ?? hw.size * 2.2;
  return Array.from({ length: n }, (_, i) => f((i - (n - 1) / 2) * gap));
}

function one(hw: Hardware, cx: number): GlyphPath[] {
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
      const h = r * 0.32;
      return [{ d: circle(cx, 0, r) }, { d: circle(cx, 0, r * 0.72) }, { d: [[-h, -h], [h, -h], [-h, h], [h, h]].map(([x, y]) => circle(cx + x, y, r * 0.1)).join('') }];
    }
    default:
      return [];
  }
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
    out.push({ d: `M${f(-w * 0.8)} ${f(sy - 0.45)}H${f(w * 0.8)}V${f(sy + 0.45)}H${f(-w * 0.8)}Z` + line(0, sy + 0.45, 0, sy + 1.4) });
    return out;
  }
  return hardwareRow(hw).flatMap((x) => one(hw, x));
}
