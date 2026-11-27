// Photo to design: turn a picture into clean vector shapes that can be embroidered, cut as applique or printed.
// Dependency free and DOM free: works on anything shaped like ImageData (the browser's canvas getImageData, or a
// plain { width, height, data } in tests and workers).
//
// Pipeline:  prepareImage (downscale) -> removeBackground (flood fill from the borders) -> posterize (k-means in Lab)
//            -> traceToPaths (marching squares, Douglas-Peucker, smoothing) -> toLayers (ShapeLayer 'path', one per colour)
// Paths are in the unit box -0.5..0.5 (the longer side of the picture spans the box, aspect kept), fill rule evenodd,
// so holes (the middle of an O, a ring) come out right. Give a layer equal w and h to keep the proportions.

import type { ShapeLayer } from '../data/edits';
import { uid } from './units';

export interface ImageLike { width: number; height: number; data: Uint8ClampedArray }

/** How many colours each way of making a design can carry. */
export const COLOR_LIMITS = {
  /** each colour is a thread change on the machine; most heads carry 12 needles at most */
  embroidery: 12,
  /** each colour is a separately cut piece of fabric */
  applique: 6,
  /** a traced vector print (screen print: one screen per colour) */
  print: 16,
} as const;
export type DesignKind = keyof typeof COLOR_LIMITS;

export function traceGuidance(kind: DesignKind, nColors: number): { max: number; ok: boolean; message: string } {
  const max = COLOR_LIMITS[kind];
  const ok = nColors <= max;
  const what = kind === 'embroidery' ? 'thread colours' : kind === 'applique' ? 'fabric pieces' : 'print colours';
  const message = ok
    ? `${nColors} ${what}. ${kind === 'embroidery' ? 'Fewer colours sew faster and cleaner.' : kind === 'applique' ? 'Small shapes under 1 cm are hard to cut and sew.' : 'Each colour is one screen.'}`
    : `${nColors} colours is more than ${kind} can carry (up to ${max} ${what}). Reduce the colours to ${max} or fewer.`;
  return { max, ok, message };
}

// ---------------------------------------------------------------- image prep

const blank = (w: number, h: number): ImageLike => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });

/** Downscale so the longer side is at most maxSide (area average, alpha weighted so edges do not get dark fringes). */
export function prepareImage(img: ImageLike, maxSide = 1024): ImageLike {
  const { width: W, height: H, data } = img;
  const k = Math.min(1, maxSide / Math.max(W, H));
  if (k >= 1) return { width: W, height: H, data: new Uint8ClampedArray(data) };
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * H) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * W) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4, al = data[i + 3];
        r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; n++;
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out.data[o] = r / a; out.data[o + 1] = g / a; out.data[o + 2] = b / a; }
      out.data[o + 3] = a / n;
    }
  }
  return out;
}

// ---------------------------------------------------------------- colour

type Lab = [number, number, number];
const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = Array.from({ length: 256 }, (_, i) => lin(i));
function toLab(r: number, g: number, b: number): Lab {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, Y = 0.2126 * R + 0.7152 * G + 0.0722 * B, Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const fn = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = fn(X), fy = fn(Y), fz = fn(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function toRgb([L, a, b]: Lab): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  const X = inv(fx) * 0.95047, Y = inv(fy), Z = inv(fz) * 1.08883;
  const R = 3.2406 * X - 1.5372 * Y - 0.4986 * Z, G = -0.9689 * X + 1.8758 * Y + 0.0415 * Z, B = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const g = (c: number) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
  return [g(R), g(G), g(B)];
}
const d2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
const hex = ([r, g, b]: [number, number, number]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Make the background transparent: the most common border colour is taken as the background, and everything
 * connected to the border within `tolerance` (CIE Lab distance, about 2 = just noticeable) of it is cleared.
 * Shapes of the same colour that do not touch the background (the inside of a ring) are kept.
 */
export function removeBackground(img: ImageLike, tolerance = 20): ImageLike {
  const { width: w, height: h } = img;
  const out: ImageLike = { width: w, height: h, data: new Uint8ClampedArray(img.data) };
  const D = out.data;
  const lab = (i: number) => toLab(D[i * 4], D[i * 4 + 1], D[i * 4 + 2]);
  // most common border colour (coarse bins), then the mean of that bin
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1);
  const bins = new Map<number, number[]>();
  for (const i of border) {
    if (D[i * 4 + 3] < 16) continue;
    const k = ((D[i * 4] >> 4) << 8) | ((D[i * 4 + 1] >> 4) << 4) | (D[i * 4 + 2] >> 4);
    (bins.get(k) ?? bins.set(k, []).get(k)!).push(i);
  }
  let best: number[] = [];
  for (const v of bins.values()) if (v.length > best.length) best = v;
  if (!best.length) return out; // border already transparent
  const ref: Lab = [0, 0, 0];
  for (const i of best) { const l = lab(i); ref[0] += l[0] / best.length; ref[1] += l[1] / best.length; ref[2] += l[2] / best.length; }
  const tol2 = tolerance * tolerance;
  const isBg = (i: number) => D[i * 4 + 3] < 16 || d2(lab(i), ref) <= tol2;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const i of border) if (!seen[i] && isBg(i)) { seen[i] = 1; stack.push(i); }
  while (stack.length) {
    const i = stack.pop()!;
    D[i * 4 + 3] = 0;
    const x = i % w, y = (i - x) / w;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const j of nb) if (j >= 0 && !seen[j]) { seen[j] = 1; if (isBg(j)) stack.push(j); }
  }
  return out;
}

export interface Posterized {
  /** colours as CSS hex, most used first */
  palette: string[];
  /** per pixel palette index, -1 = transparent */
  index: Int16Array;
  /** pixels per palette colour */
  counts: number[];
  width: number;
  height: number;
}

/** Reduce to at most nColors flat colours (k-means++ in Lab, seeded so the same picture gives the same result). */
export function posterize(img: ImageLike, nColors: number): Posterized {
  const { width: w, height: h, data: D } = img;
  const N = w * h;
  const opaque: number[] = [];
  for (let i = 0; i < N; i++) if (D[i * 4 + 3] >= 128) opaque.push(i);
  const index = new Int16Array(N).fill(-1);
  if (!opaque.length || nColors < 1) return { palette: [], index, counts: [], width: w, height: h };
  const labs = new Float32Array(N * 3);
  for (const i of opaque) { const l = toLab(D[i * 4], D[i * 4 + 1], D[i * 4 + 2]); labs[i * 3] = l[0]; labs[i * 3 + 1] = l[1]; labs[i * 3 + 2] = l[2]; }
  const L = (i: number): Lab => [labs[i * 3], labs[i * 3 + 1], labs[i * 3 + 2]];
  // sample for fitting
  const step = Math.max(1, Math.floor(opaque.length / 40000));
  const sample = opaque.filter((_, k) => k % step === 0).map(L);
  let seed = 0x9e3779b9;
  const rnd = () => { seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; return seed / 4294967296; };
  // k-means++ seeding
  const cents: Lab[] = [sample[Math.floor(rnd() * sample.length)]];
  const dist = sample.map((p) => d2(p, cents[0]));
  while (cents.length < nColors) {
    const tot = dist.reduce((a, b) => a + b, 0);
    if (tot <= 1e-9) break; // fewer distinct colours than asked
    let r = rnd() * tot, k = 0;
    while (k < dist.length - 1 && (r -= dist[k]) > 0) k++;
    cents.push(sample[k]);
    for (let i = 0; i < sample.length; i++) dist[i] = Math.min(dist[i], d2(sample[i], sample[k]));
  }
  const nearest = (p: Lab) => { let bi = 0, bd = Infinity; for (let c = 0; c < cents.length; c++) { const d = d2(p, cents[c]); if (d < bd) { bd = d; bi = c; } } return bi; };
  for (let it = 0; it < 16; it++) {
    const acc = cents.map(() => [0, 0, 0, 0]);
    for (const p of sample) { const a = acc[nearest(p)]; a[0] += p[0]; a[1] += p[1]; a[2] += p[2]; a[3]++; }
    let moved = 0;
    acc.forEach((a, c) => { if (!a[3]) return; const n: Lab = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; moved = Math.max(moved, d2(n, cents[c])); cents[c] = n; });
    if (moved < 0.01) break;
  }
  // merge near identical centres (just noticeable difference)
  for (let a = 0; a < cents.length; a++) for (let b = cents.length - 1; b > a; b--) if (d2(cents[a], cents[b]) < 4) cents.splice(b, 1);
  const raw = new Int16Array(N).fill(-1);
  const counts = cents.map(() => 0);
  for (const i of opaque) { const c = nearest(L(i)); raw[i] = c; counts[c]++; }
  // most used first, drop empty
  const order = counts.map((n, c) => [n, c]).filter(([n]) => n > 0).sort((p, q) => q[0] - p[0]).map(([, c]) => c);
  const remap = new Int16Array(cents.length).fill(-1);
  order.forEach((c, k) => (remap[c] = k));
  for (let i = 0; i < N; i++) if (raw[i] >= 0) index[i] = remap[raw[i]];
  return { palette: order.map((c) => hex(toRgb(cents[c]))), index, counts: order.map((c) => counts[c]), width: w, height: h };
}

// ---------------------------------------------------------------- tracing

type P = [number, number];

/** Closed Douglas-Peucker: keeps the outline within eps pixels. */
function simplifyClosed(pts: P[], eps: number): P[] {
  if (pts.length < 5 || eps <= 0) return pts;
  const segDist = (p: P, a: P, b: P) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const dp = (seq: P[]): P[] => {
    const keep = new Uint8Array(seq.length); keep[0] = keep[seq.length - 1] = 1;
    const st: [number, number][] = [[0, seq.length - 1]];
    while (st.length) {
      const [a, b] = st.pop()!;
      let md = 0, mi = -1;
      for (let i = a + 1; i < b; i++) { const d = segDist(seq[i], seq[a], seq[b]); if (d > md) { md = d; mi = i; } }
      if (mi >= 0 && md > eps) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
    }
    return seq.filter((_, i) => keep[i]);
  };
  // split at the point farthest from the first one
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length; i++) { const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = dp(pts.slice(0, far + 1)), b = dp([...pts.slice(far), pts[0]]);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

const area = (pts: P[]) => { let s = 0; for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; s += p[0] * q[1] - q[0] * p[1]; } return s / 2; };

/**
 * Outlines of a binary mask by marching squares on the pixel centres. Loops are oriented consistently (inside on
 * the right in y down coordinates), so outer outlines and holes have opposite signed areas. Diagonal touches are
 * kept apart (4 connected).
 */
export function contours(mask: Uint8Array, w: number, h: number): P[][] {
  const GW = w + 2, GH = h + 2;
  const s = (i: number, j: number) => (i >= 1 && j >= 1 && i <= w && j <= h ? mask[(j - 1) * w + (i - 1)] : 0);
  const Hk = (i: number, j: number) => (j * GW + i) * 2; // edge (i,j)-(i+1,j)
  const Vk = (i: number, j: number) => (j * GW + i) * 2 + 1; // edge (i,j)-(i,j+1)
  const kp = (k: number): P => { const v = k & 1, c = k >> 1, i = c % GW, j = (c - i) / GW; return v ? [i - 0.5, j] : [i, j - 0.5]; }; // pixel coords
  const next = new Map<number, number>();
  for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
    const tl = s(i, j), tr = s(i + 1, j), br = s(i + 1, j + 1), bl = s(i, j + 1);
    const cs = tl * 8 + tr * 4 + br * 2 + bl;
    if (cs === 0 || cs === 15) continue;
    const T = Hk(i, j), B = Hk(i, j + 1), Lf = Vk(i, j), R = Vk(i + 1, j);
    // corner positions in the same pixel coords as kp
    const C = { tl: [i - 0.5, j - 0.5], tr: [i + 0.5, j - 0.5], br: [i + 0.5, j + 0.5], bl: [i - 0.5, j + 0.5] } as Record<string, P>;
    const val: Record<string, number> = { tl, tr, br, bl };
    const shared: Record<string, string> = { [`${T},${R}`]: 'tr', [`${R},${B}`]: 'br', [`${B},${Lf}`]: 'bl', [`${Lf},${T}`]: 'tl' };
    const segs: [number, number][] = {
      1: [[Lf, B]], 2: [[B, R]], 3: [[Lf, R]], 4: [[T, R]], 5: [[T, R], [Lf, B]], 6: [[T, B]], 7: [[T, Lf]], 8: [[T, Lf]],
      9: [[T, B]], 10: [[T, Lf], [R, B]], 11: [[T, R]], 12: [[Lf, R]], 13: [[R, B]], 14: [[Lf, B]],
    }[cs] as [number, number][];
    for (let [a, b] of segs) {
      const corner = shared[`${a},${b}`] ?? shared[`${b},${a}`] ?? 'tl';
      const pa = kp(a), pb = kp(b), q = C[corner];
      const cross = (pb[0] - pa[0]) * (q[1] - pa[1]) - (pb[1] - pa[1]) * (q[0] - pa[0]);
      if ((val[corner] ? cross < 0 : cross > 0)) [a, b] = [b, a];
      next.set(a, b);
    }
  }
  const loops: P[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: P[] = [];
    let k = start;
    while (!done.has(k) && next.has(k)) { done.add(k); loop.push(kp(k)); k = next.get(k)!; }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

export interface TracedPath {
  color: string;
  /** SVG path data in the unit box -0.5..0.5, fill rule evenodd */
  path: string;
  /** filled area as a fraction of the unit box */
  area: number;
}

export interface TraceOptions {
  /** Douglas-Peucker tolerance in pixels (default 0.8) */
  simplify?: number;
  /** drop outlines (and holes) smaller than this fraction of the picture area (default 0.0004) */
  minArea?: number;
  /** round the corners with quadratic curves (default true) */
  smooth?: boolean;
}

/** One SVG path per palette colour (holes included, fill rule evenodd), most used colour first. */
export function traceToPaths(indexMap: Int16Array, w: number, h: number, palette: string[], opts: TraceOptions = {}): TracedPath[] {
  const eps = opts.simplify ?? 0.8, minA = (opts.minArea ?? 0.0004) * w * h, smooth = opts.smooth ?? true;
  const k = 1 / Math.max(w, h);
  const X = (x: number) => (Math.round((x - w / 2) * k * 10000) / 10000).toString();
  const Y = (y: number) => (Math.round((y - h / 2) * k * 10000) / 10000).toString();
  const out: TracedPath[] = [];
  const mask = new Uint8Array(w * h);
  palette.forEach((color, c) => {
    for (let i = 0; i < w * h; i++) mask[i] = indexMap[i] === c ? 1 : 0;
    let d = '', tot = 0;
    for (const raw of contours(mask, w, h)) {
      if (Math.abs(area(raw)) < minA) continue;
      const pts = simplifyClosed(raw, eps);
      if (pts.length < 3) continue;
      tot += area(pts);
      if (!smooth) { d += 'M' + pts.map(([x, y]) => `${X(x)} ${Y(y)}`).join('L') + 'Z'; continue; }
      const n = pts.length, m = (i: number): P => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2];
      d += `M${X(m(0)[0])} ${Y(m(0)[1])}`;
      for (let i = 1; i <= n; i++) {
        // round gentle bends, keep real corners (a turn sharper than about 55 degrees) crisp
        const a = pts[(i - 1) % n], q = pts[i % n], b = pts[(i + 1) % n], e = m(i);
        const u = [q[0] - a[0], q[1] - a[1]], v = [b[0] - q[0], b[1] - q[1]];
        const cos = (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1);
        d += cos < 0.57 ? `L${X(q[0])} ${Y(q[1])}L${X(e[0])} ${Y(e[1])}` : `Q${X(q[0])} ${Y(q[1])} ${X(e[0])} ${Y(e[1])}`;
      }
      d += 'Z';
    }
    if (d) out.push({ color, path: d, area: Math.abs(tot) * k * k });
  });
  return out;
}

export interface LayerOptions {
  /** size of the design box (cm); the longer side of the picture spans it */
  size: number;
  kind?: DesignKind;
  /** centre relative to the attachment centre (cm) */
  x?: number;
  y?: number;
}

/**
 * Traced paths as emblem layers (shape 'path'), bottom layer first. Colours past the kind's limit (embroidery: 12
 * threads) are dropped, smallest first; check traceGuidance() before to tell the user.
 */
export function toLayers(paths: TracedPath[], opts: LayerOptions): ShapeLayer[] {
  const max = COLOR_LIMITS[opts.kind ?? 'embroidery'];
  const keep = [...paths].sort((a, b) => b.area - a.area).slice(0, max);
  return keep.map((p) => ({ id: uid(), shape: 'path' as const, x: opts.x ?? 0, y: opts.y ?? 0, w: opts.size, h: opts.size, rotation: 0, color: p.color, path: p.path }));
}

/** The whole pipeline in one call, colours clamped to what the kind can carry. */
export function photoToLayers(img: ImageLike, opts: LayerOptions & { colors?: number; removeBg?: boolean; tolerance?: number } & TraceOptions) {
  const kind = opts.kind ?? 'embroidery';
  let im = prepareImage(img, 512);
  if (opts.removeBg ?? true) im = removeBackground(im, opts.tolerance ?? 20);
  const n = Math.min(opts.colors ?? 6, COLOR_LIMITS[kind]);
  const post = posterize(im, n);
  const paths = traceToPaths(post.index, post.width, post.height, post.palette, opts);
  return { layers: toLayers(paths, { ...opts, kind }), palette: post.palette, guidance: traceGuidance(kind, paths.length) };
}
