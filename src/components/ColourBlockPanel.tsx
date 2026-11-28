// Edge paint tool card: draw a shape of colour on a piece, or pick a quick block from an edge. Height and colour are exact.
import { usePick } from '../store';
import { ColorField, LenInput, Row, Seg, Switch } from './controls';
import { InsertSection } from './Insert';
import { addPresetBlock, addPresetEdge } from './blockDraw';
import { EDGE_METHODS, METHOD_NAME, TEX_OPTIONS, DEFAULT_WIDTH } from '../data/edgeTrim';
import type { EdgeMethod } from '../data/edits';
import { PRESET_HEIGHT, PRESET_LABEL, type BlockPreset } from '../data/colourBlock';

const INKS = ['#111111', '#ffffff', '#1c2b4a', '#b3202a', '#2f6b3b', '#d9a521', '#8a8d93'];
const QUICK: BlockPreset[] = ['hem', 'tip', 'yoke', 'collar', 'top', 'bottom'];

export default function ColourBlockPanel() {
  const { colourBlock: cb, set, units, totalSymmetry, symmetry, blockDraft, project, removeEdgeTrim } = usePick('colourBlock', 'set', 'units', 'totalSymmetry', 'symmetry', 'blockDraft', 'project', 'removeEdgeTrim');
  const trims = project.edits?.edgeTrims ?? [];
  const method = cb.method ?? 'paint';
  const pickMethod = (m: EdgeMethod) => set({ colourBlock: { ...cb, method: m, ...(m === 'binding' ? { width: cb.method === 'binding' ? cb.width : DEFAULT_WIDTH.binding } : m === 'piping' ? { width: cb.method === 'piping' ? cb.width : DEFAULT_WIDTH.piping } : {}) }, blockDraft: null });
  const up = (patch: Partial<typeof cb>) => set({ colourBlock: { ...cb, ...patch } });
  return (
    <section className="tool-card" aria-label="Edge paint">
      <h3>Edge paint</h3>
      <p className="step-hint" role="status">
        {method !== 'paint' ? 'Press a quick edge, or click an edge on the chart.' : cb.mode === 'rect' ? 'Drag a rectangle on a piece to paint it.' : blockDraft ? 'Click to add corners. Click the first corner or press Enter to finish.' : 'Click corners on a piece to draw a shape.'}
        {' '}{totalSymmetry ? 'Total symmetry is on: it also goes on the matching pieces.' : symmetry ? 'It goes on both sides of a piece cut twice.' : ''}
      </p>
      <div className="sublabel">Edge method</div>
      <Seg label="Edge method" value={method} options={EDGE_METHODS} onChange={pickMethod} />
      <p className="group-note">
        {method === 'paint'
          ? 'Paint is dye or ink on the cloth. Real garments usually finish an edge with thread, binding or piping instead, so pick one of those for a pattern a factory can sew.'
          : method === 'thread' ? 'Contrast thread is a topstitch line in your colour along the edge. It is sewn, so it adds thread, not cloth.'
          : method === 'binding' ? 'Binding is a folded tape wrapped over the raw edge and stitched down on both sides. It adds tape length and width to the materials.'
          : 'Piping is a cord wrapped in tape and sewn into the seam so a thin ridge of colour shows at the edge.'}
      </p>
      {method !== 'paint' && (
        <>
          <div className="agrid" role="group" aria-label="Quick edges">
            <button className="btn small" onClick={() => addPresetEdge('hem')}>Hem edge</button>
            <button className="btn small" onClick={() => addPresetEdge('cuff')}>Cuff / sleeve end</button>
          </div>
          {method === 'thread' && <Seg label="Thread weight" value={String(cb.tex ?? 45)} options={TEX_OPTIONS} onChange={(v) => up({ tex: Number(v) })} />}
          {method !== 'thread' && <label className="kv"><span>{method === 'binding' ? 'Tape width' : 'Cord thickness'}</span><LenInput label={method === 'binding' ? 'Binding width' : 'Piping cord'} units={units} value={cb.width} min={0.2} max={3} step={0.1} onChange={(width) => up({ width })} /></label>}
          {method !== 'piping' && <Row label="Both faces"><Switch on={cb.bothFaces} onChange={(bothFaces) => up({ bothFaces })} label="Both faces" /></Row>}
          {trims.length > 0 && (
            <>
              <div className="sublabel">On this garment</div>
              <ul className="plain-list">
                {trims.map((t) => (
                  <li key={t.id} className="row wrap"><span style={{ flex: 1 }}>{t.name ?? METHOD_NAME[t.method]}</span><button className="btn small" aria-label={`Remove ${t.name ?? METHOD_NAME[t.method]}`} onClick={() => removeEdgeTrim(t.id)}>Remove</button></li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {method === 'paint' && <Row label="Paint both faces"><Switch on={cb.bothFaces} onChange={(bothFaces) => up({ bothFaces })} label="Paint both faces" /></Row>}
      {method === 'paint' && (
      <InsertSection hint="Press a quick edge to add it at once, or pick a shape and draw it on a piece.">
      <Seg label="Shape" value={cb.mode} options={[{ id: 'rect', label: 'Rectangle' }, { id: 'poly', label: 'Polygon' }]} onChange={(mode) => set({ colourBlock: { ...cb, mode }, blockDraft: null })} />
      <div className="sublabel">Quick edges</div>
      <label className="kv"><span>Height</span><LenInput label="Edge paint height" units={units} value={cb.h} min={0.5} max={80} onChange={(h) => up({ h })} /></label>
      <div className="agrid" role="group" aria-label="Quick edges">
        {QUICK.map((q) => (
          <button key={q} className="btn small" onClick={() => addPresetBlock(q, PRESET_HEIGHT[q] === 0 ? 0 : cb.h)}>{PRESET_LABEL[q]}</button>
        ))}
      </div>
      </InsertSection>
      )}
      <div className="sublabel">Colour</div>
      <ColorField label="Edge paint colour" value={cb.colour} colors={INKS} onChange={(colour) => up({ colour })} />
 {method === 'paint' && <>
      <div className="sublabel">Look</div>
      <Seg label="Look" value={cb.look} options={[{ id: 'dyed', label: 'Dyed' }, { id: 'printed', label: 'Printed' }]} onChange={(look) => up({ look })} />
      <Seg label="Finish" value={cb.sheen} options={[{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }, { id: 'glossy', label: 'Glossy' }]} onChange={(sheen) => up({ sheen })} />
      </>}
      {blockDraft && <div className="row wrap"><button className="btn" onClick={() => set({ blockDraft: null })}>Start over</button></div>}
    </section>
  );
}

