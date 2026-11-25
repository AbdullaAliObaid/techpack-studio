import type { Project } from '../store';
import { useStore } from '../store';
import { migrateGarment } from '../data/catalog';

// Local project storage (browser). Cloud sync with accounts comes in a later phase.

const KEY = 'techit.projects.v2';
const LAST = 'techit.last.v2';

function readAll(): Record<string, Project> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, Project>) {
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
  const all = readAll();
  all[p.id] = p;
  writeAll(all);
  try {
    localStorage.setItem(LAST, p.id);
  } catch {
    /* ignore */
  }
}

export function deleteProject(id: string) {
  const all = readAll();
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
  let lastSaved = 0;
  useStore.subscribe((s) => {
    if (s.project.updatedAt === lastSaved) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      lastSaved = s.project.updatedAt;
      saveProject(useStore.getState().project);
      window.dispatchEvent(new Event('tps-saved'));
    }, 400);
  });
  saveProject(useStore.getState().project);
}
