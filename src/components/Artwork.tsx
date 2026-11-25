import { SHAPES, OUTLINES, outlinePolygon } from '../lib/shapes';
import type { Attachment, ShapeLayer } from '../data/edits';
import { polyD } from '../lib/geometry';

/** One emblem layer, in attachment-centred cm. */
export function LayerShape({ l, pointer = true, ...rest }: { l: ShapeLayer; pointer?: boolean } & React.SVGProps<SVGGElement>) {
  const op = l.opacity ?? 1;
  if (op <= 0 && pointer === false) return null;
  const flip = l.flipX ? -1 : 1;
  return (
    <g transform={`translate(${l.x},${l.y}) rotate(${l.rotation})`} opacity={op} {...rest}>
      {l.shape === 'text' ? (
        <text x={0} y={0} fontSize={l.h} textLength={l.w} lengthAdjust="spacingAndGlyphs" textAnchor="middle" dominantBaseline="central" fill={l.color} fontWeight={700} transform={`scale(${flip},1)`} style={{ fontFamily: 'var(--font)' }}>
          {l.text ?? ''}
        </text>
      ) : (
        <path d={SHAPES[l.shape].d} transform={`scale(${l.w * flip},${l.h})`} fill={l.color} fillRule="evenodd" />
      )}
    </g>
  );
}

export function outlineD(a: Pick<Attachment, 'outline' | 'w' | 'h' | 'points'>): { d: string; transform?: string } {
  if (a.outline === 'custom' && a.points?.length) return { d: polyD(a.points) };
  const o = a.outline === 'custom' ? 'rect' : a.outline;
  return { d: OUTLINES[o], transform: `scale(${a.w},${a.h})` };
}

export function outlinePoly(a: Pick<Attachment, 'outline' | 'w' | 'h' | 'points'>) {
  return outlinePolygon(a.outline, a.w, a.h, a.points);
}

/** The attachment outline filled with its fabric and the emblem layers on top. */
export function ArtworkGroup({ a, fill, layers = true }: { a: Attachment | (Omit<Attachment, 'id' | 'pieceId' | 'x' | 'y'>); fill?: string; layers?: boolean }) {
  const o = outlineD(a);
  return (
    <>
      {a.kind !== 'print' && fill && <path d={o.d} transform={o.transform} fill={fill} />}
      {layers && a.layers.map((l) => <LayerShape key={l.id} l={l} pointer={false} />)}
    </>
  );
}
