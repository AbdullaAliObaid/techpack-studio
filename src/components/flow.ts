// The "New piece" flow: templates, opening it, and finishing it with addCustomPiece.
import { useStore, type PenPoint, type PieceFlow } from '../store';
import { centroid, outlineLength, samplePoly, signedArea, type PPoint } from '../lib/geometry';
import { outlinePolygon } from '../lib/shapes';
import type { EdgeRef, Placement } from '../data/edits';
import { copiesOf } from './sides';

export type TemplateId = 'rect' | 'rounded' | 'circle' | 'pocket' | 'strap' | 'panel' | 'triangle';
export interface TemplateDef { id: TemplateId; label: string; name: string; w: number; h: number; attach: 'patch' | 'sewn' }
export const TEMPLATES: TemplateDef[] = [
  { id: 'rect', label: 'Rectangle', name: 'Rectangle', w: 10, h: 8, attach: 'patch' },
  { id: 'rounded', label: 'Rounded', name: 'Rounded rectangle', w: 10, h: 8, attach: 'patch' },
  { id: 'circle', label: 'Circle', name: 'Circle', w: 8, h: 8, attach: 'patch' },
  { id: 'pocket', label: 'Pocket', name: 'Pocket', w: 13, h: 14, attach: 'patch' },
  { id: 'strap', label: 'Belt strap', name: 'Belt strap', w: 2.5, h: 9, attach: 'patch' },
  { id: 'panel', label: 'Panel', name: 'Panel', w: 14, h: 14, attach: 'sewn' },
  { id: 'triangle', label: 'Triangle', name: 'Triangle', w: 8, h: 8, attach: 'patch' },
];

export function templatePoints(id: TemplateId, w: number, h: number): PenPoint[] {
  const poly = (pts: { x: number; y: number }[], smooth = false): PenPoint[] => pts.map((p) => ({ x: p.x, y: p.y, smooth }));
  switch (id) {
    case 'rounded': return poly(outlinePolygon('rounded', w, h));
    case 'strap': return poly(outlinePolygon('rounded', w, h));
    case 'pocket': return poly(outlinePolygon('pointed', w, h));
    case 'circle': return poly(Array.from({ length: 8 }, (_, i) => ({ x: (w / 2) * Math.cos((i / 8) * 2 * Math.PI), y: (h / 2) * Math.sin((i / 8) * 2 * Math.PI) })), true);
    case 'triangle': return poly([{ x: 0, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }]);
    default: return poly(outlinePolygon('rect', w, h));
  }
}

/** The outline the way the piece is stored: clockwise on screen. Edge numbers in the flow refer to this order. */
export function normalizedShape(shape: PenPoint[]): PenPoint[] {
  const arr = shape.map((p) => ({ ...p }));
  return signedArea(arr) < 0 ? arr.reverse() : arr;
}
export const asPoints = (shape: PenPoint[]): PPoint[] => shape.map((p, i) => ({ id: `n${i}`, x: p.x, y: p.y, smooth: p.smooth, mirror: null }));
export const ownEdgeLength = (shape: PenPoint[], edge: number) => {
  const pts = asPoints(normalizedShape(shape));
  return outlineLength(pts, pts[edge % pts.length].id, pts[(edge + 1) % pts.length].id);
};

export function openPieceFlow(shape?: PenPoint[]) {
  const st = useStore.getState();
  const hosts = st.project.pieces.filter((p) => p.role !== 'custom');
  const host = hosts.find((p) => p.id === st.selPiece) ?? hosts.find((p) => p.role === 'front') ?? hosts[0];
  const base = host?.fabric ?? st.project.pieces[0].fabric;
  const t = TEMPLATES[3];
  const copies = host ? copiesOf(st.project.garment, host) : 1;
  const flow: PieceFlow = {
    step: 1,
    shape: shape ?? templatePoints(t.id, t.w, t.h),
    source: shape ? 'pen' : 'template',
    template: t.id, tw: t.w, th: t.h,
    drawing: false,
    name: shape ? 'New piece' : t.name,
    fabricMode: 'same', fabric: { ...base }, cut: 1,
    attach: 'patch', host: host?.id ?? '',
    side: copies === 2 && st.showBothSides ? st.selInstance ?? 0 : null,
    ownEdge: 0, hostEdge: null, picking: false,
  };
  useStore.setState({ pieceFlow: flow, tool: 'select', penDraft: [], seamDraft: { a: null, b: null, flip: false } });
}

export function finishPieceFlow() {
  const st = useStore.getState();
  const f = st.pieceFlow;
  if (!f?.shape) return;
  const arr = normalizedShape(f.shape);
  const c = centroid(arr);
  const local = arr.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
  const hostPiece = st.project.pieces.find((p) => p.id === f.host);
  const hc = hostPiece ? centroid(samplePoly(hostPiece.points)) : { x: 0, y: 0 };
  // Placement has no side field in the shared contract yet; the extra field is kept in the saved project
  const placement = (f.attach === 'patch'
    ? { mode: 'patch', hostPieceId: f.host, x: hc.x, y: hc.y, rotation: 0, ...(f.side !== null ? { instance: f.side } : {}) }
    : { mode: 'sewn' }) as Placement;
  const name = f.name.trim() || 'New piece';
  const id = st.addCustomPiece(name, local, placement);
  const made = useStore.getState().project.pieces.find((p) => p.id === id);
  if (!made) return;
  st.updatePiece(id, { points: made.points.map((q, i) => ({ ...q, smooth: arr[i]?.smooth ?? false })), cut: f.cut, ...(f.fabricMode === 'pick' ? { fabric: { ...f.fabric } } : {}) });
  if (f.attach === 'sewn' && f.hostEdge) {
    const n = made.points.length;
    const own: EdgeRef = { pieceId: id, fromId: made.points[f.ownEdge % n].id, toId: made.points[(f.ownEdge + 1) % n].id };
    st.addCustomSeam({ a: f.hostEdge, b: own });
  }
  useStore.setState((s) => ({
    pieceFlow: null, penDraft: [], tool: 'select', fitToken: s.fitToken + 1, inspectorTab: 'construction', selAttachment: null,
    seamHint: f.attach === 'sewn' && !f.hostEdge ? `${name} is ready to be sewn in. Use Join seams to pick its edges.` : null,
  }));
}
