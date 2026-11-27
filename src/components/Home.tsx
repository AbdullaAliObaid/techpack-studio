import { createPortal } from 'react-dom';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { type Project, type Outfit, type ThemePref, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { samplePoly } from '../lib/geometry';
import { listProjects } from '../lib/projects';
import { Mark } from './Logo';
import Icon from './Icon';
import { Sketch } from './Sketches';
import { duplicateProject, openNewFlow, openProject, openProjectSaved, removeProject, renameProject, since, openOutfitNav } from './nav';
import { NewOutfitSheet, OutfitThumb } from './Outfits';
import { deleteOutfit, exportProjectFile, importTechitFile, installOutfitFallback, listOutfits, saveOutfit, shareProjects } from './uiData';
import { saveProject } from '../lib/projects';
import { uid } from '../lib/units';

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
  const [confirm, setConfirm] = useState<{ id: string; name: string; outfit?: boolean } | null>(null);
  const [outfits, setOutfits] = useState<Outfit[]>([]);
  const [outfitSheet, setOutfitSheet] = useState(false);
  const [drop, setDrop] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => { setList(listProjects()); setOutfits(listOutfits()); }, []);
  const say = (m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3600); };
  useEffect(() => { installOutfitFallback(); }, []);

  const importFiles = async (files: FileList | File[] | null) => {
    const fs = Array.from(files ?? []);
    if (!fs.length) return;
    let n = 0;
    for (const f of fs) {
      try { const r = await importTechitFile(f); n += r.projects.length; } catch (e) { say((e as Error).message); return; }
    }
    refresh();
    say(n === 1 ? 'Imported 1 project. Find it under Imported.' : `Imported ${n} projects. Find them under Imported.`);
  };
  const share = async (ps: Project[], os: Outfit[] = []) => {
    const r = await shareProjects(ps, os);
    if (r === 'downloaded') say('Saved a .techit file. Send it to anyone with tech-it.');
  };
  const active = screen === 'home';

  useEffect(() => { if (screen === 'home') refresh(); }, [screen, refresh]);

  const current = list.find((p) => p.id === project.id);
  const hasCurrent = active && !!current && openProjectSaved();
  const mine = list.filter((p) => !p.imported);
  const imported = list.filter((p) => !!p.imported);
  const entries = [...mine.map((p) => ({ kind: 'project' as const, at: p.updatedAt, p })), ...outfits.map((o) => ({ kind: 'outfit' as const, at: o.updatedAt, o }))].sort((a, b) => b.at - a.at);
  const copyToMine = (p: Project) => { saveProject({ ...structuredClone(p), id: uid(), name: `${p.name} copy`, imported: undefined, updatedAt: Date.now() }); refresh(); say('Copied to Your projects.'); };

  const THEMES: { id: ThemePref; label: string; icon: string }[] = [
    { id: 'system', label: 'System', icon: 'auto' },
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];

  const open = (p: Project) => openProject(p);
  const doDuplicate = (p: Project) => { duplicateProject(p); refresh(); };

  return (
    <section className="home" aria-label="Home" aria-hidden={!active} onClick={() => setMenu(null)}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDrop(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrop(false); }}
      onDrop={(e) => { e.preventDefault(); setDrop(false); void importFiles(e.dataTransfer.files); }}>
      <header className="home-bar">
        <div className="home-brand"><Mark size={22} /><span>tech-it</span></div>
        <div className="home-bar-end">
        <button className="btn" onClick={() => fileRef.current?.click()} title="Open a .techit file someone shared with you"><Icon name="folder" size={16} /> Import</button>
        <input ref={fileRef} type="file" accept=".techit,application/json" multiple hidden aria-label="Import a .techit file" onChange={(e) => { void importFiles(e.target.files); e.target.value = ''; }} />
        <div className="seg" role="group" aria-label="Appearance">
          {THEMES.map((t) => (
            <button key={t.id} className={theme === t.id ? 'on' : ''} aria-pressed={theme === t.id} aria-label={t.label} title={t.label} onClick={() => set({ theme: t.id })}>
              <Icon name={t.icon} size={16} />
            </button>
          ))}
        </div>
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
          <button className="outfit-card" onClick={() => setOutfitSheet(true)} aria-label="New outfit">
            <span className="oc-art" aria-hidden="true"><Icon name="layers" size={22} /></span>
            <span className="oc-text"><b>New outfit</b><small>Try a shirt and jeans together on one body.</small></span>
            <Icon name="plus" size={18} />
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
          {entries.length === 0 ? (
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
              {entries.map((en) => {
                const id = en.kind === 'project' ? en.p.id : en.o.id;
                const name = en.kind === 'project' ? en.p.name : en.o.name;
                return (
                <li key={id} className={`proj-card ${en.kind === 'outfit' ? 'is-outfit' : ''}`} onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ id, x: e.clientX, y: e.clientY, opener: null }); }}>
                  <button className="proj-open" onClick={() => (en.kind === 'project' ? open(en.p) : openOutfitNav(en.o.id))} aria-label={`Open ${name}${en.kind === 'outfit' ? ', outfit' : ''}`}>
                    <span className="proj-art">{en.kind === 'project' ? <ProjectThumb project={en.p} /> : <OutfitThumb outfit={en.o} />}</span>
                    {en.kind === 'outfit' && <span className="badge on-art">Outfit</span>}
                  </button>
                  <div className="proj-info">
                    <div className="proj-text">
                      {renaming === id ? (
                        <RenameField value={name} onDone={(v) => {
                          if (v !== null && v.trim()) { if (en.kind === 'project') renameProject(en.p, v); else saveOutfit({ ...en.o, name: v.trim(), updatedAt: Date.now() }); refresh(); }
                          setRenaming(null);
                        }} />
                      ) : (
                        <b className="proj-title" title={name}>{name}</b>
                      )}
                      <small>{en.kind === 'project' ? styleName(en.p.garment) : `${en.o.items.length} ${en.o.items.length === 1 ? 'garment' : 'garments'}`} · {since(en.at)}</small>
                    </div>
                    <button
                      className="icon-btn proj-more" aria-label={`More actions for ${name}`} aria-haspopup="menu" aria-expanded={menu?.id === id}
                      onClick={(e) => {
                        e.stopPropagation();
                        const r = e.currentTarget.getBoundingClientRect();
                        setMenu(menu?.id === id ? null : { id, x: r.right, y: r.bottom + 4, opener: e.currentTarget });
                      }}
                    >
                      <Icon name="more" size={20} />
                    </button>
                  </div>
                </li>
                );
              })}
            </ul>
          )}

          {imported.length > 0 && (
            <section className="imported" aria-labelledby="imp-h">
              <div className="home-section-head"><h2 id="imp-h">Imported</h2><span className="muted">Shared with you. Your own projects stay separate.</span></div>
              <ul className="imp-list">
                {imported.map((p) => (
                  <li key={p.id} className="imp-row">
                    <button className="imp-open" onClick={() => open(p)} aria-label={`Open ${p.name}`}>
                      <span className="imp-art"><ProjectThumb project={p} /></span>
                      <span className="imp-text"><b>{p.name}</b><small>{styleName(p.garment)} · from {p.imported?.from ?? 'someone'} · {since(p.imported?.at ?? p.updatedAt)}</small></span>
                    </button>
                    <button className="btn small" onClick={() => copyToMine(p)}><Icon name="copy" size={14} /> Copy to my projects</button>
                    <button className="icon-btn" aria-label={`More actions for ${p.name}`} aria-haspopup="menu" onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); setMenu(menu?.id === p.id ? null : { id: p.id, x: r.right, y: r.bottom + 4, opener: e.currentTarget }); }}><Icon name="more" size={20} /></button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {menu && createPortal(
        <CardMenu
          state={menu}
          onClose={() => { menu.opener?.focus(); setMenu(null); }}
          onRename={() => { setRenaming(menu.id); setMenu(null); }}
          outfit={outfits.some((q) => q.id === menu.id)}
          onDuplicate={() => { const p = list.find((q) => q.id === menu.id); if (p) doDuplicate(p); setMenu(null); }}
          onShare={() => {
            const o = outfits.find((q) => q.id === menu.id);
            const ps = o ? o.items.map((i) => list.find((q) => q.id === i.projectId)).filter(Boolean) as Project[] : list.filter((q) => q.id === menu.id);
            setMenu(null); void share(ps, o ? [o] : []);
          }}
          onExport={() => {
            const o = outfits.find((q) => q.id === menu.id);
            const ps = o ? o.items.map((i) => list.find((q) => q.id === i.projectId)).filter(Boolean) as Project[] : list.filter((q) => q.id === menu.id);
            setMenu(null); exportProjectFile(ps, o ? [o] : []); say('Saved a .techit file.');
          }}
          onDelete={() => { const o = outfits.find((q) => q.id === menu.id); const p = list.find((q) => q.id === menu.id); const t = o ?? p; setConfirm(t ? { id: t.id, name: t.name, outfit: !!o } : null); setMenu(null); }}
        />,
        document.body,
      )}
      {confirm && createPortal(
        <ConfirmDelete
          project={confirm}
          onCancel={() => setConfirm(null)}
          onDelete={() => { if (confirm.outfit) deleteOutfit(confirm.id); else removeProject(confirm.id); setConfirm(null); refresh(); }}
        />,
        document.body,
      )}
      {outfitSheet && <NewOutfitSheet onClose={() => setOutfitSheet(false)} onDone={(id) => { setOutfitSheet(false); openOutfitNav(id); }} />}
      {drop && <div className="drop-veil" aria-hidden="true"><div><Icon name="folder" size={28} /><b>Drop a .techit file to import</b></div></div>}
      {toast && <div className="toast material" role="status">{toast}</div>}
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

function CardMenu({ state, onClose, onRename, onDuplicate, onDelete, onShare, onExport, outfit }: { state: NonNullable<MenuState>; onClose: () => void; onRename: () => void; onDuplicate: () => void; onDelete: () => void; onShare: () => void; onExport: () => void; outfit?: boolean }) {
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
      {!outfit && <button role="menuitem" className="menu-row" onClick={onDuplicate}><Icon name="copy" size={18} /><span>Duplicate</span></button>}
      <button role="menuitem" className="menu-row" onClick={onShare}><Icon name="share" size={18} /><span>Share…</span></button>
      <button role="menuitem" className="menu-row" onClick={onExport}><Icon name="folder" size={18} /><span>Export file</span></button>
      <div className="menu-sep" role="separator" />
      <button role="menuitem" className="menu-row danger" onClick={onDelete}><Icon name="trash" size={18} /><span>Delete</span></button>
    </div>
  );
}

function ConfirmDelete({ project, onCancel, onDelete }: { project: { name: string }; onCancel: () => void; onDelete: () => void }) {
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
