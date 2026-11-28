// Your motifs: motifs the person saved, shared by every project on this device (localStorage, so no server).
// Each entry keeps the motif (picture shrunk to fit about 1 MB, or traced shapes), how it repeats and its colour edits.
import type { FabricPattern } from '../data/fabrics';
import { withPatternDefaults } from '../data/patterns';

const KEY = 'tech-it.motifs.v1';
/** one saved motif stays under about 1 MB of text, the whole library under about 4 MB (browsers allow about 5 MB) */
export const MOTIF_MAX_CHARS = 1_000_000;
export const LIBRARY_MAX_CHARS = 4_000_000;

export interface SavedMotif { id: string; name: string; savedAt: number; pattern: FabricPattern }

const store = (): Storage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

export function listMotifs(): SavedMotif[] {
  try {
    const raw = store()?.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return arr.filter((m) => m && typeof m.id === 'string' && m.pattern?.id === 'custom').map((m) => ({ id: m.id, name: String(m.name ?? 'Motif').slice(0, 60), savedAt: Number(m.savedAt) || 0, pattern: withPatternDefaults(m.pattern) }));
  } catch { return []; }
}

export type SaveResult = { ok: true; motif: SavedMotif } | { ok: false; message: string };

const write = (list: SavedMotif[]): string | null => {
  const s = store();
  if (!s) return 'Saving is not available in this browser.';
  const text = JSON.stringify(list);
  if (text.length > LIBRARY_MAX_CHARS) return 'Your motif library is full. Delete a motif you no longer use, then try again.';
  try { s.setItem(KEY, text); return null; } catch { return 'This device has no room left to save motifs. Delete a motif you no longer use, then try again.'; }
};

/** Save a custom pattern. A picture larger than about 1 MB must be shrunk first (see shrinkMotifImage in PatternTools). */
export function saveMotif(name: string, pattern: FabricPattern): SaveResult {
  if (pattern.id !== 'custom' || !pattern.motif) return { ok: false, message: 'Choose a motif first.' };
  const p = withPatternDefaults(pattern);
  if (p.motif?.source) delete p.motif.source; // the saved copy keeps the edited picture only
  if (JSON.stringify(p).length > MOTIF_MAX_CHARS) return { ok: false, message: 'This motif is too large to save. Use a smaller picture.' };
  const motif: SavedMotif = { id: Math.random().toString(36).slice(2, 10), name: name.trim().slice(0, 60) || 'My motif', savedAt: Date.now(), pattern: p };
  const err = write([motif, ...listMotifs()]);
  return err ? { ok: false, message: err } : { ok: true, motif };
}

export function renameMotif(id: string, name: string): string | null {
  const nm = name.trim().slice(0, 60);
  return nm ? write(listMotifs().map((m) => (m.id === id ? { ...m, name: nm } : m))) : null;
}

export function deleteMotif(id: string): void { write(listMotifs().filter((m) => m.id !== id)); }
