// The Insert section: the one bright place where things get added (shapes, letters, pictures, trims, edge paint),
// plus the method picker (Print, Embroidery, Appliqué) that shows what each way of making a design looks like.
import { useId, useState, type ReactNode } from 'react';
import { METHODS, type Method } from './artworkMethod';
import Icon from './Icon';

const HINT_KEY = 'tech-it-insert-hint';
const seen = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return true; } };

/** Accent tinted block. Everything inside adds something to the garment with one click or a drag. */
export function InsertSection({ title = 'Insert', hint, notice, children }: { title?: string; hint?: string; notice?: string | null; children: ReactNode }) {
  const [hide, setHide] = useState(seen);
  const dismiss = () => { setHide(true); try { localStorage.setItem(HINT_KEY, '1'); } catch { /* storage blocked */ } };
  return (
    <section className="insert-sec" aria-label={title}>
      <header className="insert-head">
        <span className="insert-ico" aria-hidden="true"><Icon name="plus" size={16} /></span>
        <h3>{title}</h3>
        <span className="insert-sub">Click to add, or drag onto the garment</span>
      </header>
      {!hide && (
        <div className="insert-hint" role="note">
          <span>{hint ?? 'One click adds it to the middle of the selected piece. Drag it onto a piece to put it exactly there.'}</span>
          <button className="btn small" onClick={dismiss}>Got it</button>
        </div>
      )}
      {notice && <div className="insert-notice" role="status">{notice}</div>}
      <div className="insert-body">{children}</div>
    </section>
  );
}

// a five point star, drawn the same way for all three method previews
const STAR = (() => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 6.5 : 15, a = -Math.PI / 2 + (i * Math.PI) / 5; pts.push(`${(32 + r * Math.cos(a)).toFixed(2)},${(20 + r * Math.sin(a) * 1.0).toFixed(2)}`); }
  return pts.join(' ');
})();

/** What each method looks like, as a background texture behind a sample star. */
function MethodArt({ m, ink, thread, cloth }: { m: Method; ink: string; thread: string; cloth: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 64 40" preserveAspectRatio="xMidYMid slice" className="mt-art" aria-hidden="true" focusable="false">
      <defs>
        <pattern id={`w${id}`} width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="var(--bg-grouped)" /><path d="M0 2h4M2 0v4" stroke="var(--separator)" strokeWidth="0.5" /></pattern>
        <pattern id={`s${id}`} width="2.2" height="2.2" patternUnits="userSpaceOnUse" patternTransform="rotate(62)"><rect width="2.2" height="2.2" fill={thread} /><rect width="2.2" height="0.8" fill="oklch(0 0 0 / 0.28)" /><rect y="1.1" width="2.2" height="0.5" fill="oklch(1 0 0 / 0.28)" /></pattern>
        <pattern id={`d${id}`} width="3" height="3" patternUnits="userSpaceOnUse"><rect width="3" height="3" fill={ink} /><circle cx="1.5" cy="1.5" r="0.45" fill="oklch(1 0 0 / 0.14)" /></pattern>
      </defs>
      <rect width="64" height="40" fill={m === 'applique' ? `url(#w${id})` : `url(#w${id})`} />
      {m === 'print' && <polygon points={STAR} fill={`url(#d${id})`} />}
      {m === 'embroidery' && <><polygon points={STAR} fill={`url(#s${id})`} /><polygon points={STAR} fill="none" stroke="oklch(0 0 0 / 0.35)" strokeWidth="0.8" strokeLinejoin="round" /></>}
      {m === 'applique' && (
        <>
          <polygon points={STAR} fill={cloth} stroke="oklch(0 0 0 / 0.3)" strokeWidth="0.6" strokeLinejoin="round" />
          <polygon points={STAR} fill="none" stroke={thread} strokeWidth="1" strokeDasharray="2 1.4" strokeLinejoin="round" transform="translate(32 20) scale(0.82) translate(-32 -20)" />
        </>
      )}
    </svg>
  );
}

/** Three big tiles, one per method. Each shows its own texture, so the choice is visible and not just a word. */
export function MethodPicker({ value, onChange, ink, thread, cloth, label = 'How to make it', disabled }: {
  value: Method; onChange: (m: Method) => void; ink: string; thread: string; cloth: string; label?: string; disabled?: (m: Method) => boolean;
}) {
  return (
    <div className="method-grid" role="radiogroup" aria-label={label}>
      {METHODS.map((m) => {
        const off = disabled?.(m.id) ?? false;
        return (
          <button key={m.id} role="radio" aria-checked={value === m.id} disabled={off} className={`method-tile ${value === m.id ? 'on' : ''}`} title={off ? `${m.label} is not available for this one` : m.blurb} onClick={() => onChange(m.id)}>
            <MethodArt m={m.id} ink={ink} thread={thread} cloth={cloth} />
            <span className="mt-name">{m.label}</span>
            <small className="mt-blurb">{m.blurb}</small>
          </button>
        );
      })}
    </div>
  );
}
