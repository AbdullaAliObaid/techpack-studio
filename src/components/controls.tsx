import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { addColour, loadColours, moveColour, removeColour, subscribeColours } from '../lib/savedColours';
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

/** The colours the user saved (shared by every project on this device): click one to use it, "+" saves the current colour. */
export function SavedColours({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  const list = useSyncExternalStore(subscribeColours, loadColours, loadColours);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [drag, setDrag] = useState<number | null>(null);
  const valid = /^#[0-9a-f]{6}$/i.test(value);
  const saved = valid && list.some((c) => c.hex === value.toLowerCase());
  const save = () => { addColour(value, name); setNaming(false); setName(''); };
  return (
    <div className="saved-colours" role="group" aria-label={`${label}, saved colours`}>
      <span className="sc-head">Saved colours</span>
      <div className="swatches">
        {list.map((c, i) => (
          <span key={c.hex} className="sc-item" draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', c.hex); }}
            onDragOver={(e) => { if (drag !== null) e.preventDefault(); }} onDrop={(e) => { e.preventDefault(); if (drag !== null) moveColour(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}>
            <button aria-label={`${label}, use saved colour ${c.name ?? c.hex}`} title={`${c.name ? `${c.name}, ` : ''}${c.hex}. Right click to delete, drag to reorder.`} aria-pressed={value.toLowerCase() === c.hex}
              className={value.toLowerCase() === c.hex ? 'on' : ''} style={{ background: c.hex }} onClick={() => onChange(c.hex)}
              onContextMenu={(e) => { e.preventDefault(); removeColour(c.hex); }}
              onKeyDown={(e) => { if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeColour(c.hex); } else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); moveColour(i, i - 1); } else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); moveColour(i, i + 1); } }} />
            <button className="sc-x" aria-label={`Delete saved colour ${c.name ?? c.hex}`} title="Delete" onClick={() => removeColour(c.hex)}>x</button>
          </span>
        ))}
        <button className="sc-add" aria-label={`Save this colour for later`} title={saved ? 'Already saved' : 'Save this colour for later'} disabled={!valid || saved} onClick={() => setNaming(true)}>+</button>
      </div>
      {list.length === 0 && !naming && <small className="sc-empty">Press + to keep this colour for other garments.</small>}
      {naming && (
        <div className="sc-name">
          <span className="sc-chip" style={{ background: value }} aria-hidden="true" />
          <input className="txt" aria-label="Name for this colour (optional)" placeholder="Name (optional)" maxLength={24} value={name} autoFocus
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') { setNaming(false); setName(''); } }} />
          <button className="btn small" onClick={save}>Save</button>
          <button className="btn small" onClick={() => { setNaming(false); setName(''); }}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/** Swatches plus a colour picker for artwork colours. */
export function ColorField({ value, onChange, label, colors = PALETTE }: { value: string; onChange: (hex: string) => void; label: string; colors?: string[] }) {
  return (
    <div className="color-wrap">
    <div className="swatches color-field" role="group" aria-label={label}>
      {colors.map((c) => (
        <button key={c} aria-label={`${label} ${c}`} title={c} aria-pressed={value.toLowerCase() === c} className={value.toLowerCase() === c ? 'on' : ''} style={{ background: c }} onClick={() => onChange(c)} />
      ))}
      <label className="picker" title="Pick any colour">
        <input type="color" aria-label={`${label}, custom colour`} value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
    <SavedColours value={value} onChange={onChange} label={label} />
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
