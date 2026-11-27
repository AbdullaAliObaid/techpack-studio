import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore, type Project, type ThemePref, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { samplePoly } from '../lib/geometry';
import { listProjects } from '../lib/projects';
import { Mark } from './Logo';
import Icon from './Icon';
import { Sketch } from './Sketches';
import { duplicateProject, openNewFlow, openProject, openProjectSaved, removeProject, renameProject, since } from './nav';

/* Home: the start screen, like the one in Photoshop or Procreate. A big New project card on one side,
   your projects on the other. */

const styleName = (g: string) => CATALOG.find((x) => x.id === migrateGarment(g))?.name ?? g;

/** The pattern pieces of a project as a small drawing. */
export function ProjectThumb({ project }: { project: Project }) {
  const { paths, box } = useMemo(() => {
    const polys = project.pieces.map((pc) => samplePoly(pc.points, 10).map((p) => ({ x: p.x + pc.offset.x, y: p.y + pc.offset.y })));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const poly of polys) for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 10; y1 = 10; }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
    return {
      paths: polys.map((poly) => 'M' + poly.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + 'Z'),
      box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`,
    };
  }, [project.pieces]);
  return (
    <svg className="proj-thumb" viewBox={box} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}

function NewArt() {
  return (
    <svg className="new-art" viewBox="0 0 220 150" fill="none" aria-hidden="true" focusable="false">
      <g className="new-art-piece" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M82 18L60 28L42 54L56 63L66 52V126H134V52L144 63L158 54L140 28L118 18Q100 36 82 18Z" strokeDasharray="1 7" />
        <path d="M82 18Q100 36 118 18" opacity="0.6" />
      </g>
      <g transform="translate(150 96)">
        <g className="plus-pop">
          <circle r="24" />
          <path d="M0 -10V10M-10 0H10" stroke="var(--accent-fill)" strokeWidth="3.4" strokeLinecap="round" />
        </g>
      </g>
    </svg>
  );
}

type MenuState = { id: string; x: number; y: number; opener: HTMLElement | null } | null;

export default function Home() {
  const { screen, project, theme, set } = usePick('screen', 'project', 'theme', 'set');
  const [list, setList] = useState<Project[]>([]);
  const [menu, setMenu] = useState<MenuState>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Project | null>(null);
  const refresh = useCallback(() => setList(listProjects()), []);
  const active = screen === 'home';

  useEffect(() => { if (screen === 'home') refresh(); }, [screen, refresh]);

  const current = list.find((p) => p.id === project.id);
  const hasCurrent = active && !!current && openProjectSaved();

  const THEMES: { id: ThemePref; label: string; icon: string }[] = [
    { id: 'system', label: 'System', icon: 'auto' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];

  const open = (p: Project) => openProject(p);
  const doDuplicate = (p: Project) => { duplicateProject(p); refresh(); };

  return (
    <section className="home" aria-label="Home" aria-hidden={!active} onClick={() => setMenu(null)}>
      <header className="home-bar">
        <div className="home-brand"><Mark size={22} /><span>tech-it</span></div>
        <div className="seg" role="group" aria-label="Appearance">
          {THEMES.map((t) => (
            <button key={t.id} className={theme === t.id ? 'on' : ''} aria-pressed={theme === t.id} aria-label={t.label} title={t.label} onClick={() => set({ theme: t.id })}>
              <Icon name={t.icon} size={16} />
            </button>
          ))}
        </div>
      </header>

      <div className="home-body">
        <div className="home-start">
          <h1 className="home-title">What are we making today?</h1>
          <button className="new-card" onClick={() => openNewFlow('create', 'home')} aria-label="New project">
            <NewArt />
            <span className="new-card-text">
              <span className="new-card-title">New project</span>
              <span className="new-card-sub">Pick a style, set the fit, and start drafting.</span>
            </span>
            <span className="new-card-go" aria-hidden="true"><Icon name="chevronRight" size={20} /></span>
          </button>
          {hasCurrent && current && (
            <button className="continue-card" onClick={() => open(current)} aria-label={`Continue editing ${current.name}`}>
              <span className="continue-thumb"><ProjectThumb project={current} /></span>
              <span className="continue-text">
                <small>Continue where you left off</small>
                <b>{current.name}</b>
              </span>
              <Icon name="chevronRight" size={18} />
            </button>
          )}
        </div>

        <div className="home-projects">
          <div className="home-section-head">
            <h2>Your projects</h2>
            {list.length > 0 && <span className="muted">{list.length} on this device</span>}
          </div>
          {list.length === 0 ? (
            <div className="home-empty">
              <svg viewBox="0 0 120 70" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
                <path d="M10 35H110" strokeDasharray="1 7" strokeWidth="3" />
                <g transform="translate(34 35) scale(0.55)"><circle cx="-8" cy="-16" r="9" /><circle cx="-8" cy="16" r="9" /><path d="M0 -8L44 14M0 8L44 -14" /></g>
              </svg>
              <h3>Nothing here yet</h3>
              <p>Projects you start are saved on this device and show up here.</p>
              <button className="btn primary" onClick={() => openNewFlow('create', 'home')}><Icon name="plus" size={16} /> New project</button>
            </div>
          ) : (
            <ul className="proj-grid">
              {list.map((p) => (
                <li key={p.id} className="proj-card" onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ id: p.id, x: e.clientX, y: e.clientY, opener: null }); }}>
                  <button className="proj-open" onClick={() => open(p)} aria-label={`Open ${p.name}`}>
                    <span className="proj-art"><ProjectThumb project={p} /></span>
                  </button>
                  <div className="proj-info">
                    <div className="proj-text">
                      {renaming === p.id ? (
                        <RenameField value={p.name} onDone={(v) => { if (v !== null) { renameProject(p, v); refresh(); } setRenaming(null); }} />
                      ) : (
                        <b className="proj-title" title={p.name}>{p.name}</b>
                      )}
                      <small>{styleName(p.garment)} · {since(p.updatedAt)}</small>
                    </div>
                    <button
                      className="icon-btn proj-more" aria-label={`More actions for ${p.name}`} aria-haspopup="menu" aria-expanded={menu?.id === p.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu(menu?.id === p.id ? null : { id: p.id, x: r.right, y: r.bottom + 4, opener: e.currentTarget });
                      }}
                    >
                      <Icon name="more" size={20} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {menu && createPortal(
        <CardMenu
          state={menu}
          onClose={() => { menu.opener?.focus(); setMenu(null); }}
          onRename={() => { setRenaming(menu.id); setMenu(null); }}
          onDuplicate={() => { const p = list.find((q) => q.id === menu.id); if (p) doDuplicate(p); setMenu(null); }}
          onDelete={() => { setConfirm(list.find((q) => q.id === menu.id) ?? null); setMenu(null); }}
        />,
        document.body,
      )}
      {confirm && createPortal(
        <ConfirmDelete
          project={confirm}
          onCancel={() => setConfirm(null)}
          onDelete={() => { removeProject(confirm.id); setConfirm(null); refresh(); }}
        />,
        document.body,
      )}
    </section>
  );
}

function RenameField({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(value);
  const done = useRef(false);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const finish = (val: string | null) => { if (done.current) return; done.current = true; onDone(val); };
  return (
    <input
      ref={ref} className="proj-rename" aria-label="Project name" value={v} maxLength={60}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(v)}
      onKeyDown={(e) => { if (e.key === 'Enter') finish(v); else if (e.key === 'Escape') { e.stopPropagation(); finish(null); } }}
    />
  );
}

function CardMenu({ state, onClose, onRename, onDuplicate, onDelete }: { state: NonNullable<MenuState>; onClose: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: state.x, top: state.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // the opener anchors the menu's right edge; a right click anchors its left edge
    const left = state.opener ? state.x - r.width : state.x;
    setPos({ left: Math.max(8, Math.min(left, window.innerWidth - r.width - 8)), top: Math.max(8, Math.min(state.y, window.innerHeight - r.height - 8)) });
    el.querySelector<HTMLButtonElement>('button')?.focus();
  }, [state]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  return (
    <div ref={ref} className="menu home-menu" role="menu" style={pos} onClick={(e) => e.stopPropagation()}>
      <button role="menuitem" className="menu-row" onClick={onRename}><Icon name="draw" size={18} /><span>Rename</span></button>
      <button role="menuitem" className="menu-row" onClick={onDuplicate}><Icon name="copy" size={18} /><span>Duplicate</span></button>
      <div className="menu-sep" role="separator" />
      <button role="menuitem" className="menu-row danger" onClick={onDelete}><Icon name="trash" size={18} /><span>Delete</span></button>
    </div>
  );
}

function ConfirmDelete({ project, onCancel, onDelete }: { project: Project; onCancel: () => void; onDelete: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { cancel.current?.focus(); }, []);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    if (e.key === 'Tab') {
      const items = [...(root.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const i = items.indexOf(document.activeElement as HTMLButtonElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length]?.focus();
    }
  };
  return (
    <div className="sheet-backdrop" onClick={onCancel} onKeyDown={key}>
      <div ref={root} className="sheet alert material" role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-body" onClick={(e) => e.stopPropagation()}>
        <h2 id="del-title">Delete “{project.name}”?</h2>
        <p id="del-body" className="alert-body">This project is removed from this device and cannot be recovered.</p>
        <div className="alert-actions">
          <button ref={cancel} className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn danger-fill" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}
