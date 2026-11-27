import Logo from './Logo';
import { useEffect, useRef, useState } from 'react';
import { useStore, type Project, type ThemePref, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import Icon from './Icon';
import { deleteProject, listProjects, saveProject } from '../lib/projects';
import { uid } from '../lib/units';
import { exportTechPack } from '../lib/exportPdf';
import { piecesToDxf } from '../lib/exportDxf';
import { flushSave, goHome, openNewFlow } from './nav';
import { exportProjectFile, shareProjects } from './uiData';

export default function TopBar() {
  const { project, units, past, future, set, undo, redo, loadProject, rename, theme, drawer } = usePick('project', 'units', 'past', 'future', 'set', 'undo', 'redo', 'loadProject', 'rename', 'theme', 'drawer');
  const [menu, setMenu] = useState<'open' | 'export' | 'theme' | null>(null);
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
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('tps-saved', on);
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, []);

  const openMenu = (m: 'open' | 'export' | 'theme') => {
    if (m === 'open') setList(listProjects());
    setMenu(menu === m ? null : m);
  };

  const exportPdf = () => {
    const canvas = document.querySelector('.viewport canvas') as HTMLCanvasElement | null;
    let shot: string | null = null;
    try { shot = canvas ? canvas.toDataURL('image/png') : null; } catch { shot = null; }
    exportTechPack(project, units, shot);
  };
  const exportDxf = () => {
    const b = project.body;
    const dxf = piecesToDxf(project.pieces, { project: project.name, size: `H${Math.round(b.height)} C${Math.round(b.chest)} W${Math.round(b.waist)} H${Math.round(b.hips)}` }, undefined, project.edits, project.garment);
    const url = URL.createObjectURL(new Blob([dxf], { type: 'application/dxf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/[^a-z0-9]+/gi, '_')}_pattern.dxf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const duplicate = () => {
    const copy: Project = { ...structuredClone(project), id: uid(), name: project.name + ' copy', updatedAt: Date.now() };
    saveProject(project);
    loadProject(copy);
  };

  const styleName = (g: string) => CATALOG.find((x) => x.id === migrateGarment(g))?.name ?? g;
  const THEMES: { id: ThemePref; label: string; icon: string }[] = [
    { id: 'system', label: 'System', icon: 'auto' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];
  const themeIcon = THEMES.find((t) => t.id === theme)!.icon;

  return (
    <header className="topbar material" ref={ref}>
      <button className="brand" onClick={goHome} title="Home: all your projects" aria-label="Home">
        <Logo size={22} />
        <span>tech-it</span>
      </button>

      <div className="menus">
        <button className="btn ghost" title="Start a new project" onClick={() => { setMenu(null); openNewFlow('create', 'editor'); }}>
          <Icon name="plus" size={16} /> New
        </button>
        <div className="menu-wrap">
          <button className="btn ghost" aria-haspopup="menu" aria-expanded={menu === 'open'} onClick={() => openMenu('open')}>
            <Icon name="folder" size={16} /> Projects <Icon name="chevron" size={12} />
          </button>
          {menu === 'open' && (
            <div className="menu wide" role="menu">
              <button role="menuitem" className="menu-row" onClick={() => { setMenu(null); goHome(); }}><Icon name="home" size={18} /><span>All projects</span></button>
              <button role="menuitem" className="menu-row" onClick={() => { setMenu(null); openNewFlow('change', 'editor'); }}><Icon name="garment" size={18} /><span>Change style of this project…</span></button>
              <button role="menuitem" className="menu-row" onClick={() => { setMenu(null); void shareProjects([project]); }}><Icon name="share" size={18} /><span>Share…</span></button>
              <button role="menuitem" className="menu-row" onClick={() => { setMenu(null); exportProjectFile([project]); }}><Icon name="folder" size={18} /><span>Export file</span></button>
              <div className="menu-sep" role="separator" />
              <div className="menu-label">Saved on this device</div>
              {list.length === 0 && <div className="menu-empty">No saved projects yet</div>}
              {list.map((p) => (
                <div className={`menu-item ${p.id === project.id ? 'on' : ''}`} key={p.id}>
                  <button role="menuitem" onClick={() => { flushSave(); loadProject(p); setMenu(null); }}>
                    <b>{p.name}</b>
                    <small>{styleName(p.garment)} · {new Date(p.updatedAt).toLocaleString()}</small>
                  </button>
                  {p.id !== project.id && (
                    <button className="x" title="Delete project" aria-label={`Delete ${p.name}`} onClick={() => { deleteProject(p.id); setList(listProjects()); }}><Icon name="close" size={14} /></button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn ghost" title="Duplicate this project" onClick={duplicate}><Icon name="copy" size={16} /> Duplicate</button>
        <div className="menu-wrap">
          <button className="btn ghost" aria-haspopup="menu" aria-expanded={menu === 'export'} onClick={() => openMenu('export')}>
            <Icon name="share" size={16} /> Export <Icon name="chevron" size={12} />
          </button>
          {menu === 'export' && (
            <div className="menu wide" role="menu">
              <div className="menu-label">Send to a factory</div>
              <button role="menuitem" onClick={() => { exportPdf(); setMenu(null); }}>
                <b>Tech pack (PDF)</b>
                <small>Cover with 3D render, pattern sheet, specs, fit, seams, materials</small>
              </button>
              <button role="menuitem" onClick={() => { exportDxf(); setMenu(null); }}>
                <b>Pattern (DXF)</b>
                <small>Full size, cut and sewing lines, grain lines, in mm</small>
              </button>
              <div className="menu-label">Share with people</div>
              <button role="menuitem" onClick={() => { exportProjectFile([project]); setMenu(null); }}>
                <b>Project file (.techit)</b>
                <small>Others can import it into their tech-it and keep editing</small>
              </button>
            </div>
          )}
        </div>
      </div>

      <input className="proj-name" aria-label="Project name" value={project.name} onChange={(e) => rename(e.target.value)} />
      <span className="save-state" role="status">{saved ? 'Saved' : 'Saving…'}</span>

      <div className="spacer" />

      <button className="icon-btn drawer-toggle" title="Show or hide the inspector" aria-label="Show or hide the inspector" aria-pressed={drawer} onClick={() => set({ drawer: !drawer })}><Icon name="sidebar" /></button>
      <button className="icon-btn" disabled={!past.length} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo"><Icon name="undo" /></button>
      <button className="icon-btn" disabled={!future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Icon name="redo" /></button>
      <div className="seg" role="group" aria-label="Units">
        <button className={units === 'cm' ? 'on' : ''} aria-pressed={units === 'cm'} onClick={() => set({ units: 'cm' })}>cm</button>
        <button className={units === 'in' ? 'on' : ''} aria-pressed={units === 'in'} onClick={() => set({ units: 'in' })}>in</button>
      </div>
      <div className="menu-wrap">
        <button className="icon-btn" title="Appearance" aria-label="Appearance" aria-haspopup="menu" aria-expanded={menu === 'theme'} onClick={() => openMenu('theme')}>
          <Icon name={themeIcon} />
        </button>
        {menu === 'theme' && (
          <div className="menu right" role="menu">
            <div className="menu-label">Appearance</div>
            {THEMES.map((t) => (
              <button key={t.id} role="menuitemradio" aria-checked={theme === t.id} className="menu-row" onClick={() => { set({ theme: t.id }); setMenu(null); }}>
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
                <span className="tick">{theme === t.id && <Icon name="check" size={16} />}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  );
}
