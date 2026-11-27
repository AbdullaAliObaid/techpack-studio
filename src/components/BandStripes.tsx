// Bands drawn on one piece of the 2D chart, in the piece's own coordinates, clipped to its outline.
// In the Paint workspace (Bands) a band can be dragged up or down to set its distance, and the edges between stripes dragged to
// change their heights. Distances snap to whole cm and to the edges of other bands, and show live.
import { useRef, useState } from 'react';
import { useStore } from '../store';
import { bandRanges } from './designDoc';
import type { Band } from '../data/edits';
import type { Piece } from '../data/presets';

const SNAP = 0.4;

export default function BandStripes({ piece, d, id }: { piece: Piece; d: string; id: string }) {
  const bands = useStore((s) => s.project.edits?.bands);
  const live = useStore((s) => s.workspace === 'paint' && s.paintTab === 'bands');
  const selBand = useStore((s) => s.selBand);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const drag = useRef<{ kind: 'move' | 'edge'; band: Band; edge: number; y0: number; moved: boolean } | null>(null);
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
  const start = (e: React.PointerEvent, b: Band, kind: 'move' | 'edge', edge = 0) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    useStore.setState({ selBand: b.id });
    drag.current = { kind, band: b, edge, y0: local(e).y, moved: false };
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current;
    if (!g) return;
    const st = useStore.getState();
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
    <g pointerEvents={live ? undefined : 'none'} aria-hidden="true">
      <clipPath id={cid}><path d={d} /></clipPath>
      <g clipPath={`url(#${cid})`}>
        {out.map(({ b, r }) => (
          <g key={b.id} onPointerDown={live ? (e) => start(e, b, 'move') : undefined} onPointerMove={live ? move : undefined} onPointerUp={live ? end : undefined} onPointerCancel={live ? end : undefined}
            style={live ? { cursor: 'ns-resize', touchAction: 'none' } : undefined} data-kind={live ? 'band' : undefined} data-band={b.id}>
            {r.map((s, i) => <rect key={i} x={x0} y={s.y0} width={w} height={s.y1 - s.y0} fill={s.color} opacity={0.95} />)}
            {live && selBand === b.id && <rect x={x0} y={r[0].y0} width={w} height={r[r.length - 1].y1 - r[0].y0} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
            {live && selBand === b.id && r.map((s, i) => (
              <rect key={`h${i}`} x={x0} y={s.y1 - 0.45} width={w} height={0.9} fill="transparent" style={{ cursor: 'row-resize' }}
                onPointerDown={(e) => start(e, b, 'edge', i)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
            ))}
          </g>
        ))}
      </g>
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
