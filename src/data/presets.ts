import type { FabricPattern } from './fabrics';
import type { Placement } from './edits';
import { bbox, type PPoint, type Pt } from '../lib/geometry';
import { uid } from '../lib/units';
import { draft, type Fit } from './draft';
import { CATALOG, migrateGarment, styleById, type StyleId } from './catalog';
import { DEFAULT_BODY, type Body } from '../three/body';

/** Kept for older imports: a garment is now any catalog style. */
export type GarmentType = StyleId;
export type Role = 'front' | 'back' | 'sleeve' | 'collar' | 'cuff' | 'waistband' | 'neckband' | 'placket' | 'crown' | 'brim' | 'custom';

export type SpecDef =
  | { label: string; kind: 'slice'; tag: string; dy?: number; /** measure straight across openings (a buttoned placket) */ full?: boolean }
  | { label: string; kind: 'mirror'; tag: string; off?: number }
  | { label: string; kind: 'dist'; tags: [string, string]; off?: number }
  | { label: string; kind: 'vdist'; tags: [string, string] }
  | { label: string; kind: 'length' };

export interface PieceFabric {
  id: string;
  /** index into the fabric's colours */
  color: number;
  /** any custom colour (CSS hex); overrides `color` when set */
  hex?: string;
  /** pattern on this piece (src/data/fabrics.ts) */
  pattern?: FabricPattern;
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
  /** relaxed length of the elastic inside a waistband (cm); the band is gathered onto it */
  elastic?: number;
  /** user-drawn pieces: how the piece goes onto the garment (src/data/edits.ts) */
  placement?: Placement;
}

const TOP_SPECS: SpecDef[] = [
  { label: 'Shoulder', kind: 'mirror', tag: 'shoulder', off: -3 },
  { label: 'Chest', kind: 'slice', tag: 'underarm', full: true },
  { label: 'Waist', kind: 'slice', tag: 'waist', full: true },
  { label: 'Hem', kind: 'mirror', tag: 'hem', off: 3.5 },
  { label: 'Length', kind: 'length' },
];

const SLEEVE_SPECS: SpecDef[] = [
  { label: 'Bicep', kind: 'mirror', tag: 'underarm', off: 0 },
  { label: 'Cuff', kind: 'mirror', tag: 'cuff', off: 3.5 },
  { label: 'Length', kind: 'length' },
];

const SHORT_SLEEVE_SPECS: SpecDef[] = [
  { label: 'Bicep', kind: 'mirror', tag: 'underarm', off: 0 },
  { label: 'Opening', kind: 'mirror', tag: 'cuff', off: 3.5 },
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
const SHORTS_SPECS = LEG_SPECS.filter((s) => s.label !== 'Knee');

const COLLAR: SpecDef[] = [{ label: 'Collar length', kind: 'mirror', tag: 'tip', off: -2.5 }];
const NECKBAND: SpecDef[] = [{ label: 'Neckband length', kind: 'mirror', tag: 'nb', off: -2.5 }, { label: 'Height', kind: 'length' }];
const PLACKET: SpecDef[] = [{ label: 'Placket width', kind: 'mirror', tag: 'pl', off: -2 }, { label: 'Length', kind: 'length' }];
const CUFF: SpecDef[] = [{ label: 'Cuff length', kind: 'mirror', tag: 'c', off: -3 }];
const WAISTBAND: SpecDef[] = [{ label: 'Waistband', kind: 'mirror', tag: 'wb', off: -3 }];
const CROWN: SpecDef[] = [{ label: 'Panel base', kind: 'mirror', tag: 'band', off: 2.5 }, { label: 'Panel height', kind: 'length' }];

interface Meta { role: Role; name: string; cut: number; specs: SpecDef[] }

function metaFor(style: StyleId): Meta[] {
  const fam = styleById(style).family;
  const body = (sleeve: SpecDef[]): Meta[] => [
    { role: 'front', name: 'Front', cut: 1, specs: TOP_SPECS },
    { role: 'back', name: 'Back', cut: 1, specs: TOP_SPECS },
    { role: 'sleeve', name: 'Sleeve', cut: 2, specs: sleeve },
  ];
  switch (fam) {
    case 'jacket':
      return [...body(SLEEVE_SPECS), { role: 'collar', name: 'Collar', cut: 2, specs: COLLAR }];
    case 'shirt':
      return [...body(SLEEVE_SPECS), { role: 'collar', name: 'Collar', cut: 2, specs: COLLAR }, { role: 'cuff', name: 'Cuff', cut: 2, specs: CUFF }];
    case 'tee':
      return [...body(SHORT_SLEEVE_SPECS), { role: 'neckband', name: 'Neckband', cut: 1, specs: NECKBAND }];
    case 'polo':
      return [
        ...body(SHORT_SLEEVE_SPECS),
        { role: 'collar', name: 'Knit collar', cut: 1, specs: COLLAR },
        ...(style === 'polo' ? [{ role: 'placket' as Role, name: 'Placket', cut: 2, specs: PLACKET }] : []),
      ];
    case 'pants':
      return [
        { role: 'front', name: 'Front leg', cut: 2, specs: style === 'shorts' ? SHORTS_SPECS : LEG_SPECS },
        { role: 'back', name: 'Back leg', cut: 2, specs: style === 'shorts' ? SHORTS_SPECS : LEG_SPECS },
        { role: 'waistband', name: style === 'sweatpants' ? 'Elastic waistband' : 'Waistband', cut: 1, specs: WAISTBAND },
        ...(style === 'sweatpants' ? [{ role: 'cuff' as Role, name: 'Ankle cuff', cut: 2, specs: CUFF }] : []),
      ];
    case 'bucket':
      return [
        { role: 'crown', name: 'Crown panel', cut: 6, specs: CROWN },
        { role: 'brim', name: 'Brim', cut: 2, specs: [{ label: 'Brim width', kind: 'dist', tags: ['brimIn', 'brimOut'] }] },
      ];
    case 'cap':
      return [
        { role: 'crown', name: 'Crown panel', cut: 6, specs: CROWN },
        { role: 'brim', name: 'Visor', cut: 2, specs: [{ label: 'Visor depth', kind: 'dist', tags: ['visorIn', 'visorOut'] }, { label: 'Visor width', kind: 'mirror', tag: 'visorEnd', off: -2 }] },
      ];
  }
}

/** Fabric a piece starts in: knit styles get rib trims, everything else the style's main fabric. */
function fabricFor(style: StyleId, role: Role) {
  const s = styleById(style);
  const rib = s.details.rib && (role === 'neckband' || role === 'cuff' || (role === 'collar' && s.family === 'polo'));
  return rib ? 'rib' : s.defaultFabric;
}

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
export function makePreset(type: StyleId, body: Body = DEFAULT_BODY, fit: Fit = 'regular'): Piece[] {
  const style = migrateGarment(type);
  const drafted = draft(style, body, fit);
  const fam = styleById(style).family;
  const pieces: Piece[] = metaFor(style).map((m) => {
    const d = drafted.find((q) => q.role === m.role)!;
    return {
      id: uid(), name: m.name, role: m.role, cut: m.cut, offset: { x: 0, y: 0 }, symmetric: true,
      fabric: { id: fabricFor(style, m.role), color: 0 }, specs: m.specs, points: d.points,
      ...(d.elastic !== undefined ? { elastic: d.elastic } : {}),
    };
  });
  layout(pieces, fam === 'pants' ? 120 : fam === 'bucket' || fam === 'cap' ? 90 : 140);
  return pieces;
}

/** Display name of every style, by id. */
export const GARMENT_LABEL = Object.fromEntries(CATALOG.map((s) => [s.id, s.name])) as Record<StyleId, string>;
