// Layer stacks: the cloth a piece or an attachment is really made of. A tee with a leather lining is jersey plus
// leather: it weighs both, it is as thick as both, it stretches no further than the leather and it bends like a
// laminate of the two (much stiffer than either alone, so it folds in fewer, larger creases).
//
// Bending: a ply of modulus E and thickness t has bending stiffness B = E t^3 / 12. The fabric library's `bend`
// (0..1) is calibrated so that the solver's bend compliance goes as 1 / bend^2, so here B = bend^2 and E t = 12 B / t^2.
// Stacked plies add their own B, and plies held together also bend about a shared middle (parallel axis term
// sum E t d^2). How tightly they are held sets how much of that term counts: a bagged lining sewn round its edges
// slides a little (COUPLING.bagged), a patch sewn all round holds better, a fused or glued ply counts fully.

import { fabricById, fabricThickness } from './fabrics';
import type { Piece } from './presets';
import type { Attachment, Edits } from './edits';

export interface Ply { id: string; name: string; gsm: number; /** mm */ thickness: number; bend: number; stretch: number; role: 'outside' | 'lining' | 'patch' | 'relief' }

export interface Stack {
  plies: Ply[];
  /** total weight (g/m2) */
  gsm: number;
  /** total thickness (mm) */
  thickness: number;
  /** effective bend on the library's 0..1+ scale (sqrt of the laminate's bending stiffness) */
  bend: number;
  /** safe stretch: the least stretchy ply */
  stretch: number;
}

/** share of the parallel axis term that counts, by how the plies are held together */
export const COUPLING = { bagged: 0.2, sewn: 0.3, fused: 1 } as const;

/** caps that keep the solver calm with extreme stacks */
export const STACK_CAPS = { bend: 3, gsm: 2500, thickness: 10 } as const;

export function plyOf(id: string, role: Ply['role'] = 'outside'): Ply {
  const f = fabricById(id);
  return { id: f.id, name: f.name, gsm: f.gsm, thickness: fabricThickness(f.id), bend: f.bend, stretch: f.stretch, role };
}

/** Laminate of plies, outermost first. */
export function combine(plies: Ply[], coupling: number = COUPLING.bagged): Stack {
  let z = 0, Bsum = 0, Et = 0, Etz = 0;
  const zs: number[] = [];
  for (const p of plies) {
    const t = Math.max(0.05, p.thickness), B = p.bend * p.bend;
    zs.push(z + t / 2); z += t;
    Bsum += B; Et += (12 * B) / (t * t); Etz += ((12 * B) / (t * t)) * zs[zs.length - 1];
  }
  const zm = Et > 0 ? Etz / Et : 0;
  let par = 0;
  plies.forEach((p, i) => { const t = Math.max(0.05, p.thickness); par += ((12 * p.bend * p.bend) / (t * t)) * (zs[i] - zm) ** 2; });
  const B = Bsum + (plies.length > 1 ? coupling * par : 0);
  return {
    plies,
    gsm: Math.min(STACK_CAPS.gsm, plies.reduce((s, p) => s + p.gsm, 0)),
    thickness: Math.min(STACK_CAPS.thickness, z),
    bend: Math.min(STACK_CAPS.bend, plies.length > 1 ? Math.sqrt(B) : plies[0]?.bend ?? 0),
    stretch: Math.min(...plies.map((p) => p.stretch)),
  };
}

/**
 * The stack of a pattern piece: its outside fabric, plus the inside fabric (Edits.insideFabric) as a bagged lining
 * ply when it is a different cloth. Same cloth (or none) inside: one ply, the piece behaves as it always has.
 */
export function stackOf(piece: Pick<Piece, 'id' | 'fabric'>, edits?: Pick<Edits, 'insideFabric'>): Stack {
  const out = plyOf(piece.fabric.id);
  const inner = edits?.insideFabric?.[piece.id];
  if (!inner || inner.id === piece.fabric.id) return combine([out]);
  return combine([out, plyOf(inner.id, 'lining')], COUPLING.bagged);
}

/** relief (mm) of the raised artwork on an attachment: puff print, padded applique, stacked felt */
export const reliefOf = (a: Pick<Attachment, 'layers'>) => a.layers.reduce((m, l) => Math.max(m, l.relief ?? 0), 0);

/** a raised print or padded layer as a ply: a soft foam about 150 g/m2 and a little stiffness per mm */
export function reliefPly(mm: number): Ply {
  const t = Math.min(5, Math.max(0, mm));
  return { id: 'relief', name: 'Raised artwork', gsm: 150 * t, thickness: t, bend: Math.min(0.6, 0.18 * t), stretch: 0.3, role: 'relief' };
}

/**
 * The stack of a cloth attachment (pocket, patch, applique, label): its own fabric (default the host's), its lining
 * when set, and padding for raised artwork on it.
 */
export function attachmentStack(a: Pick<Attachment, 'fabric' | 'lining' | 'layers' | 'kind'>, hostFabricId: string): Stack {
  const plies = [plyOf(a.fabric?.id ?? hostFabricId, 'patch')];
  if (a.lining) plies.push(plyOf(a.lining.id, 'lining'));
  const r = a.kind === 'patch' || a.kind === 'applique' ? reliefOf(a) : 0;
  if (r > 0) plies.unshift(reliefPly(r));
  return combine(plies, a.kind === 'pocket' ? COUPLING.bagged : COUPLING.sewn);
}

/** One line for a tech pack: 'Cotton Jersey + Leather lining, 1.7 mm, 1080 g/m2'. */
export function stackText(s: Stack): string {
  const names = s.plies.map((p) => (p.role === 'lining' ? `${p.name} lining` : p.name)).join(' + ');
  return `${names}, ${Math.round(s.thickness * 10) / 10} mm, ${Math.round(s.gsm)} g/m2`;
}
