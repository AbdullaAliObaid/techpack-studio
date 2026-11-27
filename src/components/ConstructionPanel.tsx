// Construction tab: how the garment is put together. Seams (built in and joined by hand), pleats, and your own pieces.
import { useMemo } from 'react';
import { EMPTY_SEAM_DRAFT, useStore, usePick } from '../store';
import { builtinSeams } from '../sim/seams';
import { outlineLength } from '../lib/geometry';
import { fmt } from '../lib/units';
import type { EdgeRef, PleatType } from '../data/edits';
import { Disclosure, LenInput, Row, Seg, Switch, TabHeader } from './controls';
import { copiesOf, instanceName } from './sides';
import { openPieceFlow } from './flow';
import Icon from './Icon';

/** Click handler for the Seams tool: first click starts a range, second ends it. A and B fill in turn. `instance` is the copy that was clicked. */
export function pickSeamPoint(pieceId: string, pointId: string, instance?: number) {
  const st = useStore.getState();
  const d = st.seamDraft;
  const target: 'a' | 'b' = d.a && d.a.toId ? 'b' : 'a';
  const cur = d[target];
  const inst = instance === undefined ? {} : { instance };
  if (!cur || !cur.fromId || cur.pieceId !== pieceId || cur.instance !== instance) {
    st.set({ seamDraft: { ...d, [target]: { pieceId, fromId: pointId, ...inst } } });
  } else if (pointId !== cur.fromId) {
    st.set({ seamDraft: { ...d, [target]: { ...cur, toId: pointId } } });
  }
}

const complete = (r: Partial<EdgeRef> | null): r is EdgeRef => !!(r && r.pieceId && r.fromId && r.toId);

/** "Front, right leg" for a pick on a copy, the plain piece name otherwise. */
function useRefName() {
  const { project } = usePick('project');
  return (r?: Partial<EdgeRef> | null) => {
    const p = project.pieces.find((q) => q.id === r?.pieceId);
    if (!p) return 'Piece';
    return r?.instance !== undefined && copiesOf(project.garment, p) === 2 ? instanceName(project.garment, p, r.instance) : p.name;
  };
}

export default function ConstructionPanel() {
  const { project, units, tool, set, hoverSeam, seamDraft, seamHint, setSeamAttached, addCustomSeam, removeCustomSeam } = usePick('project', 'units', 'tool', 'set', 'hoverSeam', 'seamDraft', 'seamHint', 'setSeamAttached', 'addCustomSeam', 'removeCustomSeam');
  const edits = project.edits;
  const pieces = project.pieces;
  const refName = useRefName();
  const seams = useMemo(() => builtinSeams(project.garment, pieces, project.edits), [project.garment, pieces, project.edits]);
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
  const len = (r: Partial<EdgeRef> | null) => {
    if (!complete(r)) return null;
    const p = pieces.find((q) => q.id === r.pieceId);
    return p ? outlineLength(p.points, r.fromId, r.toId) : null;
  };
  const la = len(seamDraft.a), lb = len(seamDraft.b);
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
  const joining = tool === 'seams';

  return (
    <>
      <TabHeader icon="construction" title="Construction" subtitle="How the pieces are cut and sewn together." />

      {seamHint && (
        <div className="callout-box" role="status"><Icon name="check" size={16} /><span>{seamHint}</span></div>
      )}

      {joining && (
        <section className="tool-card" aria-label="Joining seams">
          <h3>Join seams</h3>
          <p className="step-hint" role="status">{step}</p>
          <div className="range-rows">
            <RangeRow tag="A" colorClass="a" r={seamDraft.a} name={refName(seamDraft.a)} length={la} units={units} />
            <RangeRow tag="B" colorClass="b" r={seamDraft.b} name={refName(seamDraft.b)} length={lb} units={units} />
          </div>
          {ready && (
            <>
              <div className={`diff ${Math.abs(diff) < 0.2 ? 'ok' : ''}`}>
                {Math.abs(diff) < 0.2 ? 'Same length. They match.' : `Difference ${fmt(Math.abs(diff), units)}. ${diff > 0 ? 'A is longer, so B stretches or A is eased.' : 'B is longer, so A stretches or B is eased.'}`}
              </div>
              <Row label="Flip direction of B"><Switch label="Flip direction of B" on={seamDraft.flip} onChange={(v) => set({ seamDraft: { ...seamDraft, flip: v } })} /></Row>
            </>
          )}
          <div className="row wrap">
            <button className="btn primary" disabled={!ready} onClick={confirm}><Icon name="check" size={16} /> Confirm</button>
            <button className="btn" onClick={() => set({ seamDraft: EMPTY_SEAM_DRAFT })}>Start over</button>
            <button className="btn ghost" onClick={() => useStore.getState().cancelTools()}>Done</button>
          </div>
        </section>
      )}
      {tool === 'pleat' && (
        <section className="tool-card" aria-label="Adding pleats">
          <h3>Add pleats</h3>
          <p className="step-hint" role="status">Click an edge of a piece to place a pleat there. It goes on the side you click.</p>
          <button className="btn block" onClick={() => useStore.getState().cancelTools()}>Done</button>
        </section>
      )}
      {tool === 'pen' && <PenCard />}

      <PiecesSection />

      <Disclosure id="con-seams" title="Seams" icon="seams" count={rows.length}>
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
      </Disclosure>

      <Disclosure id="con-join" title="Join seams" icon="seams" count={edits?.customSeams.length ?? 0}>
        <p className="group-note">Sew any stretch of one piece to a stretch of another. Each pick belongs to the side of the piece you click.</p>
        <button className="btn block" disabled={joining} onClick={() => set({ tool: 'seams', seamDraft: EMPTY_SEAM_DRAFT })}><Icon name="seams" size={16} /> {joining ? 'Joining, see the card above' : 'Start joining'}</button>
        {!!edits?.customSeams.length && (
          <>
            <div className="sublabel">Your seams</div>
            <ul className="seam-list">
              {edits.customSeams.map((c, i) => {
                const a = len(c.a), b = len(c.b);
                return (
                  <li key={c.id} className={`seam-item ${hoverSeam === c.id ? 'hover' : ''}`} onMouseEnter={() => set({ hoverSeam: c.id })} onMouseLeave={() => set({ hoverSeam: null })}>
                    <span className="seam-name">Seam {i + 1}: {refName(c.a)} to {refName(c.b)}<small>{a !== null && b !== null ? `${fmt(a, units)} and ${fmt(b, units)}` : ''}{c.flip ? ', flipped' : ''}</small></span>
                    <button className="icon-btn sm danger" aria-label={`Delete custom seam ${i + 1}`} title="Delete seam" onClick={() => removeCustomSeam(c.id)}><Icon name="trash" size={16} /></button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Disclosure>

      <PleatSection />
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

function PleatSection() {
  const { project, selPleat, tool, set, updatePleat, removePleat, units } = usePick('project', 'selPleat', 'tool', 'set', 'updatePleat', 'removePleat', 'units');
  const pleats = project.edits?.pleats ?? [];
  const pl = pleats.find((p) => p.id === selPleat);
  const pname = (id: string, inst?: number) => {
    const p = project.pieces.find((q) => q.id === id);
    if (!p) return 'Piece';
    return inst !== undefined && copiesOf(project.garment, p) === 2 ? instanceName(project.garment, p, inst) : p.name;
  };
  const instOf = (x: object) => (x as { instance?: number }).instance;
  return (
    <Disclosure id="con-pleats" title="Pleats" icon="pleat" count={pleats.length}>
      <button className="btn block" disabled={tool === 'pleat'} onClick={() => set({ tool: 'pleat' })}><Icon name="pleat" size={16} /> {tool === 'pleat' ? 'Adding pleats, see the card above' : 'Add a pleat'}</button>
      {pleats.length > 0 && (
        <ul className="seam-list" style={{ marginTop: 8 }}>
          {pleats.map((p, i) => (
            <li key={p.id} className={`seam-item ${p.id === selPleat ? 'hover' : ''}`}>
              <button className="plain-row" aria-pressed={p.id === selPleat} onClick={() => set({ selPleat: p.id, selPiece: p.pieceId })}>
                <span className="seam-name">Pleat {i + 1}: {TYPES.find((t) => t.id === p.type)?.label}<small>{pname(p.pieceId, instOf(p))}</small></span>
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
    </Disclosure>
  );
}

function PiecesSection() {
  const { project, selPiece, set, removePiece, updatePiece } = usePick('project', 'selPiece', 'set', 'removePiece', 'updatePiece');
  const custom = project.pieces.filter((p) => p.role === 'custom');
  const sel = custom.find((p) => p.id === selPiece);
  const hosts = project.pieces.filter((q) => q.role !== 'custom');
  return (
    <Disclosure id="con-pieces" title="Your pieces" icon="pattern" count={custom.length}
      action={<button className="btn small primary" onClick={() => openPieceFlow()}><Icon name="plus" size={14} /> New piece</button>}>
      {custom.length === 0 && <div className="group-note">Pockets, panels and straps you draw or start from a template show up here. Press New piece to begin.</div>}
      <ul className="seam-list">
        {custom.map((p) => (
          <li key={p.id} className={`seam-item ${p.id === selPiece ? 'hover' : ''}`}>
            <button className="plain-row" aria-pressed={p.id === selPiece} onClick={() => set({ selPiece: p.id, selPoint: null })}>
              <span className="seam-name">{p.name}<small>{p.placement?.mode === 'patch' ? `Stitched on top of ${project.pieces.find((q) => q.id === p.placement?.hostPieceId)?.name ?? 'a piece'}` : 'Sewn into an edge'}{p.cut >= 2 ? ', cut as a pair' : ''}</small></span>
            </button>
            <button className="icon-btn sm danger" aria-label={`Delete ${p.name}`} title="Delete piece" onClick={() => removePiece(p.id)}><Icon name="trash" size={16} /></button>
          </li>
        ))}
      </ul>
      {sel && (
        <div className="subgroup">
          <Row label="Name" htmlFor="cp-name"><input id="cp-name" className="txt" value={sel.name} maxLength={40} onChange={(e) => updatePiece(sel.id, { name: e.target.value })} /></Row>
          <Row label="Cut"><Seg full={false} label="Cut count" value={sel.cut >= 2 ? '2' : '1'} options={[{ id: '1', label: 'One' }, { id: '2', label: 'A pair' }]} onChange={(v) => updatePiece(sel.id, { cut: Number(v) })} /></Row>
          <div className="frow stack">
            <span className="lbl">How it goes on</span>
            <Seg label="How it goes on" value={sel.placement?.mode ?? 'sewn'} options={[{ id: 'sewn', label: 'Sewn in' }, { id: 'patch', label: 'Stitched on top' }]}
              onChange={(m) => {
                const host = hosts[0];
                updatePiece(sel.id, { placement: m === 'sewn' ? { mode: 'sewn' } : { mode: 'patch', hostPieceId: sel.placement?.hostPieceId ?? host?.id, x: sel.placement?.x ?? 0, y: sel.placement?.y ?? 0, rotation: sel.placement?.rotation ?? 0 } });
              }} />
          </div>
          {sel.placement?.mode === 'patch' && (
            <>
              <div className="frow stack">
                <label htmlFor="cp-host">Sits on</label>
                <select id="cp-host" className="sel" value={sel.placement.hostPieceId ?? ''} onChange={(e) => updatePiece(sel.id, { placement: { ...sel.placement!, hostPieceId: e.target.value } })}>
                  {hosts.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
              </div>
              <div className="frow stack">
                <label htmlFor="cp-rot">Rotation <b className="val">{Math.round(sel.placement.rotation ?? 0)}°</b></label>
                <input id="cp-rot" type="range" min={-180} max={180} value={sel.placement.rotation ?? 0} onChange={(e) => updatePiece(sel.id, { placement: { ...sel.placement!, rotation: Number(e.target.value) } })} />
              </div>
              <p className="group-note">Drag the dashed outline on the chart to move it.</p>
            </>
          )}
          {sel.placement?.mode !== 'patch' && <p className="group-note">Use Join seams to sew it into an open edge.</p>}
        </div>
      )}
    </Disclosure>
  );
}

/** The pen tool's controls: a card above the sections so nothing has to be opened. */
function PenCard() {
  const { set, penDraft, penSnap } = useStore();
  return (
    <section className="tool-card" aria-label="Drawing a new piece">
      <h3>Draw a piece</h3>
      <p className="step-hint" role="status">{penDraft.length < 3 ? 'Click on the chart to add corners. Drag a little to make a point curved.' : 'Click the first point, or press Close shape, to finish.'}</p>
      <Row label="Snap to grid"><Switch label="Snap to grid" on={penSnap} onChange={(v) => set({ penSnap: v })} /></Row>
      <div className="row wrap">
        <button className="btn" disabled={penDraft.length === 0} onClick={() => set({ penDraft: penDraft.slice(0, -1) })}>Undo point</button>
        <button className="btn primary" disabled={penDraft.length < 3} onClick={() => openPieceFlow(penDraft)}><Icon name="check" size={16} /> Close shape</button>
        <button className="btn ghost" onClick={() => useStore.getState().cancelTools()}>Cancel</button>
      </div>
    </section>
  );
}
