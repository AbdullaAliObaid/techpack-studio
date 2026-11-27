// One artwork, three ways to make it: Print (ink on the piece), Embroidery (thread stitched in) and Appliqué (cut from
// fabric and sewn on). The stored kinds stay 'print', 'embroidery' and 'applique', so old projects load as they are.
// This file makes the same artwork (a shape, letters or a stripe) for any method and converts a placed one in place.
import type { Attachment, ShapeId } from '../data/edits';
import { SHAPES } from '../lib/shapes';
import type { ShapeLayer } from '../data/edits';
import { fabricById } from '../data/fabrics';
import { uid } from '../lib/units';
import type { AttachTemplate } from './editHelpers';
import type { DesignOpts } from './designLibrary';

// (kept free of editHelpers and designLibrary values so tests can import it without the browser-only store pieces)
const layer = (shape: ShapeId, over: Partial<ShapeLayer> = {}): ShapeLayer => ({ id: uid(), shape, x: 0, y: 0, w: 4, h: 4, rotation: 0, color: '#000000', opacity: 1, ...over });
/** Block capitals, width follows the number of letters. */
export const clean = (t: string) => (t.toUpperCase().replace(/[^A-Z0-9 &!?.\-+]/g, '').slice(0, 12) || 'A');
export const textWidth = (t: string, h: number) => Math.max(h * 0.8, clean(t).length * h * 0.72);
const SIZE: Partial<Record<ShapeId, [number, number]>> = { chevron: [8, 5], bolt: [5, 8], cross: [6, 6], rect: [6, 6], rounded: [6, 6] };
const sizeOf = (s: ShapeId, k = 1): [number, number] => { const [w, h] = SIZE[s] ?? [7, 7]; return [w * k, h * k]; };

export type Method = 'print' | 'embroidery' | 'applique';
export const METHODS: { id: Method; label: string; blurb: string }[] = [
  { id: 'print', label: 'Print', blurb: 'Flat ink on the cloth' },
  { id: 'embroidery', label: 'Embroidery', blurb: 'Satin stitched thread' },
  { id: 'applique', label: 'Appliqué', blurb: 'Cut from fabric and sewn on' },
];
export const isMethod = (k: string): k is Method => k === 'print' || k === 'embroidery' || k === 'applique';

/** the artwork the user picks once */
export type Art = { type: 'shape'; shape: ShapeId } | { type: 'text' } | { type: 'stripe' };
export const artKey = (a: Art) => (a.type === 'shape' ? a.shape : a.type);

/** a ring has a hole, so it cannot be cut from one piece of cloth */
export const methodAllows = (a: Art, m: Method) => !(m === 'applique' && a.type === 'shape' && a.shape === 'ring');

export function makeArtwork(a: Art, m: Method, o: DesignOpts): AttachTemplate {
  const cloth = { thread: o.thread, ...(o.fabric ? { fabric: { ...o.fabric } } : {}) };
  if (a.type === 'shape') {
    const nm = SHAPES[a.shape].name.toLowerCase();
    if (m === 'applique') { const [w, h] = sizeOf(a.shape); return { kind: 'applique', name: `Appliqué ${nm}`, rotation: 0, w, h, outline: 'shape', shape: a.shape, layers: [], ...cloth }; }
    if (m === 'embroidery') { const [w, h] = sizeOf(a.shape, 0.85); return { kind: 'embroidery', name: `Embroidered ${nm}`, rotation: 0, w, h, outline: 'rect', thread: o.thread, layers: [layer(a.shape, { w, h, color: o.thread })] }; }
    const [w, h] = sizeOf(a.shape);
    return { kind: 'print', name: `Printed ${nm}`, rotation: 0, w, h, outline: 'rect', layers: [layer(a.shape, { w, h, color: o.ink })] };
  }
  if (a.type === 'text') {
    const t = clean(o.text);
    if (m === 'applique') { const h = 4; return { kind: 'applique', name: `Appliqué "${t}"`, rotation: 0, w: textWidth(t, h), h, outline: 'shape', shape: 'text', text: t, layers: [], ...cloth }; }
    if (m === 'embroidery') { const h = 3, w = textWidth(t, h); return { kind: 'embroidery', name: `Embroidered "${t}"`, rotation: 0, w, h, outline: 'rect', thread: o.thread, layers: [layer('text', { w, h, text: t, color: o.thread })] }; }
    const h = 4, w = textWidth(t, h);
    return { kind: 'print', name: `Printed "${t}"`, rotation: 0, w, h, outline: 'rect', layers: [layer('text', { w, h, text: t, color: o.ink })] };
  }
  if (m === 'print') return { kind: 'print', name: 'Stripe', rotation: 0, w: 20, h: 2, outline: 'rect', layers: [layer('stripe', { w: 20, h: 2, color: o.ink })] };
  if (m === 'embroidery') return { kind: 'embroidery', name: 'Embroidered stripe', rotation: 0, w: 20, h: 2, outline: 'rect', thread: o.thread, layers: [layer('stripe', { w: 20, h: 2, color: o.thread })] };
  return { kind: 'applique', name: 'Appliqué stripe', rotation: 0, w: 20, h: 2, outline: 'shape', shape: 'stripe', layers: [], ...cloth };
}

/** What a placed design is, when it is plain artwork one method can remake. Pictures and layered designs return null. */
export function artOf(a: Pick<Attachment, 'kind' | 'outline' | 'shape' | 'layers'>): Art | null {
  if (a.kind === 'applique') {
    if (a.outline !== 'shape' || !a.shape || a.layers.length) return null;
    return a.shape === 'text' ? { type: 'text' } : a.shape === 'stripe' ? { type: 'stripe' } : { type: 'shape', shape: a.shape };
  }
  if (a.kind !== 'print' && a.kind !== 'embroidery') return null;
  if (a.layers.length !== 1) return null;
  const l = a.layers[0];
  if (l.shape === 'image' || l.shape === 'path') return null;
  return l.shape === 'text' ? { type: 'text' } : l.shape === 'stripe' ? { type: 'stripe' } : { type: 'shape', shape: l.shape };
}

const nameOf = (m: Method, a: Art, text?: string) => {
  const what = a.type === 'text' ? `"${clean(text ?? 'A')}"` : a.type === 'stripe' ? 'stripe' : SHAPES[a.shape].name.toLowerCase();
  return m === 'print' ? (a.type === 'stripe' ? 'Stripe' : `Printed ${what}`) : m === 'embroidery' ? `Embroidered ${what}` : `Appliqué ${what}`;
};

/** can this placed design be made another way, and how */
export function canConvert(a: Attachment, to: Method): boolean {
  if (!isMethod(a.kind) || a.kind === to) return false;
  const art = artOf(a);
  if (!art) {
    // print and embroidery of the same layers only swap the kind, as long as there is no picture or traced path
    return a.kind !== 'applique' && to !== 'applique' && a.layers.length > 0 && a.layers.every((l) => l.shape !== 'image' && l.shape !== 'path');
  }
  return methodAllows(art, to);
}

/** The changes that remake a placed design with another method, keeping place, size, rotation, face and sheen. Null when it cannot. */
export function convertMethod(a: Attachment, to: Method, o: DesignOpts): Partial<Attachment> | null {
  if (!canConvert(a, to)) return null;
  const art = artOf(a);
  const colourNow = a.kind === 'applique' ? a.fabric?.hex ?? (a.fabric ? (fabricById(a.fabric.id).colors[a.fabric.color] ?? fabricById(a.fabric.id).colors[0]).hex : o.ink) : a.layers[0]?.color ?? a.thread ?? o.ink;
  if (!art) return { kind: to, thread: to === 'embroidery' ? colourNow : a.thread };
  const text = art.type === 'text' ? (a.text ?? a.layers[0]?.text ?? 'A') : undefined;
  const name = nameOf(to, art, text);
  if (to === 'applique') {
    return {
      kind: 'applique', name, outline: 'shape', shape: art.type === 'text' ? 'text' : art.type === 'stripe' ? 'stripe' : art.shape, text, layers: [], w: a.w, h: a.h,
      thread: a.kind === 'embroidery' ? a.thread ?? colourNow : o.thread, ...(o.fabric ? { fabric: { ...o.fabric } } : {}),
    };
  }
  const shape: ShapeId = art.type === 'text' ? 'text' : art.type === 'stripe' ? 'stripe' : art.shape;
  const color = a.kind === 'applique' ? (to === 'embroidery' ? a.thread ?? o.thread : colourNow) : colourNow;
  return {
    kind: to, name, outline: 'rect', shape: undefined, text: undefined, fabric: undefined, lining: undefined,
    thread: to === 'embroidery' ? color : a.thread, w: a.w, h: a.h,
    layers: [layer(shape, { w: a.w, h: a.h, color, ...(text ? { text: clean(text) } : {}) })],
  };
}

