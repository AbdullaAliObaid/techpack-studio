// Specs > Selected points: the box around a multi selection (X, Y, W, H), align, distribute and corner or curve.
import { useMemo, useRef } from 'react';
import { useStore } from '../store';
import { fromUnit, toUnit } from '../lib/units';
import { NumInput } from './controls';
import { chartEntries, movesFromWorld, placeItems, withLinked } from './multi';
import { alignPoints, boxOf, distributePoints, placeBox, type AlignMode, type Box } from './snap';

const ALIGN: { id: AlignMode; label: string }[] = [
  { id: 'left', label: 'Left' }, { id: 'centre', label: 'Centre' }, { id: 'right', label: 'Right' },
  { id: 'top', label: 'Top' }, { id: 'middle', label: 'Middle' }, { id: 'bottom', label: 'Bottom' },
];

export default function MultiPanel() {
  const { project, selMulti, units, showBothSides, chartFace, moveGroup, setSmoothMany, commit, totalSymmetry } = useStore();
  const entries = useMemo(() => chartEntries(project.garment, project.pieces, showBothSides, chartFace), [project.garment, project.pieces, showBothSides, chartFace]);
  const placed = useMemo(() => placeItems(selMulti, entries), [selMulti, entries]);
  const burst = useRef(0);
  const box = boxOf(placed.map((p) => p.world));
  if (!box || placed.length < 2) return null;
  // X and Y are read on the first point's piece, so they match the numbers the pattern itself shows
  const o = placed[0].entry.offset;

  const apply = (world: { x: number; y: number }[], fresh = true) => {
    // typing in a field makes many small edits: one undo step per burst
    const now = performance.now();
    if (fresh || now - burst.current > 700) commit();
    burst.current = now;
    moveGroup(withLinked(project.pieces, movesFromWorld(placed, world), totalSymmetry));
  };
  const worlds = placed.map((p) => p.world);
  const edit = (to: Partial<Box>) => apply(placeBox(worlds, to), false);
  const u = (cm: number) => toUnit(cm, units);
  const fld = (label: string, v: number, on: (cm: number) => void, min?: number) => (
    <label className="mfield">
      <span>{label}</span>
      <NumInput label={`Selection ${label}`} value={u(v)} digits={units === 'cm' ? 1 : 2} step={units === 'cm' ? 0.1 : 0.05} min={min === undefined ? undefined : u(min)} unit={units} onChange={(n) => on(fromUnit(n, units))} />
    </label>
  );
  const pieceCount = new Set(placed.map((p) => p.item.pieceId)).size;

  return (
    <>
      <div className="kv"><span>Selected</span><b>{placed.length} points{pieceCount > 1 ? ` on ${pieceCount} pieces` : ''}</b></div>
      <div className="mgrid">
        {fld('X', box.x - o.x, (n) => edit({ x: n + o.x }))}
        {fld('Y', box.y - o.y, (n) => edit({ y: n + o.y }))}
        {fld('W', box.w, (n) => edit({ w: n }), 0.1)}
        {fld('H', box.h, (n) => edit({ h: n }), 0.1)}
      </div>
      <div className="sublabel">Align</div>
      <div className="agrid" role="group" aria-label="Align points">
        {ALIGN.map((a) => (
          <button key={a.id} className="btn small" aria-label={`Align ${a.id}`} onClick={() => apply(alignPoints(worlds, a.id))}>{a.label}</button>
        ))}
      </div>
      <div className="sublabel">Distribute evenly</div>
      <div className="row" style={{ marginTop: 0 }}>
        <button className="btn small" disabled={placed.length < 3} aria-label="Distribute horizontally" onClick={() => apply(distributePoints(worlds, 'x'))}>Horizontally</button>
        <button className="btn small" disabled={placed.length < 3} aria-label="Distribute vertically" onClick={() => apply(distributePoints(worlds, 'y'))}>Vertically</button>
      </div>
      <div className="row">
        <button className="btn small" onClick={() => setSmoothMany(placed.map((p) => p.item), true)}>Make smooth</button>
        <button className="btn small" onClick={() => setSmoothMany(placed.map((p) => p.item), false)}>Make corner</button>
      </div>
    </>
  );
}
