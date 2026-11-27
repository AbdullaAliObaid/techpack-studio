// Body: measurement fields shared by the Body tab and the floating card on the 3D view.
import { useState } from 'react';
import { useStore, usePick } from '../store';
import { BODY_FIELDS, SKIN_TONES, limbGirths } from '../three/body';
import { fromUnit, toUnit } from '../lib/units';
import Icon from './Icon';
import { Row, Switch } from './controls';
import { SavedBodies } from './BodyPresets';

export function BodyFields({ advanced }: { advanced: boolean }) {
  const { project, units, setBody } = usePick('project', 'units', 'setBody');
  const body = project.body;
  const est = limbGirths(body) as Record<string, number>;
  const step = units === 'cm' ? 0.5 : 0.25;
  return (
    <>
      {BODY_FIELDS.filter((f) => !!f.advanced === advanced).map((f) => {
        const typed = body[f.key] as number | undefined;
        const cm = typed ?? est[f.key];
        const v = toUnit(cm, units);
        return (
          <div className="field" key={f.key}>
            <div className="field-top">
              <label htmlFor={`body-${f.key}`}>
                {f.label}
                {f.advanced && typed === undefined && <span className="est"> estimated</span>}
                {f.advanced && typed !== undefined && (
                  <button className="clear" title="Go back to the estimate" aria-label={`Use the estimate for ${f.label}`} onClick={() => setBody(f.key, undefined)}><Icon name="close" size={12} /></button>
                )}
              </label>
              <div className="num">
                <input
                  id={`body-${f.key}`}
                  type="number"
                  step={step}
                  value={Number(v.toFixed(units === 'cm' ? 1 : 2))}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    if (!isNaN(n)) setBody(f.key, Math.min(f.max, Math.max(f.min, fromUnit(n, units))));
                  }}
                />
                <span>{units}</span>
              </div>
            </div>
            <input type="range" aria-label={`${f.label} slider`} min={toUnit(f.min, units)} max={toUnit(f.max, units)} step={step} value={v}
              onChange={(e) => setBody(f.key, fromUnit(parseFloat(e.target.value), units))} />
          </div>
        );
      })}
    </>
  );
}

export function BodyType() {
  const { project, skin, set, setLink, setBodyPreset } = usePick('project', 'skin', 'set', 'setLink', 'setBodyPreset');
  const body = project.body;
  return (
    <>
      <div className="seg full" role="group" aria-label="Body preset">
        <button className={body.sex !== 'female' ? 'on' : ''} aria-pressed={body.sex !== 'female'} onClick={() => setBodyPreset('male')}>Male</button>
        <button className={body.sex === 'female' ? 'on' : ''} aria-pressed={body.sex === 'female'} onClick={() => setBodyPreset('female')}>Female</button>
      </div>
      <div className="frow stack">
        <span className="lbl">Skin tone <b className="val">{SKIN_TONES[skin]?.name}</b></span>
        <div className="swatches">
          {SKIN_TONES.map((t, i) => (
            <button key={t.name} title={t.name} aria-label={`Skin tone ${t.name}`} aria-pressed={skin === i} className={skin === i ? 'on' : ''} style={{ background: t.hex }} onClick={() => set({ skin: i })} />
          ))}
        </div>
      </div>
      <Row label="Pattern follows body"><Switch label="Pattern follows body" on={project.linkPattern} onChange={setLink} /></Row>
      <p className="group-note">Turn off to test a fixed pattern on different bodies.</p>
    </>
  );
}

/** Floating measurement card on the 3D view. Closed by default so it never covers the model. */
export default function BodyCard() {
  const { project, units, resetBody, set } = usePick('project', 'units', 'resetBody', 'set');
  const [open, setOpen] = useState(false);
  const b = project.body;
  return (
    <div className={`body-card material ${open ? 'open' : ''}`}>
      <button className="body-card-head" aria-expanded={open} aria-controls="body-card-body" onClick={() => setOpen(!open)}>
        <span className="body-card-ico" aria-hidden="true"><Icon name="body" size={16} /></span>
        <span className="body-card-title">Body</span>
        <span className="body-card-sum">{b.sex === 'female' ? 'Female' : 'Male'}, {toUnit(b.height, units).toFixed(0)} {units}</span>
        <span className="dsc-chev" aria-hidden="true"><Icon name="chevronRight" size={14} /></span>
      </button>
      {open && (
        <div className="body-card-body" id="body-card-body">
          <BodyFields advanced={false} />
          <div className="row wrap">
            <button className="btn small ghost" onClick={resetBody}>Reset</button>
            <button className="btn small" onClick={() => { useStore.getState().setWorkspace('fit'); set({ drawer: true }); }}>More in Fit</button>
          </div>
        </div>
      )}
    </div>
  );
}
