// Notes on the chart: freehand ink, arrows and text callouts. Pen and finger friendly.
// A note starts on the piece under its first point and is stored in that piece's local cm, so it moves with the piece.
import { useEffect, useRef, useState } from 'react';
import { useStore, usePick, type Note } from '../store';
import type { Pt } from '../lib/geometry';
import type { Entry } from './sides';
import Icon from './Icon';

export const NOTE_COLORS = ['#ff3b30', '#ff9500', '#34c759', '#007aff', '#af52de', '#1c1c1e'];
export const NOTE_WIDTHS = [{ id: 2, label: 'Thin' }, { id: 3.5, label: 'Medium' }, { id: 6, label: 'Thick' }];

type Draft = { kind: 'ink' | 'arrow'; pts: Pt[]; entry: Entry | null } | { kind: 'move'; id: string; last: Pt; committed: boolean };

/** world position of a note point */
function worldOf(n: Note, p: Pt, entries: Entry[]): Pt {
  if (!n.pieceId) return p;
  const en = entries.find((e) => e.src.id === n.pieceId && e.inst === (n.instance ?? 0)) ?? entries.find((e) => e.src.id === n.pieceId);
  return en ? { x: p.x + en.offset.x, y: p.y + en.offset.y } : p;
}

/** Pointer handling for the Notes tool. The chart calls these when tool is 'note'. */
export function useNoteTool(toWorld: (cx: number, cy: number) => Pt, entryAt: (w: Pt) => Entry | null, entries: Entry[]) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const ref = useRef<Draft | null>(null);
  const set = (d: Draft | null) => { ref.current = d; setDraft(d); };

  const down = (e: React.PointerEvent): boolean => {
    const st = useStore.getState();
    const w = toWorld(e.clientX, e.clientY);
    const hit = (e.target as Element).closest?.('[data-note]') as HTMLElement | null;
    if (hit) {
      const id = hit.dataset.note!;
      st.set({ selNote: id });
      if ((e.target as Element).closest('[data-editing]')) return true;
      set({ kind: 'move', id, last: w, committed: false });
      return true;
    }
    st.set({ selNote: null });
    setEditing(null);
    const en = entryAt(w);
    if (st.noteKind === 'text') {
      const local = en ? { x: w.x - en.offset.x, y: w.y - en.offset.y } : w;
      const id = st.addNote({ kind: 'text', points: [local], text: '', color: st.noteColor, width: st.noteWidth, ...(en ? { pieceId: en.src.id, instance: en.both ? en.inst : undefined } : {}) });
      setEditing(id);
      return true;
    }
    set({ kind: st.noteKind === 'arrow' ? 'arrow' : 'ink', pts: [w, w], entry: en });
    return true;
  };

  const move = (e: React.PointerEvent) => {
    const d = ref.current;
    if (!d) return;
    const w = toWorld(e.clientX, e.clientY);
    const st = useStore.getState();
    if (d.kind === 'move') {
      const dx = w.x - d.last.x, dy = w.y - d.last.y;
      if (!d.committed && Math.hypot(dx, dy) * 1 < 0.05) return;
      if (!d.committed) st.commit();
      const n = st.project.notes?.find((q) => q.id === d.id);
      if (n) st.updateNote(d.id, { points: n.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) });
      set({ ...d, last: w, committed: true });
    } else if (d.kind === 'ink') set({ ...d, pts: [...d.pts, w] });
    else set({ ...d, pts: [d.pts[0], w] });
  };

  const up = () => {
    const d = ref.current;
    set(null);
    if (!d || d.kind === 'move') return;
    const st = useStore.getState();
    const len = d.pts.reduce((a, p, i) => (i ? a + Math.hypot(p.x - d.pts[i - 1].x, p.y - d.pts[i - 1].y) : 0), 0);
    if (len < 0.4) return; // a tap with no stroke
    const en = d.entry;
    const pts = en ? d.pts.map((p) => ({ x: p.x - en.offset.x, y: p.y - en.offset.y })) : d.pts;
    const keep = d.kind === 'ink' ? thin(pts) : pts;
    st.addNote({ kind: d.kind, points: keep, color: st.noteColor, width: st.noteWidth, ...(en ? { pieceId: en.src.id, instance: en.both ? en.inst : undefined } : {}) });
  };

  const cancel = () => set(null);
  void entries;
  return { draft, down, move, up, cancel, editing, setEditing };
}

/** drop points closer than 1 mm to the last kept one */
function thin(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of p) if (!out.length || Math.hypot(q.x - out[out.length - 1].x, q.y - out[out.length - 1].y) > 0.1) out.push({ x: Math.round(q.x * 100) / 100, y: Math.round(q.y * 100) / 100 });
  return out.length ? out : p.slice(0, 1);
}

function inkPath(pts: Pt[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0].x},${pts[0].y}l0.01,0` : '';
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) { const m = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 }; d += `Q${pts[i].x},${pts[i].y} ${m.x},${m.y}`; }
  const l = pts[pts.length - 1];
  return d + `L${l.x},${l.y}`;
}

function Arrow({ a, b, color, w, k }: { a: Pt; b: Pt; color: string; w: number; k: number }) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), s = (w * 3.2 + 6) / k;
  const h1 = { x: b.x - s * Math.cos(ang - 0.45), y: b.y - s * Math.sin(ang - 0.45) }, h2 = { x: b.x - s * Math.cos(ang + 0.45), y: b.y - s * Math.sin(ang + 0.45) };
  return (
    <g fill="none" stroke={color} strokeWidth={w / k} strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${a.x},${a.y}L${b.x},${b.y}`} />
      <path d={`M${h1.x},${h1.y}L${b.x},${b.y}L${h2.x},${h2.y}`} />
    </g>
  );
}

const lines = (t: string) => (t || ' ').split('\n');

export default function NotesLayer({ k, entries, tool }: { k: number; entries: Entry[]; tool: ReturnType<typeof useNoteTool> & { active: boolean } }) {
  const { project, showNotes, selNote, noteColor, noteWidth, noteKind } = usePick('project', 'showNotes', 'selNote', 'noteColor', 'noteWidth', 'noteKind');
  const notes = project.notes ?? [];
  const px = (n: number) => n / k;
  if (!showNotes && !tool.active) return null;
  const d = tool.draft;
  return (
    <g className="notes-layer" data-active={tool.active ? '' : undefined} pointerEvents={tool.active ? 'auto' : 'none'}>
      {notes.map((n) => {
        const pts = n.points.map((p) => worldOf(n, p, entries));
        const sel = selNote === n.id;
        const box = bbox(n, pts, k);
        return (
          <g key={n.id} data-note={n.id} style={{ cursor: tool.active ? 'move' : undefined }}>
            {/* generous invisible hit area */}
            {n.kind === 'ink' && <path d={inkPath(pts)} fill="none" stroke="transparent" strokeWidth={Math.max(n.width, 14) / k} strokeLinecap="round" strokeLinejoin="round" />}
            {n.kind === 'ink' && <path d={inkPath(pts)} fill="none" stroke={n.color} strokeWidth={n.width / k} strokeLinecap="round" strokeLinejoin="round" />}
            {n.kind === 'arrow' && pts.length >= 2 && (<><path d={`M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`} stroke="transparent" strokeWidth={14 / k} fill="none" /><Arrow a={pts[0]} b={pts[1]} color={n.color} w={n.width} k={k} /></>)}
            {n.kind === 'text' && pts[0] && (
              <TextNote n={n} at={pts[0]} k={k} editing={tool.editing === n.id} onEdit={() => tool.active && tool.setEditing(n.id)} onDone={() => tool.setEditing(null)} />
            )}
            {sel && box && <rect className="note-sel" x={box.x - px(6)} y={box.y - px(6)} width={box.w + px(12)} height={box.h + px(12)} rx={px(6)} fill="none" strokeWidth={px(1.5)} strokeDasharray={`${px(5)} ${px(4)}`} pointerEvents="none" />}
          </g>
        );
      })}
      {d && d.kind === 'ink' && <path d={inkPath(d.pts)} fill="none" stroke={noteColor} strokeWidth={noteWidth / k} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />}
      {d && d.kind === 'arrow' && <Arrow a={d.pts[0]} b={d.pts[1]} color={noteColor} w={noteWidth} k={k} />}
      {tool.active && noteKind === 'text' && !d && null}
    </g>
  );
}

function bbox(n: Note, pts: Pt[], k: number): { x: number; y: number; w: number; h: number } | null {
  if (!pts.length) return null;
  if (n.kind === 'text') {
    const ls = lines(n.text ?? '');
    const w = Math.max(...ls.map((l) => l.length), 6) * 7.4 + 20, h = ls.length * 17 + 14;
    return { x: pts[0].x, y: pts[0].y - 10 / k, w: w / k, h: h / k };
  }
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

function TextNote({ n, at, k, editing, onEdit, onDone }: { n: Note; at: Pt; k: number; editing: boolean; onEdit: () => void; onDone: () => void }) {
  const ls = lines(n.text ?? '');
  const w = Math.max(...ls.map((l) => l.length), 6) * 7.4 + 20, h = ls.length * 17 + 14;
  const update = useStore((s) => s.updateNote);
  const remove = useStore((s) => s.removeNote);
  const area = useRef<HTMLTextAreaElement>(null);
  // the click that placed the note would take focus back on release, so focus after it
  useEffect(() => { if (!editing) return; const t = window.setTimeout(() => { area.current?.focus(); area.current?.select(); }, 80); return () => window.clearTimeout(t); }, [editing]);
  return (
    <g transform={`translate(${at.x},${at.y - 10 / k}) scale(${1 / k})`} onDoubleClick={onEdit}>
      <circle cx={0} cy={10} r={3.2} fill={n.color} />
      {editing ? (
        <foreignObject x={0} y={0} width={Math.max(w, 180)} height={Math.max(h, 40) + 8} data-editing="">
          <textarea
            ref={area} className="note-input" aria-label="Note text" defaultValue={n.text} rows={Math.max(ls.length, 2)} style={{ borderColor: n.color }}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={(e) => { const t = e.target.value.trim(); if (!t) remove(n.id); else update(n.id, { text: t }); onDone(); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); }}
          />
        </foreignObject>
      ) : (
        <g>
          <rect x={8} y={0} width={w} height={h} rx={8} className="note-card" stroke={n.color} strokeWidth={1.5} />
          {ls.map((l, i) => <text key={i} x={18} y={19 + i * 17} className="note-text" fontSize={13}>{l}</text>)}
        </g>
      )}
    </g>
  );
}

/** Colour, width and kind of the next note, over the chart. */
export function NotesBar() {
  const { tool, noteKind, noteColor, noteWidth, selNote, project, set, updateNote, removeNote, commit } = usePick('tool', 'noteKind', 'noteColor', 'noteWidth', 'selNote', 'project', 'set', 'updateNote', 'removeNote', 'commit');
  if (tool !== 'note') return null;
  const sel = project.notes?.find((n) => n.id === selNote);
  const kinds = [{ id: 'ink', label: 'Pen' }, { id: 'arrow', label: 'Arrow' }, { id: 'text', label: 'Text' }] as const;
  const pickColor = (c: string) => { set({ noteColor: c }); if (sel) { commit(); updateNote(sel.id, { color: c }); } };
  const pickWidth = (w: number) => { set({ noteWidth: w }); if (sel && sel.kind !== 'text') { commit(); updateNote(sel.id, { width: w }); } };
  return (
    <div className="notes-bar material" role="toolbar" aria-label="Note options">
      <div className="seg" role="group" aria-label="Note type">
        {kinds.map((k) => <button key={k.id} className={noteKind === k.id ? 'on' : ''} aria-pressed={noteKind === k.id} onClick={() => set({ noteKind: k.id })}>{k.label}</button>)}
      </div>
      <div className="nb-colors" role="group" aria-label="Note colour">
        {NOTE_COLORS.map((c) => <button key={c} className={(sel?.color ?? noteColor) === c ? 'on' : ''} aria-label={`Colour ${c}`} aria-pressed={(sel?.color ?? noteColor) === c} style={{ background: c }} onClick={() => pickColor(c)} />)}
      </div>
      {noteKind !== 'text' && (
        <div className="seg" role="group" aria-label="Line width">
          {NOTE_WIDTHS.map((w) => <button key={w.id} className={(sel && sel.kind !== 'text' ? sel.width : noteWidth) === w.id ? 'on' : ''} aria-pressed={noteWidth === w.id} aria-label={w.label} onClick={() => pickWidth(w.id)}><span className="nb-dash" style={{ height: w.id }} /></button>)}
        </div>
      )}
      <button className="icon-btn" disabled={!sel} aria-label="Delete selected note" title="Delete the selected note" onClick={() => sel && removeNote(sel.id)}><Icon name="trash" size={18} /></button>
      <span className="nb-hint">{sel ? (sel.kind === 'text' ? 'Drag to move. Double tap to edit.' : 'Drag to move.') : noteKind === 'text' ? 'Tap the chart to place a note.' : 'Draw on the chart.'}</span>
    </div>
  );
}
