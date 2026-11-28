// The workspace bar, plus the Tech pack workspace (preview + export).
import { useEffect, useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import { visibleWorkspaces, type Workspace } from './designDoc';
import { useOutfit } from './uiData';
import { exportTechPack } from '../lib/exportPdf';
import { CATALOG, migrateGarment } from '../data/catalog';
import Icon from './Icon';
import { finishRows, hasFinish } from '../data/finish';

const fitSoon = () => requestAnimationFrame(() => window.dispatchEvent(new Event('tps-fit')));

/** Large row of workspace tabs under the top bar. Scrolls sideways with edge fades, arrow buttons and a rubberband at the ends. */
export function WorkspaceBar() {
  const { workspace, setWorkspace } = usePick('workspace', 'setWorkspace');
  const outfit = !!useOutfit();
  const list = visibleWorkspaces(outfit);
  const scroller = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: false });
  const measure = () => {
    const el = scroller.current;
    if (el) setEdge({ l: el.scrollLeft > 2, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [list.length]);
  // keep the open tab in view
  useEffect(() => { document.getElementById(`ws-${workspace}`)?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }); }, [workspace]);
  // rubberband: wheel pushing past either end stretches the row a little, then it springs back
  useEffect(() => {
    const el = scroller.current, tr = track.current;
    if (!el || !tr) return;
    let pull = 0, t = 0;
    const on = (e: WheelEvent) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      if (!d) return;
      const atL = el.scrollLeft <= 0 && d < 0, atR = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 && d > 0;
      if (!atL && !atR) return;
      pull = Math.max(-28, Math.min(28, pull - d * 0.25));
      tr.style.transition = 'none';
      tr.style.transform = `translateX(${pull}px)`;
      window.clearTimeout(t);
      t = window.setTimeout(() => { pull = 0; tr.style.transition = 'transform 320ms cubic-bezier(0.2, 0.8, 0.2, 1)'; tr.style.transform = ''; }, 90);
    };
    el.addEventListener('wheel', on, { passive: true });
    return () => { el.removeEventListener('wheel', on); window.clearTimeout(t); };
  }, []);
  const go = (w: Workspace) => { setWorkspace(w); fitSoon(); };
  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * Math.max(160, (scroller.current.clientWidth * 0.6)), behavior: 'smooth' });
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = list.findIndex((w) => w.id === workspace);
    const n = e.key === 'Home' ? list[0] : e.key === 'End' ? list[list.length - 1] : list[(i + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length];
    go(n.id);
    requestAnimationFrame(() => document.getElementById(`ws-${n.id}`)?.focus());
  };
  return (
    <nav className="ws-bar" aria-label="Workspaces" data-l={edge.l} data-r={edge.r}>
      <button className="ws-arrow left" aria-label="Scroll workspaces left" tabIndex={-1} disabled={!edge.l} onClick={() => nudge(-1)}><Icon name="chevronLeft" size={18} /></button>
      <div className="ws-scroll" ref={scroller} onScroll={measure}>
        <div className="ws-track" ref={track} role="tablist" aria-label="Workspaces" onKeyDown={onKey}>
          {list.map((w, i) => (
            <button key={w.id} id={`ws-${w.id}`} role="tab" aria-selected={workspace === w.id} tabIndex={workspace === w.id ? 0 : -1} className={`ws-tab ${workspace === w.id ? 'on' : ''}`}
              title={`${w.label}: ${w.blurb}${i < 9 ? ` (Ctrl or Cmd + ${i + 1})` : ''}`} onClick={() => go(w.id)}>
              <Icon name={w.icon} size={22} /><span>{w.label}</span>
            </button>
          ))}
        </div>
      </div>
      <button className="ws-arrow right" aria-label="Scroll workspaces right" tabIndex={-1} disabled={!edge.r} onClick={() => nudge(1)}><Icon name="chevronRight" size={18} /></button>
    </nav>
  );
}

/** Cmd or Ctrl + 1..9 switches to that tab of the bar. */
export function useWorkspaceKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !/^[1-9]$/.test(e.key)) return;
      const st = useStore.getState();
      if (st.screen !== 'editor') return;
      const w = visibleWorkspaces(!!(st as unknown as { outfit?: unknown }).outfit)[Number(e.key) - 1];
      if (!w) return;
      e.preventDefault();
      st.setWorkspace(w.id);
      fitSoon();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}

export function TechPackPanel() {
  const { project, units } = usePick('project', 'units');
  const e = project.edits;
  const att = e?.attachments ?? [];
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment))?.name ?? 'Garment';
  const trims = att.filter((a) => a.kind === 'hardware' || a.kind === 'label').length;
  const designs = att.length - trims;
  const rows: { icon: string; title: string; note: string }[] = [
    { icon: 'cube', title: 'Cover', note: `${style}, 3D render, size and fit, style number` },
    { icon: 'pattern', title: 'Pattern sheet', note: `${project.pieces.length} ${project.pieces.length === 1 ? 'piece' : 'pieces'} with cut and sewing lines, grain, scale` },
    { icon: 'specs', title: 'Specs and fit table', note: 'Finished measurements against the body, ease per measurement' },
    { icon: 'seams', title: 'Seam report', note: 'Every seam with matched lengths' },
    { icon: 'garment', title: 'Materials', note: 'Fabric and colour of each piece, thread and trims' },
    { icon: 'patch', title: 'Detail sheets', note: `${designs} ${designs === 1 ? 'design' : 'designs'}, ${trims} ${trims === 1 ? 'trim or tag' : 'trims and tags'}` },
    ...(hasFinish(e?.finish) ? [{ icon: 'sparkle', title: 'Wash and distress', note: `${finishRows(project.garment, project.pieces, e?.finish, e?.attachments ?? []).length} processes with locations and process names` }] : []),
    ...((e?.edgeTrims?.length ?? 0) > 0 ? [{ icon: 'seams', title: 'Edge trims', note: `${e!.edgeTrims!.length} contrast thread, binding or piping runs in the materials list` }] : []),
    { icon: 'stripes', title: 'Bands', note: `${e?.bands?.length ?? 0} across the garment, shown in the cover render` },
    { icon: 'note', title: 'Notes', note: `${project.notes?.length ?? 0} drawn on the pattern` },
  ];
  const exportPdf = () => {
    const canvas = document.querySelector('.viewport canvas') as HTMLCanvasElement | null;
    let shot: string | null = null;
    try { shot = canvas ? canvas.toDataURL('image/png') : null; } catch { shot = null; }
    void exportTechPack(project, units, shot);
  };
  return (
    <section className="ws-page techpack" aria-label="Tech pack">
      <header className="ws-page-head">
        <div>
          <h2>Tech pack</h2>
          <p>{project.name} · what the PDF will contain</p>
        </div>
        <button className="btn primary" onClick={exportPdf}><Icon name="share" size={16} /> Export PDF</button>
      </header>
      <ol className="tp-list">
        {rows.map((r, i) => (
          <li key={r.title}>
            <span className="tp-num">{i + 1}</span>
            <span className="tp-ico" aria-hidden="true"><Icon name={r.icon} size={18} /></span>
            <span className="tp-txt"><b>{r.title}</b><small>{r.note}</small></span>
          </li>
        ))}
      </ol>
      <p className="ws-note">The cover uses the 3D view on the right, so pose and angle it the way you want it printed.</p>
    </section>
  );
}
