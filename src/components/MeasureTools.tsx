// Measuring tools for the pattern chart: ruler, tape measure, protractor, set square, cm grid, edge rulers, and the tray they live in.
// All maths is in chart world cm (see rulerMath.ts); the chart passes its own toWorld so pan and zoom are honoured.
import { useEffect, useReducer, useRef, useState } from 'react';
import { fmt, type Units } from '../lib/units';
import { dist, type Pt } from '../lib/geometry';
import { useStore, usePick, type MeasureToolId, type RMark, type RMarkInput } from '../store';
import { angleSnap } from './snap';
import type { Entry } from './sides';
import { angleDeg, arcBetween, lengthOf, nearestOnArc, niceStep, type ArcPos } from './rulerMath';
import Icon from './Icon';

interface Hit { p: Pt; kind: 'point' | 'edge' | null; en?: Entry; pos?: ArcPos }

/** Snap a world point to a pattern point (10 px reach), then to an edge (8 px; `edgeReach` px when an edge is required). */
function snapAt(w: Pt, k: number, entries: Entry[], edgeReach = 8): Hit {
  const px = (n: number) => n / k;
  let pt: Hit | null = null, ptD = px(10);
  let ed: Hit | null = null, edD = px(edgeReach);
  for (const en of entries) {
    const pts = en.piece.points;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const lx = w.x - en.offset.x, ly = w.y - en.offset.y, m = px(edgeReach) + 2;
    if (lx < x0 - m || lx > x1 + m || ly < y0 - m || ly > y1 + m) continue;
    pts.forEach((q, i) => {
      const d = Math.hypot(q.x - lx, q.y - ly);
      if (d < ptD) { ptD = d; pt = { p: { x: q.x + en.offset.x, y: q.y + en.offset.y }, kind: 'point', en, pos: { seg: i, t: 0 } }; }
    });
    const n = nearestOnArc(pts, { x: lx, y: ly });
    if (n.d < edD) { edD = n.d; ed = { p: { x: n.pt.x + en.offset.x, y: n.pt.y + en.offset.y }, kind: 'edge', en, pos: n.pos }; }
  }
  return pt ?? ed ?? { p: w, kind: null };
}

export interface MeasureHandle {
  active: () => boolean;
  down: (e: React.PointerEvent) => boolean;
  move: (e: React.PointerEvent) => boolean;
  up: (e: React.PointerEvent) => boolean;
}

interface Draft { hits: Hit[]; cur: Hit | null; downClient: Pt | null }
const EMPTY: Draft = { hits: [], cur: null, downClient: null };
const SQ_LONG = 30, SQ_SHORT = 20, SQ_THICK = 3;

export function MeasureLayer({ k, entries, units, toWorld, handle, notify }: {
  k: number; entries: Entry[]; units: Units; toWorld: (cx: number, cy: number) => Pt; handle: React.MutableRefObject<MeasureHandle | null>; notify: (m: string) => void;
}) {
  const { showMeasure, measureTool, measureGrid, measureSquare, measureMarks, project } = usePick('showMeasure', 'measureTool', 'measureGrid', 'measureSquare', 'measureMarks', 'project');
  const marks = measureMarks[project.id] ?? [];
  const px = (n: number) => n / k;
  const D = useRef<Draft>(EMPTY);
  const sq = useRef<{ start: Pt; orig: { x: number; y: number } } | null>(null);
  const [, force] = useReducer((n: number) => n + 1, 0);
  const setD = (d: Draft) => { D.current = d; force(); };
  const tool = showMeasure ? measureTool : null;
  useEffect(() => { D.current = EMPTY; sq.current = null; force(); }, [tool, project.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && D.current.hits.length) { D.current = EMPTY; force(); e.stopPropagation(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const hitFor = (e: React.PointerEvent, from?: Pt): Hit => {
    const w = toWorld(e.clientX, e.clientY);
    const h = snapAt(w, k, entries, useStore.getState().measureTool === 'tape' ? 24 : 8);
    // Shift locks the line to 0, 45 or 90 degrees from the first point
    if (e.shiftKey && from) return { p: angleSnap(from, w, 45), kind: null };
    return h;
  };

  const commit = (m: RMarkInput) => { useStore.getState().addMeasureMark(m); setD(EMPTY); };

  handle.current = {
    active: () => !!tool,
    down(e) {
      if (!tool || e.button !== 0) return false;
      const st = useStore.getState();
      const d = D.current;
      if (tool === 'square') {
        sq.current = { start: toWorld(e.clientX, e.clientY), orig: { x: st.measureSquare.x, y: st.measureSquare.y } };
        return true;
      }
      const from = d.hits[0]?.p;
      const h = hitFor(e, from);
      if (tool === 'tape' && !h.en) { notify('Click on the edge of a piece.'); return true; }
      if (d.hits.length === 0) { setD({ hits: [h], cur: h, downClient: { x: e.clientX, y: e.clientY } }); return true; }
      const hits = [...d.hits, h];
      if (tool === 'ruler' && hits.length === 2) { if (lengthOf(hits[0].p, h.p) > 0.05) commit({ kind: 'ruler', a: hits[0].p, b: h.p }); else setD(EMPTY); }
      else if (tool === 'tape' && hits.length === 2) {
        const [a, b] = hits;
        if (!a.en || !b.en || a.en.key !== b.en.key || !a.pos || !b.pos) { notify('Pick both spots on the same piece.'); setD(EMPTY); }
        else { const r = arcBetween(a.en.piece.points, a.pos, b.pos); const o = a.en.offset; commit({ kind: 'tape', path: r.path.map((q) => ({ x: q.x + o.x, y: q.y + o.y })), len: r.len }); }
      } else if (tool === 'angle' && hits.length === 3) commit({ kind: 'angle', v: hits[0].p, a: hits[1].p, b: hits[2].p });
      else setD({ hits, cur: h, downClient: null });
      return true;
    },
    move(e) {
      if (!tool) return false;
      const st = useStore.getState();
      if (tool === 'square') {
        const s = sq.current;
        if (s) {
          const w = toWorld(e.clientX, e.clientY);
          let x = s.orig.x + w.x - s.start.x, y = s.orig.y + w.y - s.start.y;
          const h = snapAt({ x, y }, k, entries, 0);
          if (h.kind === 'point') { x = h.p.x; y = h.p.y; }
          st.set({ measureSquare: { ...st.measureSquare, x, y } });
        }
        return true;
      }
      const d = D.current;
      setD({ ...d, cur: hitFor(e, d.hits[0]?.p) });
      return true;
    },
    up(e) {
      if (!tool) return false;
      if (tool === 'square') { sq.current = null; return true; }
      const d = D.current;
      // dragging out the first arm or the ruler line: letting go places the next point
      if (d.hits.length === 1 && d.downClient && Math.hypot(e.clientX - d.downClient.x, e.clientY - d.downClient.y) > 6 && tool !== 'tape') {
        const h = hitFor(e, d.hits[0].p);
        const hits = [...d.hits, h];
        if (tool === 'ruler') { if (lengthOf(hits[0].p, h.p) > 0.05) commit({ kind: 'ruler', a: hits[0].p, b: h.p }); else setD(EMPTY); }
        else setD({ hits, cur: h, downClient: null });
      } else if (d.downClient) setD({ ...d, downClient: null });
      return true;
    },
  };

  const unitCm = units === 'cm' ? 1 : 2.54;
  const gridStep = unitCm;
  const d = D.current;
  const cur = d.cur;
  const live = tool && cur && d.hits.length ? d : null;

  return (
    <g className="mlayer" pointerEvents="none">
      {showMeasure && measureGrid && (
        <>
          <defs>
            <pattern id="mgrid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse"><path d={`M${gridStep} 0H0V${gridStep}`} fill="none" stroke="var(--measure)" strokeOpacity={0.22} strokeWidth={px(1)} /></pattern>
            <pattern id="mgrid5" width={gridStep * 5} height={gridStep * 5} patternUnits="userSpaceOnUse"><path d={`M${gridStep * 5} 0H0V${gridStep * 5}`} fill="none" stroke="var(--measure)" strokeOpacity={0.4} strokeWidth={px(1)} /></pattern>
          </defs>
          {k * gridStep > 4 && <rect x={-2000} y={-2000} width={4000} height={4000} fill="url(#mgrid)" />}
          <rect x={-2000} y={-2000} width={4000} height={4000} fill="url(#mgrid5)" />
        </>
      )}
      {showMeasure && marks.map((m) => <MarkView key={m.id} m={m} k={k} units={units} />)}
      {tool && live && cur && <DraftView tool={tool} d={live} k={k} units={units} />}
      {tool && tool !== 'square' && cur && cur.kind && <circle cx={cur.p.x} cy={cur.p.y} r={px(cur.kind === 'point' ? 5 : 3.5)} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} />}
      {showMeasure && tool === 'square' && <SetSquare k={k} sq={measureSquare} />}
    </g>
  );
}

const label = (k: number, x: number, y: number, text: string) => (
  <text x={x} y={y} className="dim-text" strokeWidth={3 / k} fontSize={12 / k} textAnchor="middle" dominantBaseline="central">{text}</text>
);

function lineTicks(a: Pt, b: Pt, k: number, color: string) {
  const L = dist(a, b) || 1, nx = (-(b.y - a.y) / L) * (5 / k), ny = ((b.x - a.x) / L) * (5 / k);
  return <path d={`M${a.x + nx} ${a.y + ny}L${a.x - nx} ${a.y - ny}M${b.x + nx} ${b.y + ny}L${b.x - nx} ${b.y - ny}`} stroke={color} strokeWidth={1.5 / k} />;
}

function angleGeom(v: Pt, a: Pt, b: Pt, k: number) {
  const a1 = Math.atan2(a.y - v.y, a.x - v.x), a2 = Math.atan2(b.y - v.y, b.x - v.x);
  let dl = a2 - a1;
  while (dl > Math.PI) dl -= 2 * Math.PI;
  while (dl <= -Math.PI) dl += 2 * Math.PI;
  const r = Math.min(34 / k, 0.45 * Math.min(dist(v, a), dist(v, b)) || 34 / k);
  const e = { x: v.x + r * Math.cos(a2), y: v.y + r * Math.sin(a2) }, s = { x: v.x + r * Math.cos(a1), y: v.y + r * Math.sin(a1) };
  const mid = a1 + dl / 2, rl = r + 16 / k;
  return { d: `M${s.x} ${s.y}A${r} ${r} 0 0 ${dl > 0 ? 1 : 0} ${e.x} ${e.y}`, lx: v.x + rl * Math.cos(mid), ly: v.y + rl * Math.sin(mid) };
}

function MarkView({ m, k, units }: { m: RMark; k: number; units: Units }) {
  const c = 'var(--measure)';
  if (m.kind === 'ruler') {
    const L = dist(m.a, m.b), mx = (m.a.x + m.b.x) / 2, my = (m.a.y + m.b.y) / 2;
    return <g><line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={c} strokeWidth={1.5 / k} />{lineTicks(m.a, m.b, k, c)}{label(k, mx, my - 12 / k, fmt(L, units))}</g>;
  }
  if (m.kind === 'tape') {
    const mid = m.path[Math.floor(m.path.length / 2)];
    return <g><polyline points={m.path.map((q) => `${q.x},${q.y}`).join(' ')} fill="none" stroke={c} strokeWidth={3 / k} strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.55} /><circle cx={m.path[0].x} cy={m.path[0].y} r={3.5 / k} fill={c} /><circle cx={m.path[m.path.length - 1].x} cy={m.path[m.path.length - 1].y} r={3.5 / k} fill={c} />{label(k, mid.x, mid.y - 12 / k, fmt(m.len, units))}</g>;
  }
  const g = angleGeom(m.v, m.a, m.b, k);
  return <g><path d={`M${m.a.x} ${m.a.y}L${m.v.x} ${m.v.y}L${m.b.x} ${m.b.y}`} fill="none" stroke={c} strokeWidth={1.5 / k} strokeLinejoin="round" /><path d={g.d} fill="none" stroke={c} strokeWidth={1.5 / k} />{label(k, g.lx, g.ly, `${angleDeg(m.v, m.a, m.b).toFixed(1)}°`)}</g>;
}

function DraftView({ tool, d, k, units }: { tool: MeasureToolId; d: Draft; k: number; units: Units }) {
  const c = 'var(--accent)';
  const cur = d.cur!.p, h0 = d.hits[0];
  if (tool === 'ruler') return <MarkView m={{ id: '', kind: 'ruler', a: h0.p, b: cur }} k={k} units={units} />;
  if (tool === 'tape') {
    const e = d.cur!;
    if (!h0.en || !h0.pos || !e.en || !e.pos || h0.en.key !== e.en.key) return <circle cx={h0.p.x} cy={h0.p.y} r={4 / k} fill={c} />;
    const r = arcBetween(h0.en.piece.points, h0.pos, e.pos);
    return <MarkView m={{ id: '', kind: 'tape', len: r.len, path: r.path.map((q) => ({ x: q.x + h0.en!.offset.x, y: q.y + h0.en!.offset.y })) }} k={k} units={units} />;
  }
  if (tool === 'angle') {
    const v = h0.p;
    if (d.hits.length === 1) return <g><line x1={v.x} y1={v.y} x2={cur.x} y2={cur.y} stroke={c} strokeWidth={1.5 / k} /><circle cx={v.x} cy={v.y} r={4 / k} fill={c} /></g>;
    return <g><MarkView m={{ id: '', kind: 'angle', v, a: d.hits[1].p, b: cur }} k={k} units={units} /><circle cx={v.x} cy={v.y} r={4 / k} fill={c} /></g>;
  }
  return null;
}

function SetSquare({ k, sq }: { k: number; sq: { x: number; y: number; rot: number } }) {
  const t = SQ_THICK, A = SQ_LONG, B = SQ_SHORT;
  // legs run right (long) and down (short) from the corner; ticks every cm along both outer edges
  const ticks: string[] = [];
  for (let i = 1; i < A; i++) ticks.push(`M${i} 0v${i % 5 === 0 ? 1.6 : 0.9}`);
  for (let i = 1; i < B; i++) ticks.push(`M0 ${i}h${i % 5 === 0 ? 1.6 : 0.9}`);
  return (
    <g transform={`translate(${sq.x},${sq.y}) rotate(${sq.rot})`}>
      <path d={`M0 0H${A}V${t}H${t}V${B}H0z`} fill="var(--measure)" fillOpacity={0.14} stroke="var(--measure)" strokeWidth={1.5 / k} strokeLinejoin="round" />
      <path d={ticks.join('')} stroke="var(--measure)" strokeWidth={1 / k} />
      <path d={`M${t + 1.6} ${t}V${t + 1.6}H${t}`} fill="none" stroke="var(--measure)" strokeWidth={1 / k} />
      <circle cx={0} cy={0} r={3 / k} fill="var(--measure)" />
    </g>
  );
}

/** Rulers along the top and left edges of the chart, in the chosen units, following pan and zoom. */
export function ChartRulers({ view, size, units }: { view: { x: number; y: number; k: number }; size: { w: number; h: number } | null; units: Units }) {
  const { showMeasure, measureRulers } = usePick('showMeasure', 'measureRulers');
  if (!showMeasure || !measureRulers || !size) return null;
  const T = 20;
  const unitCm = units === 'cm' ? 1 : 2.54, upx = view.k * unitCm;
  const minor = niceStep(upx, 8);
  const major = minor * [1, 2, 5, 10, 20, 50].find((m) => minor * m * upx >= 56)!;
  const fmtV = (v: number) => String(+v.toFixed(3));
  const axis = (len: number, origin: number, horiz: boolean) => {
    const i0 = Math.floor((T - origin) / upx / minor), i1 = Math.ceil((len - origin) / upx / minor);
    const els: React.ReactNode[] = [];
    let path = '';
    for (let i = i0; i <= i1 && i - i0 < 800; i++) {
      const v = i * minor, p = origin + v * upx;
      if (p < T - 0.5 || p > len) continue;
      const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
      const L = isMajor ? 12 : Math.abs(v / (major / 2) - Math.round(v / (major / 2))) < 1e-6 ? 8 : 5;
      path += horiz ? `M${p} ${T}v${-L}` : `M${T} ${p}h${-L}`;
      if (isMajor) els.push(horiz
        ? <text key={i} x={p + 3} y={11} className="ruler-num">{fmtV(v)}</text>
        : <text key={i} transform={`translate(11 ${p - 3}) rotate(-90)`} className="ruler-num">{fmtV(v)}</text>);
    }
    return <>{<path d={path} className="ruler-tick" />}{els}</>;
  };
  return (
    <svg className="chart-rulers" width={size.w} height={size.h} aria-hidden="true">
      <rect x={0} y={0} width={size.w} height={T} className="ruler-bg" />
      <rect x={0} y={0} width={T} height={size.h} className="ruler-bg" />
      <path d={`M${T} ${T}H${size.w}M${T} ${T}V${size.h}`} className="ruler-edge" />
      {axis(size.w, view.x, true)}
      {axis(size.h, view.y, false)}
      <text x={T / 2} y={T / 2 + 1} className="ruler-unit" textAnchor="middle" dominantBaseline="central">{units}</text>
    </svg>
  );
}

const TOOLS: { id: MeasureToolId; label: string; icon: string; key: string; hint: string }[] = [
  { id: 'ruler', label: 'Ruler', icon: 'ruler', key: 'R', hint: 'Drag between two points for a straight length. Shift locks to 45 degree steps.' },
  { id: 'tape', label: 'Tape', icon: 'tape', key: 'E', hint: 'Click two spots on the edge of a piece to measure along the curve.' },
  { id: 'angle', label: 'Protractor', icon: 'protractor', key: 'A', hint: 'Click the corner, then the end of each arm. Or drag out the first arm.' },
  { id: 'square', label: 'Set square', icon: 'square', key: 'Q', hint: 'Drag the square onto a corner to check it is square. Shift+Q turns it a quarter.' },
];
const markText = (m: RMark, units: Units) => m.kind === 'ruler' ? `Ruler ${fmt(dist(m.a, m.b), units)}` : m.kind === 'tape' ? `Tape ${fmt(m.len, units)}` : `Angle ${angleDeg(m.v, m.a, m.b).toFixed(1)}°`;

/** The tool tray that rises from the bottom of the chart while Measure is on. */
export function MeasureTray() {
  const { showMeasure, measureTool, measureGrid, measureRulers, measureSquare, measureMarks, project, units, set } = usePick('showMeasure', 'measureTool', 'measureGrid', 'measureRulers', 'measureSquare', 'measureMarks', 'project', 'units', 'set');
  const marks = measureMarks[project.id] ?? [];
  // choosing another chart tool (Select, Pan, Pen and so on) puts the measuring tool down
  const chartTool = useStore((st) => st.tool);
  const firstTool = useRef(true);
  useEffect(() => { if (firstTool.current) { firstTool.current = false; return; } set({ measureTool: null }); }, [chartTool, set]);
  const [mounted, setMounted] = useState(showMeasure);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (showMeasure) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
      return () => cancelAnimationFrame(r);
    }
    setOpen(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [showMeasure]);
  useEffect(() => {
    if (!showMeasure) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase(), st = useStore.getState();
      const pickTool = (t: MeasureToolId) => { e.preventDefault(); e.stopImmediatePropagation(); set({ measureTool: st.measureTool === t ? null : t }); };
      if (k === 'r' && !e.shiftKey) pickTool('ruler');
      else if (k === 'e') pickTool('tape');
      else if (k === 'a') pickTool('angle');
      else if (k === 'q' && !e.shiftKey) pickTool('square');
      else if (k === 'q' && e.shiftKey) { e.preventDefault(); set({ measureSquare: { ...st.measureSquare, rot: (st.measureSquare.rot + 90) % 360 } }); }
      else if (k === 'g') { e.preventDefault(); set({ measureGrid: !st.measureGrid }); }
      else if (k === '1' || k === '2' || k === '3' || k === '4') { e.preventDefault(); set({ measureTool: TOOLS[+k - 1].id }); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showMeasure, set]);
  if (!mounted) return null;
  const tool = TOOLS.find((t) => t.id === measureTool);
  const rm = (id: string) => useStore.getState().removeMeasureMark(id);
  return (
    <div className="mtray material" data-open={open} role="region" aria-label="Measuring tools">
      <div className="mtray-row">
        <div className="seg mtray-tools" role="toolbar" aria-label="Measuring tool">
          {TOOLS.map((t) => (
            <button key={t.id} className={measureTool === t.id ? 'on' : ''} aria-pressed={measureTool === t.id} title={`${t.label} (${t.key})`} onClick={() => set({ measureTool: measureTool === t.id ? null : t.id })}>
              <Icon name={t.icon} size={16} weight={1.5} /><span>{t.label}</span>
            </button>
          ))}
        </div>
        <div className="seg mtray-opts" role="group" aria-label="Chart guides">
          <button className={measureGrid ? 'on' : ''} aria-pressed={measureGrid} title="Grid (G)" onClick={() => set({ measureGrid: !measureGrid })}><Icon name="grid" size={16} weight={1.5} /><span>Grid</span></button>
          <button className={measureRulers ? 'on' : ''} aria-pressed={measureRulers} title="Rulers on the chart edges" onClick={() => set({ measureRulers: !measureRulers })}><Icon name="rulers" size={16} weight={1.5} /><span>Rulers</span></button>
        </div>
        {measureTool === 'square' && <button className="btn" onClick={() => set({ measureSquare: { ...measureSquare, rot: (measureSquare.rot + 90) % 360 } })}>Turn square</button>}
        <button className="icon-btn mtray-close" aria-label="Close measuring tools" title="Close (M)" onClick={() => set({ showMeasure: false })}><Icon name="close" size={16} weight={1.5} /></button>
      </div>
      <div className="mtray-row mtray-low">
        <p className="mtray-hint">{tool ? tool.hint : 'Pick a tool to measure on the chart.'}</p>
        <div className="mtray-list" role="list" aria-label="Placed measurements" aria-live="polite">
          {marks.map((m) => (
            <span key={m.id} className="mchip" role="listitem" onContextMenu={(e) => { e.preventDefault(); rm(m.id); }}>
              {markText(m, units)}
              <button aria-label={`Remove ${markText(m, units)}`} title="Remove" onClick={() => rm(m.id)}><Icon name="close" size={12} weight={1.5} /></button>
            </span>
          ))}
          {!marks.length && <span className="mtray-empty">Nothing measured yet. These stay off the tech pack.</span>}
        </div>
        {marks.length > 0 && <button className="btn mtray-clear" onClick={() => useStore.getState().clearMeasureMarks()}>Clear all</button>}
      </div>
    </div>
  );
}
