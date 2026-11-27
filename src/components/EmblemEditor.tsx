// Artwork layers: a layer stack plus a live preview where layers are dragged, scaled and rotated with the pointer.
import { useEffect, useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import { SHAPES, SHAPE_IDS } from '../lib/shapes';
import type { Attachment, ShapeId, ShapeLayer } from '../data/edits';
import { LayerShape, outlineD } from './Artwork';
import { ColorField, Disclosure, LenInput, Row, SubLabel, Switch } from './controls';
import { PALETTE, layer, stripeLayers } from './editHelpers';
import { fabricById } from '../data/fabrics';
import { uid } from '../lib/units';
import Icon from './Icon';

/** opacity a hidden layer had before it was hidden (hidden = opacity 0, the shared shape has no hidden flag) */
const hiddenMemo = new Map<string, number>();

type Drag = { kind: 'move'; id: string; dx: number; dy: number } | { kind: 'scale'; id: string; ratio: number } | { kind: 'rotate'; id: string };

/**
 * Layer editor. By default it edits the attachment's own layers; pass `layers` and `onLayers` to edit another list of
 * layers (trim engraving, zipper puller artwork) and `fill` for the colour behind them.
 */
export default function EmblemEditor({ att: attIn, layers: layersProp, onLayers, fill, sectionId = 'design-layers', title = 'Artwork layers' }: {
  att: Attachment; layers?: ShapeLayer[]; onLayers?: (l: ShapeLayer[]) => void; fill?: string; sectionId?: string; title?: string;
}) {
  const layers = layersProp ?? attIn.layers;
  const att = layersProp ? { ...attIn, layers } : attIn;
  const { updateAttachment, selLayer, set, project, units } = usePick('updateAttachment', 'selLayer', 'set', 'project', 'units');
  const [picking, setPicking] = useState(false);
  const [lock, setLock] = useState(true);
  const sel = layers.find((l) => l.id === selLayer) ?? null;

  const setLayers = (next: ShapeLayer[]) => (onLayers ? onLayers(next) : updateAttachment(att.id, { layers: next }));
  const patch = (id: string, p: Partial<ShapeLayer>) => setLayers(layers.map((l) => (l.id === id ? { ...l, ...p } : l)));
  const add = (shape: ShapeId) => {
    const s = Math.max(0.3, Math.min(att.w, att.h) * 0.5);
    const l = layer(shape, { w: shape === 'stripe' ? att.w : s, h: shape === 'stripe' ? s * 0.4 : shape === 'text' ? Math.max(1.5, s * 0.6) : s, text: shape === 'text' ? 'TEXT' : undefined, color: PALETTE[(layers.length + 1) % PALETTE.length] });
    setLayers([...layers, l]);
    set({ selLayer: l.id });
    setPicking(false);
  };
  const move = (id: string, dir: -1 | 1) => {
    const i = layers.findIndex((l) => l.id === id), j = i + dir;
    if (j < 0 || j >= layers.length) return;
    const next = [...layers];
    [next[i], next[j]] = [next[j], next[i]];
    setLayers(next);
  };
  const duplicate = (l: ShapeLayer) => {
    const copy = { ...l, id: uid(), x: l.x + 1, y: l.y + 1 };
    const i = layers.findIndex((q) => q.id === l.id);
    setLayers([...layers.slice(0, i + 1), copy, ...layers.slice(i + 1)]);
    set({ selLayer: copy.id });
  };
  const remove = (id: string) => {
    setLayers(layers.filter((l) => l.id !== id));
    if (selLayer === id) set({ selLayer: null });
  };
  const toggleHidden = (l: ShapeLayer) => {
    if ((l.opacity ?? 1) <= 0) patch(l.id, { opacity: hiddenMemo.get(l.id) ?? 1 });
    else { hiddenMemo.set(l.id, l.opacity ?? 1); patch(l.id, { opacity: 0 }); }
  };

  return (
    <Disclosure id={sectionId} title={title} icon="layers" count={layers.length}>
        <Preview att={att} sel={sel} onPatch={patch} onSelect={(id) => set({ selLayer: id })} lock={lock} fabricHex={fill ?? fabricHex(att, project.pieces.find((p) => p.id === att.pieceId)?.fabric)} />
        <div className="group-note" style={{ padding: '6px 0 0' }}>Drag a layer to move it. Use the corner handle to resize and the top handle to turn it.</div>
        <div className="row wrap">
          <button className="btn small" onClick={() => setPicking(!picking)} aria-expanded={picking}><Icon name="plus" size={14} /> Add shape</button>
          <button className="btn small" onClick={() => { const ls = stripeLayers(att.w, att.h, 1); setLayers([...layers, ...ls]); set({ selLayer: ls[0].id }); }}><Icon name="stripes" size={14} /> Add stripe</button>
        </div>
        {picking && (
          <div className="shape-grid" role="group" aria-label="Shapes">
            {SHAPE_IDS.map((id) => (
              <button key={id} className="shape-tile" title={SHAPES[id].name} aria-label={`Add ${SHAPES[id].name}`} onClick={() => add(id)}>
                <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true">
                  {id === 'text' ? <text x="0" y="0" fontSize="0.8" textAnchor="middle" dominantBaseline="central" fill="currentColor" fontWeight="700">Aa</text> : <path d={SHAPES[id].d} fill="currentColor" fillRule="evenodd" />}
                </svg>
                <span>{SHAPES[id].name}</span>
              </button>
            ))}
          </div>
        )}

        <SubLabel>Layers, top first</SubLabel>
        {layers.length === 0 && <div className="group-note">No extra layers. Add a shape or a stripe on top of this design.</div>}
        <ul className="layer-list">
          {[...layers].reverse().map((l) => {
            const hidden = (l.opacity ?? 1) <= 0;
            return (
              <li key={l.id} className={`layer-row ${l.id === selLayer ? 'on' : ''}`}>
                <button className="layer-main" aria-pressed={l.id === selLayer} onClick={() => set({ selLayer: l.id })}>
                  <svg viewBox="-0.6 -0.6 1.2 1.2" className="layer-thumb" aria-hidden="true" style={{ opacity: hidden ? 0.35 : 1 }}>
                    {l.shape === 'text' ? <text x="0" y="0" fontSize="0.8" textAnchor="middle" dominantBaseline="central" fill={l.color} fontWeight="700">Aa</text> : l.shape === 'image' && l.image ? <image href={l.image} x="-0.5" y="-0.5" width="1" height="1" preserveAspectRatio="none" /> : <path d={l.shape === 'path' ? l.path ?? '' : SHAPES[l.shape].d} fill={l.color} stroke="var(--separator)" strokeWidth="0.03" fillRule="evenodd" />}
                  </svg>
                  <span className={hidden ? 'dim' : ''}>{l.shape === 'text' ? `Text "${l.text ?? ''}"` : l.shape === 'path' ? 'Traced colour' : SHAPES[l.shape].name}</span>
                </button>
                <button className="icon-btn sm" aria-label={hidden ? 'Show layer' : 'Hide layer'} title={hidden ? 'Show layer' : 'Hide layer'} onClick={() => toggleHidden(l)}><Icon name={hidden ? 'eyeoff' : 'eye'} size={16} /></button>
                <button className="icon-btn sm" aria-label="Move layer up" title="Bring forward" disabled={layers[layers.length - 1].id === l.id} onClick={() => move(l.id, 1)}><Icon name="up" size={16} /></button>
                <button className="icon-btn sm" aria-label="Move layer down" title="Send back" disabled={layers[0].id === l.id} onClick={() => move(l.id, -1)}><Icon name="down" size={16} /></button>
                <button className="icon-btn sm" aria-label="Duplicate layer" title="Duplicate" onClick={() => duplicate(l)}><Icon name="copy" size={16} /></button>
                <button className="icon-btn sm danger" aria-label="Delete layer" title="Delete" onClick={() => remove(l.id)}><Icon name="trash" size={16} /></button>
              </li>
            );
          })}
        </ul>

      {sel && (
        <>
          <SubLabel>Selected layer</SubLabel>
          <div className="frow stack"><span className="lbl">Colour</span><ColorField label="Layer colour" value={sel.color} onChange={(c) => patch(sel.id, { color: c })} /></div>
          {sel.shape === 'text' && (
            <Row label="Text" htmlFor="layer-text"><input id="layer-text" className="txt" value={sel.text ?? ''} maxLength={24} onChange={(e) => patch(sel.id, { text: e.target.value })} /></Row>
          )}
          <Row label="Position X"><LenInput units={units} label="Layer position X" value={sel.x} onChange={(v) => patch(sel.id, { x: v })} /></Row>
          <Row label="Position Y"><LenInput units={units} label="Layer position Y" value={sel.y} onChange={(v) => patch(sel.id, { y: v })} /></Row>
          <Row label={<>Size <button className="icon-btn sm inline" aria-label={lock ? 'Unlock proportions' : 'Lock proportions'} aria-pressed={lock} title={lock ? 'Proportions locked' : 'Proportions free'} onClick={() => setLock(!lock)}><Icon name={lock ? 'lock' : 'unlock'} size={14} /></button></>}>
            <LenInput units={units} label="Layer width" value={sel.w} min={0.1} onChange={(v) => patch(sel.id, lock && sel.w > 0 ? { w: v, h: (sel.h * v) / sel.w } : { w: v })} />
            <LenInput units={units} label="Layer height" value={sel.h} min={0.1} onChange={(v) => patch(sel.id, lock && sel.h > 0 ? { h: v, w: (sel.w * v) / sel.h } : { h: v })} />
          </Row>
          <div className="frow stack">
            <label htmlFor="layer-rot">Rotation <b className="val">{Math.round(sel.rotation)}°</b></label>
            <input id="layer-rot" type="range" min={-180} max={180} step={1} value={sel.rotation} onChange={(e) => patch(sel.id, { rotation: Number(e.target.value) })} />
          </div>
          <div className="frow stack">
            <label htmlFor="layer-op">Opacity <b className="val">{Math.round((sel.opacity ?? 1) * 100)}%</b></label>
            <input id="layer-op" type="range" min={5} max={100} step={1} value={Math.round((sel.opacity ?? 1) * 100) || 100} onChange={(e) => patch(sel.id, { opacity: Number(e.target.value) / 100 })} />
          </div>
          <Row label="Flip left to right"><Switch label="Flip layer left to right" on={!!sel.flipX} onChange={(v) => patch(sel.id, { flipX: v })} /></Row>
        </>
      )}
    </Disclosure>
  );
}

function fabricHex(att: Attachment, host?: { id: string; color: number }) {
  const f = att.fabric ?? host;
  if (!f) return 'var(--fill)';
  const fab = fabricById(f.id);
  return (fab.colors[f.color] ?? fab.colors[0]).hex;
}

/** Live preview with direct manipulation. Coordinates are attachment-centred cm, so SVG user space is cm. */
function Preview({ att, sel, onPatch, onSelect, lock, fabricHex: fill }: {
  att: Attachment; sel: ShapeLayer | null; onPatch: (id: string, p: Partial<ShapeLayer>) => void; onSelect: (id: string | null) => void; lock: boolean; fabricHex: string;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const S = Math.max(att.w, att.h, att.kind === 'hardware' ? 0.8 : 6) * 1.5;
  const o = outlineD(att);
  const [wpx, setWpx] = useState(260);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWpx(el.getBoundingClientRect().width));
    ro.observe(el);
    setWpx(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const svg = ref.current!;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const down = (e: React.PointerEvent) => {
    const t = (e.target as Element).closest('[data-layer],[data-handle]') as SVGElement | null;
    if (!t) { onSelect(null); return; }
    e.preventDefault();
    ref.current!.setPointerCapture(e.pointerId);
    const p = toLocal(e);
    const h = t.dataset.handle;
    const id = (t.dataset.layer ?? sel?.id)!;
    const l = att.layers.find((q) => q.id === id);
    if (!l) return;
    onSelect(id);
    if (h === 'scale') drag.current = { kind: 'scale', id, ratio: l.h / l.w };
    else if (h === 'rotate') drag.current = { kind: 'rotate', id };
    else drag.current = { kind: 'move', id, dx: p.x - l.x, dy: p.y - l.y };
  };
  const moveP = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const l = att.layers.find((q) => q.id === d.id);
    if (!l) return;
    const p = toLocal(e);
    if (d.kind === 'move') onPatch(l.id, { x: round(p.x - d.dx), y: round(p.y - d.dy) });
    else if (d.kind === 'rotate') {
      let deg = (Math.atan2(p.x - l.x, -(p.y - l.y)) * 180) / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      onPatch(l.id, { rotation: Math.round(deg) });
    } else {
      const r = (-l.rotation * Math.PI) / 180;
      const dx = p.x - l.x, dy = p.y - l.y;
      const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
      const w = Math.max(0.3, Math.abs(lx) * 2);
      onPatch(l.id, lock && !e.shiftKey ? { w: round(w), h: round(w * d.ratio) } : { w: round(w), h: round(Math.max(0.3, Math.abs(ly) * 2)) });
    }
  };
  const up = () => { drag.current = null; };

  const k = S / Math.max(1, wpx);
  const hr = 6 * k, hit = 22 * k;
  return (
    <svg
      ref={ref}
      className="emblem-preview"
      viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`}
      role="img"
      aria-label="Emblem preview. Drag layers to move them."
      onPointerDown={down}
      onPointerMove={moveP}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <defs>
        <clipPath id="emb-clip"><path d={o.d} transform={o.transform} /></clipPath>
      </defs>
      <path d={o.d} transform={o.transform} fill={att.kind === 'print' || att.kind === 'embroidery' ? 'var(--fill-2)' : fill} />
      <g clipPath={att.kind === 'print' ? undefined : 'url(#emb-clip)'}>
        {att.layers.map((l) => (
          <g key={l.id} data-layer={l.id} style={{ cursor: 'move' }}>
            <LayerShape l={l} pointer />
          </g>
        ))}
      </g>
      <path d={o.d} transform={o.transform} fill="none" stroke="var(--label-2)" strokeWidth={1.2 * k} strokeDasharray={`${4 * k} ${3 * k}`} vectorEffect="non-scaling-stroke" pointerEvents="none" />
      {sel && (
        <g transform={`translate(${sel.x},${sel.y}) rotate(${sel.rotation})`}>
          <rect x={-sel.w / 2} y={-sel.h / 2} width={sel.w} height={sel.h} fill="none" stroke="var(--accent)" strokeWidth={1.5 * k} pointerEvents="none" />
          <line x1={0} y1={-sel.h / 2} x2={0} y2={-sel.h / 2 - 16 * k} stroke="var(--accent)" strokeWidth={1.5 * k} pointerEvents="none" />
          <circle cx={0} cy={-sel.h / 2 - 16 * k} r={hr} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={2 * k} pointerEvents="none" />
          <circle data-handle="rotate" cx={0} cy={-sel.h / 2 - 16 * k} r={hit} fill="transparent" style={{ cursor: 'grab' }} />
          <rect x={sel.w / 2 - hr} y={sel.h / 2 - hr} width={hr * 2} height={hr * 2} fill="var(--accent)" pointerEvents="none" />
          <circle data-handle="scale" cx={sel.w / 2} cy={sel.h / 2} r={hit} fill="transparent" style={{ cursor: 'nwse-resize' }} />
        </g>
      )}
    </svg>
  );
}

const round = (n: number) => Math.round(n * 100) / 100;
