// Inspector: five sections (Garment, Design, Construction, Body, Specs), each with titled, collapsible groups.
import { useStore, type InspectorTab } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { FABRICS, fabricById, stretchLabel } from '../data/fabrics';
import { fabricDataUrl } from '../lib/textures';
import { fitTable, garmentSpecs, pieceSpecs, seamReport } from '../lib/specs';
import { FITS } from '../data/draft';
import { fmt, toUnit } from '../lib/units';
import Library from './Library';
import DesignPanel from './DesignPanel';
import ConstructionPanel from './ConstructionPanel';
import PosePanel from './PosePanel';
import { BodyFields, BodyType } from './BodyPanel';
import { Disclosure, TabHeader } from './controls';
import { copiesOf } from './sides';
import Icon from './Icon';

const TABS: { id: InspectorTab; label: string; icon: string }[] = [
  { id: 'garment', label: 'Garment', icon: 'garment' },
  { id: 'design', label: 'Design', icon: 'design' },
  { id: 'construction', label: 'Construction', icon: 'construction' },
  { id: 'body', label: 'Body', icon: 'body' },
  { id: 'specs', label: 'Specs', icon: 'specs' },
];

export default function Inspector() {
  const { inspectorTab: tab, set, drawer } = useStore();
  const go = (id: InspectorTab) => set({ inspectorTab: id });
  const onKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
      go(n.id);
      requestAnimationFrame(() => document.getElementById(`itab-${n.id}`)?.focus());
    }
  };
  return (
    <>
      <aside className={`inspector ${drawer ? 'drawer-open' : ''}`} aria-label="Inspector">
        <div className="inspector-head">
          <button className="drawer-close btn small" onClick={() => set({ drawer: false })} aria-label="Close inspector"><Icon name="chevronRight" size={14} /> Hide inspector</button>
          <div className="itabs" role="tablist" aria-label="Inspector sections" onKeyDown={onKey}>
            {TABS.map((t) => (
              <button key={t.id} id={`itab-${t.id}`} role="tab" aria-selected={tab === t.id} tabIndex={tab === t.id ? 0 : -1} className={tab === t.id ? 'on' : ''} aria-label={t.label} title={t.label} onClick={() => go(t.id)}>
                <Icon name={t.icon} size={20} />
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="inspector-body" role="tabpanel" aria-labelledby={`itab-${tab}`}>
          {tab === 'garment' ? <GarmentTab /> : tab === 'design' ? <DesignPanel /> : tab === 'construction' ? <ConstructionPanel /> : tab === 'body' ? <BodyTab /> : <SpecsTab />}
        </div>
      </aside>
    </>
  );
}

function FitPick() {
  const { project, setFit } = useStore();
  const fit = project.fit ?? 'regular';
  return (
    <div className="seg full" role="group" aria-label="Fit">
      {FITS.map((f) => (
        <button key={f} className={fit === f ? 'on' : ''} aria-pressed={fit === f} onClick={() => setFit(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
      ))}
    </div>
  );
}

function GarmentTab() {
  const { project, selPiece, fabricScope, set, setFabric } = useStore();
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment));
  const piece = project.pieces.find((p) => p.id === selPiece);
  const scope = piece ? fabricScope : 'all';
  const current = (piece ?? project.pieces[0]).fabric;

  return (
    <>
      <TabHeader icon="garment" title="Garment" subtitle={<>{style?.name ?? 'Garment'} in {fabricById(project.pieces[0].fabric.id).name}</>} />

      <Disclosure id="gar-fabric" title="Fabric" icon="grid">
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
                <button className="fabric-main" aria-pressed={active} onClick={() => setFabric(f.id, active ? current.color : 0)}>
                  <img src={fabricDataUrl(f, f.colors[active ? current.color : 0].hex)} alt="" width={44} height={44} />
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
                        <button key={c.name} title={c.name} aria-label={c.name} aria-pressed={current.color === i} className={current.color === i ? 'on' : ''} style={{ background: c.hex }} onClick={() => setFabric(f.id, i)} />
                      ))}
                    </div>
                    <div className="fabric-facts">Safe stretch ~{Math.round(f.stretch * 100)}% · {f.gsm} gsm</div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </Disclosure>

      <Disclosure id="gar-fit" title="Fit" icon="stretch">
        <FitPick />
        <p className="group-note">How much room the pattern has around the body. The pattern and the 3D garment follow.</p>
      </Disclosure>

      <Disclosure id="gar-style" title="Style" icon="library" defaultOpen={false}>
        <Library />
      </Disclosure>
    </>
  );
}

function BodyTab() {
  const { resetBody, project } = useStore();
  return (
    <>
      <TabHeader icon="body" title="Body" subtitle={`${project.body.sex === 'female' ? 'Female' : 'Male'} body, measurements, pose and movement`} />
      <Disclosure id="body-type" title="Body type" icon="body">
        <BodyType />
      </Disclosure>
      <Disclosure id="body-measure" title="Measurements" icon="tape">
        <BodyFields advanced={false} />
        <button className="btn ghost small" onClick={resetBody}>Reset to default</button>
      </Disclosure>
      <Disclosure id="body-more" title="More measurements" icon="tape" defaultOpen={false}>
        <BodyFields advanced />
      </Disclosure>
      <PosePanel />
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
      <TabHeader icon="specs" title="Specs" subtitle="Measurements, fit check and seam lengths for the tech pack." />
      {point && piece && (
        <Disclosure id="spec-point" title="Selected point" icon="target">
          <div className="kv"><span>Across</span><b>{toUnit(point.x, units).toFixed(2)} {units}</b></div>
          <div className="kv"><span>Down</span><b>{toUnit(point.y, units).toFixed(2)} {units}</b></div>
          {point.tag && <div className="kv"><span>Anchor</span><b>{point.tag}</b></div>}
          <div className="row">
            <button className="btn small" onClick={() => toggleSmooth(piece.id, point.id)}>{point.smooth ? 'Make corner' : 'Make curve'}</button>
            <button className="btn small ghost" disabled={!!point.tag} onClick={() => deletePoint(piece.id, point.id)}>Delete</button>
          </div>
        </Disclosure>
      )}

      <Disclosure id="spec-fit" title="Fit check" icon="stretch">
        <FitPick />
        <div className="fit-head"><span /><span>Body</span><span>Garment</span><span>Ease</span></div>
        {fitTable(project.garment, project.pieces, project.body).map((r) => {
          const ease = r.body === null ? null : r.garment - r.body;
          return (
            <div className="fit-row" key={r.label}>
              <span>{r.label}</span>
              <span className="muted">{r.body === null ? '·' : toUnit(r.body, units).toFixed(1)}{r.estimated ? '*' : ''}</span>
              <b>{toUnit(r.garment, units).toFixed(1)}</b>
              <span className={ease === null || r.length ? '' : ease < 0 ? 'neg' : ease < 2 ? 'tight' : 'pos'}>
                {ease === null ? '' : (ease > 0 ? '+' : '') + toUnit(ease, units).toFixed(1)}
              </span>
            </div>
          );
        })}
        <div className="fit-note">In {units}. * estimated from your other measurements. Negative ease means the garment is smaller than the body and has to stretch.</div>
      </Disclosure>

      <Disclosure id="spec-seams" title="Seam lengths" icon="seams" defaultOpen={false}>
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

      <Disclosure id="spec-garment" title="Garment specs" icon="specs" defaultOpen={false}>
        {g.map((r) => (
          <div className="kv" key={r.label}><span>{r.label}</span><b>{fmt(r.value, units)}</b></div>
        ))}
      </Disclosure>

      <Disclosure id="spec-pieces" title="Pieces" icon="pattern" count={project.pieces.length} defaultOpen={false}>
        {project.pieces.map((p) => (
          <div className={`piece-spec ${p.id === selPiece ? 'hl' : ''}`} key={p.id}>
            <div className="sublabel">{p.name} <span className="muted">· {fabricById(p.fabric.id).name} · cut {p.cut}{copiesOf(project.garment, p) === 2 ? ', right and left' : ''}</span></div>
            {pieceSpecs(p, project.edits).map((s) => (
              <div className="kv" key={s.label}><span>{s.label}</span><b>{fmt(s.value, units)}</b></div>
            ))}
          </div>
        ))}
      </Disclosure>
    </>
  );
}
