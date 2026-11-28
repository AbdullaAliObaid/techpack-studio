// The Design workspace's working model: a design (patch, applique, embroidery or print) made of paint-style layers, how it
// flattens into the shared ShapeLayer / Attachment contract (src/data/edits.ts), and the band geometry shared by the 2D chart
// and the 3D print pass. Extra per-layer fields (name, lock, group, outline, blend, stitch, font) live only on DLayer.
import type { Attachment, Band, Outline, Sheen, ShapeLayer } from '../data/edits';
import type { Piece } from '../data/presets';
import { uid } from '../lib/units';
import { bandSlope } from '../data/bandGeom';
import { outlinePolygon, pathPolygon, shapePolygon } from '../lib/shapes';
import { textKey, traceTextUnit } from '../lib/textTrace';

export type Workspace = 'shape' | 'seams' | 'fabric' | 'paint' | 'design' | 'trims' | 'fit' | 'outfit' | 'finish' | 'review' | 'techpack';
/** In bar order. `key` is the Cmd or Ctrl number shortcut (the visible ones are numbered in order, see workspaceKey). */
export const WORKSPACES: { id: Workspace; label: string; icon: string; blurb: string }[] = [
  { id: 'shape', label: 'Shape', icon: 'pattern', blurb: 'Reshape pieces and type exact numbers' },
  { id: 'seams', label: 'Seams', icon: 'seams', blurb: 'How the pieces are sewn together' },
  { id: 'fabric', label: 'Fabric', icon: 'grid', blurb: 'Cloth, colour and pattern, outside and inside' },
  { id: 'paint', label: 'Paint', icon: 'block', blurb: 'Edge paint and bands across the garment' },
  { id: 'design', label: 'Design', icon: 'design', blurb: 'Patches, prints, embroidery and appliques' },
  { id: 'trims', label: 'Trims', icon: 'hardware', blurb: 'Hardware, tags, pockets, patches and straps' },
  { id: 'fit', label: 'Fit', icon: 'body', blurb: 'Body, pose, movement and stretch risk' },
  { id: 'outfit', label: 'Outfit', icon: 'layers', blurb: 'Garments worn together' },
  { id: 'finish', label: 'Finish', icon: 'sparkle', blurb: 'Wash and distressing' },
  { id: 'review', label: 'Review', icon: 'specs', blurb: 'Specs, fit table, seam report and notes' },
  { id: 'techpack', label: 'Tech pack', icon: 'share', blurb: 'Preview and export' },
];
/** The tabs on show: Outfit only while an outfit is open. */
export const visibleWorkspaces = (outfit: boolean) => WORKSPACES.filter((w) => w.id !== 'outfit' || outfit);
export const isWorkspace = (v: unknown): v is Workspace => WORKSPACES.some((w) => w.id === v);
/** Old saved ids: Construct became Shape. */
export const normaliseWorkspace = (v: unknown): Workspace => (v === 'construct' ? 'shape' : isWorkspace(v) ? v : 'shape');

const WS_KEY = 'tech-it-workspaces';
export function readWorkspaceMap(): Record<string, Workspace> {
  try { return JSON.parse(localStorage.getItem(WS_KEY) ?? '{}') as Record<string, Workspace>; } catch { return {}; }
}
export function writeWorkspaceMap(m: Record<string, Workspace>) {
  try { localStorage.setItem(WS_KEY, JSON.stringify(m)); } catch { /* storage blocked */ }
}

export type FontId = 'classic' | 'varsity' | 'script' | 'block' | 'mono';
export type Blend = 'normal' | 'multiply' | 'screen';
export type Stitch = 'satin' | 'fill' | 'running';

export interface DLayer extends ShapeLayer {
  name?: string;
  locked?: boolean;
  hidden?: boolean;
  group?: string;
  /** outline colour and width (cm, drawn outside the shape) */
  stroke?: string;
  strokeW?: number;
  /** how the layer looks against the layers below on the artboard (the garment print has no blend) */
  blend?: Blend;
  /** embroidery thread fill */
  stitch?: Stitch;
  font?: FontId;
  /** picture layers: silhouette (path in the unit box) when the background was removed, so the picture can be a patch base */
  outlinePath?: string;
}
export interface DGroup { id: string; name: string; hidden?: boolean; locked?: boolean }

export type MakeAs = 'patch' | 'applique' | 'embroidery' | 'print';
export interface DesignDoc {
  name: string;
  makeAs: MakeAs;
  /** size of the artboard and of the cloth patch (cm) */
  w: number;
  h: number;
  outline: Outline;
  /** cloth colour of a patch or applique */
  cloth: string;
  thread: string;
  sheen: Sheen;
  layers: DLayer[];
  groups: DGroup[];
  /** attachment this design is linked to once placed: edits flow through to it */
  placedId: string | null;
  pieceId: string | null;
  instance: number;
}

export const RELIEF_PRESETS: { id: string; name: string; mm: number }[] = [
  { id: 'flat', name: 'Flat print', mm: 0 },
  { id: 'puff', name: 'Puff', mm: 0.6 },
  { id: 'padded', name: 'Padded', mm: 1.6 },
  { id: 'felt', name: 'Stacked felt', mm: 1 },
  { id: 'deboss', name: 'Deboss', mm: -0.6 },
];

export function newDesign(): DesignDoc {
  return { name: 'New design', makeAs: 'patch', w: 8, h: 8, outline: 'rounded', cloth: '#1d3b6e', thread: '#e9e2cf', sheen: 'matte', layers: [], groups: [], placedId: null, pieceId: null, instance: 0 };
}

export const defaultBand = (): Omit<Band, 'id'> => ({ from: 'shoulder', offset: 12, stripes: [{ height: 2.5, color: '#c0392b' }, { height: 1, color: '#ffffff' }, { height: 2.5, color: '#1d3b6e' }], method: 'printed', sheen: 'matte' });

/** Layers as the shared contract stores them: hidden ones dropped, outlines turned into a slightly larger layer behind. */
export function flatten(doc: Pick<DesignDoc, 'layers' | 'groups'>): ShapeLayer[] {
  const gm = new Map(doc.groups.map((g) => [g.id, g]));
  const out: ShapeLayer[] = [];
  for (const l of doc.layers) {
    if (l.hidden || (l.group && gm.get(l.group)?.hidden)) continue;
    const { name: _n, locked: _l, hidden: _h, group: _g, stroke, strokeW, blend: _b, ...rest } = l;
    void _n; void _l; void _h; void _g; void _b;
    if (stroke && (strokeW ?? 0) > 0 && l.shape !== 'image') {
      const s = (strokeW ?? 0) * 2;
      out.push({ ...rest, id: `${l.id}-o`, color: stroke, w: l.w + s, h: l.h + s });
    }
    out.push(rest);
  }
  return out;
}

/** The first layer of a cloth patch or appliqué is its base: it defines the outline, whatever shape it is. */
export const isCloth = (doc: Pick<DesignDoc, 'makeAs'>) => doc.makeAs === 'patch' || doc.makeAs === 'applique';
export function baseLayer(doc: Pick<DesignDoc, 'makeAs' | 'layers'>): DLayer | null {
  return isCloth(doc) ? doc.layers.find((l) => !l.hidden) ?? null : null;
}
const rot = (pts: { x: number; y: number }[], deg: number, flip?: boolean) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return pts.map((q) => { const x = flip ? -q.x : q.x; return { x: Math.round((x * c - q.y * s) * 1000) / 1000, y: Math.round((x * s + q.y * c) * 1000) / 1000 }; });
};
/** Outline points of a base layer, centred on its own middle (cm). */
export function basePolygon(l: DLayer): { x: number; y: number }[] {
  let ring: { x: number; y: number }[] = [];
  if (l.shape === 'path' && l.path) ring = pathPolygon(l.path, l.w, l.h);
  else if (l.shape === 'image' && l.outlinePath) ring = pathPolygon(l.outlinePath, l.w, l.h);
  else if (l.shape !== 'text' && l.shape !== 'image' && l.shape !== 'path') ring = shapePolygon(l.shape, l.w, l.h)[0] ?? [];
  if (ring.length < 3) ring = outlinePolygon('rect', l.w, l.h);
  return rot(ring, l.rotation, l.flipX);
}
const bounds = (pts: { x: number; y: number }[]) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};

export function attachmentPatch(doc: DesignDoc): Pick<Attachment, 'kind' | 'name' | 'w' | 'h' | 'outline' | 'points' | 'layers' | 'thread' | 'sheen' | 'fabric'> & Partial<Pick<Attachment, 'shape' | 'text' | 'font' | 'outlineRings' | 'outlineKey'>> {
  const cloth = isCloth(doc);
  const base = baseLayer(doc);
  if (cloth && base && base.shape === 'text' && base.text?.trim()) {
    // letters as the cloth: the patch is cut letter by letter (not a box round the text)
    const rest = flatten({ layers: doc.layers.filter((l) => l !== base), groups: doc.groups }).map((l) => ({ ...l, x: Math.round((l.x - base.x) * 100) / 100, y: Math.round((l.y - base.y) * 100) / 100 }));
    // the letters are cut from the real font, the same text, font and box as the Design canvas draws (src/lib/textTrace.ts)
    const text = base.text.trim(), rings = traceTextUnit(text, base.font);
    return {
      kind: doc.makeAs, name: doc.name, w: Math.max(0.5, Math.round(base.w * 100) / 100), h: Math.max(0.5, Math.round(base.h * 100) / 100), outline: 'shape', shape: 'text', text, ...(base.font ? { font: base.font } : {}), ...(rings?.length ? { outlineRings: rings, outlineKey: textKey(text, base.font) } : {}), layers: rest, thread: doc.thread, sheen: doc.sheen,
      fabric: { id: 'canvas', color: 0, hex: base.color },
    };
  }
  if (cloth && base) {
    // the base is the cloth: its colour is the cloth colour and its outline the patch outline; everything else is centred on it
    const pts = basePolygon(base);
    const bb = bounds(pts);
    const rest = flatten({ layers: doc.layers.filter((l) => l !== base || base.shape === 'image'), groups: doc.groups }).map((l) => ({ ...l, x: Math.round((l.x - base.x) * 100) / 100, y: Math.round((l.y - base.y) * 100) / 100 }));
    return {
      kind: doc.makeAs, name: doc.name, w: Math.max(0.5, Math.round(bb.w * 100) / 100), h: Math.max(0.5, Math.round(bb.h * 100) / 100), outline: 'custom', points: pts, layers: rest, thread: doc.thread, sheen: doc.sheen,
      fabric: { id: 'canvas', color: 0, hex: base.shape === 'image' ? doc.cloth : base.color },
    };
  }
  return {
    kind: doc.makeAs, name: doc.name, w: doc.w, h: doc.h, outline: doc.outline, layers: flatten(doc), thread: doc.thread, sheen: doc.sheen,
    fabric: cloth ? { id: 'canvas', color: 0, hex: doc.cloth } : undefined,
  };
}

/** A design from an attachment already on the garment: cloth gets its outline back as the base layer. */
export function docFromAttachment(a: Attachment): DesignDoc {
  const kind = a.kind === 'patch' || a.kind === 'applique' || a.kind === 'embroidery' || a.kind === 'print' ? a.kind : 'patch';
  const doc: DesignDoc = { ...newDesign(), name: a.name, makeAs: kind, w: a.w, h: a.h, outline: a.outline === 'custom' || a.outline === 'shape' ? 'rounded' : a.outline, cloth: a.fabric?.hex ?? '#1d3b6e', thread: a.thread ?? '#e9e2cf', sheen: a.sheen ?? 'matte', layers: a.layers.map((l) => ({ ...l }) as DLayer), placedId: a.id, pieceId: a.pieceId, instance: a.instance ?? 0 };
  if ((kind === 'patch' || kind === 'applique') && a.outline === 'shape' && a.shape === 'text' && a.text) {
    doc.layers = [newLayer('text', { w: a.w, h: a.h, text: a.text, ...(a.font ? { font: a.font as FontId } : {}), color: doc.cloth, name: 'Letters' }), ...doc.layers];
  } else if (kind === 'patch' || kind === 'applique') {
    const pts = a.outline === 'custom' && a.points?.length ? a.points : outlinePolygon(a.outline === 'shape' ? 'rect' : a.outline, a.w, a.h);
    const d = 'M' + pts.map((q) => `${Math.round((q.x / a.w) * 1000) / 1000} ${Math.round((q.y / a.h) * 1000) / 1000}`).join('L') + 'Z';
    doc.layers = [newLayer('path', { w: a.w, h: a.h, path: d, color: doc.cloth, name: 'Base' }), ...doc.layers];
  }
  return doc;
}

export const newLayer = (shape: ShapeLayer['shape'], over: Partial<DLayer> = {}): DLayer => ({ id: uid(), shape, x: 0, y: 0, w: 3, h: 3, rotation: 0, color: '#f2c94c', opacity: 1, ...over });

/* ---------- bands ---------- */

/** the high point shoulder on a top (pattern y = 0), else the highest point of the piece */
export function pieceTop(p: Piece): number {
  const h = p.points.find((q) => q.tag === 'hps');
  return h ? h.y : Math.min(...p.points.map((q) => q.y));
}
export function pieceBottom(p: Piece): number {
  const hem = p.points.filter((q) => q.tag === 'hem');
  return (hem.length ? hem : p.points).reduce((m, q) => Math.max(m, q.y), -Infinity);
}
const BAND_ROLES = new Set(['front', 'back']);
export const bandSkips = (b: Band, p: Piece) => (b.skip ? b.skip.includes(p.id) : !BAND_ROLES.has(p.role));

export interface BandStripe {
  /** the stripe's top and bottom at pattern x = 0 (the centre line) */
  y0: number; y1: number; color: string;
  /** dy/dx when the band is tilted (see src/data/bandGeom.ts); 0 or missing = level */
  slope?: number;
}
/** Where the band's stripes sit on one piece, in that piece's own pattern coordinates (cm), or null when it skips the piece. */
export function bandRanges(b: Band, p: Piece): BandStripe[] | null {
  if (bandSkips(b, p) || !b.stripes.length) return null;
  const total = b.stripes.reduce((s, q) => s + q.height, 0);
  let y = b.from === 'shoulder' ? pieceTop(p) + b.offset : pieceBottom(p) - b.offset - total;
  const slope = bandSlope(b, p.role);
  const reach = Math.abs(slope) * Math.max(...p.points.map((q) => Math.abs(q.x)));
  const lo = Math.min(...p.points.map((q) => q.y)) - reach, hi = Math.max(...p.points.map((q) => q.y)) + reach;
  const out: BandStripe[] = [];
  for (const s of b.stripes) { out.push({ y0: y, y1: y + s.height, color: s.color, ...(slope ? { slope } : {}) }); y += s.height; }
  if (out[out.length - 1].y1 < lo || out[0].y0 > hi) return null;
  return out;
}
