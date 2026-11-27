// Centred overlay in the 3D view while a newly picked garment or design drapes for the first time. The old garment is
// hidden by ClothView, so this is all the person sees until the first frame of the new one. Scissors snip along a dotted
// line; with reduced motion they hold still and the text carries the progress.
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { DottedLine, Scissors } from './Logo';

export default function GarmentLoading() {
  const loading = useStore((s) => s.garmentLoading);
  const status = useStore((s) => s.simStatus);
  const a = useRef<SVGGElement>(null), b = useRef<SVGGElement>(null);
  useEffect(() => { a.current?.classList.add('gl-a'); b.current?.classList.add('gl-b'); }, [loading]);
  if (!loading) return null;
  return (
    <div className="gl-wrap" role="status" aria-live="polite">
      <div className="gl-card material">
        <svg width="132" height="66" viewBox="0 7 100 50" aria-hidden="true" focusable="false" style={{ color: 'var(--label)' }}>
          <g transform="translate(36 32)">
            <Scissors theta={19} heavy aRef={a} bRef={b} />
            <g transform="translate(-36 -32)" className="gl-dots"><DottedLine x0={64} x1={98} y={32} r={3.2} pitch={11.5} /></g>
          </g>
        </svg>
        <div className="gl-text"><b>Cutting your garment</b><span>{status && status !== 'Simulating fabric…' ? status : 'Getting the pattern onto the body'}</span></div>
      </div>
    </div>
  );
}
