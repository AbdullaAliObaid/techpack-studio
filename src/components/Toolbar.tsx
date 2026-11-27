// Tool rail of the Pattern workspace: labelled tools in four groups.
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import { EMPTY_SEAM_DRAFT, useStore, type Tool, usePick } from '../store';
import { symmetryGroups } from '../data/symmetry';
import Icon from './Icon';

type Preview = (on: boolean, el?: HTMLElement) => void;

function Btn(props: { on?: boolean; label: string; tip: string; icon: string; aria?: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; preview?: Preview }) {
  const { preview } = props;
  return (
    <button className={`rail-btn ${props.on ? 'on' : ''}`} title={props.tip} aria-label={props.aria ?? props.tip.replace(/ \([A-Z]\)$/, '')} aria-pressed={props.on} onClick={props.onClick}
      onPointerEnter={preview && ((e) => preview(true, e.currentTarget))} onPointerLeave={preview && (() => preview(false))}
      onFocus={preview && ((e) => { if (e.currentTarget.matches(':focus-visible')) preview(true, e.currentTarget); })} onBlur={preview && (() => preview(false))}>
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

const FLASH_MS = 1400;

/**
 * Which pieces Symmetry / Total symmetry link, shown while the button is hovered or keyboard focused, and briefly
 * when the mode is switched on. Writes store.symPreview (the chart tints the pieces); the legend chip sits beside the
 * button (fixed, so the rail never clips it and nothing around it moves).
 */
function useSymPreview() {
  const [hover, setHover] = useState<{ mode: 'sym' | 'total'; top: number; left: number } | null>(null);
  const [flash, setFlash] = useState<{ mode: 'sym' | 'total'; top: number; left: number } | null>(null);
  const timer = useRef<number>();
  const active = hover ?? flash;
  useEffect(() => { useStore.setState({ symPreview: active?.mode ?? null }); }, [active?.mode]);
  useEffect(() => () => { window.clearTimeout(timer.current); useStore.setState({ symPreview: null }); }, []);
  const where = (el?: HTMLElement) => { const r = el?.getBoundingClientRect(); return r ? { top: r.top + r.height / 2, left: r.right + 8 } : { top: 0, left: 0 }; };
  const preview = (mode: 'sym' | 'total'): Preview => (on, el) => setHover(on ? { mode, ...where(el) } : null);
  const flashOn = (mode: 'sym' | 'total', el: HTMLElement) => {
    setFlash({ mode, ...where(el) });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };
  return { active, preview, flashOn };
}

function SymLegend({ at }: { at: { mode: 'sym' | 'total'; top: number; left: number } }) {
  const style = useStore((st) => st.project.garment);
  const pieces = useStore((st) => st.project.pieces);
  const groups = symmetryGroups(style, pieces, at.mode);
  const total = at.mode === 'total';
  return (
    <div className="sym-legend" role="status" style={{ top: at.top, left: at.left }}>
      {groups.length === 0 ? <span>Nothing to link on this style</span> : (
        <>
          <span className="sym-legend-head">Linked:</span>
          {groups.map((g) => (
            <span key={g.index} className="sym-legend-item">
              <i className="sym-swatch" data-c={total ? 'total' : g.index % 6} />{g.label}
            </span>
          ))}
        </>
      )}
    </div>
  );
}

export default function Toolbar() {
  const sym = useSymPreview();
  const { tool, symmetry, totalSymmetry, setTotalSymmetry, showMeasure, showStitch, snapOn, showNotes, set } = usePick('tool', 'symmetry', 'totalSymmetry', 'setTotalSymmetry', 'showMeasure', 'showStitch', 'snapOn', 'showNotes', 'set');
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
        <Btn on={tool === 'note'} label="Notes" tip="Notes: draw, add arrows and text on the chart (N)" icon="note" onClick={() => set({ tool: 'note', showNotes: true })} />
        <Btn on={tool === 'pleat'} label="Pleat" tip="Pleat: click an edge to add one (L)" icon="pleat" onClick={build('pleat')} />
      </Group>
      <Group title="Show">
        <Btn on={showMeasure} label="Measure" tip="Show measurements (M)" icon="measure" onClick={() => set({ showMeasure: !showMeasure })} />
        <Btn on={symmetry} label="Symmetry" tip="Symmetry bind: edit both halves together (S)" icon="sym" preview={sym.preview('sym')}
          onClick={(e) => { set({ symmetry: !symmetry }); if (!symmetry) sym.flashOn('sym', e.currentTarget); }} />
        <Btn on={totalSymmetry} label="Total symmetry" aria="Total symmetry" icon="symAll"
          tip="Total symmetry (T): link every mating piece. Move a point on one jeans leg and it moves on all four leg pieces, the same way the front and back bodies and both sleeves move together."
          preview={sym.preview('total')}
          onClick={(e) => { setTotalSymmetry(!totalSymmetry); if (!totalSymmetry) { set({ symmetry: true }); sym.flashOn('total', e.currentTarget); } }} />
        <Btn on={snapOn} label="Snap" tip="Snap: dragged points line up with other points and the grainline. Hold Option to turn it off for one drag." icon="snap" onClick={() => set({ snapOn: !snapOn })} />
        <Btn on={showNotes} label="Show notes" tip="Show notes on the chart" icon="noteshow" onClick={() => set({ showNotes: !showNotes })} />
        <Btn on={showStitch} label="Stitch lines" tip="Stitch lines: cut line 1 cm outside the sewing line" icon="stitch" onClick={() => set({ showStitch: !showStitch })} />
      </Group>
      <Group title="View">
        <Btn label="Fit view" tip="Fit the chart to the window (F)" icon="fit" onClick={() => window.dispatchEvent(new Event('tps-fit'))} />
      </Group>
      {sym.active && <SymLegend at={sym.active} />}
    </div>
  );
}
