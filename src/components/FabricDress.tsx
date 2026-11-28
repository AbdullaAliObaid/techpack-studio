// Fabric workspace: one target ("Applies to": whole garment or one piece, outside or inside), one Fabric | Colour | Pattern
// control that acts on it, and a short list of what differs from the main fabric. Uses the existing store actions.
import { useEffect, useMemo, useState } from 'react';
import { useStore, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import type { PieceFabric } from '../data/presets';
import FabricBrowser, { FabricSwatch, fabricLabel, type FabricPart } from './FabricBrowser';
import { faceName } from './editHelpers';
import { Seg, Switch } from './controls';
import { rootPiece } from './editHelpers';

const key = (f: PieceFabric) => JSON.stringify(f);
const short = (f: PieceFabric) => fabricLabel(f).replace(/, Custom colour/, ', custom colour');

export default function FabricDress() {
  const { project, selPiece, selAttachment, fabricScope, viewFace, set, select, commit, updatePiece, updateAttachment, setInsideFabric, setInsideAll } =
    usePick('project', 'selPiece', 'selAttachment', 'fabricScope', 'viewFace', 'set', 'select', 'commit', 'updatePiece', 'updateAttachment', 'setInsideFabric', 'setInsideAll');
  const [part, setPart] = useState<FabricPart>('fabric');
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment));
  const collar = project.edits?.collar;
  const inside = project.edits?.insideFabric ?? {};
  const pieces = project.pieces;

  // choosing a piece on the chart or in 3D makes it the target; clearing the selection goes back to the whole garment
  useEffect(() => { set({ fabricScope: selPiece ? 'piece' : 'all' }); }, [selPiece, set]);

  // cloth attachments (pockets, patches, straps, appliques) take a full fabric, pattern and motif like a piece
  const allAtts = project.edits?.attachments ?? [];
  const clothAtts = allAtts.filter((a) => a.kind === 'pocket' || a.kind === 'patch' || a.kind === 'strap' || a.kind === 'applique');
  const attT = clothAtts.find((a) => a.id === selAttachment);
  const attHost = attT ? pieces.find((p) => p.id === rootPiece(allAtts, attT)) ?? pieces[0] : undefined;
  const piece = pieces.find((p) => p.id === selPiece);
  const whole = !attT && (!piece || fabricScope === 'all');
  const target = whole ? undefined : piece;
  const face = attT ? 'outside' : viewFace === 'inside' ? 'inside' : 'outside';
  const faceOf = (p: typeof piece, f: 'outside' | 'inside') => faceName(project.garment, p, f, collar);

  const setOutside = (id: string | null, f: PieceFabric) => {
    commit();
    if (id) updatePiece(id, { fabric: { ...f } });
    else useStore.setState((s) => ({ project: { ...s.project, pieces: s.project.pieces.map((p) => ({ ...p, fabric: { ...f } })), updatedAt: Date.now() } }));
  };

  // the fabric being edited and how a change is stored
  const outsideNow = (target ?? pieces[0]).fabric;
  const attOwn = attT?.fabric as PieceFabric | undefined;
  const ownInside = target ? inside[target.id] : pieces.every((p) => inside[p.id]) ? inside[pieces[0].id] : undefined;
  const current: PieceFabric = attT ? attOwn ?? attHost!.fabric : face === 'outside' ? outsideNow : ownInside ?? outsideNow;
  const onChange = (f: PieceFabric) => {
    if (attT) { commit(); updateAttachment(attT.id, { fabric: { id: f.id, color: f.color, hex: f.hex, pattern: f.pattern } }); return; }
    if (face === 'outside') setOutside(target?.id ?? null, f);
    else if (target) setInsideFabric(target.id, f); else setInsideAll(f);
  };

  const targetWords = attT ? attT.name : whole ? `Whole garment, ${face}` : face === 'outside' ? target!.name : `${target!.name}, ${faceOf(target, 'inside').toLowerCase()}`;

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

  for (const a of clothAtts) if (a.fabric && key(a.fabric as PieceFabric) !== main) rows.push({ id: `a-${a.id}`, label: a.name, fab: a.fabric as PieceFabric, pid: a.id, face: 'outside', reset: () => { commit(); updateAttachment(a.id, { fabric: undefined, alignPattern: undefined }); } });

  const pick = (r: Row) => {
    const att = clothAtts.find((a) => a.id === r.pid);
    if (att) { select(rootPiece(allAtts, att), null); set({ selAttachment: att.id, fabricScope: 'piece', viewFace: 'outside', designFace: 'outside' }); return; }
    set({ selAttachment: null });
    if (r.pid) { select(r.pid, null); set({ fabricScope: 'piece', viewFace: r.face, designFace: r.face }); }
    else { select(null); set({ viewFace: r.face, designFace: r.face }); }
  };
  const chooseTarget = (id: string) => {
    if (id.startsWith('a:')) { const a = clothAtts.find((q) => q.id === id.slice(2)); if (a) { select(rootPiece(allAtts, a), null); set({ selAttachment: a.id, fabricScope: 'piece' }); } return; }
    set({ selAttachment: null });
    if (id === '') { select(null); set({ fabricScope: 'all' }); } else { select(id, null); set({ fabricScope: 'piece' }); }
  };
  const label = attT ? attT.name.toLowerCase() : whole ? `whole garment, ${face}` : targetWords.toLowerCase();

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
          <select value={attT ? `a:${attT.id}` : whole ? '' : target!.id} onChange={(e) => chooseTarget(e.target.value)} aria-label="Applies to">
            <option value="">{style?.name ? `Whole ${style.name.toLowerCase()}` : 'Whole garment'}</option>
            {pieces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            {clothAtts.length > 0 && <optgroup label="Pockets, patches and trims">{clothAtts.map((a) => <option key={a.id} value={`a:${a.id}`}>{a.name}</option>)}</optgroup>}
          </select>
        </label>
        {!attT && <Seg<'outside' | 'inside'> label="Face" value={face} onChange={(f) => set({ viewFace: f, designFace: f })}
          options={[{ id: 'outside', label: whole ? 'Outside' : faceOf(target, 'outside') }, { id: 'inside', label: whole ? 'Inside' : faceOf(target, 'inside') }]} />}
        {face === 'inside' && <p className="group-note" style={{ padding: 0 }}>{ownInside ? 'The inside has its own fabric.' : 'The inside follows the outside until you change it.'}{ownInside && <> <button className="btn small inline" onClick={() => (target ? setInsideFabric(target.id, null) : setInsideAll(null))}>Same as outside</button></>}</p>}
      </section>

      <Seg<FabricPart> label="What to change" value={part} onChange={setPart} options={[{ id: 'fabric', label: 'Fabric' }, { id: 'colour', label: 'Colour' }, { id: 'pattern', label: 'Pattern' }]} />
      {attT && !!attT.fabric?.pattern && attT.fabric.pattern.id !== 'solid' && part === 'pattern' && (
        <div className="frow"><span className="lbl">Line up with the garment pattern</span><Switch on={!!attT.alignPattern} onChange={(v) => { commit(); updateAttachment(attT.id, { alignPattern: v || undefined }); }} label="Line up with the garment pattern" /></div>
      )}
      <FabricBrowser key={`${attT ? attT.id : whole ? 'all' : target!.id}-${face}`} idKey={`dress-${face}`} part={part} value={current} onChange={onChange} targetLabel={label} />

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
