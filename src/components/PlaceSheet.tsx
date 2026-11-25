// "Place on garment" sheet shown when a drawn outline is closed.
import { useEffect, useRef, useState } from 'react';
import { EMPTY_SEAM_DRAFT, useStore } from '../store';
import { centroid, samplePoly, signedArea } from '../lib/geometry';
import { Seg } from './controls';

type Preset = 'custom' | 'pocket' | 'strap' | 'panel';
const PRESETS: { id: Preset; label: string; name: string; mode: 'sewn' | 'patch' }[] = [
  { id: 'pocket', label: 'Pocket', name: 'Pocket', mode: 'patch' },
  { id: 'strap', label: 'Belt strap', name: 'Belt strap', mode: 'patch' },
  { id: 'panel', label: 'Panel', name: 'Panel', mode: 'sewn' },
  { id: 'custom', label: 'Other', name: 'New piece', mode: 'patch' },
];

export default function PlaceSheet() {
  const sheet = useStore((s) => s.penSheet);
  if (!sheet) return null;
  return <Sheet />;
}

function Sheet() {
  const { penSheet, project, selPiece, set, addCustomPiece, updatePiece, fitToken } = useStore();
  const hosts = project.pieces.filter((p) => p.role !== 'custom');
  const [preset, setPreset] = useState<Preset>('pocket');
  const [name, setName] = useState('Pocket');
  const [mode, setMode] = useState<'sewn' | 'patch'>('patch');
  const [host, setHost] = useState(() => (hosts.find((p) => p.id === selPiece) ?? hosts.find((p) => p.role === 'front') ?? hosts[0])?.id ?? '');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.getState().cancelTools(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  if (!penSheet) return null;

  const choose = (id: Preset) => {
    const p = PRESETS.find((q) => q.id === id)!;
    setPreset(id);
    setName(p.name);
    setMode(p.mode);
  };

  const place = () => {
    const arr = penSheet.map((p) => ({ ...p }));
    if (signedArea(arr) < 0) arr.reverse(); // pieces are stored clockwise on screen
    const c = centroid(arr);
    const local = arr.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
    const hostPiece = project.pieces.find((p) => p.id === host);
    const hc = hostPiece ? centroid(samplePoly(hostPiece.points)) : { x: 0, y: 0 };
    const id = addCustomPiece(name.trim() || 'New piece', local, mode === 'patch' ? { mode: 'patch', hostPieceId: host, x: hc.x, y: hc.y, rotation: 0 } : { mode: 'sewn' });
    const made = useStore.getState().project.pieces.find((p) => p.id === id);
    if (made) updatePiece(id, { points: made.points.map((q, i) => ({ ...q, smooth: arr[i]?.smooth ?? false })) });
    set({
      penSheet: null, penDraft: [], fitToken: fitToken + 1, inspectorTab: 'seams',
      tool: mode === 'sewn' ? 'seams' : 'select', seamDraft: EMPTY_SEAM_DRAFT,
      seamHint: mode === 'sewn' ? `${name.trim() || 'Your piece'} is ready to be sewn in.` : null,
    });
  };

  return (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) useStore.getState().cancelTools(); }}>
      <div className="sheet material" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
        <h2 id="sheet-title">Place on garment</h2>
        <p className="group-note" style={{ padding: 0 }}>Your piece is drawn. Choose what it is and how it goes onto the garment.</p>
        <div className="sheet-field">
          <span className="lbl">Quick start</span>
          <Seg label="Quick start" value={preset} options={PRESETS.map((p) => ({ id: p.id, label: p.label }))} onChange={choose} />
        </div>
        <div className="sheet-field">
          <label htmlFor="sheet-name" className="lbl">Name</label>
          <input id="sheet-name" ref={ref} className="txt wide" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') place(); }} />
        </div>
        <div className="sheet-field">
          <span className="lbl">How does it go on?</span>
          <Seg label="How it goes on" value={mode} options={[{ id: 'sewn', label: 'Sewn into an open area' }, { id: 'patch', label: 'Patched on' }]} onChange={setMode} />
          <p className="group-note" style={{ padding: 0 }}>
            {mode === 'sewn' ? 'It becomes part of the garment. Next you pick the range on it and the open edge it joins.' : 'It sits on top of a piece and is sewn round its edge, like a pocket or a belt strap. Drag it into place on the sewing chart.'}
          </p>
        </div>
        {mode === 'patch' && (
          <div className="sheet-field">
            <label htmlFor="sheet-host" className="lbl">Sits on</label>
            <select id="sheet-host" className="sel" value={host} onChange={(e) => setHost(e.target.value)}>
              {hosts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        <div className="sheet-actions">
          <button className="btn" onClick={() => useStore.getState().cancelTools()}>Cancel</button>
          <button className="btn primary" disabled={mode === 'patch' && !host} onClick={place}>Place piece</button>
        </div>
      </div>
    </div>
  );
}
