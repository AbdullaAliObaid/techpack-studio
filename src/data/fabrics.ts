// Fabric library. Stretch is the rough safe elongation before a fabric starts to strain or tear.
// Values are sensible starting defaults, not lab measurements.

export type Weave = 'canvas' | 'twill' | 'poplin' | 'linen' | 'wool' | 'poly' | 'jersey' | 'leather' | 'spandex';

export interface Fabric {
  id: string;
  name: string;
  blurb: string;
  stretch: number; // fraction, 0.04 = 4%
  weight: 'Light' | 'Medium' | 'Heavy';
  gsm: number;
  weave: Weave;
  roughness: number;
  /** bending stiffness 0..1 (1 = stiff like canvas, low = drapey like jersey) */
  bend: number;
  colors: { name: string; hex: string }[];
}

export const FABRICS: Fabric[] = [
  {
    id: 'canvas', bend: 1.0, name: 'Cotton Canvas', weave: 'canvas', stretch: 0.03, weight: 'Heavy', gsm: 340, roughness: 0.95,
    blurb: 'Stiff and tough, barely stretches. Chore jackets, workwear, bags.',
    colors: [{ name: 'Tan', hex: '#c8a978' }, { name: 'Olive', hex: '#6b6f45' }, { name: 'Natural', hex: '#e6dcc6' }, { name: 'Black', hex: '#2b2b2b' }],
  },
  {
    id: 'denim', bend: 0.85, name: 'Denim', weave: 'twill', stretch: 0.04, weight: 'Heavy', gsm: 400, roughness: 0.9,
    blurb: 'Rigid cotton twill. Jeans and trucker jackets. Breaks in but does not give much.',
    colors: [{ name: 'Indigo', hex: '#2e3f66' }, { name: 'Mid wash', hex: '#5878a3' }, { name: 'Light wash', hex: '#9cb3cf' }, { name: 'Black', hex: '#25272c' }],
  },
  {
    id: 'stretch-denim', bend: 0.6, name: 'Stretch Denim', weave: 'twill', stretch: 0.15, weight: 'Medium', gsm: 340, roughness: 0.88,
    blurb: 'Denim with a little elastane mixed in. Skinny and slim jeans.',
    colors: [{ name: 'Indigo', hex: '#2b3a5e' }, { name: 'Mid wash', hex: '#56739c' }, { name: 'Grey', hex: '#6d7077' }],
  },
  {
    id: 'poplin', bend: 0.35, name: 'Cotton Poplin', weave: 'poplin', stretch: 0.03, weight: 'Light', gsm: 120, roughness: 0.8,
    blurb: 'Smooth, crisp shirting cotton. Dress shirts. Almost no stretch.',
    colors: [{ name: 'White', hex: '#f4f4f1' }, { name: 'Sky', hex: '#b9d0ea' }, { name: 'Pink', hex: '#efc9cc' }, { name: 'Navy', hex: '#2a3550' }],
  },
  {
    id: 'linen', bend: 0.4, name: 'Linen', weave: 'linen', stretch: 0.02, weight: 'Light', gsm: 160, roughness: 0.95,
    blurb: 'Breathable and textured, wrinkles easily. Summer shirts and trousers. No stretch.',
    colors: [{ name: 'Oat', hex: '#d9ccb2' }, { name: 'White', hex: '#efece4' }, { name: 'Sage', hex: '#a7b39a' }, { name: 'Rust', hex: '#a8573a' }],
  },
  {
    id: 'wool', bend: 0.55, name: 'Wool', weave: 'wool', stretch: 0.08, weight: 'Medium', gsm: 280, roughness: 1,
    blurb: 'Warm with a soft natural give. Suits, coats, overshirts.',
    colors: [{ name: 'Charcoal', hex: '#4a4c52' }, { name: 'Camel', hex: '#b88a5a' }, { name: 'Navy', hex: '#28304a' }, { name: 'Heather grey', hex: '#9a9a9a' }],
  },
  {
    id: 'poly', bend: 0.25, name: 'Polyester', weave: 'poly', stretch: 0.06, weight: 'Light', gsm: 150, roughness: 0.45,
    blurb: 'Smooth synthetic with a slight sheen. Windbreakers, linings, sportswear.',
    colors: [{ name: 'Black', hex: '#1f2023' }, { name: 'Red', hex: '#b3262d' }, { name: 'Cobalt', hex: '#2a52be' }, { name: 'Silver', hex: '#b9bcc2' }],
  },
  {
    id: 'jersey', bend: 0.12, name: 'Cotton Jersey', weave: 'jersey', stretch: 0.3, weight: 'Light', gsm: 180, roughness: 0.9,
    blurb: 'Soft knitted cotton like a T-shirt. Stretches comfortably.',
    colors: [{ name: 'White', hex: '#f2f2f0' }, { name: 'Heather grey', hex: '#a3a5a8' }, { name: 'Black', hex: '#232325' }, { name: 'Forest', hex: '#2f4a3a' }],
  },
  {
    id: 'leather', bend: 0.9, name: 'Leather', weave: 'leather', stretch: 0.1, weight: 'Heavy', gsm: 900, roughness: 0.55,
    blurb: 'Lambskin or cowhide. Moulds to the body slowly. Biker jackets.',
    colors: [{ name: 'Black', hex: '#1c1b1b' }, { name: 'Brown', hex: '#5a3a26' }, { name: 'Tan', hex: '#a06b3f' }, { name: 'Oxblood', hex: '#4e1c1f' }],
  },
  {
    id: 'spandex', bend: 0.15, name: 'Athletic Spandex', weave: 'spandex', stretch: 0.5, weight: 'Light', gsm: 220, roughness: 0.5,
    blurb: 'Nylon or poly with lots of elastane. Activewear and compression. Very stretchy.',
    colors: [{ name: 'Black', hex: '#1b1c20' }, { name: 'Slate', hex: '#4b5563' }, { name: 'Teal', hex: '#0f766e' }, { name: 'Volt', hex: '#c6e33a' }],
  },
];

export const fabricById = (id: string) => FABRICS.find((f) => f.id === id) ?? FABRICS[0];

export function stretchLabel(s: number) {
  if (s < 0.05) return 'Low stretch';
  if (s < 0.15) return 'Some stretch';
  return 'High stretch';
}
