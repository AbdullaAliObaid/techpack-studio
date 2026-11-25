// Built-in sewing lines of a style, each with a stable id so the user can detach or re-attach it.
// CONTRACT: the garment-engineer fills this in (and setup.ts sews from it, skipping edits.detachedSeams
// and adding edits.customSeams). The UI lists these with attach / detach toggles.

import type { Piece } from '../data/presets';
import type { StyleId } from '../data/catalog';
import type { EdgeRef } from '../data/edits';

export interface BuiltinSeam {
  /** stable id, e.g. 'shoulder-r', 'side-l', 'inseam-r', 'waistband' */
  id: string;
  /** plain language label for the UI, e.g. 'Right shoulder' */
  label: string;
  /** one or more piece edges in a row on each side */
  a: EdgeRef[];
  b: EdgeRef[];
}

export function builtinSeams(_style: StyleId, _pieces: Piece[]): BuiltinSeam[] {
  return [];
}
