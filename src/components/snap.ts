// Magnetism for dragging points: pure functions, no store, no DOM. Units are whatever the caller uses (chart cm).
// A moving point snaps to the same x (a vertical line) or the same y (a horizontal line) as a target, when it is
// closer than `thr`. The whole selection moves by one shared delta, so the closest pair (any moving point, any
// target) decides, and every other pair that lines up at that delta is drawn as part of the same guide.
export interface P { x: number; y: number }

/** Something to line up with: a point (both axes) or a line (only x or only y). */
export interface Target { x?: number; y?: number; label: string }

export interface Guide {
  axis: 'x' | 'y';
  /** the coordinate of the line (x for a vertical line, y for a horizontal one) */
  at: number;
  /** the span drawn along the line */
  a: number;
  b: number;
  label: string;
}

export interface SnapResult { dx: number; dy: number; guides: Guide[] }

const EPS = 1e-6;

/**
 * `moving` are the positions the points would have without snapping. Returns the extra shift that makes them line up
 * (zero on an axis with nothing within `thr`) and the guides to draw at the shifted position.
 */
export function snapMove(moving: P[], targets: Target[], thr: number): SnapResult {
  let bx = Infinity, by = Infinity, dx = 0, dy = 0, lx = '', ly = '';
  for (const m of moving) {
    for (const t of targets) {
      if (t.x !== undefined) { const d = t.x - m.x, ad = Math.abs(d); if (ad <= thr && ad < bx) { bx = ad; dx = d; lx = t.label; } }
      if (t.y !== undefined) { const d = t.y - m.y, ad = Math.abs(d); if (ad <= thr && ad < by) { by = ad; dy = d; ly = t.label; } }
    }
  }
  const sx = lx !== '', sy = ly !== '';
  if (!sx) dx = 0;
  if (!sy) dy = 0;
  const guides: Guide[] = [];
  const at = moving.map((m) => ({ x: m.x + dx, y: m.y + dy }));
  const collect = (axis: 'x' | 'y', value: (p: P) => number, other: (p: P) => number, tv: (t: Target) => number | undefined, label: string) => {
    let line: number | null = null;
    for (const t of targets) { const v = tv(t); if (v !== undefined && at.some((m) => Math.abs(value(m) - v) < EPS)) { if (t.label === label || line === null) line = v; } }
    if (line === null) return;
    const along: number[] = at.filter((m) => Math.abs(value(m) - line!) < EPS).map(other);
    for (const t of targets) {
      const v = tv(t);
      if (v === undefined || Math.abs(v - line) > EPS) continue;
      const o = axis === 'x' ? t.y : t.x;
      if (o !== undefined) along.push(o);
    }
    if (!along.length) return;
    guides.push({ axis, at: line, a: Math.min(...along), b: Math.max(...along), label });
  };
  if (sx) collect('x', (p) => p.x, (p) => p.y, (t) => t.x, lx);
  if (sy) collect('y', (p) => p.y, (p) => p.x, (t) => t.y, ly);
  return { dx, dy, guides };
}

/** Pull `p` onto the nearest multiple of `step` degrees as seen from `from`, keeping its distance. */
export function angleSnap(from: P, p: P, step = 45): P {
  const dx = p.x - from.x, dy = p.y - from.y, L = Math.hypot(dx, dy);
  if (L < 1e-9) return p;
  const a = Math.round(Math.atan2(dy, dx) / ((step * Math.PI) / 180)) * ((step * Math.PI) / 180);
  // axis angles land exactly on the axis, so a vertical or horizontal result has no rounding noise
  const c = Math.abs(Math.cos(a)) < 1e-12 ? 0 : Math.cos(a), s = Math.abs(Math.sin(a)) < 1e-12 ? 0 : Math.sin(a);
  return { x: from.x + L * c, y: from.y + L * s };
}

/* ---------- selection box, align, distribute, resize ---------- */

export interface Box { x: number; y: number; w: number; h: number }

export function boxOf(pts: P[]): Box | null {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export type AlignMode = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom';

export function alignPoints(pts: P[], mode: AlignMode): P[] {
  const b = boxOf(pts);
  if (!b) return pts;
  return pts.map((p) => {
    switch (mode) {
      case 'left': return { x: b.x, y: p.y };
      case 'centre': return { x: b.x + b.w / 2, y: p.y };
      case 'right': return { x: b.x + b.w, y: p.y };
      case 'top': return { x: p.x, y: b.y };
      case 'middle': return { x: p.x, y: b.y + b.h / 2 };
      default: return { x: p.x, y: b.y + b.h };
    }
  });
}

/** Equal gaps along one axis: the two outermost points stay, the ones between are spread evenly in order. */
export function distributePoints(pts: P[], axis: 'x' | 'y'): P[] {
  if (pts.length < 3) return pts;
  const order = pts.map((p, i) => i).sort((a, b) => pts[a][axis] - pts[b][axis]);
  const lo = pts[order[0]][axis], hi = pts[order[order.length - 1]][axis];
  const out = pts.map((p) => ({ ...p }));
  order.forEach((idx, n) => { out[idx][axis] = lo + ((hi - lo) * n) / (order.length - 1); });
  return out;
}

/** Move the selection box to x, y and/or resize it to w, h (scaling about its top left corner). */
export function placeBox(pts: P[], to: Partial<Box>): P[] {
  const b = boxOf(pts);
  if (!b) return pts;
  const sx = to.w !== undefined && b.w > 1e-6 ? Math.max(0.001, to.w) / b.w : 1;
  const sy = to.h !== undefined && b.h > 1e-6 ? Math.max(0.001, to.h) / b.h : 1;
  const nx = to.x ?? b.x, ny = to.y ?? b.y;
  return pts.map((p) => ({ x: nx + (p.x - b.x) * sx, y: ny + (p.y - b.y) * sy }));
}
