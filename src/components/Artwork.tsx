import { SHAPES, OUTLINES, outlinePolygon, attachmentShapes } from '../lib/shapes';
import { fontOf } from '../three/detailsArt';
import { cleanText } from '../lib/fonts';
import type { Attachment, Finish, Hardware, ShapeLayer, ZipperDesign } from '../data/edits';
import { polyD } from '../lib/geometry';
import { buttonholeSlots } from '../data/construction';

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

/** Surface highlights shared by every drawn trim, tag and cloth panel. Fixed ids: every copy is identical. */
export function SheenDefs() {
  return (
    <defs>
      <linearGradient id="shn-satin" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.26" /><stop offset="0.55" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.12" /></linearGradient>
      <linearGradient id="shn-glossy" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.7" /><stop offset="0.42" stopColor="#fff" stopOpacity="0.08" /><stop offset="0.5" stopColor="#000" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity="0.22" /></linearGradient>
      <linearGradient id="shn-metallic" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity="0.6" /><stop offset="0.3" stopColor="#000" stopOpacity="0.28" /><stop offset="0.55" stopColor="#fff" stopOpacity="0.5" /><stop offset="1" stopColor="#000" stopOpacity="0.34" /></linearGradient>
    </defs>
  );
}
const sheenFill = (s?: string) => (s === 'satin' || s === 'glossy' || s === 'metallic' ? `url(#shn-${s})` : null);

/** Plastic or dyed colours: a base with a darker edge and a lighter spot. */
const shade = (hex: string, to: 'black' | 'white', pct: number) => `color-mix(in srgb, ${hex} ${100 - pct}%, ${to})`;

interface Tone { base: string; dark: string; light: string }
function toneOf(hw: Hardware): Tone {
  if (hw.color) return { base: hw.color, dark: shade(hw.color, 'black', 40), light: shade(hw.color, 'white', 55) };
  const f = FINISH[hw.finish] ?? FINISH.silver;
  return { base: f.base, dark: f.dark, light: f.light };
}

export const DEFAULT_ZIPPER: ZipperDesign = { teeth: 'metal', tape: '#3a3a3f', puller: 'standard' };

function Puller({ z, tone, x, y, tw }: { z: ZipperDesign; tone: Tone; x: number; y: number; tw: number }) {
  const body = <rect x={-tw * 0.3} y={-0.5} width={tw * 0.6} height={1} rx={tw * 0.14} fill={tone.base} stroke={tone.dark} strokeWidth={0.06} />;
  const tab = (() => {
    switch (z.puller) {
      case 'ring': return <g><path d="M0 0.4V1" stroke={tone.dark} strokeWidth={0.1} /><circle cy={1.75} r={0.75} fill="none" stroke={tone.base} strokeWidth={0.22} /><circle cy={1.75} r={0.75} fill="none" stroke={tone.dark} strokeWidth={0.04} /></g>;
      case 'tab': return <rect x={-tw * 0.26} y={0.4} width={tw * 0.52} height={2.4} rx={0.25} fill={tone.base} stroke={tone.dark} strokeWidth={0.06} />;
      case 'cord': return <g><path d="M0 0.4C0.9 1.2 -0.9 2 0 2.8" fill="none" stroke={tone.dark} strokeWidth={0.16} strokeLinecap="round" /><circle cy={3} r={0.32} fill={tone.base} stroke={tone.dark} strokeWidth={0.05} /></g>;
      case 'custom': {
        const o = z.pullerOutline;
        return (
          <g transform="translate(0,1.6)">
            {o && o.length >= 3 ? <path d={polyD(o)} fill={tone.base} stroke={tone.dark} strokeWidth={0.06} strokeLinejoin="round" /> : <circle r={0.6} fill={tone.base} stroke={tone.dark} strokeWidth={0.06} />}
            {(z.pullerLayers ?? []).map((l) => <LayerShape key={l.id} l={l} pointer={false} />)}
          </g>
        );
      }
      default: return <path d={`M${-tw * 0.18} 0.45h${tw * 0.36}v1.5l${-tw * 0.18} 0.6l${-tw * 0.18} -0.6z`} fill={tone.base} stroke={tone.dark} strokeWidth={0.06} strokeLinejoin="round" />;
    }
  })();
  return <g transform={`translate(${x},${y})`}>{tab}{body}</g>;
}

function Zipper({ hw, w, h }: { hw: Hardware; w: number; h: number }) {
  const z = hw.zipper ?? DEFAULT_ZIPPER;
  const metal = hw.zipper?.teeth !== 'coil' && hw.zipper?.teeth !== 'molded';
  const tone: Tone = z.teeth === 'metal' || !z.teethColor ? toneOf(hw) : { base: z.teethColor, dark: shade(z.teethColor, 'black', 40), light: shade(z.teethColor, 'white', 55) };
  const tw = Math.max(0.6, w), L = Math.max(2, h);
  const step = z.teeth === 'coil' ? 0.3 : z.teeth === 'molded' ? 0.5 : 0.55;
  const gap = hw.open ? L * 0.38 : 0;
  const teeth: number[] = [];
  for (let y = -L / 2 + 0.7; y < L / 2 - 0.3; y += step) teeth.push(y);
  const sheen = sheenFill(hw.sheen);
  const tooth = (y: number, i: number, openSide: boolean) => {
    const left = openSide ? false : i % 2 === 0;
    if (z.teeth === 'coil') return <rect key={i} x={left ? -tw * 0.42 : -tw * 0.02} y={y} width={tw * 0.44} height={0.2} rx={0.1} fill={tone.base} stroke={tone.dark} strokeWidth={0.025} />;
    if (z.teeth === 'molded') return <rect key={i} x={left ? -tw * 0.36 : tw * 0.02} y={y} width={tw * 0.34} height={0.4} rx={0.07} fill={tone.base} />;
    return <rect key={i} x={left ? -tw * 0.4 : -tw * 0.05} y={y} width={tw * 0.45} height={0.3} fill={tone.base} stroke={tone.dark} strokeWidth={0.03} />;
  };
  return (
    <g>
      <rect x={-tw / 2} y={-L / 2} width={tw} height={L} rx={tw * 0.08} fill={z.tape} />
      <rect x={-tw / 2} y={-L / 2} width={tw} height={L} rx={tw * 0.08} fill="none" stroke="#000" strokeOpacity={0.25} strokeWidth={0.05} />
      {teeth.map((y, i) => {
        const open = y > L / 2 - gap - 0.4;
        if (!open) return tooth(y, i, false);
        return <g key={i}><rect x={-tw * 0.4} y={y} width={tw * 0.32} height={0.3} fill={tone.base} /><rect x={tw * 0.08} y={y + (i % 2 ? 0.2 : 0)} width={tw * 0.32} height={0.3} fill={tone.base} /></g>;
      })}
      {metal && sheen && <rect x={-tw * 0.42} y={-L / 2 + 0.6} width={tw * 0.84} height={L - 0.9} fill={sheen} pointerEvents="none" />}
      <Puller z={z} tone={toneOf(hw.zipper?.pullerFinish ? { ...hw, finish: hw.zipper.pullerFinish, color: undefined } : hw)} x={0} y={-L / 2 - 0.1} tw={tw} />
    </g>
  );
}

/** One trim of diameter d, centred on 0,0 (cm). Zipper uses tape width w and length h. */
export function HardwareMark({ hw, w, h }: { hw: Hardware; w: number; h: number }) {
  if (hw.type === 'zipper') return <Zipper hw={hw} w={w} h={h} />;
  const tone = toneOf(hw);
  const d = hw.size;
  const r = d / 2;
  const sw = Math.max(0.04, r * 0.14);
  const sheen = sheenFill(hw.sheen);
  const holes = hw.holes ?? (hw.type === 'button' ? 4 : 0);
  const layers = (hw.layers ?? []).map((l) => <LayerShape key={l.id} l={l} pointer={false} />);
  const holeMarks = holes === 2 || holes === 4
    ? (holes === 2 ? [[-1, 0], [1, 0]] : [[-1, -1], [1, -1], [-1, 1], [1, 1]]).map(([x, y], i) => <circle key={i} cx={x * r * (holes === 2 ? 0.26 : 0.22)} cy={y * r * 0.22} r={r * 0.11} fill={tone.dark} />)
    : holes === 'shank' ? <circle cy={r * 0.12} r={r * 0.14} fill="none" stroke={tone.dark} strokeWidth={sw * 0.7} strokeDasharray={`${r * 0.1} ${r * 0.08}`} /> : null;
  // a drawn outline replaces the round shape
  if (hw.outline && hw.outline.length >= 3) {
    const rim = hw.outline.map((p) => ({ x: p.x * 0.74, y: p.y * 0.74 }));
    return (
      <g>
        <path d={polyD(hw.outline)} fill={tone.base} stroke={tone.dark} strokeWidth={sw} strokeLinejoin="round" />
        {hw.type !== 'rivet' && <path d={polyD(rim)} fill="none" stroke={tone.dark} strokeWidth={sw * 0.7} strokeLinejoin="round" />}
        {holeMarks}
        {layers}
        {sheen && <path d={polyD(hw.outline)} fill={sheen} pointerEvents="none" />}
      </g>
    );
  }
  const body = <circle r={r} fill={tone.base} stroke={tone.dark} strokeWidth={sw} />;
  const shine = sheen ? <circle r={r} fill={sheen} pointerEvents="none" /> : null;
  switch (hw.type) {
    case 'eyelet':
      return <g>{body}<circle r={r * 0.5} fill="#000" opacity={0.6} /><circle r={r * 0.5} fill="none" stroke={tone.dark} strokeWidth={sw * 0.8} />{shine}</g>;
    case 'stud':
      return <g>{body}<circle r={r * 0.62} fill="none" stroke={tone.dark} strokeWidth={sw * 0.8} /><circle cx={-r * 0.2} cy={-r * 0.2} r={r * 0.22} fill={tone.light} opacity={0.85} />{layers}{shine}</g>;
    case 'button':
      return <g>{body}<circle r={r * 0.72} fill="none" stroke={tone.dark} strokeWidth={sw * 0.8} />{holeMarks}{layers}{shine}</g>;
    case 'snap':
      return <g>{body}<circle r={r * 0.64} fill="none" stroke={tone.dark} strokeWidth={sw * 0.8} /><circle r={r * 0.28} fill={tone.dark} /><circle cx={-r * 0.35} cy={-r * 0.35} r={r * 0.14} fill={tone.light} opacity={0.8} />{layers}{shine}</g>;
    default: // rivet
      return <g>{body}<circle r={r * 0.55} fill={tone.light} opacity={0.35} /><circle cx={-r * 0.25} cy={-r * 0.25} r={r * 0.2} fill={tone.light} opacity={0.9} />{layers}{shine}</g>;
  }
}

/** All the trims of one hardware attachment: a row of `count`, `spacing` apart along its width. */
export function HardwareRow({ a }: { a: Pick<Attachment, 'hardware' | 'w' | 'h'> & Partial<Pick<Attachment, 'buttonhole' | 'thread'>> }) {
  const hw = a.hardware;
  if (!hw) return null;
  if (a.buttonhole) {
    // buttonholes: the stitched slot of each hole (straight or keyhole), cut line down the middle
    const slots = buttonholeSlots({ hardware: hw, buttonhole: true, x: 0, y: 0, rotation: 0 });
    const ink = a.thread ?? '#3a3a3f';
    return <>{slots.map((sl, i) => <path key={i} d={polyD(sl)} fill="#ffffff" fillOpacity={0.35} stroke={ink} strokeWidth={0.06} strokeLinejoin="round" />)}</>;
  }
  if (hw.type === 'zipper') return <><SheenDefs /><HardwareMark hw={hw} w={a.w} h={a.h} /></>;
  const n = Math.max(1, Math.round(hw.count ?? 1)), sp = hw.spacing ?? hw.size * 2;
  return (
    <>
      <SheenDefs />
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
  if (l.clip?.length) {
    // cut to its outline: clip in the attachment's frame, then draw the layer as usual
    const id = `lc-${l.id}`;
    const { clip: _c, ...bare } = l;
    void _c;
    return (
      <g>
        <clipPath id={id}><path d={l.clip.map((r) => 'M' + r.map((q) => `${q.x} ${q.y}`).join('L') + 'Z').join('')} clipRule="evenodd" /></clipPath>
        <g clipPath={`url(#${id})`}><LayerShape l={bare} pointer={pointer} {...rest} /></g>
      </g>
    );
  }
  const flip = l.flipX ? -1 : 1;
  return (
    <g transform={`translate(${l.x},${l.y}) rotate(${l.rotation})`} opacity={op} {...rest}>
      {l.shape === 'text' ? (
        <text x={0} y={0} fontSize={l.h} textLength={l.w} lengthAdjust="spacingAndGlyphs" textAnchor="middle" dominantBaseline="central" fill={l.color} transform={`scale(${flip},1)`} style={{ font: fontOf(l, l.h) }}>
          {cleanText(l.text)}
        </text>
      ) : l.shape === 'image' && l.image ? (
        <image href={l.image} x={-0.5} y={-0.5} width={1} height={1} preserveAspectRatio="none" transform={`scale(${l.w * flip},${l.h})`} />
      ) : (
        <path d={l.shape === 'path' ? l.path ?? '' : SHAPES[l.shape].d} transform={`scale(${l.w * flip},${l.h})`} fill={l.color} fillRule="evenodd" />
      )}
    </g>
  );
}

/** SVG path (cm, centred) of cut text: every letter's outer edge and counters, to fill evenodd */
function cutLettersD(a: Pick<Attachment, 'kind' | 'outline' | 'w' | 'h' | 'points' | 'shape' | 'text' | 'font' | 'outlineRings' | 'outlineKey'>): string {
  return attachmentShapes(a).flatMap((s) => [s.outer, ...s.holes]).map((r) => polyD(r)).join('');
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
export const isCloth = (k: Attachment['kind']) => k === 'pocket' || k === 'patch' || k === 'strap' || k === 'applique' || k === 'label';

/** The attachment as it looks on the chart: cloth with its stitching, thread, ink or metal. */
export function ArtworkGroup({ a, fill, layers = true }: { a: Art | Attachment; fill?: string; layers?: boolean }) {
  if (a.kind === 'hardware') return <HardwareRow a={a} />;
  const o = outlineD(a);
  const letters = a.outline === 'shape' && a.shape === 'text';
  return (
    <>
      <SheenDefs />
      {isCloth(a.kind) && fill && !letters && <path d={o.d} transform={o.transform} fill={fill} />}
      {isCloth(a.kind) && fill && !letters && sheenFill(a.sheen) && <path d={o.d} transform={o.transform} fill={sheenFill(a.sheen)!} pointerEvents="none" />}
      {isCloth(a.kind) && fill && letters && (
        // the cut letters, traced from the real font, counters left open
        <path d={cutLettersD(a)} fillRule="evenodd" fill={fill} stroke={a.thread ?? 'none'} strokeWidth={1.4} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      )}
      {isCloth(a.kind) && !letters && a.thread && <path d={o.d} transform={o.transform} fill="none" stroke={a.thread} strokeWidth={1.6} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {layers && a.layers.map((l) => <LayerShape key={l.id} l={l} pointer={false} />)}
    </>
  );
}
