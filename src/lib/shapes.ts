// Shape library for emblems, prints and attachment outlines. Every shape is an SVG path in a unit box
// centred on (0,0) spanning -0.5..0.5, so it can be scaled to any w x h. Used by the 2D pattern chart
// (SVG), the emblem editor and the 3D print textures (Canvas Path2D accepts the same strings).

import type { Outline, ShapeId } from '../data/edits';

function poly(pts: [number, number][]) {
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(4)} ${y.toFixed(4)}`).join('') + 'Z';
}
function star(n: number, inner: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? 0.5 * inner : 0.5;
    const a = -Math.PI / 2 + (i * Math.PI) / n;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return poly(pts);
}
function ngon(n: number, rot = 0) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * 2 * Math.PI) / n;
    pts.push([0.5 * Math.cos(a), 0.5 * Math.sin(a)]);
  }
  return poly(pts);
}
const circle = 'M0.5 0A0.5 0.5 0 1 1 -0.5 0A0.5 0.5 0 1 1 0.5 0Z';

export const SHAPES: Record<ShapeId, { name: string; d: string }> = {
  rect: { name: 'Square', d: poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) },
  rounded: { name: 'Rounded', d: 'M-0.35 -0.5H0.35Q0.5 -0.5 0.5 -0.35V0.35Q0.5 0.5 0.35 0.5H-0.35Q-0.5 0.5 -0.5 0.35V-0.35Q-0.5 -0.5 -0.35 -0.5Z' },
  circle: { name: 'Circle', d: circle },
  triangle: { name: 'Triangle', d: poly([[0, -0.5], [0.5, 0.5], [-0.5, 0.5]]) },
  star: { name: 'Star', d: star(5, 0.42) },
  star4: { name: 'Sparkle', d: star(4, 0.3) },
  heart: { name: 'Heart', d: 'M0 0.45C-0.6 0.05 -0.55 -0.45 -0.25 -0.45C-0.1 -0.45 0 -0.32 0 -0.22C0 -0.32 0.1 -0.45 0.25 -0.45C0.55 -0.45 0.6 0.05 0 0.45Z' },
  hexagon: { name: 'Hexagon', d: ngon(6, Math.PI / 6) },
  shield: { name: 'Shield', d: 'M-0.5 -0.5H0.5V0Q0.5 0.35 0 0.5Q-0.5 0.35 -0.5 0Z' },
  chevron: { name: 'Chevron', d: poly([[-0.5, -0.1], [0, -0.5], [0.5, -0.1], [0.5, 0.2], [0, -0.2], [-0.5, 0.2]]) },
  stripe: { name: 'Stripe', d: poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) },
  bolt: { name: 'Bolt', d: poly([[0.1, -0.5], [-0.35, 0.05], [-0.02, 0.05], [-0.15, 0.5], [0.35, -0.08], [0.02, -0.08]]) },
  cross: { name: 'Cross', d: poly([[-0.15, -0.5], [0.15, -0.5], [0.15, -0.15], [0.5, -0.15], [0.5, 0.15], [0.15, 0.15], [0.15, 0.5], [-0.15, 0.5], [-0.15, 0.15], [-0.5, 0.15], [-0.5, -0.15], [-0.15, -0.15]]) },
  diamond: { name: 'Diamond', d: poly([[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]]) },
  ring: { name: 'Ring', d: circle + 'M0.32 0A0.32 0.32 0 1 0 -0.32 0A0.32 0.32 0 1 0 0.32 0Z' },
  text: { name: 'Text', d: '' },
};

export const OUTLINES: Record<Exclude<Outline, 'custom'>, string> = {
  rect: SHAPES.rect.d,
  rounded: SHAPES.rounded.d,
  pointed: poly([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.25], [0, 0.5], [-0.5, 0.25]]), // classic jeans back pocket
  circle,
  shield: SHAPES.shield.d,
};

/** Polygon (cm, centred) for an attachment outline, for meshing it as cloth. */
export function outlinePolygon(outline: Outline, w: number, h: number, custom?: { x: number; y: number }[], n = 48): { x: number; y: number }[] {
  if (outline === 'custom' && custom?.length) return custom;
  if (outline === 'circle') return Array.from({ length: n }, (_, i) => ({ x: (w / 2) * Math.cos((i / n) * 2 * Math.PI), y: (h / 2) * Math.sin((i / n) * 2 * Math.PI) }));
  if (outline === 'pointed') return [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.25], [0, 0.5], [-0.5, 0.25]].map(([x, y]) => ({ x: x * w, y: y * h }));
  if (outline === 'shield') {
    const pts: { x: number; y: number }[] = [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: 0 }];
    for (let i = 1; i < 12; i++) { const t = i / 12; pts.push({ x: (w / 2) * (1 - t), y: (h / 2) * Math.sin((t * Math.PI) / 2) }); }
    pts.push({ x: 0, y: h / 2 });
    for (let i = 1; i < 12; i++) { const t = i / 12; pts.push({ x: (-w / 2) * t, y: (h / 2) * Math.cos((t * Math.PI) / 2) }); }
    pts.push({ x: -w / 2, y: 0 });
    return pts;
  }
  if (outline === 'rounded') {
    const r = Math.min(w, h) * 0.15, pts: { x: number; y: number }[] = [];
    const c: [number, number, number][] = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
    for (const [cx, cy, a0] of c) for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); }
    return pts;
  }
  return [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }];
}

export const SHAPE_IDS = Object.keys(SHAPES) as ShapeId[];
