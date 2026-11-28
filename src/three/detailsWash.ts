import * as THREE from 'three';
import type { FinishKind, FinishStroke, WashPreset } from '../data/edits';
import { seedOf, strokePts } from '../data/finish';
import { samplePoly, type Pt } from '../lib/geometry';
import type { Attachment } from '../data/edits';
import type { Piece } from '../data/presets';
import { washFamily } from '../data/finish';

// Wash look painted from procedural noise in pattern space (cm). Nothing here is a flat overlay: every wash is a field of
// several noise octaves (fibre streaks along the grain for denim, cloud mottling for stone and acid) driven by masks from the
// geometry (seams roped and ridged, hems, edges, thighs, knees, seat, shoulders, pocket outlines). The result is a soft
// RGBA overlay drawn over the cloth; the weave stays visible through it (the cloth and its bump map are underneath).

export type Family = 'denim' | 'knit' | 'woven';
export interface WashInfo {
  pieceId: string; role: string; family: Family;
  /** dense outline of the piece, cm */
  poly: Pt[];
  /** patch pockets on this piece: centre and size (cm), their outlines show as ridges */
  pockets: { x: number; y: number; w: number; h: number }[];
  /** pocket bag size (denim fronts): the bag edge shows through the front as a faint ridge */
  bag?: { w: number; h: number };
}
export interface Box { x0: number; y0: number; w: number; h: number }
export interface WashFin { preset: WashPreset; ps: number; strokes: FinishStroke[] }

/* ---------- noise ---------- */
const h2 = (ix: number, iy: number, seed: number) => {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const vn = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = h2(ix, iy, seed), b = h2(ix + 1, iy, seed), c = h2(ix, iy + 1, seed), d = h2(ix + 1, iy + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
export const fbm = (x: number, y: number, oct: number, seed: number) => {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vn(x * f, y * f, seed + i * 17); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
};
const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const bell = (d: number, c: number, w: number) => Math.exp(-(((d - c) / w) ** 2));

/* ---------- colour ---------- */
const hsl = { h: 0, s: 0, l: 0 };
/** lighter and less saturated version of a colour (a faded dye) */
export function fadeColor(hex: string, light: number, desat: number): [number, number, number] {
  const c = new THREE.Color(hex);
  c.getHSL(hsl);
  const l = hsl.l + (0.93 - hsl.l) * light;
  const out = new THREE.Color().setHSL(hsl.h, hsl.s * (1 - desat), l);
  return [out.r * 255, out.g * 255, out.b * 255];
}
const lum = (hex: string) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
const mixRgb = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgbOf = (hex: string): [number, number, number] => { const c = new THREE.Color(hex); return [c.r * 255, c.g * 255, c.b * 255]; };
const rgba = (hex: string, a: number) => { const c = new THREE.Color(hex); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${clamp01(a)})`; };

/* ---------- cached noise and geometry fields per piece ---------- */
interface Fields { gw: number; gh: number; k: number; cloud: Float32Array; cloud2: Float32Array; streak: Float32Array; fine: Float32Array; marble: Float32Array; dSeam: Float32Array; dHem: Float32Array }
const cache = new Map<string, Fields>();
const GRID_MAX = 420;
const polySig = (p: Pt[]) => p.length + ':' + p.filter((_, i) => i % 7 === 0).map((a) => Math.round(a.x * 2) + ',' + Math.round(a.y * 2)).join(';');

function fieldsFor(info: WashInfo, box: Box): Fields {
  const key = [info.pieceId, info.family, Math.round(box.w), Math.round(box.h), polySig(info.poly)].join('|');
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const k = Math.min(8, GRID_MAX / Math.max(box.w, box.h));
  const gw = Math.max(2, Math.ceil(box.w * k)), gh = Math.max(2, Math.ceil(box.h * k));
  const n = gw * gh;
  const f: Fields = { gw, gh, k, cloud: new Float32Array(n), cloud2: new Float32Array(n), streak: new Float32Array(n), fine: new Float32Array(n), marble: new Float32Array(n), dSeam: new Float32Array(n), dHem: new Float32Array(n) };
  let seed = 0; for (const ch of info.pieceId) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
  seed = Math.abs(seed) % 9973;
  const ys = info.poly.map((a) => a.y), top = Math.min(...ys), bot = Math.max(...ys), H = Math.max(1, bot - top);
  // outline segments: hem segments (low and flat) and the rest (seams, openings)
  const seam: number[] = [], hem: number[] = [];
  for (let i = 0; i < info.poly.length; i++) {
    const a = info.poly[i], b = info.poly[(i + 1) % info.poly.length];
    const isHem = (a.y + b.y) / 2 > top + H * 0.9 && Math.abs(b.y - a.y) < 0.6 * Math.abs(b.x - a.x);
    (isHem ? hem : seam).push(a.x, a.y, b.x, b.y);
  }
  const dist = (list: number[], x: number, y: number) => {
    let best = 1e9;
    for (let i = 0; i < list.length; i += 4) {
      const ax = list[i], ay = list[i + 1], dx = list[i + 2] - ax, dy = list[i + 3] - ay;
      const L = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
      const ex = ax + dx * t - x, ey = ay + dy * t - y, d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  const denim = info.family === 'denim';
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const X = box.x0 + (i + 0.5) / k, Y = box.y0 + (j + 0.5) / k, o = j * gw + i;
    f.cloud[o] = fbm(X * 0.32, Y * 0.32, 5, seed);
    f.cloud2[o] = fbm(X * 0.9 + 40, Y * 0.9, 4, seed + 7);
    // fibre streaks lie along the grain (pattern y); knits and wovens get a rounder, softer grain
    f.streak[o] = denim ? fbm(X * 3.4, Y * 0.35, 3, seed + 13) : fbm(X * 1.6, Y * 1.2, 3, seed + 13);
    f.fine[o] = fbm(X * 11, Y * 11, 2, seed + 29);
    const wx = fbm(X * 0.22 + 9, Y * 0.22, 3, seed + 41) * 5, wy = fbm(X * 0.22, Y * 0.22 + 9, 3, seed + 43) * 5;
    f.marble[o] = 1 - Math.abs(2 * fbm(X * 0.2 + wx, Y * 0.2 + wy, 4, seed + 53) - 1); // ridged, domain warped: marbled veins
    f.dSeam[o] = seam.length ? dist(seam, X, Y) : 9;
    f.dHem[o] = hem.length ? dist(hem, X, Y) : 9;
  }
  cache.set(key, f);
  if (cache.size > 14) cache.delete(cache.keys().next().value!);
  return f;
}

/* ---------- processes ---------- */
interface PresetP { base: number; contrast: number; edge: number; zone: number; recess: number; light: number; desat: number; tint?: [number, number, number]; tintAmt?: number }
function presetParams(p: WashPreset, fam: Family): PresetP | null {
  if (p === 'none') return null;
  if (fam === 'denim') {
    switch (p) {
      case 'light': return { base: 0.6, contrast: 1.0, edge: 0.7, zone: 0.55, recess: 0.1, light: 0.8, desat: 0.28 };
      case 'mid': return { base: 0.38, contrast: 0.75, edge: 0.6, zone: 0.45, recess: 0.13, light: 0.62, desat: 0.2 };
      case 'dark': return { base: 0.1, contrast: 0.5, edge: 0.45, zone: 0.3, recess: 0.2, light: 0.45, desat: 0.1 };
      default: return { base: 0.48, contrast: 1.05, edge: 0.95, zone: 0.65, recess: 0.12, light: 0.66, desat: 0.5, tint: [196, 193, 186], tintAmt: 0.3 };
    }
  }
  // cotton knits and wovens: garment dye and pigment wash, colour fades and greys, even and heathered
  switch (p) {
    case 'light': return { base: 0.46, contrast: 0.7, edge: 0.6, zone: 0.55, recess: 0.05, light: 0.62, desat: 0.5 };
    case 'mid': return { base: 0.32, contrast: 0.6, edge: 0.5, zone: 0.45, recess: 0.05, light: 0.5, desat: 0.4 };
    case 'dark': return { base: 0.14, contrast: 0.4, edge: 0.35, zone: 0.3, recess: 0.06, light: 0.35, desat: 0.3 };
    default: return { base: 0.42, contrast: 0.75, edge: 0.85, zone: 0.6, recess: 0.06, light: 0.55, desat: 0.65, tint: [200, 196, 186], tintAmt: 0.35 };
  }
}

/** how much a place on the piece wears: thighs, knees, seat and belt on denim; shoulders, chest and sleeves on tops */
function zoneAt(info: WashInfo, fx: number, fy: number): number {
  const g = (v: number, c: number, w: number) => Math.exp(-(((v - c) / w) ** 2));
  const r = info.role;
  if (info.family === 'denim') {
    if (r === 'waistband') return 0.9;
    if (r === 'front') return Math.max(0.9 * g(fy, 0.2, 0.09) * g(fx, 0.5, 0.3), 0.8 * g(fy, 0.5, 0.05) * g(fx, 0.5, 0.32), 0.7 * g(fy, 0.02, 0.04));
    if (r === 'back') return Math.max(0.8 * g(fy, 0.07, 0.08) * g(fx, 0.5, 0.35), 0.5 * g(fy, 0.5, 0.05) * g(fx, 0.5, 0.3), 0.4 * g(fy, 0.2, 0.1) * g(fx, 0.5, 0.3));
    return 0.5;
  }
  if (r === 'front' || r === 'back') return Math.max(0.9 * g(fy, 0.04, 0.07), 0.45 * g(fy, 0.2, 0.1) * g(fx, 0.5, 0.35), 0.35 * g(fy, 0.97, 0.05));
  if (r === 'sleeve') return Math.max(0.8 * g(fy, 0.02, 0.1), 0.45 * g(fy, 0.55, 0.12) * g(fx, 0.5, 0.4), 0.6 * g(fy, 0.97, 0.06));
  return 0.7; // collar, cuffs, bands, plackets
}

/** soft brush mask per kind, at grid resolution */
function strokeMask(strokes: FinishStroke[], box: Box, f: Fields): Float32Array {
  const c = document.createElement('canvas');
  c.width = f.gw; c.height = f.gh;
  const g = c.getContext('2d')!;
  g.setTransform(f.k, 0, 0, f.k, -box.x0 * f.k, -box.y0 * f.k);
  for (const s of strokes) {
    const pts = strokePts(s);
    const every = Math.max(0.2, s.r * 0.3);
    const stamp = (x: number, y: number) => {
      const gr = g.createRadialGradient(x, y, 0, x, y, s.r);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - s.r, y - s.r, s.r * 2, s.r * 2);
    };
    if (pts.length === 1) stamp(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / every));
      for (let q = 0; q <= n; q++) stamp(a.x + (b.x - a.x) * (q / n), a.y + (b.y - a.y) * (q / n));
    }
  }
  const d = g.getImageData(0, 0, f.gw, f.gh).data, out = new Float32Array(f.gw * f.gh);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] / 255;
  return out;
}

type Layer = { col: [number, number, number]; a: number };
const MASKED_WASH: FinishKind[] = ['stone', 'acid', 'bleach', 'fade', 'sunfade', 'armpit', 'abrasion', 'elbow'];

/**
 * Paint the wash into ctx (pattern space cm). Returns the low resolution overlay so printed artwork can be faded by the
 * same field (prints fade where the cloth fades).
 */
export function paintWash(ctx: CanvasRenderingContext2D, hex: string, fin: WashFin, box: Box, info: WashInfo): HTMLCanvasElement | null {
  const pp = presetParams(fin.preset, info.family);
  const groups = MASKED_WASH.filter((k) => fin.strokes.some((s) => s.k === k));
  if (!pp && !groups.length) return null;
  const f = fieldsFor(info, box);
  const { gw, gh, k } = f;
  const masks = new Map<FinishKind, Float32Array>();
  const strengthOf = new Map<FinishKind, number>();
  for (const kd of groups) {
    const list = fin.strokes.filter((s) => s.k === kd);
    masks.set(kd, strokeMask(list, box, f));
    strengthOf.set(kd, list.reduce((a, s) => a + s.s, 0) / list.length);
  }
  const ys = info.poly.map((a) => a.y), xs = info.poly.map((a) => a.x);
  const top = Math.min(...ys), H = Math.max(1, Math.max(...ys) - top), left = Math.min(...xs), W = Math.max(1, Math.max(...xs) - left);
  const dark = lum(hex) < 0.12;
  // overlay colours: indigo and dyed cloth lose colour towards a lighter, greyer version of itself; black goes charcoal
  const baseRgb = rgbOf(hex);
  const colFor = (light: number, desat: number) => fadeColor(dark ? mixHexToGrey(hex) : hex, light, desat);
  const darkRgb = mixRgb(baseRgb, [0, 0, 0], 0.55);
  const pLight: [number, number, number] = pp ? mixRgb(colFor(pp.light, pp.desat), pp.tint ?? [0, 0, 0], pp.tintAmt ?? 0) : [0, 0, 0];
  const ps = fin.ps;
  const data = new Uint8ClampedArray(gw * gh * 4);
  // pocket outlines and bag edge as ridges (distance field is cheap enough at this grid)
  const ridges: number[] = [];
  for (const p of info.pockets) ridges.push(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, p.x + p.w / 2, p.y + p.h / 2, p.x - p.w / 2, p.y + p.h / 2, p.x - p.w / 2, p.y + p.h / 2, p.x - p.w / 2, p.y - p.h / 2);
  if (info.bag && info.family === 'denim' && info.role === 'front') {
    const bx1 = Math.max(...xs), bx0 = bx1 - info.bag.w * 0.9, by1 = top + info.bag.h;
    ridges.push(bx0, top + 2, bx0, by1, bx0, by1, bx1, by1);
  }
  for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
    const o = j * gw + i, X = box.x0 + (i + 0.5) / k, Y = box.y0 + (j + 0.5) / k;
    const cloud = f.cloud[o], cloud2 = f.cloud2[o], streak = f.streak[o], fine = f.fine[o];
    const layers: Layer[] = [];
    let ridge = 0;
    if (ridges.length) { let best = 9; for (let q = 0; q < ridges.length; q += 4) { const ax = ridges[q], ay = ridges[q + 1], dx = ridges[q + 2] - ax, dy = ridges[q + 3] - ay, L = dx * dx + dy * dy || 1e-9, t = Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / L)); best = Math.min(best, Math.hypot(ax + dx * t - X, ay + dy * t - Y)); } ridge = bell(best, 0.2, 0.28); }
    if (pp) {
      const m = clamp01(0.5 + (cloud - 0.5) * 2.2 * pp.contrast);
      const zone = zoneAt(info, (X - left) / W, (Y - top) / H);
      const seamW = bell(f.dSeam[o], 0.35, 0.32) + 0.35 * bell(f.dSeam[o], 0.9, 0.5);
      const hemW = bell(f.dHem[o], 0.6, 0.8);
      const edgeW = bell(Math.min(f.dSeam[o], f.dHem[o]), 0.4, 1.4);
      const grain = info.family === 'denim' ? 0.7 + 0.6 * streak : 0.85 + 0.3 * streak;
      const speck = info.family === 'denim' ? (fine > 0.62 ? (fine - 0.62) * 2.2 : 0) : (fine > 0.58 ? (fine - 0.58) * 1.2 : 0);
      let w = pp.base * (0.45 + 0.95 * m) * grain + speck * pp.base * 0.9;
      w += pp.zone * zone * (0.45 + 0.7 * cloud2) * (0.5 + pp.base);
      w += pp.edge * (info.family === 'denim' ? seamW * 0.9 + hemW * 0.8 : seamW * 0.5 + hemW * 0.9 + edgeW * 0.35) * (0.55 + 0.6 * cloud2);
      w += ridge * pp.edge * 0.55;
      w = clamp01(w * (0.5 + 0.5 * ps) * ps ** 0.35);
      // base stays deeper in the recesses: a darker band beside seam ridges and in the low parts of the mottling
      const rec = (pp.recess * (1 - m) * (1 - w) + 0.3 * pp.recess * bell(f.dSeam[o], 1.0, 0.3)) * (0.4 + ps);
      if (rec > 0.004) layers.push({ col: darkRgb, a: rec });
      layers.push({ col: pLight, a: w * 0.9 });
    }
    for (const kd of groups) {
      const mk = masks.get(kd)![o];
      if (mk < 0.01) continue;
      const st = strengthOf.get(kd)!;
      const soft = sstep(0.12, 0.7, mk + (cloud2 - 0.5) * 0.45); // blobby, uneven brush edge
      if (kd === 'stone') {
        const mott = sstep(0.34, 0.72, cloud * 0.8 + cloud2 * 0.35 + (fine - 0.5) * 0.4);
        const a = soft * st * (0.16 + 0.85 * mott) * (0.75 + 0.5 * streak);
        layers.push({ col: colFor(0.75, 0.25), a: clamp01(a) * 0.9 });
      } else if (kd === 'acid') {
        const vein = sstep(0.62, 0.7, f.marble[o]), cloudy = sstep(0.4, 0.62, cloud);
        layers.push({ col: colFor(0.95, 0.72), a: clamp01(soft * st * (0.8 * vein + 0.38 * cloudy * (0.6 + 0.4 * fine))) * 0.95 });
        const pool = sstep(0.4, 0.28, f.marble[o]) * soft * st;
        if (pool > 0.01) layers.push({ col: darkRgb, a: pool * 0.22 });
      } else if (kd === 'bleach') {
        const patch = 0.3 + 0.7 * sstep(0.25, 0.6, cloud2 * 0.7 + cloud * 0.5);
        const yel = mixRgb(colFor(0.97, 0.85), [244, 234, 200], 0.55);
        layers.push({ col: yel, a: clamp01(soft * st * patch * (0.8 + 0.3 * streak)) * 0.95 });
      } else if (kd === 'abrasion' || kd === 'elbow') {
        const rub = sstep(0.3, 0.62, streak * 0.55 + fine * 0.45 + cloud * 0.3);
        const a = soft * st * (kd === 'elbow' ? 0.25 + 0.5 * rub : 0.3 + 0.8 * rub);
        layers.push({ col: colFor(kd === 'elbow' ? 0.65 : 0.88, 0.35), a: clamp01(a) * 0.92 });
      } else { // fade, sunfade, armpit: soft, even, only a little cloudy
        const a = soft * st * (kd === 'sunfade' ? 0.62 : 0.78) * (0.72 + 0.28 * cloud);
        const col = kd === 'armpit' ? mixRgb(colFor(0.6, 0.35), [214, 204, 168], 0.25) : kd === 'sunfade' ? colFor(0.5, 0.5) : colFor(0.65, 0.3);
        layers.push({ col, a: clamp01(a) * 0.9 });
      }
    }
    // composite the layers 'over' in order into one straight RGBA pixel
    let r = 0, g = 0, b = 0, A = 0;
    for (const L of layers) {
      const a = clamp01(L.a), nA = a + A * (1 - a);
      if (nA <= 0) continue;
      r = (L.col[0] * a + r * A * (1 - a)) / nA; g = (L.col[1] * a + g * A * (1 - a)) / nA; b = (L.col[2] * a + b * A * (1 - a)) / nA; A = nA;
    }
    data[o * 4] = r; data[o * 4 + 1] = g; data[o * 4 + 2] = b; data[o * 4 + 3] = A * 255;
  }
  const lc = document.createElement('canvas');
  lc.width = gw; lc.height = gh;
  lc.getContext('2d')!.putImageData(new ImageData(data, gw, gh), 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lc, box.x0, box.y0, gw / k, gh / k);
  ctx.restore();
  return lc;
}

const mixHexToGrey = (hex: string) => { const l = lum(hex); const g = Math.round((0.2 + l * 1.4) * 255); return '#' + [g, g, g + 4].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join(''); };

/* ---------- printed artwork in the wash ---------- */

let crackleTile: HTMLCanvasElement | null = null;
/** a tile of fine cracks and pits, white lines on transparent, used to eat into prints */
function crackle(): HTMLCanvasElement {
  if (crackleTile) return crackleTile;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  let s = 7; const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  g.strokeStyle = '#fff'; g.lineCap = 'round';
  for (let i = 0; i < 380; i++) {
    let x = r() * 512, y = r() * 512, a = r() * 6.28;
    g.lineWidth = 0.6 + r() * 1.6; g.globalAlpha = 0.5 + r() * 0.5; g.beginPath(); g.moveTo(x, y);
    for (let q = 0; q < 4 + Math.floor(r() * 6); q++) { a += (r() - 0.5) * 1.3; x += Math.cos(a) * (6 + r() * 14); y += Math.sin(a) * (6 + r() * 14); g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  for (let i = 0; i < 5200; i++) { g.globalAlpha = 0.4 + r() * 0.6; g.fillStyle = '#fff'; g.fillRect(r() * 512, r() * 512, 0.8 + r() * 2.4, 0.8 + r() * 2); }
  crackleTile = c;
  return c;
}

/**
 * Wear a printed layer drawn on art (a canvas the size of the ink canvas, pattern space via the same transform): the print
 * fades where the cloth faded (same field), and cracks and chips more where the wash is strong and under crack strokes.
 */
export function weatherArt(art: CanvasRenderingContext2D, layer: HTMLCanvasElement | null, box: Box, k: number, fin: WashFin, hex: string, amount: number) {
  const W = art.canvas.width, Hh = art.canvas.height;
  art.save();
  art.setTransform(1, 0, 0, 1, 0, 0);
  const pp = fin.preset === 'none' ? 0 : fin.preset === 'light' ? 0.9 : fin.preset === 'mid' ? 0.6 : fin.preset === 'vintage' ? 0.8 : 0.25;
  const cracks = fin.strokes.filter((s) => s.k === 'crack');
  const wearBase = clamp01(pp * fin.ps * amount);
  // chips and cracks: the crackle tile erases the ink
  const eat = (alpha: number, scale: number) => {
    if (alpha <= 0.01) return;
    const tile = crackle(), pat = art.createPattern(tile, 'repeat');
    if (!pat) return;
    art.globalCompositeOperation = 'destination-out';
    art.globalAlpha = Math.min(0.95, alpha);
    pat.setTransform(new DOMMatrix().scale(scale));
    art.fillStyle = pat;
    art.fillRect(0, 0, W, Hh);
  };
  eat(wearBase * 0.55, k / 14);
  // under crack strokes the print crazes heavily
  if (cracks.length) {
    const cm = document.createElement('canvas'); cm.width = W; cm.height = Hh;
    const cg = cm.getContext('2d')!;
    cg.setTransform(k, 0, 0, k, -box.x0 * k, -box.y0 * k);
    for (const s of cracks) for (const p of strokePts(s)) {
      const gr = cg.createRadialGradient(p.x, p.y, 0, p.x, p.y, s.r);
      gr.addColorStop(0, `rgba(255,255,255,${0.95 * s.s})`); gr.addColorStop(0.6, `rgba(255,255,255,${0.55 * s.s})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
      cg.fillStyle = gr; cg.fillRect(p.x - s.r, p.y - s.r, s.r * 2, s.r * 2);
    }
    // crack mask times the crackle tile (denser pits), then taken out of the ink
    const tile = crackle(), pat = cg.createPattern(tile, 'repeat');
    if (pat) {
      cg.setTransform(1, 0, 0, 1, 0, 0);
      cg.globalCompositeOperation = 'destination-in';
      pat.setTransform(new DOMMatrix().scale(k / 9));
      cg.fillStyle = pat; cg.fillRect(0, 0, W, Hh);
    }
    art.globalCompositeOperation = 'destination-out'; art.globalAlpha = 1;
    art.drawImage(cm, 0, 0);
    // and the surviving ink is pale
    art.globalCompositeOperation = 'source-atop'; art.globalAlpha = 0.28;
    art.fillStyle = rgba('#f4f1ea', 1);
    art.fillRect(0, 0, W, Hh);
  }
  // fade: the ink lightens by the wash field
  if (layer && pp > 0) {
    art.globalCompositeOperation = 'source-atop';
    art.globalAlpha = Math.min(1, 0.55 * amount + 0.2);
    art.drawImage(layer, 0, 0, W, Hh, 0, 0, W, Hh);
    art.globalAlpha = wearBase * 0.32;
    art.fillStyle = rgba(mixHexToGrey(hex) === hex ? '#ffffff' : '#f2f0ea', 1);
    art.fillRect(0, 0, W, Hh);
  }
  art.restore();
}

/** thread (embroidery, woven labels) fades less than cloth and print: a light touch of the wash field */
export function fadeThread(cc: CanvasRenderingContext2D, layer: HTMLCanvasElement | null, box: Box, kk: number, amount: number) {
  if (!layer) return;
  cc.save();
  cc.setTransform(1, 0, 0, 1, 0, 0);
  cc.globalCompositeOperation = 'source-atop';
  cc.globalAlpha = amount;
  // the layer is in grid space for the whole box: draw it over the thread canvas at that scale
  cc.drawImage(layer, 0, 0, cc.canvas.width, cc.canvas.height);
  cc.restore();
}

/** what the wash needs to know about a piece: outline, pocket outlines, the pocket bag size */
export function buildWashInfo(piece: Piece, pieces: Piece[], atts: Attachment[]): WashInfo {
  const bagP = pieces.find((q) => q.role === 'pocketBag');
  const ext = (q: Piece, k: 'x' | 'y') => Math.max(...q.points.map((a) => a[k])) - Math.min(...q.points.map((a) => a[k]));
  return {
    pieceId: piece.id, role: piece.role, family: washFamily(piece.fabric.id), poly: samplePoly(piece.points, 4),
    pockets: atts.filter((a) => a.kind === 'pocket' && a.pieceId === piece.id && (a.face ?? 'outside') === 'outside').map((a) => ({ x: a.x, y: a.y, w: a.w, h: a.h })),
    bag: bagP ? { w: ext(bagP, 'x'), h: ext(bagP, 'y') } : undefined,
  };
}
