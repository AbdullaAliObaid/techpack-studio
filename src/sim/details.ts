// Construction details derived from the simulated panels: seam topstitching and hems, plus the pocket opening and fly
// stitching of the pattern (stitchLines in src/data/construction.ts). Buttons, buttonholes, rivets, belt loops and
// pockets are not made here: they are attachments on the pattern (builtin: true) and draw as hardware and cloth.
// Everything is generic: it keys off piece roles and the sewing constraints, never garment names.
// Each stitch point is stored as barycentric coordinates on a cloth triangle (found in pattern space), so the
// main thread only has to interpolate three particle positions per point every frame.

import type { Details } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import type { Pt } from '../lib/geometry';
import type { Garment3D, PanelInst } from './setup';
import { stitchLines } from '../data/construction';
import type { Piece } from '../data/presets';

export const DASH = 0.3; // dash length, cm
const GAP = 0.15; // gap between dashes, cm

export const ANCHOR = { loop: 0, rivet: 1, button: 2, coveredButton: 3 } as const;

export interface DetailsMsg {
  type: 'details';
  n: number; // particle count the indices refer to
  dashCount: number;
  dashTri: Uint32Array; // 6 per dash: start triangle, end triangle (global particle indices)
  dashW: Float32Array; // 6 per dash: barycentric weights
  dashSign: Float32Array; // 2 per dash: +1 or -1, flips the triangle normal to face outward
  dashCol: Uint8Array; // palette index per dash
  palette: string[];
  anchorCount: number;
  anchorKind: Uint8Array;
  anchorTri: Uint32Array; // 3 per anchor
  anchorW: Float32Array; // 3 per anchor
  anchorUp: Float32Array; // 2 per anchor: pattern-space "down the garment" direction expressed in triangle edges
  anchorSign: Float32Array;
  anchorCol: Uint8Array; // palette index per anchor
  anchorSize: Float32Array; // 2 per anchor: length, width (cm)
}

const TRIM = new Set(['collar', 'cuff', 'waistband', 'neckband', 'placket', 'brim']);
const MAX_DASHES = 60000;

/* ---------- colour helpers ---------- */

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace('#', '');
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
const rgbToHex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = (h: string) => { const [r, g, b] = hexToRgb(h); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

/** A tone of the fabric colour that reads as thread: darker on light fabric, lighter on very dark fabric. */
export function threadTone(hex: string) {
  const c = hexToRgb(hex);
  return lum(hex) > 0.22 ? rgbToHex(c.map((v) => v * 0.7)) : rgbToHex(c.map((v) => v + (255 - v) * 0.3));
}

export function panelHex(p: PanelInst) {
  const f = fabricById(p.piece.fabric.id);
  return (f.colors[p.piece.fabric.color] ?? f.colors[0]).hex;
}

/* ---------- locating pattern points on cloth triangles ---------- */

export interface Loc { tri: [number, number, number]; w: [number, number, number] }

export class Locator {
  private cells = new Map<number, number[]>();
  constructor(private P: PanelInst, private cell = 2) {
    const { uv, tris } = P.mesh;
    for (let t = 0; t < tris.length; t += 3) {
      const a = uv[tris[t]], b = uv[tris[t + 1]], c = uv[tris[t + 2]];
      const x0 = Math.floor(Math.min(a.x, b.x, c.x) / cell), x1 = Math.floor(Math.max(a.x, b.x, c.x) / cell);
      const y0 = Math.floor(Math.min(a.y, b.y, c.y) / cell), y1 = Math.floor(Math.max(a.y, b.y, c.y) / cell);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        const l = this.cells.get(k);
        if (l) l.push(t); else this.cells.set(k, [t]);
      }
    }
  }
  private key(x: number, y: number) { return (x + 2048) * 8192 + (y + 2048); }

  at(x: number, y: number, tol = 0.6): Loc | null {
    const { uv, tris } = this.P.mesh;
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best: { t: number; w: number[]; m: number } | null = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const l = this.cells.get(this.key(cx + dx, cy + dy));
      if (!l) continue;
      for (const t of l) {
        const a = uv[tris[t]], b = uv[tris[t + 1]], c = uv[tris[t + 2]];
        const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
        if (Math.abs(det) < 1e-9) continue;
        const w0 = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / det;
        const w1 = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / det;
        const w2 = 1 - w0 - w1;
        const m = Math.min(w0, w1, w2);
        if (!best || m > best.m) best = { t, w: [w0, w1, w2], m };
        if (m >= -1e-6) dx = dy = 2;
      }
    }
    if (!best) return null;
    let w = best.w.map((v) => Math.max(0, v));
    const s = w[0] + w[1] + w[2];
    if (s < 1e-9) return null;
    w = w.map((v) => v / s);
    if (best.m < -1e-6) {
      // outside the mesh: accept only if the clamped point is close to the query
      const a = uv[tris[best.t]], b = uv[tris[best.t + 1]], c = uv[tris[best.t + 2]];
      const px = w[0] * a.x + w[1] * b.x + w[2] * c.x, py = w[0] * a.y + w[1] * b.y + w[2] * c.y;
      if (Math.hypot(px - x, py - y) > tol) return null;
    }
    const o = this.P.offset;
    return { tri: [o + tris[best.t], o + tris[best.t + 1], o + tris[best.t + 2]], w: [w[0], w[1], w[2]] };
  }
}

/* ---------- builder ---------- */

/** +1 or -1 per panel: which way the triangle normals face to point away from the panel centre (outward). */
export function outwardSigns(panels: PanelInst[], pos: Float32Array): number[] {
  return panels.map((P) => {
    const { tris, uv } = P.mesh;
    const n = uv.length, o = P.offset;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += pos[(o + i) * 3]; cy += pos[(o + i) * 3 + 1]; cz += pos[(o + i) * 3 + 2]; }
    cx /= n; cy /= n; cz /= n;
    const brim = P.piece.role === ('brim' as string);
    let vote = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const a = (o + tris[t]) * 3, b = (o + tris[t + 1]) * 3, c = (o + tris[t + 2]) * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const L = Math.hypot(nx, ny, nz) || 1;
      if (brim) { vote += ny / L; continue; }
      const mx = (pos[a] + pos[b] + pos[c]) / 3 - cx, my = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - cy, mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - cz;
      const ml = Math.hypot(mx, my, mz) || 1;
      vote += (nx * mx + ny * my + nz * mz) / (L * ml);
    }
    return vote >= 0 ? 1 : -1;
  });
}


interface Run { idx: number[]; closed: boolean; sewn: boolean; own: boolean }

export function buildDetails(G: Garment3D, d: Details): DetailsMsg {
  const { sim, panels } = G;
  const pos = sim.pos;
  const palette: string[] = [];
  const colIdx = (hex: string) => { let i = palette.indexOf(hex); if (i < 0) { i = palette.length; palette.push(hex); } return i; };

  // sewing partners per particle (a button through its buttonhole is not a seam)
  const fastened = new Set<string>();
  for (const [id, ls] of Object.entries(G.seamLinks ?? {})) if (id.startsWith('fasten:')) for (const [a, b] of ls) { fastened.add(`${a},${b}`); fastened.add(`${b},${a}`); }
  const partners = new Map<number, number[]>();
  for (let c = sim.nStretch; c < sim.ca.length; c++) {
    if (sim.rest[c] !== 0) continue;
    const a = sim.ca[c], b = sim.cb[c];
    if (a === b || fastened.has(`${a},${b}`)) continue;
    (partners.get(a) ?? partners.set(a, []).get(a)!).push(b);
    (partners.get(b) ?? partners.set(b, []).get(b)!).push(a);
  }
  const panelOf = (v: number) => { for (let k = panels.length - 1; k >= 0; k--) if (v >= panels[k].offset) return k; return 0; };

  // outputs
  const dashTri: number[] = [], dashW: number[] = [], dashSign: number[] = [], dashCol: number[] = [];
  const aKind: number[] = [], aTri: number[] = [], aW: number[] = [], aUp: number[] = [], aSign: number[] = [], aCol: number[] = [], aSize: number[] = [];

  const locs = panels.map((P) => new Locator(P));

  // which side of each panel faces outward: vote with the triangle normals against the direction from the panel centre
  const signs = outwardSigns(panels, pos);

  /** pattern-space direction (0,1) expressed as alpha, beta on a triangle's edges, so main can orient things "down the garment" */
  const upOf = (k: number, loc: Loc): [number, number] => {
    const P = panels[k], o = P.offset;
    const a = P.mesh.uv[loc.tri[0] - o], b = P.mesh.uv[loc.tri[1] - o], c = P.mesh.uv[loc.tri[2] - o];
    const e1x = b.x - a.x, e1y = b.y - a.y, e2x = c.x - a.x, e2y = c.y - a.y;
    const det = e1x * e2y - e1y * e2x || 1e-9;
    return [(0 * e2y - 1 * e2x) / det, (e1x * 1 - e1y * 0) / det];
  };

  const addAnchor = (k: number, kind: number, loc: Loc, col: string, size: [number, number]) => {
    const [al, be] = upOf(k, loc);
    aKind.push(kind); aTri.push(...loc.tri); aW.push(...loc.w); aUp.push(al, be); aSign.push(signs[k]); aCol.push(colIdx(col)); aSize.push(size[0], size[1]);
  };

  /** dashes along an arbitrary pattern-space polyline */
  const stitchLine = (k: number, pts: Pt[], col: string, closed = false) => {
    if (dashCol.length >= MAX_DASHES) return;
    const line = closed ? [...pts, pts[0]] : pts;
    const acc = [0];
    for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y));
    const L = acc[acc.length - 1];
    if (L < 1) return;
    const ci = colIdx(col);
    let seg = 0;
    const at = (s: number): Pt => {
      while (seg < line.length - 2 && acc[seg + 1] < s) seg++;
      const f = Math.max(0, Math.min(1, (s - acc[seg]) / ((acc[seg + 1] - acc[seg]) || 1)));
      return { x: line[seg].x + (line[seg + 1].x - line[seg].x) * f, y: line[seg].y + (line[seg + 1].y - line[seg].y) * f };
    };
    const period = DASH + GAP;
    const n = Math.floor((L - DASH) / period);
    const lead = (L - (n * period + DASH)) / 2; // centre the pattern so runs end on a full dash
    for (let i = 0; i <= n; i++) {
      const s0 = lead + i * period;
      seg = 0;
      const p0 = at(s0);
      const p1 = at(s0 + DASH);
      const a = locs[k].at(p0.x, p0.y), b = locs[k].at(p1.x, p1.y);
      if (!a || !b) continue;
      dashTri.push(...a.tri, ...b.tri);
      dashW.push(...a.w, ...b.w);
      dashSign.push(signs[k], signs[k]);
      dashCol.push(ci);
    }
  };

  const threadColor = (P: PanelInst, spec?: string) => (!spec || spec === 'match' ? threadTone(panelHex(P)) : spec);

  /* ---- boundary walk: sewn runs and free runs ---- */
  panels.forEach((P, k) => {
    const { uv, boundary } = P.mesh;
    const N = boundary.length;
    if (N < 6) return;
    const role = P.piece.role as string;
    const trim = TRIM.has(role);
    const pt = (i: number) => uv[boundary[((i % N) + N) % N]];
    const gl = (i: number) => P.offset + boundary[((i % N) + N) % N];

    // polygon orientation, so "inward" is known
    let area = 0;
    for (let i = 0; i < N; i++) { const a = pt(i), b = pt(i + 1); area += a.x * b.y - b.x * a.y; }
    const side = area >= 0 ? 1 : -1;

    const sewn = Array.from({ length: N }, (_, i) => partners.has(gl(i)));
    const partnerPanel = Array.from({ length: N }, (_, i) => (sewn[i] ? panelOf(partners.get(gl(i))![0]) : -1));

    // corners
    const W = 2;
    const ang = Array.from({ length: N }, (_, i) => {
      const a = pt(i), p = pt(i - W), q = pt(i + W);
      const ux = a.x - p.x, uy = a.y - p.y, vx = q.x - a.x, vy = q.y - a.y;
      const l = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      return l < 1e-9 ? 0 : Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / l)));
    });
    const brk = Array.from({ length: N }, (_, i) =>
      (ang[i] > 0.85 && ang[i] > ang[(i + N - 1) % N] && ang[i] >= ang[(i + 1) % N]) ||
      sewn[i] !== sewn[(i + N - 1) % N] ||
      (sewn[i] && sewn[(i + N - 1) % N] && partnerPanel[i] !== partnerPanel[(i + N - 1) % N]));

    const runs: Run[] = [];
    const first = brk.findIndex(Boolean);
    const ownVote = (idx: number[]) => {
      let own = 0, other = 0;
      for (const i of idx) {
        const v = gl(i);
        for (const q of partners.get(v) ?? []) {
          const qt = TRIM.has(panels[panelOf(q)].piece.role as string);
          if (!trim && qt) other++;
          else if (trim && !qt) own++;
          else if (v <= q) own++; else other++;
        }
      }
      return own >= other;
    };
    if (first < 0) {
      const idx = Array.from({ length: N }, (_, i) => i);
      runs.push({ idx: [...idx, 0], closed: true, sewn: sewn[0], own: sewn[0] ? ownVote(idx) : false });
    } else {
      let cur = [first];
      for (let s = 1; s <= N; s++) {
        const i = (first + s) % N;
        cur.push(i);
        if (brk[i] || s === N) {
          const sw = sewn[cur[Math.min(1, cur.length - 1)]];
          runs.push({ idx: cur, closed: false, sewn: sw, own: sw ? ownVote(cur) : false });
          cur = [i];
        }
      }
    }

    const rows: { off: number; col: string }[][] = [];
    void rows;
    for (const run of runs) {
      const len = run.idx.reduce((s, i, j) => (j ? s + Math.hypot(pt(i).x - pt(run.idx[j - 1]).x, pt(i).y - pt(run.idx[j - 1]).y) : 0), 0);
      if (len < 4) continue;
      let offsets: number[] = [];
      let col = '';
      if (run.sewn) {
        if (!run.own || !d.topstitch) continue;
        const t = d.topstitch;
        offsets = t.needles === 2 ? [t.offset, t.offset + 0.6] : [t.offset];
        col = threadColor(P, t.color);
      } else if (role === 'brim') {
        const o = d.topstitch?.offset ?? 0.5;
        offsets = [o, o + 0.6, o + 1.2];
        col = threadColor(P, d.topstitch?.color);
      } else if (trim) {
        if (!d.topstitch) continue;
        offsets = [Math.min(0.4, d.topstitch.offset)];
        col = threadColor(P, d.topstitch.color);
      } else if (d.hem) {
        const dep = Math.max(0.5, d.hem.depth);
        offsets = d.hem.needles === 2 ? [Math.max(0.3, dep - 0.3), dep + 0.3] : [dep];
        col = threadColor(P, d.topstitch?.color);
      } else continue;

      // offset the run inward (into the panel), averaging the normals of neighbouring segments
      const pts = run.idx.map((i) => pt(i));
      const nrm = pts.map((p, j) => {
        const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
        let tx = b.x - a.x, ty = b.y - a.y;
        if (run.closed && (j === 0 || j === pts.length - 1)) { const pa = pt(run.idx[0] - 1), pb = pt(run.idx[0] + 1); tx = pb.x - pa.x; ty = pb.y - pa.y; }
        const l = Math.hypot(tx, ty) || 1;
        return { x: (-ty / l) * side, y: (tx / l) * side };
      });
      for (const o of offsets) {
        const line = pts.map((p, j) => ({ x: p.x + nrm[j].x * o, y: p.y + nrm[j].y * o }));
        // trim the very ends so lines from neighbouring runs do not pile up at corners
        stitchLine(k, line, col);
      }
    }
  });

  /* ---- stitching drawn on the pattern: pocket openings, fly J stitch (src/data/construction.ts) ---- */
  if (G.style) {
    const pieces: Piece[] = [];
    for (const P of panels) if (!P.attach && !pieces.includes(P.piece)) pieces.push(P.piece);
    for (const L of stitchLines(G.style, pieces, G.edits)) {
      if (L.kind !== 'pocket' && L.kind !== 'fly') continue;
      panels.forEach((P, k) => {
        if (P.attach || P.piece.id !== L.pieceId || (L.instance !== undefined && P.instance !== L.instance)) return;
        stitchLine(k, L.points, threadColor(P, L.color));
      });
    }
  }

  return {
    type: 'details',
    n: sim.n,
    dashCount: dashCol.length,
    dashTri: new Uint32Array(dashTri),
    dashW: new Float32Array(dashW),
    dashSign: new Float32Array(dashSign),
    dashCol: new Uint8Array(dashCol),
    palette,
    anchorCount: aKind.length,
    anchorKind: new Uint8Array(aKind),
    anchorTri: new Uint32Array(aTri),
    anchorW: new Float32Array(aW),
    anchorUp: new Float32Array(aUp),
    anchorSign: new Float32Array(aSign),
    anchorCol: new Uint8Array(aCol),
    anchorSize: new Float32Array(aSize),
  };
}

export function detailTransfers(m: DetailsMsg): ArrayBuffer[] {
  return [m.dashTri, m.dashW, m.dashSign, m.dashCol, m.anchorKind, m.anchorTri, m.anchorW, m.anchorUp, m.anchorSign, m.anchorCol, m.anchorSize].map((a) => a.buffer as ArrayBuffer);
}
