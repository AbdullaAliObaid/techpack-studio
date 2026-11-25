// 2D pattern geometry. All units are centimetres, y points down (screen space).

export type Pt = { x: number; y: number };

export interface PPoint {
  id: string;
  x: number;
  y: number;
  smooth: boolean;
  /** id of the mirrored partner point; equal to own id when the point sits on the axis */
  mirror: string | null;
  tag?: string;
  /** stable id of a drafted point, used to regrade the pattern when the body changes */
  key?: string;
}

export interface Bez {
  p0: Pt;
  c1: Pt;
  c2: Pt;
  p1: Pt;
}

export const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

/** Convert outline points into cubic beziers. Smooth points get a tangent along their neighbours, corners get none. */
export function toBeziers(pts: PPoint[]): Bez[] {
  const n = pts.length;
  const dirs = pts.map((p, i) => {
    if (!p.smooth) return { x: 0, y: 0 };
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    return norm(sub(b, a));
  });
  return pts.map((p0, i) => {
    const p1 = pts[(i + 1) % n];
    const L = dist(p0, p1) / 3;
    const d0 = dirs[i];
    const d1 = dirs[(i + 1) % n];
    return {
      p0,
      c1: { x: p0.x + d0.x * L, y: p0.y + d0.y * L },
      c2: { x: p1.x - d1.x * L, y: p1.y - d1.y * L },
      p1,
    };
  });
}

export function bezAt(b: Bez, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u, c = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * b.p0.x + c * b.c1.x + d * b.c2.x + e * b.p1.x,
    y: a * b.p0.y + c * b.c1.y + d * b.c2.y + e * b.p1.y,
  };
}

export function bezTangent(b: Bez, t: number): Pt {
  const u = 1 - t;
  return norm({
    x: 3 * u * u * (b.c1.x - b.p0.x) + 6 * u * t * (b.c2.x - b.c1.x) + 3 * t * t * (b.p1.x - b.c2.x),
    y: 3 * u * u * (b.c1.y - b.p0.y) + 6 * u * t * (b.c2.y - b.c1.y) + 3 * t * t * (b.p1.y - b.c2.y),
  });
}

export function pathD(bz: Bez[]): string {
  if (!bz.length) return '';
  let d = `M${bz[0].p0.x},${bz[0].p0.y}`;
  for (const b of bz) d += `C${b.c1.x},${b.c1.y} ${b.c2.x},${b.c2.y} ${b.p1.x},${b.p1.y}`;
  return d + 'Z';
}

export function polyD(poly: Pt[]): string {
  return poly.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('') + 'Z';
}

export function bezLength(b: Bez, n = 32): number {
  let L = 0;
  let prev = b.p0;
  for (let i = 1; i <= n; i++) {
    const p = bezAt(b, i / n);
    L += dist(prev, p);
    prev = p;
  }
  return L;
}

/** Dense closed polyline of the outline (first point not repeated). */
export function samplePoly(pts: PPoint[], perSeg = 20): Pt[] {
  const out: Pt[] = [];
  for (const b of toBeziers(pts)) for (let i = 0; i < perSeg; i++) out.push(bezAt(b, i / perSeg));
  return out;
}

/** Sorted x positions where the horizontal line y crosses the polygon. */
export function sliceX(poly: Pt[], y: number): number[] {
  const xs: number[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      xs.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return xs.sort((p, q) => p - q);
}

/** Width of the polygon at height y. With nearX, picks the filled span containing it (e.g. one leg). */
export function sliceSpan(poly: Pt[], y: number, nearX?: number): { x1: number; x2: number } | null {
  let xs = sliceX(poly, y);
  if (xs.length < 2) xs = sliceX(poly, y + 0.01);
  if (xs.length < 2) return null;
  if (nearX === undefined) return { x1: xs[0], x2: xs[xs.length - 1] };
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (nearX >= xs[i] - 0.8 && nearX <= xs[i + 1] + 0.8) return { x1: xs[i], x2: xs[i + 1] };
  }
  return { x1: xs[0], x2: xs[xs.length - 1] };
}

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function centroid(poly: Pt[]): Pt {
  let cx = 0, cy = 0, A = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const f = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * f;
    cy += (a.y + b.y) * f;
    A += f;
  }
  if (Math.abs(A) < 1e-6) return poly[0] ?? { x: 0, y: 0 };
  return { x: cx / (3 * A), y: cy / (3 * A) };
}

export function bbox(poly: Pt[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/** Offset a closed polyline inward by d (used for the stitch line). */
export function offsetInward(poly: Pt[], d: number): Pt[] {
  const sign = signedArea(poly) > 0 ? 1 : -1;
  const n = poly.length;
  return poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n];
    const b = poly[(i + 1) % n];
    const t = norm(sub(b, a));
    // for a positive-area (clockwise on screen) polygon the inward normal is (-ty, tx)
    const nrm = { x: -t.y * sign, y: t.x * sign };
    return { x: p.x + nrm.x * d, y: p.y + nrm.y * d };
  });
}

export function nearestOnOutline(pts: PPoint[], p: Pt) {
  let best = { seg: 0, t: 0, pt: pts[0] as Pt, d: Infinity };
  toBeziers(pts).forEach((b, seg) => {
    for (let i = 1; i < 40; i++) {
      const t = i / 40;
      const q = bezAt(b, t);
      const d = dist(q, p);
      if (d < best.d) best = { seg, t, pt: q, d };
    }
  });
  return best;
}

export function pointInPoly(poly: Pt[], p: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Length along the outline between two points (by id), taking the shorter way round. */
export function outlineLength(pts: PPoint[], fromId: string, toId: string): number {
  const ia = pts.findIndex((p) => p.id === fromId), ib = pts.findIndex((p) => p.id === toId);
  if (ia < 0 || ib < 0) return 0;
  const bz = toBeziers(pts);
  const n = pts.length;
  const fwd = (ib - ia + n) % n, back = (ia - ib + n) % n;
  let L = 0;
  if (fwd <= back) for (let i = ia; i !== ib; i = (i + 1) % n) L += bezLength(bz[i], 48);
  else for (let i = ib; i !== ia; i = (i + 1) % n) L += bezLength(bz[i], 48);
  return L;
}
