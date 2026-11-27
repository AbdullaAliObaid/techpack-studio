// The right panel. Each workspace shows only its own job here; the chart and the 3D view stay where they are.
import { useEffect } from 'react';
import { useStore, usePick } from '../store';
import { CATALOG, migrateGarment } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import { WORKSPACES } from './designDoc';
import { Disclosure, Seg, TabHeader } from './controls';
import { FabricSwatch, fabricLabel } from './FabricBrowser';
import FabricBrowser from './FabricBrowser';
import ConstructionPanel, { PenCard } from './ConstructionPanel';
import ColourBlockPanel from './ColourBlockPanel';
import BandsPanel from './BandsPanel';
import DesignLibrary from './DesignPanel';
import AttachmentEditor from './AttachmentEditor';
import PosePanel from './PosePanel';
import { BodyFields, BodyType } from './BodyPanel';
import { SavedBodies } from './BodyPresets';
import { FacesSection, FitPick, PieceNumbers, PointCard, ReviewSections } from './Inspector';
import { FinishCard } from './Workspaces';
import { DesignModeSeg } from './DesignSide';
import { byLayer, useOutfit } from './uiData';
import Icon from './Icon';

function FabricPanel() {
  const { project, selPiece, fabricScope, set, applyFabric } = usePick('project', 'selPiece', 'fabricScope', 'set', 'applyFabric');
  const style = CATALOG.find((s) => s.id === migrateGarment(project.garment));
  const piece = project.pieces.find((p) => p.id === selPiece);
  const scope = piece ? fabricScope : 'all';
  const current = (piece ?? project.pieces[0]).fabric;
  const cf = fabricById(current.id);
  return (
    <>
      <div className="mat-head">
        <FabricSwatch fabric={current} size={72} label={`${cf.name} swatch`} />
        <div>
          <span className="mat-kicker">Material</span>
          <h2>{style?.name ?? 'Garment'}</h2>
          <p>{fabricLabel(current)}{piece ? ` on ${piece.name}` : ', whole garment'}</p>
        </div>
      </div>
      <FacesSection />
      <Disclosure id="gar-fabric" title="Fabric, colour and pattern" icon="grid" openFirst>
        <div className="seg full">
          <button className={scope === 'all' ? 'on' : ''} onClick={() => set({ fabricScope: 'all' })}>Whole garment</button>
          <button className={scope === 'piece' ? 'on' : ''} disabled={!piece} onClick={() => set({ fabricScope: 'piece' })}>
            {piece ? piece.name : 'Select a piece'}
          </button>
        </div>
        <FabricBrowser idKey="outside" value={current} onChange={applyFabric} />
      </Disclosure>
    </>
  );
}

function PaintPanel() {
  const { paintTab, set } = usePick('paintTab', 'set');
  return (
    <>
      <Seg<'edge' | 'bands'> label="Paint tool" value={paintTab} options={[{ id: 'edge', label: 'Edge paint' }, { id: 'bands', label: 'Bands across' }]}
        onChange={(t) => set(t === 'edge' ? { paintTab: t, tool: 'block', blockDraft: null } : { paintTab: t, tool: 'select', blockDraft: null })} />
      {paintTab === 'edge' ? <ColourBlockPanel /> : <BandsPanel />}
    </>
  );
}

/** Trims and the Design workspace's insert mode share one panel: the library, and the editor of the selected one. */
function AttachPanel({ mode }: { mode: 'insert' | 'trims' }) {
  const { designTab, selAttachment, project, set } = usePick('designTab', 'selAttachment', 'project', 'set');
  const att = (project.edits?.attachments ?? []).find((a) => a.id === selAttachment);
  useEffect(() => { if (selAttachment) set({ designTab: 'edit' }); }, [selAttachment, set]);
  const tab = designTab === 'edit' && att ? 'edit' : 'add';
  return (
    <>
      <Seg<'add' | 'edit'> label="Library or edit" value={tab} onChange={(t) => set({ designTab: t })}
        options={[{ id: 'add', label: 'Library' }, { id: 'edit', label: 'Edit selected', disabled: !att }]} />
      {tab === 'edit' && att ? <AttachmentEditor att={att} /> : <DesignLibrary mode={mode} />}
    </>
  );
}

function FitPanel() {
  const { resetBody, view3d, set } = usePick('resetBody', 'view3d', 'set');
  return (
    <>
      <Disclosure id="fit-ease" title="Fit, how much ease" icon="stretch" openFirst>
        <FitPick />
        <p className="group-note">How much room the pattern has around the body. The pattern and the 3D garment follow.</p>
      </Disclosure>
      <Disclosure id="fit-stretch" title="Stretch-Risk-O-Meter" icon="stretch">
        <Seg<'fabric' | 'stretch'> label="3D view colouring" value={view3d} onChange={(v) => set({ view3d: v })} options={[{ id: 'fabric', label: 'Fabric' }, { id: 'stretch', label: 'Stretch risk' }]} />
        <p className="group-note">Colours the 3D garment by how hard each part is pulled on this body: green is relaxed, red is at risk of tearing or popping seams.</p>
      </Disclosure>
      <SavedBodies />
      <Disclosure id="body-type" title="Body type" icon="body">
        <BodyType />
      </Disclosure>
      <Disclosure id="body-measure" title="Measurements" icon="tape">
        <BodyFields advanced={false} />
        <button className="btn ghost small" onClick={resetBody}>Reset to default</button>
      </Disclosure>
      <Disclosure id="body-more" title="More measurements" icon="tape">
        <BodyFields advanced />
      </Disclosure>
      <PosePanel />
    </>
  );
}

function OutfitPanel() {
  const outfit = useOutfit();
  if (!outfit) return null;
  const n = byLayer(outfit.items).length;
  return (
    <section className="tool-card" aria-label="Outfit">
      <h3>{outfit.name}</h3>
      <p className="step-hint">{n} {n === 1 ? 'garment' : 'garments'} worn together. Use the bar above the chart to pick the garment you edit, move it nearer the skin or outward, tuck a top in, or hide a layer.</p>
      <p className="group-note">Every other workspace edits the garment you picked. Its pieces are listed beside the chart.</p>
    </section>
  );
}

function NotesList() {
  const { project, selNote, tool, set, removeNote } = usePick('project', 'selNote', 'tool', 'set', 'removeNote');
  const notes = project.notes ?? [];
  const label = (k: string) => (k === 'ink' ? 'Pen note' : k === 'arrow' ? 'Arrow' : 'Text note');
  return (
    <Disclosure id="review-notes" title="Notes" icon="note" count={notes.length} openFirst
      action={<button className="btn small primary" disabled={tool === 'note'} onClick={() => set({ tool: 'note', showNotes: true })}><Icon name="plus" size={14} /> Add</button>}>
      {notes.length === 0 && <div className="group-note">Draw, point with arrows or type on the chart. Notes print on the tech pack. Press Add, then draw on the chart.</div>}
      <ul className="seam-list">
        {notes.map((n, i) => (
          <li key={n.id} className={`seam-item ${n.id === selNote ? 'hover' : ''}`}>
            <button className="plain-row" aria-pressed={n.id === selNote} onClick={() => set({ tool: 'note', showNotes: true, selNote: n.id })}>
              <span className="seam-name">{i + 1}. {label(n.kind)}<small>{n.text ? n.text.slice(0, 40) : project.pieces.find((p) => p.id === n.pieceId)?.name ?? 'On the chart'}</small></span>
            </button>
            <button className="icon-btn sm danger" aria-label={`Delete note ${i + 1}`} title="Delete note" onClick={() => removeNote(n.id)}><Icon name="trash" size={16} /></button>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function Body({ ws }: { ws: string }) {
  const tool = useStore((s) => s.tool);
  switch (ws) {
    case 'shape': return <>{tool === 'pen' && <PenCard />}<PointCard /><PieceNumbers /></>;
    case 'seams': return <ConstructionPanel />;
    case 'fabric': return <FabricPanel />;
    case 'paint': return <PaintPanel />;
    case 'design': return <AttachPanel mode="insert" />;
    case 'trims': return <AttachPanel mode="trims" />;
    case 'fit': return <FitPanel />;
    case 'outfit': return <OutfitPanel />;
    case 'finish': return <FinishCard />;
    case 'review': return <><NotesList /><ReviewSections /></>;
    default: return null;
  }
}

export default function Inspector() {
  const { workspace, drawer, set } = usePick('workspace', 'drawer', 'set');
  const w = WORKSPACES.find((q) => q.id === workspace) ?? WORKSPACES[0];
  return (
    <aside className={`inspector ${drawer ? 'drawer-open' : ''}`} aria-label={`${w.label} panel`} data-ws={workspace}>
      <div className="inspector-head">
        <button className="drawer-close btn small" onClick={() => set({ drawer: false })} aria-label="Close panel"><Icon name="chevronRight" size={14} /> Hide panel</button>
        <TabHeader icon={w.icon} title={w.label} subtitle={w.blurb} />
        {workspace === 'design' && <DesignModeSeg />}
      </div>
      <div className="inspector-body scroll-fade" role="region" aria-label={`${w.label} tools`} key={workspace}>
        <Body ws={workspace} />
      </div>
    </aside>
  );
}
