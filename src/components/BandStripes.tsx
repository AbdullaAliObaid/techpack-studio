// Bands drawn on one piece of the 2D chart, in the piece's own coordinates, clipped to its outline.
import { useStore } from '../store';
import { bandRanges } from './designDoc';
import type { Piece } from '../data/presets';

export default function BandStripes({ piece, d, id }: { piece: Piece; d: string; id: string }) {
  const bands = useStore((s) => s.project.edits?.bands);
  if (!bands?.length) return null;
  const xs = piece.points.map((p) => p.x);
  const x0 = Math.min(...xs) - 2, w = Math.max(...xs) - x0 + 2;
  const out = bands.flatMap((b) => { const r = bandRanges(b, piece); return r ? [{ b, r }] : []; });
  if (!out.length) return null;
  const cid = `bandclip-${id}`;
  return (
    <g pointerEvents="none" aria-hidden="true">
      <clipPath id={cid}><path d={d} /></clipPath>
      <g clipPath={`url(#${cid})`}>
        {out.map(({ b, r }) => r.map((s, i) => <rect key={`${b.id}-${i}`} x={x0} y={s.y0} width={w} height={s.y1 - s.y0} fill={s.color} opacity={0.95} />))}
      </g>
    </g>
  );
}
