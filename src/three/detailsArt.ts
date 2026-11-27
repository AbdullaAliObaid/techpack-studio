import type { ShapeLayer } from '../data/edits';
import { SHAPES } from '../lib/shapes';

// Shared artwork painting for prints, embroidery, tags and trim faces: every ShapeLayer kind in one place.
//   shape 'image'  the picture (data URL) drawn into the layer box w x h, opacity and flip respected. Decoded once and
//                  cached; until it has decoded nothing is drawn and the art version below changes when it has.
//   shape 'path'   the traced SVG path in the unit box -0.5..0.5, filled evenodd
//   text / library shapes as before
// Painting always happens in a cm (or normalised) space the caller has set up; layer x, y, rotation, flip are applied here.

const rad = (d: number) => (d * Math.PI) / 180;

/** Font styles of text layers. The Design workspace sets `font` on a layer; without it the bold system face is used. */
export const FONT_STACKS: Record<string, string> = {
  classic: `700 {h}px Georgia, 'Times New Roman', serif`,
  varsity: `900 {h}px Rockwell, 'Roboto Slab', 'Arial Black', serif`,
  script: `italic 700 {h}px 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', cursive`,
  block: `900 {h}px Impact, 'Arial Black', sans-serif`,
  mono: `700 {h}px 'SF Mono', Menlo, Consolas, monospace`,
};
/** canvas font for a text layer of height h */
export const fontOf = (l: ShapeLayer, h: number) => (FONT_STACKS[(l as { font?: string }).font ?? ''] ?? '700 {h}px system-ui, sans-serif').replace('{h}', String(h));

/* ---------- art version: bumps whenever an image or pattern tile finishes decoding, so painters can repaint ---------- */
let version = 0;
const subs = new Set<() => void>();
export const artVersion = () => version;
export const subscribeArt = (cb: () => void) => { subs.add(cb); return () => { subs.delete(cb); }; };
export function bumpArt() { version++; subs.forEach((f) => f()); }

/* ---------- decoded pictures ---------- */
interface Pic { img: HTMLImageElement; ok: boolean; failed: boolean }
const pics = new Map<string, Pic>();
const MAX_PICS = 24;

/** The decoded picture, or null while it is still decoding (or broken). */
export function getImage(src: string | undefined): HTMLImageElement | null {
  if (!src) return null;
  let p = pics.get(src);
  if (p) {
    pics.delete(src); pics.set(src, p); // most recently used last
    return p.ok ? p.img : null;
  }
  const img = new Image();
  p = { img, ok: false, failed: false };
  const pic = p;
  img.onload = () => { pic.ok = true; bumpArt(); };
  img.onerror = () => { pic.failed = true; };
  img.decoding = 'async';
  img.src = src;
  pics.set(src, p);
  if (pics.size > MAX_PICS) pics.delete(pics.keys().next().value!);
  return p.ok ? img : null;
}

export const isPicture = (l: ShapeLayer) => l.shape === 'image' && !!l.image;
export const hasPictures = (layers: ShapeLayer[]) => layers.some(isPicture);

/* ---------- vector paths ---------- */
const paths = new Map<string, Path2D>();
/** the layer's outline in the unit box (library shape or traced path); null for text, pictures and empty paths */
export function unitPath(l: ShapeLayer): Path2D | null {
  if (l.shape === 'text' || l.shape === 'image') return null;
  const d = l.shape === 'path' ? l.path : SHAPES[l.shape]?.d;
  if (!d) return null;
  let p = paths.get(d);
  if (!p) {
    try { p = new Path2D(d); } catch { return null; }
    paths.set(d, p);
    if (paths.size > 200) paths.delete(paths.keys().next().value!);
  }
  return p;
}
export const fillRuleOf = (l: ShapeLayer): CanvasFillRule => (l.shape === 'path' ? 'evenodd' : 'nonzero');

/**
 * Paint one layer at its place in the current space. `fill` is the colour or pattern for vector layers.
 * pass 'height' skips pictures (they have no relief of their own).
 */
export function drawLayer(ctx: CanvasRenderingContext2D, l: ShapeLayer, fill: string | CanvasPattern, pass: 'color' | 'height' = 'color') {
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(rad(l.rotation));
  if (l.flipX) ctx.scale(-1, 1);
  ctx.globalAlpha *= l.opacity ?? 1;
  ctx.fillStyle = fill;
  if (l.shape === 'text') {
    if (l.text) {
      ctx.font = fontOf(l, Math.max(0.02, l.h));
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, 0, 0, Math.max(0.02, l.w));
    }
  } else if (l.shape === 'image') {
    const img = pass === 'color' ? getImage(l.image) : null;
    if (img) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, -l.w / 2, -l.h / 2, l.w, l.h);
    }
  } else {
    const p = unitPath(l);
    if (p) {
      ctx.scale(l.w, l.h);
      ctx.fill(p, fillRuleOf(l));
    }
  }
  ctx.restore();
}
