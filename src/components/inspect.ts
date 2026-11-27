// Double click: open the inspector of the thing under the pointer, focused on its own properties.
// A piece opens Fabric on that piece; a trim or design opens its editor with the material section open.
import { useStore } from '../store';
import { rootPiece } from './editHelpers';
import type { Attachment } from '../data/edits';

const TRIM_KINDS = ['pocket', 'patch', 'strap', 'hardware', 'label'];

export function inspectAttachment(id: string) {
  const st = useStore.getState();
  const atts = st.project.edits?.attachments ?? [];
  const a = atts.find((q) => q.id === id);
  if (!a) return;
  st.setWorkspace(TRIM_KINDS.includes(a.kind) ? 'trims' : 'design');
  const root = rootPiece(atts, a);
  useStore.setState({ designMode: 'insert', designTab: 'edit', selAttachment: id, selLayer: null, selPiece: root ?? st.selPiece, selInstance: a.instance ?? null, tool: 'select' });
  // what a double click is for: type, size, colour and material open, placement tucked away
  for (const s of ['att-material', 'att-size']) st.setSection(s, true);
  st.setSection('att-placement', false);
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('att-focus')?.scrollIntoView({ block: 'start', behavior: 'smooth' })));
}

export function inspectPiece(pieceId: string, instance?: number | null) {
  const st = useStore.getState();
  if (!st.project.pieces.some((p) => p.id === pieceId)) return;
  st.setWorkspace('fabric');
  st.select(pieceId, null);
  useStore.setState({ selAttachment: null, selInstance: instance ?? null, fabricScope: 'piece' });
  st.setSection('gar-fabric', true);
}

/** the trim or design on a piece nearest to a spot (pattern cm), when the spot is on it */
export function attachmentAt(pieceId: string, instance: number, x: number, y: number): Attachment | null {
  const atts = useStore.getState().project.edits?.attachments ?? [];
  let best: Attachment | null = null, bd = Infinity;
  for (const a of atts) {
    if (a.pieceId !== pieceId || (a.instance !== undefined && a.instance !== instance)) continue;
    const d = Math.hypot(a.x - x, a.y - y), r = Math.max(a.w, a.h) / 2 + 0.6;
    if (d <= r && d < bd) { best = a; bd = d; }
  }
  return best;
}
