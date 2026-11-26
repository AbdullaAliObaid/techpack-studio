// Shared controls for the design panel: fabric, metal finish, sheen and the zipper designer.
import type { Finish, Sheen, ZipperDesign } from '../data/edits';
import { FABRICS, fabricById } from '../data/fabrics';
import { FINISH, FINISH_IDS } from './Artwork';
import type React from 'react';
import { CLOTH_SHEENS, METAL_SHEENS, SHEEN_LABEL } from './editHelpers';
import { ColorField, Row, Seg, SubLabel } from './controls';
import Icon from './Icon';

/** Fabric dropdown plus colour swatches. Undefined = same as the piece. */
export function FabricPick({ value, onChange, host, id = 'fab-pick', sameLabel = 'Same as the piece' }: {
  value: { id: string; color: number } | undefined; onChange: (f: { id: string; color: number } | undefined) => void; host?: { id: string; color: number }; id?: string; sameLabel?: string;
}) {
  const fab = fabricById(value?.id ?? host?.id ?? 'canvas');
  const sel = value ?? host;
  return (
    <div className="frow stack">
      <label htmlFor={id}>Fabric</label>
      <select id={id} className="sel" value={value ? value.id : ''} onChange={(e) => onChange(e.target.value ? { id: e.target.value, color: 0 } : undefined)}>
        <option value="">{sameLabel}</option>
        {FABRICS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
      </select>
      {(value || host) && (
        <div className="swatches" role="group" aria-label="Fabric colour">
          {fab.colors.map((c, i) => (
            <button key={c.name} title={c.name} aria-label={c.name} aria-pressed={sel?.color === i} className={sel?.color === i ? 'on' : ''} style={{ background: c.hex }} onClick={() => onChange({ id: fab.id, color: i })} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FinishPick({ value, onChange, label = 'Finish' }: { value: Finish; onChange: (f: Finish) => void; label?: string }) {
  return (
    <div className="frow stack">
      <span className="lbl">{label} <b className="val">{FINISH[value].name}</b></span>
      <div className="swatches" role="group" aria-label={label}>
        {FINISH_IDS.map((f) => (
          <button key={f} title={FINISH[f].name} aria-label={FINISH[f].name} aria-pressed={value === f} className={value === f ? 'on' : ''} style={{ background: `radial-gradient(circle at 35% 30%, ${FINISH[f].light}, ${FINISH[f].base} 55%, ${FINISH[f].dark})` }} onClick={() => onChange(f)} />
        ))}
      </div>
    </div>
  );
}

/** Matte / Satin / Glossy (and Metallic for trims). */
export function SheenPick({ value, onChange, metal = false }: { value: Sheen | undefined; onChange: (s: Sheen) => void; metal?: boolean }) {
  const list = metal ? METAL_SHEENS : CLOTH_SHEENS;
  const cur = value ?? (metal ? 'metallic' : 'matte');
  return (
    <div className="frow stack">
      <span className="lbl">Sheen</span>
      <Seg label="Sheen" value={cur} onChange={onChange} options={list.map((s) => ({ id: s, label: SHEEN_LABEL[s] }))} />
      <span className="group-note" style={{ padding: 0 }}>{cur === 'matte' ? 'Flat, no shine.' : cur === 'satin' ? 'Soft glow.' : cur === 'glossy' ? 'Wet look, sharp highlights.' : 'Brushed or polished metal.'}</span>
    </div>
  );
}

const TAPES = ['#3a3a3f', '#111111', '#ffffff', '#e8dcc2', '#2f80ed', '#eb5757', '#27ae60', '#f2c94c'];

/** Everything about a zipper: teeth, tape, puller, length and whether it is open. */
export function ZipperFields({ zip, onZip, finish, onFinish, length, onLength, open, onOpen, onDrawPuller, lengthField }: {
  zip: ZipperDesign; onZip: (p: Partial<ZipperDesign>) => void; finish: Finish; onFinish: (f: Finish) => void;
  length?: number; onLength?: (cm: number) => void; open: boolean; onOpen: (v: boolean) => void; onDrawPuller: () => void; lengthField?: React.ReactNode;
}) {
  void length; void onLength;
  return (
    <>
      <SubLabel>Teeth</SubLabel>
      <Seg label="Teeth" value={zip.teeth} onChange={(teeth) => onZip({ teeth })} options={[{ id: 'metal', label: 'Metal' }, { id: 'coil', label: 'Coil' }, { id: 'molded', label: 'Molded' }]} />
      {zip.teeth === 'metal'
        ? <FinishPick value={finish} onChange={onFinish} label="Metal" />
        : <div className="frow stack"><span className="lbl">Teeth colour</span><ColorField label="Teeth colour" value={zip.teethColor ?? '#e8e8ec'} onChange={(c) => onZip({ teethColor: c })} /></div>}
      <div className="frow stack"><span className="lbl">Tape colour</span><ColorField label="Tape colour" colors={TAPES} value={zip.tape} onChange={(c) => onZip({ tape: c })} /></div>
      <SubLabel>Puller</SubLabel>
      <Seg label="Puller" value={zip.puller} onChange={(puller) => onZip({ puller })} options={[{ id: 'standard', label: 'Classic' }, { id: 'ring', label: 'Ring' }, { id: 'tab', label: 'Tab' }, { id: 'cord', label: 'Cord' }, { id: 'custom', label: 'Yours' }]} />
      {zip.puller === 'custom' && (
        <button className="btn small" onClick={onDrawPuller}><Icon name="draw" size={14} /> {zip.pullerOutline?.length ? 'Edit your puller' : 'Draw your puller'}</button>
      )}
      <FinishPick value={zip.pullerFinish ?? finish} onChange={(pullerFinish) => onZip({ pullerFinish })} label="Puller finish" />
      {lengthField}
      <Row label="Position"><Seg full={false} label="Zipper position" value={open ? 'open' : 'closed'} options={[{ id: 'closed', label: 'Closed' }, { id: 'open', label: 'Open' }]} onChange={(v) => onOpen(v === 'open')} /></Row>
    </>
  );
}
