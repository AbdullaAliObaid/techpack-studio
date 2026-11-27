import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Scissors } from './Logo';
import '../splash.css';

/* Start screen. The screen is a sheet of woven fabric with a dotted cut line across the middle.
   Press Start: the scissors travel along the line, and the sheet opens behind the blades, strip by strip.
   The two halves then fold back like cloth flaps and reveal Home, which is already mounted underneath.
   Everything animates with transforms on plain divs (no canvas, no libraries). Reduced motion: a quick crossfade. */

const CUT_MS = 1800; // from the first snip to the last strip folding away
const SCALE = 2.4; // scissor size in px per drawing unit
const REACH = 45 * SCALE; // pivot to blade tip
const PERSP = 2200; // gentle: each strip foreshortens about its own hinge, so neighbours never gap
const FOLD_DEG = 94; // how far a flap turns (past 90 so it ends edge on and gone)
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const skip = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosplash');
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Splash() {
  const [phase, setPhase] = useState<'idle' | 'cutting' | 'done'>(() => (skip() ? 'done' : 'idle'));
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const { w, h } = size;
  const rootRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<SVGGElement>(null);
  const bRef = useRef<SVGGElement>(null);
  const scisRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGSVGElement>(null);
  const slitRef = useRef<HTMLDivElement>(null);
  const strips = useRef<{ top: HTMLElement[]; bot: HTMLElement[]; topShade: HTMLElement[]; botShade: HTMLElement[]; xs: number[] }>({ top: [], bot: [], topShade: [], botShade: [], xs: [] });
  const t0 = useRef(0);
  const rm = reduced();
  const px0 = Math.max(64, Math.min(w * 0.12, 200)) + 40 * SCALE; // left margin plus the handles
  const sw = 16; // strip width in px
  const n = Math.ceil(w / sw);
  const span = Math.max(360, w * 0.42); // how far the blades travel while one strip folds away
  const exit = w + 40 * SCALE + 24; // pivot position where the whole scissors are off screen
  const end = Math.max(exit, w + span);

  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setSize({ w: window.innerWidth, h: window.innerHeight })); };
    window.addEventListener('resize', on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on); };
  }, []);

  // keep the app underneath out of the tab order and away from screen readers while the front door is up
  useLayoutEffect(() => {
    if (phase === 'done') return;
    const app = document.querySelector('.app');
    app?.setAttribute('inert', '');
    return () => app?.removeAttribute('inert');
  }, [phase]);

  // cache the strips after every layout change
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const q = (sel: string) => [...el.querySelectorAll<HTMLElement>(sel)];
    strips.current = { top: q('.fab-top .fab-strip'), bot: q('.fab-bot .fab-strip'), topShade: q('.fab-top .fab-strip i'), botShade: q('.fab-bot .fab-strip i'), xs: Array.from({ length: n }, (_, i) => i * sw + sw / 2) };
  }, [n, phase]);

  const start = () => {
    if (phase !== 'idle') return;
    if (rm) {
      setPhase('cutting');
      window.setTimeout(() => setPhase('done'), 260);
      return;
    }
    t0.current = performance.now();
    setPhase('cutting');
  };

  // Enter or Space starts, even before the button has focus
  useEffect(() => {
    if (phase !== 'idle') return;
    const on = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); start(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // when the splash goes, give Home its size back and land focus on its main action
  useEffect(() => {
    if (phase !== 'done') return;
    const home = document.querySelector<HTMLElement>('.home');
    if (home) home.style.removeProperty('scale');
    if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>('.new-card')?.focus({ preventScroll: true });
  }, [phase]);

  // rAF loop: idle snipping, then the cut
  useEffect(() => {
    if (phase === 'done') return;
    const setTheta = (th: number) => {
      aRef.current?.setAttribute('transform', `rotate(${-th})`);
      bRef.current?.setAttribute('transform', `rotate(${th})`);
    };
    if (rm) { setTheta(17); return; }
    const homeEl = document.querySelector<HTMLElement>('.home');
    let raf = 0;
    const t00 = performance.now();
    const place = (x: number) => {
      if (scisRef.current) scisRef.current.style.transform = `translate3d(${x - px0}px,0,0)`;
      // the dotted line only exists ahead of the blades
      if (lineRef.current) lineRef.current.style.clipPath = `inset(-4px 0 -4px ${Math.max(0, x + 70)}px)`;
    };
    place(px0);
    const tick = (now: number) => {
      if (phase === 'idle') {
        setTheta(12 + 7 * Math.sin(((now - t00) / 2600) * Math.PI * 2)); // a slow open and close
      } else {
        const t = now - t0.current;
        const k = clamp(t / CUT_MS);
        const e = 0.3 * k + 0.7 * (0.5 - 0.5 * Math.cos(Math.PI * k)); // eases in, then keeps moving
        const f = px0 + (end - px0) * e; // where the cut is right now
        place(f);
        setTheta(3 + 15 * (0.5 + 0.5 * Math.cos(((f - px0) / 96) * Math.PI * 2))); // a snip every ~96 px
        const s = strips.current;
        let sum = 0;
        for (let i = 0; i < s.xs.length; i++) {
          // strips left of the start follow just behind the first snip
          const x = s.xs[i] >= px0 ? s.xs[i] : px0 + (px0 - s.xs[i]) * 0.22;
          const u = smoother(clamp((f - x) / span));
          sum += u;
          // a small ripple along the sheet, strongest mid fold, so the flaps read as cloth and not as a blind
          const rip = Math.sin(i * 0.9 + t / 160) * 5 * Math.sin(Math.PI * u);
          const a = u * FOLD_DEG + rip * (u > 0 && u < 1 ? 1 : 0);
          const hide = u >= 0.999;
          const sh = (0.62 * u + 0.1 * Math.sin(i * 1.7 + 1) * Math.sin(Math.PI * u)).toFixed(3);
          const top = s.top[i], bot = s.bot[i];
          if (top && bot) {
            top.style.transform = `perspective(${PERSP}px) rotateX(${-a}deg)`;
            bot.style.transform = `perspective(${PERSP}px) rotateX(${a}deg)`;
            top.style.visibility = bot.style.visibility = hide ? 'hidden' : '';
            s.topShade[i].style.opacity = s.botShade[i].style.opacity = sh;
          }
        }
        const g = sum / Math.max(1, s.xs.length);
        if (slitRef.current) {
          slitRef.current.style.clipPath = `inset(0 ${Math.max(0, w - f)}px 0 0)`;
          slitRef.current.style.opacity = String(clamp(1 - g * 1.4));
        }
        if (homeEl) homeEl.style.scale = String(0.955 + 0.045 * smoother(g));
        if (rootRef.current) rootRef.current.style.setProperty('--g', g.toFixed(3));
        if (k >= 1) { setPhase('done'); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, w, h, px0, end, span, rm]);

  const stripEls = useMemo(
    () => (['top', 'bot'] as const).map((half) => (
      <div key={half} className={`fab-half fab-${half}`}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i} className="fab-strip" style={{ left: i * sw, width: sw + 1, backgroundPosition: `${-i * sw}px ${half === 'top' ? 0 : -Math.floor(h / 2)}px` }}><i /></div>
        ))}
      </div>
    )),
    [n, h],
  );

  if (phase === 'done') return null;
  const cutting = phase === 'cutting';
  return createPortal(
    <div ref={rootRef} className={`splash ${phase} ${rm ? 'rm' : ''}`} role="dialog" aria-label="tech-it start screen">
      <div className="fab">{stripEls}</div>
      <div className="fab-slit" ref={slitRef} aria-hidden="true" />
      <svg ref={lineRef} className="splash-line" aria-hidden="true" focusable="false">
        <line x1="0" x2="100%" y1="0.5" y2="0.5" />
      </svg>
      <div className={`splash-head ${cutting ? 'away' : ''}`}>
        <h1>tech-it</h1>
        <p>Patterns, fit and tech packs in one place</p>
      </div>
      <div className={`splash-foot ${cutting ? 'away' : ''}`}>
        <button className="splash-start" onClick={start} tabIndex={cutting ? -1 : 0} aria-hidden={cutting} >Start</button>
      </div>
      {!rm && (
        <div ref={scisRef} className="splash-scissors" style={{ left: px0 }} aria-hidden="true">
          <svg width="1" height="1" style={{ overflow: 'visible' }} focusable="false">
            <g transform={`scale(${SCALE})`}><Scissors aRef={aRef} bRef={bRef} detail /></g>
          </svg>
        </div>
      )}
    </div>,
    document.body,
  );
}
