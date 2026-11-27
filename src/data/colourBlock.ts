// Colour blocks: a shape of ink or dye on a piece (black sleeve tips, a hem band, a yoke), as 'print' attachments flagged
// `block` so the chart clips them to the piece outline. Pure builders: the store adds what they return as one edit.
//
// Symmetry: a block on a piece cut twice (sleeves, legs) covers both copies; a drawn shape that is not mirror symmetric
// is made as a left and a right block (the right one flipped) so the two sides mirror. A drawn shape off the centre line
// of a symmetric piece gets its mirror image. With total symmetry the matching block goes on the mating piece too
// (front and back), measured from the hem so the bands meet at the side seams.

import type { Pt } from '../lib/geometry';
import { bbox } from '../lib/geometry';
import { uid } from '../lib/units';
import type { Attachment, Sheen, ShapeLayer } from './edits';
import type { Piece } from './presets';
import type { StyleId } from './catalog';
import { instanceCount } from '../sim/seams';

export type BlockPreset = 'hem' | 'tip' | 'yoke' | 'collar' | 'top' | 'bottom';
export interface BlockLook { colour: string; sheen: Sheen; look: 'dyed' | 'printed' }
/** bothFaces (default on): the colour goes through the cloth, so the inside shows it too */
export interface BlockOpts { total: boolean; symmetry: boolean; bothFaces?: boolean }

export const PRESET_LABEL: Record<BlockPreset, string> = { hem: 'Hem band', tip: 'Cuff / sleeve tip', yoke: 'Yoke', collar: 'Collar', top: 'Top half', bottom: 'Bottom half' };
export const PRESET_HEIGHT: Record<BlockPreset, number> = { hem: 5, tip: 6, yoke: 12, collar: 0, top: 0, bottom: 0 };

const MARGIN = 2;
const rectPoly = (x0: number, y0: number, x1: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const edgeY = (p: Piece, tag: string, fallback: number) => { const ys = p.points.filter((q) => q.tag === tag).map((q) => q.y); return ys.length ? Math.max(...ys) : fallback; };
const roleOf = (pieces: Piece[], ...roles: string[]) => pieces.find((p) => roles.includes(p.role));
/** the piece whose outline is mirror symmetric about x = 0 (every point has a partner) */
const mirrorSymmetric = (p: Piece) => p.points.every((q) => !!q.mirror);

function block(p: Piece, poly: Pt[], rect: boolean, look: BlockLook, name: string, extra: { instance?: number; flip?: boolean } = {}): Omit<Attachment, 'id'> {
  const bb = bbox(poly);
  const cx = bb.minX + bb.w / 2, cy = bb.minY + bb.h / 2;
  const w = Math.max(bb.w, 0.1), h = Math.max(bb.h, 0.1);
  const base = { id: uid(), x: 0, y: 0, w, h, rotation: 0, color: look.colour, ...(look.look === 'printed' ? { opacity: 0.96 } : {}) };
  const layer: ShapeLayer = rect
    ? { ...base, shape: 'rect', ...(extra.flip ? { flipX: true } : {}) }
    : { ...base, shape: 'path', path: `M${poly.map((q) => `${((q.x - cx) / w).toFixed(4)} ${((q.y - cy) / h).toFixed(4)}`).join('L')}Z`, ...(extra.flip ? { flipX: true } : {}) };
  return {
    kind: 'print', name: `${look.look === 'dyed' ? 'Dyed' : 'Printed'} ${name}`, pieceId: p.id, x: cx, y: cy, rotation: 0, w, h, outline: 'rect',
    layers: [layer], sheen: look.sheen, block: true, ...(extra.instance !== undefined ? { instance: extra.instance } : {}),
  };
}

/** Blocks for one drawn polygon on one piece, with every symmetric twin. */
function onPiece(style: StyleId, p: Piece, poly: Pt[], rect: boolean, look: BlockLook, name: string, o: BlockOpts): Omit<Attachment, 'id'>[] {
  const bb = bbox(poly);
  const copies = instanceCount(style, p);
  const straddles = bb.minX < 0.3 && bb.maxX > -0.3;
  const out: Omit<Attachment, 'id'>[] = [];
  // a rectangle is its own mirror image, so one block covers both copies; a free shape needs a flipped twin on the other copy
  const pair = copies === 2 && !rect;
  if (pair) { out.push(block(p, poly, rect, look, name, { instance: 0 }), block(p, poly, rect, look, name, { instance: 1, flip: true })); }
  else out.push(block(p, poly, rect, look, name));
  if (o.symmetry && mirrorSymmetric(p) && !straddles) {
    const m = poly.map((q) => ({ x: -q.x, y: q.y })).reverse();
    if (pair) out.push(block(p, m, rect, look, name, { instance: 0, flip: true }), block(p, m, rect, look, name, { instance: 1 }));
    else out.push(block(p, m, rect, look, name));
  }
  return out;
}

/** The piece a total symmetry block also goes on: front and back (of a top or of the legs) mate. */
const mateOf = (pieces: Piece[], p: Piece) => (p.role === 'front' ? roleOf(pieces, 'back') : p.role === 'back' ? roleOf(pieces, 'front') : undefined);

/** a copy of each block on the inside face, so the colour shows through to the wrong side too */
function withInside(list: Omit<Attachment, 'id'>[], o: BlockOpts): Omit<Attachment, 'id'>[] {
  if (o.bothFaces === false) return list;
  return [...list, ...list.map((a) => ({ ...a, name: `${a.name} (inside)`, face: 'inside' as const, layers: a.layers.map((l) => ({ ...l, id: uid(), flipX: l.shape === 'rect' ? l.flipX : !l.flipX })) }))];
}

/** A drawn shape (piece local cm) on a piece, plus its symmetric and mating blocks. */
export function shapeBlocks(style: StyleId, pieces: Piece[], pieceId: string, poly: Pt[], rect: boolean, look: BlockLook, o: BlockOpts): Omit<Attachment, 'id'>[] {
  const p = pieces.find((q) => q.id === pieceId);
  if (!p) return [];
  const out = onPiece(style, p, poly, rect, look, 'colour block', o);
  const mate = o.total ? mateOf(pieces, p) : undefined;
  if (mate) {
    // same distance from the hem, so the two meet at the side seams
    const dy = edgeY(mate, 'hem', bbox(mate.points).maxY) - edgeY(p, 'hem', bbox(p.points).maxY);
    out.push(...onPiece(style, mate, poly.map((q) => ({ x: q.x, y: q.y + dy })), rect, look, 'colour block', o));
  }
  return withInside(out, o);
}

/** A quick block from an edge of the garment: height h (cm) from the hem, tip, or neckline; halves ignore h. */
export function presetBlocks(style: StyleId, pieces: Piece[], preset: BlockPreset, h: number, look: BlockLook, o: BlockOpts, selPieceId?: string | null): Omit<Attachment, 'id'>[] {
  const sel = pieces.find((p) => p.id === selPieceId && p.role !== 'custom');
  const piece = preset === 'tip' ? roleOf(pieces, 'sleeve', 'cuff') : preset === 'collar' ? roleOf(pieces, 'collar', 'neckband', 'waistband') : sel && (sel.role === 'front' || sel.role === 'back') ? sel : roleOf(pieces, 'front');
  if (!piece) return [];
  const label = PRESET_LABEL[preset].toLowerCase();
  const targets = [piece, ...(o.total && preset !== 'tip' && preset !== 'collar' ? [mateOf(pieces, piece)].filter((q): q is Piece => !!q) : [])];
  return withInside(targets.flatMap((p) => {
    const bb = bbox(p.points);
    const x0 = bb.minX - MARGIN, x1 = bb.maxX + MARGIN;
    let poly: Pt[];
    if (preset === 'hem' || preset === 'tip') {
      const y = edgeY(p, preset === 'tip' ? 'cuff' : 'hem', bb.maxY);
      poly = rectPoly(x0, y - h, x1, bb.maxY + MARGIN);
    } else if (preset === 'yoke') poly = rectPoly(x0, bb.minY - MARGIN, x1, bb.minY + h);
    else if (preset === 'top') poly = rectPoly(x0, bb.minY - MARGIN, x1, bb.minY + bb.h / 2);
    else if (preset === 'bottom') poly = rectPoly(x0, bb.minY + bb.h / 2, x1, bb.maxY + MARGIN);
    else poly = rectPoly(x0, bb.minY - MARGIN, x1, bb.maxY + MARGIN);
    return [block(p, poly, true, look, label)];
  }), o);
}
