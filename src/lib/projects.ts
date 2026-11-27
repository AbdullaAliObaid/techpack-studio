import type { BodyPreset, Project } from '../store';
import { useStore } from '../store';
import { migrateGarment } from '../data/catalog';
import { FEMALE_BODY, MALE_BODY } from '../three/body';
import { uid } from './units';

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

/** Projects that came from someone else's shared file. */
export const listImported = () => listProjects().filter((p) => p.imported);

// ---- body presets: saved sets of measurements; Male and Female are built in and cannot be changed or deleted ----

const BODY_KEY = 'techit.bodies.v1';
export const BUILTIN_BODIES: BodyPreset[] = [
  { id: 'builtin-male', name: 'Male', body: MALE_BODY, updatedAt: 0 },
  { id: 'builtin-female', name: 'Female', body: FEMALE_BODY, updatedAt: 0 },
];
export const isBuiltinBody = (id: string) => BUILTIN_BODIES.some((b) => b.id === id);

function readBodies(): BodyPreset[] {
  try {
    const v = JSON.parse(localStorage.getItem(BODY_KEY) || '[]');
    return Array.isArray(v) ? v.filter((b: BodyPreset) => b && typeof b.id === 'string' && !isBuiltinBody(b.id)) : [];
  } catch {
    return [];
  }
}
function writeBodies(list: BodyPreset[]) {
  try { localStorage.setItem(BODY_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
}

/** Built-ins first (Male, Female), then the saved ones, newest first. */
export function listBodyPresets(): BodyPreset[] {
  return [...BUILTIN_BODIES, ...readBodies().sort((a, b) => b.updatedAt - a.updatedAt)];
}
/** Save measurements under a name; with an id of a saved preset it is updated, otherwise a new one is added. */
export function saveBodyPreset(name: string, body: BodyPreset['body'], id?: string): BodyPreset {
  const all = readBodies();
  const keep = id && !isBuiltinBody(id) ? id : uid() + uid();
  const preset: BodyPreset = { id: keep, name: name.trim().slice(0, 60) || 'Untitled body', body: { ...body }, updatedAt: Date.now() };
  writeBodies([...all.filter((b) => b.id !== keep), preset]);
  return preset;
}
/** Rename a saved preset; false for a built-in or an unknown id. */
export function renameBodyPreset(id: string, name: string): boolean {
  const all = readBodies();
  const b = all.find((q) => q.id === id);
  if (!b || !name.trim()) return false;
  writeBodies(all.map((q) => (q.id === id ? { ...q, name: name.trim().slice(0, 60), updatedAt: Date.now() } : q)));
  return true;
}
/** Delete a saved preset; false for a built-in or an unknown id. */
export function deleteBodyPreset(id: string): boolean {
  const all = readBodies();
  if (isBuiltinBody(id) || !all.some((q) => q.id === id)) return false;
  writeBodies(all.filter((q) => q.id !== id));
  return true;
}
/** Add presets from a shared file under fresh ids. */
export function saveImportedBodies(list: BodyPreset[]): BodyPreset[] {
  const now = Date.now();
  const added = list.filter((b) => !isBuiltinBody(b.id)).map((b) => ({ ...b, id: uid() + uid(), updatedAt: now }));
  if (added.length) writeBodies([...readBodies(), ...added]);
  return added;
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
