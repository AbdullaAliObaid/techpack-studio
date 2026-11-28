// Pieces cut twice (legs, sleeves, cuffs) are drawn as two separate patterns on the chart: the first copy
// sits on +x, the wearer's left (the avatar faces you), the second copy is its mirror image, the wearer's right.
// Everything the user places belongs to a copy (`instance`); undefined means every copy.
import * as seamsMod from '../sim/seams';
import type { StyleId } from '../data/catalog';
import type { Piece } from '../data/presets';
import type { Pt } from '../lib/geometry';
import type { Attachment } from '../data/edits';

export interface Entry {
  key: string;
  /** the piece as stored */
  src: Piece;
  /** the piece as drawn: mirrored points for the left copy, offset = where it sits on the chart */
  piece: Piece;
  inst: number;
  /** how many copies this piece is cut (2 for legs and sleeves, 6 for hat crowns) */
  copies: number;
  /** both copies are on the chart, so this entry names its side */
  both: boolean;
  /** this is the mirrored left copy */
  mirror: boolean;
  offset: Pt;
  label: string;
  /** the chart is turned over (inside view): `mirror` and the outline are flipped on top of the copy's own mirroring */
  flipped?: boolean;
}

/** How many times a piece is placed on the body. */
export function copiesOf(style: StyleId, p: Piece): number {
  if (p.role === 'custom') return p.splitOf ? 1 : p.cut + (p.splitSides?.length ?? 0) >= 2 ? 2 : 1;
  return seamsMod.instanceCount(style, p);
}

export const sideName = (inst: number) => (inst === 0 ? 'Left' : 'Right');

/** "Front, right leg", "Sleeve, left". Uses the simulation's own label when it provides one. */
export function instanceName(style: StyleId, p: Piece, inst: number): string {
  const fn = (seamsMod as unknown as { instanceLabel?: (s: StyleId, p: Piece, i: number) => string }).instanceLabel;
  if (typeof fn === 'function') {
    try { const l = fn(style, p, inst); if (l) return l; } catch { /* fall back */ }
  }
  const side = sideName(inst).toLowerCase();
  const m = /^(.*?)\s+leg$/i.exec(p.name);
  return m ? `${m[1]}, ${side} leg` : `${p.name}, ${side}`;
}

const GAP = 8; // cm between the two copies

const bounds = (p: Piece) => {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of p.points) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  return { minX, maxX, minY, maxY };
};

/** Everything drawn on the chart, in draw order. Pieces to the right of a doubled piece slide over to make room. */
export function layoutEntries(style: StyleId, pieces: Piece[], showBoth: boolean): Entry[] {
  // a side edited on its own (src/data/split.ts) is drawn where that copy of its piece goes; a split pair always shows both
  const splits = pieces.filter((p) => p.splitOf && pieces.some((q) => q.id === p.splitOf));
  const info = pieces.filter((p) => !splits.includes(p)).map((p) => ({ p, b: bounds(p), copies: copiesOf(style, p) }));
  const doubled = (i: { p: Piece; copies: number }) => (showBoth || !!i.p.splitSides?.length) && i.copies === 2;
  const order = info.map((_, i) => i).sort((a, b) => info[a].p.offset.x + info[a].b.minX - (info[b].p.offset.x + info[b].b.minX));
  const shift = new Map<string, number>();
  order.forEach((i, n) => {
    let s = 0;
    for (let k = 0; k < n; k++) {
      const j = info[order[k]];
      if (!doubled(j)) continue;
      const yA0 = info[i].p.offset.y + info[i].b.minY, yA1 = info[i].p.offset.y + info[i].b.maxY;
      const yB0 = j.p.offset.y + j.b.minY, yB1 = j.p.offset.y + j.b.maxY;
      if (yA0 < yB1 - 1 && yB0 < yA1 - 1) s += j.b.maxX - j.b.minX + GAP;
    }
    shift.set(info[i].p.id, s);
  });
  const out: Entry[] = [];
  for (const it of info) {
    const { p, b, copies } = it;
    const dx = shift.get(p.id) ?? 0;
    const both = doubled(it);
    const o0: Pt = { x: p.offset.x + dx, y: p.offset.y };
    const o1: Pt = { x: o0.x + 2 * b.maxX + GAP, y: p.offset.y };
    /** the split piece standing in for copy k, drawn in that copy's place (mirrored for the wearer's right) */
    const own = (k: number) => {
      const s = both ? splits.find((q) => q.splitOf === p.id && q.side === k) : undefined;
      if (!s) return false;
      const o = k ? o1 : o0;
      out.push({ key: `${s.id}:0`, src: s, inst: 0, copies: 1, both: false, mirror: k === 1, offset: o, label: s.name, piece: { ...s, offset: o, points: k ? s.points.map((q) => ({ ...q, x: -q.x })) : s.points } });
      return true;
    };
    if (!own(0)) out.push({ key: `${p.id}:0`, src: p, piece: { ...p, offset: o0 }, inst: 0, copies, both, mirror: false, offset: o0, label: both ? instanceName(style, p, 0) : p.name });
    if (both && !own(1)) {
      out.push({
        key: `${p.id}:1`, src: p, inst: 1, copies, both, mirror: true, offset: o1, label: instanceName(style, p, 1),
        piece: { ...p, offset: o1, points: p.points.map((q) => ({ ...q, x: -q.x })) },
      });
    }
  }
  return out;
}

/** world point to the stored piece's own coordinates (the right copy's frame) */
export const toSource = (e: Entry, w: Pt): Pt => ({ x: e.mirror ? -(w.x - e.offset.x) : w.x - e.offset.x, y: w.y - e.offset.y });
/** a position in the stored frame to the world */
export const toWorldPt = (e: Entry, l: Pt): Pt => ({ x: e.offset.x + (e.mirror ? -l.x : l.x), y: e.offset.y + l.y });
/** frame of an attachment on this copy: positions and turns mirror on the left copy, artwork does not flip */
export const frameOn = (e: Entry, a: { x: number; y: number; rotation: number }) => ({ x: e.mirror ? -a.x : a.x, y: a.y, rotation: e.mirror ? -a.rotation : a.rotation });

/** does something stored with `instance` show on this copy */
export function onCopy(instance: number | undefined, e: Entry): boolean {
  if (instance === undefined) return true;
  if (e.copies === 2 && e.both) return instance === e.inst;
  if (e.copies >= 2) return instance === 0;
  return true;
}

/** the copy to record for something put on entry e, or undefined when the piece is cut once */
export const instanceFor = (e: Entry): number | undefined => (e.both ? e.inst : undefined);

/* ---------- designs sewn onto other designs (a print on a pocket, art on a tag) ---------- */

export interface WorldPose { x: number; y: number; rot: number }
const rad = (d: number) => (d * Math.PI) / 180;

/** World position and turn (degrees) of an attachment on a copy. A design on another design sits in its host's frame. */
export function attWorld(atts: Attachment[], a: Attachment, e: Entry): WorldPose {
  const parent = atts.find((q) => q.id === a.pieceId);
  if (parent) {
    const pw = attWorld(atts, parent, e);
    const c = Math.cos(rad(pw.rot)), s = Math.sin(rad(pw.rot));
    return { x: pw.x + c * a.x - s * a.y, y: pw.y + s * a.x + c * a.y, rot: pw.rot + a.rotation };
  }
  const fr = frameOn(e, a);
  return { x: e.offset.x + fr.x, y: e.offset.y + fr.y, rot: fr.rotation };
}

/** Stored x, y and rotation that put attachment `a` (keeping its host) at a world pose on copy e. */
export function worldToAtt(atts: Attachment[], a: Attachment, e: Entry, w: Pt, rotW: number): { x: number; y: number; rotation: number } {
  const parent = atts.find((q) => q.id === a.pieceId);
  if (parent) {
    const pw = attWorld(atts, parent, e);
    const c = Math.cos(rad(-pw.rot)), s = Math.sin(rad(-pw.rot));
    const dx = w.x - pw.x, dy = w.y - pw.y;
    return { x: c * dx - s * dy, y: s * dx + c * dy, rotation: rotW - pw.rot };
  }
  const l = toSource(e, w);
  return { x: l.x, y: l.y, rotation: e.mirror ? -rotW : rotW };
}

/**
 * The chart turned over, like a garment turned inside out: the whole layout is mirrored left to right. Each piece is
 * seen from its other side, so its drawn outline mirrors and everything that maps the chart to the stored piece
 * (toSource, frameOn, attWorld) keeps working because `mirror` flips with it. Labels stay as worn.
 */
export function flipEntries(entries: Entry[]): Entry[] {
  return entries.map((e) => {
    const offset: Pt = { x: -e.offset.x, y: e.offset.y };
    return { ...e, flipped: true, mirror: !e.mirror, offset, piece: { ...e.piece, offset, points: e.piece.points.map((q) => ({ ...q, x: -q.x })) } };
  });
}
