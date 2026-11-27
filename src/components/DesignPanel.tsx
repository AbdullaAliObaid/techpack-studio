// Design library: every tile is one simple thing (a shape, a word, a trim, a tag) that is cut and sewn on, stitched in
// thread, printed, or fixed on as hardware. Tiles drag onto the 2D chart or the 3D model, or are added to the selection.
import { useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import type { Attachment, HardwareType } from '../data/edits';
import { fabricById } from '../data/fabrics';
import { centroid, samplePoly } from '../lib/geometry';
import { ArtworkGroup, outlineD } from './Artwork';
import {
  appliqueShape, appliqueText, ATTACHMENT_MIME, DEFAULT_OPTS, drawnHardware, embroideryShape, embroideryText, hardwareAttachment, HARDWARE, hwDefaults, newDraft, PATCHES, POCKETS,
  printShape, printStripe, printText, SINGLE_SHAPES, STRAPS, TAG_DEFAULTS, tagAttachment, THREAD_SHAPES, clean, type DesignOpts, type DrawDraft, type HwOpts, type Kind4, type TagOpts, type Tile,
} from './designLibrary';
import { designHost, faceName, normaliseOutline, KIND_BLURB, LABEL_TYPES, SEWN_LABEL, type AttachTemplate, KIND_ICON, KIND_LABEL, rootPiece } from './editHelpers';
import { ColorField, Disclosure, LenInput, NumInput, Row, Seg, SubLabel } from './controls';
import { FabricPick, FinishPick, SheenPick, ZipperFields } from './TrimFields';
import { copiesOf, instanceName } from './sides';
import { imageFileOf, openPhoto } from './editHelpers';
import DrawSheet from './DrawSheet';
import Icon from './Icon';

export { ATTACHMENT_MIME };

interface Armed { key: string; label: string; make: () => AttachTemplate }

function Preview({ t, host }: { t: AttachTemplate; host: string }) {
  const f = t.fabric ? fabricById(t.fabric.id) : null;
  const fill = t.kind === 'label' ? t.label?.color ?? host : f ? (f.colors[t.fabric!.color] ?? f.colors[0]).hex : host;
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

const TRIM_KINDS = ['pocket', 'patch', 'strap', 'hardware', 'label'];

/** Trims workspace: hardware, tags, pockets, patches and straps. Design workspace (insert): prints, embroidery, appliques and photos. */
export default function DesignLibrary({ mode = 'insert' }: { mode?: 'insert' | 'trims' }) {
  const trims = mode === 'trims';
  const { project, selPiece, selInstance, selAttachment, showBothSides, addAttachment, set, units, designFace, openDesign } = usePick('project', 'selPiece', 'selInstance', 'selAttachment', 'showBothSides', 'addAttachment', 'set', 'units', 'designFace', 'openDesign');
  const [opts, setOpts] = useState<DesignOpts>({ ...DEFAULT_OPTS, fabric: { id: 'canvas', color: 2 } });
  const [cutKind, setCutKind] = useState<Kind4>('pocket');
  const [hwType, setHwType] = useState<HardwareType>('rivet');
  const [hw, setHw] = useState<Record<HardwareType, HwOpts>>(() => Object.fromEntries(HARDWARE.map((d) => [d.type, hwDefaults(d)])) as Record<HardwareType, HwOpts>);
  const [tag, setTag] = useState<TagOpts>(TAG_DEFAULTS);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<DrawDraft | null>(null);
  const [pullerSheet, setPullerSheet] = useState(false);
  const reg = useRef(new Map<string, Armed>());
  reg.current = new Map();

  const atts = project.edits?.attachments ?? [];
  const listed = atts.filter((a) => TRIM_KINDS.includes(a.kind) === trims);
  const collar = project.edits?.collar ?? 'down';
  const host = designHost(project.pieces, atts, selPiece, selAttachment);
  const piece = host?.piece;
  const copies = piece ? copiesOf(project.garment, piece) : 1;
  const inst = piece && !host?.attachment && copies === 2 && showBothSides ? selInstance ?? 0 : undefined;
  const targetLabel = host?.attachment ? host.attachment.name : piece ? (inst !== undefined ? instanceName(project.garment, piece, inst) : piece.name) : '';
  const hostHex = (() => { const p = piece ?? project.pieces[0]; const f = fabricById(p.fabric.id); return (f.colors[p.fabric.color] ?? f.colors[0]).hex; })();

  /** the face goes on the template, so a dragged tile carries it too */
  const withFace = (t: AttachTemplate): AttachTemplate => (t.face ? t : designFace === 'inside' ? { ...t, face: 'inside' } : t);

  const addTo = (t0: AttachTemplate, at?: { x: number; y: number }) => {
    if (!host) return;
    const t = withFace(t0);
    // a new design lands at the middle of its target, nudged so repeats do not hide each other
    let x = at?.x ?? 0, y = at?.y ?? 0;
    if (!at) {
      if (!host.attachment && piece) { const c = centroid(samplePoly(piece.points)); x = c.x; y = c.y; }
      const same = atts.filter((a) => a.pieceId === host.id && Math.hypot(a.x - x, a.y - y) < 1.2).length;
      x += same * 2; y += same * 2;
    }
    addAttachment({ ...t, pieceId: host.id, x, y, ...(inst !== undefined ? { instance: inst } : {}) });
    set({ selLayer: null, viewFace: t.face === 'inside' ? 'inside' : useStore.getState().viewFace });
    openDesign('edit');
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
        aria-label={`${label}. Drag onto the garment, or double click to add it.`}
        title={extra?.title ?? 'Drag onto the garment, or double click to add it'}
        onClick={() => setArmedKey(key)}
        onDoubleClick={() => addTo(make())}
        onDragStart={(e) => {
          const payload = withFace(make()); // fresh ids for every drag
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

  const setFace = (f: 'outside' | 'inside') => set({ designFace: f, viewFace: f });

  /** neck tag: inside the back neck, at the centre */
  const addNeckTag = () => {
    const back = project.pieces.find((p) => p.role === 'back') ?? project.pieces.find((p) => p.role === 'front') ?? project.pieces[0];
    const poly = samplePoly(back.points);
    const near = poly.filter((q) => Math.abs(q.x) < 3);
    const topY = near.length ? Math.min(...near.map((q) => q.y)) : Math.min(...poly.map((q) => q.y));
    const t = tagAttachment({ ...tag, w: Math.min(tag.w, 6), h: Math.min(tag.h, 3) });
    const same = atts.filter((a) => a.kind === 'label' && a.pieceId === back.id && a.face === 'inside').length;
    addAttachment({ ...t, name: 'Neck tag', face: 'inside', pieceId: back.id, x: 0, y: topY + t.h / 2 + 1.5 + same * 3 });
    set({ selPiece: back.id, selInstance: null, selLayer: null, viewFace: 'inside', designFace: 'inside' });
    openDesign('edit');
  };

  const tagTile = (id: TagOpts['type']) => {
    const def = LABEL_TYPES.find((t) => t.id === id)!;
    const o: TagOpts = { ...tag, type: id, color: id === tag.type ? tag.color : def.color, sheen: id === tag.type ? tag.sheen : def.sheen };
    const key = `tag-${id}`;
    reg.current.set(key, { key, label: `${def.name} tag`, make: () => tagAttachment(o) });
    const on = tag.type === id;
    return (
      <button key={key} className={`tile ${on ? 'on' : ''}`} draggable aria-pressed={on} title={def.blurb}
        aria-label={`${def.name} tag. ${def.blurb} Drag onto the garment, or double click to add it.`}
        onClick={() => { setTag({ ...tag, type: id, color: def.color, sheen: def.sheen }); setArmedKey(key); }}
        onDoubleClick={() => addTo(tagAttachment({ ...tag, type: id, color: def.color, sheen: def.sheen }))}
        onDragStart={(e) => { const p = withFace(tagAttachment({ ...tag, type: id, color: id === tag.type ? tag.color : def.color, sheen: id === tag.type ? tag.sheen : def.sheen })); e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(p)); e.dataTransfer.setData('text/plain', p.name); e.dataTransfer.effectAllowed = 'copy'; setTag({ ...tag, type: id, color: def.color, sheen: def.sheen }); setArmedKey(key); }}>
        <Preview t={tagAttachment({ ...tag, type: id, color: id === tag.type ? tag.color : def.color, sheen: id === tag.type ? tag.sheen : def.sheen, w: 5, h: 2.5 })} host={hostHex} />
        <span>{def.name}</span>
      </button>
    );
  };

  const startDraw = () => setDrawing(newDraft(hwType));

  return (
    <>
      {/* where it goes */}
      <div className={`target-card ${host ? '' : 'none'}`}>
        {host ? (
          <>
            <div className="target-head">
              <span className="att-ico"><Icon name={host.attachment ? KIND_ICON[host.attachment.kind] : 'pattern'} size={18} /></span>
              <div className="att-text"><span className="att-name">{targetLabel}</span><small>{host.attachment ? `${KIND_LABEL[host.attachment.kind]}. Designs go onto it.` : 'Designs go onto this piece.'}</small></div>
            </div>
            <span className="lbl">Which face</span>
            <Seg label="Which face the new design goes on" value={designFace} onChange={setFace}
              options={[{ id: 'outside', label: faceName(project.garment, piece, 'outside', collar) }, { id: 'inside', label: faceName(project.garment, piece, 'inside', collar) }]} />
          </>
        ) : (
          <div className="target-head"><span className="att-ico"><Icon name="target" size={18} /></span><div className="att-text"><span className="att-name">Select a piece first</span><small>Tap a piece on the pattern, then add a design to it.</small></div></div>
        )}
      </div>

      {!trims && <div className="photo-card">
        <span className="att-ico"><Icon name="print" size={18} /></span>
        <div className="att-text"><span className="att-name">From a photo</span><small>Print it, stitch it or cut it from fabric. You can also drag a picture onto the chart or the 3D view, or paste one.</small></div>
        <label className="btn small photo-pick">
          Choose a photo
          <input type="file" accept="image/*" aria-label="Choose a photo to insert" onChange={(e) => { const f = imageFileOf(e.target.files); if (f) openPhoto(f); e.target.value = ''; }} />
        </label>
      </div>}

      <Disclosure id={trims ? 'trims-cut' : 'design-cut'} title={trims ? 'Pockets, patches and straps' : 'Appliqué, cut and sewn'} icon={trims ? 'pocket' : 'scissors'} openFirst>
        {trims && <Seg label="Kind of cloth piece" value={cutKind === 'applique' ? 'pocket' : cutKind} onChange={(k) => { setCutKind(k); setArmedKey(null); }}
          options={[{ id: 'pocket', label: 'Pocket' }, { id: 'patch', label: 'Patch' }, { id: 'strap', label: 'Strap' }]} />}
        {trims && <p className="group-note">{KIND_BLURB[cutKind === 'applique' ? 'pocket' : cutKind]}</p>}
        {trims && cutKind === 'pocket' && tiles(POCKETS)}
        {trims && cutKind === 'patch' && tiles(PATCHES)}
        {trims && cutKind === 'strap' && tiles(STRAPS)}
        {!trims && (
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

      {!trims && <Disclosure id="design-embroidery" title="Embroidery" icon="embroidery">
        <p className="group-note">Thread stitched into the piece. One shape or word at a time.</p>
        <SubLabel>Shapes</SubLabel>
        <div className="tile-grid">{THREAD_SHAPES.map((s) => { const t = embroideryShape(s); return tile(t.key, t.label, () => t.make(opts)); })}</div>
        <SubLabel>Letters</SubLabel>
        {textRow('emb-text', 'Stitched in block capitals.')}
        <div className="tile-grid">{(() => { const t = embroideryText(); return tile(t.key, `"${clean(opts.text)}"`, () => t.make(opts)); })()}</div>
        <SubLabel>Thread colour</SubLabel>
        <ColorField label="Thread colour" value={opts.thread} onChange={(c) => setOpts({ ...opts, thread: c })} />
      </Disclosure>}

      {!trims && <Disclosure id="design-print" title="Print" icon="print">
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
      </Disclosure>}

      {trims && <Disclosure id="design-tags" title="Tags" icon="tag">
        <p className="group-note">A clothing tag with your design. Goes on the inside by default.</p>
        <button className="btn primary wide" onClick={addNeckTag}><Icon name="tag" size={16} /> Neck tag, inside the back neck</button>
        <SubLabel>Type</SubLabel>
        <div className="tile-grid">{LABEL_TYPES.map((t) => tagTile(t.id))}</div>
        <SubLabel>Sewn</SubLabel>
        <Seg label="How the tag is sewn" value={tag.sewn} onChange={(sewn) => setTag({ ...tag, sewn })} options={(['ends', 'all-round', 'folded-loop'] as const).map((id) => ({ id, label: SEWN_LABEL[id] }))} />
        <div className="frow stack"><span className="lbl">Tag colour</span><ColorField label="Tag colour" value={tag.color} onChange={(color) => setTag({ ...tag, color })} /></div>
        <SheenPick value={tag.sheen} onChange={(sheen) => setTag({ ...tag, sheen })} />
        <Row label="Width"><LenInput units={units} label="Tag width" value={tag.w} min={1.5} max={15} onChange={(w) => setTag({ ...tag, w })} /></Row>
        <Row label="Height"><LenInput units={units} label="Tag height" value={tag.h} min={1} max={10} onChange={(h) => setTag({ ...tag, h })} /></Row>
        <Row label="Tag text" htmlFor="tag-text-new"><input id="tag-text-new" className="txt" maxLength={24} value={tag.text} onChange={(e) => setTag({ ...tag, text: e.target.value })} /></Row>
        <button className="btn wide" disabled={!host} onClick={() => addTo(tagAttachment(tag))}><Icon name="plus" size={16} /> Add this tag{host ? ` to ${targetLabel}` : ''}</button>
      </Disclosure>}

      {trims && <Disclosure id="design-hardware" title="Hardware" icon="hardware" openFirst>
        <p className="group-note">Metal or plastic trims fixed through the fabric. Each one you place is its own, so you can design every button differently.</p>
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
                aria-label={`${d.label}. Drag onto the garment, or double click to add it.`} title="Drag onto the garment, or double click to add it"
                onClick={() => { setHwType(d.type); setArmedKey(key); }}
                onDoubleClick={() => addTo(make())}
                onDragStart={(e) => { const p = withFace(make()); e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(p)); e.dataTransfer.setData('text/plain', p.name); e.dataTransfer.effectAllowed = 'copy'; setHwType(d.type); setArmedKey(key); }}>
                <svg viewBox={`${-S / 2} ${-S / 2} ${S} ${S}`} aria-hidden="true" pointerEvents="none">
                  <ArtworkGroup a={shown} />
                </svg>
                <span>{d.label}</span>
              </button>
            );
          })}
        </div>
        <SubLabel>{hwDef.label} options</SubLabel>
        {(hwType === 'button' || hwType === 'snap' || hwType === 'stud') && (
          <button className="btn draw-btn" onClick={startDraw}><Icon name="draw" size={16} /> Draw your own {hwDef.label.toLowerCase()}</button>
        )}
        {hwType === 'zipper' ? (
          <ZipperFields zip={hwo.zipper} onZip={(z) => setHwo({ zipper: { ...hwo.zipper, ...z } })} finish={hwo.finish} onFinish={(finish) => setHwo({ finish })}
            open={hwo.open} onOpen={(open) => setHwo({ open })} onDrawPuller={() => setPullerSheet(true)}
            lengthField={(
              <>
                <Row label="Tape width"><LenInput units={units} label="Zipper tape width" value={hwo.size} min={1} max={5} onChange={(size) => setHwo({ size })} /></Row>
                <Row label="Length"><LenInput units={units} label="Zipper length" value={hwo.length} min={4} max={80} onChange={(length) => setHwo({ length })} /></Row>
              </>
            )} />
        ) : (
          <>
            <FinishPick value={hwo.finish} onChange={(finish) => setHwo({ finish })} />
            <SheenPick metal value={hwo.sheen} onChange={(sheen) => setHwo({ sheen })} />
            <Row label="Size"><LenInput units={units} label={`${hwDef.label} size`} value={hwo.size} min={hwDef.sizeRange[0]} max={hwDef.sizeRange[1]} onChange={(size) => setHwo({ size })} /></Row>
            <Row label="How many"><NumInput label="Count" value={hwo.count} min={1} max={12} step={1} digits={0} onChange={(count) => setHwo({ count: Math.round(count) })} /></Row>
            <Row label="Spacing"><LenInput units={units} label="Spacing, centre to centre" value={hwo.spacing} min={0.5} max={20} onChange={(spacing) => setHwo({ spacing })} /></Row>
          </>
        )}
        <button className="btn wide" disabled={!host} onClick={() => addTo(hardwareAttachment(hwType, hwo))}><Icon name="plus" size={16} /> Add {hwDef.label.toLowerCase()}{host ? ` to ${targetLabel}` : ''}</button>
      </Disclosure>}

      <Disclosure id={trims ? 'trims-list' : 'design-list'} title={trims ? 'Trims on this garment' : 'Designs on this garment'} icon="layers" count={listed.length}>
        {listed.length === 0 && <div className="group-note">Nothing added yet. Drag a tile onto the garment, or pick a piece and double click a tile.</div>}
        <ul className="att-list">
          {listed.map((a) => {
            const parent = atts.find((q) => q.id === a.pieceId);
            const hostPiece = project.pieces.find((p) => p.id === rootPiece(atts, a));
            const c = hostPiece ? copiesOf(project.garment, hostPiece) : 1;
            const where = parent ? parent.name : !hostPiece ? 'No piece' : c === 2 ? (a.instance === undefined ? `${hostPiece.name}, both sides` : instanceName(project.garment, hostPiece, a.instance)) : hostPiece.name;
            return (
              <li key={a.id} className={a.id === selAttachment ? 'on' : ''}>
                <button className="att-row" aria-pressed={a.id === selAttachment} onClick={() => { set({ selAttachment: a.id, selLayer: null, selPiece: hostPiece?.id ?? null, selInstance: a.instance ?? null }); openDesign('edit'); }}>
                  <span className="att-ico"><Icon name={KIND_ICON[a.kind]} size={18} /></span>
                  <span className="att-text"><span className="att-name">{a.name}</span><small>{KIND_LABEL[a.kind]} on {where}{a.face === 'inside' ? ', inside' : ''}</small></span>
                </button>
                <button className="icon-btn sm danger" aria-label={`Delete ${a.name}`} title="Delete" onClick={() => useStore.getState().removeAttachment(a.id)}><Icon name="trash" size={16} /></button>
              </li>
            );
          })}
        </ul>
      </Disclosure>

      {drawing && (
        <DrawSheet initial={drawing} doneLabel={host ? `Place on ${targetLabel}` : 'Done'} onCancel={() => setDrawing(null)}
          onDone={(d) => { if (d.type !== 'puller' && d.type !== 'zipper') addTo(drawnHardware({ ...d, type: d.type })); setDrawing(null); }} />
      )}
      {pullerSheet && (
        <DrawSheet initial={{ ...newDraft('puller'), unit: hwo.zipper.pullerOutline ? normaliseOutline(hwo.zipper.pullerOutline) : [], size: hwo.zipper.pullerOutline ? Math.max(...hwo.zipper.pullerOutline.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y)))) * 2 : 2, layers: hwo.zipper.pullerLayers ?? [], finish: hwo.zipper.pullerFinish ?? hwo.finish }} doneLabel="Use this puller" onCancel={() => setPullerSheet(false)}
          onDone={(d) => { setHwo({ zipper: { ...hwo.zipper, puller: 'custom', pullerOutline: d.unit.map((p) => ({ x: p.x * d.size, y: p.y * d.size })), pullerLayers: d.layers, pullerFinish: d.finish } }); setPullerSheet(false); }} />
      )}
    </>
  );
}
