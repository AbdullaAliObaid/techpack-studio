import * as THREE from 'three';
import type { FinishStroke, GarmentFinish, WashPreset } from '../data/edits';
import { seedOf, strokePts, strokesFor } from '../data/finish';
import type { Pt } from '../lib/geometry';

// Wash and distress painted into a piece's canvases (pattern space, cm). The colour and texture go in the ink pass under
// any print; holes and rips are cut out of the ink and out of the cloth (an alpha map on the cloth materials, read from
// the same piece uv as the ink), with frayed threads around the rim in the thread pass.

export interface PieceFin { preset: WashPreset; ps: number; strokes: FinishStroke[] }

export function pieceFin(f: GarmentFinish | undefined, pieceId: string, instance: number): PieceFin | null {
  if (!f) return null;
  const strokes = strokesFor(f, pieceId, instance);
  if (f.preset === 'none' && !strokes.length) return null;
  return { preset: f.preset, ps: f.presetStrength ?? 1, strokes };
}

const mix = (hex: string, to: string, t: number) => { const a = new THREE.Color(hex), b = new THREE.Color(to); return '#' + a.lerp(b, Math.max(0, Math.min(1, t))).getHexString(); };
const rgba = (hex: string, a: number) => { const c = new THREE.Color(hex); return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${Math.max(0, Math.min(1, a))})`; };

function blob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hex: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(hex, a)); g.addColorStop(0.55, rgba(hex, a * 0.55)); g.addColorStop(1, rgba(hex, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** stamps along a stroke, spaced by a fraction of the radius */
function stamps(s: FinishStroke, every: number): { x: number; y: number; dx: number; dy: number }[] {
  const pts = strokePts(s), out: { x: number; y: number; dx: number; dy: number }[] = [];
  if (pts.length === 1) return [{ ...pts[0], dx: 1, dy: 0 }];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
    const n = Math.max(1, Math.ceil(L / every));
    for (let k = 0; k < n; k++) { const t = k / n; out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, dx: (b.x - a.x) / L, dy: (b.y - a.y) / L }); }
  }
  const e = pts[pts.length - 1], pr = pts[pts.length - 2];
  out.push({ ...e, dx: (e.x - pr.x) / (Math.hypot(e.x - pr.x, e.y - pr.y) || 1), dy: (e.y - pr.y) / (Math.hypot(e.x - pr.x, e.y - pr.y) || 1) });
  return out;
}

/** outline polygons of the cut openings (holes, rips) of a stroke list, in cm */
export function openings(strokes: FinishStroke[]): Pt[][] {
  const out: Pt[][] = [];
  strokes.forEach((s, si) => {
    if (s.k !== 'hole' && s.k !== 'rip') return;
    const rnd = seedOf(s, si);
    const pts = strokePts(s);
    if (s.k === 'hole') {
      const c = pts[0], n = 18, ph = rnd() * 6.28, sx = 0.85 + rnd() * 0.3;
      out.push(Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, rr = s.r * (0.78 + rnd() * 0.44); return { x: c.x + Math.cos(a + ph) * rr * sx, y: c.y + Math.sin(a + ph) * rr / sx }; }));
      return;
    }
    // rip: a lens along the path, widest in the middle, with a ragged edge
    const line = pts.length > 1 ? pts : [pts[0], { x: pts[0].x + s.r * 2, y: pts[0].y }];
    const w = Math.max(0.25, s.r * 0.45) * (0.5 + s.s * 0.7);
    const left: Pt[] = [], right: Pt[] = [];
    const total = line.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - line[i].x, p.y - line[i].y), 0) || 1;
    let run = 0;
    line.forEach((p, i) => {
      if (i) run += Math.hypot(p.x - line[i - 1].x, p.y - line[i - 1].y);
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L, taper = Math.sin(Math.PI * Math.min(1, Math.max(0.05, run / total)));
      const hw = (w / 2) * taper * (0.75 + rnd() * 0.5);
      left.push({ x: p.x + nx * hw, y: p.y + ny * hw }); right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
    });
    out.push([...left, ...right.reverse()]);
  });
  return out;
}

const poly = (ctx: CanvasRenderingContext2D, pts: Pt[]) => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };

/** colour and texture: the global wash, then every stroke */
export function drawFinishInk(ctx: CanvasRenderingContext2D, hex: string, fin: PieceFin, box: { x0: number; y0: number; w: number; h: number }) {
  ctx.save();
  const { x0, y0, w, h } = box;
  const ps = fin.ps;
  const rect = (col: string, a: number) => { ctx.fillStyle = rgba(col, a); ctx.fillRect(x0 - 1, y0 - 1, w + 2, h + 2); };
  const speckle = (n: number, col: string, a: number, seed: number) => {
    let s = seed; const r = () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
    ctx.fillStyle = rgba(col, a);
    for (let i = 0; i < n; i++) { const x = x0 + r() * w, y = y0 + r() * h, d = 0.04 + r() * 0.1; ctx.fillRect(x, y, d * (1 + r() * 2), d); }
  };
  switch (fin.preset) {
    case 'light': rect(mix(hex, '#ffffff', 0.7), 0.55 * ps); speckle(Math.min(2500, w * h * 0.5), mix(hex, '#ffffff', 0.85), 0.5 * ps, 11); break;
    case 'mid': rect(mix(hex, '#ffffff', 0.55), 0.28 * ps); speckle(Math.min(1800, w * h * 0.3), mix(hex, '#ffffff', 0.8), 0.35 * ps, 13); break;
    case 'dark': rect('#0a0f1c', 0.24 * ps); break;
    case 'vintage': rect(mix(hex, '#e9dcc0', 0.6), 0.4 * ps); speckle(Math.min(3000, w * h * 0.6), '#f4ecd8', 0.5 * ps, 17); break;
    default: break;
  }
  fin.strokes.forEach((s, si) => {
    const rnd = seedOf(s, si), st = s.s;
    const light = mix(hex, '#ffffff', 0.78), dark = mix(hex, '#05070d', 0.55);
    if (s.k === 'fade') for (const p of stamps(s, s.r * 0.4)) blob(ctx, p.x, p.y, s.r, mix(hex, '#ffffff', 0.6), 0.5 * st);
    else if (s.k === 'bleach') for (const p of stamps(s, s.r * 0.5)) for (let i = 0; i < 5; i++) blob(ctx, p.x + (rnd() - 0.5) * s.r, p.y + (rnd() - 0.5) * s.r, s.r * (0.35 + rnd() * 0.5), mix(hex, '#fff4e0', 0.9), (0.55 + rnd() * 0.4) * st);
    else if (s.k === 'acid') for (const p of stamps(s, s.r * 0.5)) for (let i = 0; i < 9; i++) {
      const x = p.x + (rnd() - 0.5) * s.r * 1.6, y = p.y + (rnd() - 0.5) * s.r * 1.6, rr = s.r * (0.15 + rnd() * 0.5);
      if (rnd() < 0.7) blob(ctx, x, y, rr, light, (0.55 + rnd() * 0.4) * st); else blob(ctx, x, y, rr * 0.8, dark, 0.4 * st);
    } else if (s.k === 'stone') for (const p of stamps(s, s.r * 0.6)) {
      blob(ctx, p.x, p.y, s.r, mix(hex, '#ffffff', 0.5), 0.14 * st);
      for (let i = 0; i < 26; i++) {
        const a = rnd() * 6.28, d = Math.sqrt(rnd()) * s.r, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d, ang = rnd() * 3.14;
        ctx.strokeStyle = rgba(light, (0.35 + rnd() * 0.5) * st); ctx.lineWidth = 0.04 + rnd() * 0.07; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * (0.12 + rnd() * 0.3), y + Math.sin(ang) * (0.12 + rnd() * 0.3)); ctx.stroke();
      }
    } else if (s.k === 'whiskers') for (const p of stamps(s, s.r * 0.7)) {
      // sanded crease lines fanning from the stamp, mostly across the stroke direction
      const base = Math.atan2(p.dy, p.dx) + Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const a = base + (rnd() - 0.5) * 0.9, L = s.r * (0.9 + rnd() * 0.9), ox = (rnd() - 0.5) * s.r * 0.8, oy = (rnd() - 0.5) * s.r * 0.8;
        const g = ctx.createLinearGradient(p.x + ox, p.y + oy, p.x + ox + Math.cos(a) * L, p.y + oy + Math.sin(a) * L);
        g.addColorStop(0, rgba(light, 0)); g.addColorStop(0.35, rgba(light, 0.7 * st)); g.addColorStop(1, rgba(light, 0));
        ctx.strokeStyle = g; ctx.lineWidth = 0.08 + rnd() * 0.16; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x + ox, p.y + oy); ctx.lineTo(p.x + ox + Math.cos(a) * L, p.y + oy + Math.sin(a) * L); ctx.stroke();
      }
    } else if (s.k === 'honeycomb') for (const p of stamps(s, s.r * 0.9)) {
      // short curved chevrons stacked behind the knee
      for (let i = -2; i <= 2; i++) {
        const cy = p.y + i * s.r * 0.28, cx = p.x + (rnd() - 0.5) * s.r * 0.3, wd = s.r * (0.55 + rnd() * 0.3);
        ctx.strokeStyle = rgba(light, (0.5 + rnd() * 0.3) * st); ctx.lineWidth = 0.1 + rnd() * 0.08; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(cx - wd, cy - s.r * 0.12); ctx.quadraticCurveTo(cx, cy + s.r * 0.18, cx + wd, cy - s.r * 0.12); ctx.stroke();
      }
    } else if (s.k === 'abrasion') for (const p of stamps(s, s.r * 0.5)) {
      blob(ctx, p.x, p.y, s.r, mix(hex, '#ffffff', 0.8), 0.55 * st);
      for (let i = 0; i < 30; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * s.r; ctx.fillStyle = rgba(rnd() < 0.5 ? '#ffffff' : dark, (0.4 + rnd() * 0.4) * st); ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 0.05 + rnd() * 0.08, 0.05); }
    } else if (s.k === 'fray') for (const p of stamps(s, 0.3)) blob(ctx, p.x, p.y, Math.max(0.5, s.r * 0.9), mix(hex, '#f3ead6', 0.7), 0.55 * st);
    else if (s.k === 'rip' || s.k === 'hole') {
      // worn rim around the opening
      for (const o of openings([s])) { poly(ctx, o); ctx.lineJoin = 'round'; ctx.strokeStyle = rgba(mix(hex, '#ffffff', 0.75), 0.8 * st + 0.1); ctx.lineWidth = 0.5; ctx.stroke(); }
    }
  });
  ctx.restore();
}

/** cut the openings out of the ink */
export function cutOpenings(ctx: CanvasRenderingContext2D, strokes: FinishStroke[]) {
  const o = openings(strokes);
  if (!o.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000';
  for (const p of o) { poly(ctx, p); ctx.fill(); }
  ctx.restore();
}

/** frayed threads: around every opening, across rips, and along fray strokes (colour and height contexts, cm space) */
export function drawFrayThreads(cc: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, hex: string, strokes: FinishStroke[]) {
  const thread = (x: number, y: number, ang: number, L: number, wd: number, rnd: () => number) => {
    const col = rgba(mix(hex, '#ffffff', 0.35 + rnd() * 0.45), 0.95);
    for (const [c, h] of [[cc, false], [hc, true]] as const) {
      c.strokeStyle = h ? '#ffffff' : col; c.lineWidth = wd; c.lineCap = 'round';
      c.beginPath(); c.moveTo(x, y);
      c.quadraticCurveTo(x + Math.cos(ang + 0.5 * (rnd() - 0.5)) * L * 0.5, y + Math.sin(ang + 0.5 * (rnd() - 0.5)) * L * 0.5, x + Math.cos(ang) * L, y + Math.sin(ang) * L);
      c.stroke();
    }
  };
  strokes.forEach((s, si) => {
    const rnd = seedOf(s, si + 100);
    if (s.k === 'hole' || s.k === 'rip') {
      const [o] = openings([s]);
      if (!o) return;
      const c = o.reduce((a, p) => ({ x: a.x + p.x / o.length, y: a.y + p.y / o.length }), { x: 0, y: 0 });
      // fibres lying out from the rim
      for (let i = 0; i < o.length * 3; i++) {
        const p = o[Math.floor(rnd() * o.length)], out = Math.atan2(p.y - c.y, p.x - c.x);
        thread(p.x, p.y, out + (rnd() - 0.5) * 1.2, 0.2 + rnd() * 0.55 * (0.5 + s.s), 0.025 + rnd() * 0.04, rnd);
      }
      // loose threads bridging the opening
      for (let i = 0; i < 4 + Math.round(s.s * 4); i++) {
        const a = o[Math.floor(rnd() * o.length)], b = o[Math.floor(rnd() * o.length)];
        for (const [cx, h] of [[cc, false], [hc, true]] as const) {
          cx.strokeStyle = h ? '#ffffff' : rgba(mix(hex, '#ffffff', 0.3 + rnd() * 0.4), 0.95); cx.lineWidth = 0.03 + rnd() * 0.03;
          cx.beginPath(); cx.moveTo(a.x, a.y); cx.lineTo(b.x + (rnd() - 0.5) * 0.1, b.y); cx.stroke();
        }
      }
    } else if (s.k === 'fray') {
      for (const p of stamps(s, 0.12)) { const nx = -p.dy, ny = p.dx, side = rnd() < 0.5 ? 1 : -1; thread(p.x, p.y, Math.atan2(ny * side, nx * side) + (rnd() - 0.5) * 0.8, 0.3 + rnd() * s.r * (0.6 + s.s), 0.025 + rnd() * 0.035, rnd); }
    }
  });
}

/* ---------- holes in the cloth: an alpha map per panel, read from the cloth's second uv set ---------- */

const holeTex = new Map<number, THREE.CanvasTexture>();
let holeVersion = 0;
const subs = new Set<() => void>();
export const subscribeHoles = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const holesVersion = () => holeVersion;
const bump = () => { holeVersion++; subs.forEach((f) => f()); };

/** set (or with null clear) the hole map of a panel; the canvas is white where cloth is, black where it is cut */
export function setHoles(panel: number, canvas: HTMLCanvasElement | null, strokes: FinishStroke[], box: { x0: number; y0: number; w: number; h: number }) {
  const had = holeTex.get(panel);
  if (!canvas) { if (had) { had.dispose(); holeTex.delete(panel); bump(); } return; }
  const g = canvas.getContext('2d')!;
  const k = canvas.width / box.w;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.setTransform(k, 0, 0, k, -box.x0 * k, -box.y0 * k); g.fillStyle = '#000';
  for (const p of openings(strokes)) { poly(g, p); g.fill(); }
  if (had && had.image === canvas) { had.needsUpdate = true; bump(); return; }
  const t = new THREE.CanvasTexture(canvas);
  t.flipY = false; t.channel = 1; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  had?.dispose();
  holeTex.set(panel, t);
  bump();
}

const clones = new Map<THREE.Material, THREE.Material>();
/** cloth materials with the holes cut: clones of the panels that have a hole map (the shared originals stay as they are) */
export function withHoles(mats: THREE.Material[]): THREE.Material[] {
  return mats.map((m, i) => {
    const t = holeTex.get(i);
    if (!t || !(m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
    const c = m.clone() as THREE.MeshStandardMaterial;
    c.alphaMap = t; c.alphaTest = 0.5; c.userData = { ...m.userData };
    clones.set(c, m);
    return c;
  });
}
