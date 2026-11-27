import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './../splash.css';

/* Start screen. A calm sheet of fabric with a dotted cut line across the middle and the tech-it scissors resting on it.
   Press Start: the scissors glide along the line in one eased motion, the blades opening and closing gently on a sine
   tied to the distance travelled. The lower blade slides under the sheet (a faint silhouette), the upper blade rides over
   it, and the sheet is two smooth filled shapes on one canvas whose edges part behind the crossing point as a widening V,
   then curve away to reveal Home (already mounted).
   One requestAnimationFrame clock drives everything from timestamps; nothing is stepped per snip and no CSS transition
   restarts mid cut. Reduced motion: a quick crossfade. */

const CUT_MS = 1800; // from press to the last strip folding away
const SCALE = 2.4; // scissor size in px per drawing unit
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
  const bRef = useRef<SVGGElement>(null); // lower blade behind the crossing point
  const b2Ref = useRef<SVGGElement>(null); // lower blade ahead of it: a faint silhouette through the sheet
  const overRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const t0 = useRef(0);
  const theta = useRef(12);
  const rm = reduced();
  const px0 = Math.max(64, Math.min(w * 0.12, 200)) + 40 * SCALE; // left margin plus the handles; the crossing point rests here
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
    const homeEl = document.querySelector<HTMLElement>('.home');
    let raf = 0;
    const t00 = performance.now();
    const theta0 = theta.current;
    const place = (x: number) => {
      const tr = `translate3d(${x}px,0,0)`;
      if (overRef.current) overRef.current.style.transform = tr;
      // the dotted line only exists ahead of the crossing point
      if (lineRef.current) lineRef.current.style.clipPath = `inset(-4px 0 -4px ${Math.max(0, x)}px)`;
    };
    // the sheet: two filled shapes whose shared edge is a smooth curve. gap(x) is how far the edge has pulled away from the line.
    const gapAt = (x: number, f: number) => {
      const xx = x >= px0 ? x : px0 + (px0 - x) * 0.22; // the part left of the start follows just behind the first snip
      return smoother(clamp((f - xx) / span));
    };
    const draw = (f: number) => {
      const cv = canvasRef.current;
      if (!cv) return 0;
      const cw = cv.clientWidth, ch = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
      if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
      const ctx = cv.getContext('2d');
      if (!ctx) return 0;
      const cs = getComputedStyle(rootRef.current ?? document.body);
      const fabric = cs.getPropertyValue('--fabric').trim() || '#ebe8e1';
      const shade = cs.getPropertyValue('--fabric-shade').trim() || '#222';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      const c = ch / 2, step = 4;
      let sum = 0, cnt = 0;
      const xs: number[] = [];
      for (let x = 0; x < cw + step; x += step) xs.push(Math.min(x, cw));
      const gaps = xs.map((x) => { const u = gapAt(x, f); sum += u; cnt++; return c * 1.04 * u; });
      for (const dir of [-1, 1]) {
        const edge = () => { ctx.beginPath(); xs.forEach((x, i) => (i ? ctx.lineTo(x, c + dir * gaps[i]) : ctx.moveTo(x, c + dir * gaps[i]))); };
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, dir < 0 ? 0 : ch); ctx.lineTo(cw, dir < 0 ? 0 : ch);
        for (let i = xs.length - 1; i >= 0; i--) ctx.lineTo(xs[i], c + dir * gaps[i]);
        ctx.closePath();
        ctx.fillStyle = fabric; ctx.fill();
        ctx.clip();
        // soft fold: an inner shadow along the edge that grows as the cloth turns away, nothing ahead of the cut
        const gr = ctx.createLinearGradient(f - span * 0.9, 0, f, 0);
        gr.addColorStop(0, `color-mix(in oklch, ${shade} 1.2%, transparent)`);
        gr.addColorStop(0.55, `color-mix(in oklch, ${shade} 2.5%, transparent)`);
        gr.addColorStop(1, `color-mix(in oklch, ${shade} 0%, transparent)`);
        ctx.strokeStyle = gr; ctx.lineJoin = 'round';
        for (let i = 1; i <= 8; i++) { ctx.lineWidth = i * 14; edge(); ctx.stroke(); } // stacked soft strokes, no blur filter (cheap)
        ctx.restore();
      }
      return sum / Math.max(1, cnt);
    };
    place(px0);
    draw(px0);
    if (rm) { setTheta(14); return; }
    const tick = (now: number) => {
      if (phase === 'idle') {
        setTheta(12 + 6 * Math.sin(((now - t00) / 2800) * Math.PI * 2)); // a slow, quiet open and close
        draw(px0); // keeps up with a theme change
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
        const g = draw(f);
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

  if (phase === 'done') return null;
  const cutting = phase === 'cutting';
  const drawing = (children: React.ReactNode) => (
    <svg width="1" height="1" style={{ overflow: 'visible', display: 'block' }} focusable="false">
      <g transform={`scale(${SCALE})`}>{children}</g>
    </svg>
  );
  return createPortal(
    <div ref={rootRef} className={`splash ${phase} ${rm ? 'rm' : ''}`} role="dialog" aria-label="tech-it start screen">
      <canvas ref={canvasRef} className="fab" aria-hidden="true" />
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
      {/* upper blade rides over the sheet; the lower blade shows behind the crossing point and only as a faint silhouette ahead of it, under the cloth */}
      {!rm && (
        <div ref={overRef} className="splash-scissors over" style={{ left: 0, transform: `translate3d(${px0}px,0,0)` }} aria-hidden="true">
          {drawing(
            <>
              <defs>
                <clipPath id="splash-behind"><rect x="-80" y="-80" width="78.5" height="160" /></clipPath>
                <clipPath id="splash-ahead"><rect x="-1.5" y="-80" width="140" height="160" /></clipPath>
              </defs>
              <g clipPath="url(#splash-behind)"><Blade flip gref={bRef} /></g>
              <g clipPath="url(#splash-ahead)" opacity="0.2"><Blade flip gref={b2Ref} /></g>
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
