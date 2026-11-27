import type { Project } from '../store';
import { useStore } from '../store';
import { migrateGarment } from '../data/catalog';

// Local project storage (browser). Cloud sync with accounts comes in a later phase.

const KEY = 'techit.projects.v2';
const LAST = 'techit.last.v2';

// the parsed store is kept in memory, so an autosave serialises once instead of parsing every project first;
// another tab writing the same storage drops the copy
let cache: Record<string, Project> | null = null;
if (typeof window !== 'undefined') window.addEventListener('storage', (e) => { if (e.key === KEY || e.key === null) cache = null; });

function readAll(): Record<string, Project> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, Project>;
  } catch {
    cache = {};
  }
  return cache;
}

function writeAll(all: Record<string, Project>) {
  cache = all;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* storage full or blocked */
  }
}

export function listProjects(): Project[] {
  return Object.values(readAll()).map((p) => ({ ...p, garment: migrateGarment(p.garment) })).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveProject(p: Project) {
  writeAll({ ...readAll(), [p.id]: p });
  try {
    localStorage.setItem(LAST, p.id);
  } catch {
    /* ignore */
  }
}

export function deleteProject(id: string) {
  const all = { ...readAll() };
  delete all[id];
  writeAll(all);
}

export function lastProject(): Project | null {
  try {
    const id = localStorage.getItem(LAST);
    return id ? readAll()[id] ?? null : null;
  } catch {
    return null;
  }
}

/** Restore the last project and autosave every change. */
export function initPersistence() {
  const last = lastProject();
  if (last) useStore.getState().loadProject(last);
  let timer: number | undefined;
  let idle: number | undefined;
  // the placeholder of a fresh install counts as already handled; it is only saved once it is edited
  let lastSaved = useStore.getState().project.updatedAt;
  const ric = (window as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  const flush = () => {
    window.clearTimeout(timer);
    timer = undefined;
    const p = useStore.getState().project;
    if (p.updatedAt === lastSaved) return;
    lastSaved = p.updatedAt;
    saveProject(p);
    window.dispatchEvent(new Event('tps-saved'));
  };
  // save once edits pause, when the browser is idle (not in the middle of a drag frame)
  useStore.subscribe((s, prev) => {
    if (s.screen !== prev.screen) { flush(); return; } // Home lists saved projects: it must see the last edit
    if (s.project === prev.project || s.project.updatedAt === lastSaved) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (ric) idle = ric(flush, { timeout: 1500 });
      else flush();
    }, 500);
  });
  // never lose the last edit when the tab is hidden or closed
  const now = () => { if (idle !== undefined) (window as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback?.(idle); flush(); };
  window.addEventListener('pagehide', now);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') now(); });
  // a brand new install keeps its placeholder project unsaved until it is edited, so Home starts empty
  if (last) saveProject(useStore.getState().project);
}
