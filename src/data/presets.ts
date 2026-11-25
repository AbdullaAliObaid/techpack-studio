import type { PPoint, Pt } from '../lib/geometry';
import { uid } from '../lib/units';

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

// [x, y, smooth?, tag?]
type H = [number, number, boolean?, string?];
// [x, y, smooth?, tag?, pairKey?]
type C = [number, number, boolean?, string?, string?];

/** Build a full symmetric outline from its right half (first and last points sit on the x = 0 axis). */
function fromHalf(half: H[]): PPoint[] {
  const right: PPoint[] = half.map(([x, y, s, tag]) => ({ id: uid(), x, y, smooth: !!s, mirror: null, tag }));
  const out = [...right];
  for (let i = half.length - 2; i >= 1; i--) {
    const r = right[i];
    const m: PPoint = { id: uid(), x: -r.x, y: r.y, smooth: r.smooth, mirror: r.id, tag: r.tag };
    r.mirror = m.id;
    out.push(m);
  }
  right[0].mirror = right[0].id;
  right[right.length - 1].mirror = right[right.length - 1].id;
  return out;
}

/** Free-form outline; points sharing a pairKey mirror each other across x = 0 (the grainline). */
function custom(list: C[]): PPoint[] {
  const pts: PPoint[] = list.map(([x, y, s, tag]) => ({ id: uid(), x, y, smooth: !!s, mirror: null, tag }));
  const byKey: Record<string, PPoint[]> = {};
  list.forEach((c, i) => {
    if (c[4]) (byKey[c[4]] ??= []).push(pts[i]);
  });
  for (const pair of Object.values(byKey)) {
    if (pair.length === 2) {
      pair[0].mirror = pair[1].id;
      pair[1].mirror = pair[0].id;
    }
  }
  return pts;
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
  { label: 'Length', kind: 'length' },
];

function piece(p: Omit<Piece, 'id'>): Piece {
  return { id: uid(), ...p };
}

export function makePreset(type: GarmentType): Piece[] {
  if (type === 'jacket') {
    const fab = { id: 'canvas', color: 0 };
    return [
      piece({
        name: 'Front', role: 'front', cut: 1, offset: { x: 40, y: 12 }, symmetric: true, fabric: { ...fab }, specs: TOP_SPECS,
        points: fromHalf([[0, 9, true], [4.5, 7.2, true], [8.5, 0], [23.5, 4.5, false, 'shoulder'], [22, 13, true], [27, 24, false, 'underarm'], [24.5, 44, true, 'waist'], [28, 70, false, 'hem'], [0, 70]]),
      }),
      piece({
        name: 'Back', role: 'back', cut: 1, offset: { x: 110, y: 12 }, symmetric: true, fabric: { ...fab }, specs: TOP_SPECS,
        points: fromHalf([[0, 2, true], [4.5, 1.6, true], [8.5, 0], [23.5, 4.5, false, 'shoulder'], [22.5, 13, true], [27, 24, false, 'underarm'], [24.5, 44, true, 'waist'], [28, 70, false, 'hem'], [0, 70]]),
      }),
      piece({
        name: 'Sleeve', role: 'sleeve', cut: 2, offset: { x: 40, y: 100 }, symmetric: true, fabric: { ...fab }, specs: SLEEVE_SPECS,
        points: fromHalf([[0, 0, true], [7, 1.8, true], [14, 7, true], [21, 15, false, 'underarm'], [16.5, 64, false, 'cuff'], [0, 64]]),
      }),
      piece({
        name: 'Collar', role: 'collar', cut: 2, offset: { x: 110, y: 100 }, symmetric: true, fabric: { ...fab },
        specs: [{ label: 'Collar length', kind: 'mirror', tag: 'tip', off: 3.5 }],
        points: fromHalf([[0, 0, true], [22, 1.5], [23, 8, false, 'tip'], [0, 7, true]]),
      }),
    ];
  }
  if (type === 'shirt') {
    const fab = { id: 'poplin', color: 0 };
    return [
      piece({
        name: 'Front', role: 'front', cut: 1, offset: { x: 40, y: 12 }, symmetric: true, fabric: { ...fab }, specs: TOP_SPECS,
        points: fromHalf([[0, 8.5, true], [4.5, 7, true], [7.5, 0], [23, 4, false, 'shoulder'], [21.5, 12, true], [27.5, 23, false, 'underarm'], [25, 42, true, 'waist'], [26.5, 68, false, 'hem'], [13, 72.5, true], [0, 74, true]]),
      }),
      piece({
        name: 'Back', role: 'back', cut: 1, offset: { x: 110, y: 12 }, symmetric: true, fabric: { ...fab }, specs: TOP_SPECS,
        points: fromHalf([[0, 2, true], [4.5, 1.6, true], [8, 0], [23, 4, false, 'shoulder'], [22, 12, true], [27.5, 23, false, 'underarm'], [25, 42, true, 'waist'], [26.5, 70, false, 'hem'], [13, 74.5, true], [0, 76, true]]),
      }),
      piece({
        name: 'Sleeve', role: 'sleeve', cut: 2, offset: { x: 40, y: 100 }, symmetric: true, fabric: { ...fab }, specs: SLEEVE_SPECS,
        points: fromHalf([[0, 0, true], [7, 2, true], [13, 6.5, true], [19.5, 14, false, 'underarm'], [12.5, 60, false, 'cuff'], [0, 60]]),
      }),
      piece({
        name: 'Collar', role: 'collar', cut: 2, offset: { x: 110, y: 100 }, symmetric: true, fabric: { ...fab },
        specs: [{ label: 'Collar length', kind: 'mirror', tag: 'tip', off: 3.5 }],
        points: fromHalf([[0, 0, true], [21, 1], [22.5, 6.5, false, 'tip'], [0, 5, true]]),
      }),
      piece({
        name: 'Cuff', role: 'cuff', cut: 2, offset: { x: 110, y: 122 }, symmetric: true, fabric: { ...fab },
        specs: [{ label: 'Cuff length', kind: 'mirror', tag: 'c', off: -3 }],
        points: fromHalf([[0, 0], [12.5, 0, false, 'c'], [12.5, 6], [0, 6]]),
      }),
    ];
  }
  const fab = { id: 'denim', color: 0 };
  return [
    piece({
      name: 'Front leg', role: 'front', cut: 2, offset: { x: 30, y: 12 }, symmetric: true, fabric: { ...fab }, specs: LEG_SPECS,
      points: custom([[-11, 0, false, 'waistC'], [12, 0.5, false, 'waistS'], [14.5, 18, true, 'hip'], [15, 27, true], [11, 62, true, 'knee', 'k'], [10, 104, false, 'hem', 'h'], [-10, 104, false, undefined, 'h'], [-11, 62, true, undefined, 'k'], [-16, 26, false, 'crotch'], [-12.5, 21.5, true], [-11.5, 15]]),
    }),
    piece({
      name: 'Back leg', role: 'back', cut: 2, offset: { x: 85, y: 12 }, symmetric: true, fabric: { ...fab }, specs: LEG_SPECS,
      points: custom([[-12, -3, false, 'waistC'], [11, 0, false, 'waistS'], [15, 18, true, 'hip'], [15.5, 27, true], [13, 62, true, 'knee', 'k'], [12, 104, false, 'hem', 'h'], [-12, 104, false, undefined, 'h'], [-13, 62, true, undefined, 'k'], [-22, 27, false, 'crotch'], [-15, 21, true], [-13.5, 13]]),
    }),
    piece({
      name: 'Waistband', role: 'waistband', cut: 1, offset: { x: 57, y: 132 }, symmetric: true, fabric: { ...fab },
      specs: [{ label: 'Waistband', kind: 'mirror', tag: 'wb', off: -3 }],
      points: fromHalf([[0, 0], [46, 0, false, 'wb'], [46, 4], [0, 4]]),
    }),
  ];
}

export const GARMENT_LABEL: Record<GarmentType, string> = { jacket: 'Jacket', shirt: 'Shirt', pants: 'Pants' };
