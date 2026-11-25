import { useStore, type Tool } from '../store';
import Icon from './Icon';

function Btn(props: { on?: boolean; label: string; hint?: string; icon: string; onClick: () => void }) {
  const text = props.hint ? `${props.label} (${props.hint})` : props.label;
  return (
    <button className={`tool ${props.on ? 'on' : ''}`} title={text} aria-label={props.label} aria-pressed={props.on === undefined ? undefined : props.on} onClick={props.onClick}>
      <Icon name={props.icon} />
    </button>
  );
}

export default function Toolbar() {
  const { tool, symmetry, showMeasure, showStitch, set } = useStore();
  const t = (v: Tool) => () => set({ tool: v });
  return (
    <div className="toolbar" role="toolbar" aria-label="Pattern tools" aria-orientation="vertical">
      <Btn on={tool === 'select'} label="Select and move" hint="V" icon="select" onClick={t('select')} />
      <Btn on={tool === 'add'} label="Add point" hint="P" icon="add" onClick={t('add')} />
      <Btn on={tool === 'pan'} label="Pan" hint="H" icon="pan" onClick={t('pan')} />
      <div className="tool-sep" />
      <Btn on={symmetry} label="Symmetry bind" hint="S" icon="sym" onClick={() => set({ symmetry: !symmetry })} />
      <Btn on={showMeasure} label="Measurements" hint="M" icon="measure" onClick={() => set({ showMeasure: !showMeasure })} />
      <Btn on={showStitch} label="Seam allowance, cut line 1 cm outside the sewing line" icon="stitch" onClick={() => set({ showStitch: !showStitch })} />
      <div className="tool-sep" />
      <Btn label="Fit to screen" hint="F" icon="fit" onClick={() => window.dispatchEvent(new Event('tps-fit'))} />
    </div>
  );
}
