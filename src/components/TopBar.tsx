import { useEffect, useRef, useState } from 'react';
import { useStore, type Project } from '../store';
import { GARMENT_LABEL, type GarmentType } from '../data/presets';
import { deleteProject, listProjects, saveProject } from '../lib/projects';
import { uid } from '../lib/units';

export default function TopBar() {
  const { project, units, past, future, set, undo, redo, newProject, loadProject, rename } = useStore();
  const [menu, setMenu] = useState<'new' | 'open' | null>(null);
  const [saved, setSaved] = useState(true);
  const [list, setList] = useState<Project[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const firstStamp = useRef(project.updatedAt);
  useEffect(() => {
    if (project.updatedAt !== firstStamp.current) setSaved(false);
  }, [project.updatedAt]);
  useEffect(() => {
    const on = () => setSaved(true);
    window.addEventListener('tps-saved', on);
    const close = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => {
      window.removeEventListener('tps-saved', on);
      window.removeEventListener('pointerdown', close);
    };
  }, []);

  const openMenu = (m: 'new' | 'open') => {
    if (m === 'open') setList(listProjects());
    setMenu(menu === m ? null : m);
  };

  const duplicate = () => {
    const copy: Project = { ...structuredClone(project), id: uid(), name: project.name + ' copy', updatedAt: Date.now() };
    saveProject(project);
    loadProject(copy);
  };

  return (
    <header className="topbar" ref={ref}>
      <div className="brand">
        <svg width="22" height="22" viewBox="0 0 24 24"><path d="M8 3l4 2 4-2 5 4-3 4-2-1v11H8V10l-2 1-3-4z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>
        <span>tech-it</span>
      </div>

      <div className="menus">
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => openMenu('new')}>New ▾</button>
          {menu === 'new' && (
            <div className="menu">
              <div className="menu-label">Start from a preset</div>
              {(Object.keys(GARMENT_LABEL) as GarmentType[]).map((g) => (
                <button key={g} onClick={() => { newProject(g); setMenu(null); }}>{GARMENT_LABEL[g]}</button>
              ))}
            </div>
          )}
        </div>
        <div className="menu-wrap">
          <button className="btn ghost" onClick={() => openMenu('open')}>Projects ▾</button>
          {menu === 'open' && (
            <div className="menu wide">
              <div className="menu-label">Saved on this device</div>
              {list.length === 0 && <div className="menu-empty">No saved projects yet</div>}
              {list.map((p) => (
                <div className={`menu-item ${p.id === project.id ? 'on' : ''}`} key={p.id}>
                  <button onClick={() => { loadProject(p); setMenu(null); }}>
                    <b>{p.name}</b>
                    <small>{GARMENT_LABEL[p.garment]} · {new Date(p.updatedAt).toLocaleString()}</small>
                  </button>
                  {p.id !== project.id && (
                    <button className="x" title="Delete" onClick={() => { deleteProject(p.id); setList(listProjects()); }}>✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn ghost" onClick={duplicate}>Duplicate</button>
      </div>

      <input className="proj-name" value={project.name} onChange={(e) => rename(e.target.value)} />
      <span className="save-state">{saved ? 'Saved' : 'Saving…'}</span>

      <div className="spacer" />

      <button className="icon-btn" disabled={!past.length} onClick={undo} title="Undo (Ctrl+Z)">
        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <button className="icon-btn" disabled={!future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)">
        <svg width="18" height="18" viewBox="0 0 24 24"><path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="seg">
        <button className={units === 'cm' ? 'on' : ''} onClick={() => set({ units: 'cm' })}>cm</button>
        <button className={units === 'in' ? 'on' : ''} onClick={() => set({ units: 'in' })}>in</button>
      </div>
    </header>
  );
}
