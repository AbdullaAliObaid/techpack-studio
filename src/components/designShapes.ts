// Vector shape library for the Design workspace. Every shape is an SVG path in the unit box -0.5..0.5 (the same space as
// src/lib/shapes.ts), so it becomes a 'path' layer. The basic shapes of the shared library are listed first.
import type { ShapeId } from '../data/edits';
import { SHAPES } from '../lib/shapes';
import type { FontId } from './designDoc';

export interface LibItem {
  id: string;
  name: string;
  /** library shape id, or a path of our own, or text */
  shape: ShapeId;
  d?: string;
  text?: string;
  font?: FontId;
  /** default box proportions w : h */
  aspect?: number;
}
export interface LibGroup { id: string; name: string; items: LibItem[] }

const f = (n: number) => n.toFixed(3);
const poly = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join('') + 'Z';
const polar = (fn: (t: number) => number, n = 120) => poly(Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2 - Math.PI / 2; const r = fn(t); return [r * Math.cos(t), r * Math.sin(t)] as [number, number]; }));
const star = (n: number, inner: number) => poly(Array.from({ length: n * 2 }, (_, i) => { const r = i % 2 ? 0.5 * inner : 0.5, t = -Math.PI / 2 + (i * Math.PI) / n; return [r * Math.cos(t), r * Math.sin(t)] as [number, number]; }));
const ring = (r: number) => `M${f(r)} 0A${f(r)} ${f(r)} 0 1 1 ${f(-r)} 0A${f(r)} ${f(r)} 0 1 1 ${f(r)} 0Z`;
const ringRev = (r: number) => `M${f(r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(-r)} 0A${f(r)} ${f(r)} 0 1 0 ${f(r)} 0Z`;

/** a leaf from (x,y) pointing at angle a (rad), length L, half width W */
function leaf(x: number, y: number, a: number, L: number, W: number) {
  const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L;
  const nx = -Math.sin(a) * W, ny = Math.cos(a) * W;
  const mx = (x + ex) / 2, my = (y + ey) / 2;
  return `M${f(x)} ${f(y)}Q${f(mx + nx)} ${f(my + ny)} ${f(ex)} ${f(ey)}Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)}Z`;
}
function laurel() {
  let d = '';
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const t = 0.15 + i * 0.12; // angle around the bottom, going up each side
      const ang = Math.PI / 2 + side * t * Math.PI * 1.15;
      const R = 0.36;
      const x = Math.cos(ang) * R, y = Math.sin(ang) * R;
      const tang = ang - side * Math.PI / 2;
      d += leaf(x, y, tang - side * 0.5, 0.17, 0.05);
      d += leaf(x, y, tang + side * 0.5 + (side > 0 ? 0 : 0), 0.14, 0.04);
    }
  }
  return d;
}
function sineBand(amp: number, waves: number, thick: number) {
  const top: [number, number][] = [], bot: [number, number][] = [];
  for (let i = 0; i <= 48; i++) { const u = i / 48, x = -0.5 + u, y = Math.sin(u * waves * Math.PI * 2) * amp; top.push([x, y - thick / 2]); bot.push([x, y + thick / 2]); }
  return poly([...top, ...bot.reverse()]);
}
function spiral() {
  const a: [number, number][] = [], b: [number, number][] = [];
  for (let i = 0; i <= 90; i++) { const t = i / 90, th = t * Math.PI * 4.2, r = 0.04 + t * 0.42, w = 0.05 * (1 - t * 0.6) + 0.015; a.push([Math.cos(th) * (r + w), Math.sin(th) * (r + w)]); b.push([Math.cos(th) * (r - w), Math.sin(th) * (r - w)]); }
  return poly([...a, ...b.reverse()]);
}
function curvedArrow() {
  const o: [number, number][] = [], inn: [number, number][] = [];
  const a0 = Math.PI * 0.95, a1 = Math.PI * 0.12 * -1 + Math.PI * 2 - Math.PI * 0.3;
  for (let i = 0; i <= 30; i++) { const th = a0 + ((a1 - a0) * i) / 30; o.push([Math.cos(th) * 0.4, Math.sin(th) * 0.4 + 0.1]); inn.push([Math.cos(th) * 0.27, Math.sin(th) * 0.27 + 0.1]); }
  const e = a1;
  const tip: [number, number] = [Math.cos(e + 0.38) * 0.335, Math.sin(e + 0.38) * 0.335 + 0.1];
  return poly([...o, [Math.cos(e) * 0.5, Math.sin(e) * 0.5 + 0.1], tip, [Math.cos(e) * 0.17, Math.sin(e) * 0.17 + 0.1], ...inn.reverse()]);
}

const P = (id: string, name: string, d: string, aspect = 1): LibItem => ({ id, name, shape: 'path', d, aspect });
const B = (id: ShapeId): LibItem => ({ id, name: SHAPES[id].name, shape: id });

export const LIBRARY: LibGroup[] = [
  { id: 'basic', name: 'Basic', items: (['rect', 'rounded', 'circle', 'triangle', 'star', 'star4', 'heart', 'hexagon', 'shield', 'chevron', 'stripe', 'bolt', 'cross', 'diamond', 'ring'] as ShapeId[]).map(B).concat([
    P('oval', 'Oval', polar(() => 0.5), 1.4), P('semicircle', 'Half circle', 'M-0.5 0.25A0.5 0.5 0 0 1 0.5 0.25Z', 1.6), P('pentagon', 'Pentagon', polar(() => 0.5, 5)), P('octagon', 'Octagon', polar(() => 0.5, 8)), P('plus-round', 'Rounded plus', 'M-0.14 -0.5H0.14V-0.14H0.5V0.14H0.14V0.5H-0.14V0.14H-0.5V-0.14H-0.14Z'),
  ]) },
  { id: 'crests', name: 'Crests and shields', items: [
    P('shield-heater', 'Heater shield', 'M-0.5 -0.5H0.5V0C0.5 0.3 0.2 0.45 0 0.5C-0.2 0.45 -0.5 0.3 -0.5 0Z'),
    P('shield-kite', 'Kite shield', 'M-0.5 -0.5H0.5V-0.1L0 0.5L-0.5 -0.1Z'),
    P('shield-notch', 'Notched shield', 'M-0.5 -0.4Q-0.25 -0.5 0 -0.4Q0.25 -0.5 0.5 -0.4V0.05Q0.5 0.35 0 0.5Q-0.5 0.35 -0.5 0.05Z'),
    P('shield-round', 'Round top shield', 'M-0.5 0.05V-0.1A0.5 0.5 0 0 1 0.5 -0.1V0.05Q0.5 0.35 0 0.5Q-0.5 0.35 -0.5 0.05Z'),
    P('shield-cut', 'Cut corner shield', 'M-0.35 -0.5H0.35L0.5 -0.35V0.05Q0.5 0.35 0 0.5Q-0.5 0.35 -0.5 0.05V-0.35Z'),
    P('crown', 'Crown', 'M-0.5 0.4L-0.5 -0.22L-0.25 0.04L0 -0.45L0.25 0.04L0.5 -0.22L0.5 0.4Z', 1.2),
    P('wing', 'Wing', 'M-0.5 0.12C-0.42 -0.3 0 -0.5 0.5 -0.45C0.32 -0.32 0.36 -0.27 0.46 -0.22C0.26 -0.17 0.3 -0.12 0.4 -0.02C0.2 0.01 0.25 0.08 0.3 0.18C0.1 0.18 0.1 0.28 0.16 0.4C-0.2 0.36 -0.4 0.26 -0.5 0.12Z', 1.4),
    P('laurel', 'Laurel wreath', laurel()),
    P('fleur', 'Fleur point', 'M0 -0.5C0.12 -0.3 0.14 -0.15 0.06 -0.02C0.2 -0.2 0.4 -0.2 0.45 -0.05C0.5 0.12 0.3 0.2 0.12 0.12C0.1 0.2 0.14 0.3 0.22 0.42L-0.22 0.42C-0.14 0.3 -0.1 0.2 -0.12 0.12C-0.3 0.2 -0.5 0.12 -0.45 -0.05C-0.4 -0.2 -0.2 -0.2 -0.06 -0.02C-0.14 -0.15 -0.12 -0.3 0 -0.5Z'),
  ] },
  { id: 'banners', name: 'Banners and badges', items: [
    P('ribbon', 'Ribbon', 'M-0.5 -0.15Q-0.25 -0.35 0 -0.15Q0.25 0.05 0.5 -0.15V0.2Q0.25 0.4 0 0.2Q-0.25 0 -0.5 0.2Z', 2.4),
    P('banner', 'Swallowtail banner', 'M-0.5 -0.3H0.5L0.36 0L0.5 0.3H-0.5L-0.36 0Z', 2.4),
    P('pennant', 'Pennant', 'M-0.5 -0.5H0.5V0.2L0 0.5L-0.5 0.2Z'),
    P('flag', 'Flag', 'M-0.5 -0.5H0.5L0.3 -0.2L0.5 0.1H-0.35V0.5H-0.5Z'),
    P('tag-hole', 'Tag', 'M-0.5 -0.3H0.3L0.5 0L0.3 0.3H-0.5ZM0.32 0A0.06 0.06 0 1 0 0.2 0A0.06 0.06 0 1 0 0.32 0Z', 1.8),
    P('scallop', 'Scallop badge', polar((t) => 0.45 + 0.05 * Math.cos(12 * t))),
    P('seal', 'Seal', star(16, 0.86)),
    P('gear', 'Gear badge', polar((t) => (Math.cos(10 * t) > 0 ? 0.5 : 0.42), 160)),
    P('double-ring', 'Double ring', ring(0.5) + ringRev(0.44) + ring(0.36) + ringRev(0.3)),
    P('ring-thin', 'Thin ring', ring(0.5) + ringRev(0.46)),
    P('rounded-frame', 'Frame', 'M-0.5 -0.5H0.5V0.5H-0.5ZM-0.43 -0.43V0.43H0.43V-0.43Z'),
    P('arch', 'Arch badge', 'M-0.5 0.5V-0.05A0.5 0.5 0 0 1 0.5 -0.05V0.5Z'),
  ] },
  { id: 'arrows', name: 'Arrows', items: [
    P('arrow', 'Arrow', poly([[-0.5, -0.12], [0.1, -0.12], [0.1, -0.36], [0.5, 0], [0.1, 0.36], [0.1, 0.12], [-0.5, 0.12]]), 1.6),
    P('arrow-double', 'Double arrow', poly([[-0.5, 0], [-0.2, -0.3], [-0.2, -0.11], [0.2, -0.11], [0.2, -0.3], [0.5, 0], [0.2, 0.3], [0.2, 0.11], [-0.2, 0.11], [-0.2, 0.3]]), 1.8),
    P('arrow-chevron', 'Chevron arrow', poly([[-0.3, -0.5], [0.1, -0.5], [0.5, 0], [0.1, 0.5], [-0.3, 0.5], [0.1, 0]])),
    P('arrow-curved', 'Curved arrow', curvedArrow()),
    P('arrow-up', 'Up arrow', poly([[0, -0.5], [0.4, -0.05], [0.14, -0.05], [0.14, 0.5], [-0.14, 0.5], [-0.14, -0.05], [-0.4, -0.05]])),
    P('pointer', 'Pointer', poly([[-0.4, -0.5], [0.5, 0.05], [0.1, 0.12], [0.3, 0.5], [0.1, 0.5], [-0.1, 0.18], [-0.4, 0.4]])),
  ] },
  { id: 'flourish', name: 'Flourishes and nature', items: [
    P('swirl', 'Swirl', spiral()),
    P('wave', 'Wave', sineBand(0.14, 2, 0.14), 2.4),
    P('wave-fine', 'Fine wave', sineBand(0.08, 4, 0.08), 3),
    P('flame', 'Flame', 'M0 -0.5C0.1 -0.3 0.4 -0.15 0.35 0.15C0.3 0.4 0.1 0.5 0 0.5C-0.2 0.5 -0.4 0.35 -0.35 0.1C-0.3 -0.05 -0.15 -0.1 -0.1 -0.25C-0.05 -0.15 0 -0.3 0 -0.5Z'),
    P('leaf', 'Leaf', leaf(-0.5, 0.35, -0.7, 1.2, 0.28)),
    P('drop', 'Drop', 'M0 -0.5C0.25 -0.15 0.4 0.05 0.4 0.2A0.4 0.4 0 0 1 -0.4 0.2C-0.4 0.05 -0.25 -0.15 0 -0.5Z'),
    P('moon', 'Crescent', 'M0.1 -0.5A0.5 0.5 0 1 0 0.1 0.5A0.62 0.62 0 0 1 0.1 -0.5Z'),
    P('sun', 'Sun', star(12, 0.62)),
    P('flower', 'Flower', polar((t) => 0.3 + 0.2 * Math.cos(5 * t))),
    P('cloud', 'Cloud', 'M-0.35 0.3A0.2 0.2 0 0 1 -0.38 -0.05A0.22 0.22 0 0 1 -0.05 -0.2A0.25 0.25 0 0 1 0.35 -0.05A0.18 0.18 0 0 1 0.35 0.3Z', 1.5),
    P('mountain', 'Mountains', 'M-0.5 0.4L-0.15 -0.3L0.05 0.05L0.2 -0.15L0.5 0.4Z', 1.5),
    P('check', 'Check mark', poly([[-0.5, 0.05], [-0.33, -0.12], [-0.12, 0.1], [0.33, -0.4], [0.5, -0.23], [-0.12, 0.45]])),
  ] },
  { id: 'type', name: 'Letters and numbers', items: [
    { id: 't-classic', name: 'Serif text', shape: 'text', text: 'Aa', font: 'classic', aspect: 1.4 },
    { id: 't-varsity', name: 'Varsity text', shape: 'text', text: 'VARSITY', font: 'varsity', aspect: 3 },
    { id: 't-script', name: 'Script text', shape: 'text', text: 'Script', font: 'script', aspect: 2.4 },
    { id: 't-block', name: 'Block text', shape: 'text', text: 'BLOCK', font: 'block', aspect: 2.6 },
    { id: 't-mono', name: 'Mono text', shape: 'text', text: 'MONO', font: 'mono', aspect: 2.6 },
    { id: 'n-23', name: 'Number', shape: 'text', text: '23', font: 'varsity', aspect: 1.2 },
    { id: 'n-1', name: 'Number, block', shape: 'text', text: '07', font: 'block', aspect: 1.2 },
    { id: 'l-a', name: 'Letter', shape: 'text', text: 'A', font: 'classic', aspect: 1 },
    { id: 'l-ab', name: 'Monogram', shape: 'text', text: 'AB', font: 'script', aspect: 1.5 },
    { id: 'l-est', name: 'Year', shape: 'text', text: 'EST. 2026', font: 'classic', aspect: 3.4 },
  ] },
];
export const ALL_ITEMS = LIBRARY.flatMap((g) => g.items);
