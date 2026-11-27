import { commitBlockDraft } from './components/blockDraw';
import { installDragScroll } from './components/dragScroll';
import { allPointsOf } from './components/multi';
import { useEffect, useRef, useState } from 'react';
import TopBar from './components/TopBar';
import PatternPane from './components/PatternPane';
import Inspector from './components/Panels';
import Viewport3D from './components/Viewport3D';
import PieceFlow from './components/PieceFlow';
import PhotoSheet from './components/PhotoSheet';
import { toolAllowed, WS_TOOLS } from './components/workspaceTools';
import { useOutfit } from './components/uiData';
import { openPieceFlow } from './components/flow';
import { EMPTY_SEAM_DRAFT, useStore } from './store';
import { useApplyTheme } from './components/theme';
import { copiesOf } from './components/sides';
import Splash from './components/Splash';
import Home from './components/Home';
import NewFlow from './components/NewFlow';
import { nudgePatch } from './components/editHelpers';
import { OutfitBar } from './components/Outfits';
import { ContextMenuHost } from './components/ContextMenu';
import { installOutfitFallback } from './components/uiData';
import DesignCanvas from './components/DesignCanvas';
import DesignLibrary from './components/DesignLibrary';
import DesignSide from './components/DesignSide';
import { TechPackPanel, WorkspaceBar, useWorkspaceKeys } from './components/Workspaces';
import { isWorkspace, newDesign, normaliseWorkspace, readWorkspaceMap } from './components/designDoc';

installOutfitFallback();

let lastNudge = 0;

/** React 18 has no `inert` prop: set the attribute by hand. */
const inertIf = (on: boolean) => (on ? ({ inert: '' } as Record<string, string>) : {});

export default function App() {
  useApplyTheme();
  // press and drag (or wheel) to roll through every sideways row of options
  useEffect(() => installDragScroll(), []);
  const STACK = '(max-width: 960px) and (orientation: portrait)';
  const [stacked, setStacked] = useState(() => window.matchMedia(STACK).matches);
  const [split, setSplit] = useState(() => (window.matchMedia(STACK).matches ? 52 : window.innerWidth < 1300 ? 56 : 52));
  const dragging = useRef(false);
  const screen = useStore((s) => s.screen);
  const newFrom = useStore((s) => s.newFlow.from);
  const workspace = useStore((s) => s.workspace);
  const designMode = useStore((s) => s.designMode);
  const inOutfit = !!useOutfit();
  const projectId = useStore((s) => s.project.id);
  useWorkspaceKeys();
  // each project remembers its own workspace; a new project starts a fresh design
  useEffect(() => {
    // ?ws=fabric opens that workspace (tests and deep links); otherwise the project's own last one
    const link = new URLSearchParams(window.location.search).get('ws');
    useStore.setState({ workspace: isWorkspace(link) ? link : normaliseWorkspace(readWorkspaceMap()[projectId]), design: newDesign(), designSel: [], selBand: null });
    requestAnimationFrame(() => window.dispatchEvent(new Event('tps-fit')));
  }, [projectId]);
  useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event('tps-fit')), 60); return () => clearTimeout(t); }, [workspace, designMode]);
  // each workspace offers its own tools: drop a tool (and half finished drafts) that does not belong, start on the workspace's own
  useEffect(() => {
    const st = useStore.getState();
    if (!toolAllowed(workspace, st.tool)) { st.cancelTools(); st.set({ tool: WS_TOOLS[workspace][0] }); }
    else if (workspace === 'paint' && st.tool === 'select' && st.paintTab === 'edge') st.set({ tool: 'block' });
  }, [workspace]);
  // the Outfit tab only exists while an outfit is open
  useEffect(() => { if (!inOutfit && workspace === 'outfit') useStore.getState().setWorkspace('shape'); }, [inOutfit, workspace]);
  const prevScreen = useRef(screen);
  useEffect(() => { prevScreen.current = screen; }, [screen]);
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
      if (st.screen !== 'editor') return; // Home and the New flow own the keyboard
      const mod = e.metaKey || e.ctrlKey;
      const chartOn = st.workspace !== 'techpack' && !(st.workspace === 'design' && st.designMode === 'patch');
      if (!chartOn && !(mod && ['z', 'y'].includes(e.key.toLowerCase()))) return; // the patch designer and the tech pack handle their own keys
      const ok = (t: Parameters<typeof toolAllowed>[1]) => toolAllowed(st.workspace, t);
      if (st.pieceFlow && e.key.toLowerCase() !== 'escape') return; // the New piece sheet owns the keyboard
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? st.redo() : st.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        st.redo();
      } else if (mod && e.key.toLowerCase() === 'a' && st.tool === 'select' && st.selPiece) {
        // select every point of the selected piece
        const pc = st.project.pieces.find((q) => q.id === st.selPiece);
        if (pc) { e.preventDefault(); st.setMulti(allPointsOf(pc, st.selInstance ?? 0)); }
      } else if (!mod) {
        const k = e.key.toLowerCase();
        if (k === 'v') st.set({ tool: 'select' });
        else if (k === 'p' && ok('add')) st.set({ tool: 'add' });
        else if (k === 'h') st.set({ tool: 'pan' });
        else if (k === 's') st.set({ symmetry: !st.symmetry });
        else if (k === 't') { st.setTotalSymmetry(!st.totalSymmetry); if (!st.totalSymmetry) st.set({ symmetry: true }); }
        else if (k === 'm') st.set({ showMeasure: !st.showMeasure });
        else if (k === 'j' && ok('seams')) st.set({ tool: 'seams', seamDraft: EMPTY_SEAM_DRAFT });
        else if (k === 'l' && ok('pleat')) st.set({ tool: 'pleat' });
        else if (k === 'n' && ok('note')) st.set({ tool: 'note', showNotes: true });
        else if (k === 'd' && ok('pen')) st.set({ tool: 'pen', penDraft: [] });
        else if (k === 'b' && ok('block')) st.set({ tool: 'block', paintTab: 'edge', blockDraft: null });
        else if (k === 'f') window.dispatchEvent(new Event('tps-fit'));
        else if (k === 'enter' && st.tool === 'block' && st.blockDraft && !st.blockDraft.rect && st.blockDraft.pts.length >= 3) commitBlockDraft();
        else if (k === 'backspace' && st.tool === 'block' && st.blockDraft && !st.blockDraft.rect) st.set({ blockDraft: st.blockDraft.pts.length > 1 ? { ...st.blockDraft, pts: st.blockDraft.pts.slice(0, -1) } : null });
        else if (k === 'enter' && st.tool === 'pen' && st.penDraft.length >= 3) openPieceFlow(st.penDraft);
        else if (k === 'backspace' && st.tool === 'pen' && st.penDraft.length) st.set({ penDraft: st.penDraft.slice(0, -1) });
        else if (k.startsWith('arrow') && st.selAttachment && st.tool === 'select') {
          // nudge the selected design: 1 mm, or 1 cm with Shift
          const a = st.project.edits?.attachments.find((q) => q.id === st.selAttachment);
          if (!a) return;
          e.preventDefault();
          const atts = st.project.edits?.attachments ?? [];
          const host = st.project.pieces.find((p) => p.id === a.pieceId);
          const step = e.shiftKey ? 1 : 0.1;
          const dx = k === 'arrowright' ? step : k === 'arrowleft' ? -step : 0, dy = k === 'arrowdown' ? step : k === 'arrowup' ? -step : 0;
          const mirrored = !!host && copiesOf(st.project.garment, host) === 2 && st.showBothSides && (a.instance ?? st.selInstance ?? 0) === 1;
          const now = performance.now();
          if (now - lastNudge > 700) st.commit(); // one undo step per burst of key presses
          lastNudge = now;
          st.updateAttachment(a.id, nudgePatch(atts, a, dx, dy, mirrored));
        } else if (k.startsWith('arrow') && st.tool === 'select' && !st.selAttachment && (st.selMulti.length > 0 || (st.selPiece && st.selPoint))) {
          // nudge the selected points: 1 mm, or 1 cm with Shift (the chart does the move)
          e.preventDefault();
          const step = e.shiftKey ? 1 : 0.1;
          window.dispatchEvent(new CustomEvent('tps-nudge', { detail: { dx: k === 'arrowright' ? step : k === 'arrowleft' ? -step : 0, dy: k === 'arrowdown' ? step : k === 'arrowup' ? -step : 0 } }));
        } else if (k === 'delete' || k === 'backspace') {
          if (st.tool === 'note' && st.selNote) st.removeNote(st.selNote);
          else if (st.workspace === 'paint' && st.paintTab === 'bands' && st.selBand) st.removeBand(st.selBand);
          else if (st.selAttachment) st.removeAttachment(st.selAttachment);
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
    <div className={`app ${stacked ? 'stacked' : ''}`} data-screen={screen}>
      <Splash />
      <div className="editor-shell" {...inertIf(screen !== 'editor')} data-state={screen === 'editor' ? 'active' : 'hidden'}>
      <TopBar />
      <WorkspaceBar />
      {workspace === 'outfit' && <OutfitBar />}
      <main className="workspace" data-ws={workspace} data-dm={designMode}>
        <div
          className="canvases"
          onPointerMove={(e) => {
            if (!dragging.current) return;
            const r = e.currentTarget.getBoundingClientRect();
            setSplit(Math.min(75, Math.max(30, stacked ? ((e.clientY - r.top) / r.height) * 100 : ((e.clientX - r.left) / r.width) * 100)));
          }}
          onPointerUp={() => (dragging.current = false)}
        >
          <div className="pane-slot pattern-slot" style={stacked ? { height: `${split}%` } : { width: `min(${split}%, calc(100% - 340px))` }}>
            <PatternPane />
          </div>
          <div className="dz-slot">
            <DesignLibrary />
            <DesignCanvas />
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
          <DesignSide />
          <TechPackPanel />
        </div>
        <Inspector />
      </main>
      <PieceFlow />
      <PhotoSheet />
      <ContextMenuHost />
      </div>
      <div className="layer home-layer" data-state={screen === 'home' ? 'active' : screen === 'new' && newFrom === 'home' ? 'under' : 'gone'} {...inertIf(screen !== 'home')}>
        <Home />
      </div>
      <div className="layer new-layer" data-state={screen === 'new' ? 'active' : screen === 'home' ? 'right' : 'gone'} data-from={newFrom} {...inertIf(screen !== 'new')}>
        <NewFlow />
      </div>
    </div>
  );
}
