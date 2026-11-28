// Fabric workspace: one target ("Applies to": whole garment or one piece, outside or inside), one Fabric | Colour | Pattern
// control that acts on it, and a short list of what differs from the main fabric. Uses the existing store actions.
import { useEffect, useMemo, useState } from 'react';
import { useStore, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import type { PieceFabric } from '../data/presets';
import FabricBrowser, { FabricSwatch, fabricLabel, type FabricPart } from './FabricBrowser';
import { faceName } from './editHelpers';
import { Seg } from './controls';

const key = (f: PieceFabric) => JSON.stringify(f);
const short = (f: PieceFabric) => fabricLabel(f).replace(/, Custom colour/, ', custom colour');

export default function FabricDress() {
  const { project, selPiece, fabricScope, viewFace, set, select, commit, updatePiece, setInsideFabric, setInsideAll } =
    usePick('project', 'selPiece', 'fabricScope', 'viewFace', 'set', 'select', 'commit', 'updatePiece', 'setInsideFabric', 'setInsideAll');
  const [part, setPart] = useState<FabricPart>('fabric');
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment));
  const collar = project.edits?.collar;
  const inside = project.edits?.insideFabric ?? {};
  const pieces = project.pieces;

  // choosing a piece on the chart or in 3D makes it the target; clearing the selection goes back to the whole garment
  useEffect(() => { set({ fabricScope: selPiece ? 'piece' : 'all' }); }, [selPiece, set]);

  const piece = pieces.find((p) => p.id === selPiece);
  const whole = !piece || fabricScope === 'all';
  const target = whole ? undefined : piece;
  const face = viewFace === 'inside' ? 'inside' : 'outside';
  const faceOf = (p: typeof piece, f: 'outside' | 'inside') => faceName(project.garment, p, f, collar);

  const setOutside = (id: string | null, f: PieceFabric) => {
    commit();
    if (id) updatePiece(id, { fabric: { ...f } });
    else useStore.setState((s) => ({ project: { ...s.project, pieces: s.project.pieces.map((p) => ({ ...p, fabric: { ...f } })), updatedAt: Date.now() } }));
  };

  // the fabric being edited and how a change is stored
  const outsideNow = (target ?? pieces[0]).fabric;
  const ownInside = target ? inside[target.id] : pieces.every((p) => inside[p.id]) ? inside[pieces[0].id] : undefined;
  const current: PieceFabric = face === 'outside' ? outsideNow : ownInside ?? outsideNow;
  const onChange = (f: PieceFabric) => {
    if (face === 'outside') setOutside(target?.id ?? null, f);
    else if (target) setInsideFabric(target.id, f); else setInsideAll(f);
  };

  const targetWords = whole ? `Whole garment, ${face}` : face === 'outside' ? target!.name : `${target!.name}, ${faceOf(target, 'inside').toLowerCase()}`;

  // what differs from the main (most common) outside fabric
  const main = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of pieces) n.set(key(p.fabric), (n.get(key(p.fabric)) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  }, [pieces]);
  const mainFab = pieces.find((p) => key(p.fabric) === main)?.fabric ?? pieces[0].fabric;
  type Row = { id: string; label: string; fab: PieceFabric; pid: string | null; face: 'outside' | 'inside'; reset: () => void };
  const rows: Row[] = [];
  for (const p of pieces) if (key(p.fabric) !== main) rows.push({ id: `o-${p.id}`, label: p.name, fab: p.fabric, pid: p.id, face: 'outside', reset: () => setOutside(p.id, mainFab) });
  const allInside = pieces.every((p) => inside[p.id]) && new Set(pieces.map((p) => key(inside[p.id]))).size === 1;
  if (allInside) rows.push({ id: 'i-all', label: 'Whole garment, inside', fab: inside[pieces[0].id], pid: null, face: 'inside', reset: () => setInsideAll(null) });
  else for (const p of pieces) if (inside[p.id]) rows.push({ id: `i-${p.id}`, label: `${p.name}, ${faceOf(p, 'inside').toLowerCase()}`, fab: inside[p.id], pid: p.id, face: 'inside', reset: () => setInsideFabric(p.id, null) });

  const pick = (r: Row) => {
    if (r.pid) { select(r.pid, null); set({ fabricScope: 'piece', viewFace: r.face, designFace: r.face }); }
    else { select(null); set({ viewFace: r.face, designFace: r.face }); }
  };
  const chooseTarget = (id: string) => {
    if (id === '') { select(null); set({ fabricScope: 'all' }); } else { select(id, null); set({ fabricScope: 'piece' }); }
  };
  const label = whole ? `whole garment, ${face}` : targetWords.toLowerCase();

  return (
    <>
      <section className="dress-target" aria-label="Applies to">
        <div className="dress-head">
          <FabricSwatch fabric={current} size={56} label={`${fabricById(current.id).name} swatch`} />
          <div className="dress-words">
            <span className="mat-kicker">Applies to</span>
            <h2>{targetWords}</h2>
            <p>{short(current)}{face === 'inside' && !ownInside ? ' (same as outside)' : ''}</p>
          </div>
        </div>
        <label className="dress-pick">
          <select value={whole ? '' : target!.id} onChange={(e) => chooseTarget(e.target.value)} aria-label="Applies to">
            <option value="">{style?.name ? `Whole ${style.name.toLowerCase()}` : 'Whole garment'}</option>
            {pieces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <Seg<'outside' | 'inside'> label="Face" value={face} onChange={(f) => set({ viewFace: f, designFace: f })}
          options={[{ id: 'outside', label: whole ? 'Outside' : faceOf(target, 'outside') }, { id: 'inside', label: whole ? 'Inside' : faceOf(target, 'inside') }]} />
        {face === 'inside' && <p className="group-note" style={{ padding: 0 }}>{ownInside ? 'The inside has its own fabric.' : 'The inside follows the outside until you change it.'}{ownInside && <> <button className="btn small inline" onClick={() => (target ? setInsideFabric(target.id, null) : setInsideAll(null))}>Same as outside</button></>}</p>}
      </section>

      <Seg<FabricPart> label="What to change" value={part} onChange={setPart} options={[{ id: 'fabric', label: 'Fabric' }, { id: 'colour', label: 'Colour' }, { id: 'pattern', label: 'Pattern' }]} />
      <FabricBrowser key={`${whole ? 'all' : target!.id}-${face}`} idKey={`dress-${face}`} part={part} value={current} onChange={onChange} targetLabel={label} />

      {rows.length > 0 && (
        <section className="dress-diff" aria-label="Different from the main fabric">
          <h3>Different from {fabricById(mainFab.id).name.toLowerCase()}</h3>
          <ul>
            {rows.map((r) => (
              <li key={r.id}>
                <button className="dress-row" onClick={() => pick(r)}>
                  <FabricSwatch fabric={r.fab} size={28} />
                  <span><b>{r.label}</b><small>{short(r.fab)}</small></span>
                </button>
                <button className="btn small" aria-label={`Reset ${r.label}`} onClick={r.reset}>Reset</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
