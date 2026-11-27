// "Band across the garment": a stripe set (rugby / polo chest band) at a height measured from the shoulder or the hem.
import { useStore, usePick } from '../store';
import { ColorField, LenInput, NumInput, Row, Seg, SubLabel } from './controls';
const BAND_SWATCH = ['#c0392b', '#ffffff', '#16315f', '#111111', '#d9b45a', '#1f5d3a'];
import { bandSkips } from './designDoc';
import type { Band } from '../data/edits';
import Icon from './Icon';

export default function BandsPanel() {
  const { project, units, selBand, addBand, updateBand, removeBand, set } = usePick('project', 'units', 'selBand', 'addBand', 'updateBand', 'removeBand', 'set');
  const bands = project.edits?.bands ?? [];
  const band = bands.find((b) => b.id === selBand) ?? bands[0] ?? null;
  const total = band ? band.stripes.reduce((s, q) => s + q.height, 0) : 0;
  const patchStripe = (i: number, p: Partial<Band['stripes'][number]>) => band && updateBand(band.id, { stripes: band.stripes.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  const crossing = (b: Band) => project.pieces.filter((p) => !bandSkips(b, p));
  return (
    <div className="dz-bands">
      <div className="group-note">A band runs across the front and back at one height and lines up at the side seams. Sleeves are skipped unless you turn them on.</div>
      <ul className="dz-layers" aria-label="Bands">
        {bands.map((b, i) => (
          <li key={b.id} className={`dz-layer ${band?.id === b.id ? 'on' : ''}`}>
            <button className="dz-layer-main" aria-pressed={band?.id === b.id} onClick={() => set({ selBand: b.id })}>
              <span className="dz-band-thumb" aria-hidden="true">{b.stripes.map((s, j) => <i key={j} style={{ background: s.color, flexGrow: s.height }} />)}</span>
              <span>Band {i + 1}</span>
              <small className="dz-relief-tag">{b.offset} cm from {b.from}</small>
            </button>
            <button className="icon-btn sm danger" aria-label={`Delete band ${i + 1}`} title="Delete band" onClick={() => removeBand(b.id)}><Icon name="trash" size={16} /></button>
          </li>
        ))}
      </ul>
      <button className="btn add-onto" onClick={() => addBand()}><Icon name="plus" size={16} /> {bands.length ? 'Add another band' : 'Add a band across the garment'}</button>

      {band && (
        <div className="dz-props">
          <SubLabel>Position</SubLabel>
          <Row label="Measure from"><Seg<Band['from']> label="Measure from" full={false} value={band.from} options={[{ id: 'shoulder', label: 'Shoulder' }, { id: 'hem', label: 'Hem' }]} onChange={(v) => updateBand(band.id, { from: v })} /></Row>
          <Row label="Distance"><LenInput units={units} label="Band distance" value={band.offset} min={0} max={120} onChange={(v) => updateBand(band.id, { offset: v })} /></Row>
          <Row label="Angle"><NumInput label="Band angle in degrees" unit="°" value={band.angle ?? 0} min={-60} max={60} step={1} digits={0} onChange={(v) => updateBand(band.id, { angle: Math.round(v) })} /></Row>
          <div className="group-note">Tilt the band to turn it around the garment. It stays continuous at the side seams. You can also drag the round handle on the chart, and Shift snaps to 15 degrees.</div>
          <div className="group-note">Top edge of the band, {band.offset} cm {band.from === 'shoulder' ? 'down from the high point shoulder' : 'up from the hem'}. Total height {Math.round(total * 10) / 10} cm.</div>

          <SubLabel>Stripes, top to bottom</SubLabel>
          {band.stripes.map((s, i) => (
            <div className="dz-stripe" key={i}>
              <span className="dz-stripe-n">{i + 1}</span>
              <LenInput units={units} label={`Stripe ${i + 1} height`} value={s.height} min={0.2} max={20} onChange={(v) => patchStripe(i, { height: v })} />
              <ColorField label={`Stripe ${i + 1} colour`} value={s.color} colors={BAND_SWATCH} onChange={(c) => patchStripe(i, { color: c })} />
              <button className="icon-btn sm danger" aria-label={`Remove stripe ${i + 1}`} disabled={band.stripes.length <= 1} onClick={() => updateBand(band.id, { stripes: band.stripes.filter((_, j) => j !== i) })}><Icon name="minus" size={16} /></button>
            </div>
          ))}
          <button className="btn small" onClick={() => updateBand(band.id, { stripes: [...band.stripes, { height: 1.5, color: BAND_SWATCH[(band.stripes.length + 2) % BAND_SWATCH.length] }] })}><Icon name="plus" size={14} /> Add stripe</button>

          <SubLabel>How it is made</SubLabel>
          <Seg<Band['method']> label="Method" value={band.method} options={[{ id: 'printed', label: 'Printed' }, { id: 'woven', label: 'Woven in' }, { id: 'sewn', label: 'Sewn on' }]} onChange={(v) => updateBand(band.id, { method: v })} />
          <Row label="Surface"><Seg label="Band sheen" full={false} value={band.sheen ?? 'matte'} options={[{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }, { id: 'glossy', label: 'Glossy' }]} onChange={(v) => updateBand(band.id, { sheen: v })} /></Row>

          <SubLabel>Pieces it crosses</SubLabel>
          <ul className="dz-skip">
            {project.pieces.map((p) => {
              const on = !bandSkips(band, p);
              return (
                <li key={p.id}>
                  <label>
                    <input type="checkbox" checked={on} onChange={() => updateBand(band.id, { skip: project.pieces.filter((q) => (q.id === p.id ? on : bandSkips(band, q))).map((q) => q.id) })} />
                    <span>{p.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="group-note">{crossing(band).length} {crossing(band).length === 1 ? 'piece' : 'pieces'} carry this band.</div>
        </div>
      )}
    </div>
  );
}
