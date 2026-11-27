// Workspace switcher (Premiere Pro style) and the two simple workspaces: Finish (coming) and Tech pack (preview + export).
import { useEffect } from 'react';
import { useStore, usePick } from '../store';
import { WORKSPACES, type Workspace } from './designDoc';
import { exportTechPack } from '../lib/exportPdf';
import { CATALOG, migrateGarment } from '../data/catalog';
import Icon from './Icon';

export function WorkspaceSwitch() {
  const { workspace, setWorkspace } = usePick('workspace', 'setWorkspace');
  const go = (w: Workspace) => { setWorkspace(w); if (w === 'construct') requestAnimationFrame(() => window.dispatchEvent(new Event('tps-fit'))); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = WORKSPACES.findIndex((w) => w.id === workspace);
    const n = WORKSPACES[(i + (e.key === 'ArrowRight' ? 1 : WORKSPACES.length - 1)) % WORKSPACES.length];
    go(n.id);
    requestAnimationFrame(() => document.getElementById(`ws-${n.id}`)?.focus());
  };
  return (
    <div className="ws-switch" role="tablist" aria-label="Workspaces" onKeyDown={onKey}>
      {WORKSPACES.map((w) => (
        <button key={w.id} id={`ws-${w.id}`} role="tab" aria-selected={workspace === w.id} tabIndex={workspace === w.id ? 0 : -1} className={workspace === w.id ? 'on' : ''} title={`${w.label} workspace (Ctrl or Cmd + ${w.key})`} onClick={() => go(w.id)}>
          <Icon name={w.icon} size={16} /><span>{w.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Cmd or Ctrl + 1..4 switches workspace. */
export function useWorkspaceKeys() {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const w = WORKSPACES.find((q) => q.key === e.key);
      const st = useStore.getState();
      if (!w || st.screen !== 'editor') return;
      e.preventDefault();
      st.setWorkspace(w.id);
      if (w.id === 'construct') requestAnimationFrame(() => window.dispatchEvent(new Event('tps-fit')));
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);
}

export function FinishPanel() {
  return (
    <aside className="ws-side finish" aria-label="Finish">
      <div className="ws-card">
        <span className="ws-card-ico" aria-hidden="true"><Icon name="sparkle" size={22} /></span>
        <h2>Finish is coming</h2>
        <p>Wash and distressing are next: fades, whiskering, abrasion and garment dye, previewed live on the 3D garment.</p>
        <ul className="ws-soon">
          <li><Icon name="refresh" size={16} />Wash and fade</li>
          <li><Icon name="scissors" size={16} />Distressing and wear</li>
          <li><Icon name="tag" size={16} />Dye and coating</li>
        </ul>
        <p className="ws-note">Your garment stays in the 3D view while you switch workspaces, so nothing re-simulates.</p>
      </div>
    </aside>
  );
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
