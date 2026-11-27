// A number you can type into: shows a measurement in the current units, Enter applies it to the pattern, Escape cancels,
// arrow up / down nudge by 0.1 (Shift: 1) and the number pulses when it changes (craft rule: pulse to confirm).
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { setMeasureFrom } from './measureUi';
import type { MeasureTarget } from '../data/measureEdit';
import { toUnit, type Units } from '../lib/units';

const digitsOf = (u: Units) => (u === 'cm' ? 1 : 2);

export function useMeasurePulse(key: string | undefined) {
  return useStore((s) => (key && s.measureFlash?.keys.includes(key) ? s.measureFlash.n : 0));
}

export default function MeasureField({ cm, units, label, target, pulseKey, inline, onClose, className }: {
  cm: number; units: Units; label: string; target: MeasureTarget | null; pulseKey?: string;
  /** inline: opens focused over a chart label; closes on Enter, Escape or blur */
  inline?: boolean; onClose?: () => void; className?: string;
}) {
  const shown = toUnit(cm, units).toFixed(digitsOf(units));
  const [text, setText] = useState(shown);
  const [focus, setFocus] = useState(!!inline);
  const [bad, setBad] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const skip = useRef(false);
  const pulse = useMeasurePulse(pulseKey);
  useEffect(() => { if (!focus) setText(shown); }, [shown, focus]);
  useEffect(() => { if (inline) { ref.current?.focus(); ref.current?.select(); } }, [inline]);

  const apply = () => {
    const n = parseFloat(text.replace(',', '.'));
    if (!target || !(n > 0) || Math.abs(n - parseFloat(shown)) < 1e-9) { setBad(!!target && !(n > 0)); setText(shown); return; }
    if (!setMeasureFrom(target, n, units)) { setBad(true); setText(shown); setTimeout(() => setBad(false), 900); }
  };
  const finish = () => {
    if (skip.current) { skip.current = false; setText(shown); } else apply();
    onClose?.();
  };
  const nudge = (dir: number, big: boolean) => {
    const base = parseFloat(text.replace(',', '.'));
    const step = (units === 'cm' ? 0.1 : 0.05) * (big ? 10 : 1);
    const v = (isNaN(base) ? parseFloat(shown) : base) + dir * step;
    setText(Math.max(0.1, v).toFixed(digitsOf(units)));
  };

  if (!target) return <b className={className}>{shown}</b>;
  return (
    <span key={pulse} className={`mfield-num ${inline ? 'inline' : ''} ${pulse ? 'mf-pulse' : ''} ${bad ? 'mf-bad' : ''} ${className ?? ''}`}>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        aria-label={label}
        value={focus ? text : shown}
        onFocus={(e) => { setFocus(true); setText(shown); e.currentTarget.select(); }}
        onBlur={() => { setFocus(false); finish(); }}
        onChange={(e) => setText(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'Escape') { e.preventDefault(); skip.current = true; (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey); }
        }}
      />
      {!inline && <span className="mf-unit">{units}</span>}
    </span>
  );
}
