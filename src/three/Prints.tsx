import { useEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
const THREE_COLOR = THREE.Color;
import { useStore } from '../store';
import type { Attachment, ShapeLayer } from '../data/edits';
import { fabricById } from '../data/fabrics';
import { SHAPES, outlinePolygon } from '../lib/shapes';
import { attachmentRings } from '../lib/trims';
import { registerHitCloth, type ClothHit } from './hitCloth';
import { NONE, type VertexPattern } from './printsAdapter';
import { applyLook, cottonTile, grainTile, labelLook, sheenLook, weaveTile, type LabelLook } from './detailsLook';

// Attachment artwork on the draped cloth, plus picking and dragging in 3D.
// Artwork is painted per placed cloth panel into canvases in pattern space (cm to pixels), so a left and a right copy
// of a piece each get their own artwork (an attachment with `instance` only shows on that copy). A decal mesh shares
// the cloth's position and index buffers (so it deforms with the cloth) and samples those canvases through its own uv.
// The decal is lifted a hair along the outward normal in the vertex shader and uses polygon offset, and only the
// outside faces are drawn, so it neither z-fights nor shows through the cloth. Cloth attachments with their own
// simulated panel are painted on that panel (above the pocket or applique cloth), otherwise on the host piece.
//   print:      flat ink
//   embroidery: raised satin stitch (thread colour + height map), outline stitch
// Two faces: every cloth panel has an outside and an inside layer set. Artwork with Attachment.face 'inside' is drawn
// only on the inside layers (opposite side, lifted the other way, artwork mirrored so it reads from the inside),
// 'outside' (default) only on the outside layers. Attachment panels follow the same rule through their own face.
// Sheen (Attachment.sheen) sets the material gloss of the layer: glossy ink gets a clear coat and a soft puff,
// embroidery thread can be metallic. Labels (kind 'label') are painted in the thread pass with weave / grain / moulded
// relief by tag type (src/three/detailsLook.ts); their cloth comes from ClothView when the sim has a panel for them,
// else they are painted on the host at their position.
// Panels whose pattern x runs the other way round (left copies) get their artwork flipped so text reads correctly.

export const ATTACH_MIME = 'application/x-techit-attachment';
const MAX_PX = 1536;
const PX_PER_CM = 10;
const THREAD_PX_MAX = 2048;
const THREAD_PX_CM = 22;
const INK_LIFT = 0.03; // cm along the outward normal
const THREAD_LIFT = 0.07;
const rad = (d: number) => (d * Math.PI) / 180;

interface Bounds { x0: number; y0: number; w: number; h: number }

function fabricHex(f: Attachment['fabric']) {
  if (!f) return null;
  const fb = fabricById(f.id);
  return (fb.colors[f.color] ?? fb.colors[0]).hex;
}

function outlinePath(a: Attachment) {
  const p = new Path2D();
  for (const pts of attachmentRings(a)) {
    pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.closePath();
  }
  return p;
}

/* ---------- colour helpers ---------- */
function rgbOf(css: string): [number, number, number] {
  const c = document.createElement('canvas').getContext('2d')!;
  c.fillStyle = css;
  const v = c.fillStyle as string; // normalised to #rrggbb or rgba()
  if (v.startsWith('#')) return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
  const m = v.match(/[\d.]+/g) ?? ['0', '0', '0'];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}
const shade = (rgb: [number, number, number], f: number) => `rgb(${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v * f)))).join(',')})`;

/** Ink pass: fabric, flat artwork, selection outline. Draws into the piece (or attachment local) coordinate system. */
function drawInk(ctx: CanvasRenderingContext2D, a: Attachment, local: boolean, onHost: boolean, accent: string | null, flip: boolean) {
  ctx.save();
  if (!local) { ctx.translate(a.x, a.y); ctx.rotate(rad(a.rotation)); }
  if (flip) ctx.scale(-1, 1);
  const fill = fabricHex(a.fabric);
  if ((a.kind === 'print' || onHost) && fill && a.kind !== 'embroidery' && a.kind !== 'hardware' && a.kind !== 'label') {
    ctx.fillStyle = fill;
    ctx.fill(outlinePath(a));
  } else if (onHost && a.kind !== 'print' && a.kind !== 'embroidery' && a.kind !== 'hardware' && a.kind !== 'label') {
    // no cloth of its own yet: a faint edge so the shape still reads
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.12;
    ctx.stroke(outlinePath(a));
  }
  if (a.kind !== 'embroidery' && a.kind !== 'label') {
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
  }
  if (accent) {
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 0.22;
    ctx.stroke(outlinePath(a));
  }
  ctx.restore();
}

const mkCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  return c;
};

/**
 * One embroidered layer as raised satin stitch: parallel thread lines across the shape (light sheen along each line,
 * darker thread in the gaps), a fine dashed outline stitch, and a height map for the bump. Painted in a small scratch
 * canvas in the layer's own frame, then stamped into the thread colour and height canvases.
 */
function stitchLayer(col: CanvasRenderingContext2D, hgt: CanvasRenderingContext2D, l: ShapeLayer, k: number, outline: string | undefined, seed: number) {
  const w = Math.max(0.4, l.w), h = Math.max(0.4, l.h), pad = 0.3;
  const W = (w + 2 * pad) * k, H = (h + 2 * pad) * k;
  const sc = mkCanvas(W, H), sh = mkCanvas(W, H);
  const c = sc.getContext('2d')!, g = sh.getContext('2d')!;
  const kx = sc.width / (w + 2 * pad), ky = sc.height / (h + 2 * pad);
  for (const x of [c, g]) x.setTransform(kx, 0, 0, ky, (w / 2 + pad) * kx, (h / 2 + pad) * ky);
  const base = rgbOf(l.color);
  const pitch = 0.11, R = Math.hypot(w, h) / 2 + pad;
  // stitches run across the narrow side; compact shapes and letters get a diagonal fill
  const ang = l.shape === 'text' ? rad(28) : w >= h * 1.3 ? 0 : h >= w * 1.3 ? rad(90) : rad(35);
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);
  c.save();
  c.rotate(ang);
  c.fillStyle = shade(base, 0.62); // thread in the gaps
  c.fillRect(-R, -R, 2 * R, 2 * R);
  g.save();
  g.rotate(ang);
  g.fillStyle = 'rgb(70,70,70)';
  g.fillRect(-R, -R, 2 * R, 2 * R);
  for (let t = -R; t <= R; t += pitch) {
    const f = 0.88 + rand() * 0.24;
    const gr = c.createLinearGradient(t, -R, t, R);
    gr.addColorStop(0, shade(base, f * 0.86));
    gr.addColorStop(0.5, shade(base, f * 1.18));
    gr.addColorStop(1, shade(base, f * 0.86));
    c.strokeStyle = gr;
    c.lineWidth = pitch * 0.82;
    c.beginPath(); c.moveTo(t, -R); c.lineTo(t, R); c.stroke();
    g.strokeStyle = `rgb(${200 + Math.round(rand() * 45)},${200},${200})`;
    g.lineWidth = pitch * 0.78;
    g.beginPath(); g.moveTo(t, -R); g.lineTo(t, R); g.stroke();
  }
  c.restore();
  g.restore();
  // cut to the shape
  const shapeFill = (x: CanvasRenderingContext2D) => {
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = '#000';
    if (l.shape === 'text') {
      x.font = `700 ${Math.max(0.5, l.h)}px system-ui, sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(l.text ?? '', 0, 0, w);
    } else {
      x.save(); x.scale(l.w, l.h); x.fill(new Path2D(SHAPES[l.shape].d)); x.restore();
    }
    x.globalCompositeOperation = 'source-over';
  };
  shapeFill(c); shapeFill(g);
  // fine outline stitch
  const o = outline || shade(base, 0.7);
  const stroke = (x: CanvasRenderingContext2D, style: string) => {
    x.save();
    x.strokeStyle = style;
    x.lineWidth = 0.075;
    x.setLineDash([0.16, 0.045]);
    x.lineCap = 'round';
    if (l.shape === 'text') { x.font = `700 ${Math.max(0.5, l.h)}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.strokeText(l.text ?? '', 0, 0, w); }
    else { x.scale(l.w, l.h); x.lineWidth = 0.075 / Math.max(l.w, l.h); x.setLineDash([0.16 / Math.max(l.w, l.h), 0.045 / Math.max(l.w, l.h)]); x.stroke(new Path2D(SHAPES[l.shape].d)); }
    x.restore();
  };
  stroke(c, o);
  stroke(g, 'rgb(255,255,255)');
  // stamp into the panel canvases (their transform is cm space, already moved to the layer frame by the caller)
  for (const [dst, src] of [[col, sc], [hgt, sh]] as const) {
    dst.save();
    dst.globalAlpha = l.opacity ?? 1;
    dst.drawImage(src, -(w / 2 + pad), -(h / 2 + pad), w + 2 * pad, h + 2 * pad);
    dst.restore();
  }
}

/** Thread pass: embroidery layers as satin stitch. */
function drawThread(col: CanvasRenderingContext2D, hgt: CanvasRenderingContext2D, a: Attachment, local: boolean, flip: boolean, k: number) {
  if (a.kind !== 'embroidery') return;
  a.layers.forEach((l, i) => {
    for (const x of [col, hgt]) {
      x.save();
      if (!local) { x.translate(a.x, a.y); x.rotate(rad(a.rotation)); }
      if (flip) x.scale(-1, 1);
      x.translate(l.x, l.y);
      x.rotate(rad(l.rotation));
      if (l.flipX) x.scale(-1, 1);
    }
    // the stamp draws into both canvases, whose transforms were set the same way above
    stitchLayer(col, hgt, l, k, a.thread, 1234 + i * 977);
    col.restore();
    hgt.restore();
  });
}


/** one layer path in the current (cm) transform */
function fillLayer(ctx: CanvasRenderingContext2D, l: ShapeLayer, fill: string | CanvasPattern) {
  ctx.save();
  ctx.translate(l.x, l.y);
  ctx.rotate(rad(l.rotation));
  if (l.flipX) ctx.scale(-1, 1);
  ctx.globalAlpha *= l.opacity ?? 1;
  ctx.fillStyle = fill;
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

const tintCache = new Map<string, HTMLCanvasElement>();
/** a tile multiplied into a colour, for thread of that colour woven in */
function tinted(tile: HTMLCanvasElement, color: string) {
  const key = color + tile.width;
  let c = tintCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = tile.width;
    const g = c.getContext('2d')!;
    g.fillStyle = color; g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55; g.drawImage(tile, 0, 0);
    tintCache.set(key, c);
  }
  return c;
}

const TILE: Record<NonNullable<LabelLook['tile']>, () => HTMLCanvasElement> = { weave: weaveTile, grain: grainTile, cotton: cottonTile };

/** a repeating tile as a pattern in cm space: `perCm` tiles per cm */
function tilePattern(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, perCm: number) {
  const p = ctx.createPattern(tile, 'repeat')!;
  p.setTransform(new DOMMatrix().scale(1 / (perCm * tile.width)));
  return p;
}

/**
 * Tag pass: colour and height canvases of a clothing tag. Base (only when painted on the host, its own cloth panel
 * already has the tag material): tag colour, weave / grain relief, a thick slab for rubber and leather. Artwork:
 * woven = thread coloured with the weave through it, ink = flat, raised = moulded (rubber), debossed = pressed in (leather).
 */
function drawLabel(col: CanvasRenderingContext2D, hgt: CanvasRenderingContext2D, a: Attachment, local: boolean, onHost: boolean, flip: boolean) {
  const look = labelLook(a.label, a.sheen);
  const tile = look.tile ? TILE[look.tile]() : null;
  for (const x of [col, hgt]) {
    x.save();
    if (!local) { x.translate(a.x, a.y); x.rotate(rad(a.rotation)); }
    if (flip) x.scale(-1, 1);
  }
  const path = outlinePath(a);
  if (onHost) {
    col.fillStyle = a.label?.color ?? '#f2efe6';
    col.fill(path);
    hgt.save();
    hgt.clip(path);
    if (tile) { hgt.fillStyle = tilePattern(hgt, tile, look.tilesPerCm); hgt.fillRect(-60, -60, 120, 120); }
    hgt.restore();
    if (tile && look.tile !== 'cotton') {
      col.save(); col.clip(path); col.globalCompositeOperation = 'multiply'; col.globalAlpha = look.tile === 'weave' ? 0.5 : 0.4;
      col.fillStyle = tilePattern(col, tile, look.tilesPerCm); col.fillRect(-60, -60, 120, 120); col.restore();
    }
    if (look.thickness > 0.1) {
      // thick tag: a raised slab with a rounded edge
      hgt.save(); hgt.shadowColor = '#fff'; hgt.shadowBlur = 5; hgt.fillStyle = look.art === 'raised' ? '#ccc' : '#aaa'; hgt.fill(path); hgt.restore();
    }
  }
  a.layers.forEach((l) => {
    col.save();
    if (look.art === 'debossed') {
      const dark = new THREE_COLOR(l.color).multiplyScalar(0.55);
      fillLayer(col, l, `rgb(${Math.round(dark.r * 255)},${Math.round(dark.g * 255)},${Math.round(dark.b * 255)})`);
    } else if (look.art === 'woven' && tile) fillLayer(col, l, tilePattern(col, tinted(tile, l.color), look.tilesPerCm * 1.6));
    else fillLayer(col, l, l.color);
    col.restore();
    hgt.save();
    if (look.art === 'raised') { hgt.shadowColor = '#fff'; hgt.shadowBlur = 4; fillLayer(hgt, l, '#fff'); }
    else if (look.art === 'debossed') fillLayer(hgt, l, '#000');
    else if (look.art === 'woven' && tile) fillLayer(hgt, l, tilePattern(hgt, tile, look.tilesPerCm * 1.6));
    hgt.restore();
  });
  col.restore();
  hgt.restore();
}

function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function attachmentAt(list: Attachment[], pieceId: string, instance: number, x: number, y: number): Attachment | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i];
    if (a.id === pieceId) return a; // hit on its own cloth panel
    if (a.pieceId !== pieceId) continue;
    if (a.instance !== undefined && a.instance !== instance) continue;
    const c = Math.cos(rad(-a.rotation)), s = Math.sin(rad(-a.rotation));
    const dx = x - a.x, dy = y - a.y;
    if (pointInPoly(c * dx - s * dy, s * dx + c * dy, outlinePolygon(a.outline, a.w, a.h, a.points))) return a;
  }
  return null;
}

/** make a material draw a hair above the cloth along the outward normal (sgn = +1 when the front faces are outside) */
function lifted(m: THREE.Material, lift: number, sgn: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLift = { value: lift * sgn };
    sh.vertexShader = 'uniform float uLift;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * uLift;');
  };
  m.customProgramCacheKey = () => 'decal-lift';
}

interface Slot { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture; sig: string; hgt?: HTMLCanvasElement; hgtTex?: THREE.CanvasTexture }
interface ThreadSlot { col: HTMLCanvasElement; hgt: HTMLCanvasElement; colTex: THREE.CanvasTexture; hgtTex: THREE.CanvasTexture; sig: string; k: number }

export default function Prints({ geo, pat, visible }: { geo: THREE.BufferGeometry; pat: VertexPattern; visible: boolean }) {
  const { gl, camera, controls } = useThree();
  const attachments = useStore((s) => s.project.edits?.attachments);
  const sel = useStore((s) => s.selAttachment);
  const list = useMemo(() => attachments ?? [], [attachments]);
  const listRef = useRef(list);
  listRef.current = list;

  /* ---- per piece bounds, per panel canvases and the decal mesh ---- */
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
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const idx = geo.index!.array;
    // two faces per cloth panel, two materials per face (ink, thread). The outside layers show on the outward side
    // (front faces where the cloth's front is outward, back faces where it is not) and lift along the outward normal;
    // the inside layers show on the other side and lift the other way.
    type Face = 'outside' | 'inside';
    const inkMats: THREE.MeshPhysicalMaterial[] = [], threadMats: THREE.MeshPhysicalMaterial[] = [];
    const panelOf: number[] = []; // per entry: panel (geometry group material index)
    const faceOf: Face[] = [];
    const mats: THREE.Material[] = [];
    const voteFront = (gr: { start: number; count: number }) => {
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
      return vote >= 0 ? 1 : -1;
    };
    geo.groups.forEach((gr) => {
      const pc = pat.vPiece[idx[gr.start]];
      if (pc === NONE) return;
      const panel = gr.materialIndex ?? 0;
      const f = pat.panels?.[panel]?.front;
      const front = f ? (f > 0 ? 1 : -1) : voteFront(gr);
      for (const face of ['outside', 'inside'] as Face[]) {
        const out = face === 'outside';
        const sgn = out ? front : -front; // lift direction along the geometry normal
        const side = sgn > 0 ? THREE.FrontSide : THREE.BackSide;
        const ink = new THREE.MeshPhysicalMaterial({
          transparent: true, depthWrite: false, roughness: 0.85, side, visible: false,
          polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
        lifted(ink, INK_LIFT, sgn);
        const thread = new THREE.MeshPhysicalMaterial({
          transparent: true, depthWrite: false, roughness: 0.42, side, visible: false, bumpScale: 2.2,
          sheen: 1, sheenRoughness: 0.35, sheenColor: new THREE.Color('#ffffff'),
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
        });
        lifted(thread, THREAD_LIFT, sgn);
        g.addGroup(gr.start, gr.count, mats.length);
        mats.push(ink); inkMats.push(ink); panelOf.push(panel); faceOf.push(face);
        g.addGroup(gr.start, gr.count, mats.length);
        mats.push(thread); threadMats.push(thread);
      }
    });
    const mesh = new THREE.Mesh(g, mats);
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    mesh.receiveShadow = true;
    const ink = new Map<number, Slot>();
    const thread = new Map<number, ThreadSlot>();
    return { mesh, g, mats, inkMats, threadMats, panelOf, faceOf, ink, thread };
  }, [geo, pat, bounds]);

  useEffect(() => () => {
    rig.ink.forEach((c) => { c.tex.dispose(); c.hgtTex?.dispose(); });
    rig.thread.forEach((c) => { c.colTex.dispose(); c.hgtTex.dispose(); });
    rig.mats.forEach((m) => m.dispose());
    rig.g.dispose();
  }, [rig]);

  // repaint panels whose artwork changed
  useEffect(() => {
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#007aff';
    const hasPanel = new Set((pat.panels ?? []).map((q) => q.attachId).filter(Boolean) as string[]);
    if (!pat.panels) for (const a of list) if (pat.pieceIds.includes(a.id)) hasPanel.add(a.id);
    rig.panelOf.forEach((panel, e) => {
      const face = rig.faceOf[e];
      const slotKey = panel * 2 + (face === 'inside' ? 1 : 0);
      const info = pat.panels?.[panel];
      const pi = info?.pieceIndex ?? pat.vPiece[rig.g.index!.array[rig.g.groups[e * 2].start]];
      const pid = pat.pieceIds[pi];
      const instance = info?.instance ?? 0;
      // seen from the inside the pattern runs the other way round, so artwork is mirrored once more to read correctly there
      const flip = (info?.flip ?? false) !== (face === 'inside');
      const own = info?.attachId ?? (hasPanel.has(pid) ? pid : undefined);
      const mine = list.filter((a) => {
        if ((a.face ?? 'outside') !== face) return false;
        if (own) return a.id === own || (a.pieceId === own && (a.kind === 'print' || a.kind === 'embroidery'));
        if (a.pieceId !== pid) return false;
        if (a.instance !== undefined && a.instance !== instance) return false;
        if (a.kind === 'print' || a.kind === 'embroidery') return true;
        if (a.kind === 'hardware') return a.id === sel;
        return !hasPanel.has(a.id);
      });
      const art = mine.filter((a) => a.layers.length > 0 || a.id === sel || (a.kind === 'print' && a.fabric) || a.kind === 'label' || (a.id !== own && a.kind !== 'print' && a.kind !== 'embroidery' && a.kind !== 'hardware'));
      const b = bounds[pi];
      if (!b || !isFinite(b.x0)) return;
      const inkArt = art.filter((a) => (a.kind !== 'embroidery' && a.kind !== 'label') || a.id === sel);
      const threadArt = art.filter((a) => (a.kind === 'embroidery' && a.layers.length > 0) || a.kind === 'label');
      const inkMat = rig.inkMats[e], threadMat = rig.threadMats[e];

      /* ink */
      const sig = JSON.stringify([inkArt, sel, accent, flip, own]);
      let slot = rig.ink.get(slotKey);
      if (inkArt.length || slot) {
        // gloss follows the last print that names a sheen; a glossy print also puffs up a little
        const sh = [...inkArt].reverse().find((a) => a.kind === 'print' && a.sheen)?.sheen;
        const puff = sh === 'glossy';
        if (!slot) {
          const k = Math.min(PX_PER_CM, MAX_PX / Math.max(b.w, b.h));
          const canvas = mkCanvas(b.w * k, b.h * k);
          const tex = new THREE.CanvasTexture(canvas);
          tex.flipY = false;
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          slot = { canvas, tex, sig: '' };
          rig.ink.set(slotKey, slot);
          inkMat.map = tex;
          inkMat.needsUpdate = true;
        }
        if (slot.sig !== sig) {
          slot.sig = sig;
          const ctx = slot.canvas.getContext('2d')!;
          const k = slot.canvas.width / b.w;
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.clearRect(0, 0, slot.canvas.width, slot.canvas.height);
          ctx.setTransform(k, 0, 0, k, -b.x0 * k, -b.y0 * k);
          for (const a of inkArt) drawInk(ctx, a, a.id === own, a.id !== own && a.kind !== 'print', a.id === sel ? accent : null, flip);
          slot.tex.needsUpdate = true;
          inkMat.visible = inkArt.length > 0;
          applyLook(inkMat, { ...sheenLook(sh, false), roughness: sh ? sheenLook(sh, false).roughness : 0.85 });
          if (puff) {
            if (!slot.hgt) { slot.hgt = mkCanvas(slot.canvas.width, slot.canvas.height); slot.hgtTex = new THREE.CanvasTexture(slot.hgt); slot.hgtTex.flipY = false; }
            const hc = slot.hgt.getContext('2d')!;
            hc.setTransform(1, 0, 0, 1, 0, 0);
            hc.fillStyle = '#000'; hc.fillRect(0, 0, slot.hgt.width, slot.hgt.height);
            hc.filter = 'blur(2.5px) brightness(0) invert(1)';
            hc.drawImage(slot.canvas, 0, 0);
            hc.filter = 'none';
            slot.hgtTex!.needsUpdate = true;
            inkMat.bumpMap = slot.hgtTex!; inkMat.bumpScale = 2.4;
          } else inkMat.bumpMap = null;
          inkMat.needsUpdate = true;
        }
      }

      /* thread */
      const tsig = JSON.stringify([threadArt, flip, own]);
      let ts = rig.thread.get(slotKey);
      if (threadArt.length || ts) {
        const k = Math.min(THREAD_PX_CM, THREAD_PX_MAX / Math.max(b.w, b.h));
        if (!ts) {
          const col = mkCanvas(b.w * k, b.h * k), hgt = mkCanvas(b.w * k, b.h * k);
          const colTex = new THREE.CanvasTexture(col), hgtTex = new THREE.CanvasTexture(hgt);
          for (const t of [colTex, hgtTex]) { t.flipY = false; t.anisotropy = 8; }
          colTex.colorSpace = THREE.SRGBColorSpace;
          ts = { col, hgt, colTex, hgtTex, sig: '', k };
          rig.thread.set(slotKey, ts);
          threadMat.map = colTex;
          threadMat.bumpMap = hgtTex;
          threadMat.needsUpdate = true;
        }
        if (ts.sig !== tsig) {
          ts.sig = tsig;
          const cc = ts.col.getContext('2d')!, hc = ts.hgt.getContext('2d')!;
          const kk = ts.col.width / b.w;
          for (const x of [cc, hc]) { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, ts.col.width, ts.col.height); }
          hc.fillStyle = '#000'; hc.fillRect(0, 0, ts.hgt.width, ts.hgt.height);
          for (const x of [cc, hc]) x.setTransform(kk, 0, 0, kk, -b.x0 * kk, -b.y0 * kk);
          for (const a of threadArt) {
            if (a.kind === 'label') drawLabel(cc, hc, a, a.id === own, a.id !== own, flip);
            else drawThread(cc, hc, a, a.id === own, flip, kk);
          }
          ts.colTex.needsUpdate = true;
          ts.hgtTex.needsUpdate = true;
          threadMat.visible = threadArt.length > 0;
          // material look: a tag by its type, thread by its sheen (default satin stitch)
          const lab = threadArt.find((a) => a.kind === 'label');
          if (lab) {
            const look = labelLook(lab.label, lab.sheen);
            applyLook(threadMat, look);
            threadMat.bumpScale = Math.max(look.bump, look.art === 'raised' ? 1.6 : 0.8);
          } else {
            const sh = [...threadArt].reverse().find((a) => a.sheen)?.sheen;
            if (sh) { const l = sheenLook(sh, false); applyLook(threadMat, { ...l, sheen: sh === 'matte' ? 0.3 : l.sheen || 1 }); }
            else applyLook(threadMat, { roughness: 0.42, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 1, envMapIntensity: 1 });
            threadMat.bumpScale = 2.2;
          }
        }
      }
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
        const panel = pat.vPanel ? pat.panels?.[pat.vPanel[a]] : undefined;
        return {
          pieceId: pid,
          instance: panel?.instance ?? 0,
          copies: pat.copies?.[p] ?? 1,
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
    // an instance only matters for a piece that is cut more than once
    const instOf = (h: ClothHit) => (h.copies > 1 ? h.instance : undefined);

    const down = (e: PointerEvent) => {
      if (!visible || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const h = hit(e.clientX, e.clientY, false);
      const a = h ? attachmentAt(listRef.current, h.pieceId, h.instance, h.x, h.y) : null;
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
        const instance = instOf(h);
        if (!cur || (cur.pieceId === h.pieceId && cur.instance === instance && Math.abs(cur.x - x) < 0.05 && Math.abs(cur.y - y) < 0.05)) return;
        if (!same) { drag.pid = h.pieceId; drag.ox = 0; drag.oy = 0; }
        // dragging from the right leg to the left leg switches the side
        useStore.getState().updateAttachment(drag.id, { pieceId: h.pieceId, x, y, instance });
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
        useStore.getState().addAttachment({ ...p, rotation: p.rotation ?? 0, layers: p.layers ?? [], pieceId: h.pieceId, x: h.x, y: h.y, instance: instOf(h) });
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
