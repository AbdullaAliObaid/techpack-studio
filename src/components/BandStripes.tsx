// Bands drawn on one piece of the 2D chart, in the piece's own coordinates, clipped to its outline.
// In the Paint workspace (Bands) a band can be dragged up or down to set its distance, and the edges between stripes dragged to
// change their heights. Distances snap to whole cm and to the edges of other bands, and show live.
import { useRef, useState } from 'react';
import { useStore } from '../store';
import { bandRanges } from './designDoc';
import { clampBandAngle, stripeCorners } from '../data/bandGeom';
import type { Band } from '../data/edits';
import type { Piece } from '../data/presets';

const SNAP = 0.4;

export default function BandStripes({ piece, d, id }: { piece: Piece; d: string; id: string }) {
  const bands = useStore((s) => s.project.edits?.bands);
  const live = useStore((s) => s.workspace === 'paint' && s.paintTab === 'bands');
  const selBand = useStore((s) => s.selBand);
  // Shape and Seams edit the pattern itself: the bands stay as a faint guide there and never take a click
  const faint = useStore((s) => s.workspace === 'shape' || s.workspace === 'seams');
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<{ kind: 'move' | 'edge' | 'tilt'; band: Band; edge: number; y0: number; moved: boolean; sign?: number; cy?: number } | null>(null);
  if (!bands?.length) return null;
  const xs = piece.points.map((p) => p.x);
  const x0 = Math.min(...xs) - 2, w = Math.max(...xs) - x0 + 2;
  const out = bands.flatMap((b) => { const r = bandRanges(b, piece); return r ? [{ b, r }] : []; });
  if (!out.length) return null;
  const cid = `bandclip-${id}`;

  /** pointer in this piece's own coordinates (cm), whatever the chart zoom and offset */
  const local = (e: React.PointerEvent) => {
    const el = e.currentTarget as SVGGraphicsElement;
    const ctm = el.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };
  const total = (b: Band) => b.stripes.reduce((s, q) => s + q.height, 0);
  const start = (e: React.PointerEvent, b: Band, kind: 'move' | 'edge' | 'tilt', edge = 0, extra: { sign?: number; cy?: number } = {}) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    useStore.setState({ selBand: b.id });
    drag.current = { kind, band: b, edge, y0: local(e).y, moved: false, ...extra };
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const st = useStore.getState();
    if (g.kind === 'tilt') {
      // the handle sits at the piece's right edge: the angle of the line from the centre line to the pointer
      const q = local(e);
      const dx = q.x, dyc = q.y - (g.cy ?? 0);
      let deg = (Math.atan2(dx >= 0 ? dyc : -dyc, Math.abs(dx) < 0.01 ? 0.01 : Math.abs(dx)) * 180) / Math.PI * (g.sign ?? 1);
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      deg = Math.round(clampBandAngle(deg));
      if (!g.moved) { st.commit(); g.moved = true; }
      st.updateBand(g.band.id, { angle: deg });
      setTip({ x: e.clientX, y: e.clientY, text: `Angle ${deg}°` });
      return;
    }
    const dy = local(e).y - g.y0;
    if (!g.moved) { if (Math.abs(dy) < 0.15) return; st.commit(); g.moved = true; }
    const b = g.band;
    if (g.kind === 'move') {
      let off = Math.round(b.offset + (b.from === 'hem' ? -dy : dy));
      // snap to the edges of the other bands (top to top, top to bottom, bottom to top)
      const mine = total(b);
      for (const o of bands) {
        if (o.id === b.id || o.from !== b.from) continue;
        const ot = total(o);
        for (const c of [o.offset, o.offset + ot, o.offset - mine, o.offset + ot - mine]) if (Math.abs(off - c) < SNAP) off = c;
      }
      off = Math.max(0, Math.min(120, off));
      st.updateBand(b.id, { offset: off });
      setTip({ x: e.clientX, y: e.clientY, text: `${off} cm from ${b.from}` });
    } else {
      const i = g.edge;
      const s = b.stripes;
      const last = i === s.length - 1;
      const h = Math.max(0.2, Math.round((s[i].height + dy) * 10) / 10);
      const delta = h - s[i].height;
      const next = s.map((q, j) => (j === i ? { ...q, height: h } : !last && j === i + 1 ? { ...q, height: Math.max(0.2, Math.round((q.height - delta) * 10) / 10) } : q));
      st.updateBand(b.id, { stripes: next });
      setTip({ x: e.clientX, y: e.clientY, text: `Stripe ${i + 1}: ${h} cm` });
    }
    drag.current = { ...g, band: useStore.getState().project.edits?.bands?.find((q) => q.id === b.id) ?? b, y0: local(e).y };
  };
  const end = () => { drag.current = null; setTip(null); };

  return (
    <g pointerEvents={live ? undefined : 'none'} aria-hidden="true" opacity={faint ? 0.22 : undefined}>
      <clipPath id={cid}><path d={d} /></clipPath>
      <g clipPath={`url(#${cid})`}>
        {out.map(({ b, r }) => (
          <g key={b.id} onPointerDown={live ? (e) => start(e, b, 'move') : undefined} onPointerMove={live ? move : undefined} onPointerUp={live ? end : undefined} onPointerCancel={live ? end : undefined}
            style={live ? { cursor: 'ns-resize', touchAction: 'none' } : undefined} data-kind={live ? 'band' : undefined} data-band={b.id}>
            {r.map((s, i) => <polygon key={i} points={stripeCorners(s, x0, x0 + w).map((c) => c.join(',')).join(' ')} fill={s.color} opacity={0.95} />)}
            {live && selBand === b.id && <polygon points={[...stripeCorners(r[0], x0, x0 + w).slice(0, 2), ...stripeCorners(r[r.length - 1], x0, x0 + w).slice(2)].map((c) => c.join(',')).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {live && selBand === b.id && r.map((s, i) => (
              <polygon key={`h${i}`} points={stripeCorners({ y0: s.y1 - 0.45, y1: s.y1 + 0.45, slope: s.slope }, x0, x0 + w).map((c) => c.join(',')).join(' ')} fill="transparent" style={{ cursor: 'row-resize' }}
                onPointerDown={(e) => start(e, b, 'edge', i)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
            ))}
          </g>
        ))}
      </g>
      {live && out.filter(({ b }) => b.id === selBand).map(({ b, r }) => {
        // the tilt handle: at the right edge of the piece on the band's centre line
        const m = r[0].slope ?? 0, mid = (r[0].y0 + r[r.length - 1].y1) / 2, xr = x0 + w - 1.4;
        const sign = piece.role === 'back' ? -1 : 1;
        return (
          <g key={`tilt${b.id}`} data-handle="band-tilt">
            <line x1={xr - 6} y1={mid + m * (xr - 6)} x2={xr} y2={mid + m * xr} stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />
            <circle cx={xr} cy={mid + m * xr} r={0.9} fill="var(--bg-elevated)" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle cx={xr} cy={mid + m * xr} r={1.9} fill="transparent" style={{ cursor: 'grab', touchAction: 'none' }} role="presentation"
              onPointerDown={(e) => start(e, b, 'tilt', 0, { sign, cy: mid })} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><title>Drag to tilt the band. Shift snaps to 15 degrees.</title></circle>
          </g>
        );
      })}
      {tip && <BandTip tip={tip} />}
    </g>
  );
}

/** the live distance, drawn in a fixed layer so it follows the pointer whatever the chart zoom */
function BandTip({ tip }: { tip: { x: number; y: number; text: string } }) {
  return <TipPortal tip={tip} />;
}
import { createPortal } from 'react-dom';
function TipPortal({ tip }: { tip: { x: number; y: number; text: string } }) {
  return createPortal(<div className="band-tip material" role="status" style={{ left: tip.x + 14, top: tip.y - 36 }}>{tip.text}</div>, document.body);
}
