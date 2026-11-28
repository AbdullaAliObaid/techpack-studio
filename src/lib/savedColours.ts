// Colours the user saved for later, shared by every project on this device (localStorage, key techit.savedColours).
// Reading never throws: a blocked, full or damaged store gives an empty palette that still works for the session.

export interface SavedColour { hex: string; name?: string }

export const SAVED_COLOURS_KEY = 'techit.savedColours';
export const MAX_SAVED_COLOURS = 48;
const HEX = /^#[0-9a-f]{6}$/i;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** What the store holds, cleaned: valid colours only, no repeats, at most MAX_SAVED_COLOURS. */
export function cleanColours(raw: unknown): SavedColour[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: SavedColour[] = [];
  for (const r of raw) {
    const hex = typeof r === 'string' ? r : r && typeof r === 'object' ? (r as SavedColour).hex : undefined;
    if (typeof hex !== 'string' || !HEX.test(hex) || seen.has(hex.toLowerCase())) continue;
    seen.add(hex.toLowerCase());
    const name = r && typeof r === 'object' && typeof (r as SavedColour).name === 'string' ? (r as SavedColour).name!.trim().slice(0, 24) : '';
    out.push({ hex: hex.toLowerCase(), ...(name ? { name } : {}) });
    if (out.length >= MAX_SAVED_COLOURS) break;
  }
  return out;
}

let memory: SavedColour[] = []; // the session's copy when storage cannot be used
const listeners = new Set<() => void>();
let cache: { json: string | null; list: SavedColour[] } | null = null;

export function loadColours(store: Store | null = defaultStore()): SavedColour[] {
  if (!store) return memory;
  let json: string | null;
  try { json = store.getItem(SAVED_COLOURS_KEY); } catch { return memory; }
  const shared = store === defaultStore();
  if (shared && cache && cache.json === json) return cache.list;
  let list: SavedColour[] = [];
  try { list = json ? cleanColours(JSON.parse(json)) : []; } catch { /* damaged: start again */ }
  if (shared) cache = { json, list };
  return list;
}

export function saveColours(list: SavedColour[], store: Store | null = defaultStore()): SavedColour[] {
  const clean = cleanColours(list);
  memory = clean;
  try { store?.setItem(SAVED_COLOURS_KEY, JSON.stringify(clean)); } catch { /* storage full or blocked: kept for this session */ }
  cache = null;
  listeners.forEach((f) => f());
  return clean;
}

/** Adds a colour at the end (no repeats; a repeat only gains a name). */
export function addColour(hex: string, name?: string, store?: Store | null): SavedColour[] {
  const cur = loadColours(store);
  const h = hex.toLowerCase();
  if (!HEX.test(h)) return cur;
  const nm = name?.trim();
  const has = cur.some((c) => c.hex === h);
  return saveColours(has ? cur.map((c) => (c.hex === h && nm ? { ...c, name: nm } : c)) : [...cur, { hex: h, ...(nm ? { name: nm } : {}) }], store);
}

export function removeColour(hex: string, store?: Store | null): SavedColour[] {
  return saveColours(loadColours(store).filter((c) => c.hex !== hex.toLowerCase()), store);
}

/** Moves the colour at index `from` to index `to`. */
export function moveColour(from: number, to: number, store?: Store | null): SavedColour[] {
  const cur = [...loadColours(store)];
  if (from === to || from < 0 || from >= cur.length || to < 0 || to >= cur.length) return cur;
  const [c] = cur.splice(from, 1);
  cur.splice(to, 0, c);
  return saveColours(cur, store);
}

/** For React: call the function when the palette changes (here or in another tab). Returns the unsubscribe. */
export function subscribeColours(f: () => void): () => void {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === SAVED_COLOURS_KEY) { cache = null; f(); } };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => { listeners.delete(f); if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage); };
}
