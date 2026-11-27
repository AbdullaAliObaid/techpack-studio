// Recognise and lift a motif from an uploaded picture. Dependency free and DOM free: works on anything shaped like
// ImageData (the browser's getImageData, or a plain { width, height, data } in tests and workers).
//
//   detectRepeat(img)      is the upload already a repeating pattern? finds the repeat cell (2D autocorrelation on a
//                          small copy, then refined on a bigger one) and how rows or columns are shifted
//   extractMotif(img, o)   one motif as a transparent PNG (data URL, at most 1024 px) plus traced vector paths
//   suggestLayout(motif)   which repeat suits the motif (symmetric -> half-drop, directional -> block)
//   encodePng(img)         RGBA to a PNG data URL without a canvas
//
// Paths follow src/lib/trace.ts: unit box -0.5..0.5, the longer side spans the box, fill rule evenodd.

import type { PatternMotif, RepeatLayout } from '../data/fabrics';
import { posterize, prepareImage, removeBackground, traceToPaths, type ImageLike } from './trace';

// ---------------------------------------------------------------- planes

/** Area average of one colour channel (alpha composited over white) to at most maxSide px. */
function planes(img: ImageLike, maxSide: number, channels: 1 | 3): { w: number; h: number; sx: number; sy: number; p: Float32Array[] } {
  const { width: W, height: H, data } = img;
  const k = Math.min(1, maxSide / Math.max(W, H));
  const w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const p = Array.from({ length: channels }, () => new Float32Array(w * h));
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * H) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * W) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W) / w));
      const acc = [0, 0, 0];
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * W + xx) * 4, a = data[i + 3] / 255, w1 = 255 * (1 - a);
        acc[0] += data[i] * a + w1; acc[1] += data[i + 1] * a + w1; acc[2] += data[i + 2] * a + w1;
      }
      const n = (y1 - y0) * (x1 - x0);
      if (channels === 3) { for (let c = 0; c < 3; c++) p[c][y * w + x] = acc[c] / n; }
      else p[0][y * w + x] = (0.299 * acc[0] + 0.587 * acc[1] + 0.114 * acc[2]) / n;
    }
  }
  return { w, h, sx: w / W, sy: h / H, p };
}

// ---------------------------------------------------------------- FFT

function fft1(re: Float64Array, im: Float64Array, n: number, inv: boolean) {
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j, b = a + half;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
  if (inv) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function fft2(re: Float64Array, im: Float64Array, PW: number, PH: number, inv: boolean) {
  const rr = new Float64Array(PW), ri = new Float64Array(PW);
  for (let y = 0; y < PH; y++) {
    rr.set(re.subarray(y * PW, y * PW + PW)); ri.set(im.subarray(y * PW, y * PW + PW));
    fft1(rr, ri, PW, inv);
    re.set(rr, y * PW); im.set(ri, y * PW);
  }
  const cr = new Float64Array(PH), ci = new Float64Array(PH);
  for (let x = 0; x < PW; x++) {
    for (let y = 0; y < PH; y++) { cr[y] = re[y * PW + x]; ci[y] = im[y * PW + x]; }
    fft1(cr, ci, PH, inv);
    for (let y = 0; y < PH; y++) { re[y * PW + x] = cr[y]; im[y * PW + x] = ci[y]; }
  }
}

const pow2 = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

// ---------------------------------------------------------------- detectRepeat

export interface RepeatInfo {
  /** the upload is a repeating pattern */
  found: boolean;
  /** one cell of the repeat in source pixels (the motif's cell: half a rectangle for half-drop and brick) */
  w: number;
  h: number;
  /** 0..1, how well the picture matches itself shifted by one repeat */
  confidence: number;
  /** how the next column / row is shifted, source pixels: half-drop drops each odd column y = h / 2, brick shifts each odd row x = w / 2 */
  offset: { x: number; y: number };
  layout: 'block' | 'half-drop' | 'brick';
  /** the smallest rectangle of the picture that repeats by plain translation (source px) */
  tile: { w: number; h: number };
}

const NOT_FOUND: RepeatInfo = { found: false, w: 0, h: 0, confidence: 0, offset: { x: 0, y: 0 }, layout: 'block', tile: { w: 0, h: 0 } };

/** Pearson correlation of a plane with itself shifted by (dx, dy), on a sparse grid of samples. */
function ncc(P: Float32Array, w: number, h: number, dx: number, dy: number, step: number): number {
  let n = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  const x0 = Math.max(0, -dx), x1 = Math.min(w, w - dx), y0 = Math.max(0, -dy), y1 = Math.min(h, h - dy);
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) {
    const a = P[y * w + x], b = P[(y + dy) * w + x + dx];
    n++; sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
  }
  if (n < 16) return 0;
  const va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
  if (va < 1e-6 || vb < 1e-6) return 0;
  return (sab / n - (sa / n) * (sb / n)) / Math.sqrt(va * vb);
}

/** Best shift near `guess` along one axis (the other shift is 0), with a parabola for the sub pixel part. */
function refineShift(P: Float32Array, w: number, h: number, guess: number, radius: number, vertical: boolean): { shift: number; ncc: number } {
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  const lim = (vertical ? h : w) - 8;
  const lo = Math.max(4, Math.round(guess) - radius), hi = Math.min(lim, Math.round(guess) + radius);
  const at = (s: number) => (vertical ? ncc(P, w, h, 0, s, step) : ncc(P, w, h, s, 0, step));
  let best = lo, bv = -2;
  const vals = new Map<number, number>();
  for (let s = lo; s <= hi; s++) { const v = at(s); vals.set(s, v); if (v > bv) { bv = v; best = s; } }
  const m = vals.get(best - 1), p = vals.get(best + 1);
  let shift = best;
  if (m !== undefined && p !== undefined) {
    const d = m - 2 * bv + p;
    if (d < -1e-9) shift = best + Math.max(-1, Math.min(1, (0.5 * (m - p)) / d));
  }
  return { shift, ncc: bv };
}

/**
 * Find out whether a picture is already a repeating pattern. Works on the 2D autocorrelation of a copy with at most
 * 128 px on the long side; lattice vectors are the strong peaks, the repeat rectangle is built from them and then
 * measured again on a bigger copy, so the cell comes out within a pixel or two of the true size.
 */
export function detectRepeat(img: ImageLike): RepeatInfo {
  const small = planes(img, 128, 3);
  const { w, h } = small;
  if (w < 16 || h < 16) return NOT_FOUND;
  const PW = pow2(2 * w), PH = pow2(2 * h);
  const pw = new Float64Array(PW * PH);
  let var0 = 0;
  for (const P of small.p) {
    let mean = 0;
    for (let i = 0; i < P.length; i++) mean += P[i];
    mean /= P.length;
    const re = new Float64Array(PW * PH), im = new Float64Array(PW * PH);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = P[y * w + x] - mean; re[y * PW + x] = v; var0 += v * v; }
    fft2(re, im, PW, PH, false);
    for (let i = 0; i < pw.length; i++) pw[i] += re[i] * re[i] + im[i] * im[i];
  }
  if (var0 / (w * h) < 4) return NOT_FOUND; // nearly one flat colour
  const ac = new Float64Array(PW * PH), zero = new Float64Array(PW * PH);
  ac.set(pw);
  fft2(ac, zero, PW, PH, true);
  const mx = Math.floor(0.6 * w), my = Math.floor(0.6 * h), GW = 2 * mx + 1, GH = 2 * my + 1;
  const R = new Float32Array(GW * GH);
  const norm = var0 / (w * h);
  for (let dy = -my; dy <= my; dy++) for (let dx = -mx; dx <= mx; dx++) {
    const v = ac[((dy + PH) % PH) * PW + ((dx + PW) % PW)] / ((w - Math.abs(dx)) * (h - Math.abs(dy))) / norm;
    R[(dy + my) * GW + dx + mx] = v;
  }
  const g = (dx: number, dy: number) => R[(dy + my) * GW + dx + mx];

  // peaks: local maxima that stand out from the valley between them and the origin
  interface Peak { dx: number; dy: number; v: number; len: number }
  const peaks: Peak[] = [];
  for (let dy = -my + 1; dy < my; dy++) for (let dx = -mx + 1; dx < mx; dx++) {
    const v = g(dx, dy);
    if (v < 0.3 || Math.hypot(dx, dy) < 3) continue;
    let isMax = true;
    for (let j = -1; j <= 1 && isMax; j++) for (let i = -1; i <= 1; i++) if ((i || j) && g(dx + i, dy + j) > v) { isMax = false; break; }
    if (!isMax) continue;
    let low = Infinity;
    for (let t = 0.2; t <= 0.81; t += 0.05) low = Math.min(low, g(Math.round(dx * t), Math.round(dy * t)));
    if (v - low < 0.15) continue;
    // sub pixel position by a parabola in each axis
    const px = (a: number, b: number, c: number) => { const d = a - 2 * b + c; return d < -1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0; };
    const fx = dx + px(g(dx - 1, dy), v, g(dx + 1, dy)), fy = dy + px(g(dx, dy - 1), v, g(dx, dy + 1));
    peaks.push({ dx: fx, dy: fy, v, len: Math.hypot(fx, fy) });
  }
  const top = peaks.reduce((m, p) => Math.max(m, p.v), 0);
  const strong = peaks.filter((p) => p.v >= Math.max(0.3, 0.6 * top) && (p.dy > 0 || (Math.abs(p.dy) < 1e-9 && p.dx > 0))).sort((a, b) => a.len - b.len);
  if (!strong.length) return NOT_FOUND;
  const u = strong[0];
  const v = strong.find((p) => Math.abs(u.dx * p.dy - u.dy * p.dx) >= 0.25 * u.len * p.len);

  // the repeat rectangle from combinations of the lattice vectors
  const tol = 0.03 * Math.max(w, h) + 1.5;
  let Wr = 0, Hr = 0, k = 1;
  if (v) {
    for (let n = -3; n <= 3; n++) for (let m = -3; m <= 3; m++) {
      if (!n && !m) continue;
      const vx = n * u.dx + m * v.dx, vy = n * u.dy + m * v.dy;
      if (Math.abs(vy) <= tol && vx > 0 && (!Wr || vx < Wr)) Wr = vx;
      if (Math.abs(vx) <= tol && vy > 0 && (!Hr || vy < Hr)) Hr = vy;
    }
    if (Wr && Hr) k = Math.round((Wr * Hr) / Math.abs(u.dx * v.dy - u.dy * v.dx));
  } else if (Math.abs(u.dy) <= tol) { Wr = u.dx; Hr = u.dx; } // stripes across: any height repeats
  else if (Math.abs(u.dx) <= tol) { Hr = u.dy; Wr = u.dy; }
  if (!Wr || !Hr) return NOT_FOUND;

  // measure the rectangle on a bigger copy
  const big = planes(img, 2048, 1);
  const [L] = big.p;
  const hx = refineShift(L, big.w, big.h, (Wr / small.sx) * big.sx, Math.ceil(big.sx / small.sx) + 2, false);
  const hy = refineShift(L, big.w, big.h, (Hr / small.sy) * big.sy, Math.ceil(big.sy / small.sy) + 2, true);
  const confidence = Math.max(0, Math.min(1, Math.min(hx.ncc, hy.ncc)));
  const tileW = hx.shift / big.sx, tileH = hy.shift / big.sy;
  if (confidence < 0.6) return { ...NOT_FOUND, confidence };

  let layout: RepeatInfo['layout'] = 'block', w1 = tileW, h1 = tileH, off = { x: 0, y: 0 };
  if (k === 2) {
    // one rectangle holds two motifs: read it as dropped columns or shifted rows, whichever gives the squarer cell
    const dHalfDrop = Math.abs(Math.log(tileW / 2 / tileH)), dBrick = Math.abs(Math.log(tileW / (tileH / 2)));
    if (dHalfDrop <= dBrick * 1.05) { layout = 'half-drop'; w1 = tileW / 2; off = { x: 0, y: tileH / 2 }; }
    else { layout = 'brick'; h1 = tileH / 2; off = { x: tileW / 2, y: 0 }; }
  }
  return { found: true, w: w1, h: h1, confidence, offset: off, layout, tile: { w: tileW, h: tileH } };
}

// ---------------------------------------------------------------- PNG

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** zlib stream: the platform's CompressionStream when there is one, else stored (uncompressed) blocks. */
async function zlib(raw: Uint8Array): Promise<Uint8Array> {
  const CS = (globalThis as unknown as { CompressionStream?: new (f: string) => { readable: ReadableStream; writable: WritableStream } }).CompressionStream;
  if (CS) {
    try {
      const cs = new CS('deflate');
      const wr = cs.writable.getWriter();
      void wr.write(raw as unknown as BufferSource as never);
      void wr.close();
      return new Uint8Array(await new Response(cs.readable).arrayBuffer());
    } catch { /* fall through to stored blocks */ }
  }
  const blocks = Math.ceil(raw.length / 65535) || 1;
  const out = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;
  for (let i = 0; i < blocks; i++) {
    const s = i * 65535, n = Math.min(65535, raw.length - s);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = n & 255; out[o++] = n >> 8; out[o++] = ~n & 255; out[o++] = (~n >> 8) & 255;
    out.set(raw.subarray(s, s + n), o); o += n;
  }
  let a = 1, b = 0;
  for (let i = 0; i < raw.length; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
  const ad = ((b << 16) | a) >>> 0;
  out[o++] = ad >>> 24; out[o++] = (ad >>> 16) & 255; out[o++] = (ad >>> 8) & 255; out[o++] = ad & 255;
  return out;
}

/** RGBA picture to a PNG data URL (Sub filter + deflate), no canvas needed. */
export async function encodePng(img: ImageLike): Promise<string> {
  const { width: W, height: H, data } = img;
  const stride = W * 4, raw = new Uint8Array((stride + 1) * H);
  const px = new Uint8Array(data.length); // transparent pixels carry no colour: compresses better
  for (let i = 0; i < data.length; i += 4) if (data[i + 3]) { px[i] = data[i]; px[i + 1] = data[i + 1]; px[i + 2] = data[i + 2]; px[i + 3] = data[i + 3]; }
  for (let y = 0; y < H; y++) {
    const r = y * (stride + 1);
    raw[r] = 1; // Sub filter
    for (let x = 0; x < stride; x++) raw[r + 1 + x] = (px[y * stride + x] - (x >= 4 ? px[y * stride + x - 4] : 0)) & 255;
  }
  const idat = await zlib(raw);
  const chunk = (type: string, body: Uint8Array) => {
    const c = new Uint8Array(12 + body.length), dv = new DataView(c.buffer);
    dv.setUint32(0, body.length);
    for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
    c.set(body, 8);
    dv.setUint32(8 + body.length, crc32(c.subarray(4, 8 + body.length)));
    return c;
  };
  const ihdr = new Uint8Array(13), hv = new DataView(ihdr.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H); ihdr[8] = 8; ihdr[9] = 6;
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  let bin = '';
  for (const p of parts) for (let i = 0; i < p.length; i += 0x8000) bin += String.fromCharCode(...p.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(bin);
}

// ---------------------------------------------------------------- extractMotif

export interface ExtractOptions {
  /** result of detectRepeat: the upload is a repeat, so take one whole motif from the middle */
  repeat?: RepeatInfo;
  /** longest side of the result (default 1024, never more) */
  maxSide?: number;
  /** background tolerance in Lab units (default 20) */
  tolerance?: number;
  /** also trace vector paths (default true) */
  trace?: boolean;
  /** colours to trace (default 6) */
  colors?: number;
}

export interface ExtractedMotif {
  /** transparent PNG data URL */
  image: string;
  pixels: ImageLike;
  width: number;
  height: number;
  aspect: number;
  /** traced shapes, one per colour, unit box (longer side spans -0.5..0.5) */
  paths?: { color: string; path: string }[];
  /** background colour that was removed (CSS hex), when there was one */
  background?: string;
  /** where the motif sat in the source picture (source px) */
  bounds: { x: number; y: number; w: number; h: number };
  /** the picture is flat colour artwork (a drawing or logo), so the traced paths stand in well for it */
  flat: boolean;
  detectedTile?: { w: number; h: number };
}

const hex2 = ([r, g, b]: number[]) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');

function borderColour(img: ImageLike): number[] | null {
  const { width: w, height: h, data: D } = img;
  const bins = new Map<number, number[]>();
  const add = (i: number) => {
    if (D[i * 4 + 3] < 16) return;
    const key = ((D[i * 4] >> 4) << 8) | ((D[i * 4 + 1] >> 4) << 4) | (D[i * 4 + 2] >> 4);
    const b = bins.get(key) ?? [0, 0, 0, 0];
    b[0] += D[i * 4]; b[1] += D[i * 4 + 1]; b[2] += D[i * 4 + 2]; b[3]++;
    bins.set(key, b);
  };
  for (let x = 0; x < w; x++) { add(x); add((h - 1) * w + x); }
  for (let y = 1; y < h - 1; y++) { add(y * w); add(y * w + w - 1); }
  let best: number[] | null = null;
  for (const b of bins.values()) if (!best || b[3] > best[3]) best = b;
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : null;
}

interface Comp { id: number; area: number; x0: number; y0: number; x1: number; y1: number; border: boolean }

function components(img: ImageLike): { label: Int32Array; comps: Comp[] } {
  const { width: w, height: h, data: D } = img;
  const label = new Int32Array(w * h).fill(-1);
  const comps: Comp[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (label[s] >= 0 || D[s * 4 + 3] < 128) continue;
    const c: Comp = { id: comps.length, area: 0, x0: w, y0: h, x1: -1, y1: -1, border: false };
    label[s] = c.id; stack.push(s);
    while (stack.length) {
      const i = stack.pop()!, x = i % w, y = (i - x) / w;
      c.area++; c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x); c.y0 = Math.min(c.y0, y); c.y1 = Math.max(c.y1, y);
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) c.border = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (label[j] < 0 && D[j * 4 + 3] >= 128) { label[j] = c.id; stack.push(j); }
      }
    }
    comps.push(c);
  }
  return { label, comps };
}

/**
 * Take one motif out of a picture. The background is removed (the most common border colour, flood filled from the
 * edges, see removeBackground), the biggest connected piece is the motif and pieces close to it (a dot, a ribbon)
 * come with it. In a repeating pattern (opts.repeat) the whole motif nearest the middle is taken. Returns null when
 * nothing is left after removing the background.
 */
export async function extractMotif(img: ImageLike, opts: ExtractOptions = {}): Promise<ExtractedMotif | null> {
  const work = prepareImage(img, 1536);
  const k = work.width / img.width;
  const bg = borderColour(work);
  const cut = removeBackground(work, opts.tolerance ?? 20);
  const { label, comps } = components(cut);
  if (!comps.length) return null;
  const rep = opts.repeat?.found ? opts.repeat : undefined;

  // the main piece
  const biggest = comps.reduce((m, c) => (c.area > m.area ? c : m));
  let main = biggest;
  if (rep) {
    const cx = cut.width / 2, cy = cut.height / 2;
    const whole = comps.filter((c) => !c.border && c.area >= 0.25 * biggest.area);
    if (whole.length) main = whole.reduce((m, c) => (Math.hypot((c.x0 + c.x1) / 2 - cx, (c.y0 + c.y1) / 2 - cy) < Math.hypot((m.x0 + m.x1) / 2 - cx, (m.y0 + m.y1) / 2 - cy) ? c : m));
  }
  // nearby parts, to a fixpoint
  const group = new Set<number>([main.id]);
  let bx0 = main.x0, by0 = main.y0, bx1 = main.x1, by1 = main.y1;
  const gap = Math.max(2, (rep ? 0.04 : 0.08) * Math.max(main.x1 - main.x0, main.y1 - main.y0));
  for (let grew = true; grew;) {
    grew = false;
    for (const c of comps) {
      if (group.has(c.id) || c.area < 4 || (rep && c.border)) continue;
      if (c.x1 < bx0 - gap || c.x0 > bx1 + gap || c.y1 < by0 - gap || c.y0 > by1 + gap) continue;
      group.add(c.id); grew = true;
      bx0 = Math.min(bx0, c.x0); by0 = Math.min(by0, c.y0); bx1 = Math.max(bx1, c.x1); by1 = Math.max(by1, c.y1);
    }
  }
  // crop with a small margin, keep only the group's pixels
  const m = 1, cx0 = Math.max(0, bx0 - m), cy0 = Math.max(0, by0 - m), cx1 = Math.min(cut.width - 1, bx1 + m), cy1 = Math.min(cut.height - 1, by1 + m);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const crop: ImageLike = { width: cw, height: ch, data: new Uint8ClampedArray(cw * ch * 4) };
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = (cy0 + y) * cut.width + cx0 + x;
    if (!group.has(label[si])) continue;
    crop.data.set(cut.data.subarray(si * 4, si * 4 + 4), (y * cw + x) * 4);
  }
  // defringe: edge pixels that are mostly background colour go
  if (bg) {
    const A = crop.data, d = (i: number) => Math.hypot(A[i * 4] - bg[0], A[i * 4 + 1] - bg[1], A[i * 4 + 2] - bg[2]);
    const drop: number[] = [];
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const i = y * cw + x;
      if (A[i * 4 + 3] < 128) continue;
      let open = false, sum = 0, n = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || A[(ny * cw + nx) * 4 + 3] < 128) open = true;
        else { sum += d(ny * cw + nx); n++; }
      }
      if (open && n && d(i) < 0.5 * (sum / n)) drop.push(i);
    }
    for (const i of drop) A[i * 4 + 3] = 0;
  }
  const out = prepareImage(crop, Math.min(1024, opts.maxSide ?? 1024));
  const image = await encodePng(out);
  const res: ExtractedMotif = {
    image, pixels: out, width: out.width, height: out.height, aspect: out.width / out.height,
    background: bg ? hex2(bg) : undefined,
    bounds: { x: cx0 / k, y: cy0 / k, w: cw / k, h: ch / k },
    flat: false,
  };
  if (rep) res.detectedTile = { w: rep.w, h: rep.h };
  if (opts.trace ?? true) {
    const small = prepareImage(out, 512);
    const post = posterize(small, opts.colors ?? 6);
    if (post.palette.length) {
      const traced = traceToPaths(post.index, post.width, post.height, post.palette);
      res.paths = traced.map((t) => ({ color: t.color, path: t.path }));
      // flat artwork: pixels sit close to their palette colour
      let err = 0, n = 0;
      const pal = post.palette.map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
      for (let i = 0; i < post.index.length; i++) {
        const c = post.index[i];
        if (c < 0) continue;
        err += Math.hypot(small.data[i * 4] - pal[c][0], small.data[i * 4 + 1] - pal[c][1], small.data[i * 4 + 2] - pal[c][2]); n++;
      }
      res.flat = n > 0 && err / n < 14;
    }
  }
  return res;
}

/** The extracted motif as the fabric pattern's PatternMotif. */
export function toPatternMotif(m: ExtractedMotif): PatternMotif {
  const out: PatternMotif = { image: m.image, aspect: m.aspect };
  if (m.paths?.length) out.paths = m.paths;
  if (m.detectedTile) out.detectedTile = m.detectedTile;
  return out;
}

// ---------------------------------------------------------------- suggestLayout

export interface LayoutSuggestion {
  layout: RepeatLayout;
  /** other layouts that suit the motif, best first */
  alternatives: RepeatLayout[];
  /** how mirror symmetric the motif is left to right and top to bottom, 0..1 */
  symmetry: { lr: number; ud: number };
  reason: string;
}

/**
 * Which repeat suits a motif. A motif that is the same on both sides (a fleur de lis, a rosette, a dot) looks best
 * dropped half a cell on every other column; a directional one (a bird facing left, a word) stays in a plain block.
 * When the upload was already a repeat, its own arrangement wins.
 */
export function suggestLayout(motif: ImageLike | { pixels: ImageLike }, repeat?: RepeatInfo): LayoutSuggestion {
  const img = 'pixels' in motif ? motif.pixels : motif;
  const n = 64, mask = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const sx = Math.min(img.width - 1, Math.floor(((x + 0.5) * img.width) / n)), sy = Math.min(img.height - 1, Math.floor(((y + 0.5) * img.height) / n));
    mask[y * n + x] = img.data[(sy * img.width + sx) * 4 + 3] >= 128 ? 1 : 0;
  }
  // compare in the motif's own box (aspect kept), mirrored about its centre
  let x0 = n, y0 = n, x1 = -1, y1 = -1;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (mask[y * n + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const iou = (flipX: boolean) => {
    let a = 0, u = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = mask[y * n + x], q = flipX ? mask[y * n + (x0 + x1 - x)] : mask[(y0 + y1 - y) * n + x];
      if (p && q) a++;
      if (p || q) u++;
    }
    return u ? a / u : 0;
  };
  const lr = x1 >= 0 ? iou(true) : 0, ud = x1 >= 0 ? iou(false) : 0;
  const sym = { lr: Math.round(lr * 100) / 100, ud: Math.round(ud * 100) / 100 };
  if (repeat?.found && repeat.layout !== 'block') {
    return { layout: repeat.layout, alternatives: ['block', 'scatter'], symmetry: sym, reason: `The picture already repeats as ${repeat.layout}.` };
  }
  if (repeat?.found) return { layout: 'block', alternatives: ['half-drop', 'brick'], symmetry: sym, reason: 'The picture already repeats in a plain grid.' };
  if (lr >= 0.82) {
    return {
      layout: 'half-drop', alternatives: ud >= 0.82 ? ['brick', 'scatter', 'block'] : ['brick', 'mirror', 'block'], symmetry: sym,
      reason: 'The motif is the same on both sides, so every other column drops half a cell and fills the gaps.',
    };
  }
  return { layout: 'block', alternatives: ['half-drop', 'scatter', 'mirror'], symmetry: sym, reason: 'The motif has a direction, so it stays upright in a plain grid.' };
}
