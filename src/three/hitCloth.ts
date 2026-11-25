// Zustand-free hook for the UI: which pattern piece and pattern point (cm, piece local coords) is under a screen point.
// Prints.tsx registers the implementation while the 3D view is mounted.

export interface ClothHit { pieceId: string; x: number; y: number }

let impl: ((clientX: number, clientY: number) => ClothHit | null) | null = null;

export function registerHitCloth(f: typeof impl) { impl = f; }

/** Raycast the draped garment at a screen position. Null when the ray misses the cloth or the 3D view is not ready. */
export function hitCloth(clientX: number, clientY: number): ClothHit | null {
  return impl ? impl(clientX, clientY) : null;
}
