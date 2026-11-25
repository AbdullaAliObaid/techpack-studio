import { bbox, type PPoint, type Pt } from '../lib/geometry';
import { uid } from '../lib/units';
import { draft, type Fit } from './draft';
import { DEFAULT_BODY, type Body } from '../three/body';

export type GarmentType = 'jacket' | 'shirt' | 'pants';
export type Role = 'front' | 'back' | 'sleeve' | 'collar' | 'cuff' | 'waistband';

export type SpecDef =
  | { label: string; kind: 'slice'; tag: string; dy?: number }
  | { label: string; kind: 'mirror'; tag: string; off?: number }
  | { label: string; kind: 'dist'; tags: [string, string]; off?: number }
  | { label: string; kind: 'vdist'; tags: [string, string] }
  | { label: string; kind: 'length' };

export interface PieceFabric {
  id: string;
  color: number;
}

export interface Piece {
  id: string;
  name: string;
  role: Role;
  cut: number;
  offset: Pt;
  symmetric: boolean;
  points: PPoint[];
  fabric: PieceFabric;
  specs: SpecDef[];
}

const TOP_SPECS: SpecDef[] = [
  { label: 'Shoulder', kind: 'mirror', tag: 'shoulder', off: -3 },
  { label: 'Chest', kind: 'slice', tag: 'underarm' },
  { label: 'Waist', kind: 'slice', tag: 'waist' },
  { label: 'Hem', kind: 'mirror', tag: 'hem', off: 3.5 },
  { label: 'Length', kind: 'length' },
];

const SLEEVE_SPECS: SpecDef[] = [
  { label: 'Bicep', kind: 'mirror', tag: 'underarm', off: 0 },
  { label: 'Cuff', kind: 'mirror', tag: 'cuff', off: 3.5 },
  { label: 'Length', kind: 'length' },
];

const LEG_SPECS: SpecDef[] = [
  { label: 'Waist', kind: 'dist', tags: ['waistC', 'waistS'], off: -3 },
  { label: 'Hip', kind: 'slice', tag: 'hip' },
  { label: 'Thigh', kind: 'slice', tag: 'crotch', dy: 3 },
  { label: 'Knee', kind: 'slice', tag: 'knee' },
  { label: 'Leg opening', kind: 'mirror', tag: 'hem', off: 3.5 },
  { label: 'Rise', kind: 'vdist', tags: ['waistC', 'crotch'] },
  { label: 'Inseam', kind: 'vdist', tags: ['crotch', 'hem'] },
  { label: 'Length', kind: 'length' },
];

const META: Record<GarmentType, { role: Role; name: string; cut: number; specs: SpecDef[] }[]> = {
  jacket: [
    { role: 'front', name: 'Front', cut: 1, specs: TOP_SPECS },
    { role: 'back', name: 'Back', cut: 1, specs: TOP_SPECS },
    { role: 'sleeve', name: 'Sleeve', cut: 2, specs: SLEEVE_SPECS },
    { role: 'collar', name: 'Collar', cut: 2, specs: [{ label: 'Collar length', kind: 'mirror', tag: 'tip', off: -2.5 }] },
  ],
  shirt: [
    { role: 'front', name: 'Front', cut: 1, specs: TOP_SPECS },
    { role: 'back', name: 'Back', cut: 1, specs: TOP_SPECS },
    { role: 'sleeve', name: 'Sleeve', cut: 2, specs: SLEEVE_SPECS },
    { role: 'collar', name: 'Collar', cut: 2, specs: [{ label: 'Collar length', kind: 'mirror', tag: 'tip', off: -2.5 }] },
    { role: 'cuff', name: 'Cuff', cut: 2, specs: [{ label: 'Cuff length', kind: 'mirror', tag: 'c', off: -3 }] },
  ],
  pants: [
    { role: 'front', name: 'Front leg', cut: 2, specs: LEG_SPECS },
    { role: 'back', name: 'Back leg', cut: 2, specs: LEG_SPECS },
    { role: 'waistband', name: 'Waistband', cut: 1, specs: [{ label: 'Waistband', kind: 'mirror', tag: 'wb', off: -3 }] },
  ],
};

const DEFAULT_FABRIC: Record<GarmentType, string> = { jacket: 'canvas', shirt: 'poplin', pants: 'denim' };

/** Lay pieces out left to right in rows so nothing overlaps. */
function layout(pieces: Piece[], maxRow = 150) {
  let x = 10, y = 10, rowH = 0;
  for (const p of pieces) {
    const bb = bbox(p.points);
    if (x > 10 && x + bb.w > maxRow) { x = 10; y += rowH + 22; rowH = 0; }
    p.offset = { x: x - bb.minX, y: y - bb.minY };
    x += bb.w + 18;
    rowH = Math.max(rowH, bb.h);
  }
}

/** A preset is a draft from the body plus garment metadata. */
export function makePreset(type: GarmentType, body: Body = DEFAULT_BODY, fit: Fit = 'regular'): Piece[] {
  const drafted = draft(type, body, fit);
  const pieces = META[type].map((m) => {
    const d = drafted.find((q) => q.role === m.role)!;
    return { id: uid(), name: m.name, role: m.role, cut: m.cut, offset: { x: 0, y: 0 }, symmetric: true, fabric: { id: DEFAULT_FABRIC[type], color: 0 }, specs: m.specs, points: d.points };
  });
  layout(pieces, type === 'pants' ? 120 : 140);
  return pieces;
}

export const GARMENT_LABEL: Record<GarmentType, string> = { jacket: 'Jacket', shirt: 'Shirt', pants: 'Pants' };
