// Finish: wash and distress edits (Edits.finish). Pure helpers for the store, the 3D view, the chart and the tech pack.
// Strokes live in each piece's own pattern space as flat cm pairs, so a mask follows its piece and costs a few bytes.

import type { DistressKind, FinishKind, FinishStroke, GarmentFinish, PieceFinish, WashKind, WashPreset } from './edits';
import type { Piece } from './presets';
import { styleById, type StyleId } from './catalog';
import { instanceCount, instanceLabel } from '../sim/seams';
import { sliceX, samplePoly } from '../lib/geometry';
import { fabricById } from './fabrics';
import type { Attachment } from './edits';

export const WASH_KINDS: WashKind[] = ['stone', 'acid', 'bleach', 'fade', 'sunfade', 'armpit', 'splatter', 'paint'];
export const DISTRESS_KINDS: DistressKind[] = ['fray', 'rawhem', 'whiskers', 'honeycomb', 'abrasion', 'elbow', 'ribwear', 'pilling', 'pinhole', 'crack', 'hole', 'rip'];
export const ALL_KINDS: FinishKind[] = [...WASH_KINDS, ...DISTRESS_KINDS];
/** every tool works on every garment; a tool only has a typical place (see typicalSpots), never a restriction */
export const kindAllowed = (_k: FinishKind, _style?: StyleId) => true;

export interface KindInfo { label: string; /** name a factory knows the process by */ process: string; hint: string; /** chart colour (light on dark cloth) */ tone: string; defaultR: number }
export const KIND: Record<FinishKind, KindInfo> = {
  acid: { label: 'Acid wash', process: 'Acid wash (pumice stone soaked in chlorine, marbled)', hint: 'Marbled light and dark blotches', tone: '#e8eef8', defaultR: 6 },
  bleach: { label: 'Bleach', process: 'Bleach spray or splash, rinsed and neutralised', hint: 'Strong, patchy lightening', tone: '#ffffff', defaultR: 5 },
  fade: { label: 'Fade', process: 'Enzyme and pumice fade, soft overall lightening', hint: 'Soft, even lightening', tone: '#d7e3f5', defaultR: 8 },
  stone: { label: 'Stone wash', process: 'Stone wash (pumice tumble), speckled wear', hint: 'Fine speckle and slub wear', tone: '#c9d6ea', defaultR: 7 },
  fray: { label: 'Edge fray', process: 'Hand fray or grinding at the edge, loose threads', hint: 'Loose threads along an edge: collar, placket, cuff, hem', tone: '#f3e9d2', defaultR: 1 },
  whiskers: { label: 'Whiskers', process: 'Whiskers (laser or hand sanded creases, hip and thigh)', hint: 'Sanded crease lines at the hip', tone: '#f5f7fb', defaultR: 5 },
  honeycomb: { label: 'Honeycombs', process: 'Honeycombs (laser or hand sanded creases, behind the knee)', hint: 'Crease marks behind the knee', tone: '#f5f7fb', defaultR: 5 },
  abrasion: { label: 'Abrasion', process: 'Hand sanding / grinding abrasion, worn through to the weft', hint: 'Rough worn patch', tone: '#f1f4fa', defaultR: 3 },
  rip: { label: 'Rip', process: 'Rip and repair: cut slit, frayed edges (backing optional)', hint: 'A frayed slit, drag to set its length', tone: '#2a2f3a', defaultR: 1.2 },
  sunfade: { label: 'Sun fade', process: 'Sun fade: pigment fading on the shoulders and chest, hand sprayed or sanded', hint: 'Soft, wide fading where the sun hits', tone: '#d9dfe8', defaultR: 9 },
  armpit: { label: 'Armpit fade', process: 'Underarm fade: sweat and wear bleaching, hand sprayed', hint: 'Soft pale patch under the arm', tone: '#d9dfe8', defaultR: 5 },
  splatter: { label: 'Bleach splatter', process: 'Bleach splatter: spots and flecks flicked on by hand, rinsed and neutralised', hint: 'Small bleached spots and flecks', tone: '#ffffff', defaultR: 6 },
  paint: { label: 'Paint splatter', process: 'Paint splatter: pigment spots flicked on by hand, heat set', hint: 'Small paint spots and drips', tone: '#e8c8a0', defaultR: 6 },
  rawhem: { label: 'Raw hem', process: 'Raw cut hem: unfinished edge that curls and sheds loose threads after wash', hint: 'A cut edge that curls and frays, along a hem', tone: '#f3e9d2', defaultR: 1 },
  elbow: { label: 'Elbow wear', process: 'Elbow wear: sanded and faded patch with fine pilling', hint: 'Worn, faded patch with rough pile', tone: '#e4e8ef', defaultR: 4 },
  ribwear: { label: 'Rib wear and stretch', process: 'Rib wear: stretched, wavy and faded neckband or cuff rib', hint: 'Faded, rippled rib at the neckline or cuff', tone: '#dfe3ea', defaultR: 2 },
  pilling: { label: 'Pilling', process: 'Pilling: small fibre balls where the cloth rubs, sides, underarm, cuffs', hint: 'Tiny fibre balls on the surface', tone: '#eef0f4', defaultR: 4 },
  pinhole: { label: 'Pin holes', process: 'Pin holes: small punched holes scattered by hand, edges frayed', hint: 'Small scattered holes, click to place', tone: '#2a2f3a', defaultR: 0.35 },
  crack: { label: 'Cracked print', process: 'Cracked and faded print: ink crazed by wash and wear', hint: 'Cracks and fading in a print or embroidery', tone: '#e8e8e8', defaultR: 6 },
  hole: { label: 'Hole', process: 'Punched or cut hole with frayed edge', hint: 'A cut through hole, click to place', tone: '#2a2f3a', defaultR: 1.8 },
};

export const PRESET_INFO: Record<Exclude<WashPreset, 'none'>, { label: string; process: string }> = {
  light: { label: 'Light wash', process: 'Enzyme + pumice, long cycle, strong lightening' },
  mid: { label: 'Mid wash', process: 'Enzyme wash, medium cycle, soft lightening' },
  dark: { label: 'Dark wash', process: 'Rinse wash, short cycle, colour kept deep' },
  vintage: { label: 'Vintage', process: 'Stone + enzyme wash with overdye tint, worn look' },
};

export const EMPTY_FINISH: GarmentFinish = { preset: 'none', pieces: [] };
export const hasFinish = (f?: GarmentFinish) => !!f && (f.preset !== 'none' || f.pieces.some((p) => p.strokes.length > 0));
export const strokeCount = (f?: GarmentFinish) => (f?.pieces ?? []).reduce((n, p) => n + p.strokes.length, 0);

const q = (v: number) => Math.round(v * 10) / 10;
/** a new stroke starting at (x, y) */
export const newStroke = (k: FinishKind, r: number, s: number, x: number, y: number): FinishStroke => ({ k, p: [q(x), q(y)], r: q(r), s: Math.round(s * 100) / 100 });
const MAX_PTS = 400;

/** add a stroke to a piece (copy), merging into that piece's entry */
export function addStroke(f: GarmentFinish | undefined, pieceId: string, instance: number | undefined, st: FinishStroke): GarmentFinish {
  const base = f ?? EMPTY_FINISH;
  const has = base.pieces.some((p) => p.pieceId === pieceId && p.instance === instance);
  const pieces: PieceFinish[] = has
    ? base.pieces.map((p) => (p.pieceId === pieceId && p.instance === instance ? { ...p, strokes: [...p.strokes, st] } : p))
    : [...base.pieces, { pieceId, ...(instance !== undefined ? { instance } : {}), strokes: [st] }];
  return { ...base, pieces };
}

/** extend the last stroke of a piece (copy) with a point, when it moved far enough */
export function extendStroke(f: GarmentFinish | undefined, pieceId: string, instance: number | undefined, x: number, y: number): GarmentFinish | undefined {
  if (!f) return f;
  const e = f.pieces.find((p) => p.pieceId === pieceId && p.instance === instance);
  const st = e?.strokes[e.strokes.length - 1];
  if (!e || !st || st.k === 'hole' || st.k === 'pinhole' || st.p.length >= MAX_PTS * 2) return f;
  const lx = st.p[st.p.length - 2], ly = st.p[st.p.length - 1];
  if (Math.hypot(x - lx, y - ly) < Math.max(0.3, st.r * 0.35)) return f;
  const next = { ...st, p: [...st.p, q(x), q(y)] };
  return { ...f, pieces: f.pieces.map((p) => (p === e ? { ...p, strokes: [...p.strokes.slice(0, -1), next] } : p)) };
}

/** drop the last stroke on a piece copy, or every stroke when no id is given */
export function removeLast(f: GarmentFinish | undefined): GarmentFinish | undefined {
  if (!f) return f;
  const idx = [...f.pieces.keys()].reverse().find((i) => f.pieces[i].strokes.length);
  if (idx === undefined) return f;
  return { ...f, pieces: f.pieces.map((p, i) => (i === idx ? { ...p, strokes: p.strokes.slice(0, -1) } : p)).filter((p) => p.strokes.length) };
}

/** the strokes that apply to one placed copy of a piece */
export function strokesFor(f: GarmentFinish | undefined, pieceId: string, instance: number): FinishStroke[] {
  return (f?.pieces ?? []).filter((p) => p.pieceId === pieceId && (p.instance === undefined || p.instance === instance)).flatMap((p) => p.strokes);
}

/** polyline of a stroke as points */
export const strokePts = (s: FinishStroke): { x: number; y: number }[] => Array.from({ length: Math.floor(s.p.length / 2) }, (_, i) => ({ x: s.p[i * 2], y: s.p[i * 2 + 1] }));

/** tiny deterministic random from a stroke's coordinates, so a stroke always looks the same */
export function seedOf(s: FinishStroke, salt = 0): () => number {
  let h = (2166136261 ^ salt) >>> 0;
  for (const v of s.p) h = Math.imul(h ^ Math.round(v * 10), 16777619) >>> 0;
  h = (h || 1) % 2147483647;
  return () => ((h = (h * 16807) % 2147483647) - 1) / 2147483646;
}

/* ---------- typical places ---------- */

/** how the cloth reads when washed: denim, knit (cotton jersey, rib, fleece) or woven */
export function washFamily(fabricId: string): 'denim' | 'knit' | 'woven' {
  const f = fabricById(fabricId);
  if (f.category === 'denim') return 'denim';
  if (f.category === 'knits') return 'knit';
  return 'woven';
}

export interface Spot { pieceId: string; stroke: FinishStroke }
const HIDDEN = new Set(['facing', 'pocketFacing', 'pocketBag', 'flyFacing', 'flyShield']);
const BODY = new Set(['front', 'back', 'sleeve', 'collar', 'cuff', 'neckband', 'placket', 'waistband']);

/**
 * Where a tool normally goes on this garment, as strokes in each piece's own pattern space. Every tool can be brushed
 * anywhere; this only fills in the usual places (whiskers on the hips and top of the thighs, honeycombs behind the knee, ...).
 * An empty list means the tool has no usual place on this garment.
 */
export function typicalSpots(k: FinishKind, style: StyleId | undefined, pieces: Piece[], attachments: Attachment[] = []): Spot[] {
  const bottoms = !!style && styleById(style).category === 'bottoms';
  const out: Spot[] = [];
  const add = (pieceId: string, pts: number[], r = KIND[k].defaultR, s = 0.7) => out.push({ pieceId, stroke: { k, p: pts.map(q), r, s } });
  for (const pc of pieces) {
    if (HIDDEN.has(pc.role) || !BODY.has(pc.role) || pc.splitOf) continue;
    const poly = samplePoly(pc.points, 12);
    const ys = poly.map((a) => a.y), top = Math.min(...ys), bot = Math.max(...ys), H = bot - top;
    const span = (f: number): [number, number] => { const xs = sliceX(poly, top + H * f); return xs.length ? [xs[0], xs[xs.length - 1]] : [0, 0]; };
    const row = (f: number, a = 0, b = 1) => { const [x0, x1] = span(f), w = x1 - x0; return [x0 + w * a, top + H * f, x0 + w * b, top + H * f]; };
    const edgeAt = (f: number, inset: number) => { const [x0, x1] = span(f); return { x0: x0 + inset, x1: x1 - inset, y: top + H * f }; };
    const body = pc.role === 'front' || pc.role === 'back';
    const leg = bottoms && body;
    const hemY = (inset = 0.4) => { const [x0, x1] = span(0.985); return [x0 + inset, bot - 0.5, x1 - inset, bot - 0.5]; };
    switch (k) {
      case 'whiskers': if (leg && pc.role === 'front') add(pc.id, row(0.12, 0.2, 0.7)); else if (!bottoms && body && pc.role === 'front') { const e = edgeAt(0.72, 3); add(pc.id, [e.x0, e.y, e.x0 + 7, e.y - 1]); add(pc.id, [e.x1, e.y, e.x1 - 7, e.y - 1]); } break;
      case 'honeycomb': if (leg && pc.role === 'back') { const [x0, x1] = span(0.5); add(pc.id, [(x0 + x1) / 2, top + H * 0.5]); } else if (!bottoms && pc.role === 'sleeve') { const [x0, x1] = span(0.55); add(pc.id, [(x0 + x1) / 2, top + H * 0.55]); } break;
      case 'abrasion': if (leg) { const [a, b] = span(0.22); add(pc.id, [(a + b) / 2, top + H * 0.22]); const [c, d] = span(0.5); add(pc.id, [(c + d) / 2, top + H * 0.5], 3.5); } else if (body && pc.role === 'front') { const [a, b] = span(0.9); add(pc.id, [a + (b - a) * 0.2, top + H * 0.9], 3); add(pc.id, [a + (b - a) * 0.8, top + H * 0.9], 3); } break;
      case 'fray': case 'rawhem': if (pc.role === 'collar' || pc.role === 'placket' || pc.role === 'cuff' || pc.role === 'neckband') { if (k === 'fray') { const [x0, x1] = span(0.5); add(pc.id, [x0, top + H, x1, top + H], 1, 0.6); } } else if (body || pc.role === 'sleeve') add(pc.id, hemY(), 1, k === 'rawhem' ? 0.8 : 0.6); break;
      case 'ribwear': if (pc.role === 'neckband' || pc.role === 'collar' || pc.role === 'cuff') { const [x0, x1] = span(0.5); add(pc.id, [x0, top + H / 2, x1, top + H / 2], Math.max(1, H * 0.6), 0.7); } else if (!bottoms && body) { const [x0, x1] = span(0.02); add(pc.id, [x0 + (x1 - x0) * 0.3, top + 1.5, x0 + (x1 - x0) * 0.7, top + 1.5], 2, 0.6); } break;
      case 'sunfade': if (!bottoms && (body || pc.role === 'sleeve')) { const [x0, x1] = span(0.06); add(pc.id, [x0 + (x1 - x0) * 0.2, top + H * 0.08, x0 + (x1 - x0) * 0.8, top + H * 0.08], 8, 0.55); } else if (leg && pc.role === 'front') add(pc.id, row(0.3, 0.3, 0.7), 8, 0.5); break;
      case 'armpit': if (!bottoms && body) { const e = edgeAt(0.28, 2.5); add(pc.id, [e.x0, e.y]); add(pc.id, [e.x1, e.y]); } else if (!bottoms && pc.role === 'sleeve') { const e = edgeAt(0.8, 3); add(pc.id, [e.x0, e.y]); add(pc.id, [e.x1, e.y]); } break;
      case 'elbow': if (pc.role === 'sleeve' && H > 40) { const [x0, x1] = span(0.55); add(pc.id, [(x0 + x1) / 2, top + H * 0.55]); } else if (leg) { const [x0, x1] = span(0.5); add(pc.id, [(x0 + x1) / 2, top + H * 0.5], 5); } break;
      case 'pilling': if (!bottoms && body) { const e = edgeAt(0.4, 4); add(pc.id, [e.x0, e.y - 3, e.x0, e.y + 5], 4); add(pc.id, [e.x1, e.y - 3, e.x1, e.y + 5], 4); } else if (!bottoms && pc.role === 'sleeve') { const e = edgeAt(0.8, 4); add(pc.id, [e.x0, e.y, e.x1, e.y], 3); } else if (leg) { const [x0, x1] = span(0.35); add(pc.id, [x0 + 3, top + H * 0.35, x1 - 3, top + H * 0.35], 4); } break;
      case 'pinhole': if (body && pc.role === 'front') { const [x0, x1] = span(0.3), w = x1 - x0; add(pc.id, [x0 + w * 0.35, top + H * 0.32]); add(pc.id, [x0 + w * 0.5, top + H * 0.36]); add(pc.id, [x0 + w * 0.62, top + H * 0.3]); } break;
      case 'hole': if (body && pc.role === 'front') { const [x0, x1] = span(0.78); add(pc.id, [x0 + (x1 - x0) * 0.3, top + H * (leg ? 0.48 : 0.78)], 1.8, 0.8); } break;
      case 'rip': if (leg && pc.role === 'front') { const [x0, x1] = span(0.48), w = x1 - x0; add(pc.id, [x0 + w * 0.25, top + H * 0.47, x0 + w * 0.75, top + H * 0.5], 1.2, 0.8); } else if (!bottoms && pc.role === 'front') { const [x0, x1] = span(0.8), w = x1 - x0; add(pc.id, [x0 + w * 0.3, top + H * 0.8, x0 + w * 0.55, top + H * 0.82], 1.2, 0.7); } break;
      case 'splatter': case 'paint': if (body && pc.role === 'front') { const [x0, x1] = span(0.45), w = x1 - x0; add(pc.id, [x0 + w * 0.3, top + H * (leg ? 0.7 : 0.55), x0 + w * 0.7, top + H * (leg ? 0.8 : 0.62)], 7, 0.7); } break;
      case 'stone': case 'acid': case 'bleach': case 'fade': if (body || pc.role === 'sleeve') { const [x0, x1] = span(0.5), w = x1 - x0; add(pc.id, [x0 + w * 0.25, top + H * 0.3, x0 + w * 0.75, top + H * 0.6], KIND[k].defaultR + 3, 0.6); } break;
      default: break;
    }
  }
  if (k === 'crack') for (const a of attachments) if ((a.kind === 'print' || a.kind === 'embroidery') && !a.afterWash && (a.face ?? 'outside') === 'outside') out.push({ pieceId: a.pieceId, stroke: { k, p: [q(a.x), q(a.y)], r: q(Math.max(a.w, a.h) * 0.6), s: 0.7 } });
  return out;
}

/** add a list of spots to the finish (copy) */
export function addSpots(f: GarmentFinish | undefined, spots: Spot[]): GarmentFinish {
  let out = f ?? EMPTY_FINISH;
  for (const sp of spots) out = addStroke(out, sp.pieceId, undefined, sp.stroke);
  return out;
}

/* ---------- tech pack ---------- */

export interface FinishRow { no: number; process: string; where: string; area: string; strength: string; kind: FinishKind | 'preset' }
const r1 = (v: number) => Math.round(v * 10) / 10;
const strengthName = (s: number) => (s < 0.34 ? 'light' : s < 0.67 ? 'medium' : 'heavy');

/** where on the piece a stroke sits, in words and cm from the piece's top and centre line */
function placeWords(p: Piece, st: FinishStroke): { where: string; w: number; h: number } {
  const pts = strokePts(st);
  const xs = pts.map((a) => a.x), ys = pts.map((a) => a.y);
  const pad = st.k === 'hole' ? st.r : st.r;
  const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
  const top = Math.min(...p.points.map((a) => a.y)), bottom = Math.max(...p.points.map((a) => a.y));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const band = (cy - top) / Math.max(1e-6, bottom - top);
  const zone = band > 0.94 ? 'at the hem' : band < 0.08 ? 'at the top edge' : band < 0.34 ? 'upper third' : band < 0.67 ? 'middle third' : 'lower third';
  return { where: `${zone}, ${r1(cy - top)} cm below the top edge, ${r1(bottom - cy)} cm above the lower edge, ${r1(Math.abs(cx))} cm ${cx >= 0 ? 'right' : 'left'} of the centre line (piece pattern)`, w: x1 - x0, h: y1 - y0 };
}

/** One row per process and piece copy for the wash and distress page, numbered, plus the global wash first. */
export function finishRows(style: StyleId | undefined, pieces: Piece[], f?: GarmentFinish, attachments: Attachment[] = []): FinishRow[] {
  if (!hasFinish(f)) return [];
  const rows: FinishRow[] = [];
  if (f!.preset !== 'none') {
    const info = PRESET_INFO[f!.preset];
    rows.push({ no: 1, process: `${info.label}: ${info.process}`, where: 'Whole garment', area: 'All pieces', strength: strengthName(f!.presetStrength ?? 1), kind: 'preset' });
  }
  for (const pf of f!.pieces) {
    const piece = pieces.find((p) => p.id === pf.pieceId);
    if (!piece) continue;
    const side = style && instanceCount(style, piece) > 1 ? instanceLabel(style, piece, pf.instance) : piece.name;
    for (const k of [...WASH_KINDS, ...DISTRESS_KINDS]) {
      const list = pf.strokes.filter((s) => s.k === k);
      if (!list.length) continue;
      const per = list.map((s) => placeWords(piece, s));
      const area = per.reduce((a, b) => a + b.w * b.h, 0);
      const avgS = list.reduce((a, s) => a + s.s, 0) / list.length;
      rows.push({
        no: rows.length + 1, process: KIND[k].process, kind: k,
        where: `${side}${list.length > 1 ? `, ${list.length} marks` : ''}: ${per.slice(0, 3).map((a) => a.where).join('; ')}${list.length > 3 ? '; more' : ''}`,
        area: k === 'hole' || k === 'pinhole' ? `${list.length} hole${list.length > 1 ? 's' : ''}, about ${r1(Math.max(...list.map((s) => s.r)) * 2)} cm across` : `about ${Math.round(area)} cm2 in ${list.length} stroke${list.length > 1 ? 's' : ''}`,
        strength: strengthName(avgS),
      });
    }
  }
  const after = attachments.filter((a) => a.afterWash && ['print', 'embroidery', 'applique', 'patch', 'label'].includes(a.kind));
  if (after.length) rows.push({ no: rows.length + 1, process: 'Added after the wash (not washed)', kind: 'preset', where: after.map((a) => a.name).join(', '), area: `${after.length} item${after.length > 1 ? 's' : ''}`, strength: 'none' });
  const washed = attachments.filter((a) => !a.afterWash && ['print', 'embroidery'].includes(a.kind));
  if (washed.length && rows.length) rows.push({ no: rows.length + 1, process: 'Prints and embroidery go through the wash: prints crack and fade, thread fades a little', kind: 'preset', where: washed.map((a) => a.name).join(', '), area: `${washed.length} item${washed.length > 1 ? 's' : ''}`, strength: 'as the wash' });
  return rows;
}
