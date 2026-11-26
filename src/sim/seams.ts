// Built-in sewing lines of a style, each with a stable id so the user can detach or re-attach it.
// setup.ts sews FROM this list (single source of truth), skipping edits.detachedSeams and adding
// edits.customSeams. The UI lists these with attach / detach toggles.
//
// Pieces cut more than once are placed as several instances (EdgeRef.instance):
//   front / back of pants, sleeve, cuff: 0 = right side of the body (+x), 1 = left side (-x, mirrored)
//   crown panel: 0..5, every 60 degrees round the head
// Order matters: the solver works through the seams in this order, so it is kept exactly as the
// hand-written sewing it replaced (single seams first, then seams that run along several pieces).

import type { Piece } from '../data/presets';
import { migrateGarment, styleById, type StyleId } from '../data/catalog';
import { frontOffset } from '../data/draft';
import type { Attachment, EdgeRef, Edits, Face } from '../data/edits';

export interface BuiltinSeam {
  /** stable id, e.g. 'shoulder-r', 'side-l', 'inseam-r', 'waistband' */
  id: string;
  /** plain language label for the UI, named as worn, e.g. 'Left shoulder' */
  label: string;
  /** one or more piece edges in a row on each side */
  a: EdgeRef[];
  b: EdgeRef[];
  /** seams that belong together in the UI (both halves of a sleeve cap), toggled as one */
  group?: string;
}

/** How many times a piece is placed on the body (instances), by role and style family. */
export function instanceCount(style: StyleId, p: Piece): number {
  const fam = styleById(migrateGarment(style)).family;
  if (p.role === 'crown') return 6;
  if (p.role === 'sleeve') return 2;
  if (p.role === 'cuff') return fam === 'shirt' || fam === 'pants' ? 2 : 1;
  if (fam === 'pants' && (p.role === 'front' || p.role === 'back')) return 2;
  if (p.role === 'custom') return p.cut > 1 ? 2 : 1; // a user piece cut twice is placed as a pair
  return 1;
}

/**
 * Plain language name of one placed copy of a piece, for the UI, specs, PDF and DXF:
 * 'Right front leg', 'Left sleeve', 'Crown panel 3'. A piece placed once keeps its name. Without an
 * instance (an edit on every copy): 'Both front legs', 'All 6 crown panels'.
 */
export function instanceLabel(style: StyleId, piece: Piece, instance?: number): string {
  const n = instanceCount(style, piece);
  const name = piece.name || 'Piece';
  if (n <= 1) return name;
  const lower = name.charAt(0).toLowerCase() + name.slice(1);
  if (instance === undefined) {
    const plural = /s$/i.test(lower) ? lower : `${lower}s`;
    return n === 2 ? `Both ${plural}` : `All ${n} ${plural}`;
  }
  if (piece.role === 'crown') return `${name} ${Math.max(0, Math.min(n - 1, instance)) + 1}`;
  return `${instance === 1 ? 'Right' : 'Left'} ${lower}`;
}

/**
 * Built-in seams of a style. edits: with Edits.collar set (the collar option chosen, 'down' or 'up'), the polo collar
 * runs round the right neckline to the placket edge on that side. Without it (projects from before the option) the
 * sewing stays exactly as it was, where the right half of a polo collar is sewn down the placket opening; kept only so
 * old saves drape bit for bit the same (tests/fixtures/sew-baseline.json).
 */
export function builtinSeams(style: StyleId, pieces: Piece[], edits?: Pick<Edits, 'collar'>): BuiltinSeam[] {
  const collarSet = edits?.collar !== undefined;
  const st = styleById(migrateGarment(style));
  const fam = st.family;
  const out: BuiltinSeam[] = [];
  const multi: BuiltinSeam[] = []; // sewn after the single seams, as before
  const role = (r: string) => pieces.find((p) => p.role === r);
  /** edge on a piece between two keyed points; null when a key is missing */
  const E = (p: Piece | undefined, from: string, to: string, instance = 0): EdgeRef | null => {
    if (!p) return null;
    const a = p.points.find((q) => q.key === from)?.id, b = p.points.find((q) => q.key === to)?.id;
    return a && b ? { pieceId: p.id, fromId: a, toId: b, ...(instance ? { instance } : {}) } : null;
  };
  const push = (list: BuiltinSeam[], id: string, label: string, a: (EdgeRef | null)[], b: (EdgeRef | null)[], group?: string) => {
    if (a.some((e) => !e) || b.some((e) => !e)) return; // a seam with a missing point cannot be sewn
    list.push({ id, label, a: a as EdgeRef[], b: b as EdgeRef[], ...(group ? { group } : {}) });
  };
  const S = (id: string, label: string, a: EdgeRef | null, b: EdgeRef | null, group?: string) => push(out, id, label, [a], [b], group);
  const M = (id: string, label: string, a: (EdgeRef | null)[], b: (EdgeRef | null)[]) => push(multi, id, label, a, b);
  // sides are named as worn: copy 0 sits on +x, which is the wearer's left (the avatar faces the camera)
  const sideName = (i: number) => (i === 0 ? 'Left' : 'Right');
  const sfx = (i: number) => (i === 0 ? 'r' : 'l');

  const hat = fam === 'bucket' || fam === 'cap';
  if (hat) {
    const cr = role('crown'), brim = role('brim');
    if (!cr) return [];
    for (let k = 0; k < 6; k++) S(`crown-${k + 1}`, `Crown seam ${k + 1}`, E(cr, 'crown.0', 'crown.3', k), E(cr, 'crown.0', 'crown.3m', (k + 1) % 6));
    const base = (k: number) => [E(cr, 'crown.3m', 'crown.4', k), E(cr, 'crown.4', 'crown.3', k)];
    if (brim && fam === 'bucket') {
      S('brim-join', 'Brim back seam', E(brim, 'brim.6', 'brim.7'), E(brim, 'brim.6m', 'brim.7m'));
      M('brim', 'Brim to crown', [E(brim, 'brim.0', 'brim.6'), E(brim, 'brim.6m', 'brim.0')], [0, 1, 2, 3, 4, 5].flatMap(base));
    } else if (brim) {
      M('visor', 'Visor to crown', [E(brim, 'brim.3m', 'brim.0'), E(brim, 'brim.0', 'brim.3')], [base(4)[1], ...base(5), ...base(0), base(1)[0]]);
    }
    return [...out, ...multi];
  }

  const fr = role('front'), bk = role('back');
  if (!fr || !bk) return [];

  if (fam === 'pants') {
    for (const i of [0, 1]) {
      S(`outseam-${sfx(i)}`, `${sideName(i)} outseam`, E(fr, 'front.1', 'front.5', i), E(bk, 'back.1', 'back.5', i));
      S(`inseam-${sfx(i)}`, `${sideName(i)} inseam`, E(fr, 'front.6', 'front.8', i), E(bk, 'back.6', 'back.8', i));
    }
    S('crotch-front', 'Front rise', E(fr, 'front.8', 'front.0', 0), E(fr, 'front.8', 'front.0', 1));
    S('crotch-back', 'Back rise', E(bk, 'back.8', 'back.0', 0), E(bk, 'back.8', 'back.0', 1));
    const band = role('waistband');
    if (band) {
      S('waistband-join', 'Waistband join', E(band, 'waistband.1', 'waistband.2'), E(band, 'waistband.1m', 'waistband.2m'));
      M('waistband', 'Waistband', [E(band, 'waistband.2m', 'waistband.2')],
        [E(fr, 'front.0', 'front.1', 0), E(bk, 'back.1', 'back.0', 0), E(bk, 'back.0', 'back.1', 1), E(fr, 'front.1', 'front.0', 1)]);
    }
    const cuff = role('cuff');
    if (cuff) {
      for (const i of [0, 1]) S(`cuff-join-${sfx(i)}`, `${sideName(i)} ankle cuff join`, E(cuff, 'cuff.1', 'cuff.2', i), E(cuff, 'cuff.1m', 'cuff.2m', i));
      for (const i of [0, 1]) M(`cuff-${sfx(i)}`, `${sideName(i)} ankle cuff`, [E(cuff, 'cuff.1', 'cuff.1m', i)], [E(fr, 'front.5', 'front.6', i), E(bk, 'back.6', 'back.5', i)]);
    }
    return [...out, ...multi];
  }

  // ---- tops ----
  const fo = frontOffset(st.id);
  const F = (i: number, m = '') => `front.${i + fo}${m}`;
  const B = (i: number, m = '') => `back.${i}${m}`;
  // right side of the body (+x): front keys without "m" meet back keys with "m"
  S('shoulder-r', 'Left shoulder', E(fr, F(2), F(3)), E(bk, B(2, 'm'), B(3, 'm')));
  S('shoulder-l', 'Right shoulder', E(fr, F(2, 'm'), F(3, 'm')), E(bk, B(2), B(3)));
  S('side-r', 'Left side seam', E(fr, F(5), F(7)), E(bk, B(5, 'm'), B(7, 'm')));
  S('side-l', 'Right side seam', E(fr, F(5, 'm'), F(7, 'm')), E(bk, B(5), B(7)));
  const sleeve = role('sleeve');
  if (sleeve) {
    for (const i of [0, 1]) {
      const r = i === 0;
      S(`underarm-${sfx(i)}`, `${sideName(i)} sleeve seam`, E(sleeve, 'sleeve.3', 'sleeve.4', i), E(sleeve, 'sleeve.3m', 'sleeve.4m', i));
      S(`sleeve-cap-front-${sfx(i)}`, `${sideName(i)} sleeve cap, front`, E(sleeve, 'sleeve.0', 'sleeve.3', i), r ? E(fr, F(3), F(5)) : E(fr, F(3, 'm'), F(5, 'm')), `sleeve-cap-${sfx(i)}`);
      S(`sleeve-cap-back-${sfx(i)}`, `${sideName(i)} sleeve cap, back`, E(sleeve, 'sleeve.0', 'sleeve.3m', i), r ? E(bk, B(3, 'm'), B(5, 'm')) : E(bk, B(3), B(5)), `sleeve-cap-${sfx(i)}`);
    }
  }
  const placket = role('placket');
  if (placket) {
    S('placket-r', 'Left placket', E(placket, 'placket.1', 'placket.2'), E(fr, 'front.2', 'front.1'));
    S('placket-l', 'Right placket', E(placket, 'placket.1m', 'placket.2m'), E(fr, 'front.2m', 'front.1m'));
    S('placket-base', 'Placket base', E(placket, 'placket.2', 'placket.2m'), E(fr, 'front.1', 'front.1m'));
  }
  const band = role('neckband');
  if (band) {
    S('neckband-join', 'Neckband join', E(band, 'neckband.1', 'neckband.2'), E(band, 'neckband.1m', 'neckband.2m'));
    M('neckband', 'Neckband', [E(band, 'neckband.1', 'neckband.1m')],
      [E(bk, B(0), B(2, 'm')), E(fr, F(2), F(0)), E(fr, F(0), F(2, 'm')), E(bk, B(2), B(0))]);
  }
  const collar = role('collar');
  if (collar) {
    // the polo neckline ends at the placket edge on each side (front.2 / front.2m)
    const neck = [E(fr, F(0), F(2)), E(bk, B(2, 'm'), B(0)), E(bk, B(0), B(2)), E(fr, F(2, 'm'), fo && collarSet ? F(0, 'm') : F(0))];
    // polo: the collar runs from the middle of the placket, round the neck, back to the middle of the placket
    if (placket) { neck.unshift(E(placket, 'placket.0', 'placket.1')); neck.push(E(placket, 'placket.1m', 'placket.0')); }
    M('collar', 'Collar', [E(collar, 'collar.1', 'collar.1m')], neck);
  }
  const cuff = role('cuff');
  if (fam === 'shirt' && cuff && sleeve) {
    for (const i of [0, 1]) S(`cuff-join-${sfx(i)}`, `${sideName(i)} cuff join`, E(cuff, 'cuff.1', 'cuff.2', i), E(cuff, 'cuff.1m', 'cuff.2m', i));
    for (const i of [0, 1]) M(`cuff-${sfx(i)}`, `${sideName(i)} cuff`, [E(cuff, 'cuff.1', 'cuff.1m', i)], [E(sleeve, 'sleeve.4', 'sleeve.4m', i)]);
  }
  return [...out, ...multi];
}

// ---- faces ----
// Every pattern piece has two faces (Face in src/data/edits.ts): 'outside' is the right side of the fabric, the
// side that shows on the finished garment; 'inside' is the side against the body (placket facing, lining side).
//
// A collar is one panel with a roll line across it (collarRoll): below it the stand rises from the neckline,
// above it the fall. Its faces are named for the collar worn folded down:
//   'outside' = top collar: on the stand it faces the neck, it rolls over the fold line and is the visible top
//               of the fall when the collar is down.
//   'inside'  = under collar: on the stand it faces away from the neck, on the fall it lies against the stand and
//               the shoulders when the collar is down, and it is the face you see when the collar is popped up.
// The 'built' message panelSign (src/sim/worker.ts) points at the 'outside' face of each panel with this meaning.

/** Which host face an attachment sits on: its own face, or for a tag 'inside' (a neck tag is sewn on the inside). */
export const faceOf = (a: Pick<Attachment, 'face' | 'kind'>): Face => a.face ?? (a.kind === 'label' ? 'inside' : 'outside');

/** Collar worn down (default) or popped up. */
export const collarState = (edits?: Pick<Edits, 'collar'>): 'down' | 'up' => (edits?.collar === 'up' ? 'up' : 'down');

/**
 * Height of the collar stand at centre back (cm from the neckline edge): the roll line, where a collar worn down
 * folds over. Knit collars roll 2.5 cm up; woven collars about 42% of the collar height (2 to 3 cm).
 */
export function collarRoll(style: StyleId, piece: Piece): number {
  const fam = styleById(migrateGarment(style)).family;
  if (fam === 'polo') return 2.5;
  const cb = piece.points.find((q) => q.key === 'collar.3')?.y ?? Math.max(...piece.points.map((q) => q.y));
  return Math.min(3, Math.max(2, 0.42 * cb));
}

/**
 * Which face of a piece shows on top (to someone looking at the wearer) with the collar down and up. Only a
 * collar changes: down shows the top collar ('outside'), up shows the under collar ('inside'). Every other piece
 * shows its 'outside' face either way.
 */
export function visibleFace(_style: StyleId, piece: Pick<Piece, 'role'>, _collar?: 'down' | 'up'): { up: Face; down: Face } {
  return piece.role === 'collar' ? { up: 'inside', down: 'outside' } : { up: 'outside', down: 'outside' };
}

/**
 * Plain language name of one face of a piece for the UI and the spec sheet: 'Top collar', 'Under collar',
 * 'Placket facing', 'Lining side', 'Top of brim', 'Under brim', 'Outside', 'Inside'.
 */
export function faceLabel(style: StyleId, piece: Pick<Piece, 'role'>, face: Face, collar?: 'down' | 'up'): string {
  const fam = styleById(migrateGarment(style)).family;
  const out = face === 'outside';
  if (piece.role === 'collar') {
    void collar; // same names either way: visibleFace says which one shows
    return out ? 'Top collar' : 'Under collar';
  }
  if (out) return piece.role === 'brim' ? 'Top of brim' : 'Outside';
  if (piece.role === 'placket') return 'Placket facing';
  if (piece.role === 'brim') return 'Under brim';
  if (fam === 'jacket' || fam === 'cap' || fam === 'bucket') return 'Lining side';
  return 'Inside';
}
