import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import PatternPane from './components/PatternPane';
import Inspector from './components/Inspector';
import Viewport3D from './components/Viewport3D';
import PieceFlow from './components/PieceFlow';
import { openPieceFlow } from './components/flow';
import { EMPTY_SEAM_DRAFT, useStore } from './store';
import { useApplyTheme } from './components/theme';

export default function App() {
  useApplyTheme();
  const STACK = '(max-width: 960px) and (orientation: portrait)';
  const [stacked, setStacked] = useState(() => window.matchMedia(STACK).matches);
  const [split, setSplit] = useState(() => (window.matchMedia(STACK).matches ? 52 : window.innerWidth < 1300 ? 56 : 52));
  const dragging = useRef(false);
  // portrait iPad: Pattern on top, 3D view below, so both get the full width
  useEffect(() => {
    const m = window.matchMedia(STACK);
    const on = () => { setStacked(m.matches); setSplit(m.matches ? 52 : window.innerWidth < 1300 ? 56 : 52); };
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (st.pieceFlow && e.key.toLowerCase() !== 'escape') return; // the New piece sheet owns the keyboard
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (!mod) {
        const k = e.key.toLowerCase();
        if (k === 'v') st.set({ tool: 'select' });
        else if (k === 'p') st.set({ tool: 'add' });
        else if (k === 'h') st.set({ tool: 'pan' });
        else if (k === 's') st.set({ symmetry: !st.symmetry });
        else if (k === 'm') st.set({ showMeasure: !st.showMeasure });
        else if (k === 'j') st.set({ tool: 'seams', inspectorTab: 'construction', seamDraft: EMPTY_SEAM_DRAFT });
        else if (k === 'l') st.set({ tool: 'pleat', inspectorTab: 'construction' });
        else if (k === 'd') st.set({ tool: 'pen', inspectorTab: 'construction', penDraft: [] });
        else if (k === 'f') window.dispatchEvent(new Event('tps-fit'));
        else if (k === 'enter' && st.tool === 'pen' && st.penDraft.length >= 3) openPieceFlow(st.penDraft);
        else if (k === 'backspace' && st.tool === 'pen' && st.penDraft.length) st.set({ penDraft: st.penDraft.slice(0, -1) });
        else if (k === 'delete' || k === 'backspace') {
          if (st.selAttachment) st.removeAttachment(st.selAttachment);
          else if (st.selPleat) st.removePleat(st.selPleat);
          else if (st.selPiece && st.selPoint) st.deletePoint(st.selPiece, st.selPoint);
        } else if (k === 'escape') {
          st.cancelTools();
          st.set({ selAttachment: null });
          st.select(null, null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={`app ${stacked ? 'stacked' : ''}`}>
      <TopBar />
      <main className="workspace">
        <div
          className="canvases"
          onPointerMove={(e) => {
            if (!dragging.current) return;
            const r = e.currentTarget.getBoundingClientRect();
            setSplit(Math.min(75, Math.max(30, stacked ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100)));
          }}
          onPointerUp={() => (dragging.current = false)}
        >
          <div className="pane-slot" style={stacked ? { height: `${split}%` } : { width: `${split}%` }}>
            <PatternPane />
          </div>
          <div
            className="divider"
            role="separator"
            aria-orientation={stacked ? 'horizontal' : 'vertical'}
            aria-label="Resize panes"
            onPointerDown={(e) => {
              dragging.current = true;
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
            }}
          />
          <Viewport3D />
        </div>
        <Inspector />
      </main>
      <PieceFlow />
    </div>
  );
}
