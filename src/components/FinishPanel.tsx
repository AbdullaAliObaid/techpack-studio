// Finish workspace: wash and wear tools. A global wash, brushes for wash effects and distressing painted on the pattern or
// the 3D garment, and a list of what has been done. Strokes are stored per piece in pattern space (Edits.finish).
import { useState } from 'react';
import { usePick } from '../store';
import { LenInput, Row, Seg } from './controls';
import { DISTRESS_KINDS, KIND, PRESET_INFO, WASH_KINDS, finishRows, strokeCount } from '../data/finish';
import type { FinishKind, WashPreset } from '../data/edits';

const PRESETS: { id: WashPreset; label: string }[] = [{ id: 'none', label: 'None' }, { id: 'light', label: 'Light' }, { id: 'mid', label: 'Mid' }, { id: 'dark', label: 'Dark' }, { id: 'vintage', label: 'Vintage' }];

export default function FinishPanel() {
  const { project, finishBrush: b, set, units, setWashPreset, undoFinishStroke, clearFinish, placeTypical } = usePick('project', 'finishBrush', 'set', 'units', 'setWashPreset', 'undoFinishStroke', 'clearFinish', 'placeTypical');
  const [note, setNote] = useState('');
  const f = project.edits?.finish;
  const rows = finishRows(project.garment, project.pieces, f, project.edits?.attachments ?? []);
  const pick = (k: FinishKind) => set({ finishBrush: { ...b, k, r: KIND[k].defaultR }, tool: 'brush' });
  const kinds = (list: FinishKind[]) => (
    <div className="agrid" role="group" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      {list.map((k) => (
        <button key={k} className={`btn small ${b.k === k ? 'primary' : ''}`} aria-pressed={b.k === k} title={KIND[k].hint} onClick={() => pick(k)}>{KIND[k].label}</button>
      ))}
    </div>
  );
  return (
    <section className="tool-card" aria-label="Finish">
      <h3>Finish</h3>
      <p className="step-hint" role="status">Pick a brush, then drag on the garment or on the pattern. Wash changes colour and texture, distressing adds wear. Holes and rips are cut through the cloth.</p>

      <div className="sublabel">Overall wash</div>
      <Seg label="Overall wash" value={f?.preset ?? 'none'} options={PRESETS} onChange={(p) => setWashPreset(p)} />
      {f && f.preset !== 'none' && (
        <>
          <div className="frow stack">
            <label htmlFor="wash-strength">Wash strength <b className="val">{Math.round((f.presetStrength ?? 1) * 100)}%</b></label>
            <input id="wash-strength" type="range" min={20} max={100} step={5} value={Math.round((f.presetStrength ?? 1) * 100)} onChange={(e) => setWashPreset(f.preset, Number(e.target.value) / 100)} />
          </div>
          <p className="group-note">{PRESET_INFO[f.preset as Exclude<WashPreset, 'none'>].label}: {PRESET_INFO[f.preset as Exclude<WashPreset, 'none'>].process}.</p>
        </>
      )}

      <div className="sublabel">Wash brushes</div>
      {kinds(WASH_KINDS)}
      <div className="sublabel">Wear and distressing</div>
      {kinds(DISTRESS_KINDS)}
      <p className="group-note">{KIND[b.k].hint}. Every tool works on every garment: brush it anywhere.</p>
      <div className="row wrap">
        <button className="btn small" title="Add the usual marks for this tool, then change or undo them" onClick={() => { const n = placeTypical(b.k); setNote(n ? `Added ${n} ${n === 1 ? 'mark' : 'marks'} on typical spots. Undo removes the last one.` : 'This tool has no usual spot on this garment. Brush it where you want it.'); }}>Place on typical spots</button>
      </div>
      {note && <p className="group-note" role="status">{note}</p>}

      <Row label="Brush size"><LenInput label="Brush size" units={units} value={b.r} min={0.5} max={25} step={0.5} onChange={(r) => set({ finishBrush: { ...b, r } })} /></Row>
      <div className="frow stack">
        <label htmlFor="brush-strength">Strength <b className="val">{Math.round(b.s * 100)}%</b></label>
        <input id="brush-strength" type="range" min={10} max={100} step={5} value={Math.round(b.s * 100)} onChange={(e) => set({ finishBrush: { ...b, s: Number(e.target.value) / 100 } })} />
      </div>

      <div className="row wrap">
        <button className="btn" disabled={!strokeCount(f)} onClick={undoFinishStroke}>Undo last stroke</button>
        <button className="btn" disabled={!f} onClick={clearFinish}>Clear all</button>
      </div>

      {rows.length > 0 && (
        <>
          <div className="sublabel">What is on the garment</div>
          <ul className="plain-list">
            {rows.map((r) => (
              <li key={r.no}><b>{r.no}.</b> {r.process.split(' (')[0]}: {r.where.split(':')[0]}, {r.strength}</li>
            ))}
          </ul>
          <p className="group-note">These go on a wash and distress page in the tech pack, with the process names a factory uses.</p>
        </>
      )}
    </section>
  );
}
