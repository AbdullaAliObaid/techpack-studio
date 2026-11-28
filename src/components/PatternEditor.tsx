import BandStripes from './BandStripes';
import { inspectAttachment, inspectPiece } from './inspect';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useStore, usePick } from '../store';
import type { Piece } from '../data/presets';
import { fabricById } from '../data/fabrics';
import {
  bbox, bezAt, bezLength, bezTangent, centroid, nearestOnOutline, offsetInward, pathD, polyD, samplePoly, toBeziers, type Pt,
} from '../lib/geometry';
import { pieceSpecs } from '../lib/specs';
import MeasureField from './MeasureField';
import { commitBlockDraft, commitEdgeClick } from './blockDraw';
import { targetKey, type MeasureTarget } from '../data/measureEdit';
import { fmt } from '../lib/units';
import { pointInPoly } from '../lib/geometry';
import { edgePolyline, insetPolyline, showsOn } from '../data/edgeTrim';
import { KIND as FINISH_KIND, strokePts, strokesFor } from '../data/finish';
import { openings } from '../three/detailsFinish';
import { builtinSeams } from '../sim/seams';
import type { Attachment, EdgeRef, Pleat } from '../data/edits';
import { symmetryGroups } from '../data/symmetry';
import { ArtworkGroup, isCloth, outlineD } from './Artwork';
import { FabricDefs, InsideDecor, InsideLegend } from './ChartInside';
import { canHostDesigns, fabricHex, imageFileOf, linkedPoints, openPhoto, pleatMarks, rootPiece, runD, runIndices, runMid, scaleAttachment, scaleLimits } from './editHelpers';
import { pickSeamPoint } from './ConstructionPanel';
import { ATTACHMENT_MIME, isAttachment } from './designLibrary';
import { MeasureLayer, MeasureTray, ChartRulers, type MeasureHandle } from './MeasureTools';
import { attWorld, flipEntries, frameOn, instanceFor, layoutEntries, onCopy, toSource, toWorldPt, worldToAtt, type Entry } from './sides';
import { openPieceFlow } from './flow';
import { attsOnEntry, computeGeo, layoutChart, type Geo } from './chartLayout';
import { hitList, type Cand } from './chartHit';
import { createPortal } from 'react-dom';
import { allPointsOf, movesFromWorld, placeItems, pointsInRect, snapTargets, withLinked, itemId, type Placed } from './multi';
import { GuideLayer, MarqueeLayer, SelectionChip, overlay } from './MultiOverlay';
import NotesLayer, { NotesBar, useNoteTool } from './NotesLayer';
import { angleSnap, boxOf, snapMove, type Target } from './snap';
import type { MultiItem } from '../store';
import Icon from './Icon';

type View = { x: number; y: number; k: number };

type Drag =
  | { mode: 'point'; pieceId: string; pointId: string; key: string; start: Pt; committed: boolean; inMulti?: boolean; g?: GroupDrag; last?: { cx: number; cy: number; alt: boolean; shift: boolean } }
  | { mode: 'marquee'; start: Pt; how: 'replace' | 'add' | 'toggle'; base: MultiItem[]; moved: boolean; sig: string }
  | { mode: 'piece'; pieceId: string; start: Pt; startOffset: Pt; committed: boolean }
  | { mode: 'attach'; id: string; key: string; grab: Pt; start: Pt; committed: boolean }
  | { mode: 'resize'; id: string; key: string; c: Pt; rot: number; d0: number; att0: Attachment; committed: boolean }
  | { mode: 'rotate'; id: string; key: string; c: Pt; committed: boolean }
  | { mode: 'ghost'; pieceId: string; key: string; grab: Pt; start: Pt; committed: boolean }
  | { mode: 'pen'; startClient: Pt; smoothed: boolean }
  | { mode: 'block' }
  | { mode: 'finish'; en: Entry }
  | { mode: 'pan'; startClient: Pt; startView: View }
  | { mode: 'pinch'; startDist: number; startMid: Pt; startView: View };

/** state of a point or group drag, built once when the drag starts moving */
interface GroupDrag { items: Placed[]; w0: Pt[]; anchor: number; targets: Target[]; prev: Pt | null }
/** how close (screen px) a dragged point must come to line up; scales with zoom because it is divided by k */
const SNAP_PX = 6;
const LONG_PRESS_MS = 380;

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
  const measureRef = useRef<MeasureHandle | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const lastTap = useRef<{ t: number; key: string }>({ t: 0, key: '' });

  const { project, tool, symmetry, showMeasure, showStitch, selPiece, selPoint, selInstance, units, fitToken, selAttachment, selPleat, hoverSeam, seamDraft, penDraft, penSnap, showBothSides, pieceFlow, blockDraft, measureTool } = usePick('project', 'tool', 'symmetry', 'showMeasure', 'showStitch', 'selPiece', 'selPoint', 'selInstance', 'units', 'fitToken', 'selAttachment', 'selPleat', 'hoverSeam', 'seamDraft', 'penDraft', 'penSnap', 'showBothSides', 'pieceFlow', 'blockDraft', 'measureTool');
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
  const chartFace = useStore((st) => st.chartFace);
  const entries = useMemo(() => { const e = layoutEntries(project.garment, pieces, showBothSides); return chartFace === 'inside' ? flipEntries(e) : e; }, [project.garment, pieces, showBothSides, chartFace]);
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

  // ---- geometry, label layout and hit testing -----------------------------------
  const allPleats = edits?.pleats;
  const geos = useMemo(() => {
    const m = new Map<string, Geo>();
    for (const en of entries) m.set(en.key, computeGeo(en, (allPleats ?? []).filter((q) => q.pieceId === en.src.id && onCopy((q as { instance?: number }).instance, en))));
    return m;
  }, [entries, allPleats]);
  const geosRef = useRef(geos);
  geosRef.current = geos;
  const cycle = useRef({ x: -99, y: -99, t: 0, idx: 0, sig: '' });
  const pending = useRef<{ x: number; y: number; run: () => void } | null>(null);
  const spaceDown = useRef(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragRaf = useRef(0);
  const lastNudge = useRef(0);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<{ cand: Cand; wx: number; wy: number; more: number } | null>(null);
  const selKey = (() => {
    if (!selPiece) return null;
    const en = entries.find((e) => e.src.id === selPiece && (!e.both || (selInstance ?? 0) === e.inst)) ?? entries.find((e) => e.src.id === selPiece);
    return en?.key ?? null;
  })();
  const hoverKey = hover ? (hover.cand.hl.t === 'piece' ? hover.cand.hl.key : null) : null;
  const layout = useMemo(
    () => layoutChart({ entries, geos, atts: edits?.attachments ?? [], k: view.k, selKey, showMeasure, units, hoverKey, bounds: size ? { x0: -view.x / view.k, y0: -view.y / view.k, x1: (size.w - view.x) / view.k, y1: (size.h - view.y) / view.k } : null }),
    [entries, geos, edits?.attachments, view.k, view.x, view.y, size, selKey, showMeasure, units, hoverKey],
  );
  const [layerEls, setLayerEls] = useState<{ labels: SVGGElement | null; top: SVGGElement | null }>({ labels: null, top: null });
  const setLabelsEl = useCallback((el: SVGGElement | null) => { if (el) setLayerEls((c) => (c.labels === el ? c : { ...c, labels: el })); }, []);
  const setTopEl = useCallback((el: SVGGElement | null) => { if (el) setLayerEls((c) => (c.top === el ? c : { ...c, top: el })); }, []);
  const pickList = (w: Pt): Cand[] => {
    const st = useStore.getState();
    return hitList({
      w, k: viewRef.current.k, entries: entriesRef.current, geos: geosRef.current, atts: st.project.edits?.attachments ?? [], pieces: st.project.pieces,
      pleats: st.project.edits?.pleats ?? [], selAttachment: st.selAttachment, selKey, tool: st.tool,
    });
  };
  const hoverRaf = useRef(0);

  // ---- multi selection: what is drawn --------------------------------------
  const selMulti = useStore((st) => st.selMulti);
  const multiByPiece = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const i of selMulti) { if (!m.has(i.pieceId)) m.set(i.pieceId, new Set()); m.get(i.pieceId)!.add(i.pointId); }
    return m;
  }, [selMulti]);
  const multiBox = useMemo(() => {
    if (selMulti.length < 2) return null;
    const placed = placeItems(selMulti, entries);
    const b = boxOf(placed.map((q) => q.world));
    return b && placed.length > 1 ? { box: b, count: placed.length } : null;
  }, [selMulti, entries]);

  // ---- seam runs to draw, grouped by piece ------------------------------
  const seamList = useMemo(() => builtinSeams(project.garment, pieces, project.edits), [project.garment, pieces, project.edits]);
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

  // turning the chart over mirrors the screen, so what the user was looking at stays where it was
  const lastFace = useRef(chartFace);
  useEffect(() => {
    if (lastFace.current === chartFace) return;
    lastFace.current = chartFace;
    const w = svgRef.current?.clientWidth ?? 0;
    setView((v) => ({ ...v, x: w - v.x }));
  }, [chartFace]);

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

  const noteTool = useNoteTool(toWorld, (w) => entryAt(w), entries);
  const notesOn = tool === 'note';

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

  // Space held = pan with the pointer (the select tool drags a marquee on empty space)
  useEffect(() => {
    const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(el.tagName) || el.isContentEditable); };
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e.target)) { spaceDown.current = true; e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    const blur = () => { spaceDown.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    // arrow keys nudge the selected points (App.tsx forwards them): 1 mm, Shift 1 cm, one undo step per burst
    const onNudge = (e: Event) => {
      const { dx, dy } = (e as CustomEvent<{ dx: number; dy: number }>).detail;
      const st = useStore.getState();
      const items: { pieceId: string; pointId: string; key?: string }[] = st.selMulti.length ? st.selMulti : st.selPiece && st.selPoint ? [{ pieceId: st.selPiece, pointId: st.selPoint, key: findEntry(st.selPiece, st.selInstance ?? 0)?.key }] : [];
      const placed = placeItems(items, entriesRef.current);
      if (!placed.length) return;
      const now = performance.now();
      if (now - lastNudge.current > 700) st.commit();
      lastNudge.current = now;
      writeMoves(placed, placed.map((q) => ({ x: q.world.x + dx, y: q.world.y + dy })));
    };
    window.addEventListener('tps-nudge', onNudge);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); window.removeEventListener('tps-nudge', onNudge); };
  }, []);

  /** one store update for the whole group; a single point goes through movePoint so its own rules apply */
  const writeMoves = (placed: Placed[], world: Pt[]) => {
    const st = useStore.getState();
    const moves = movesFromWorld(placed, world);
    if (moves.length === 1) { st.movePoint(moves[0].pieceId, moves[0].pointId, moves[0].x, moves[0].y); return; }
    st.moveGroup(withLinked(st.project.pieces, moves, st.totalSymmetry, st.project.garment));
  };

  // one drag frame: where would the group be, magnetism, angle snap, then a single store write
  const stepGroup = (d: Extract<Drag, { mode: 'point' }>) => {
    const last = d.last;
    if (!last || !svgRef.current) return;
    d.last = undefined;
    const st = useStore.getState();
    const w = toWorld(last.cx, last.cy);
    if (!d.g) {
      const en = entriesRef.current.find((x) => x.key === d.key);
      if (!en) return;
      const asked = d.inMulti ? st.selMulti : [{ pieceId: d.pieceId, pointId: d.pointId, key: d.key }];
      let items = placeItems(asked, entriesRef.current);
      // the point under the pointer is moved on the copy it was grabbed on
      const own = items.findIndex((q) => q.item.pieceId === d.pieceId && q.item.pointId === d.pointId);
      const grabbed = en.src.points.find((q) => q.id === d.pointId);
      if (own >= 0 && grabbed) items[own] = { item: { pieceId: d.pieceId, pointId: d.pointId, key: en.key }, entry: en, world: toWorldPt(en, grabbed), stored: { x: grabbed.x, y: grabbed.y } };
      if (own < 0 && grabbed) items = [{ item: { pieceId: d.pieceId, pointId: d.pointId, key: en.key }, entry: en, world: toWorldPt(en, grabbed), stored: { x: grabbed.x, y: grabbed.y } }];
      const anchor = Math.max(0, items.findIndex((q) => q.item.pieceId === d.pieceId && q.item.pointId === d.pointId));
      // what moves with the drag is not a target: the selection, its mirror partners, linked points under total symmetry
      const moving = new Set(items.map((q) => itemId(q.item)));
      for (const q of items) {
        const pc = q.entry.src, pt = pc.points.find((x) => x.id === q.item.pointId);
        if (st.symmetry && pt?.mirror) moving.add(pc.id + '|' + pt.mirror);
        if (st.totalSymmetry) for (const l of linkedPoints(st.project.pieces, pc.id, q.item.pointId)) moving.add(itemId(l));
      }
      const targets = snapTargets(entriesRef.current, geosRef.current, moving);
      // keep the selection in a straight line: its own starting positions are lines to snap back to
      for (const q of items) targets.push({ x: q.world.x, y: q.world.y, label: items.length > 1 ? 'Start line' : 'Start line' });
      const pts = en.piece.points, idx = pts.findIndex((x) => x.id === d.pointId);
      const pv = idx >= 0 ? pts[(idx - 1 + pts.length) % pts.length] : null;
      const prev = pv && !moving.has(en.src.id + '|' + (en.src.points.find((x) => x.id === pv.id)?.id ?? '')) ? { x: en.offset.x + pv.x, y: en.offset.y + pv.y } : null;
      d.g = { items, w0: items.map((q) => q.world), anchor, targets, prev };
    }
    const g = d.g;
    const delta = { x: w.x - d.start.x, y: w.y - d.start.y };
    let guides: import('./snap').Guide[] = [];
    let tip: { x: number; y: number; text: string } | null = null;
    const a0 = g.w0[g.anchor];
    if (last.shift && g.prev) {
      // Shift: the dragged point keeps 0, 45 or 90 degrees from the point before it
      const sp = angleSnap(g.prev, { x: a0.x + delta.x, y: a0.y + delta.y }, 45);
      delta.x = sp.x - a0.x; delta.y = sp.y - a0.y;
      const ang = Math.round((Math.atan2(sp.y - g.prev.y, sp.x - g.prev.x) * 180) / Math.PI);
      tip = { x: sp.x, y: sp.y, text: `${((ang % 180) + 180) % 180 === 0 ? 0 : Math.abs(ang) % 90 === 45 ? 45 : 90}°` };
    } else if (st.snapOn && !last.alt) {
      const r = snapMove(g.w0.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })), g.targets, SNAP_PX / viewRef.current.k);
      delta.x += r.dx; delta.y += r.dy;
      guides = r.guides;
    }
    overlay.set({ guides, tip });
    writeMoves(g.items, g.w0.map((p) => ({ x: p.x + delta.x, y: p.y + delta.y })));
  };

  /** finish the frame that is waiting (pointer up must not lose the last move) */
  const flushDrag = () => {
    cancelAnimationFrame(dragRaf.current);
    const d = drag.current;
    if (d && d.mode === 'point' && d.last) stepGroup(d);
  };

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
    if (pointers.current.size === 2) { noteTool.cancel(); return startPinch(); }
    if (pointers.current.size > 2) return;

    if (e.button !== 1 && !spaceDown.current && !e.altKey && measureRef.current?.down(e)) return;
    if (useStore.getState().tool === 'note' && e.button !== 1 && !spaceDown.current) { noteTool.down(e); return; }
    const st = useStore.getState();
    const w = toWorld(e.clientX, e.clientY);
    const chartPick = (st.tool === 'select' || st.tool === 'add') && !st.pieceFlow?.picking;
    const panNow = () => (drag.current = { mode: 'pan', startClient: { x: e.clientX, y: e.clientY }, startView: viewRef.current });
    pending.current = null;

    if (st.tool === 'pan' || e.button === 1 || spaceDown.current || (e.button === 0 && e.altKey && !chartPick)) return panNow();

    // marquee: Select tool, empty space. Mouse and pen drag at once; a finger pans, and a long press turns that into a marquee.
    const startMarquee = (how: 'replace' | 'add' | 'toggle') => {
      const base = how === 'replace' ? [] : st.selMulti.length ? st.selMulti : st.selPiece && st.selPoint ? [{ pieceId: st.selPiece, pointId: st.selPoint, key: findEntry(st.selPiece, st.selInstance ?? 0)?.key ?? '' }] : [];
      drag.current = { mode: 'marquee', start: w, how, base, moved: false, sig: '' };
      overlay.set({ marquee: { x0: w.x, y0: w.y, x1: w.x, y1: w.y } });
    };
    const howOf = (): 'replace' | 'add' | 'toggle' => (e.metaKey || e.ctrlKey ? 'toggle' : e.shiftKey ? 'add' : 'replace');

    // what is under the pointer: one resolver, not the first DOM element (see chartHit.ts)
    let target = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
    if (chartPick) {
      const list = pickList(w);
      const c = cycle.current;
      const now = performance.now();
      const slow = now - c.t > 450; // a quick second click is a double tap, not a cycle
      const same = Math.hypot(e.clientX - c.x, e.clientY - c.y) < 6 && now - c.t < 5000 && (slow || e.altKey) && c.sig === list.map((q) => q.id).join('|');
      let idx = 0;
      if (list.length > 1 && same) {
        if (e.altKey) idx = (c.idx + 1) % list.length; // option-click steps to the next item under the pointer
        else idx = c.idx; // a plain repeat keeps the item (so it can be dragged) and steps on release
      }
      cycle.current = { x: e.clientX, y: e.clientY, t: now, idx, sig: list.map((q) => q.id).join('|') };
      const cand = list[idx];
      target = cand ? ({ dataset: cand.ds } as unknown as HTMLElement) : null;
      if (list.length > 1 && same && !e.altKey) {
        const next = list[(idx + 1) % list.length];
        pending.current = { x: e.clientX, y: e.clientY, run: () => { cycle.current = { ...cycle.current, idx: (idx + 1) % list.length }; run({ dataset: next.ds } as unknown as HTMLElement); drag.current = null; } };
      }
    }
    run(target);

    function run(target: HTMLElement | null) {
    const kind = target?.dataset.kind;
    const pieceId = target?.dataset.piece;
    const ent = pieceId ? findEntry(pieceId, Number(target?.dataset.inst ?? 0)) : undefined;
    /** remember which copy the user is working on */
    const pick = (en?: Entry) => st.set({ selInstance: en?.both ? en.inst : null });

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

    // ---- finish brush: paint wash or distress on the piece under the pointer
    if (st.tool === 'brush') {
      const en = ent ?? entryAt(w);
      if (!en) return panNow();
      const l = toSource(en, w);
      st.paintFinish(en.src.id, en.copies > 1 ? en.inst : undefined, l.x, l.y, true);
      drag.current = { mode: 'finish', en };
      return;
    }

    // ---- colour block: drag a rectangle, or click the corners of a polygon, on a piece
    if (st.tool === 'block') {
      const en = ent ?? entryAt(w);
      const d = st.blockDraft;
      // thread, binding and piping go along the edge nearest the click
      if (st.colourBlock.method !== 'paint') { if (!en) return panNow(); commitEdgeClick(en, w, viewRef.current.k); drag.current = null; return; }
      if (st.colourBlock.mode === 'rect') {
        if (!en) return panNow();
        st.set({ blockDraft: { key: en.key, pts: [w, w], rect: true } });
        drag.current = { mode: 'block' };
        return;
      }
      if (d && d.pts.length >= 3 && Math.hypot(w.x - d.pts[0].x, w.y - d.pts[0].y) * viewRef.current.k < 14) { commitBlockDraft(); drag.current = null; return; }
      if (!d) { if (!en) return panNow(); st.set({ blockDraft: { key: en.key, pts: [w], rect: false } }); }
      else st.set({ blockDraft: { ...d, pts: [...d.pts, w] } });
      drag.current = null;
      return;
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
        // selecting never moves the chart: the editor only switches when the panel is already open
        if (st.designOpen) st.set({ designTab: 'edit', designCollapsed: false });
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
      // Shift adds a point to the selection, Cmd/Ctrl toggles it; neither starts a drag
      if ((e.shiftKey || e.metaKey || e.ctrlKey) && st.tool === 'select') {
        const cur: MultiItem[] = st.selMulti.length ? st.selMulti : st.selPiece && st.selPoint ? [{ pieceId: st.selPiece, pointId: st.selPoint, key: findEntry(st.selPiece, st.selInstance ?? 0)?.key ?? ent.key }] : [];
        const has = cur.some((i) => i.pieceId === pieceId && i.pointId === pointId);
        const next = e.metaKey || e.ctrlKey ? (has ? cur.filter((i) => !(i.pieceId === pieceId && i.pointId === pointId)) : [...cur, { pieceId, pointId, key: ent.key }]) : has ? cur : [...cur, { pieceId, pointId, key: ent.key }];
        if (next.length > 1) st.setMulti(next);
        else if (next.length === 1) st.select(next[0].pieceId, next[0].pointId);
        else st.select(pieceId, null);
        pick(ent);
        drag.current = null;
        return;
      }
      const inMulti = st.selMulti.length > 1 && st.selMulti.some((i) => i.pieceId === pieceId && i.pointId === pointId);
      if (!inMulti) st.select(pieceId, pointId);
      pick(ent);
      if (st.totalSymmetry && !inMulti) st.set({ linkedHot: linkedPoints(st.project.pieces, pieceId, pointId, st.project.garment) });
      drag.current = { mode: 'point', pieceId, pointId, key: ent.key, start: w, committed: false, inMulti };
      return;
    }

    if (kind === 'piece' && st.tool === 'select' && (e.shiftKey || e.metaKey || e.ctrlKey)) return startMarquee(howOf());

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

    if (st.tool === 'select') {
      if (e.pointerType === 'touch') {
        // finger: pan, as every touch surface does. Press and hold, then drag, to rubber band instead.
        panNow();
        const sx = e.clientX, sy = e.clientY, id = e.pointerId;
        clearTimeout(holdTimer.current);
        holdTimer.current = setTimeout(() => {
          const p = pointers.current.get(id);
          if (drag.current?.mode !== 'pan' || pointers.current.size !== 1 || !p || Math.hypot(p.x - sx, p.y - sy) > 8) return;
          startMarquee(howOf());
          (navigator as Navigator & { vibrate?: (n: number) => boolean }).vibrate?.(8);
        }, LONG_PRESS_MS);
        if (!e.shiftKey && !e.metaKey && !e.ctrlKey) { st.select(null, null); st.set({ selAttachment: null, selPleat: null }); }
        return;
      }
      startMarquee(howOf());
      return;
    }
    st.select(null, null);
    st.set({ selAttachment: null, selPleat: null });
    panNow();
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current && !spaceDown.current && measureRef.current?.move(e)) return;
    const stNow = useStore.getState();
    if (stNow.tool === 'note' && pointers.current.has(e.pointerId) && !drag.current) { pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); noteTool.move(e); return; }
    if (!drag.current && !pointers.current.size && (stNow.tool === 'select' || stNow.tool === 'add') && !stNow.pieceFlow?.picking && e.pointerType !== 'touch') {
      const cx = e.clientX, cy = e.clientY;
      cancelAnimationFrame(hoverRaf.current);
      hoverRaf.current = requestAnimationFrame(() => {
        if (!svgRef.current) return;
        const w0 = toWorld(cx, cy);
        const list = pickList(w0);
        const c = cycle.current;
        const sig = list.map((q) => q.id).join('|');
        const again = list.length > 1 && c.sig === sig && Math.hypot(cx - c.x, cy - c.y) < 6;
        const cand = list[again ? (c.idx + 1) % list.length : 0];
        setHover((h) => (!cand ? (h ? null : h) : h && h.cand.id === cand.id && h.more === list.length - 1 && Math.hypot(h.wx - w0.x, h.wy - w0.y) * viewRef.current.k < 4 ? h : { cand, wx: w0.x, wy: w0.y, more: list.length - 1 }));
      });
    }
    if (stNow.tool === 'pen') setPenHover(snap(toWorld(e.clientX, e.clientY)));
    if (stNow.tool === 'block' && stNow.blockDraft && !stNow.blockDraft.rect) setPenHover(toWorld(e.clientX, e.clientY));
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
    if (hover) setHover(null);
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
    if (d.mode === 'finish') {
      const l = toSource(d.en, toWorld(e.clientX, e.clientY));
      st.paintFinish(d.en.src.id, d.en.copies > 1 ? d.en.inst : undefined, l.x, l.y, false);
      return;
    }
    if (d.mode === 'block') {
      const bd = st.blockDraft;
      if (bd) st.set({ blockDraft: { ...bd, pts: [bd.pts[0], toWorld(e.clientX, e.clientY)] } });
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
    if (d.mode === 'marquee') {
      const mw = toWorld(e.clientX, e.clientY);
      if (!d.moved && Math.hypot(mw.x - d.start.x, mw.y - d.start.y) * viewRef.current.k < 3) return;
      d.moved = true;
      const r = { x0: Math.min(d.start.x, mw.x), y0: Math.min(d.start.y, mw.y), x1: Math.max(d.start.x, mw.x), y1: Math.max(d.start.y, mw.y) };
      overlay.set({ marquee: { x0: d.start.x, y0: d.start.y, x1: mw.x, y1: mw.y } });
      const hits = pointsInRect(entriesRef.current, r);
      const id = (i: MultiItem) => i.pieceId + '|' + i.pointId;
      const hitIds = new Set(hits.map(id));
      const next = d.how === 'replace' ? hits
        : d.how === 'add' ? [...d.base, ...hits.filter((i) => !d.base.some((b) => id(b) === id(i)))]
        : [...d.base.filter((b) => !hitIds.has(id(b))), ...hits.filter((i) => !d.base.some((b) => id(b) === id(i)))];
      const sig = next.map(id).join(',');
      if (sig === d.sig) return;
      d.sig = sig;
      if (next.length > 1) st.setMulti(next);
      else if (next.length === 1) st.select(next[0].pieceId, next[0].pointId);
      else st.select(d.how === 'replace' ? null : st.selPiece, null);
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
      // one store write per animation frame for the whole group (see stepGroup)
      const waiting = !!d.last;
      d.last = { cx: e.clientX, cy: e.clientY, alt: e.altKey, shift: e.shiftKey };
      if (!waiting) dragRaf.current = requestAnimationFrame(() => { const dd = drag.current; if (dd && dd.mode === 'point') stepGroup(dd); });
    } else if (d.mode === 'piece') {
      st.movePiece(d.pieceId, { x: d.startOffset.x + w.x - d.start.x, y: d.startOffset.y + w.y - d.start.y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current && measureRef.current?.active() && pointers.current.size <= 1) { if (e.type === 'pointerup') measureRef.current.up(e); pointers.current.delete(e.pointerId); return; }
    if (useStore.getState().tool === 'note' && !drag.current) { if (e.type === 'pointerup') noteTool.up(); else noteTool.cancel(); pointers.current.delete(e.pointerId); return; }
    const pc = pending.current;
    pending.current = null;
    if (pc && Math.hypot(e.clientX - pc.x, e.clientY - pc.y) < 4 && !(drag.current && 'committed' in drag.current && drag.current.committed)) pc.run();
    if (pointers.current.size <= 1) {
      flushDrag();
      const dd = drag.current;
      const stU = useStore.getState();
      if (dd?.mode === 'block' && e.type === 'pointerup') commitBlockDraft();
      if (dd?.mode === 'marquee' && !dd.moved && dd.how === 'replace' && e.type === 'pointerup') { stU.select(null, null); stU.set({ selAttachment: null, selPleat: null }); }
      // a click on a point that was part of the selection narrows the selection to it
      if (dd?.mode === 'point' && dd.inMulti && !dd.committed && e.type === 'pointerup') stU.select(dd.pieceId, dd.pointId);
      overlay.clear();
    }
    clearTimeout(holdTimer.current);
    pointers.current.delete(e.pointerId);
    if (useStore.getState().linkedHot.length) useStore.setState({ linkedHot: [] });
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
      <FabricDefs pieces={pieces} inside={edits?.insideFabric} />
      <marker id="arr" viewBox="0 0 10 10" refX="5" refY="5" markerWidth={px(7)} markerHeight={px(7)} orient="auto-start-reverse" markerUnits="userSpaceOnUse">
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
    if (!e.dataTransfer.types.includes(ATTACHMENT_MIME) && !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const en = entryAt(toWorld(e.clientX, e.clientY));
    setDropKey((cur) => (cur === (en?.key ?? null) ? cur : en?.key ?? null));
  };
  const onDrop = (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(ATTACHMENT_MIME);
    setDropKey(null);
    // a picture file: open the photo sheet aimed at the piece (and spot) it was dropped on
    const file = imageFileOf(e.dataTransfer.files);
    if (file && !raw) {
      e.preventDefault();
      const w = toWorld(e.clientX, e.clientY);
      const en = entryAt(w);
      if (!en) { setNote('Drop the picture on a piece of the pattern.'); setTimeout(() => setNote(null), 2500); return; }
      const l = toSource(en, w);
      const inst = instanceFor(en);
      useStore.getState().set({ selPiece: en.src.id, selInstance: en.both ? en.inst : null, selPoint: null });
      openPhoto(file, { pieceId: en.src.id, x: round2(l.x), y: round2(l.y), ...(inst !== undefined ? { instance: inst } : {}) });
      return;
    }
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
    : `${HUD[tool] ?? HUD.select}`;

  return (
    <div className="editor">
      <div className={`editor-canvas ${dropKey ? 'dropping' : ''} ${picking ? 'picking' : ''}`} onDragOver={onDragOver} onDragLeave={() => setDropKey(null)} onDrop={onDrop}>
        <svg
          ref={svgRef}
          className={`editor-svg tool-${tool}${showMeasure && measureTool ? ' measuring' : ''}`}
          aria-label="Pattern chart"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => setHover(null)}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={(e) => {
            // double click a trim or design to edit it, a piece to edit its fabric
            if (useStore.getState().tool !== 'select') return;
            const t = (e.target as Element).closest('[data-kind]') as HTMLElement | null;
            if (t?.dataset.kind === 'attach' && t.dataset.att) inspectAttachment(t.dataset.att);
            else if (t?.dataset.kind === 'piece' && t.dataset.piece) inspectPiece(t.dataset.piece, t.dataset.inst === undefined ? null : Number(t.dataset.inst));
          }}
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
                  multiIds={multiByPiece.get(p.id) ?? null}
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
                  geo={geos.get(en.key)!}
                  layout={layout}
                  labelsEl={layerEls.labels}
                  topEl={layerEls.top}
                />
              );
            })}
            <SymTint entries={entries} geos={geos} />
            <g ref={setLabelsEl} />
            <g ref={setTopEl} />
            {multiBox && <SelectionChip box={multiBox.box} count={multiBox.count} k={k} />}
            <NotesLayer k={k} entries={entries} tool={{ ...noteTool, active: notesOn }} />
            <ProbeMarker k={k} entries={entries} />
            <GuideLayer k={k} />
            <MeasureLayer k={k} entries={entries} units={units} toWorld={toWorld} handle={measureRef} notify={(m) => { setNote(m); setTimeout(() => setNote(null), 2500); }} />
            <MarqueeLayer k={k} />
            {hover && tool !== 'pen' && <HoverOverlay hover={hover} entries={entries} geos={geos} k={k} />}
            {tool === 'block' && blockDraft && <BlockPreview draft={blockDraft} hover={penHover} k={k} />}
            {tool === 'pen' && <PenPreview draft={penDraft} hover={penHover} k={k} snap={penSnap} />}
          </g>
        </svg>
        {chartFace === 'inside' && <InsideLegend />}
        <ChartRulers view={view} size={size} units={units} />
        <NotesBar />
        <MeasureTray />
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
  select: 'Drag points to reshape, or drag on empty space to select several (touch: press and hold, then drag). Shift adds, Cmd toggles. Hold Option to turn off snapping, Shift to snap angles. Space and drag pans.',
  add: 'Tap an edge to add a point.',
  pan: 'Drag to pan the chart.',
  seams: 'Click a start point, then an end point, to pick a range to sew. Escape to stop.',
  pleat: 'Click an edge of a piece to place a pleat. Escape to stop.',
  note: 'Draw, add arrows or text notes on the chart. Notes print on the tech pack. Two fingers pan and zoom.',
  brush: 'Drag on a piece to paint the chosen wash or wear. It also paints on the 3D garment.',
  block: 'Drag a rectangle on a piece, or click the corners of a shape. It goes on both sides and on matching pieces when symmetry is on. Escape cancels.',
  pen: 'Click to add corners. Drag for a curve. Click the first point to close. Backspace removes the last point. Escape cancels.',
};

/** Tool rail preview: tints the pieces Symmetry or Total symmetry would link, one colour per group. Changes nothing. */
function SymTint({ entries, geos }: { entries: Entry[]; geos: Map<string, Geo> }) {
  const mode = useStore((st) => st.symPreview);
  const style = useStore((st) => st.project.garment);
  const pieces = useStore((st) => st.project.pieces);
  const groups = useMemo(() => (mode ? symmetryGroups(style, pieces, mode) : []), [mode, style, pieces]);
  if (!mode || !groups.length) return null;
  return (
    <g pointerEvents="none" aria-hidden="true" data-sym-tint={mode}>
      {entries.map((en) => {
        const g = groups.find((q) => q.pieceIds.includes(en.src.id));
        const geo = geos.get(en.key);
        if (!g || !geo) return null;
        return <path key={en.key} className="sym-tint" data-c={mode === 'total' ? 'total' : g.index % 6} transform={`translate(${en.piece.offset.x},${en.piece.offset.y})`} d={geo.d} vectorEffect="non-scaling-stroke" />;
      })}
    </g>
  );
}

function BlockPreview({ draft, hover, k }: { draft: { pts: Pt[]; rect: boolean }; hover: Pt | null; k: number }) {
  const px = (n: number) => n / k;
  const pts = draft.rect ? (() => { const [a, b] = draft.pts; return [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }]; })() : hover ? [...draft.pts, hover] : draft.pts;
  return (
    <g pointerEvents="none">
      <path d={`M${pts.map((q) => `${q.x},${q.y}`).join('L')}Z`} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(1.6)} strokeDasharray={`${px(6)} ${px(4)}`} strokeLinejoin="round" />
      {!draft.rect && draft.pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={px(i === 0 ? 7 : 4.5)} fill={i === 0 ? 'var(--accent)' : 'var(--point-fill)'} stroke="var(--accent)" strokeWidth={px(2)} />)}
    </g>
  );
}

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
  /** points picked as a group (marquee, shift-click) on this piece */
  multiIds: ReadonlySet<string> | null;
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
  geo: Geo;
  layout: import('./chartLayout').Layout;
  labelsEl: SVGGElement | null;
  topEl: SVGGElement | null;
}) {
  const { geo, layout, labelsEl, topEl, entry, k, selected, selPoint, multiIds, symmetry, showMeasure, showStitch, units, tool, attachments, selAttachment, pleats, selPleat, ghosts, runs, starts, dropTarget, pickSeg, picking } = props;
  const p = entry.piece;
  const inst = entry.inst;
  const px = (n: number) => n / k;
  const selPieceId = useStore((st) => st.selPiece);
  const flash = useStore((st) => st.measureFlash);
  const [editing, setEditing] = useState<string | null>(null);

  const sel = p.points.find((q) => q.id === selPoint);

  const allAtts = useStore((st) => st.project.edits?.attachments);
  const viewFace = useStore((st) => st.chartFace);
  const edgeTrims = useStore((st) => st.project.edits?.edgeTrims);
  const finishEdit = useStore((st) => st.project.edits?.finish);
  const garment = useStore((st) => st.project.garment);
  const linkedHot = useStore((st) => st.linkedHot);
  const everyAtt = allAtts ?? [];
  const insideOwn = useStore((st) => !!st.project.edits?.insideFabric?.[p.id]);

  /** one attachment (and the designs sewn onto it) in its own frame */
  const renderAtt = (a: Attachment, top: boolean): React.ReactNode => {
    const o = outlineD(a);
    const label = a.kind === 'label';
    const fabric = a.fabric ?? p.fabric;
    const hex = label ? a.label?.color ?? '#f2f2f2' : fabricHex(fabric);
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
        <g opacity={(dim ? 0.5 : 1) * (a.kind === 'print' && a.blend !== false ? 1 - 0.14 * (a.blendStrength ?? 0.7) : 1)}>
          {hw || letters ? <rect x={-hitW / 2} y={-hitH / 2} width={hitW} height={hitH} fill="transparent" /> : <path d={o.d} transform={o.transform} fill="transparent" />}
          {!hw && !letters && (a.w < px(18) || a.h < px(18)) && <rect x={-hitW / 2} y={-hitH / 2} width={hitW} height={hitH} fill="transparent" />}
          {hw && a.hardware?.type !== 'zipper' && Math.max(a.w, a.h) * k < 16 && (
            <>
              <circle r={px(10)} fill="var(--canvas)" fillOpacity={0.85} stroke="var(--outline)" strokeWidth={px(1.2)} pointerEvents="none" />
            </>
          )}
          <g transform={hw && a.hardware?.type !== 'zipper' && Math.max(a.w, a.h) * k < 12 ? `scale(${px(12) / Math.max(a.w, a.h, 1e-3)})` : undefined}><ArtworkGroup a={a} fill={hex} /></g>
          {showLine && (
            hw || letters
              ? <rect x={-a.w / 2} y={-a.h / 2} width={a.w} height={a.h} fill="none" stroke={stroke} strokeWidth={px(on ? 2.2 : 1.2)} strokeDasharray={dash} strokeLinecap="round" pointerEvents="none" opacity={on ? 1 : 0.55} />
              : <path d={o.d} transform={o.transform} fill="none" stroke={stroke} strokeWidth={px(on ? 2.2 : 1.4)} strokeDasharray={dash} strokeLinecap="round" vectorEffect="non-scaling-stroke" pointerEvents="none" opacity={isCloth(a.kind) || on ? 1 : 0.55} />
          )}
        </g>
        {kids.map((c) => renderAtt(c, false))}
        {on && <circle r={px(3)} fill="var(--accent)" pointerEvents="none" />}
        {on && <text y={a.h / 2 + px(14)} fontSize={px(11)} textAnchor="middle" className="edge-len" strokeWidth={px(3)} pointerEvents="none">{a.name}</text>}
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

  const nm = layout.names.get(entry.key);
  const ms = layout.measures.get(entry.key) ?? [];
  const els = layout.edges.get(entry.key) ?? [];
  // piece names sit on the fabric, so their colour follows the fabric (not the theme): dark text with a fabric halo on
  // light cloth, light text on dark cloth
  const fabHex = fabricHex(p.fabric);
  const lum = (() => { const n = parseInt(fabHex.slice(1, 7), 16); const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; })();
  const onFabric = { fill: lum > 0.35 ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.95)', stroke: fabHex };
  const secondary = selected && k >= 4 ? (entry.both ? `Cut 1 of ${p.cut >= 2 ? p.cut : 2}` : `Cut ${p.cut} · ${fabricById(p.fabric.id).name}`) : null;
  const tr = `translate(${p.offset.x},${p.offset.y})`;

  return (
    <>
    <g transform={tr}>
      {/* body */}
      <path d={geo.d} fill={viewFace === 'inside' ? `url(#fab-in-${p.id})` : `url(#fab-${p.id})`} data-kind="piece" data-piece={p.id} data-inst={inst} style={{ cursor: picking ? 'crosshair' : 'move' }} />
      <path d={geo.d} fill="var(--piece-sheen)" pointerEvents="none" />
      <BandStripes piece={p} d={geo.d} id={`${p.id}-${inst}`} />
      {viewFace === 'inside' && <InsideDecor entry={entry} geo={geo} k={k} style={garment} ownInside={insideOwn} />}
      {showStitch && <path d={geo.cut} fill="none" stroke="var(--cut-line)" strokeWidth={px(1)} pointerEvents="none" />}
      {/* the editable outline is the sewing line (finished size); the outer line is the cut line with seam allowance */}
      <path d={geo.d} fill="none" stroke={selected ? 'var(--accent)' : 'var(--outline)'} strokeWidth={px(selected ? 2 : 1.4)} strokeDasharray={showStitch ? `${px(6)} ${px(3)}` : undefined} pointerEvents="none" />
      {/* wide invisible stroke for picking edges */}
      <path d={geo.d} fill="none" stroke="transparent" strokeWidth={px(16)} data-kind="edge" data-piece={p.id} data-inst={inst} />
      {dropTarget && <path d={geo.d} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={px(3)} pointerEvents="none" />}
      {picking && pickSeg !== null && geo.bz[pickSeg] && (
        <path d={runD(geo.bz, [pickSeg])} fill="none" stroke="var(--orange)" strokeWidth={px(7)} strokeLinecap="round" opacity={0.85} pointerEvents="none" />
      )}

      {/* grainline: only on the selected piece or when zoomed in */}
      {(selected || k >= 6) && (
        <line
          x1={geo.c.x} x2={geo.c.x} y1={geo.c.y - geo.bb.h * 0.22} y2={geo.c.y + geo.bb.h * 0.22}
          stroke="var(--dim-line)" strokeWidth={px(1)} markerStart="url(#arr)" markerEnd="url(#arr)" pointerEvents="none" opacity={0.45}
        />
      )}
      {/* symmetry axis */}
      {symmetry && p.symmetric && (
        <line x1={0} x2={0} y1={geo.bb.minY - 4} y2={geo.bb.maxY + 4} stroke="var(--purple)" strokeWidth={px(1.2)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />
      )}

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

    </g>
    {labelsEl && createPortal(
      <g transform={tr}>
        {nm?.show && (
          <text x={nm.x} y={nm.y - (nm.lines.length - 1) * px(6.5) - (secondary ? px(6) : 0)} className="piece-label" style={onFabric} strokeWidth={px(2.2)} fontSize={px(11)} textAnchor="middle" dominantBaseline="central" pointerEvents="none">
            {nm.lines.map((l, i) => <tspan key={i} x={nm.x} dy={i ? px(13) : 0}>{l}</tspan>)}
          </text>
        )}
        {nm?.show && secondary && (
          <text x={nm.x} y={nm.y + (nm.lines.length - 1) * px(6.5) + px(14) - px(6)} className="piece-sub" style={{ ...onFabric, fillOpacity: 0.75 }} strokeWidth={px(2.2)} fontSize={px(11)} textAnchor="middle" dominantBaseline="central" pointerEvents="none">{secondary}</text>
        )}
        {ms.map((m) => {
          const mx = (m.a.x + m.b.x) / 2, my = (m.a.y + m.b.y) / 2, tick = px(4);
          const def = m.sel ? entry.src.specs.some((d) => d.label === m.key) : false;
          const tgt: MeasureTarget | null = def ? { kind: 'spec', pieceId: entry.src.id, label: m.key } : null;
          const spec = geo.specs.find((q) => q.label === m.key);
          const flashed = !!tgt && !!flash?.keys.includes(targetKey(tgt));
          const w = px(m.text.length * 6.6 + 10), hh = px(18);
          return (
            <g key={m.key} pointerEvents="none">
              <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={ACCENT} strokeWidth={px(1)} opacity={0.8} />
              {m.vertical
                ? <><line x1={m.a.x - tick} x2={m.a.x + tick} y1={m.a.y} y2={m.a.y} stroke={ACCENT} strokeWidth={px(1)} /><line x1={m.b.x - tick} x2={m.b.x + tick} y1={m.b.y} y2={m.b.y} stroke={ACCENT} strokeWidth={px(1)} /></>
                : <><line x1={m.a.x} x2={m.a.x} y1={m.a.y - tick} y2={m.a.y + tick} stroke={ACCENT} strokeWidth={px(1)} /><line x1={m.b.x} x2={m.b.x} y1={m.b.y - tick} y2={m.b.y + tick} stroke={ACCENT} strokeWidth={px(1)} /></>}
              <line x1={mx} y1={my} x2={m.lx} y2={m.ly} stroke={ACCENT} strokeWidth={px(0.8)} opacity={0.55} />
              {tgt && spec && editing === 'm:' + m.key ? (
                <foreignObject x={m.lx - px(46)} y={m.ly - px(14)} width={px(92)} height={px(28)} pointerEvents="all">
                  <div className="chart-field" style={{ width: '100%', height: '100%', fontSize: px(13) }}>
                    <MeasureField inline cm={spec.value} units={units} label={`${m.key} (${units})`} target={tgt} onClose={() => setEditing(null)} />
                  </div>
                </foreignObject>
              ) : (
                <>
                  <text key={flashed ? flash!.n : 0} x={m.lx} y={m.ly} className={`dim-text${tgt ? ' editable' : ''}${flashed ? ' mf-flash' : ''}`} strokeWidth={px(3)} fontSize={px(11)} textAnchor="middle" dominantBaseline="central">{m.text}</text>
                  {tgt && <rect x={m.lx - w / 2} y={m.ly - hh / 2} width={w} height={hh} fill="transparent" pointerEvents="all" style={{ cursor: 'text' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing('m:' + m.key)}><title>Click to type a number</title></rect>}
                </>
              )}
            </g>
          );
        })}
        {els.map((l) => {
          const i = Number(l.key), n = p.points.length;
          const a = p.points[i], b = p.points[(i + 1) % n];
          const tgt: MeasureTarget | null = a && b ? { kind: 'edge', pieceId: entry.src.id, fromId: a.id, toId: b.id } : null;
          const bez = geo.bz[i];
          const flashed = !!tgt && !!flash?.keys.includes(targetKey(tgt));
          const w = px(l.text.length * 6 + 8), hh = px(16);
          return editing === 'e:' + l.key && tgt && bez ? (
            <foreignObject key={l.key} x={l.x - px(44)} y={l.y - px(13)} width={px(88)} height={px(26)} pointerEvents="all">
              <div className="chart-field" style={{ width: '100%', height: '100%', fontSize: px(12) }}>
                <MeasureField inline cm={bezLength(bez)} units={units} label={`Edge length (${units})`} target={tgt} onClose={() => setEditing(null)} />
              </div>
            </foreignObject>
          ) : (
            <g key={l.key}>
              <text key={flashed ? flash!.n : 0} x={l.x} y={l.y} className={`edge-len${tgt ? ' editable' : ''}${flashed ? ' mf-flash' : ''}`} strokeWidth={px(3)} fontSize={px(10)} textAnchor="middle" dominantBaseline="central" pointerEvents="none">{l.text}</text>
              {tgt && <rect x={l.x - w / 2} y={l.y - hh / 2} width={w} height={hh} fill="transparent" pointerEvents="all" style={{ cursor: 'text' }} onPointerDown={(e) => e.stopPropagation()} onClick={() => setEditing('e:' + l.key)}><title>Click to type a length</title></rect>}
            </g>
          );
        })}
      {p.points.map((q) => {
          const isSel = q.id === selPoint;
          const isMirror = symmetry && sel && sel.mirror === q.id && sel.id !== q.id;
          const isLinked = linkedHot.some((h) => h.pieceId === p.id && h.pointId === q.id);
          const inGroup = !!multiIds?.has(q.id);
          const r = px(isSel || inGroup ? 6 : tool === 'seams' ? 6 : selected ? 4.5 : 3.5);
          const fill = isSel || inGroup ? 'var(--accent)' : isMirror ? 'var(--purple)' : 'var(--point-fill)';
          const stroke = inGroup ? 'var(--bg-elevated)' : isMirror ? 'var(--purple)' : selected ? 'var(--accent)' : 'var(--point-stroke)';
          return (
            <g key={q.id}>
              {q.smooth ? (
                <circle cx={q.x} cy={q.y} r={r} fill={fill} stroke={stroke} strokeWidth={px(1.5)} pointerEvents="none" />
              ) : (
                <rect x={q.x - r} y={q.y - r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} strokeWidth={px(1.5)} pointerEvents="none" />
              )}
              {flash?.points.includes(q.id) && <circle key={flash.n} className="pt-pulse" cx={q.x} cy={q.y} r={px(11)} />}
              {isLinked && <circle cx={q.x} cy={q.y} r={px(11)} fill="var(--purple)" fillOpacity={0.25} stroke="var(--purple)" strokeWidth={px(2)} pointerEvents="none" />}
              <circle cx={q.x} cy={q.y} r={px(tool === 'seams' ? 16 : 13)} fill="transparent" data-kind="point" data-piece={p.id} data-inst={inst} data-point={q.id} style={{ cursor: tool === 'seams' ? 'pointer' : 'grab' }} />
            </g>
          );
        })}
      </g>,
      labelsEl,
    )}
    {topEl && createPortal(
      <g transform={tr}>
      {/* attachments sit on their host in the host's own coordinates; designs on a pocket or tag sit inside it */}
      <defs><clipPath id={`blk-${p.id}-${inst}`}><path d={geo.d} /></clipPath></defs>
      {attachments.filter((a) => a.block).length > 0 && <g clipPath={`url(#blk-${p.id}-${inst})`}>{attachments.filter((a) => a.block).map((a) => renderAtt(a, true))}</g>}
      {finishEdit && (finishEdit.preset !== 'none' || finishEdit.pieces.length > 0) && (
        <g clipPath={`url(#blk-${p.id}-${inst})`} pointerEvents="none">
          {finishEdit.preset !== 'none' && <path d={geo.d} fill={finishEdit.preset === 'dark' ? '#0a0f1c' : '#ffffff'} opacity={(finishEdit.preset === 'dark' ? 0.22 : finishEdit.preset === 'light' ? 0.45 : finishEdit.preset === 'vintage' ? 0.35 : 0.22) * (finishEdit.presetStrength ?? 1)} />}
          {strokesFor(finishEdit, p.id, inst).map((st, i) => {
            const pts = strokePts(st);
            if (st.k === 'hole' || st.k === 'rip') return <path key={i} d={openings([st]).map((o) => polyD(o)).join('')} fill="var(--viewport, #1b1b1f)" stroke={FINISH_KIND.fray.tone} strokeWidth={0.12} strokeDasharray="0.25 0.15" />;
            return <path key={i} d={pts.length > 1 ? polyD(pts).replace(/Z$/, '') : `M${pts[0].x},${pts[0].y}l0.01,0`} fill="none" stroke={FINISH_KIND[st.k].tone} strokeWidth={Math.max(0.3, st.r * 2)} strokeLinecap="round" strokeLinejoin="round" opacity={0.18 + 0.4 * st.s} style={{ mixBlendMode: 'screen' }} />;
          })}
        </g>
      )}
      {(edgeTrims ?? []).filter((t) => t.edge.pieceId === p.id && (t.edge.instance === undefined || t.edge.instance === inst) && showsOn(t, viewFace === 'inside' ? 'inside' : 'outside')).map((t) => {
        const line = edgePolyline(p, t.edge);
        if (line.length < 2) return null;
        if (t.method === 'thread') return <path key={t.id} d={polyD(insetPolyline(p, line, 0.35)).replace(/Z$/, '')} fill="none" stroke={t.colour} strokeWidth={Math.max(0.08, (t.tex ?? 45) / 450)} strokeDasharray="0.35 0.2" strokeLinecap="round" pointerEvents="none" />;
        if (t.method === 'binding') return <path key={t.id} d={polyD(insetPolyline(p, line, t.width / 2)).replace(/Z$/, '')} fill="none" stroke={t.colour} strokeWidth={t.width} strokeLinejoin="round" opacity={0.92} pointerEvents="none" />;
        return <path key={t.id} d={polyD(line).replace(/Z$/, '')} fill="none" stroke={t.colour} strokeWidth={t.width} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />;
      })}
      {attachments.filter((a) => !a.block).map((a) => renderAtt(a, true))}

      {/* drawn pieces that are patched on: dashed placement, draggable */}
      {ghosts.map((g) => {
        const pl = g.placement!;
        const on = g.id === selPieceId;
        const hex = fabricHex(g.fabric);
        const gf = frameOn(entry, { x: pl.x ?? 0, y: pl.y ?? 0, rotation: pl.rotation ?? 0 });
        return (
          <g key={g.id} transform={`translate(${gf.x},${gf.y}) rotate(${gf.rotation})`} data-kind="ghost" data-piece={g.id} data-inst={inst} style={{ cursor: 'move' }}>
            <path d={pathD(toBeziers(g.points))} fill={hex} fillOpacity={0.85} stroke={on ? 'var(--accent)' : 'var(--outline)'} strokeWidth={px(on ? 2.2 : 1.4)} strokeDasharray={`${px(6)} ${px(4)}`} />
            <text y={px(4)} fontSize={px(11)} textAnchor="middle" className="edge-len" strokeWidth={px(3)} pointerEvents="none">{g.name}</text>
          </g>
        );
      })}

      </g>,
      topEl,
    )}
    </>
  );
}

/** What a click would select right now: outline of the item plus a small name chip. */
function HoverOverlay({ hover, entries, geos, k }: { hover: { cand: Cand; wx: number; wy: number; more: number }; entries: Entry[]; geos: Map<string, Geo>; k: number }) {
  const px = (n: number) => n / k;
  const { cand } = hover;
  const h = cand.hl;
  const stroke = 'var(--accent)';
  let shape: React.ReactNode = null;
  if (h.t === 'ring') shape = <circle cx={h.x} cy={h.y} r={h.r} fill="var(--accent-soft)" stroke={stroke} strokeWidth={px(2)} />;
  else if (h.t === 'rect') shape = <rect x={-Math.max(h.w, px(14)) / 2 - px(2)} y={-Math.max(h.h, px(14)) / 2 - px(2)} width={Math.max(h.w, px(14)) + px(4)} height={Math.max(h.h, px(14)) + px(4)} transform={`translate(${h.x},${h.y}) rotate(${h.rot})`} fill="var(--accent-soft)" stroke={stroke} strokeWidth={px(2)} rx={px(3)} />;
  else if (h.t === 'line') shape = <line x1={h.a.x} y1={h.a.y} x2={h.b.x} y2={h.b.y} stroke={stroke} strokeWidth={px(4)} strokeLinecap="round" opacity={0.8} />;
  else {
    const en = entries.find((e) => e.key === h.key), g = geos.get(h.key);
    if (en && g) shape = h.t === 'piece'
      ? <path d={g.d} transform={`translate(${en.offset.x},${en.offset.y})`} fill="var(--accent-soft)" stroke={stroke} strokeWidth={px(2.5)} />
      : <path d={runD(g.bz, [h.seg])} transform={`translate(${en.offset.x},${en.offset.y})`} fill="none" stroke={stroke} strokeWidth={px(5)} strokeLinecap="round" opacity={0.85} />;
  }
  const text = cand.name;
  const sub = [cand.sub, hover.more > 0 ? `${hover.more} more under, click again` : null].filter(Boolean).join(' · ');
  const w = Math.max(text.length * 6.6, sub.length * 5.8) + 16;
  const hgt = sub ? 36 : 22;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {shape}
      <g transform={`translate(${hover.wx},${hover.wy}) scale(${1 / k}) translate(14,-${hgt + 10})`}>
        <rect width={w} height={hgt} rx={8} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={1} />
        <text x={8} y={sub ? 14 : 11} dominantBaseline="central" fontSize={12} fontWeight={600} fill="var(--label)">{text}</text>
        {sub && <text x={8} y={28} dominantBaseline="central" fontSize={11} fill="var(--text-2)">{sub}</text>}
      </g>
    </g>
  );
}

/** The spot last clicked on the 3D garment, marked on its pattern piece (both copies follow the side clicked). */
function ProbeMarker({ k, entries }: { k: number; entries: Entry[] }) {
  const probe = useStore((s) => s.probe);
  if (!probe) return null;
  const en = entries.find((e) => e.src.id === probe.pieceId && e.inst === probe.instance) ?? entries.find((e) => e.src.id === probe.pieceId);
  if (!en) return null;
  const w = toWorldPt(en, { x: probe.x, y: probe.y });
  const px = (n: number) => n / k;
  return (
    <g className="probe-mark" key={probe.at} pointerEvents="none" transform={`translate(${w.x} ${w.y})`}>
      <circle r={px(18)} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} className="probe-pulse" />
      <circle r={px(5)} fill="var(--accent)" stroke="var(--bg)" strokeWidth={px(1.5)} />
      <path d={`M${px(-12)} 0H${px(-7)}M${px(7)} 0H${px(12)}M0 ${px(-12)}V${px(-7)}M0 ${px(7)}V${px(12)}`} stroke="var(--accent)" strokeWidth={px(1.5)} />
      <text x={px(14)} y={px(-12)} fontSize={px(11)} fill="var(--accent)" style={{ paintOrder: 'stroke', stroke: 'var(--bg)', strokeWidth: px(3) }}>
        {`From 3D · ${probe.x.toFixed(1)}, ${probe.y.toFixed(1)} cm`}
      </text>
    </g>
  );
}
