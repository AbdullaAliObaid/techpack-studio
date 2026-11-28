// Letter outlines from the real font. The Design canvas, the 3D print pass and the chart all draw text with the layer's
// font; a text patch or applique has to be CUT to the same letters, counters (the holes in B, a, e, d, o) included.
//
//   traceTextUnit(text, font)  renders the text with its canvas font, traces the ink edge (marching squares, sub-pixel),
//                              simplifies it, and returns closed rings in the text's unit box: x = -0.5..0.5 across the
//                              advance width, y in em units (1 = the font height), y down, centred like drawText.
//                              Multiply by the layer's w and h to get cm: the Design canvas sets text to exactly w wide
//                              and h tall, and the unit rings scale the same way.
//   Orientation: outer rings have a positive shoelace area, holes a negative one.
//   groupShapes(rings)         pairs each hole with the outer ring that contains it.
//
// Works on the main thread and in the worker (OffscreenCanvas); with no canvas at all it returns null and callers fall
// back to the block letters of src/lib/shapes.ts. The traced rings are also stored on the attachment (outlineRings), so
// the worker normally only reads geometry.

import { centralShift, cleanText, fontCss } from './fonts';

export interface P2 { x: number; y: number }
export interface TextShape { outer: P2[]; holes: P2[][] }

export const ringArea = (r: P2[]) => { let s = 0; for (let i = 0; i < r.length; i++) { const q = r[(i + 1) % r.length]; s += r[i].x * q.y - q.x * r[i].y; } return s / 2; };

/** cache key of a text and font: the traced rings depend on nothing else */
export const textKey = (text: string | undefined, font: string | undefined) => `${font ?? ''}|${cleanText(text)}`;

/* ---------- marching squares on a coverage grid ---------- */

/**
 * Closed contours of `cov` (W x H values 0..1, row-major) at level 0.5, in grid units (pixel centres at i + 0.5).
 * Ink is on the left of each loop (y down). The grid must have a zero border so every loop closes.
 */
export function traceMask(cov: ArrayLike<number>, W: number, H: number): P2[][] {
  const v = (x: number, y: number) => cov[y * W + x];
  // directed segment: start edge id -> end edge id. Edge ids: horizontal edge at (x,y) = 2(yW+x), vertical = 2(yW+x)+1
  const next = new Map<number, number>();
  const hE = (x: number, y: number) => 2 * (y * W + x), vE = (x: number, y: number) => 2 * (y * W + x) + 1;
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const tl = v(x, y) >= 0.5, tr = v(x + 1, y) >= 0.5, br = v(x + 1, y + 1) >= 0.5, bl = v(x, y + 1) >= 0.5;
    const c = (tl ? 1 : 0) | (tr ? 2 : 0) | (br ? 4 : 0) | (bl ? 8 : 0);
    if (c === 0 || c === 15) continue;
    const T = hE(x, y), B = hE(x, y + 1), L = vE(x, y), R = vE(x + 1, y);
    const seg = (a: number, b: number) => next.set(a, b);
    switch (c) {
      case 1: seg(L, T); break;
      case 2: seg(T, R); break;
      case 4: seg(R, B); break;
      case 8: seg(B, L); break;
      case 3: seg(L, R); break;
      case 6: seg(T, B); break;
      case 12: seg(R, L); break;
      case 9: seg(B, T); break;
      case 14: seg(T, L); break;
      case 13: seg(R, T); break;
      case 11: seg(B, R); break;
      case 7: seg(L, B); break;
      case 5: { const mid = (v(x, y) + v(x + 1, y) + v(x, y + 1) + v(x + 1, y + 1)) / 4 >= 0.5; if (mid) { seg(R, T); seg(L, B); } else { seg(L, T); seg(R, B); } break; }
      case 10: { const mid = (v(x, y) + v(x + 1, y) + v(x, y + 1) + v(x + 1, y + 1)) / 4 >= 0.5; if (mid) { seg(T, L); seg(B, R); } else { seg(T, R); seg(B, L); } break; }
    }
  }
  const pt = (e: number): P2 => {
    const horiz = e % 2 === 0, i = e >> 1, x = i % W, y = (i - x) / W;
    if (horiz) { const a = v(x, y), b = v(x + 1, y); return { x: x + 0.5 + (0.5 - a) / ((b - a) || 1), y: y + 0.5 }; }
    const a = v(x, y), b = v(x, y + 1);
    return { x: x + 0.5, y: y + 0.5 + (0.5 - a) / ((b - a) || 1) };
  };
  const out: P2[][] = [];
  while (next.size) {
    const start = next.keys().next().value as number;
    const ring: P2[] = [];
    let e = start;
    for (;;) {
      ring.push(pt(e));
      const n = next.get(e);
      next.delete(e);
      if (n === undefined) break;
      e = n;
      if (e === start) break;
    }
    if (ring.length >= 3) out.push(ring);
  }
  return out;
}

/** Douglas-Peucker for a closed ring: split at the two farthest apart points, simplify both halves */
export function simplifyRing(r: P2[], tol: number): P2[] {
  if (r.length <= 4) return r;
  const dseg = (p: P2, a: P2, b: P2) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const keep = new Uint8Array(r.length);
  const run = (i0: number, i1: number) => { // keep points between i0 and i1 (indices into the doubled ring)
    const stack: [number, number][] = [[i0, i1]];
    while (stack.length) {
      const [a, b] = stack.pop()!;
      let best = -1, bi = -1;
      for (let i = a + 1; i < b; i++) { const d = dseg(r[i % r.length], r[a % r.length], r[b % r.length]); if (d > best) { best = d; bi = i; } }
      if (best > tol && bi >= 0) { keep[bi % r.length] = 1; stack.push([a, bi], [bi, b]); }
    }
  };
  let i0 = 0, i1 = 0, far = -1;
  for (let i = 1; i < r.length; i++) { const d = Math.hypot(r[i].x - r[0].x, r[i].y - r[0].y); if (d > far) { far = d; i1 = i; } }
  keep[i0] = 1; keep[i1] = 1;
  run(i0, i1); run(i1, i0 + r.length);
  const out = r.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : r;
}

/** Orient (outer positive, holes negative), drop specks and simplify. `minArea` and `tol` in the rings' own units. */
export function cleanRings(rings: P2[][], minArea: number, tol: number): P2[][] {
  const areas = rings.map(ringArea);
  let big = 0;
  areas.forEach((a, i) => { if (Math.abs(a) > Math.abs(areas[big])) big = i; });
  const outerSign = Math.sign(areas[big] || 1);
  const out: P2[][] = [];
  rings.forEach((r, i) => {
    if (Math.abs(areas[i]) < minArea) return;
    const isOuter = Math.sign(areas[i]) === outerSign;
    const s = simplifyRing(r, tol);
    const a = ringArea(s);
    const want = isOuter ? 1 : -1;
    out.push(Math.sign(a) === want ? s : s.slice().reverse());
  });
  return out;
}

const inRing = (r: P2[], p: P2) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i].y > p.y) !== (r[j].y > p.y) && p.x < ((r[j].x - r[i].x) * (p.y - r[i].y)) / (r[j].y - r[i].y) + r[i].x) c = !c;
  return c;
};

/** Pair holes (negative rings) with the smallest outer ring (positive) that contains them. */
export function groupShapes(rings: P2[][]): TextShape[] {
  const shapes: (TextShape & { a: number })[] = rings.filter((r) => ringArea(r) > 0).map((outer) => ({ outer, holes: [], a: ringArea(outer) }));
  for (const h of rings) {
    if (ringArea(h) >= 0) continue;
    let best: (typeof shapes)[number] | null = null;
    for (const s of shapes) if (inRing(s.outer, h[0]) && (!best || s.a < best.a)) best = s;
    best?.holes.push(h);
  }
  return shapes.map(({ outer, holes }) => ({ outer, holes }));
}

/* ---------- the text itself ---------- */

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
function makeCanvas(w: number, h: number): { ctx: Ctx } | null {
  try {
    if (typeof OffscreenCanvas !== 'undefined') { const c = new OffscreenCanvas(w, h); const ctx = c.getContext('2d', { willReadFrequently: true }); return ctx ? { ctx } : null; }
    if (typeof document !== 'undefined') { const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d', { willReadFrequently: true }); return ctx ? { ctx } : null; }
  } catch { /* no canvas here */ }
  return null;
}

const cache = new Map<string, P2[][] | null>();

/** Traced letter rings in the unit box (see the top of the file), or null when there is no canvas to draw on. Cached. */
export function traceTextUnit(text: string | undefined, font: string | undefined): P2[][] | null {
  const t = cleanText(text);
  if (!t) return [];
  const key = textKey(t, font);
  if (cache.has(key)) { const v = cache.get(key)!; cache.delete(key); cache.set(key, v); return v; }
  let rings: P2[][] | null = null;
  const probe = makeCanvas(8, 8);
  if (probe) {
    probe.ctx.font = fontCss(font, 100);
    const w100 = probe.ctx.measureText(t).width;
    // em size in px: 160 for short text, smaller so the canvas stays under about 4000 px wide
    const S = Math.max(40, Math.min(160, Math.floor((3800 / Math.max(1, w100 / 100 + 1)) * 0.9)));
    probe.ctx.font = fontCss(font, S);
    const mw = probe.ctx.measureText(t).width;
    const padX = Math.ceil(S * 0.6), W = Math.ceil(mw) + 2 * padX, H = Math.ceil(S * 2.6);
    const cv = makeCanvas(W, H);
    if (cv && mw > 0) {
      const { ctx } = cv;
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#000';
      ctx.font = fontCss(font, S);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(t, W / 2, H / 2 + centralShift(ctx, S));
      const px = ctx.getImageData(0, 0, W, H).data;
      const cov = new Float32Array(W * H);
      for (let i = 0; i < cov.length; i++) cov[i] = px[i * 4 + 3] / 255;
      // zero border so loops close
      for (let x = 0; x < W; x++) { cov[x] = 0; cov[(H - 1) * W + x] = 0; }
      for (let y = 0; y < H; y++) { cov[y * W] = 0; cov[y * W + W - 1] = 0; }
      const raw = traceMask(cov, W, H).map((r) => r.map((q) => ({ x: (q.x - W / 2) / mw, y: (q.y - H / 2) / S })));
      // simplify to about 0.005 em (0.3 mm on 6 cm letters), drop specks under 0.0001 em squared
      rings = raw.length ? cleanRings(raw, 1e-4, 0.005) : [];
    }
  }
  cache.set(key, rings);
  if (cache.size > 64) cache.delete(cache.keys().next().value!);
  return rings;
}

/** Unit rings scaled to a w x h cm box centred on 0,0. */
export const scaleRings = (rings: P2[][], w: number, h: number): P2[][] => rings.map((r) => r.map((q) => ({ x: q.x * w, y: q.y * h })));
