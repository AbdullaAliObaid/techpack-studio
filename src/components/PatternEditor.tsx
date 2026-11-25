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

type View = { x: number; y: number; k: number };

type Drag =
  | { mode: 'point'; pieceId: string; pointId: string; start: Pt; committed: boolean }
  | { mode: 'piece'; pieceId: string; start: Pt; startOffset: Pt; committed: boolean }
  | { mode: 'pan'; startClient: Pt; startView: View }
  | { mode: 'pinch'; startDist: number; startMid: Pt; startView: View };

const ACCENT = 'var(--measure)';
export const SEAM_ALLOWANCE = 1; // cm

export default function PatternEditor() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ x: 40, y: 40, k: 3 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, Pt>());
  const lastTap = useRef<{ t: number; key: string }>({ t: 0, key: '' });

  const s = useStore();
  const { project, tool, symmetry, showMeasure, showStitch, selPiece, selPoint, units, fitToken } = s;
  const pieces = project.pieces;

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
      drag.current = { mode: 'piece', pieceId, start: w, startOffset: piece.offset, committed: false };
      return;
    }

    st.select(null, null);
    panNow();
  };

  const onPointerMove = (e: React.PointerEvent) => {
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
    const w = toWorld(e.clientX, e.clientY);
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
            />
          ))}
        </g>
      </svg>
      <div className="editor-hud">
        <span>{Math.round(k * 10)}%</span>
        <span className="hud-sep" />
        <span>{tool === 'add' ? 'Tap an edge to add a point' : 'Drag points to reshape · double-tap an edge to add a point · double-tap a point for curve/corner'}</span>
      </div>
    </div>
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
}) {
  const { piece: p, k, selected, selPoint, symmetry, showMeasure, showStitch, units } = props;
  const px = (n: number) => n / k;

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

      {/* points */}
      {p.points.map((q) => {
          const isSel = q.id === selPoint;
          const isMirror = symmetry && sel && sel.mirror === q.id && sel.id !== q.id;
          const r = px(isSel ? 6 : selected ? 4.5 : 3.5);
          const fill = isSel ? 'var(--accent)' : isMirror ? 'var(--purple)' : 'var(--point-fill)';
          const stroke = isMirror ? 'var(--purple)' : selected ? 'var(--accent)' : 'var(--point-stroke)';
          return (
            <g key={q.id}>
              {q.smooth ? (
                <circle cx={q.x} cy={q.y} r={r} fill={fill} stroke={stroke} strokeWidth={px(1.5)} pointerEvents="none" />
              ) : (
                <rect x={q.x - r} y={q.y - r} width={r * 2} height={r * 2} fill={fill} stroke={stroke} strokeWidth={px(1.5)} pointerEvents="none" />
              )}
              <circle cx={q.x} cy={q.y} r={px(13)} fill="transparent" data-kind="point" data-piece={p.id} data-point={q.id} style={{ cursor: 'grab' }} />
            </g>
          );
        })}
    </g>
  );
}
