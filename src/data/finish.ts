// Finish: wash and distress edits (Edits.finish). Pure helpers for the store, the 3D view, the chart and the tech pack.
// Strokes live in each piece's own pattern space as flat cm pairs, so a mask follows its piece and costs a few bytes.

import type { DistressKind, FinishKind, FinishStroke, GarmentFinish, PieceFinish, WashKind, WashPreset } from './edits';
import type { Piece } from './presets';
import type { StyleId } from './catalog';
import { instanceCount, instanceLabel } from '../sim/seams';

export const WASH_KINDS: WashKind[] = ['acid', 'bleach', 'fade', 'stone'];
export const DISTRESS_KINDS: DistressKind[] = ['fray', 'whiskers', 'honeycomb', 'abrasion', 'rip', 'hole'];

export interface KindInfo { label: string; /** name a factory knows the process by */ process: string; hint: string; /** chart colour (light on dark cloth) */ tone: string; defaultR: number }
export const KIND: Record<FinishKind, KindInfo> = {
  acid: { label: 'Acid wash', process: 'Acid wash (pumice stone soaked in chlorine, marbled)', hint: 'Marbled light and dark blotches', tone: '#e8eef8', defaultR: 6 },
  bleach: { label: 'Bleach', process: 'Bleach spray or splash, rinsed and neutralised', hint: 'Strong, patchy lightening', tone: '#ffffff', defaultR: 5 },
  fade: { label: 'Fade', process: 'Enzyme and pumice fade, soft overall lightening', hint: 'Soft, even lightening', tone: '#d7e3f5', defaultR: 8 },
  stone: { label: 'Stone wash', process: 'Stone wash (pumice tumble), speckled wear', hint: 'Fine speckle and slub wear', tone: '#c9d6ea', defaultR: 7 },
  fray: { label: 'Fray', process: 'Hand fray or grinding at the edge, loose threads', hint: 'Loose threads along an edge or hem', tone: '#f3e9d2', defaultR: 1 },
  whiskers: { label: 'Whiskers', process: 'Whiskers (laser or hand sanded creases, hip and thigh)', hint: 'Sanded crease lines at the hip', tone: '#f5f7fb', defaultR: 5 },
  honeycomb: { label: 'Honeycombs', process: 'Honeycombs (laser or hand sanded creases, behind the knee)', hint: 'Crease marks behind the knee', tone: '#f5f7fb', defaultR: 5 },
  abrasion: { label: 'Abrasion', process: 'Hand sanding / grinding abrasion, worn through to the weft', hint: 'Rough worn patch', tone: '#f1f4fa', defaultR: 3 },
  rip: { label: 'Rip', process: 'Rip and repair: cut slit, frayed edges (backing optional)', hint: 'A frayed slit, drag to set its length', tone: '#2a2f3a', defaultR: 1.2 },
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
  if (!e || !st || st.k === 'hole' || st.p.length >= MAX_PTS * 2) return f;
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
  return { where: `${r1(cy - top)} cm below the top edge, ${r1(bottom - cy)} cm above the lower edge, ${r1(Math.abs(cx))} cm ${cx >= 0 ? 'right' : 'left'} of the centre line (piece pattern)`, w: x1 - x0, h: y1 - y0 };
}

/** One row per process and piece copy for the wash and distress page, numbered, plus the global wash first. */
export function finishRows(style: StyleId | undefined, pieces: Piece[], f?: GarmentFinish): FinishRow[] {
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
        area: k === 'hole' ? `${list.length} hole${list.length > 1 ? 's' : ''}, about ${r1(Math.max(...list.map((s) => s.r)) * 2)} cm across` : `about ${Math.round(area)} cm2 in ${list.length} stroke${list.length > 1 ? 's' : ''}`,
        strength: strengthName(avgS),
      });
    }
  }
  return rows;
}
