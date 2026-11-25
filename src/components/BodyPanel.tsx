import { useState } from 'react';
import { useStore } from '../store';
import { BODY_FIELDS, SKIN_TONES, limbGirths } from '../three/body';
import { fromUnit, toUnit } from '../lib/units';
import Icon from './Icon';

export default function BodyPanel() {
  const { project, units, setBody, resetBody, skin, set, setLink, setBodyPreset } = useStore();
  const [open, setOpen] = useState(() => window.innerWidth > 1500);
  const [more, setMore] = useState(false);
  const body = project.body;
  const est = limbGirths(body) as Record<string, number>;
  const step = units === 'cm' ? 0.5 : 0.25;

  const row = (f: (typeof BODY_FIELDS)[number]) => {
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
  };

  return (
    <div className={`panel material body-panel ${open ? '' : 'closed'}`}>
      <button className="panel-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Body measurements</span>
        <span className={`chev ${open ? 'open' : ''}`}><Icon name="chevron" size={16} /></span>
      </button>
      {open && (
        <div className="panel-body">
          <div className="seg full" role="group" aria-label="Body preset">
            <button className={body.sex !== 'female' ? 'on' : ''} aria-pressed={body.sex !== 'female'} onClick={() => setBodyPreset('male')}>Male</button>
            <button className={body.sex === 'female' ? 'on' : ''} aria-pressed={body.sex === 'female'} onClick={() => setBodyPreset('female')}>Female</button>
          </div>
          <label className="link-row">
            <input type="checkbox" checked={project.linkPattern} onChange={(e) => setLink(e.target.checked)} />
            <span>Pattern follows body. Turn off to test a fixed pattern on different bodies.</span>
          </label>
          <div className="field">
            <div className="field-top"><span className="lbl">Skin</span><span className="num">{SKIN_TONES[skin]?.name}</span></div>
            <div className="swatches">
              {SKIN_TONES.map((t, i) => (
                <button key={t.name} title={t.name} aria-label={`Skin tone ${t.name}`} aria-pressed={skin === i} className={skin === i ? 'on' : ''} style={{ background: t.hex }} onClick={() => set({ skin: i })} />
              ))}
            </div>
          </div>
          {BODY_FIELDS.filter((f) => !f.advanced).map(row)}
          <button className="btn ghost small more" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Fewer measurements' : 'More measurements'}</button>
          {more && BODY_FIELDS.filter((f) => f.advanced).map(row)}
          <button className="btn ghost small" onClick={resetBody}>Reset to default</button>
        </div>
      )}
    </div>
  );
}
