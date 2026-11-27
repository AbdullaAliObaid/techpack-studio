// Editor for the selected design: face, placement, size, material and sheen, trim and tag options, artwork layers.
import { useState } from 'react';
import { useStore, usePick } from '../store';
import type { Attachment, Hardware, LabelType } from '../data/edits';
import { shapePolygon } from '../lib/shapes';
import { ArtworkGroup, outlineD } from './Artwork';
import { ColorField, Disclosure, LenInput, NumInput, Row, Seg } from './controls';
import { canHostDesigns, faceName, KIND_ICON, KIND_LABEL, LABEL_TYPES, normaliseOutline, OUTLINE_LIST, rootPiece, scaleAttachment, scaleOutline, SEWN_LABEL } from './editHelpers';
import { drawnHardware, type DrawDraft } from './designLibrary';
import { clean, textWidth } from './designLibrary';
import { FabricPick, FinishPick, SheenPick, ZipperFields } from './TrimFields';
import { DEFAULT_ZIPPER } from './Artwork';
import { copiesOf } from './sides';
import DrawSheet from './DrawSheet';
import EmblemEditor from './EmblemEditor';
import { MethodPicker } from './Insert';
import { canConvert, convertMethod, isMethod } from './artworkMethod';
import { DEFAULT_OPTS } from './designLibrary';
import Icon from './Icon';

export default function AttachmentEditor({ att }: { att: Attachment }) {
  const { updateAttachment, removeAttachment, duplicateAttachment, project, units, set, openDesign } = usePick('updateAttachment', 'removeAttachment', 'duplicateAttachment', 'project', 'units', 'set', 'openDesign');
  const [drawing, setDrawing] = useState<'trim' | 'puller' | null>(null);
  const atts = project.edits?.attachments ?? [];
  const parent = atts.find((q) => q.id === att.pieceId);
  const rootId = rootPiece(atts, att);
  const host = project.pieces.find((p) => p.id === rootId);
  const copies = host && !parent ? copiesOf(project.garment, host) : 1;
  const hostFab = parent?.fabric ?? host?.fabric ?? project.pieces[0].fabric;
  const patch = (p: Partial<Attachment>) => updateAttachment(att.id, p);
  const cloth = att.kind === 'pocket' || att.kind === 'patch' || att.kind === 'strap' || att.kind === 'applique';
  const letters = att.outline === 'shape' && att.shape === 'text';
  const side = att.instance === undefined ? 'b' : att.instance === 0 ? 'r' : 'l';
  const hw = att.hardware;
  const face = att.face ?? 'outside';
  const collar = project.edits?.collar ?? 'down';

  const setHw = (p: Partial<Hardware>) => {
    if (!hw) return;
    const next = { ...hw, ...p };
    // keep the attachment's own sheen in step so every consumer reads the same thing
    const extra: Partial<Attachment> = p.sheen ? { sheen: p.sheen } : {};
    if (p.size !== undefined && p.size !== hw.size && (hw.outline || hw.layers?.length || hw.zipper?.pullerOutline)) {
      patch({ ...scaleAttachment(att, p.size / hw.size), ...extra });
      return;
    }
    const n = next.type === 'zipper' ? 1 : Math.max(1, next.count ?? 1);
    const w = next.type === 'zipper' ? next.size : n > 1 ? (n - 1) * (next.spacing ?? next.size * 2) + next.size : next.size;
    patch({ hardware: next, w, ...extra, ...(next.type === 'zipper' ? {} : { h: next.size, ...(next.outline ? {} : { outline: n > 1 ? 'rect' : 'circle' }) }) });
  };
  const recolour = (hex: string) => patch({ thread: hex, ...(att.layers.length === 1 && (att.kind === 'embroidery' || att.kind === 'print') ? { layers: [{ ...att.layers[0], color: hex }] } : {}) });
  const colour = att.kind === 'print' ? att.layers[0]?.color ?? '#eb5757' : att.thread ?? '#f2c94c';
  const tagTextLayer = att.kind === 'label' ? att.layers.find((l) => l.shape === 'text') : undefined;

  const draftOf = (): DrawDraft => {
    const h = hw!;
    const seed = h.outline?.length ? normaliseOutline(h.outline) : normaliseOutline(shapePolygon('circle', 1, 1)[0]);
    return { type: h.type, unit: seed, size: h.size, holes: h.holes ?? (h.type === 'button' ? 4 : 0), finish: h.finish, color: h.color, sheen: h.sheen ?? 'metallic', layers: h.layers ?? [] };
  };
  const pullerDraft = (): DrawDraft => {
    const z = hw!.zipper ?? DEFAULT_ZIPPER;
    const o = z.pullerOutline;
    const size = o?.length ? Math.max(...o.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 2 : 2;
    return { type: 'puller', unit: o?.length ? normaliseOutline(o) : normaliseOutline(shapePolygon('rounded', 1, 1)[0]), size, holes: 0, finish: z.pullerFinish ?? hw!.finish, sheen: hw!.sheen ?? 'metallic', layers: z.pullerLayers ?? [] };
  };
  const applyDraw = (d: DrawDraft) => {
    if (drawing === 'puller' && hw) {
      const z = hw.zipper ?? DEFAULT_ZIPPER;
      patch({ hardware: { ...hw, zipper: { ...z, puller: 'custom', pullerOutline: scaleOutline(d.unit, d.size), pullerLayers: d.layers, pullerFinish: d.finish } } });
    } else if (hw && hw.type !== 'zipper') {
      const t = drawnHardware({ ...d, type: hw.type });
      const { color: _c, ...rest } = t.hardware!;
      void _c;
      patch({ ...t, name: att.name, hardware: { ...rest, count: hw.count, spacing: hw.spacing, ...(d.color ? { color: d.color } : {}) } });
    }
    setDrawing(null);
  };

  return (
    <div className="editor-block">
      <div className="editing-head">
        <span className="att-ico"><Icon name={KIND_ICON[att.kind]} size={18} /></span>
        <div className="editing-title">
          <input className="txt name" aria-label="Name" value={att.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} />
          <small>{KIND_LABEL[att.kind]}{parent ? `, on ${parent.name}` : host ? `, on ${host.name}` : ''}</small>
        </div>
        <button className="icon-btn sm" aria-label={`Make a copy of ${att.name}`} title="Make a copy to edit separately" onClick={() => duplicateAttachment(att.id)}><Icon name="copy" size={16} /></button>
        <button className="icon-btn sm danger" aria-label={`Delete ${att.name}`} title="Delete" onClick={() => removeAttachment(att.id)}><Icon name="trash" size={16} /></button>
        <button className="btn small" onClick={() => set({ selAttachment: null, selLayer: null, designTab: 'add' })}>Done</button>
      </div>

      {isMethod(att.kind) && (
        <div className="frow stack">
          <span className="lbl">Made as</span>
          <MethodPicker label="How this design is made" value={att.kind} ink={att.layers[0]?.color ?? DEFAULT_OPTS.ink} thread={att.thread ?? DEFAULT_OPTS.thread} cloth={att.fabric?.hex ?? 'var(--fill)'}
            disabled={(m) => m !== att.kind && !canConvert(att, m)} onChange={(m) => { const p = convertMethod(att, m, DEFAULT_OPTS); if (p) { useStore.getState().commit(); patch(p); } }} />
          <span className="group-note" style={{ padding: 0 }}>Same artwork, same place. Pictures stay prints, and a ring cannot be cut from fabric.</span>
        </div>
      )}

      {canHostDesigns(att.kind) && (
        <button className="btn add-onto" onClick={() => openDesign('add')}>
          <Icon name="plus" size={16} /> Add a design onto this {KIND_LABEL[att.kind].toLowerCase()}
        </button>
      )}

      <div className="frow stack">
        <span className="lbl">Which face</span>
        <Seg label="Face of the piece this is on" value={face} onChange={(f) => { patch({ face: f }); set({ viewFace: f }); }}
          options={[{ id: 'outside', label: faceName(project.garment, host, 'outside', collar) }, { id: 'inside', label: faceName(project.garment, host, 'inside', collar) }]} />
        <span className="group-note" style={{ padding: 0 }}>{face === 'inside' ? 'On the side against the body. Shown dotted on the chart.' : 'On the side people see.'}</span>
      </div>

      <Disclosure id="att-placement" title="Placement" icon="target">
        {parent ? (
          <p className="group-note">Sewn onto {parent.name}. Drag it on the chart to move it inside the {KIND_LABEL[parent.kind].toLowerCase()}.</p>
        ) : (
          <div className="frow stack">
            <label htmlFor="att-piece">Piece</label>
            <select id="att-piece" className="sel" value={att.pieceId} onChange={(e) => patch({ pieceId: e.target.value, instance: undefined })}>
              {project.pieces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        )}
        {copies === 2 && (
          <div className="frow stack">
            <span className="lbl">Side</span>
            <Seg label="Side" value={side} options={[{ id: 'r', label: 'Left' }, { id: 'l', label: 'Right' }, { id: 'b', label: 'Both' }]}
              onChange={(v) => patch({ instance: v === 'b' ? undefined : v === 'r' ? 0 : 1 })} />
            <span className="group-note" style={{ padding: 0 }}>{side === 'b' ? 'Shows on both copies, mirrored on the other side.' : `Only on the ${side === 'r' ? 'left' : 'right'} side, as worn.`}</span>
          </div>
        )}
        <Row label="Across"><LenInput units={units} label="Position across" value={att.x} onChange={(v) => patch({ x: v })} /></Row>
        <Row label="Down"><LenInput units={units} label="Position down" value={att.y} onChange={(v) => patch({ y: v })} /></Row>
        <div className="frow stack">
          <label htmlFor="att-rot">Rotation <b className="val">{Math.round(att.rotation)}°</b></label>
          <input id="att-rot" type="range" min={-180} max={180} step={1} value={att.rotation} onChange={(e) => patch({ rotation: Number(e.target.value) })} />
        </div>
        <p className="group-note">Drag it on the chart to move it. Use the corner handle to resize and the top handle to turn it. Arrow keys nudge it, Shift for 1 cm.</p>
      </Disclosure>

      <Disclosure id="att-size" title="Size" icon="stretch">
        {hw ? (
          <>
            <Row label={hw.type === 'zipper' ? 'Tape width' : 'Size'}><LenInput units={units} label="Trim size" value={hw.size} min={0.4} max={6} onChange={(v) => setHw({ size: v })} /></Row>
            {hw.type === 'zipper' ? (
              <Row label="Length"><LenInput units={units} label="Zipper length" value={att.h} min={3} max={90} onChange={(v) => patch({ h: v })} /></Row>
            ) : (
              <>
                <Row label="How many"><NumInput label="Count" value={hw.count ?? 1} min={1} max={20} step={1} digits={0} onChange={(v) => setHw({ count: Math.round(v) })} /></Row>
                <Row label="Spacing"><LenInput units={units} label="Spacing, centre to centre" value={hw.spacing ?? hw.size * 2} min={0.4} max={30} onChange={(v) => setHw({ spacing: v })} /></Row>
              </>
            )}
          </>
        ) : (
          <>
            {letters && (
              <div className="frow stack">
                <label htmlFor="att-letters">Letters</label>
                <input id="att-letters" className="txt" value={att.text ?? ''} maxLength={12} onChange={(e) => { const t = clean(e.target.value); patch({ text: t, w: textWidth(t, att.h), name: `Appliqué "${t}"` }); }} />
              </div>
            )}
            <Row label="Width"><LenInput units={units} label="Width" value={att.w} min={0.5} max={80} onChange={(v) => patch({ w: v })} /></Row>
            <Row label="Height"><LenInput units={units} label="Height" value={att.h} min={0.5} max={80} onChange={(v) => patch({ h: v })} /></Row>
            {(att.kind === 'pocket' || att.kind === 'patch' || att.kind === 'strap' || att.kind === 'label') && att.outline !== 'shape' && (
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
            )}
          </>
        )}
      </Disclosure>

      {att.kind === 'label' && att.label && (
        <Disclosure id="att-tag" title="Tag" icon="tag">
          <div className="frow stack">
            <span className="lbl">Type</span>
            <div className="type-grid" role="group" aria-label="Tag type">
              {LABEL_TYPES.map((t) => (
                <button key={t.id} className={att.label!.type === t.id ? 'on' : ''} aria-pressed={att.label!.type === t.id} title={t.blurb}
                  onClick={() => patch({ label: { ...att.label!, type: t.id as LabelType, color: t.color }, sheen: t.sheen })}>
                  <span className="type-sw" style={{ background: t.color }} /><span>{t.name}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="frow stack">
            <span className="lbl">Sewn</span>
            <Seg label="How the tag is sewn" value={att.label.sewn} onChange={(sewn) => patch({ label: { ...att.label!, sewn } })}
              options={(['ends', 'all-round', 'folded-loop'] as const).map((id) => ({ id, label: SEWN_LABEL[id] }))} />
          </div>
          <div className="frow stack"><span className="lbl">Tag colour</span><ColorField label="Tag colour" value={att.label.color} onChange={(color) => patch({ label: { ...att.label!, color } })} /></div>
          {tagTextLayer && (
            <Row label="Tag text" htmlFor="tag-text"><input id="tag-text" className="txt" maxLength={24} value={tagTextLayer.text ?? ''} onChange={(e) => patch({ layers: att.layers.map((l) => (l.id === tagTextLayer.id ? { ...l, text: e.target.value } : l)) })} /></Row>
          )}
        </Disclosure>
      )}

      <Disclosure id="att-material" title="Material and look" icon="garment">
        {cloth && <FabricPick value={att.fabric} host={hostFab} onChange={(fabric) => patch({ fabric })} />}
        {(cloth || att.kind === 'label') && <div className="frow stack"><span className="lbl">Stitch thread</span><ColorField label="Stitch thread" value={att.thread ?? '#f2f2f2'} onChange={(c) => patch({ thread: c })} /></div>}
        {att.kind === 'embroidery' && <div className="frow stack"><span className="lbl">Thread colour</span><ColorField label="Thread colour" value={colour} onChange={recolour} /></div>}
        {att.kind === 'print' && <div className="frow stack"><span className="lbl">Ink colour</span><ColorField label="Ink colour" value={colour} onChange={recolour} /></div>}
        {hw && hw.type !== 'zipper' && (
          <>
            <FinishPick value={hw.finish} onChange={(finish) => setHw({ finish, color: undefined })} />
            {(hw.type === 'button' || hw.color) && (
              <div className="frow stack"><span className="lbl">Or a plastic colour</span><ColorField label="Plastic colour" value={hw.color ?? ''} onChange={(color) => setHw({ color })} /></div>
            )}
            {hw.type === 'button' && (
              <div className="frow stack">
                <span className="lbl">Holes</span>
                <Seg label="Holes" value={String(hw.holes ?? 4)} onChange={(v) => setHw({ holes: v === 'shank' ? 'shank' : (Number(v) as 0 | 2 | 4) })}
                  options={[{ id: '0', label: 'None' }, { id: '2', label: '2 holes' }, { id: '4', label: '4 holes' }, { id: 'shank', label: 'Shank' }]} />
              </div>
            )}
            {(hw.type === 'button' || hw.type === 'snap' || hw.type === 'stud') && (
              <button className="btn small" onClick={() => setDrawing('trim')}><Icon name="draw" size={14} /> {hw.outline?.length ? 'Edit your drawing' : 'Draw your own shape'}</button>
            )}
          </>
        )}
        {hw && hw.type === 'zipper' && (
          <ZipperFields zip={hw.zipper ?? DEFAULT_ZIPPER} onZip={(z) => setHw({ zipper: { ...(hw.zipper ?? DEFAULT_ZIPPER), ...z } })} finish={hw.finish} onFinish={(finish) => setHw({ finish })}
            open={!!hw.open} onOpen={(open) => setHw({ open })} onDrawPuller={() => setDrawing('puller')} />
        )}
        {att.kind !== 'embroidery' && att.kind !== 'print' && <SheenPick metal={!!hw} value={hw?.sheen ?? att.sheen} onChange={(sheen) => (hw ? setHw({ sheen }) : patch({ sheen }))} />}
        {(att.kind === 'embroidery' || att.kind === 'print') && <SheenPick value={att.sheen} onChange={(sheen) => patch({ sheen })} />}
        {hw && (
          <div className="hw-preview" aria-hidden="true">
            <svg viewBox={`${-Math.max(att.w, att.h) * 0.8} ${-Math.max(att.w, att.h) * 0.8} ${Math.max(att.w, att.h) * 1.6} ${Math.max(att.w, att.h) * 1.6}`}><ArtworkGroup a={att} /></svg>
          </div>
        )}
      </Disclosure>

      {hw && hw.type !== 'zipper'
        ? <EmblemEditor att={att} layers={hw.layers ?? []} onLayers={(layers) => setHw({ layers })} fill="var(--fill-2)" title="Engraving and artwork" />
        : hw ? null : <EmblemEditor att={att} fill={att.kind === 'label' ? att.label?.color : undefined} />}

      {drawing && hw && <DrawSheet initial={drawing === 'puller' ? pullerDraft() : draftOf()} doneLabel="Done" onDone={applyDraw} onCancel={() => setDrawing(null)} />}
    </div>
  );
}

