// Right click (and press and hold with a finger or Pencil) menus: on the chart for pieces, points, designs, trims, edge paint,
// bands and notes, and on the Design artboard for layers. One app styled menu, keyboard driven (arrows, Enter, Escape).
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { rowSlots } from '../data/edits';
import { matchingTrim } from '../data/construction';
import { uid } from '../lib/units';
import { copiesOf } from './sides';
import { allPointsOf } from './multi';
import { openPieceFlow } from './flow';
import { hitCloth, focusHitMember } from '../three/hitCloth';
import { attachmentAt, inspectPiece } from './inspect';
import { delLayers, dupLayers, groupLayers, lockLayers, moveLayers } from './designOps';
import Icon from './Icon';

export interface MenuItem { label: string; icon?: string; onClick?: () => void; danger?: boolean; disabled?: boolean; sep?: boolean; hint?: string }
interface Open { x: number; y: number; items: MenuItem[] }

let show: ((o: Open | null) => void) | null = null;
export const openContextMenu = (x: number, y: number, items: MenuItem[]) => show?.({ x, y, items: items.filter((i) => i.sep || i.label) });

const S = () => useStore.getState();
const HW_WORD: Record<string, string> = { button: 'button', snap: 'snap', rivet: 'rivet', eyelet: 'eyelet', stud: 'stud', grommet: 'grommet' };
const go = (ws: Parameters<ReturnType<typeof S>['setWorkspace']>[0], extra: Record<string, unknown> = {}) => { S().setWorkspace(ws); S().set(extra as never); };

/** Move an attachment one step in the stack (later is on top). */
function stack(id: string, dir: 1 | -1) {
  const st = S();
  const list = st.project.edits?.attachments ?? [];
  const i = list.findIndex((a) => a.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  st.commit();
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  useStore.setState((s) => ({ project: { ...s.project, edits: { ...s.project.edits!, attachments: next }, updatedAt: Date.now() } }));
}

function attachItems(id: string, slot?: number): MenuItem[] {
  const st = S();
  const a = (st.project.edits?.attachments ?? []).find((q) => q.id === id);
  if (!a) return [];
  const host = st.project.pieces.find((p) => p.id === a.pieceId);
  const pair = !!host && copiesOf(st.project.garment, host) === 2 && a.instance !== undefined;
  const partner = matchingTrim(st.project.edits?.attachments ?? [], a);
  const trim = a.kind === 'hardware' || a.kind === 'label' || a.kind === 'pocket' || a.kind === 'strap';
  // one trim of a row (a placket's buttons): the one right clicked when known, else each listed
  const slots = a.hardware && a.hardware.type !== 'zipper' ? rowSlots(a.hardware) : [];
  const what = a.buttonhole ? 'buttonhole' : a.hardware ? (HW_WORD[a.hardware.type] ?? 'trim') : 'trim';
  const pw = a.buttonhole ? 'button' : 'buttonhole';
  const one: MenuItem[] = slots.length > 1 ? (slot !== undefined && slots.includes(slot) ? [slot] : slots).flatMap((k) => [
    { label: slot !== undefined ? `Remove this ${what}` : `Remove ${what} ${k + 1}`, icon: 'minus', danger: true, onClick: () => st.removeRowItem(id, k) },
    ...(partner ? [{ label: slot !== undefined ? `Remove this ${what} and its ${pw}` : `Remove ${what} ${k + 1} and its ${pw}`, icon: 'minus', danger: true, onClick: () => st.removeRowItem(id, k, true) }] : []),
  ]) : [];
  const skipped = a.hardware?.skip?.length ?? 0;
  return [
    { label: 'Edit', icon: 'select', onClick: () => { go(trim ? 'trims' : 'design', { designMode: 'insert', designTab: 'edit', selAttachment: id, tool: 'select' }); } },
    { label: 'Duplicate', icon: 'copy', onClick: () => { const n = st.duplicateAttachment(id); if (n) st.set({ selAttachment: n }); } },
    ...(pair ? [{ label: 'Copy to other side', icon: 'flip', onClick: () => { const n = st.duplicateAttachment(id); if (n) st.updateAttachment(n, { instance: 1 - (a.instance ?? 0) }); } }] : []),
    { sep: true, label: '' },
    { label: 'Bring forward', icon: 'up', onClick: () => stack(id, 1) },
    { label: 'Send back', icon: 'down', onClick: () => stack(id, -1) },
    { sep: true, label: '' },
    ...(one.length ? [...one, ...(skipped ? [{ label: `Bring back ${skipped} removed`, icon: 'plus', onClick: () => st.restoreRow(id) }] : []), { sep: true, label: '' }] : skipped ? [{ label: `Bring back ${skipped} removed`, icon: 'plus', onClick: () => st.restoreRow(id) }] : []),
    { label: slots.length > 1 ? `Delete all ${slots.length}` : 'Delete', icon: 'trash', danger: true, hint: 'Del', onClick: () => { st.removeAttachment(id); st.set({ selAttachment: null }); } },
    ...(partner ? [{ label: a.buttonhole ? 'Delete with its button' : 'Delete with its buttonhole', icon: 'trash', danger: true, onClick: () => { st.removeAttachment(id); st.removeMatch(); } }] : []),
  ];
}

function pieceItems(pieceId: string, inst: number): MenuItem[] {
  const st = S();
  const p = st.project.pieces.find((q) => q.id === pieceId);
  if (!p) return [];
  const custom = p.role === 'custom';
  return [
    { label: 'Select all points', icon: 'select', onClick: () => { st.select(pieceId, null); st.set({ tool: 'select' }); st.setMulti(allPointsOf(p, inst)); } },
    ...(custom ? [{ label: 'Duplicate piece', icon: 'copy', onClick: () => { st.addCustomPiece(`${p.name} copy`, p.points.map((q) => ({ x: q.x + 2, y: q.y + 2 })), p.placement ?? { mode: 'sewn' }); } }] : []),
    { sep: true, label: '' },
    { label: 'Edge paint here', icon: 'block', onClick: () => { go('paint', { selPiece: pieceId, selInstance: inst, tool: 'block', paintTab: 'edge' }); } },
    { label: 'Insert design here', icon: 'design', onClick: () => { go('design', { designMode: 'insert', designTab: 'add', selPiece: pieceId, selInstance: inst, tool: 'select' }); } },
    { label: 'Add trim here', icon: 'hardware', onClick: () => { go('trims', { designTab: 'add', selPiece: pieceId, selInstance: inst, tool: 'select' }); } },
    { label: 'Add note', icon: 'note', onClick: () => { go('review', { selPiece: pieceId, tool: 'note', showNotes: true }); } },
    ...(custom ? [{ sep: true, label: '' }, { label: 'Delete piece', icon: 'trash', danger: true, hint: 'Del', onClick: () => st.removePiece(pieceId) }] : []),
  ];
}

function pointItems(pieceId: string, pointId: string): MenuItem[] {
  const st = S();
  const p = st.project.pieces.find((q) => q.id === pieceId);
  const pt = p?.points.find((q) => q.id === pointId);
  if (!p || !pt) return [];
  const multi = st.selMulti.length > 1 && st.selMulti.some((i) => i.pieceId === pieceId && i.pointId === pointId);
  if (multi) {
    const items = st.selMulti;
    return [
      { label: 'Make corners', icon: 'pen', onClick: () => st.setSmoothMany(items, false) },
      { label: 'Make curves', icon: 'pen', onClick: () => st.setSmoothMany(items, true) },
      { label: 'Align and distribute', icon: 'sides', onClick: () => go('shape') },
      { sep: true, label: '' },
      { label: `Delete ${items.length} points`, icon: 'trash', danger: true, hint: 'Del', onClick: () => { for (const i of items) { const q = S().project.pieces.find((z) => z.id === i.pieceId)?.points.find((z) => z.id === i.pointId); if (q && !q.tag) S().deletePoint(i.pieceId, i.pointId); } S().setMulti([]); } },
    ];
  }
  return [
    { label: pt.smooth ? 'Make corner' : 'Make curve', icon: 'pen', onClick: () => st.toggleSmooth(pieceId, pointId) },
    { label: st.symmetry ? 'Mirror: on, tap to turn off' : 'Mirror to the other half', icon: 'sym', onClick: () => st.set({ symmetry: !st.symmetry }) },
    { sep: true, label: '' },
    { label: 'Delete point', icon: 'trash', danger: true, hint: 'Del', disabled: !!pt.tag, onClick: () => st.deletePoint(pieceId, pointId) },
  ];
}

function chartItems(t: HTMLElement): MenuItem[] | null {
  const st = S();
  const note = t.closest<HTMLElement>('[data-note]')?.dataset.note;
  if (note) {
    return [
      { label: 'Edit', icon: 'note', onClick: () => go('review', { tool: 'note', showNotes: true, selNote: note }) },
      { sep: true, label: '' },
      { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', onClick: () => st.removeNote(note) },
    ];
  }
  const bandId = t.closest<HTMLElement>('[data-band]')?.dataset.band;
  if (bandId) {
    st.set({ selBand: bandId });
    return [
      { label: 'Edit', icon: 'stripes', onClick: () => go('paint', { paintTab: 'bands', tool: 'select', selBand: bandId }) },
      { label: 'Duplicate', icon: 'copy', onClick: () => { const b = S().project.edits?.bands?.find((q) => q.id === bandId); if (b) { const { id: _id, ...rest } = b; void _id; S().addBand({ ...rest, offset: b.offset + 4 }); } } },
      { sep: true, label: '' },
      { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', onClick: () => st.removeBand(bandId) },
    ];
  }
  const el = t.closest<HTMLElement>('[data-kind]');
  const kind = el?.dataset.kind;
  const pieceId = el?.dataset.piece;
  const inst = Number(el?.dataset.inst ?? 0);
  if (!kind || !el) return null;
  if (kind === 'attach' || kind === 'handle') { const id = el.dataset.att!; st.set({ selAttachment: id, selPiece: pieceId ?? st.selPiece }); const sl = (t.closest('[data-slot]') as HTMLElement | null)?.dataset.slot; return attachItems(id, sl !== undefined ? Number(sl) : undefined); }
  if (kind === 'point' && pieceId) { if (!(st.selMulti.length > 1 && st.selMulti.some((i) => i.pointId === el.dataset.point))) st.select(pieceId, el.dataset.point!); return pointItems(pieceId, el.dataset.point!); }
  if (kind === 'pleat') { const id = el.dataset.pleat!; st.set({ selPleat: id }); return [{ label: 'Delete pleat', icon: 'trash', danger: true, hint: 'Del', onClick: () => st.removePleat(id) }]; }
  if (kind === 'ghost' && pieceId) { st.select(pieceId, null); return [{ label: 'Edit in Seams', icon: 'seams', onClick: () => go('seams', { selPiece: pieceId }) }, { sep: true, label: '' }, { label: 'Delete piece', icon: 'trash', danger: true, hint: 'Del', onClick: () => st.removePiece(pieceId) }]; }
  if ((kind === 'piece' || kind === 'edge') && pieceId) { st.set({ selPiece: pieceId, selInstance: inst, selPoint: null }); return pieceItems(pieceId, inst); }
  return null;
}

/** Right click on the 3D garment (Edit mode): the design or trim under the pointer, else the piece. Camera mode has no menu. */
function clothItems(x: number, y: number): MenuItem[] | null {
  const st = S();
  if (st.view3dMode !== 'edit' || st.pullMode) return null;
  const h = hitCloth(x, y);
  if (!h) return null;
  // in an outfit the garment under the pointer becomes the active one first
  focusHitMember(h);
  const a = attachmentAt(h.pieceId, h.instance ?? 0, h.x, h.y);
  if (a) { S().set({ selAttachment: a.id, selPiece: S().project.pieces.some((p) => p.id === h.pieceId) ? h.pieceId : S().selPiece }); return attachItems(a.id); }
  const piece = S().project.pieces.find((p) => p.id === h.pieceId);
  if (!piece) return null;
  S().set({ selPiece: h.pieceId, selInstance: h.instance ?? 0, selPoint: null, selAttachment: null });
  return [
    { label: 'Edit fabric', icon: 'stitch', onClick: () => inspectPiece(h.pieceId, h.instance ?? 0) },
    { label: 'Select piece', icon: 'select', onClick: () => S().set({ selPiece: h.pieceId, selInstance: h.instance ?? 0 }) },
  ];
}

function artboardItems(t: HTMLElement): MenuItem[] | null {
  const el = t.closest<HTMLElement>('[data-layer]');
  if (!el) return null;
  const id = el.dataset.layer!;
  const st = S();
  const ids = st.designSel.includes(id) ? st.designSel : [id];
  if (!st.designSel.includes(id)) st.set({ designSel: [id] });
  const l = st.design.layers.find((q) => q.id === id);
  return [
    { label: 'Duplicate', icon: 'copy', hint: 'Ctrl D', onClick: () => dupLayers(ids) },
    { label: 'Group', icon: 'folder', disabled: ids.length < 2, onClick: () => groupLayers(ids) },
    { label: l?.locked ? 'Unlock' : 'Lock', icon: l?.locked ? 'unlock' : 'lock', onClick: () => lockLayers(ids, !l?.locked) },
    { sep: true, label: '' },
    { label: 'Bring forward', icon: 'up', onClick: () => moveLayers(ids, 1) },
    { label: 'Send back', icon: 'down', onClick: () => moveLayers(ids, -1) },
    { sep: true, label: '' },
    { label: 'Delete', icon: 'trash', danger: true, hint: 'Del', onClick: () => delLayers(ids) },
  ];
}

export function ContextMenuHost() {
  const [m, setM] = useState<Open | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<{ t: number; x: number; y: number } | null>(null);
  useEffect(() => { show = setM; return () => { show = null; }; }, []);
  const rdown = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const build = (target: EventTarget | null, x: number, y: number) => {
      // the chart captures the pointer, so the event target is the whole svg: ask what is really under the pointer
      const under = document.elementFromPoint(x, y) as HTMLElement | null;
      const t = (under && (target as Element | null)?.closest?.('.editor-svg, .dz-slot svg') && (under.closest('.editor-svg, .dz-slot svg') ? under : null)) || (target as HTMLElement | null);
      if (!t?.closest) return false;
      if (S().screen !== 'editor') return false;
      if (t.closest('.viewport canvas')) {
        // a right button drag pans the camera: no menu when the pointer travelled
        if (rdown.current && Math.hypot(x - rdown.current.x, y - rdown.current.y) > 5) return false;
        const cloth = clothItems(x, y);
        if (!cloth) return false;
        setM({ x, y, items: cloth });
        return true;
      }
      const inChart = t.closest('.editor-svg');
      const inBoard = t.closest('.dz-slot svg');
      const items = inChart ? chartItems(t) : inBoard ? artboardItems(t) : null;
      if (!items) return false;
      setM({ x, y, items });
      return true;
    };
    const ctx = (e: MouseEvent) => { if (build(e.target, e.clientX, e.clientY)) e.preventDefault(); else setM(null); };
    // press and hold with a finger or Pencil
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') { if (e.button === 2) rdown.current = { x: e.clientX, y: e.clientY }; return; }
      window.clearTimeout(press.current?.t);
      const x = e.clientX, y = e.clientY, target = e.target;
      press.current = { x, y, t: window.setTimeout(() => { if (build(target, x, y)) navigator.vibrate?.(8); }, 550) };
    };
    const moved = (e: PointerEvent) => { const p = press.current; if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { window.clearTimeout(p.t); press.current = null; } };
    const up = () => { window.clearTimeout(press.current?.t); press.current = null; };
    window.addEventListener('contextmenu', ctx);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', moved);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => { window.removeEventListener('contextmenu', ctx); window.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', moved); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
  }, []);
  useEffect(() => {
    if (!m) return;
    const first = ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
    first?.focus();
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setM(null); };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setM(null); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const bs = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
      const i = bs.indexOf(document.activeElement as HTMLButtonElement);
      bs[(i + (e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
    };
    const close = () => setM(null);
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', close); window.removeEventListener('resize', close); };
  }, [m]);
  if (!m) return null;
  const W = 236, H = Math.min(window.innerHeight - 16, m.items.length * 40 + 16);
  const x = Math.max(8, Math.min(m.x, window.innerWidth - W - 8)), y = Math.max(8, Math.min(m.y, window.innerHeight - H - 8));
  void uid; void openPieceFlow;
  return (
    <div className="ctx-menu material" role="menu" aria-label="Actions" ref={ref} style={{ left: x, top: y, width: W }} onContextMenu={(e) => e.preventDefault()}>
      {m.items.map((it, i) => it.sep ? <div key={i} className="menu-sep" role="separator" /> : (
        <button key={i} role="menuitem" className={`menu-row ${it.danger ? 'danger' : ''}`} disabled={it.disabled} onClick={() => { setM(null); it.onClick?.(); }}>
          <Icon name={it.icon ?? 'select'} size={18} /><span>{it.label}</span>{it.hint && <kbd>{it.hint}</kbd>}
        </button>
      ))}
    </div>
  );
}
