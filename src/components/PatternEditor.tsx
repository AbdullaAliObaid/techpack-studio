import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
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
import { ArtworkGroup, isCloth, outlineD } from './Artwork';
import { canHostDesigns, pleatMarks, rootPiece, runD, runIndices, runMid, scaleAttachment, scaleLimits } from './editHelpers';
import { pickSeamPoint } from './ConstructionPanel';
import { ATTACHMENT_MIME, isAttachment } from './designLibrary';
import { attWorld, frameOn, instanceFor, layoutEntries, onCopy, toSource, toWorldPt, worldToAtt, type Entry } from './sides';
import { openPieceFlow } from './flow';
import Icon from './Icon';

type View = { x: number; y: number; k: number };

type Drag =
  | { mode: 'point'; pieceId: string; pointId: string; key: string; start: Pt; committed: boolean }
  | { mode: 'piece'; pieceId: string; start: Pt; startOffset: Pt; committed: boolean }
  | { mode: 'attach'; id: string; key: string; grab: Pt; start: Pt; committed: boolean }
  | { mode: 'resize'; id: string; key: string; c: Pt; rot: number; d0: number; att0: Attachment; committed: boolean }
  | { mode: 'rotate'; id: string; key: string; c: Pt; committed: boolean }
  | { mode: 'ghost'; pieceId: string; key: string; grab: Pt; start: Pt; committed: boolean }
  | { mode: 'pen'; startClient: Pt; smoothed: boolean }
  | { mode: 'pan'; startClient: Pt; startView: View }
  | { mode: 'pinch'; startDist: number; startMid: Pt; startView: View };

const ACCENT = 'var(--measure)';
export const SEAM_ALLOWANCE = 1; // cm
const GRID_SNAP = 0.5; // cm

/** A highlighted run along a piece outline: built in seams, custom seams and the join in progress. */
type RunStyle = 'attached' | 'detached' | 'custom' | 'hover' | 'draftA' | 'draftB';
interface Run { key: string; ref: EdgeRef; style: RunStyle; label?: string; /** drawn on every copy of the piece */ all?: boolean }
const runOn = (r: Run, e: Entry) => r.all || e.copies !== 2 || (r.ref.instance ?? 0) === e.inst;

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
  const { project, tool, symmetry, showMeasure, showStitch, selPiece, selPoint, selInstance, units, fitToken, selAttachment, selPleat, hoverSeam, seamDraft, penDraft, penSnap, showBothSides, pieceFlow } = s;
  const pieces = project.pieces;
  const edits = project.edits;
  const [penHover, setPenHover] = useState<Pt | null>(null);
  useEffect(() => { if (tool !== 'pen') setPenHover(null); }, [tool]);
  const picking = !!pieceFlow?.picking;
  const [pickHover, setPickHover] = useState<{ key: string; seg: number } | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { if (!picking) setPickHover(null); }, [picking]);

  // ---- what is drawn: pieces cut twice show as a right and a left pattern ----
  const entries = useMemo(() => layoutEntries(project.garment, pieces, showBothSides), [project.garment, pieces, showBothSides]);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const findEntry = (pieceId: string, inst = 0) => entriesRef.current.find((e) => e.src.id === pieceId && e.inst === inst) ?? entriesRef.current.find((e) => e.src.id === pieceId);
  /** the copy under a world point (topmost first) */
  const entryAt = (w: Pt, skipCustom = false): Entry | null => {
    const es = entriesRef.current;
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      if (skipCustom && e.src.role === 'custom') continue;
      if (pointInPoly(samplePoly(e.piece.points, 8), { x: w.x - e.offset.x, y: w.y - e.offset.y })) return e;
    }
    return null;
  };
  const instOf = (e: Entry) => (e.both ? e.inst : undefined);

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
      add({ key: c.id + 'a', ref: c.a, style: hot ? 'hover' : 'custom', label: `S${i + 1}`, all: c.a.instance === undefined });
      add({ key: c.id + 'b', ref: c.b, style: hot ? 'hover' : 'custom', label: `S${i + 1}`, all: c.b.instance === undefined });
    });
    if (tool === 'seams') {
      const { a, b } = seamDraft;
      if (a?.pieceId && a.fromId && a.toId) add({ key: 'dA', ref: a as EdgeRef, style: 'draftA', label: 'A' });
      if (b?.pieceId && b.fromId && b.toId) add({ key: 'dB', ref: b as EdgeRef, style: 'draftB', label: 'B' });
    }
    if (pieceFlow?.picking && pieceFlow.hostEdge) add({ key: 'flow-host', ref: pieceFlow.hostEdge, style: 'draftA', label: 'A' });
    return m;
  }, [seamList, edits?.detachedSeams, edits?.customSeams, hoverSeam, tool, seamDraft, pieceFlow?.picking, pieceFlow?.hostEdge]);
  const draftStarts = useMemo(() => {
    const m = new Map<string, { id: string; tag: string; inst?: number }[]>();
    if (tool !== 'seams') return m;
    for (const [tag, r] of [['A', seamDraft.a], ['B', seamDraft.b]] as const) {
      if (r?.pieceId && r.fromId && !r.toId) m.set(r.pieceId, [...(m.get(r.pieceId) ?? []), { id: r.fromId, tag, inst: r.instance }]);
    }
    return m;
  }, [tool, seamDraft]);

  // ---- fit to view -------------------------------------------------------
  const fit = () => {
    const el = svgRef.current;
    if (!el) return;
    const all: Pt[] = [];
    for (const e of entriesRef.current) for (const q of e.piece.points) all.push({ x: q.x + e.offset.x, y: q.y + e.offset.y });
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
  }, [fitToken, showBothSides]);
  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('tps-fit', onFit);
    // zoom in on a small piece so a design can be placed on it
    const onZoom = (e: Event) => {
      const d = (e as CustomEvent<{ pieceId: string; inst?: number | null }>).detail;
      const en = findEntry(d.pieceId, d.inst ?? 0);
      const el = svgRef.current;
      if (!en || !el) return;
      const bb = bbox(en.piece.points.map((q) => ({ x: q.x + en.offset.x, y: q.y + en.offset.y })));
      const r = el.getBoundingClientRect();
      const cur = viewRef.current.k;
      if (bb.w * cur > r.width * 0.45 && bb.h * cur > r.height * 0.3) return; // already big enough
      const k = Math.min((r.width - 80) / bb.w, (r.height - 80) / bb.h, 9);
      if (k <= cur * 1.15) return;
      setView({ k, x: (r.width - bb.w * k) / 2 - bb.minX * k, y: (r.height - bb.h * k) / 2 - bb.minY * k });
    };
    window.addEventListener('tps-zoom', onZoom);
    return () => { window.removeEventListener('tps-fit', onFit); window.removeEventListener('tps-zoom', onZoom); };
  }, []);

  // ---- coordinate helpers ------------------------------------------------
  const toWorld = (cx: number, cy: number): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  };

  const snap = (w: Pt): Pt => (useStore.getState().penSnap ? { x: Math.round(w.x / GRID_SNAP) * GRID_SNAP, y: Math.round(w.y / GRID_SNAP) * GRID_SNAP } : w);

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
    const ent = pieceId ? findEntry(pieceId, Number(target?.dataset.inst ?? 0)) : undefined;
    /** remember which copy the user is working on */
    const pick = (en?: Entry) => st.set({ selInstance: en?.both ? en.inst : null });
    const w = toWorld(e.clientX, e.clientY);
    const panNow = () => (drag.current = { mode: 'pan', startClient: { x: e.clientX, y: e.clientY }, startView: viewRef.current });

    if (st.tool === 'pan' || e.button === 1 || (e.button === 0 && e.altKey)) return panNow();

    // ---- new piece, sewing it into an edge: click the edge of the garment it joins
    if (st.pieceFlow?.picking) {
      const en = ent ?? entryAt(w);
      if (en) {
        const near = nearestOnOutline(en.piece.points, { x: w.x - en.offset.x, y: w.y - en.offset.y });
        if (near.d < 22 / viewRef.current.k) {
          const pts = en.src.points;
          st.setFlow({ hostEdge: { pieceId: en.src.id, fromId: pts[near.seg].id, toId: pts[(near.seg + 1) % pts.length].id, ...(en.both ? { instance: en.inst } : {}) } });
          drag.current = null;
          return;
        }
      }
      return panNow();
    }

    // ---- pen: click to add a corner, drag to make it smooth, click the first point to close
    if (st.tool === 'pen') {
      const d = st.penDraft;
      if (d.length >= 3 && Math.hypot(w.x - d[0].x, w.y - d[0].y) * viewRef.current.k < 14) {
        openPieceFlow(d);
        drag.current = null;
        return;
      }
      const sp = snap(w);
      st.set({ penDraft: [...d, { x: sp.x, y: sp.y, smooth: false }] });
      drag.current = { mode: 'pen', startClient: { x: e.clientX, y: e.clientY }, smoothed: false };
      return;
    }

    // ---- seams: points pick the ends of a range, on the copy that was clicked
    if (st.tool === 'seams') {
      if (kind === 'point' && pieceId) {
        pickSeamPoint(pieceId, target!.dataset.point!, ent ? instOf(ent) : undefined);
        drag.current = null;
        return;
      }
      if (!kind) { panNow(); return; }
      return;
    }

    // ---- pleat: click an edge to place one on that copy
    if (st.tool === 'pleat') {
      if ((kind === 'edge' || kind === 'piece') && pieceId && ent) {
        const near = nearestOnOutline(ent.piece.points, { x: w.x - ent.offset.x, y: w.y - ent.offset.y });
        if (near.d < 16 / viewRef.current.k) {
          // Pleat has no side field in the shared contract yet; the extra field is kept in the saved project
          const pl = { pieceId, pointId: ent.src.points[near.seg].id, t: near.t, depth: 2, length: 12, type: 'knife' as const, direction: 1 as const, ...(ent.both ? { instance: ent.inst } : {}) };
          const id = st.addPleat(pl);
          st.set({ selPleat: id, selPiece: pieceId, selAttachment: null });
          pick(ent);
        }
        return;
      }
      if (kind === 'pleat') { st.set({ selPleat: target!.dataset.pleat!, selAttachment: null }); return; }
      if (!kind) panNow();
      return;
    }

    if (kind === 'pleat') {
      st.set({ selPleat: target!.dataset.pleat!, selAttachment: null, inspectorTab: 'construction' });
      pick(ent);
      drag.current = null;
      return;
    }

    if (kind === 'attach' && ent) {
      const id = target!.dataset.att!;
      const all = st.project.edits?.attachments ?? [];
      const att = all.find((a) => a.id === id);
      if (att) {
        const at = attWorld(all, att, ent);
        st.set({ selAttachment: id, selPiece: ent.src.id, selPoint: null, selPleat: null, selLayer: null });
        st.openDesign('edit');
        pick(ent);
        drag.current = { mode: 'attach', id, key: ent.key, grab: { x: w.x - at.x, y: w.y - at.y }, start: w, committed: false };
        return;
      }
    }

    // handles on the selected design: corner resizes, top handle turns
    if (kind === 'handle' && ent) {
      const all = st.project.edits?.attachments ?? [];
      const att = all.find((a) => a.id === target!.dataset.att);
      if (att) {
        const at = attWorld(all, att, ent);
        if (target!.dataset.handle === 'rotate') drag.current = { mode: 'rotate', id: att.id, key: ent.key, c: { x: at.x, y: at.y }, committed: false };
        else {
          const r = (-at.rot * Math.PI) / 180, dx = w.x - at.x, dy = w.y - at.y;
          const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
          drag.current = { mode: 'resize', id: att.id, key: ent.key, c: { x: at.x, y: at.y }, rot: at.rot, d0: Math.max(1e-3, Math.hypot(lx, ly)), att0: att, committed: false };
        }
        return;
      }
    }

    if (kind === 'ghost' && pieceId) {
      const cp = st.project.pieces.find((p) => p.id === pieceId);
      const hostEnt = cp?.placement?.hostPieceId ? findEntry(cp.placement.hostPieceId, Number(target?.dataset.inst ?? 0)) : undefined;
      if (cp?.placement && hostEnt) {
        const at = toWorldPt(hostEnt, { x: cp.placement.x ?? 0, y: cp.placement.y ?? 0 });
        st.set({ selPiece: pieceId, selPoint: null, selAttachment: null, selPleat: null, inspectorTab: 'construction' });
        pick(hostEnt);
        drag.current = { mode: 'ghost', pieceId, key: hostEnt.key, grab: { x: w.x - at.x, y: w.y - at.y }, start: w, committed: false };
        return;
      }
    }

    if (kind === 'point' && pieceId && ent) {
      const pointId = target!.dataset.point!;
      if (isDoubleTap('pt' + pointId)) {
        st.toggleSmooth(pieceId, pointId);
        drag.current = null;
        return;
      }
      st.select(pieceId, pointId);
      pick(ent);
      drag.current = { mode: 'point', pieceId, pointId, key: ent.key, start: w, committed: false };
      return;
    }

    if ((kind === 'edge' || kind === 'piece') && pieceId && ent) {
      const local = { x: w.x - ent.offset.x, y: w.y - ent.offset.y };
      const near = nearestOnOutline(ent.piece.points, local);
      const close = near.d < 14 / viewRef.current.k;
      const dbl = isDoubleTap('pc' + ent.key);
      if ((st.tool === 'add' && close) || (kind === 'edge' && dbl)) {
        const id = st.insertPoint(pieceId, near.seg, near.t);
        pick(ent);
        if (id) drag.current = { mode: 'point', pieceId, pointId: id, key: ent.key, start: w, committed: true };
        return;
      }
      st.select(pieceId, null);
      pick(ent);
      st.set({ selAttachment: null, selPleat: null });
      drag.current = { mode: 'piece', pieceId, start: w, startOffset: ent.src.offset, committed: false };
      return;
    }

    st.select(null, null);
    st.set({ selAttachment: null, selPleat: null });
    panNow();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const stNow = useStore.getState();
    if (stNow.tool === 'pen') setPenHover(snap(toWorld(e.clientX, e.clientY)));
    if (stNow.pieceFlow?.picking && !drag.current) {
      const w0 = toWorld(e.clientX, e.clientY);
      const en = entryAt(w0);
      if (en) {
        const near = nearestOnOutline(en.piece.points, { x: w0.x - en.offset.x, y: w0.y - en.offset.y });
        const next = near.d < 22 / viewRef.current.k ? { key: en.key, seg: near.seg } : null;
        setPickHover((h) => (h?.key === next?.key && h?.seg === next?.seg ? h : next));
      } else setPickHover(null);
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = drag.current;
    if (!d) return;
    const st = stNow;

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
    if (d.mode === 'resize' || d.mode === 'rotate') {
      if (!d.committed) {
        if (Math.hypot(w.x - d.c.x, w.y - d.c.y) * viewRef.current.k < 3) return;
        st.commit();
        d.committed = true;
      }
      const all = st.project.edits?.attachments ?? [];
      const att = all.find((a) => a.id === d.id);
      const cur = entriesRef.current.find((en) => en.key === d.key);
      if (!att || !cur) return;
      if (d.mode === 'rotate') {
        let deg = (Math.atan2(w.y - d.c.y, w.x - d.c.x) * 180) / Math.PI + 90;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        const at = worldToAtt(all, att, cur, d.c, deg);
        let rot = ((at.rotation + 540) % 360) - 180;
        if (Math.abs(rot) < 2) rot = 0;
        st.updateAttachment(d.id, { rotation: Math.round(rot * 10) / 10 });
      } else {
        const r = (-d.rot * Math.PI) / 180, dx = w.x - d.c.x, dy = w.y - d.c.y;
        const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
        const [lo, hi] = scaleLimits(d.att0);
        const sc = Math.min(hi, Math.max(lo, Math.hypot(lx, ly) / d.d0));
        st.updateAttachment(d.id, scaleAttachment(d.att0, sc));
      }
      return;
    }
    if (d.mode === 'attach' || d.mode === 'ghost') {
      if (!d.committed) {
        if (Math.hypot(w.x - d.start.x, w.y - d.start.y) * viewRef.current.k < 3) return;
        st.commit(); // commit on drag start so undo steps back to before the move
        d.committed = true;
      }
      const centre = { x: w.x - d.grab.x, y: w.y - d.grab.y };
      const cur = entriesRef.current.find((en) => en.key === d.key);
      if (!cur) return;
      if (d.mode === 'attach') {
        const all = st.project.edits?.attachments ?? [];
        const att = all.find((a) => a.id === d.id);
        if (!att) return;
        if (all.some((q) => q.id === att.pieceId)) {
          // a design sewn onto a pocket or tag moves within it
          const at = worldToAtt(all, att, cur, centre, attWorld(all, att, cur).rot);
          st.updateAttachment(d.id, { x: round2(at.x), y: round2(at.y) });
          return;
        }
        const over = entryAt(w) ?? cur;
        const local = toSource(over, centre);
        const patch: Partial<Attachment> = { pieceId: over.src.id, x: round2(local.x), y: round2(local.y) };
        // dropping on another copy or piece moves it there; a "both sides" item keeps shared coordinates
        if (over.src.id !== att.pieceId) patch.instance = instanceFor(over);
        else if (att.instance !== undefined && over.both) patch.instance = over.inst;
        st.updateAttachment(d.id, patch);
        d.key = over.key;
        if (st.selPiece !== over.src.id) st.set({ selPiece: over.src.id });
        if (over.both && st.selInstance !== over.inst) st.set({ selInstance: over.inst });
      } else {
        const cp = st.project.pieces.find((p) => p.id === d.pieceId);
        if (!cp?.placement) return;
        const over = entryAt(w, true) ?? cur;
        const local = toSource(over, centre);
        st.updatePiece(d.pieceId, { placement: { ...cp.placement, hostPieceId: over.src.id, x: round2(local.x), y: round2(local.y), ...(over.both ? { instance: over.inst } : {}) } as typeof cp.placement });
        d.key = over.key;
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
      const en = entriesRef.current.find((x) => x.key === d.key);
      if (!en) return;
      const l = toSource(en, w);
      st.movePoint(d.pieceId, d.pointId, l.x, l.y);
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
      {Object.entries(edits?.insideFabric ?? {}).map(([pid, fb]) => {
        const f = fabricById(fb.id);
        return (
          <pattern key={'in-' + pid} id={'fab-in-' + pid} width="6" height="6" patternUnits="userSpaceOnUse">
            <image href={fabricDataUrl(f, (f.colors[fb.color] ?? f.colors[0]).hex)} width="6" height="6" preserveAspectRatio="none" />
          </pattern>
        );
      })}
      <pattern id="inside-hatch" width="1.2" height="1.2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line x1="0" y1="0" x2="0" y2="1.2" stroke="var(--grid-major)" strokeWidth={px(1)} />
      </pattern>
      <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse">
        <path d="M0 1L10 5L0 9z" fill="var(--dim-line)" />
      </marker>
    </defs>
  );

  const zoomBy = (f: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  };

  // ---- drop a design from the library onto the chart ------------------------
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(ATTACHMENT_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const en = entryAt(toWorld(e.clientX, e.clientY));
    setDropKey((cur) => (cur === (en?.key ?? null) ? cur : en?.key ?? null));
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(ATTACHMENT_MIME);
    setDropKey(null);
    if (!raw) return;
    e.preventDefault();
    const w = toWorld(e.clientX, e.clientY);
    const en = entryAt(w);
    if (!en) { setNote('Drop it on a piece of the pattern.'); setTimeout(() => setNote(null), 2500); return; }
    try {
      const t = JSON.parse(raw) as Partial<Attachment>;
      if (!isAttachment(t)) return;
      const stNow = useStore.getState();
      const all = stNow.project.edits?.attachments ?? [];
      // dropped on a pocket, patch, applique or tag: the design goes onto that panel
      const hostId = ((e.target as Element).closest?.('[data-kind="attach"]') as HTMLElement | null)?.dataset.att;
      const host = hostId ? all.find((q) => q.id === hostId) : undefined;
      if (host && canHostDesigns(host.kind) && ['print', 'embroidery', 'applique', 'hardware'].includes(String(t.kind))) {
        const pose = attWorld(all, host, en);
        const cr = Math.cos((-pose.rot * Math.PI) / 180), sr = Math.sin((-pose.rot * Math.PI) / 180);
        const dx = w.x - pose.x, dy = w.y - pose.y;
        stNow.addAttachment({ ...t, rotation: 0, layers: t.layers ?? [], pieceId: host.id, x: round2(cr * dx - sr * dy), y: round2(sr * dx + cr * dy), instance: undefined } as Omit<Attachment, 'id'>);
        stNow.set({ selPiece: en.src.id, selInstance: en.both ? en.inst : null, selPoint: null });
        stNow.openDesign('edit');
        return;
      }
      const l = toSource(en, w);
      const inst = instanceFor(en);
      stNow.addAttachment({ ...t, rotation: t.rotation ?? 0, layers: t.layers ?? [], pieceId: en.src.id, x: round2(l.x), y: round2(l.y), ...(inst !== undefined ? { instance: inst } : {}) } as Omit<Attachment, 'id'>);
      stNow.set({ selPiece: en.src.id, selInstance: en.both ? en.inst : null, selPoint: null });
      stNow.openDesign('edit');
    } catch { /* not ours */ }
  };

  const hint = picking
    ? pieceFlow?.hostEdge ? 'Edge picked. Click another edge to change it, then press Add piece.' : 'Click the edge of the garment that your new piece is sewn to. Escape cancels.'
    : `${HUD[tool] ?? HUD.select}${showMeasure && k < 2.4 ? ' Zoom in to see measurements.' : ''}`;

  return (
    <div className="editor">
      <div className={`editor-canvas ${dropKey ? 'dropping' : ''} ${picking ? 'picking' : ''}`} onDragOver={onDragOver} onDragLeave={() => setDropKey(null)} onDrop={onDrop}>
        <svg
          ref={svgRef}
          className={`editor-svg tool-${tool}`}
          aria-label="Pattern chart"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
        >
          {grid}
          <g transform={`translate(${view.x},${view.y}) scale(${k})`}>
            <rect x={-2000} y={-2000} width={4000} height={4000} fill="url(#g10)" />
            {entries.map((en) => {
              const p = en.piece;
              const active = en.src.id === selPiece && (!en.both || (selInstance ?? 0) === en.inst);
              return (
                <PieceView
                  key={en.key}
                  entry={en}
                  k={k}
                  selected={active}
                  selPoint={active ? selPoint : null}
                  symmetry={symmetry}
                  showMeasure={showMeasure}
                  showStitch={showStitch}
                  units={units}
                  tool={tool}
                  attachments={(edits?.attachments ?? []).filter((a) => a.pieceId === p.id && onCopy(a.instance, en))}
                  selAttachment={selAttachment}
                  pleats={(edits?.pleats ?? []).filter((q) => q.pieceId === p.id && onCopy((q as { instance?: number }).instance, en))}
                  selPleat={selPleat}
                  ghosts={pieces.filter((q) => q.role === 'custom' && q.placement?.mode === 'patch' && q.placement.hostPieceId === p.id && onCopy((q.placement as { instance?: number }).instance, en))}
                  runs={(runsByPiece.get(p.id) ?? []).filter((r) => runOn(r, en))}
                  starts={(draftStarts.get(p.id) ?? []).filter((st) => st.inst === undefined || en.copies !== 2 || st.inst === en.inst)}
                  dropTarget={dropKey === en.key}
                  pickSeg={pickHover?.key === en.key ? pickHover.seg : null}
                  picking={picking}
                />
              );
            })}
            {tool === 'pen' && <PenPreview draft={penDraft} hover={penHover} k={k} snap={penSnap} />}
          </g>
        </svg>
      </div>
      <footer className="pane-foot" role="status">
        <span className="foot-zoom">
          <button className="icon-btn sm" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" size={14} /></button>
          <span className="foot-pct" aria-label="Zoom level">{Math.round(k * 10)}%</span>
          <button className="icon-btn sm" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.25)}><Icon name="plus" size={14} /></button>
        </span>
        <span className="hud-sep" />
        <span className="foot-hint">{note ?? hint}</span>
      </footer>
    </div>
  );
}

const HUD: Record<string, string> = {
  select: 'Drag points to reshape. Double tap an edge to add a point. Drag a pocket or design to move it. Drop designs from the library here.',
  add: 'Tap an edge to add a point.',
  pan: 'Drag to pan the chart.',
  seams: 'Click a start point, then an end point, to pick a range to sew. Escape to stop.',
  pleat: 'Click an edge of a piece to place a pleat. Escape to stop.',
  pen: 'Click to add corners. Drag for a curve. Click the first point to close. Backspace removes the last point. Escape cancels.',
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
  entry: Entry;
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
  dropTarget: boolean;
  pickSeg: number | null;
  picking: boolean;
}) {
  const { entry, k, selected, selPoint, symmetry, showMeasure, showStitch, units, tool, attachments, selAttachment, pleats, selPleat, ghosts, runs, starts, dropTarget, pickSeg, picking } = props;
  const p = entry.piece;
  const inst = entry.inst;
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
      specs: pieceSpecs(p, pleats.length ? { attachments: [], customSeams: [], detachedSeams: [], pleats } : undefined),
    };
  }, [p.points, p.specs, pleats]);

  const sel = p.points.find((q) => q.id === selPoint);
  const fontPx = 11;
  // a label wider than its piece breaks after the comma: "Front," over "right leg"
  const labelLines = entry.label.length * 6.8 > geo.bb.w * k * 0.92 && entry.label.includes(', ') ? entry.label.split(', ', 2) : [entry.label];

  const allAtts = useStore((st) => st.project.edits?.attachments);
  const viewFace = useStore((st) => st.viewFace);
  const everyAtt = allAtts ?? [];
  const insideOwn = useStore((st) => !!st.project.edits?.insideFabric?.[p.id]);

  /** one attachment (and the designs sewn onto it) in its own frame */
  const renderAtt = (a: Attachment, top: boolean): React.ReactNode => {
    const o = outlineD(a);
    const label = a.kind === 'label';
    const fabric = a.fabric ?? p.fabric;
    const hex = label ? a.label?.color ?? '#f2f2f2' : (fabricById(fabric.id).colors[fabric.color] ?? fabricById(fabric.id).colors[0]).hex;
    const on = a.id === selAttachment;
    const fr = top ? frameOn(entry, a) : { x: a.x, y: a.y, rotation: a.rotation }; // on the left copy the position and turn mirror, the artwork does not flip
    const hw = a.kind === 'hardware';
    const letters = a.outline === 'shape' && a.shape === 'text';
    const hitW = Math.max(a.w, px(16)), hitH = Math.max(a.h, px(16));
    const face = a.face ?? 'outside';
    const inside = face === 'inside';
    const dim = face !== viewFace;
    const stroke = on ? 'var(--accent)' : 'var(--outline)';
    const dash = inside ? `${px(1.5)} ${px(3.5)}` : `${px(6)} ${px(4)}`;
    const kids = everyAtt.filter((c) => c.pieceId === a.id);
    const showLine = (isCloth(a.kind) || on || a.kind !== 'hardware') && !(hw && !on);
    const handleY = -a.h / 2 - px(30);
    // handles sit just outside the box; on a small design their touch circles shrink so the middle stays free to drag
    const gap = px(12);
    const rx = a.w / 2 + gap, ry = a.h / 2 + gap;
    const hitR = (dx: number, dy: number) => Math.min(px(22), Math.max(px(12), Math.hypot(dx, dy) - px(10)));
    return (
      <g key={a.id} transform={`translate(${fr.x},${fr.y}) rotate(${fr.rotation})`} data-kind="attach" data-att={a.id} data-piece={p.id} data-inst={inst} style={{ cursor: 'move' }}>
        <g opacity={dim ? 0.5 : 1}>
          {hw || letters ? <rect x={-hitW / 2} y={-hitH / 2} width={hitW} height={hitH} fill="transparent" /> : <path d={o.d} transform={o.transform} fill="transparent" />}
          {!hw && !letters && (a.w < px(18) || a.h < px(18)) && <rect x={-hitW / 2} y={-hitH / 2} width={hitW} height={hitH} fill="transparent" />}
          <ArtworkGroup a={a} fill={hex} />
          {showLine && (
            hw || letters
              ? <rect x={-a.w / 2} y={-a.h / 2} width={a.w} height={a.h} fill="none" stroke={stroke} strokeWidth={px(on ? 2.2 : 1.2)} strokeDasharray={dash} strokeLinecap="round" pointerEvents="none" opacity={on ? 1 : 0.55} />
              : <path d={o.d} transform={o.transform} fill="none" stroke={stroke} strokeWidth={px(on ? 2.2 : 1.4)} strokeDasharray={dash} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" opacity={isCloth(a.kind) || on ? 1 : 0.55} />
          )}
        </g>
        {kids.map((c) => renderAtt(c, false))}
        {inside && (
          <g transform={`translate(${-a.w / 2},${-a.h / 2 - px(10)})`} pointerEvents="none">
            <rect width={px(46)} height={px(16)} rx={px(8)} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={px(1)} />
            <text x={px(23)} y={px(8)} fontSize={px(11)} textAnchor="middle" dominantBaseline="central" fill="var(--accent)" fontWeight={600}>Inside</text>
          </g>
        )}
        {on && <circle r={px(3)} fill="var(--accent)" pointerEvents="none" />}
        {(on || k > 6) && <text y={a.h / 2 + px(14)} fontSize={px(11)} textAnchor="middle" className="edge-len" pointerEvents="none">{a.name}</text>}
        {on && (
          <g>
            <line x1={0} y1={-a.h / 2} x2={0} y2={handleY} stroke="var(--accent)" strokeWidth={px(1.5)} pointerEvents="none" />
            <circle cx={0} cy={handleY} r={px(7)} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={px(2)} pointerEvents="none" />
            <circle cx={0} cy={handleY} r={hitR(0, handleY)} fill="transparent" data-kind="handle" data-handle="rotate" data-att={a.id} data-piece={p.id} data-inst={inst} style={{ cursor: 'grab' }}><title>Turn</title></circle>
            <rect x={rx - px(6)} y={ry - px(6)} width={px(12)} height={px(12)} rx={px(2)} fill="var(--accent)" stroke="var(--bg-elevated)" strokeWidth={px(1.5)} pointerEvents="none" />
            <circle cx={rx} cy={ry} r={hitR(rx, ry)} fill="transparent" data-kind="handle" data-handle="resize" data-att={a.id} data-piece={p.id} data-inst={inst} style={{ cursor: 'nwse-resize' }}><title>Resize</title></circle>
          </g>
        )}
      </g>
    );
  };

  return (
    <g transform={`translate(${p.offset.x},${p.offset.y})`}>
      {/* body */}
      <path d={geo.d} fill={viewFace === 'inside' && insideOwn ? `url(#fab-in-${p.id})` : `url(#fab-${p.id})`} data-kind="piece" data-piece={p.id} data-inst={inst} style={{ cursor: picking ? 'crosshair' : 'move' }} />
      <path d={geo.d} fill="var(--piece-sheen)" pointerEvents="none" />
      {viewFace === 'inside' && <path d={geo.d} fill="url(#inside-hatch)" opacity={0.7} pointerEvents="none" />}
      {showStitch && <path d={geo.cut} fill="none" stroke="var(--cut-line)" strokeWidth={px(1)} pointerEvents="none" />}
      {/* the editable outline is the sewing line (finished size); the outer line is the cut line with seam allowance */}
      <path d={geo.d} fill="none" stroke={selected ? 'var(--accent)' : 'var(--outline)'} strokeWidth={px(selected ? 2 : 1.4)} strokeDasharray={showStitch ? `${px(6)} ${px(3)}` : undefined} pointerEvents="none" />
      {/* wide invisible stroke for picking edges */}
      <path d={geo.d} fill="none" stroke="transparent" strokeWidth={px(16)} data-kind="edge" data-piece={p.id} data-inst={inst} />
      {dropTarget && <path d={geo.d} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(3)} pointerEvents="none" />}
      {picking && pickSeg !== null && geo.bz[pickSeg] && (
        <path d={runD(geo.bz, [pickSeg])} fill="none" stroke="var(--orange)" strokeWidth={px(7)} strokeLinecap="round" opacity={0.85} pointerEvents="none" />
      )}

      {/* grainline + label */}
      <line
        x1={geo.c.x} x2={geo.c.x} y1={geo.c.y - geo.bb.h * 0.22} y2={geo.c.y + geo.bb.h * 0.22}
        stroke="var(--dim-line)" strokeWidth={px(1)} markerStart="url(#arr)" markerEnd="url(#arr)" pointerEvents="none" opacity={0.7}
      />
      <text x={geo.c.x} y={geo.c.y - px(2) - (labelLines.length - 1) * px(6.5)} className="piece-label" fontSize={px(12)} textAnchor="middle" pointerEvents="none">
        {labelLines.map((l, i) => <tspan key={i} x={geo.c.x} dy={i ? px(13) : 0}>{l}</tspan>)}
      </text>
      <text x={geo.c.x} y={geo.c.y - px(2) + (labelLines.length - 1) * px(6.5) + px(13)} className="piece-sub" fontSize={px(11)} textAnchor="middle" pointerEvents="none">
        {entry.both ? `Cut 1 of ${p.cut >= 2 ? p.cut : 2}` : `Cut ${p.cut} · ${fabricById(p.fabric.id).name}`}
      </text>

      {/* symmetry axis */}
      {symmetry && p.symmetric && (
        <line x1={0} x2={0} y1={geo.bb.minY - 4} y2={geo.bb.maxY + 4} stroke="var(--purple)" strokeWidth={px(1.2)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
      )}

      {/* measurements */}
      {showMeasure && !entry.mirror && k >= 2.4 &&
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
                <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y} stroke="transparent" strokeWidth={px(18)} data-kind="pleat" data-pleat={pl.id} data-inst={inst} style={{ cursor: 'pointer' }} />
              </g>
            ))}
            {m.arrows.map((a, i) => <line key={i} x1={a.from.x} y1={a.from.y} x2={a.to.x} y2={a.to.y} stroke={col} strokeWidth={px(1.6)} markerEnd="url(#arr)" pointerEvents="none" />)}
            {m.notches.map((n, i) => <line key={i} x1={n.a.x} y1={n.a.y} x2={n.b.x} y2={n.b.y} stroke={col} strokeWidth={px(2)} pointerEvents="none" />)}
          </g>
        );
      })}

      {/* attachments sit on their host in the host's own coordinates; designs on a pocket or tag sit inside it */}
      {attachments.map((a) => renderAtt(a, true))}

      {/* drawn pieces that are patched on: dashed placement, draggable */}
      {ghosts.map((g) => {
        const pl = g.placement!;
        const on = g.id === selPieceId;
        const f = fabricById(g.fabric.id);
        const hex = (f.colors[g.fabric.color] ?? f.colors[0]).hex;
        const gf = frameOn(entry, { x: pl.x ?? 0, y: pl.y ?? 0, rotation: pl.rotation ?? 0 });
        return (
          <g key={g.id} transform={`translate(${gf.x},${gf.y}) rotate(${gf.rotation})`} data-kind="ghost" data-piece={g.id} data-inst={inst} style={{ cursor: 'move' }}>
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
              <circle cx={q.x} cy={q.y} r={px(tool === 'seams' ? 16 : 13)} fill="transparent" data-kind="point" data-piece={p.id} data-inst={inst} data-point={q.id} style={{ cursor: tool === 'seams' ? 'pointer' : 'grab' }} />
            </g>
          );
        })}
    </g>
  );
}
