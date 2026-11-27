// The Design workspace's working model: a design (patch, applique, embroidery or print) made of paint-style layers, how it
// flattens into the shared ShapeLayer / Attachment contract (src/data/edits.ts), and the band geometry shared by the 2D chart
// and the 3D print pass. Extra per-layer fields (name, lock, group, outline, blend, stitch, font) live only on DLayer.
import type { Attachment, Band, Outline, Sheen, ShapeLayer } from '../data/edits';
import type { Piece } from '../data/presets';
import { uid } from '../lib/units';

export type Workspace = 'construct' | 'design' | 'finish' | 'techpack';
export const WORKSPACES: { id: Workspace; label: string; icon: string; key: string }[] = [
  { id: 'construct', label: 'Construct', icon: 'pattern', key: '1' },
  { id: 'design', label: 'Design', icon: 'design', key: '2' },
  { id: 'finish', label: 'Finish', icon: 'sparkle', key: '3' },
  { id: 'techpack', label: 'Tech pack', icon: 'specs', key: '4' },
];

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

export function attachmentPatch(doc: DesignDoc): Pick<Attachment, 'kind' | 'name' | 'w' | 'h' | 'outline' | 'layers' | 'thread' | 'sheen' | 'fabric'> {
  const cloth = doc.makeAs === 'patch' || doc.makeAs === 'applique';
  return {
    kind: doc.makeAs, name: doc.name, w: doc.w, h: doc.h, outline: doc.outline, layers: flatten(doc), thread: doc.thread, sheen: doc.sheen,
    fabric: cloth ? { id: 'canvas', color: 0, hex: doc.cloth } : undefined,
  };
}

/** A design from an attachment already on the garment (outline layers stay as layers of their own). */
export function docFromAttachment(a: Attachment): DesignDoc {
  const kind = a.kind === 'patch' || a.kind === 'applique' || a.kind === 'embroidery' || a.kind === 'print' ? a.kind : 'patch';
  return { ...newDesign(), name: a.name, makeAs: kind, w: a.w, h: a.h, outline: a.outline === 'custom' || a.outline === 'shape' ? 'rounded' : a.outline, cloth: a.fabric?.hex ?? '#1d3b6e', thread: a.thread ?? '#e9e2cf', sheen: a.sheen ?? 'matte', layers: a.layers.map((l) => ({ ...l }) as DLayer), placedId: a.id, pieceId: a.pieceId, instance: a.instance ?? 0 };
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

export interface BandStripe { y0: number; y1: number; color: string }
/** Where the band's stripes sit on one piece, in that piece's own pattern coordinates (cm), or null when it skips the piece. */
export function bandRanges(b: Band, p: Piece): BandStripe[] | null {
  if (bandSkips(b, p) || !b.stripes.length) return null;
  const total = b.stripes.reduce((s, q) => s + q.height, 0);
  let y = b.from === 'shoulder' ? pieceTop(p) + b.offset : pieceBottom(p) - b.offset - total;
  const lo = Math.min(...p.points.map((q) => q.y)), hi = Math.max(...p.points.map((q) => q.y));
  const out: BandStripe[] = [];
  for (const s of b.stripes) { out.push({ y0: y, y1: y + s.height, color: s.color }); y += s.height; }
  if (out[out.length - 1].y1 < lo || out[0].y0 > hi) return null;
  return out;
}
