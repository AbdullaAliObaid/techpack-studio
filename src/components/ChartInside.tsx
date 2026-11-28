// What the chart draws for fabric and for the inside (wrong side) view.
//  FabricDefs   the fills: outside and inside cloth of every piece, with patterns repeated at their real size (chart
//               units are cm, so a 4 cm repeat is 4 units).
//  InsideDecor  one piece seen from behind: wrong side shading, seam allowance, overlocked edges, topstitch showing
//               as bobbin thread, fusible interfacing on collars and plackets, the facing along a buttoned front.
import { fabricById, type FabricPattern } from '../data/fabrics';
import type { Piece, PieceFabric } from '../data/presets';
import { styleById, type StyleId } from '../data/catalog';
import { offsetInward, polyD } from '../lib/geometry';
import { fabricDataUrl } from '../lib/textures';
import { fabricHex, patternTile } from './editHelpers';
import type { Geo } from './chartLayout';
import type { Entry } from './sides';

const tileHref = (p: FabricPattern) => { const t = patternTile(p); return { href: `data:image/svg+xml;utf8,${encodeURIComponent(t.svg)}`, w: t.size[0], h: t.size[1] }; };

/** the cloth of one face: weave texture, pattern on top when there is one */
function cloth(id: string, fb: PieceFabric, withPattern: boolean, lead = '') {
  const f = fabricById(fb.id);
  const tex = fabricDataUrl(f, fabricHex(fb));
  const pat = withPattern && fb.pattern && fb.pattern.id !== 'solid' ? fb.pattern : null;
  if (!pat) {
    return (
      <pattern key={id} id={id} width="6" height="6" patternUnits="userSpaceOnUse">
        <image href={tex} width="6" height="6" preserveAspectRatio="none" />
      </pattern>
    );
  }
  const t = tileHref(pat);
  return (
    <pattern key={id} id={id} width={t.w} height={t.h} patternUnits="userSpaceOnUse" patternTransform={`${lead}${lead ? ' ' : ''}rotate(${pat.rotation || 0})`}>
      {/* the weave under the pattern, tiled in 6 cm squares */}
      {Array.from({ length: Math.ceil(t.w / 6) * Math.ceil(t.h / 6) }, (_, i) => {
        const nx = Math.ceil(t.w / 6);
        return <image key={i} href={tex} x={(i % nx) * 6} y={Math.floor(i / nx) * 6} width="6" height="6" preserveAspectRatio="none" />;
      })}
      <image href={t.href} width={t.w} height={t.h} preserveAspectRatio="none" style={{ mixBlendMode: 'multiply' }} />
    </pattern>
  );
}

/**
 * The cloth of a pocket, patch or applique as an SVG fill (`attfab-<id>`), drawn like the piece cloth. `align` lays the
 * pattern out in the host piece's frame (the attachment's position and turn on it) so the body's repeat continues.
 */
export function AttachmentCloth({ id, fabric, align }: { id: string; fabric: PieceFabric; align?: { x: number; y: number; rotation: number } }) {
  return <defs>{cloth('attfab-' + id, fabric, true, align ? `rotate(${-align.rotation}) translate(${-align.x} ${-align.y})` : '')}</defs>;
}

/** outside fill `fab-<piece>` and inside fill `fab-in-<piece>` for every piece */
export function FabricDefs({ pieces, inside }: { pieces: Piece[]; inside?: Record<string, PieceFabric> }) {
  return (
    <>
      {pieces.map((p) => {
        const own = inside?.[p.id];
        // a printed pattern stays on the outside; a woven one runs through, so the wrong side shows it too
        const behind: PieceFabric = own ?? { ...p.fabric, pattern: p.fabric.pattern?.method === 'woven' ? p.fabric.pattern : undefined };
        return [cloth('fab-' + p.id, p.fabric, true), cloth('fab-in-' + p.id, behind, true)];
      })}
      <pattern id="interfacing" width="0.9" height="0.9" patternUnits="userSpaceOnUse"><circle cx="0.45" cy="0.45" r="0.14" fill="var(--interfacing)" /></pattern>
    </>
  );
}

const lighten = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${100 - pct}%, white)`;

/** roles that carry fusible interfacing on the wrong side */
const FUSED = new Set(['collar', 'cuff', 'waistband', 'placket', 'neckband', 'brim']);

export function InsideDecor({ entry, geo, k, style, ownInside }: { entry: Entry; geo: Geo; k: number; style: StyleId; ownInside: boolean }) {
  const px = (n: number) => n / k;
  const p = entry.piece;
  const det = styleById(style)?.details ?? {};
  const hex = fabricHex(p.fabric);
  const thread = lighten(hex, 45);
  const ts = det.topstitch;
  const tsColor = ts ? (ts.color === 'match' ? lighten(hex, 30) : ts.color) : null;
  const off = ts?.offset ?? 0.5;
  const rings = ts ? [off, ...(ts.needles === 2 ? [off + 0.38] : [])] : [];
  const poly = geo.poly;
  const fused = FUSED.has(p.role);
  const facing = p.role === 'front' && !!det.buttons;
  const id = `in-${entry.key.replace(/[^a-z0-9]/gi, '')}`;
  const fusedPath = fused ? polyD(offsetInward(poly, 0.8)) : null;
  return (
    <g pointerEvents="none" className="inside-decor">
      {/* seam allowance: the extra cloth round the sewing line, seen from behind */}
      <path d={`${geo.cut}${geo.d}`} fillRule="evenodd" fill={`url(#fab-in-${p.id})`} opacity={0.55} />
      <path d={`${geo.cut}${geo.d}`} fillRule="evenodd" fill="var(--inside-shade)" />
      {/* wrong side of the cloth is a little darker unless it has a cloth of its own */}
      {!ownInside && <path d={geo.d} fill="var(--inside-shade)" />}
      {/* facing along a buttoned front: folded back, fused */}
      {facing && (
        <>
          <clipPath id={id}><path d={geo.d} /></clipPath>
          <g clipPath={`url(#${id})`}>
            <rect x={-3.4} y={geo.bb.minY - 1} width={6.8} height={geo.bb.h + 2} fill="var(--inside-facing)" />
            <rect x={-3.4} y={geo.bb.minY - 1} width={6.8} height={geo.bb.h + 2} fill="url(#interfacing)" />
            <line x1={-3.4} x2={-3.4} y1={geo.bb.minY - 1} y2={geo.bb.maxY + 1} stroke={thread} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(3)}`} />
            <line x1={3.4} x2={3.4} y1={geo.bb.minY - 1} y2={geo.bb.maxY + 1} stroke={thread} strokeWidth={px(1)} strokeDasharray={`${px(5)} ${px(3)}`} />
          </g>
        </>
      )}
      {/* fusible interfacing, a little smaller than the piece, dotted with glue */}
      {fusedPath && (
        <>
          <path d={fusedPath} fill="var(--inside-facing)" />
          <path d={fusedPath} fill="url(#interfacing)" />
          <path d={fusedPath} fill="none" stroke="var(--interfacing)" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(3)}`} />
        </>
      )}
      {/* topstitch shows from behind as the bobbin thread */}
      {tsColor && rings.map((o, i) => <path key={i} d={polyD(offsetInward(poly, o))} fill="none" stroke={tsColor} strokeWidth={px(1.3)} strokeDasharray={`0.28 0.14`} strokeLinecap="round" opacity={0.9} />)}
      {/* overlocked (serged) cut edge: looped thread over the raw edge */}
      <path d={geo.cut} fill="none" stroke={thread} strokeWidth={px(3.4)} strokeLinejoin="round" opacity={0.85} />
      <path d={geo.cut} fill="none" stroke="var(--inside-loop)" strokeWidth={px(3.4)} strokeDasharray={`${px(1.4)} ${px(1.8)}`} strokeLinejoin="round" />
      <path d={geo.cut} fill="none" stroke={thread} strokeWidth={px(0.9)} />
    </g>
  );
}

/** Small key shown over the chart while it is turned inside out. */
export function InsideLegend() {
  const items = [
    ['serge', 'Overlocked edge'],
    ['stitch', 'Topstitch from behind'],
    ['fuse', 'Fusible interfacing'],
    ['allow', 'Seam allowance'],
  ];
  return (
    <ul className="inside-legend" aria-label="What the inside view shows">
      {items.map(([k, t]) => <li key={k}><i className={`lg-${k}`} aria-hidden="true" />{t}</li>)}
    </ul>
  );
}
