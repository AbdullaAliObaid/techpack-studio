// Clothing tags (Attachment kind 'label'): materials, default size and how each one is sewn on.
// Shared by the simulation (src/sim/setup.ts), the spec sheet (src/lib/specs.ts) and the exports.
// Units: cm, grams per square metre.

import type { Attachment, LabelType } from './edits';
import { nearestOnOutline, type Pt } from '../lib/geometry';
import type { Piece } from './presets';

export interface LabelMaterial {
  /** plain name for the spec sheet and BOM */
  name: string;
  gsm: number;
  /** bending stiffness on the fabric scale (src/data/fabrics.ts: jersey 0.12, canvas 1.0); above 1 is board-like */
  bend: number;
  stretch: number;
  /** bought in finished (moulded or die cut), not cut from a roll: a trim in the BOM, no cut piece in the DXF */
  purchased: boolean;
}

export const LABEL_MATERIAL: Record<LabelType, LabelMaterial> = {
  woven: { name: 'Woven damask', gsm: 200, bend: 0.6, stretch: 0.02, purchased: false },
  printed: { name: 'Printed satin tape', gsm: 90, bend: 0.15, stretch: 0.03, purchased: false },
  satin: { name: 'Satin', gsm: 100, bend: 0.12, stretch: 0.03, purchased: false },
  cotton: { name: 'Cotton twill tape', gsm: 180, bend: 0.35, stretch: 0.03, purchased: false },
  leather: { name: 'Leather', gsm: 900, bend: 1.5, stretch: 0.05, purchased: true },
  rubber: { name: 'Rubber (PVC)', gsm: 1500, bend: 2.5, stretch: 0.08, purchased: true },
};

/** Finished size of a tag when none is set (cm). */
export const LABEL_SIZE = { w: 5, h: 2.5 };
/** A folded loop tag whose open end sits this close to a seam edge (cm) is caught in that seam. */
export const LABEL_SEAM_CATCH = 1.5;

export const labelType = (a: Pick<Attachment, 'label'>): LabelType => a.label?.type ?? 'woven';
export const labelMaterial = (a: Pick<Attachment, 'label'>) => LABEL_MATERIAL[labelType(a)] ?? LABEL_MATERIAL.woven;

/** Finished size of a tag (cm): the attachment's own w x h, or the default 5 x 2.5. */
export function labelSize(a: Pick<Attachment, 'w' | 'h'>): { w: number; h: number } {
  return a.w > 0 && a.h > 0 ? { w: a.w, h: a.h } : { ...LABEL_SIZE };
}

/** One side of a tag's rectangle in its own coords: the unit direction out of that side and the half size across it. */
export interface LabelSide { dir: Pt; half: number; along: number }
const SIDES = (w: number, h: number): LabelSide[] => [
  { dir: { x: 0, y: -1 }, half: h / 2, along: w }, { dir: { x: 0, y: 1 }, half: h / 2, along: w },
  { dir: { x: -1, y: 0 }, half: w / 2, along: h }, { dir: { x: 1, y: 0 }, half: w / 2, along: h },
];

export interface LabelSewing {
  /** how the simulation and the spec sheet treat it */
  method: 'ends' | 'all-round' | 'loop';
  /** folded loop caught in a seam: the open end (a side of the finished rectangle, in the tag's own coords) */
  open?: LabelSide;
  /** distance from the open end to the host's edge (cm) */
  seamDist?: number;
  /** cut length of the strip (cm) along the fold direction and the strip width: a folded loop is cut twice as long */
  cut: { w: number; h: number };
}

/**
 * How a tag is sewn on. 'ends' = stitched across both short ends; 'all-round' = edge stitched all round;
 * 'folded-loop' = cut twice as long, folded in half, the open end caught in a seam: only when that end sits within
 * LABEL_SEAM_CATCH of the host's edge (the side of the tag nearest the edge is the open end), else it is sewn at
 * both ends like 'ends'. host: the host piece (placement x, y, rotation are in its pattern coords).
 */
export function labelSewing(a: Pick<Attachment, 'w' | 'h' | 'x' | 'y' | 'rotation' | 'label'>, host?: Piece): LabelSewing {
  const { w, h } = labelSize(a);
  const sewn = a.label?.sewn ?? 'ends';
  if (sewn === 'all-round') return { method: 'all-round', cut: { w, h } };
  if (sewn === 'folded-loop' && host) {
    const c = Math.cos((a.rotation * Math.PI) / 180), s = Math.sin((a.rotation * Math.PI) / 180);
    let best: { side: LabelSide; d: number } | null = null;
    for (const side of SIDES(w, h)) {
      const q = { x: side.dir.x * side.half, y: side.dir.y * side.half };
      const hp = { x: a.x + q.x * c - q.y * s, y: a.y + q.x * s + q.y * c };
      const d = nearestOnOutline(host.points, hp).d;
      if (!best || d < best.d) best = { side, d };
    }
    if (best && best.d <= LABEL_SEAM_CATCH) {
      const across = best.side.dir.x ? { w: 2 * w, h } : { w, h: 2 * h };
      return { method: 'loop', open: best.side, seamDist: best.d, cut: across };
    }
  }
  return { method: 'ends', cut: { w, h } };
}
