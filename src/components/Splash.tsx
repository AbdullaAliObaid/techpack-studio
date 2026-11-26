import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Scissors } from './Logo';
import '../splash.css';

/* Start screen. The app mounts underneath straight away (so it can build the body while this shows).
   Start: scissors snip along the dotted line, then the sheet parts at the line, top half up, bottom half down. */

const CUT_MS = 780; // scissors travel
const PART_AT = 560; // when the halves start to part
const PART_MS = 900;
const TOTAL = 1500;
const SCALE = 2.4; // scissor size in px per drawing unit
const REACH = 45 * SCALE; // pivot to blade tip
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp = (t: number) => Math.min(1, Math.max(0, t));

const skip = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosplash');
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function Scene({ ghost, onStart, startRef, pivotX }: { ghost?: boolean; onStart?: () => void; startRef?: React.Ref<HTMLButtonElement>; pivotX: number }) {
  return (
    <div className="splash-scene">
      <div className="splash-head">
        <h1>tech-it</h1>
        <p>Patterns, fit and tech packs in one place</p>
      </div>
      <svg className="splash-line" aria-hidden="true" focusable="false">
        <line x1={pivotX + REACH + 24} x2="100%" y1="0.5" y2="0.5" />
      </svg>
      <div className="splash-foot">
        {ghost ? (
          <div className="splash-start" aria-hidden="true">Start</div>
        ) : (
          <button ref={startRef} className="splash-start" onClick={onStart}>Start</button>
        )}
      </div>
    </div>
  );
}

export default function Splash() {
  const [phase, setPhase] = useState<'idle' | 'cutting' | 'done'>(() => (skip() ? 'done' : 'idle'));
  const [w, setW] = useState(() => window.innerWidth);
  const aRef = useRef<SVGGElement>(null);
  const bRef = useRef<SVGGElement>(null);
  const scisRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const t0 = useRef(0);
  const pivotX = Math.max(64, Math.min(w * 0.12, 200)) + 40 * SCALE; // left margin plus the handles

  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  // keep the app underneath out of the tab order and away from screen readers while the front door is up
  useLayoutEffect(() => {
    if (phase === 'done') return;
    const app = document.querySelector('.app');
    app?.setAttribute('inert', '');
    return () => app?.removeAttribute('inert');
  }, [phase]);

  // Enter or Space starts, even before the button has focus
  useEffect(() => {
    if (phase !== 'idle') return;
    const on = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); start(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // rAF loop: idle snipping, then the cut
  useEffect(() => {
    if (phase === 'done') return;
    const setTheta = (th: number) => {
      aRef.current?.setAttribute('transform', `rotate(${-th})`);
      bRef.current?.setAttribute('transform', `rotate(${th})`);
    };
    if (reduced()) { setTheta(17); return; }
    let raf = 0;
    const t00 = performance.now();
    const tick = (now: number) => {
      if (phase === 'idle') {
        // gentle: a slow open and close
        setTheta(12 + 7 * Math.sin(((now - t00) / 2600) * Math.PI * 2));
      } else {
        const t = now - t0.current;
        const p = easeInOut(clamp(t / CUT_MS));
        const travel = w - pivotX + REACH + 40;
        // three quick snips while travelling
        const th = 3 + 15 * (0.5 + 0.5 * Math.cos(clamp(t / CUT_MS) * Math.PI * 2 * 4));
        setTheta(th);
        if (scisRef.current) {
          scisRef.current.style.transform = `translate3d(${p * travel}px,0,0)`;
          scisRef.current.style.opacity = String(1 - clamp((t - CUT_MS * 0.8) / (CUT_MS * 0.2)));
        }
        const q = easeOut(clamp((t - PART_AT) / PART_MS));
        if (topRef.current) topRef.current.style.transform = `translate3d(0,${-q * 100}%,0)`;
        if (botRef.current) botRef.current.style.transform = `translate3d(0,${q * 100}%,0)`;
        if (rootRef.current) rootRef.current.style.setProperty('--part', String(q));
        if (t >= TOTAL) { setPhase('done'); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, w, pivotX]);

  const start = () => {
    if (phase !== 'idle') return;
    if (reduced()) {
      setPhase('cutting');
      window.setTimeout(() => setPhase('done'), 260);
      return;
    }
    t0.current = performance.now();
    setPhase('cutting');
  };

  if (phase === 'done') return null;
  const rm = reduced();
  return createPortal(
    <div
      ref={rootRef}
      className={`splash ${phase} ${rm ? 'rm' : ''}`}
      role="dialog"
      aria-label="tech-it start screen"
    >
      {phase === 'idle' || rm ? (
        <div className="splash-live"><Scene onStart={start} startRef={startRef} pivotX={pivotX} /></div>
      ) : (
        <>
          <div ref={topRef} className="splash-half top"><div className="splash-half-in"><Scene ghost pivotX={pivotX} /></div></div>
          <div ref={botRef} className="splash-half bottom"><div className="splash-half-in"><Scene ghost pivotX={pivotX} /></div></div>
        </>
      )}
      {!rm && (
        <div ref={scisRef} className="splash-scissors" style={{ left: pivotX }} aria-hidden="true">
          <svg width="1" height="1" style={{ overflow: 'visible' }} focusable="false">
            <g transform={`scale(${SCALE})`}><Scissors aRef={aRef} bRef={bRef} detail /></g>
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}
