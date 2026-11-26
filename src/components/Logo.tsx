import type { Ref } from 'react';

/* The tech-it mark: open scissors cutting along a dotted line.
   Monochrome (currentColor) so it follows light and dark. Geometry is drawn around the pivot at (0,0)
   with the blades pointing right; `Scissors` is shared with the start screen animation. */

type HalfProps = { flip?: boolean; theta: number; heavy?: boolean; gref?: Ref<SVGGElement> };

function Half({ flip, theta, heavy, gref }: HalfProps) {
  const sw = heavy ? 5 : 3.4; // handle stroke
  const edge = heavy ? 7 : 5; // blade back thickness
  const ring = heavy ? { cx: -25, cy: 6, rx: 11.5, ry: 8.5 } : { cx: -26, cy: 5, rx: 10.5, ry: 7.5 };
  // A: blade up, handle down. B is the mirror image, so the pair crosses at the pivot.
  const rot = flip ? theta : -theta;
  return (
    <g ref={gref} transform={`rotate(${rot})`}>
      <g transform={flip ? 'scale(1,-1)' : undefined}>
        <path d={`M0 ${-edge} L45 -0.6 Q46.5 0 45 0.7 L0 0 Z`} fill="currentColor" />
        <path d={`M-1 0.2 L${ring.cx + ring.rx - 0.5} ${ring.cy - 1.2}`} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" fill="none" />
        <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} fill="none" stroke="currentColor" strokeWidth={sw} />
      </g>
    </g>
  );
}

export function Scissors({ theta = 17, heavy = false, detail = false, aRef, bRef }: { theta?: number; heavy?: boolean; detail?: boolean; aRef?: Ref<SVGGElement>; bRef?: Ref<SVGGElement> }) {
  return (
    <g>
      <Half theta={theta} heavy={heavy} gref={aRef} />
      <Half theta={theta} heavy={heavy} flip gref={bRef} />
      {detail && <circle r="3.4" fill="currentColor" stroke="var(--bg)" strokeWidth="1.2" />}
    </g>
  );
}

export function DottedLine({ x0, x1, y = 0, r = 1.9, pitch = 7 }: { x0: number; x1: number; y?: number; r?: number; pitch?: number }) {
  const dots: number[] = [];
  for (let x = x0; x <= x1 + 0.01; x += pitch) dots.push(x);
  return <g fill="currentColor">{dots.map((x) => <circle key={x} cx={x} cy={y} r={r} />)}</g>;
}

export function Mark({ size = 22 }: { size?: number }) {
  const small = size <= 24;
  return (
    <svg width={size * 2} height={size} viewBox="0 7 100 50" aria-hidden="true" focusable="false" style={{ display: 'block', flex: 'none', color: 'inherit' }}>
      <g transform="translate(36 32)">
        <Scissors theta={small ? 19 : 17} heavy={small} detail={size >= 48} />
        <g transform="translate(-36 -32)">
          {small ? <DottedLine x0={64} x1={98} y={32} r={3.2} pitch={11.5} /> : <DottedLine x0={60} x1={98} y={32} r={2} pitch={7.6} />}
        </g>
      </g>
    </svg>
  );
}

/** Logo. `size` is the mark height in px. variant "full" adds the wordmark. */
export default function Logo({ size = 22, variant = 'mark', label = 'tech-it' }: { size?: number; variant?: 'mark' | 'full'; label?: string }) {
  if (variant === 'mark') {
    return (
      <span className="logo" role="img" aria-label={label} style={{ display: 'inline-flex', color: 'var(--label)' }}>
        <Mark size={size} />
      </span>
    );
  }
  return (
    <span className="logo logo-full" role="img" aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.28), color: 'var(--label)' }}>
      <Mark size={size} />
      <span aria-hidden="true" style={{ font: `600 ${Math.round(size * 0.78)}px/1 var(--font)`, letterSpacing: '-0.022em' }}>tech-it</span>
    </span>
  );
}
