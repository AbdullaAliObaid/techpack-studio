import { useStore, type Tool } from '../store';

const I = {
  select: <path d="M5 3l14 8-6 1.5L10 19z" />,
  add: <><path d="M4 18C8 6 16 6 20 18" /><circle cx="12" cy="9" r="2.2" /><path d="M18 3v5M15.5 5.5h5" /></>,
  pan: <path d="M8 13V6a1.5 1.5 0 013 0v6m0-7a1.5 1.5 0 013 0v7m0-5a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 012.5-1.5L8 15" />,
  sym: <><path d="M12 3v18" strokeDasharray="2 2" /><path d="M9 7L4 12l5 5M15 7l5 5-5 5" /></>,
  measure: <><path d="M3 15l12-12 6 6-12 12z" /><path d="M7 11l2 2M10 8l2 2M13 5l2 2" /></>,
  stitch: <path d="M4 20L20 4" strokeDasharray="3 2.5" />,
  fit: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
};

function Btn(props: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`tool ${props.on ? 'on' : ''}`} title={props.title} onClick={props.onClick}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {props.children}
      </svg>
    </button>
  );
}

export default function Toolbar() {
  const { tool, symmetry, showMeasure, showStitch, set } = useStore();
  const t = (v: Tool) => () => set({ tool: v });
  return (
    <div className="toolbar">
      <Btn on={tool === 'select'} title="Select / move (V)" onClick={t('select')}>{I.select}</Btn>
      <Btn on={tool === 'add'} title="Add point (P)" onClick={t('add')}>{I.add}</Btn>
      <Btn on={tool === 'pan'} title="Pan (H)" onClick={t('pan')}>{I.pan}</Btn>
      <div className="tool-sep" />
      <Btn on={symmetry} title="Symmetry bind (S)" onClick={() => set({ symmetry: !symmetry })}>{I.sym}</Btn>
      <Btn on={showMeasure} title="Measurements (M)" onClick={() => set({ showMeasure: !showMeasure })}>{I.measure}</Btn>
      <Btn on={showStitch} title="Seam allowance (cut line, 1 cm outside the sewing line)" onClick={() => set({ showStitch: !showStitch })}>{I.stitch}</Btn>
      <div className="tool-sep" />
      <Btn title="Fit to screen (F)" onClick={() => window.dispatchEvent(new Event('tps-fit'))}>{I.fit}</Btn>
    </div>
  );
}
