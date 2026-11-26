// New piece: a step by step sheet. 1 Shape (template or pen), 2 Details (name, fabric, cut), 3 Attach (stitch on top, or sew into an edge).
import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { FABRICS, fabricById } from '../data/fabrics';
import { bbox, bezAt, outlineLength, pathD, toBeziers } from '../lib/geometry';
import { fmt } from '../lib/units';
import { asPoints, finishPieceFlow, normalizedShape, ownEdgeLength, templatePoints, TEMPLATES, type TemplateId } from './flow';
import { copiesOf, instanceName } from './sides';
import { LenInput, Row, Seg } from './controls';
import Icon from './Icon';

const STEPS = ['Shape', 'Details', 'Attach'] as const;

export default function PieceFlow() {
  const flow = useStore((s) => s.pieceFlow);
  if (!flow || flow.drawing) return null;
  return <Sheet />;
}

/** The outline, big, with its edges numbered. Pass onEdge to make them pickable. */
function ShapePreview({ shape, edge, onEdge }: { shape: { x: number; y: number; smooth: boolean }[]; edge?: number; onEdge?: (i: number) => void }) {
  const pts = asPoints(normalizedShape(shape));
  const bz = toBeziers(pts);
  const bb = bbox(pts);
  const pad = Math.max(bb.w, bb.h) * 0.16 + 0.5;
  return (
    <svg className="shape-preview" viewBox={`${bb.minX - pad} ${bb.minY - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}`} role="img" aria-label="Shape preview">
      <path d={pathD(bz)} fill="var(--fill-2)" stroke="var(--label)" strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {onEdge && bz.map((b, i) => {
        const m = bezAt(b, 0.5);
        const on = edge === i;
        const d = `M${b.p0.x},${b.p0.y}C${b.c1.x},${b.c1.y} ${b.c2.x},${b.c2.y} ${b.p1.x},${b.p1.y}`;
        const r = Math.max(bb.w, bb.h) * 0.045 + 0.2;
        return (
          <g key={i} style={{ cursor: 'pointer' }} role="button" aria-label={`Edge ${i + 1}`} aria-pressed={on} tabIndex={0}
            onClick={() => onEdge(i)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdge(i); } }}>
            <path d={d} fill="none" stroke={on ? 'var(--accent)' : 'transparent'} strokeWidth={on ? 5 : 0} strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={d} fill="none" stroke="transparent" strokeWidth={22} vectorEffect="non-scaling-stroke" />
            <circle cx={m.x} cy={m.y} r={r} fill={on ? 'var(--accent-fill)' : 'var(--bg-elevated)'} stroke={on ? 'var(--accent-fill)' : 'var(--label-2)'} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={m.x} y={m.y} fontSize={r * 1.25} textAnchor="middle" dominantBaseline="central" fill={on ? '#fff' : 'var(--label)'} fontWeight={700}>{i + 1}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Sheet() {
  const { pieceFlow: f, setFlow, project, units } = useStore();
  const nameRef = useRef<HTMLInputElement>(null);
  const hosts = project.pieces.filter((p) => p.role !== 'custom');
  const sewing = !!f && f.step === 3 && f.attach === 'sewn';

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') useStore.getState().cancelTools(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  // while sewing into an edge the chart picks edges and the sheet sits low, out of the way
  useEffect(() => { setFlow({ picking: sewing }); return () => setFlow({ picking: false }); }, [sewing, setFlow]);
  useEffect(() => { if (f?.step === 2) { nameRef.current?.focus(); nameRef.current?.select(); } }, [f?.step]);
  if (!f || !f.shape) return null;

  const defaultNames = new Set(['New piece', ...TEMPLATES.map((t) => t.name)]);
  const chooseTemplate = (id: TemplateId) => {
    const t = TEMPLATES.find((x) => x.id === id)!;
    setFlow({ source: 'template', template: id, tw: t.w, th: t.h, shape: templatePoints(id, t.w, t.h), attach: t.attach, ownEdge: 0, ...(defaultNames.has(f.name) ? { name: t.name } : {}) });
  };
  const resize = (w: number, h: number) => setFlow({ tw: w, th: h, shape: templatePoints(f.template as TemplateId, w, h), ownEdge: 0 });
  const startPen = () => {
    setFlow({ drawing: true });
    useStore.setState({ tool: 'pen', penDraft: [], inspectorTab: 'construction', ...(window.innerWidth <= 960 ? { drawer: true } : {}) });
  };

  const host = project.pieces.find((p) => p.id === f.host);
  const hostCopies = host ? copiesOf(project.garment, host) : 1;
  const edgeLen = ownEdgeLength(f.shape, f.ownEdge);
  const hostEdgeLen = (() => {
    if (!f.hostEdge) return null;
    const p = project.pieces.find((q) => q.id === f.hostEdge!.pieceId);
    return p ? outlineLength(p.points, f.hostEdge.fromId, f.hostEdge.toId) : null;
  })();
  const hostEdgeName = (() => {
    if (!f.hostEdge) return '';
    const p = project.pieces.find((q) => q.id === f.hostEdge!.pieceId);
    if (!p) return '';
    return f.hostEdge.instance !== undefined && copiesOf(project.garment, p) === 2 ? instanceName(project.garment, p, f.hostEdge.instance) : p.name;
  })();
  const diff = hostEdgeLen === null ? 0 : edgeLen - hostEdgeLen;

  const fab = fabricById(f.fabric.id);
  const next = () => setFlow({ step: (f.step + 1) as 1 | 2 | 3 });
  const back = () => setFlow({ step: (f.step - 1) as 1 | 2 | 3 });
  const cancel = () => useStore.getState().cancelTools();

  const card = (
    <div className={`sheet flow material ${sewing ? 'docked' : ''}`} role="dialog" aria-modal={!sewing} aria-labelledby="flow-title">
      <div className="flow-head">
        <ol className="steps" aria-label="Progress">
          {STEPS.map((t, i) => {
            const n = i + 1;
            return (
              <li key={t} className={f.step === n ? 'now' : f.step > n ? 'done' : ''} aria-current={f.step === n ? 'step' : undefined}>
                <span className="dot">{f.step > n ? <Icon name="check" size={12} /> : n}</span>
                <span className="steplabel">{t}</span>
              </li>
            );
          })}
        </ol>
        <button className="icon-btn sm" aria-label="Cancel new piece" title="Cancel" onClick={cancel}><Icon name="close" size={16} /></button>
      </div>
      <h2 id="flow-title">{f.step === 1 ? 'Shape' : f.step === 2 ? 'Details' : 'Attach'}<small>Step {f.step} of 3</small></h2>

      {f.step === 1 && (
        <div className="flow-body">
          <p className="group-note">Start from a template, or draw the outline yourself with the pen.</p>
          <div className="tpl-grid" role="group" aria-label="Templates">
            {TEMPLATES.map((t) => {
              const on = f.source === 'template' && f.template === t.id;
              const pts = templatePoints(t.id, t.w, t.h);
              return (
                <button key={t.id} className={`tpl ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => chooseTemplate(t.id)}>
                  <MiniShape shape={pts} />
                  <span>{t.label}</span>
                </button>
              );
            })}
            <button className={`tpl ${f.source === 'pen' ? 'on' : ''}`} aria-pressed={f.source === 'pen'} onClick={startPen}>
              <span className="tpl-ico"><Icon name="pen" size={26} /></span>
              <span>Draw with pen</span>
            </button>
          </div>
          <ShapePreview shape={f.shape} />
          {f.source === 'template' ? (
            <div className="two-col">
              <Row label="Width"><LenInput units={units} label="Width" value={f.tw} min={1} max={80} onChange={(v) => resize(v, f.th)} /></Row>
              <Row label="Height"><LenInput units={units} label="Height" value={f.th} min={1} max={80} onChange={(v) => resize(f.tw, v)} /></Row>
            </div>
          ) : (
            <div className="frow"><span className="muted">Your drawing, {f.shape.length} points</span><button className="btn small" onClick={startPen}><Icon name="pen" size={14} /> Draw again</button></div>
          )}
        </div>
      )}

      {f.step === 2 && (
        <div className="flow-body">
          <div className="frow stack">
            <label htmlFor="flow-name">Name</label>
            <input id="flow-name" ref={nameRef} className="txt" value={f.name} maxLength={40} onChange={(e) => setFlow({ name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') next(); }} />
          </div>
          <div className="frow stack">
            <span className="lbl">Fabric</span>
            <Seg label="Fabric" value={f.fabricMode} options={[{ id: 'same', label: 'Same as garment' }, { id: 'pick', label: 'Pick one' }]} onChange={(v) => setFlow({ fabricMode: v })} />
            {f.fabricMode === 'pick' && (
              <>
                <select className="sel" aria-label="Fabric" value={f.fabric.id} onChange={(e) => setFlow({ fabric: { id: e.target.value, color: 0 } })}>
                  {FABRICS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <div className="swatches" role="group" aria-label="Fabric colour">
                  {fab.colors.map((c, i) => (
                    <button key={c.name} title={c.name} aria-label={c.name} aria-pressed={f.fabric.color === i} className={f.fabric.color === i ? 'on' : ''} style={{ background: c.hex }} onClick={() => setFlow({ fabric: { id: fab.id, color: i } })} />
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="frow stack">
            <span className="lbl">How many to cut</span>
            <Seg label="Cut count" value={String(f.cut)} options={[{ id: '1', label: 'One' }, { id: '2', label: 'A pair' }]} onChange={(v) => setFlow({ cut: v === '2' ? 2 : 1 })} />
            <span className="group-note" style={{ padding: 0 }}>{f.cut === 2 ? 'Cut two, one for each side. They are mirror images.' : 'Cut one.'}</span>
          </div>
        </div>
      )}

      {f.step === 3 && (
        <div className="flow-body">
          <Seg label="How it attaches" value={f.attach} options={[{ id: 'patch', label: 'Stitch on top' }, { id: 'sewn', label: 'Sew into an edge' }]} onChange={(v) => setFlow({ attach: v })} />
          {f.attach === 'patch' ? (
            <>
              <p className="group-note">Patched on like a pocket. It lands in the middle of the piece you choose, then you drag it into place on the chart or the 3D model.</p>
              <div className="frow stack">
                <label htmlFor="flow-host">Piece</label>
                <select id="flow-host" className="sel" value={f.host} onChange={(e) => { const p = project.pieces.find((q) => q.id === e.target.value); setFlow({ host: e.target.value, side: p && copiesOf(project.garment, p) === 2 ? f.side ?? 0 : null }); }}>
                  {hosts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {hostCopies === 2 && (
                <div className="frow stack">
                  <span className="lbl">Side</span>
                  <Seg label="Side" value={String(f.side ?? 0)} options={[{ id: '0', label: 'Left' }, { id: '1', label: 'Right' }]} onChange={(v) => setFlow({ side: Number(v) })} />
                </div>
              )}
            </>
          ) : (
            <>
              <p className="group-note">Two edges get sewn together. Pick the edge of your piece, then click the edge of the garment on the chart.</p>
              <div className="sew-grid">
                <div>
                  <SubTitle n={1} text="Your piece" />
                  <ShapePreview shape={f.shape} edge={f.ownEdge} onEdge={(i) => setFlow({ ownEdge: i })} />
                </div>
                <div className="sew-info">
                  <SubTitle n={2} text="Edge on the garment" />
                  <div className={`pick-state ${f.hostEdge ? 'ok' : ''}`}>
                    {f.hostEdge ? <><b>{hostEdgeName}</b><small>Picked on the chart</small></> : <><b>Click an edge on the chart</b><small>It glows orange as you move over it.</small></>}
                  </div>
                  <div className="lengths">
                    <div><span>Your piece, edge {f.ownEdge + 1}</span><b>{fmt(edgeLen, units)}</b></div>
                    <div><span>Garment edge</span><b>{hostEdgeLen === null ? 'Not picked' : fmt(hostEdgeLen, units)}</b></div>
                  </div>
                  {hostEdgeLen !== null && (
                    <div className={`diff ${Math.abs(diff) < 0.3 ? 'ok' : ''}`}>{Math.abs(diff) < 0.3 ? 'Same length. They match.' : `Your edge is ${fmt(Math.abs(diff), units)} ${diff > 0 ? 'longer' : 'shorter'}. The cloth is eased or stretched to fit.`}</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flow-actions">
        <button className="btn ghost" onClick={cancel}>Cancel</button>
        <span className="spacer" />
        {f.step > 1 && <button className="btn" onClick={back}>Back</button>}
        {f.step < 3
          ? <button className="btn primary" disabled={!f.shape || (f.step === 2 && !f.name.trim())} onClick={next}>Next</button>
          : <button className="btn primary" disabled={f.attach === 'patch' && !f.host} onClick={finishPieceFlow}><Icon name="check" size={16} /> Add piece</button>}
      </div>
      {f.step === 3 && f.attach === 'sewn' && !f.hostEdge && <p className="group-note foot-note">You can also add it now and join it later with the Seam tool.</p>}
    </div>
  );

  return sewing ? <div className="sheet-dock">{card}</div> : (
    <div className="sheet-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) cancel(); }}>{card}</div>
  );
}

function SubTitle({ n, text }: { n: number; text: string }) {
  return <div className="sub-title"><span className="dot">{n}</span>{text}</div>;
}

function MiniShape({ shape }: { shape: { x: number; y: number; smooth: boolean }[] }) {
  const pts = asPoints(normalizedShape(shape));
  const bb = bbox(pts);
  const S = Math.max(bb.w, bb.h) * 1.2;
  const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2;
  return (
    <svg viewBox={`${cx - S / 2} ${cy - S / 2} ${S} ${S}`} aria-hidden="true">
      <path d={pathD(toBeziers(pts))} fill="var(--fill)" stroke="var(--label)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
