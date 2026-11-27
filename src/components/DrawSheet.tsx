// "Draw your own": a small sheet to draw the outline of a button, snap, stud or zipper puller with the pen, finger or
// mouse (or start from a shape), then set its size, holes, finish, colour and sheen and add artwork to engrave on it.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SHAPES } from '../lib/shapes';
import * as shapesLib from '../lib/shapes';
import type { Attachment, ShapeId, ShapeLayer } from '../data/edits';
import { HardwareMark } from './Artwork';
import { ColorField, LenInput, Row, Seg } from './controls';
import { FinishPick, SheenPick } from './TrimFields';
import { normaliseOutline, scaleOutline, strokeToOutline } from './editHelpers';
import type { DrawDraft } from './designLibrary';
import EmblemEditor from './EmblemEditor';
import { useStore } from '../store';
import Icon from './Icon';

const STARTERS: ShapeId[] = ['circle', 'rounded', 'hexagon', 'shield', 'star', 'heart', 'diamond', 'star4', 'cross', 'triangle'];
const NAME: Record<DrawDraft['type'], string> = { button: 'button', snap: 'snap', stud: 'stud', rivet: 'rivet', eyelet: 'eyelet', zipper: 'zipper', puller: 'zipper puller' };
const C = 300; // drawing canvas, px

export default function DrawSheet({ initial, doneLabel, onDone, onCancel }: { initial: DrawDraft; doneLabel: string; onDone: (d: DrawDraft) => void; onCancel: () => void }) {
  const units = useStore((s) => s.units);
  const [d, setD] = useState<DrawDraft>(initial);
  const [stroke, setStroke] = useState<{ x: number; y: number }[] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const pen = useRef(false);
  const patch = (p: Partial<DrawDraft>) => setD((cur) => ({ ...cur, ...p }));
  const puller = d.type === 'puller';

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onCancel]);

  const at = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * C, y: ((e.clientY - r.top) / r.height) * C };
  };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    svgRef.current!.setPointerCapture(e.pointerId);
    pen.current = true;
    setStroke([at(e)]);
  };
  const move = (e: React.PointerEvent) => {
    if (!pen.current) return;
    const p = at(e);
    setStroke((s) => (s && Math.hypot(p.x - s[s.length - 1].x, p.y - s[s.length - 1].y) > 2.5 ? [...s, p] : s));
  };
  const up = () => {
    if (!pen.current) return;
    pen.current = false;
    setStroke((s) => {
      const u = s ? strokeToOutline(s) : [];
      if (u.length >= 3) patch({ unit: u });
      return null;
    });
  };
  const start = (id: ShapeId) => {
    const ring = shapesLib.shapePolygon(id, 1, 1)[0];
    if (ring?.length) patch({ unit: normaliseOutline(ring) });
  };

  const setSize = (v: number) => {
    const k = v / d.size;
    const scale = (l: ShapeLayer): ShapeLayer => ({ ...l, x: l.x * k, y: l.y * k, w: l.w * k, h: l.h * k });
    setD((cur) => ({ ...cur, size: v, layers: cur.layers.map(scale) }));
  };

  const outline = d.unit.length >= 3 ? scaleOutline(d.unit, d.size) : undefined;
  const hw = { type: (puller ? 'button' : d.type) as 'button', finish: d.finish, size: d.size, holes: puller ? 0 as const : d.type === 'button' ? d.holes : 0 as const, outline, layers: d.layers, sheen: d.sheen, ...(d.color ? { color: d.color } : {}) };
  const scale = 190 / d.size;
  const synth: Attachment = { id: 'draft', kind: 'hardware', name: '', pieceId: '', x: 0, y: 0, rotation: 0, w: d.size, h: d.size, outline: 'custom', points: outline, layers: d.layers };
  const poly = stroke && stroke.length > 1 ? `M${stroke.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}` : '';
  const ready = !!outline;

  return createPortal(
    <div className="sheet-backdrop" role="presentation" onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sheet draw-sheet material" role="dialog" aria-modal="true" aria-labelledby="draw-title">
        <div className="flow-head">
          <h2 id="draw-title" style={{ flex: 1 }}>Draw your {NAME[d.type]}</h2>
          <button className="icon-btn" aria-label="Close" title="Close" onClick={onCancel}><Icon name="close" size={18} /></button>
        </div>
        <svg ref={svgRef} className="draw-canvas" viewBox={`0 0 ${C} ${C}`} role="img" aria-label="Drawing area. Draw the outline with a pen, finger or mouse."
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <path d={`M${C / 2} 0V${C}M0 ${C / 2}H${C}`} stroke="var(--grid-major)" strokeWidth={1} strokeDasharray="4 4" />
          <circle cx={C / 2} cy={C / 2} r={C * 0.42} fill="none" stroke="var(--grid-major)" strokeWidth={1} strokeDasharray="2 5" />
          {outline && !stroke && (
            <g transform={`translate(${C / 2},${C / 2}) scale(${scale})`} pointerEvents="none">
              <HardwareMark hw={hw} w={d.size} h={d.size} />
            </g>
          )}
          {poly && <path d={poly} fill="none" stroke="var(--accent)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
          {!outline && !stroke && (
            <text x={C / 2} y={C / 2} textAnchor="middle" dominantBaseline="central" fill="var(--label-2)" fontSize={14} pointerEvents="none">Draw an outline here</text>
          )}
        </svg>
        <div className="row wrap">
          <span className="lbl" style={{ marginRight: 4 }}>Start from a shape</span>
          {STARTERS.map((id) => (
            <button key={id} className="shape-tile mini" title={SHAPES[id].name} aria-label={`Start from ${SHAPES[id].name}`} onClick={() => start(id)}>
              <svg viewBox="-0.6 -0.6 1.2 1.2" aria-hidden="true"><path d={SHAPES[id].d} fill="currentColor" fillRule="evenodd" /></svg>
            </button>
          ))}
          {ready && <button className="btn small" onClick={() => patch({ unit: [], layers: [] })}><Icon name="refresh" size={14} /> Clear</button>}
        </div>

        <Row label={puller ? 'Length' : 'Size'}><LenInput units={units} label={puller ? 'Puller length' : 'Size across'} value={d.size} min={0.5} max={puller ? 6 : 5} onChange={setSize} /></Row>
        {d.type === 'button' && (
          <div className="frow stack">
            <span className="lbl">Holes</span>
            <Seg label="Holes" value={String(d.holes)} onChange={(v) => patch({ holes: v === 'shank' ? 'shank' : (Number(v) as 0 | 2 | 4) })}
              options={[{ id: '0', label: 'None' }, { id: '2', label: '2 holes' }, { id: '4', label: '4 holes' }, { id: 'shank', label: 'Shank' }]} />
          </div>
        )}
        <FinishPick value={d.finish} onChange={(finish) => patch({ finish, color: undefined })} />
        <div className="frow stack">
          <span className="lbl">Or a plastic colour {d.color && <button className="btn small inline" onClick={() => patch({ color: undefined })}>Use metal</button>}</span>
          <ColorField label="Plastic colour" value={d.color ?? ''} onChange={(color) => patch({ color })} />
        </div>
        <SheenPick metal value={d.sheen} onChange={(sheen) => patch({ sheen })} />
        <EmblemEditor att={synth} layers={d.layers} onLayers={(layers) => patch({ layers })} fill="var(--fill-2)" sectionId="draw-layers" title="Engraving and artwork" />

        <div className="flow-actions">
          <span className="spacer" />
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn primary" disabled={!ready} onClick={() => onDone(d)}>{doneLabel}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
