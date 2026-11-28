// Total symmetry: one point edit applied to every point that mirrors or mates with it, so the whole garment stays
// matched and every seam still walks.
//
// Plain symmetry (the store's `symmetry`) mirrors a point inside its own piece. A piece cut twice (left and right
// leg, both sleeves) is already one stored piece, so both copies follow for free. Total symmetry adds the pieces that
// MATE with it, by drafted point key (src/data/draft.ts), and then re-walks the seams the edit touched:
//
//  pants (jeans, sweatpants, shorts): front leg point `front.i` and back leg point `back.i` correspond for the waist
//    corners, hip, side, knee, hem and crotch points (i = 0..8). Both get the SAME delta (dx, dy), and the in-piece
//    mirror (hem outer / inner, knee outer / inner) gets (-dx, dy). So widening the front hem by 2 widens the back hem
//    by 2 too: the drafted front / back difference (back is 4 cm fuller) stays and all four leg copies change alike.
//    The fly and seat curves (9..11) are design lines of their own and are not linked. Then the seams are walked:
//    inseam -> mate crotch point height, outseam -> mate waist side point height (the same two handles the draft
//    walks with), waistband -> band length, ankle cuff -> cuff length (rib ratio kept).
//  tops (jacket, shirt, tee, polo): front `front.(i + fo)` and back `back.i` correspond for the shoulder (hps,
//    shoulder point), armhole middle, underarm, waist and hem side points (i = 2..7). Necklines and shirt tails differ
//    front to back and are not linked. Same delta on both, mirrored to the other side. Walks: shoulder -> mate
//    shoulder point x, side seam -> mate hem height, sleeve cap -> sleeve underarm (bicep) width so the cap keeps its
//    ease, neckband (rib ratio) and collar -> their length, shirt cuff -> its length.
//  hats: the six crown panels are one stored piece and the brim has no mate, so nothing extra is linked.
//
// A walk only ever adjusts the side of a seam that the user did NOT edit (the trim follows the body, the back
// follows the front you dragged), and it keeps the difference the seam had before the edit (cap ease, rib stretch,
// pleat intake), so intended ease is never lost.

import type { PPoint } from '../lib/geometry';
import { outlineLength } from '../lib/geometry';
import type { Piece } from './presets';
import { isHatFamily, migrateGarment, styleById, type StyleId } from './catalog';
import { frontOffset } from './draft';
import { builtinSeams, instanceCount } from '../sim/seams';
import type { EdgeRef } from './edits';

export interface PointMove { pieceId: string; pointId: string; dx: number; dy: number }

type Adjust = { keys: string[]; axis: 'x' | 'y'; mode?: 'add' | 'ratio' };
type Spec = { partners: (role: string, key: string) => { role: string; key: string } | null; walks: Record<string, Record<string, Adjust>> };

function specFor(style: StyleId): Spec | null {
  const st = styleById(migrateGarment(style));
  const fam = st.family;
  if (fam === 'pants') {
    return {
      partners: (role, key) => {
        const m = /^(front|back)\.(\d+)$/.exec(key);
        if (!m || m[1] !== role) return null;
        const i = Number(m[2]);
        if (i > 8) return null;
        const other = role === 'front' ? 'back' : 'front';
        return { role: other, key: `${other}.${i}` };
      },
      walks: {
        outseam: { front: { keys: ['front.1'], axis: 'y' }, back: { keys: ['back.1'], axis: 'y' } },
        inseam: { front: { keys: ['front.8'], axis: 'y' }, back: { keys: ['back.8'], axis: 'y' } },
        // each seam can be walked from either side: the trim follows the body, and the body follows a trim you drag
        waistband: {
          waistband: { keys: ['waistband.1', 'waistband.2'], axis: 'x' },
          front: { keys: ['front.1'], axis: 'x' }, back: { keys: ['back.1'], axis: 'x' },
        },
        cuff: {
          cuff: { keys: ['cuff.1', 'cuff.2'], axis: 'x', mode: 'ratio' },
          front: { keys: ['front.5'], axis: 'x', mode: 'ratio' }, back: { keys: ['back.5'], axis: 'x', mode: 'ratio' },
        },
      },
    };
  }
  if (isHatFamily(fam)) return null;
  const fo = frontOffset(st.id);
  return {
    partners: (role, key) => {
      const m = /^(front|back)\.(\d+)(m?)$/.exec(key);
      if (!m || m[1] !== role) return null;
      const i = Number(m[2]) - (role === 'front' ? fo : 0);
      // 2..7: shoulder, armhole, underarm, waist and hem side; 8 and 9: the hem towards and at centre (front and back
      // hem centre, and the shirt tail curve), so dragging the centre bottom point of one moves the other too
      if (i < 2 || i > 9) return null;
      return role === 'front' ? { role: 'back', key: `back.${i}${m[3]}` } : { role: 'front', key: `front.${i + fo}${m[3]}` };
    },
    walks: {
      shoulder: { front: { keys: [`front.${3 + fo}`], axis: 'x' }, back: { keys: ['back.3'], axis: 'x' } },
      side: { front: { keys: [`front.${7 + fo}`], axis: 'y' }, back: { keys: ['back.7'], axis: 'y' } },
      // sleeve cap: a body edit walks the bicep; a sleeve edit walks the armhole depth (underarm point, front and back)
      // so the cap keeps its ease, and the side seams then follow the underarm
      'sleeve-cap': {
        sleeve: { keys: ['sleeve.3'], axis: 'x' },
        front: { keys: [`front.${5 + fo}`], axis: 'y' }, back: { keys: ['back.5'], axis: 'y' },
      },
      // neck trim: the trim follows the neckline; a trim you drag walks the neck width (high point shoulder)
      neckband: {
        neckband: { keys: ['neckband.1', 'neckband.2'], axis: 'x', mode: 'ratio' },
        front: { keys: [`front.${2 + fo}`], axis: 'x', mode: 'ratio' }, back: { keys: ['back.2'], axis: 'x', mode: 'ratio' },
      },
      collar: {
        collar: { keys: ['collar.1', 'collar.2'], axis: 'x' },
        front: { keys: [`front.${2 + fo}`], axis: 'x' }, back: { keys: ['back.2'], axis: 'x' },
      },
      cuff: { cuff: { keys: ['cuff.1', 'cuff.2'], axis: 'x' }, sleeve: { keys: ['sleeve.4'], axis: 'x' } },
      // placket: its length and the front opening it is sewn to follow each other (the base of either one moves)
      placket: { placket: { keys: ['placket.2', 'placket.3'], axis: 'y' }, front: { keys: ['front.1', 'front.0'], axis: 'y' } },
    },
  };
}

/** Seam family name from a built-in seam id: 'inseam-r' -> 'inseam', 'sleeve-cap-front-l' -> 'sleeve-cap'. */
const family = (id: string) => (id.startsWith('sleeve-cap') ? 'sleeve-cap' : id.replace(/-(r|l)$/, ''));

type Pts = Map<string, PPoint[]>;

const sideLen = (pts: Pts, side: EdgeRef[]) => side.reduce((s, e) => s + outlineLength(pts.get(e.pieceId) ?? [], e.fromId, e.toId), 0);

/** Move a point and its in-piece mirror (on-axis points stay on the axis). Returns the moves made. */
function shift(pts: Pts, pieceId: string, pointId: string, dx: number, dy: number, acc?: Map<string, PointMove>) {
  const arr = pts.get(pieceId);
  if (!arr) return;
  const p = arr.find((q) => q.id === pointId);
  if (!p) return;
  const onAxis = p.mirror === p.id;
  const list: [string, number, number][] = [[p.id, onAxis ? 0 : dx, dy]];
  if (p.mirror && !onAxis) list.push([p.mirror, -dx, dy]);
  const next = arr.map((q) => { const hit = list.find((l) => l[0] === q.id); return hit ? { ...q, x: q.x + hit[1], y: q.y + hit[2] } : q; });
  pts.set(pieceId, next);
  if (acc) for (const [id, mx, my] of list) {
    const m = acc.get(id) ?? { pieceId, pointId: id, dx: 0, dy: 0 };
    m.dx += mx; m.dy += my;
    acc.set(id, m);
  }
}

/**
 * Every point move that one edit implies in total symmetry mode: the point itself, its mirror, the matching
 * points on mating pieces (front / back), and the walk corrections that keep the touched seams matched.
 * dx, dy: the move the user made (cm). Apply with applyMoves().
 */
export function linkedMoves(style: StyleId, pieces: Piece[], pieceId: string, pointId: string, dx: number, dy: number): PointMove[] {
  const acc = new Map<string, PointMove>();
  const pts: Pts = new Map(pieces.map((p) => [p.id, p.points]));
  const piece = pieces.find((p) => p.id === pieceId);
  const pt = piece?.points.find((q) => q.id === pointId);
  if (!piece || !pt) return [];
  shift(pts, pieceId, pointId, dx, dy, acc);
  // one side of a split pair (src/data/split.ts) is edited on its own: nothing on the other side or its mates follows
  if (piece.splitOf || piece.splitSides?.length) return [...acc.values()];
  const spec = specFor(style);
  if (!spec || !pt.key) return [...acc.values()];

  // mating point on the other piece, same delta
  const mate = spec.partners(piece.role, pt.key);
  const matePiece = mate ? pieces.find((p) => p.role === mate.role) : undefined;
  const matePt = mate && matePiece?.points.find((q) => q.key === mate.key);
  // a point on the centre line stays on it: its mate only follows up and down
  const onCentre = Math.abs(pt.x) < 0.05 || (!!matePt && Math.abs(matePt.x) < 0.05);
  if (matePiece && matePt) shift(pts, matePiece.id, matePt.id, onCentre ? 0 : dx, dy, acc);

  // walk the seams the edit touched. A walk can move a point another seam uses (the underarm after a sleeve cap
  // edit), so the groups are walked again until nothing moves; every walk targets the same "before + change" length,
  // so a settled seam is left alone.
  const before: Pts = new Map(pieces.map((p) => [p.id, p.points]));
  const seams = builtinSeams(style, pieces, { collar: 'down' });
  const groups = new Map<string, { fam: string; a: EdgeRef[]; b: EdgeRef[] }>();
  for (const s of seams) {
    const k = s.group ?? s.id;
    const g = groups.get(k) ?? groups.set(k, { fam: family(s.id), a: [], b: [] }).get(k)!;
    g.a.push(...s.a); g.b.push(...s.b);
  }
  const roleOf = (id: string) => pieces.find((p) => p.id === id)?.role;
  for (let pass = 0; pass < 3; pass++) {
    const moved = new Set([...acc.values()].map((m) => m.pieceId));
    let changed = false;
    for (const g of groups.values()) {
      const pa = new Set(g.a.map((e) => e.pieceId)), pb = new Set(g.b.map((e) => e.pieceId));
      if (pa.size === 1 && pb.size === 1 && [...pa][0] === [...pb][0]) continue; // a piece sewn to itself always walks
      const touched = (s: Set<string>) => [...s].some((id) => moved.has(id));
      if (!touched(pa) && !touched(pb)) continue;
      const walks = spec.walks[g.fam];
      if (!walks) continue;
      // master: the side holding the edited piece, else the side that moved
      let masterA = pa.has(pieceId) ? true : pb.has(pieceId) ? false : touched(pa) && !touched(pb) ? true : !touched(pa) && touched(pb) ? false : null;
      if (masterA === null) masterA = !walks[roleOf([...pa][0]) ?? ''];
      if ((masterA ? pb : pa).has(pieceId)) continue; // never re-walk the piece the user is dragging
      const master = masterA ? g.a : g.b, slave = masterA ? g.b : g.a;
      // the handles of the slave side: one per slave piece that has one (a trim can be sewn to front and back both)
      const handles: { sid: string; adj: Adjust; ids: string[] }[] = [];
      for (const sid of new Set(slave.map((e) => e.pieceId))) {
        const adj = walks[roleOf(sid) ?? ''];
        const ids = adj ? adj.keys.map((k) => pts.get(sid)?.find((q) => q.key === k)?.id).filter((v): v is string => !!v) : [];
        if (adj && ids.length) handles.push({ sid, adj, ids });
      }
      if (!handles.length) continue;
      const m0 = sideLen(before, master), s0 = sideLen(before, slave), m1 = sideLen(pts, master);
      if (Math.abs(m1 - m0) < 1e-6 && Math.abs(sideLen(pts, slave) - s0) < 1e-6) continue;
      const target = handles[0].adj.mode === 'ratio' && m0 > 0 ? (s0 * m1) / m0 : s0 + (m1 - m0);
      const apply = (t: Pts, d: number, a?: Map<string, PointMove>) => {
        for (const h of handles) for (const id of h.ids) shift(t, h.sid, id, h.adj.axis === 'x' ? d : 0, h.adj.axis === 'y' ? d : 0, a);
      };
      const trial = (d: number) => { const t: Pts = new Map(pts); apply(t, d); return sideLen(t, slave) - target; };
      // Newton on the handle, numeric slope
      let d = 0, r = trial(0);
      for (let it = 0; it < 12 && Math.abs(r) > 1e-4; it++) {
        const h = 0.05, slope = (trial(d + h) - trial(d - h)) / (2 * h);
        if (Math.abs(slope) < 1e-3) break;
        d -= Math.max(-10, Math.min(10, r / slope));
        r = trial(d);
      }
      if (Math.abs(r) < 0.05 && Math.abs(d) > 1e-6) { apply(pts, d, acc); changed = true; }
    }
    if (!changed) break;
  }
  return [...acc.values()].filter((m) => m.dx !== 0 || m.dy !== 0 || (m.pieceId === pieceId && m.pointId === pointId));
}

/** Apply point moves to pieces (new arrays, untouched pieces kept as they are). */
export function applyMoves(pieces: Piece[], moves: PointMove[]): Piece[] {
  if (!moves.length) return pieces;
  const by = new Map<string, Map<string, PointMove>>();
  for (const m of moves) (by.get(m.pieceId) ?? by.set(m.pieceId, new Map()).get(m.pieceId)!).set(m.pointId, m);
  return pieces.map((p) => {
    const mv = by.get(p.id);
    if (!mv) return p;
    return { ...p, points: p.points.map((q) => { const m = mv.get(q.id); return m ? { ...q, x: q.x + m.dx, y: q.y + m.dy } : q; }) };
  });
}

/** One set of pieces that are linked together, for the hover preview on the tool rail. */
export interface SymGroup { index: number; label: string; pieceIds: string[] }

/** Plural name of a piece cut more than once: 'Front legs', 'Sleeves'; a single piece keeps its name. */
function groupName(style: StyleId, p: Piece): string {
  const n = p.name || 'Piece';
  if (instanceCount(style, p) <= 1) return n;
  return /s$/i.test(n) ? n : `${n}s`;
}

/**
 * The pieces a symmetry mode links, grouped for the preview.
 *  'sym': one group per piece that mirrors (about its own centre line, or as a left and right pair, or all the crown
 *    panels): both halves of a group share a colour, different groups differ.
 *  'total': every piece total symmetry reaches (mating front and back, and the trims it walks) in ONE group.
 * Pieces the mode does not link are in no group.
 */
export function symmetryGroups(style: StyleId, pieces: Piece[], mode: 'sym' | 'total'): SymGroup[] {
  const mirrored = pieces.filter((p) => p.symmetric || instanceCount(style, p) > 1);
  if (mode === 'sym') return mirrored.map((p, i) => ({ index: i, label: groupName(style, p), pieceIds: [p.id] }));
  const spec = specFor(style);
  const roles = new Set<string>();
  if (spec) {
    roles.add('front'); roles.add('back');
    for (const w of Object.values(spec.walks)) for (const r of Object.keys(w)) roles.add(r);
  }
  const hit = spec ? pieces.filter((p) => roles.has(p.role) && p.role !== 'custom') : mirrored;
  return hit.length ? [{ index: 0, label: hit.map((p) => groupName(style, p)).join(', '), pieceIds: hit.map((p) => p.id) }] : [];
}
