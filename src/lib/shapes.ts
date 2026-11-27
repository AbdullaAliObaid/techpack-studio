// Shape library for emblems, prints and attachment outlines. Every shape is an SVG path in a unit box
// centred on (0,0) spanning -0.5..0.5, so it can be scaled to any w x h. Used by the 2D pattern chart
// (SVG), the emblem editor and the 3D print textures (Canvas Path2D accepts the same strings).

import type { Attachment, Outline, ShapeId } from '../data/edits';

type P2 = { x: number; y: number };

function poly(pts: [number, number][]) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(4)} ${y.toFixed(4)}`).join('') + 'Z';
}
function star(n: number, inner: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? 0.5 * inner : 0.5;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return poly(pts);
}
function ngon(n: number, rot = 0) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
  }
  return poly(pts);
}
const circle = 'M0.5 0A0.5 0.5 0 1 1 -0.5 0A0.5 0.5 0 1 1 0.5 0Z';

const SQUARE_D = 'M-0.5 -0.5L0.5 -0.5L0.5 0.5L-0.5 0.5Z';

export const SHAPES: Record<ShapeId, { name: string; d: string }> = {
  rect: { name: 'Square', d: poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) },
  rounded: { name: 'Rounded', d: 'M-0.35 -0.5H0.35Q0.5 -0.5 0.5 -0.35V0.35Q0.5 0.5 0.35 0.5H-0.35Q-0.5 0.5 -0.5 0.35V-0.35Q-0.5 -0.5 -0.35 -0.5Z' },
  circle: { name: 'Circle', d: circle },
  triangle: { name: 'Triangle', d: poly([[0, -0.5], [0.5, 0.5], [-0.5, 0.5]]) },
  star: { name: 'Star', d: star(5, 0.42) },
  star4: { name: 'Sparkle', d: star(4, 0.3) },
  heart: { name: 'Heart', d: 'M0 0.45C-0.6 0.05 -0.55 -0.45 -0.25 -0.45C-0.1 -0.45 0 -0.32 0 -0.22C0 -0.32 0.1 -0.45 0.25 -0.45C0.55 -0.45 0.6 0.05 0 0.45Z' },
  hexagon: { name: 'Hexagon', d: ngon(6, Math.PI / 6) },
  shield: { name: 'Shield', d: 'M-0.5 -0.5H0.5V0Q0.5 0.35 0 0.5Q-0.5 0.35 -0.5 0Z' },
  chevron: { name: 'Chevron', d: poly([[-0.5, -0.1], [0, -0.5], [0.5, -0.1], [0.5, 0.2], [0, -0.2], [-0.5, 0.2]]) },
  stripe: { name: 'Stripe', d: poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) },
  bolt: { name: 'Bolt', d: poly([[0.1, -0.5], [-0.35, 0.05], [-0.02, 0.05], [-0.15, 0.5], [0.35, -0.08], [0.02, -0.08]]) },
  cross: { name: 'Cross', d: poly([[-0.15, -0.5], [0.15, -0.5], [0.15, -0.15], [0.5, -0.15], [0.5, 0.15], [0.15, 0.15], [0.15, 0.5], [-0.15, 0.5], [-0.15, 0.15], [-0.5, 0.15], [-0.5, -0.15], [-0.15, -0.15]]) },
  diamond: { name: 'Diamond', d: poly([[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]]) },
  ring: { name: 'Ring', d: circle + 'M0.32 0A0.32 0.32 0 1 0 -0.32 0A0.32 0.32 0 1 0 0.32 0Z' },
  text: { name: 'Text', d: '' },
  image: { name: 'Picture', d: SQUARE_D },
  path: { name: 'Traced shape', d: '' },
};

export const OUTLINES: Record<Exclude<Outline, 'custom' | 'shape'>, string> = {
  rect: SHAPES.rect.d,
  rounded: SHAPES.rounded.d,
  pointed: poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.25], [0, 0.5], [-0.5, 0.25]]), // classic jeans back pocket
  circle,
  shield: SHAPES.shield.d,
};

/** Polygon (cm, centred) for an attachment outline, for meshing it as cloth. 'shape' cuts `shape` (largest ring for text). */
export function outlinePolygon(outline: Outline, w: number, h: number, custom?: { x: number; y: number }[], n = 48, shape?: ShapeId, text?: string): { x: number; y: number }[] {
  if (outline === 'custom' && custom?.length) return custom;
  if (outline === 'shape') {
    const rings = shapePolygon(shape ?? 'rect', w, h, text);
    if (rings.length) return rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
    outline = 'rect';
  }
  if (outline === 'circle') return Array.from({ length: n }, (_, i) => ({ x: (w / 2) * Math.cos((i / n) * 2 * Math.PI), y: (h / 2) * Math.sin((i / n) * 2 * Math.PI) }));
  if (outline === 'pointed') return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.25], [0, 0.5], [-0.5, 0.25]].map(([x, y]) => ({ x: x * w, y: y * h }));
  if (outline === 'shield') {
    const pts: { x: number; y: number }[] = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: 0 }];
    for (let i = 1; i < 12; i++) { const t = i / 12; pts.push({ x: (w / 2) * (1 - t), y: (h / 2) * Math.sin((t * Math.PI) / 2) }); }
    pts.push({ x: 0, y: h / 2 });
    for (let i = 1; i < 12; i++) { const t = i / 12; pts.push({ x: (-w / 2) * t, y: (h / 2) * Math.cos((t * Math.PI) / 2) }); }
    pts.push({ x: -w / 2, y: 0 });
    return pts;
  }
  if (outline === 'rounded') {
    const r = Math.min(w, h) * 0.15, pts: { x: number; y: number }[] = [];
    const c: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
    for (const [cx, cy, a0] of c) for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return pts;
  }
  return [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
}

export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];

// ---------------------------------------------------------------------------------------------
// shapes as cutting outlines: SVG path -> polygon rings, and a block letter font for text appliques
// ---------------------------------------------------------------------------------------------

function ringArea(r: P2[]) {
  let a = 0;
  for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p.x * q.y - q.x * p.y; }
  return a / 2;
}

/**
 * Flatten an SVG path (absolute and relative M L H V Q C A Z; S and T as smooth curves) into closed rings,
 * one per subpath, in the path's own units.
 */
export function pathRings(d: string, seg = 12): P2[][] {
  const tok = d.match(/[MmLlHhVvQqTtCcSsAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
  const rings: P2[][] = [];
  let cur: P2[] = [];
  let x = 0, y = 0, sx = 0, sy = 0, cmd = '', k = 0;
  let lastC: P2 | null = null, lastQ: P2 | null = null;
  const num = () => Number(tok[k++]);
  const isNum = () => k < tok.length && !/^[A-Za-z]$/.test(tok[k]);
  const close = () => { if (cur.length > 2) rings.push(cur); cur = []; };
  const to = (nx: number, ny: number) => { x = nx; y = ny; cur.push({ x, y }); };
  while (k < tok.length) {
    if (/^[A-Za-z]$/.test(tok[k])) cmd = tok[k++];
    else if (!cmd) { k++; continue; }
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    const ox = rel ? x : 0, oy = rel ? y : 0;
    if (C === 'Z') { close(); x = sx; y = sy; lastC = lastQ = null; continue; }
    if (!isNum()) { k++; continue; }
    if (C === 'M') {
      close();
      const nx = ox + num(), ny = oy + num();
      sx = nx; sy = ny; to(nx, ny);
      cmd = rel ? 'l' : 'L'; // further pairs are lines
      lastC = lastQ = null;
    } else if (C === 'L') { to(ox + num(), oy + num()); lastC = lastQ = null; }
    else if (C === 'H') { to((rel ? x : 0) + num(), y); lastC = lastQ = null; }
    else if (C === 'V') { to(x, (rel ? y : 0) + num()); lastC = lastQ = null; }
    else if (C === 'Q' || C === 'T') {
      let c1: P2;
      if (C === 'Q') c1 = { x: ox + num(), y: oy + num() };
      else c1 = lastQ ? { x: 2 * x - lastQ.x, y: 2 * y - lastQ.y } : { x, y };
      const ex = ox + num(), ey = oy + num(), x0 = x, y0 = y;
      for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; to(u * u * x0 + 2 * u * t * c1.x + t * t * ex, u * u * y0 + 2 * u * t * c1.y + t * t * ey); }
      lastQ = c1; lastC = null;
    } else if (C === 'C' || C === 'S') {
      let c1: P2;
      if (C === 'C') c1 = { x: ox + num(), y: oy + num() };
      else c1 = lastC ? { x: 2 * x - lastC.x, y: 2 * y - lastC.y } : { x, y };
      const c2 = { x: ox + num(), y: oy + num() }, ex = ox + num(), ey = oy + num(), x0 = x, y0 = y;
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, u = 1 - t;
        to(u * u * u * x0 + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * ex, u * u * u * y0 + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * ey);
      }
      lastC = c2; lastQ = null;
    } else if (C === 'A') {
      let rx = Math.abs(num()), ry = Math.abs(num());
      const phi = (num() * Math.PI) / 180, large = num() !== 0, sweep = num() !== 0;
      const ex = ox + num(), ey = oy + num(), x0 = x, y0 = y;
      lastC = lastQ = null;
      if (!rx || !ry || (ex === x0 && ey === y0)) { to(ex, ey); continue; }
      // endpoint to centre parameterisation (SVG spec, F.6.5)
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const dx = (x0 - ex) / 2, dy = (y0 - ey) / 2;
      const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
      const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
      if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
      const num2 = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1, den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
      const co = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num2 / den));
      const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
      const cx = cp * cx1 - sp * cy1 + (x0 + ex) / 2, cy = sp * cx1 + cp * cy1 + (y0 + ey) / 2;
      const ang = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
      let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
      if (!sweep && dt > 0) dt -= 2 * Math.PI;
      else if (sweep && dt < 0) dt += 2 * Math.PI;
      const n = Math.max(2, Math.ceil(Math.abs(dt) / (Math.PI / 18)));
      for (let i = 1; i <= n; i++) {
        const t = t1 + (dt * i) / n, c = Math.cos(t), s2 = Math.sin(t);
        to(cx + cp * rx * c - sp * ry * s2, cy + sp * rx * c + cp * ry * s2);
      }
    } else k++;
  }
  close();
  // drop repeated points (and a closing point equal to the first)
  return rings.map((r) => r.filter((p, i) => { const q = r[(i + r.length - 1) % r.length]; return Math.hypot(p.x - q.x, p.y - q.y) > 1e-6; })).filter((r) => r.length > 2);
}

// Block capitals A-Z, 0-9 as strokes on a 4 x 6 grid (y down). Each glyph is cut as the outline of its
// strokes drawn with a broad pen; inner holes (A, B, O ...) are not cut out of the cloth.
const STROKES: Record<string, number[][]> = {
  A: [[0, 6, 2, 0, 4, 6], [0.8, 4, 3.2, 4]],
  B: [[0, 0, 0, 6], [0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [3, 3, 4, 4, 4, 5, 3, 6, 0, 6]],
  C: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5]],
  D: [[0, 0, 0, 6, 2.5, 6, 4, 4.5, 4, 1.5, 2.5, 0, 0, 0]],
  E: [[4, 0, 0, 0, 0, 6, 4, 6], [0, 3, 3, 3]],
  F: [[4, 0, 0, 0, 0, 6], [0, 3, 3, 3]],
  G: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 3, 2, 3]],
  H: [[0, 0, 0, 6], [4, 0, 4, 6], [0, 3, 4, 3]],
  I: [[1, 0, 3, 0], [2, 0, 2, 6], [1, 6, 3, 6]],
  J: [[4, 0, 4, 5, 3, 6, 1, 6, 0, 5]],
  K: [[0, 0, 0, 6], [4, 0, 0, 3.5], [1.3, 2.6, 4, 6]],
  L: [[0, 0, 0, 6, 4, 6]],
  M: [[0, 6, 0, 0, 2, 3, 4, 0, 4, 6]],
  N: [[0, 6, 0, 0, 4, 6, 4, 0]],
  O: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0]],
  P: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3]],
  Q: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [2.5, 4.5, 4, 6]],
  R: [[0, 6, 0, 0, 3, 0, 4, 1, 4, 2, 3, 3, 0, 3], [2, 3, 4, 6]],
  S: [[4, 1, 3, 0, 1, 0, 0, 1, 0, 2, 1, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  T: [[0, 0, 4, 0], [2, 0, 2, 6]],
  U: [[0, 0, 0, 5, 1, 6, 3, 6, 4, 5, 4, 0]],
  V: [[0, 0, 2, 6, 4, 0]],
  W: [[0, 0, 1, 6, 2, 2.5, 3, 6, 4, 0]],
  X: [[0, 0, 4, 6], [4, 0, 0, 6]],
  Y: [[0, 0, 2, 3, 4, 0], [2, 3, 2, 6]],
  Z: [[0, 0, 4, 0, 0, 6, 4, 6]],
  0: [[1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 1, 6, 0, 5, 0, 1, 1, 0], [3.6, 0.8, 0.4, 5.2]],
  1: [[1, 1, 2, 0, 2, 6], [1, 6, 3, 6]],
  2: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 0, 6, 4, 6]],
  3: [[0, 1, 1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1.5, 3], [3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  4: [[3, 6, 3, 0, 0, 4, 4, 4]],
  5: [[4, 0, 0, 0, 0, 3, 3, 3, 4, 4, 4, 5, 3, 6, 1, 6, 0, 5]],
  6: [[3.5, 0, 1, 0, 0, 1, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3, 0, 3]],
  7: [[0, 0, 4, 0, 1.5, 6]],
  8: [[1, 0, 3, 0, 4, 1, 4, 2, 3, 3, 1, 3, 0, 2, 0, 1, 1, 0], [1, 3, 0, 4, 0, 5, 1, 6, 3, 6, 4, 5, 4, 4, 3, 3]],
  9: [[4, 3, 1, 3, 0, 2, 0, 1, 1, 0, 3, 0, 4, 1, 4, 5, 3, 6, 0.5, 6]],
};
const PEN = 0.6; // half width of a stroke, grid units
const GLYPH_W = 4 + 2 * PEN, GLYPH_H = 6 + 2 * PEN, GLYPH_GAP = 1;
const glyphCache = new Map<string, P2[] | null>();

/** Outer outline of a block letter in glyph units (0..GLYPH_W, 0..GLYPH_H, y down), or null for a space / unknown character. */
export function glyphOutline(ch: string): P2[] | null {
  const c = ch.toUpperCase();
  if (glyphCache.has(c)) return glyphCache.get(c)!;
  const strokes = STROKES[c];
  if (!strokes) { glyphCache.set(c, null); return null; }
  // rasterise the broad pen strokes, then trace the outer boundary of the filled cells
  const R = 6, pad = 1;
  const nx = Math.ceil(GLYPH_W * R) + 2 * pad, ny = Math.ceil(GLYPH_H * R) + 2 * pad;
  const fill = new Uint8Array(nx * ny);
  const segs: number[][] = [];
  for (const s of strokes) for (let i = 0; i + 3 < s.length; i += 2) segs.push([s[i] + PEN, s[i + 1] + PEN, s[i + 2] + PEN, s[i + 3] + PEN]);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const px = (i - pad + 0.5) / R, py = (j - pad + 0.5) / R;
    for (const [ax, ay, bx, by] of segs) {
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
      if (Math.hypot(px - ax - t * dx, py - ay - t * dy) <= PEN) { fill[i + j * nx] = 1; break; }
    }
  }
  const F = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && fill[i + j * nx] === 1;
  // directed boundary edges, filled cell on the right when walking (screen coords, y down)
  const out = new Map<number, number[]>();
  const vid = (i: number, j: number) => i + j * (nx + 1);
  const addE = (a: number, b: number) => { const l = out.get(a); if (l) l.push(b); else out.set(a, [b]); };
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    if (!F(i, j)) continue;
    if (!F(i, j - 1)) addE(vid(i, j), vid(i + 1, j));
    if (!F(i + 1, j)) addE(vid(i + 1, j), vid(i + 1, j + 1));
    if (!F(i, j + 1)) addE(vid(i + 1, j + 1), vid(i, j + 1));
    if (!F(i - 1, j)) addE(vid(i, j + 1), vid(i, j));
  }
  const loops: P2[][] = [];
  const xy = (v: number): P2 => ({ x: v % (nx + 1), y: Math.floor(v / (nx + 1)) });
  for (const [start] of out) {
    while (out.get(start)?.length) {
      const loop: P2[] = [];
      let a = start, prevDir: P2 | null = null;
      for (let guard = 0; guard < 100000; guard++) {
        const l = out.get(a);
        if (!l || !l.length) break;
        // where two cells touch at a corner, turn right (keeps the letter in one piece)
        let pick = 0;
        if (l.length > 1 && prevDir) {
          let best = -Infinity;
          l.forEach((b, k) => { const p = xy(a), q = xy(b), d = { x: q.x - p.x, y: q.y - p.y }; const turn = prevDir!.x * d.y - prevDir!.y * d.x; if (turn > best) { best = turn; pick = k; } });
        }
        const b = l.splice(pick, 1)[0];
        const p = xy(a), q = xy(b);
        prevDir = { x: q.x - p.x, y: q.y - p.y };
        loop.push(p);
        a = b;
        if (a === start) break;
      }
      if (loop.length > 2) loops.push(loop);
    }
  }
  if (!loops.length) { glyphCache.set(c, null); return null; }
  let ring = loops.reduce((m, r) => (Math.abs(ringArea(r)) > Math.abs(ringArea(m)) ? r : m));
  ring = simplifyRing(ring, 0.9).map((q) => ({ x: (q.x - pad) / R, y: (q.y - pad) / R }));
  glyphCache.set(c, ring);
  return ring;
}

/** Douglas-Peucker on a closed ring (tolerance in ring units), keeping at least a triangle. */
function simplifyRing(r: P2[], tol: number): P2[] {
  // split at the two points furthest apart, simplify both halves as open lines
  let i0 = 0, i1 = 0, best = -1;
  for (let i = 0; i < r.length; i++) { const d = Math.hypot(r[i].x - r[0].x, r[i].y - r[0].y); if (d > best) { best = d; i1 = i; } }
  const line = (pts: P2[]): P2[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1], dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
    let k = -1, dm = -1;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / L; if (d > dm) { dm = d; k = i; } }
    if (dm <= tol) return [a, b];
    const l1 = line(pts.slice(0, k + 1)), l2 = line(pts.slice(k));
    return [...l1.slice(0, -1), ...l2];
  };
  const h1 = line(r.slice(i0, i1 + 1)), h2 = line([...r.slice(i1), r[0]]);
  const out = [...h1.slice(0, -1), ...h2.slice(0, -1)];
  return out.length >= 3 ? out : r;
}

/**
 * Cutting outline(s) of a shape scaled into a w x h box centred on 0,0 (cm). The outer ring of each
 * SVG subpath group is used (holes, like the middle of a ring, are not cut). 'text' gives one ring per
 * letter, laid out in a row that fills the box (block capitals A-Z, 0-9; other characters leave a gap).
 */
export function shapePolygon(shape: ShapeId, w: number, h: number, text?: string): P2[][] {
  if (shape === 'text') {
    const chars = [...(text ?? '').trim()];
    if (!chars.length) return [];
    const adv = GLYPH_W + GLYPH_GAP, W = chars.length * adv - GLYPH_GAP;
    const sx = w / W, sy = h / GLYPH_H;
    const out: P2[][] = [];
    chars.forEach((ch, k) => {
      const g = glyphOutline(ch);
      if (g) out.push(g.map((q) => ({ x: -w / 2 + (k * adv + q.x) * sx, y: -h / 2 + q.y * sy })));
    });
    return out;
  }
  const d = SHAPES[shape]?.d;
  if (!d) return [];
  const rings = pathRings(d);
  if (!rings.length) return [];
  const outer = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
  return [outer.map((q) => ({ x: q.x * w, y: q.y * h }))];
}

/**
 * Cutting outline of an SVG path drawn in the unit box (-0.5..0.5, evenodd), scaled into a w x h box centred on 0,0 (cm).
 * Used for patch bases made from a pen shape or a picture's silhouette. Holes are not cut.
 */
export function pathPolygon(d: string, w: number, h: number): P2[] {
  const rings = pathRings(d);
  if (!rings.length) return [];
  const outer = rings.reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a)) ? b : a));
  return outer.map((q) => ({ x: q.x * w, y: q.y * h }));
}

/**
 * Cloth outline(s) of an attachment, centred on 0,0 in its own coords (cm): an applique (or outline 'shape')
 * is cut to its shape, one piece per letter for text; everything else is one outline.
 */
export function attachmentPolygons(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text'>): P2[][] {
  if (a.outline === 'shape' || (a.kind === 'applique' && a.shape)) {
    const rings = shapePolygon(a.shape ?? 'rect', a.w, a.h, a.text);
    if (rings.length) return rings;
  }
  return [outlinePolygon(a.outline === 'shape' ? 'rect' : a.outline, a.w, a.h, a.points)];
}
