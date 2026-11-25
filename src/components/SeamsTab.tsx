// Seams, pleats and drawn pieces: the controls behind the Seams, Pleat and Pen tools.
import { useMemo } from 'react';
import { EMPTY_SEAM_DRAFT, useStore } from '../store';
import { builtinSeams } from '../sim/seams';
import { outlineLength } from '../lib/geometry';
import { fmt } from '../lib/units';
import type { EdgeRef, PleatType } from '../data/edits';
import { LenInput, Row, Seg, Switch } from './controls';
import Icon from './Icon';

/** Click handler for the Seams tool: first click starts a range, second ends it. A and B fill in turn. */
export function pickSeamPoint(pieceId: string, pointId: string) {
  const st = useStore.getState();
  const d = st.seamDraft;
  const target: 'a' | 'b' = d.a && d.a.toId ? 'b' : 'a';
  const cur = d[target];
  if (!cur || !cur.fromId || cur.pieceId !== pieceId) {
    st.set({ seamDraft: { ...d, [target]: { pieceId, fromId: pointId } } });
  } else if (pointId !== cur.fromId) {
    st.set({ seamDraft: { ...d, [target]: { ...cur, toId: pointId } } });
  }
}

const complete = (r: Partial<EdgeRef> | null): r is EdgeRef => !!(r && r.pieceId && r.fromId && r.toId);

export default function SeamsTab() {
  const { project, units, tool, set, hoverSeam, seamDraft, seamHint, setSeamAttached, addCustomSeam, removeCustomSeam, selPiece } = useStore();
  const edits = project.edits;
  const pieces = project.pieces;
  const name = (id?: string) => pieces.find((p) => p.id === id)?.name ?? 'Piece';
  const seams = useMemo(() => builtinSeams(project.garment, pieces), [project.garment, pieces]);
  const detached = new Set(edits?.detachedSeams ?? []);
  // seams that share a group (both halves of a sleeve cap) show as one row and toggle together
  const rows = useMemo(() => {
    const out: { key: string; label: string; ids: string[] }[] = [];
    for (const s of seams) {
      const g = s.group && out.find((r) => r.key === s.group);
      if (g) g.ids.push(s.id);
      else out.push({ key: s.group ?? s.id, label: s.group ? s.label.replace(/, (front|back)$/, '') : s.label, ids: [s.id] });
    }
    return out;
  }, [seams]);
  const len = (r: EdgeRef | null) => {
    if (!complete(r)) return null;
    const p = pieces.find((q) => q.id === r.pieceId);
    return p ? outlineLength(p.points, r.fromId, r.toId) : null;
  };
  const la = len(seamDraft.a as EdgeRef), lb = len(seamDraft.b as EdgeRef);
  const ready = complete(seamDraft.a) && complete(seamDraft.b);
  const diff = la !== null && lb !== null ? la - lb : 0;
  const step = !seamDraft.a?.fromId ? 'Click a start point on the first piece.'
    : !seamDraft.a.toId ? 'Click the end point of the range on the same piece.'
    : !seamDraft.b?.fromId ? 'Now click a start point on the piece it should join.'
    : !seamDraft.b.toId ? 'Click the end point of the second range.'
    : 'Check the lengths, then confirm.';

  const confirm = () => {
    if (!complete(seamDraft.a) || !complete(seamDraft.b)) return;
    addCustomSeam({ a: seamDraft.a, b: seamDraft.b, flip: seamDraft.flip });
    set({ seamDraft: EMPTY_SEAM_DRAFT, seamHint: null });
  };

  return (
    <>
      {seamHint && (
        <div className="card callout" role="status">
          <div className="card-title">{seamHint}</div>
          <div className="group-note" style={{ padding: 0 }}>Use Join seam below: pick a range on your piece, then the open edge it should be sewn to.</div>
        </div>
      )}

      <div className="card">
        <div className="card-title">Built in seams</div>
        {seams.length === 0 && <div className="group-note">This garment has no seam list yet. Custom seams still work.</div>}
        <ul className="seam-list">
          {rows.map((s) => {
            const on = s.ids.some((id) => !detached.has(id));
            const hov = s.ids[0];
            return (
              <li key={s.key} className={`seam-item ${s.ids.includes(hoverSeam ?? '') ? 'hover' : ''}`} onMouseEnter={() => set({ hoverSeam: hov })} onMouseLeave={() => set({ hoverSeam: null })} onFocus={() => set({ hoverSeam: hov })} onBlur={() => set({ hoverSeam: null })}>
                <span className="seam-name">{s.label}<small>{on ? 'Sewn' : 'Open'}</small></span>
                <Switch label={`${s.label}: ${on ? 'sewn, turn off to open it' : 'open, turn on to sew it'}`} on={on} onChange={(v) => s.ids.forEach((id) => setSeamAttached(id, v))} />
              </li>
            );
          })}
        </ul>
        <p className="fit-note">Turn a seam off to leave that edge open. The 3D garment follows.</p>
      </div>

      <div className="card">
        <div className="card-title">Join seam</div>
        {tool !== 'seams' ? (
          <>
            <p className="group-note" style={{ padding: 0 }}>Sew any stretch of one piece to a stretch of another.</p>
            <button className="btn block" style={{ marginTop: 8 }} onClick={() => set({ tool: 'seams', seamDraft: EMPTY_SEAM_DRAFT })}><Icon name="seams" size={16} /> Start joining</button>
          </>
        ) : (
          <>
            <p className="step-hint" role="status">{step}</p>
            <div className="range-rows">
              <RangeRow tag="A" colorClass="a" r={seamDraft.a} name={name(seamDraft.a?.pieceId)} length={la} units={units} />
              <RangeRow tag="B" colorClass="b" r={seamDraft.b} name={name(seamDraft.b?.pieceId)} length={lb} units={units} />
            </div>
            {ready && (
              <>
                <div className={`diff ${Math.abs(diff) < 0.2 ? 'ok' : ''}`}>
                  {Math.abs(diff) < 0.2 ? 'Same length. They match.' : `Difference ${fmt(Math.abs(diff), units)}. ${diff > 0 ? 'A is longer, so B stretches or A is eased.' : 'B is longer, so A stretches or B is eased.'}`}
                </div>
                <Row label="Flip direction of B"><Switch label="Flip direction of B" on={seamDraft.flip} onChange={(v) => set({ seamDraft: { ...seamDraft, flip: v } })} /></Row>
              </>
            )}
            <div className="row">
              <button className="btn primary" disabled={!ready} onClick={confirm}><Icon name="check" size={16} /> Confirm</button>
              <button className="btn" onClick={() => set({ seamDraft: EMPTY_SEAM_DRAFT })}>Start over</button>
              <button className="btn ghost" onClick={() => useStore.getState().cancelTools()}>Done</button>
            </div>
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">Custom seams <span className="muted">· {edits?.customSeams.length ?? 0}</span></div>
        {!edits?.customSeams.length && <div className="group-note">Seams you join by hand show up here.</div>}
        <ul className="seam-list">
          {edits?.customSeams.map((c, i) => {
            const a = len(c.a), b = len(c.b);
            return (
              <li key={c.id} className={`seam-item ${hoverSeam === c.id ? 'hover' : ''}`} onMouseEnter={() => set({ hoverSeam: c.id })} onMouseLeave={() => set({ hoverSeam: null })}>
                <span className="seam-name">Seam {i + 1}: {name(c.a.pieceId)} to {name(c.b.pieceId)}<small>{a !== null && b !== null ? `${fmt(a, units)} and ${fmt(b, units)}` : ''}{c.flip ? ', flipped' : ''}</small></span>
                <button className="icon-btn sm danger" aria-label={`Delete custom seam ${i + 1}`} title="Delete seam" onClick={() => removeCustomSeam(c.id)}><Icon name="trash" size={16} /></button>
              </li>
            );
          })}
        </ul>
      </div>

      <PleatCard />
      <DrawCard selPiece={selPiece} />
    </>
  );
}

function RangeRow({ tag, colorClass, r, name, length, units }: { tag: string; colorClass: string; r: Partial<EdgeRef> | null; name: string; length: number | null; units: 'cm' | 'in' }) {
  return (
    <div className={`range-row ${colorClass}`}>
      <span className="range-tag" aria-hidden="true">{tag}</span>
      <span className="range-main">{r?.fromId ? name : 'Not picked yet'}<small>{length !== null ? fmt(length, units) : r?.fromId ? 'Pick the end point' : ''}</small></span>
    </div>
  );
}

const TYPES: { id: PleatType; label: string }[] = [{ id: 'knife', label: 'Knife' }, { id: 'box', label: 'Box' }, { id: 'inverted', label: 'Inverted' }];
const TYPE_NOTE: Record<PleatType, string> = {
  knife: 'One fold, all pressed the same way.',
  box: 'Two folds that open outward.',
  inverted: 'Two folds that meet in the middle.',
};

function PleatCard() {
  const { project, selPleat, tool, set, updatePleat, removePleat, units } = useStore();
  const pleats = project.edits?.pleats ?? [];
  const pl = pleats.find((p) => p.id === selPleat);
  const pname = (id: string) => project.pieces.find((p) => p.id === id)?.name ?? 'Piece';
  return (
    <div className="card">
      <div className="card-title">Pleats <span className="muted">· {pleats.length}</span></div>
      {tool !== 'pleat' && <button className="btn block" onClick={() => set({ tool: 'pleat' })}><Icon name="pleat" size={16} /> Add a pleat</button>}
      {tool === 'pleat' && <p className="step-hint" role="status">Click an edge of a piece to place a pleat there.</p>}
      {pleats.length > 0 && (
        <ul className="seam-list" style={{ marginTop: 8 }}>
          {pleats.map((p, i) => (
            <li key={p.id} className={`seam-item ${p.id === selPleat ? 'hover' : ''}`}>
              <button className="plain-row" aria-pressed={p.id === selPleat} onClick={() => set({ selPleat: p.id, selPiece: p.pieceId })}>
                <span className="seam-name">Pleat {i + 1}: {TYPES.find((t) => t.id === p.type)?.label}<small>{pname(p.pieceId)}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pl && (
        <div className="subgroup">
          <Seg label="Pleat type" value={pl.type} options={TYPES} onChange={(t) => updatePleat(pl.id, { type: t })} />
          <p className="group-note" style={{ padding: '6px 0 0' }}>{TYPE_NOTE[pl.type]}</p>
          <Row label="Depth"><LenInput units={units} label="Pleat depth" value={pl.depth} min={0.3} max={15} onChange={(v) => updatePleat(pl.id, { depth: v })} /></Row>
          <Row label="Length"><LenInput units={units} label="Pleat length" value={pl.length} min={1} max={80} onChange={(v) => updatePleat(pl.id, { length: v })} /></Row>
          <Row label="Position"><span className="num"><input type="range" aria-label="Pleat position along the edge" min={0} max={100} value={Math.round(pl.t * 100)} onChange={(e) => updatePleat(pl.id, { t: Number(e.target.value) / 100 })} /></span></Row>
          <div className="frow stack">
            <span className="lbl">Fold direction</span>
            <Seg label="Fold direction" value={pl.direction === 1 ? 'cw' : 'ccw'} options={[{ id: 'cw', label: 'Clockwise', disabled: pl.type !== 'knife' }, { id: 'ccw', label: 'Anticlockwise', disabled: pl.type !== 'knife' }]} onChange={(v) => updatePleat(pl.id, { direction: v === 'cw' ? 1 : -1 })} />
            {pl.type !== 'knife' && <span className="group-note" style={{ padding: 0 }}>Box and inverted pleats fold both ways.</span>}
          </div>
          <button className="btn block danger" style={{ marginTop: 8 }} onClick={() => removePleat(pl.id)}><Icon name="trash" size={16} /> Delete pleat</button>
        </div>
      )}
    </div>
  );
}

function DrawCard({ selPiece }: { selPiece: string | null }) {
  const { project, tool, penDraft, penSnap, set, removePiece, updatePiece } = useStore();
  const custom = project.pieces.filter((p) => p.role === 'custom');
  const sel = custom.find((p) => p.id === selPiece);
  const drawing = tool === 'pen';
  const close = () => { if (penDraft.length >= 3) set({ penSheet: penDraft, penDraft: [] }); };
  return (
    <div className="card">
      <div className="card-title">Draw a new piece</div>
      {!drawing ? (
        <button className="btn block" onClick={() => set({ tool: 'pen', penDraft: [] })}><Icon name="pen" size={16} /> Start drawing</button>
      ) : (
        <>
          <p className="step-hint" role="status">{penDraft.length < 3 ? 'Click to add corners. Drag a little to make a point curved.' : 'Click the first point or press Close shape to finish.'}</p>
          <Row label="Snap to grid"><Switch label="Snap to grid" on={penSnap} onChange={(v) => set({ penSnap: v })} /></Row>
          <div className="row wrap">
            <button className="btn" disabled={penDraft.length === 0} onClick={() => set({ penDraft: penDraft.slice(0, -1) })}>Undo point</button>
            <button className="btn primary" disabled={penDraft.length < 3} onClick={close}><Icon name="check" size={16} /> Close shape</button>
            <button className="btn ghost" onClick={() => useStore.getState().cancelTools()}>Cancel</button>
          </div>
        </>
      )}
      {custom.length > 0 && (
        <>
          <div className="card-title" style={{ paddingTop: 14 }}>Your pieces</div>
          <ul className="seam-list">
            {custom.map((p) => (
              <li key={p.id} className={`seam-item ${p.id === selPiece ? 'hover' : ''}`}>
                <button className="plain-row" aria-pressed={p.id === selPiece} onClick={() => set({ selPiece: p.id, selPoint: null })}>
                  <span className="seam-name">{p.name}<small>{p.placement?.mode === 'patch' ? `Patched on ${project.pieces.find((q) => q.id === p.placement?.hostPieceId)?.name ?? 'a piece'}` : 'Sewn into an open area'}</small></span>
                </button>
                <button className="icon-btn sm danger" aria-label={`Delete ${p.name}`} title="Delete piece" onClick={() => removePiece(p.id)}><Icon name="trash" size={16} /></button>
              </li>
            ))}
          </ul>
        </>
      )}
      {sel && (
        <div className="subgroup">
          <Row label="Name" htmlFor="cp-name"><input id="cp-name" className="txt" value={sel.name} maxLength={40} onChange={(e) => updatePiece(sel.id, { name: e.target.value })} /></Row>
          <Seg label="How it goes on" value={sel.placement?.mode ?? 'sewn'} options={[{ id: 'sewn', label: 'Sewn in' }, { id: 'patch', label: 'Patched on' }]}
            onChange={(m) => {
              const host = project.pieces.find((q) => q.role !== 'custom');
              updatePiece(sel.id, { placement: m === 'sewn' ? { mode: 'sewn' } : { mode: 'patch', hostPieceId: sel.placement?.hostPieceId ?? host?.id, x: sel.placement?.x ?? 0, y: sel.placement?.y ?? 0, rotation: sel.placement?.rotation ?? 0 } });
            }} />
          {sel.placement?.mode === 'patch' && (
            <>
              <div className="frow stack">
                <label htmlFor="cp-host">Sits on</label>
                <select id="cp-host" className="sel" value={sel.placement.hostPieceId ?? ''} onChange={(e) => updatePiece(sel.id, { placement: { ...sel.placement!, hostPieceId: e.target.value } })}>
                  {project.pieces.filter((q) => q.role !== 'custom').map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </div>
              <div className="frow stack">
                <label htmlFor="cp-rot">Rotation <b className="val">{Math.round(sel.placement.rotation ?? 0)}°</b></label>
                <input id="cp-rot" type="range" min={-180} max={180} value={sel.placement.rotation ?? 0} onChange={(e) => updatePiece(sel.id, { placement: { ...sel.placement!, rotation: Number(e.target.value) } })} />
              </div>
              <p className="group-note" style={{ padding: 0 }}>Drag the dashed outline on the sewing chart to move it.</p>
            </>
          )}
          {sel.placement?.mode !== 'patch' && <p className="group-note" style={{ padding: 0 }}>Use Join seam above to sew it into an open area.</p>}
        </div>
      )}
    </div>
  );
}
