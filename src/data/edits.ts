// Garment edits on top of the drafted pattern: attachments (pockets, patches, straps, prints/emblems),
// seam edits (detach built-in seams, add custom seams), pleats, user-drawn pieces and custom poses.
// Shared contract between the store, the 2D editor, the 3D view and the simulation. Units: cm, degrees.

import type { Pt } from '../lib/geometry';

/** Emblem / print shape library (BO2 emblem editor style layers). */
export type ShapeId =
  | 'rect' | 'rounded' | 'circle' | 'triangle' | 'star' | 'star4' | 'heart' | 'hexagon' | 'shield'
  | 'chevron' | 'stripe' | 'bolt' | 'cross' | 'diamond' | 'ring' | 'text'
  /** a photo or picture the user inserted (ShapeLayer.image) */
  | 'image'
  /** a traced / free vector shape (ShapeLayer.path, SVG path in the unit box -0.5..0.5) */
  | 'path';

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
  /** shape 'image': picture as a data URL (downscaled to at most 1024 px, PNG or JPEG) */
  image?: string;
  /** shape 'path': SVG path data in the unit box -0.5..0.5 (fill rule evenodd) */
  path?: string;
  /** relief in mm: positive = raised (puff print, padded applique, stacked felt), negative = pressed in (deboss) */
  relief?: number;
  /** text layers: font style (Design workspace) */
  font?: string;
  /** embroidery stitch style */
  stitch?: string;
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
export type AttachKind = 'pocket' | 'patch' | 'applique' | 'strap' | 'embroidery' | 'print' | 'hardware' | 'label';

/**
 * label = a clothing tag: small cloth panel (Attachment.label) sewn at its two short ends (loop) or all round,
 * usually on the inside at the back neck. Artwork layers are woven / printed onto it.
 */
export type LabelType = 'woven' | 'printed' | 'satin' | 'cotton' | 'leather' | 'rubber';
export interface Label { type: LabelType; sewn: 'ends' | 'all-round' | 'folded-loop'; color: string }

/** Surface look of a cloth attachment, tag, print or trim. */
export type Sheen = 'matte' | 'satin' | 'glossy' | 'metallic';

/** Which face of the host piece an attachment sits on. Inside = the side against the body (e.g. under collar, placket facing, neck tag). */
export type Face = 'outside' | 'inside';

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
  /** button / snap / stud drawn by the user: outline (cm, centred on 0,0); replaces the round shape */
  outline?: Pt[];
  /** button holes: 0 (none), 2, 4 or 'shank' (loop underneath) */
  holes?: 0 | 2 | 4 | 'shank';
  /** artwork on the trim's face (engraved / printed / enamel), same layer model as emblems, sized in cm */
  layers?: ShapeLayer[];
  sheen?: Sheen;
  /** colour for plastic finishes ('black' / 'white' are presets; this overrides with any CSS colour) */
  color?: string;
  /** zipper design */
  zipper?: ZipperDesign;
  /**
   * buttonholes (Attachment.buttonhole): straight (a bar tacked slot, shirts and knits) or keyhole (a round eye at the
   * end the button shank sits in, jackets and coats). Default straight. `size` is the button the hole takes.
   */
  holeStyle?: 'straight' | 'keyhole';
  /** buttonholes: each slot across the row (default, like a jacket front) or along it (like a shirt placket) */
  holeDir?: 'across' | 'along';
}

export interface ZipperDesign {
  teeth: 'metal' | 'coil' | 'molded';
  /** tape colour (CSS) */
  tape: string;
  /** teeth colour when not metal (CSS); metal teeth use Hardware.finish */
  teethColor?: string;
  puller: 'standard' | 'ring' | 'tab' | 'cord' | 'custom';
  /** puller drawn by the user (cm, centred) when puller === 'custom' */
  pullerOutline?: Pt[];
  pullerLayers?: ShapeLayer[];
  pullerFinish?: Finish;
}

export interface Attachment {
  id: string;
  kind: AttachKind;
  name: string;
  /**
   * host pattern piece and the centre position in that piece's local pattern coords (cm). x, y and rotation are
   * always in the stored piece's own frame, for every copy: on a mirrored copy (instance 1, the wearer's right) the
   * placement is the mirror image in 3D, but the attachment itself is not flipped (text still reads the right way).
   */
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
  /**
   * the outline was reshaped by its points on the chart (src/data/attachOutline.ts): on the mirrored copy of a piece
   * cut twice it is cut as its mirror image (artwork on it is never flipped)
   */
  outlineEdited?: boolean;
  /** emblem / print artwork, drawn on top of the attachment's fabric */
  layers: ShapeLayer[];
  /** fabric for cloth attachments; defaults to the host piece fabric */
  fabric?: { id: string; color: number; hex?: string; pattern?: import('./fabrics').FabricPattern };
  /** cloth attachments with a patterned fabric: lay the pattern out as on the host piece so it continues the body's repeat (default: starts at the attachment) */
  alignPattern?: boolean;
  /**
   * cloth attachments: a lining or backing bagged inside the attachment (a leather lined pocket, a felt backed patch).
   * It adds its weight, thickness and stiffness to the attachment (src/data/stack.ts). Omitted: unlined.
   */
  lining?: { id: string; color: number; hex?: string };
  /** outline === 'shape': the shape to cut (applique) and its text for 'text' */
  shape?: ShapeId;
  text?: string;
  /** thread colour for embroidery and for the stitching around cloth attachments (CSS colour) */
  thread?: string;
  /** which face of the host it is on; default 'outside' */
  face?: Face;
  /** surface look; default matte for cloth, metallic for metal trims */
  sheen?: Sheen;
  /** kind === 'label' */
  label?: Label;
  /** kind === 'hardware' */
  hardware?: Hardware;
  /**
   * which placed copy of a piece cut more than once gets the attachment (see instanceCount in
   * src/sim/seams.ts: 0 = +x copy, the wearer's left; 1 = the wearer's right; crown panels 0..5). Omitted: every copy.
   */
  instance?: number;
  /** a colour block (src/data/colourBlock.ts): a print the chart clips to the piece outline */
  block?: boolean;
  /** prints: take on the host fabric (weave shows through the ink, gloss follows the cloth). Omitted: on. */
  blend?: boolean;
  /** how strongly the print blends with the fabric, 0..1. Omitted: 0.7. */
  blendStrength?: number;
  /**
   * made from the style (src/data/construction.ts builtinDetails): the buttons, buttonholes, rivets, belt loops and
   * pockets every garment of the style has. The UI labels them "from the style"; they move, edit and delete like any
   * other attachment.
   */
  builtin?: boolean;
  /**
   * kind === 'hardware', hardware.type === 'button': these are buttonholes (cut and stitched into the host), not buttons
   * sewn on. Buttonholes add no weight and are not bought trims. In the simulation each buttonhole is buttoned to the
   * nearest button on another piece (or the other copy of a piece cut twice), so a front that buttons is held closed only
   * at its buttons; Edits.closure 'open' leaves them unbuttoned.
   */
  buttonhole?: boolean;
}

/** A run along a piece outline between two outline points (ids), taking the shorter way round. */
export interface EdgeRef {
  pieceId: string;
  fromId: string;
  toId: string;
  /**
   * placed copy of a piece cut more than once (0 = +x copy, the wearer's left; 1 = the wearer's right; crown panels 0..5).
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
  /** placed copy of a piece cut more than once that gets the pleat (0 = +x copy, the wearer's left; 1 = the wearer's right). Omitted: every copy. */
  instance?: number;
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
  /** 'patch' on a host cut more than once: the host copy it goes on (0 = +x copy, the wearer's left; 1 = the wearer's right). Omitted: every copy. */
  instance?: number;
}

export interface SideAngles { shFlex: number; shAbd: number; shHoriz: number; elbow: number; hipFlex: number; hipAbd: number; knee: number }
/** User pose (radians) for the 'custom' movement mode; index 0 = +x side, 1 = -x side. */
export interface CustomPose { s: [SideAngles, SideAngles]; spineBend: number; spineTwist: number; headTurn: number }

export const ZERO_SIDE: SideAngles = { shFlex: 0, shAbd: 0, shHoriz: 0, elbow: 0, hipFlex: 0, hipAbd: 0, knee: 0 };
export const ZERO_POSE: CustomPose = { s: [{ ...ZERO_SIDE }, { ...ZERO_SIDE }], spineBend: 0, spineTwist: 0, headTurn: 0 };

/**
 * How the edge of a garment gets its colour. Real garments use thread, binding or piping rather than paint: paint is the
 * colour block tool (an attachment), the others are edge trims (Edits.edgeTrims).
 */
export type EdgeMethod = 'paint' | 'thread' | 'binding' | 'piping';

/**
 * A contrast edge: a topstitch line in a colour ('thread'), a folded tape over the edge ('binding') or a cord sewn into
 * the seam ('piping'). Runs along one outline run of a piece (see EdgeRef; omitted instance = every copy).
 */
export interface EdgeTrim {
  id: string;
  method: Exclude<EdgeMethod, 'paint'>;
  edge: EdgeRef;
  /** thread, tape or cord colour (CSS) */
  colour: string;
  /** binding: finished tape width over the edge (cm); piping: cord diameter (cm); thread: unused */
  width: number;
  /** thread weight as Tex (30 fine, 45 regular, 70 heavy topstitch); thread only */
  tex?: number;
  /** which face shows it; default: binding and thread show on both, piping on the outside */
  face?: 'both' | 'outside' | 'inside';
  name?: string;
}

/** wash and wear processes painted as a colour and texture change (src/data/finish.ts) */
export type WashKind = 'acid' | 'bleach' | 'fade' | 'stone';
/** distressing: fray (edges and hems), whiskers (hip creases), honeycomb (behind the knee), abrasion, rip, hole (cut through) */
export type DistressKind = 'fray' | 'whiskers' | 'honeycomb' | 'abrasion' | 'rip' | 'hole';
export type FinishKind = WashKind | DistressKind;
/** one brush stroke in a piece's own pattern space. Compact: flat x,y pairs in cm, rounded to 0.1 */
export interface FinishStroke { k: FinishKind; p: number[]; /** brush radius (cm) */ r: number; /** strength 0..1 */ s: number }
/** the strokes on one piece; omitted instance = every copy (a stroke on a mirrored pair mirrors with it) */
export interface PieceFinish { pieceId: string; instance?: number; strokes: FinishStroke[] }
export type WashPreset = 'none' | 'light' | 'mid' | 'dark' | 'vintage';
/** wash and distress of the whole garment: a global wash plus strokes per piece (masks in pattern space, not bitmaps) */
export interface GarmentFinish { preset: WashPreset; presetStrength?: number; pieces: PieceFinish[] }

export type WashSequence = 'prewash' | 'garment' | 'none';

export interface Edits {
  attachments: Attachment[];
  customSeams: CustomSeam[];
  /** ids of built-in seams the user has detached (ids from builtinSeams in src/sim/seams.ts) */
  detachedSeams: string[];
  pleats: Pleat[];
  /** collar worn folded down (default) or popped up */
  collar?: 'down' | 'up';
  /** when cotton or denim is mixed with genuine leather: are the fabric panels washed before the leather goes on */
  washSequence?: WashSequence;
  /** fabric on the inside face of a piece (under collar, placket facing, lining look); key = piece id */
  bands?: Band[];
  insideFabric?: Record<string, { id: string; color: number; hex?: string; pattern?: import('./fabrics').FabricPattern }>;
  /** ids of points of interest (src/lib/poi.ts) the designer left out of the tech pack's close-up pages */
  techpackSkip?: string[];
  /** wash and distressing (Finish workspace). Omitted in older projects: none. */
  finish?: GarmentFinish;
  /** contrast thread, binding and piping along piece edges (see EdgeTrim). Omitted in older projects: none. */
  edgeTrims?: EdgeTrim[];
  /** a front that buttons: worn buttoned (default) or open (buttonholes left unbuttoned, the fronts hang free) */
  closure?: 'buttoned' | 'open';
  /**
   * version of the style details made as attachments (builtin: true). Set when they were made, so a project whose user
   * deleted them does not get them back on load; projects from before have none and get them once (withBuiltins).
   */
  builtin?: number;
  /**
   * style trims the user removed, one key per trim (builtinKey in src/data/construction.ts), so "Restore style trims"
   * knows what to bring back and a project that is migrated again does not remake them.
   */
  removedBuiltins?: string[];
}

/**
 * A band across the garment (rugby / polo chest stripe): a horizontal stripe set at a height on the body that runs
 * across every piece it crosses and lines up at the seams. Height is measured down from the high point shoulder (tops)
 * or up from the hem.
 */
export interface Band {
  id: string;
  from: 'shoulder' | 'hem';
  /** distance in cm from the reference to the band's top edge */
  offset: number;
  /** stripes from top to bottom: height cm and colour */
  stripes: { height: number; color: string }[];
  method: 'printed' | 'woven' | 'sewn';
  /** pieces the band skips (e.g. sleeves); default: every piece it crosses */
  skip?: string[];
  sheen?: Sheen;
  /**
   * tilt in degrees (-60..60, default 0 = level). The band is a tilted plane through the garment, so its stripes stay
   * continuous across the side seams: positive lowers the wearer's left side (see src/data/bandGeom.ts).
   */
  angle?: number;
}

export const EMPTY_EDITS: Edits = { attachments: [], customSeams: [], detachedSeams: [], pleats: [] };
