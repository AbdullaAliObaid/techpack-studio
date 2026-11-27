/// <reference types="vite/client" />
// Local fallbacks for the pieces other agents deliver (outfit store actions, repeat detection, share files, body preset
// storage). Everything here is re-exported from editHelpers.ts. When the real module or action exists it wins:
// lib modules are looked up with import.meta.glob (empty when the file is missing), store actions are only installed
// when the store has none. Swapping in the real thing later touches only this file.

import { useStore, type Project, type Outfit, type OutfitItem, type BodyPreset, type ShareFile } from '../store';
import type { Body } from '../three/body';
import { FEMALE_BODY, MALE_BODY } from '../three/body';
import type { PatternMotif, RepeatLayout, FabricPattern } from '../data/fabrics';
import { fabricById } from '../data/fabrics';
import { fabricDataUrl } from '../lib/textures';
import { listProjects, saveProject } from '../lib/projects';
import { uid } from '../lib/units';
import { migrateGarment } from '../data/catalog';
import { prepareImage, removeBackground, cropBitmap as cropFrac, bitmapToDataUrl, hasAlpha, posterize, traceToPaths, type Bitmap } from './shims';

/* ------------------------------------------------------------------ body presets */

const BODIES_KEY = 'techit.bodies.v1';
export const BUILTIN_BODIES: BodyPreset[] = [
  { id: 'builtin-male', name: 'Male', body: MALE_BODY, updatedAt: 0 },
  { id: 'builtin-female', name: 'Female', body: FEMALE_BODY, updatedAt: 0 },
];
const real = {
  lib: import.meta.glob('../lib/projects.ts', { eager: true }) as Record<string, Record<string, unknown>>,
  repeat: import.meta.glob('../lib/repeat.ts', { eager: true }) as Record<string, Record<string, unknown>>,
  share: import.meta.glob('../lib/share.ts', { eager: true }) as Record<string, Record<string, unknown>>,
};
const first = (o: Record<string, Record<string, unknown>>) => Object.values(o)[0] as Record<string, unknown> | undefined;

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}
function writeJson(key: string, v: unknown) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage blocked */ } }

/** The user's saved bodies (never the built-ins). */
export function listBodyPresets(): BodyPreset[] {
  const fn = first(real.lib)?.listBodyPresets as (() => BodyPreset[]) | undefined;
  return (fn ? fn() : readJson<BodyPreset[]>(BODIES_KEY, [])).filter((b) => !b.id.startsWith('builtin'));
}
/** Save measurements under a name; with the id of a saved body it is updated. */
export function saveBodyPreset(name: string, body: Body, id?: string): BodyPreset {
  const fn = first(real.lib)?.saveBodyPreset as ((n: string, b: Body, id?: string) => BodyPreset) | undefined;
  if (fn) return fn(name, body, id);
  const keep = id && !id.startsWith('builtin') ? id : uid() + uid();
  const preset: BodyPreset = { id: keep, name: name.trim().slice(0, 60) || 'Untitled body', body: { ...body }, updatedAt: Date.now() };
  writeJson(BODIES_KEY, [...readJson<BodyPreset[]>(BODIES_KEY, []).filter((q) => q.id !== keep), preset]);
  return preset;
}
export function renameBodyPreset(id: string, name: string) {
  const fn = first(real.lib)?.renameBodyPreset as ((id: string, name: string) => void) | undefined;
  if (fn) return fn(id, name);
  writeJson(BODIES_KEY, readJson<BodyPreset[]>(BODIES_KEY, []).map((q) => (q.id === id ? { ...q, name, updatedAt: Date.now() } : q)));
}
export function deleteBodyPreset(id: string) {
  const fn = first(real.lib)?.deleteBodyPreset as ((id: string) => void) | undefined;
  if (fn) return fn(id);
  writeJson(BODIES_KEY, readJson<BodyPreset[]>(BODIES_KEY, []).filter((q) => q.id !== id));
}
/** Built-ins first, then the user's, newest first. */
export const allBodyPresets = (): BodyPreset[] => [...BUILTIN_BODIES, ...listBodyPresets().sort((a, b) => b.updatedAt - a.updatedAt)];

/** Same measurements? (compares the numbers, ignores key order) */
export function sameBody(a: Body, b: Body): boolean {
  const ka = Object.keys(a) as (keyof Body)[];
  const kb = Object.keys(b) as (keyof Body)[];
  const all = new Set([...ka, ...kb]);
  for (const k of all) { if (a[k] !== b[k]) return false; }
  return true;
}

/* ------------------------------------------------------------------ outfits */

const OUTFITS_KEY = 'techit.outfits.v1';
export function listOutfits(): Outfit[] {
  const fn = first(real.lib)?.listOutfits as (() => Outfit[]) | undefined;
  return (fn ? fn() : readJson<Outfit[]>(OUTFITS_KEY, [])).slice().sort((a, b) => b.updatedAt - a.updatedAt);
}
export function saveOutfit(o: Outfit) {
  const fn = first(real.lib)?.saveOutfit as ((o: Outfit) => void) | undefined;
  if (fn) return fn(o);
  writeJson(OUTFITS_KEY, [...readJson<Outfit[]>(OUTFITS_KEY, []).filter((q) => q.id !== o.id), o]);
}
export function deleteOutfit(id: string) {
  const fn = first(real.lib)?.deleteOutfit as ((id: string) => void) | undefined;
  if (fn) return fn(id);
  writeJson(OUTFITS_KEY, readJson<Outfit[]>(OUTFITS_KEY, []).filter((q) => q.id !== id));
}

/** The contract of the outfit agent, as the UI sees it (all optional until the store has them). */
export interface OutfitApi {
  outfit: Outfit | null;
  activeItem: string | null;
  newOutfit: (name: string, body: Body) => string | void;
  addToOutfit: (projectId: string) => void;
  removeFromOutfit: (projectId: string) => void;
  setOutfitLayer: (projectId: string, layer: number) => void;
  setTuck: (projectId: string, tuck: 'in' | 'out') => void;
  setOutfitBody: (body: Body) => void;
  openOutfit: (id: string) => void;
  /** UI only: show or hide one garment in the 3D view */
  setItemHidden?: (projectId: string, hidden: boolean) => void;
  setActiveItem?: (projectId: string) => void;
}
export const outfitApi = () => useStore.getState() as unknown as OutfitApi;
export const useOutfit = (): Outfit | null => useStore((s) => (s as unknown as OutfitApi).outfit ?? null);
export const useActiveItem = (): string | null => useStore((s) => (s as unknown as OutfitApi).activeItem ?? null);

/** Items in layer order, skin side first. */
export const byLayer = (items: OutfitItem[]) => items.slice().sort((a, b) => a.layer - b.layer);

function persistOutfit(o: Outfit | null) { if (o) saveOutfit({ ...o, updatedAt: Date.now() }); }

/** Install same-named outfit actions when the store has none (the outfit agent's work is merged later). */
export function installOutfitFallback() {
  const st = useStore.getState() as unknown as Partial<OutfitApi>;
  if (typeof st.newOutfit === 'function') return;
  const get = () => useStore.getState() as unknown as OutfitApi;
  const put = (fn: (o: Outfit) => Outfit) => {
    const o = get().outfit;
    if (!o) return;
    const next = fn(o);
    useStore.setState({ outfit: { ...next, updatedAt: Date.now() } } as never);
    persistOutfit(next);
  };
  useStore.setState({
    outfit: null,
    activeItem: null,
    newOutfit: (name: string, body: Body) => {
      const o: Outfit = { id: uid(), name, body: { ...body }, items: [], updatedAt: Date.now() };
      useStore.setState({ outfit: o, activeItem: null } as never);
      persistOutfit(o);
      return o.id;
    },
    addToOutfit: (projectId: string) => put((o) => (o.items.some((i) => i.projectId === projectId) ? o : { ...o, items: [...o.items, { projectId, layer: o.items.length, tuck: 'out' }] })),
    removeFromOutfit: (projectId: string) => put((o) => ({ ...o, items: o.items.filter((i) => i.projectId !== projectId).map((i, n) => ({ ...i, layer: n })) })),
    setOutfitLayer: (projectId: string, layer: number) => put((o) => {
      const sorted = byLayer(o.items);
      const from = sorted.findIndex((i) => i.projectId === projectId);
      if (from < 0) return o;
      const [it] = sorted.splice(from, 1);
      sorted.splice(Math.max(0, Math.min(sorted.length, layer)), 0, it);
      return { ...o, items: sorted.map((i, n) => ({ ...i, layer: n })) };
    }),
    setTuck: (projectId: string, tuck: 'in' | 'out') => put((o) => ({ ...o, items: o.items.map((i) => (i.projectId === projectId ? { ...i, tuck } : i)) })),
    setItemHidden: (projectId: string, hidden: boolean) => put((o) => ({ ...o, items: o.items.map((i) => (i.projectId === projectId ? { ...i, hidden } : i)) })),
    setOutfitBody: (body: Body) => put((o) => ({ ...o, body: { ...body } })),
    setActiveItem: (projectId: string) => {
      const p = listProjects().find((q) => q.id === projectId);
      const cur = useStore.getState().project;
      if (cur.id === projectId) { useStore.setState({ activeItem: projectId } as never); return; }
      saveProject(cur);
      if (p) { useStore.getState().loadProject(p); useStore.setState({ activeItem: projectId } as never); }
    },
    openOutfit: (id: string) => {
      const o = listOutfits().find((q) => q.id === id);
      if (!o) return;
      useStore.setState({ outfit: o } as never);
      const first = byLayer(o.items)[0];
      if (first) get().setActiveItem?.(first.projectId);
    },
  } as never);
}

export function leaveOutfit() {
  if (outfitApi().outfit) useStore.setState({ outfit: null, activeItem: null } as never);
}

/** crop in pixels (shims.cropBitmap takes fractions of the picture) */
function cropBitmap(b: Bitmap, r: { x: number; y: number; w: number; h: number }): Bitmap {
  return cropFrac(b, { x: r.x / b.w, y: r.y / b.h, w: r.w / b.w, h: r.h / b.h });
}

/* ------------------------------------------------------------------ repeat detection (fallback) */

export interface RepeatInfo {
  /** the photo had no full vertical repeat: the tile uses the whole height with blended top and bottom edges */
  seamY?: boolean; repeating: boolean; /** repeat tile in source pixels */ tile?: { w: number; h: number }; confidence: number }

/** Is this picture a repeating pattern? Self similarity over horizontal and vertical shifts on a small grey copy. */
export async function detectRepeatLocal(b: Bitmap): Promise<RepeatInfo> {
  const N = 96;
  const g = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const sx = Math.min(b.w - 1, Math.floor((x / N) * b.w)), sy = Math.min(b.h - 1, Math.floor((y / N) * b.h));
    const i = (sy * b.w + sx) * 4;
    g[y * N + x] = (0.3 * b.data[i] + 0.59 * b.data[i + 1] + 0.11 * b.data[i + 2]) * (b.data[i + 3] / 255) / 255;
  }
  let mean = 0; for (const v of g) mean += v; mean /= g.length;
  let varr = 0; for (const v of g) varr += (v - mean) ** 2; varr /= g.length;
  if (varr < 1e-4) return { repeating: false, confidence: 0 };
  const err = (dx: number, dy: number) => {
    let s = 0, n = 0;
    for (let y = 0; y < N - dy; y++) for (let x = 0; x < N - dx; x++) { const d = g[y * N + x] - g[(y + dy) * N + x + dx]; s += d * d; n++; }
    return s / n / (2 * varr);
  };
  const lo = 5, hi = Math.floor(N / 2.2);
  let bx = 0, bxe = 9, by = 0, bye = 9;
  for (let d = lo; d <= hi; d++) { const e = err(d, 0); if (e < bxe) { bxe = e; bx = d; } const f = err(0, d); if (f < bye) { bye = f; by = d; } }
  // a repeat needs a clear match in at least one direction and the picture to hold three or more repeats across
  // the next multiple of the period must match too, or it was one blob and not a repeat
  const again = (d: number, horizontal: boolean) => (2 * d < N - 6 ? (horizontal ? err(2 * d, 0) : err(0, 2 * d)) < 0.5 : true);
  const okx = bxe < 0.3 && again(bx, true), oky = bye < 0.3 && again(by, false);
  if (!okx && !oky) return { repeating: false, confidence: Math.round((1 - Math.min(bxe, bye)) * 100) / 100 };
  const w = okx ? (bx / N) * b.w : b.w, h = oky ? (by / N) * b.h : b.h;
  return { repeating: true, tile: { w: Math.round(w), h: Math.round(h) }, confidence: Math.round((1 - Math.min(okx ? bxe : 1, oky ? bye : 1)) * 100) / 100 };
}

/**
 * Repeat probe that works on short photos (a damask strip with only ~1.3 vertical repeats): find the horizontal
 * period by normalised cross correlation, then a vertical period, or the half drop shift (period/2 across, dy down).
 * Returns the full rectangular repeat tile in source pixels.
 */
export function probeRepeat(b: Bitmap): RepeatInfo {
  const k = Math.max(1, b.w / 220);
  const W = Math.floor(b.w / k), H = Math.floor(b.h / k);
  if (W < 24 || H < 24) return { repeating: false, confidence: 0 };
  const g = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (Math.floor(y * k) * b.w + Math.floor(x * k)) * 4;
    g[y * W + x] = 0.299 * b.data[i] + 0.587 * b.data[i + 1] + 0.114 * b.data[i + 2];
  }
  // light blur so sub pixel periods and fabric texture don't hide the repeat
  const gb = new Float32Array(g);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let t = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) t += g[(y + j) * W + x + i];
    gb[y * W + x] = t / 9;
  }
  g.set(gb);
  const ncc = (dx: number, dy: number) => {
    let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0;
    for (let y = Math.max(0, -dy); y < Math.min(H, H - dy); y++) for (let x = 0; x < W - dx; x++) {
      const a = g[y * W + x], c = g[(y + dy) * W + x + dx];
      sa += a; sb += c; saa += a * a; sbb += c * c; sab += a * c; n++;
    }
    if (n < W * H * 0.15) return -1;
    const cov = sab / n - (sa / n) * (sb / n), va = saa / n - (sa / n) ** 2, vb = sbb / n - (sb / n) ** 2;
    return va > 1e-6 && vb > 1e-6 ? cov / Math.sqrt(va * vb) : -1;
  };
  // horizontal period: the first strong peak
  let px = 0, best = 0;
  for (let dx = Math.floor(W / 8); dx <= Math.floor(W * 0.75); dx++) { const v = ncc(dx, 0); if (v > best) { best = v; px = dx; } }
  if (best < 0.5 || !px) return { repeating: false, confidence: Math.max(0, best) };
  // straight vertical repeat, or a half drop (shift half the width across)
  let vy = 0, vBest = 0, hy = 0, hBest = 0;
  for (let dy = Math.floor(H / 8); dy <= Math.floor(H * 0.8); dy++) {
    const a = ncc(0, dy); if (a > vBest) { vBest = a; vy = dy; }
    for (let dx = Math.round(px / 2) - 2; dx <= Math.round(px / 2) + 2; dx++) { const c = ncc(dx, dy); if (c > hBest) { hBest = c; hy = dy; } }
  }
  let tw = px, th: number;
  if (hBest > 0.55 && hBest >= vBest - 0.05 && 2 * hy <= H) th = 2 * hy;
  else if (vBest > 0.55) th = vy;
  else {
    // a clear repeat across but no full repeat top to bottom in the photo: keep the exact width, use the whole
    // height and blend the top and bottom edges so the tile still joins without a seam
    const w0 = Math.round(px * k);
    return w0 <= b.w ? { repeating: true, tile: { w: w0, h: b.h }, confidence: Math.round(best * 100) / 100, seamY: true } : { repeating: false, confidence: best };
  }
  tw = Math.round(tw * k); th = Math.round(th * k);
  if (tw > b.w || th > b.h) return { repeating: false, confidence: best };
  return { repeating: true, tile: { w: tw, h: th }, confidence: Math.round(Math.min(best, Math.max(hBest, vBest)) * 100) / 100 };
}

export async function detectRepeat(b: Bitmap): Promise<RepeatInfo> {
  const probe = probeRepeat(b);
  const fn = first(real.repeat)?.detectRepeat as ((b: unknown) => unknown) | undefined;
  if (fn) {
    try {
      const r = (await fn(b)) as (Partial<RepeatInfo> & { isRepeat?: boolean; found?: boolean; w?: number; h?: number; layout?: string; tile?: { w: number; h: number } }) | null;
      // src/lib/repeat.ts: {found, w, h, layout, confidence}; w x h is one motif cell. Half drop and brick repeat
      // exactly over two cells, so the seamless tile kept from the photo is 2w x h (half drop) or w x 2h (brick).
      if (r && typeof r.found === 'boolean') {
        if (!r.found || !r.w || !r.h) return probe.repeating ? probe : { repeating: false, confidence: r.confidence ?? 0 };
        const w = r.layout === 'half-drop' ? 2 * r.w : r.w, h = r.layout === 'brick' ? 2 * r.h : r.h;
        if (w > b.w || h > b.h) return { repeating: true, tile: { w: Math.round(r.w), h: Math.round(r.h) }, confidence: r.confidence ?? 0 };
        return { repeating: true, tile: { w: Math.round(w), h: Math.round(h) }, confidence: r.confidence ?? 0 };
      }
      if (r && (typeof r.repeating === 'boolean' || typeof r.isRepeat === 'boolean')) return { repeating: r.repeating ?? !!r.isRepeat, tile: r.tile, confidence: r.confidence ?? 0 };
    } catch { /* use the local detector */ }
  }
  const local = await detectRepeatLocal(b);
  return local.repeating ? local : probe;
}

export interface MotifOptions { tolerance?: number; repeat?: RepeatInfo }

/** The motif as a transparent picture: a repeating photo keeps one repeat tile, a single motif loses its background and is cropped. */
export async function extractMotif(b: Bitmap, opts: MotifOptions = {}): Promise<PatternMotif> {
  const fn = first(real.repeat)?.extractMotif as ((b: unknown, o: unknown) => unknown) | undefined;
  // an upload that already repeats (a damask, a print photo) keeps one full repeat exactly as it looks, ground and
  // texture included; only single motifs lose their background
  if (fn && !opts.repeat?.repeating) {
    try { const m = (await fn(b, opts)) as PatternMotif | null; if (m && (m.image || m.paths)) return m; } catch { /* use the local one */ }
  }
  if (opts.repeat?.repeating && opts.repeat.tile) {
    const t = opts.repeat.tile;
    let tile = cropBitmap(b, { x: Math.round((b.w - t.w) / 2), y: Math.round((b.h - t.h) / 2), w: t.w, h: t.h });
    if (opts.repeat.seamY) tile = blendSeamY(tile, 0.18);
    return { image: bitmapToDataUrl(tile, 768), aspect: tile.w / tile.h, detectedTile: { w: tile.w, h: tile.h } };
  }
  const clear = hasAlpha(b) ? b : removeBackground(b, opts.tolerance ?? 36);
  let x0 = clear.w, y0 = clear.h, x1 = 0, y1 = 0;
  for (let y = 0; y < clear.h; y++) for (let x = 0; x < clear.w; x++) if (clear.data[(y * clear.w + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = clear.w - 1; y1 = clear.h - 1; }
  const crop = cropBitmap(clear, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  return { image: bitmapToDataUrl(crop, 768), aspect: crop.w / crop.h };
}

/** Make a tile join top to bottom: the last `share` of rows is cross faded into the first rows, then dropped. */
function blendSeamY(b: Bitmap, share: number): Bitmap {
  const band = Math.max(2, Math.round(b.h * share)), h = b.h - band;
  const out = new Uint8ClampedArray(b.w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < b.w; x++) {
    const o = (y * b.w + x) * 4, i = (y * b.w + x) * 4;
    if (y < band) {
      const t = y / band, j = ((h + y) * b.w + x) * 4; // rows below the kept area flow into the top
      for (let c = 0; c < 4; c++) out[o + c] = b.data[j + c] * (1 - t) + b.data[i + c] * t;
    } else for (let c = 0; c < 4; c++) out[o + c] = b.data[i + c];
  }
  return { w: b.w, h, data: out };
}

/** Vector copy of a picture motif (up to 3 colours) so it can be recoloured. Null when it does not trace cleanly. */
export function vectoriseMotif(b: Bitmap, colours = 3): PatternMotif['paths'] | null {
  try {
    const small = b.w > 256 ? prepareScaled(b, 256 / b.w) : b;
    const post = posterize(small, colours);
    const paths = traceToPaths(post);
    if (!paths.length || paths.length > 60) return null;
    return paths.map((p) => ({ color: post.palette[p.ci], path: p.d }));
  } catch { return null; }
}
function prepareScaled(b: Bitmap, s: number): Bitmap {
  const w = Math.max(1, Math.round(b.w * s)), h = Math.max(1, Math.round(b.h * s));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (Math.min(b.h - 1, Math.floor(y / s)) * b.w + Math.min(b.w - 1, Math.floor(x / s))) * 4, o = (y * w + x) * 4;
    out[o] = b.data[i]; out[o + 1] = b.data[i + 1]; out[o + 2] = b.data[i + 2]; out[o + 3] = b.data[i + 3];
  }
  return { w, h, data: out };
}

export function suggestLayout(m: PatternMotif, repeating = false): RepeatLayout {
  const fn = first(real.repeat)?.suggestLayout as ((m: PatternMotif) => RepeatLayout) | undefined;
  if (fn) { try { return fn(m); } catch { /* fall through */ } }
  return repeating ? 'block' : m.aspect > 1.6 ? 'brick' : 'half-drop';
}

export { prepareImage };

/* ------------------------------------------------------------------ custom pattern preview (canvas) */

export const LAYOUTS: { id: RepeatLayout; label: string; hint: string }[] = [
  { id: 'block', label: 'Block', hint: 'Rows and columns, straight' },
  { id: 'half-drop', label: 'Half drop', hint: 'Every other column drops half a repeat' },
  { id: 'brick', label: 'Brick', hint: 'Every other row shifts half a repeat' },
  { id: 'mirror', label: 'Mirror', hint: 'Flipped across each repeat edge' },
  { id: 'turn', label: 'Turn', hint: 'Each repeat turns a quarter' },
  { id: 'scatter', label: 'Scatter', hint: 'Spread out, turned and shifted at random' },
];

const imgCache = new Map<string, { im: HTMLImageElement; cbs: Set<() => void> }>();
/** The decoded picture, or null while it loads (every caller gets its own callback when it is ready). */
function loadImg(src: string, done: () => void): HTMLImageElement | null {
  let hit = imgCache.get(src);
  if (!hit) {
    const im = new Image();
    hit = { im, cbs: new Set() };
    const h = hit;
    im.onload = () => { const l = [...h.cbs]; h.cbs.clear(); l.forEach((f) => f()); };
    im.src = src;
    imgCache.set(src, hit);
  }
  if (hit.im.complete && hit.im.naturalWidth) return hit.im;
  hit.cbs.add(done);
  return null;
}

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/**
 * Draw the repeat into a canvas: `px` pixels per cm. Used for the live preview of the sheet and the small tiles.
 * Returns false while the picture is still decoding (call again from `onReady`).
 */
export function drawCustomPattern(ctx: CanvasRenderingContext2D, w: number, h: number, pat: FabricPattern, ground: string, pxPerCm: number, onReady: () => void): boolean {
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, w, h);
  const m = pat.motif;
  if (!m) return true;
  const cell = Math.max(6, pat.scale * pxPerCm);
  const share = pat.motifScale ?? 0.7;
  const aspect = m.aspect || 1;
  const mw = (aspect >= 1 ? share : share * aspect) * cell, mh = (aspect >= 1 ? share / aspect : share) * cell;
  const rec = pat.recolor && m.paths ? pat.recolor : null;
  let img: HTMLImageElement | null = null;
  if (!rec && m.image) { img = loadImg(m.image, onReady); if (!img) return false; }
  const paths = m.paths?.map((p, i) => ({ p: new Path2D(p.path), c: rec ? rec[i % Math.max(1, rec.length)] ?? p.color : p.color }));
  const draw = (cx: number, cy: number, rot: number, flipX: boolean, flipY: boolean) => {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
    if (rec && paths) {
      ctx.scale(mw, mh);
      for (const q of paths) { ctx.fillStyle = q.c; ctx.fill(q.p, 'evenodd'); }
    } else if (img) ctx.drawImage(img, -mw / 2, -mh / 2, mw, mh);
    ctx.restore();
  };
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(((pat.rotation ?? 0) * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  const span = Math.hypot(w, h);
  const n = Math.ceil(span / cell) + 2;
  const layout = pat.layout ?? 'block';
  const rnd = rng(7);
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    let cx = w / 2 + i * cell, cy = h / 2 + j * cell;
    let rot = 0, fx = false, fy = false;
    if (layout === 'half-drop' && i % 2 !== 0) cy += cell / 2;
    else if (layout === 'brick' && j % 2 !== 0) cx += cell / 2;
    else if (layout === 'mirror') { fx = i % 2 !== 0; fy = j % 2 !== 0; }
    else if (layout === 'turn') rot = (((i + j) % 4) + 4) % 4 * (Math.PI / 2);
    else if (layout === 'scatter') { cx += (rnd() - 0.5) * cell * 0.5; cy += (rnd() - 0.5) * cell * 0.5; rot = (rnd() - 0.5) * 1.4; }
    // a full-cell tile (a photo of a repeat) fills its cell, so it needs no gap
    draw(cx, cy, rot, fx, fy);
  }
  ctx.restore();
  return true;
}

/** Small picture of a custom pattern on the fabric, for tiles and the swatch. */
export function customPatternUrl(pat: FabricPattern, fabricId: string, ground: string, size: number, repeatsOnSwatch = 2.5): string {
  const c = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = c.height = Math.round(size * dpr);
  const ctx = c.getContext('2d')!;
  const f = fabricById(fabricId);
  const tex = new Image();
  void f; void tex; void fabricDataUrl;
  drawCustomPattern(ctx, c.width, c.height, pat, ground, (c.width / (pat.scale * repeatsOnSwatch)), () => undefined);
  return c.toDataURL('image/png');
}

/* ------------------------------------------------------------------ share files */

export const APP_NAME = 'tech-it';
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'project';

export function buildShareFile(projects: Project[], outfits: Outfit[] = [], bodies: BodyPreset[] = []): ShareFile {
  const fn = first(real.share)?.exportShareFile as ((p: Project[], o?: Outfit[], b?: BodyPreset[]) => unknown) | undefined;
  if (fn) { try { const r = fn(projects, outfits, bodies); if (r && typeof r === 'object' && (r as ShareFile).format === 'tech-it') return r as ShareFile; } catch { /* local */ } }
  return { format: 'tech-it', version: 1, exportedAt: Date.now(), app: APP_NAME, projects: structuredClone(projects), ...(outfits.length ? { outfits } : {}), ...(bodies.length ? { bodies } : {}) };
}

export function shareFileBlob(f: ShareFile): Blob { return new Blob([JSON.stringify(f)], { type: 'application/json' }); }

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Save a .techit file with one or more projects. */
export async function exportProjectFile(projects: Project[], outfits: Outfit[] = []) {
  const name = projects.length === 1 ? projects[0].name : outfits[0]?.name ?? 'tech-it projects';
  const ex = first(real.share)?.exportShareFile as ((p: Project[], o?: Outfit[], b?: BodyPreset[]) => Promise<Blob>) | undefined;
  const dl = (first(real.share)?.downloadBlob as typeof downloadBlob | undefined) ?? downloadBlob;
  if (ex) { try { dl(await ex(projects, outfits), `${slug(name)}.techit`); return; } catch { /* local file below */ } }
  downloadBlob(shareFileBlob(buildShareFile(projects, outfits)), `${slug(name)}.techit`);
}

/** Web Share on devices that can share files (iPad), otherwise a download. Returns how it went. */
export async function shareProjects(projects: Project[], outfits: Outfit[] = []): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const one = first(real.share)?.shareProject as ((p: Project) => Promise<'shared' | 'downloaded' | 'cancelled'>) | undefined;
  if (one && projects.length === 1 && !outfits.length) { try { return await one(projects[0]); } catch { /* local share below */ } }
  const name = projects.length === 1 ? projects[0].name : outfits[0]?.name ?? 'tech-it projects';
  const file = new File([shareFileBlob(buildShareFile(projects, outfits))], `${slug(name)}.techit`, { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return 'shared'; } catch (e) { if ((e as Error).name === 'AbortError') return 'cancelled'; }
  }
  downloadBlob(file, file.name);
  return 'downloaded';
}

export interface ImportResult { projects: Project[]; outfits: number; bodies: number }

/** Read a .techit file: each project gets a new id and an `imported` mark, so it never overwrites yours. */
export async function importTechitFile(file: File): Promise<ImportResult> {
  const rd = first(real.share)?.readShareFile as ((f: Blob) => Promise<ShareFile>) | undefined;
  const im = first(real.share)?.importShareFile as ((sf: ShareFile, o: { fileName?: string; saveOutfit?: (o: Outfit) => void; hasProject?: (id: string) => boolean }) => { projects: Project[]; outfits: Outfit[]; bodies: BodyPreset[] }) | undefined;
  if (rd && im) {
    const sf = await rd(file).catch((e: Error) => { throw new Error(e.message || 'This file is not a tech-it project.'); });
    const saved = new Set(listProjects().map((p) => p.id));
    const r = im(sf, { fileName: file.name, saveOutfit, hasProject: (id) => saved.has(id) });
    return { projects: r.projects, outfits: r.outfits.length, bodies: r.bodies.length };
  }
  const text = await file.text();
  let data: ShareFile;
  try { data = JSON.parse(text) as ShareFile; } catch { throw new Error('This file is not a tech-it project.'); }
  if (!data || data.format !== 'tech-it' || !Array.isArray(data.projects)) throw new Error('This file is not a tech-it project.');
  const at = Date.now();
  const remap = new Map<string, string>();
  const projects = data.projects.map((p) => {
    const id = uid();
    remap.set(p.id, id);
    return { ...p, id, garment: migrateGarment(p.garment), linkPattern: p.linkPattern ?? true, imported: { from: data.app && data.app !== APP_NAME ? data.app : p.imported?.from, at, fileName: file.name }, updatedAt: at } as Project;
  });
  for (const p of projects) saveProject(p);
  let outfits = 0;
  for (const o of data.outfits ?? []) {
    const items = o.items.map((i) => ({ ...i, projectId: remap.get(i.projectId) ?? i.projectId }));
    saveOutfit({ ...o, id: uid(), items, updatedAt: at });
    outfits++;
  }
  let bodies = 0;
  for (const b of data.bodies ?? []) { saveBodyPreset(b.name, b.body); bodies++; }
  return { projects, outfits, bodies };
}
