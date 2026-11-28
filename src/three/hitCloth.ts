// Hook for the UI (the store is only touched by focusHitMember): which pattern piece and pattern point (cm, piece local coords) is under a screen point.
// Prints.tsx registers the implementation while the 3D view is mounted.

import { useStore } from '../store';

export interface ClothHit {
  pieceId: string;
  /**
   * which placed copy of the piece was hit: 0 = right side (+x), 1 = left side, crown panels 0..5. Set
   * Attachment.instance to this to attach to that copy only. For a piece cut once it is 0.
   */
  instance: number;
  /** how many placed copies the piece has; instance is only worth storing when this is above 1 */
  copies: number;
  x: number;
  y: number;
  /** outfits: the project (garment) the hit cloth belongs to; unset for a single garment */
  projectId?: string;
}

let impl: ((clientX: number, clientY: number) => ClothHit | null) | null = null;

export function registerHitCloth(f: typeof impl) { impl = f; }

/** Raycast the draped garment at a screen position. Null when the ray misses the cloth or the 3D view is not ready. */
export function hitCloth(clientX: number, clientY: number): ClothHit | null {
  return impl ? impl(clientX, clientY) : null;
}

/**
 * In an outfit, make the garment under a hit the active tab (its project becomes the open one) so edits, probes and
 * inspectors act on it. Returns true when the active garment changed.
 */
export function focusHitMember(h: { projectId?: string } | null): boolean {
  if (!h?.projectId) return false;
  const st = useStore.getState();
  if (!st.outfit || st.project.id === h.projectId) return false;
  st.setActiveItem(h.projectId);
  return useStore.getState().project.id === h.projectId;
}
