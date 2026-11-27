/// <reference types="vite/client" />
// Close-up photos of the live draped garment for the tech pack.
// The 3D view module (src/three/snapshots.ts, `captureDetails(requests, size)`) is picked up automatically when it
// exists; without it, or without a mounted 3D view, every request comes back empty and the PDF still exports (no photos).

export type ShotView = 'front' | 'back' | 'side';
export interface ShotTarget { pieceId: string; instance?: number; x: number; y: number; radiusCm: number; face?: 'outside' | 'inside' }
export interface ShotRequest { kind: 'attachment' | 'piece' | 'inside' | 'seam' | 'overview'; target?: ShotTarget; view?: ShotView }
/** One PNG data URL per request, in order; null where the shot could not be taken. */
export type ShotProvider = (requests: ShotRequest[], size: number) => Promise<(string | null | undefined)[]>;

let custom: ShotProvider | null = null;
/** Tests and tools can supply their own camera. */
export function setShotProvider(fn: ShotProvider | null) { custom = fn; }

let found: Promise<ShotProvider | null> | null = null;
function discover(): Promise<ShotProvider | null> {
  if (!found) {
    found = (async () => {
      let mods: Record<string, () => Promise<unknown>> = {};
      try { mods = import.meta.glob('../three/snapshots.ts') as Record<string, () => Promise<unknown>>; } catch { /* not running under vite */ }
      for (const load of Object.values(mods)) {
        try {
          const m = (await load()) as { captureDetails?: ShotProvider };
          if (typeof m.captureDetails === 'function') return m.captureDetails;
        } catch { /* module failed to load */ }
      }
      return null;
    })();
  }
  return found;
}

/** Take the shots; never throws. Photos come back aligned with the requests (null = none). */
export async function captureShots(requests: ShotRequest[], size = 480, provider?: ShotProvider): Promise<(string | null)[]> {
  const none = requests.map(() => null);
  if (!requests.length) return none;
  try {
    const fn = provider ?? custom ?? (await discover());
    if (!fn) return none;
    const res = await fn(requests, size);
    return requests.map((_, i) => (typeof res?.[i] === 'string' && res[i]!.startsWith('data:image') ? (res[i] as string) : null));
  } catch {
    return none;
  }
}
