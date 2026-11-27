// Small modal helpers: a Sheet that traps focus and closes on Escape, and a one field name sheet.
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Sheet({ title, onClose, children, wide, label }: { title?: string; onClose: () => void; children: ReactNode; wide?: boolean; label?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(document.activeElement);
  useEffect(() => {
    const el = root.current;
    el?.querySelector<HTMLElement>('[data-autofocus], input, button')?.focus();
    const back = opener.current as HTMLElement | null;
    return () => back?.focus?.();
  }, []);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const items = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]') ?? [])];
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
    }
  };
  return createPortal(
    <div className="sheet-backdrop stage" onClick={onClose} onKeyDown={key}>
      <div ref={root} className={`sheet material ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={label ?? title} onClick={(e) => e.stopPropagation()}>
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PromptSheet({ title, label, value, confirm = 'Save', onDone, onClose, hint }: { title: string; label: string; value: string; confirm?: string; hint?: string; onDone: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState(value);
  const ok = v.trim().length > 0;
  return (
    <Sheet title={title} onClose={onClose}>
      <form className="prompt-form" onSubmit={(e) => { e.preventDefault(); if (ok) onDone(v.trim()); }}>
        <label className="field-label" htmlFor="prompt-field">{label}</label>
        <input id="prompt-field" data-autofocus className="txt wide" value={v} maxLength={60} autoComplete="off" onChange={(e) => setV(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        {hint && <p className="group-note" style={{ padding: 0 }}>{hint}</p>}
        <div className="alert-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!ok}>{confirm}</button>
        </div>
      </form>
    </Sheet>
  );
}
