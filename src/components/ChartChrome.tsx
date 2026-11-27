// Chart furniture: the floating modifiers (Symmetry, Total symmetry, Snap) and the View menu in the chart header.
import { useEffect, useRef, useState } from 'react';
import { useStore, usePick } from '../store';
import { symmetryGroups } from '../data/symmetry';
import { copiesOf } from './sides';
import { MODIFIER_WS } from './workspaceTools';
import Icon from './Icon';

type Mode = 'sym' | 'total';
type At = { mode: Mode; top: number; left: number };

const FLASH_MS = 1400;

/**
 * Which pieces Symmetry / Total symmetry link, shown while the button is hovered or keyboard focused, and briefly
 * when the mode is switched on. Writes store.symPreview (the chart tints the pieces); the legend chip sits above the
 * button (fixed, so nothing clips it and nothing around it moves).
 */
function useSymPreview() {
  const [hover, setHover] = useState<At | null>(null);
  const [flash, setFlash] = useState<At | null>(null);
  const timer = useRef<number>();
  const active = hover ?? flash;
  useEffect(() => { useStore.setState({ symPreview: active?.mode ?? null }); }, [active?.mode]);
  useEffect(() => () => { window.clearTimeout(timer.current); useStore.setState({ symPreview: null }); }, []);
  const where = (el?: HTMLElement) => { const r = el?.getBoundingClientRect(); return r ? { top: r.top - 8, left: r.left } : { top: 0, left: 0 }; };
  const preview = (mode: Mode) => ({
    onPointerEnter: (e: React.PointerEvent<HTMLElement>) => setHover({ mode, ...where(e.currentTarget) }),
    onPointerLeave: () => setHover(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.currentTarget.matches(':focus-visible')) setHover({ mode, ...where(e.currentTarget) }); },
    onBlur: () => setHover(null),
  });
  const flashOn = (mode: Mode, el: HTMLElement) => {
    setFlash({ mode, ...where(el) });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
  };
  return { active, preview, flashOn };
}

function SymLegend({ at }: { at: At }) {
  const style = useStore((st) => st.project.garment);
  const pieces = useStore((st) => st.project.pieces);
  const groups = symmetryGroups(style, pieces, at.mode);
  const total = at.mode === 'total';
  return (
    <div className="sym-legend" role="status" style={{ top: at.top, left: at.left, transform: 'translateY(-100%)' }}>
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

/** Bottom left of the chart while editing. Modifiers change how edits behave, so they live next to the edit. */
export function ChartModifiers() {
  const sym = useSymPreview();
  const { workspace, symmetry, totalSymmetry, setTotalSymmetry, snapOn, set } = usePick('workspace', 'symmetry', 'totalSymmetry', 'setTotalSymmetry', 'snapOn', 'set');
  if (!MODIFIER_WS.includes(workspace)) return null;
  return (
    <div className="chart-mods material" role="toolbar" aria-label="Editing modifiers">
      <button className={`mod ${symmetry ? 'on' : ''}`} aria-pressed={symmetry} title="Symmetry: edit both halves together (S)" {...sym.preview('sym')}
        onClick={(e) => { set({ symmetry: !symmetry }); if (!symmetry) sym.flashOn('sym', e.currentTarget); }}>
        <Icon name="sym" size={18} /><span>Symmetry</span>
      </button>
      <button className={`mod ${totalSymmetry ? 'on' : ''}`} aria-pressed={totalSymmetry} title="Total symmetry (T): link every mating piece. Move a point on one jeans leg and it moves on all four leg pieces, the same way the front and back bodies and both sleeves move together." {...sym.preview('total')}
        onClick={(e) => { setTotalSymmetry(!totalSymmetry); if (!totalSymmetry) { set({ symmetry: true }); sym.flashOn('total', e.currentTarget); } }}>
        <Icon name="symAll" size={18} /><span>Total</span>
      </button>
      <button className={`mod ${snapOn ? 'on' : ''}`} aria-pressed={snapOn} title="Snap: dragged points line up with other points and the grainline. Hold Option to turn it off for one drag." onClick={() => set({ snapOn: !snapOn })}>
        <Icon name="snap" size={18} /><span>Snap</span>
      </button>
      {sym.active && <SymLegend at={sym.active} />}
    </div>
  );
}

/** What the chart draws on top of the pattern. Small and in the chart header, since it is not an editing choice. */
export function ViewMenu() {
  const { project, showMeasure, showStitch, showNotes, showBothSides, set } = usePick('project', 'showMeasure', 'showStitch', 'showNotes', 'showBothSides', 'set');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasPairs = project.pieces.some((p) => copiesOf(project.garment, p) === 2);
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [open]);
  const row = (label: string, on: boolean, flip: () => void, icon: string) => (
    <button role="menuitemcheckbox" aria-checked={on} className="menu-row" onClick={flip}>
      <Icon name={icon} size={18} /><span>{label}</span><span className="tick">{on && <Icon name="check" size={16} />}</span>
    </button>
  );
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn ghost view-btn" aria-haspopup="menu" aria-expanded={open} title="What the chart shows" onClick={() => setOpen(!open)}>
        <Icon name="eye" size={16} /> View <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="menu right" role="menu" aria-label="View">
          <div className="menu-label">Show on the chart</div>
          {row('Measurements (M)', showMeasure, () => set({ showMeasure: !showMeasure }), 'measure')}
          {row('Stitch lines', showStitch, () => set({ showStitch: !showStitch }), 'stitch')}
          {row('Notes', showNotes, () => set({ showNotes: !showNotes }), 'noteshow')}
          {hasPairs && row('Both sides', showBothSides, () => set({ showBothSides: !showBothSides }), 'flip')}
          <div className="menu-sep" role="separator" />
          <button role="menuitem" className="menu-row" onClick={() => { window.dispatchEvent(new Event('tps-fit')); setOpen(false); }}><Icon name="fit" size={18} /><span>Fit to window (F)</span><span className="tick" /></button>
        </div>
      )}
    </div>
  );
}
