import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import PatternEditor from './components/PatternEditor';
import Inspector from './components/Inspector';
import Viewport3D from './components/Viewport3D';
import PlaceSheet from './components/PlaceSheet';
import { EMPTY_SEAM_DRAFT, useStore } from './store';
import { useApplyTheme } from './components/theme';

export default function App() {
  useApplyTheme();
  const [split, setSplit] = useState(() => (window.innerWidth < 1300 ? 60 : 58));
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const st = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;
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
        else if (k === 'j') st.set({ tool: 'seams', inspectorTab: 'seams', seamDraft: EMPTY_SEAM_DRAFT });
        else if (k === 'l') st.set({ tool: 'pleat', inspectorTab: 'seams' });
        else if (k === 'd') st.set({ tool: 'pen', inspectorTab: 'seams', penDraft: [] });
        else if (k === 'f') window.dispatchEvent(new Event('tps-fit'));
        else if (k === 'enter' && st.tool === 'pen' && st.penDraft.length >= 3) st.set({ penSheet: st.penDraft, penDraft: [] });
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
    <div className="app">
      <TopBar />
      <main
        className="workspace"
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const r = e.currentTarget.getBoundingClientRect();
          setSplit(Math.min(78, Math.max(30, ((e.clientX - r.left) / r.width) * 100)));
        }}
        onPointerUp={() => (dragging.current = false)}
      >
        <section className="pane left" style={{ width: `${split}%` }}>
          <Toolbar />
          <PatternEditor />
          <Inspector />
        </section>
        <div
          className="divider"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
          }}
        />
        <section className="pane right">
          <Viewport3D />
        </section>
      </main>
      <PlaceSheet />
    </div>
  );
}
