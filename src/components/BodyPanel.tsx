import { useState } from 'react';
import { useStore } from '../store';
import { BODY_FIELDS, SKIN_TONES } from '../three/body';
import { fromUnit, toUnit } from '../lib/units';

export default function BodyPanel() {
  const { project, units, setBody, resetBody, skin, set } = useStore();
  const [open, setOpen] = useState(() => window.innerWidth > 1500);
  const body = project.body;
  const step = units === 'cm' ? 0.5 : 0.25;

  return (
    <div className={`panel body-panel ${open ? '' : 'closed'}`}>
      <button className="panel-head" onClick={() => setOpen(!open)}>
        <span>Body measurements</span>
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="panel-body">
          <div className="field">
            <div className="field-top"><label>Skin</label><span className="num">{SKIN_TONES[skin]?.name}</span></div>
            <div className="swatches">
              {SKIN_TONES.map((t, i) => (
                <button key={t.name} title={t.name} className={skin === i ? 'on' : ''} style={{ background: t.hex }} onClick={() => set({ skin: i })} />
              ))}
            </div>
          </div>
          {BODY_FIELDS.map((f) => {
            const v = toUnit(body[f.key], units);
            return (
              <div className="field" key={f.key}>
                <div className="field-top">
                  <label>{f.label}</label>
                  <div className="num">
                    <input
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
                <input
                  type="range"
                  min={toUnit(f.min, units)}
                  max={toUnit(f.max, units)}
                  step={step}
                  value={v}
                  onChange={(e) => setBody(f.key, fromUnit(parseFloat(e.target.value), units))}
                />
              </div>
            );
          })}
          <button className="btn ghost small" onClick={resetBody}>Reset to default</button>
        </div>
      )}
    </div>
  );
}
