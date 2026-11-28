// Design library: every tile is one simple thing (a shape, a word, a trim, a tag) that is cut and sewn on, stitched in
// thread, printed, or fixed on as hardware. Tiles drag onto the 2D chart or the 3D model, or are added to the selection.
import { notify } from './notify';
import { useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import type { Attachment, HardwareType } from '../data/edits';
import { fabricById } from '../data/fabrics';
import { SHAPES } from '../lib/shapes';
import { centroid, samplePoly } from '../lib/geometry';
import { ArtworkGroup, outlineD } from './Artwork';
import {
  ATTACHMENT_MIME, DEFAULT_OPTS, drawnHardware, hardwareAttachment, HARDWARE, hwDefaults, newDraft, PATCHES, POCKETS,
  SINGLE_SHAPES, STRAPS, TAG_DEFAULTS, tagAttachment, THREAD_SHAPES, clean, type DesignOpts, type DrawDraft, type HwOpts, type Kind4, type TagOpts, type Tile,
} from './designLibrary';
import { makeArtwork, methodAllows, type Art, type Method } from './artworkMethod';
import { InsertSection, MethodPicker } from './Insert';
import { designHost, faceName, normaliseOutline, KIND_BLURB, LABEL_TYPES, SEWN_LABEL, type AttachTemplate, KIND_ICON, KIND_LABEL, rootPiece } from './editHelpers';
import { ColorField, Disclosure, LenInput, NumInput, Row, Seg, SubLabel } from './controls';
import { FabricPick, FinishPick, SheenPick, ZipperFields } from './TrimFields';
import { copiesOf, instanceName } from './sides';
import { imageFileOf, openPhoto } from './editHelpers';
import DrawSheet from './DrawSheet';
import Icon from './Icon';
import { FabricSwatch } from './FabricBrowser';

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
  const { project, selPiece, selInstance, selAttachment, showBothSides, addAttachment, addButtonholes, set, units, designFace, openDesign } = usePick('project', 'selPiece', 'selInstance', 'selAttachment', 'showBothSides', 'addAttachment', 'addButtonholes', 'set', 'units', 'designFace', 'openDesign');
  const [opts, setOpts] = useState<DesignOpts>({ ...DEFAULT_OPTS, fabric: { id: 'canvas', color: 2 } });
  const [cutKind, setCutKind] = useState<Kind4>('pocket');
  const [hwType, setHwType] = useState<HardwareType>('rivet');
  const [hw, setHw] = useState<Record<HardwareType, HwOpts>>(() => Object.fromEntries(HARDWARE.map((d) => [d.type, hwDefaults(d)])) as Record<HardwareType, HwOpts>);
  const [tag, setTag] = useState<TagOpts>(TAG_DEFAULTS);
  const [armedKey, setArmedKey] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('print');
  const [notice, setNotice] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<DrawDraft | null>(null);
  const [pullerSheet, setPullerSheet] = useState(false);
  const [bh, setBh] = useState({ style: 'straight' as 'straight' | 'keyhole', dir: 'across' as 'across' | 'along', size: 1.5, count: 1, spacing: 6, button: true });
  const [btn, setBtn] = useState({ count: 1, spacing: 6, size: 1.1 });
  const [restored, setRestored] = useState<string | null>(null);
  const removedMatch = useStore((st) => st.removedMatch);
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

  const addTo = (t0: AttachTemplate, at?: { x: number; y: number }): boolean => {
    if (!host) { notify({ id: 'pick-piece', title: 'Pick a piece first', body: 'Tap a piece on the pattern, then add this to it. You can also drag it straight onto a piece.' }); return false; }
    setNotice(null);
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
    return true;
  };

  /** one button, or a row of them, on the centre line of the selected piece (a placket or centre front) */
  const buttonTemplate = (): AttachTemplate => {
    const t = hardwareAttachment('button', { ...hw.button, size: btn.size, count: btn.count, spacing: btn.spacing });
    return btn.count > 1 ? { ...t, rotation: 90, name: `Buttons, ${btn.count}` } : t;
  };
  const addButtons = () => {
    if (!piece || host?.attachment) { notify({ id: 'pick-piece-buttons', title: 'Pick a piece first', body: 'Tap a piece on the pattern, then add buttons to it.' }); return; }
    const c = centroid(samplePoly(piece.points));
    // on the centre line of a piece cut twice (centre front) or a symmetric one; else at the middle of the piece
    const onCentre = copies === 2 || piece.symmetric;
    const t = buttonTemplate();
    const n = btn.count;
    // the row is centred on the middle of the piece, so it runs down the centre line
    addAttachment({ ...withFace(t), pieceId: piece.id, x: onCentre ? 0 : c.x, y: c.y, w: n > 1 ? (n - 1) * btn.spacing + btn.size : btn.size, h: btn.size, ...(inst !== undefined ? { instance: inst } : {}) });
    set({ selLayer: null });
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
        className={`tile ${on ? 'pulse' : ''}`}
        draggable
        aria-label={`Insert ${label}. Click to add it to the selected piece, or drag it onto the garment.`}
        title={extra?.title ?? 'Click to add it to the middle of the piece, or drag it onto the garment'}
        onClick={() => { if (addTo(make())) flash(key); }}
        onDragStart={(e) => {
          const payload = withFace(make()); // fresh ids for every drag
          e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(payload));
          e.dataTransfer.setData('text/plain', payload.name);
          e.dataTransfer.effectAllowed = 'copy';
        }}
      >
        <Preview t={t} host={hostHex} />
        <span>{label}</span>
      </button>
    );
  };
  /** a brief pulse on the tile that just inserted */
  const flash = (key: string) => { setArmedKey(key); window.setTimeout(() => setArmedKey((k) => (k === key ? null : k)), 700); };
  const tiles = (list: Tile[]) => <div className="tile-grid">{list.map((t) => tile(t.key, t.label, () => t.make(opts)))}</div>;

  /** one artwork tile: the same artwork whatever the method, drawn the way the chosen method makes it */
  const art = (a: Art, label: string) => tile(`${method}-${a.type === 'shape' ? a.shape : a.type}${a.type === 'text' ? clean(opts.text) : ''}`, label, () => makeArtwork(a, method, opts));
  const clothHex = (() => { const f = opts.fabric ? fabricById(opts.fabric.id) : null; return f ? (f.colors[opts.fabric!.color] ?? f.colors[0]).hex : hostHex; })();

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
      <button key={key} className={`tile ${armedKey === key ? 'pulse' : on ? 'on' : ''}`} draggable aria-pressed={on} title={`${def.blurb} Click to add it, or drag it onto the garment.`}
        aria-label={`Insert ${def.name} tag. ${def.blurb} Click to add it to the selected piece, or drag it onto the garment.`}
        onClick={() => { const o2 = { ...tag, type: id, color: def.color, sheen: def.sheen }; setTag(o2); if (addTo(tagAttachment(o2))) flash(key); }}
        onDragStart={(e) => { const p = withFace(tagAttachment({ ...tag, type: id, color: id === tag.type ? tag.color : def.color, sheen: id === tag.type ? tag.sheen : def.sheen })); e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(p)); e.dataTransfer.setData('text/plain', p.name); e.dataTransfer.effectAllowed = 'copy'; setTag({ ...tag, type: id, color: def.color, sheen: def.sheen }); }}>
        <Preview t={tagAttachment({ ...tag, type: id, color: id === tag.type ? tag.color : def.color, sheen: id === tag.type ? tag.sheen : def.sheen, w: 5, h: 2.5 })} host={hostHex} />
        <span>{def.name}</span>
      </button>
    );
  };

  const startDraw = () => setDrawing(newDraft(hwType));

  return (
    <>
      {removedMatch && (
      <div className="insert-notice" role="status">
        <span>Removed {removedMatch.removed}. Remove {removedMatch.name} too?</span>{' '}
        <button className="btn small" onClick={() => useStore.getState().removeMatch()}>Remove it</button>{' '}
        <button className="btn small" onClick={() => useStore.setState({ removedMatch: null })}>Keep it</button>
      </div>
      )}
      <InsertSection notice={notice}>
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

      {!trims && (
        <>
          <span className="lbl">How to make it</span>
          <MethodPicker value={method} onChange={(m) => { setMethod(m); setArmedKey(null); }} ink={opts.ink} thread={opts.thread} cloth={clothHex} />
          {method === 'print' && <div className="frow stack"><span className="lbl">Ink colour</span><ColorField label="Ink colour" value={opts.ink} onChange={(c) => setOpts({ ...opts, ink: c })} /></div>}
          {method === 'embroidery' && <div className="frow stack"><span className="lbl">Thread colour</span><ColorField label="Thread colour" value={opts.thread} onChange={(c) => setOpts({ ...opts, thread: c })} /></div>}
          {method === 'applique' && (
            <>
              <SubLabel>Fabric and stitching</SubLabel>
              <FabricPick value={opts.fabric} onChange={(fabric) => setOpts({ ...opts, fabric })} />
              <div className="frow stack"><span className="lbl">Stitch thread</span><ColorField label="Stitch thread" value={opts.thread} onChange={(c) => setOpts({ ...opts, thread: c })} /></div>
            </>
          )}
          <SubLabel>Shapes</SubLabel>
          <div className="tile-grid">{THREAD_SHAPES.filter((sh) => methodAllows({ type: 'shape', shape: sh }, method)).map((sh) => art({ type: 'shape', shape: sh }, SHAPES[sh].name))}</div>
          <SubLabel>Letters and stripes</SubLabel>
          <div className="frow stack">
            <label htmlFor="art-text">Letters or a word</label>
            <input id="art-text" className="txt" value={opts.text} maxLength={12} placeholder="ABC" onChange={(e) => setOpts({ ...opts, text: e.target.value })} onBlur={() => setOpts({ ...opts, text: clean(opts.text) })} />
          </div>
          <div className="tile-grid">{art({ type: 'text' }, `"${clean(opts.text)}"`)}{art({ type: 'stripe' }, 'Stripe')}</div>
          <div className="photo-card">
            <span className="att-ico"><Icon name="print" size={18} /></span>
            <div className="att-text"><span className="att-name">Picture</span><small>Choose a photo, then print it, stitch it or cut it from fabric. You can also drop one on the chart or the 3D view, or paste it.</small></div>
            <label className="btn small photo-pick">
              Choose a photo
              <input type="file" accept="image/*" aria-label="Choose a photo to insert" onChange={(e) => { const f = imageFileOf(e.target.files); if (f) openPhoto(f); e.target.value = ''; }} />
            </label>
          </div>
        </>
      )}
      {trims && <Disclosure id="design-buttons" title="Buttons" icon="hardware" openFirst>
        <p className="group-note">Sewn on through the fabric. One button goes to the middle of the selected piece. A row goes down the centre line, like a placket or centre front. Buttonholes are just below.</p>
        <div className="tile-grid">
          <button className="tile on" aria-label={`Add ${btn.count > 1 ? `a row of ${btn.count} buttons` : 'a button'}${piece ? ` to ${targetLabel}` : ''}`} onClick={addButtons}>
            <svg viewBox="-1.6 -1.6 3.2 3.2" aria-hidden="true" pointerEvents="none"><ArtworkGroup a={buttonTemplate()} /></svg>
            <span>Buttons</span>
          </button>
        </div>
        <Row label="How many"><NumInput label="Button count" value={btn.count} min={1} max={12} step={1} digits={0} onChange={(count) => setBtn({ ...btn, count: Math.round(count) })} /></Row>
        {btn.count > 1 && <Row label="Spacing"><LenInput units={units} label="Button spacing, centre to centre" value={btn.spacing} min={1} max={20} onChange={(spacing) => setBtn({ ...btn, spacing })} /></Row>}
        <Row label="Size"><LenInput units={units} label="Button size" value={btn.size} min={0.6} max={4} onChange={(size) => setBtn({ ...btn, size })} /></Row>
        <button className="btn wide" disabled={!piece || !!host?.attachment} onClick={addButtons}><Icon name="plus" size={16} /> Add {btn.count > 1 ? `${btn.count} buttons` : 'a button'}{piece && !host?.attachment ? ` to ${targetLabel}` : ''}</button>
      </Disclosure>}

      {trims && (
        <Disclosure id="trims-cut" title="Pockets, patches and straps" icon="pocket">
          <Seg label="Kind of cloth piece" value={cutKind === 'applique' ? 'pocket' : cutKind} onChange={(k) => { setCutKind(k); setArmedKey(null); }}
            options={[{ id: 'pocket', label: 'Pocket' }, { id: 'patch', label: 'Patch' }, { id: 'strap', label: 'Strap' }]} />
          <p className="group-note">{KIND_BLURB[cutKind === 'applique' ? 'pocket' : cutKind]}</p>
          {cutKind === 'pocket' && tiles(POCKETS)}
          {cutKind === 'patch' && tiles(PATCHES)}
          {cutKind === 'strap' && tiles(STRAPS)}
          <SubLabel>Fabric and stitching</SubLabel>
          <FabricPick value={opts.fabric} onChange={(fabric) => setOpts({ ...opts, fabric })} />
          <div className="frow stack"><span className="lbl">Stitch thread</span><ColorField label="Stitch thread" value={opts.thread} onChange={(c) => setOpts({ ...opts, thread: c })} /></div>
        </Disclosure>
      )}
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
              <button key={key} className={`tile ${on ? 'pulse' : hwType === d.type ? 'on' : ''}`} draggable aria-pressed={hwType === d.type}
                aria-label={`Insert ${d.label}. Click to add it to the selected piece, or drag it onto the garment.`} title="Click to add it, or drag it onto the garment. Change its options below or after it is placed."
                onClick={() => { setHwType(d.type); if (addTo(make())) flash(key); }}
                onDragStart={(e) => { const p = withFace(make()); e.dataTransfer.setData(ATTACHMENT_MIME, JSON.stringify(p)); e.dataTransfer.setData('text/plain', p.name); e.dataTransfer.effectAllowed = 'copy'; setHwType(d.type); }}>
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

      {trims && <Disclosure id="design-buttonholes" title="Buttonholes" icon="hardware">
        <p className="group-note">Cut and stitched into the piece, sized to the button they take. On a piece cut twice the matching buttons go on the other side, where it laps over.</p>
        <Seg label="Buttonhole shape" value={bh.style} options={[{ id: 'straight', label: 'Straight' }, { id: 'keyhole', label: 'Keyhole' }]} onChange={(style) => setBh({ ...bh, style })} />
        <Seg label="Buttonhole direction" value={bh.dir} options={[{ id: 'across', label: 'Across the row' }, { id: 'along', label: 'Along the row' }]} onChange={(dir) => setBh({ ...bh, dir })} />
        <Row label="Button size"><LenInput units={units} label="Button size the hole takes" value={bh.size} min={0.8} max={4} onChange={(size) => setBh({ ...bh, size })} /></Row>
        <Row label="How many"><NumInput label="Buttonhole count" value={bh.count} min={1} max={12} step={1} digits={0} onChange={(count) => setBh({ ...bh, count: Math.round(count) })} /></Row>
        <Row label="Spacing"><LenInput units={units} label="Buttonhole spacing, centre to centre" value={bh.spacing} min={1} max={20} onChange={(spacing) => setBh({ ...bh, spacing })} /></Row>
        {copies === 2 && !host?.attachment && <label className="frow"><input type="checkbox" checked={bh.button} onChange={(e) => setBh({ ...bh, button: e.target.checked })} /> <span>Matching buttons on the other side</span></label>}
        <button className="btn wide" disabled={!piece || !!host?.attachment} onClick={() => {
          if (!piece) return;
          const c = centroid(samplePoly(piece.points));
          // a piece cut twice: on its centre line (the centre front of a front), so the button meets it on the other side
          addButtonholes({ pieceId: piece.id, x: copies === 2 ? 0 : c.x, y: c.y, rotation: 90, size: bh.size, count: bh.count, spacing: bh.spacing, style: bh.style, dir: bh.dir,
            ...(copies === 2 ? { instance: inst ?? 0, button: bh.button } : {}) });
        }}><Icon name="plus" size={16} /> Add {bh.count > 1 ? 'buttonholes' : 'a buttonhole'}{piece && !host?.attachment ? ` to ${targetLabel}` : ''}</button>
      </Disclosure>}

      </InsertSection>

      <Disclosure id={trims ? 'trims-list' : 'design-list'} title={trims ? 'Trims on this garment' : 'Designs on this garment'} icon="layers" count={listed.length}>
        
        {listed.length === 0 && <div className="group-note">{trims ? 'No trims on this garment. To add buttons, open Buttons above, pick a piece and press Add. Buttonholes and other hardware are in the sections below it.' : 'Nothing added yet. Click a tile to add it to the selected piece, or drag it onto the garment.'}</div>}
        {trims && (project.edits?.removedBuiltins?.length ?? 0) > 0 && (
          <div className="frow">
            <button className="btn small" onClick={() => { const n = useStore.getState().restoreStyleTrims(); setRestored(n ? `Brought back ${n} style ${n === 1 ? 'trim' : 'trims'}.` : 'Nothing to bring back.'); window.setTimeout(() => setRestored(null), 3500); }}>Restore style trims</button>
            <small>{project.edits!.removedBuiltins!.length} removed from the style</small>
          </div>
        )}
        {restored && <div className="group-note" role="status">{restored}</div>}
        <ul className="att-list">
          {listed.map((a) => {
            const parent = atts.find((q) => q.id === a.pieceId);
            const hostPiece = project.pieces.find((p) => p.id === rootPiece(atts, a));
            const c = hostPiece ? copiesOf(project.garment, hostPiece) : 1;
            const where = parent ? parent.name : !hostPiece ? 'No piece' : c === 2 ? (a.instance === undefined ? `${hostPiece.name}, both sides` : instanceName(project.garment, hostPiece, a.instance)) : hostPiece.name;
            return (
              <li key={a.id} className={a.id === selAttachment ? 'on' : ''}>
                <button className="att-row" aria-pressed={a.id === selAttachment} onClick={() => { set({ selAttachment: a.id, selLayer: null, selPiece: hostPiece?.id ?? null, selInstance: a.instance ?? null }); openDesign('edit'); }}>
                  <span className="att-ico">{a.fabric && ['pocket', 'patch', 'strap', 'applique'].includes(a.kind) ? <FabricSwatch fabric={a.fabric} size={28} /> : <Icon name={KIND_ICON[a.kind]} size={18} />}</span>
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
