// Garment assembly, CLO style: mesh each pattern piece, arrange it around the avatar,
// sew it along the built-in sewing lines (src/sim/seams.ts) plus the user's edits (custom seams,
// pleats, attachments, user pieces from src/data/edits.ts), then let the solver drape it.

import type { GarmentType, Piece } from '../data/presets';
import { fabricById, fabricThickness } from '../data/fabrics';
import { attachmentStack, combine, plyOf, reliefOf, reliefPly, stackOf, COUPLING, STACK_CAPS, type Stack } from '../data/stack';
import { migrateGarment, styleById, type Style, type StyleId } from '../data/catalog';
import { COLLAR_TIP, frontOffset, isSplitFront, RIB } from '../data/draft';
import { bezAt, bbox, outlineLength, pointInPoly, samplePoly, sliceSpan, toBeziers, type PPoint, type Pt } from '../lib/geometry';
import { attachmentPolygons } from '../lib/shapes';
import { EMPTY_EDITS, type EdgeRef, type Edits, type Face, type Hardware, type Pleat } from '../data/edits';
import { labelMaterial, labelSewing, labelSize, type LabelMaterial } from '../data/labels';
import { builtinSeams, collarRoll, collarState, faceOf } from './seams';
import { pleatIntake } from '../lib/specs';
import { bodyFrame, ellipseCirc, ellipseFromCirc, hullAt, type Body, type BodyFrame } from '../three/body';
import { BodyCollider } from './collider';
import { ClothSim } from './cloth';
import { meshPanel, seamPath, type PanelMesh } from './panels';

export interface PanelInst {
  piece: Piece;
  mesh: PanelMesh;
  offset: number; // first particle index
  mirror: boolean;
  /** placed copy of a piece cut more than once (see instanceCount in seams.ts); 0 for the first */
  instance: number;
  /**
   * a cloth attachment (pocket, patch, strap) or a user piece patched on: the attachment id (or the
   * user piece id), how it is sewn on, and the index of the host panel it is pinned to.
   * mesh.uv of an attachment is in the attachment's own coords (cm, centred, before rotation).
   */
  attach?: { id: string; kind: ClothKind; host: number; face: Face };
}

/** attachments that are cloth of their own (embroidery, prints and hardware add no cloth) */
export type ClothKind = 'pocket' | 'patch' | 'applique' | 'strap' | 'label';
const CLOTH_KINDS = new Set<string>(['pocket', 'patch', 'applique', 'strap', 'label']);
/** gap kept between an attachment and the outer face of its host cloth (cm): about two fabric thicknesses */
export const LAYER_GAP = 0.2;

/** grams per trim (at the reference size, cm), for the weight hardware adds to the cloth under it */
const TRIM_GRAMS: Record<Exclude<Hardware['type'], 'zipper'>, [number, number]> = {
  rivet: [1.0, 0.9], eyelet: [0.4, 1.0], stud: [1.2, 1.2], button: [1.5, 1.8], snap: [1.6, 1.5],
};
/** a closed zip, tape included (grams per cm of length) */
const ZIP_GRAMS_PER_CM = 0.3;
/**
 * zip by teeth (ZipperDesign.teeth): grams per cm of length, and the compliance of the links that stiffen the cloth
 * along it (0 = rigid, in units of 1 / substep^2). Metal teeth are the heaviest and stiffest, a nylon coil the
 * lightest and bends most. A zip without a design keeps the plain values (0.3 g/cm, rigid).
 */
export const ZIP_TEETH: Record<'metal' | 'molded' | 'coil', { grams: number; compliance: number }> = {
  metal: { grams: 0.36, compliance: 0 },
  molded: { grams: 0.24, compliance: 2e-3 },
  coil: { grams: 0.14, compliance: 1.5e-2 },
};
/** plastic trims (finish black or white) weigh about half what metal ones do */
const PLASTIC = new Set(['black', 'white']);

/** Grams of one trim and the radius (cm) of cloth it is fixed through: by type, size, a drawn outline and the finish. */
export function trimWeight(h: Hardware): { grams: number; radius: number } {
  if (h.type === 'zipper') return { grams: 0, radius: 0 };
  const [g0, s0] = TRIM_GRAMS[h.type] ?? [1, 1];
  const mat = (h.type === 'button' || h.type === 'snap' || h.type === 'stud') && PLASTIC.has(h.finish) ? 0.5 : 1;
  if (h.outline && h.outline.length >= 3) {
    // a drawn button: mass by its area against the round one at the reference size, spread over its footprint
    let A = 0;
    for (let i = 0; i < h.outline.length; i++) { const p = h.outline[i], q = h.outline[(i + 1) % h.outline.length]; A += p.x * q.y - q.x * p.y; }
    A = Math.abs(A) / 2;
    const ref = Math.PI * (s0 / 2) ** 2;
    const reach = Math.max(...h.outline.map((q) => Math.hypot(q.x, q.y)));
    return { grams: g0 * mat * Math.min(4, Math.max(0.25, A / ref)) * (h.holes === 'shank' ? 1.15 : 1), radius: Math.max(0.1, reach) };
  }
  return { grams: g0 * mat * Math.min(4, Math.max(0.25, ((h.size || s0) / s0) ** 2)) * (h.holes === 'shank' ? 1.15 : 1), radius: (h.size || s0) / 2 };
}
/** a button on a collar point and one on another piece closer than this at the start are buttoned together (cm) */
const FASTEN_REACH = 6;
/** snap halves on two pieces closer than this at the start are snapped together (cm) */
const SNAP_REACH = 2;

/** Centres of the trims of a hardware attachment, in its own coords (cm): count in a row along w, spacing apart. */
export function hardwarePoints(h: Hardware): Pt[] {
  const n = Math.max(1, Math.round(h.count ?? 1)), sp = h.spacing ?? Math.max(1.5, h.size * 2);
  return Array.from({ length: n }, (_, k) => ({ x: (k - (n - 1) / 2) * sp, y: 0 }));
}

export interface Garment3D {
  sim: ClothSim;
  panels: PanelInst[];
  limits: Float32Array; // safe stretch per particle
  /** cloth thickness per panel (cm): the whole layer stack (src/data/stack.ts), for drawing cut edges and hems */
  panelThickness?: Float32Array;
  /** extra distance a particle keeps off the body for the stack's added thickness (cm); absent when nothing is lined */
  thick?: Float32Array;
  /** sew links (particle pairs) each seam added, by seam id: built-in ids, custom seam ids, 'pleat:<id>' */
  seamLinks: Record<string, [number, number][]>;
  /** body collider and per particle contact mode (0 normal, 1 none, 2 crease, 3 elastic), for the display check */
  body?: BodyLike;
  contact?: Uint8Array;
  /**
   * display check of cloth layers: per attachment particle, the host triangles near it (corner particle
   * triples) and the sign that turns each triangle's winding normal outward
   */
  layerNear?: { a: number; tris: Int32Array; sign: Int8Array; inside?: boolean }[];
  /**
   * +1 / -1 per panel: the side of the mesh triangle order (P.mesh.tris, not the mirrored render order) that is the
   * piece's 'outside' face (Face, src/data/edits.ts). Collar: the top collar (see faceOf / visibleFace in seams.ts).
   * Attachment panels: the side facing away from the host cloth, the attachment's own show face.
   */
  panelSign: Int8Array;
  /** collar worn down or up in this build */
  collar: 'down' | 'up';
  /** sim layer entries before this index are attachments on their host; from it on, the fall of a collar on its stand */
  foldLayers?: number;
  /** the style and edits this garment was built from (details read the style's stitching from them) */
  style: StyleId;
  edits: Edits;
  /**
   * buttons buttoned through a buttonhole in this build: which trim of which button attachment (and host copy) sits in
   * which buttonhole. The button shows on top of the buttonhole's piece, where it is seen on the worn garment.
   */
  buttoned: { button: string; buttonIndex: number; buttonInstance: number; hole: string; holeIndex: number; holeInstance: number }[];
}

/** The front that laps over: right over left as worn for men, left over right for women (copy 1 is the wearer's right). */
export const overCopy = (body: Pick<Body, 'sex'>) => (body.sex === 'female' ? 0 : 1);
/** how far the overlapping front (or placket strip) starts off the one under it (cm) */
const OVERLAP_LIFT = 0.45;
/** half width of the strip along centre front where the over front rests on the under one (cm, at least; a front takes
 *  its whole overlap, so no part of it is held off the other by self collision), and how much it gives */
const OVERLAP_STRIP = 1.2;
const OVERLAP_COMPLIANCE = 0.1;

type Hit = { nx: number; ny: number; nz: number; depth: number; vx?: number; vy?: number; vz?: number };
/** what setup needs of a body collider (BodyCollider, GridCollider, PosedCollider) */
export type BodyLike = {
  project(p: Float32Array, i: number, out: Hit): boolean; thickness: number; flat?: [number, number]; useCaps?: boolean; skinning?: boolean;
  /** soft skin: which cloth particle a query is for when it is not p[i] of the simulation (-1: i / 3) */
  particle?: number;
  escape?(p: Float32Array, i: number, bone: number, dx: number, dy: number, dz: number, margin: number): boolean;
};
/** displayed cloth keeps at least this far off the drawn skin (cm); the solver keeps BodyLike.thickness */
export const DISPLAY_MARGIN = 0.25;
/** edge midpoints and triangle centres of the displayed cloth keep this far off the skin (cm) */
const CHORD_MARGIN = 0.1;
/** while sewing, no cloth point rises more than this above where it started (cm) */
export const SEW_RISE = 3;
/** cloth points closer than this to the skin get their edges and triangles checked for display (cm) */
const NEAR = 1.0;

const TAU = Math.PI * 2;
/** mesh spacing of a collar (cm) */
const COLLAR_SPACING = 1.0;
const SUB = 10;
const H2 = (1 / 60 / SUB) ** 2;

type Placer = (u: number, v: number) => [number, number, number];

function widthSpan(poly: Pt[], y: number) {
  return sliceSpan(poly, y) ?? { x1: -1, x2: 1 };
}

function torsoPoint(f: BodyFrame, h: number, th: number, C: number): [number, number, number] {
  const above = h >= f.crotchH + 3.5;
  const r = above ? f.torsoRing(h) : (() => { const e = hullAt(f, h); return { a: e.a, b: e.b, shape: () => 1, C: ellipseCirc(e) }; })();
  const m = r.shape(th);
  const k = Math.max(C / r.C, 1) + 1.2 / Math.min(r.a, r.b);
  return [r.a * m * Math.cos(th) * k, h, r.b * m * Math.sin(th) * k];
}

/** Height of a collar's sewn (neckline) edge at pattern x: the edge from tip to tip through collar.0, as a lookup. */
function collarEdge(c: Piece): (u: number) => number {
  const bz = toBeziers(c.points);
  const i0 = c.points.findIndex((q) => q.key === 'collar.0');
  const t1 = c.points.findIndex((q) => q.key === 'collar.1'), t1m = c.points.findIndex((q) => q.key === 'collar.1m');
  if (i0 < 0 || t1 < 0 || t1m < 0) return () => 0;
  const pts: Pt[] = [];
  for (let i = i0; i !== t1; i = (i + 1) % bz.length) for (let k = 0; k <= 24; k++) pts.push(bezAt(bz[i], k / 24));
  for (let i = t1m; i !== i0; i = (i + 1) % bz.length) for (let k = 0; k <= 24; k++) pts.push(bezAt(bz[i], k / 24));
  pts.sort((p, q) => p.x - q.x);
  return (u) => {
    if (u <= pts[0].x) return pts[0].y;
    if (u >= pts[pts.length - 1].x) return pts[pts.length - 1].y;
    let lo = 0, hi = pts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].x <= u) lo = m; else hi = m; }
    const t = (u - pts[lo].x) / ((pts[hi].x - pts[lo].x) || 1);
    return pts[lo].y + (pts[hi].y - pts[lo].y) * t;
  };
}

/** below this mismatch (share of the neckline) a collar's sewn edge counts as walked to the neckline */
const COLLAR_MATCH = 0.01;

/**
 * How a collar wraps round the neckline, from its own sewn edge as drawn. L: the circumference (cm of pattern x) the
 * collar is wrapped over, the sewn edge from tip to tip plus the drafted tip run-out (COLLAR_TIP) at each end; g: the
 * neckline length over the collar's sewn edge length. A drafted collar is walked to the neckline (g = 1, the wrap
 * is the pattern width at the tips, as it always was). A sewn edge longer than the neckline (g < 1) is eased in, its
 * extra length spread evenly round the neck like the seam spreads it; a shorter one is stretched on.
 */
export function collarFit(style: StyleId, collar: Piece, knit: boolean, pieces: Piece[], edits?: Pick<Edits, 'collar'>) {
  const p1 = collar.points.find((q) => q.key === 'collar.1'), p1m = collar.points.find((q) => q.key === 'collar.1m');
  const X1 = p1 && p1m ? (Math.abs(p1.x) + Math.abs(p1m.x)) / 2 : Math.max(...collar.points.map((q) => q.x)) - (knit ? COLLAR_TIP.knit : COLLAR_TIP.woven);
  const Lc = p1 && p1m ? outlineLength(collar.points, p1.id, p1m.id) : 0;
  const seam = builtinSeams(style, pieces, edits).find((s) => s.id === 'collar');
  let N = 0;
  for (const r of seam?.b ?? []) { const P = pieces.find((q) => q.id === r.pieceId); if (P) N += outlineLength(P.points, r.fromId, r.toId); }
  let g = Lc > 0 && N > 0 ? N / Lc : 1;
  if (Math.abs(g - 1) < COLLAR_MATCH) g = 1;
  // past what a seam can sensibly ease in or stretch on, the start shape stops following (the seam spreads the rest)
  g = Math.max(0.6, Math.min(1.25, g));
  const L = 2 * (X1 * g + (knit ? COLLAR_TIP.knit : COLLAR_TIP.woven));
  return { L, g, Lc, N };
}

const key = (p: Piece, k: string) => p.points.find((q) => q.key === k)?.id;
const tag = (p: Piece, t: string) => p.points.find((q) => q.tag === t);

type V3 = [number, number, number];
const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a: V3) => Math.sqrt(dot3(a, a));
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Triangle of a panel mesh under a pattern point, with barycentric weights (nearest triangle when outside). */
export function locate(m: PanelMesh, p: Pt): { v: [number, number, number]; w: [number, number, number]; out: number } {
  let best = { v: [0, 0, 0] as [number, number, number], w: [1, 0, 0] as [number, number, number], out: 0 }, bestMin = -Infinity;
  for (let t = 0; t < m.tris.length; t += 3) {
    const a = m.uv[m.tris[t]], b = m.uv[m.tris[t + 1]], c = m.uv[m.tris[t + 2]];
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(det) < 1e-12) continue;
    const wa = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / det;
    const wb = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / det;
    const wc = 1 - wa - wb;
    const mn = Math.min(wa, wb, wc);
    if (mn > bestMin) {
      bestMin = mn;
      best = { v: [m.tris[t], m.tris[t + 1], m.tris[t + 2]], w: [wa, wb, wc], out: 0 };
      if (mn >= 0) break;
    }
  }
  if (bestMin < 0) {
    // outside the piece: clamp onto the nearest triangle (out: how far outside, in barycentric units)
    best.out = -bestMin;
    const w = best.w.map((x) => Math.max(0, x)) as [number, number, number];
    const s = w[0] + w[1] + w[2] || 1;
    best.w = [w[0] / s, w[1] / s, w[2] / s];
  }
  return best;
}

/**
 * Rest length of a mesh edge once the pleats on its piece are folded. Along the edge, a pleat folds its
 * intake into a Z (knife) or two Zs (box, inverted): the folded position is a triangle wave over the
 * intake, so an edge across the intake gets as short as the folded fabric. Further than the pleat length
 * into the piece the pleat is released and the fabric opens flat again over 3 cm.
 */
function foldLen(folds: { A: Pt; te: Pt; n: Pt; L: number; folds: number; length: number }[], p: Pt, q: Pt, flat: number) {
  let r = flat;
  for (const f of folds) {
    const s1 = (p.x - f.A.x) * f.te.x + (p.y - f.A.y) * f.te.y, s2 = (q.x - f.A.x) * f.te.x + (q.y - f.A.y) * f.te.y;
    if ((s1 < 0 && s2 < 0) || (s1 > f.L && s2 > f.L)) continue;
    const ac = (((p.x + q.x) / 2 - f.A.x) * f.n.x + ((p.y + q.y) / 2 - f.A.y) * f.n.y);
    const w = Math.max(0, Math.min(1, (f.length + 3 - ac) / 3)) * (ac > -1 ? 1 : 0);
    if (w <= 0) continue;
    const seg = f.L / f.folds, d = seg / 2;
    const x = (s: number) => {
      if (s <= 0) return s;
      if (s >= f.L) return s - f.L;
      const k = Math.min(f.folds - 1, Math.floor(s / seg)), u = s - k * seg;
      return (k % 2 ? -1 : 1) * (u <= d ? u : seg - u);
    };
    const dAlong = Math.abs(x(s1) - x(s2));
    const dAcross = Math.abs((p.x - q.x) * f.n.x + (p.y - q.y) * f.n.y);
    const folded = Math.max(Math.min(0.3, flat), Math.hypot(dAlong, dAcross)); // a fold has a radius: never quite zero
    r = Math.min(r, flat * (1 - w) + folded * w);
  }
  return r;
}

/**
 * Pleat on a panel mesh. A and B are the outline points brought together (knife: the fold at the pleat
 * position and the point 2 x depth further along in `direction`; box / inverted: 2 x depth either side,
 * the centre folds in between). The stitching runs from the edge into the piece for the pleat length.
 */
export function pleatGeometry(m: PanelMesh, points: PPoint[], pl: Pleat, spacing: number) {
  const si = m.pointIds.indexOf(pl.pointId);
  if (si < 0 || !(pl.depth > 0)) return null;
  const bz = toBeziers(points)[si];
  if (!bz) return null;
  const P0 = bezAt(bz, Math.max(0, Math.min(1, pl.t)));
  const B = m.boundary, N = B.length;
  let k0 = 0;
  B.forEach((v, k) => { if ((m.uv[v].x - P0.x) ** 2 + (m.uv[v].y - P0.y) ** 2 < (m.uv[B[k0]].x - P0.x) ** 2 + (m.uv[B[k0]].y - P0.y) ** 2) k0 = k; });
  const step = (k: number, dir: number) => (k + dir + N) % N;
  const walk = (k: number, dist: number, dir: number) => {
    let acc = 0;
    for (let n = 0; n < N - 1; n++) {
      const nk = step(k, dir), d = Math.hypot(m.uv[B[nk]].x - m.uv[B[k]].x, m.uv[B[nk]].y - m.uv[B[k]].y);
      if (acc + d >= dist) return acc + d - dist < dist - acc ? nk : k;
      acc += d; k = nk;
    }
    return k;
  };
  const dir = pl.direction < 0 ? -1 : 1;
  const intake = pleatIntake(pl);
  const kA = pl.type === 'knife' ? k0 : walk(k0, intake / 2, -dir);
  const kB = walk(kA, intake, dir);
  if (kA === kB) return null;
  // boundary edges from A to B: folded away, they add nothing to a seam along this edge
  const foldedEdges: string[] = [];
  for (let k = kA; k !== kB; k = step(k, dir)) { const a = B[k], b = B[step(k, dir)]; foldedEdges.push(a < b ? `${a},${b}` : `${b},${a}`); }
  const outline = B.map((v) => m.uv[v]);
  const tq = { x: m.uv[B[step(k0, 1)]].x - m.uv[B[step(k0, -1)]].x, y: m.uv[B[step(k0, 1)]].y - m.uv[B[step(k0, -1)]].y };
  const tl = Math.hypot(tq.x, tq.y) || 1;
  let n = { x: -tq.y / tl, y: tq.x / tl };
  const c0 = m.uv[B[k0]];
  if (!pointInPoly(outline, { x: c0.x + n.x * 0.5, y: c0.y + n.y * 0.5 })) n = { x: -n.x, y: -n.y };
  const A = m.uv[B[kA]], Bp = m.uv[B[kB]];
  const lines = pl.type === 'knife' ? [[A, Bp]] : [[A, Bp], [A, c0]];
  const nearest = (q: Pt) => {
    let bi = -1, bd = (0.75 * spacing) ** 2;
    m.uv.forEach((u, i) => { const d = (u.x - q.x) ** 2 + (u.y - q.y) ** 2; if (d < bd) { bd = d; bi = i; } });
    return bi;
  };
  const pairs: [number, number][] = []; // stitched shut at the edge
  const holds: [number, number][] = []; // stitched down inside the piece, held at their folded distance
  const seen = new Set<string>();
  const push = (list: [number, number][], a: number, b: number) => { const k = `${a},${b}`; if (a >= 0 && b >= 0 && a !== b && !seen.has(k)) { seen.add(k); list.push([a, b]); } };
  push(pairs, B[kA], B[kB]);
  if (pl.type !== 'knife') push(pairs, B[kA], B[k0]);
  for (let d = spacing; d <= pl.length + 1e-6; d += spacing) {
    for (const [p, q] of lines) push(holds, nearest({ x: p.x + n.x * d, y: p.y + n.y * d }), nearest({ x: q.x + n.x * d, y: q.y + n.y * d }));
  }
  return { A, B: Bp, C: c0, n, pairs, holds, foldedEdges };
}

/** Warm start: copy 3D positions from a previous drape onto the new mesh (nearest pattern point per panel). */
export function warmStart(next: Garment3D, prev: Garment3D) {
  if (next.panels.length !== prev.panels.length) return false;
  for (let k = 0; k < next.panels.length; k++) {
    const a = next.panels[k], b = prev.panels[k];
    if (a.piece.role !== b.piece.role || a.mirror !== b.mirror) return false;
  }
  next.panels.forEach((a, k) => {
    const b = prev.panels[k];
    const buv = b.mesh.uv;
    a.mesh.uv.forEach((p, i) => {
      let best = 0, bd = Infinity;
      for (let j = 0; j < buv.length; j++) {
        const d = (buv[j].x - p.x) ** 2 + (buv[j].y - p.y) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      const s = (b.offset + best) * 3, t = (a.offset + i) * 3;
      next.sim.pos[t] = prev.sim.pos[s]; next.sim.pos[t + 1] = prev.sim.pos[s + 1]; next.sim.pos[t + 2] = prev.sim.pos[s + 2];
    });
  });
  next.sim.prev.set(next.sim.pos);
  if (prev.sim.frames < prev.sim.sewFrames) {
    // the last build was still being sewn (an edit right after opening): carry on sewing where it was; cutting the
    // sewing short gives open seams gravity
    next.sim.frames = Math.min(prev.sim.frames, next.sim.sewFrames);
    return true;
  }
  next.sim.sewFrames = 4; // already sewn, just settle
  next.sim.frames = 0;
  return true;
}

/** How a piece behaves in the solver: fabric properties, adjusted for its role (rib trims, elastic, stiff brims). */
interface Mech {
  stretch: number; // safe stretch, also the strain limit
  sc: number; // stretch compliance
  bc: number; // bend compliance
  /** rest lengths come from the placed 3D shape instead of the flat pattern (pre-shaped, stiff parts) */
  shaped: boolean;
  /** extra long-range links for a plate that must hold its shape (cap visor) */
  plate: boolean;
  /** bending rest shape comes from the placed 3D shape (a pressed fold line), stretch still from the flat pattern */
  foldBend: boolean;
  /** horizontal rest-length scale (elastic gathering) */
  gather: number;
}

function mechanics(p: Piece, style: Style, opts: { collarUp?: boolean; legacyCollar?: boolean; label?: LabelMaterial; layers?: number; stack?: Stack } = {}): Mech {
  const fab = fabricById(p.fabric.id);
  const S = opts.stack && opts.stack.plies.length > 1 ? opts.stack : undefined;
  let stretch = fab.stretch, bend = fab.bend, scK = 1, shaped = false, plate = false, gather = 1, foldBend = false;
  if (opts.label) {
    // a tag: its own material; a folded loop is two layers
    const L = opts.label, k = opts.layers ?? 1;
    // a lined or backed tag: the lining plies laminated onto the tag material
    const Lb = S ? Math.min(STACK_CAPS.bend, Math.sqrt((L.bend * k) ** 2 + (S.bend ** 2 - (S.plies[0].bend) ** 2))) : L.bend * k;
    const Ls = S ? Math.min(L.stretch, S.stretch) : L.stretch;
    return { stretch: Ls, sc: Ls * 0.3 * H2, bc: (0.05 / (Lb * Lb)) * H2, shaped: false, plate: false, gather: 1, foldBend: false };
  }
  const knit = !!style.details.rib;
  const ribTrim = fab.id === 'rib' || (knit && (p.role === 'neckband' || p.role === 'cuff' || (p.role === 'collar' && style.family === 'polo')));
  if (ribTrim) {
    // rib is cut short and stretched on: it may stretch a lot, and springs back about as hard as the body fabric
    stretch = Math.max(stretch, 0.5);
    scK = 0.5;
  }
  if (p.role === 'waistband' && p.elastic) {
    // elastic inside the band: the band relaxes to the elastic length and grips the waist
    const W = Math.max(...p.points.map((q) => q.x)) * 2;
    gather = Math.min(1, p.elastic / W);
    stretch = 0.09; // stretches over the waist (elastic is cut about 5% short), but not over the hips: that holds the pants up
    scK = 0.1; // elastic is much stronger than the fabric it gathers
  }
  if (p.role === 'brim') {
    if (style.family === 'cap') {
      // visor with a pre-curved plastic insert: holds its shape
      stretch = 0.01; scK = 0; bend = 50; shaped = true; plate = true;
    } else {
      // bucket brim: rows of stitching make it stiffer than the crown
      bend = Math.max(bend, 1) * 3; scK = 0.5;
    }
  }
  if (p.role === 'crown' && style.family === 'cap') bend = Math.max(bend, 1) * 2; // structured crown (buckram front)
  if (p.role === 'collar' && style.family === 'shirt') bend *= 2; // interfaced collar
  if (p.role === 'collar' && style.family === 'polo') { foldBend = true; bend = Math.max(bend, 0.4); } // knit collar with a pressed fold
  // a woven collar keeps the shape it is pressed into: folded over at the roll line when worn down
  if (p.role === 'collar' && (style.family === 'shirt' || style.family === 'jacket') && !opts.legacyCollar) foldBend = true;
  // popped up: the stand and fall are pressed flat in line, so the collar holds itself up round the neck
  if (p.role === 'collar' && opts.collarUp) { foldBend = true; bend *= style.family === 'polo' ? 4 : 2; }
  if (S) {
    // a layer stack (a lining, a lined pocket, padding): the role's own stiffening scales with the laminate, and
    // nothing stretches further than its least stretchy ply (a rib trim is cut short and stretched on: it keeps its give)
    bend = Math.min(STACK_CAPS.bend * Math.max(1, bend / fab.bend), bend * (S.bend / Math.max(0.02, fab.bend)));
    if (!ribTrim) stretch = Math.min(stretch, S.stretch);
  }
  return { stretch, sc: stretch * 0.3 * scK * H2, bc: (0.05 / (bend * bend)) * H2, shaped, plate, gather, foldBend };
}

export function assemble(type: GarmentType, pieces: Piece[], body: Body, spacing = 2.2, collider?: ClothSim['collider'], edits: Edits = EMPTY_EDITS): Garment3D | null {
  const style = styleById(migrateGarment(type));
  const fam = style.family;
  const f = bodyFrame(body);
  const hat = fam === 'bucket' || fam === 'cap';
  const front = pieces.find((p) => p.role === 'front');
  const back = pieces.find((p) => p.role === 'back');
  const sleeve = pieces.find((p) => p.role === 'sleeve');
  const crown = pieces.find((p) => p.role === 'crown');
  if (hat ? !crown : !front || !back) return null;

  const collarIs = collarState(edits);
  /** a front that buttons, worn open: nothing buttons, the fronts hang free */
  const openFront = edits.closure === 'open';
  // no collar option chosen (a project from before it): the collar is arranged exactly as it always was, so old saves
  // drape bit for bit the same (tests/fixtures/sew-baseline.json). That start stands the collar up (woven) or folds it
  // on a mesh too coarse to hold the fold; choosing 'down' or 'up' gives the arranged collar
  const legacyCollar = edits.collar === undefined;
  /** mech: a tag's own material (weight, stiffness), two layers for a folded loop */
  const insts: (PanelInst & { place: Placer; shape?: Placer; mech?: { label: LabelMaterial; layers: number }; stack?: Stack })[] = [];
  let count = 0;
  /** place: where each pattern point starts; shape: the rest shape of a pre-shaped part (defaults to place) */
  const add = (piece: Piece, mirror: boolean, place: Placer, mesh?: PanelMesh, shape?: Placer) => {
    const m = mesh ?? meshPanel(piece.points, spacing);
    const instance = insts.filter((q) => q.piece === piece).length;
    insts.push({ piece, mesh: m, offset: count, mirror, place, shape, instance });
    count += m.uv.length;
    return insts[insts.length - 1];
  };
  type Side = [PanelInst, string | undefined, string | undefined][];
  // seam lines allowed to pass inside the body: the upper inseam lies between thighs that touch on most bodies
  const between: Side[] = [];
  const freePanels = new Set<PanelInst>(); // pieces that do not collide with the body (a visor is held by its band)

  if (fam === 'pants') assemblePants();
  else if (hat) assembleHat();
  else assembleTop();

  function assembleTop() {
    const fr = front!, bk = back!;
    const fp = samplePoly(fr.points), bp = samplePoly(bk.points);
    const fo = frontOffset(style.id);
    const fH = tag(fr, 'hps')?.y ?? 0, bH = tag(bk, 'hps')?.y ?? 0;
    const hps = f.neckH;
    // a split front is one front cut twice: its width round the body is twice centre front to side
    const split = isSplitFront(fr);
    const frontW = (a: { x1: number; x2: number }) => (split ? 2 * Math.max(0, a.x2) : a.x2 - a.x1);
    const rowC = (vr: number) => {
      const a = widthSpan(fp, fH + vr), b = widthSpan(bp, bH + vr);
      return frontW(a) + (b.x2 - b.x1);
    };
    const placeTorso = (poly: Pt[], top: number, isBack: boolean): Placer => (u, v) => {
      const span = widthSpan(poly, v);
      const half = Math.max(0.5, (span.x2 - span.x1) / 2);
      const frac = Math.max(-1, Math.min(1, (u - (span.x1 + span.x2) / 2) / half));
      const th = isBack ? (3 * Math.PI) / 2 - frac * (Math.PI / 2) : Math.PI / 2 - frac * (Math.PI / 2);
      const vr = v - top;
      return torsoPoint(f, hps - vr, th, rowC(vr));
    };
    const frontPlace = placeTorso(fp, fH, false);
    if (split) {
      // split fronts: centre front at the middle of the body, the extension carries on round past it, over the other
      // front. Buttoned, the front that laps over starts a little off the one under it across the overlap; worn open,
      // each front stops at centre front so the two start apart.
      const ext = Math.max(0, -Math.min(...fr.points.map((q) => q.x)));
      const fm = meshPanel(fr.points, spacing);
      for (const side of [1, -1]) {
        const over = !openFront && (side > 0 ? 0 : 1) === overCopy(body);
        add(fr, side < 0, (u, v) => {
          const span = widthSpan(fp, v), half = Math.max(0.5, span.x2);
          const frac = openFront ? 0.015 + 0.985 * (u + ext) / (half + ext) : u / half;
          const th = Math.PI / 2 - Math.max(-0.5, Math.min(1, frac)) * (Math.PI / 2);
          const p = torsoPoint(f, hps - (v - fH), th, rowC(v - fH));
          if (over) {
            const w = Math.max(0, Math.min(1, (ext + 5 - u) / 3)), r = Math.hypot(p[0], p[2]) || 1, k = 1 + (OVERLAP_LIFT * w) / r;
            p[0] *= k; p[2] *= k;
          }
          return side > 0 ? p : [-p[0], p[1], p[2]];
        }, fm);
      }
    } else add(fr, false, frontPlace);
    add(bk, false, placeTorso(bp, bH, true));
    const sleeveInst: Record<number, PanelInst> = {};
    if (sleeve) {
      const sp = samplePoly(sleeve.points);
      const sTop = Math.min(...sleeve.points.map((p) => p.y));
      const capH = (tag(sleeve, 'underarm')?.y ?? 15) - sTop;
      const bicepW = (() => { const s = widthSpan(sp, sTop + capH); return s.x2 - s.x1; })();
      // a dropped shoulder puts the sleeve seam that far down the arm
      const drop = Math.max(0, (tag(fr, 'shoulder')?.x ?? 0) - body.shoulder / 2 - 1);
      const mesh = meshPanel(sleeve.points, spacing);
      for (const side of [1, -1]) {
        const ca = Math.cos(side * f.armAngle), sa = Math.sin(side * f.armAngle);
        const place: Placer = (u, v) => {
          const vr = v - sTop;
          const s = f.acromionS + drop + vr;
          const span = widthSpan(sp, v);
          const R = vr < capH ? bicepW / TAU : Math.max(0.5, span.x2 - span.x1) / TAU;
          const phi = Math.max(-Math.PI, Math.min(Math.PI, (u - (span.x1 + span.x2) / 2) / R));
          const ar = f.armRing(Math.max(s, -f.armDome * 0.9), side);
          const r = Math.max(R, Math.max(ar.a, ar.b) + 1.2);
          const lx = side * r * Math.cos(phi), lz = r * Math.sin(phi), ly = -s;
          return [f.shoulderJoint.x * side + lx * ca - ly * sa, f.shoulderJoint.y + lx * sa + ly * ca, lz];
        };
        sleeveInst[side] = add(sleeve, side < 0, place, mesh);
      }
    }

    // ---- neckline trims: neckband, collar, placket ----
    const fND = tag(fr, 'hps') ? (fr.points.find((q) => q.key === `front.${fo}`)?.y ?? 8) - fH : 8;
    const nr = f.neckRing(f.neckH + 1);
    const neckDepth = (th: number) => fND * Math.max(0, Math.sin(th)) ** 1.5 + 2 * Math.max(0, -Math.sin(th));
    const placket = pieces.find((p) => p.role === 'placket');
    if (placket) {
      // two strips over the opening, copy 1 mirrored; the one that laps over starts on top of the other
      const top = fr.points.find((q) => q.key === 'front.2')?.y ?? 0;
      const pm = meshPanel(placket.points, spacing);
      for (const k of [0, 1]) {
        const lift = 0.35 + (k === overCopy(body) ? OVERLAP_LIFT : 0);
        add(placket, k === 1, (u, v) => {
          const p = frontPlace(k ? -u : u, top + v);
          return [p[0], p[1], p[2] + lift];
        }, pm);
      }
    }
    const band = pieces.find((p) => p.role === 'neckband');
    if (band) {
      const L = Math.max(...band.points.map((p) => p.x)) * 2;
      const neckLen = L / RIB.neckband;
      add(band, false, (u, v) => {
        const th = Math.PI / 2 - (u / L) * TAU; // centre front at u = 0, the join at centre back
        const r = Math.max(neckLen / TAU, Math.max(nr.a, nr.b) + 1.2);
        return [r * Math.cos(th), f.neckH - neckDepth(th) + v, (nr.cz ?? 0) + r * 0.95 * Math.sin(th)];
      });
    }
    const collar = pieces.find((p) => p.role === 'collar');
    if (collar) {
      const knit = fam === 'polo';
      const roll = collarRoll(style.id, collar);
      const edgeY = collarEdge(collar);
      if (legacyCollar) {
        // projects from before the collar option: exactly the old start (tests/fixtures/sew-baseline.json)
        const L = Math.max(...collar.points.map((p) => p.x)) * 2;
        add(collar, false, (u, v) => {
          const th = Math.PI / 2 - ((L / 2 - u) / L) * TAU;
          const r0 = Math.max(L / TAU, Math.max(nr.a, nr.b) + 1.2);
          if (!knit) return [(r0 + 0.15 * v) * Math.cos(th), f.neckH - neckDepth(th) + v * 0.9, (nr.cz ?? 0) + (r0 + 0.15 * v) * Math.sin(th)];
          const stand = Math.min(v, 2.5), fall = Math.max(0, v - 2.5);
          const fold = Math.min(1, fall / 0.8);
          const r = r0 + 0.1 * stand + 0.6 * fold + 0.15 * fall;
          return [r * Math.cos(th), f.neckH - neckDepth(th) + stand + 0.3 * fold - 0.95 * fall, (nr.cz ?? 0) + r * Math.sin(th)];
        });
      } else {
        // the wrap round the neck comes from the collar's own sewn edge as drawn (collarFit), so a collar edited longer,
        // taller or with a neck edge that no longer matches the neckline starts in a shape its seam can close without
        // pulling: a neck edge longer than the neckline starts eased in (spread evenly), as the sewing will hold it
        const fit = collarFit(style.id, collar, knit, pieces, edits);
        const { L, g } = fit;
        // a fine mesh: the stand is only 2 to 3 cm tall, and a fold needs a few rows of triangles to turn over
        const cm = meshPanel(collar.points, Math.min(spacing, COLLAR_SPACING));
        add(collar, false, (u, v) => {
          const th = Math.PI / 2 - ((L / 2 - u * g) / L) * TAU; // tips at centre front, centre of the collar at centre back
          const r0 = Math.max(L / TAU, Math.max(nr.a, nr.b) + 1.2);
          const base = f.neckH - neckDepth(th), cz = nr.cz ?? 0;
          // height over the sewn edge: the stand rises from it to the roll line, the fall is beyond
          const s = Math.max(0, v - edgeY(u));
          if (collarIs === 'up') {
            // popped: stand and fall in line, standing up round the neck, flaring out a little and lightly rolled
            // outward along the top edge
            const r = r0 + 0.12 * s + 0.25 * Math.max(0, s - roll - 1);
            return [r * Math.cos(th), base + 0.95 * s, cz + r * Math.sin(th)];
          }
          // worn down: the stand rises to the roll line, the fall folds over (round over the fold line) and lies down
          // over the stand and the neckline
          const stand = Math.min(s, roll), fall = Math.max(0, s - roll);
          const fold = Math.min(1, fall / 0.8);
          const r = r0 + 0.1 * stand + 0.6 * fold + 0.15 * fall;
          return [r * Math.cos(th), base + stand + 0.3 * fold - 0.95 * fall, cz + r * Math.sin(th)];
        }, cm);
      }
    }
    const cuff = pieces.find((p) => p.role === 'cuff');
    if (fam === 'shirt' && cuff && sleeve) {
      const cw = Math.max(...cuff.points.map((p) => p.x)) * 2;
      const sTop = Math.min(...sleeve.points.map((p) => p.y));
      const sEnd = (tag(sleeve, 'cuff')?.y ?? 60) - sTop;
      for (const side of [1, -1]) {
        if (!sleeveInst[side]) continue;
        const ca = Math.cos(side * f.armAngle), sa = Math.sin(side * f.armAngle);
        const place: Placer = (u, v) => {
          const s = f.acromionS + sEnd + v;
          const R = cw / TAU;
          const ar = f.armRing(s, side);
          const r = Math.max(R, Math.max(ar.a, ar.b) + 0.8);
          const phi = Math.max(-Math.PI, Math.min(Math.PI, u / R));
          const lx = side * r * Math.cos(phi), lz = r * Math.sin(phi), ly = -s;
          return [f.shoulderJoint.x * side + lx * ca - ly * sa, f.shoulderJoint.y + lx * sa + ly * ca, lz];
        };
        add(cuff, side < 0, place);
      }
    }
  }

  function assemblePants() {
    const fr = front!, bk = back!;
    const fp = samplePoly(fr.points), bp = samplePoly(bk.points);
    const fCr = tag(fr, 'crotch')?.y ?? 26, bCr = tag(bk, 'crotch')?.y ?? 27;
    const legC = (d: number) => {
      const a = widthSpan(fp, fCr + Math.max(d, 1)), b = widthSpan(bp, bCr + Math.max(d, 1));
      return (a.x2 - a.x1) + (b.x2 - b.x1);
    };
    const seatC = (d: number) => {
      const a = widthSpan(fp, fCr + d), b = widthSpan(bp, bCr + d);
      return 2 * ((a.x2 - a.x1) + (b.x2 - b.x1));
    };
    const placeLeg = (poly: Pt[], cr: number, isBack: boolean, side: number): Placer => (u, v) => {
      const d = v - cr;
      const span = widthSpan(poly, v);
      let p: [number, number, number];
      if (d < 0) {
        const frac = Math.max(0, Math.min(1, (span.x2 - u) / Math.max(0.5, span.x2 - span.x1)));
        const th = isBack ? TAU - frac * (Math.PI / 2) : frac * (Math.PI / 2);
        p = torsoPoint(f, f.crotchH - d, th, Math.min(seatC(d), 2 * f.torsoRing(f.hipH).C));
      } else {
        const half = Math.max(0.5, (span.x2 - span.x1) / 2);
        const frac = Math.max(-1, Math.min(1, (u - (span.x1 + span.x2) / 2) / half));
        const th = isBack ? (3 * Math.PI) / 2 + frac * (Math.PI / 2) : Math.PI / 2 - frac * (Math.PI / 2);
        // the fork of the inseam starts a little below the crotch, in the crease between the thighs, where front and back can meet
        const inner = Math.max(0, -Math.cos(th)) ** 2 * Math.max(0, 1 - d / 6);
        const h = Math.max(0.5, f.crotchH - d - 5 * inner);
        const lr = f.legRing(Math.min(h, f.hipJointH + 3), 1);
        const k = Math.max(legC(d) / lr.C, 1) + 1.2 / lr.a;
        const m = lr.shape(th);
        // a wide leg starts flattened against the centre line rather than inside the other leg
        p = [Math.max(0.4, f.legX + lr.a * m * Math.cos(th) * k), h, lr.b * m * Math.sin(th) * k];
      }
      return side > 0 ? p : [-p[0], p[1], p[2]];
    };
    const fm = meshPanel(fr.points, spacing), bm = meshPanel(bk.points, spacing);
    const FR = add(fr, false, placeLeg(fp, fCr, false, 1), fm);
    const FL = add(fr, true, placeLeg(fp, fCr, false, -1), fm);
    const BR = add(bk, false, placeLeg(bp, bCr, true, 1), bm);
    const BL = add(bk, true, placeLeg(bp, bCr, true, -1), bm);
    for (const [Fp, Bp] of [[FR, BR], [FL, BL]]) {
      between.push([[Fp, key(fr, 'front.6'), key(fr, 'front.8')]], [[Bp, key(bk, 'back.6'), key(bk, 'back.8')]]);
    }

    const band = pieces.find((p) => p.role === 'waistband');
    if (band) {
      const W = Math.max(...band.points.map((p) => p.x)) * 2;
      const bandH = Math.max(...band.points.map((p) => p.y));
      // the band sits on top of the leg pieces: its top is the rise above the crotch plus the band height
      const legTop = f.crotchH + (fCr - (tag(fr, 'waistC')?.y ?? 0));
      const top = legTop + bandH;
      add(band, false, (u, v) => {
        const th = Math.PI / 2 - ((u + W / 2) / W) * TAU; // starts at centre front, runs round the right side
        return torsoPoint(f, top - v * (1 - 0.02), th, W);
      });
    }
    const cuff = pieces.find((p) => p.role === 'cuff');
    if (cuff) {
      const c = Math.max(...cuff.points.map((p) => p.x)) * 2;
      const hemH = f.crotchH - ((tag(fr, 'hem')?.y ?? 90) - fCr);
      const cm = meshPanel(cuff.points, spacing);
      for (const side of [1, -1]) {
        add(cuff, side < 0, (u, v) => {
          const th = ((c / 2 - u) / c) * TAU; // the join sits on the outseam
          const h = Math.max(0.5, hemH - v);
          const lr = f.legRing(h, 1);
          const r = Math.max(c / TAU, Math.max(lr.a, lr.b) + 0.8);
          return [side * (f.legX + r * Math.cos(th)), h, r * Math.sin(th)];
        }, cm);
      }
    }
  }

  function assembleHat() {
    const cr = crown!;
    const gp = samplePoly(cr.points);
    const Hg = Math.max(...cr.points.map((p) => p.y));
    const W = 6 * 2 * (tag(cr, 'band')?.x ?? 9.5);
    const e = ellipseFromCirc(W, f.headK);
    const brim = pieces.find((p) => p.role === 'brim');
    // a cap band sits on exactly the visor's inner curve (the rigid visor and the band must agree); a bucket band a touch off the head
    const visorEnd = fam === 'cap' && brim ? Math.max(...brim.points.filter((q) => q.tag === 'visorEnd').map((q) => q.x)) : 0;
    const A = visorEnd || e.a + 0.25, B = visorEnd ? brim!.points[0].y : e.b + 0.25, yb = f.headBandH, cz = f.headCz;
    // starting dome built from the panel itself (radius from the panel width, height from the seam length),
    // so the crown starts at its own sewn shape and settles onto the head without being squeezed
    const R0 = W / TAU, N = 64;
    const prof: { r: number; y: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const v = (i / N) * Hg, sp = widthSpan(gp, Math.min(v, Hg - 1e-3));
      prof.push({ r: i === 0 ? 0 : (6 * (sp.x2 - sp.x1)) / TAU, y: 0 });
    }
    prof[N].r = R0;
    for (let i = N - 1; i >= 0; i--) {
      const dv = Hg / N, dr = prof[i].r - prof[i + 1].r;
      prof[i].y = prof[i + 1].y + Math.sqrt(Math.max(0.05 * dv * dv, dv * dv - dr * dr));
    }
    // start clear of the head everywhere (contact during the gravity-free sewing phase would launch the hat)
    const lift = Math.max(1, f.H + 1 - (yb + prof[0].y));
    const sx = (A + 0.6) / R0, sz = (B + 0.6) / R0;
    const gm = meshPanel(cr.points, spacing);
    for (let k = 0; k < 6; k++) {
      // panel centres every 60 degrees with a seam at centre front; pattern +x runs towards the wearer's left (+x)
      const thk = Math.PI / 2 - Math.PI / 6 - (k * Math.PI) / 3;
      add(cr, false, (u, v) => {
        const span = widthSpan(gp, v);
        const hw = Math.max(0.3, (span.x2 - span.x1) / 2);
        const th = thk - Math.max(-1, Math.min(1, u / hw)) * (Math.PI / 6);
        const fi = Math.max(0, Math.min(N, (v / Hg) * N)), i0 = Math.min(N - 1, Math.floor(fi)), t = fi - i0;
        const r = prof[i0].r + (prof[i0 + 1].r - prof[i0].r) * t, y = prof[i0].y + (prof[i0 + 1].y - prof[i0].y) * t;
        return [r * sx * Math.cos(th), yb + lift + y, cz + r * sz * Math.sin(th)];
      }, gm);
    }
    if (!brim) return;
    if (fam === 'bucket') {
      const end = brim.points.find((q) => q.key === 'brim.6')!;
      const r1 = Math.hypot(brim.points[0].x, brim.points[0].y);
      const half = Math.atan2(end.x, end.y); // half the sector angle
      const cosA = Math.min(1, half / Math.PI); // sector angle / 2 pi = cos(slope)
      const sinA = Math.sqrt(1 - cosA * cosA);
      add(brim, false, (u, v) => {
        const r = Math.hypot(u, v), ps = Math.atan2(u, v);
        const th = Math.PI / 2 - ps * (Math.PI / half);
        const s = Math.max(0, r - r1);
        return [(A + 0.6 + s * cosA) * Math.cos(th), yb + lift - s * sinA, cz + (B + 0.6 + s * cosA) * Math.sin(th)];
      });
    } else {
      const visor = (grow: number, up: number): Placer => (u, v) => {
        const xi = Math.max(-1, Math.min(1, u / A));
        const d = Math.max(0, v - B * Math.sqrt(1 - xi * xi)); // distance out from the band
        return [u * (A + grow) / A, yb + up - d * (0.16 + 0.35 * xi * xi), cz + v * (B + grow) / B];
      };
      // rest shape on the exact band curve; it starts a little out and up, with the crown
      const BR = add(brim, false, visor(0.6, lift), undefined, visor(0, 0));
      freePanels.add(BR);
    }
  }

  // ---- garment edits: user pieces, attachments, pleats (src/data/edits.ts) ----
  const instOf = (pieceId: string, instance = 0) => insts.find((q) => q.piece.id === pieceId && q.instance === instance && !q.attach);
  const copiesOf = (pieceId: string) => insts.filter((q) => q.piece.id === pieceId && !q.attach);
  const centroids = new Map<PanelInst, V3>();
  /** centre of a placed panel: the outward side of the cloth faces away from it (a tube's axis, a half shell's middle) */
  const centreOf = (P: PanelInst & { place: Placer }) => {
    let c = centroids.get(P);
    if (!c) {
      c = [0, 0, 0];
      for (const q of P.mesh.uv) { const r = P.place(q.x, q.y); c[0] += r[0]; c[1] += r[1]; c[2] += r[2]; }
      const n = P.mesh.uv.length || 1;
      c = [c[0] / n, c[1] / n, c[2] / n];
      centroids.set(P, c);
    }
    return c;
  };
  /**
   * +1 / -1: which side of the panel's triangle winding (mesh order) is its 'outside' face, from the start shape.
   * Most pieces: the side facing away from the panel's middle (a tube's axis, a half shell's middle), a brim: up.
   * A collar: the top collar, which faces the neck on the stand (it rolls over to be the top of the fall).
   */
  const signs = new Map<PanelInst, number>();
  const signOf = (P: PanelInst & { place: Placer }) => {
    let sg = signs.get(P);
    if (sg !== undefined) return sg;
    const { uv, tris } = P.mesh;
    const X = uv.map((q) => P.place(q.x, q.y));
    const collarP = P.piece.role === 'collar' && !P.attach;
    const roll = collarP ? collarRoll(style.id, P.piece) : 0;
    const c = centreOf(P), cz = f.neckRing(f.neckH + 1).cz ?? 0;
    let vote = 0, any = false;
    for (const pass of collarP ? [0, 1] : [1]) {
      for (let t = 0; t < tris.length; t += 3) {
        const a = X[tris[t]], b = X[tris[t + 1]], d = X[tris[t + 2]];
        if (pass === 0 && Math.max(uv[tris[t]].y, uv[tris[t + 1]].y, uv[tris[t + 2]].y) > roll) continue; // the stand only
        const n = cross(sub3(b, a), sub3(d, a)), L = len3(n) || 1;
        const m: V3 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3, (a[2] + b[2] + d[2]) / 3];
        if (collarP) { const r: V3 = [m[0], 0, m[2] - cz]; vote -= dot3(n, r) / (L * (len3(r) || 1)); } // neck side
        else if (P.piece.role === 'brim') vote += n[1] / L;
        else { const r = sub3(m, c); vote += dot3(n, r) / (L * (len3(r) || 1)); }
        any = true;
      }
      if (any) break;
    }
    sg = vote >= 0 ? 1 : -1;
    signs.set(P, sg);
    return sg;
  };
  /**
   * start position on a host panel at pattern point hp, lifted off the given face (outside: away from the body,
   * inside: towards it), and the normal pointing off that face
   */
  const onHost = (H: PanelInst & { place: Placer }, hp: Pt, lift: number, face: Face = 'outside'): { p: V3; n: V3 } => {
    const L = locate(H.mesh, hp);
    const P = L.v.map((i) => H.place(H.mesh.uv[i].x, H.mesh.uv[i].y));
    const p: V3 = [0, 1, 2].map((k) => P[0][k] * L.w[0] + P[1][k] * L.w[1] + P[2][k] * L.w[2]) as V3;
    let n = cross(sub3(P[1], P[0]), sub3(P[2], P[0]));
    const out = sub3(p, centreOf(H));
    if (H.piece.role === 'collar' && len3(n) >= 1e-6) {
      // a collar folds over itself: the side comes from the winding, not from the middle of the panel
      n = scale3(n, signOf(H) / len3(n));
    } else {
      if (len3(n) < 1e-6) n = out;
      n = scale3(n, 1 / (len3(n) || 1));
      if (dot3(n, out) < 0) n = scale3(n, -1);
    }
    if (face === 'inside') n = scale3(n, -1);
    return { p: [p[0] + n[0] * lift, p[1] + n[1] * lift, p[2] + n[2] * lift], n };
  };

  // user pieces sewn into an open area: start flat next to the edge they are sewn to, then the seam pulls them in.
  // A user piece cut twice is placed twice, copy i sewn to host copy i (the second one mirrored, like a left sleeve).
  for (const up of pieces.filter((q) => q.role === 'custom' && q.placement?.mode === 'sewn')) {
    let hostRef: EdgeRef | null = null, mine: EdgeRef | null = null, flip = false;
    for (const cs of edits.customSeams) {
      if (cs.a.pieceId === up.id && cs.b.pieceId !== up.id && instOf(cs.b.pieceId, cs.b.instance ?? 0)) { mine = cs.a; hostRef = cs.b; flip = !!cs.flip; break; }
      if (cs.b.pieceId === up.id && cs.a.pieceId !== up.id && instOf(cs.a.pieceId, cs.a.instance ?? 0)) { mine = cs.b; hostRef = cs.a; flip = !!cs.flip; break; }
    }
    if (!hostRef || !mine) continue; // nothing holds it on the garment
    const nCopies = up.cut > 1 && hostRef.instance === undefined && mine.instance === undefined ? Math.min(up.cut, copiesOf(hostRef.pieceId).length) : 1;
    for (let ci = 0; ci < nCopies; ci++) {
      const H = instOf(hostRef.pieceId, nCopies > 1 ? ci : hostRef.instance ?? 0)!;
      const path = seamPath(H.mesh, hostRef.fromId, hostRef.toId);
      const Fp = up.points.find((q) => q.id === mine!.fromId), Tp = up.points.find((q) => q.id === mine!.toId);
      if (path.length < 2 || !Fp || !Tp) break;
      const uvH = H.mesh.uv;
      let E0 = H.place(uvH[path[0]].x, uvH[path[0]].y), E1 = H.place(uvH[path[path.length - 1]].x, uvH[path[path.length - 1]].y);
      if (flip) [E0, E1] = [E1, E0];
      const mid = uvH[path[path.length >> 1]];
      // across the edge, away from the host: continue the host surface past its edge
      const inner = H.mesh.uv.reduce((bi, q, i) => (H.mesh.boundary.includes(i) ? bi : bi < 0 || (q.x - mid.x) ** 2 + (q.y - mid.y) ** 2 < (uvH[bi].x - mid.x) ** 2 + (uvH[bi].y - mid.y) ** 2 ? i : bi), -1);
      const ex3 = scale3(sub3(E1, E0), 1 / (len3(sub3(E1, E0)) || 1));
      const { p: m3, n: nOut } = onHost(H, mid, 0);
      let d3 = inner >= 0 ? sub3(m3, H.place(uvH[inner].x, uvH[inner].y)) : nOut;
      d3 = sub3(d3, scale3(ex3, dot3(d3, ex3)));
      d3 = scale3(d3, 1 / (len3(d3) || 1));
      const L2 = Math.hypot(Tp.x - Fp.x, Tp.y - Fp.y) || 1;
      const ex2 = { x: (Tp.x - Fp.x) / L2, y: (Tp.y - Fp.y) / L2 };
      let ey2 = { x: -ex2.y, y: ex2.x };
      const c2 = bbox(up.points);
      if ((c2.minX + c2.w / 2 - Fp.x) * ey2.x + (c2.minY + c2.h / 2 - Fp.y) * ey2.y < 0) ey2 = { x: -ey2.x, y: -ey2.y };
      const along = len3(sub3(E1, E0)) / L2;
      // the start frame follows the host copy, so on a mirrored copy the piece is placed mirrored too
      add(up, H.mirror, (u, v) => {
        const a = ((u - Fp.x) * ex2.x + (v - Fp.y) * ex2.y) * along, b = (u - Fp.x) * ey2.x + (v - Fp.y) * ey2.y;
        return [0, 1, 2].map((k) => E0[k] + ex3[k] * a + d3[k] * b + nOut[k] * 1.0) as V3;
      });
    }
  }

  // cloth attachments (pockets, patches, appliques, straps) and user pieces patched on: their own panel, pinned to the host.
  // Placement x, y, rotation are in the host piece's own pattern coords for every copy; on a mirrored copy (left side)
  // the placement is the mirror image in 3D but the attachment itself is not flipped (letters still read the right way),
  // so its own coords are mirrored into the host's before placing.
  interface Pin { v: number; hp: Pt } // attachment vertex and the host pattern point it is sewn to
  const pins: { A: PanelInst; H: PanelInst; face: Face; pins: Pin[]; layer: { v: number; hp: Pt }[]; gap: number }[] = [];
  const toHost = (x: number, y: number, rot: number) => {
    const c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
    return (q: Pt): Pt => ({ x: x + q.x * c - q.y * s, y: y + q.x * s + q.y * c });
  };
  /** host copies an edit goes on: the chosen copy, or every copy when none is chosen */
  const hostsOf = (pieceId: string, instance?: number) => instance !== undefined ? [instOf(pieceId, instance)].filter((q): q is (typeof insts)[number] => !!q) : copiesOf(pieceId);
  const mirrorLocal = (H: PanelInst, q: Pt): Pt => (H.mirror ? { x: -q.x, y: q.y } : q);
  const attachSpecs: { id: string; kind: ClothKind; piece: Piece; local: Pt; host: string; instance?: number; xf: (q: Pt) => Pt; w: number; h: number; face: Face; tag?: { mat: LabelMaterial; sew: ReturnType<typeof labelSewing> }; stack: Stack }[] = [];
  for (const a0 of edits.attachments) {
    // a tag without a size gets the standard 5 x 2.5 cm
    const a = a0.kind === 'label' ? { ...a0, ...labelSize(a0) } : a0;
    if (!CLOTH_KINDS.has(a.kind) || !(a.w > 0 && a.h > 0)) continue;
    const host = pieces.find((q) => q.id === a.pieceId);
    if (!host) continue;
    const face = faceOf(a);
    const tag = a.kind === 'label' ? { mat: labelMaterial(a), sew: labelSewing(a, host) } : undefined;
    // an applique cut from a shape: one piece per letter for text, all in the attachment's own coords
    const rings = attachmentPolygons(a);
    rings.forEach((poly, ri) => {
      const pts: PPoint[] = poly.map((q, i) => ({ id: `${a.id}:${ri ? `${ri}:` : ''}${i}`, x: q.x, y: q.y, smooth: false, mirror: null }));
      const bb = bbox(poly);
      const piece: Piece = { id: a.id, name: a.name, role: 'custom', cut: 1, offset: { x: 0, y: 0 }, symmetric: false, points: pts, fabric: a.fabric ?? host.fabric, specs: [] };
      // a letter's size for meshing is its own box; its position stays in the attachment's coords
      attachSpecs.push({ id: a.id, kind: a.kind as ClothKind, piece, local: { x: 0, y: 0 }, host: host.id, instance: a.instance, xf: toHost(a.x, a.y, a.rotation), w: rings.length > 1 ? bb.w : a.w, h: rings.length > 1 ? bb.h : a.h, face, ...(tag ? { tag } : {}), stack: attachmentStack(a, host.fabric.id) });
    });
  }
  for (const up of pieces.filter((q) => q.role === 'custom' && q.placement?.mode === 'patch' && q.placement.hostPieceId)) {
    const pl = up.placement!, bb = bbox(up.points);
    attachSpecs.push({ id: up.id, kind: 'patch', piece: up, local: { x: bb.minX + bb.w / 2, y: bb.minY + bb.h / 2 }, host: pl.hostPieceId!, instance: pl.instance, xf: toHost(pl.x ?? 0, pl.y ?? 0, pl.rotation ?? 0), w: bb.w, h: bb.h, face: 'outside', stack: stackOf(up, edits) });
  }
  // stacked cloth: a patch laid over another patch (layered emblems) sits on top of the cloth under it. Later attachments
  // lie over earlier ones. `below` is the height of the stack under an attachment (mm): the most of (height under the
  // one it covers + that one's own thickness) over every attachment it covers by at least 30% of its area.
  const localPoly = (at: (typeof attachSpecs)[number]) => at.piece.points.map((q) => at.xf({ x: q.x - at.local.x, y: q.y - at.local.y }));
  const polys = attachSpecs.map(localPoly);
  const below = attachSpecs.map(() => 0);
  const covers: number[][] = attachSpecs.map(() => []);
  const sharesCopy = (a?: number, b?: number) => a === undefined || b === undefined || a === b;
  attachSpecs.forEach((at, i) => {
    if (at.kind === 'strap') return;
    const P = polys[i], bb = bbox(P), samples: Pt[] = [];
    for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 7; gy++) {
      const q = { x: bb.minX + ((gx + 0.5) / 7) * bb.w, y: bb.minY + ((gy + 0.5) / 7) * bb.h };
      if (pointInPoly(P, q)) samples.push(q);
    }
    if (!samples.length) return;
    for (let j = 0; j < i; j++) {
      const o = attachSpecs[j];
      if (o.id === at.id || o.host !== at.host || o.face !== at.face || o.kind === 'strap' || !sharesCopy(o.instance, at.instance)) continue;
      const cov = samples.filter((q) => pointInPoly(polys[j], q)).length / samples.length;
      if (cov < 0.3) continue;
      covers[i].push(j);
      below[i] = Math.max(below[i], below[j] + o.stack.thickness);
    }
  });
  /** a region of a panel made locally stiffer (dB, in bend^2) and heavier (dGsm): cloth stacked on it, raised artwork */
  const stiffen: { P: PanelInst; inside: (q: Pt) => boolean; dB: number; dGsm: number }[] = [];
  for (const [i, at] of attachSpecs.entries()) {
    const hosts = hostsOf(at.host, at.instance);
    // the stack height under it lifts it off the host (capped: a very tall stack would pull its pins loose)
    const gap = LAYER_GAP + Math.min(1, below[i] / 10);
    if (!hosts.length) continue;
    const mesh = meshPanel(at.piece.points, Math.min(spacing, Math.max(at.kind === 'applique' ? 0.45 : 0.6, Math.min(at.w, at.h) / 4)));
    if (mesh.tris.length < 3) continue;
    const ys = mesh.boundary.map((i) => mesh.uv[i].y - at.local.y), xs = mesh.boundary.map((i) => mesh.uv[i].x - at.local.x);
    const minY = Math.min(...ys), maxX = Math.max(...xs), minX = Math.min(...xs), maxY = Math.max(...ys);
    const long = at.w >= at.h ? 'x' : 'y', Lh = (long === 'x' ? maxX - minX : maxY - Math.min(...ys)) / 2;
    // which outline vertices are stitched down
    let sewnIdx = mesh.boundary.slice();
    if (at.kind === 'pocket') {
      // the mouth along the top stays open; its two corners are bar-tacked
      const flatTop = ys.filter((y) => y < minY + 0.05).length >= 3;
      const tol = flatTop ? 0.05 : 0.25 * (maxY - minY);
      const top = mesh.boundary.filter((_, k) => ys[k] < minY + tol);
      const tx = top.map((i) => mesh.uv[i].x);
      const lo = Math.min(...tx), hi = Math.max(...tx);
      sewnIdx = mesh.boundary.filter((i, k) => !(ys[k] < minY + tol && mesh.uv[i].x > lo + 1e-3 && mesh.uv[i].x < hi - 1e-3));
    } else if (at.kind === 'strap' || (at.tag && at.tag.sew.method === 'ends')) {
      // stitched across both short ends only; the middle is free (a strap stands off as a loop)
      const tol = Math.max(0.05, Math.min(1, 0.1 * Lh * 2));
      sewnIdx = mesh.boundary.filter((i) => Math.abs((long === 'x' ? mesh.uv[i].x - at.local.x : mesh.uv[i].y - at.local.y)) >= Lh - tol);
    } else if (at.tag?.sew.open) {
      // folded loop caught in a seam: only the open end is held, the fold hangs free
      const o = at.tag.sew.open, tol = Math.max(0.1, Math.min(0.5, 0.15 * o.half * 2));
      sewnIdx = mesh.boundary.filter((i) => (mesh.uv[i].x - at.local.x) * o.dir.x + (mesh.uv[i].y - at.local.y) * o.dir.y >= o.half - tol);
    }
    // a strap's ends are sewn a little closer together than its length, so it forms a loop
    const SLACK = at.kind === 'strap' ? 0.9 : 1;
    const lp = (q: Pt): Pt => {
      const x = q.x - at.local.x, y = q.y - at.local.y;
      return long === 'x' ? { x: x * SLACK, y } : { x, y: y * SLACK };
    };
    for (const H of hosts) {
      const hostIdx = insts.indexOf(H);
      const hpOf = (q: Pt) => at.xf(mirrorLocal(H, lp(q)));
      const A = add(at.piece, false, (u, v) => {
        let bump = 0;
        if (at.kind === 'strap') {
          const t = (long === 'x' ? u - at.local.x : v - at.local.y) / (Lh || 1); // -1..1 along the strap
          bump = 0.19 * 2 * Lh * SLACK * Math.cos((Math.max(-1, Math.min(1, t)) * Math.PI) / 2);
        }
        return onHost(H, hpOf({ x: u, y: v }), gap + 0.3 + bump, at.face).p;
      }, mesh);
      A.attach = { id: at.id, kind: at.kind, host: hostIdx, face: at.face };
      if (at.tag) A.mech = { label: at.tag.mat, layers: at.tag.sew.method === 'loop' ? 2 : 1 };
      if (at.stack.plies.length > 1) (A as (typeof insts)[number]).stack = at.stack;
      if (covers[i].length) {
        // stitched through the cloth under it, the stack bends together over the overlap: the host there takes the
        // bonding (parallel axis) share of the laminate; each ply's own stiffness is in its own panel already
        const hostPly = plyOf(H.piece.fabric.id);
        const plies = [...at.stack.plies, ...covers[i].flatMap((j) => attachSpecs[j].stack.plies), hostPly];
        const dB = Math.max(0, combine(plies, COUPLING.sewn).bend ** 2 - plies.reduce((s, q) => s + q.bend * q.bend, 0));
        const mine = at.piece.points.map((q) => hpOf(q));
        const under = covers[i].map((j) => attachSpecs[j].piece.points.map((q) => attachSpecs[j].xf(mirrorLocal(H, { x: q.x - attachSpecs[j].local.x, y: q.y - attachSpecs[j].local.y }))));
        if (dB > 0) stiffen.push({ P: H, inside: (q) => pointInPoly(mine, q) && under.some((u) => pointInPoly(u, q)), dB, dGsm: 0 });
      }
      // its show face: the side of its winding that faces away from the host cloth
      {
        let nx = 0, ny = 0, nz = 0;
        const X = mesh.uv.map((q) => A.place(q.x, q.y));
        for (let t = 0; t < mesh.tris.length; t += 3) { const n = cross(sub3(X[mesh.tris[t + 1]], X[mesh.tris[t]]), sub3(X[mesh.tris[t + 2]], X[mesh.tris[t]])); nx += n[0]; ny += n[1]; nz += n[2]; }
        const off = onHost(H, hpOf(at.local), 0, at.face).n;
        signs.set(A, nx * off[0] + ny * off[1] + nz * off[2] >= 0 ? 1 : -1);
      }
      pins.push({ A, H, face: at.face, pins: sewnIdx.map((v) => ({ v, hp: hpOf(mesh.uv[v]) })), layer: mesh.uv.map((q, v) => ({ v, hp: hpOf(q) })), gap });
    }
  }

  // raised artwork printed or stitched into the host (puff print, padded embroidery): the cloth under each raised layer
  // is a little stiffer and heavier (a soft foam ply fused on, src/data/stack.ts reliefPly)
  for (const a of edits.attachments) {
    if ((a.kind !== 'print' && a.kind !== 'embroidery') || !(reliefOf(a) > 0)) continue;
    for (const H of hostsOf(a.pieceId, a.instance)) {
      const hostPly = plyOf(H.piece.fabric.id), xf = toHost(a.x, a.y, a.rotation);
      for (const l of a.layers) {
        if (!((l.relief ?? 0) > 0)) continue;
        const rp = reliefPly(l.relief!), dB = Math.max(0, combine([rp, hostPly], COUPLING.fused).bend ** 2 - hostPly.bend ** 2);
        const c = Math.cos((l.rotation * Math.PI) / 180), sn = Math.sin((l.rotation * Math.PI) / 180);
        const box = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
          const x = (u * l.w) / 2, y = (v * l.h) / 2;
          return xf(mirrorLocal(H, { x: l.x + x * c - y * sn, y: l.y + x * sn + y * c }));
        });
        stiffen.push({ P: H, inside: (q) => pointInPoly(box, q), dB, dGsm: rp.gsm });
      }
    }
  }

  // hardware: rivets, buttons, studs, snaps and eyelets weigh the cloth down under them; a zip stiffens the
  // cloth along its line (and an open zip on a seam leaves that stretch of the seam unsewn)
  const trimGrams: { H: PanelInst; at: Pt; r: number; g: number }[] = [];
  const zips: { H: PanelInst; a: Pt; b: Pt; half: number; open: boolean; grams: number; compliance: number }[] = [];
  /** buttons and snaps that can fasten to another piece: attachment id, host panel, pattern point, start position */
  const fasteners: { id: string; type: string; H: PanelInst & { place: Placer }; at: Pt; p: V3; hole: boolean; k: number }[] = [];
  for (const a of edits.attachments) {
    if (a.kind !== 'hardware' || !a.hardware) continue;
    const hw = a.hardware, xf = toHost(a.x, a.y, a.rotation);
    for (const H of hostsOf(a.pieceId, a.instance)) {
      if (hw.type === 'zipper') {
        const L = a.h > 0 ? a.h : 10;
        const teeth = hw.zipper ? ZIP_TEETH[hw.zipper.teeth] ?? ZIP_TEETH.metal : { grams: ZIP_GRAMS_PER_CM, compliance: 0 };
        zips.push({ H, a: xf(mirrorLocal(H, { x: 0, y: -L / 2 })), b: xf(mirrorLocal(H, { x: 0, y: L / 2 })), half: Math.max(0.3, (hw.size || 1) / 2), open: !!hw.open, ...teeth });
        continue;
      }
      const w = trimWeight(hw);
      hardwarePoints(hw).forEach((q, k) => {
        const at = xf(mirrorLocal(H, q));
        // a buttonhole is stitched into the cloth: no weight
        if (!a.buttonhole) trimGrams.push({ H, at, r: Math.max(w.radius, 0.75 * spacing), g: w.grams });
        if (hw.type === 'button' || hw.type === 'snap') fasteners.push({ id: a.id, type: hw.type, H, at, p: onHost(H, at, 0, faceOf(a)).p, hole: !!a.buttonhole, k });
      });
    }
  }
  // fastened: with the collar down, a button on a collar point buttons onto the nearest button on another piece within
  // FASTEN_REACH at the start (a button-down collar; a popped collar is worn unbuttoned); snap halves on two pieces
  // within SNAP_REACH snap together. Each pair is sewn shut like a seam point ('fasten:<id>+<id>').
  const fastenSew: { id: string; a: number; b: number }[] = [];
  const buttoned: Garment3D['buttoned'] = [];
  {
    const used = new Set<number>();
    const vertexAt = (F: (typeof fasteners)[number]) => { const L = locate(F.H.mesh, F.at); return F.H.offset + L.v[L.w.indexOf(Math.max(...L.w))]; };
    // the two copies of a piece cut twice (split fronts, placket strips) are mirror images: of the vertices near the
    // button, take the pair that are each other's mirror most nearly, so they meet in 3D without pulling the fronts across
    const mirroredPair = (A: (typeof fasteners)[number], B: (typeof fasteners)[number]) => {
      const uv = A.H.mesh.uv, R2 = (1.5 * spacing) ** 2;
      const near = (F: typeof A) => uv.map((q, i) => i).filter((i) => (uv[i].x - F.at.x) ** 2 + (uv[i].y - F.at.y) ** 2 < R2);
      let best = { a: vertexAt(A), b: vertexAt(B) }, bd = Infinity;
      for (const i of near(A)) for (const j of near(B)) {
        const d = (uv[i].x + uv[j].x) ** 2 + (uv[i].y - uv[j].y) ** 2 + 0.05 * ((uv[i].x - A.at.x) ** 2 + (uv[i].y - A.at.y) ** 2);
        if (d < bd) { bd = d; best = { a: A.H.offset + i, b: B.H.offset + j }; }
      }
      return best;
    };
    const cand: { i: number; j: number; d: number }[] = [];
    fasteners.forEach((A, i) => fasteners.forEach((B, j) => {
      if (j <= i || A.H === B.H || A.H.piece === B.H.piece && A.H.instance === B.H.instance) return;
      // a popped collar is worn unbuttoned
      const collarPair = collarIs === 'down' && !A.hole && !B.hole && (A.H.piece.role === 'collar') !== (B.H.piece.role === 'collar');
      // a button and a buttonhole on two pieces (or the two copies of a piece cut twice): buttoned unless worn open
      const holePair = !openFront && A.type === 'button' && B.type === 'button' && A.hole !== B.hole;
      const d = len3(sub3(A.p, B.p));
      if (((collarPair || holePair) && d < FASTEN_REACH) || (A.type === 'snap' && B.type === 'snap' && d < SNAP_REACH)) cand.push({ i, j, d });
    }));
    cand.sort((p, q) => p.d - q.d);
    for (const c of cand) {
      if (used.has(c.i) || used.has(c.j)) continue;
      used.add(c.i); used.add(c.j);
      const A = fasteners[c.i], B = fasteners[c.j];
      fastenSew.push({ id: `fasten:${A.id}+${B.id}`, ...(A.H.piece === B.H.piece && A.H.mirror !== B.H.mirror ? mirroredPair(A, B) : { a: vertexAt(A), b: vertexAt(B) }) });
      if (A.hole !== B.hole) {
        const [Bt, Hl] = A.hole ? [B, A] : [A, B];
        buttoned.push({ button: Bt.id, buttonIndex: Bt.k, buttonInstance: Bt.H.instance, hole: Hl.id, holeIndex: Hl.k, holeInstance: Hl.H.instance });
      }
    }
  }
  /** host vertices within d of a pattern segment */
  const nearLine = (H: PanelInst, a: Pt, b: Pt, d: number, boundaryOnly = false) => {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
    const list = boundaryOnly ? H.mesh.boundary : H.mesh.uv.map((_, i) => i);
    return list.filter((i) => {
      const q = H.mesh.uv[i], t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2));
      return Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy) <= d;
    });
  };
  /** host particles an open zip leaves unsewn */
  const unsewn = new Set<number>();
  for (const z of zips) {
    if (!z.open) continue;
    const L = Math.hypot(z.b.x - z.a.x, z.b.y - z.a.y);
    const onEdge = nearLine(z.H, z.a, z.b, z.half + 0.6 * spacing, true);
    // the zip lies on the piece edge when edge points run along most of its length
    const ex = (z.b.x - z.a.x) / (L || 1), ey = (z.b.y - z.a.y) / (L || 1);
    const ts = onEdge.map((i) => (z.H.mesh.uv[i].x - z.a.x) * ex + (z.H.mesh.uv[i].y - z.a.y) * ey);
    if (onEdge.length >= 2 && Math.max(...ts) - Math.min(...ts) >= 0.5 * L) for (const i of onEdge) unsewn.add(z.H.offset + i);
  }

  // pleats: the intake is folded and stitched shut at the edge for the pleat length
  const pleatSew: { id: string; links: [number, number][] }[] = [];
  const pleatHolds: { P: PanelInst; holds: [number, number][] }[] = [];
  const folded = new Map<PanelInst, Set<string>>(); // boundary edges (local "a,b", a < b) inside a pleat intake
  const creased = new Map<PanelInst, Set<number>>(); // local vertices in a pressed pleat: they fold freely
  /** pleat folds per panel: A = first fold point, te = along the edge, n = into the piece, L = intake, folds 1 (knife) or 2 */
  const foldsOf = new Map<PanelInst, { A: Pt; te: Pt; n: Pt; L: number; folds: number; length: number }[]>();
  for (const pl of edits.pleats) {
    for (const P of hostsOf(pl.pieceId, pl.instance)) {
      const g = pleatGeometry(P.mesh, P.piece.points, pl, spacing);
      if (!g) continue;
      pleatSew.push({ id: `pleat:${pl.id}`, links: g.pairs.map(([a, b]) => [P.offset + a, P.offset + b]) });
      pleatHolds.push({ P, holds: g.holds });
      // seams along this edge walk past the folded intake (it adds no length), like the seam report
      const set = folded.get(P) ?? new Set<string>();
      for (const k of g.foldedEdges) set.add(k);
      folded.set(P, set);
      // start the fold already turned: the folded fabric lies behind the face (a box pleat stands out in front)
      const base = P.place, sign = pl.type === 'box' ? 1 : -1;
      const cP = centreOf(P); // from the unfolded placement
      const H = Math.min(0.6 * pl.depth, 1.2);
      const C = { x: (g.A.x + g.B.x) / 2, y: (g.A.y + g.B.y) / 2 }, half = Math.max(0.5, Math.hypot(g.B.x - g.A.x, g.B.y - g.A.y) / 2);
      const te = { x: (g.B.x - g.A.x) / (2 * half), y: (g.B.y - g.A.y) / (2 * half) };
      const cr = creased.get(P) ?? new Set<number>();
      P.mesh.uv.forEach((q, i) => {
        const al = Math.abs((q.x - C.x) * te.x + (q.y - C.y) * te.y), ac = (q.x - C.x) * g.n.x + (q.y - C.y) * g.n.y;
        if (al < half + 0.6 * spacing && ac > -1 && ac < pl.length + spacing) cr.add(i);
      });
      creased.set(P, cr);
      const fl = foldsOf.get(P) ?? [];
      fl.push({ A: g.A, te, n: g.n, L: 2 * half, folds: pl.type === 'knife' ? 1 : 2, length: pl.length });
      foldsOf.set(P, fl);
      const normalAt = (u: number, v: number): V3 => {
        const e = 0.5, du = sub3(base(u + e, v), base(u - e, v)), dv = sub3(base(u, v + e), base(u, v - e));
        let n = cross(du, dv);
        const out = sub3(base(u, v), cP);
        if (len3(n) < 1e-9) n = out;
        n = scale3(n, 1 / (len3(n) || 1));
        return dot3(n, out) < 0 ? scale3(n, -1) : n;
      };
      P.place = (u, v) => {
        const p = base(u, v);
        const along = Math.abs((u - C.x) * te.x + (v - C.y) * te.y), across = (u - C.x) * g.n.x + (v - C.y) * g.n.y;
        if (along >= half || across < -0.5 || across > pl.length + 3) return p;
        const k = (pl.type === 'knife' ? 1 - along / half : Math.abs(1 - along / (half / 2)) < 1 ? 1 - Math.abs(1 - along / (half / 2)) : 0) * Math.min(1, (pl.length + 3 - across) / 3);
        if (k <= 0) return p;
        const n = normalAt(u, v);
        return [p[0] + n[0] * sign * H * k, p[1] + n[1] * sign * H * k, p[2] + n[2] * sign * H * k];
      };
    }
  }

  // ---- initial placement ----
  const init = new Float32Array(count * 3);
  for (const pi of insts) {
    pi.mesh.uv.forEach((p, i) => {
      const [x, y, z] = pi.place(p.x, p.y);
      const j = (pi.offset + i) * 3;
      init[j] = x; init[j + 1] = y; init[j + 2] = z;
    });
  }

  // ---- constraints ----
  const stretch: [number, number, number, number][] = [];
  const maxStrain: number[] = [];
  const bend: [number, number, number, number][] = [];
  const limits = new Float32Array(count);
  // an elastic waist gathers the top of the legs too: the fabric there takes up the extra length in small folds
  const band = pieces.find((p) => p.role === 'waistband' && p.elastic);
  const bandGather = band ? Math.min(1, band.elastic! / (Math.max(...band.points.map((q) => q.x)) * 2)) : 1;
  for (const pi of insts) {
    // a pattern piece with a different cloth inside: the two bend, weigh and stretch as one stack
    if (!pi.attach) { const S = stackOf(pi.piece, edits); if (S.plies.length > 1) pi.stack = S; }
    const M = mechanics(pi.piece, style, { collarUp: collarIs === 'up', legacyCollar, ...(pi.mech ?? {}), ...(pi.stack ? { stack: pi.stack } : {}) });
    const bend0 = bend.length;
    const { uv, tris } = pi.mesh;
    const o = pi.offset;
    const legTop = Math.min(...pi.piece.points.map((q) => q.y));
    const shirr = bandGather < 1 && (pi.piece.role === 'front' || pi.piece.role === 'back')
      ? (y: number) => bandGather + (1 - bandGather) * Math.min(1, Math.max(0, (y - legTop) / 8))
      : null;
    for (let i = 0; i < uv.length; i++) limits[o + i] = M.stretch;
    const edges = new Map<string, number>(); // edge -> opposite vertex of first triangle
    const crease = creased.get(pi);
    const fl = foldsOf.get(pi);
    const len = (a: number, b: number) => fl ? foldLen(fl, uv[a], uv[b], flatLen(a, b)) : flatLen(a, b);
    const flatLen = (a: number, b: number) => {
      if (M.shaped) {
        const sh = pi.shape ?? pi.place;
        const p = sh(uv[a].x, uv[a].y), q = sh(uv[b].x, uv[b].y);
        return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      }
      const g = shirr ? shirr((uv[a].y + uv[b].y) / 2) : M.gather;
      return Math.hypot((uv[a].x - uv[b].x) * g, uv[a].y - uv[b].y);
    };
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + ((e + 1) % 3)], c = tris[t + ((e + 2) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        const other = edges.get(k);
        if (other === undefined) {
          edges.set(k, c);
          stretch.push([o + a, o + b, len(a, b), M.sc]);
          maxStrain.push(M.stretch + 0.01);
        } else {
          // a pressed fold only shortens the distance across an edge; spreading in the start shape does not count
          const rest = M.foldBend ? (() => { const P = pi.place(uv[other].x, uv[other].y), Q = pi.place(uv[c].x, uv[c].y); return Math.min(len(other, c), Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2])); })() : len(other, c);
          bend.push([o + other, o + c, rest, crease && (crease.has(other) || crease.has(c)) ? M.bc * 1e4 : M.bc]);
        }
      }
    }
    // regions stiffened by cloth stacked on them or raised artwork: bending links whose middle lies inside
    const mine = stiffen.filter((r) => r.P === pi);
    if (mine.length) for (let k = bend0; k < bend.length; k++) {
      const e = bend[k];
      if (!(e[3] > 0) || e[3] > M.bc * 1.5) continue; // rigid links and pressed creases keep theirs
      const m = { x: (uv[e[0] - o].x + uv[e[1] - o].x) / 2, y: (uv[e[0] - o].y + uv[e[1] - o].y) / 2 };
      const dB = mine.reduce((s, r) => s + (r.inside(m) ? r.dB : 0), 0);
      if (dB > 0) { const B0 = (0.05 * H2) / e[3]; e[3] = (0.05 * H2) / Math.min(STACK_CAPS.bend ** 2, B0 + dB); }
    }
    if (pi.stack && !M.plate && !M.shaped) {
      // a stiff stack bends over a longer span than one cloth: links across about two mesh spacings carry the stiffness
      // it adds, so it folds in fewer, larger creases instead of the fine wrinkles of its outside cloth alone
      const dB = pi.stack.bend ** 2 - fabricById(pi.piece.fabric.id).bend ** 2;
      if (dB > 0.02) {
        // two rings (about 2 and 3 spacings): stiffness shared between them
        const c2 = (0.05 / Math.min(STACK_CAPS.bend ** 2, dB)) * H2, lo = (1.7 * spacing) ** 2, hi = (3.2 * spacing) ** 2;
        const cell = 3.2 * spacing, grid = new Map<string, number[]>();
        uv.forEach((q, a) => { const k = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(a); });
        uv.forEach((q, a) => {
          const gx = Math.floor(q.x / cell), gy = Math.floor(q.y / cell);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const b of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
            if (b <= a) continue;
            const d2 = (q.x - uv[b].x) ** 2 + (q.y - uv[b].y) ** 2;
            if (d2 > lo && d2 < hi) bend.push([o + a, o + b, len(a, b), c2]);
          }
        });
      }
    }
    if (M.plate) {
      // a stiff plate: tie every point to its neighbours a few cm away, keeping the pre-curved shape
      for (let a = 0; a < uv.length; a++) for (let b = a + 1; b < uv.length; b++) {
        const d2 = (uv[a].x - uv[b].x) ** 2 + (uv[a].y - uv[b].y) ** 2;
        if (d2 > (1.6 * spacing) ** 2 && d2 < (3.4 * spacing) ** 2) bend.push([o + a, o + b, len(a, b), 0]);
      }
    }
  }

  // attachments: every stitched outline point is tied to the three corners of the host triangle under it
  // (barycentric pin), at its flat pattern distance plus the layer gap, so it rides on the host cloth; and every
  // attachment point keeps the layer gap on the host's outer side (the pins alone could flip it underneath)
  const layerIdx: number[] = [], layerW: number[] = [];
  const layerNear: NonNullable<Garment3D['layerNear']> = [];
  const skipPanel = new Int32Array(count).fill(-1);
  for (const { A, H, face, pins: list, layer: lay, gap } of pins) {
    for (const { v, hp } of list) {
      const L = locate(H.mesh, hp);
      L.v.forEach((c) => {
        const q = H.mesh.uv[c];
        bend.push([A.offset + v, H.offset + c, Math.hypot(hp.x - q.x, hp.y - q.y, gap), 0]);
      });
    }
    const hostIdx = insts.indexOf(H as (typeof insts)[number]);
    skipPanel.fill(hostIdx, A.offset, A.offset + A.mesh.uv.length);
    const Hp = H as (typeof insts)[number];
    const HT = H.mesh.tris, Huv = H.mesh.uv;
    const cH = centreOf(Hp);
    const fs = face === 'inside' ? -1 : 1;
    const triSign = (t: number) => {
      if (H.piece.role === 'collar') return signOf(Hp) * fs; // a collar folds over itself: the side comes from its winding
      const P = [HT[t], HT[t + 1], HT[t + 2]].map((c) => [init[(H.offset + c) * 3], init[(H.offset + c) * 3 + 1], init[(H.offset + c) * 3 + 2]] as V3);
      const mid: V3 = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3];
      return (dot3(cross(sub3(P[1], P[0]), sub3(P[2], P[0])), sub3(mid, cH)) >= 0 ? 1 : -1) * fs;
    };
    const signs = new Map<number, number>();
    const tc = new Float32Array((HT.length / 3) * 2);
    for (let t = 0; t < HT.length; t += 3) { tc[(t / 3) * 2] = (Huv[HT[t]].x + Huv[HT[t + 1]].x + Huv[HT[t + 2]].x) / 3; tc[(t / 3) * 2 + 1] = (Huv[HT[t]].y + Huv[HT[t + 1]].y + Huv[HT[t + 2]].y) / 3; }
    const R2 = (1.6 * spacing) ** 2;
    for (const { v, hp } of lay) {
      const L = locate(H.mesh, hp);
      const P = L.v.map((c) => [init[(H.offset + c) * 3], init[(H.offset + c) * 3 + 1], init[(H.offset + c) * 3 + 2]] as V3);
      const nw = cross(sub3(P[1], P[0]), sub3(P[2], P[0]));
      const out = onHost(Hp, hp, 0, face).n;
      layerIdx.push(A.offset + v, H.offset + L.v[0], H.offset + L.v[1], H.offset + L.v[2]);
      layerW.push(L.w[0], L.w[1], L.w[2], gap, dot3(nw, out) >= 0 ? 1 : -1);
      const tris: number[] = [], sg: number[] = [];
      for (let t = 0; t < HT.length; t += 3) {
        const cx = tc[(t / 3) * 2] - hp.x, cy = tc[(t / 3) * 2 + 1] - hp.y;
        if (cx * cx + cy * cy > R2) continue;
        if (!signs.has(t)) signs.set(t, triSign(t));
        tris.push(H.offset + HT[t], H.offset + HT[t + 1], H.offset + HT[t + 2]); sg.push(signs.get(t)!);
      }
      layerNear.push({ a: A.offset + v, tris: Int32Array.from(tris), sign: Int8Array.from(sg), ...(face === 'inside' ? { inside: true } : {}) });
    }
  }

  // a collar worn down: the roll line holds and the fall lies outside the stand. Every point of the fall within a
  // stand height of the roll line is tied to the stand point it lies over (the same distance below the roll line), at
  // the start distance, and kept on the stand's outer side (the under collar side, away from the neck) like a cloth
  // layer; the rest of the fall hangs past the neckline seam, kept on the outer side of the foot of the stand.
  // Without the side rule a fold may turn either way: a fall folded in against the neck climbs up it.
  // Everything here comes from the collar as drawn: the sewn edge (collarEdge), the roll line over it (collarRoll),
  // and only where the collar really has a stand under the fall. A point that runs out past the stand (a collar tip
  // drawn longer than its sewn edge) has nothing to lie on and hangs free: tied to the nearest triangle instead, its
  // side rule swings with every twist of that triangle and shakes the fall. The solver pushes a layer back out by at
  // most ClothSim.layerStep per substep, so a host triangle that does twist can not fling the fall about.
  // fronts that overlap (split fronts buttoned, polo placket strips): the front that laps over lies on the one under it.
  // Over the overlap it rests on the under front with soft links (OVERLAP_COMPLIANCE: they give, like cloth held by
  // friction and the buttons either side), so the two can not slide apart between the buttons. The two copies are
  // mirror images, so a point at x on the over copy lies over the point at -x of the under copy. (A one-sided layer push
  // here, as attachments have, flings the fronts while the seams close: the under front slides under the triangles it
  // was tied to.)
  const fastenV = new Set(fastenSew.flatMap((q) => [q.a, q.b]));
  const overlapPairs: [(typeof insts)[number], (typeof insts)[number]][] = [];
  if (!openFront) for (const P of insts) {
    if (P.attach || P.instance !== overCopy(body)) continue;
    const U = insts.find((q) => q.piece === P.piece && !q.attach && q.instance !== P.instance);
    if (U && ((P.piece.role === 'front' && isSplitFront(P.piece)) || P.piece.role === 'placket')) overlapPairs.push([P, U]);
  }
  for (const [O, U] of overlapPairs) {
    const uIdx = insts.indexOf(U);
    const strip = Math.max(OVERLAP_STRIP, Math.max(0, -Math.min(...O.piece.points.map((q) => q.x))) + 0.5 * spacing);
    O.mesh.uv.forEach((q, v) => {
      if (Math.abs(q.x) > strip || fastenV.has(O.offset + v)) return;
      const hp = { x: -q.x, y: q.y };
      const L = locate(U.mesh, hp);
      if (L.out > 0.05) return;
      skipPanel[O.offset + v] = uIdx;
      L.v.forEach((c) => {
        const r = U.mesh.uv[c];
        bend.push([O.offset + v, U.offset + c, Math.hypot(hp.x - r.x, hp.y - r.y, LAYER_GAP), OVERLAP_COMPLIANCE * H2]);
      });
    });
  }
  const foldLayers = layerIdx.length / 4; // collar fold entries follow the attachment ones
  if (collarIs === 'down' && !legacyCollar) for (const P of insts) {
    if (P.piece.role !== 'collar' || P.attach) continue;
    const roll = collarRoll(style.id, P.piece), edgeY = collarEdge(P.piece), uv = P.mesh.uv;
    const sOf = (q: Pt) => q.y - edgeY(q.x); // height over the sewn edge as drawn
    const away = -signOf(P); // winding sign of the under collar face
    const X = (i: number): V3 => [init[i * 3], init[i * 3 + 1], init[i * 3 + 2]];
    uv.forEach((q, i) => {
      const s = sOf(q), d = s - roll;
      if (d < 0.4) return;
      const vi = P.offset + i;
      // the stand point under it: mirrored about the roll line, or at the foot of the stand for the fall past the seam
      const target = { x: q.x, y: q.y - Math.min(2 * d, s - 0.3) };
      if (d <= roll) {
        let bj = -1, bd = (0.7 * spacing) ** 2;
        uv.forEach((r, j) => { const e = (r.x - target.x) ** 2 + (r.y - target.y) ** 2; if (e < bd && sOf(r) < roll) { bd = e; bj = j; } });
        if (bj >= 0) bend.push([vi, P.offset + bj, len3(sub3(X(vi), X(P.offset + bj))), 0]);
      }
      const L = locate(P.mesh, target);
      if (L.out > 0.05) return;
      layerIdx.push(vi, P.offset + L.v[0], P.offset + L.v[1], P.offset + L.v[2]);
      layerW.push(L.w[0], L.w[1], L.w[2], LAYER_GAP, away);
    });
  }

  // a zip: long links along its line hold the cloth there straight and stiff, like the zip tape (metal teeth rigid,
  // a coil bends a little)
  for (const z of zips) {
    const vs = nearLine(z.H, z.a, z.b, z.half + 0.35 * spacing);
    const uv = z.H.mesh.uv, o = z.H.offset;
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const d = Math.hypot(uv[vs[i]].x - uv[vs[j]].x, uv[vs[i]].y - uv[vs[j]].y);
      if (d > 1.2 * spacing && d < 3.4 * spacing) bend.push([o + vs[i], o + vs[j], d, z.compliance * H2]);
    }
  }

  // pleat stitching inside the piece: the folded layers are held where the fold puts them
  for (const { P, holds } of pleatHolds) {
    const fl = foldsOf.get(P)!;
    for (const [a, b] of holds) {
      const p = P.mesh.uv[a], q = P.mesh.uv[b];
      const r = foldLen(fl, p, q, 1e6);
      bend.push([P.offset + a, P.offset + b, r < 1e5 ? r : Math.hypot(p.x - q.x, p.y - q.y), 0]);
    }
  }

  const sew: [number, number][] = [];
  const seen = new Set<string>();
  const seamLinks: Record<string, [number, number][]> = {};
  // a side is one or more piece edges in a row; both sides are matched by arc length, so ease or
  // gathering (sleeve cap, cuff pleat, rib trims) is spread evenly along the seam
  const sideVerts = (side: Side) => {
    const verts: number[] = [];
    const uvs: Pt[] = [];
    const fold: boolean[] = []; // the step to this vertex lies inside a folded pleat intake
    for (const [P, a, b] of side) {
      if (!a || !b) return null;
      const path = seamPath(P.mesh, a, b);
      if (path.length < 2) return null;
      const fs = folded.get(P);
      path.forEach((v, i) => {
        verts.push(P.offset + v); uvs.push(P.mesh.uv[v]);
        const u = path[i - 1];
        fold.push(!!fs && i > 0 && fs.has(u < v ? `${u},${v}` : `${v},${u}`));
      });
    }
    // arc length over the whole side (piece-to-piece jumps and pleat intakes add nothing)
    const t = [0];
    for (let i = 1; i < verts.length; i++) {
      const d = Math.hypot(uvs[i].x - uvs[i - 1].x, uvs[i].y - uvs[i - 1].y);
      t.push(t[i - 1] + (d > 3 * spacing || fold[i] ? 0 : d));
    }
    const L = t[t.length - 1] || 1;
    // the fabric inside a folded intake is not sewn: only the two fold points meet the other side
    const inside = fold.map((f, i) => f && i + 1 < fold.length && fold[i + 1]);
    return { verts, t: t.map((x) => x / L), inside };
  };
  const link = (i: number, j: number, out: [number, number][]) => {
    const k = `${i},${j}`;
    if (i === j || seen.has(k) || (unsewn.size && (unsewn.has(i) || unsewn.has(j)))) return;
    seen.add(k);
    sew.push([i, j]);
    out.push([i, j]);
  };
  const sewSides = (id: string, sa: Side, sb: Side, flip = false) => {
    const A = sideVerts(sa), B = sideVerts(sb);
    if (!A || !B) return;
    if (flip) B.t = B.t.map((x) => 1 - x);
    const out = (seamLinks[id] ??= []);
    const nearest = (S: { t: number[]; inside: boolean[] }, t: number) => {
      let bi = -1;
      S.t.forEach((v, i) => { if (!S.inside[i] && (bi < 0 || Math.abs(v - t) < Math.abs(S.t[bi] - t))) bi = i; });
      return Math.max(0, bi);
    };
    A.verts.forEach((v, i) => { if (!A.inside[i]) link(v, B.verts[nearest(B, A.t[i])], out); });
    B.verts.forEach((v, i) => { if (!B.inside[i]) link(A.verts[nearest(A, B.t[i])], v, out); });
  };
  const sideOf = (refs: EdgeRef[], instance?: number): Side | null => {
    const side: Side = [];
    for (const r of refs) {
      const P = instOf(r.pieceId, r.instance ?? instance ?? 0);
      if (!P) return null;
      side.push([P, r.fromId, r.toId]);
    }
    return side;
  };
  // built-in sewing lines, in their fixed order, minus the ones the user detached
  const detached = new Set(edits.detachedSeams);
  for (const bs of builtinSeams(style.id, pieces, edits)) {
    if (detached.has(bs.id)) continue;
    const a = sideOf(bs.a), b = sideOf(bs.b);
    if (a && b) sewSides(bs.id, a, b);
  }
  // user seams: an edge run on each side, the shorter way round; a piece cut twice is sewn copy to copy
  for (const cs of edits.customSeams) {
    const na = copiesOf(cs.a.pieceId).length, nb = copiesOf(cs.b.pieceId).length;
    const pairs = cs.a.instance !== undefined || cs.b.instance !== undefined || na !== nb ? [0] : Array.from({ length: na }, (_, i) => i);
    for (const i of pairs) {
      const a = sideOf([cs.a], i), b = sideOf([cs.b], i);
      if (a && b) sewSides(cs.id, a, b, cs.flip);
    }
  }
  for (const { id, links } of pleatSew) {
    const out = (seamLinks[id] ??= []);
    for (const [i, j] of links) link(i, j, out);
  }
  for (const { id, a, b } of fastenSew) link(a, b, (seamLinks[id] ??= []));

  const sim = new ClothSim(count, stretch, bend, sew, { sewCompliance: 0, friction: 0.35, damping: 0.985 });
  maxStrain.forEach((v, i) => (sim.maxStrain[i] = v));
  sim.substeps = SUB;
  // hat pieces start in place, practically sewn: gravity and friction from the start keep them seated on the head
  if (hat) sim.sewFrames = 6;
  // the garment can not climb the body while its seams close (see ClothSim.sewRise)
  else sim.sewRise = SEW_RISE;
  sim.pos.set(init);
  sim.prev.set(sim.pos);
  // body contact per particle: 0 normal, 1 none (a visor is held off the body by its band),
  // 2 may sink up to 3.5 cm (the inseam fork and upper inseam lie in the crease between thighs that touch on most bodies)
  const contact = new Uint8Array(count);
  for (const P of freePanels) contact.fill(1, P.offset, P.offset + P.mesh.uv.length);
  // a strip a few cm wide along those seams, so the cloth can fold into the crease
  for (const side of between) for (const [P, a, b] of side) {
    if (!a || !b) continue;
    const seamUv = seamPath(P.mesh, a, b).filter((v) => { const y = init[(P.offset + v) * 3 + 1]; return y > f.crotchH - 25 && y < f.crotchH + 2; }).map((v) => P.mesh.uv[v]);
    P.mesh.uv.forEach((q, v) => {
      for (const s of seamUv) if ((s.x - q.x) ** 2 + (s.y - q.y) ** 2 < 16) { contact[P.offset + v] = 2; break; }
    });
  }
  // 3: rubber elastic grips the skin much harder than fabric (the solver's friction scales with contact depth)
  if (band) for (const P of insts) if (P.piece === band) contact.fill(3, P.offset, P.offset + P.mesh.uv.length);
  const body3d = (collider ?? new BodyCollider(body)) as BodyLike;
  sim.collider = contactCollider(contact, body3d);
  // a hat rides on the head: simulated in the head's frame, so a walk's bob or a jump can not throw it off
  if (hat) carryWithHead(sim, body3d, 0, count);
  // fabric weight: heavier cloth (higher gsm) hangs and folds more under the same stiffness
  const panelOf = new Uint16Array(count), uvs = new Float32Array(count * 2);
  let heaviest = 0;
  // a stack weighs all its plies; it is thicker than its outside cloth, so it keeps further off the body
  const thick = new Float32Array(count);
  let thickest = 0;
  let heavier = 1; // most weight a stack adds over its outside cloth
  const panelThickness = new Float32Array(insts.length);
  insts.forEach((pi, k) => {
    const S = pi.stack;
    const gsm = pi.mech ? pi.mech.label.gsm * pi.mech.layers + (S ? S.gsm - S.plies[0].gsm : 0) : S ? S.gsm : fabricById(pi.piece.fabric.id).gsm;
    if (!pi.mech) heaviest = Math.max(heaviest, gsm); // a small tag does not set the layer spacing of the garment
    const extra = S && !pi.attach ? Math.max(0, S.thickness - fabricThickness(pi.piece.fabric.id)) / 10 : 0; // cm
    if (extra > 0) { thick.fill(extra, pi.offset, pi.offset + pi.mesh.uv.length); thickest = Math.max(thickest, extra); }
    if (S && !pi.attach) heavier = Math.max(heavier, S.gsm / fabricById(pi.piece.fabric.id).gsm);
    panelThickness[k] = (S ? S.thickness : fabricThickness(pi.piece.fabric.id)) / 10;
    const heavy = stiffen.filter((r) => r.P === pi && r.dGsm > 0);
    pi.mesh.uv.forEach((q, i) => {
      const v = pi.offset + i;
      const g = heavy.length ? gsm + heavy.reduce((s, r) => s + (r.inside(q) ? r.dGsm : 0), 0) : gsm;
      sim.invMass[v] = Math.min(2, 250 / Math.min(STACK_CAPS.gsm, g));
      panelOf[v] = k; uvs[v * 2] = q.x; uvs[v * 2 + 1] = q.y;
    });
  });
  if (thickest > 0) sim.collider = contactCollider(contact, body3d, thick);
  // the solver caps a constraint's impulse per substep (maxMove), and a heavier point moves less for the same impulse:
  // scaled up by the added weight, a lined garment closes its seams as fast as the unlined one
  if (heavier > 1) sim.maxMove *= heavier;
  const group = new Int32Array(count).map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (const [a, b] of sew) group[find(a)] = find(b);
  // the layers of a pressed pleat lie flat on each other: they share a group so self collision lets them touch
  for (const [P, set] of creased) { let first = -1; for (const v of set) { if (first < 0) first = P.offset + v; else group[find(P.offset + v)] = find(first); } }
  for (let i = 0; i < count; i++) group[i] = find(i);
  sim.panelOf = panelOf; sim.uv = uvs; sim.seamGroup = group;
  if (layerIdx.length) { sim.layerIdx = Int32Array.from(layerIdx); sim.layerW = Float32Array.from(layerW); }
  if (layerIdx.length || skipPanel.some((v) => v >= 0)) sim.skipPanel = skipPanel;
  // hardware weight: grams onto the host particles under each trim (spread over the cloth it is fixed through)
  if (trimGrams.length || zips.length) {
    const areaOf = new Map<PanelInst, Float32Array>(); // cloth area each particle stands for (cm2)
    const area = (P: PanelInst) => {
      let A = areaOf.get(P);
      if (!A) {
        A = new Float32Array(P.mesh.uv.length);
        const { uv, tris } = P.mesh;
        for (let t = 0; t < tris.length; t += 3) {
          const a = uv[tris[t]], b = uv[tris[t + 1]], c = uv[tris[t + 2]];
          const ar = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 6;
          A[tris[t]] += ar; A[tris[t + 1]] += ar; A[tris[t + 2]] += ar;
        }
        areaOf.set(P, A);
      }
      return A;
    };
    const addGrams = (P: PanelInst, vs: number[], g: number) => {
      if (!vs.length) return;
      const A = area(P);
      for (const v of vs) {
        const i = P.offset + v, m0 = 1 / sim.invMass[i];
        // mass 1 stands for 250 g/m2 of fabric over the particle's area
        const gramsPerUnit = Math.max(1e-4, (250 * A[v]) / 1e4);
        sim.invMass[i] = 1 / Math.min(6 * m0, m0 + g / vs.length / gramsPerUnit); // capped: very heavy points upset the solver
      }
    };
    for (const t of trimGrams) {
      let vs = nearLine(t.H, t.at, t.at, t.r);
      if (!vs.length) vs = [locate(t.H.mesh, t.at).v[0]];
      addGrams(t.H, vs, t.g);
    }
    for (const z of zips) addGrams(z.H, nearLine(z.H, z.a, z.b, z.half + 0.35 * spacing), z.grams * Math.hypot(z.b.x - z.a.x, z.b.y - z.a.y));
  }
  const nearSeam = new Uint8Array(count);
  const sewn = new Set<number>();
  for (const [a, b] of sew) { sewn.add(a); sewn.add(b); }
  for (const pi of insts) {
    const seamPts = [...sewn].filter((v) => v >= pi.offset && v < pi.offset + pi.mesh.uv.length).map((v) => pi.mesh.uv[v - pi.offset]);
    pi.mesh.uv.forEach((q, i) => {
      for (const sp of seamPts) if ((sp.x - q.x) ** 2 + (sp.y - q.y) ** 2 < 9) { nearSeam[pi.offset + i] = 1; break; }
    });
  }
  // the cloth folded into the crease between the thighs is out of sight: layers there may overlap freely
  for (let i = 0; i < count; i++) if (contact[i] === 2) nearSeam[i] = 1;
  sim.nearSeam = nearSeam;
  sim.selfRadius = Math.min(spacing * 0.45, 0.5 + heaviest / 1500 + thickest); // thicker cloth keeps layers further apart
  const panelSign = Int8Array.from(insts, (P) => signOf(P));
  return {
    sim, panels: insts.map(({ place: _p, shape: _s, mech: _m, stack: _k, ...rest }) => rest), limits, seamLinks, body: body3d, contact, panelSign, collar: collarIs, foldLayers,
    style: style.id, edits, buttoned, panelThickness, ...(thickest > 0 ? { thick } : {}), ...(layerNear.length ? { layerNear } : {}),
  };
}

/**
 * Float: the body is hidden, so the cloth is shown in its draped shape in the air instead of acting as if a body were
 * there. On: the cloth is frozen where it is (the solver stops: sim.sleeping), and should it be stepped anyway (a
 * garment rebuilt while floating is stepped a few frames to close its seams) there is no gravity, no body and no
 * riding on the head, so nothing falls or sinks. The cloth on its own can not hold a drape (fabric springs back flat
 * without the body and gravity shaping it), which is why it is frozen rather than simulated. Off: gravity and the body
 * come back and the drape picks up from that shape. The body collider is kept on the garment (`floatSaved`).
 */
export function setFloat(G: Garment3D & { floatSaved?: { collider: ClothSim['collider']; carry: ClothSim['carrySource'] } }, on: boolean) {
  const sim = G.sim;
  if (on) {
    if (!G.floatSaved) G.floatSaved = { collider: sim.collider, carry: sim.carrySource };
    sim.collider = null;
    sim.carrySource = null;
    sim.gravity = 0;
    sim.vel.fill(0);
    sim.prev.set(sim.pos);
    sim.awake = false;
    sim.sleeping = true;
  } else if (G.floatSaved) {
    sim.collider = G.floatSaved.collider;
    sim.carrySource = G.floatSaved.carry;
    sim.gravity = -981;
    delete G.floatSaved;
    // a garment built while floating may not be fully sewn yet: it finishes its sewing on the body (skipping the rest
    // of the sewing phase gave open seams gravity and the body pushing them apart)
    sim.sleeping = false;
  }
}

/** bone of the head (and upper neck) in the pose rig (src/sim/pose.ts) */
export const HEAD_BONE = 10;

/** Make particles from..to ride with the head when the collider is posed (has bone matrices M and Mprev). */
export function carryWithHead(sim: ClothSim, body: unknown, from: number, to: number) {
  const C = body as { M?: Float64Array; Mprev?: Float64Array };
  if (!(C.M instanceof Float64Array) || !(C.Mprev instanceof Float64Array)) return;
  sim.carrySource = C as { M: Float64Array; Mprev: Float64Array };
  sim.carry.push({ from, to, bone: HEAD_BONE });
}

/**
 * The solver's collider for a per particle contact mode (Garment3D.contact): 0 normal, 1 none (a visor held off the
 * body by its band), 2 may sink up to 3.5 cm (the crease between the thighs), 3 elastic (grips 6x harder).
 */
export function contactCollider(contact: Uint8Array, body3d: BodyLike, thick?: Float32Array): NonNullable<ClothSim['collider']> {
  if (thick) {
    // a thick stack (a lined piece) keeps its own thickness further off the skin than single cloth
    const inner = contactCollider(contact, body3d);
    return {
      project: (p, j, out) => {
        const x = thick[j / 3], c = contact[j / 3];
        if (!(x > 0) || c === 1 || c === 2) return inner.project(p, j, out);
        const t = body3d.thickness;
        body3d.thickness = t + x;
        const hit = inner.project(p, j, out);
        body3d.thickness = t;
        return hit;
      },
    };
  }
  if (!contact.some((v) => v)) return body3d;
  return {
    project: (p, j, out) => {
      const c = contact[j / 3];
      if (c === 1) { out.depth = 0; return false; }
      if (c === 0) return body3d.project(p, j, out);
      if (c === 3) { const hit = body3d.project(p, j, out); out.depth *= 6; return hit; }
      const t = body3d.thickness;
      body3d.thickness = -3.5;
      const hit = body3d.project(p, j, out);
      body3d.thickness = t;
      return hit;
    },
  };
}

/**
 * Cloth positions as the user sees them: seams closed exactly, then every point that ended up in the drawn
 * skin (seam averaging, the crease between the thighs, a fast limb) is lifted back out to DISPLAY_MARGIN.
 * Display only: strain (the Stretch-Risk-O-Meter) is always read from sim.pos, never from these.
 */
export function displayPositions(G: Garment3D, out: Float32Array) {
  G.sim.display(out);
  const B = G.body, contact = G.contact;
  const nL = G.sim.layerIdx ? G.sim.layerIdx.length / 4 : 0, fold = Math.min(nL, G.foldLayers ?? nL);
  // the fall of a collar laid out over its stand first, so the skin rule below has the last word on the collar (a stand
  // that twists near a collar point could otherwise push the fall into the neck)
  if (fold < nL) G.sim.layers(out, Infinity, fold, nL);
  if (B && B.thickness > 0) liftOffSkin(G, B, contact, out);
  // attachments last: always on the outer face of their host as drawn
  if (fold > 0) G.sim.layers(out, Infinity, 0, fold);
  if (G.layerNear) for (const L of G.layerNear) liftOffHost(out, L);
}

/**
 * Display: an attachment point keeps LAYER_GAP over the nearest of the host triangles around it. An attachment on the
 * inside face lies between the host and the skin, so there the host cloth is lifted off it instead (the attachment
 * is already off the skin).
 */
function liftOffHost(out: Float32Array, L: { a: number; tris: Int32Array; sign: Int8Array; inside?: boolean }) {
  const a = L.a * 3, x = out[a], y = out[a + 1], z = out[a + 2];
  let best = Infinity, bt = -1, bq: V3 = [0, 0, 0];
  for (let t = 0; t < L.tris.length; t += 3) {
    const q = closestOnTri(out, L.tris[t] * 3, L.tris[t + 1] * 3, L.tris[t + 2] * 3, x, y, z);
    const d2 = (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2;
    if (d2 < best) { best = d2; bt = t; bq = q; }
  }
  if (bt < 0) return;
  const i0 = L.tris[bt] * 3, i1 = L.tris[bt + 1] * 3, i2 = L.tris[bt + 2] * 3;
  const n = cross([out[i1] - out[i0], out[i1 + 1] - out[i0 + 1], out[i1 + 2] - out[i0 + 2]], [out[i2] - out[i0], out[i2 + 1] - out[i0 + 1], out[i2 + 2] - out[i0 + 2]]);
  const l = len3(n);
  if (l < 1e-9) return;
  const k = L.sign[bt / 3] / l;
  const d = (x - bq[0]) * n[0] * k + (y - bq[1]) * n[1] * k + (z - bq[2]) * n[2] * k;
  if (d >= LAYER_GAP) return;
  const c = (LAYER_GAP - d) * k;
  if (L.inside) {
    for (const i of [i0, i1, i2]) { out[i] -= n[0] * c; out[i + 1] -= n[1] * c; out[i + 2] -= n[2] * c; }
    return;
  }
  out[a] += n[0] * c; out[a + 1] += n[1] * c; out[a + 2] += n[2] * c;
}

/** closest point on triangle a b c (particle offsets into P) to (px, py, pz) */
function closestOnTri(P: Float32Array, a: number, b: number, c: number, px: number, py: number, pz: number): V3 {
  const A: V3 = [P[a], P[a + 1], P[a + 2]], B: V3 = [P[b], P[b + 1], P[b + 2]], C: V3 = [P[c], P[c + 1], P[c + 2]], X: V3 = [px, py, pz];
  const ab = sub3(B, A), ac = sub3(C, A), ap = sub3(X, A);
  const d1 = dot3(ab, ap), d2 = dot3(ac, ap);
  if (d1 <= 0 && d2 <= 0) return A;
  const bp = sub3(X, B), d3 = dot3(ab, bp), d4 = dot3(ac, bp);
  if (d3 >= 0 && d4 <= d3) return B;
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return [A[0] + ab[0] * v, A[1] + ab[1] * v, A[2] + ab[2] * v]; }
  const cp = sub3(X, C), d5 = dot3(ab, cp), d6 = dot3(ac, cp);
  if (d6 >= 0 && d5 <= d6) return C;
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return [A[0] + ac[0] * w, A[1] + ac[1] * w, A[2] + ac[2] * w]; }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return [B[0] + (C[0] - B[0]) * w, B[1] + (C[1] - B[1]) * w, B[2] + (C[2] - B[2]) * w]; }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return [A[0] + ab[0] * v + ac[0] * w, A[1] + ab[1] * v + ac[1] * w, A[2] + ab[2] * v + ac[2] * w];
}

function liftOffSkin(G: Garment3D, B: BodyLike, contact: Uint8Array | undefined, out: Float32Array) {
  const t = B.thickness, fl = B.flat, caps = B.useCaps, skin = B.skinning;
  B.thickness = DISPLAY_MARGIN;
  if (fl) B.flat = [-1, -1];
  if (caps !== undefined) B.useCaps = false;
  if (skin !== undefined) B.skinning = true; // the drawn body is skinned: check against exactly that surface
  const hit: Hit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  try {
    // cloth in the crease between the thighs leaves it forward (front legs) or backward (back legs) in the thigh's frame
    if (B.escape && contact) for (const P of G.panels) {
      const dir = P.attach ? 0 : P.piece.role === 'front' ? 1 : P.piece.role === 'back' ? -1 : 0;
      if (!dir) continue;
      const bone = P.mirror ? 7 : 5;
      for (let v = P.offset; v < P.offset + P.mesh.uv.length; v++) if (contact[v] === 2) B.escape(out, v * 3, bone, 0, 0, dir, DISPLAY_MARGIN);
    }
    // distance off the skin per point (cm, up to NEAR; NEAR means further) and the skin normal under it
    const n = G.sim.n, dist = new Float32Array(n).fill(NEAR), nrm = new Float32Array(n * 3), tmp = new Float32Array(3);
    B.thickness = NEAR;
    for (let i = 0; i < n; i++) {
      if (contact && contact[i] === 1) continue;
      const j = i * 3;
      if (B.particle !== undefined) B.particle = i; // soft skin: the dent under this point
      tmp[0] = out[j]; tmp[1] = out[j + 1]; tmp[2] = out[j + 2];
      if (!B.project(tmp, 0, hit)) continue;
      const dx = tmp[0] - out[j], dy = tmp[1] - out[j + 1], dz = tmp[2] - out[j + 2], mv = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (mv < 1e-9) continue;
      nrm[j] = dx / mv; nrm[j + 1] = dy / mv; nrm[j + 2] = dz / mv;
      const d = NEAR - mv;
      if (d >= DISPLAY_MARGIN) { dist[i] = d; continue; }
      // lift to the margin along the way out
      const k = (DISPLAY_MARGIN - d) / mv;
      out[j] += dx * k; out[j + 1] += dy * k; out[j + 2] += dz * k;
      dist[i] = DISPLAY_MARGIN;
      if (contact && contact[i] === 2) {
        // the blended field is shallow where limbs meet (between the thighs): a few more steps reach the drawn surface
        B.thickness = DISPLAY_MARGIN;
        for (let it = 0; it < 8; it++) if (!B.project(out, j, hit)) break;
        B.thickness = NEAR;
      }
    }
    // a flat triangle cuts through a tightly curved body (wrist, heel) between its corners. Over a curve the
    // straight edge dips below its ends by about half its length times tan(a / 4), a = angle between the skin
    // normals at the ends (a circle through both); the centre of a triangle dips about a third more. Where that
    // would bring an edge or centre closer than CHORD_MARGIN, the corners are lifted along their normals.
    const dip = (u: number, v: number) => {
      const c = Math.max(-1, Math.min(1, nrm[u * 3] * nrm[v * 3] + nrm[u * 3 + 1] * nrm[v * 3 + 1] + nrm[u * 3 + 2] * nrm[v * 3 + 2]));
      const L = Math.hypot(out[u * 3] - out[v * 3], out[u * 3 + 1] - out[v * 3 + 1], out[u * 3 + 2] - out[v * 3 + 2]);
      return 1.3 * 0.5 * L * Math.tan(Math.acos(c) / 4); // 30% spare: skin is not a perfect circle
    };
    const raise = (vs: number[], by: number) => {
      for (const v of vs) {
        const j = v * 3;
        out[j] += nrm[j] * by; out[j + 1] += nrm[j + 1] * by; out[j + 2] += nrm[j + 2] * by;
      }
      for (const v of vs) dist[v] += by;
    };
    for (const P of G.panels) {
      const T = P.mesh.tris, o = P.offset;
      for (let t = 0; t < T.length; t += 3) {
        const a = o + T[t], b = o + T[t + 1], c = o + T[t + 2];
        if (dist[a] >= NEAR || dist[b] >= NEAR || dist[c] >= NEAR) continue; // a corner well off the skin
        const sab = dip(a, b), sbc = dip(b, c), sca = dip(c, a);
        const need = CHORD_MARGIN - Math.min((dist[a] + dist[b]) / 2 - sab, (dist[b] + dist[c]) / 2 - sbc, (dist[c] + dist[a]) / 2 - sca, (dist[a] + dist[b] + dist[c]) / 3 - 1.35 * Math.max(sab, sbc, sca));
        if (need > 0) raise([a, b, c], need);
      }
    }
  } finally {
    B.thickness = t;
    if (fl) B.flat = fl;
    if (caps !== undefined) B.useCaps = caps;
    if (skin !== undefined) B.skinning = skin;
    if (B.particle !== undefined) B.particle = -1;
  }
}
