// Colour block tool: turn the shape being drawn on the chart into blocks on the piece it was drawn on.
import { useStore } from '../store';
import { chartEntries } from './multi';
import { toSource } from './sides';
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
  st.addColourBlocks(shapeBlocks(st.project.garment, st.project.pieces, en.src.id, poly, d.rect, look(), { total: st.totalSymmetry, symmetry: st.symmetry }));
}

export function addPresetBlock(preset: BlockPreset, h: number) {
  const st = useStore.getState();
  st.addColourBlocks(presetBlocks(st.project.garment, st.project.pieces, preset, h, look(), { total: st.totalSymmetry, symmetry: st.symmetry }, st.selPiece));
}
