// The Design panel, docked to the pattern: left of the chart on wide screens, a bottom sheet under it on iPad.
// It holds the design library (Add) and the editor for the selected design (Edit). Collapsible and resizable.
import { useRef } from 'react';
import { useStore, writeDesignSize } from '../store';
import { Seg } from './controls';
import DesignLibrary from './DesignPanel';
import AttachmentEditor from './AttachmentEditor';
import Icon from './Icon';

const MIN = { side: 250, bottom: 200 };
const MAX = { side: 480, bottom: 0.62 };

export default function DesignDock({ mode }: { mode: 'side' | 'bottom' }) {
  const { designOpen, designCollapsed, designTab, designSize, selAttachment, project, set } = useStore();
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  if (!designOpen) return null;
  const att = (project.edits?.attachments ?? []).find((a) => a.id === selAttachment);
  const tab = designTab === 'edit' && att ? 'edit' : 'add';
  const side = mode === 'side';

  const clamp = (v: number) => (side ? Math.min(MAX.side, Math.max(MIN.side, v)) : Math.min(window.innerHeight * MAX.bottom, Math.max(MIN.bottom, v)));
  const resize = (e: React.PointerEvent) => {
    if (!start.current) return;
    set({ designSize: side ? { ...designSize, w: clamp(start.current.w + e.clientX - start.current.x) } : { ...designSize, h: clamp(start.current.h - (e.clientY - start.current.y)) } });
  };
  const key = (e: React.KeyboardEvent) => {
    const grow = side ? 'ArrowRight' : 'ArrowUp', shrink = side ? 'ArrowLeft' : 'ArrowDown';
    if (e.key !== grow && e.key !== shrink) return;
    e.preventDefault();
    const next = side ? { ...designSize, w: clamp(designSize.w + (e.key === grow ? 24 : -24)) } : { ...designSize, h: clamp(designSize.h + (e.key === grow ? 24 : -24)) };
    set({ designSize: next });
    writeDesignSize(next);
  };

  if (designCollapsed) {
    return (
      <aside className={`design-dock ${mode} collapsed`} aria-label="Insert design panel, collapsed">
        <button className="dock-expand" aria-label="Open the Insert design panel" title="Open the Insert design panel" onClick={() => set({ designCollapsed: false })}>
          <Icon name="design" size={20} /><span>Insert design</span><Icon name={side ? 'chevronRight' : 'up'} size={14} />
        </button>
      </aside>
    );
  }

  return (
    <aside className={`design-dock ${mode}`} aria-label="Insert design panel" style={side ? { width: designSize.w } : { height: designSize.h }}>
      <div
        className="dock-resize" role="separator" tabIndex={0} aria-orientation={side ? 'vertical' : 'horizontal'} aria-label="Resize the Insert design panel. Use the arrow keys."
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start.current = { x: e.clientX, y: e.clientY, w: designSize.w, h: designSize.h }; }}
        onPointerMove={resize}
        onPointerUp={() => { if (start.current) writeDesignSize(useStore.getState().designSize); start.current = null; }}
        onKeyDown={key}
      />
      <header className="dock-head">
        <span className="dock-title"><Icon name="design" size={20} /><h2>Insert design</h2></span>
        <Seg full={false} label="Insert design view" value={tab} onChange={(t) => set({ designTab: t })}
          options={[{ id: 'add', label: 'Library' }, { id: 'edit', label: 'Edit', disabled: !att }]} />
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Collapse the Insert design panel" title="Collapse" onClick={() => set({ designCollapsed: true })}><Icon name={side ? 'chevron' : 'down'} size={16} /></button>
        <button className="icon-btn sm" aria-label="Close the Insert design panel" title="Close" onClick={() => set({ designOpen: false })}><Icon name="close" size={16} /></button>
      </header>
      <div className="dock-body">
        {tab === 'edit' && att ? <AttachmentEditor att={att} /> : <DesignLibrary />}
      </div>
    </aside>
  );
}
