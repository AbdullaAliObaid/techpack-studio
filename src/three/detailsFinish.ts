import * as THREE from 'three';
import type { FinishStroke, GarmentFinish, WashPreset } from '../data/edits';
import { seedOf, strokePts, strokesFor } from '../data/finish';
import type { Pt } from '../lib/geometry';
import { buildWashInfo, paintWash, type WashInfo } from './detailsWash';

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
    if (s.k !== 'hole' && s.k !== 'rip' && s.k !== 'pinhole') return;
    const rnd = seedOf(s, si);
    const pts = strokePts(s);
    if (s.k === 'hole' || s.k === 'pinhole') {
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

/** colour and texture: the global wash and wash brushes from noise (detailsWash.ts), then the hand marks. Returns the wash overlay. */
export function drawFinishInk(ctx: CanvasRenderingContext2D, hex: string, fin: PieceFin, box: { x0: number; y0: number; w: number; h: number }, info?: WashInfo): HTMLCanvasElement | null {
  ctx.save();
  const layer = info ? paintWash(ctx, hex, fin, box, info) : null;
  const dk = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l < 0.3;
  fin.strokes.forEach((s, si) => {
    const rnd = seedOf(s, si), st = s.s;
    const light = mix(hex, '#ffffff', dk ? 0.6 : 0.78), dark = mix(hex, '#05070d', 0.55);
    if (s.k === 'whiskers') for (const p of stamps(s, s.r * 0.6)) {
      // sanded crease lines fanning from the stamp, mostly across the stroke direction, a darker crease beside each
      const base = Math.atan2(p.dy, p.dx) + Math.PI / 2;
      for (let i = 0; i < 9; i++) {
        const a = base + (rnd() - 0.5) * 0.8, L = s.r * (0.8 + rnd() * 1.1), ox = (rnd() - 0.5) * s.r * 1.1, oy = (rnd() - 0.5) * s.r * 1.1;
        const x1 = p.x + ox + Math.cos(a) * L, y1 = p.y + oy + Math.sin(a) * L;
        const g = ctx.createLinearGradient(p.x + ox, p.y + oy, x1, y1);
        g.addColorStop(0, rgba(light, 0)); g.addColorStop(0.3, rgba(light, 0.75 * st)); g.addColorStop(0.7, rgba(light, 0.5 * st)); g.addColorStop(1, rgba(light, 0));
        ctx.strokeStyle = rgba(dark, 0.22 * st); ctx.lineWidth = 0.1 + rnd() * 0.12; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(p.x + ox + 0.07, p.y + oy); ctx.lineTo(x1 + 0.07, y1); ctx.stroke();
        ctx.strokeStyle = g; ctx.lineWidth = 0.07 + rnd() * 0.18;
        ctx.beginPath(); ctx.moveTo(p.x + ox, p.y + oy); ctx.lineTo(x1, y1); ctx.stroke();
      }
    } else if (s.k === 'honeycomb') for (const p of stamps(s, s.r * 0.9)) {
      // stacked curved ridges behind the knee: a light crest with a dark side
      for (let i = -3; i <= 3; i++) {
        const cy = p.y + i * s.r * 0.22, cx = p.x + (rnd() - 0.5) * s.r * 0.3, wd = s.r * (0.5 + rnd() * 0.35) * (1 - Math.abs(i) * 0.1);
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(dark, 0.3 * st); ctx.lineWidth = 0.16 + rnd() * 0.08;
        ctx.beginPath(); ctx.moveTo(cx - wd, cy - s.r * 0.1 + 0.1); ctx.quadraticCurveTo(cx, cy + s.r * 0.2 + 0.1, cx + wd, cy - s.r * 0.1 + 0.1); ctx.stroke();
        ctx.strokeStyle = rgba(light, (0.5 + rnd() * 0.3) * st); ctx.lineWidth = 0.1 + rnd() * 0.08;
        ctx.beginPath(); ctx.moveTo(cx - wd, cy - s.r * 0.1); ctx.quadraticCurveTo(cx, cy + s.r * 0.2, cx + wd, cy - s.r * 0.1); ctx.stroke();
      }
    } else if (s.k === 'abrasion' || s.k === 'elbow') for (const p of stamps(s, s.r * 0.5)) {
      for (let i = 0; i < 26; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()) * s.r; ctx.fillStyle = rgba(rnd() < 0.6 ? light : dark, (0.25 + rnd() * 0.4) * st); ctx.fillRect(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 0.04 + rnd() * 0.1, 0.03); }
      if (s.k === 'elbow') pillDots(ctx, p.x, p.y, s.r, st * 0.7, light, dark, rnd);
    } else if (s.k === 'pilling') for (const p of stamps(s, s.r * 0.5)) pillDots(ctx, p.x, p.y, s.r, st, light, dark, rnd);
    else if (s.k === 'ribwear') {
      // rib that has stretched: faded, with wavy ribs and rippled edges along the strip
      const pts = strokePts(s);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, dx = (b.x - a.x) / L, dy = (b.y - a.y) / L;
        for (let t = 0; t < L; t += 0.22) {
          const w = (Math.sin(t * 1.7 + rnd() * 0.4) * 0.5 + 0.5) * s.r * 0.5;
          ctx.strokeStyle = rgba(t % 0.44 < 0.22 ? light : dark, (t % 0.44 < 0.22 ? 0.3 : 0.2) * st);
          ctx.lineWidth = 0.09; ctx.beginPath();
          ctx.moveTo(a.x + dx * t - dy * (s.r - w), a.y + dy * t + dx * (s.r - w)); ctx.lineTo(a.x + dx * t + dy * (s.r - w), a.y + dy * t - dx * (s.r - w)); ctx.stroke();
        }
      }
      for (const p of stamps(s, s.r * 0.8)) blob(ctx, p.x, p.y, s.r * 1.2, mix(hex, '#ffffff', dk ? 0.35 : 0.55), 0.3 * st);
    } else if (s.k === 'fray') for (const p of stamps(s, 0.3)) blob(ctx, p.x, p.y, Math.max(0.5, s.r * 0.9), mix(hex, '#f3ead6', 0.7), 0.4 * st);
    else if (s.k === 'rawhem') {
      // a cut edge that curls: a bright rolled lip and a shadow under it
      for (const p of stamps(s, 0.25)) {
        const nx = -p.dy, ny = p.dx;
        ctx.fillStyle = rgba(dark, 0.3 * st); ctx.beginPath(); ctx.arc(p.x + nx * 0.5, p.y + ny * 0.5, 0.32, 0, 6.3); ctx.fill();
        ctx.fillStyle = rgba(mix(hex, '#ffffff', dk ? 0.5 : 0.7), 0.5 * st); ctx.beginPath(); ctx.arc(p.x + nx * 0.2, p.y + ny * 0.2, 0.2 + rnd() * 0.08, 0, 6.3); ctx.fill();
      }
    } else if (s.k === 'splatter') {
      const pts = strokePts(s);
      for (let i = 0; i < 70 + 120 * st; i++) {
        const p = pts[Math.floor(rnd() * pts.length)], a = rnd() * 6.28, d = Math.abs(rnd() + rnd() - 1) * s.r * 1.4, r = 0.04 + rnd() ** 3 * 0.5;
        blob(ctx, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, r * 1.4, rnd() < 0.5 ? '#f3ecd6' : mix(hex, '#fff6dc', 0.85), 0.55 + rnd() * 0.4);
      }
    } else if (s.k === 'paint') {
      const pts = strokePts(s), lumv = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;
      const cols = lumv > 0.5 ? ['#27282d', '#3b5b8c', '#c44a3a'] : ['#ece8de', '#d9b44a', '#c44a3a'];
      const col = cols[Math.floor(rnd() * cols.length)];
      for (let i = 0; i < 40 + 70 * st; i++) {
        const p = pts[Math.floor(rnd() * pts.length)], a = rnd() * 6.28, d = Math.abs(rnd() + rnd() - 1) * s.r * 1.3, r = 0.05 + rnd() ** 3 * 0.45, x = p.x + Math.cos(a) * d, y = p.y + Math.sin(a) * d;
        ctx.fillStyle = rgba(col, 0.92); ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill();
        if (r > 0.25 && rnd() < 0.4) { ctx.fillRect(x - 0.03, y, 0.06, 0.4 + rnd() * 0.8); }
      }
    } else if (s.k === 'rip' || s.k === 'hole' || s.k === 'pinhole') {
      // worn, faded rim around the opening (and a rolled edge on knits)
      for (const o of openings([s])) { poly(ctx, o); ctx.lineJoin = 'round'; ctx.strokeStyle = rgba(mix(hex, '#ffffff', dk ? 0.5 : 0.75), 0.55 * st + 0.2); ctx.lineWidth = s.k === 'pinhole' ? 0.18 : 0.5; ctx.stroke(); }
    }
  });
  ctx.restore();
  return layer;
}

function pillDots(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, st: number, light: string, dark: string, rnd: () => number) {
  for (let i = 0; i < 16; i++) {
    const a = rnd() * 6.28, d = Math.sqrt(rnd()) * r, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, pr = 0.04 + rnd() * 0.07;
    ctx.fillStyle = rgba(dark, 0.35 * st); ctx.beginPath(); ctx.arc(px + 0.03, py + 0.04, pr, 0, 6.3); ctx.fill();
    ctx.fillStyle = rgba(light, (0.55 + rnd() * 0.3) * st); ctx.beginPath(); ctx.arc(px, py, pr, 0, 6.3); ctx.fill();
  }
}

/** cut the openings out of the ink */
export function cutOpenings(ctx: CanvasRenderingContext2D, strokes: FinishStroke[]) {
  const o = openings(strokes);
  if (!o.length) return;
  ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = '#000';
  for (const p of o) { poly(ctx, p); ctx.fill(); }
  ctx.restore();
}

/**
 * frayed threads: around every opening, across rips, and along fray strokes (colour and height contexts, cm space).
 * Woven cloth frays: weft threads bridge the opening and warp ends stand out of the rim. Knits do not fray: the rim rolls,
 * and a ladder of dropped stitches runs up and down the wale from the hole.
 */
export function drawFrayThreads(cc: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, hex: string, strokes: FinishStroke[], knit = false) {
  const line = (x0: number, y0: number, x1: number, y1: number, wd: number, col: string, h: boolean, bend = 0) => {
    const c = h ? hc : cc;
    c.strokeStyle = h ? '#ffffff' : col; c.lineWidth = wd; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x0, y0);
    if (bend) c.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2 + bend * 0.5, x1, y1); else c.lineTo(x1, y1);
    c.stroke();
  };
  const thread = (x: number, y: number, ang: number, L: number, wd: number, rnd: () => number) => {
    const col = rgba(mix(hex, '#ffffff', 0.35 + rnd() * 0.45), 0.95);
    for (const h of [false, true]) line(x, y, x + Math.cos(ang) * L, y + Math.sin(ang) * L, wd, col, h, 0.25 * L * (rnd() - 0.5));
  };
  strokes.forEach((s, si) => {
    const rnd = seedOf(s, si + 100);
    if (s.k === 'hole' || s.k === 'rip' || s.k === 'pinhole') {
      const [o] = openings([s]);
      if (!o) return;
      const c = o.reduce((a, p) => ({ x: a.x + p.x / o.length, y: a.y + p.y / o.length }), { x: 0, y: 0 });
      const ys = o.map((p) => p.y), xs = o.map((p) => p.x), top = Math.min(...ys), bot = Math.max(...ys), left = Math.min(...xs), right = Math.max(...xs);
      const big = s.k !== 'pinhole';
      if (knit) {
        // rolled rim: a thick curled edge, bright on top
        for (const [cx, h] of [[cc, false], [hc, true]] as const) {
          cx.lineJoin = 'round'; cx.beginPath(); o.forEach((p, i) => (i ? cx.lineTo(p.x, p.y) : cx.moveTo(p.x, p.y))); cx.closePath();
          cx.strokeStyle = h ? '#ffffff' : rgba(mix(hex, '#ffffff', 0.45), 0.95); cx.lineWidth = big ? 0.32 : 0.16; cx.stroke();
        }
        // ladders: thin dropped stitch lines along the wale (pattern y) above and below the hole, and a few loose loops
        const n = (big ? 4 : 2) + Math.round(s.s * (big ? 3 : 1));
        for (let i = 0; i < n; i++) {
          const x = left + (right - left) * (0.1 + 0.8 * rnd()), len = (big ? 1.2 : 0.5) + rnd() * (big ? 3 : 1.2) * (0.5 + s.s), up = rnd() < 0.5 ? -1 : 1;
          const y0 = up < 0 ? top : bot;
          line(x, y0, x + (rnd() - 0.5) * 0.15, y0 + up * len, 0.03 + rnd() * 0.025, rgba(mix(hex, '#ffffff', 0.5), 0.8), false);
          for (let q = 0; q < len; q += 0.16 + rnd() * 0.08) line(x - 0.08, y0 + up * q, x + 0.08, y0 + up * q, 0.025, rgba(mix(hex, '#ffffff', 0.3), 0.75), false);
          line(x, y0, x, y0 + up * len, 0.05, '#fff', true);
        }
        for (let i = 0; i < 4; i++) thread(c.x + (rnd() - 0.5) * (right - left), rnd() < 0.5 ? top : bot, rnd() * 6.28, 0.15 + rnd() * 0.25, 0.04, rnd);
        return;
      }
      // fibres lying out from the rim
      for (let i = 0; i < o.length * 3; i++) {
        const p = o[Math.floor(rnd() * o.length)], out = Math.atan2(p.y - c.y, p.x - c.x);
        thread(p.x, p.y, out + (rnd() - 0.5) * 1.2, 0.2 + rnd() * 0.55 * (0.5 + s.s), 0.025 + rnd() * 0.04, rnd);
      }
      // weft threads cross the opening side to side (with a little sag), warp ends hang down from the top
      const wefts = (big ? 5 : 2) + Math.round(s.s * (big ? 4 : 1));
      for (let i = 0; i < wefts; i++) {
        const y = top + (bot - top) * (0.1 + 0.8 * (i + rnd() * 0.5) / wefts);
        line(left - 0.1, y, right + 0.1, y + (rnd() - 0.5) * 0.08, 0.03 + rnd() * 0.03, rgba(mix(hex, '#ffffff', 0.3 + rnd() * 0.4), 0.95), false, 0.08);
        line(left - 0.1, y, right + 0.1, y, 0.04, '#fff', true);
      }
      for (let i = 0; i < 2 + Math.round(s.s * 2); i++) thread(left + (right - left) * rnd(), top, Math.PI / 2 + (rnd() - 0.5) * 0.6, (bot - top) * (0.3 + rnd() * 0.6), 0.03, rnd);
    } else if (s.k === 'fray' || s.k === 'rawhem') {
      // woven edges shed long loose threads; a knit edge only curls and sheds short fuzz
      const L = knit ? 0.25 : 0.3 + (s.k === 'fray' ? s.r * (0.6 + s.s) : 0.5);
      for (const p of stamps(s, knit ? 0.2 : 0.1)) { const nx = -p.dy, ny = p.dx, side = rnd() < 0.5 ? 1 : -1; thread(p.x, p.y, Math.atan2(ny * side, nx * side) + (rnd() - 0.5) * 0.8, 0.1 + rnd() * L, 0.025 + rnd() * 0.035, rnd); }
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

/* ---------- chart preview: the same wash, as an image over the piece ---------- */
const previews = new Map<string, { url: string; x: number; y: number; w: number; h: number }>();
/** the wash and wear marks of one piece copy as an image (cm box), drawn by the same code as the 3D view so the chart matches */
export function finishPreview(piece: import('../data/presets').Piece, pieces: import('../data/presets').Piece[], atts: import('../data/edits').Attachment[], fin: PieceFin, hex: string) {
  const ys = piece.points.map((q) => q.y), xs = piece.points.map((q) => q.x);
  const box = { x0: Math.min(...xs) - 3, y0: Math.min(...ys) - 3, w: Math.max(...xs) - Math.min(...xs) + 6, h: Math.max(...ys) - Math.min(...ys) + 6 };
  const key = JSON.stringify([fin, hex, piece.id, piece.points.map((q) => [q.x, q.y]), atts.filter((a) => a.kind === 'pocket').map((a) => [a.x, a.y, a.w, a.h])]);
  const hit = previews.get(key);
  if (hit) return hit;
  const k = Math.min(10, 900 / Math.max(box.w, box.h));
  const c = document.createElement('canvas');
  c.width = Math.ceil(box.w * k); c.height = Math.ceil(box.h * k);
  const g = c.getContext('2d')!;
  g.setTransform(k, 0, 0, k, -box.x0 * k, -box.y0 * k);
  drawFinishInk(g, hex, fin, box, buildWashInfo(piece, pieces, atts));
  const out = { url: c.toDataURL('image/png'), x: box.x0, y: box.y0, w: box.w, h: box.h };
  previews.set(key, out);
  if (previews.size > 24) previews.delete(previews.keys().next().value!);
  return out;
}
