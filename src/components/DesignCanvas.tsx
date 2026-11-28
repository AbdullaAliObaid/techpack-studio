// The Design workspace artboard: the patch or print being designed, with rulers, zoom, grid and snap, direct manipulation
// of layers and a pen tool for custom shapes.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { LayerShape, outlineD } from './Artwork';
import { fontOf } from '../three/detailsArt';
import { baseLayer, docClipRings, isCloth, newLayer, type DLayer, type DesignDoc } from './designDoc';
import { imageFileOf, openPhoto } from './editHelpers';
import { uid } from '../lib/units';
import { designTargets, layerBox, snapBox, unionBox } from './designSnap';
import type { Guide } from './snap';
import Icon from './Icon';

const GRIDS = [0.1, 0.25, 0.5, 1, 2, 5];
const round = (n: number) => Math.round(n * 100) / 100;

type Drag =
  | { kind: 'move'; ids: string[]; start: { x: number; y: number }; orig: Record<string, { x: number; y: number }> }
  | { kind: 'scale'; id: string; ratio: number }
  | { kind: 'rotate'; id: string }
  | { kind: 'pan'; x: number; y: number; vx: number; vy: number };

interface PenPt { x: number; y: number; smooth: boolean }

/** a closed path through the pen points: smooth points get Catmull-Rom handles, corner points none */
function penPath(pts: PenPt[]) {
  const n = pts.length;
  const T = pts.map((p, i) => (p.smooth ? { x: (pts[(i + 1) % n].x - pts[(i + n - 1) % n].x) / 6, y: (pts[(i + 1) % n].y - pts[(i + n - 1) % n].y) / 6 } : { x: 0, y: 0 }));
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    d += `C${a.x + T[i].x} ${a.y + T[i].y} ${b.x - T[(i + 1) % n].x} ${b.y - T[(i + 1) % n].y} ${b.x} ${b.y}`;
  }
  return d + 'Z';
}
/** the pen path as a unit box layer ('path' shape, evenodd) */
function penLayer(pts: PenPt[]): DLayer {
  const n = pts.length;
  const T = pts.map((p, i) => (p.smooth ? { x: (pts[(i + 1) % n].x - pts[(i + n - 1) % n].x) / 6, y: (pts[(i + 1) % n].y - pts[(i + n - 1) % n].y) / 6 } : { x: 0, y: 0 }));
  const samples: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const c1 = { x: a.x + T[i].x, y: a.y + T[i].y }, c2 = { x: b.x - T[(i + 1) % n].x, y: b.y - T[(i + 1) % n].y };
    for (let s = 0; s < 12; s++) { const t = s / 12, u = 1 - t; samples.push({ x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y }); }
  }
  const x0 = Math.min(...samples.map((p) => p.x)), x1 = Math.max(...samples.map((p) => p.x));
  const y0 = Math.min(...samples.map((p) => p.y)), y1 = Math.max(...samples.map((p) => p.y));
  const w = Math.max(0.3, x1 - x0), h = Math.max(0.3, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const q = pts.map((p) => ({ ...p, x: round3((p.x - cx) / w), y: round3((p.y - cy) / h) }));
  return newLayer('path', { x: round(cx), y: round(cy), w: round(w), h: round(h), path: penPath(q), name: 'Pen shape' });
}
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** one layer, with its outline behind it, a relief shadow and its blend look */
export function DLayerView({ l, doc }: { l: DLayer; doc?: Pick<DesignDoc, 'groups'> }) {
  const g = l.group ? doc?.groups.find((q) => q.id === l.group) : undefined;
  if (l.hidden || g?.hidden) return null;
  const r = l.relief ?? 0;
  const fid = `dz-rf-${l.id}`;
  const body = (x: DLayer) => (x.shape === 'text' ? (
    <g transform={`translate(${x.x},${x.y}) rotate(${x.rotation}) scale(${x.flipX ? -1 : 1},1)`} opacity={x.opacity ?? 1}>
      <text fontSize={x.h} textLength={x.w} lengthAdjust="spacingAndGlyphs" textAnchor="middle" dominantBaseline="central" fill={x.color} style={{ font: fontOf(x, x.h) }}>{x.text ?? ''}</text>
    </g>
  ) : <LayerShape l={x} pointer={false} />);
  return (
    <g data-layer={l.id} style={{ mixBlendMode: l.blend && l.blend !== 'normal' ? l.blend : undefined, cursor: l.locked ? 'default' : 'move' }} filter={r ? `url(#${fid})` : undefined}>
      {r !== 0 && (
        <filter id={fid} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          {r > 0 ? (
            <feDropShadow dx={0.04 * r + 0.02} dy={0.07 * r + 0.03} stdDeviation={0.05 + 0.05 * r} floodColor="#000" floodOpacity={0.45} />
          ) : (
            <>
              <feFlood floodColor="#000" floodOpacity={0.55} />
              <feComposite in2="SourceAlpha" operator="out" result="inv" />
              <feOffset dx={0.05} dy={0.07} />
              <feGaussianBlur stdDeviation={0.06} />
              <feComposite in2="SourceAlpha" operator="in" result="sh" />
              <feMerge><feMergeNode in="SourceGraphic" /><feMergeNode in="sh" /></feMerge>
            </>
          )}
        </filter>
      )}
      {l.stroke && (l.strokeW ?? 0) > 0 && l.shape !== 'image' && body({ ...l, id: `${l.id}-o`, color: l.stroke, w: l.w + (l.strokeW ?? 0) * 2, h: l.h + (l.strokeW ?? 0) * 2 })}
      {body(l)}
    </g>
  );
}

export default function DesignCanvas() {
  const design = useStore((s) => s.design);
  const hasBase = isCloth(design) && design.layers.some((l) => !l.hidden);
  const setDesign = useStore((s) => s.setDesign);
  const sel = useStore((s) => s.designSel);
  const set = useStore((s) => s.set);
  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 600, h: 500 });
  const [view, setView] = useState({ k: 24, x: 300, y: 250 });
  const [grid, setGrid] = useState(true);
  const snap = useStore((s) => s.snapOn);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [tool, setTool] = useState<'select' | 'pen'>('select');
  const [pen, setPen] = useState<PenPt[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [space, setSpace] = useState(false);
  const fitted = useRef(false);
  const { layers, groups } = design;
  const base = baseLayer(design);
  const cutD = useMemo(() => {
    const rings = base ? docClipRings(design) : null;
    return rings?.length ? rings.map((r) => 'M' + r.map((q) => `${q.x} ${q.y}`).join('L') + 'Z').join('') : null;
  }, [design, base]);
  const setSel = (ids: string[]) => set({ designSel: ids });

  const fit = useCallback((w = size.w, h = size.h) => {
    const k = Math.max(4, Math.min((w - 90) / (design.w * 1.5), (h - 90) / (design.h * 1.5)));
    setView({ k, x: w / 2, y: h / 2 });
  }, [design.w, design.h, size.w, size.h]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width < 10) return;
      setSize({ w: r.width, h: r.height });
      if (!fitted.current) { fitted.current = true; fit(r.width, r.height); }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const step = useMemo(() => GRIDS.find((g) => g * view.k >= 14) ?? 5, [view.k]);
  const toWorld = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left - view.x) / view.k, y: (e.clientY - r.top - view.y) / view.k };
  };
  const snapV = (v: number, off: boolean) => (snap && !off ? Math.round(v / step) * step : v);

  const patchLayers = (ids: string[], p: (l: DLayer) => Partial<DLayer>) => setDesign((d) => ({ layers: d.layers.map((l) => (ids.includes(l.id) ? { ...l, ...p(l) } : l)) }));
  const selLayers = layers.filter((l) => sel.includes(l.id));
  const one = selLayers.length === 1 ? selLayers[0] : null;

  const finishPen = () => {
    if (pen.length >= 3) {
      const l = penLayer(pen);
      setDesign((d) => ({ layers: [...d.layers, { ...l, color: '#f2c94c' }] }));
      setSel([l.id]);
    }
    setPen([]);
    setTool('select');
  };

  /* keyboard: space pans, Enter finishes the pen, Delete removes, arrows nudge */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') { e.preventDefault(); setSpace(true); return; }
    if (tool === 'pen') {
      if (e.key === 'Enter') { e.preventDefault(); finishPen(); }
      else if (e.key === 'Escape') { setPen([]); setTool('select'); }
      else if (e.key === 'Backspace') { e.preventDefault(); setPen(pen.slice(0, -1)); }
      return;
    }
    const k = e.key.toLowerCase();
    if ((k === 'delete' || k === 'backspace') && sel.length) {
      e.preventDefault();
      setDesign((d) => ({ layers: d.layers.filter((l) => !sel.includes(l.id) || l.locked) }));
      setSel([]);
    } else if (k === 'escape') setSel([]);
    else if (k === 'p') setTool('pen');
    else if (k === 'v') setTool('select');
    else if (k === 'f') fit();
    else if (k === 'd' && (e.metaKey || e.ctrlKey) && sel.length) {
      e.preventDefault();
      const copies = selLayers.map((l) => ({ ...l, id: uid(), x: l.x + 0.5, y: l.y + 0.5 }));
      setDesign((d) => ({ layers: [...d.layers, ...copies] }));
      setSel(copies.map((c) => c.id));
    } else if (k.startsWith('arrow') && sel.length) {
      e.preventDefault();
      const s = e.shiftKey ? 1 : 0.1;
      const dx = k === 'arrowright' ? s : k === 'arrowleft' ? -s : 0, dy = k === 'arrowdown' ? s : k === 'arrowup' ? -s : 0;
      patchLayers(sel.filter((id) => !layers.find((l) => l.id === id)?.locked), (l) => ({ x: round(l.x + dx), y: round(l.y + dy) }));
    }
  };

  const down = (e: React.PointerEvent) => {
    wrap.current?.focus();
    const t = e.target as Element;
    if (space || e.button === 1) {
      e.preventDefault();
      svg.current!.setPointerCapture(e.pointerId);
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
      return;
    }
    const p = toWorld(e);
    if (tool === 'pen') {
      e.preventDefault();
      svg.current!.setPointerCapture(e.pointerId);
      const first = pen[0];
      if (first && pen.length >= 3 && Math.hypot(first.x - p.x, first.y - p.y) * view.k < 10) { finishPen(); return; }
      setPen([...pen, { x: round(snapV(p.x, e.altKey)), y: round(snapV(p.y, e.altKey)), smooth: false }]);
      drag.current = { kind: 'pan', x: e.clientX, y: e.clientY, vx: -1, vy: -1 }; // marker: dragging after a click makes the point smooth
      return;
    }
    const h = (t.closest('[data-handle]') as SVGElement | null)?.dataset.handle;
    const layerEl = t.closest('[data-layer]') as SVGElement | null;
    if (h && one) {
      e.preventDefault();
      svg.current!.setPointerCapture(e.pointerId);
      drag.current = h === 'scale' ? { kind: 'scale', id: one.id, ratio: one.h / one.w } : { kind: 'rotate', id: one.id };
      return;
    }
    if (!layerEl) { if (!e.shiftKey) setSel([]); return; }
    const id = layerEl.dataset.layer!;
    const l = layers.find((q) => q.id === id);
    if (!l) return;
    e.preventDefault();
    // a click on a grouped layer picks the whole group; Alt picks the one layer
    const mates = l.group && !e.altKey ? layers.filter((q) => q.group === l.group).map((q) => q.id) : [id];
    let next = sel.includes(id) && !e.shiftKey && !e.metaKey ? sel : e.shiftKey || e.metaKey ? (sel.includes(id) ? sel.filter((s) => !mates.includes(s)) : [...sel, ...mates]) : mates;
    if (!next.includes(id) && !(e.shiftKey || e.metaKey)) next = mates;
    setSel(next);
    const movable = next.filter((s) => { const q = layers.find((z) => z.id === s); return q && !q.locked && !groups.find((g) => g.id === q.group)?.locked; });
    if (!movable.length || !next.includes(id)) return;
    svg.current!.setPointerCapture(e.pointerId);
    drag.current = { kind: 'move', ids: movable, start: p, orig: Object.fromEntries(movable.map((s) => { const q = layers.find((z) => z.id === s)!; return [s, { x: q.x, y: q.y }]; })) };
  };
  const move = (e: React.PointerEvent) => {
    const p = toWorld(e);
    setCursor(p);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      if (d.vx === -1) {
        // pen: a drag after the click makes the new point smooth
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) setPen((q) => q.map((pt, i) => (i === q.length - 1 ? { ...pt, smooth: true } : pt)));
        return;
      }
      setView({ ...view, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y });
      return;
    }
    if (d.kind === 'move') {
      let dx = p.x - d.start.x, dy = p.y - d.start.y;
      if (snap && !e.altKey) {
        // magnet: piece edges, centre lines and the other layers, then the grid for any axis that found nothing
        const mv = layers.filter((q) => d.ids.includes(q.id)).map((q) => layerBox({ ...q, x: d.orig[q.id].x + dx, y: d.orig[q.id].y + dy }));
        const rest = layers.filter((q) => !d.ids.includes(q.id) && !q.hidden).map(layerBox);
        const r = snapBox(unionBox(mv), designTargets(design.w, design.h, rest), 7 / view.k);
        const o = d.orig[d.ids[0]];
        if (r.dx === 0 && !r.guides.some((g) => g.axis === 'x')) dx = snapV(o.x + dx, false) - o.x; else dx += r.dx;
        if (r.dy === 0 && !r.guides.some((g) => g.axis === 'y')) dy = snapV(o.y + dy, false) - o.y; else dy += r.dy;
        setGuides(r.guides);
      } else setGuides([]);
      patchLayers(d.ids, (l) => ({ x: round(d.orig[l.id].x + dx), y: round(d.orig[l.id].y + dy) }));
      return;
    }
    const l = layers.find((q) => q.id === d.id);
    if (!l) return;
    if (d.kind === 'rotate') {
      let deg = (Math.atan2(p.x - l.x, -(p.y - l.y)) * 180) / Math.PI;
      if (e.shiftKey || snap) deg = Math.round(deg / (e.shiftKey ? 15 : 5)) * (e.shiftKey ? 15 : 5);
      patchLayers([l.id], () => ({ rotation: Math.round(deg) }));
    } else {
      const r = (-l.rotation * Math.PI) / 180;
      const dx = p.x - l.x, dy = p.y - l.y;
      const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
      const w = Math.max(0.3, snapV(Math.abs(lx) * 2, e.altKey));
      patchLayers([l.id], () => (e.shiftKey ? { w: round(w), h: round(Math.max(0.3, snapV(Math.abs(ly) * 2, e.altKey))) } : { w: round(w), h: round(w * d.ratio) }));
    }
  };
  const up = () => { drag.current = null; setGuides([]); };

  const wheel = (e: React.WheelEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    if (e.ctrlKey || e.metaKey) {
      const k = Math.max(3, Math.min(200, view.k * Math.exp(-e.deltaY * 0.01)));
      setView({ k, x: mx - ((mx - view.x) / view.k) * k, y: my - ((my - view.y) / view.k) * k });
    } else setView({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
  };
  const zoomBy = (f: number) => {
    const k = Math.max(3, Math.min(200, view.k * f));
    setView({ k, x: size.w / 2 - ((size.w / 2 - view.x) / view.k) * k, y: size.h / 2 - ((size.h / 2 - view.y) / view.k) * k });
  };

  const o = outlineD({ outline: design.outline, w: design.w, h: design.h });
  const cloth = design.makeAs === 'patch' || design.makeAs === 'applique';
  const k = view.k;
  const px = (n: number) => n / k;

  // rulers: tick every `rs` cm, labelled every 5th
  const rs = step;
  const ticksX: number[] = [], ticksY: number[] = [];
  for (let v = Math.ceil(-view.x / k / rs) * rs; v * k + view.x < size.w; v += rs) ticksX.push(round3(v));
  for (let v = Math.ceil(-view.y / k / rs) * rs; v * k + view.y < size.h; v += rs) ticksY.push(round3(v));
  const labelEvery = Math.max(1, Math.round(40 / (rs * k)));
  const R = 22;

  const hr = 5 / k, hit = 18 / k;
  const bbox = selLayers.length > 1 ? {
    x0: Math.min(...selLayers.map((l) => l.x - l.w / 2)), x1: Math.max(...selLayers.map((l) => l.x + l.w / 2)),
    y0: Math.min(...selLayers.map((l) => l.y - l.h / 2)), y1: Math.max(...selLayers.map((l) => l.y + l.h / 2)),
  } : null;

  return (
    <div className={`dz-art ${tool === 'pen' ? 'pen' : ''} ${space ? 'space' : ''}`} ref={wrap} tabIndex={0} onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }} onDrop={(e) => { const f = imageFileOf(e.dataTransfer.files); if (f) { e.preventDefault(); openPhoto(f); } }} onKeyDown={onKeyDown} onKeyUp={(e) => { if (e.key === ' ') setSpace(false); }} aria-label="Design artboard. Space and drag to pan, Ctrl and scroll to zoom.">
      <svg ref={svg} width={size.w} height={size.h} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel} onPointerLeave={() => setCursor(null)} role="img" aria-label="Artboard">
        <defs>
          <pattern id="dz-check" width="14" height="14" patternUnits="userSpaceOnUse"><rect width="14" height="14" fill="var(--canvas)" /><rect width="7" height="7" fill="var(--grid)" /><rect x="7" y="7" width="7" height="7" fill="var(--grid)" /></pattern>
          <clipPath id="dz-clip"><path d={o.d} transform={o.transform} /></clipPath>
          {cutD && <clipPath id="dz-cut"><path d={cutD} clipRule="evenodd" /></clipPath>}
        </defs>
        <rect width={size.w} height={size.h} fill="var(--canvas)" />
        <g transform={`translate(${view.x},${view.y}) scale(${k})`}>
          {grid && (
            <g stroke="var(--grid-major)" strokeWidth={px(1)} opacity={0.9} pointerEvents="none">
              {ticksX.map((v) => <line key={`gx${v}`} x1={v} x2={v} y1={-view.y / k} y2={(size.h - view.y) / k} strokeOpacity={Math.abs(v / (rs * 5) - Math.round(v / (rs * 5))) < 1e-6 ? 1 : 0.4} />)}
              {ticksY.map((v) => <line key={`gy${v}`} y1={v} y2={v} x1={-view.x / k} x2={(size.w - view.x) / k} strokeOpacity={Math.abs(v / (rs * 5) - Math.round(v / (rs * 5))) < 1e-6 ? 1 : 0.4} />)}
            </g>
          )}
          {/* the cloth (patch / applique): the first layer is the base and draws it. Print and embroidery get a transparent checker. */}
          {!hasBase && <path d={o.d} transform={o.transform} fill={cloth ? design.cloth : 'url(#dz-check)'} stroke="var(--label-2)" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeDasharray={cloth ? '5 4' : '5 4'} opacity={cloth ? 0.55 : 1} pointerEvents="none" />}
          <g>
            {cutD ? (
              <>
                {/* what lies outside the outline is cut when applied: show it dimmed, and the part that stays at full strength */}
                {layers.filter((l) => l === base).map((l) => <DLayerView key={l.id} l={l} doc={design} />)}
                <g opacity={0.3}>{layers.filter((l) => l !== base).map((l) => <DLayerView key={l.id} l={l} doc={design} />)}</g>
                <g clipPath="url(#dz-cut)" pointerEvents="none">{layers.filter((l) => l !== base).map((l) => <DLayerView key={`c${l.id}`} l={l} doc={design} />)}</g>
              </>
            ) : layers.map((l) => <DLayerView key={l.id} l={l} doc={design} />)}
          </g>
          {/* centre guides */}
          <g stroke="var(--accent)" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(4)}`} opacity={0.5} pointerEvents="none">
            <line x1={0} x2={0} y1={-design.h / 2 - 1} y2={design.h / 2 + 1} /><line y1={0} y2={0} x1={-design.w / 2 - 1} x2={design.w / 2 + 1} />
          </g>
          {/* selection */}
          {one && (
            <g transform={`translate(${one.x},${one.y}) rotate(${one.rotation})`} pointerEvents={one.locked ? 'none' : undefined}>
              <rect x={-one.w / 2} y={-one.h / 2} width={one.w} height={one.h} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} pointerEvents="none" />
              {!one.locked && (
                <>
                  <line x1={0} y1={-one.h / 2} x2={0} y2={-one.h / 2 - px(18)} stroke="var(--accent)" strokeWidth={px(1.5)} pointerEvents="none" />
                  <circle cx={0} cy={-one.h / 2 - px(18)} r={hr} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={px(2)} pointerEvents="none" />
                  <circle data-handle="rotate" cx={0} cy={-one.h / 2 - px(18)} r={hit} fill="transparent" style={{ cursor: 'grab' }} />
                  <rect x={one.w / 2 - hr} y={one.h / 2 - hr} width={hr * 2} height={hr * 2} fill="var(--accent)" pointerEvents="none" />
                  <circle data-handle="scale" cx={one.w / 2} cy={one.h / 2} r={hit} fill="transparent" style={{ cursor: 'nwse-resize' }} />
                </>
              )}
            </g>
          )}
          {guides.length > 0 && (
            <g pointerEvents="none" stroke="var(--purple)" strokeWidth={px(1.2)}>
              {guides.map((g, i) => (g.axis === 'x'
                ? <line key={i} x1={g.at} x2={g.at} y1={Math.min(g.a, -design.h / 2) - 1} y2={Math.max(g.b, design.h / 2) + 1} />
                : <line key={i} y1={g.at} y2={g.at} x1={Math.min(g.a, -design.w / 2) - 1} x2={Math.max(g.b, design.w / 2) + 1} />))}
            </g>
          )}
          {bbox && <rect x={bbox.x0} y={bbox.y0} width={bbox.x1 - bbox.x0} height={bbox.y1 - bbox.y0} fill="none" stroke="var(--accent)" strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(3)}`} pointerEvents="none" />}
          {/* pen in progress */}
          {tool === 'pen' && pen.length > 0 && (
            <g pointerEvents="none">
              <path d={pen.length >= 3 ? penPath(pen) : `M${pen.map((p) => `${p.x} ${p.y}`).join('L')}`} fill={pen.length >= 3 ? 'var(--accent-soft)' : 'none'} stroke="var(--accent)" strokeWidth={px(1.6)} />
              {cursor && <line x1={pen[pen.length - 1].x} y1={pen[pen.length - 1].y} x2={cursor.x} y2={cursor.y} stroke="var(--accent)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />}
              {pen.map((p, i) => (p.smooth ? <circle key={i} cx={p.x} cy={p.y} r={px(5)} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={px(1.6)} /> : <rect key={i} x={p.x - px(4.5)} y={p.y - px(4.5)} width={px(9)} height={px(9)} fill={i === 0 ? 'var(--accent)' : 'var(--bg-elevated)'} stroke="var(--accent)" strokeWidth={px(1.6)} />))}
            </g>
          )}
        </g>
        {cloth && !hasBase && <text x={size.w / 2} y={size.h - 28} textAnchor="middle" fontSize="13" fill="var(--text-2)" pointerEvents="none">The first shape you add becomes the patch base: a circle, a star, a picture, anything.</text>}
        {/* rulers */}
        <g pointerEvents="none" fontSize="11" fill="var(--text-2)" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <rect width={size.w} height={R} fill="var(--bg-grouped)" /><rect width={R} height={size.h} fill="var(--bg-grouped)" />
          <line x1={0} x2={size.w} y1={R} y2={R} stroke="var(--separator)" strokeWidth={0.5} /><line y1={0} y2={size.h} x1={R} x2={R} stroke="var(--separator)" strokeWidth={0.5} />
          {ticksX.map((v, i) => { const sx = v * k + view.x; if (sx < R) return null; const major = Math.round(v / rs) % labelEvery === 0; return <g key={`rx${i}`}><line x1={sx} x2={sx} y1={major ? 8 : 15} y2={R} stroke="var(--label-3)" />{major && <text x={sx + 3} y={11}>{round3(v)}</text>}</g>; })}
          {ticksY.map((v, i) => { const sy = v * k + view.y; if (sy < R) return null; const major = Math.round(v / rs) % labelEvery === 0; return <g key={`ry${i}`}><line y1={sy} y2={sy} x1={major ? 8 : 15} x2={R} stroke="var(--label-3)" />{major && <text transform={`translate(11,${sy - 3}) rotate(-90)`}>{round3(v)}</text>}</g>; })}
          {cursor && <><line x1={cursor.x * k + view.x} x2={cursor.x * k + view.x} y1={0} y2={R} stroke="var(--accent)" /><line y1={cursor.y * k + view.y} y2={cursor.y * k + view.y} x1={0} x2={R} stroke="var(--accent)" /></>}
          <text x={4} y={15} fontSize="10">cm</text>
        </g>
      </svg>

      <div className="dz-tools material" role="toolbar" aria-label="Artboard tools">
        <button className={tool === 'select' ? 'on' : ''} aria-pressed={tool === 'select'} aria-label="Select tool" title="Select and move (V)" onClick={() => { setPen([]); setTool('select'); }}><Icon name="select" size={18} /></button>
        <button className={tool === 'pen' ? 'on' : ''} aria-pressed={tool === 'pen'} aria-label="Pen tool" title="Pen: click for corners, drag for curves, Enter to close (P)" onClick={() => { setSel([]); setTool('pen'); }}><Icon name="pen" size={18} /></button>
        <span className="dz-sep" />
        <button aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" size={18} /></button>
        <span className="dz-zoom" aria-live="polite">{Math.round((view.k / 24) * 100)}%</span>
        <button aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(1.25)}><Icon name="plus" size={18} /></button>
        <button aria-label="Fit artboard" title="Fit artboard (F)" onClick={() => fit()}><Icon name="fit" size={18} /></button>
        <span className="dz-sep" />
        <button className={grid ? 'on' : ''} aria-pressed={grid} aria-label="Show grid" title="Grid" onClick={() => setGrid(!grid)}><Icon name="grid" size={18} /></button>
      </div>
      <div className="chart-mods material" role="toolbar" aria-label="Editing modifiers">
        <button className={`mod ${snap ? 'on' : ''}`} aria-pressed={snap} title="Snap: layers line up with the piece edges, the centre lines and other layers. Hold Alt to turn it off for one drag." onClick={() => set({ snapOn: !snap })}>
          <Icon name="snap" size={18} /><span>Snap</span>
        </button>
      </div>
      {tool === 'pen' && (
        <div className="dz-hint material" role="status">
          {pen.length < 3 ? 'Click to add points. Drag after a click for a curve.' : 'Enter or click the first point to close the shape.'}
          <button className="btn small" onClick={finishPen} disabled={pen.length < 3}>Done</button>
          <button className="btn small ghost" onClick={() => { setPen([]); setTool('select'); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}
