// Colour block tool: turn the shape being drawn on the chart into blocks on the piece it was drawn on.
import { useStore } from '../store';
import { chartEntries } from './multi';
import { toSource } from './sides';
import { nearestOnOutline, type Pt } from '../lib/geometry';
import { presetEdgeTrims, segmentEdgeTrim, type EdgePreset } from '../data/edgeTrim';
import type { Entry } from './sides';
import { presetBlocks, shapeBlocks, type BlockPreset } from '../data/colourBlock';

const look = () => { const c = useStore.getState().colourBlock; return { colour: c.colour, sheen: c.sheen, look: c.look }; };

export function commitBlockDraft() {
  const st = useStore.getState();
  const d = st.blockDraft;
  if (!d) return;
  const en = chartEntries(st.project.garment, st.project.pieces, st.showBothSides, st.chartFace).find((e) => e.key === d.key);
  st.set({ blockDraft: null });
  if (!en) return;
  const local = d.pts.map((q) => toSource(en, q));
  let poly = local;
  if (d.rect) {
    const [a, b] = local;
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
    if (x1 - x0 < 0.3 || y1 - y0 < 0.3) return;
    poly = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  } else if (local.length < 3) return;
  st.addColourBlocks(shapeBlocks(st.project.garment, st.project.pieces, en.src.id, poly, d.rect, look(), { total: st.totalSymmetry, symmetry: st.symmetry, bothFaces: st.colourBlock.bothFaces }));
}

export function addPresetBlock(preset: BlockPreset, h: number) {
  const st = useStore.getState();
  st.addColourBlocks(presetBlocks(st.project.garment, st.project.pieces, preset, h, look(), { total: st.totalSymmetry, symmetry: st.symmetry }, st.selPiece));
}

const edgeSettings = () => { const c = useStore.getState().colourBlock; return { method: c.method as 'thread' | 'binding' | 'piping', colour: c.colour, width: c.width, tex: c.tex, bothFaces: c.bothFaces }; };

/** a click on the chart: put the chosen edge method on the outline segment nearest the click (within 24 px) */
export function commitEdgeClick(en: Entry, world: Pt, k: number) {
  const st = useStore.getState();
  const n = nearestOnOutline(en.src.points, toSource(en, world));
  if (n.d * k > 24) return;
  st.addEdgeTrims([segmentEdgeTrim(en.src, n.seg, edgeSettings())]);
}

export function addPresetEdge(preset: EdgePreset) {
  const st = useStore.getState();
  st.addEdgeTrims(presetEdgeTrims(st.project.pieces, preset, edgeSettings(), st.totalSymmetry, st.selPiece));
}
