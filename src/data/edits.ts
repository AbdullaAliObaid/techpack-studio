// Garment edits on top of the drafted pattern: attachments (pockets, patches, straps, prints/emblems),
// seam edits (detach built-in seams, add custom seams), pleats, user-drawn pieces and custom poses.
// Shared contract between the store, the 2D editor, the 3D view and the simulation. Units: cm, degrees.

import type { Pt } from '../lib/geometry';

/** Emblem / print shape library (BO2 emblem editor style layers). */
export type ShapeId =
  | 'rect' | 'rounded' | 'circle' | 'triangle' | 'star' | 'star4' | 'heart' | 'hexagon' | 'shield'
  | 'chevron' | 'stripe' | 'bolt' | 'cross' | 'diamond' | 'ring' | 'text';

export interface ShapeLayer {
  id: string;
  shape: ShapeId;
  /** centre relative to the attachment centre (cm) */
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  color: string;
  opacity?: number;
  flipX?: boolean;
  text?: string; // for shape 'text'
}

/**
 * How each attachment is made, like on a real garment:
 * pocket     = separate cloth piece sewn on three sides (top open)
 * patch      = separate cloth piece sewn all round
 * applique   = a shape or letter cut from fabric (outline = its shape) and sewn down all round with a satin or edge stitch
 * strap      = separate strip sewn at its two ends (belt strap, tab, loop)
 * embroidery = thread stitched into the host piece (raised satin stitch look), no extra cloth
 * print      = ink on the host piece, no extra cloth
 * hardware   = metal or plastic trim fixed through the fabric (see Hardware)
 */
export type AttachKind = 'pocket' | 'patch' | 'applique' | 'strap' | 'embroidery' | 'print' | 'hardware';

/** Outline of a cloth attachment. 'shape' uses Attachment.shape (any ShapeId, including 'text' letters). */
export type Outline = 'rect' | 'rounded' | 'pointed' | 'circle' | 'shield' | 'shape' | 'custom';

export type HardwareType = 'rivet' | 'eyelet' | 'stud' | 'button' | 'snap' | 'zipper';
export type Finish = 'silver' | 'brass' | 'copper' | 'gunmetal' | 'black' | 'white';

export interface Hardware {
  type: HardwareType;
  finish: Finish;
  /** diameter for round trims (cm); zipper: tape width. Attachment.h is the zipper length, rotation its direction. */
  size: number;
  /** several in a row along the attachment's w (cm) direction, centre to centre spacing */
  count?: number;
  spacing?: number;
  /** zipper: open or closed (closed = the two sides are joined) */
  open?: boolean;
}

export interface Attachment {
  id: string;
  kind: AttachKind;
  name: string;
  /** host pattern piece and the centre position in that piece's local pattern coords (cm) */
  pieceId: string;
  x: number;
  y: number;
  rotation: number;
  /** outline size of the attachment itself (cm); prints use it as the artwork box */
  w: number;
  h: number;
  outline: Outline;
  /** custom outline points (cm, centred on 0,0) when outline === 'custom' */
  points?: Pt[];
  /** emblem / print artwork, drawn on top of the attachment's fabric */
  layers: ShapeLayer[];
  /** fabric for cloth attachments; defaults to the host piece fabric */
  fabric?: { id: string; color: number };
  /** outline === 'shape': the shape to cut (applique) and its text for 'text' */
  shape?: ShapeId;
  text?: string;
  /** thread colour for embroidery and for the stitching around cloth attachments (CSS colour) */
  thread?: string;
  /** kind === 'hardware' */
  hardware?: Hardware;
  /**
   * which placed copy of a piece cut more than once gets the attachment (see instanceCount in
   * src/sim/seams.ts: 0 = right side, 1 = left side; crown panels 0..5). Omitted: every copy.
   */
  instance?: number;
}

/** A run along a piece outline between two outline points (ids), taking the shorter way round. */
export interface EdgeRef {
  pieceId: string;
  fromId: string;
  toId: string;
  /**
   * placed copy of a piece cut more than once (0 = right side / first, 1 = left side; crown panels 0..5).
   * Omitted on a custom seam: sewn on every copy, copy i to copy i (a mirrored pair stays mirrored).
   */
  instance?: number;
}

export interface CustomSeam {
  id: string;
  a: EdgeRef;
  b: EdgeRef;
  /** sew b in the opposite direction */
  flip?: boolean;
}

export type PleatType = 'knife' | 'box' | 'inverted';

export interface Pleat {
  id: string;
  pieceId: string;
  /** position on the outline: segment starting at this outline point, parameter 0..1 along it */
  pointId: string;
  t: number;
  /** fabric folded away per side (cm); a knife pleat takes 2 x depth out of the edge length */
  depth: number;
  /** fold length into the piece (cm) */
  length: number;
  type: PleatType;
  direction: 1 | -1;
  /** pattern width (cm) the store added beside the pleat so the edge still matches its seam after folding */
  spread?: number;
}

/** Edge length a pleat folds away: knife 2 x depth, box and inverted 4 x depth. */
export const pleatIntakeOf = (p: Pick<Pleat, 'type' | 'depth'>) => (p.type === 'knife' ? 2 : 4) * p.depth;

/** How a user-drawn piece goes onto the garment. */
export interface Placement {
  mode: 'sewn' | 'patch';
  /** for 'patch': host piece and centre position on it; for 'sewn': the seams come from customSeams */
  hostPieceId?: string;
  x?: number;
  y?: number;
  rotation?: number;
}

export interface SideAngles { shFlex: number; shAbd: number; shHoriz: number; elbow: number; hipFlex: number; hipAbd: number; knee: number }
/** User pose (radians) for the 'custom' movement mode; index 0 = +x side, 1 = -x side. */
export interface CustomPose { s: [SideAngles, SideAngles]; spineBend: number; spineTwist: number; headTurn: number }

export const ZERO_SIDE: SideAngles = { shFlex: 0, shAbd: 0, shHoriz: 0, elbow: 0, hipFlex: 0, hipAbd: 0, knee: 0 };
export const ZERO_POSE: CustomPose = { s: [{ ...ZERO_SIDE }, { ...ZERO_SIDE }], spineBend: 0, spineTwist: 0, headTurn: 0 };

export interface Edits {
  attachments: Attachment[];
  customSeams: CustomSeam[];
  /** ids of built-in seams the user has detached (ids from builtinSeams in src/sim/seams.ts) */
  detachedSeams: string[];
  pleats: Pleat[];
}

export const EMPTY_EDITS: Edits = { attachments: [], customSeams: [], detachedSeams: [], pleats: [] };
