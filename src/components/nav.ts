import { useStore, type NewFlow, type Project } from '../store';
import { freshProject } from '../store';
import { deleteProject, listProjects, saveProject } from '../lib/projects';
import { CATALOG, CATEGORIES, type Category, type Style } from '../data/catalog';
import { installOutfitFallback, leaveOutfit, outfitApi } from './uiData';

/* Navigation between Home, the new project flow and the editor, plus the few helpers they share. */

// The placeholder project of a fresh install is not saved until the person edits it.
const first = useStore.getState().project;
let pristine = { id: first.id, t: first.updatedAt };

/** Make the open project count as untouched again (after its saved copy is deleted). */
export function resetOpenProject() {
  const p = freshProject('jacket', 'My first jacket');
  useStore.getState().loadProject(p);
  pristine = { id: p.id, t: useStore.getState().project.updatedAt };
}

/** Is the open project stored on this device? */
export function openProjectSaved(): boolean {
  const p = useStore.getState().project;
  return listProjects().some((q) => q.id === p.id);
}

/** Write the open project to storage now (autosave waits 400 ms). */
export function flushSave() {
  const p = useStore.getState().project;
  const untouched = p.id === pristine.id && p.updatedAt === pristine.t;
  if (untouched && !openProjectSaved()) return;
  saveProject(p);
  window.dispatchEvent(new Event('tps-saved'));
}

export function goHome() {
  flushSave();
  useStore.getState().setScreen('home');
}

export function openNewFlow(mode: NewFlow['mode'], from: NewFlow['from']) {
  if (from === 'editor') flushSave();
  useStore.getState().openNew(mode, from);
}

export function openProject(p: Project) {
  leaveOutfit();
  const st = useStore.getState();
  if (st.project.id !== p.id) {
    flushSave();
    st.loadProject(p);
  }
  st.setScreen('editor');
}

export function removeProject(id: string) {
  deleteProject(id);
  if (useStore.getState().project.id === id) resetOpenProject();
}

export function duplicateProject(p: Project): Project {
  if (useStore.getState().project.id === p.id) flushSave();
  const src = listProjects().find((q) => q.id === p.id) ?? p;
  const copy: Project = { ...structuredClone(src), id: Math.random().toString(36).slice(2, 10), name: `${src.name} copy`, updatedAt: Date.now() };
  saveProject(copy);
  return copy;
}

export function renameProject(p: Project, name: string) {
  const clean = name.trim();
  if (!clean || clean === p.name) return;
  const st = useStore.getState();
  if (st.project.id === p.id) {
    st.rename(clean);
    flushSave();
  } else {
    saveProject({ ...p, name: clean });
  }
}

/* ---------- the picker's categories ---------- */

export interface PickGroup { id: string; name: string; blurb: string; icon: Style['id']; styles: Style[] }

const GROUP_COPY: Record<string, { name?: string; blurb: string; icon: Style['id'] }> = {
  tops: { blurb: 'Tees, polos and shirts', icon: 'basic-tee' },
  bottoms: { blurb: 'Jeans, shorts and sweatpants', icon: 'jeans' },
  outerwear: { name: 'Jackets and outerwear', blurb: 'Layers for outside', icon: 'jacket' },
  headwear: { blurb: 'Caps and hats', icon: 'cap' },
};

/** Catalog categories, with the jacket family lifted out of Tops into its own group. */
export function pickGroups(): PickGroup[] {
  const out: PickGroup[] = [];
  for (const c of CATEGORIES as { id: Category; name: string }[]) {
    const inCat = CATALOG.filter((s) => s.category === c.id);
    const outer = inCat.filter((s) => s.family === 'jacket');
    const rest = inCat.filter((s) => s.family !== 'jacket');
    out.push({ id: c.id, name: c.name, ...GROUP_COPY[c.id], styles: rest });
    if (outer.length) out.push({ id: 'outerwear', ...GROUP_COPY.outerwear, name: GROUP_COPY.outerwear.name!, styles: outer });
  }
  // keep the order Tops, Bottoms, Jackets and outerwear, Headwear
  const order = ['tops', 'bottoms', 'outerwear', 'headwear'];
  return out.filter((g) => g.styles.length).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}

/** "Just now", "12 min ago", "Yesterday", or a date. */
export function since(ts: number, now = Date.now()): string {
  const m = Math.round((now - ts) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = new Date(ts), n = new Date(now);
  const days = Math.round((new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' });
}

/** Open a saved outfit in the editor. */
export function openOutfitNav(id: string) {
  installOutfitFallback();
  flushSave();
  outfitApi().openOutfit(id);
  useStore.getState().setScreen('editor');
}
