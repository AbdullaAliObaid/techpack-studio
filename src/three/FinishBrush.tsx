import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useStore } from '../store';
import { hitCloth } from './hitCloth';

// Finish brush on the 3D garment: press and drag on the cloth to paint the chosen wash or distress. The stroke is stored
// in the hit piece's own pattern space (store.paintFinish), so it follows the piece on the chart and in the tech pack.

export default function FinishBrush() {
  const { gl, controls } = useThree();
  const on = useStore((s) => s.workspace === 'finish' && s.tool === 'brush');
  useEffect(() => {
    if (!on) return;
    const el = gl.domElement;
    const orbit = controls as unknown as { enabled: boolean } | null;
    let cur: { id: number; piece: string; inst: number | undefined } | null = null;
    const prevCursor = el.style.cursor;
    el.style.cursor = 'crosshair';
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const st = useStore.getState();
      if (st.view3dMode === 'camera') return;
      const h = hitCloth(e.clientX, e.clientY);
      if (!h) return;
      const inst = h.copies > 1 ? h.instance : undefined;
      cur = { id: e.pointerId, piece: h.pieceId, inst };
      st.paintFinish(h.pieceId, inst, h.x, h.y, true);
      if (orbit) orbit.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      e.preventDefault();
      e.stopPropagation();
    };
    let frame = 0, last: PointerEvent | null = null;
    const move = (e: PointerEvent) => {
      if (!cur || e.pointerId !== cur.id) return;
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!cur || !last) return;
        const h = hitCloth(last.clientX, last.clientY);
        if (h && h.pieceId === cur.piece) useStore.getState().paintFinish(cur.piece, cur.inst, h.x, h.y, false);
      });
    };
    const up = (e: PointerEvent) => {
      if (!cur || e.pointerId !== cur.id) return;
      cur = null;
      if (orbit) orbit.enabled = true;
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.style.cursor = prevCursor;
      if (frame) cancelAnimationFrame(frame);
      if (orbit) orbit.enabled = true;
    };
  }, [on, gl, controls]);
  return null;
}
