// Body meshes (display mesh plus the collision grid) are slow to build: a few seconds on a PC, longer on an iPad.
// They are kept in IndexedDB between visits, keyed by the body measurements and the worker build (the hashed
// worker file name changes whenever the meshing code does), so reopening the app starts draping right away.
import type { BodyMesh } from '../three/mesher';

const DB = 'techit-body', STORE = 'mesh', KEEP = 4;

function open(): Promise<IDBDatabase | null> {
  return new Promise((res) => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
      r.onblocked = () => res(null);
    } catch { res(null); }
  });
}

let db: Promise<IDBDatabase | null> | null = null;
const getDb = () => (db ??= open());

/** cache only in a production build, whose worker file name carries a content hash */
export function cacheVersion(): string | null {
  const url = typeof location !== 'undefined' ? location.pathname : '';
  return /-[A-Za-z0-9_-]{8}\.js$/.test(url) ? url : null;
}

const withTimeout = <T,>(p: Promise<T>, ms: number, v: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(v), ms))]);

export async function loadBody(key: string): Promise<BodyMesh | null> {
  const ver = cacheVersion();
  if (!ver) return null;
  return withTimeout((async () => {
    const d = await getDb();
    if (!d) return null;
    return new Promise<BodyMesh | null>((res) => {
      try {
        const r = d.transaction(STORE, 'readonly').objectStore(STORE).get(ver + '|' + key);
        r.onsuccess = () => res((r.result as { mesh: BodyMesh } | undefined)?.mesh ?? null);
        r.onerror = () => res(null);
      } catch { res(null); }
    });
  })(), 3000, null);
}

/** store a copy (call before the buffers are transferred away) and keep only the latest few bodies */
export async function saveBody(key: string, m: BodyMesh): Promise<void> {
  const ver = cacheVersion();
  if (!ver) return;
  const d = await getDb();
  if (!d) return;
  try {
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.put({ mesh: m, at: Date.now() }, ver + '|' + key);
    const all = st.getAllKeys();
    all.onsuccess = () => {
      const keys = all.result as string[];
      // other builds' entries go; of this build's, the oldest beyond KEEP go
      for (const k of keys) if (!k.startsWith(ver + '|')) st.delete(k);
      const mine = keys.filter((k) => k.startsWith(ver + '|') && k !== ver + '|' + key);
      if (mine.length >= KEEP) mine.slice(0, mine.length - KEEP + 1).forEach((k) => st.delete(k));
    };
  } catch { /* quota or private mode: just rebuild next time */ }
}
