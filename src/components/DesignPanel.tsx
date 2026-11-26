// Design tab: the design library (cut and sew, embroidery, print, hardware), what is on the garment, and the editor
// for the selected item. Tiles drag onto the 3D model or the 2D chart, or are added to the selected piece.
import { useRef, useState } from 'react';
import { useStore } from '../store';
import type { Attachment, Finish, HardwareType } from '../data/edits';
import { FABRICS, fabricById } from '../data/fabrics';
import { centroid, samplePoly } from '../lib/geometry';
import { ArtworkGroup, FINISH, FINISH_IDS, outlineD } from './Artwork';
import {
  appliqueShape, appliqueText, ATTACHMENT_MIME, DEFAULT_OPTS, embroideryShape, embroideryText, hardwareAttachment, HARDWARE, hwDefaults, PATCHES, POCKETS,
  printShape, printStripe, printText, SINGLE_SHAPES, STRAPS, THREAD_SHAPES, clean, textWidth, type DesignOpts, type HwOpts, type Kind4, type Tile,
} from './designLibrary';
import { KIND_BLURB, KIND_ICON, KIND_LABEL, OUTLINE_LIST, type AttachTemplate } from './editHelpers';
import { ColorField, Disclosure, LenInput, NumInput, Row, Seg, SubLabel, TabHeader } from './controls';
import { copiesOf, instanceName } from './sides';
import EmblemEditor from './EmblemEditor';
import Icon from './Icon';

export { ATTACHMENT_MIME };

interface Armed { key: string; label: string; make: () => AttachTemplate }

function Preview({ t, host }: { t: AttachTemplate; host: string }) {
  const f = t.fabric ? fabricById(t.fabric.id) : null;
  const fill = f ? (f.colors[t.fabric!.color] ?? f.colors[0]).hex : host;
  const hw = t.kind === 'hardware';
  const S = hw ? (t.hardware?.type === 'zipper' ? t.h * 1.15 : Math.max(t.w, t.h) * 1.5) : Math.max(t.w, t.h) * 1.18;
  const o = outlineD(t);
  const showLine = t.kind !== 'hardware' && t.kind !== 'embroidery' && t.kind !== 'print';
  return (
    <svg viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} aria-hidden="true" pointerEvents="none">
      <ArtworkGroup a={t} fill={fill} />
      {showLine && !(t.outline === 'shape' && t.shape === 'text') && <path d={o.d} transform={o.transform} fill="none" stroke="var(--label-2)" strokeWidth={1.2} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export default function DesignPanel() {
  const { project, selPiece, selInstance, selAttachment, showBothSides, addAttachment, set, units } = useStore();
  const [opts, setOpts] = useState<DesignOpts>({ ...DEFAULT_OPTS, fabric: { id: 'canvas', color: 2 } });
  const [cutKind, setCutKind] = useState<Kind4>('pocket');
  const [hwType, setHwType] = useState<HardwareType>('rivet');
  const [hw, setHw] = useState<Record<HardwareType, HwOpts>>(() => Object.fromEntries(HARDWARE.map((d) => [d.type, hwDefaults(d)])) as Record<HardwareType, HwOpts>);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const reg = useRef(new Map<string, Armed>());
  reg.current = new Map();

  const atts = project.edits?.attachments ?? [];
  const att = atts.find((a) => a.id === selAttachment) ?? null;
  const piece = project.pieces.find((p) => p.id === selPiece);
  const copies = piece ? copiesOf(project.garment, piece) : 1;
  const inst = piece && copies === 2 && showBothSides ? selInstance ?? 0 : undefined;
  const targetLabel = piece ? (inst !== undefined ? instanceName(project.garment, piece, inst) : piece.name) : '';
  const hostHex = (() => { const p = piece ?? project.pieces[0]; const f = fabricById(p.fabric.id); return (f.colors[p.fabric.color] ?? f.colors[0]).hex; })();

  const addTo = (t: AttachTemplate) => {
    if (!piece) return;
    const c = centroid(samplePoly(piece.points));
    addAttachment({ ...t, pieceId: piece.id, x: c.x, y: c.y, ...(inst !== undefined ? { instance: inst } : {}) });
    set({ selLayer: null });
  };

  /** one draggable tile: click to pick it, double click to add it, drag it onto the garment */
  const tile = (key: string, label: string, make: () => AttachTemplate, extra?: { title?: string }) => {
    reg.current.set(key, { key, label, make });
    const on = armedKey === key;
    const t = make();
    return (
      <button
        key={key}
        className={`tile ${on ? 'on' : ''}`}
        draggable
        aria-pressed={on}
        aria-label={`${label}. Drag onto the garment, or pick it and press Add.`}
        title={extra?.title ?? 'Drag onto the garment, or pick it and press Add'}
        onClick={() => setArmedKey(key)}
        onDoubleClick={() => addTo(make())}
        onDragStart={(e) => {
          const payload = make(); // fresh ids for every drag
          e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(payload));
          e.dataTransfer.setData('text/plain', payload.name);
          e.dataTransfer.effectAllowed = 'copy';
          setArmedKey(key);
        }}
      >
        <Preview t={t} host={hostHex} />
        <span>{label}</span>
      </button>
    );
  };
  const tiles = (list: Tile[]) => <div className="tile-grid">{list.map((t) => tile(t.key, t.label, () => t.make(opts)))}</div>;

  const hwDef = HARDWARE.find((d) => d.type === hwType)!;
  const hwo = hw[hwType];
  const setHwo = (p: Partial<HwOpts>) => setHw({ ...hw, [hwType]: { ...hwo, ...p } });

  const setText = (v: string) => setOpts({ ...opts, text: v });
  const textRow = (id: string, hint: string) => (
    <div className="frow stack">
      <label htmlFor={id}>Letters or a word</label>
      <input id={id} className="txt" value={opts.text} maxLength={12} placeholder="ABC" onChange={(e) => setText(e.target.value)} onBlur={() => setText(clean(opts.text))} />
      <span className="group-note" style={{ padding: 0 }}>{hint}</span>
    </div>
  );

  return (
    <>
      <TabHeader icon="design" title="Design" subtitle="Cut out shapes and stitch them on, embroider, print, or fix on hardware." />

      {att && <AttachmentEditor att={att} />}

      <Disclosure id="design-cut" title="Cut and sew" icon="scissors">
        <Seg label="Kind of cloth piece" value={cutKind} onChange={(k) => { setCutKind(k); setArmedKey(null); }}
          options={[{ id: 'pocket', label: 'Pocket' }, { id: 'patch', label: 'Patch' }, { id: 'strap', label: 'Strap' }, { id: 'applique', label: 'Appliqué' }]} />
        <p className="group-note">{KIND_BLURB[cutKind]}</p>
        {cutKind === 'pocket' && tiles(POCKETS)}
        {cutKind === 'patch' && tiles(PATCHES)}
        {cutKind === 'strap' && tiles(STRAPS)}
        {cutKind === 'applique' && (
          <>
            <SubLabel>Shapes</SubLabel>
            <div className="tile-grid">{SINGLE_SHAPES.map((s) => { const t = appliqueShape(s); return tile(t.key, t.label, () => t.make(opts)); })}</div>
            <SubLabel>Letters</SubLabel>
            {textRow('app-text', 'Block capitals cut from fabric.')}
            <div className="tile-grid">{(() => { const t = appliqueText(); return tile(t.key, `"${clean(opts.text)}"`, () => t.make(opts)); })()}</div>
          </>
        )}
        <SubLabel>Fabric and stitching</SubLabel>
        <FabricPick value={opts.fabric} onChange={(fabric) => setOpts({ ...opts, fabric })} />
        <div className="frow stack"><span className="lbl">Stitch thread</span><ColorField label="Stitch thread" value={opts.thread} onChange={(c) => setOpts({ ...opts, thread: c })} /></div>
      </Disclosure>

      <Disclosure id="design-embroidery" title="Embroidery" icon="embroidery" defaultOpen={false}>
        <p className="group-note">Thread stitched into the piece. One shape or word at a time.</p>
        <SubLabel>Shapes</SubLabel>
        <div className="tile-grid">{THREAD_SHAPES.map((s) => { const t = embroideryShape(s); return tile(t.key, t.label, () => t.make(opts)); })}</div>
        <SubLabel>Letters</SubLabel>
        {textRow('emb-text', 'Stitched in block capitals.')}
        <div className="tile-grid">{(() => { const t = embroideryText(); return tile(t.key, `"${clean(opts.text)}"`, () => t.make(opts)); })()}</div>
        <SubLabel>Thread colour</SubLabel>
        <ColorField label="Thread colour" value={opts.thread} onChange={(c) => setOpts({ ...opts, thread: c })} />
      </Disclosure>

      <Disclosure id="design-print" title="Print" icon="print" defaultOpen={false}>
        <p className="group-note">Ink printed onto the piece. Add a second stripe by adding it again.</p>
        <SubLabel>Shapes</SubLabel>
        <div className="tile-grid">{THREAD_SHAPES.map((s) => { const t = printShape(s); return tile(t.key, t.label, () => t.make(opts)); })}</div>
        <SubLabel>Text and stripes</SubLabel>
        {textRow('prt-text', 'Printed in block capitals.')}
        <div className="tile-grid">
          {(() => { const t = printText(); return tile(t.key, `"${clean(opts.text)}"`, () => t.make(opts)); })()}
          {(() => { const t = printStripe(); return tile(t.key, t.label, () => t.make(opts)); })()}
        </div>
        <SubLabel>Ink colour</SubLabel>
        <ColorField label="Ink colour" value={opts.ink} onChange={(c) => setOpts({ ...opts, ink: c })} />
      </Disclosure>

      <Disclosure id="design-hardware" title="Hardware" icon="hardware" defaultOpen={false}>
        <p className="group-note">Metal or plastic trims fixed through the fabric.</p>
        <div className="tile-grid">
          {HARDWARE.map((d) => {
            const o = hw[d.type];
            const key = `hw-${d.type}`;
            const make = () => hardwareAttachment(d.type, o);
            reg.current.set(key, { key, label: d.label, make });
            const on = armedKey === key;
            const t = make();
            const shown = d.type === 'zipper' ? { ...t, h: 8 } : t; // the zipper tile shows a short stretch
            const S = d.type === 'zipper' ? 9 : Math.max(t.w, t.h) * 1.5;
            return (
              <button key={key} className={`tile ${on || hwType === d.type ? 'on' : ''}`} draggable aria-pressed={hwType === d.type}
                aria-label={`${d.label}. Drag onto the garment, or pick it and press Add.`} title="Drag onto the garment, or pick it and press Add"
                onClick={() => { setHwType(d.type); setArmedKey(key); }}
                onDoubleClick={() => addTo(make())}
                onDragStart={(e) => { const p = make(); e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(p)); e.dataTransfer.setData('text/plain', p.name); e.dataTransfer.effectAllowed = 'copy'; setHwType(d.type); setArmedKey(key); }}>
                <svg viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} aria-hidden="true" pointerEvents="none">
                  <ArtworkGroup a={shown} />
                </svg>
                <span>{d.label}</span>
              </button>
            );
          })}
        </div>
        <SubLabel>{hwDef.label} options</SubLabel>
        <FinishPick value={hwo.finish} onChange={(finish) => setHwo({ finish })} />
        <Row label={hwType === 'zipper' ? 'Tape width' : 'Size'}><LenInput units={units} label={`${hwDef.label} size`} value={hwo.size} min={hwDef.sizeRange[0]} max={hwDef.sizeRange[1]} onChange={(size) => setHwo({ size })} /></Row>
        {hwType === 'zipper' ? (
          <>
            <Row label="Length"><LenInput units={units} label="Zipper length" value={hwo.length} min={4} max={80} onChange={(length) => setHwo({ length })} /></Row>
            <Row label="Position"><Seg full={false} label="Zipper position" value={hwo.open ? 'open' : 'closed'} options={[{ id: 'closed', label: 'Closed' }, { id: 'open', label: 'Open' }]} onChange={(v) => setHwo({ open: v === 'open' })} /></Row>
          </>
        ) : (
          <>
            <Row label="How many"><NumInput label="Count" value={hwo.count} min={1} max={12} step={1} digits={0} onChange={(count) => setHwo({ count: Math.round(count) })} /></Row>
            <Row label="Spacing"><LenInput units={units} label="Spacing, centre to centre" value={hwo.spacing} min={0.5} max={20} onChange={(spacing) => setHwo({ spacing })} /></Row>
          </>
        )}
      </Disclosure>

      <Disclosure id="design-list" title="On this garment" icon="layers" count={atts.length}>
        {atts.length === 0 && <div className="group-note">Nothing added yet. Drag a tile onto the garment.</div>}
        <ul className="att-list">
          {atts.map((a) => {
            const host = project.pieces.find((p) => p.id === a.pieceId);
            const c = host ? copiesOf(project.garment, host) : 1;
            const where = !host ? 'No piece' : c === 2 ? (a.instance === undefined ? `${host.name}, both sides` : instanceName(project.garment, host, a.instance)) : host.name;
            return (
              <li key={a.id} className={a.id === selAttachment ? 'on' : ''}>
                <button className="att-row" aria-pressed={a.id === selAttachment} onClick={() => set({ selAttachment: a.id, selLayer: null, selPiece: a.pieceId, selInstance: a.instance ?? null })}>
                  <span className="att-ico"><Icon name={KIND_ICON[a.kind]} size={18} /></span>
                  <span className="att-text"><span className="att-name">{a.name}</span><small>{KIND_LABEL[a.kind]} on {where}</small></span>
                </button>
                <button className="icon-btn sm danger" aria-label={`Delete ${a.name}`} title="Delete" onClick={() => useStore.getState().removeAttachment(a.id)}><Icon name="trash" size={16} /></button>
              </li>
            );
          })}
        </ul>
      </Disclosure>

      {(() => {
        const armed = armedKey ? reg.current.get(armedKey) ?? lastArmed.current : null;
        if (armed) lastArmed.current = armed;
        if (!armed && att) return null;
        return (
          <div className="add-bar material">
            <div className="add-what">
              {armed ? <><b>{armed.label}</b><small>{piece ? `Goes on ${targetLabel}` : 'Select a piece on the chart first'}</small></> : <small>Pick a design above, or drag one onto the pattern or the 3D model.</small>}
            </div>
            <button className="btn primary" disabled={!armed || !piece} onClick={() => armed && addTo(armed.make())}><Icon name="plus" size={16} /> Add</button>
          </div>
        );
      })()}
    </>
  );
}

const lastArmed: { current: Armed | null } = { current: null };

/** Fabric dropdown plus colour swatches. Undefined = same as the piece. */
function FabricPick({ value, onChange, host }: { value: { id: string; color: number } | undefined; onChange: (f: { id: string; color: number } | undefined) => void; host?: { id: string; color: number } }) {
  const fab = fabricById(value?.id ?? host?.id ?? 'canvas');
  const sel = value ?? host;
  return (
    <div className="frow stack">
      <label htmlFor="fab-pick">Fabric</label>
      <select id="fab-pick" className="sel" value={value ? value.id : ''} onChange={(e) => onChange(e.target.value ? { id: e.target.value, color: 0 } : undefined)}>
        <option value="">Same as the piece</option>
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

function FinishPick({ value, onChange }: { value: Finish; onChange: (f: Finish) => void }) {
  return (
    <div className="frow stack">
      <span className="lbl">Finish <b className="val">{FINISH[value].name}</b></span>
      <div className="swatches" role="group" aria-label="Finish">
        {FINISH_IDS.map((f) => (
          <button key={f} title={FINISH[f].name} aria-label={FINISH[f].name} aria-pressed={value === f} className={value === f ? 'on' : ''} style={{ background: `radial-gradient(circle at 35% 30%, ${FINISH[f].light}, ${FINISH[f].base} 55%, ${FINISH[f].dark})` }} onClick={() => onChange(f)} />
        ))}
      </div>
    </div>
  );
}

function AttachmentEditor({ att }: { att: Attachment }) {
  const { updateAttachment, removeAttachment, project, units, set } = useStore();
  const host = project.pieces.find((p) => p.id === att.pieceId);
  const copies = host ? copiesOf(project.garment, host) : 1;
  const hostFab = host?.fabric ?? project.pieces[0].fabric;
  const patch = (p: Partial<Attachment>) => updateAttachment(att.id, p);
  const cloth = att.kind === 'pocket' || att.kind === 'patch' || att.kind === 'strap' || att.kind === 'applique';
  const letters = att.outline === 'shape' && att.shape === 'text';
  const side = att.instance === undefined ? 'b' : att.instance === 0 ? 'r' : 'l';
  const hw = att.hardware;
  const setHw = (p: Partial<NonNullable<Attachment['hardware']>>) => {
    if (!hw) return;
    const next = { ...hw, ...p };
    const n = next.type === 'zipper' ? 1 : Math.max(1, next.count ?? 1);
    const w = next.type === 'zipper' ? next.size : n > 1 ? (n - 1) * (next.spacing ?? next.size * 2) + next.size : next.size;
    patch({ hardware: next, w, ...(next.type === 'zipper' ? {} : { h: next.size, outline: n > 1 ? 'rect' : 'circle' }) });
  };
  const recolour = (hex: string) => patch({ thread: hex, ...(att.layers.length === 1 && (att.kind === 'embroidery' || att.kind === 'print') ? { layers: [{ ...att.layers[0], color: hex }] } : {}) });
  const colour = att.kind === 'print' ? att.layers[0]?.color ?? '#eb5757' : att.thread ?? '#f2c94c';

  return (
    <div className="editor-block">
      <div className="editing-head">
        <span className="att-ico"><Icon name={KIND_ICON[att.kind]} size={18} /></span>
        <div className="editing-title">
          <input className="txt name" aria-label="Name" value={att.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} />
          <small>{KIND_LABEL[att.kind]}</small>
        </div>
        <button className="icon-btn sm danger" aria-label={`Delete ${att.name}`} title="Delete" onClick={() => removeAttachment(att.id)}><Icon name="trash" size={16} /></button>
        <button className="btn small" onClick={() => set({ selAttachment: null, selLayer: null })}>Done</button>
      </div>

      <Disclosure id="att-placement" title="Placement" icon="target">
        <div className="frow stack">
          <label htmlFor="att-piece">Piece</label>
          <select id="att-piece" className="sel" value={att.pieceId} onChange={(e) => patch({ pieceId: e.target.value, instance: undefined })}>
            {project.pieces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
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
        <p className="group-note">Drag it on the chart or the 3D model to move it.</p>
      </Disclosure>

      <Disclosure id="att-size" title="Size" icon="stretch">
        {hw ? (
          <>
            <Row label={hw.type === 'zipper' ? 'Tape width' : 'Size'}><LenInput units={units} label="Trim size" value={hw.size} min={0.4} max={6} onChange={(v) => setHw({ size: v })} /></Row>
            {hw.type === 'zipper' ? (
              <>
                <Row label="Length"><LenInput units={units} label="Zipper length" value={att.h} min={3} max={90} onChange={(v) => patch({ h: v })} /></Row>
                <Row label="Position"><Seg full={false} label="Zipper position" value={hw.open ? 'open' : 'closed'} options={[{ id: 'closed', label: 'Closed' }, { id: 'open', label: 'Open' }]} onChange={(v) => setHw({ open: v === 'open' })} /></Row>
              </>
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
            {(att.kind === 'pocket' || att.kind === 'patch' || att.kind === 'strap') && att.outline !== 'shape' && (
              <div className="frow stack">
                <span className="lbl">Outline</span>
                <div className="outline-row" role="group" aria-label="Outline">
                  {OUTLINE_LIST.filter((o) => o.id !== 'shape').map((o) => {
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

      <Disclosure id="att-material" title="Material" icon="garment">
        {cloth && <FabricPick value={att.fabric} host={hostFab} onChange={(fabric) => patch({ fabric })} />}
        {cloth && <div className="frow stack"><span className="lbl">Stitch thread</span><ColorField label="Stitch thread" value={att.thread ?? '#f2f2f2'} onChange={(c) => patch({ thread: c })} /></div>}
        {att.kind === 'embroidery' && <div className="frow stack"><span className="lbl">Thread colour</span><ColorField label="Thread colour" value={colour} onChange={recolour} /></div>}
        {att.kind === 'print' && <div className="frow stack"><span className="lbl">Ink colour</span><ColorField label="Ink colour" value={colour} onChange={recolour} /></div>}
        {hw && <FinishPick value={hw.finish} onChange={(finish) => setHw({ finish })} />}
        {hw && (
          <div className="hw-preview" aria-hidden="true">
            <svg viewBox={`${-Math.max(att.w, att.h) * 0.8} ${-Math.max(att.w, att.h) * 0.8} ${Math.max(att.w, att.h) * 1.6} ${Math.max(att.w, att.h) * 1.6}`}><ArtworkGroup a={att} /></svg>
          </div>
        )}
      </Disclosure>

      {att.kind !== 'hardware' && <EmblemEditor att={att} />}
    </div>
  );
}
