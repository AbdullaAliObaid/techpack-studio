// Outside / Inside out, at the top of the Pattern workspace. The coin is a round swatch of the fabric: pressing it flips
// it over (a real 3D turn, each face carries its own cloth) and the chart turns over with it, like a garment turned
// inside out. FaceFlip runs the chart's half of the turn.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../store';
import type { Face } from '../data/edits';
import { FabricSwatch, fabricLabel } from './FabricBrowser';
import { faceName } from './editHelpers';

const reducedMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Wraps the chart. When the face changes it turns the chart edge on, swaps what is drawn, and turns it back. */
export function FaceFlip({ children }: { children: ReactNode }) {
  const viewFace = useStore((s) => s.viewFace);
  const ref = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const timer = useRef(0);
  useEffect(() => {
    const swap = () => useStore.setState({ chartFace: viewFace });
    if (useStore.getState().chartFace === viewFace && !anim.current) return;
    const el = ref.current;
    anim.current?.cancel();
    clearTimeout(timer.current);
    if (!el || reducedMotion()) {
      // no motion: a quick crossfade instead
      swap();
      anim.current = el?.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' }) ?? null;
      return;
    }
    // one animation, so it cannot be left half turned: edge on at the middle, where the drawn face is swapped
    const dir = viewFace === 'inside' ? 1 : -1, T = 440;
    anim.current = el.animate([
      { transform: 'rotateY(0deg)', opacity: 1, offset: 0, easing: 'cubic-bezier(.5,0,.9,.6)' },
      { transform: `rotateY(${90 * dir}deg)`, opacity: 0.85, offset: 0.46 },
      { transform: `rotateY(${-90 * dir}deg)`, opacity: 0.85, offset: 0.46001, easing: 'cubic-bezier(.1,.5,.3,1)' },
      { transform: 'rotateY(0deg)', opacity: 1, offset: 1 },
    ], { duration: T });
    timer.current = window.setTimeout(swap, T * 0.46);
    return () => { /* a newer change cancels this one above */ };
  }, [viewFace]);
  return <div className="flip-stage"><div className="flip-card" ref={ref}>{children}</div></div>;
}

export default function FaceBar() {
  const { project, selPiece, viewFace, set } = useStore();
  const piece = project.pieces.find((p) => p.id === selPiece) ?? project.pieces[0];
  const collar = project.edits?.collar;
  const insideOwn = project.edits?.insideFabric?.[piece.id];
  const inFab = insideOwn ?? { ...piece.fabric, pattern: piece.fabric.pattern?.method === 'woven' ? piece.fabric.pattern : undefined };
  const inside = viewFace === 'inside';
  const [touched, setTouched] = useState(false);
  const go = (f: Face) => { setTouched(true); set({ viewFace: f, designFace: f }); };
  return (
    <div className="face-bar" role="group" aria-label="Which side of the cloth the pattern shows">
      <button
        className={`coin ${inside ? 'inside' : ''} ${touched ? 'touched' : ''}`}
        aria-pressed={inside}
        aria-label={inside ? 'Turn the pattern back to the outside' : 'Turn the pattern inside out'}
        title={inside ? 'Turn back to the outside' : 'Turn the garment inside out'}
        onClick={() => go(inside ? 'outside' : 'inside')}
      >
        <span className="coin-body">
          <span className="coin-face front"><FabricSwatch fabric={piece.fabric} size={40} round /><i className="coin-rim" /></span>
          <span className="coin-face back"><FabricSwatch fabric={inFab} size={40} round /><i className="coin-rim stitched" /><i className="coin-serge" /></span>
        </span>
      </button>
      <div className="face-text">
        <div className="face-labels" role="group" aria-label="Side shown">
          <button className={!inside ? 'on' : ''} aria-pressed={!inside} onClick={() => go('outside')}>Outside</button>
          <button className={inside ? 'on' : ''} aria-pressed={inside} onClick={() => go('inside')}>Inside out</button>
        </div>
        <p className="face-note">
          {inside
            ? `Fabric folded out: ${faceName(project.garment, piece, 'inside', collar).toLowerCase()} side, overlocked edges and stitching from behind.`
            : `Right side of the cloth: ${fabricLabel(piece.fabric)}.`}
        </p>
      </div>
    </div>
  );
}
