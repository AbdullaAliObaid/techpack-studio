// The tool rail: only the tools of the open workspace, so there are never more than a handful.
import type React from 'react';
import { EMPTY_SEAM_DRAFT, type Tool, usePick } from '../store';
import Icon from './Icon';

function Btn(props: { on?: boolean; label: string; tip: string; icon: string; aria?: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <button className={`rail-btn ${props.on ? 'on' : ''}`} title={props.tip} aria-label={props.aria ?? props.tip.replace(/ \([A-Z]\)$/, '')} aria-pressed={props.on} onClick={props.onClick}>
      <Icon name={props.icon} size={22} />
      <span>{props.label}</span>
    </button>
  );
}

const TOOL: Record<Tool, { label: string; tip: string; icon: string }> = {
  select: { label: 'Select', tip: 'Select and move (V)', icon: 'select' },
  add: { label: 'Add point', tip: 'Add a point on an edge (P)', icon: 'add' },
  pan: { label: 'Pan', tip: 'Pan the chart (H)', icon: 'pan' },
  pen: { label: 'Pen', tip: 'Pen: draw a new piece (D)', icon: 'pen' },
  seams: { label: 'Join seam', tip: 'Join seam: sew one stretch of a piece to another (J)', icon: 'seams' },
  pleat: { label: 'Pleats', tip: 'Pleats: click an edge to add one (L)', icon: 'pleat' },
  note: { label: 'Notes', tip: 'Notes: draw, add arrows and text on the chart (N)', icon: 'note' },
  brush: { label: 'Brush', tip: 'Brush: paint wash and wear on the pattern or the 3D garment', icon: 'draw' },
  block: { label: 'Edge paint', tip: 'Edge paint: draw a shape of colour on a piece, like black sleeve tips (B)', icon: 'block' },
};

type Item = Tool | 'measure' | 'flip' | 'bands';
const RAIL: Record<string, Item[]> = {
  shape: ['select', 'add', 'pen', 'measure', 'pan'],
  seams: ['select', 'seams', 'pleat', 'pan'],
  fabric: ['select', 'flip', 'pan'],
  paint: ['select', 'block', 'bands', 'pan'],
  review: ['select', 'note', 'measure', 'pan'],
  fit: ['select', 'measure', 'pan'],
  finish: ['brush', 'select', 'pan'],
};

export default function Toolbar() {
  const { workspace, tool, showMeasure, viewFace, paintTab, set } = usePick('workspace', 'tool', 'showMeasure', 'viewFace', 'paintTab', 'set');
  const narrow = () => (window.innerWidth <= 960 ? { drawer: true } : {});
  const pick = (v: Tool) => () => {
    set({ measureTool: null });
    if (v === 'pen' || v === 'seams' || v === 'pleat' || v === 'block') set({ tool: v, seamDraft: EMPTY_SEAM_DRAFT, penDraft: [], penSheet: null, pieceFlow: null, blockDraft: null, ...(v === 'block' ? { paintTab: 'edge' as const } : {}), ...narrow() });
    else if (v === 'note') set({ tool: 'note', showNotes: true });
    else set({ tool: v });
  };
  const inside = viewFace === 'inside';
  const render = (it: Item) => {
    if (it === 'measure') return <Btn key={it} on={showMeasure} label="Measure" tip="Measure: labels, rulers and measuring tools (M)" icon="measure" onClick={() => set({ showMeasure: !showMeasure, ...(!showMeasure ? { measureTool: 'ruler' as const } : {}) })} />;
    if (it === 'bands') return <Btn key={it} on={paintTab === 'bands'} label="Bands" tip="Bands: stripes across the whole garment" icon="stripes" onClick={() => set({ tool: 'select', paintTab: 'bands', blockDraft: null })} />;
    if (it === 'flip') return <Btn key={it} on={inside} label={inside ? 'Inside' : 'Outside'} tip={inside ? 'Turn the pattern back to the outside' : 'Turn the garment inside out'} aria="Turn the pattern over" icon="flip" onClick={() => set({ viewFace: inside ? 'outside' : 'inside', designFace: inside ? 'outside' : 'inside' })} />;
    const d = TOOL[it];
    const on = tool === it && !(workspace === 'paint' && paintTab === 'bands' && it === 'block');
    return <Btn key={it} on={on} label={d.label} tip={d.tip} icon={d.icon} onClick={pick(it)} />;
  };
  const list = RAIL[workspace] ?? ['select', 'pan'];
  if (workspace === 'techpack') return null;
  return (
    <div className="rail" role="toolbar" aria-label="Chart tools" aria-orientation="vertical">
      {list.map(render)}
    </div>
  );
}
