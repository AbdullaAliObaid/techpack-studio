// Artwork against trims: new prints and embroidery go under pockets, patches and tags (see Attachment.order). When a
// trim is placed over artwork that is already there, say so and offer to bring the artwork to the front.
import type { Attachment } from '../data/edits';
import { useStore } from '../store';
import { notify } from './notify';

const ART = ['print', 'embroidery'];
const TRIM = ['pocket', 'patch', 'applique', 'strap', 'label'];
export const isArtwork = (a: Pick<Attachment, 'kind'>) => ART.includes(a.kind);
export const isClothTrim = (a: Pick<Attachment, 'kind'>) => TRIM.includes(a.kind);

/** New artwork starts under the trims. */
export const withOrder = <T extends Omit<Attachment, 'id'>>(a: T): T => (isArtwork(a) && !a.order ? { ...a, order: 'under' } : a);

/** Call after a trim is added: any artwork on the same piece and face that it covers gets a notice. */
export function noticeCoveredArtwork(id: string): void {
  const all = useStore.getState().project.edits?.attachments ?? [];
  const t = all.find((a) => a.id === id);
  if (!t || !isClothTrim(t) || t.block) return;
  const hit = all.filter((a) => a.id !== id && isArtwork(a) && !a.block && a.pieceId === t.pieceId && (a.face ?? 'outside') === (t.face ?? 'outside') && a.layers.length > 0
    && Math.abs(a.x - t.x) < (a.w + t.w) / 2 && Math.abs(a.y - t.y) < (a.h + t.h) / 2);
  if (!hit.length) return;
  const under = hit.filter((a) => a.order !== 'over');
  const name = t.name.toLowerCase();
  if (under.length) {
    notify({ id: `cover-${id}`, title: `The ${name} covers a design`, body: `This ${name} sits over a design on the same piece, so the design is hidden where they meet, like on real cloth. Keep it under, or put the design on top so it runs across the ${name}.`, tone: 'info', ok: 'Keep under',
      action: { label: 'Put design on top', run: () => { for (const a of under) useStore.getState().updateAttachment(a.id, { order: 'over' }); } } });
  } else {
    notify({ id: `cover-${id}`, title: `A design runs over the ${name}`, body: `The design on this piece is set to go over trims, so it is printed across the ${name}. Put it under if you want the ${name} to cover it.`, tone: 'info', ok: 'Keep on top',
      action: { label: 'Put design under', run: () => { for (const a of hit) useStore.getState().updateAttachment(a.id, { order: 'under' }); } } });
  }
}

/** Drawing rank on the chart: artwork set to go under comes first, artwork set to go over comes last, everything else keeps its order. */
export const layerRank = (a: Pick<Attachment, 'kind' | 'order'>) => (isArtwork(a) ? (a.order === 'under' ? 0 : a.order === 'over' ? 2 : 1) : 1);
