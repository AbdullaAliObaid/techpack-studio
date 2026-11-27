// Magnet for the Design artboard: a moving layer (or selection) lines up with the artboard edges, the centre lines and
// the edges and centres of the other layers. Pure functions on top of snapMove.
import { snapMove, type Guide, type P, type Target } from './snap';

export interface Box { x0: number; x1: number; y0: number; y1: number }
export interface BoxLayer { x: number; y: number; w: number; h: number; rotation: number }

/** the axis aligned box a rotated layer covers */
export function layerBox(l: BoxLayer): Box {
  const r = (l.rotation * Math.PI) / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const hw = (l.w * c + l.h * s) / 2, hh = (l.w * s + l.h * c) / 2;
  return { x0: l.x - hw, x1: l.x + hw, y0: l.y - hh, y1: l.y + hh };
}
export const unionBox = (b: Box[]): Box => ({ x0: Math.min(...b.map((q) => q.x0)), x1: Math.max(...b.map((q) => q.x1)), y0: Math.min(...b.map((q) => q.y0)), y1: Math.max(...b.map((q) => q.y1)) });

/** lines to line up with: the piece edges (artboard), the centre lines, and every other layer */
export function designTargets(artW: number, artH: number, others: Box[]): Target[] {
  const t: Target[] = [
    { x: 0, label: 'Centre' }, { y: 0, label: 'Centre' },
    { x: -artW / 2, label: 'Edge' }, { x: artW / 2, label: 'Edge' }, { y: -artH / 2, label: 'Edge' }, { y: artH / 2, label: 'Edge' },
  ];
  for (const b of others) {
    for (const x of [b.x0, (b.x0 + b.x1) / 2, b.x1]) t.push({ x, label: 'Layer' });
    for (const y of [b.y0, (b.y0 + b.y1) / 2, b.y1]) t.push({ y, label: 'Layer' });
  }
  return t;
}

/** the shift (and guides) that the moved box needs to line up; `thr` in the same units as the box */
export function snapBox(moved: Box, targets: Target[], thr: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [moved.x0, (moved.x0 + moved.x1) / 2, moved.x1], ys = [moved.y0, (moved.y0 + moved.y1) / 2, moved.y1];
  const pts: P[] = [];
  for (const x of xs) for (const y of ys) pts.push({ x, y });
  return snapMove(pts, targets, thr);
}
