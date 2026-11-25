// Construction details derived from the simulated panels: stitching, hems, belt loops, rivets, buttons.
// Everything is generic: it keys off piece roles and the sewing constraints, never garment names.
// Each stitch point is stored as barycentric coordinates on a cloth triangle (found in pattern space), so the
// main thread only has to interpolate three particle positions per point every frame.

import type { Details } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import type { Pt } from '../lib/geometry';
import type { Garment3D, PanelInst } from './setup';

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

class Locator {
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

interface Run { idx: number[]; closed: boolean; sewn: boolean; own: boolean }

export function buildDetails(G: Garment3D, d: Details): DetailsMsg {
  const { sim, panels } = G;
  const pos = sim.pos;
  const palette: string[] = [];
  const colIdx = (hex: string) => { let i = palette.indexOf(hex); if (i < 0) { i = palette.length; palette.push(hex); } return i; };

  // sewing partners per particle
  const partners = new Map<number, number[]>();
  for (let c = sim.nStretch; c < sim.ca.length; c++) {
    if (sim.rest[c] !== 0) continue;
    const a = sim.ca[c], b = sim.cb[c];
    if (a === b) continue;
    (partners.get(a) ?? partners.set(a, []).get(a)!).push(b);
    (partners.get(b) ?? partners.set(b, []).get(b)!).push(a);
  }
  const panelOf = (v: number) => { for (let k = panels.length - 1; k >= 0; k--) if (v >= panels[k].offset) return k; return 0; };

  // outputs
  const dashTri: number[] = [], dashW: number[] = [], dashSign: number[] = [], dashCol: number[] = [];
  const aKind: number[] = [], aTri: number[] = [], aW: number[] = [], aUp: number[] = [], aSign: number[] = [], aCol: number[] = [], aSize: number[] = [];

  const locs = panels.map((P) => new Locator(P));

  // which side of each panel faces outward: vote with the triangle normals against the direction from the panel centre
  const signs = panels.map((P) => {
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

  /* ---- helpers for placed details ---- */
  const byRole = (r: string) => panels.map((P, k) => ({ P, k })).filter((e) => (e.P.piece.role as string) === r);
  const uvBox = (P: PanelInst) => {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const q of P.mesh.uv) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
    return { x0, x1, y0, y1 };
  };
  /** extent (first and last y) of a vertical line at pattern x that lies on the cloth */
  const vertExtent = (k: number, x: number) => {
    const bb = uvBox(panels[k]);
    let top = NaN, bot = NaN;
    for (let y = bb.y0; y <= bb.y1; y += 0.4) if (locs[k].at(x, y, 0.01)) { if (isNaN(top)) top = y; bot = y; }
    return { top, bot };
  };

  /* ---- belt loops ---- */
  if (d.beltLoops) {
    for (const { P, k } of byRole('waistband')) {
      const bb = uvBox(P);
      const Wd = bb.x1 - bb.x0, h = bb.y1 - bb.y0;
      // the band's front-most particle marks centre front
      let uf = bb.x0, zBest = -Infinity;
      for (let i = 0; i < P.mesh.uv.length; i++) {
        const z = pos[(P.offset + i) * 3 + 2];
        if (z > zBest) { zBest = z; uf = P.mesh.uv[i].x; }
      }
      const n = d.beltLoops;
      const step = n > 1 ? 0.68 / (n - 1) : 0;
      for (let j = 0; j < n; j++) {
        const s = 0.5 + (j - (n - 1) / 2) * step; // fraction of the circumference measured from centre front
        const u = bb.x0 + ((((uf + s * Wd) - bb.x0) % Wd) + Wd) % Wd;
        const loc = locs[k].at(u, bb.y0 + h / 2);
        if (loc) addAnchor(k, ANCHOR.loop, loc, panelHex(P), [Math.min(4.5, h * 0.95), 1.0]);
      }
    }
  }

  /* ---- pants-style pockets and rivets (front and back panels sewn to a waistband) ---- */
  if (d.rivets) {
    const copper = '#c47a3c';
    const thread = (P: PanelInst) => threadColor(P, d.topstitch?.color);
    panels.forEach((P, k) => {
      const role = P.piece.role as string;
      if (role !== 'front' && role !== 'back') return;
      const { uv, boundary } = P.mesh;
      // waist edge = boundary run sewn to a waistband panel
      const edge = boundary.filter((b) => (partners.get(P.offset + b) ?? []).some((q) => (panels[panelOf(q)].piece.role as string) === 'waistband'));
      if (edge.length < 4) return;
      let u0 = Infinity, u1 = -Infinity;
      for (const b of edge) { u0 = Math.min(u0, uv[b].x); u1 = Math.max(u1, uv[b].x); }
      const vAt = (u: number) => { let best = edge[0]; for (const b of edge) if (Math.abs(uv[b].x - u) < Math.abs(uv[best].x - u)) best = b; return uv[best].y; };
      // which end of the waist edge is the side seam: the one further from the body centre line
      const ex = (u: number) => { let best = edge[0]; for (const b of edge) if (Math.abs(uv[b].x - u) < Math.abs(uv[best].x - u)) best = b; return Math.abs(pos[(P.offset + best) * 3]); };
      const e = ex(u0) > ex(u1) ? 1 : -1; // direction from the side seam towards the centre, in u
      const uOut = e > 0 ? u0 : u1;
      const sideU = (v: number) => { // pattern u of the side seam at depth v
        let best = e > 0 ? Infinity : -Infinity;
        for (const b of boundary) if (Math.abs(uv[b].y - v) < 1.2) best = e > 0 ? Math.min(best, uv[b].x) : Math.max(best, uv[b].x);
        return isFinite(best) ? best : uOut;
      };
      const vTop = vAt(uOut);
      if (role === 'front') {
        // pocket opening: scoop from the waist down to the side seam, with a rivet at each end
        const A = { x: uOut + e * 7.5, y: vAt(uOut + e * 7.5) + 1.2 };
        const vB = vTop + 13.5;
        const B = { x: sideU(vB) + e * 1.0, y: vB };
        const C = { x: B.x + e * 5.5, y: A.y + 9.5 };
        const curve: Pt[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t;
          curve.push({ x: a * A.x + b * C.x + c * B.x, y: a * A.y + b * C.y + c * B.y });
        }
        stitchLine(k, curve, thread(P));
        const off2 = curve.map((q, i) => { const n = curve[Math.min(i + 1, 24)], p = curve[Math.max(i - 1, 0)]; const tx = n.x - p.x, ty = n.y - p.y, l = Math.hypot(tx, ty) || 1; return { x: q.x + (ty / l) * e * 0.55 * -1, y: q.y + (tx / l) * e * 0.55 }; });
        void off2;
        for (const q of [A, B]) {
          const loc = locs[k].at(q.x, q.y);
          if (loc) addAnchor(k, ANCHOR.rivet, loc, copper, [0.42, 0]);
        }
      } else {
        // back pocket: five sided patch pocket centred on the half back
        const vP = vTop + 6.5;
        const out = sideU(vP + 7), inn = e > 0 ? u1 : u0;
        const cu = (out + inn) / 2 + e * 0.5;
        const hw = 7, ht = 12.5, pt = 15.5;
        const poly: Pt[] = [
          { x: cu - hw, y: vP }, { x: cu + hw, y: vP }, { x: cu + hw, y: vP + ht }, { x: cu, y: vP + pt }, { x: cu - hw, y: vP + ht },
        ];
        if (Math.abs(out - inn) > 2 * hw + 4) {
          stitchLine(k, poly, thread(P), true);
          stitchLine(k, [{ x: cu - hw, y: vP + 0.9 }, { x: cu + hw, y: vP + 0.9 }], thread(P));
          for (const q of [poly[0], poly[1]]) {
            const loc = locs[k].at(q.x + (q === poly[0] ? 0.6 : -0.6), q.y + 0.6);
            if (loc) addAnchor(k, ANCHOR.rivet, loc, copper, [0.38, 0]);
          }
        }
      }
    });
  }

  /* ---- buttons ---- */
  if (d.buttons) {
    const n = d.buttons;
    const crowns = byRole('crown');
    const buttonFor = (P: PanelInst) => (lum(panelHex(P)) > 0.65 ? '#cfc8b4' : '#eee9db');
    if (crowns.length) {
      // covered button on the crown top: the highest particle of the crown panels
      let best = -1, bk = 0, by = -Infinity;
      for (const { P, k } of crowns) for (let i = 0; i < P.mesh.uv.length; i++) {
        const y = pos[(P.offset + i) * 3 + 1];
        if (y > by) { by = y; best = i; bk = k; }
      }
      if (best >= 0) {
        const P = panels[bk], q = P.mesh.uv[best];
        const loc = locs[bk].at(q.x, q.y);
        if (loc) addAnchor(bk, ANCHOR.coveredButton, loc, panelHex(P), [0.7, 0]);
      }
    } else {
      const plackets = byRole('placket');
      const targets = plackets.length ? plackets.slice(0, 1) : byRole('front').slice(0, 1);
      for (const { P, k } of targets) {
        let top: number, bot: number, x: number;
        if (plackets.length) {
          const bb = uvBox(P);
          x = (bb.x0 + bb.x1) / 2;
          const ex = vertExtent(k, x);
          top = ex.top; bot = ex.bot;
          if (isNaN(top)) { top = bb.y0; bot = bb.y1; }
        } else {
          x = 0;
          const ex = vertExtent(k, 0);
          top = ex.top; bot = ex.bot;
        }
        if (isNaN(top) || isNaN(bot)) continue;
        const span = bot - top;
        const first = plackets.length ? top + 2 : top + 2.6;
        const last = plackets.length ? bot - 2 : top + span * 0.8;
        const pitch = n > 1 ? Math.min(plackets.length ? 8 : 12, (last - first) / (n - 1)) : 0;
        const y0 = n > 1 ? first : (first + last) / 2;
        const col = buttonFor(P);
        for (let j = 0; j < n; j++) {
          const loc = locs[k].at(x, y0 + j * pitch);
          if (loc) addAnchor(k, ANCHOR.button, loc, col, [0.62, 0]);
        }
        // placket edge stitching on a body panel that has a front opening but no placket piece
        if (!plackets.length && n >= 3) {
          const t = d.topstitch;
          const color = threadColor(P, t?.color);
          for (const s of [-1, 1]) {
            const ex = vertExtent(k, s * 1.7);
            if (isNaN(ex.top)) continue;
            stitchLine(k, [{ x: s * 1.7, y: ex.top + 0.5 }, { x: s * 1.7, y: ex.bot - (d.hem ? d.hem.depth + 0.6 : 0.6) }], color);
          }
        }
      }
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
