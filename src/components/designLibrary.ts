// The design library: every tile is one simple thing (one shape, one word, one trim) that is cut and sewn on,
// stitched in thread, printed, or fixed on as hardware. Nothing comes pre-combined; layers can be added
// afterwards in the layer editor.
import type { AttachKind, Attachment, Finish, Hardware, HardwareType, Outline, ShapeId } from '../data/edits';
import { SHAPES } from '../lib/shapes';
import { layer, type AttachTemplate } from './editHelpers';

export const ATTACHMENT_MIME = 'application/x-techit-attachment';

/** Single shapes offered for appliqué, embroidery and print. */
export const SINGLE_SHAPES: ShapeId[] = ['star', 'triangle', 'rect', 'circle', 'heart', 'diamond', 'hexagon', 'bolt', 'cross', 'chevron', 'shield', 'star4', 'rounded'];
/** Shapes with a hole cannot be cut from cloth as one piece, but they can be stitched or printed. */
export const THREAD_SHAPES: ShapeId[] = [...SINGLE_SHAPES, 'ring'];

const SIZE: Partial<Record<ShapeId, [number, number]>> = { chevron: [8, 5], bolt: [5, 8], cross: [6, 6], rect: [6, 6], rounded: [6, 6] };
const sizeOf = (s: ShapeId, k = 1): [number, number] => { const [w, h] = SIZE[s] ?? [7, 7]; return [w * k, h * k]; };

export interface DesignOpts {
  /** print ink */
  ink: string;
  /** embroidery thread and the stitching round cloth */
  thread: string;
  /** cloth for pockets, patches, straps and appliqué (same as the piece when undefined) */
  fabric?: { id: string; color: number };
  text: string;
}

export const DEFAULT_OPTS: DesignOpts = { ink: '#eb5757', thread: '#f2c94c', text: 'ABC' };

/** Block capitals, width follows the number of letters. */
export const clean = (t: string) => (t.toUpperCase().replace(/[^A-Z0-9 &!?.\-+]/g, '').slice(0, 12) || 'A');
export const textWidth = (t: string, h: number) => Math.max(h * 0.8, clean(t).length * h * 0.72);

const withFabric = (a: AttachTemplate, o: DesignOpts): AttachTemplate => ({ ...a, ...(o.fabric ? { fabric: { ...o.fabric } } : {}), thread: o.thread });

export type Kind4 = 'pocket' | 'patch' | 'strap' | 'applique';

export interface Tile { key: string; label: string; shape?: ShapeId; outline?: Outline; text?: boolean; make: (o: DesignOpts) => AttachTemplate }

const cloth = (kind: AttachKind, label: string, outline: Outline, w: number, h: number): Tile => ({
  key: `${kind}-${label}`, label, outline,
  make: (o) => withFabric({ kind, name: `${kind === 'pocket' ? 'Pocket' : kind === 'patch' ? 'Patch' : 'Strap'}, ${label.toLowerCase()}`, rotation: 0, w, h, outline, layers: [] }, o),
});

export const POCKETS: Tile[] = [
  cloth('pocket', 'Square', 'rect', 14, 16),
  cloth('pocket', 'Rounded', 'rounded', 14, 16),
  cloth('pocket', 'Pointed', 'pointed', 13, 14),
  cloth('pocket', 'Shield', 'shield', 12, 14),
];
export const PATCHES: Tile[] = [
  cloth('patch', 'Square', 'rect', 8, 8),
  cloth('patch', 'Rounded', 'rounded', 8, 8),
  cloth('patch', 'Circle', 'circle', 8, 8),
  cloth('patch', 'Shield', 'shield', 8, 9),
];
export const STRAPS: Tile[] = [
  cloth('strap', 'Strap', 'rect', 2.5, 9),
  cloth('strap', 'Belt loop', 'rounded', 1.8, 6),
  cloth('strap', 'Pointed tab', 'pointed', 3.5, 7),
];

export const appliqueShape = (shape: ShapeId): Tile => ({
  key: `applique-${shape}`, label: SHAPES[shape].name, shape,
  make: (o) => { const [w, h] = sizeOf(shape); return withFabric({ kind: 'applique', name: `Appliqué ${SHAPES[shape].name.toLowerCase()}`, rotation: 0, w, h, outline: 'shape', shape, layers: [] }, o); },
});
export const appliqueText = (): Tile => ({
  key: 'applique-text', label: 'Letters', text: true,
  make: (o) => { const h = 4, t = clean(o.text); return withFabric({ kind: 'applique', name: `Appliqué "${t}"`, rotation: 0, w: textWidth(t, h), h, outline: 'shape', shape: 'text', text: t, layers: [] }, o); },
});

export const embroideryShape = (shape: ShapeId): Tile => ({
  key: `embroidery-${shape}`, label: SHAPES[shape].name, shape,
  make: (o) => {
    const [w, h] = sizeOf(shape, 0.85);
    return { kind: 'embroidery', name: `Embroidered ${SHAPES[shape].name.toLowerCase()}`, rotation: 0, w, h, outline: 'rect', thread: o.thread, layers: [layer(shape, { w, h, color: o.thread })] };
  },
});
export const embroideryText = (): Tile => ({
  key: 'embroidery-text', label: 'Letters', text: true,
  make: (o) => { const h = 3, t = clean(o.text), w = textWidth(t, h); return { kind: 'embroidery', name: `Embroidered "${t}"`, rotation: 0, w, h, outline: 'rect', thread: o.thread, layers: [layer('text', { w, h, text: t, color: o.thread })] }; },
});

export const printShape = (shape: ShapeId): Tile => ({
  key: `print-${shape}`, label: SHAPES[shape].name, shape,
  make: (o) => { const [w, h] = sizeOf(shape); return { kind: 'print', name: `Printed ${SHAPES[shape].name.toLowerCase()}`, rotation: 0, w, h, outline: 'rect', layers: [layer(shape, { w, h, color: o.ink })] }; },
});
export const printText = (): Tile => ({
  key: 'print-text', label: 'Text', text: true,
  make: (o) => { const h = 4, t = clean(o.text), w = textWidth(t, h); return { kind: 'print', name: `Printed "${t}"`, rotation: 0, w, h, outline: 'rect', layers: [layer('text', { w, h, text: t, color: o.ink })] }; },
});
export const printStripe = (): Tile => ({
  key: 'print-stripe', label: 'Stripe', shape: 'stripe',
  make: (o) => ({ kind: 'print', name: 'Stripe', rotation: 0, w: 20, h: 2, outline: 'rect', layers: [layer('stripe', { w: 20, h: 2, color: o.ink })] }),
});

/* ---------- hardware ---------- */

export interface HwDef { type: HardwareType; label: string; size: number; count: number; spacing: number; length?: number; sizeRange: [number, number] }
export const HARDWARE: HwDef[] = [
  { type: 'rivet', label: 'Rivet', size: 0.9, count: 1, spacing: 2.5, sizeRange: [0.5, 2] },
  { type: 'eyelet', label: 'Eyelet', size: 1.1, count: 1, spacing: 3, sizeRange: [0.5, 2.5] },
  { type: 'stud', label: 'Stud', size: 1.2, count: 1, spacing: 2.5, sizeRange: [0.5, 3] },
  { type: 'button', label: 'Button', size: 1.8, count: 1, spacing: 3, sizeRange: [1, 4] },
  { type: 'snap', label: 'Snap', size: 1.3, count: 1, spacing: 2.5, sizeRange: [0.8, 3] },
  { type: 'zipper', label: 'Zipper', size: 2.5, count: 1, spacing: 0, length: 15, sizeRange: [1, 5] },
];

export interface HwOpts { finish: Finish; size: number; count: number; spacing: number; length: number; open: boolean }
export const hwDefaults = (d: HwDef, finish: Finish = 'silver'): HwOpts => ({ finish, size: d.size, count: d.count, spacing: d.spacing, length: d.length ?? 15, open: false });

export function hardwareAttachment(type: HardwareType, o: HwOpts): AttachTemplate {
  const def = HARDWARE.find((h) => h.type === type)!;
  const hw: Hardware = type === 'zipper'
    ? { type, finish: o.finish, size: o.size, open: o.open }
    : { type, finish: o.finish, size: o.size, count: o.count, spacing: o.spacing };
  const n = type === 'zipper' ? 1 : o.count;
  const w = type === 'zipper' ? o.size : n > 1 ? (n - 1) * o.spacing + o.size : o.size;
  const h = type === 'zipper' ? o.length : o.size;
  return { kind: 'hardware', name: n > 1 ? `${def.label}s, ${n}` : def.label, rotation: 0, w, h, outline: type === 'zipper' || n > 1 ? 'rect' : 'circle', layers: [], hardware: hw };
}

export const isAttachment = (a: Partial<Attachment>): a is AttachTemplate => typeof a.w === 'number' && typeof a.h === 'number' && !!a.kind;
