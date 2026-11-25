import type { Piece, SpecDef, GarmentType } from '../data/presets';
import { bbox, dist, samplePoly, sliceSpan, type Pt } from './geometry';

export interface SpecValue {
  label: string;
  value: number; // cm
  a: Pt; // measurement line endpoints, piece-local
  b: Pt;
  vertical?: boolean;
}

export const findTag = (p: Piece, tag: string) => p.points.find((q) => q.tag === tag);

export function computeSpec(p: Piece, s: SpecDef, poly = samplePoly(p.points)): SpecValue | null {
  switch (s.kind) {
    case 'length': {
      const bb = bbox(poly);
      const x = bb.maxX + 5;
      return { label: s.label, value: bb.h, a: { x, y: bb.minY }, b: { x, y: bb.maxY }, vertical: true };
    }
    case 'slice': {
      const t = findTag(p, s.tag);
      if (!t) return null;
      const y = t.y + (s.dy ?? 0);
      const span = sliceSpan(poly, y, t.x);
      if (!span) return null;
      return { label: s.label, value: span.x2 - span.x1, a: { x: span.x1, y }, b: { x: span.x2, y } };
    }
    case 'mirror': {
      const t = findTag(p, s.tag);
      if (!t) return null;
      const m = p.points.find((q) => q.id === t.mirror && q.id !== t.id) ?? p.points.find((q) => q.tag === s.tag && q.id !== t.id);
      if (!m) return null;
      const off = s.off ?? 0;
      return { label: s.label, value: dist(t, m), a: { x: m.x, y: m.y + off }, b: { x: t.x, y: t.y + off } };
    }
    case 'dist': {
      const a = findTag(p, s.tags[0]);
      const b = findTag(p, s.tags[1]);
      if (!a || !b) return null;
      const off = s.off ?? 0;
      return { label: s.label, value: dist(a, b), a: { x: a.x, y: a.y + off }, b: { x: b.x, y: b.y + off } };
    }
    case 'vdist': {
      const a = findTag(p, s.tags[0]);
      const b = findTag(p, s.tags[1]);
      if (!a || !b) return null;
      const x = Math.min(a.x, b.x) - 4;
      return { label: s.label, value: Math.abs(b.y - a.y), a: { x, y: a.y }, b: { x, y: b.y }, vertical: true };
    }
  }
}

export function pieceSpecs(p: Piece): SpecValue[] {
  const poly = samplePoly(p.points);
  return p.specs.map((s) => computeSpec(p, s, poly)).filter((v): v is SpecValue => !!v);
}

/** Finished garment measurements, i.e. what a factory spec sheet lists. */
export function garmentSpecs(type: GarmentType, pieces: Piece[]): { label: string; value: number }[] {
  const get = (role: string, label: string) => {
    const p = pieces.find((q) => q.role === role);
    if (!p) return 0;
    const s = p.specs.find((q) => q.label === label);
    return s ? computeSpec(p, s)?.value ?? 0 : 0;
  };
  if (type === 'pants') {
    return [
      { label: 'Waist circumference', value: 2 * (get('front', 'Waist') + get('back', 'Waist')) },
      { label: 'Hip circumference', value: 2 * (get('front', 'Hip') + get('back', 'Hip')) },
      { label: 'Thigh circumference', value: get('front', 'Thigh') + get('back', 'Thigh') },
      { label: 'Knee circumference', value: get('front', 'Knee') + get('back', 'Knee') },
      { label: 'Leg opening', value: get('front', 'Leg opening') + get('back', 'Leg opening') },
      { label: 'Front rise', value: get('front', 'Rise') },
      { label: 'Back rise', value: get('back', 'Rise') },
      { label: 'Outseam', value: get('front', 'Length') },
    ];
  }
  return [
    { label: 'Chest circumference', value: get('front', 'Chest') + get('back', 'Chest') },
    { label: 'Waist circumference', value: get('front', 'Waist') + get('back', 'Waist') },
    { label: 'Hem circumference', value: get('front', 'Hem') + get('back', 'Hem') },
    { label: 'Shoulder width', value: get('back', 'Shoulder') },
    { label: 'Body length (CB)', value: get('back', 'Length') },
    { label: 'Sleeve length', value: get('sleeve', 'Length') },
    { label: 'Bicep circumference', value: get('sleeve', 'Bicep') },
    { label: 'Cuff opening', value: get('sleeve', 'Cuff') },
  ];
}
