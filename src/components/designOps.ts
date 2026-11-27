// Layer actions of the Design artboard that more than one place needs (the layer list and the right click menu).
import { useStore } from '../store';
import { uid } from '../lib/units';

const sd = () => useStore.getState();

export function dupLayers(ids: string[]) {
  const copies = sd().design.layers.filter((l) => ids.includes(l.id)).map((l) => ({ ...l, id: uid(), x: l.x + 0.5, y: l.y + 0.5, name: l.name ? `${l.name} copy` : undefined }));
  sd().setDesign((d) => ({ layers: [...d.layers, ...copies] }));
  sd().set({ designSel: copies.map((c) => c.id) });
}
export function delLayers(ids: string[]) { sd().setDesign((d) => ({ layers: d.layers.filter((l) => !ids.includes(l.id)) })); sd().set({ designSel: [] }); }
export function lockLayers(ids: string[], locked: boolean) { sd().setDesign((d) => ({ layers: d.layers.map((l) => (ids.includes(l.id) ? { ...l, locked } : l)) })); }
export function moveLayers(ids: string[], dir: -1 | 1) {
  sd().setDesign((d) => {
    const next = [...d.layers];
    const idx = next.map((l, i) => (ids.includes(l.id) ? i : -1)).filter((i) => i >= 0);
    if (dir > 0) for (const i of idx.reverse()) { if (i + 1 < next.length && !ids.includes(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]]; }
    else for (const i of idx) { if (i > 0 && !ids.includes(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]]; }
    return { layers: next };
  });
}
export function groupLayers(ids: string[]) {
  if (ids.length < 2) return;
  const gid = uid();
  sd().setDesign((d) => {
    const top = Math.max(...d.layers.map((l, i) => (ids.includes(l.id) ? i : -1)));
    const mine = d.layers.filter((l) => ids.includes(l.id)).map((l) => ({ ...l, group: gid }));
    const rest = d.layers.filter((l) => !ids.includes(l.id));
    const at = Math.min(rest.length, top - mine.length + 1);
    return { layers: [...rest.slice(0, at), ...mine, ...rest.slice(at)], groups: [...d.groups, { id: gid, name: `Group ${d.groups.length + 1}` }] };
  });
}
