// Colour block tool card: draw a shape on a piece, or pick a quick block from an edge. Height and colour are exact.
import { usePick } from '../store';
import { ColorField, LenInput, Seg } from './controls';
import { addPresetBlock } from './blockDraw';
import { PRESET_HEIGHT, PRESET_LABEL, type BlockPreset } from '../data/colourBlock';
import Icon from './Icon';

const INKS = ['#111111', '#ffffff', '#1c2b4a', '#b3202a', '#2f6b3b', '#d9a521', '#8a8d93'];
const QUICK: BlockPreset[] = ['hem', 'tip', 'yoke', 'collar', 'top', 'bottom'];

export default function ColourBlockPanel() {
  const { colourBlock: cb, set, units, totalSymmetry, symmetry, blockDraft } = usePick('colourBlock', 'set', 'units', 'totalSymmetry', 'symmetry', 'blockDraft');
  const up = (patch: Partial<typeof cb>) => set({ colourBlock: { ...cb, ...patch } });
  return (
    <section className="tool-card" aria-label="Colour block">
      <h3>Colour block</h3>
      <p className="step-hint" role="status">
        {cb.mode === 'rect' ? 'Drag a rectangle on a piece.' : blockDraft ? 'Click to add corners. Click the first corner or press Enter to finish.' : 'Click corners on a piece to draw a shape.'}
        {' '}{totalSymmetry ? 'Total symmetry is on: it also goes on the matching pieces.' : symmetry ? 'It goes on both sides of a piece cut twice.' : ''}
      </p>
      <Seg label="Shape" value={cb.mode} options={[{ id: 'rect', label: 'Rectangle' }, { id: 'poly', label: 'Polygon' }]} onChange={(mode) => set({ colourBlock: { ...cb, mode }, blockDraft: null })} />
      <div className="sublabel">Colour</div>
      <ColorField label="Block colour" value={cb.colour} colors={INKS} onChange={(colour) => up({ colour })} />
      <div className="sublabel">Look</div>
      <Seg label="Look" value={cb.look} options={[{ id: 'dyed', label: 'Dyed' }, { id: 'printed', label: 'Printed' }]} onChange={(look) => up({ look })} />
      <Seg label="Finish" value={cb.sheen} options={[{ id: 'matte', label: 'Matte' }, { id: 'satin', label: 'Satin' }, { id: 'glossy', label: 'Glossy' }]} onChange={(sheen) => up({ sheen })} />
      <div className="sublabel">Quick blocks</div>
      <label className="kv"><span>Height</span><LenInput label="Block height" units={units} value={cb.h} min={0.5} max={80} onChange={(h) => up({ h })} /></label>
      <div className="agrid" role="group" aria-label="Quick blocks">
        {QUICK.map((q) => (
          <button key={q} className="btn small" onClick={() => addPresetBlock(q, PRESET_HEIGHT[q] === 0 ? 0 : cb.h)}>{PRESET_LABEL[q]}</button>
        ))}
      </div>
      <div className="row wrap">
        {blockDraft && <button className="btn" onClick={() => set({ blockDraft: null })}>Start over</button>}
        <button className="btn ghost" onClick={() => useStoreCancel()}><Icon name="check" size={16} /> Done</button>
      </div>
    </section>
  );
}

import { useStore } from '../store';
const useStoreCancel = () => useStore.getState().cancelTools();
