import { SHAPES, OUTLINES, outlinePolygon } from '../lib/shapes';
import type { Attachment, Finish, Hardware, ShapeLayer } from '../data/edits';
import { polyD } from '../lib/geometry';

type Art = Omit<Attachment, 'id' | 'pieceId' | 'x' | 'y'>;

/** Metal and plastic finishes. These are the colours of real trims (content), not interface colours. */
export const FINISH: Record<Finish, { name: string; base: string; dark: string; light: string }> = {
  silver: { name: 'Silver', base: '#c3c7cf', dark: '#7d828c', light: '#f4f5f7' },
  brass: { name: 'Brass', base: '#c9a24b', dark: '#876a24', light: '#f1dc9a' },
  copper: { name: 'Copper', base: '#b9714c', dark: '#74402a', light: '#e9b394' },
  gunmetal: { name: 'Gunmetal', base: '#626771', dark: '#2f3238', light: '#9aa0ab' },
  black: { name: 'Black', base: '#26262a', dark: '#09090a', light: '#6b6b73' },
  white: { name: 'White', base: '#f1f1f1', dark: '#a9a9ae', light: '#ffffff' },
};
export const FINISH_IDS = Object.keys(FINISH) as Finish[];

/** One trim of diameter d, centred on 0,0 (cm). Zipper uses tape width w and length h. */
export function HardwareMark({ hw, w, h }: { hw: Hardware; w: number; h: number }) {
  const f = FINISH[hw.finish] ?? FINISH.silver;
  const d = hw.size;
  const r = d / 2;
  const sw = Math.max(0.04, r * 0.14);
  if (hw.type === 'zipper') {
    const tw = Math.max(0.6, w), L = Math.max(2, h);
    const teeth: number[] = [];
    for (let y = -L / 2 + 0.5; y < L / 2 - 0.4; y += 0.55) teeth.push(y);
    const gap = hw.open ? L * 0.38 : 0;
    return (
      <g>
        <rect x={-tw / 2} y={-L / 2} width={tw} height={L} rx={tw * 0.12} fill={f.dark} opacity={0.28} />
        {teeth.map((y, i) => {
          const open = y > L / 2 - gap - 0.4;
          return open
            ? <g key={i}><rect x={-tw * 0.4} y={y} width={tw * 0.3} height={0.3} fill={f.base} /><rect x={tw * 0.1} y={y + (i % 2 ? 0.2 : 0)} width={tw * 0.3} height={0.3} fill={f.base} /></g>
            : <rect key={i} x={i % 2 ? -tw * 0.4 : -tw * 0.05} y={y} width={tw * 0.45} height={0.3} fill={f.base} stroke={f.dark} strokeWidth={0.03} />;
        })}
        <rect x={-tw * 0.32} y={-L / 2 - 0.2} width={tw * 0.64} height={Math.min(1.8, L * 0.2)} rx={tw * 0.16} fill={f.base} stroke={f.dark} strokeWidth={0.06} />
        <circle cx={0} cy={-L / 2 + 0.55} r={tw * 0.1} fill={f.dark} />
      </g>
    );
  }
  const body = <circle r={r} fill={f.base} stroke={f.dark} strokeWidth={sw} />;
  switch (hw.type) {
    case 'eyelet':
      return <g>{body}<circle r={r * 0.5} fill="#000" opacity={0.6} /><circle r={r * 0.5} fill="none" stroke={f.dark} strokeWidth={sw * 0.8} /></g>;
    case 'stud':
      return <g>{body}<circle r={r * 0.62} fill="none" stroke={f.dark} strokeWidth={sw * 0.8} /><circle cx={-r * 0.2} cy={-r * 0.2} r={r * 0.22} fill={f.light} opacity={0.85} /></g>;
    case 'button':
      return <g>{body}<circle r={r * 0.72} fill="none" stroke={f.dark} strokeWidth={sw * 0.8} />{[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y], i) => <circle key={i} cx={x * r * 0.22} cy={y * r * 0.22} r={r * 0.11} fill={f.dark} />)}</g>;
    case 'snap':
      return <g>{body}<circle r={r * 0.64} fill="none" stroke={f.dark} strokeWidth={sw * 0.8} /><circle r={r * 0.28} fill={f.dark} /><circle cx={-r * 0.35} cy={-r * 0.35} r={r * 0.14} fill={f.light} opacity={0.8} /></g>;
    default: // rivet
      return <g>{body}<circle r={r * 0.55} fill={f.light} opacity={0.35} /><circle cx={-r * 0.25} cy={-r * 0.25} r={r * 0.2} fill={f.light} opacity={0.9} /></g>;
  }
}

/** All the trims of one hardware attachment: a row of `count`, `spacing` apart along its width. */
export function HardwareRow({ a }: { a: Pick<Attachment, 'hardware' | 'w' | 'h'> }) {
  const hw = a.hardware;
  if (!hw) return null;
  if (hw.type === 'zipper') return <HardwareMark hw={hw} w={a.w} h={a.h} />;
  const n = Math.max(1, Math.round(hw.count ?? 1)), sp = hw.spacing ?? hw.size * 2;
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <g key={i} transform={`translate(${(i - (n - 1) / 2) * sp},0)`}><HardwareMark hw={hw} w={a.w} h={a.h} /></g>
      ))}
    </>
  );
}

/** One layer, in attachment-centred cm. */
export function LayerShape({ l, pointer = true, ...rest }: { l: ShapeLayer; pointer?: boolean } & React.SVGProps<SVGGElement>) {
  const op = l.opacity ?? 1;
  if (op <= 0 && pointer === false) return null;
  const flip = l.flipX ? -1 : 1;
  return (
    <g transform={`translate(${l.x},${l.y}) rotate(${l.rotation})`} opacity={op} {...rest}>
      {l.shape === 'text' ? (
        <text x={0} y={0} fontSize={l.h} textLength={l.w} lengthAdjust="spacingAndGlyphs" textAnchor="middle" dominantBaseline="central" fill={l.color} fontWeight={800} transform={`scale(${flip},1)`} style={{ fontFamily: 'var(--font)' }}>
          {l.text ?? ''}
        </text>
      ) : (
        <path d={SHAPES[l.shape].d} transform={`scale(${l.w * flip},${l.h})`} fill={l.color} fillRule="evenodd" />
      )}
    </g>
  );
}

export function outlineD(a: Pick<Attachment, 'outline' | 'w' | 'h' | 'points'> & { shape?: Attachment['shape'] }): { d: string; transform?: string } {
  if (a.outline === 'custom' && a.points?.length) return { d: polyD(a.points) };
  if (a.outline === 'shape' && a.shape && SHAPES[a.shape].d) return { d: SHAPES[a.shape].d, transform: `scale(${a.w},${a.h})` };
  const o = a.outline === 'custom' || a.outline === 'shape' ? 'rect' : a.outline;
  return { d: OUTLINES[o], transform: `scale(${a.w},${a.h})` };
}

export function outlinePoly(a: Pick<Attachment, 'outline' | 'w' | 'h' | 'points'>) {
  return outlinePolygon(a.outline, a.w, a.h, a.points);
}

/** Cloth attachments are drawn as cut cloth with a stitch line; the others sit on the host. */
export const isCloth = (k: Attachment['kind']) => k === 'pocket' || k === 'patch' || k === 'strap' || k === 'applique';

/** The attachment as it looks on the chart: cloth with its stitching, thread, ink or metal. */
export function ArtworkGroup({ a, fill, layers = true }: { a: Art | Attachment; fill?: string; layers?: boolean }) {
  if (a.kind === 'hardware') return <HardwareRow a={a} />;
  const o = outlineD(a);
  const letters = a.outline === 'shape' && a.shape === 'text';
  return (
    <>
      {isCloth(a.kind) && fill && !letters && <path d={o.d} transform={o.transform} fill={fill} />}
      {isCloth(a.kind) && fill && letters && (
        <text fontSize={a.h} textLength={a.w} lengthAdjust="spacingAndGlyphs" textAnchor="middle" dominantBaseline="central" fill={fill} fontWeight={800} stroke={a.thread ?? 'none'} strokeWidth={a.h * 0.03} strokeDasharray={`${a.h * 0.08} ${a.h * 0.06}`} style={{ fontFamily: 'var(--font)' }}>{a.text ?? ''}</text>
      )}
      {isCloth(a.kind) && !letters && a.thread && <path d={o.d} transform={o.transform} fill="none" stroke={a.thread} strokeWidth={1.6} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {layers && a.layers.map((l) => <LayerShape key={l.id} l={l} pointer={false} />)}
    </>
  );
}
