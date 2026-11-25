import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Piece } from '../data/presets';
import { fabricById } from '../data/fabrics';
import { fabricDataUrl } from '../lib/textures';
import {
  bbox, bezAt, bezLength, bezTangent, centroid, nearestOnOutline, offsetInward, pathD, polyD, samplePoly, toBeziers, type Pt,
} from '../lib/geometry';
import { pieceSpecs } from '../lib/specs';
import { fmt } from '../lib/units';
import { pointInPoly } from '../lib/geometry';
import { builtinSeams } from '../sim/seams';
import type { Attachment, EdgeRef, Pleat } from '../data/edits';
import { ArtworkGroup, outlineD } from './Artwork';
import { pleatMarks, runD, runIndices, runMid } from './editHelpers';
import { pickSeamPoint } from './SeamsTab';

type View = { x: number; y: number; k: number };

type Drag =
  | { mode: 'point'; pieceId: string; pointId: string; start: Pt; committed: boolean }
  | { mode: 'piece'; pieceId: string; start: Pt; startOffset: Pt; committed: boolean }
  | { mode: 'attach'; id: string; grab: Pt; start: Pt; committed: boolean }
  | { mode: 'ghost'; pieceId: string; grab: Pt; start: Pt; committed: boolean }
  | { mode: 'pen'; startClient: Pt; smoothed: boolean }
  | { mode: 'pan'; startClient: Pt; startView: View }
  | { mode: 'pinch'; startDist: number; startMid: Pt; startView: View };

const ACCENT = 'var(--measure)';
export const SEAM_ALLOWANCE = 1; // cm
const GRID_SNAP = 0.5; // cm

/** A highlighted run along a piece outline: built in seams, custom seams and the join in progress. */
type RunStyle = 'attached' | 'detached' | 'custom' | 'hover' | 'draftA' | 'draftB';
interface Run { key: string; ref: EdgeRef; style: RunStyle; label?: string }

const round2 = (n: number) => Math.round(n * 100) / 100;

export default function PatternEditor() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 3 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const lastTap = useRef<{ t: number; key: string }>({ t: 0, key: '' });

  const s = useStore();
  const { project, tool, symmetry, showMeasure, showStitch, selPiece, selPoint, units, fitToken, selAttachment, selPleat, hoverSeam, seamDraft, penDraft, penSnap } = s;
  const pieces = project.pieces;
  const edits = project.edits;
  const [penHover, setPenHover] = useState<Pt | null>(null);
  useEffect(() => { if (tool !== 'pen') setPenHover(null); }, [tool]);

  // ---- seam runs to draw, grouped by piece ------------------------------
  const seamList = useMemo(() => builtinSeams(project.garment, pieces), [project.garment, pieces]);
  const runsByPiece = useMemo(() => {
    const m = new Map<string, Run[]>();
    const add = (r: Run) => m.set(r.ref.pieceId, [...(m.get(r.ref.pieceId) ?? []), r]);
    const detached = new Set(edits?.detachedSeams ?? []);
    for (const sm of seamList) {
      const off = detached.has(sm.id);
      const hot = hoverSeam === sm.id;
      if (!off && !hot && tool !== 'seams') continue;
      [...sm.a, ...sm.b].forEach((ref, i) => add({ key: `${sm.id}-${i}`, ref, style: hot ? 'hover' : off ? 'detached' : 'attached' }));
    }
    (edits?.customSeams ?? []).forEach((c, i) => {
      const hot = hoverSeam === c.id;
      add({ key: c.id + 'a', ref: c.a, style: hot ? 'hover' : 'custom', label: `S${i + 1}` });
      add({ key: c.id + 'b', ref: c.b, style: hot ? 'hover' : 'custom', label: `S${i + 1}` });
    });
    if (tool === 'seams') {
      const { a, b } = seamDraft;
      if (a?.pieceId && a.fromId && a.toId) add({ key: 'dA', ref: a as EdgeRef, style: 'draftA', label: 'A' });
      if (b?.pieceId && b.fromId && b.toId) add({ key: 'dB', ref: b as EdgeRef, style: 'draftB', label: 'B' });
    }
    return m;
  }, [seamList, edits?.detachedSeams, edits?.customSeams, hoverSeam, tool, seamDraft]);
  const draftStarts = useMemo(() => {
    const m = new Map<string, { id: string; tag: string }[]>();
    if (tool !== 'seams') return m;
    for (const [tag, r] of [['A', seamDraft.a], ['B', seamDraft.b]] as const) {
      if (r?.pieceId && r.fromId && !r.toId) m.set(r.pieceId, [...(m.get(r.pieceId) ?? []), { id: r.fromId, tag }]);
    }
    return m;
  }, [tool, seamDraft]);

  // ---- fit to view -------------------------------------------------------
  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const all: Pt[] = [];
    for (const p of useStore.getState().project.pieces) for (const q of p.points) all.push({ x: q.x + p.offset.x, y: q.y + p.offset.y });
    if (!all.length) return;
    const bb = bbox(all);
    const r = el.getBoundingClientRect();
    const pad = 50;
    const k = Math.min((r.width - pad * 2) / bb.w, (r.height - pad * 2) / bb.h, 12);
    setView({ k, x: (r.width - bb.w * k) / 2 - bb.minX * k, y: (r.height - bb.h * k) / 2 - bb.minY * k });
  };
  useEffect(() => {
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
  }, [fitToken]);
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('tps-fit', onFit);
    return () => window.removeEventListener('tps-fit', onFit);
  }, []);

  // ---- coordinate helpers ------------------------------------------------
  const toWorld = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  const snap = (w: Pt): Pt => (useStore.getState().penSnap ? { x: Math.round(w.x / GRID_SNAP) * GRID_SNAP, y: Math.round(w.y / GRID_SNAP) * GRID_SNAP } : w);

  /** the piece under a world point (topmost first), or the fallback */
  const hostAt = (w: Pt, fallback: string, skipCustom = true): string => {
    const ps = useStore.getState().project.pieces;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      if (skipCustom && p.role === 'custom') continue;
      if (pointInPoly(samplePoly(p.points, 8), { x: w.x - p.offset.x, y: w.y - p.offset.y })) return p.id;
    }
    return fallback;
  };

  const zoomAt = (cx: number, cy: number, factor: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(40, Math.max(0.4, v.k * factor));
      const px = cx - r.left, py = cy - r.top;
      return { k, x: px - ((px - v.x) / v.k) * k, y: py - ((py - v.y) / v.k) * k };
    });
  };

  useEffect(() => {
    const el = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      zoomAt(e.clientX, e.clientY, f);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ---- pointer handling (mouse, Apple Pencil and touch) -------------------
  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    drag.current = {
      mode: 'pinch',
      startDist: Math.hypot(a.x - b.x, a.y - b.y),
      startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      startView: viewRef.current,
    };
  };

  const isDoubleTap = (key: string) => {
    const now = performance.now();
    const hit = now - lastTap.current.t < 320 && lastTap.current.key === key;
    lastTap.current = { t: hit ? 0 : now, key };
    return hit;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    svgRef.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) return startPinch();
    if (pointers.current.size > 2) return;

    const st = useStore.getState();
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    const kind = target?.dataset.kind;
    const pieceId = target?.dataset.piece;
    const w = toWorld(e.clientX, e.clientY);
    const panNow = () => (drag.current = { mode: 'pan', startClient: { x: e.clientX, y: e.clientY }, startView: viewRef.current });

    if (st.tool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) return panNow();

    // ---- pen: click to add a corner, drag to make it smooth, click the first point to close
    if (st.tool === 'pen') {
      const d = st.penDraft;
      if (d.length >= 3 && Math.hypot(w.x - d[0].x, w.y - d[0].y) * viewRef.current.k < 14) {
        st.set({ penSheet: d, penDraft: [] });
        drag.current = null;
        return;
      }
      const sp = snap(w);
      st.set({ penDraft: [...d, { x: sp.x, y: sp.y, smooth: false }] });
      drag.current = { mode: 'pen', startClient: { x: e.clientX, y: e.clientY }, smoothed: false };
      return;
    }

    // ---- seams: points pick the ends of a range
    if (st.tool === 'seams') {
      if (kind === 'point' && pieceId) {
        pickSeamPoint(pieceId, target!.dataset.point!);
        drag.current = null;
        return;
      }
      if (!kind) { panNow(); return; }
      return;
    }

    // ---- pleat: click an edge to place one
    if (st.tool === 'pleat') {
      if ((kind === 'edge' || kind === 'piece') && pieceId) {
        const piece = st.project.pieces.find((p) => p.id === pieceId)!;
        const near = nearestOnOutline(piece.points, { x: w.x - piece.offset.x, y: w.y - piece.offset.y });
        if (near.d < 16 / viewRef.current.k) {
          const id = st.addPleat({ pieceId, pointId: piece.points[near.seg].id, t: near.t, depth: 2, length: 12, type: 'knife', direction: 1 });
          st.set({ selPleat: id, selPiece: pieceId, selAttachment: null });
        }
        return;
      }
      if (kind === 'pleat') { st.set({ selPleat: target!.dataset.pleat!, selAttachment: null }); return; }
      if (!kind) panNow();
      return;
    }

    if (kind === 'pleat') {
      st.set({ selPleat: target!.dataset.pleat!, selAttachment: null, inspectorTab: 'seams' });
      drag.current = null;
      return;
    }

    if (kind === 'attach') {
      const id = target!.dataset.att!;
      const att = st.project.edits?.attachments.find((a) => a.id === id);
      const host = att && st.project.pieces.find((p) => p.id === att.pieceId);
      if (att && host) {
        st.set({ selAttachment: id, selPiece: att.pieceId, selPoint: null, selPleat: null, selLayer: null, inspectorTab: 'patchwork' });
        drag.current = { mode: 'attach', id, grab: { x: w.x - (host.offset.x + att.x), y: w.y - (host.offset.y + att.y) }, start: w, committed: false };
        return;
      }
    }

    if (kind === 'ghost' && pieceId) {
      const cp = st.project.pieces.find((p) => p.id === pieceId);
      const host = st.project.pieces.find((p) => p.id === cp?.placement?.hostPieceId);
      if (cp?.placement && host) {
        st.set({ selPiece: pieceId, selPoint: null, selAttachment: null, selPleat: null, inspectorTab: 'seams' });
        drag.current = { mode: 'ghost', pieceId, grab: { x: w.x - (host.offset.x + (cp.placement.x ?? 0)), y: w.y - (host.offset.y + (cp.placement.y ?? 0)) }, start: w, committed: false };
        return;
      }
    }

    if (kind === 'point' && pieceId) {
      const pointId = target!.dataset.point!;
      if (isDoubleTap('pt' + pointId)) {
        st.toggleSmooth(pieceId, pointId);
        drag.current = null;
        return;
      }
      st.select(pieceId, pointId);
      drag.current = { mode: 'point', pieceId, pointId, start: w, committed: false };
      return;
    }

    if ((kind === 'edge' || kind === 'piece') && pieceId) {
      const piece = st.project.pieces.find((p) => p.id === pieceId)!;
      const local = { x: w.x - piece.offset.x, y: w.y - piece.offset.y };
      const near = nearestOnOutline(piece.points, local);
      const close = near.d < 14 / viewRef.current.k;
      const dbl = isDoubleTap('pc' + pieceId);
      if ((st.tool === 'add' && close) || (kind === 'edge' && dbl)) {
        const id = st.insertPoint(pieceId, near.seg, near.t);
        if (id) drag.current = { mode: 'point', pieceId, pointId: id, start: w, committed: true };
        return;
      }
      st.select(pieceId, null);
      st.set({ selAttachment: null, selPleat: null });
      drag.current = { mode: 'piece', pieceId, start: w, startOffset: piece.offset, committed: false };
      return;
    }

    st.select(null, null);
    st.set({ selAttachment: null, selPleat: null });
    panNow();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (useStore.getState().tool === 'pen') setPenHover(snap(toWorld(e.clientX, e.clientY)));
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    const st = useStore.getState();

    if (d.mode === 'pinch') {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const sv = d.startView;
      const k = Math.min(40, Math.max(0.4, sv.k * (dist / d.startDist)));
      const r = svgRef.current!.getBoundingClientRect();
      const wx = (d.startMid.x - r.left - sv.x) / sv.k;
      const wy = (d.startMid.y - r.top - sv.y) / sv.k;
      setView({ k, x: mid.x - r.left - wx * k, y: mid.y - r.top - wy * k });
      return;
    }
    if (d.mode === 'pan') {
      setView({ ...d.startView, x: d.startView.x + e.clientX - d.startClient.x, y: d.startView.y + e.clientY - d.startClient.y });
      return;
    }
    if (d.mode === 'pen') {
      if (!d.smoothed && Math.hypot(e.clientX - d.startClient.x, e.clientY - d.startClient.y) > 6) {
        d.smoothed = true;
        const pd = st.penDraft;
        if (pd.length) st.set({ penDraft: pd.map((q, i) => (i === pd.length - 1 ? { ...q, smooth: true } : q)) });
      }
      return;
    }
    const w = toWorld(e.clientX, e.clientY);
    if (d.mode === 'attach' || d.mode === 'ghost') {
      if (!d.committed) {
        if (Math.hypot(w.x - d.start.x, w.y - d.start.y) * viewRef.current.k < 3) return;
        st.commit(); // commit on drag start so undo steps back to before the move
        d.committed = true;
      }
      const centre = { x: w.x - d.grab.x, y: w.y - d.grab.y };
      if (d.mode === 'attach') {
        const att = st.project.edits?.attachments.find((a) => a.id === d.id);
        if (!att) return;
        const host = st.project.pieces.find((p) => p.id === hostAt(w, att.pieceId, false))!;
        st.updateAttachment(d.id, { pieceId: host.id, x: round2(centre.x - host.offset.x), y: round2(centre.y - host.offset.y) });
        if (st.selPiece !== host.id) st.set({ selPiece: host.id });
      } else {
        const cp = st.project.pieces.find((p) => p.id === d.pieceId);
        if (!cp?.placement) return;
        const host = st.project.pieces.find((p) => p.id === hostAt(w, cp.placement!.hostPieceId ?? '', true));
        if (!host) return;
        st.updatePiece(d.pieceId, { placement: { ...cp.placement, hostPieceId: host.id, x: round2(centre.x - host.offset.x), y: round2(centre.y - host.offset.y) } });
      }
      return;
    }
    if (!d.committed) {
      if (Math.hypot(w.x - d.start.x, w.y - d.start.y) * viewRef.current.k < 3) return;
      st.commit();
      d.committed = true;
    }
    const piece = st.project.pieces.find((p) => p.id === d.pieceId);
    if (!piece) return;
    if (d.mode === 'point') {
      st.movePoint(d.pieceId, d.pointId, w.x - piece.offset.x, w.y - piece.offset.y);
    } else {
      st.movePiece(d.pieceId, { x: d.startOffset.x + w.x - d.start.x, y: d.startOffset.y + w.y - d.start.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) drag.current = null;
    else if (pointers.current.size === 1 && drag.current?.mode === 'pinch') {
      const [p] = [...pointers.current.values()];
      drag.current = { mode: 'pan', startClient: p, startView: viewRef.current };
    }
  };

  // ---- render ------------------------------------------------------------
  const k = view.k;
  const px = (n: number) => n / k; // screen pixels to world units

  const grid = (
    <defs>
      <pattern id="g1" width="1" height="1" patternUnits="userSpaceOnUse">
        <path d="M1 0H0V1" fill="none" stroke="var(--grid)" strokeWidth={px(1)} />
      </pattern>
      <pattern id="g10" width="10" height="10" patternUnits="userSpaceOnUse">
        {k > 2.2 && <rect width="10" height="10" fill="url(#g1)" />}
        <path d="M10 0H0V10" fill="none" stroke="var(--grid-major)" strokeWidth={px(1)} />
      </pattern>
      {pieces.map((p) => {
        const f = fabricById(p.fabric.id);
        const hex = f.colors[p.fabric.color]?.hex ?? f.colors[0].hex;
        return (
          <pattern key={p.id} id={'fab-' + p.id} width="6" height="6" patternUnits="userSpaceOnUse">
            <image href={fabricDataUrl(f, hex)} width="6" height="6" preserveAspectRatio="none" />
          </pattern>
        );
      })}
      <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 1L10 5L0 9z" fill="var(--dim-line)" />
      </marker>
    </defs>
  );

  return (
    <div className="editor">
      <svg
        ref={svgRef}
        className={`editor-svg tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(e) => e.preventDefault()}
      >
        {grid}
        <g transform={`translate(${view.x},${view.y}) scale(${k})`}>
          <rect x={-2000} y={-2000} width={4000} height={4000} fill="url(#g10)" />
          {pieces.map((p) => (
            <PieceView
              key={p.id}
              piece={p}
              k={k}
              selected={p.id === selPiece}
              selPoint={p.id === selPiece ? selPoint : null}
              symmetry={symmetry}
              showMeasure={showMeasure}
              showStitch={showStitch}
              units={units}
              tool={tool}
              attachments={(edits?.attachments ?? []).filter((a) => a.pieceId === p.id)}
              selAttachment={selAttachment}
              pleats={(edits?.pleats ?? []).filter((q) => q.pieceId === p.id)}
              selPleat={selPleat}
              ghosts={pieces.filter((q) => q.role === 'custom' && q.placement?.mode === 'patch' && q.placement.hostPieceId === p.id)}
              runs={runsByPiece.get(p.id) ?? []}
              starts={draftStarts.get(p.id) ?? []}
            />
          ))}
          {tool === 'pen' && <PenPreview draft={penDraft} hover={penHover} k={k} snap={penSnap} />}
        </g>
      </svg>
      <div className="editor-hud">
        <span>{Math.round(k * 10)}%</span>
        <span className="hud-sep" />
        <span>{HUD[tool] ?? HUD.select}</span>
      </div>
    </div>
  );
}

const HUD: Record<string, string> = {
  select: 'Drag points to reshape · double-tap an edge to add a point · double-tap a point for curve/corner · drag a pocket or patch to move it',
  add: 'Tap an edge to add a point',
  pan: 'Drag to pan',
  seams: 'Click a start point, then an end point, to pick a range to sew. Escape to stop.',
  pleat: 'Click an edge of a piece to place a pleat. Escape to stop.',
  pen: 'Click to add corners · drag for a curve · click the first point to close · Backspace removes the last point · Escape cancels',
};

function PenPreview({ draft, hover, k, snap }: { draft: { x: number; y: number; smooth: boolean }[]; hover: Pt | null; k: number; snap: boolean }) {
  const px = (n: number) => n / k;
  const pts = draft.map((q, i) => ({ id: String(i), x: q.x, y: q.y, smooth: q.smooth, mirror: null }));
  const closing = draft.length >= 3 && hover && Math.hypot(hover.x - draft[0].x, hover.y - draft[0].y) * k < 14;
  const withHover = hover && !closing ? [...pts, { id: 'h', x: hover.x, y: hover.y, smooth: false, mirror: null }] : pts;
  const d = withHover.length >= 3 ? pathD(toBeziers(withHover)) : withHover.length === 2 ? `M${withHover[0].x},${withHover[0].y}L${withHover[1].x},${withHover[1].y}` : '';
  return (
    <g pointerEvents="none">
      {d && <path d={d} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(1.6)} strokeDasharray={`${px(6)} ${px(4)}`} strokeLinejoin="round" />}
      {draft.map((q, i) => {
        const r = px(i === 0 ? 7 : 5);
        return q.smooth ? (
          <circle key={i} cx={q.x} cy={q.y} r={r} fill={i === 0 ? 'var(--accent)' : 'var(--point-fill)'} stroke="var(--accent)" strokeWidth={px(2)} />
        ) : (
          <rect key={i} x={q.x - r} y={q.y - r} width={r * 2} height={r * 2} fill={i === 0 ? 'var(--accent)' : 'var(--point-fill)'} stroke="var(--accent)" strokeWidth={px(2)} />
        );
      })}
      {closing && <circle cx={draft[0].x} cy={draft[0].y} r={px(13)} fill="none" stroke="var(--accent)" strokeWidth={px(2)} />}
      {hover && snap && <circle cx={hover.x} cy={hover.y} r={px(2.5)} fill="var(--accent)" />}
    </g>
  );
}

function PieceView(props: {
  piece: Piece;
  k: number;
  selected: boolean;
  selPoint: string | null;
  symmetry: boolean;
  showMeasure: boolean;
  showStitch: boolean;
  units: 'cm' | 'in';
  tool: string;
  attachments: Attachment[];
  selAttachment: string | null;
  pleats: Pleat[];
  selPleat: string | null;
  ghosts: Piece[];
  runs: Run[];
  starts: { id: string; tag: string }[];
}) {
  const { piece: p, k, selected, selPoint, symmetry, showMeasure, showStitch, units, tool, attachments, selAttachment, pleats, selPleat, ghosts, runs, starts } = props;
  const px = (n: number) => n / k;
  const selPieceId = useStore((st) => st.selPiece);

  const geo = useMemo(() => {
    const bz = toBeziers(p.points);
    const poly = samplePoly(p.points);
    const bb = bbox(poly);
    return {
      bz,
      d: pathD(bz),
      poly,
      bb,
      c: centroid(poly),
      cut: polyD(offsetInward(poly, -SEAM_ALLOWANCE)),
      specs: pieceSpecs(p),
    };
  }, [p.points, p.specs]);

  const sel = p.points.find((q) => q.id === selPoint);
  const fontPx = 11;

  return (
    <g transform={`translate(${p.offset.x},${p.offset.y})`}>
      {/* body */}
      <path d={geo.d} fill={`url(#fab-${p.id})`} data-kind="piece" data-piece={p.id} style={{ cursor: 'move' }} />
      <path d={geo.d} fill="var(--piece-sheen)" pointerEvents="none" />
      {showStitch && <path d={geo.cut} fill="none" stroke="var(--cut-line)" strokeWidth={px(1)} pointerEvents="none" />}
      {/* the editable outline is the sewing line (finished size); the outer line is the cut line with seam allowance */}
      <path d={geo.d} fill="none" stroke={selected ? 'var(--accent)' : 'var(--outline)'} strokeWidth={px(selected ? 2 : 1.4)} strokeDasharray={showStitch ? `${px(6)} ${px(3)}` : undefined} pointerEvents="none" />
      {/* wide invisible stroke for picking edges */}
      <path d={geo.d} fill="none" stroke="transparent" strokeWidth={px(16)} data-kind="edge" data-piece={p.id} />

      {/* grainline + label */}
      <line
        x1={geo.c.x} x2={geo.c.x} y1={geo.c.y - geo.bb.h * 0.22} y2={geo.c.y + geo.bb.h * 0.22}
        stroke="var(--dim-line)" strokeWidth={px(1)} markerStart="url(#arr)" markerEnd="url(#arr)" pointerEvents="none" opacity={0.7}
      />
      <text x={geo.c.x + 1.2} y={geo.c.y - 1} className="piece-label" fontSize={Math.min(3, geo.bb.w / 9)} pointerEvents="none">
        {p.name}
      </text>
      <text x={geo.c.x + 1.2} y={geo.c.y + 2.6} className="piece-sub" fontSize={Math.min(2.2, geo.bb.w / 12)} pointerEvents="none">
        Cut {p.cut} · {fabricById(p.fabric.id).name}
      </text>

      {/* symmetry axis */}
      {symmetry && p.symmetric && (
        <line x1={0} x2={0} y1={geo.bb.minY - 4} y2={geo.bb.maxY + 4} stroke="var(--purple)" strokeWidth={px(1.2)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
      )}

      {/* measurements */}
      {showMeasure &&
        geo.specs.map((m) => {
          const mx = (m.a.x + m.b.x) / 2, my = (m.a.y + m.b.y) / 2;
          const label = `${m.label} ${fmt(m.value, units)}`;
          const w = px(label.length * 6.1 + 10);
          const h = px(17);
          const tick = px(5);
          return (
            <g key={m.label} pointerEvents="none">
              <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={ACCENT} strokeWidth={px(1)} />
              {m.vertical ? (
                <>
                  <line x1={m.a.x - tick} x2={m.a.x + tick} y1={m.a.y} y2={m.a.y} stroke={ACCENT} strokeWidth={px(1)} />
                  <line x1={m.b.x - tick} x2={m.b.x + tick} y1={m.b.y} y2={m.b.y} stroke={ACCENT} strokeWidth={px(1)} />
                </>
              ) : (
                <>
                  <line x1={m.a.x} x2={m.a.x} y1={m.a.y - tick} y2={m.a.y + tick} stroke={ACCENT} strokeWidth={px(1)} />
                  <line x1={m.b.x} x2={m.b.x} y1={m.b.y - tick} y2={m.b.y + tick} stroke={ACCENT} strokeWidth={px(1)} />
                </>
              )}
              <g transform={`translate(${mx},${my})${m.vertical ? ' rotate(-90)' : ''}`}>
                <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={px(4)} fill="var(--canvas)" stroke={ACCENT} strokeWidth={px(1)} />
                <text className="dim-text" fontSize={px(fontPx)} textAnchor="middle" dominantBaseline="central">
                  {label}
                </text>
              </g>
            </g>
          );
        })}

      {/* edge lengths on the selected piece */}
      {selected &&
        geo.bz.map((b, i) => {
          const L = bezLength(b);
          if (L * k < 40) return null;
          const m = bezAt(b, 0.5);
          const t = bezTangent(b, 0.5);
          let n = { x: -t.y, y: t.x };
          if ((m.x + n.x - geo.c.x) ** 2 + (m.y + n.y - geo.c.y) ** 2 < (m.x - geo.c.x) ** 2 + (m.y - geo.c.y) ** 2) n = { x: -n.x, y: -n.y };
          return (
            <text key={i} x={m.x + n.x * px(14)} y={m.y + n.y * px(14)} className="edge-len" fontSize={px(10)} textAnchor="middle" dominantBaseline="central" pointerEvents="none">
              {fmt(L, units)}
            </text>
          );
        })}

      {/* seam runs: built in, detached, custom and the join in progress */}
      {runs.map((r) => {
        const idx = runIndices(p.points, r.ref.fromId, r.ref.toId);
        if (!idx.length) return null;
        const d = runD(geo.bz, idx);
        const mid = r.label ? runMid(geo.bz, idx) : null;
        const w = r.style === 'hover' ? 7 : r.style === 'draftA' || r.style === 'draftB' ? 6 : r.style === 'custom' ? 3 : r.style === 'detached' ? 3 : 2;
        const stroke = r.style === 'hover' ? 'var(--accent)' : r.style === 'draftA' ? 'var(--accent)' : r.style === 'draftB' ? 'var(--green)' : r.style === 'custom' ? 'var(--purple)' : r.style === 'detached' ? 'var(--orange)' : 'var(--label-2)';
        const badge = r.style === 'draftA' ? 'var(--accent)' : r.style === 'draftB' ? 'var(--green)' : 'var(--purple)';
        return (
          <g key={r.key} pointerEvents="none">
            <path d={d} fill="none" stroke={stroke} strokeWidth={px(w)} strokeLinecap="round" strokeLinejoin="round" opacity={r.style === 'hover' || r.style === 'draftA' || r.style === 'draftB' ? 0.55 : 1} strokeDasharray={r.style === 'detached' ? `${px(2)} ${px(7)}` : undefined} />
            {(r.style === 'draftA' || r.style === 'draftB') && <path d={d} fill="none" stroke={stroke} strokeWidth={px(2)} strokeLinecap="round" />}
            {r.style === 'detached' && <path d={d} fill="none" stroke={stroke} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(5)}`} />}
            {mid && r.label && (
              <g transform={`translate(${mid.x},${mid.y})`}>
                <circle r={px(9)} fill={badge} />
                <text fontSize={px(11)} fill="#fff" textAnchor="middle" dominantBaseline="central" fontWeight={700}>{r.label}</text>
              </g>
            )}
          </g>
        );
      })}
      {starts.map((s) => {
        const q = p.points.find((x) => x.id === s.id);
        return q ? <circle key={s.tag} cx={q.x} cy={q.y} r={px(11)} fill="none" stroke={s.tag === 'A' ? 'var(--accent)' : 'var(--green)'} strokeWidth={px(3)} pointerEvents="none" /> : null;
      })}

      {/* pleats: fold lines (solid), placement lines (dashed), arrows and notches */}
      {pleats.map((pl) => {
        const m = pleatMarks(pl, p.points, geo.bz, geo.c);
        if (!m) return null;
        const on = pl.id === selPleat;
        const col = on ? 'var(--accent)' : 'var(--outline)';
        return (
          <g key={pl.id}>
            {m.lines.map((l, i) => (
              <g key={i}>
                <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke={col} strokeWidth={px(on ? 2.2 : 1.6)} strokeDasharray={l.fold ? undefined : `${px(5)} ${px(4)}`} pointerEvents="none" />
                <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="transparent" strokeWidth={px(18)} data-kind="pleat" data-pleat={pl.id} style={{ cursor: 'pointer' }} />
              </g>
            ))}
            {m.arrows.map((a, i) => <line key={i} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} stroke={col} strokeWidth={px(1.6)} markerEnd="url(#arr)" pointerEvents="none" />)}
            {m.notches.map((n, i) => <line key={i} x1={n.a.x} y1={n.a.y} x2={n.b.x} y2={n.b.y} stroke={col} strokeWidth={px(2)} pointerEvents="none" />)}
          </g>
        );
      })}

      {/* attachments sit on their host in the host's own coordinates */}
      {attachments.map((a) => {
        const o = outlineD(a);
        const f = fabricById((a.fabric ?? p.fabric).id);
        const hex = (f.colors[(a.fabric ?? p.fabric).color] ?? f.colors[0]).hex;
        const on = a.id === selAttachment;
        return (
          <g key={a.id} transform={`translate(${a.x},${a.y}) rotate(${a.rotation})`} data-kind="attach" data-att={a.id} style={{ cursor: 'move' }}>
            <path d={o.d} transform={o.transform} fill="transparent" />
            <ArtworkGroup a={a} fill={hex} />
            <path d={o.d} transform={o.transform} fill="none" stroke={on ? 'var(--accent)' : 'var(--outline)'} strokeWidth={px(on ? 2.2 : 1.4)} strokeDasharray={`${px(6)} ${px(4)}`} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            {on && <circle r={px(3)} fill="var(--accent)" pointerEvents="none" />}
            {(tool === 'select' || on) && <text y={a.h / 2 + px(14)} fontSize={px(11)} textAnchor="middle" className="edge-len" pointerEvents="none">{a.name}</text>}
          </g>
        );
      })}

      {/* drawn pieces that are patched on: dashed placement, draggable */}
      {ghosts.map((g) => {
        const pl = g.placement!;
        const on = g.id === selPieceId;
        const f = fabricById(g.fabric.id);
        const hex = (f.colors[g.fabric.color] ?? f.colors[0]).hex;
        return (
          <g key={g.id} transform={`translate(${pl.x ?? 0},${pl.y ?? 0}) rotate(${pl.rotation ?? 0})`} data-kind="ghost" data-piece={g.id} style={{ cursor: 'move' }}>
            <path d={pathD(toBeziers(g.points))} fill={hex} fillOpacity={0.85} stroke={on ? 'var(--accent)' : 'var(--outline)'} strokeWidth={px(on ? 2.2 : 1.4)} strokeDasharray={`${px(6)} ${px(4)}`} />
            <text y={px(4)} fontSize={px(11)} textAnchor="middle" className="edge-len" pointerEvents="none">{g.name}</text>
          </g>
        );
      })}

      {/* points */}
      {p.points.map((q) => {
          const isSel = q.id === selPoint;
          const isMirror = symmetry && sel && sel.mirror === q.id && sel.id !== q.id;
          const r = px(isSel ? 6 : tool === 'seams' ? 6 : selected ? 4.5 : 3.5);
          const fill = isSel ? 'var(--accent)' : isMirror ? 'var(--purple)' : 'var(--point-fill)';
          const stroke = isMirror ? 'var(--purple)' : selected ? 'var(--accent)' : 'var(--point-stroke)';
          return (
            <g key={q.id}>
              {q.smooth ? (
                <circle cx={q.x} cy={q.y} r={r} fill={fill} stroke={stroke} strokeWidth={px(1.5)} pointerEvents="none" />
              ) : (
                <rect x={q.x - r} y={q.y - r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} strokeWidth={px(1.5)} pointerEvents="none" />
              )}
              <circle cx={q.x} cy={q.y} r={px(tool === 'seams' ? 16 : 13)} fill="transparent" data-kind="point" data-piece={p.id} data-point={q.id} style={{ cursor: tool === 'seams' ? 'pointer' : 'grab' }} />
            </g>
          );
        })}
    </g>
  );
}
