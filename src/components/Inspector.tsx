import { useState } from 'react';
import { useStore } from '../store';
import { FABRICS, fabricById, stretchLabel } from '../data/fabrics';
import { fabricDataUrl } from '../lib/textures';
import { garmentSpecs, pieceSpecs } from '../lib/specs';
import { fmt, toUnit } from '../lib/units';

export default function Inspector() {
  const [tab, setTab] = useState<'fabric' | 'specs'>('fabric');
  return (
    <aside className="inspector">
      <div className="tabs">
        <button className={tab === 'fabric' ? 'on' : ''} onClick={() => setTab('fabric')}>Fabric</button>
        <button className={tab === 'specs' ? 'on' : ''} onClick={() => setTab('specs')}>Specs</button>
      </div>
      <div className="inspector-body">{tab === 'fabric' ? <FabricTab /> : <SpecsTab />}</div>
    </aside>
  );
}

function FabricTab() {
  const { project, selPiece, fabricScope, set, setFabric } = useStore();
  const piece = project.pieces.find((p) => p.id === selPiece);
  const scope = piece ? fabricScope : 'all';
  const current = (piece ?? project.pieces[0]).fabric;

  return (
    <>
      <div className="seg full">
        <button className={scope === 'all' ? 'on' : ''} onClick={() => set({ fabricScope: 'all' })}>Whole garment</button>
        <button className={scope === 'piece' ? 'on' : ''} disabled={!piece} onClick={() => set({ fabricScope: 'piece' })}>
          {piece ? piece.name : 'Select a piece'}
        </button>
      </div>
      <div className="fabric-list">
        {FABRICS.map((f) => {
          const active = current.id === f.id;
          return (
            <div key={f.id} className={`fabric ${active ? 'on' : ''}`}>
              <button className="fabric-main" onClick={() => setFabric(f.id, active ? current.color : 0)}>
                <img src={fabricDataUrl(f, f.colors[active ? current.color : 0].hex)} alt="" />
                <div>
                  <div className="fabric-name">{f.name}</div>
                  <div className="fabric-meta">
                    <span className={`chip s${f.stretch < 0.05 ? 0 : f.stretch < 0.15 ? 1 : 2}`}>{stretchLabel(f.stretch)}</span>
                    <span>{f.weight}</span>
                  </div>
                </div>
              </button>
              {active && (
                <>
                  <p className="fabric-blurb">{f.blurb}</p>
                  <div className="swatches">
                    {f.colors.map((c, i) => (
                      <button
                        key={c.name}
                        title={c.name}
                        className={current.color === i ? 'on' : ''}
                        style={{ background: c.hex }}
                        onClick={() => setFabric(f.id, i)}
                      />
                    ))}
                  </div>
                  <div className="fabric-facts">
                    Safe stretch ~{Math.round(f.stretch * 100)}% · {f.gsm} gsm
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function SpecsTab() {
  const { project, units, selPiece, selPoint, toggleSmooth, deletePoint } = useStore();
  const g = garmentSpecs(project.garment, project.pieces);
  const piece = project.pieces.find((p) => p.id === selPiece);
  const point = piece?.points.find((q) => q.id === selPoint);

  return (
    <>
      {point && piece && (
        <div className="card">
          <div className="card-title">Selected point</div>
          <div className="kv"><span>X</span><b>{toUnit(point.x, units).toFixed(2)} {units}</b></div>
          <div className="kv"><span>Y</span><b>{toUnit(point.y, units).toFixed(2)} {units}</b></div>
          {point.tag && <div className="kv"><span>Anchor</span><b>{point.tag}</b></div>}
          <div className="row">
            <button className="btn small" onClick={() => toggleSmooth(piece.id, point.id)}>{point.smooth ? 'Make corner' : 'Make curve'}</button>
            <button className="btn small ghost" disabled={!!point.tag} onClick={() => deletePoint(piece.id, point.id)}>Delete</button>
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-title">Garment specs</div>
        {g.map((r) => (
          <div className="kv" key={r.label}><span>{r.label}</span><b>{fmt(r.value, units)}</b></div>
        ))}
      </div>
      {project.pieces.map((p) => (
        <div className={`card ${p.id === selPiece ? 'hl' : ''}`} key={p.id}>
          <div className="card-title">{p.name} <span className="muted">· {fabricById(p.fabric.id).name} · cut {p.cut}</span></div>
          {pieceSpecs(p).map((s) => (
            <div className="kv" key={s.label}><span>{s.label}</span><b>{fmt(s.value, units)}</b></div>
          ))}
        </div>
      ))}
    </>
  );
}
