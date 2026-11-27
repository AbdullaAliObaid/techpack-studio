// Saved bodies: the built-in Male and Female bodies plus the user's own, with save, rename, delete and apply.
import { useState } from 'react';
import { usePick } from '../store';
import type { Body } from '../three/body';
import { allBodyPresets, deleteBodyPreset, renameBodyPreset, sameBody, saveBodyPreset } from './uiData';
import { PromptSheet } from './Sheets';
import Icon from './Icon';

/** The measurements of a preset in one line, for captions. */
export const bodyLine = (b: Body) => `${b.sex === 'female' ? 'Female' : 'Male'}, ${Math.round(b.height)} cm, chest ${Math.round(b.chest)}, waist ${Math.round(b.waist)}`;

/** Saved bodies picker for the Body panel. */
export function SavedBodies() {
  const { project, setWholeBody } = usePick('project', 'setWholeBody');
  const [tick, setTick] = useState(0);
  const [sheet, setSheet] = useState<null | { kind: 'save' } | { kind: 'rename'; id: string; name: string }>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [just, setJust] = useState<string | null>(null);
  void tick;
  const list = allBodyPresets();
  const current = list.find((p) => sameBody(p.body, project.body));
  const refresh = () => setTick((n) => n + 1);
  return (
    <div className="saved-bodies">
      <div className="sb-head">
        <span className="sb-title">Saved bodies</span>
        <button className="btn small" onClick={() => setSheet({ kind: 'save' })}><Icon name="plus" size={14} /> Save current as…</button>
      </div>
      <div className="sb-list" role="listbox" aria-label="Saved bodies">
        {list.map((p) => {
          const on = current?.id === p.id;
          const builtin = p.id.startsWith('builtin');
          return (
            <div key={p.id} className={`sb-row ${on ? 'on' : ''} ${just === p.id ? 'pulse' : ''}`}>
              <button role="option" aria-selected={on} className="sb-pick" onClick={() => { setWholeBody(p.body); setJust(p.id); setTimeout(() => setJust(null), 600); }}>
                <span className="sb-ico" aria-hidden="true"><Icon name="body" size={16} /></span>
                <span className="sb-text"><b>{p.name}</b><small>{bodyLine(p.body)}</small></span>
                {on && <span className="sb-tick" aria-hidden="true"><Icon name="check" size={16} /></span>}
              </button>
              {!builtin && (
                <span className="sb-menu-wrap">
                  <button className="icon-btn sm" aria-label={`More actions for ${p.name}`} aria-haspopup="menu" aria-expanded={menu === p.id} onClick={() => setMenu(menu === p.id ? null : p.id)}><Icon name="more" size={18} /></button>
                  {menu === p.id && (
                    <div className="menu right" role="menu" onMouseLeave={() => setMenu(null)}>
                      <button role="menuitem" className="menu-row" onClick={() => { setMenu(null); setSheet({ kind: 'rename', id: p.id, name: p.name }); }}><Icon name="draw" size={18} /><span>Rename</span></button>
                      <button role="menuitem" className="menu-row" onClick={() => { saveBodyPreset(p.name, project.body, p.id); setMenu(null); refresh(); }}><Icon name="refresh" size={18} /><span>Update to current body</span></button>
                      <div className="menu-sep" role="separator" />
                      <button role="menuitem" className="menu-row danger" onClick={() => { deleteBodyPreset(p.id); setMenu(null); refresh(); }}><Icon name="trash" size={18} /><span>Delete</span></button>
                    </div>
                  )}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="group-note" style={{ padding: 0 }}>{project.linkPattern ? 'Choosing a body regrades the pattern to fit it.' : 'Pattern follows body is off, so the pattern stays as drawn.'}</p>
      {sheet?.kind === 'save' && (
        <PromptSheet title="Save this body" label="Name" value="" hint={bodyLine(project.body)} confirm="Save body" onClose={() => setSheet(null)}
          onDone={(name) => { const id = saveBodyPreset(name, project.body).id; setSheet(null); refresh(); setJust(id); setTimeout(() => setJust(null), 600); }} />
      )}
      {sheet?.kind === 'rename' && (
        <PromptSheet title="Rename body" label="Name" value={sheet.name} confirm="Rename" onClose={() => setSheet(null)}
          onDone={(name) => { renameBodyPreset(sheet.id, name); setSheet(null); refresh(); }} />
      )}
    </div>
  );
}

/** Compact body choice for the new project and new outfit flows. */
export function BodyChoice({ value, onChange, labelledBy }: { value: string; onChange: (id: string, body: Body) => void; labelledBy: string }) {
  const list = allBodyPresets();
  return (
    <select className="sel body-choice" aria-labelledby={labelledBy} value={value} onChange={(e) => { const p = list.find((q) => q.id === e.target.value); if (p) onChange(p.id, p.body); }}>
      {list.map((p) => <option key={p.id} value={p.id}>{p.name}{p.id.startsWith('builtin') ? '' : ' (saved)'}</option>)}
    </select>
  );
}

