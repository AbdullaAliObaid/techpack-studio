import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import type { Attachment } from '../data/edits';
import { fabricById } from '../data/fabrics';
import { SHAPES, outlinePolygon } from '../lib/shapes';
import { registerHitCloth, type ClothHit } from './hitCloth';
import { NONE, type VertexPattern } from './printsAdapter';

// Attachment artwork on the draped cloth, plus picking and dragging in 3D.
// Artwork is painted per pattern piece into a canvas in pattern space (cm to pixels). A decal mesh shares the cloth's
// position, normal and index buffers, so it deforms with the cloth for free, and samples those canvases through its own
// uv (pattern coords normalised to the piece box). Cloth attachments with their own simulated panel (piece id equals the
// attachment id, local coords centred on the attachment) are painted on that panel, otherwise on the host piece.

export const ATTACH_MIME = 'application/x-techit-attachment';
const MAX_PX = 1536;
const PX_PER_CM = 10;
const rad = (d: number) => (d * Math.PI) / 180;

interface Bounds { x0: number; y0: number; w: number; h: number }

function fabricHex(f: Attachment['fabric']) {
  if (!f) return null;
  const fb = fabricById(f.id);
  return (fb.colors[f.color] ?? fb.colors[0]).hex;
}

function outlinePath(a: Attachment) {
  const pts = outlinePolygon(a.outline, a.w, a.h, a.points);
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  p.closePath();
  return p;
}

function drawAttachment(ctx: CanvasRenderingContext2D, a: Attachment, local: boolean, onHost: boolean, accent: string | null) {
  ctx.save();
  if (!local) { ctx.translate(a.x, a.y); ctx.rotate(rad(a.rotation)); }
  const fill = fabricHex(a.fabric);
  if ((a.kind === 'print' || onHost) && fill) {
    ctx.fillStyle = fill;
    ctx.fill(outlinePath(a));
  } else if (onHost && a.kind !== 'print') {
    // no cloth of its own yet: a faint edge so the shape still reads
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.12;
    ctx.stroke(outlinePath(a));
  }
  for (const l of a.layers) {
    ctx.save();
    ctx.translate(l.x, l.y);
    ctx.rotate(rad(l.rotation));
    if (l.flipX) ctx.scale(-1, 1);
    ctx.globalAlpha = l.opacity ?? 1;
    ctx.fillStyle = l.color;
    if (l.shape === 'text') {
      if (l.text) {
        ctx.font = `700 ${Math.max(0.5, l.h)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(l.text, 0, 0, Math.max(0.5, l.w));
      }
    } else {
      ctx.scale(l.w, l.h);
      ctx.fill(new Path2D(SHAPES[l.shape].d));
    }
    ctx.restore();
  }
  if (accent) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.22;
    ctx.stroke(outlinePath(a));
  }
  ctx.restore();
}

function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function attachmentAt(list: Attachment[], pieceId: string, x: number, y: number): Attachment | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (a.id === pieceId) return a; // hit on its own cloth panel
    if (a.pieceId !== pieceId) continue;
    const c = Math.cos(rad(-a.rotation)), s = Math.sin(rad(-a.rotation));
    const dx = x - a.x, dy = y - a.y;
    if (pointInPoly(c * dx - s * dy, s * dx + c * dy, outlinePolygon(a.outline, a.w, a.h, a.points))) return a;
  }
  return null;
}

export default function Prints({ geo, pat, visible }: { geo: THREE.BufferGeometry; pat: VertexPattern; visible: boolean }) {
  const { gl, camera, controls } = useThree();
  const attachments = useStore((s) => s.project.edits?.attachments);
  const sel = useStore((s) => s.selAttachment);
  const list = useMemo(() => attachments ?? [], [attachments]);
  const listRef = useRef(list);
  listRef.current = list;

  /* ---- per piece canvases and the decal mesh ---- */
  const bounds = useMemo(() => {
    const b: (Bounds & { x1: number; y1: number })[] = pat.pieceIds.map(() => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, w: 0, h: 0 }));
    for (let v = 0; v < pat.vPiece.length; v++) {
      const p = pat.vPiece[v];
      if (p === NONE || !b[p]) continue;
      const x = pat.vUV[v * 2], y = pat.vUV[v * 2 + 1];
      b[p].x0 = Math.min(b[p].x0, x); b[p].x1 = Math.max(b[p].x1, x); b[p].y0 = Math.min(b[p].y0, y); b[p].y1 = Math.max(b[p].y1, y);
    }
    for (const q of b) { q.w = Math.max(1, q.x1 - q.x0); q.h = Math.max(1, q.y1 - q.y0); }
    return b;
  }, [pat]);

  const rig = useMemo(() => {
    const n = pat.vPiece.length;
    const uv = new Float32Array(n * 2);
    for (let v = 0; v < n; v++) {
      const b = bounds[pat.vPiece[v]];
      if (!b) continue;
      uv[v * 2] = (pat.vUV[v * 2] - b.x0) / b.w;
      uv[v * 2 + 1] = (pat.vUV[v * 2 + 1] - b.y0) / b.h;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', geo.getAttribute('position'));
    g.setAttribute('normal', geo.getAttribute('normal'));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(geo.index);
    // one material per cloth panel: which face is outward decides the side
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const idx = geo.index!.array;
    const mats: THREE.MeshStandardMaterial[] = [];
    const groupPiece: number[] = [];
    geo.groups.forEach((gr) => {
      const pc = pat.vPiece[idx[gr.start]];
      if (pc === NONE) return;
      let cx = 0, cy = 0, cz = 0, cnt = 0;
      for (let i = gr.start; i < gr.start + gr.count; i++) { const v = idx[i]; cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); cnt++; }
      cx /= cnt; cy /= cnt; cz /= cnt;
      const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3();
      let vote = 0;
      for (let i = gr.start; i < gr.start + gr.count; i += 3) {
        A.fromBufferAttribute(pos, idx[i]); B.fromBufferAttribute(pos, idx[i + 1]); C.fromBufferAttribute(pos, idx[i + 2]);
        N.subVectors(C, B).cross(A.clone().sub(B)).normalize();
        vote += N.dot(A.add(B).add(C).multiplyScalar(1 / 3).sub(new THREE.Vector3(cx, cy, cz)).normalize());
      }
      const m = new THREE.MeshStandardMaterial({
        transparent: true, depthWrite: false, roughness: 0.85, side: vote >= 0 ? THREE.FrontSide : THREE.BackSide,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1, visible: false,
      });
      g.addGroup(gr.start, gr.count, mats.length);
      mats.push(m);
      groupPiece.push(pc);
    });
    const mesh = new THREE.Mesh(g, mats);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    const canvases = new Map<number, { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; sig: string }>();
    return { mesh, g, mats, groupPiece, canvases };
  }, [geo, pat, bounds]);

  useEffect(() => () => {
    rig.canvases.forEach((c) => c.tex.dispose());
    rig.mats.forEach((m) => m.dispose());
    rig.g.dispose();
  }, [rig]);

  // repaint pieces whose artwork changed
  useEffect(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    const hasPanel = new Set(pat.pieceIds);
    pat.pieceIds.forEach((pid, pi) => {
      const mine = list.filter((a) => a.id === pid || (a.pieceId === pid && (a.kind === 'print' || !hasPanel.has(a.id))));
      const art = mine.filter((a) => a.layers.length > 0 || a.id === sel || (a.kind === 'print' && a.fabric) || (a.id !== pid && a.kind !== 'print'));
      const sig = JSON.stringify([art, sel, accent]);
      let entry = rig.canvases.get(pi);
      if (!art.length && !entry) return;
      const b = bounds[pi];
      if (!b || !isFinite(b.x0)) return;
      if (!entry) {
        const k = Math.min(PX_PER_CM, MAX_PX / Math.max(b.w, b.h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(2, Math.ceil(b.w * k));
        canvas.height = Math.max(2, Math.ceil(b.h * k));
        const tex = new THREE.CanvasTexture(canvas);
        tex.flipY = false;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        entry = { canvas, tex, sig: '' };
        rig.canvases.set(pi, entry);
        rig.mats.forEach((m, gi) => { if (rig.groupPiece[gi] === pi) { m.map = tex; m.needsUpdate = true; } });
      }
      if (entry.sig === sig) return;
      entry.sig = sig;
      const ctx = entry.canvas.getContext('2d')!;
      const k = entry.canvas.width / b.w;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, entry.canvas.width, entry.canvas.height);
      ctx.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
      for (const a of art) {
        const own = a.id === pid;
        drawAttachment(ctx, a, own, !own && a.kind !== 'print', a.id === sel ? accent : null);
      }
      entry.tex.needsUpdate = true;
      rig.mats.forEach((m, gi) => { if (rig.groupPiece[gi] === pi) m.visible = art.length > 0; });
    });
  }, [rig, pat, bounds, list, sel]);

  /* ---- picking ---- */
  const hit = useMemo(() => {
    const ray = new THREE.Raycaster();
    const pick = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), W = new THREE.Vector3();
    return (clientX: number, clientY: number, skipOwn = false): ClothHit | null => {
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), camera);
      const own = skipOwn ? new Set(listRef.current.map((a) => a.id)) : null;
      for (const h of ray.intersectObject(pick, false)) {
        if (!h.face) continue;
        const { a, b, c } = h.face;
        const p = pat.vPiece[a];
        if (p === NONE) continue;
        const pid = pat.pieceIds[p];
        if (own?.has(pid)) continue;
        A.fromBufferAttribute(pos, a); B.fromBufferAttribute(pos, b); C.fromBufferAttribute(pos, c);
        if (!THREE.Triangle.getBarycoord(h.point, A, B, C, W)) continue;
        return {
          pieceId: pid,
          x: W.x * pat.vUV[a * 2] + W.y * pat.vUV[b * 2] + W.z * pat.vUV[c * 2],
          y: W.x * pat.vUV[a * 2 + 1] + W.y * pat.vUV[b * 2 + 1] + W.z * pat.vUV[c * 2 + 1],
        };
      }
      return null;
    };
  }, [geo, pat, gl, camera]);

  useEffect(() => {
    registerHitCloth((x, y) => hit(x, y, true));
    return () => registerHitCloth(null);
  }, [hit]);

  /* ---- drag to move, drop to add ---- */
  useEffect(() => {
    const el = gl.domElement;
    const orbit = controls as unknown as { enabled: boolean } | null;
    let drag: { id: string; pid: string; ox: number; oy: number; pointer: number } | null = null;
    let tap: { x: number; y: number } | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;

    const down = (e: PointerEvent) => {
      if (!visible || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const h = hit(e.clientX, e.clientY, false);
      const a = h ? attachmentAt(listRef.current, h.pieceId, h.x, h.y) : null;
      if (!h || !a) { tap = { x: e.clientX, y: e.clientY }; return; }
      const st = useStore.getState();
      if (st.selAttachment !== a.id) st.set({ selAttachment: a.id });
      st.commit();
      const onOwn = h.pieceId === a.id;
      drag = { id: a.id, pid: onOwn ? a.pieceId : h.pieceId, ox: onOwn ? 0 : a.x - h.x, oy: onOwn ? 0 : a.y - h.y, pointer: e.pointerId };
      if (orbit) orbit.enabled = false;
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.pointer) return;
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!drag || !last) return;
        const h = hit(last.clientX, last.clientY, true);
        if (!h) return;
        const same = h.pieceId === drag.pid;
        const x = h.x + (same ? drag.ox : 0), y = h.y + (same ? drag.oy : 0);
        const cur = listRef.current.find((a) => a.id === drag!.id);
        if (!cur || (cur.pieceId === h.pieceId && Math.abs(cur.x - x) < 0.05 && Math.abs(cur.y - y) < 0.05)) return;
        if (!same) { drag.pid = h.pieceId; drag.ox = 0; drag.oy = 0; }
        useStore.getState().updateAttachment(drag.id, { pieceId: h.pieceId, x, y });
      });
    };
    const up = (e: PointerEvent) => {
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) < 4 && useStore.getState().selAttachment) useStore.getState().set({ selAttachment: null });
      tap = null;
      if (drag && e.pointerId === drag.pointer) {
        drag = null;
        if (orbit) orbit.enabled = true;
        try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      }
    };
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes(ATTACH_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
    };
    const drop = (e: DragEvent) => {
      const raw = e.dataTransfer?.getData(ATTACH_MIME);
      if (!raw) return;
      e.preventDefault();
      const h = hit(e.clientX, e.clientY, true);
      if (!h) return;
      try {
        const p = JSON.parse(raw) as Omit<Attachment, 'id' | 'pieceId' | 'x' | 'y'>;
        if (typeof p.w !== 'number' || typeof p.h !== 'number' || !p.kind) return;
        useStore.getState().addAttachment({ ...p, rotation: p.rotation ?? 0, layers: p.layers ?? [], pieceId: h.pieceId, x: h.x, y: h.y });
      } catch { /* not ours */ }
    };
    // capture phase so we run before the orbit controls and can switch them off for this gesture
    el.addEventListener('pointerdown', down, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('dragover', over);
    el.addEventListener('drop', drop);
    return () => {
      el.removeEventListener('pointerdown', down, true);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('dragover', over);
      el.removeEventListener('drop', drop);
      if (frame) cancelAnimationFrame(frame);
      if (orbit) orbit.enabled = true;
    };
  }, [gl, controls, hit, visible]);

  return visible ? <primitive object={rig.mesh} /> : null;
}
