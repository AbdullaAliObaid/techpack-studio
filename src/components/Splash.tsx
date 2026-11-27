import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './../splash.css';

/* Start screen. A calm sheet of fabric with a dotted cut line across the middle and the tech-it scissors resting on it.
   Press Start: the scissors glide along the line in one eased motion, the blades opening and closing gently on a sine
   tied to the distance travelled. The lower blade slides under the sheet, the upper blade rides over it, and the sheet
   parts behind the crossing point, progressively, then both halves fold softly away to reveal Home (already mounted).
   One requestAnimationFrame clock drives everything from timestamps; nothing is stepped per snip and no CSS transition
   restarts mid cut. Reduced motion: a quick crossfade. */

const CUT_MS = 1800; // from press to the last strip folding away
const SCALE = 2.4; // scissor size in px per drawing unit
const PERSP = 2200; // each strip foreshortens about its own hinge, so neighbours never gap
const FOLD_DEG = 94; // a little past 90 so a flap ends edge on and gone
const PITCH = 180; // px of travel per blade cycle
const clamp = (t: number) => Math.min(1, Math.max(0, t));
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

const skip = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosplash');
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* One blade with its handle, same drawing as the logo. Drawn about the pivot at (0,0), blade pointing right. */
function Blade({ flip, gref }: { flip?: boolean; gref?: React.Ref<SVGGElement> }) {
  const edge = 5, ring = { cx: -26, cy: 5, rx: 10.5, ry: 7.5 }, sw = 3.4;
  return (
    <g ref={gref} transform={`rotate(${flip ? 12 : -12})`}>
      <g transform={flip ? 'scale(1,-1)' : undefined}>
        <path d={`M0 ${-edge} L45 -0.6 Q46.5 0 45 0.7 L0 0 Z`} fill="currentColor" />
        <path d={`M-1 0.2 L${ring.cx + ring.rx - 0.5} ${ring.cy - 1.2}`} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" fill="none" />
        <ellipse cx={ring.cx} cy={ring.cy} rx={ring.rx} ry={ring.ry} fill="none" stroke="currentColor" strokeWidth={sw} />
      </g>
    </g>
  );
}

export default function Splash() {
  const [phase, setPhase] = useState<'idle' | 'cutting' | 'done'>(() => (skip() ? 'done' : 'idle'));
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const { w, h } = size;
  const rootRef = useRef<HTMLDivElement>(null);
  const aRef = useRef<SVGGElement>(null); // upper blade
  const bRef = useRef<SVGGElement>(null); // lower blade, under the sheet
  const b2Ref = useRef<SVGGElement>(null); // lower blade again, over the sheet, clipped to behind the crossing point
  const underRef = useRef<HTMLDivElement>(null);
  const overRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGSVGElement>(null);
  const slitRef = useRef<HTMLDivElement>(null);
  const strips = useRef<{ top: HTMLElement[]; bot: HTMLElement[]; topShade: HTMLElement[]; botShade: HTMLElement[]; xs: number[] }>({ top: [], bot: [], topShade: [], botShade: [], xs: [] });
  const t0 = useRef(0);
  const theta = useRef(12);
  const rm = reduced();
  const px0 = Math.max(64, Math.min(w * 0.12, 200)) + 40 * SCALE; // left margin plus the handles; the crossing point rests here
  const sw = 10; // strip width in px
  const n = Math.ceil(w / sw);
  const span = Math.max(520, w * 0.55); // distance behind the blades over which a strip folds away
  const end = w + span; // crossing point position at the end; the last strip is gone by then

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
    if (home) { home.style.removeProperty('scale'); home.style.removeProperty('mask-image'); home.style.removeProperty('-webkit-mask-image'); }
    if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>('.new-card')?.focus({ preventScroll: true });
  }, [phase]);

  // the single clock: idle blade breathing, then the cut
  useEffect(() => {
    if (phase === 'done') return;
    const setTheta = (th: number) => {
      theta.current = th;
      aRef.current?.setAttribute('transform', `rotate(${-th})`);
      bRef.current?.setAttribute('transform', `rotate(${th})`);
      b2Ref.current?.setAttribute('transform', `rotate(${th})`);
    };
    if (rm) { setTheta(14); return; }
    const homeEl = document.querySelector<HTMLElement>('.home');
    let raf = 0;
    const t00 = performance.now();
    const theta0 = theta.current;
    const place = (x: number) => {
      const tr = `translate3d(${x}px,0,0)`;
      if (underRef.current) underRef.current.style.transform = tr;
      if (overRef.current) overRef.current.style.transform = tr;
      // the dotted line only exists ahead of the crossing point
      if (lineRef.current) lineRef.current.style.clipPath = `inset(-4px 0 -4px ${Math.max(0, x)}px)`;
      if (slitRef.current) slitRef.current.style.transform = `translate3d(${x - 200}px,0,0)`;
    };
    place(px0);
    const tick = (now: number) => {
      if (phase === 'idle') {
        setTheta(12 + 6 * Math.sin(((now - t00) / 2800) * Math.PI * 2)); // a slow, quiet open and close
      } else {
        const t = Math.max(0, now - t0.current);
        const k = clamp(t / CUT_MS);
        const e = 0.12 * k + 0.88 * (0.5 - 0.5 * Math.cos(Math.PI * k)); // one continuous glide, soft at both ends
        const f = px0 + (end - px0) * e; // the crossing point, on the line
        place(f);
        // blade angle: a sine of distance travelled (so snips follow the motion), eased in from the idle angle
        const target = 10.5 + 7 * Math.cos(((f - px0) / PITCH) * Math.PI * 2);
        const b = smoother(clamp(t / 320));
        setTheta(theta0 + (target - theta0) * b);
        const s = strips.current;
        let sum = 0;
        for (let i = 0; i < s.xs.length; i++) {
          // strips left of the start follow just behind the first snip
          const x = s.xs[i] >= px0 ? s.xs[i] : px0 + (px0 - s.xs[i]) * 0.22;
          const u = smoother(clamp((f - x) / span));
          sum += u;
          const a = u * FOLD_DEG;
          const top = s.top[i], bot = s.bot[i];
          if (top && bot) {
            top.style.transform = `perspective(${PERSP}px) rotateX(${-a}deg)`;
            bot.style.transform = `perspective(${PERSP}px) rotateX(${a}deg)`;
            top.style.visibility = bot.style.visibility = u >= 0.999 ? 'hidden' : '';
            s.topShade[i].style.opacity = s.botShade[i].style.opacity = (0.4 * u).toFixed(3);
          }
        }
        const g = sum / Math.max(1, s.xs.length);
        if (slitRef.current) slitRef.current.style.opacity = String(clamp(1 - g * 1.6));
        if (homeEl) {
          // Home comes in behind the opening through a soft mask that travels with the cut
          const m = `linear-gradient(90deg, #000 ${(f - 60).toFixed(1)}px, transparent ${(f + 60).toFixed(1)}px)`;
          homeEl.style.setProperty('mask-image', m);
          homeEl.style.setProperty('-webkit-mask-image', m);
          homeEl.style.scale = String(0.96 + 0.04 * smoother(g));
        }
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
  const drawing = (children: React.ReactNode) => (
    <svg width="1" height="1" style={{ overflow: 'visible', display: 'block' }} focusable="false">
      <g transform={`scale(${SCALE})`}>{children}</g>
    </svg>
  );
  return createPortal(
    <div ref={rootRef} className={`splash ${phase} ${rm ? 'rm' : ''}`} role="dialog" aria-label="tech-it start screen">
      <div className="fab-slit" ref={slitRef} style={{ transform: `translate3d(${px0 - 200}px,0,0)` }} aria-hidden="true" />
      {/* lower blade: below the sheet, so it slides under the fabric ahead of the cut */}
      {!rm && <div ref={underRef} className="splash-scissors under" style={{ left: 0, transform: `translate3d(${px0}px,0,0)` }} aria-hidden="true">{drawing(<Blade flip gref={bRef} />)}</div>}
      <div className="fab">{stripEls}</div>
      <svg ref={lineRef} className="splash-line" style={{ clipPath: `inset(-4px 0 -4px ${px0}px)` }} aria-hidden="true" focusable="false">
        <line x1="0" x2="100%" y1="0.5" y2="0.5" />
      </svg>
      <div className={`splash-head ${cutting ? 'away' : ''}`}>
        <h1>tech-it</h1>
        <p>Patterns, fit and tech packs in one place</p>
      </div>
      <div className={`splash-foot ${cutting ? 'away' : ''}`}>
        <button className="splash-start" onClick={start} tabIndex={cutting ? -1 : 0} aria-hidden={cutting}>Start</button>
      </div>
      {/* upper blade rides over the sheet; the lower blade's handle shows again behind the crossing point */}
      {!rm && (
        <div ref={overRef} className="splash-scissors over" style={{ left: 0, transform: `translate3d(${px0}px,0,0)` }} aria-hidden="true">
          {drawing(
            <>
              <defs><clipPath id="splash-behind"><rect x="-80" y="-80" width="78.5" height="160" /></clipPath></defs>
              <g clipPath="url(#splash-behind)"><Blade flip gref={b2Ref} /></g>
              <Blade gref={aRef} />
              <circle className="splash-pivot" r="3.4" fill="currentColor" stroke="var(--fabric)" strokeWidth="1.2" />
            </>,
          )}
        </div>
      )}
    </div>,
    document.body,
  );
}
