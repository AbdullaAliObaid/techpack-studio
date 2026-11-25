// Garment library: every style you can start a project from, grouped by category.
// This file is the shared contract between the drafting engine (src/data/draft.ts), the UI library tab
// and the 3D detail renderer. Each style id is what Project.garment stores.

export type Category = 'tops' | 'bottoms' | 'headwear';

/** Drafting family: which block the style is drafted from. */
export type Family = 'tee' | 'polo' | 'shirt' | 'jacket' | 'pants' | 'bucket' | 'cap';

export type StyleId =
  | 'basic-tee' | 'boxy-tee' | 'polo' | 'collared-tee' | 'button-up' | 'jacket'
  | 'sweatpants' | 'jeans' | 'straight-jeans' | 'bootcut-jeans' | 'flared-jeans' | 'baggy-jeans' | 'shorts'
  | 'bucket-hat' | 'cap';

/** Construction details the 3D view draws on top of the cloth. */
export interface Details {
  /** topstitching along seams: single or double needle, thread colour, distance from the seam (cm) */
  topstitch?: { needles: 1 | 2; color: string; offset: number };
  /** hem finish drawn on unsewn edges (hems, cuffs, necklines) */
  hem?: { needles: 1 | 2; depth: number };
  beltLoops?: number; // count on the waistband
  rivets?: boolean;
  rib?: boolean; // knit rib trims (neckband, cuffs, hem band)
  drawcord?: boolean;
  buttons?: number; // centre front / placket buttons
}

export interface Style {
  id: StyleId;
  name: string;
  category: Category;
  family: Family;
  blurb: string;
  defaultFabric: string; // fabric id from src/data/fabrics.ts
  details: Details;
}

export const CATEGORIES: { id: Category; name: string }[] = [
  { id: 'tops', name: 'Tops' },
  { id: 'bottoms', name: 'Bottoms' },
  { id: 'headwear', name: 'Headwear' },
];

const denim: Details = { topstitch: { needles: 2, color: '#c9933a', offset: 0.6 }, hem: { needles: 2, depth: 1.5 }, beltLoops: 5, rivets: true };
const knit: Details = { topstitch: { needles: 2, color: 'match', offset: 0.6 }, hem: { needles: 2, depth: 2 }, rib: true };

export const CATALOG: Style[] = [
  // tops
  { id: 'basic-tee', name: 'Basic tee', category: 'tops', family: 'tee', defaultFabric: 'jersey', blurb: 'Classic crew neck T-shirt, regular body, set-in short sleeves.', details: knit },
  { id: 'boxy-tee', name: 'Boxy tee', category: 'tops', family: 'tee', defaultFabric: 'jersey', blurb: 'Wide, cropped body with dropped shoulders and a heavier neckband.', details: knit },
  { id: 'polo', name: 'Polo', category: 'tops', family: 'polo', defaultFabric: 'jersey', blurb: 'Knit polo with a two-button placket and a flat knit collar.', details: { ...knit, buttons: 2 } },
  { id: 'collared-tee', name: 'Collared tee', category: 'tops', family: 'polo', defaultFabric: 'jersey', blurb: 'T-shirt body with a knit collar and no placket.', details: knit },
  { id: 'button-up', name: 'Button-up shirt', category: 'tops', family: 'shirt', defaultFabric: 'poplin', blurb: 'Woven shirt with collar, cuffs and a buttoned front.', details: { topstitch: { needles: 1, color: 'match', offset: 0.3 }, hem: { needles: 1, depth: 0.6 }, buttons: 7 } },
  { id: 'jacket', name: 'Chore jacket', category: 'tops', family: 'jacket', defaultFabric: 'canvas', blurb: 'Boxy work jacket in canvas with a point collar.', details: { topstitch: { needles: 2, color: 'match', offset: 0.6 }, hem: { needles: 2, depth: 2 }, buttons: 5 } },
  // bottoms
  { id: 'sweatpants', name: 'Sweatpants', category: 'bottoms', family: 'pants', defaultFabric: 'jersey', blurb: 'Relaxed joggers with an elastic drawcord waist and ribbed ankle cuffs.', details: { ...knit, drawcord: true } },
  { id: 'jeans', name: 'Jeans', category: 'bottoms', family: 'pants', defaultFabric: 'denim', blurb: 'Five-pocket jeans, regular rise, slim through the thigh, gentle taper.', details: denim },
  { id: 'straight-jeans', name: 'Straight jeans', category: 'bottoms', family: 'pants', defaultFabric: 'denim', blurb: 'Same width from knee to hem.', details: denim },
  { id: 'bootcut-jeans', name: 'Bootcut jeans', category: 'bottoms', family: 'pants', defaultFabric: 'denim', blurb: 'Fitted to the knee, then a slight flare to sit over boots.', details: denim },
  { id: 'flared-jeans', name: 'Flared jeans', category: 'bottoms', family: 'pants', defaultFabric: 'denim', blurb: 'Fitted thigh and knee with a wide flare from the knee down.', details: denim },
  { id: 'baggy-jeans', name: 'Baggy jeans', category: 'bottoms', family: 'pants', defaultFabric: 'denim', blurb: 'Low, roomy seat and wide legs that stack at the hem.', details: denim },
  { id: 'shorts', name: 'Shorts', category: 'bottoms', family: 'pants', defaultFabric: 'canvas', blurb: 'Chino shorts with an above-knee inseam.', details: { topstitch: { needles: 1, color: 'match', offset: 0.6 }, hem: { needles: 1, depth: 2.5 }, beltLoops: 5 } },
  // headwear
  { id: 'bucket-hat', name: 'Bucket hat', category: 'headwear', family: 'bucket', defaultFabric: 'canvas', blurb: 'Six-piece crown with a stitched, sloped brim.', details: { topstitch: { needles: 1, color: 'match', offset: 0.5 } } },
  { id: 'cap', name: 'Baseball cap', category: 'headwear', family: 'cap', defaultFabric: 'canvas', blurb: 'Six-panel cap with a curved brim and a top button.', details: { topstitch: { needles: 2, color: 'match', offset: 0.4 }, buttons: 1 } },
];

export const styleById = (id: string): Style => CATALOG.find((s) => s.id === id) ?? CATALOG.find((s) => s.id === 'jeans')!;

/** Legacy project garment values from before the catalog existed. */
export function migrateGarment(g: string): StyleId {
  if (g === 'pants') return 'jeans';
  if (g === 'shirt') return 'button-up';
  return (CATALOG.some((s) => s.id === g) ? g : 'jacket') as StyleId;
}
