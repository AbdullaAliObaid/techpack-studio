// Patchwork: attachment library (drag onto the 3D garment or add to the selected piece), the attachment list and its editor.
import { useState } from 'react';
import { useStore } from '../store';
import type { AttachKind, Attachment } from '../data/edits';
import { FABRICS, fabricById } from '../data/fabrics';
import { centroid, samplePoly } from '../lib/geometry';
import { ArtworkGroup, outlineD } from './Artwork';
import { KINDS, KIND_BLURB, KIND_LABEL, OUTLINE_LIST, templatesFor, type TemplateDef } from './editHelpers';
import { LenInput, Row, Seg } from './controls';
import EmblemEditor from './EmblemEditor';
import Icon from './Icon';

export const ATTACHMENT_MIME = 'application/x-techit-attachment';

function Tile({ def, kind, armed, onArm }: { def: TemplateDef; kind: AttachKind; armed: boolean; onArm: () => void }) {
  const t = def.make();
  const o = outlineD(t);
  const S = Math.max(t.w, t.h) * 1.25;
  return (
    <button
      className={`att-tile ${armed ? 'on' : ''}`}
      draggable
      aria-pressed={armed}
      aria-label={`${KIND_LABEL[kind]}, ${def.label}. Drag onto the garment or press to choose.`}
      title="Drag onto the garment"
      onClick={onArm}
      onDragStart={(e) => {
        const payload = def.make(); // fresh layer ids for every drag
        e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(payload));
        e.dataTransfer.setData('text/plain', payload.name);
        e.dataTransfer.effectAllowed = 'copy';
      }}
    >
      <svg viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} aria-hidden="true" pointerEvents="none">
        <ArtworkGroup a={t} fill="var(--fill)" />
        <path d={o.d} transform={o.transform} fill="none" stroke="var(--label-2)" strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
      </svg>
      <span>{def.label}</span>
    </button>
  );
}

export default function PatchworkTab() {
  const { project, selPiece, selAttachment, addAttachment, set, units } = useStore();
  const [kind, setKind] = useState<AttachKind>('pocket');
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const edits = project.edits;
  const atts = edits?.attachments ?? [];
  const att = atts.find((a) => a.id === selAttachment) ?? null;
  const piece = project.pieces.find((p) => p.id === selPiece);
  const defs = templatesFor(kind);
  const armed = defs.find((d) => d.key === armedKey) ?? defs[0];

  const addToPiece = () => {
    if (!piece) return;
    const c = centroid(samplePoly(piece.points));
    addAttachment({ ...armed.make(), pieceId: piece.id, x: c.x, y: c.y });
    set({ selLayer: null });
  };

  return (
    <>
      <div className="card">
        <div className="card-title">Attachments</div>
        <Seg label="Attachment type" value={kind} options={KINDS} onChange={(k) => { setKind(k); setArmedKey(null); }} />
        <p className="group-note" style={{ padding: '8px 0 6px' }}>{KIND_BLURB[kind]}</p>
        <div className="att-grid">
          {defs.map((d) => <Tile key={d.key} def={d} kind={kind} armed={armed.key === d.key} onArm={() => setArmedKey(d.key)} />)}
        </div>
        <p className="group-note" style={{ padding: '8px 0 0' }}>Drag a tile onto the 3D garment, or add it to the piece you have selected.</p>
        <button className="btn primary block" style={{ marginTop: 8 }} disabled={!piece} onClick={addToPiece}>
          <Icon name="plus" size={16} /> {piece ? `Add to ${piece.name}` : 'Select a piece to add'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">On this garment <span className="muted">· {atts.length}</span></div>
        {atts.length === 0 && <div className="group-note">Nothing added yet. Pockets, patches, straps and prints show up here and on the sewing chart.</div>}
        <ul className="att-list">
          {atts.map((a) => (
            <li key={a.id} className={a.id === selAttachment ? 'on' : ''}>
              <button className="att-row" aria-pressed={a.id === selAttachment} onClick={() => set({ selAttachment: a.id, selLayer: null, selPiece: a.pieceId })}>
                <span className="att-ico"><Icon name="patch" size={16} /></span>
                <span className="att-name">{a.name}</span>
                <span className="muted">{KIND_LABEL[a.kind]} · {project.pieces.find((p) => p.id === a.pieceId)?.name ?? 'No piece'}</span>
              </button>
              <button className="icon-btn sm danger" aria-label={`Delete ${a.name}`} title="Delete" onClick={() => useStore.getState().removeAttachment(a.id)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      </div>

      {att && <AttachmentEditor att={att} units={units} />}
      {att && <EmblemEditor att={att} />}
    </>
  );
}

function AttachmentEditor({ att, units }: { att: Attachment; units: 'cm' | 'in' }) {
  const { updateAttachment, project } = useStore();
  const host = project.pieces.find((p) => p.id === att.pieceId);
  const fab = att.fabric ?? host?.fabric ?? project.pieces[0].fabric;
  const fabric = fabricById(fab.id);
  const patch = (p: Partial<Attachment>) => updateAttachment(att.id, p);
  return (
    <div className="card">
      <div className="card-title">Selected attachment</div>
      <Row label="Name" htmlFor="att-name"><input id="att-name" className="txt" value={att.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} /></Row>
      <div className="frow stack">
        <span className="lbl">Type</span>
        <Seg label="Attachment type" value={att.kind} options={KINDS} onChange={(k) => patch({ kind: k })} />
        <span className="group-note" style={{ padding: 0 }}>{KIND_BLURB[att.kind]}</span>
      </div>
      <Row label="Size"><LenInput units={units} label="Width" value={att.w} min={0.5} max={80} onChange={(v) => patch({ w: v })} /><LenInput units={units} label="Height" value={att.h} min={0.5} max={80} onChange={(v) => patch({ h: v })} /></Row>
      <div className="frow stack">
        <label htmlFor="att-rot">Rotation <b className="val">{Math.round(att.rotation)}°</b></label>
        <input id="att-rot" type="range" min={-180} max={180} step={1} value={att.rotation} onChange={(e) => patch({ rotation: Number(e.target.value) })} />
      </div>
      <div className="frow stack">
        <span className="lbl">Outline</span>
        <div className="outline-row" role="group" aria-label="Outline">
          {OUTLINE_LIST.map((o) => {
            const d = outlineD({ outline: o.id, w: 1, h: 1 });
            return (
              <button key={o.id} className={att.outline === o.id ? 'on' : ''} aria-pressed={att.outline === o.id} aria-label={o.label} title={o.label} onClick={() => patch({ outline: o.id })}>
                <svg viewBox="-0.65 -0.65 1.3 1.3" aria-hidden="true"><path d={d.d} transform={d.transform} fill="none" stroke="currentColor" strokeWidth="0.07" /></svg>
              </button>
            );
          })}
        </div>
      </div>
      {att.kind !== 'print' && (
        <div className="frow stack">
          <label htmlFor="att-fab">Fabric</label>
          <select id="att-fab" className="sel" value={att.fabric ? att.fabric.id : ''} onChange={(e) => patch({ fabric: e.target.value ? { id: e.target.value, color: 0 } : undefined })}>
            <option value="">Same as the piece</option>
            {FABRICS.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <div className="swatches" role="group" aria-label="Fabric colour">
            {fabric.colors.map((c, i) => (
              <button key={c.name} title={c.name} aria-label={c.name} aria-pressed={att.fabric ? att.fabric.color === i : fab.color === i} className={(att.fabric ? att.fabric.color : fab.color) === i ? 'on' : ''} style={{ background: c.hex }} onClick={() => patch({ fabric: { id: fab.id, color: i } })} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
