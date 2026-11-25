import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import Toolbar from './components/Toolbar';
import PatternEditor from './components/PatternEditor';
import Inspector from './components/Inspector';
import Viewport3D from './components/Viewport3D';
import { useStore } from './store';

export default function App() {
  const [split, setSplit] = useState(58);
  const dragging = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
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
        else if (k === 'f') window.dispatchEvent(new Event('tps-fit'));
        else if ((k === 'delete' || k === 'backspace') && st.selPiece && st.selPoint) st.deletePoint(st.selPiece, st.selPoint);
        else if (k === 'escape') st.select(null, null);
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
          onPointerDown={(e) => {
            dragging.current = true;
            (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
          }}
        />
        <section className="pane right">
          <Viewport3D />
        </section>
      </main>
    </div>
  );
}
