// Host for important notices (see notify.ts). A round "i" rises from below the screen to the bottom centre, then grows in
// place into a card with the title, the message and a "Got it" button. Esc or Enter close it; the next notice follows.
// Reduced motion: the badge and card simply fade.
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { dismissNotice, notify, type Notice } from './notify';
import { productionChecks } from '../lib/specs';

type Phase = 'rise' | 'open' | 'close';

export default function Notices() {
  const first = useStore((s) => s.notices[0]);
  const [phase, setPhase] = useState<Phase>('rise');
  const [shown, setShown] = useState<Notice | undefined>(first);
  // the factory needs an answer (eg the wash sequence for leather with cotton or denim): say so as soon as it applies
  const project = useStore((s) => s.project);
  useEffect(() => {
    const c = productionChecks(project.pieces, project.edits).find((x) => !x.resolved);
    const key = `${project.id}:${c?.id}`;
    if (c && !told.current.has(key)) { told.current.add(key); notify({ id: `check-${c.id}`, title: c.title, body: 'The factory needs an answer before it can make this. Open the Review tab, Production checks, and choose one. It prints in the tech pack.', tone: 'warn', action: { label: 'Open Review', run: () => useStore.getState().setWorkspace('review') } }); }
  }, [project.id, project.pieces, project.edits]);
  const told = useRef(new Set<string>());
  const ok = useRef<HTMLButtonElement>(null);
  const from = useRef<HTMLElement | null>(null);
  const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // a new notice starts its rise; remember where focus was so it can go back
  useEffect(() => {
    if (first && first !== shown) { setShown(first); setPhase('rise'); }
    if (!first && shown) setShown(undefined);
  }, [first, shown]);
  useEffect(() => {
    if (!shown) return;
    if (!from.current) from.current = document.activeElement as HTMLElement | null;
    setPhase('rise');
    const t = window.setTimeout(() => setPhase('open'), reduced ? 30 : 520);
    return () => window.clearTimeout(t);
  }, [shown, reduced]);
  useEffect(() => { if (phase === 'open') ok.current?.focus(); }, [phase]);

  const close = () => {
    if (!shown) return;
    const id = shown.id;
    setPhase('close');
    window.setTimeout(() => {
      dismissNotice(id);
      if (!useStore.getState().notices.length) { from.current?.focus?.(); from.current = null; }
    }, reduced ? 30 : 180);
  };

  useEffect(() => {
    if (!shown || phase !== 'open') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && !(e.target as HTMLElement).closest?.('button'))) { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') { // keep focus inside the card while it is open
        const bs = Array.from(document.querySelectorAll<HTMLElement>('.notice-card button'));
        if (!bs.length) return;
        const i = bs.indexOf(document.activeElement as HTMLElement);
        e.preventDefault(); bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!shown) return null;
  const tone = shown.tone ?? 'info';
  const open = phase === 'open';
  return (
    <div className="notice-layer" data-phase={phase} data-tone={tone}>
      {open && <div className="notice-scrim" onClick={close} aria-hidden="true" />}
      <div className="notice-card material" role="alertdialog" aria-modal="true" aria-labelledby="notice-title" aria-describedby="notice-body" data-open={open || undefined}>
        <span className="notice-badge" aria-hidden="true">{tone === 'info' ? 'i' : '!'}</span>
        <div className="notice-content" aria-hidden={!open}><div className="notice-inner">
          <h2 id="notice-title">{shown.title}</h2>
          <p id="notice-body">{shown.body}</p>
          <div className="notice-actions">
            {shown.action && <button className="btn" tabIndex={open ? 0 : -1} onClick={() => { const a = shown.action!; close(); a.run(); }}>{shown.action.label}</button>}
            <button ref={ok} className="btn primary" tabIndex={open ? 0 : -1} onClick={close}>{shown.ok ?? 'Got it'}</button>
          </div>
        </div></div>
      </div>
    </div>
  );
}
