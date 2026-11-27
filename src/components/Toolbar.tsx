// Tool rail of the Pattern workspace: labelled tools in four groups.
import { EMPTY_SEAM_DRAFT, useStore, type Tool, usePick } from '../store';
import Icon from './Icon';

function Btn(props: { on?: boolean; label: string; tip: string; icon: string; onClick: () => void }) {
  return (
    <button className={`rail-btn ${props.on ? 'on' : ''}`} title={props.tip} aria-label={props.tip.replace(/ \([A-Z]\)$/, '')} aria-pressed={props.on} onClick={props.onClick}>
      <Icon name={props.icon} size={22} />
      <span>{props.label}</span>
    </button>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rail-group" role="group" aria-label={title}>
      <div className="rail-head">{title}</div>
      {children}
    </div>
  );
}

export default function Toolbar() {
  const { tool, symmetry, showMeasure, showStitch, set } = usePick('tool', 'symmetry', 'showMeasure', 'showStitch', 'set');
  const t = (v: Tool) => () => set({ tool: v });
  // build tools open their controls in the Construction tab and drop any half finished action
  const build = (v: Tool) => () => set({
    tool: v, inspectorTab: 'construction', seamDraft: EMPTY_SEAM_DRAFT, penDraft: [], penSheet: null, pieceFlow: null,
    ...(window.innerWidth <= 960 ? { drawer: true } : {}),
  });
  return (
    <div className="rail" role="toolbar" aria-label="Pattern tools" aria-orientation="vertical">
      <Group title="Edit">
        <Btn on={tool === 'select'} label="Select" tip="Select and move (V)" icon="select" onClick={t('select')} />
        <Btn on={tool === 'add'} label="Add point" tip="Add a point on an edge (P)" icon="add" onClick={t('add')} />
        <Btn on={tool === 'pan'} label="Pan" tip="Pan the chart (H)" icon="pan" onClick={t('pan')} />
      </Group>
      <Group title="Create">
        <Btn on={tool === 'pen'} label="Pen" tip="Pen: draw a new piece (D)" icon="pen" onClick={build('pen')} />
        <Btn on={tool === 'seams'} label="Seam" tip="Seam: join or open seams (J)" icon="seams" onClick={build('seams')} />
        <Btn on={tool === 'pleat'} label="Pleat" tip="Pleat: click an edge to add one (L)" icon="pleat" onClick={build('pleat')} />
      </Group>
      <Group title="Show">
        <Btn on={showMeasure} label="Measure" tip="Show measurements (M)" icon="measure" onClick={() => set({ showMeasure: !showMeasure })} />
        <Btn on={symmetry} label="Symmetry" tip="Symmetry bind: edit both halves together (S)" icon="sym" onClick={() => set({ symmetry: !symmetry })} />
        <Btn on={showStitch} label="Stitch lines" tip="Stitch lines: cut line 1 cm outside the sewing line" icon="stitch" onClick={() => set({ showStitch: !showStitch })} />
      </Group>
      <Group title="View">
        <Btn label="Fit view" tip="Fit the chart to the window (F)" icon="fit" onClick={() => window.dispatchEvent(new Event('tps-fit'))} />
      </Group>
    </div>
  );
}
