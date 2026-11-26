// Pieces cut twice (legs, sleeves, cuffs) are drawn as two separate patterns on the chart: the first copy
// sits on +x, the wearer's left (the avatar faces you), the second copy is its mirror image, the wearer's right.
// Everything the user places belongs to a copy (`instance`); undefined means every copy.
import * as seamsMod from '../sim/seams';
import type { StyleId } from '../data/catalog';
import type { Piece } from '../data/presets';
import type { Pt } from '../lib/geometry';

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
}

/** How many times a piece is placed on the body. */
export function copiesOf(style: StyleId, p: Piece): number {
  if (p.role === 'custom') return p.cut >= 2 ? 2 : 1;
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
  const info = pieces.map((p) => ({ p, b: bounds(p), copies: copiesOf(style, p) }));
  const doubled = (i: { copies: number }) => showBoth && i.copies === 2;
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
    out.push({ key: `${p.id}:0`, src: p, piece: { ...p, offset: o0 }, inst: 0, copies, both, mirror: false, offset: o0, label: both ? instanceName(style, p, 0) : p.name });
    if (both) {
      const o1: Pt = { x: o0.x + 2 * b.maxX + GAP, y: p.offset.y };
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
