// Right side of the Design workspace: the design's settings, the layer stack (painting style), the selected layer's
// properties (fill, outline, relief, stitch) and Place on garment. Bands live in the Paint workspace.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import { SHAPES } from '../lib/shapes';
import { ColorField, LenInput, Row, Seg, SubLabel } from './controls';
import { FONT_STACKS } from '../three/detailsArt';
import { RELIEF_PRESETS, attachmentPatch, docFromAttachment, droppedLayers, type Blend, type DLayer, type FontId, type MakeAs, type Stitch } from './designDoc';
import { pieceBottom, pieceTop } from './designDoc';
import { ALL_ITEMS } from './designShapes';
import { uid } from '../lib/units';
import { AddPicture } from './DesignLibrary';
import { baseLayer } from './designDoc';
import Icon from './Icon';
import type { Outline } from '../data/edits';

const MAKE: { id: MakeAs; label: string }[] = [{ id: 'patch', label: 'Patch' }, { id: 'applique', label: 'Appliqué' }, { id: 'embroidery', label: 'Stitched' }, { id: 'print', label: 'Print' }];
const OUTLINES: { id: Outline; label: string }[] = [{ id: 'rect', label: 'Square' }, { id: 'rounded', label: 'Rounded' }, { id: 'circle', label: 'Circle' }, { id: 'shield', label: 'Shield' }, { id: 'pointed', label: 'Pointed' }];
const SWATCH = ['#16315f', '#7a1f2b', '#1f5d3a', '#111111', '#f2f2f2', '#d9b45a'];
const FONT_NAMES: Record<string, string> = { classic: 'Serif', varsity: 'Varsity', script: 'Script', block: 'Block', mono: 'Mono' };

const nameOf = (l: DLayer) => l.name ?? (l.shape === 'text' ? `Text "${l.text ?? ''}"` : l.shape === 'path' ? 'Custom shape' : SHAPES[l.shape].name);

/** keeps the placed attachment in step with the design, and drops the link when the attachment is deleted */
export function useDesignSync() {
  const design = useStore((s) => s.design);
  const exists = useStore((s) => !!design.placedId && !!s.project.edits?.attachments.some((a) => a.id === design.placedId));
  const sig = useMemo(() => JSON.stringify(attachmentPatch(design)), [design]);
  const last = useRef('');
  useEffect(() => {
    const st = useStore.getState();
    if (!design.placedId) { last.current = ''; return; }
    if (!exists) { st.setDesign({ placedId: null }); return; }
    if (last.current === '') { last.current = sig; return; } // just placed or opened: already in step
    if (last.current === sig) return;
    last.current = sig;
    st.updateAttachment(design.placedId, attachmentPatch(design));
  }, [sig, exists, design]);
}

function placeDefault(pieceId: string) {
  const pc = useStore.getState().project.pieces.find((p) => p.id === pieceId);
  if (!pc) return { x: 0, y: 0 };
  const xs = pc.points.map((p) => p.x), ys = pc.points.map((p) => p.y);
  const top = pieceTop(pc), bot = pieceBottom(pc);
  if (pc.role === 'front' || pc.role === 'back') return { x: Math.round(Math.max(...xs) * 0.52 * 10) / 10, y: Math.round((top + Math.min(24, (bot - top) * 0.3)) * 10) / 10 };
  return { x: Math.round(((Math.min(...xs) + Math.max(...xs)) / 2) * 10) / 10, y: Math.round(((Math.min(...ys) + Math.max(...ys)) / 2) * 10) / 10 };
}

function PlaceCard() {
  const { project, design, setDesign } = usePick('project', 'design', 'setDesign');
  const atts = project.edits?.attachments ?? [];
  const pieceId = design.pieceId && project.pieces.some((p) => p.id === design.pieceId) ? design.pieceId : (project.pieces.find((p) => p.role === 'front') ?? project.pieces[0])?.id;
  const piece = project.pieces.find((p) => p.id === pieceId);
  const dropped = droppedLayers(design);
  const placed = design.placedId ? atts.find((a) => a.id === design.placedId) : null;
  const place = () => {
    if (!piece) return;
    const st = useStore.getState();
    const pos = placeDefault(piece.id);
    const id = st.addAttachment({ ...attachmentPatch(st.design), pieceId: piece.id, x: pos.x, y: pos.y, rotation: 0, ...(piece.cut > 1 ? { instance: st.design.instance } : {}) });
    useStore.setState({ selAttachment: null });
    st.setDesign({ placedId: id, pieceId: piece.id });
  };
  const move = (patch: { pieceId?: string; instance?: number }) => {
    setDesign(patch as never);
    if (!placed) return;
    const np = patch.pieceId ? project.pieces.find((p) => p.id === patch.pieceId) : piece;
    if (!np) return;
    const pos = patch.pieceId ? placeDefault(np.id) : { x: placed.x, y: placed.y };
    useStore.getState().updateAttachment(placed.id, { pieceId: np.id, ...pos, instance: np.cut > 1 ? patch.instance ?? design.instance : undefined });
  };
  const open = atts.filter((a) => ['patch', 'applique', 'embroidery', 'print'].includes(a.kind) && a.layers.length > 0);
  return (
    <div className="dz-place">
      <SubLabel>Place on garment</SubLabel>
      {dropped > 0 && <div className="group-note" role="status">{dropped === 1 ? '1 layer is' : `${dropped} layers are`} wholly outside the outline and will not be made.</div>}
      <Row label="On piece" htmlFor="dz-piece">
        <select id="dz-piece" className="sel" value={pieceId} onChange={(e) => move({ pieceId: e.target.value })}>
          {project.pieces.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </Row>
      {piece && piece.cut > 1 && (
        <Row label="Side"><Seg label="Side" full={false} value={String(design.instance)} options={[{ id: '0', label: 'Left' }, { id: '1', label: 'Right' }]} onChange={(v) => move({ instance: Number(v) })} /></Row>
      )}
      {placed ? (
        <div className="dz-placed" role="status">
          <Icon name="check" size={16} />
          <span>On the garment. Edits here update it live. Move it in Construct or by dragging in 3D.</span>
          <button className="btn small ghost" onClick={() => setDesign({ placedId: null })}>Detach</button>
        </div>
      ) : (
        <button className="btn primary block" disabled={!piece || design.layers.length === 0} onClick={place}><Icon name="garment" size={16} /> Place on garment</button>
      )}
      {open.length > 0 && (
        <Row label="Open a placed design" htmlFor="dz-open">
          <select id="dz-open" className="sel" value="" onChange={(e) => { const a = atts.find((q) => q.id === e.target.value); if (a) { useStore.setState({ design: docFromAttachment(a), designSel: [] }); } }}>
            <option value="">Choose…</option>
            {open.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Row>
      )}
    </div>
  );
}

function Properties({ sel }: { sel: DLayer[] }) {
  const { units, project, design, setDesign } = usePick('units', 'project', 'design', 'setDesign');
  const ids = sel.map((l) => l.id);
  const patch = (p: Partial<DLayer>) => setDesign((d) => ({ layers: d.layers.map((l) => (ids.includes(l.id) ? { ...l, ...p } : l)) }));
  void project;
  const l = sel[0];
  const single = sel.length === 1;
  const relief = l.relief ?? 0;
  const embro = design.makeAs === 'embroidery';
  return (
    <div className="dz-props">
      <SubLabel>{single ? nameOf(l) : `${sel.length} layers`}</SubLabel>
      <div className="frow stack"><span className="lbl">Fill</span><ColorField label="Fill colour" value={l.color} onChange={(c) => patch({ color: c })} /></div>
      <div className="frow stack">
        <label htmlFor="dz-op">Opacity <b className="val">{Math.round((l.opacity ?? 1) * 100)}%</b></label>
        <input id="dz-op" type="range" min={5} max={100} value={Math.round((l.opacity ?? 1) * 100)} onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })} />
      </div>
      <Row label="Look against layers below"><Seg<Blend> label="Blend look" full={false} value={l.blend ?? 'normal'} options={[{ id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' }]} onChange={(v) => patch({ blend: v })} /></Row>

      <SubLabel>Outline</SubLabel>
      <div className="frow stack"><span className="lbl">Outline colour</span><ColorField label="Outline colour" value={l.stroke ?? '#111111'} onChange={(c) => patch({ stroke: c, strokeW: l.strokeW || 0.2 })} /></div>
      <Row label="Outline width"><LenInput units={units} label="Outline width" value={l.strokeW ?? 0} min={0} max={2} onChange={(v) => patch({ strokeW: v })} /></Row>

      <SubLabel>Relief, raises or presses the surface</SubLabel>
      <div className="dz-chips" role="group" aria-label="Relief presets">
        {RELIEF_PRESETS.map((p) => (
          <button key={p.id} className={`dz-chip ${Math.abs(relief - p.mm) < 0.01 ? 'on' : ''}`} aria-pressed={Math.abs(relief - p.mm) < 0.01} onClick={() => patch({ relief: p.mm })}>{p.name}</button>
        ))}
      </div>
      <div className="frow stack">
        <label htmlFor="dz-relief">Relief <b className="val">{relief > 0 ? '+' : ''}{relief.toFixed(1)} mm</b></label>
        <input id="dz-relief" type="range" min={-1} max={3} step={0.1} value={relief} onChange={(e) => patch({ relief: Number(e.target.value) })} />
        <div className="dz-scale"><span>Pressed in</span><span>Flat</span><span>Raised</span></div>
      </div>
      <div className="group-note">Layers on top of each other add up where they overlap, so stack two to make felt layers.</div>

      {embro && (
        <>
          <SubLabel>Stitch</SubLabel>
          <Seg<Stitch> label="Stitch style" value={l.stitch ?? 'satin'} options={[{ id: 'satin', label: 'Satin' }, { id: 'fill', label: 'Fill' }, { id: 'running', label: 'Open' }]} onChange={(v) => patch({ stitch: v })} />
        </>
      )}

      {single && l.shape === 'text' && (
        <>
          <SubLabel>Text</SubLabel>
          <Row label="Text" htmlFor="dz-text"><input id="dz-text" className="txt" value={l.text ?? ''} maxLength={24} onChange={(e) => patch({ text: e.target.value })} /></Row>
          <Row label="Font" htmlFor="dz-font">
            <select id="dz-font" className="sel" value={l.font ?? ''} onChange={(e) => patch({ font: (e.target.value || undefined) as FontId | undefined })}>
              <option value="">System bold</option>
              {Object.keys(FONT_STACKS).map((f) => <option key={f} value={f}>{FONT_NAMES[f]}</option>)}
            </select>
          </Row>
        </>
      )}

      {single && (
        <>
          <SubLabel>Position and size</SubLabel>
          <Row label="X, Y"><LenInput units={units} label="Position X" value={l.x} onChange={(v) => patch({ x: v })} /><LenInput units={units} label="Position Y" value={l.y} onChange={(v) => patch({ y: v })} /></Row>
          <Row label="Width, height"><LenInput units={units} label="Width" value={l.w} min={0.1} onChange={(v) => patch({ w: v })} /><LenInput units={units} label="Height" value={l.h} min={0.1} onChange={(v) => patch({ h: v })} /></Row>
          <div className="frow stack">
            <label htmlFor="dz-rot">Rotation <b className="val">{Math.round(l.rotation)}°</b></label>
            <input id="dz-rot" type="range" min={-180} max={180} value={l.rotation} onChange={(e) => patch({ rotation: Number(e.target.value) })} />
          </div>
          <Row label="Name" htmlFor="dz-name"><input id="dz-name" className="txt" value={l.name ?? ''} placeholder={nameOf({ ...l, name: undefined })} onChange={(e) => patch({ name: e.target.value || undefined })} /></Row>
        </>
      )}
    </div>
  );
}

function Layers() {
  const { design, designSel, setDesign, set } = usePick('design', 'designSel', 'setDesign', 'set');
  const { layers, groups } = design;
  const [over, setOver] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);
  const sel = layers.filter((l) => designSel.includes(l.id));
  const setSel = (ids: string[]) => set({ designSel: ids });
  const gOf = (id?: string) => groups.find((g) => g.id === id);
  const isHidden = (l: DLayer) => l.hidden || !!gOf(l.group)?.hidden;
  const isLocked = (l: DLayer) => l.locked || !!gOf(l.group)?.locked;

  const patchOne = (id: string, p: Partial<DLayer>) => setDesign((d) => ({ layers: d.layers.map((l) => (l.id === id ? { ...l, ...p } : l)) }));
  const move = (dir: -1 | 1) => setDesign((d) => {
    const next = [...d.layers];
    const idx = next.map((l, i) => (designSel.includes(l.id) ? i : -1)).filter((i) => i >= 0);
    if (dir > 0) for (const i of idx.reverse()) { if (i + 1 < next.length && !designSel.includes(next[i + 1].id)) [next[i], next[i + 1]] = [next[i + 1], next[i]]; }
    else for (const i of idx) { if (i > 0 && !designSel.includes(next[i - 1].id)) [next[i], next[i - 1]] = [next[i - 1], next[i]]; }
    return { layers: next };
  });
  const dup = () => {
    const copies = sel.map((l) => ({ ...l, id: uid(), x: l.x + 0.5, y: l.y + 0.5, name: l.name ? `${l.name} copy` : undefined }));
    setDesign((d) => ({ layers: [...d.layers, ...copies] }));
    setSel(copies.map((c) => c.id));
  };
  const del = () => { setDesign((d) => ({ layers: d.layers.filter((l) => !designSel.includes(l.id)) })); setSel([]); };
  const group = () => {
    if (sel.length < 2) return;
    const gid = uid();
    const top = Math.max(...sel.map((l) => layers.indexOf(l)));
    setDesign((d) => {
      const mine = d.layers.filter((l) => designSel.includes(l.id)).map((l) => ({ ...l, group: gid }));
      const rest = d.layers.filter((l) => !designSel.includes(l.id));
      const at = Math.min(rest.length, top - mine.length + 1);
      return { layers: [...rest.slice(0, at), ...mine, ...rest.slice(at)], groups: [...d.groups, { id: gid, name: `Group ${d.groups.length + 1}` }] };
    });
  };
  const ungroup = () => setDesign((d) => {
    const gids = new Set(d.layers.filter((l) => designSel.includes(l.id)).map((l) => l.group).filter(Boolean));
    return { layers: d.layers.map((l) => (l.group && gids.has(l.group) ? { ...l, group: undefined } : l)), groups: d.groups.filter((g) => !gids.has(g.id)) };
  });
  const drop = (targetId: string) => {
    const from = dragId.current;
    dragId.current = null; setOver(null);
    if (!from || from === targetId) return;
    setDesign((d) => {
      const arr = [...d.layers];
      const i = arr.findIndex((l) => l.id === from), j = arr.findIndex((l) => l.id === targetId);
      if (i < 0 || j < 0) return {};
      const [m] = arr.splice(i, 1);
      const tg = arr.find((l) => l.id === targetId);
      arr.splice(arr.indexOf(tg!) + (i > j ? 0 : 1), 0, { ...m, group: tg?.group });
      return { layers: arr };
    });
  };

  const pick = (l: DLayer, e: React.MouseEvent) => {
    const mates = l.group && !e.altKey ? layers.filter((q) => q.group === l.group).map((q) => q.id) : [l.id];
    if (e.shiftKey || e.metaKey || e.ctrlKey) setSel(designSel.includes(l.id) ? designSel.filter((s) => !mates.includes(s)) : [...designSel, ...mates]);
    else setSel(mates);
  };

  // top first; a group's members sit together under its header
  const rows: { l?: DLayer; gid?: string }[] = [];
  const seen = new Set<string>();
  for (const l of [...layers].reverse()) {
    if (l.group && gOf(l.group)) {
      if (seen.has(l.group)) continue;
      seen.add(l.group);
      rows.push({ gid: l.group });
      for (const m of [...layers].reverse().filter((q) => q.group === l.group)) rows.push({ l: m, gid: l.group });
    } else rows.push({ l });
  }

  return (
    <>
      <div className="dz-layerbar" role="toolbar" aria-label="Layer actions">
        <button className="icon-btn sm" aria-label="Group selected layers" title="Group" disabled={sel.length < 2} onClick={group}><Icon name="folder" size={16} /></button>
        <button className="icon-btn sm" aria-label="Ungroup" title="Ungroup" disabled={!sel.some((l) => l.group)} onClick={ungroup}><Icon name="sides" size={16} /></button>
        <button className="icon-btn sm" aria-label="Bring forward" title="Bring forward" disabled={!sel.length} onClick={() => move(1)}><Icon name="up" size={16} /></button>
        <button className="icon-btn sm" aria-label="Send back" title="Send back" disabled={!sel.length} onClick={() => move(-1)}><Icon name="down" size={16} /></button>
        <button className="icon-btn sm" aria-label="Duplicate layer" title="Duplicate (Ctrl+D)" disabled={!sel.length} onClick={dup}><Icon name="copy" size={16} /></button>
        <button className="icon-btn sm danger" aria-label="Delete layer" title="Delete" disabled={!sel.length} onClick={del}><Icon name="trash" size={16} /></button>
      </div>
      <AddPicture />
      {layers.length === 0 && <div className="group-note dz-empty">{design.makeAs === 'patch' || design.makeAs === 'applique' ? 'Pick a shape or add a picture. The first one you add is the base and sets the outline of the patch, so start with a circle, a star or a shield if you want one.' : 'Pick a shape from the library to start painting your design. Each shape is its own layer.'}</div>}
      <ul className="dz-layers" aria-label="Layers, top first">
        {rows.map((r, i) => {
          if (!r.l) {
            const g = gOf(r.gid)!;
            return (
              <li key={`g${g.id}`} className="dz-group">
                <Icon name="folder" size={16} />
                <input aria-label="Group name" value={g.name} onChange={(e) => setDesign((d) => ({ groups: d.groups.map((q) => (q.id === g.id ? { ...q, name: e.target.value } : q)) }))} />
                <button className="icon-btn sm" aria-label={g.hidden ? 'Show group' : 'Hide group'} onClick={() => setDesign((d) => ({ groups: d.groups.map((q) => (q.id === g.id ? { ...q, hidden: !q.hidden } : q)) }))}><Icon name={g.hidden ? 'eyeoff' : 'eye'} size={16} /></button>
                <button className="icon-btn sm" aria-label={g.locked ? 'Unlock group' : 'Lock group'} aria-pressed={!!g.locked} onClick={() => setDesign((d) => ({ groups: d.groups.map((q) => (q.id === g.id ? { ...q, locked: !q.locked } : q)) }))}><Icon name={g.locked ? 'lock' : 'unlock'} size={16} /></button>
              </li>
            );
          }
          const l = r.l;
          const lib = ALL_ITEMS.find((it) => it.d && it.d === l.path);
          return (
            <li key={l.id} className={`dz-layer ${designSel.includes(l.id) ? 'on' : ''} ${r.gid ? 'in-group' : ''} ${over === l.id ? 'over' : ''}`} draggable onDragStart={() => { dragId.current = l.id; }} onDragOver={(e) => { e.preventDefault(); setOver(l.id); }} onDragLeave={() => setOver(null)} onDrop={() => drop(l.id)} onDragEnd={() => { dragId.current = null; setOver(null); }}>
              <button className="dz-layer-main" aria-pressed={designSel.includes(l.id)} onClick={(e) => pick(l, e)}>
                <svg viewBox="-0.6 -0.6 1.2 1.2" className="layer-thumb" aria-hidden="true" style={{ opacity: isHidden(l) ? 0.35 : 1 }}>
                  {l.shape === 'text' ? <text x="0" y="0" fontSize="0.8" textAnchor="middle" dominantBaseline="central" fill={l.color} fontWeight="700">Aa</text>
                    : <path d={l.shape === 'path' ? l.path ?? '' : SHAPES[l.shape].d} fill={l.color} stroke="var(--separator)" strokeWidth="0.03" fillRule="evenodd" />}
                </svg>
                <span className={isHidden(l) ? 'dim' : ''}>{l.name ?? lib?.name ?? nameOf(l)}</span>
                {baseLayer(design)?.id === l.id && <small className="dz-base-badge">Base</small>}
                {(l.relief ?? 0) !== 0 && <small className="dz-relief-tag">{(l.relief ?? 0) > 0 ? '+' : ''}{(l.relief ?? 0).toFixed(1)}</small>}
              </button>
              <button className="icon-btn sm" aria-label={isHidden(l) ? 'Show layer' : 'Hide layer'} title={isHidden(l) ? 'Show' : 'Hide'} onClick={() => patchOne(l.id, { hidden: !l.hidden })}><Icon name={isHidden(l) ? 'eyeoff' : 'eye'} size={16} /></button>
              <button className="icon-btn sm" aria-label={isLocked(l) ? 'Unlock layer' : 'Lock layer'} aria-pressed={isLocked(l)} title={isLocked(l) ? 'Unlock' : 'Lock'} onClick={() => patchOne(l.id, { locked: !l.locked })}><Icon name={isLocked(l) ? 'lock' : 'unlock'} size={16} /></button>
              <span hidden>{i}</span>
            </li>
          );
        })}
      </ul>
      {sel.length > 0 && <Properties sel={sel} />}
    </>
  );
}

/** Design workspace: build a patch from scratch, or insert a ready made design on the garment. */
export function DesignModeSeg() {
  const { designMode, set } = usePick('designMode', 'set');
  return (
    <Seg<'patch' | 'insert'> label="Design mode" value={designMode} onChange={(m) => set({ designMode: m })}
      options={[{ id: 'patch', label: 'Patch designer' }, { id: 'insert', label: 'Insert design' }]} />
  );
}

export default function DesignSide() {
  const { design, setDesign, units } = usePick('design', 'setDesign', 'units');
  useDesignSync();
  const cloth = design.makeAs === 'patch' || design.makeAs === 'applique';
  return (
    <aside className="dz-side" aria-label="Patch designer panel">
      <div className="dz-side-head"><DesignModeSeg /></div>
      <div className="dz-side-body">
        <>
            <div className="dz-setup">
              <input className="txt name wide" aria-label="Design name" value={design.name} onChange={(e) => setDesign({ name: e.target.value })} />
              <Seg<MakeAs> label="Make it as" value={design.makeAs} options={MAKE} onChange={(v) => setDesign({ makeAs: v })} />
              <Row label="Size"><LenInput units={units} label="Design width" value={design.w} min={1} max={60} onChange={(v) => setDesign({ w: v })} /><LenInput units={units} label="Design height" value={design.h} min={1} max={60} onChange={(v) => setDesign({ h: v })} /></Row>
              {cloth && (
                <>
                  <Row label="Shape" htmlFor="dz-outline"><select id="dz-outline" className="sel" value={design.outline} onChange={(e) => setDesign({ outline: e.target.value as Outline })}>{OUTLINES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></Row>
                  <div className="frow stack"><span className="lbl">Cloth</span><ColorField label="Cloth colour" colors={SWATCH} value={design.cloth} onChange={(c) => setDesign({ cloth: c })} /></div>
                </>
              )}
              {design.makeAs !== 'print' && <div className="frow stack"><span className="lbl">Thread</span><ColorField label="Thread colour" colors={SWATCH} value={design.thread} onChange={(c) => setDesign({ thread: c })} /></div>}
              <Row label="Surface"><Seg label="Sheen" full={false} value={design.sheen ?? 'matte'} options={[{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }, { id: 'glossy', label: 'Glossy' }]} onChange={(v) => setDesign({ sheen: v })} /></Row>
            </div>
            <SubLabel>Layers</SubLabel>
            <Layers />
        </>
      </div>
      <div className="dz-side-foot"><PlaceCard /></div>
    </aside>
  );
}
