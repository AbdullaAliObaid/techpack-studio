// Local fallbacks for exports the fabrics agent adds to src/data/fabrics.ts (category, FABRIC_CATEGORIES, fabricHex,
// PATTERNS, patternTile) and src/lib/trace.ts (prepareImage, removeBackground, posterize, traceToPaths, toLayers).
// Everything is re-exported from editHelpers.ts. When the real exports exist they win automatically (a namespace
// import with optional lookups, so this file builds either way). The picture functions at the bottom are always
// local: the sheet calls them through this one file, so swapping in src/lib/trace.ts later touches only here.

import * as F from '../data/fabrics';
import type { Fabric, FabricPattern, PatternId } from '../data/fabrics';
import type { ShapeLayer } from '../data/edits';
import type { PieceFabric } from '../data/presets';
import type { CSSProperties } from 'react';
import { uid } from '../lib/units';
import { linkedMoves } from '../data/symmetry';

/* ------------------------------------------------------------------ fabrics */

const lib = F as unknown as {
  FABRIC_CATEGORIES?: unknown;
  PATTERNS?: unknown;
  fabricHex?: (pf: { id: string; color: number; hex?: string }) => string;
  patternTile?: (p: FabricPattern) => { size: [number, number]; svg: string };
};

export interface FabricCategory { id: string; label: string }

const WEAVE_CATEGORY: Record<string, string> = {
  canvas: 'Cotton', twill: 'Denim', poplin: 'Shirting', linen: 'Linen', wool: 'Wool', poly: 'Synthetic', jersey: 'Knit', leather: 'Leather', spandex: 'Active',
};

const asText = (v: unknown) => (typeof v === 'string' ? v : '');

/** Categories, as {id, label}, whatever shape the library exports them in. */
export function fabricCategories(): FabricCategory[] {
  const raw = lib.FABRIC_CATEGORIES;
  const out: FabricCategory[] = [];
  const add = (id: string, label?: string) => { if (id && !out.some((c) => c.id === id)) out.push({ id, label: label || id }); };
  if (Array.isArray(raw)) {
    for (const c of raw) {
      if (typeof c === 'string') add(c);
      else if (c && typeof c === 'object') { const o = c as Record<string, unknown>; add(asText(o.id) || asText(o.name) || asText(o.label), asText(o.label) || asText(o.name) || asText(o.id)); }
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) add(k, typeof v === 'string' ? v : asText((v as Record<string, unknown>)?.label) || asText((v as Record<string, unknown>)?.name));
  }
  if (!out.length) for (const f of F.FABRICS) add(categoryOf(f));
  return out;
}

/** The id of a fabric's category. */
export function categoryOf(f: Fabric): string {
  const c = (f as unknown as { category?: unknown }).category;
  if (typeof c === 'string' && c) return c;
  return WEAVE_CATEGORY[f.weave] ?? 'Other';
}

/** Colour of a piece's fabric: a custom hex when set, else the palette colour. */
export function fabricHex(pf: { id: string; color: number; hex?: string }): string {
  if (lib.fabricHex) return lib.fabricHex(pf);
  if (pf.hex) return pf.hex;
  const f = F.fabricById(pf.id);
  return (f.colors[pf.color] ?? f.colors[0]).hex;
}

export interface PatternInfo { id: PatternId; name: string; colors: string[]; scale: number }

const PATTERN_DEFAULTS: Record<PatternId, { name: string; colors: string[]; scale: number }> = {
  solid: { name: 'Solid', colors: ['#ffffff'], scale: 4 },
  stripe: { name: 'Stripe', colors: ['#f4f4f1', '#2a3550'], scale: 2 },
  pinstripe: { name: 'Pinstripe', colors: ['#2a3550', '#d9d9de'], scale: 1 },
  breton: { name: 'Breton', colors: ['#f4f4f1', '#2a3550'], scale: 2 },
  awning: { name: 'Awning', colors: ['#f4f4f1', '#b3262d'], scale: 3 },
  gingham: { name: 'Gingham', colors: ['#ffffff', '#2a52be'], scale: 1.2 },
  check: { name: 'Check', colors: ['#f4f4f1', '#222222'], scale: 2 },
  plaid: { name: 'Plaid', colors: ['#e9e6dc', '#b3262d', '#2a3550'], scale: 8 },
  tartan: { name: 'Tartan', colors: ['#1f4d3a', '#2a3550', '#b3262d'], scale: 8 },
  windowpane: { name: 'Windowpane', colors: ['#d9d9de', '#2a3550'], scale: 7 },
  houndstooth: { name: 'Houndstooth', colors: ['#f4f4f1', '#222222'], scale: 3 },
  herringbone: { name: 'Herringbone', colors: ['#9a9a9a', '#4a4c52'], scale: 2 },
  chevron: { name: 'Chevron', colors: ['#f4f4f1', '#0f766e'], scale: 3 },
  polka: { name: 'Polka dot', colors: ['#2a3550', '#ffffff'], scale: 2.5 },
  pindot: { name: 'Pin dot', colors: ['#2a3550', '#ffffff'], scale: 1.2 },
  grid: { name: 'Grid', colors: ['#ffffff', '#2f80ed'], scale: 2 },
  camo: { name: 'Camo', colors: ['#6b6f45', '#3f4a2b', '#a8996a', '#2b2b2b'], scale: 9 },
  floral: { name: 'Floral', colors: ['#f4f4f1', '#e57e9a', '#5a8f4e'], scale: 7 },
  paisley: { name: 'Paisley', colors: ['#2a3550', '#e8c36a', '#b3262d'], scale: 7 },
  animal: { name: 'Animal spots', colors: ['#d9b26a', '#4b3a26'], scale: 6 },
  geo: { name: 'Geometric', colors: ['#f4f4f1', '#0f766e', '#f2c94c'], scale: 5 },
  'tie-dye': { name: 'Tie dye', colors: ['#f4f4f1', '#2f80ed', '#bb6bd9'], scale: 14 },
  heather: { name: 'Heather', colors: ['#9a9a9a', '#c9c9c9'], scale: 3 },
  jacquard: { name: 'Jacquard', colors: ['#28304a', '#9aa4c4'], scale: 4 },
};
const PATTERN_IDS = Object.keys(PATTERN_DEFAULTS) as PatternId[];

/** The pattern library as a list, from the fabrics agent's PATTERNS when it exists. */
export function patternList(): PatternInfo[] {
  const raw = lib.PATTERNS;
  const rows: unknown[] = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw as Record<string, unknown>).map(([k, v]) => (typeof v === 'object' && v ? { id: k, ...(v as object) } : { id: k })) : PATTERN_IDS;
  const out: PatternInfo[] = [];
  for (const r of rows) {
    const o = (typeof r === 'string' ? { id: r } : (r ?? {})) as Record<string, unknown>;
    const id = asText(o.id) as PatternId;
    if (!id) continue;
    const d = PATTERN_DEFAULTS[id] ?? { name: id, colors: ['#ffffff', '#222222'], scale: 4 };
    const cols = [o.colors, o.defaultColors, o.palette, o.defaults].find((c) => Array.isArray(c) && c.length && typeof c[0] === 'string') as string[] | undefined;
    const sc = [o.scale, o.defaultScale].find((v) => typeof v === 'number') as number | undefined;
    out.push({ id, name: asText(o.name) || asText(o.label) || d.name, colors: cols ? [...cols] : [...d.colors], scale: sc ?? d.scale });
  }
  return out.length ? out : PATTERN_IDS.map((id) => ({ id, ...PATTERN_DEFAULTS[id] }));
}

export const colourName = (i: number, count: number) => (i === 0 ? 'Ground' : count === 2 ? 'Pattern' : `Colour ${i + 1}`);

/* ----- pattern tiles (used only until the fabrics agent's patternTile exists) ----- */

export interface PatternTile { size: [number, number]; svg: string }

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const wrap = (w: number, h: number, body: string, bg: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 40}" height="${h * 40}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;

function fallbackTile(p: FabricPattern): PatternTile {
  const c = p.colors.length ? p.colors : ['#ffffff'];
  const g = c[0], a = c[1] ?? '#333333', b = c[2] ?? a;
  const s = Math.max(0.5, p.scale || 4);
  const R = rng(91);
  const tile = (body: string, w = s, h = s): PatternTile => ({ size: [w, h], svg: wrap(w, h, body, g) });
  switch (p.id) {
    case 'stripe': return tile(`<rect x="${s * 0.25}" width="${s * 0.5}" height="${s}" fill="${a}"/>`);
    case 'awning': return tile(`<rect width="${s / 2}" height="${s}" fill="${a}"/>`);
    case 'breton': return tile(`<rect y="0" width="${s}" height="${s / 2}" fill="${a}"/>`);
    case 'pinstripe': { const t = s * 0.05; return tile(`<rect x="${s / 2 - t / 2}" width="${t}" height="${s}" fill="${a}"/>`); }
    case 'gingham': return tile(`<rect width="${s / 2}" height="${s}" fill="${a}" opacity=".5"/><rect width="${s}" height="${s / 2}" fill="${a}" opacity=".5"/>`);
    case 'check': return tile(`<rect width="${s / 2}" height="${s / 2}" fill="${a}"/><rect x="${s / 2}" y="${s / 2}" width="${s / 2}" height="${s / 2}" fill="${a}"/>`);
    case 'plaid': case 'tartan': {
      const L = (x: number, w: number, col: string, o = 1) => `<rect x="${x}" width="${w}" height="${s}" fill="${col}" opacity="${o}"/><rect y="${x}" width="${s}" height="${w}" fill="${col}" opacity="${o}"/>`;
      return tile(L(s * 0.1, s * 0.3, a, 0.55) + L(s * 0.55, s * 0.14, b, 0.6) + L(s * 0.8, s * 0.02, '#ffffff', 0.7) + L(s * 0.25, s * 0.03, g, 0.9));
    }
    case 'windowpane': { const t = s * 0.04; return tile(`<rect x="${s * 0.1}" width="${t}" height="${s}" fill="${a}"/><rect y="${s * 0.1}" width="${s}" height="${t}" fill="${a}"/>`); }
    case 'houndstooth': {
      const q = s / 4;
      let body = '';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) body += `<path d="M${i * q} ${j * q}h${q}l${q * 0.5} ${q}h${-q}z" fill="${a}"/>`;
      return tile(body);
    }
    case 'herringbone': case 'chevron': {
      const sw = p.id === 'chevron' ? s * 0.22 : s * 0.12;
      return tile(`<path d="M0 ${s * 0.25}L${s / 2} ${s * 0.75}L${s} ${s * 0.25}" fill="none" stroke="${a}" stroke-width="${sw}"/><path d="M0 ${s * 1.0}L${s / 2} ${s * 1.5}L${s} ${s}" fill="none" stroke="${a}" stroke-width="${sw}"/>`);
    }
    case 'polka': case 'pindot': {
      const r = s * (p.id === 'polka' ? 0.16 : 0.07);
      return tile(`<circle cx="${s / 4}" cy="${s / 4}" r="${r}" fill="${a}"/><circle cx="${s * 0.75}" cy="${s * 0.75}" r="${r}" fill="${a}"/>`);
    }
    case 'grid': { const t = s * 0.04; return tile(`<rect width="${t}" height="${s}" fill="${a}"/><rect width="${s}" height="${t}" fill="${a}"/>`); }
    case 'camo': {
      let body = '';
      [a, b, c[3] ?? '#222222'].forEach((col, k) => {
        for (let i = 0; i < 7; i++) {
          const x = R() * s, y = R() * s, rx = s * (0.08 + R() * 0.1), ry = rx * (0.5 + R() * 0.6), rot = R() * 180;
          for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]]) body += `<ellipse cx="${x + ox}" cy="${y + oy}" rx="${rx}" ry="${ry}" transform="rotate(${rot + k * 20} ${x + ox} ${y + oy})" fill="${col}"/>`;
        }
      });
      return tile(body);
    }
    case 'floral': {
      const flower = (x: number, y: number, r: number) => {
        let f = '';
        for (let i = 0; i < 5; i++) { const t = (i / 5) * Math.PI * 2; f += `<circle cx="${x + Math.cos(t) * r}" cy="${y + Math.sin(t) * r}" r="${r * 0.7}" fill="${a}"/>`; }
        return f + `<circle cx="${x}" cy="${y}" r="${r * 0.45}" fill="${g}"/><circle cx="${x}" cy="${y}" r="${r * 0.28}" fill="${b}"/>`;
      };
      return tile(`<path d="M${s * 0.2} ${s * 0.9}Q${s * 0.5} ${s * 0.5} ${s * 0.8} ${s * 0.1}" stroke="${b}" stroke-width="${s * 0.03}" fill="none"/>` + flower(s * 0.3, s * 0.3, s * 0.1) + flower(s * 0.75, s * 0.7, s * 0.09));
    }
    case 'paisley': {
      const drop = (x: number, y: number, k: number, col: string) => `<path d="M${x} ${y}c${-k} ${-k * 1.2} ${-k * 0.2} ${-k * 2.6} ${k * 0.9} ${-k * 2.1}c${k * 1.4} ${k * 0.6} ${k * 1.1} ${k * 2.5} ${-k * 0.9} ${k * 2.1}z" fill="${col}"/>`;
      return tile(drop(s * 0.35, s * 0.75, s * 0.14, a) + drop(s * 0.8, s * 0.4, s * 0.1, b));
    }
    case 'animal': {
      let body = '';
      for (let i = 0; i < 9; i++) { const x = R() * s, y = R() * s, r = s * (0.05 + R() * 0.06); body += `<ellipse cx="${x}" cy="${y}" rx="${r * 1.4}" ry="${r}" transform="rotate(${R() * 180} ${x} ${y})" fill="none" stroke="${a}" stroke-width="${r * 0.7}"/>`; }
      return tile(body);
    }
    case 'geo': return tile(`<path d="M0 ${s}L${s / 2} 0L${s} ${s}z" fill="${a}"/><circle cx="${s / 2}" cy="${s * 0.72}" r="${s * 0.1}" fill="${b}"/>`);
    case 'tie-dye': {
      let body = '';
      for (let i = 0; i < 8; i++) body += `<circle cx="${R() * s}" cy="${R() * s}" r="${s * (0.12 + R() * 0.2)}" fill="${i % 2 ? a : b}" opacity=".5"/>`;
      return tile(body);
    }
    case 'heather': {
      let body = '';
      for (let i = 0; i < 70; i++) body += `<circle cx="${R() * s}" cy="${R() * s}" r="${s * 0.02}" fill="${a}" opacity="${0.4 + R() * 0.5}"/>`;
      return tile(body);
    }
    case 'jacquard': return tile(`<path d="M${s / 2} 0L${s} ${s / 2}L${s / 2} ${s}L0 ${s / 2}z" fill="${a}" opacity=".6"/><path d="M${s / 2} ${s * 0.3}L${s * 0.7} ${s / 2}L${s / 2} ${s * 0.7}L${s * 0.3} ${s / 2}z" fill="${g}"/>`);
    default: return tile('');
  }
}

/** One seamless repeat of a pattern: SVG text and its size in cm. */
export function patternTile(p: FabricPattern): PatternTile {
  if (lib.patternTile) { try { return lib.patternTile(p); } catch { /* fall back */ } }
  return fallbackTile(p);
}

export const svgUrl = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

/** CSS for a swatch showing a fabric: its weave texture, a pattern over it when it has one. */
export function swatchStyle(texUrl: string, pattern: FabricPattern | undefined, px: number): CSSProperties {
  if (!pattern || pattern.id === 'solid') return { backgroundImage: `url(${texUrl})`, backgroundSize: 'cover' };
  const t = patternTile(pattern);
  // show about two repeats across the swatch so the pattern reads at any scale
  const size = Math.max(10, Math.min(px / 1.6, (px / 2) * (t.size[0] / Math.max(0.5, Math.min(t.size[0], 10)))));
  return { backgroundImage: `${svgUrl(t.svg)}, url(${texUrl})`, backgroundSize: `${size}px ${(size * t.size[1]) / t.size[0]}px, cover`, backgroundBlendMode: 'multiply' };
}

export function sameFabric(a: PieceFabric | undefined, b: PieceFabric | undefined) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/* ------------------------------------------------------------------ pictures */

/** RGBA pixels. */
export interface Bitmap { w: number; h: number; data: Uint8ClampedArray }

/** Load an image file (or data URL), downscale so the long side is at most `maxPx`. */
export async function prepareImage(src: Blob | string, maxPx = 1024): Promise<Bitmap> {
  const url = typeof src === 'string' ? src : URL.createObjectURL(src);
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('That file is not a picture the browser can open.')); img.src = url; });
    const k = Math.min(1, maxPx / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, w, h);
    return { w, h, data: g.getImageData(0, 0, w, h).data };
  } finally { if (typeof src !== 'string') URL.revokeObjectURL(url); }
}

export function cropBitmap(b: Bitmap, r: { x: number; y: number; w: number; h: number }): Bitmap {
  const x0 = Math.max(0, Math.round(r.x * b.w)), y0 = Math.max(0, Math.round(r.y * b.h));
  const w = Math.max(1, Math.min(b.w - x0, Math.round(r.w * b.w))), h = Math.max(1, Math.min(b.h - y0, Math.round(r.h * b.h)));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(b.data.subarray(((y0 + y) * b.w + x0) * 4, ((y0 + y) * b.w + x0 + w) * 4), y * w * 4);
  return { w, h, data };
}

const dist = (d: Uint8ClampedArray, i: number, c: number[]) => Math.hypot(d[i] - c[0], d[i + 1] - c[1], d[i + 2] - c[2]);

/** Make the background transparent: flood fill from the edges over pixels close to the corner colours. Tolerance 0..100. */
export function removeBackground(b: Bitmap, tolerance: number): Bitmap {
  const { w, h } = b;
  const data = new Uint8ClampedArray(b.data);
  const corner = (cx: number, cy: number) => {
    let r = 0, g = 0, bl = 0, n = 0;
    for (let y = Math.max(0, cy - 2); y <= Math.min(h - 1, cy + 2); y++) for (let x = Math.max(0, cx - 2); x <= Math.min(w - 1, cx + 2); x++) { const i = (y * w + x) * 4; r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++; }
    return [r / n, g / n, bl / n];
  };
  const seeds = [corner(0, 0), corner(w - 1, 0), corner(0, h - 1), corner(w - 1, h - 1)];
  const lim = (tolerance / 100) * 160 + 6;
  const near = (i: number) => data[i + 3] < 16 || seeds.some((c) => dist(data, i, c) <= lim);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => { const p = y * w + x; if (!seen[p] && near(p * 4)) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!, x = p % w, y = (p / w) | 0;
    data[p * 4 + 3] = 0;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  return { w, h, data };
}

export const hasAlpha = (b: Bitmap) => { for (let i = 3; i < b.data.length; i += 4 * 7) if (b.data[i] < 250) return true; return false; };

/** PNG when the picture has see-through parts, else JPEG. */
export function bitmapToDataUrl(b: Bitmap, maxPx = 1024): string {
  const c = document.createElement('canvas');
  c.width = b.w; c.height = b.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.w, b.h), 0, 0);
  const k = Math.min(1, maxPx / Math.max(b.w, b.h));
  let out = c;
  if (k < 1) { out = document.createElement('canvas'); out.width = Math.round(b.w * k); out.height = Math.round(b.h * k); out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height); }
  return hasAlpha(b) ? out.toDataURL('image/png') : out.toDataURL('image/jpeg', 0.88);
}

/** Approximate stored size of a data URL in KB. */
export const dataUrlKb = (u: string) => Math.round((u.length * 3) / 4 / 1024);

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');
const toHex = (c: number[]) => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

export interface Posterized { w: number; h: number; palette: string[]; /** palette index per pixel, 255 = see-through */ index: Uint8Array }

/** Reduce the picture to at most n flat colours (k-means on the opaque pixels). */
export function posterize(b: Bitmap, n: number): Posterized {
  const total = b.w * b.h;
  const idx = new Uint8Array(total).fill(255);
  const opaque: number[] = [];
  for (let p = 0; p < total; p++) if (b.data[p * 4 + 3] >= 128) opaque.push(p);
  if (!opaque.length) return { w: b.w, h: b.h, palette: [], index: idx };
  const step = Math.max(1, Math.floor(opaque.length / 4000));
  const sample: number[][] = [];
  for (let i = 0; i < opaque.length; i += step) { const q = opaque[i] * 4; sample.push([b.data[q], b.data[q + 1], b.data[q + 2]]); }
  const k = Math.max(1, Math.min(n, 12, sample.length));
  const mean = sample.reduce((a, s) => [a[0] + s[0], a[1] + s[1], a[2] + s[2]], [0, 0, 0]).map((v) => v / sample.length);
  const cent: number[][] = [mean];
  while (cent.length < k) {
    let best = sample[0], bd = -1;
    for (const s of sample) { const dmin = Math.min(...cent.map((c) => Math.hypot(s[0] - c[0], s[1] - c[1], s[2] - c[2]))); if (dmin > bd) { bd = dmin; best = s; } }
    cent.push([...best]);
  }
  for (let it = 0; it < 6; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (const s of sample) {
      let bi = 0, bd = Infinity;
      cent.forEach((c, i) => { const d = (s[0] - c[0]) ** 2 + (s[1] - c[1]) ** 2 + (s[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      sum[bi][0] += s[0]; sum[bi][1] += s[1]; sum[bi][2] += s[2]; sum[bi][3]++;
    }
    sum.forEach((s, i) => { if (s[3]) cent[i] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const area = new Array(cent.length).fill(0);
  for (const p of opaque) {
    const q = p * 4;
    let bi = 0, bd = Infinity;
    for (let i = 0; i < cent.length; i++) { const c = cent[i]; const d = (b.data[q] - c[0]) ** 2 + (b.data[q + 1] - c[1]) ** 2 + (b.data[q + 2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } }
    idx[p] = bi; area[bi]++;
  }
  // biggest colour first, empty colours dropped
  const order = cent.map((_, i) => i).filter((i) => area[i] > 0).sort((a, c) => area[c] - area[a]);
  const remap = new Uint8Array(cent.length);
  order.forEach((old, ni) => { remap[old] = ni; });
  for (let p = 0; p < total; p++) if (idx[p] !== 255) idx[p] = remap[idx[p]];
  return { w: b.w, h: b.h, palette: order.map((i) => toHex(cent[i])), index: idx };
}

export interface TracedPath { /** palette index */ ci: number; /** SVG path in the unit box -0.5..0.5, fill rule evenodd */ d: string }

type V = [number, number];

/** Outline loops of a binary mask (cell edges), simplified. */
function maskLoops(mask: Uint8Array, w: number, h: number): V[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : mask[y * w + x]);
  const next = new Map<number, number[]>(); // start vertex -> end vertices
  const key = (x: number, y: number) => y * (w + 1) + x;
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => { const k = key(x0, y0); (next.get(k) ?? next.set(k, []).get(k)!).push(key(x1, y1)); };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) addEdge(x, y, x + 1, y);
    if (!at(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
    if (!at(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
    if (!at(x - 1, y)) addEdge(x, y + 1, x, y);
  }
  const loops: V[][] = [];
  for (const [start] of next) {
    while (next.get(start)?.length) {
      const loop: V[] = [];
      let cur = start;
      for (let guard = 0; guard < 400000; guard++) {
        const outs = next.get(cur);
        if (!outs?.length) break;
        const nx = outs.pop()!;
        loop.push([cur % (w + 1), Math.floor(cur / (w + 1))]);
        cur = nx;
        if (cur === start) break;
      }
      if (loop.length >= 4) loops.push(loop);
    }
  }
  return loops;
}

function simplify(pts: V[], eps: number): V[] {
  if (pts.length < 5) return pts;
  // drop collinear runs first, then Douglas Peucker on the closed loop split in two
  const dp = (a: V[], e: number): V[] => {
    if (a.length < 3) return a;
    const [x1, y1] = a[0], [x2, y2] = a[a.length - 1];
    const L = Math.hypot(x2 - x1, y2 - y1) || 1;
    let md = 0, mi = 0;
    for (let i = 1; i < a.length - 1; i++) { const d = Math.abs((y2 - y1) * a[i][0] - (x2 - x1) * a[i][1] + x2 * y1 - y2 * x1) / L; if (d > md) { md = d; mi = i; } }
    if (md <= e) return [a[0], a[a.length - 1]];
    return [...dp(a.slice(0, mi + 1), e).slice(0, -1), ...dp(a.slice(mi), e)];
  };
  const half = Math.floor(pts.length / 2);
  const A = dp(pts.slice(0, half + 1), eps), B = dp([...pts.slice(half), pts[0]], eps);
  return [...A.slice(0, -1), ...B.slice(0, -1)];
}

const areaOf = (l: V[]) => { let a = 0; for (let i = 0; i < l.length; i++) { const p = l[i], q = l[(i + 1) % l.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };

/** Smooth closed loop as a path: quadratic curves through segment midpoints. */
function loopPath(l: V[], w: number, h: number): string {
  const f = (v: V) => [(v[0] / w - 0.5), (v[1] / h - 0.5)].map((n) => Math.round(n * 1e4) / 1e4);
  const mid = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const n = l.length;
  const m0 = f(mid(l[n - 1], l[0]));
  let d = `M${m0[0]} ${m0[1]}`;
  for (let i = 0; i < n; i++) { const c = f(l[i]), m = f(mid(l[i], l[(i + 1) % n])); d += `Q${c[0]} ${c[1]} ${m[0]} ${m[1]}`; }
  return d + 'Z';
}

/** Trace each colour of a posterized picture into smooth outlines. Works on at most about 150 px. */
export function traceToPaths(p: Posterized): TracedPath[] {
  const k = Math.min(1, 150 / Math.max(p.w, p.h));
  const w = Math.max(1, Math.round(p.w * k)), h = Math.max(1, Math.round(p.h * k));
  const small = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) small[y * w + x] = p.index[Math.min(p.h - 1, Math.floor(y / k)) * p.w + Math.min(p.w - 1, Math.floor(x / k))];
  const out: TracedPath[] = [];
  p.palette.forEach((_, ci) => {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < mask.length; i++) mask[i] = small[i] === ci ? 1 : 0;
    const d = maskLoops(mask, w, h).map((l) => simplify(l, 0.75)).filter((l) => l.length >= 3 && Math.abs(areaOf(l)) >= 5).map((l) => loopPath(l, w, h)).join('');
    if (d) out.push({ ci, d });
  });
  return out;
}

/** The outline of everything that is not see-through, as one path (for cutting the shape from fabric). */
export function traceSilhouette(p: Posterized): string {
  const q: Posterized = { ...p, palette: ['#000'], index: p.index.map((v) => (v === 255 ? 255 : 0)) as unknown as Uint8Array };
  return traceToPaths(q)[0]?.d ?? '';
}

/** Layers for a traced picture: one 'path' layer per colour, w x h cm. `colors` overrides the palette (edited colours). */
export function toLayers(paths: TracedPath[], palette: string[], w: number, h: number): ShapeLayer[] {
  return paths.map((t) => ({ id: uid(), shape: 'path', x: 0, y: 0, w, h, rotation: 0, color: palette[t.ci] ?? '#000000', path: t.d }));
}

/* ------------------------------------------------------------------ total symmetry */

/**
 * The points that move together with `pointId` on `pieceId` when Total symmetry is on: the same point on every mating
 * piece (both legs front and back, front and back bodies, both sleeves). Matched by anchor tag, else by position in the
 * outline. Used only to highlight; the move itself is the store's.
 */
/** Points that move with the dragged one under total symmetry (src/data/symmetry.ts), for highlighting. */
export function linkedPoints(pieces: import('../data/presets').Piece[], pieceId: string, pointId: string, style?: import('../data/catalog').StyleId): { pieceId: string; pointId: string }[] {
  if (!style) return [];
  return linkedMoves(style, pieces, pieceId, pointId, 0.5, 0.5)
    .filter((m) => !(m.pieceId === pieceId && m.pointId === pointId))
    .map((m) => ({ pieceId: m.pieceId, pointId: m.pointId }));
}

/** A copy of the picture scaled so the long side is at most maxPx. */
export function downscale(b: Bitmap, maxPx: number): Bitmap {
  const k = Math.min(1, maxPx / Math.max(b.w, b.h));
  if (k >= 1) return b;
  const w = Math.max(1, Math.round(b.w * k)), h = Math.max(1, Math.round(b.h * k));
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.min(b.w - 1, Math.floor(x / k)), sy = Math.min(b.h - 1, Math.floor(y / k));
    data.set(b.data.subarray((sy * b.w + sx) * 4, (sy * b.w + sx) * 4 + 4), (y * w + x) * 4);
  }
  return { w, h, data };
}

/** Event that opens the photo sheet. detail.target = where it was dropped (a piece, a spot in its own frame, the copy). */
export const PHOTO_EVENT = 'tps-photo';
export interface PhotoTarget { pieceId: string; x: number; y: number; instance?: number }
export const openPhoto = (file: Blob, target?: PhotoTarget) => window.dispatchEvent(new CustomEvent(PHOTO_EVENT, { detail: { file, target } }));
export const imageFileOf = (files: FileList | File[] | null | undefined): File | null => Array.from(files ?? []).find((f) => f.type.startsWith('image/')) ?? null;
