// Marquee, snap guides and the selection chip. The marquee and the guides change on every pointer frame, so they live
// in a tiny external store: only these layers redraw while dragging, not the whole chart.
import { memo, useSyncExternalStore } from 'react';
import type { Guide } from './snap';

export interface OverlayState {
  guides: Guide[];
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** a short note next to the dragged point (the angle when Shift snaps it) */
  tip: { x: number; y: number; text: string } | null;
}
const EMPTY: OverlayState = { guides: [], marquee: null, tip: null };
let state = EMPTY;
const subs = new Set<() => void>();
export const overlay = {
  get: () => state,
  set(p: Partial<OverlayState>) { state = { ...state, ...p }; subs.forEach((f) => f()); },
  clear() { if (state !== EMPTY) { state = EMPTY; subs.forEach((f) => f()); } },
  sub(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};
const useOverlay = () => useSyncExternalStore(overlay.sub, overlay.get);

/** thin accent lines where the drag lines up, each with a small label */
export const GuideLayer = memo(function GuideLayer({ k }: { k: number }) {
  const { guides, tip } = useOverlay();
  const px = (n: number) => n / k;
  if (!guides.length && !tip) return null;
  return (
    <g pointerEvents="none">
      {guides.map((g, i) => {
        const pad = px(14);
        const [x1, y1, x2, y2] = g.axis === 'x' ? [g.at, g.a - pad, g.at, g.b + pad] : [g.a - pad, g.at, g.b + pad, g.at];
        const lx = g.axis === 'x' ? g.at + px(6) : g.b + pad + px(4);
        const ly = g.axis === 'x' ? g.a - pad - px(4) : g.at - px(6);
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--accent)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
            <text x={lx} y={ly} className="edge-len guide-label" strokeWidth={px(3)} fontSize={px(11)} textAnchor="start">{g.label}</text>
          </g>
        );
      })}
      {tip && <text x={tip.x + px(12)} y={tip.y - px(12)} className="edge-len guide-label" strokeWidth={px(3)} fontSize={px(11)}>{tip.text}</text>}
    </g>
  );
});

/** the rubber band: alpha fill, accent hairline */
export const MarqueeLayer = memo(function MarqueeLayer({ k }: { k: number }) {
  const { marquee: m } = useOverlay();
  if (!m) return null;
  const x = Math.min(m.x0, m.x1), y = Math.min(m.y0, m.y1);
  return <rect x={x} y={y} width={Math.abs(m.x1 - m.x0)} height={Math.abs(m.y1 - m.y0)} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth={1 / k} pointerEvents="none" className="marquee" />;
});

/** a hairline box around the selection with a count chip: "6 points" */
export function SelectionChip({ box, count, k }: { box: { x: number; y: number; w: number; h: number }; count: number; k: number }) {
  const px = (n: number) => n / k;
  const text = `${count} points`;
  const w = text.length * 6.4 + 16, h = 20;
  const x = box.x + box.w - px(w) / 2, y = box.y - px(h + 10);
  return (
    <g pointerEvents="none" className="sel-chip">
      <rect x={box.x - px(8)} y={box.y - px(8)} width={box.w + px(16)} height={box.h + px(16)} fill="none" stroke="var(--accent)" strokeWidth={px(1)} strokeDasharray={`${px(3)} ${px(3)}`} opacity={0.7} rx={px(4)} />
      <g transform={`translate(${x},${y})`}>
        <rect width={px(w)} height={px(h)} rx={px(h / 2)} fill="var(--accent)" />
        <text x={px(w) / 2} y={px(h) / 2} fontSize={px(11)} fill="var(--on-accent)" textAnchor="middle" dominantBaseline="central" fontWeight={600}>{text}</text>
      </g>
    </g>
  );
}
