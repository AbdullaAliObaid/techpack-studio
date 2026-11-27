// Example designs: ready made looks for each garment style. Loading one starts a new project with the style,
// the fabric and colour, the finished garment measurements and the edits (bands, pockets, patches, labels, prints,
// embroidery, collar, closure, inside fabric).
//
// Rules for authors:
//  - `style` is a StyleId from src/data/catalog.ts. A design whose style is not in CATALOG is skipped by the UI and the loader.
//  - `fabric.id` is a fabric from src/data/fabrics.ts. `color` is the name of a colour on that fabric's card, `hex` a custom colour.
//  - `measures` keys are the finished garment measurement labels the Shape inspector edits (garmentSpecs in
//    src/lib/specs.ts, for example 'Chest circumference', 'Body length (CB)', 'Sleeve length', 'Hip circumference',
//    'Leg opening') plus 'Inseam'. Values are cm. They are typed in through setMeasurement, so seams still walk.
//  - Pieces in `edits` (attachments pieceId, bands skip, insideFabric keys) are named by pattern role
//    ('front', 'back', 'sleeve', 'collar', 'waistband' ...) because piece ids are made fresh for every project.
//    The loader swaps roles for real piece ids and gives every attachment a new id.

import type { Attachment, Band, Edits, ShapeId, ShapeLayer } from './edits';
import type { StyleId } from './catalog';
import { HAT_DESIGNS } from './designsHats';

export type GarmentEdits = Edits;

export interface Design {
  id: string;
  style: StyleId;
  name: string;
  blurb: string;
  fabric?: { id: string; color?: string; hex?: string };
  /** garment measurements in cm, same keys the Shape inspector uses (src/data/measureEdit.ts) */
  measures?: Record<string, number>;
  edits?: Partial<GarmentEdits>;
}

/* ---------- small builders (pieces are named by role, see above) ---------- */

let n = 0;
const nid = () => `d${++n}`;
const layer = (shape: ShapeId, w: number, h: number, color: string, extra: Partial<ShapeLayer> = {}): ShapeLayer =>
  ({ id: nid(), shape, x: 0, y: 0, w, h, rotation: 0, color, ...extra });
const base = (kind: Attachment['kind'], name: string, role: string, x: number, y: number, w: number, h: number, extra: Partial<Attachment>): Attachment =>
  ({ id: nid(), kind, name, pieceId: role, x, y, rotation: 0, w, h, outline: 'rect', layers: [], ...extra });

const fab = (id: string, hex: string) => ({ id, color: 0, hex });
/** a sewn on pocket in its own cloth */
const pocket = (name: string, role: string, x: number, y: number, w: number, h: number, cloth?: { id: string; hex: string }, outline: Attachment['outline'] = 'rect', thread?: string): Attachment =>
  base('pocket', name, role, x, y, w, h, { outline, ...(cloth ? { fabric: fab(cloth.id, cloth.hex) } : {}), ...(thread ? { thread } : {}) });
const patch = (name: string, role: string, x: number, y: number, w: number, h: number, cloth: { id: string; hex: string }, outline: Attachment['outline'] = 'rounded'): Attachment =>
  base('patch', name, role, x, y, w, h, { outline, fabric: fab(cloth.id, cloth.hex) });
const stitched = (name: string, role: string, x: number, y: number, shape: ShapeId, w: number, h: number, thread: string): Attachment =>
  base('embroidery', name, role, x, y, w, h, { thread, layers: [layer(shape, w, h, thread)] });
const printed = (name: string, role: string, x: number, y: number, w: number, h: number, layers: ShapeLayer[]): Attachment =>
  base('print', name, role, x, y, w, h, { layers });
const wordPrint = (name: string, role: string, x: number, y: number, text: string, h: number, color: string): Attachment => {
  const w = Math.max(3, text.length * h * 0.62);
  return printed(name, role, x, y, w, h, [layer('text', w, h, color, { text })]);
};
/** a tag on the inside of the back neck (blank unless text is given) */
const tag = (role: string, color: string, ink: string, text?: string, face: 'inside' | 'outside' = 'inside', type: 'woven' | 'leather' = 'woven', x = 0, y = 2.6, w = 5, h = 2.5): Attachment =>
  base('label', text ? 'Woven tag' : 'Blank label', role, x, y, w, h, {
    face, thread: ink, sheen: type === 'leather' ? 'matte' : 'satin', outline: type === 'leather' ? 'rounded' : 'rect',
    label: { type, sewn: type === 'leather' ? 'all-round' : 'ends', color },
    layers: text ? [layer('text', w * 0.78, h * 0.34, ink, { text })] : [],
  });
const band = (from: Band['from'], offset: number, stripes: [number, string][], skip: string[], method: Band['method'] = 'sewn'): Band =>
  ({ id: nid(), from, offset, stripes: stripes.map(([height, color]) => ({ height, color })), method, skip });

const TEE_SKIP = ['sleeve', 'neckband', 'collar', 'placket'];
const BODY_SKIP = ['front', 'back', 'neckband', 'collar', 'placket', 'cuff', 'facing'];

/* ---------- tops and bottoms ---------- */

const TOP_AND_BOTTOM_DESIGNS: Design[] = [
  // basic tee
  { id: 'basic-everyday-crew', style: 'basic-tee', name: 'Everyday crew', blurb: 'Plain white crew neck with a woven tag at the back neck.',
    fabric: { id: 'jersey', color: 'White' }, measures: { 'Chest circumference': 102, 'Body length (CB)': 70, 'Sleeve length': 21, 'Shoulder width': 45 },
    edits: { attachments: [tag('back', '#f2f2ee', '#222222', 'STUDIO')] } },
  { id: 'basic-pocket-heather', style: 'basic-tee', name: 'Pocket tee in slub', blurb: 'Soft grey slub cotton with a sewn on chest pocket.',
    fabric: { id: 'slub-jersey', color: 'Grey' }, measures: { 'Chest circumference': 104, 'Body length (CB)': 71, 'Sleeve length': 22 },
    edits: { attachments: [pocket('Chest pocket', 'front', 9, 15, 10, 11.5, undefined, 'rect', '#7a7a7e')] } },
  { id: 'basic-raw-oversized', style: 'basic-tee', name: 'Deconstructed oversized tee', blurb: 'Washed black, wide and long, with a blank white label patch at the hem.',
    fabric: { id: 'slub-jersey', color: 'Washed black' }, measures: { 'Chest circumference': 120, 'Body length (CB)': 76, 'Sleeve length': 24, 'Shoulder width': 54 },
    edits: { attachments: [tag('front', '#f4f4f1', '#222222', undefined, 'outside', 'woven', -17, 61, 4.5, 3)] } },
  { id: 'basic-ringer', style: 'basic-tee', name: 'Ringer tee', blurb: 'White tee with navy and red bands at both sleeve hems.',
    fabric: { id: 'jersey', color: 'White' }, measures: { 'Chest circumference': 100, 'Body length (CB)': 69, 'Sleeve length': 20 },
    edits: { bands: [band('hem', 0, [[1.6, '#1f2a44'], [0.8, '#f1f2f3'], [1.6, '#b3262d']], BODY_SKIP)] } },

  // boxy tee
  { id: 'boxy-heavyweight', style: 'boxy-tee', name: 'Heavyweight boxy tee', blurb: 'Thick ivory interlock, wide body and a short, square cut.',
    fabric: { id: 'interlock', color: 'Ivory' }, measures: { 'Chest circumference': 124, 'Body length (CB)': 66, 'Sleeve length': 20, 'Shoulder width': 56 },
    edits: { attachments: [tag('back', '#222222', '#f2f2ee', 'STUDIO')] } },
  { id: 'boxy-longline-dropped', style: 'boxy-tee', name: 'Drop shoulder long line tee', blurb: 'Black, dropped shoulders and a hem that sits well below the hip.',
    fabric: { id: 'jersey', color: 'Black' }, measures: { 'Chest circumference': 122, 'Body length (CB)': 80, 'Sleeve length': 22, 'Shoulder width': 60 } },
  { id: 'boxy-cropped-print', style: 'boxy-tee', name: 'Cropped tee with word print', blurb: 'Natural slub, cut short, with a small word printed on the chest.',
    fabric: { id: 'slub-jersey', color: 'Natural' }, measures: { 'Chest circumference': 118, 'Body length (CB)': 58, 'Sleeve length': 18, 'Shoulder width': 54 },
    edits: { attachments: [wordPrint('Chest word', 'front', 9, 13, 'WEEKEND', 1.8, '#1f1f22')] } },

  // polo
  { id: 'polo-web-stripe', style: 'polo', name: 'Web stripe trim polo', blurb: 'Navy knit polo with a red and white stripe pair at each sleeve hem.',
    fabric: { id: 'pique', color: 'Navy' }, measures: { 'Chest circumference': 104, 'Body length (CB)': 71, 'Sleeve length': 22, 'Placket length': 14 },
    edits: { bands: [band('hem', 1.2, [[0.9, '#b3262d'], [0.5, '#f1f2f3'], [0.9, '#b3262d']], BODY_SKIP)] } },
  { id: 'polo-tipped-motif', style: 'polo', name: 'Pique polo with small motif', blurb: 'White pique, a contrast navy under collar and a small stitched shield.',
    fabric: { id: 'pique', color: 'White' }, measures: { 'Chest circumference': 102, 'Body length (CB)': 70, 'Sleeve length': 21 },
    edits: { attachments: [stitched('Embroidered shield', 'front', 9, 14, 'shield', 2.4, 2.8, '#1f2a44')], insideFabric: { collar: { id: 'pique', color: 1 } } } },
  { id: 'polo-chest-stripe', style: 'polo', name: 'Knit stripe polo', blurb: 'Stone pique with a bold chest stripe in bottle green and cream.',
    fabric: { id: 'pique', color: 'Stone' }, measures: { 'Chest circumference': 106, 'Body length (CB)': 72, 'Sleeve length': 23 },
    edits: { bands: [band('shoulder', 20, [[3.5, '#1f4d3a'], [1.2, '#efe9dc'], [3.5, '#1f4d3a']], TEE_SKIP, 'woven')] } },

  // collared tee
  { id: 'collared-plain', style: 'collared-tee', name: 'Plain collar tee', blurb: 'Light jersey tee with a flat knit collar and no placket.',
    fabric: { id: 'jersey', color: 'Navy' }, measures: { 'Chest circumference': 102, 'Body length (CB)': 70, 'Sleeve length': 21 } },
  { id: 'collared-slub-pocket', style: 'collared-tee', name: 'Slub collar tee with pocket', blurb: 'Sage slub cotton, collar and a small chest pocket.',
    fabric: { id: 'slub-jersey', color: 'Sage' }, measures: { 'Chest circumference': 106, 'Body length (CB)': 71, 'Sleeve length': 22 },
    edits: { attachments: [pocket('Chest pocket', 'front', 9, 15, 9.5, 11, undefined, 'rect', '#7a8a6e')] } },
  { id: 'collared-retro-ringer', style: 'collared-tee', name: 'Retro ringer collar tee', blurb: 'Heather grey with two thin stripes at the sleeve hems.',
    fabric: { id: 'jersey', color: 'Heather grey' }, measures: { 'Chest circumference': 104, 'Body length (CB)': 69, 'Sleeve length': 20 },
    edits: { bands: [band('hem', 0, [[1, '#b3262d'], [0.6, '#f1f2f3'], [1, '#1f2a44']], BODY_SKIP)] } },

  // button up
  { id: 'shirt-oxford-bd', style: 'button-up', name: 'Oxford button down', blurb: 'Light blue oxford cloth, one chest pocket, buttoned all the way.',
    fabric: { id: 'oxford', color: 'Blue' }, measures: { 'Chest circumference': 108, 'Sleeve length': 60, 'Shoulder width': 46 },
    edits: { closure: 'buttoned', attachments: [pocket('Chest pocket', 'front', 9, 17, 11, 12.5, undefined, 'pointed')] } },
  { id: 'shirt-linen-camp', style: 'button-up', name: 'Linen camp shirt', blurb: 'Oat linen, short sleeves, a roomy body and a pocket on the chest.',
    fabric: { id: 'linen', color: 'Oat' }, measures: { 'Chest circumference': 116, 'Sleeve length': 27, 'Shoulder width': 49, 'Cuff opening': 40 },
    edits: { closure: 'buttoned', attachments: [pocket('Chest pocket', 'front', 9, 17, 11, 12.5)] } },
  { id: 'shirt-chambray-work', style: 'button-up', name: 'Chambray work shirt', blurb: 'Mid blue chambray with two chest pockets and a lighter inside collar.',
    fabric: { id: 'chambray', color: 'Mid blue' }, measures: { 'Chest circumference': 112, 'Sleeve length': 59 },
    edits: { closure: 'buttoned', attachments: [pocket('Left pocket', 'front', 9, 18, 11.5, 13, undefined, 'pointed'), pocket('Right pocket', 'front', -9, 18, 11.5, 13, undefined, 'pointed')],
      insideFabric: { collar: { id: 'chambray', color: 0 } } } },
  { id: 'shirt-poplin-dress', style: 'button-up', name: 'Slim poplin dress shirt', blurb: 'Crisp white poplin cut close to the body, with a blank tag at the back neck.',
    fabric: { id: 'poplin', color: 'White' }, measures: { 'Chest circumference': 100, 'Waist circumference': 90, 'Sleeve length': 62 },
    edits: { closure: 'buttoned', attachments: [tag('back', '#f2f2ee', '#222222')] } },

  // jacket
  { id: 'jacket-workwear-chore', style: 'jacket', name: 'Workwear chore jacket', blurb: 'Olive canvas with three patch pockets and a tan corduroy under collar.',
    fabric: { id: 'canvas', color: 'Olive' }, measures: { 'Chest circumference': 118, 'Body length (CB)': 70, 'Sleeve length': 64, 'Shoulder width': 51 },
    edits: { closure: 'buttoned', attachments: [pocket('Chest pocket', 'front', 10, 18, 12, 13), pocket('Hip pocket', 'front', 10, 46, 15, 17), pocket('Hip pocket', 'front', -10, 46, 15, 17)],
      insideFabric: { collar: { id: 'corduroy', color: 0 } } } },
  { id: 'jacket-waxed-field', style: 'jacket', name: 'Waxed field jacket', blurb: 'Waxed cotton in dark sage, two big front pockets and a corduroy collar.',
    fabric: { id: 'waxed-cotton', color: 'Sage' }, measures: { 'Chest circumference': 120, 'Body length (CB)': 74, 'Sleeve length': 65 },
    edits: { closure: 'buttoned', attachments: [pocket('Front pocket', 'front', 11, 44, 16, 18, undefined, 'rect'), pocket('Front pocket', 'front', -11, 44, 16, 18, undefined, 'rect')],
      insideFabric: { collar: { id: 'corduroy', color: 1 } } } },
  { id: 'jacket-denim-chore', style: 'jacket', name: 'Denim chore jacket', blurb: 'Indigo denim, short and boxy, with two chest pockets and a leather tag.',
    fabric: { id: 'denim', color: 'Indigo' }, measures: { 'Chest circumference': 114, 'Body length (CB)': 64, 'Sleeve length': 63 },
    edits: { closure: 'buttoned', attachments: [pocket('Chest pocket', 'front', 10, 17, 11.5, 12.5, undefined, 'pointed'), pocket('Chest pocket', 'front', -10, 17, 11.5, 12.5, undefined, 'pointed'), tag('back', '#8a5a33', '#f1e6d2', undefined, 'outside', 'leather', 0, 8, 4.5, 2.8)] } },
  { id: 'jacket-moleskin-shop', style: 'jacket', name: 'Moleskin shop coat', blurb: 'Tobacco moleskin, longer cut, worn open with the collar turned up.',
    fabric: { id: 'moleskin', color: 'Tobacco' }, measures: { 'Chest circumference': 122, 'Body length (CB)': 76, 'Sleeve length': 65 },
    edits: { closure: 'open', collar: 'up', attachments: [pocket('Hip pocket', 'front', 10, 48, 16, 18), pocket('Hip pocket', 'front', -10, 48, 16, 18)] } },

  // sweatpants
  { id: 'sweat-fleece-jogger', style: 'sweatpants', name: 'Fleece jogger', blurb: 'Heather grey brushed fleece, tapered to a ribbed ankle cuff.',
    fabric: { id: 'fleece', color: 'Heather grey' }, measures: { 'Hip circumference': 112, 'Thigh circumference': 68, 'Leg opening': 30, Inseam: 74, 'Front rise': 28 } },
  { id: 'sweat-wide-terry', style: 'sweatpants', name: 'Wide leg terry sweatpant', blurb: 'Oatmeal French terry, easy through the leg with a roomy opening.',
    fabric: { id: 'french-terry', color: 'Oatmeal' }, measures: { 'Hip circumference': 118, 'Thigh circumference': 74, 'Leg opening': 40, Inseam: 76, 'Front rise': 29 } },
  { id: 'sweat-slim-track', style: 'sweatpants', name: 'Slim track pant', blurb: 'Black interlock, close cut, with a white stripe down each side.',
    fabric: { id: 'interlock', color: 'Black' }, measures: { 'Hip circumference': 104, 'Thigh circumference': 60, 'Leg opening': 26, Inseam: 78, 'Front rise': 27 },
    edits: { attachments: [printed('Side stripe', 'front', -15, 48, 1.4, 70, [layer('rect', 1.4, 70, '#f1f2f3')])] } },

  // jeans
  { id: 'jeans-mid-wash', style: 'jeans', name: 'Mid wash five pocket', blurb: 'The everyday jean: mid wash denim, regular rise, gentle taper.',
    fabric: { id: 'denim', color: 'Mid wash' }, measures: { 'Waist circumference': 82, 'Hip circumference': 102, 'Thigh circumference': 62, 'Knee circumference': 44, 'Leg opening': 36, Inseam: 80, 'Front rise': 26 } },
  { id: 'jeans-black-stretch', style: 'jeans', name: 'Black stretch taper', blurb: 'Black stretch denim cut close, narrow at the ankle.',
    fabric: { id: 'stretch-denim', color: 'Black' }, measures: { 'Waist circumference': 80, 'Hip circumference': 98, 'Thigh circumference': 58, 'Knee circumference': 40, 'Leg opening': 32, Inseam: 81, 'Front rise': 25 } },
  { id: 'jeans-selvedge-taper', style: 'jeans', name: 'Raw selvedge taper', blurb: 'Deep indigo selvedge denim with a plain leather patch at the back waist.',
    fabric: { id: 'selvedge-denim', color: 'Deep indigo' }, measures: { 'Waist circumference': 82, 'Hip circumference': 102, 'Thigh circumference': 63, 'Knee circumference': 43, 'Leg opening': 34, Inseam: 82, 'Front rise': 26 },
    edits: { attachments: [tag('back', '#a8794a', '#2a1b10', undefined, 'outside', 'leather', 0, 5, 4.5, 2.8)] } },

  // straight jeans
  { id: 'straight-raw', style: 'straight-jeans', name: 'Raw selvedge straight jean', blurb: 'Stiff dark raw denim, same width from knee to hem, made to fade.',
    fabric: { id: 'raw-denim', color: 'Raw indigo' }, measures: { 'Waist circumference': 82, 'Hip circumference': 104, 'Thigh circumference': 64, 'Knee circumference': 50, 'Leg opening': 48, Inseam: 82, 'Front rise': 26 } },
  { id: 'straight-light-wash', style: 'straight-jeans', name: 'Light wash straight', blurb: 'Faded light blue straight leg with a relaxed seat.',
    fabric: { id: 'denim', color: 'Light wash' }, measures: { 'Waist circumference': 84, 'Hip circumference': 106, 'Thigh circumference': 66, 'Knee circumference': 52, 'Leg opening': 50, Inseam: 80, 'Front rise': 27 } },
  { id: 'straight-ecru', style: 'straight-jeans', name: 'Ecru straight jean', blurb: 'Off white denim, straight leg, a little shorter at the hem.',
    fabric: { id: 'white-denim', color: 'Ecru' }, measures: { 'Waist circumference': 82, 'Hip circumference': 104, 'Thigh circumference': 64, 'Knee circumference': 49, 'Leg opening': 46, Inseam: 76, 'Front rise': 26 } },

  // bootcut
  { id: 'bootcut-mid', style: 'bootcut-jeans', name: 'Mid wash bootcut', blurb: 'Fitted to the knee, then a small flare that sits over boots.',
    fabric: { id: 'denim', color: 'Mid wash' }, measures: { 'Waist circumference': 82, 'Hip circumference': 102, 'Thigh circumference': 62, 'Knee circumference': 46, 'Leg opening': 52, Inseam: 84, 'Front rise': 26 } },
  { id: 'bootcut-dark', style: 'bootcut-jeans', name: 'Dark stretch bootcut', blurb: 'Dark rinse stretch denim with a long leg for boots.',
    fabric: { id: 'stretch-denim', color: 'Dark rinse' }, measures: { 'Waist circumference': 80, 'Hip circumference': 100, 'Thigh circumference': 60, 'Knee circumference': 44, 'Leg opening': 50, Inseam: 86, 'Front rise': 26 } },
  { id: 'bootcut-black', style: 'bootcut-jeans', name: 'Black bootcut', blurb: 'Jet black denim, a touch wider at the hem.',
    fabric: { id: 'black-denim', color: 'Jet black' }, measures: { 'Waist circumference': 84, 'Hip circumference': 104, 'Thigh circumference': 63, 'Knee circumference': 47, 'Leg opening': 54, Inseam: 83, 'Front rise': 26 } },

  // flared
  { id: 'flare-kick', style: 'flared-jeans', name: 'Cropped kick flare', blurb: 'Vintage blue, hem sits at the ankle bone with a small kick of width.',
    fabric: { id: 'denim', color: 'Vintage blue' }, measures: { 'Waist circumference': 80, 'Hip circumference': 100, 'Thigh circumference': 60, 'Knee circumference': 42, 'Leg opening': 54, Inseam: 70, 'Front rise': 25 } },
  { id: 'flare-seventies', style: 'flared-jeans', name: 'Full length flare', blurb: 'Indigo stretch denim, tight to the knee and a wide flare to the floor.',
    fabric: { id: 'stretch-denim', color: 'Indigo' }, measures: { 'Waist circumference': 80, 'Hip circumference': 100, 'Thigh circumference': 59, 'Knee circumference': 40, 'Leg opening': 62, Inseam: 86, 'Front rise': 27 } },
  { id: 'flare-black', style: 'flared-jeans', name: 'Black flare', blurb: 'Washed black, medium flare, sits on the hip bone.',
    fabric: { id: 'black-denim', color: 'Washed black' }, measures: { 'Waist circumference': 82, 'Hip circumference': 102, 'Thigh circumference': 61, 'Knee circumference': 42, 'Leg opening': 58, Inseam: 82, 'Front rise': 24 } },

  // baggy
  { id: 'baggy-skate', style: 'baggy-jeans', name: 'Skate baggy jean', blurb: 'Stone wash denim, low seat and very wide legs that stack on the shoe.',
    fabric: { id: 'denim', color: 'Stone wash' }, measures: { 'Waist circumference': 88, 'Hip circumference': 122, 'Thigh circumference': 80, 'Knee circumference': 66, 'Leg opening': 66, Inseam: 82, 'Front rise': 24 } },
  { id: 'baggy-washed-black', style: 'baggy-jeans', name: 'Washed black baggy', blurb: 'Faded black, roomy through the seat, straight and wide below.',
    fabric: { id: 'black-denim', color: 'Washed black' }, measures: { 'Waist circumference': 88, 'Hip circumference': 120, 'Thigh circumference': 76, 'Knee circumference': 62, 'Leg opening': 62, Inseam: 80, 'Front rise': 23 } },
  { id: 'baggy-carpenter', style: 'baggy-jeans', name: 'Carpenter baggy', blurb: 'Brown duck cotton with a hammer loop and a sewn on tool pocket.',
    fabric: { id: 'duck', color: 'Brown duck' }, measures: { 'Waist circumference': 88, 'Hip circumference': 120, 'Thigh circumference': 78, 'Knee circumference': 64, 'Leg opening': 64, Inseam: 80, 'Front rise': 24 },
    edits: { attachments: [pocket('Tool pocket', 'front', -9, 30, 11, 15, undefined, 'rect'), base('strap', 'Hammer loop', 'front', -15, 32, 2, 8, { outline: 'rounded' })] } },

  // shorts
  { id: 'shorts-chino', style: 'shorts', name: 'Stone chino short', blurb: 'Plain cotton twill short with an above knee inseam.',
    fabric: { id: 'canvas', color: 'Stone' }, measures: { 'Waist circumference': 82, 'Hip circumference': 104, 'Thigh circumference': 64, 'Leg opening': 60, Inseam: 18, 'Front rise': 26 } },
  { id: 'shorts-linen', style: 'shorts', name: 'Easy linen short', blurb: 'Sand linen, shorter and wider for summer.',
    fabric: { id: 'linen', color: 'Sand' }, measures: { 'Waist circumference': 84, 'Hip circumference': 108, 'Thigh circumference': 68, 'Leg opening': 66, Inseam: 14, 'Front rise': 27 } },
  { id: 'shorts-cutoff', style: 'shorts', name: 'Denim cut off short', blurb: 'Light wash denim with a short inseam and a plain leg opening.',
    fabric: { id: 'denim', color: 'Light wash' }, measures: { 'Waist circumference': 82, 'Hip circumference': 104, 'Thigh circumference': 62, 'Leg opening': 58, Inseam: 12, 'Front rise': 25 } },
  { id: 'shorts-utility', style: 'shorts', name: 'Utility short', blurb: 'Olive canvas with a sewn on pocket on each leg.',
    fabric: { id: 'canvas', color: 'Olive' }, measures: { 'Waist circumference': 84, 'Hip circumference': 108, 'Thigh circumference': 68, 'Leg opening': 64, Inseam: 20, 'Front rise': 27 },
    edits: { attachments: [pocket('Leg pocket', 'front', -6, 24, 11, 13), pocket('Leg pocket', 'back', -6, 24, 11, 13)] } },
];

export const DESIGNS: Design[] = [...TOP_AND_BOTTOM_DESIGNS, ...HAT_DESIGNS];
export const designsFor = (style: StyleId) => DESIGNS.filter((d) => d.style === style);
