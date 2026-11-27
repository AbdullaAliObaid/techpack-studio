// Construction of a style made real on the pattern: everything the 3D view shows of a garment's make (buttons and
// buttonholes, rivets, belt loops, pockets, the fly zip, stitching lines) exists on the 2D pattern as well, the way a
// tech pack shows it.
//
//  builtinDetails(style, pieces, body)  the style's buttons, buttonholes, rivets, belt loops, pockets and fly zip as
//                                       ordinary attachments (Attachment.builtin = true), placed from the drafted
//                                       points. They print and edit like the user's own attachments.
//  stitchLines(style, pieces, edits)    every stitching line per piece in pattern coords: seam topstitching, hems,
//                                       edge stitching of trims, the jeans pocket opening and the fly J stitch. The
//                                       chart and the tech pack draw them; the 3D view draws the pocket and fly lines
//                                       from here too (src/sim/details.ts), so both always agree.
//  withBuiltins(project)                gives a project from before this its style details once (Edits.builtin).
//  upgradeFront(project)                redrafts a closed front of an old save as split fronts, keeping its edits.
//
// Buttons and buttonholes: the buttons sit on the front that goes under, the buttonholes on the front that laps over
// (right over left as worn for men, left over right for women, Body.sex). The sim buttons each hole to its button.

import { bezAt, pointInPoly, samplePoly, toBeziers, type PPoint, type Pt } from '../lib/geometry';
import { uid } from '../lib/units';
import type { Body } from '../three/body';
import { migrateGarment, styleById, type StyleId } from './catalog';
import { draft, isSplitFront, pocketOpening, regradePoints, splitFrontStyle, flyStyle, frontPocketStyle, type Fit } from './draft';
import { EMPTY_EDITS, type Attachment, type EdgeRef, type Edits, type Hardware } from './edits';
import { fabricHex } from './fabrics';
import { INSIDE_ROLES, makePreset, type Piece } from './presets';
import { builtinSeams, instanceCount } from '../sim/seams';

/** Version of the style details builtinDetails makes (Edits.builtin). */
export const BUILTIN_VERSION = 1;

/** The front that laps over: copy 1 (the wearer's right) for men, copy 0 for women. Same rule as the simulation. */
const overOf = (body?: Pick<Body, 'sex'>) => (body?.sex === 'female' ? 0 : 1);

const key = (p: Piece | undefined, k: string) => p?.points.find((q) => q.key === k);
const tagged = (p: Piece | undefined, t: string) => p?.points.find((q) => q.tag === t);

type NewAttachment = Omit<Attachment, 'id'>;
const base = (name: string, pieceId: string, x: number, y: number, extra: Partial<Attachment> = {}): NewAttachment =>
  ({ kind: 'hardware', name, pieceId, x, y, rotation: 0, w: 1, h: 1, outline: 'rect', layers: [], builtin: true, ...extra });

/** A row of buttons (or buttonholes) down a line at x from y0 to y1, as one attachment. */
function buttonRow(name: string, pieceId: string, x: number, y0: number, y1: number, n: number, hw: Hardware, extra: Partial<Attachment>): NewAttachment {
  const spacing = n > 1 ? (y1 - y0) / (n - 1) : 0;
  return base(name, pieceId, x, (y0 + y1) / 2, { rotation: 90, hardware: { ...hw, count: n, spacing }, ...extra });
}

/**
 * The style's buttons, buttonholes, rivets, belt loops, pockets and fly zip as attachments with builtin: true,
 * positioned from the drafted pattern points. Body gives the side the front laps over (Body.sex).
 */
export function builtinDetails(style: StyleId, pieces: Piece[], body?: Pick<Body, 'sex'>): Attachment[] {
  const st = styleById(migrateGarment(style));
  const d = st.details;
  const role = (r: string) => pieces.find((p) => p.role === r);
  const out: NewAttachment[] = [];
  const over = overOf(body), under = 1 - over;

  if (d.buttons && splitFrontStyle(st.id)) {
    // buttons down centre front of the front that goes under, buttonholes at the same places on the front over it
    const fr = role('front');
    const top = key(fr, 'front.0'), hem = tagged(fr, 'cfHem');
    if (fr && top && hem && isSplitFront(fr)) {
      const shirt = st.family === 'shirt';
      const n = d.buttons, span = hem.y - top.y;
      const first = top.y + (shirt ? 1.6 : 2.5), last0 = top.y + 0.8 * span;
      const pitch = n > 1 ? Math.min(12, (last0 - first) / (n - 1)) : 0;
      const last = first + pitch * (n - 1);
      const hw: Hardware = shirt
        ? { type: 'button', finish: 'white', size: 1.1, holes: 4, color: '#eee9db' }
        : { type: 'button', finish: 'brass', size: 1.8, holes: 4 };
      out.push(buttonRow('Front buttons', fr.id, 0, first, last, n, hw, { instance: under }));
      // shirts: holes along the placket; jackets: keyhole buttonholes across the front
      out.push(buttonRow('Front buttonholes', fr.id, 0, first, last, n, shirt ? { ...hw, holeDir: 'along' } : { ...hw, holeStyle: 'keyhole' }, { instance: over, buttonhole: true }));
    }
  }
  if (d.buttons && st.family === 'polo') {
    // polo: buttons on the placket strip that goes under, buttonholes on the strip over it
    const pl = role('placket');
    const h = pl ? Math.max(...pl.points.map((q) => q.y)) : 0;
    if (pl && h > 6) {
      const n = d.buttons, y0 = 2, y1 = n > 1 ? Math.min(y0 + 8 * (n - 1), h - 2) : y0;
      const hw: Hardware = { type: 'button', finish: 'white', size: 1.1, holes: 2, color: '#eee9db' };
      out.push(buttonRow('Placket buttons', pl.id, 0, y0, y1, n, hw, { instance: under }));
      out.push(buttonRow('Placket buttonholes', pl.id, 0, y0, y1, n, { ...hw, holeDir: 'along' }, { instance: over, buttonhole: true }));
    }
  }
  if (d.buttons && st.family === 'cap') {
    // covered top button where the six crown panels meet
    const cr = role('crown');
    if (cr) out.push(base('Top button', cr.id, 0, 0.6, { instance: 0, hardware: { type: 'button', finish: 'white', size: 1.4, holes: 'shank', color: fabricHex(cr.fabric) } }));
  }

  const band = role('waistband');
  if (d.beltLoops && band) {
    // belt loops round the waistband: from centre front (one band end) to the back, spread over 68% of the band
    const W = 2 * Math.max(...band.points.map((q) => q.x)), H = Math.max(...band.points.map((q) => q.y));
    const n = d.beltLoops, step = n > 1 ? 0.68 / (n - 1) : 0;
    for (let j = 0; j < n; j++) {
      const s = 0.5 + (j - (n - 1) / 2) * step;
      out.push(base('Belt loop', band.id, -W / 2 + s * W, H / 2, { kind: 'strap', w: 1.2, h: Math.max(1, H * 0.95) }));
    }
  }

  const front = role('front'), back = role('back');
  if (st.family === 'pants' && front && frontPocketStyle(st.id)) {
    // five pocket jeans: rivets at the ends of the front pocket openings, a coin pocket on the right front,
    // patch pockets on both back legs with a rivet at each top corner
    const po = pocketOpening(front.points);
    const rivet: Hardware = { type: 'rivet', finish: 'copper', size: 0.9 };
    if (po) {
      out.push(base('Pocket rivet, top', front.id, po.A.x + 0.4, po.A.y + 1.2, { hardware: rivet }));
      out.push(base('Pocket rivet, side', front.id, po.B.x - 1.0, po.B.y, { hardware: rivet }));
      const ws = key(front, 'front.1')!;
      out.push(base('Coin pocket', front.id, ws.x - 3.3, ws.y + 4.2, { kind: 'pocket', outline: 'rect', w: 5, h: 5, instance: 1 }));
    }
    const w0 = key(back, 'back.0'), w1 = key(back, 'back.1');
    if (back && w0 && w1) {
      const vP = w1.y + 6.5;
      const side = sideX(back.points, back.points.indexOf(w1), vP + 7);
      const mid = (side + w0.x) / 2 - 0.5, hw = 7, ht = 15.5;
      if (Number.isFinite(side) && Math.abs(side - w0.x) > 2 * hw + 4) {
        out.push(base('Back pocket', back.id, mid, vP + ht / 2, { kind: 'pocket', outline: 'pointed', w: 2 * hw, h: ht }));
        out.push(base('Back pocket rivet', back.id, mid - hw + 0.6, vP + 0.6, { hardware: { ...rivet, size: 0.8 } }));
        out.push(base('Back pocket rivet', back.id, mid + hw - 0.6, vP + 0.6, { hardware: { ...rivet, size: 0.8 } }));
      }
    }
  }
  if (st.family === 'pants' && front && flyStyle(st.id)) {
    // zip fly on the front that laps over, sewn behind the fly facing (on the inside, it does not show)
    const z = flyZip(front);
    if (z) out.push(base('Fly zip', front.id, z.x, z.y, {
      instance: flyCopy(body), face: 'inside', rotation: z.rotation, w: 1, h: z.length,
      hardware: { type: 'zipper', finish: 'brass', size: 1, open: false, zipper: { teeth: 'metal', tape: fabricHex(front.fabric), puller: 'standard' } },
    }));
  }
  return out.map((a) => ({ ...a, id: uid() }));
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* buttonholes the user adds                                                                                          */

/** Cut length of a buttonhole for a button of diameter `size` (cm): the button plus 3 mm (as the trims report says). */
export const buttonholeLength = (size: number) => size + 0.3;

/**
 * Stitched outline of one buttonhole, centred on (0, 0) with the slot along +x (cm). Straight: a slot 4 mm wide with
 * square bar tacks. Keyhole: the same slot with a round eye at the +x end (where the button shank sits) and a tapered
 * bar tack at the other end.
 */
export function buttonholeOutline(size: number, style: 'straight' | 'keyhole' = 'straight'): Pt[] {
  const L = buttonholeLength(size), w = 0.2;
  if (style === 'straight') return [{ x: -L / 2, y: -w }, { x: L / 2, y: -w }, { x: L / 2, y: w }, { x: -L / 2, y: w }];
  const R = Math.max(0.15, 0.12 * size + 0.05), cx = L / 2 - R, a0 = Math.asin(Math.min(0.95, w / R));
  const eye: Pt[] = [];
  for (let k = 0; k <= 16; k++) { const t = a0 + ((2 * Math.PI - 2 * a0) * k) / 16; eye.push({ x: cx - R * Math.cos(t), y: -R * Math.sin(t) }); }
  return [{ x: -L / 2, y: 0 }, { x: -L / 2 + w, y: -w }, ...eye, { x: -L / 2 + w, y: w }];
}

/**
 * Each buttonhole of a buttonhole attachment as its stitched outline in the attachment's own coords (cm, centred,
 * before rotation; the row runs along local x), or in the host piece's coords with `onPiece`.
 */
export function buttonholeSlots(a: Pick<Attachment, 'hardware' | 'buttonhole' | 'x' | 'y' | 'rotation'>, onPiece = false): Pt[][] {
  const h = a.hardware;
  if (!a.buttonhole || !h) return [];
  const n = Math.max(1, Math.round(h.count ?? 1)), sp = h.spacing ?? Math.max(1.5, h.size * 2);
  const unit = buttonholeOutline(h.size, h.holeStyle ?? 'straight');
  const along = h.holeDir === 'along';
  const r = (a.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return Array.from({ length: n }, (_, k) => unit.map((q) => {
    const lx = (k - (n - 1) / 2) * sp + (along ? q.x : q.y), ly = along ? q.y : q.x;
    return onPiece ? { x: a.x + lx * c - ly * s, y: a.y + lx * s + ly * c } : { x: lx, y: ly };
  }));
}

export interface ButtonholeOpts {
  /** host piece and centre of the row (piece pattern coords, cm), row direction in degrees (0 = across, 90 = down) */
  pieceId: string;
  x: number;
  y: number;
  rotation: number;
  /** button diameter the holes take (cm) */
  size: number;
  count: number;
  /** centre to centre (cm) */
  spacing: number;
  style?: 'straight' | 'keyhole';
  dir?: 'across' | 'along';
  /** copy of a piece cut twice that gets the holes (0 the wearer's left, 1 the right); omitted: every copy */
  instance?: number;
  /** add matching buttons: on the other copy of a piece cut twice (at the mirrored place, where it laps over), or on `buttonPieceId` at the same place */
  button?: boolean;
  buttonPieceId?: string;
  finish?: Hardware['finish'];
  /** stitching thread (CSS colour); omitted: matched to the cloth */
  thread?: string;
  /** symmetry on: a row off the centre line of a symmetric piece cut once is mirrored across it as well */
  symmetric?: boolean;
}

/**
 * A row of buttonholes (Attachment kind 'hardware', type 'button', buttonhole: true) and, if asked, the matching
 * buttons, ready for the store. Copies of a piece cut twice are mirror images, so the button on the other copy goes at
 * the mirrored pattern place (-x): it meets its hole where the two lap over (the style's own front buttons sit at x = 0).
 */
export function buttonholeSet(style: StyleId, pieces: Piece[], o: ButtonholeOpts): Omit<Attachment, 'id'>[] {
  const host = pieces.find((p) => p.id === o.pieceId);
  if (!host) return [];
  const n = Math.max(1, Math.min(24, Math.round(o.count))), size = Math.max(0.6, o.size), spacing = n > 1 ? Math.max(buttonholeLength(size) + 0.3, o.spacing) : 0;
  const twice = instanceCount(style, host) === 2;
  const hole: Hardware = { type: 'button', finish: o.finish ?? 'white', size, count: n, spacing, holes: 4, holeStyle: o.style ?? 'straight', holeDir: o.dir ?? 'across' };
  const w = (n - 1) * spacing + buttonholeLength(size);
  const row = (x: number, rotation: number, name: string): Omit<Attachment, 'id'> => ({
    kind: 'hardware', name, pieceId: host.id, x, y: o.y, rotation, w, h: size, outline: 'rect', layers: [], buttonhole: true,
    hardware: { ...hole }, ...(o.thread ? { thread: o.thread } : {}), ...(twice && o.instance !== undefined ? { instance: o.instance } : {}),
  });
  const label = n > 1 ? `Buttonholes, ${n}` : 'Buttonhole';
  const out: Omit<Attachment, 'id'>[] = [row(o.x, o.rotation, label)];
  const mirrored = !!o.symmetric && !twice && host.symmetric && Math.abs(o.x) > 0.3;
  if (mirrored) out.push(row(-o.x, (540 - o.rotation) % 360, `${label}, mirrored`));
  if (o.button) {
    const target = o.buttonPieceId ? pieces.find((p) => p.id === o.buttonPieceId) : twice && o.instance !== undefined ? host : undefined;
    if (target) {
      const other = target === host ? 1 - o.instance! : instanceCount(style, target) === 2 ? o.instance : undefined;
      // the other copy of the same piece is its mirror image: the button meets the hole at the mirrored pattern place
      const flip = target === host;
      for (const h of [...out]) out.push({
        ...h, name: n > 1 ? `Buttons, ${n}` : 'Button', pieceId: target.id, buttonhole: undefined, w: (n - 1) * spacing + size,
        ...(flip ? { x: -h.x, rotation: (540 - h.rotation) % 360 } : {}),
        hardware: { type: 'button', finish: hole.finish, size, count: n, spacing, holes: 4 },
        ...(other !== undefined ? { instance: other } : { instance: undefined }),
      });
    }
  }
  return out.map((a) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as Omit<Attachment, 'id'>);
}

/** x of the side seam at height y, walking the outline forward from point index i0 */
function sideX(points: PPoint[], i0: number, y: number) {
  const bz = toBeziers(points);
  for (let s = 0; s < 4; s++) {
    const b = bz[(i0 + s) % bz.length];
    let prev = bezAt(b, 0);
    for (let k = 1; k <= 48; k++) {
      const q = bezAt(b, k / 48);
      if ((prev.y - y) * (q.y - y) <= 0 && q.y !== prev.y) return prev.x + ((y - prev.y) / (q.y - prev.y)) * (q.x - prev.x);
      prev = q;
    }
  }
  return NaN;
}

/** The fly laps over on the wearer's left for men (copy 0), on the right for women. */
export const flyCopy = (body?: Pick<Body, 'sex'>) => (body?.sex === 'female' ? 1 : 0);

/** Fly zip on a front leg: along the straight front edge (front.0 to front.11), 1.2 cm in from it, from 1 cm below the waist. */
function flyZip(front: Piece) {
  const a = key(front, 'front.0'), b = key(front, 'front.11');
  if (!a || !b) return null;
  const L = Math.hypot(b.x - a.x, b.y - a.y);
  if (L < 6) return null;
  const d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
  let n = { x: d.y, y: -d.x };
  if (n.x < 0) n = { x: -n.x, y: -n.y }; // into the leg (the front edge is the leg's -x side)
  const length = L - 2, s = 1 + length / 2;
  return { x: a.x + d.x * s + n.x * 1.2, y: a.y + d.y * s + n.y * 1.2, length, rotation: (Math.atan2(-d.x, d.y) * 180) / Math.PI, a, d, n, L };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* stitching lines                                                                                                   */

/** 'opening': a line the piece is cut along (the jeans pocket opening), drawn on the chart, not stitched */
export type StitchKind = 'topstitch' | 'edge' | 'hem' | 'brim' | 'pocket' | 'fly' | 'opening' | 'buttonhole';
export interface StitchLine {
  pieceId: string;
  /** placed copy of a piece cut more than once; omitted: every copy (the copies are mirror images) */
  instance?: number;
  kind: StitchKind;
  /** one needle row, piece-local pattern coords (cm) */
  points: Pt[];
  /** thread colour: CSS colour, or 'match' (a tone of the fabric) */
  color: string;
  /** distance in from the edge or line it follows (cm) */
  offset: number;
  label: string;
}

const TRIMS = new Set(['collar', 'cuff', 'waistband', 'neckband', 'placket', 'brim']);

/** sampled outline segments i (from point i to i + 1), as polylines */
function segPts(p: Piece, i: number, per = 10): Pt[] {
  const b = toBeziers(p.points)[i];
  return Array.from({ length: per + 1 }, (_, k) => bezAt(b, k / per));
}

/** outline segments (index of the start point) between two point ids, the shorter way round */
function segsOf(p: Piece, fromId: string, toId: string): number[] {
  const n = p.points.length;
  const ia = p.points.findIndex((q) => q.id === fromId), ib = p.points.findIndex((q) => q.id === toId);
  if (ia < 0 || ib < 0) return [];
  const fwd = (ib - ia + n) % n, back = (ia - ib + n) % n;
  const out: number[] = [];
  if (fwd <= back) for (let i = ia; i !== ib; i = (i + 1) % n) out.push(i);
  else for (let i = ib; i !== ia; i = (i + 1) % n) out.push(i);
  return out;
}

/** a polyline moved `by` cm to one side (side +1: left of the direction of travel) */
function offsetLine(pts: Pt[], by: number, side: number): Pt[] {
  return pts.map((p, j) => {
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
    const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
    return { x: p.x - (ty / l) * by * side, y: p.y + (tx / l) * by * side };
  });
}

/** the runs of a polyline that lie inside a polygon (2 points or more each) */
function clipTo(poly: Pt[], pts: Pt[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const q of pts) {
    if (pointInPoly(poly, q)) cur.push(q);
    else { if (cur.length >= 2) out.push(cur); cur = []; }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

const signedArea = (pts: Pt[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;

/**
 * Every stitching line of the garment, per piece, in the piece's own pattern coords: topstitching beside the seams
 * (on the piece that is pressed over, the trim side of a trim seam), edge stitching round trims, hems on the free
 * edges, the stitched rows of a brim, the jeans pocket openings and the fly J stitch. From the style's Details and the
 * sewing of this pattern (built-in seams minus detached ones, plus custom seams).
 */
export function stitchLines(style: StyleId, pieces: Piece[], edits: Edits = EMPTY_EDITS): StitchLine[] {
  const st = styleById(migrateGarment(style));
  const d = st.details;
  const t = d.topstitch;
  const color = t?.color ?? 'match';
  const out: StitchLine[] = [];
  const off = new Set(edits.detachedSeams);
  const sewn = new Map<string, Map<number, boolean>>(); // piece -> segment -> topstitched on this side
  const mark = (refs: EdgeRef[], own: boolean) => {
    for (const r of refs) {
      const p = pieces.find((q) => q.id === r.pieceId);
      if (!p) continue;
      const m = sewn.get(p.id) ?? sewn.set(p.id, new Map()).get(p.id)!;
      for (const i of segsOf(p, r.fromId, r.toId)) m.set(i, (m.get(i) ?? false) || own);
    }
  };
  const isTrim = (refs: EdgeRef[]) => refs.every((r) => TRIMS.has(pieces.find((q) => q.id === r.pieceId)?.role ?? ''));
  for (const bs of builtinSeams(st.id, pieces, edits)) {
    if (off.has(bs.id)) continue;
    const ta = isTrim(bs.a), tb = isTrim(bs.b);
    // a trim seam is pressed towards the trim and stitched on it; a body seam is pressed to its first side
    const ownA = ta !== tb ? ta : true;
    mark(bs.a, ownA); mark(bs.b, !ownA);
  }
  for (const cs of edits.customSeams) { mark([cs.a], true); mark([cs.b], false); }

  for (const p of pieces) {
    if (p.role === 'custom' || INSIDE_ROLES.has(p.role)) continue;
    const n = p.points.length;
    if (n < 3) continue;
    const side = signedArea(p.points) >= 0 ? 1 : -1; // inward is to the left of travel for a positive (y down) outline
    const m = sewn.get(p.id) ?? new Map<number, boolean>();
    const cls = (i: number) => (m.has(i) ? (m.get(i) ? 'own' : 'other') : 'free');
    // runs of segments of one kind, starting where the kind changes
    let start = 0;
    while (start < n && cls(start) === cls((start + n - 1) % n)) start++;
    if (start === n) start = 0;
    const runs: { kind: string; segs: number[] }[] = [];
    for (let s = 0; s < n; s++) {
      const i = (start + s) % n, k = cls(i);
      const last = runs[runs.length - 1];
      if (last && last.kind === k) last.segs.push(i); else runs.push({ kind: k, segs: [i] });
    }
    const trim = TRIMS.has(p.role);
    for (const run of runs) {
      if (run.kind === 'other') continue;
      const pts = run.segs.flatMap((i, j) => segPts(p, i).slice(j ? 1 : 0));
      let rows: number[] = [], kind: StitchKind = 'topstitch', label = '';
      if (run.kind === 'own') {
        if (!t) continue;
        rows = t.needles === 2 ? [t.offset, t.offset + 0.6] : [t.offset];
        label = t.needles === 2 ? 'Double needle topstitch' : 'Topstitch';
      } else if (p.role === 'brim') {
        const o = t?.offset ?? 0.5;
        rows = [o, o + 0.6, o + 1.2]; kind = 'brim'; label = 'Brim stitching';
      } else if (trim) {
        if (!t) continue;
        rows = [Math.min(0.4, t.offset)]; kind = 'edge'; label = 'Edge stitch';
      } else if (d.hem) {
        const dep = Math.max(0.5, d.hem.depth);
        rows = d.hem.needles === 2 ? [Math.max(0.3, dep - 0.3), dep + 0.3] : [dep]; kind = 'hem';
        label = `${d.hem.needles === 2 ? 'Double needle hem' : 'Hem'}, ${dep} cm`;
      } else continue;
      // a row runs on the piece only: where a narrowing piece (a visor point) is thinner than the row is deep, it stops
      const poly = samplePoly(p.points, 12);
      for (const o of rows) for (const part of clipTo(poly, offsetLine(pts, o, side))) out.push({ pieceId: p.id, kind, points: part, color, offset: o, label });
    }
  }

  // jeans: the front pocket openings (two rows on the leg side of the curve) and the fly J stitch
  const front = pieces.find((p) => p.role === 'front');
  if (st.family === 'pants' && front) {
    const po = frontPocketStyle(st.id) ? pocketOpening(front.points) : null;
    if (po) {
      const curve: Pt[] = Array.from({ length: 25 }, (_, i) => {
        const s = i / 24, a = (1 - s) ** 2, b = 2 * (1 - s) * s, c = s * s;
        return { x: a * po.A.x + b * po.C.x + c * po.B.x, y: a * po.A.y + b * po.C.y + c * po.B.y };
      });
      out.push({ pieceId: front.id, kind: 'opening', points: curve, color, offset: 0, label: 'Pocket opening' });
      // the rows sit on the leg side, away from the corner the pocket is cut from
      const corner = key(front, 'front.1')!;
      const mid = curve[12], probe = offsetLine(curve, 1, 1)[12];
      const s = Math.hypot(probe.x - corner.x, probe.y - corner.y) > Math.hypot(mid.x - corner.x, mid.y - corner.y) ? 1 : -1;
      for (const o of t?.needles === 2 ? [0.6, 1.2] : [0.6]) out.push({ pieceId: front.id, kind: 'pocket', points: offsetLine(curve, o, s), color, offset: o, label: 'Pocket opening topstitch' });
    }
    const z = flyStyle(st.id) ? flyZip(front) : null;
    if (z) {
      // J stitch: 3.2 cm in from the front edge, down past the zip, curving back to the front edge
      const inset = 3.2, end = Math.min(z.L, z.length + 2.5);
      const at = (s: number, o: number): Pt => ({ x: z.a.x + z.d.x * s + z.n.x * o, y: z.a.y + z.d.y * s + z.n.y * o });
      const pts: Pt[] = [];
      for (let i = 0; i <= 12; i++) pts.push(at(0.3 + ((end - 3.5) * i) / 12, inset));
      for (let i = 1; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); pts.push(at(end - 3.5 + 3.5 * Math.sin(a), inset * Math.cos(a))); }
      const inst = edits.attachments.find((a) => a.builtin && a.hardware?.type === 'zipper' && a.pieceId === front.id)?.instance ?? 0;
      for (const o of t?.needles === 2 ? [0, 0.6] : [0]) out.push({ pieceId: front.id, instance: inst, kind: 'fly', points: o ? offsetLine(pts, o, -1) : pts, color, offset: inset + o, label: 'Fly J stitch' });
    }
  }
  // buttonholes (the style's and the user's): each stitched outline, closed, on the copy it is cut in
  for (const a of edits.attachments) {
    if (!a.buttonhole || a.kind !== 'hardware' || !pieces.some((p) => p.id === a.pieceId)) continue;
    for (const slot of buttonholeSlots(a, true)) out.push({
      pieceId: a.pieceId, ...(a.instance !== undefined ? { instance: a.instance } : {}), kind: 'buttonhole', points: [...slot, slot[0]],
      color: a.thread ?? 'match', offset: 0, label: a.hardware?.holeStyle === 'keyhole' ? 'Keyhole buttonhole' : 'Buttonhole',
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* projects                                                                                                          */

interface ProjectLike { garment: StyleId; pieces: Piece[]; body: Body; fit?: Fit; edits?: Edits }

/** Edits of a new project: the style's details as attachments, marked as made. */
export function styleEdits(style: StyleId, pieces: Piece[], body?: Pick<Body, 'sex'>, edits: Edits = EMPTY_EDITS): Edits {
  return { ...edits, attachments: [...builtinDetails(style, pieces, body), ...edits.attachments], builtin: BUILTIN_VERSION };
}

/** A project from before style details were attachments gets them once; one that has them (or had them deleted) is left alone. */
export function withBuiltins<T extends ProjectLike>(p: T): T {
  if (p.edits?.builtin !== undefined) return p;
  return { ...p, edits: styleEdits(p.garment, p.pieces, p.body, p.edits ?? EMPTY_EDITS) };
}

/**
 * Old saves of a style that buttons down the front have one closed front. Redraft it as split fronts on the project's
 * body and fit, keeping the piece id, fabric and the ids of the points that still exist; edits on its right half (x < 0,
 * "m" points) move to the right front (copy 1, mirrored). Also adds the inside pieces a newer draft has (facings,
 * pocket bags, fly pieces). Projects already split come back unchanged.
 */
export function upgradeFront<T extends ProjectLike>(p: T): T {
  const style = migrateGarment(p.garment);
  const fresh = makePreset(style, p.body, p.fit ?? 'regular');
  let pieces = p.pieces, edits = p.edits;
  const fr = pieces.find((q) => q.role === 'front');
  const nf = fresh.find((q) => q.role === 'front');
  if (splitFrontStyle(style) && fr && nf && !isSplitFront(fr)) {
    const idOf = new Map(fr.points.filter((q) => q.key).map((q) => [q.key!, q.id]));
    const points = nf.points.map((q) => ({ ...q, id: idOf.get(q.key!) ?? q.id, mirror: null }));
    const remap = new Map<string, string>(); // old "m" point id -> the same point on the right front (copy 1)
    for (const q of fr.points) if (q.key?.endsWith('m')) { const id = idOf.get(q.key.slice(0, -1)); if (id) remap.set(q.id, id); }
    const keep = new Set(points.map((q) => q.id));
    pieces = pieces.map((q) => (q === fr ? { ...fr, name: nf.name, cut: nf.cut, specs: nf.specs, symmetric: false, points } : q));
    const ref = (r: EdgeRef): EdgeRef | null => {
      if (r.pieceId !== fr.id) return r;
      const a = remap.get(r.fromId), b = remap.get(r.toId);
      if (a || b) return a && b ? { ...r, fromId: a, toId: b, instance: 1 } : null;
      return keep.has(r.fromId) && keep.has(r.toId) ? r : null;
    };
    const e = edits ?? EMPTY_EDITS;
    edits = {
      ...e,
      attachments: e.attachments.map((a) => (a.pieceId !== fr.id || a.instance !== undefined ? a : a.x < 0 ? { ...a, x: -a.x, instance: 1 } : { ...a, instance: 0 })),
      customSeams: e.customSeams.flatMap((cs) => { const a = ref(cs.a), b = ref(cs.b); return a && b ? [{ ...cs, a, b }] : []; }),
      pleats: e.pleats.flatMap((pl) => {
        if (pl.pieceId !== fr.id) return [pl];
        const m = remap.get(pl.pointId);
        return m ? [{ ...pl, pointId: m, instance: 1 }] : keep.has(pl.pointId) ? [{ ...pl, instance: pl.instance ?? 0 }] : [];
      }),
    };
  }
  // inside pieces the old draft did not have
  const missing = fresh.filter((q) => INSIDE_ROLES.has(q.role) && !pieces.some((r) => r.role === q.role));
  if (missing.length) {
    const right = Math.max(...pieces.map((q) => q.offset.x + Math.max(...q.points.map((r) => r.x))));
    let x = right + 18;
    pieces = [...pieces, ...missing.map((q) => { const minX = Math.min(...q.points.map((r) => r.x)), w = Math.max(...q.points.map((r) => r.x)) - minX; const o = { x: x - minX, y: 10 - Math.min(...q.points.map((r) => r.y)) }; x += w + 18; return { ...q, offset: o }; })];
  }
  if (pieces === p.pieces && edits === p.edits) return p;
  return { ...p, pieces, ...(edits ? { edits } : {}) };
}

/**
 * Builtin attachments follow the pattern when it is regraded (new body or fit): each moves by the draft change of its
 * host piece around it, so a button stays on centre front and a belt loop on the band. The user's own attachments stay
 * where they were put.
 */
export function regradeBuiltins(edits: Edits | undefined, pieces: Piece[], from: ReturnType<typeof draft>, to: ReturnType<typeof draft>, sexChanged = false): Edits | undefined {
  if (!edits?.attachments.some((a) => a.builtin)) return edits;
  return {
    ...edits,
    attachments: edits.attachments.map((a) => {
      if (!a.builtin) return a;
      const host = pieces.find((p) => p.id === a.pieceId);
      const da = host && from.find((d) => d.role === host.role), db = host && to.find((d) => d.role === host.role);
      let b = a;
      // the side that laps over follows the body (right over left for men, left over right for women)
      const lapped = a.instance !== undefined && a.kind === 'hardware' && ((a.hardware?.type === 'button' && (host?.role === 'front' || host?.role === 'placket')) || a.hardware?.type === 'zipper');
      if (sexChanged && lapped) b = { ...b, instance: 1 - a.instance! };
      if (!da || !db) return b;
      const [q] = regradePoints([{ id: 'a', x: a.x, y: a.y, smooth: false, mirror: null }], da.points, db.points);
      return { ...b, x: a.x === 0 ? 0 : q.x, y: q.y }; // on the centre line (centre front buttons) stays on it
    }),
  };
}
