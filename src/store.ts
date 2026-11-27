import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { makePreset, GARMENT_LABEL, type Piece, type PieceFabric } from './data/presets';
import { migrateGarment, type StyleId } from './data/catalog';
import { DEFAULT_BODY, type Body } from './three/body';
import { draft, regradePoints, type Fit } from './data/draft';
import { bezAt, toBeziers, type PPoint, type Pt } from './lib/geometry';
import { fromUnit, uid, type Units } from './lib/units';
import { pleatIntakeOf, EMPTY_EDITS, ZERO_POSE, type Face, type Attachment, type CustomPose, type CustomSeam, type Edits, type EdgeRef, type Placement, type Pleat } from './data/edits';
import { FEMALE_BODY, MALE_BODY } from './three/body';
import { applyMoves, linkedMoves } from './data/symmetry';
import { setMeasurement, targetKey, type MeasureTarget } from './data/measureEdit';
import { fitTable, garmentSpecs, pieceSpecs } from './lib/specs';
import { newDesign, type DesignDoc, type Workspace, readWorkspaceMap, writeWorkspaceMap, defaultBand } from './components/designDoc';
import type { Band } from './data/edits';
import { deleteOutfit as removeSavedOutfit, listOutfits, listProjects, saveOutfit, saveProject } from './lib/projects';
import { regradeBuiltins, styleEdits, upgradeFront, withBuiltins } from './data/construction';

/** undo history entry: pattern pieces plus garment edits */
export interface Snapshot { pieces: Piece[]; edits?: Edits; notes?: Note[] }

export interface Project {
  id: string;
  name: string;
  /** catalog style id (src/data/catalog.ts) */
  garment: StyleId;
  pieces: Piece[];
  body: Body;
  /** when on, the pattern is regraded whenever body measurements change */
  linkPattern: boolean;
  fit?: Fit;
  /** attachments, seam edits and pleats on top of the pattern (src/data/edits.ts) */
  edits?: Edits;
  /** notes drawn or typed on the pattern chart (and pinned to pieces) for the maker */
  notes?: Note[];
  /** set when the project came from someone else's shared file */
  imported?: { from?: string; at: number; fileName?: string };
  updatedAt: number;
}

/**
 * A note on the chart: freehand ink, an arrow, or a text callout. Anchored to a piece (local cm, moves with it)
 * or to the chart (world cm). Notes print on the tech pack pattern pages.
 */
export interface Note {
  id: string;
  kind: 'ink' | 'arrow' | 'text';
  /** ink: the stroke; arrow: [tail, head]; text: [anchor] */
  points: { x: number; y: number }[];
  pieceId?: string;
  instance?: number;
  text?: string;
  color: string;
  /** stroke width in screen points */
  width: number;
  createdAt: number;
}

/** File format for sharing (.techit, JSON). Pictures stay embedded as data URLs. */
export interface ShareFile {
  format: 'tech-it';
  version: 1;
  exportedAt: number;
  app: string;
  projects: Project[];
  outfits?: Outfit[];
  bodies?: BodyPreset[];
}

/** A saved set of body measurements the user can reuse (e.g. "Me", "Fit model size M", "Client A"). */
export interface BodyPreset { id: string; name: string; body: Body; updatedAt: number }

/**
 * An outfit: several garment projects worn together on one body (e.g. a shirt over jeans). Each item points at a
 * saved garment project; the outfit owns the body. Layer order: lower numbers are closer to the skin.
 */
export interface OutfitItem {
  projectId: string;
  layer: number;
  /** tops: tucked into the bottoms or worn out */
  tuck?: 'in' | 'out';
  hidden?: boolean;
}
export interface Outfit { id: string; name: string; body: Body; items: OutfitItem[]; updatedAt: number }

export type Tool = 'select' | 'add' | 'pan' | 'seams' | 'pleat' | 'pen' | 'note' | 'block';
/** Edge paint tool settings (src/data/colourBlock.ts) */
export interface BlockSettings { colour: string; sheen: import('./data/edits').Sheen; look: 'dyed' | 'printed'; h: number; mode: 'rect' | 'poly' }
/** a block being drawn: world points, on the copy it started on */
export interface BlockDraft { key: string; pts: Pt[]; rect: boolean }
export type NoteKind = Note['kind'];
export type Screen = 'home' | 'new' | 'editor';
export interface NewFlow { mode: 'create' | 'change'; from: 'home' | 'editor' }
export type ThemePref = 'system' | 'light' | 'dark';
export type InspectorTab = 'garment' | 'construction' | 'body' | 'specs';

/** State of the step by step "New piece" sheet (Shape, Details, Attach). Null when closed. */
export interface PieceFlow {
  step: 1 | 2 | 3;
  /** outline in pattern space (cm) from a template or the pen; null until chosen */
  shape: PenPoint[] | null;
  source: 'template' | 'pen';
  template: string;
  tw: number;
  th: number;
  /** the pen tool is active for this flow (the sheet steps aside) */
  drawing: boolean;
  name: string;
  fabricMode: 'same' | 'pick';
  fabric: { id: string; color: number };
  cut: 1 | 2;
  attach: 'patch' | 'sewn';
  host: string;
  /** copy of the host the piece goes on (0 right, 1 left); null when the host is cut once */
  side: number | null;
  /** index of the new piece's edge that gets sewn (the edge starting at that outline point) */
  ownEdge: number;
  hostEdge: EdgeRef | null;
  /** waiting for a click on an edge of the chart */
  picking: boolean;
}


/** Seam being joined by hand: a range on one piece, then a range on another (point ids on the outline). */
export interface SeamDraft { a: Partial<EdgeRef> | null; b: Partial<EdgeRef> | null; flip: boolean }
export const EMPTY_SEAM_DRAFT: SeamDraft = { a: null, b: null, flip: false };
/** A point of the pen tool outline in pattern space (cm); smooth when the pointer was dragged. */
export interface PenPoint { x: number; y: number; smooth: boolean }

const COACH_KEY = 'tech-it-design-coach';
function readCoach(): boolean { try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return false; } }
const DESIGN_SIZE_KEY = 'tech-it-design-size';
function readDesignSize(): { w: number; h: number } {
  try { const v = JSON.parse(localStorage.getItem(DESIGN_SIZE_KEY) ?? 'null') as { w: number; h: number } | null; if (v && v.w > 0 && v.h > 0) return v; } catch { /* storage blocked */ }
  return { w: 300, h: 280 };
}
export function writeDesignSize(v: { w: number; h: number }) { try { localStorage.setItem(DESIGN_SIZE_KEY, JSON.stringify(v)); } catch { /* storage blocked */ } }

const THEME_KEY = 'tech-it-theme';
export function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch { /* storage blocked */ }
  return 'system';
}
export function writeTheme(t: ThemePref) {
  try { localStorage.setItem(THEME_KEY, t); } catch { /* storage blocked */ }
}

/** one point of a multi selection: the stored point, and the copy of the piece it was picked on (entry key) */
export interface MultiItem { pieceId: string; pointId: string; key: string }
export interface GroupMove { pieceId: string; pointId: string; x: number; y: number }

/** a spot picked on the 3D garment, shown on the pattern chart (piece local cm, as hitCloth returns it) */
export interface Probe { pieceId: string; instance: number; x: number; y: number; at: number }

export interface State {
  theme: ThemePref;
  inspectorTab: InspectorTab;
  project: Project;
  units: Units;
  tool: Tool;
  symmetry: boolean;
  /** Total symmetry: mating pieces (all four jeans leg pieces, front and back, both sleeves) move together */
  totalSymmetry: boolean;
  setTotalSymmetry: (on: boolean) => void;
  /** the points that move together with the one being dragged (highlighted on the chart) */
  linkedHot: { pieceId: string; pointId: string }[];
  /** the tool rail is previewing which pieces Symmetry ('sym') or Total symmetry ('total') links (hover, focus, or just switched on) */
  symPreview: 'sym' | 'total' | null;
  showMeasure: boolean;
  showStitch: boolean;
  /** notes layer: draw, arrow and text callouts on the chart */
  showNotes: boolean;
  selNote: string | null;
  noteKind: NoteKind;
  noteColor: string;
  noteWidth: number;
  addNote: (n: Omit<Note, 'id' | 'createdAt'>) => string;
  updateNote: (id: string, patch: Partial<Note>) => void;
  removeNote: (id: string) => void;
  /** put a whole body on the open project (a saved body preset); regrades the pattern when it follows the body */
  setWholeBody: (body: Body) => void;
  selPiece: string | null;
  selPoint: string | null;
  /** several points selected at once (marquee, shift-click); empty when zero or one point is selected */
  selMulti: MultiItem[];
  /** magnetism while dragging points (Alt/Option turns it off for one drag) */
  snapOn: boolean;
  setMulti: (items: MultiItem[]) => void;
  /** move many points in one update (absolute stored positions); symmetric partners follow */
  moveGroup: (moves: GroupMove[]) => void;
  setSmoothMany: (items: { pieceId: string; pointId: string }[], smooth: boolean) => void;
  view3d: 'fabric' | 'stretch';
  showBody: boolean;
  /** 3D view: pull the cloth by hand (drag a point; Shift-click pins one) instead of orbiting */
  pullMode: boolean;
  skin: number;
  showJoints: boolean;
  showGarment: boolean;
  showTape: boolean;
  draping: boolean;
  simStatus: string;
  drapePeak: { ratio: number; strain: number; where: string; over?: number };
  redrapeToken: number;
  mode: import('./sim/pose').Mode;
  fabricScope: 'all' | 'piece';
  past: Snapshot[];
  future: Snapshot[];
  fitToken: number;
  // --- UI state for the edit tools ---
  selLayer: string | null;
  selPleat: string | null;
  hoverSeam: string | null;
  seamDraft: SeamDraft;
  penDraft: PenPoint[];
  penSnap: boolean;
  /** closed pen outline waiting for the "Place on garment" sheet */
  penSheet: PenPoint[] | null;
  /** hint shown after placing a sewn piece */
  seamHint: string | null;
  symmetricPose: boolean;
  /** pieces cut twice are shown as two labelled patterns, right and left */
  showBothSides: boolean;
  /** which copy of a piece cut twice was last clicked on the chart (0 right, 1 left) */
  selInstance: number | null;
  pieceFlow: PieceFlow | null;
  setFlow: (patch: Partial<PieceFlow>) => void;
  /** Open sections. Everything starts closed; only what the user opens is remembered, for this session only
   *  (never stored on the device, cleared when a project is created or opened). */
  sections: Record<string, boolean>;
  setSection: (id: string, open: boolean) => void;
  /** inspector as a slide over drawer on narrow screens */
  drawer: boolean;
  /** drop every half-finished tool action and go back to Select */
  cancelTools: () => void;
  // --- Design panel (docked beside the pattern) ---
  designOpen: boolean;
  designCollapsed: boolean;
  /** 'add' = the library, 'edit' = the selected design */
  designTab: 'add' | 'edit';
  /** side dock width and bottom sheet height, px */
  designSize: { w: number; h: number };
  /** face new designs go on, and the face the chart shows */
  designFace: Face;
  /** the face the user asked for (the fabric coin) */
  viewFace: Face;
  /** the face the chart is drawing right now: follows viewFace halfway through the flip animation */
  chartFace: Face;
  coachDone: boolean;
  openDesign: (tab?: 'add' | 'edit', face?: Face) => void;
  dismissCoach: () => void;

  set: (s: Partial<State>) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  select: (piece: string | null, point?: string | null) => void;
  movePoint: (pieceId: string, pointId: string, x: number, y: number) => void;
  /** Type a measurement: change the pattern so it reads `value` (in `unit`, default the current units). One undo step. False when it cannot be solved. */
  setMeasure: (target: MeasureTarget, value: number, unit?: Units) => boolean;
  /** the last typed measurement: which numbers changed (target keys) and which points moved, so the UI can pulse them */
  measureFlash: { n: number; keys: string[]; points: string[] } | null;
  colourBlock: BlockSettings;
  blockDraft: BlockDraft | null;
  /** add edge paint blocks (one undo step) and select the first */
  addColourBlocks: (list: Omit<Attachment, 'id'>[]) => void;
  movePiece: (pieceId: string, offset: Pt) => void;
  insertPoint: (pieceId: string, seg: number, t: number) => string | null;
  deletePoint: (pieceId: string, pointId: string) => void;
  toggleSmooth: (pieceId: string, pointId: string) => void;
  setFabric: (fabricId: string, color: number) => void;
  /** fabric, colour (palette index or custom hex) and pattern on the selected piece, or the whole garment */
  applyFabric: (spec: PieceFabric) => void;
  setBody: (key: keyof Body, v: number | undefined) => void;
  resetBody: () => void;
  setLink: (on: boolean) => void;
  setFit: (fit: Fit) => void;
  newProject: (id: StyleId) => void;
  /** which full screen is showing: the start screen, the new project flow, or the editor */
  screen: Screen;
  setScreen: (s: Screen) => void;
  /** the new project flow: starting a project, or changing the style of the open one */
  newFlow: NewFlow;
  openNew: (mode: NewFlow['mode'], from: NewFlow['from']) => void;
  /** a project from the new project flow: style, name, fit and body type chosen up front */
  createProject: (o: { style: StyleId; name: string; fit: Fit; sex: 'male' | 'female'; body?: Body }) => void;
  /** keep the open project (name, body, fit) but redraft it as another style */
  restyle: (id: StyleId) => void;
  // --- edits (attachments, seams, pleats, user pieces) ---
  selAttachment: string | null;
  addAttachment: (a: Omit<Attachment, 'id'>) => string;
  duplicateAttachment: (id: string) => string | null;
  setCollar: (c: 'down' | 'up') => void;
  /** a front that buttons: worn buttoned or open */
  setClosure: (c: 'buttoned' | 'open') => void;
  /** fabric on the inside face of a piece; null = same as the outside */
  setInsideFabric: (pieceId: string, fabric: { id: string; color: number } | null) => void;
  /** the same inside fabric on every piece; null = every piece uses its outside fabric */
  setInsideAll: (fabric: { id: string; color: number } | null) => void;
  updateAttachment: (id: string, patch: Partial<Attachment>) => void;
  removeAttachment: (id: string) => void;
  addCustomSeam: (s: Omit<CustomSeam, 'id'>) => string;
  removeCustomSeam: (id: string) => void;
  setSeamAttached: (builtinId: string, attached: boolean) => void;
  addPleat: (p: Omit<Pleat, 'id'>) => string;
  updatePleat: (id: string, patch: Partial<Pleat>) => void;
  removePleat: (id: string) => void;
  /** add a user-drawn piece (closed outline, local coords) and how it goes onto the garment */
  addCustomPiece: (name: string, points: Pt[], placement: Placement) => string;
  updatePiece: (id: string, patch: Partial<Piece>) => void;
  removePiece: (id: string) => void;
  // --- body presets and posing ---
  setBodyPreset: (sex: 'male' | 'female') => void;
  customPose: CustomPose;
  setPoseAngle: (side: 0 | 1 | null, key: string, value: number) => void;
  resetPose: () => void;
  loadProject: (p: Project) => void;
  rename: (name: string) => void;
  /** the last spot clicked on the 3D garment, marked on the pattern */
  probe: Probe | null;
  // --- workspaces (Construct, Design, Finish, Tech pack) and the Design workspace ---
  workspace: Workspace;
  setWorkspace: (w: Workspace) => void;
  /** the design being drawn in the Design workspace; once placed it stays linked to its attachment */
  design: DesignDoc;
  setDesign: (patch: Partial<DesignDoc> | ((d: DesignDoc) => Partial<DesignDoc>)) => void;
  designSel: string[];
  /** Design workspace right panel: the patch layers or the band tool */
  dwTab: 'layers' | 'band';
  /** Design workspace: the patch designer, or inserting a ready made design on the garment */
  designMode: 'patch' | 'insert';
  /** Paint workspace right panel: Edge paint or Bands across the garment */
  paintTab: 'edge' | 'bands';
  selBand: string | null;
  addBand: (b?: Partial<Omit<Band, 'id'>>) => string;
  updateBand: (id: string, patch: Partial<Band>) => void;
  removeBand: (id: string) => void;
  // --- outfits: several saved garment projects worn together on one body (src/sim/outfit.ts simulates them) ---
  /** the open outfit, or null when a single garment is open. Saved with src/lib/projects.ts (saveOutfit) on every change */
  outfit: Outfit | null;
  /** the outfit garment the 2D editor edits (its project is `project`); edits save to that project and redrape the outfit */
  activeItem: string | null;
  /** start a new, empty outfit on this body and open it; returns its id */
  newOutfit: (name: string, body: Body) => string;
  /** open a saved outfit; the first garment (closest to the skin) becomes the active one */
  openOutfit: (id: string) => void;
  /** close the outfit (the active garment stays open on its own) */
  leaveOutfit: () => void;
  /** add a saved garment project as the new outermost layer; regraded onto the outfit body when it follows the body */
  addToOutfit: (projectId: string) => void;
  removeFromOutfit: (projectId: string) => void;
  /** move a garment to position `layer` in the skin side first order (0 = closest to the skin); layers are renumbered */
  setOutfitLayer: (projectId: string, layer: number) => void;
  /** a top tucked into the bottoms or worn out over them */
  setTuck: (projectId: string, tuck: 'in' | 'out') => void;
  /** show or hide one garment in the 3D view (a hidden garment is left out of the simulation) */
  setItemHidden: (projectId: string, hidden: boolean) => void;
  /** which garment the 2D editor edits; the open one is saved first */
  setActiveItem: (projectId: string) => void;
  /** a new body for the outfit: every garment that follows the body (linkPattern) is regraded onto it */
  setOutfitBody: (body: Body) => void;
}

/** Garments with a collar store the collar position explicitly (folded down unless chosen), which turns on the
 *  collar fold in the simulation. Projects saved before the option existed get 'down' when loaded. */
function withCollar(p: Project): Project {
  if (!p.pieces.some((q) => q.role === 'collar') || p.edits?.collar) return p;
  return { ...p, edits: { ...(p.edits ?? EMPTY_EDITS), collar: 'down' } };
}

/** A new project for any catalog style, drafted on the given body in the style's default fabric, with the style's
 *  buttons, buttonholes, rivets, belt loops and pockets as editable attachments (src/data/construction.ts). */
export function freshProject(id: StyleId, name?: string, body: Body = DEFAULT_BODY): Project {
  const g = migrateGarment(id);
  const pieces = makePreset(g, body);
  return withCollar({ id: uid(), name: name ?? `Untitled ${GARMENT_LABEL[g].toLowerCase()}`, garment: g, pieces, body: { ...body }, linkPattern: true, fit: 'regular', edits: styleEdits(g, pieces, body), updatedAt: Date.now() });
}

/** A saved project as this version opens it: split fronts for a front that buttons, the inside pieces of the newer draft,
 *  the style details as attachments once, the collar position stored. */
export function migrateProject(p: Project): Project {
  return withCollar(withBuiltins(upgradeFront({ ...p, garment: migrateGarment(p.garment), linkPattern: p.linkPattern ?? true })));
}

/** Regrade every piece from one body to another, keeping the user's edits as offsets. */
function regrade(p: Project, from: Body, to: Body, fitFrom: Fit = p.fit ?? 'regular', fitTo: Fit = p.fit ?? 'regular'): Piece[] {
  const a = draft(p.garment, from, fitFrom), b = draft(p.garment, to, fitTo);
  return p.pieces.map((pc) => {
    const da = a.find((d) => d.role === pc.role), db = b.find((d) => d.role === pc.role);
    if (!da || !db) return pc;
    return { ...pc, points: regradePoints(pc.points, da.points, db.points), ...(db.elastic !== undefined ? { elastic: db.elastic } : {}) };
  });
}

/** Regrade the pieces and move the style's own attachments with them (buttons stay on centre front, loops on the band). */
function regradeAll(p: Project, from: Body, to: Body, fitFrom: Fit = p.fit ?? 'regular', fitTo: Fit = p.fit ?? 'regular'): Pick<Project, 'pieces' | 'edits'> {
  const pieces = regrade(p, from, to, fitFrom, fitTo);
  const edits = regradeBuiltins(p.edits, p.pieces, draft(p.garment, from, fitFrom), draft(p.garment, to, fitTo), (from.sex ?? 'male') !== (to.sex ?? 'male'));
  return { pieces, ...(edits ? { edits } : {}) };
}

const mapPiece = (pieces: Piece[], id: string, fn: (p: Piece) => Piece) => pieces.map((p) => (p.id === id ? fn(p) : p));

export const useStore = create<State>((set, get) => {
  const snap = (p: Project): Snapshot => ({ pieces: p.pieces, edits: p.edits, notes: p.notes });
  const restore = (h: Snapshot) => set((s) => ({ project: { ...s.project, pieces: h.pieces, edits: h.edits, notes: h.notes, updatedAt: Date.now() } }));
  /** slash and spread: move every point past the pleat (along its edge) outward by `amount` cm */
  const spreadPleat = (pl: Pick<Pleat, 'pieceId' | 'pointId' | 't'>, amount: number) => {
    if (!amount) return;
    const pieces = get().project.pieces;
    const piece = pieces.find((p) => p.id === pl.pieceId);
    if (!piece) return;
    const i = piece.points.findIndex((q) => q.id === pl.pointId);
    if (i < 0) return;
    const a = piece.points[i], b = piece.points[(i + 1) % piece.points.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-6) return;
    const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L;
    // undoing a spread: cut at the original position (length before the spread), the gap beyond it is empty
    const at = pl.t * (amount < 0 ? L + amount : L);
    const cx = a.x + tx * at, cy = a.y + ty * at;
    const points = piece.points.map((q) => ((q.x - cx) * tx + (q.y - cy) * ty > 1e-6 ? { ...q, x: q.x + tx * amount, y: q.y + ty * amount } : q));
    setPieces(pieces.map((p) => (p.id === piece.id ? { ...p, points } : p)));
  };
  const setEdits = (fn: (e: Edits) => Edits) =>
    set((s) => ({ project: { ...s.project, edits: fn(s.project.edits ?? EMPTY_EDITS), updatedAt: Date.now() } }));
  const setPieces = (pieces: Piece[]) => set((s) => ({ project: { ...s.project, pieces, updatedAt: Date.now() } }));
  /** keep the open outfit in the store and on the device */
  const putOutfit = (o: Outfit) => { const next = { ...o, updatedAt: Date.now() }; saveOutfit(next); set({ outfit: next }); };
  /** put a garment of an outfit on the outfit body: the open one in the store, a saved one on the device */
  const onOutfitBody = (projectId: string, body: Body) => {
    const same = (p: Project) => JSON.stringify(p.body) === JSON.stringify(body);
    const move = (p: Project): Project => ({ ...p, body: { ...body }, pieces: p.linkPattern ? regrade(p, p.body, body) : p.pieces, updatedAt: Date.now() });
    const open = get().project;
    if (open.id === projectId) { if (!same(open)) set({ project: move(open) }); return; }
    const p = listProjects().find((q) => q.id === projectId);
    if (p && !same(p)) saveProject(move(p));
  };

  return {
    project: freshProject('jacket', 'My first jacket'),
    theme: readTheme(),
    inspectorTab: 'garment',
    units: 'cm',
    tool: 'select',
    symmetry: true,
    totalSymmetry: false,
    setTotalSymmetry: (on) => set(on ? { totalSymmetry: true, symmetry: true, linkedHot: [] } : { totalSymmetry: false, linkedHot: [] }),
    linkedHot: [],
    symPreview: null,
    showMeasure: false,
    showStitch: true,
    showNotes: true,
    selNote: null,
    noteKind: 'ink',
    noteColor: '#ff3b30',
    noteWidth: 3,
    addNote: (n) => {
      const id = uid();
      get().commit();
      set((s) => ({ project: { ...s.project, notes: [...(s.project.notes ?? []), { ...n, id, createdAt: Date.now() }], updatedAt: Date.now() }, selNote: id }));
      return id;
    },
    updateNote: (id, patch) => set((s) => ({ project: { ...s.project, notes: (s.project.notes ?? []).map((q) => (q.id === id ? { ...q, ...patch } : q)), updatedAt: Date.now() } })),
    removeNote: (id) => {
      get().commit();
      set((s) => ({ project: { ...s.project, notes: (s.project.notes ?? []).filter((q) => q.id !== id), updatedAt: Date.now() }, selNote: s.selNote === id ? null : s.selNote }));
    },
    setWholeBody: (b) =>
      set((s) => {
        const body = { ...b } as Body;
        const pieces = s.project.linkPattern ? regrade(s.project, s.project.body, body) : s.project.pieces;
        return { project: { ...s.project, body, pieces, updatedAt: Date.now() } };
      }),
    selPiece: null,
    selPoint: null,
    selMulti: [],
    snapOn: true,
    setMulti: (items) => set((s) => ({ selMulti: items, selPoint: null, selPiece: items.length ? (items.some((i) => i.pieceId === s.selPiece) ? s.selPiece : items[0].pieceId) : s.selPiece })),
    moveGroup: (moves) => {
      const { symmetry, project } = get();
      const by = new Map<string, Map<string, Pt>>();
      for (const m of moves) { if (!by.has(m.pieceId)) by.set(m.pieceId, new Map()); by.get(m.pieceId)!.set(m.pointId, { x: m.x, y: m.y }); }
      const pieces = project.pieces.map((p) => {
        const mv = by.get(p.id);
        if (!mv) return p;
        const ids = new Map(p.points.map((q) => [q.id, q]));
        return {
          ...p,
          points: p.points.map((q) => {
            const own = mv.get(q.id);
            const onAxis = q.mirror === q.id;
            const twin = symmetry && !onAxis && q.mirror ? ids.get(q.mirror) : undefined;
            const twinMoved = twin && mv.has(twin.id) ? mv.get(twin.id) : undefined;
            if (own && twinMoved && q.x < twin!.x) return { ...q, x: -twinMoved.x, y: twinMoved.y };
            if (own) return { ...q, x: symmetry && onAxis ? 0 : own.x, y: own.y };
            const partner = symmetry && q.mirror && q.mirror !== q.id ? mv.get(q.mirror) : undefined;
            if (partner && ids.get(q.mirror!)?.mirror === q.id) return { ...q, x: -partner.x, y: partner.y };
            return q;
          }),
        };
      });
      setPieces(pieces);
    },
    setSmoothMany: (items, smooth) => {
      const { symmetry, project } = get();
      get().commit();
      const ids = new Set(items.map((i) => i.pieceId + '|' + i.pointId));
      setPieces(project.pieces.map((p) => ({
        ...p,
        points: p.points.map((q) => (ids.has(p.id + '|' + q.id) || (symmetry && q.mirror && q.mirror !== q.id && ids.has(p.id + '|' + q.mirror)) ? { ...q, smooth } : q)),
      })));
    },
    view3d: 'fabric',
    showBody: true,
    pullMode: false,
    skin: 1,
    showJoints: false,
    showGarment: true,
    showTape: false,
    draping: false,
    simStatus: '',
    drapePeak: { ratio: 0, strain: 0, where: '' },
    redrapeToken: 0,
    mode: 'stand',
    fabricScope: 'all',
    past: [],
    future: [],
    fitToken: 0,
    selLayer: null,
    selPleat: null,
    hoverSeam: null,
    seamDraft: EMPTY_SEAM_DRAFT,
    penDraft: [],
    penSnap: true,
    penSheet: null,
    seamHint: null,
    symmetricPose: true,
    cancelTools: () => set({ blockDraft: null, selNote: null, tool: 'select', seamDraft: EMPTY_SEAM_DRAFT, penDraft: [], penSheet: null, pieceFlow: null, seamHint: null, selLayer: null, selPleat: null, hoverSeam: null }),
    designOpen: false,
    designCollapsed: false,
    designTab: 'add',
    designSize: readDesignSize(),
    designFace: 'outside',
    viewFace: 'outside',
    chartFace: 'outside',
    coachDone: readCoach(),
    openDesign: (tab = 'add', face) => set((s) => ({ designOpen: true, designCollapsed: false, designTab: tab, ...(face ? { designFace: face, viewFace: face } : {}), coachDone: true })),
    dismissCoach: () => { try { localStorage.setItem(COACH_KEY, '1'); } catch { /* storage blocked */ } set({ coachDone: true }); },
    showBothSides: true,
    selInstance: null,
    pieceFlow: null,
    setFlow: (patch) => set((s) => (s.pieceFlow ? { pieceFlow: { ...s.pieceFlow, ...patch } } : {})),
    sections: {},
    setSection: (id, open) => set((s) => ({ sections: { ...s.sections, [id]: open } })),
    drawer: false,

    set: (s) => set(s),

    commit: () => set((s) => ({ past: [...s.past.slice(-99), snap(s.project)], future: [] })),

    undo: () => {
      const { past, future, project } = get();
      if (!past.length) return;
      set({ past: past.slice(0, -1), future: [snap(project), ...future], selPoint: null });
      restore(past[past.length - 1]);
    },

    redo: () => {
      const { past, future, project } = get();
      if (!future.length) return;
      set({ past: [...past, snap(project)], future: future.slice(1), selPoint: null });
      restore(future[0]);
    },

    select: (piece, point = null) => set({ selPiece: piece, selPoint: point, selMulti: [], ...(piece === null ? { selInstance: null, fabricScope: 'all' } : {}) }),

    measureFlash: null,
    colourBlock: { colour: '#111111', sheen: 'matte', look: 'dyed', h: 6, mode: 'rect' },
    blockDraft: null,
    addColourBlocks: (list) => {
      if (!list.length) return;
      get().commit();
      const added = list.map((a) => ({ ...a, id: uid() }));
      setEdits((e) => ({ ...e, attachments: [...e.attachments, ...added] }));
      set({ selAttachment: added[0].id, blockDraft: null });
    },
    setMeasure: (target, value, unit) => {
      const { project, totalSymmetry, units } = get();
      const cm = fromUnit(value, unit ?? units);
      const moves = setMeasurement(project.garment, project.pieces, target, cm, { total: totalSymmetry });
      if (!moves.length) return false;
      const next = applyMoves(project.pieces, moves);
      // every number on screen that changed pulses, the typed one first
      const keys = new Set<string>([targetKey(target)]);
      const diff = (a: { label: string; value: number }[], b: { label: string; value: number }[], pre: (l: string) => string) =>
        a.forEach((r, i) => { if (Math.abs(r.value - (b[i]?.value ?? r.value)) > 0.005 || a.length !== b.length) keys.add(pre(r.label)); });
      project.pieces.forEach((p, i) => diff(pieceSpecs(p), pieceSpecs(next[i]), (l) => `spec:${p.id}:${l}`));
      diff(garmentSpecs(project.garment, project.pieces), garmentSpecs(project.garment, next), (l) => `garment:${l}`);
      const fa = fitTable(project.garment, project.pieces, project.body), fb = fitTable(project.garment, next, project.body);
      fa.forEach((r, i) => { if (Math.abs(r.garment - (fb[i]?.garment ?? r.garment)) > 0.005) keys.add(`fit:${r.label}`); });
      get().commit();
      set((s) => ({ project: { ...s.project, pieces: next, updatedAt: Date.now() }, measureFlash: { n: (s.measureFlash?.n ?? 0) + 1, keys: [...keys], points: moves.map((m) => m.pointId) } }));
      return true;
    },

    movePoint: (pieceId, pointId, x, y) => {
      const { symmetry, totalSymmetry, project } = get();
      if (totalSymmetry) {
        const pt = project.pieces.find((p) => p.id === pieceId)?.points.find((q) => q.id === pointId);
        if (pt) setPieces(applyMoves(project.pieces, linkedMoves(project.garment, project.pieces, pieceId, pointId, x - pt.x, y - pt.y)));
        return;
      }
      setPieces(
        mapPiece(project.pieces, pieceId, (p) => {
          const pt = p.points.find((q) => q.id === pointId);
          if (!pt) return p;
          const onAxis = pt.mirror === pt.id;
          const nx = symmetry && onAxis ? 0 : x;
          return {
            ...p,
            points: p.points.map((q) => {
              if (q.id === pointId) return { ...q, x: nx, y };
              if (symmetry && !onAxis && q.id === pt.mirror) return { ...q, x: -nx, y };
              return q;
            }),
          };
        }),
      );
    },

    movePiece: (pieceId, offset) => setPieces(mapPiece(get().project.pieces, pieceId, (p) => ({ ...p, offset }))),

    insertPoint: (pieceId, seg, t) => {
      const { symmetry, project } = get();
      const p = project.pieces.find((q) => q.id === pieceId);
      if (!p) return null;
      get().commit();
      const pts = p.points;
      const n = pts.length;
      const A = pts[seg], B = pts[(seg + 1) % n];
      const pos = bezAt(toBeziers(pts)[seg], t);
      const newPt: PPoint = { id: uid(), x: pos.x, y: pos.y, smooth: true, mirror: null };
      let out = [...pts.slice(0, seg + 1), newPt, ...pts.slice(seg + 1)];

      if (symmetry && A.mirror && B.mirror) {
        const selfMirror = A.mirror === B.id && B.mirror === A.id;
        if (selfMirror) {
          newPt.x = 0;
          newPt.mirror = newPt.id;
        } else if (A.mirror !== A.id || B.mirror !== B.id) {
          // mirrored segment runs from mirror(B) to mirror(A)
          const iMB = out.findIndex((q) => q.id === B.mirror);
          const iMA = out.findIndex((q) => q.id === A.mirror);
          if (iMB >= 0 && iMA >= 0 && (iMB + 1) % out.length === iMA) {
            const twin: PPoint = { id: uid(), x: -pos.x, y: pos.y, smooth: true, mirror: newPt.id };
            newPt.mirror = twin.id;
            out = [...out.slice(0, iMB + 1), twin, ...out.slice(iMB + 1)];
          }
        }
      }
      setPieces(mapPiece(project.pieces, pieceId, (q) => ({ ...q, points: out })));
      set({ selPiece: pieceId, selPoint: newPt.id });
      return newPt.id;
    },

    deletePoint: (pieceId, pointId) => {
      const { symmetry, project } = get();
      const p = project.pieces.find((q) => q.id === pieceId);
      if (!p) return;
      const pt = p.points.find((q) => q.id === pointId);
      if (!pt || pt.tag) return; // keep measurement anchors
      const drop = new Set([pointId]);
      if (symmetry && pt.mirror && pt.mirror !== pointId) drop.add(pt.mirror);
      if (p.points.length - drop.size < 3) return;
      get().commit();
      const points = p.points
        .filter((q) => !drop.has(q.id))
        .map((q) => (q.mirror && drop.has(q.mirror) ? { ...q, mirror: null } : q));
      setPieces(mapPiece(project.pieces, pieceId, (q) => ({ ...q, points })));
      set({ selPoint: null });
    },

    toggleSmooth: (pieceId, pointId) => {
      const { symmetry, project } = get();
      get().commit();
      setPieces(
        mapPiece(project.pieces, pieceId, (p) => {
          const pt = p.points.find((q) => q.id === pointId);
          if (!pt) return p;
          const v = !pt.smooth;
          return { ...p, points: p.points.map((q) => (q.id === pointId || (symmetry && q.id === pt.mirror) ? { ...q, smooth: v } : q)) };
        }),
      );
    },

    setFabric: (fabricId, color) => get().applyFabric({ id: fabricId, color }),
    applyFabric: (spec) => {
      const { fabricScope, selPiece, project } = get();
      // "this piece" only counts while a piece is selected: after a click on empty chart the controls fall back to
      // the whole garment, and so does this (it used to stay on "piece" and silently change nothing)
      const one = fabricScope === 'piece' && !!selPiece && project.pieces.some((p) => p.id === selPiece);
      get().commit();
      setPieces(project.pieces.map((p) => (!one || p.id === selPiece ? { ...p, fabric: { ...spec } } : p)));
    },

    setBody: (key, v) =>
      set((s) => {
        const body = { ...s.project.body, [key]: v } as Body;
        if (v === undefined) delete (body as unknown as Record<string, unknown>)[key];
        const r = s.project.linkPattern ? regradeAll(s.project, s.project.body, body) : {};
        return { project: { ...s.project, body, ...r, updatedAt: Date.now() } };
      }),
    resetBody: () =>
      set((s) => {
        const body = { ...DEFAULT_BODY };
        const r = s.project.linkPattern ? regradeAll(s.project, s.project.body, body) : {};
        return { project: { ...s.project, body, ...r, updatedAt: Date.now() } };
      }),
    setLink: (on) => set((s) => ({ project: { ...s.project, linkPattern: on, updatedAt: Date.now() } })),
    setFit: (fit) =>
      set((s) => {
        get().commit();
        const r = regradeAll(s.project, s.project.body, s.project.body, s.project.fit ?? 'regular', fit);
        return { project: { ...s.project, fit, ...r, updatedAt: Date.now() } };
      }),

    screen: typeof location !== 'undefined' && new URLSearchParams(location.search).get('screen') === 'editor' ? 'editor' : 'home',
    setScreen: (screen) => set({ screen }),
    newFlow: { mode: 'create', from: 'home' },
    openNew: (mode, from) => set({ newFlow: { mode, from }, screen: 'new' }),
    createProject: ({ style, name, fit, sex, body: given }) =>
      set((s) => {
        const body = { ...(given ?? (sex === 'female' ? FEMALE_BODY : MALE_BODY)) };
        let project = freshProject(style, name.trim() || undefined, body);
        if (fit !== 'regular') project = { ...project, fit, ...regradeAll(project, body, body, 'regular', fit) };
        return { project, past: [], future: [], selPiece: null, selPoint: null, selAttachment: null, fitToken: s.fitToken + 1, tool: 'select', sections: {}, viewFace: 'outside', chartFace: 'outside', fabricScope: 'all' };
      }),
    restyle: (id) =>
      set((s) => {
        const old = s.project;
        const fit = old.fit ?? 'regular';
        let project = { ...freshProject(id, old.name, old.body), id: old.id };
        if (fit !== 'regular') project = { ...project, fit, ...regradeAll(project, old.body, old.body, 'regular', fit) };
        return { project, past: [], future: [], selPiece: null, selPoint: null, selAttachment: null, fitToken: s.fitToken + 1, tool: 'select' };
      }),
    newProject: (id) => set((s) => ({ project: freshProject(id, undefined, s.project.body), past: [], future: [], selPiece: null, selPoint: null, fitToken: s.fitToken + 1, sections: {}, viewFace: 'outside', chartFace: 'outside', fabricScope: 'all' })),
    // older saves stored 'jacket' | 'shirt' | 'pants'; map them onto catalog styles
    loadProject: (p) => set((s) => ({ project: migrateProject(p), past: [], future: [], selPiece: null, selPoint: null, fitToken: s.fitToken + 1, sections: {}, viewFace: 'outside', chartFace: 'outside', fabricScope: 'all' })),
    rename: (name) => set((s) => ({ project: { ...s.project, name, updatedAt: Date.now() } })),

    probe: null,
    workspace: 'shape',
    designMode: 'patch',
    paintTab: 'edge',
    setWorkspace: (w) => { const m = { ...readWorkspaceMap(), [get().project.id]: w }; writeWorkspaceMap(m); set({ workspace: w }); },
    design: newDesign(),
    setDesign: (patch) => set((s) => ({ design: { ...s.design, ...(typeof patch === 'function' ? patch(s.design) : patch) } })),
    designSel: [],
    dwTab: 'layers',
    selBand: null,
    addBand: (b = {}) => {
      const id = uid();
      get().commit();
      setEdits((e) => ({ ...e, bands: [...(e.bands ?? []), { ...defaultBand(), ...b, id }] }));
      set({ selBand: id });
      return id;
    },
    updateBand: (id, patch) => setEdits((e) => ({ ...e, bands: (e.bands ?? []).map((q) => (q.id === id ? { ...q, ...patch } : q)) })),
    removeBand: (id) => {
      get().commit();
      setEdits((e) => ({ ...e, bands: (e.bands ?? []).filter((q) => q.id !== id) }));
      set((s) => ({ selBand: s.selBand === id ? null : s.selBand }));
    },
    // ---- outfits ----
    outfit: null,
    activeItem: null,
    newOutfit: (name, body) => {
      const o: Outfit = { id: uid(), name: name.trim() || 'My outfit', body: { ...body }, items: [], updatedAt: Date.now() };
      saveOutfit(o);
      set({ outfit: o, activeItem: null });
      return o.id;
    },
    openOutfit: (id) => {
      const o = listOutfits().find((q) => q.id === id);
      if (!o) return;
      set({ outfit: o, activeItem: null });
      const first = o.items.slice().sort((a, b) => a.layer - b.layer)[0];
      if (first) get().setActiveItem(first.projectId);
    },
    leaveOutfit: () => set({ outfit: null, activeItem: null }),
    addToOutfit: (projectId) => {
      const o = get().outfit;
      if (!o || o.items.some((i) => i.projectId === projectId)) return;
      onOutfitBody(projectId, o.body);
      putOutfit({ ...o, items: [...o.items, { projectId, layer: o.items.reduce((m, i) => Math.max(m, i.layer + 1), 0), tuck: 'out' }] });
      if (!get().activeItem) get().setActiveItem(projectId);
    },
    removeFromOutfit: (projectId) => {
      const o = get().outfit;
      if (!o) return;
      const items = o.items.filter((i) => i.projectId !== projectId).sort((a, b) => a.layer - b.layer).map((i, n) => ({ ...i, layer: n }));
      putOutfit({ ...o, items });
      if (get().activeItem === projectId) { set({ activeItem: null }); if (items[0]) get().setActiveItem(items[0].projectId); }
    },
    setOutfitLayer: (projectId, layer) => {
      const o = get().outfit;
      if (!o) return;
      const sorted = o.items.slice().sort((a, b) => a.layer - b.layer);
      const from = sorted.findIndex((i) => i.projectId === projectId);
      if (from < 0) return;
      const [it] = sorted.splice(from, 1);
      sorted.splice(Math.max(0, Math.min(sorted.length, layer)), 0, it);
      putOutfit({ ...o, items: sorted.map((i, n) => ({ ...i, layer: n })) });
    },
    setTuck: (projectId, tuck) => { const o = get().outfit; if (o) putOutfit({ ...o, items: o.items.map((i) => (i.projectId === projectId ? { ...i, tuck } : i)) }); },
    setItemHidden: (projectId, hidden) => { const o = get().outfit; if (o) putOutfit({ ...o, items: o.items.map((i) => (i.projectId === projectId ? { ...i, hidden } : i)) }); },
    setActiveItem: (projectId) => {
      const { project, outfit } = get();
      if (project.id === projectId) { set({ activeItem: projectId }); return; }
      saveProject(project);
      if (outfit) onOutfitBody(projectId, outfit.body);
      const p = listProjects().find((q) => q.id === projectId);
      if (!p) return;
      get().loadProject(p);
      set({ activeItem: projectId });
    },
    setOutfitBody: (body) => {
      const o = get().outfit;
      if (!o) return;
      for (const it of o.items) onOutfitBody(it.projectId, body);
      putOutfit({ ...o, body: { ...body } });
    },

    // ---- edits ----
    selAttachment: null,
    addAttachment: (a) => {
      const id = uid();
      get().commit();
      // on a piece cut more than once (sleeves, pant legs) a new attachment goes on one side: the right one unless
      // chosen. Saved attachments without an instance keep meaning "every copy".
      const host = get().project.pieces.find((p) => p.id === a.pieceId);
      const inst = a.instance === undefined && host && host.cut > 1 ? { instance: 0 } : {};
      setEdits((e) => ({ ...e, attachments: [...e.attachments, { ...a, ...inst, id }] }));
      set({ selAttachment: id });
      return id;
    },
    duplicateAttachment: (id) => {
      const a = get().project.edits?.attachments.find((q) => q.id === id);
      if (!a) return null;
      get().commit();
      const nid = uid();
      const copy: Attachment = JSON.parse(JSON.stringify(a));
      copy.id = nid;
      copy.name = `${a.name} copy`;
      copy.x = a.x + 1.5; copy.y = a.y + 1.5;
      copy.layers = copy.layers.map((l) => ({ ...l, id: uid() }));
      if (copy.hardware?.layers) copy.hardware.layers = copy.hardware.layers.map((l) => ({ ...l, id: uid() }));
      if (copy.hardware?.zipper?.pullerLayers) copy.hardware.zipper.pullerLayers = copy.hardware.zipper.pullerLayers.map((l) => ({ ...l, id: uid() }));
      setEdits((e) => ({ ...e, attachments: [...e.attachments, copy] }));
      set({ selAttachment: nid });
      return nid;
    },
    setCollar: (c) => { get().commit(); setEdits((e) => ({ ...e, collar: c })); },
    setClosure: (c) => { get().commit(); setEdits((e) => ({ ...e, closure: c })); },
    setInsideFabric: (pieceId, fabric) => {
      get().commit();
      setEdits((e) => {
        const m = { ...(e.insideFabric ?? {}) };
        if (fabric) m[pieceId] = fabric; else delete m[pieceId];
        return { ...e, insideFabric: m };
      });
    },
    setInsideAll: (fabric) => {
      get().commit();
      setEdits((e) => ({ ...e, insideFabric: fabric ? Object.fromEntries(get().project.pieces.map((p) => [p.id, fabric])) : {} }));
    },
    updateAttachment: (id, patch) => setEdits((e) => ({ ...e, attachments: e.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    removeAttachment: (id) => {
      get().commit();
      // designs sewn onto this attachment go with it
      setEdits((e) => ({ ...e, attachments: e.attachments.filter((a) => a.id !== id && a.pieceId !== id) }));
      set((s) => ({ selAttachment: s.selAttachment === id ? null : s.selAttachment }));
    },
    addCustomSeam: (cs) => {
      const id = uid();
      get().commit();
      setEdits((e) => ({ ...e, customSeams: [...e.customSeams, { ...cs, id }] }));
      return id;
    },
    removeCustomSeam: (id) => {
      get().commit();
      setEdits((e) => ({ ...e, customSeams: e.customSeams.filter((c) => c.id !== id) }));
    },
    setSeamAttached: (builtinId, attached) => {
      get().commit();
      setEdits((e) => ({ ...e, detachedSeams: attached ? e.detachedSeams.filter((d) => d !== builtinId) : [...new Set([...e.detachedSeams, builtinId])] }));
    },
    // pleats: the pattern is spread beside the fold by the intake so the folded edge still walks to its seam
    addPleat: (pl) => {
      const id = uid();
      get().commit();
      const spread = pleatIntakeOf(pl);
      spreadPleat(pl, spread);
      setEdits((e) => ({ ...e, pleats: [...e.pleats, { ...pl, id, spread }] }));
      return id;
    },
    updatePleat: (id, patch) => {
      const old = get().project.edits?.pleats.find((p) => p.id === id);
      if (!old) return;
      const next = { ...old, ...patch };
      const spread = pleatIntakeOf(next);
      if (old.spread) spreadPleat(old, -old.spread);
      spreadPleat(next, spread);
      setEdits((e) => ({ ...e, pleats: e.pleats.map((p) => (p.id === id ? { ...next, spread } : p)) }));
    },
    removePleat: (id) => {
      get().commit();
      const old = get().project.edits?.pleats.find((p) => p.id === id);
      if (old?.spread) spreadPleat(old, -old.spread);
      setEdits((e) => ({ ...e, pleats: e.pleats.filter((p) => p.id !== id) }));
      set((s) => ({ selPleat: s.selPleat === id ? null : s.selPleat }));
    },
    addCustomPiece: (name, pts, placement) => {
      get().commit();
      const id = uid();
      const points: PPoint[] = pts.map((q) => ({ id: uid(), x: q.x, y: q.y, smooth: false, mirror: null }));
      const host = get().project.pieces.find((p) => p.id === placement.hostPieceId);
      const fabric = host ? { ...host.fabric } : { ...get().project.pieces[0].fabric };
      const maxX = Math.max(0, ...get().project.pieces.map((p) => p.offset.x + Math.max(...p.points.map((q) => q.x))));
      const piece: Piece = { id, name, role: 'custom', cut: 1, offset: { x: maxX + 25, y: 20 }, symmetric: false, points, fabric, specs: [{ label: 'Length', kind: 'length' }], placement };
      setPieces([...get().project.pieces, piece]);
      set({ selPiece: id, selPoint: null });
      return id;
    },
    updatePiece: (id, patch) => setPieces(get().project.pieces.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    removePiece: (id) => {
      get().commit();
      setPieces(get().project.pieces.filter((p) => p.id !== id));
      setEdits((e) => ({
        ...e,
        attachments: e.attachments.filter((a) => a.pieceId !== id && !e.attachments.some((h) => h.id === a.pieceId && h.pieceId === id)),
        customSeams: e.customSeams.filter((c) => c.a.pieceId !== id && c.b.pieceId !== id),
        pleats: e.pleats.filter((p) => p.pieceId !== id),
      }));
      set({ selPiece: null, selPoint: null });
    },

    // ---- body presets and posing ----
    setBodyPreset: (sex) =>
      set((s) => {
        const body = { ...(sex === 'female' ? FEMALE_BODY : MALE_BODY) };
        const r = s.project.linkPattern ? regradeAll(s.project, s.project.body, body) : {};
        return { project: { ...s.project, body, ...r, updatedAt: Date.now() } };
      }),
    customPose: ZERO_POSE,
    setPoseAngle: (side, key, value) =>
      set((s) => {
        const p: CustomPose = { ...s.customPose, s: [{ ...s.customPose.s[0] }, { ...s.customPose.s[1] }] };
        if (side === null) (p as unknown as Record<string, number>)[key] = value;
        else (p.s[side] as unknown as Record<string, number>)[key] = value;
        return { customPose: p, mode: 'custom' };
      }),
    resetPose: () => set({ customPose: ZERO_POSE }),
  };
});

/**
 * Subscribe to a few store fields. A component re-renders only when one of them changes (shallow compare), not on
 * every store update (simulation status, drape peak, hover state and the like change many times a second).
 */
export function usePick<K extends keyof State>(...keys: K[]): Pick<State, K> {
  return useStore(useShallow((s: State) => {
    const o = {} as Pick<State, K>;
    for (const k of keys) o[k] = s[k];
    return o;
  }));
}

// profiling hook: ?perf exposes the store to the performance harness (no effect otherwise)
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf')) (window as unknown as { __store: typeof useStore }).__store = useStore;
