import { create } from 'zustand';
import { makePreset, GARMENT_LABEL, type Piece } from './data/presets';
import { migrateGarment, type StyleId } from './data/catalog';
import { DEFAULT_BODY, type Body } from './three/body';
import { draft, regradePoints, type Fit } from './data/draft';
import { bezAt, toBeziers, type PPoint, type Pt } from './lib/geometry';
import { uid, type Units } from './lib/units';
import { EMPTY_EDITS, ZERO_POSE, type Attachment, type CustomPose, type CustomSeam, type Edits, type EdgeRef, type Placement, type Pleat } from './data/edits';
import { FEMALE_BODY, MALE_BODY } from './three/body';

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
  updatedAt: number;
}

export type Tool = 'select' | 'add' | 'pan' | 'seams' | 'pleat' | 'pen';
export type ThemePref = 'system' | 'light' | 'dark';
export type InspectorTab = 'library' | 'fabric' | 'patchwork' | 'seams' | 'pose' | 'specs';

/** Seam being joined by hand: a range on one piece, then a range on another (point ids on the outline). */
export interface SeamDraft { a: Partial<EdgeRef> | null; b: Partial<EdgeRef> | null; flip: boolean }
export const EMPTY_SEAM_DRAFT: SeamDraft = { a: null, b: null, flip: false };
/** A point of the pen tool outline in pattern space (cm); smooth when the pointer was dragged. */
export interface PenPoint { x: number; y: number; smooth: boolean }

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

interface State {
  theme: ThemePref;
  inspectorTab: InspectorTab;
  project: Project;
  units: Units;
  tool: Tool;
  symmetry: boolean;
  showMeasure: boolean;
  showStitch: boolean;
  selPiece: string | null;
  selPoint: string | null;
  view3d: 'fabric' | 'stretch';
  showBody: boolean;
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
  past: Piece[][];
  future: Piece[][];
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
  /** drop every half-finished tool action and go back to Select */
  cancelTools: () => void;

  set: (s: Partial<State>) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  select: (piece: string | null, point?: string | null) => void;
  movePoint: (pieceId: string, pointId: string, x: number, y: number) => void;
  movePiece: (pieceId: string, offset: Pt) => void;
  insertPoint: (pieceId: string, seg: number, t: number) => string | null;
  deletePoint: (pieceId: string, pointId: string) => void;
  toggleSmooth: (pieceId: string, pointId: string) => void;
  setFabric: (fabricId: string, color: number) => void;
  setBody: (key: keyof Body, v: number | undefined) => void;
  resetBody: () => void;
  setLink: (on: boolean) => void;
  setFit: (fit: Fit) => void;
  newProject: (id: StyleId) => void;
  // --- edits (attachments, seams, pleats, user pieces) ---
  selAttachment: string | null;
  addAttachment: (a: Omit<Attachment, 'id'>) => string;
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
}

/** A new project for any catalog style, drafted on the given body in the style's default fabric. */
export function freshProject(id: StyleId, name?: string, body: Body = DEFAULT_BODY): Project {
  const g = migrateGarment(id);
  return { id: uid(), name: name ?? `Untitled ${GARMENT_LABEL[g].toLowerCase()}`, garment: g, pieces: makePreset(g, body), body: { ...body }, linkPattern: true, fit: 'regular', updatedAt: Date.now() };
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

const mapPiece = (pieces: Piece[], id: string, fn: (p: Piece) => Piece) => pieces.map((p) => (p.id === id ? fn(p) : p));

export const useStore = create<State>((set, get) => {
  const setEdits = (fn: (e: Edits) => Edits) =>
    set((s) => ({ project: { ...s.project, edits: fn(s.project.edits ?? EMPTY_EDITS), updatedAt: Date.now() } }));
  const setPieces = (pieces: Piece[]) => set((s) => ({ project: { ...s.project, pieces, updatedAt: Date.now() } }));

  return {
    project: freshProject('jacket', 'My first jacket'),
    theme: readTheme(),
    inspectorTab: 'fabric',
    units: 'cm',
    tool: 'select',
    symmetry: true,
    showMeasure: true,
    showStitch: true,
    selPiece: null,
    selPoint: null,
    view3d: 'fabric',
    showBody: true,
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
    cancelTools: () => set({ tool: 'select', seamDraft: EMPTY_SEAM_DRAFT, penDraft: [], penSheet: null, seamHint: null, selLayer: null, selPleat: null, hoverSeam: null }),

    set: (s) => set(s),

    commit: () => set((s) => ({ past: [...s.past.slice(-99), s.project.pieces], future: [] })),

    undo: () => {
      const { past, future, project } = get();
      if (!past.length) return;
      set({ past: past.slice(0, -1), future: [project.pieces, ...future], selPoint: null });
      setPieces(past[past.length - 1]);
    },

    redo: () => {
      const { past, future, project } = get();
      if (!future.length) return;
      set({ past: [...past, project.pieces], future: future.slice(1), selPoint: null });
      setPieces(future[0]);
    },

    select: (piece, point = null) => set({ selPiece: piece, selPoint: point }),

    movePoint: (pieceId, pointId, x, y) => {
      const { symmetry, project } = get();
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

    setFabric: (fabricId, color) => {
      const { fabricScope, selPiece, project } = get();
      get().commit();
      setPieces(project.pieces.map((p) => (fabricScope === 'all' || p.id === selPiece ? { ...p, fabric: { id: fabricId, color } } : p)));
    },

    setBody: (key, v) =>
      set((s) => {
        const body = { ...s.project.body, [key]: v } as Body;
        if (v === undefined) delete (body as unknown as Record<string, unknown>)[key];
        const pieces = s.project.linkPattern ? regrade(s.project, s.project.body, body) : s.project.pieces;
        return { project: { ...s.project, body, pieces, updatedAt: Date.now() } };
      }),
    resetBody: () =>
      set((s) => {
        const body = { ...DEFAULT_BODY };
        const pieces = s.project.linkPattern ? regrade(s.project, s.project.body, body) : s.project.pieces;
        return { project: { ...s.project, body, pieces, updatedAt: Date.now() } };
      }),
    setLink: (on) => set((s) => ({ project: { ...s.project, linkPattern: on, updatedAt: Date.now() } })),
    setFit: (fit) =>
      set((s) => {
        get().commit();
        const pieces = regrade(s.project, s.project.body, s.project.body, s.project.fit ?? 'regular', fit);
        return { project: { ...s.project, fit, pieces, updatedAt: Date.now() } };
      }),

    newProject: (id) => set((s) => ({ project: freshProject(id, undefined, s.project.body), past: [], future: [], selPiece: null, selPoint: null, fitToken: s.fitToken + 1 })),
    // older saves stored 'jacket' | 'shirt' | 'pants'; map them onto catalog styles
    loadProject: (p) => set((s) => ({ project: { ...p, garment: migrateGarment(p.garment), linkPattern: p.linkPattern ?? true }, past: [], future: [], selPiece: null, selPoint: null, fitToken: s.fitToken + 1 })),
    rename: (name) => set((s) => ({ project: { ...s.project, name, updatedAt: Date.now() } })),

    // ---- edits ----
    selAttachment: null,
    addAttachment: (a) => {
      const id = uid();
      get().commit();
      setEdits((e) => ({ ...e, attachments: [...e.attachments, { ...a, id }] }));
      set({ selAttachment: id });
      return id;
    },
    updateAttachment: (id, patch) => setEdits((e) => ({ ...e, attachments: e.attachments.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
    removeAttachment: (id) => {
      get().commit();
      setEdits((e) => ({ ...e, attachments: e.attachments.filter((a) => a.id !== id) }));
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
    addPleat: (pl) => {
      const id = uid();
      get().commit();
      setEdits((e) => ({ ...e, pleats: [...e.pleats, { ...pl, id }] }));
      return id;
    },
    updatePleat: (id, patch) => setEdits((e) => ({ ...e, pleats: e.pleats.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
    removePleat: (id) => {
      get().commit();
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
        attachments: e.attachments.filter((a) => a.pieceId !== id),
        customSeams: e.customSeams.filter((c) => c.a.pieceId !== id && c.b.pieceId !== id),
        pleats: e.pleats.filter((p) => p.pieceId !== id),
      }));
      set({ selPiece: null, selPoint: null });
    },

    // ---- body presets and posing ----
    setBodyPreset: (sex) =>
      set((s) => {
        const body = { ...(sex === 'female' ? FEMALE_BODY : MALE_BODY) };
        const pieces = s.project.linkPattern ? regrade(s.project, s.project.body, body) : s.project.pieces;
        return { project: { ...s.project, body, pieces, updatedAt: Date.now() } };
      }),
    customPose: ZERO_POSE,
    setPoseAngle: (side, key, value) =>
      set((s) => {
        const p: CustomPose = { ...s.customPose, s: [{ ...s.customPose.s[0] }, { ...s.customPose.s[1] }] };
        if (side === null) (p as unknown as Record<string, number>)[key] = value;
        else (p.s[side] as unknown as Record<string, number>)[key] = value;
        return { customPose: p, mode: 'custom' as never };
      }),
    resetPose: () => set({ customPose: ZERO_POSE }),
  };
});
