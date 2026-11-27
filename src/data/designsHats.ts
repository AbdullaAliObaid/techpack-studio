// Example designs for the headwear styles (bucket hat, cap, five panel, beanie, visor). Same rules as
// src/data/designs.ts: pieces in edits are named by pattern role ('crown', 'crownFront', 'brim', 'cuff', 'headband',
// 'strap'), measures are garmentSpecs labels, fabric colours are names on the fabric card. Names are generic and
// nothing carries a logo: labels are blank, artwork is plain shapes. Crowned hats keep the head size and crown depth the
// wearer's body gives them (head + ease): a design only sets what is a design choice, the brim or peak.

import type { Design } from './designs';
import type { Attachment, ShapeId, ShapeLayer } from './edits';

let n = 0;
const nid = () => `h${++n}`;
const layer = (shape: ShapeId, w: number, h: number, color: string, extra: Partial<ShapeLayer> = {}): ShapeLayer =>
  ({ id: nid(), shape, x: 0, y: 0, w, h, rotation: 0, color, ...extra });
const att = (kind: Attachment['kind'], name: string, role: string, x: number, y: number, w: number, h: number, extra: Partial<Attachment> = {}): Attachment =>
  ({ id: nid(), kind, name, pieceId: role, x, y, rotation: 0, w, h, outline: 'rect', layers: [], ...extra });

/** a small blank woven label, sewn at its ends (outside: a flag label on a cuff or panel; inside: the size tag) */
const label = (role: string, x: number, y: number, color: string, face: 'inside' | 'outside' = 'outside', w = 4, h = 2): Attachment =>
  att('label', 'Woven label', role, x, y, w, h, { face, sheen: 'satin', thread: color, label: { type: 'woven', sewn: 'ends', color } });
/** a plain embroidered shape */
const stitched = (name: string, role: string, x: number, y: number, shape: ShapeId, w: number, h: number, thread: string, instance?: number): Attachment =>
  att('embroidery', name, role, x, y, w, h, { thread, layers: [layer(shape, w, h, thread)], ...(instance !== undefined ? { instance } : {}) });

export const HAT_DESIGNS: Design[] = [
  // bucket hat
  { id: 'bucket-reversible', style: 'bucket-hat', name: 'Reversible bucket', blurb: 'Olive canvas outside, natural canvas inside, so it can be worn either way.',
    fabric: { id: 'canvas', color: 'Olive' }, measures: { 'Brim width': 6.5 },
    edits: { insideFabric: { crown: { id: 'canvas', color: 2 }, brim: { id: 'canvas', color: 2 } } } },
  { id: 'bucket-cord-wide', style: 'bucket-hat', name: 'Wide brim cord bucket', blurb: 'Tan corduroy with a wider brim for more shade.',
    fabric: { id: 'corduroy', color: 'Tan' }, measures: { 'Brim width': 7.5 } },
  { id: 'bucket-packable-ripstop', style: 'bucket-hat', name: 'Packable ripstop bucket', blurb: 'Light khaki ripstop with a short brim that folds flat into a bag, and a small stitched star on the side.',
    fabric: { id: 'ripstop', color: 'Khaki' }, measures: { 'Brim width': 5.5 },
    edits: { attachments: [stitched('Side star', 'crown', 0, 10, 'star', 2, 2, '#efe7d4', 1)] } },
  { id: 'bucket-chambray-star', style: 'bucket-hat', name: 'Chambray bucket with a star', blurb: 'Washed blue chambray with one small white star stitched on the front panel.',
    fabric: { id: 'chambray', color: 'Mid blue' }, measures: { 'Brim width': 6 },
    edits: { attachments: [stitched('Front star', 'crown', 0, 10, 'star', 2.4, 2.4, '#f4f2ec', 0)] } },

  // structured cap
  { id: 'cap-washed-dad', style: 'cap', name: 'Washed cotton dad cap', blurb: 'Soft stone canvas with a short, gently curved peak and a small brown stitched square.',
    fabric: { id: 'canvas', color: 'Stone' }, measures: { 'Visor depth': 6.8 },
    edits: { attachments: [stitched('Front square', 'crown', 0, 10, 'rounded', 2.4, 2, '#5b4a3a', 0)] } },
  { id: 'cap-wool-navy', style: 'cap', name: 'Navy wool ball cap', blurb: 'Navy wool suiting, a structured front and a long peak.',
    fabric: { id: 'wool', color: 'Navy' }, measures: { 'Visor depth': 7.5 } },
  { id: 'cap-cord-forest', style: 'cap', name: 'Forest corduroy cap', blurb: 'Forest green corduroy with a small embroidered circle on the front left panel.',
    fabric: { id: 'corduroy', color: 'Forest' }, measures: { 'Visor depth': 7 },
    edits: { attachments: [stitched('Front circle', 'crown', 0, 10, 'circle', 2.2, 2.2, '#ece6d8', 0)] } },

  // five panel
  { id: 'fivepanel-nylon', style: 'five-panel', name: 'Nylon five panel', blurb: 'Light black nylon, a soft crown and a small white stitched diamond on the front panel.',
    fabric: { id: 'nylon-taffeta', color: 'Black' }, measures: { 'Visor depth': 6.5 },
    edits: { attachments: [stitched('Front diamond', 'crownFront', 4, 8, 'diamond', 1.8, 2.2, '#f2f2f0')] } },
  { id: 'fivepanel-ripstop-camp', style: 'five-panel', name: 'Ripstop camp cap', blurb: 'Olive ripstop, a flat front panel and a short peak for packing.',
    fabric: { id: 'ripstop', color: 'Olive' }, measures: { 'Visor depth': 6 } },
  { id: 'fivepanel-linen-summer', style: 'five-panel', name: 'Summer linen five panel', blurb: 'Breathable sand linen with a cream stitched triangle on the front panel.',
    fabric: { id: 'linen', color: 'Sand' }, measures: { 'Visor depth': 6.5 },
    edits: { attachments: [stitched('Front triangle', 'crownFront', 0, 8, 'triangle', 2.4, 2, '#efe7d4')] } },

  // beanie (rib knit, cut smaller than the head: negative ease)
  { id: 'beanie-fisherman', style: 'beanie', name: 'Ribbed fisherman beanie', blurb: 'Natural rib knit with a deep turned-back cuff.',
    fabric: { id: 'rib', color: 'Natural' }, measures: { 'Head band circumference': 48, 'Body length': 23, 'Cuff height': 8 } },
  { id: 'beanie-technical', style: 'beanie', name: 'Cuffed technical beanie', blurb: 'Black rib knit, a 7 cm cuff and a small blank woven label stitched on the cuff.',
    fabric: { id: 'rib', color: 'Black' }, measures: { 'Head band circumference': 47.5, 'Body length': 22, 'Cuff height': 7 },
    edits: { attachments: [label('cuff', 7, 3.5, '#d9dce3')] } },
  { id: 'beanie-heather-slouch', style: 'beanie', name: 'Heather slouch beanie', blurb: 'Heather grey rib, a longer body that slouches at the back and a narrow cuff.',
    fabric: { id: 'rib', color: 'Heather grey' }, measures: { 'Head band circumference': 49.5, 'Body length': 24, 'Cuff height': 5 } },
  { id: 'beanie-watch-red', style: 'beanie', name: 'Red watch beanie', blurb: 'Bright red rib knit, a close fit and a classic cuff.',
    fabric: { id: 'rib', color: 'Red' }, measures: { 'Head band circumference': 47, 'Body length': 21.5, 'Cuff height': 6.5 } },

  // visor
  { id: 'visor-terry', style: 'visor', name: 'Terry tennis visor', blurb: 'White terry front band that soaks up sweat, with a long peak.',
    fabric: { id: 'french-terry', color: 'White' }, measures: { 'Band height': 5, 'Visor depth': 7.5 } },
  { id: 'visor-sport-navy', style: 'visor', name: 'Navy sport visor', blurb: 'Light navy polyester, a slim band and a small white stitched circle on the front.',
    fabric: { id: 'poly', color: 'Navy' }, measures: { 'Band height': 4, 'Visor depth': 7 },
    edits: { attachments: [stitched('Front circle', 'headband', 0, 2, 'circle', 1.6, 1.6, '#f4f4f1')] } },
  { id: 'visor-linen-sun', style: 'visor', name: 'Wide peak linen sun visor', blurb: 'Natural linen with a deep peak for extra shade.',
    fabric: { id: 'linen', color: 'Natural flax' }, measures: { 'Head band circumference': 56.5, 'Visor depth': 9 } },
];
