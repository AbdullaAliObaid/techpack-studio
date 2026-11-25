import { create } from 'zustand';
import { makePreset, GARMENT_LABEL, type Piece } from './data/presets';
import { migrateGarment, type StyleId } from './data/catalog';
import { DEFAULT_BODY, type Body } from './three/body';
import { draft, regradePoints, type Fit } from './data/draft';
import { bezAt, toBeziers, type PPoint, type Pt } from './lib/geometry';
import { uid, type Units } from './lib/units';

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
  updatedAt: number;
}

export type Tool = 'select' | 'add' | 'pan';

interface State {
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
  const setPieces = (pieces: Piece[]) => set((s) => ({ project: { ...s.project, pieces, updatedAt: Date.now() } }));

  return {
    project: freshProject('jacket', 'My first jacket'),
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
  };
});
