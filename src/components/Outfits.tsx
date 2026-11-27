// Outfits: several garment projects worn together on one body.
// NewOutfitSheet (Home), OutfitBar (editor top), OutfitPatterns (left of the chart), OutfitThumb (Home card).
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, freshProject, type Outfit, type OutfitItem, type Project } from '../store';
import { CATALOG, CATEGORIES, migrateGarment, styleById, type StyleId } from '../data/catalog';
import { samplePoly } from '../lib/geometry';
import { listProjects, saveProject } from '../lib/projects';
import type { Body } from '../three/body';
import type { Piece } from '../data/presets';
import { Sketch } from './Sketches';
import { BodyChoice } from './BodyPresets';
import { Sheet } from './Sheets';
import { ProjectThumb } from './Home';
import Icon from './Icon';
import { allBodyPresets, byLayer, installOutfitFallback, outfitApi, useActiveItem, useOutfit, listOutfits } from './uiData';
import { flushSave } from './nav';

const styleOf = (p: Project) => styleById(migrateGarment(p.garment));
const isTop = (p: Project) => { const c = styleOf(p).category as string; return c === 'tops'; };
/** natural order against the skin: bottoms, tops, jackets, headwear */
const rank = (p: Project) => { const s = styleOf(p); return s.category === 'bottoms' ? 0 : s.family === 'jacket' ? 2 : s.category === 'headwear' ? 3 : 1; };

/** Projects of an outfit as saved on this device; the open project is the live copy. */
export function useOutfitProjects(o: Outfit | null): Map<string, Project> {
  const live = useStore((s) => s.project);
  return useMemo(() => {
    const m = new Map<string, Project>();
    if (!o) return m;
    const saved = new Map(listProjects().map((p) => [p.id, p]));
    for (const it of o.items) { const p = it.projectId === live.id ? live : saved.get(it.projectId); if (p) m.set(it.projectId, p); }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o, live.id, live.updatedAt]);
}

/* ------------------------------------------------------------------ Home card thumbnail */

export function OutfitThumb({ outfit }: { outfit: Outfit }) {
  const saved = useMemo(() => new Map(listProjects().map((p) => [p.id, p])), []);
  const items = byLayer(outfit.items).map((i) => saved.get(i.projectId)).filter(Boolean) as Project[];
  return (
    <span className="outfit-stack" aria-hidden="true">
      {items.slice(0, 3).map((p, i) => <span key={p.id} className="os-layer" style={{ ['--i' as string]: i, ['--n' as string]: Math.min(3, items.length) }}><ProjectThumb project={p} /></span>)}
      {!items.length && <span className="os-empty"><Icon name="layers" size={28} /></span>}
    </span>
  );
}

/* ------------------------------------------------------------------ new outfit sheet */

interface Pick { id: string; tuck: 'in' | 'out' }

export function NewOutfitSheet({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState(() => { const n = listOutfits().length; return n ? `Outfit ${n + 1}` : 'My outfit'; });
  const [bodyId, setBodyId] = useState('builtin-male');
  const [body, setBody] = useState<Body>(() => allBodyPresets()[0].body);
  const [projects, setProjects] = useState<Project[]>(() => listProjects());
  const [picked, setPicked] = useState<Pick[]>([]);
  const [adding, setAdding] = useState(false);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const has = (id: string) => picked.some((p) => p.id === id);
  const toggle = (p: Project) => setPicked((cur) => {
    if (cur.some((c) => c.id === p.id)) return cur.filter((c) => c.id !== p.id);
    const next = [...cur, { id: p.id, tuck: 'out' as const }];
    // new garments slot in by their natural layer unless the person already ordered them by hand
    return next.sort((a, b) => (cur.some((c) => c.id === a.id) && cur.some((c) => c.id === b.id) ? 0 : rank(byId.get(a.id)!) - rank(byId.get(b.id)!)));
  });
  const move = (from: number, to: number) => setPicked((cur) => { if (to < 0 || to >= cur.length) return cur; const a = cur.slice(); const [it] = a.splice(from, 1); a.splice(to, 0, it); return a; });
  const create = (style: StyleId) => {
    const p = freshProject(style, `${styleById(style).name}`, body);
    saveProject(p);
    setProjects(listProjects());
    const rk = new Map(projects.map((q) => [q.id, rank(q)]));
    rk.set(p.id, rank(p));
    setPicked((cur) => [...cur, { id: p.id, tuck: 'out' as const }].sort((x, y) => (cur.some((c) => c.id === x.id) && cur.some((c) => c.id === y.id) ? 0 : (rk.get(x.id) ?? 1) - (rk.get(y.id) ?? 1))));
    setAdding(false);
  };
  const go = () => {
    installOutfitFallback();
    const api = outfitApi();
    flushSave();
    const id = api.newOutfit(name.trim() || 'My outfit', body) ?? outfitApi().outfit?.id ?? '';
    picked.forEach((p) => api.addToOutfit(p.id));
    picked.forEach((p, i) => { api.setOutfitLayer(p.id, i); if (isTop(byId.get(p.id)!)) api.setTuck(p.id, p.tuck); });
    onDone(id);
  };
  return (
    <Sheet title="New outfit" onClose={onClose} wide label="New outfit">
      <p className="step-sub" style={{ marginTop: -6 }}>Wear several garments together on one body to check the whole fit.</p>
      <div className="of-grid">
        <div className="of-col">
          <label className="field-label" htmlFor="of-name">Name</label>
          <input id="of-name" data-autofocus className="txt wide" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <span className="field-label" id="of-body">Body</span>
          <BodyChoice value={bodyId} labelledBy="of-body" onChange={(id, b) => { setBodyId(id); setBody(b); }} />
          <span className="field-label">Garments <small className="muted">{picked.length} chosen</small></span>
          <ul className="of-pick" aria-label="Your projects">
            {projects.map((p) => (
              <li key={p.id}>
                <button className={`of-pick-row ${has(p.id) ? 'on' : ''}`} aria-pressed={has(p.id)} onClick={() => toggle(p)}>
                  <span className="of-pick-art"><Sketch id={migrateGarment(p.garment)} decorative /></span>
                  <span className="of-pick-text"><b>{p.name}</b><small>{styleOf(p).name}</small></span>
                  <span className="of-check" aria-hidden="true">{has(p.id) && <Icon name="check" size={14} />}</span>
                </button>
              </li>
            ))}
            {!projects.length && <li className="group-note" style={{ padding: 0 }}>No projects yet. Create a garment below.</li>}
          </ul>
          {!adding ? (
            <button className="btn" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> New garment</button>
          ) : (
            <StylePicker onPick={create} onCancel={() => setAdding(false)} />
          )}
        </div>
        <div className="of-col">
          <span className="field-label">Layer order <small className="muted">closest to the skin first</small></span>
          <LayerList picked={picked} byId={byId} onMove={move} onTuck={(id, t) => setPicked((c) => c.map((q) => (q.id === id ? { ...q, tuck: t } : q)))} />
        </div>
      </div>
      <div className="alert-actions">
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!picked.length} onClick={go}>Create outfit</button>
      </div>
    </Sheet>
  );
}

function StylePicker({ onPick, onCancel }: { onPick: (s: StyleId) => void; onCancel: () => void }) {
  const [cat, setCat] = useState<string>(CATEGORIES[0].id);
  return (
    <div className="of-styles">
      <div className="seg full" role="group" aria-label="Garment type">
        {CATEGORIES.map((c) => <button key={c.id} className={cat === c.id ? 'on' : ''} aria-pressed={cat === c.id} onClick={() => setCat(c.id)}>{c.name}</button>)}
      </div>
      <div className="of-style-grid">
        {CATALOG.filter((s) => s.category === cat).map((s) => (
          <button key={s.id} className="of-style" onClick={() => onPick(s.id)}><span className="of-pick-art"><Sketch id={s.id} decorative /></span><span>{s.name}</span></button>
        ))}
      </div>
      <button className="btn small ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

function LayerList({ picked, byId, onMove, onTuck }: { picked: Pick[]; byId: Map<string, Project>; onMove: (a: number, b: number) => void; onTuck: (id: string, t: 'in' | 'out') => void }) {
  const ref = useRef<HTMLOListElement>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const start = (e: React.PointerEvent, from: number) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ from, over: from });
  };
  const moveTo = (e: React.PointerEvent) => {
    if (!drag || !ref.current) return;
    const rows = [...ref.current.children] as HTMLElement[];
    let over = drag.over;
    rows.forEach((r, i) => { const b = r.getBoundingClientRect(); if (e.clientY >= b.top && e.clientY <= b.bottom) over = i; });
    if (over !== drag.over) setDrag({ ...drag, over });
  };
  const end = () => { if (drag && drag.over !== drag.from) onMove(drag.from, drag.over); setDrag(null); };
  if (!picked.length) return <p className="group-note of-empty" style={{ padding: 0 }}>Pick garments on the left. Drag them here to change which sits on top.</p>;
  return (
    <ol className="of-layers" ref={ref} onPointerMove={moveTo} onPointerUp={end} onPointerCancel={() => setDrag(null)}>
      {picked.map((p, i) => {
        const pr = byId.get(p.id)!;
        return (
          <li key={p.id} className={`of-layer ${drag?.from === i ? 'dragging' : ''} ${drag && drag.over === i && drag.from !== i ? 'target' : ''}`}>
            <button className="of-handle" aria-label={`Drag ${pr.name} to reorder`} onPointerDown={(e) => start(e, i)} onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); onMove(i, i - 1); } if (e.key === 'ArrowDown') { e.preventDefault(); onMove(i, i + 1); } }}>
              <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true"><g fill="currentColor"><circle cx="4" cy="4" r="1.4" /><circle cx="10" cy="4" r="1.4" /><circle cx="4" cy="9" r="1.4" /><circle cx="10" cy="9" r="1.4" /><circle cx="4" cy="14" r="1.4" /><circle cx="10" cy="14" r="1.4" /></g></svg>
            </button>
            <span className="of-num" aria-hidden="true">{i + 1}</span>
            <span className="of-pick-text"><b>{pr.name}</b><small>{i === 0 ? 'Closest to the skin' : i === picked.length - 1 ? 'Outermost' : styleOf(pr).name}</small></span>
            {isTop(pr) && (
              <div className="seg" role="group" aria-label={`${pr.name} tuck`}>
                <button className={p.tuck === 'out' ? 'on' : ''} aria-pressed={p.tuck === 'out'} onClick={() => onTuck(p.id, 'out')}>Out</button>
                <button className={p.tuck === 'in' ? 'on' : ''} aria-pressed={p.tuck === 'in'} onClick={() => onTuck(p.id, 'in')}>Tucked in</button>
              </div>
            )}
            <span className="of-arrows">
              <button className="icon-btn sm" aria-label={`Move ${pr.name} closer to the skin`} disabled={i === 0} onClick={() => onMove(i, i - 1)}><Icon name="up" size={14} /></button>
              <button className="icon-btn sm" aria-label={`Move ${pr.name} outward`} disabled={i === picked.length - 1} onClick={() => onMove(i, i + 1)}><Icon name="down" size={14} /></button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ editor: outfit bar */

export function OutfitBar() {
  const outfit = useOutfit();
  const active = useActiveItem();
  const projects = useOutfitProjects(outfit);
  if (!outfit) return null;
  const api = outfitApi();
  const items = byLayer(outfit.items);
  const setHidden = (it: OutfitItem) => { api.setItemHidden?.(it.projectId, !it.hidden); };
  const select = (id: string) => { if (id !== active) { flushSave(); api.setActiveItem?.(id); } };
  return (
    <div className="outfit-bar" role="toolbar" aria-label={`Outfit ${outfit.name}`}>
      <span className="ob-name"><span className="badge">Outfit</span><b title={outfit.name}>{outfit.name}</b></span>
      <ol className="ob-items">
        {items.map((it, i) => {
          const p = projects.get(it.projectId);
          if (!p) return null;
          const on = it.projectId === active;
          return (
            <li key={it.projectId} className={`ob-item ${on ? 'on' : ''} ${it.hidden ? 'hidden' : ''}`}>
              <button className="ob-pick" aria-pressed={on} aria-label={`Edit ${p.name}`} onClick={() => select(it.projectId)}>
                <span className="ob-num" aria-hidden="true">{i + 1}</span>
                <span className="ob-text"><b>{p.name}</b><small>{styleOf(p).name}</small></span>
              </button>
              {isTop(p) && (
                <button className="ob-tuck" aria-pressed={it.tuck === 'in'} title={it.tuck === 'in' ? 'Tucked in. Press to wear it out.' : 'Worn out. Press to tuck it in.'} aria-label={`${p.name}: ${it.tuck === 'in' ? 'tucked in' : 'worn out'}`} onClick={() => api.setTuck(it.projectId, it.tuck === 'in' ? 'out' : 'in')}>{it.tuck === 'in' ? 'Tucked' : 'Out'}</button>
              )}
              <button className="icon-btn sm" aria-label={`Move ${p.name} closer to the skin`} disabled={i === 0} onClick={() => api.setOutfitLayer(it.projectId, i - 1)}><Icon name="chevronLeft" size={14} /></button>
              <button className="icon-btn sm" aria-label={`Move ${p.name} outward`} disabled={i === items.length - 1} onClick={() => api.setOutfitLayer(it.projectId, i + 1)}><Icon name="chevronRight" size={14} /></button>
              <button className="icon-btn sm" aria-label={it.hidden ? `Show ${p.name}` : `Hide ${p.name}`} aria-pressed={!it.hidden} onClick={() => setHidden(it)}><Icon name={it.hidden ? 'eyeoff' : 'eye'} size={16} /></button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ editor: all the patterns, grouped by garment */

function PieceMini({ piece }: { piece: Piece }) {
  const d = useMemo(() => {
    const poly = samplePoly(piece.points, 6);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of poly) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.08;
    return { path: 'M' + poly.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + 'Z', box: `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}` };
  }, [piece.points]);
  return <svg className="piece-mini" viewBox={d.box} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"><path d={d.path} /></svg>;
}

export function OutfitPatterns() {
  const outfit = useOutfit();
  const active = useActiveItem();
  const projects = useOutfitProjects(outfit);
  const selPiece = useStore((s) => s.selPiece);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => { /* keep the active garment open */ if (active) setClosed((c) => (c[active] ? { ...c, [active]: false } : c)); }, [active]);
  if (!outfit) return null;
  const api = outfitApi();
  const items = byLayer(outfit.items);
  return (
    <nav className="outfit-patterns" aria-label="Patterns of every garment in the outfit">
      <div className="op-title">All patterns</div>
      {items.map((it) => {
        const p = projects.get(it.projectId);
        if (!p) return null;
        const on = it.projectId === active;
        const open = !closed[it.projectId];
        return (
          <section key={it.projectId} className={`op-group ${on ? 'on' : ''}`}>
            <div className="op-head">
              <button className="op-toggle" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${p.name}`} onClick={() => setClosed({ ...closed, [it.projectId]: open })}><Icon name="chevronRight" size={14} /></button>
              <button className="op-name" aria-current={on} onClick={() => { if (!on) { flushSave(); api.setActiveItem?.(it.projectId); } }}>
                <b>{p.name}</b><small>{styleOf(p).name}{on ? ', editing' : ''}</small>
              </button>
            </div>
            {open && (
              <ul className="op-pieces">
                {p.pieces.map((pc) => (
                  <li key={pc.id}>
                    <button className={`op-piece ${on && selPiece === pc.id ? 'sel' : ''}`} aria-label={`${pc.name}, ${p.name}`} onClick={() => { if (!on) { flushSave(); api.setActiveItem?.(it.projectId); } useStore.getState().select(pc.id, null); }}>
                      <PieceMini piece={pc} /><span>{pc.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </nav>
  );
}
