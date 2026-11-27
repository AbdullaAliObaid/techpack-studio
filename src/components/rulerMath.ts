// Pure maths for the chart measuring tools. Everything is in chart world units (cm), the same units the pattern is drafted in.
import { bezAt, dist, toBeziers, type PPoint, type Pt } from '../lib/geometry';

/** The angle at `v` between the arms v to a and v to b, in degrees (0 to 180). */
export function angleDeg(v: Pt, a: Pt, b: Pt): number {
  const ax = a.x - v.x, ay = a.y - v.y, bx = b.x - v.x, by = b.y - v.y;
  if (Math.hypot(ax, ay) < 1e-9 || Math.hypot(bx, by) < 1e-9) return 0;
  return (Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by) * 180) / Math.PI;
}

/** Straight length between two points. */
export const lengthOf = (a: Pt, b: Pt) => dist(a, b);

/** A spot on a closed outline: `seg` is the edge (from point seg to point seg + 1), `t` runs 0 to 1 along it. */
export interface ArcPos { seg: number; t: number }

/** The nearest spot on the outline to `p` (coarse scan, then refined). */
export function nearestOnArc(pts: PPoint[], p: Pt): { pos: ArcPos; pt: Pt; d: number } {
  const bz = toBeziers(pts);
  let best = { pos: { seg: 0, t: 0 }, pt: pts[0] as Pt, d: Infinity };
  const N = 48;
  bz.forEach((b, seg) => {
    for (let i = 0; i <= N; i++) {
      const q = bezAt(b, i / N), d = dist(q, p);
      if (d < best.d) best = { pos: { seg, t: i / N }, pt: q, d };
    }
  });
  const b = bz[best.pos.seg];
  let lo = Math.max(0, best.pos.t - 1 / N), hi = Math.min(1, best.pos.t + 1 / N);
  for (let i = 0; i < 24; i++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (dist(bezAt(b, m1), p) < dist(bezAt(b, m2), p)) hi = m2; else lo = m1;
  }
  const t = (lo + hi) / 2, pt = bezAt(b, t);
  const d = dist(pt, p);
  return d <= best.d ? { pos: { seg: best.pos.seg, t }, pt, d } : best;
}

/** Walk the outline forward from `a` to `b` (wrapping round), as a fine polyline and its length. */
function walk(bz: ReturnType<typeof toBeziers>, a: ArcPos, b: ArcPos): { len: number; path: Pt[] } {
  const n = bz.length;
  const ua = a.seg + a.t, ub = b.seg + b.t;
  const span = (ub - ua + n) % n;
  const steps = Math.max(2, Math.ceil(span * 96));
  const path: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const u = (ua + (span * i) / steps) % n;
    const seg = Math.min(n - 1, Math.floor(u + 1e-12));
    path.push(bezAt(bz[seg], Math.min(1, u - seg)));
  }
  let len = 0;
  for (let i = 1; i < path.length; i++) len += dist(path[i - 1], path[i]);
  return { len, path };
}

/** Curved length along the outline between two spots, taking the shorter way round. The path runs from `a` to `b`. */
export function arcBetween(pts: PPoint[], a: ArcPos, b: ArcPos): { len: number; path: Pt[] } {
  const bz = toBeziers(pts);
  const fwd = walk(bz, a, b);
  const back = walk(bz, b, a);
  return fwd.len <= back.len ? fwd : { len: back.len, path: back.path.slice().reverse() };
}

/** A nice ruler step (in the chosen unit) so that ticks are at least `minPx` apart at `pxPerUnit`. */
export function niceStep(pxPerUnit: number, minPx: number): number {
  const raw = minPx / pxPerUnit;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}
