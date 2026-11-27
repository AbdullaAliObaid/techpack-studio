import { useEffect, useState, type ReactNode } from 'react';
import { fromUnit, toUnit, type Units } from '../lib/units';
import { PALETTE } from './editHelpers';
import { useStore } from '../store';
import Icon from './Icon';

/** Inset list row: label on the left, control on the right. */
export function Row({ label, children, htmlFor }: { label: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="frow">
      <label htmlFor={htmlFor}>{label}</label>
      <div className="frow-ctl">{children}</div>
    </div>
  );
}

/** Number input that keeps what the user types until it is a valid number. */
export function NumInput({ id, value, onChange, min, max, step = 0.1, unit, label, digits = 1 }: {
  id?: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; label: string; digits?: number;
}) {
  const shown = Number(value.toFixed(digits));
  const [text, setText] = useState(String(shown));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setText(String(shown)); }, [shown, focus]);
  return (
    <span className="num">
      <input
        id={id}
        type="number"
        inputMode="decimal"
        aria-label={label}
        step={step}
        min={min}
        max={max}
        value={focus ? text : String(shown)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n)));
        }}
      />
      {unit && <span>{unit}</span>}
    </span>
  );
}

/** iOS style switch. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, full = true }: { value: T; options: { id: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string; full?: boolean }) {
  return (
    <div className={`seg ${full ? 'full' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} disabled={o.disabled} className={value === o.id ? 'on' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Swatches plus a colour picker for artwork colours. */
export function ColorField({ value, onChange, label, colors = PALETTE }: { value: string; onChange: (hex: string) => void; label: string; colors?: string[] }) {
  return (
    <div className="swatches color-field" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c} aria-label={`${label} ${c}`} title={c} aria-pressed={value.toLowerCase() === c} className={value.toLowerCase() === c ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <label className="picker" title="Pick any colour">
        <input type="color" aria-label={`${label}, custom colour`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

/** Length input: the value is kept in cm and shown in the project units. */
export function LenInput({ value, onChange, label, min, max, units, step }: { value: number; onChange: (cm: number) => void; label: string; min?: number; max?: number; units: Units; step?: number }) {
  return (
    <NumInput
      label={label}
      value={toUnit(value, units)}
      min={min === undefined ? undefined : toUnit(min, units)}
      max={max === undefined ? undefined : toUnit(max, units)}
      step={step ?? (units === 'cm' ? 0.1 : 0.05)}
      digits={units === 'cm' ? 1 : 2}
      unit={units}
      onChange={(v) => onChange(fromUnit(v, units))}
    />
  );
}

/**
 * Collapsible section: icon, title, optional count, chevron.
 * Every section starts closed. It opens only when the user presses its arrow, and that choice is remembered for this
 * session only. Nothing opens a section for the user: picking an option inside one never expands another.
 */
export function Disclosure({ id, title, icon, count, action, children, openFirst }: {
  id: string; title: string; icon: string; count?: number; action?: ReactNode; children: ReactNode; openFirst?: boolean;
}) {
  const open = useStore((s) => s.sections[id] ?? !!openFirst);
  const setSection = useStore((s) => s.setSection);
  return (
    <section className={`dsc ${open ? 'open' : ''}`}>
      <div className="dsc-head">
        <button className="dsc-toggle" aria-expanded={open} aria-controls={`dsc-${id}`} onClick={() => setSection(id, !open)}>
          <span className="dsc-ico" aria-hidden="true"><Icon name={icon} size={16} /></span>
          <span className="dsc-title">{title}</span>
          {count !== undefined && <span className="dsc-count">{count}</span>}
          <span className="dsc-chev" aria-hidden="true"><Icon name="chevronRight" size={14} /></span>
        </button>
        {action && <div className="dsc-action">{action}</div>}
      </div>
      {open && <div className="dsc-body" id={`dsc-${id}`}>{children}</div>}
    </section>
  );
}

/** Title block at the top of an inspector tab. */
export function TabHeader({ title, subtitle, icon }: { title: string; subtitle?: ReactNode; icon: string }) {
  return (
    <div className="tab-head">
      <span className="tab-head-ico" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

/** Small uppercase label above a group of controls inside a section. */
export function SubLabel({ children }: { children: ReactNode }) {
  return <div className="sublabel">{children}</div>;
}

/** Title bar shared by the Pattern and 3D panes. */
export function PaneTitle({ icon, title, meta, children }: { icon: string; title: string; meta?: ReactNode; children?: ReactNode }) {
  return (
    <header className="pane-title">
      <span className="pane-ico" aria-hidden="true"><Icon name={icon} size={18} /></span>
      <h1>{title}</h1>
      {meta && <span className="pane-meta">{meta}</span>}
      <span className="spacer" />
      {children}
    </header>
  );
}
