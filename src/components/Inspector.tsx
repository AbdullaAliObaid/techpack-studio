// Sections the workspace panels share: inside and outside card, fit, point and piece numbers, the review tables.
import { canSplit } from '../data/split';
import { useStore, usePick } from '../store';
import type { PieceFabric } from '../data/presets';
import { fabricById } from '../data/fabrics';
import { fitTable, garmentSpecs, pieceSpecs, seamReport } from '../lib/specs';
import { FITS } from '../data/draft';
import { fmt, toUnit } from '../lib/units';
import { FabricPick } from './TrimFields';
import { FabricSwatch } from './FabricBrowser';
import { faceName } from './editHelpers';
import { Disclosure, Seg, SubLabel } from './controls';
import { copiesOf } from './sides';
import MultiPanel from './MultiPanel';
import MeasureField from './MeasureField';
import { canEditMeasure, targetKey, type MeasureTarget } from '../data/measureEdit';

export function FitPick() {
  const { project, setFit } = usePick('project', 'setFit');
  const fit = project.fit ?? 'regular';
  return (
    <div className="seg full" role="group" aria-label="Fit">
      {FITS.map((f) => (
        <button key={f} className={fit === f ? 'on' : ''} aria-pressed={fit === f} onClick={() => setFit(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
      ))}
    </div>
  );
}

/** Collar worn folded down or popped up. */
export function CollarControl() {
  const { project, setCollar } = usePick('project', 'setCollar');
  const collar = project.edits?.collar ?? 'down';
  return (
    <>
      <Seg label="Collar" value={collar} onChange={setCollar} options={[{ id: 'down', label: 'Collar down' }, { id: 'up', label: 'Collar up' }]} />
      <p className="group-note">{collar === 'down' ? 'Folded over, the way a shirt is normally worn.' : 'Popped up around the neck. The under collar shows on the outside edge.'}</p>
    </>
  );
}

/** Hooks for the numbers you can type into: a measurement field when the pattern has something to move, a plain number otherwise. */
function useField() {
  const { project, units } = usePick('project', 'units');
  const tgt = (t: MeasureTarget) => (canEditMeasure(project.garment, project.pieces, t) ? t : null);
  return (cm: number, t: MeasureTarget, label: string) => <MeasureField cm={cm} units={units} label={label} target={tgt(t)} pulseKey={targetKey(t)} />;
}

/** Shape: the selected point, or every selected point with the align tools. */
export function PointCard() {
  const { project, units, selPiece, selPoint, toggleSmooth, deletePoint, selMulti } = usePick('project', 'units', 'selPiece', 'selPoint', 'toggleSmooth', 'deletePoint', 'selMulti');
  const piece = project.pieces.find((p) => p.id === selPiece);
  const point = piece?.points.find((q) => q.id === selPoint);
  if (selMulti.length > 1) {
    return (
      <Disclosure id="shape-point" title="Selected points" icon="target" count={selMulti.length} openFirst>
        <MultiPanel />
      </Disclosure>
    );
  }
  if (!point || !piece) return null;
  return (
    <Disclosure id="shape-point" title="Selected point" icon="target" openFirst>
      <div className="kv"><span>Across</span><b>{toUnit(point.x, units).toFixed(2)} {units}</b></div>
      <div className="kv"><span>Down</span><b>{toUnit(point.y, units).toFixed(2)} {units}</b></div>
      {point.tag && <div className="kv"><span>Anchor</span><b>{point.tag}</b></div>}
      <div className="row">
        <button className="btn small" onClick={() => toggleSmooth(piece.id, point.id)}>{point.smooth ? 'Make corner' : 'Make curve'}</button>
        <button className="btn small ghost" disabled={!!point.tag} onClick={() => deletePoint(piece.id, point.id)}>Delete</button>
      </div>
    </Disclosure>
  );
}

/** Measurements of the selected piece (or of the whole garment when nothing is selected), typeable. */
export function PieceNumbers() {
  const { project, units, selPiece, selInstance, splitSide, matchOtherSide } = usePick('project', 'units', 'selPiece', 'selInstance', 'splitSide', 'matchOtherSide');
  const field = useField();
  const piece = project.pieces.find((p) => p.id === selPiece);
  const g = garmentSpecs(project.garment, project.pieces);
  // a copy of a piece cut twice can be split off and edited on its own (src/data/split.ts)
  const side = selInstance ?? 0;
  const canSplitHere = !!piece && canSplit(project.garment, piece, side) && selInstance !== null;
  return (
    <>
      {piece && (
        <Disclosure id="shape-piece" title={piece.name} icon="pattern" openFirst>
          <div className="sublabel"><span className="muted">{fabricById(piece.fabric.id).name} · cut {piece.cut}{copiesOf(project.garment, piece) === 2 ? ', right and left' : ''}{piece.splitOf ? ', edited on its own' : ''}</span></div>
          {canSplitHere && (
            <div className="row">
              <button className="btn small" onClick={() => splitSide(piece.id, side)}>Edit this side only</button>
            </div>
          )}
          {piece.splitOf && (
            <div className="row">
              <button className="btn small" onClick={() => matchOtherSide(piece.id)}>Match other side</button>
            </div>
          )}
          {canSplitHere && <p className="fit-note">Change the {side === 1 ? 'right' : 'left'} side without changing the other. Seams stay the same.</p>}
          {piece.splitOf && <p className="fit-note">This side has its own shape. Match other side puts it back to a mirror of the other side.</p>}
          {pieceSpecs(piece, project.edits).map((s) => (
            <div className="kv" key={s.label}><span>{s.label}</span>{piece.specs.some((d) => d.label === s.label) ? field(s.value, { kind: 'spec', pieceId: piece.id, label: s.label }, `${piece.name} ${s.label}`) : <b>{fmt(s.value, units)}</b>}</div>
          ))}
          <p className="fit-note">Click a number to type your own. The pattern and the 3D garment follow.</p>
        </Disclosure>
      )}
      <Disclosure id="shape-garment" title="Whole garment" icon="specs" openFirst={!piece}>
        {g.map((r) => (
          <div className="kv" key={r.label}><span>{r.label}</span>{field(r.value, { kind: 'garment', label: r.label }, r.label)}</div>
        ))}
        {!piece && <p className="fit-note">Select a piece on the chart to see and type its own numbers.</p>}
      </Disclosure>
    </>
  );
}

/** Review: the fit table, seam report, garment specs and every piece. */
export function ReviewSections() {
  const { project, units, selPiece } = usePick('project', 'units', 'selPiece');
  const field = useField();
  const g = garmentSpecs(project.garment, project.pieces);
  return (
    <>
      <Disclosure id="spec-fit" title="Fit check" icon="stretch" openFirst>
        <FitPick />
        <div className="fit-head"><span /><span>Body</span><span>Garment</span><span>Ease</span></div>
        {fitTable(project.garment, project.pieces, project.body).map((r) => {
          const ease = r.body === null ? null : r.garment - r.body;
          return (
            <div className="fit-row" key={r.label}>
              <span>{r.label}</span>
              <span className="muted">{r.body === null ? '·' : toUnit(r.body, units).toFixed(1)}{r.estimated ? '*' : ''}</span>
              {field(r.garment, { kind: 'fit', label: r.label }, `${r.label} garment measurement`)}
              <span className={ease === null || r.length ? '' : ease < 0 ? 'neg' : ease < 2 ? 'tight' : 'pos'}>
                {ease === null ? '' : (ease > 0 ? '+' : '') + toUnit(ease, units).toFixed(1)}
              </span>
            </div>
          );
        })}
        <div className="fit-note">In {units}. Click a garment number to type your own. * estimated from your other measurements. Negative ease means the garment is smaller than the body and has to stretch.</div>
      </Disclosure>

      <Disclosure id="spec-seams" title="Seam report" icon="seams">
        {seamReport(project.garment, project.pieces, project.edits).map((r) => {
          const diff = r.a - r.b;
          const want = r.ease ?? 0;
          const ok = Math.abs(diff - want) < 0.1;
          return (
            <div className="seam-row" key={r.label}>
              <span>{r.label}</span>
              <span className="muted">{toUnit(r.a, units).toFixed(1)} / {toUnit(r.b, units).toFixed(1)}</span>
              <b className={ok ? 'pos' : 'neg'}>
                {r.ease !== undefined ? `ease ${(diff > 0 ? '+' : '') + toUnit(diff, units).toFixed(1)}` : ok ? 'Match' : (diff > 0 ? '+' : '') + toUnit(diff, units).toFixed(1)}
              </b>
            </div>
          );
        })}
        <div className="fit-note">Edge lengths that get sewn together. Green when they match (or carry their intended ease), red when a pattern edit makes them disagree.</div>
      </Disclosure>

      <Disclosure id="spec-garment" title="Garment specs" icon="specs">
        {g.map((r) => (
          <div className="kv" key={r.label}><span>{r.label}</span>{field(r.value, { kind: 'garment', label: r.label }, r.label)}</div>
        ))}
      </Disclosure>

      <Disclosure id="spec-pieces" title="Pieces" icon="pattern" count={project.pieces.length}>
        {project.pieces.map((p) => (
          <div className={`piece-spec ${p.id === selPiece ? 'hl' : ''}`} key={p.id}>
            <div className="sublabel">{p.name} <span className="muted">· {fabricById(p.fabric.id).name} · cut {p.cut}{copiesOf(project.garment, p) === 2 ? ', right and left' : ''}</span></div>
            {pieceSpecs(p, project.edits).map((s) => (
              <div className="kv" key={s.label}><span>{s.label}</span>{p.specs.some((d) => d.label === s.label) ? field(s.value, { kind: 'spec', pieceId: p.id, label: s.label }, `${p.name} ${s.label}`) : <b>{fmt(s.value, units)}</b>}</div>
            ))}
          </div>
        ))}
      </Disclosure>
    </>
  );
}
