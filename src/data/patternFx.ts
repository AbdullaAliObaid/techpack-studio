// Pattern colour tools: list the colours of a pattern, hide or recolour them, and match them to the garment.
// Pure functions only (no DOM), so the 2D chart, the 3D cloth, the tech pack and the tests all agree.
import type { FabricPattern } from './fabrics';

export interface Bitmap { w: number; h: number; data: Uint8ClampedArray | Uint8Array | number[] }

const HEX = /^#[0-9a-f]{6}$/i;
const toRgb = (h: string): [number, number, number] => {
  const v = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1);
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0) as [number, number, number];
};
const hx = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/* ---- OKLCH ---- */
const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const gam = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055);
export function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = toRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}
export function fromOklch(L: number, C: number, H: number): string {
  // pull chroma in until the colour fits in sRGB
  for (let c = C; c >= 0; c -= 0.005) {
    const a = c * Math.cos((H * Math.PI) / 180), b = c * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    if ([r, g, bb].every((v) => v >= -0.0005 && v <= 1.0005)) return hx(gam(r), gam(g), gam(bb));
  }
  return hx(gam(L ** 3), gam(L ** 3), gam(L ** 3));
}
export const lightness = (hex: string) => toOklch(hex)[0];

/* ---- the colours of a pattern ---- */

/** Colours the person can hide or recolour: the pattern's own colours (not the ground), or the motif's colours. */
export function patternColours(p: FabricPattern): { index: number; hex: string }[] {
  if (p.id === 'custom') {
    const base = p.motif?.palette ?? [...new Set((p.motif?.paths ?? []).map((q) => q.color))];
    return base.slice(0, 8).map((hex, index) => ({ index, hex: (p.recolor?.[index] && HEX.test(p.recolor[index]) ? p.recolor[index] : hex).toLowerCase() }));
  }
  return p.colors.slice(1).map((hex, i) => ({ index: i + 1, hex }));
}
export const isHidden = (p: FabricPattern, i: number) => !!p.hidden?.includes(i);

/** Colours as the tile draws them: a hidden colour is drawn as the base cloth colour (colour 0), so the cloth shows through. */
export function drawnColours(p: FabricPattern): string[] {
  return p.colors.map((c, i) => (i > 0 && p.id !== 'custom' && isHidden(p, i) ? p.colors[0] : c));
}

/* ---- quantise and edit a picture ---- */

/** At most `max` distinct colours of a picture, most used first (opaque pixels only). */
export function quantizePalette(b: Bitmap, max = 8): string[] {
  const bins = new Map<number, { n: number; r: number; g: number; bl: number }>();
  const step = Math.max(1, Math.floor((b.w * b.h) / 40000));
  for (let i = 0; i < b.w * b.h; i += step) {
    const o = i * 4;
    if (b.data[o + 3] < 40) continue;
    const key = ((b.data[o] >> 4) << 8) | ((b.data[o + 1] >> 4) << 4) | (b.data[o + 2] >> 4);
    const e = bins.get(key) ?? { n: 0, r: 0, g: 0, bl: 0 };
    e.n++; e.r += b.data[o]; e.g += b.data[o + 1]; e.bl += b.data[o + 2];
    bins.set(key, e);
  }
  const all = [...bins.values()].sort((a, c) => c.n - a.n).map((e) => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.bl / e.n] as [number, number, number] }));
  const picked: { n: number; c: [number, number, number] }[] = [];
  for (const e of all) {
    const near = picked.find((q) => Math.hypot(q.c[0] - e.c[0], q.c[1] - e.c[1], q.c[2] - e.c[2]) < 48);
    if (near) { near.n += e.n; continue; }
    if (picked.length < max) picked.push({ ...e });
    else { // fold into the nearest kept colour
      let best = picked[0], bd = Infinity;
      for (const q of picked) { const d = Math.hypot(q.c[0] - e.c[0], q.c[1] - e.c[1], q.c[2] - e.c[2]); if (d < bd) { bd = d; best = q; } }
      best.n += e.n;
    }
  }
  return picked.sort((a, c) => c.n - a.n).map((q) => hx(q.c[0], q.c[1], q.c[2]));
}

/** A copy of the picture with palette colours hidden (made transparent) or recoloured; other pixels keep their look. */
export function applyColourEdits(b: Bitmap, palette: string[], hidden: number[] = [], recolor: (string | undefined)[] = []): Bitmap {
  const out = new Uint8ClampedArray(b.w * b.h * 4);
  const pal = palette.map(toRgb);
  for (let i = 0; i < b.w * b.h; i++) {
    const o = i * 4;
    let r = b.data[o], g = b.data[o + 1], bl = b.data[o + 2], a = b.data[o + 3];
    if (a >= 40 && pal.length) {
      let k = 0, bd = Infinity;
      for (let j = 0; j < pal.length; j++) { const d = (pal[j][0] - r) ** 2 + (pal[j][1] - g) ** 2 + (pal[j][2] - bl) ** 2; if (d < bd) { bd = d; k = j; } }
      if (hidden.includes(k)) a = 0;
      else if (recolor[k] && HEX.test(recolor[k]!)) {
        // keep the shading of the pixel against its palette colour so soft edges and texture survive
        const to = toRgb(recolor[k]!);
        r = to[0] + (r - pal[k][0]); g = to[1] + (g - pal[k][1]); bl = to[2] + (bl - pal[k][2]);
      }
    }
    out[o] = r; out[o + 1] = g; out[o + 2] = bl; out[o + 3] = a;
  }
  return { w: b.w, h: b.h, data: out };
}

/* ---- match the garment ---- */

/** Distinct colours, with lightness variants added until there are at least `n`, sorted dark to light. */
function spread(palette: string[], n: number): string[] {
  const set = [...new Set(palette.filter((c) => HEX.test(c)).map((c) => c.toLowerCase()))];
  if (!set.length) return [];
  const out = [...set];
  for (let k = 1; out.length < n && k < 8; k++) {
    for (const c of set) {
      if (out.length >= n) break;
      const [L, C, H] = toOklch(c);
      out.push(fromOklch(Math.min(0.97, Math.max(0.12, L + (k % 2 ? 0.14 : -0.14) * Math.ceil(k / 2))), C, H));
    }
  }
  return out.sort((a, b) => lightness(a) - lightness(b));
}

/**
 * Recolour `colors` from `palette` by lightness order: the darkest pattern colour gets the darkest palette colour, the
 * lightest the lightest, the rest in between, so contrast survives. Result is in the order of `colors`.
 */
export function matchPalette(colors: string[], palette: string[]): string[] {
  if (!colors.length) return [];
  const pal = spread(palette, colors.length);
  if (!pal.length) return colors.slice();
  const order = colors.map((c, i) => ({ i, L: lightness(c) })).sort((a, b) => a.L - b.L);
  const out = colors.slice();
  order.forEach((e, rank) => { out[e.i] = pal[order.length === 1 ? Math.floor((pal.length - 1) / 2) : Math.round((rank * (pal.length - 1)) / (order.length - 1))]; });
  return out;
}

export interface Colourway { id: 'garment' | 'analogous' | 'contrast' | 'tonal'; name: string; colors: string[] }

/** Suggested colourways for `colors` (the colours to replace) from the garment palette: first colour of palette is the main cloth. */
export function colourways(colors: string[], palette: string[]): Colourway[] {
  if (!palette.length || !colors.length) return [];
  const [L, C, H] = toOklch(palette[0]);
  const n = Math.max(colors.length, 2);
  const ramp = (hue: (k: number) => number, chroma: number) => Array.from({ length: n }, (_, k) => fromOklch(0.25 + (0.62 * k) / (n - 1), chroma, hue(k)));
  const c = Math.max(0.05, Math.min(0.16, C || 0.08));
  return [
    { id: 'garment', name: 'Garment colours', colors: matchPalette(colors, palette) },
    { id: 'analogous', name: 'Neighbours', colors: matchPalette(colors, ramp((k) => H + (k % 2 ? 30 : -30), c)) },
    { id: 'contrast', name: 'Contrast', colors: matchPalette(colors, ramp((k) => (k % 2 ? H + 180 : H), c * 1.2)) },
    { id: 'tonal', name: 'Same colour, lighter and darker', colors: matchPalette(colors, ramp(() => H, Math.min(c, Math.max(0.03, C))).map((x, k) => (k === 0 && L < 0.3 ? x : x))) },
  ];
}
