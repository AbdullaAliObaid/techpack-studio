// Topstitching around attachments (pockets, patches, straps). Output uses the DetailsMsg layout (dashes only),
// so the main thread draws it with the same code as the garment's own stitching.
//   pocket: three sides, open at the top, bar tacks at the two top corners
//   patch:  all the way round
//   strap:  box with an X at each end, plus edge stitching along the long sides
// Stitches go on the attachment's own cloth panel when the simulation has one (panel piece id === attachment id,
// outline in centred local coords). Otherwise they go on the host panel at the attachment position.

import type { Attachment } from '../data/edits';
import type { Pt } from '../lib/geometry';
import { attachmentPolygon, attachmentRings } from '../lib/trims';
import { DASH, Locator, outwardSigns, panelHex, threadTone, type DetailsMsg } from './details';
import type { Garment3D, PanelInst } from './setup';

/**
 * +1 or -1 per panel: which way the triangle normals (mesh order) face outward. Cloth attachment panels take the side
 * of the host cloth under them, which is more reliable than a vote on a small flat piece.
 */
export function outwardSignsHosted(panels: PanelInst[], pos: Float32Array): number[] {
  const s = outwardSigns(panels, pos);
  const nrm = (P: PanelInst, t: number, out: number[]) => {
    const { tris } = P.mesh, o = P.offset;
    const a = (o + tris[t]) * 3, b = (o + tris[t + 1]) * 3, c = (o + tris[t + 2]) * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    out[0] = uy * vz - uz * vy; out[1] = uz * vx - ux * vz; out[2] = ux * vy - uy * vx;
    out[3] = (pos[a] + pos[b] + pos[c]) / 3; out[4] = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3; out[5] = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3;
  };
  panels.forEach((P, k) => {
    const H = P.attach ? panels[P.attach.host] : null;
    if (!P.attach || !H) return;
    const q = [0, 0, 0, 0, 0, 0];
    let cx = 0, cy = 0, cz = 0, nx = 0, ny = 0, nz = 0;
    for (let t = 0; t < P.mesh.tris.length; t += 3) { nrm(P, t, q); cx += q[3]; cy += q[4]; cz += q[5]; nx += q[0]; ny += q[1]; nz += q[2]; }
    const nt = Math.max(1, P.mesh.tris.length / 3);
    cx /= nt; cy /= nt; cz /= nt;
    let best = Infinity, hx = 0, hy = 0, hz = 0;
    for (let t = 0; t < H.mesh.tris.length; t += 3) {
      nrm(H, t, q);
      const d = (q[3] - cx) ** 2 + (q[4] - cy) ** 2 + (q[5] - cz) ** 2;
      if (d < best) { best = d; hx = q[0]; hy = q[1]; hz = q[2]; }
    }
    const hs = s[P.attach.host];
    if (best < Infinity) s[k] = (nx * hx + ny * hy + nz * hz) * hs >= 0 ? 1 : -1;
  });
  return s;
}

const INSET = 0.3; // stitch line distance from the attachment edge, cm
const MAX_DASHES = 20000;

export type AttachDetailsMsg = Omit<DetailsMsg, 'type'> & { type: 'attachDetails' };

const rad = (d: number) => (d * Math.PI) / 180;

function inset(poly: Pt[], by: number): Pt[] {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const sx = Math.max(0.1, (x1 - x0 - 2 * by) / ((x1 - x0) || 1)), sy = Math.max(0.1, (y1 - y0 - 2 * by) / ((y1 - y0) || 1));
  return poly.map((p) => ({ x: cx + (p.x - cx) * sx, y: cy + (p.y - cy) * sy }));
}

export function buildAttachmentDetails(G: Garment3D, attachments: Attachment[]): AttachDetailsMsg {
  const { sim, panels } = G;
  const signs = outwardSignsHosted(panels, sim.pos);
  const locs = new Map<number, Locator>();
  const loc = (k: number) => { let l = locs.get(k); if (!l) { l = new Locator(panels[k]); locs.set(k, l); } return l; };
  const palette: string[] = [];
  const dashTri: number[] = [], dashW: number[] = [], dashSign: number[] = [], dashCol: number[] = [];

  const line = (k: number, pts: Pt[], col: string, dash = DASH, gap = 0.15) => {
    if (dashCol.length >= MAX_DASHES || pts.length < 2) return;
    let ci = palette.indexOf(col);
    if (ci < 0) { ci = palette.length; palette.push(col); }
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const L = acc[acc.length - 1];
    if (L < dash) return;
    let seg = 0;
    const at = (s: number): Pt => {
      while (seg < pts.length - 2 && acc[seg + 1] < s) seg++;
      const f = Math.max(0, Math.min(1, (s - acc[seg]) / ((acc[seg + 1] - acc[seg]) || 1)));
      return { x: pts[seg].x + (pts[seg + 1].x - pts[seg].x) * f, y: pts[seg].y + (pts[seg + 1].y - pts[seg].y) * f };
    };
    const period = dash + gap;
    const n = Math.floor((L - dash) / period);
    const lead = (L - (n * period + dash)) / 2;
    for (let i = 0; i <= n; i++) {
      seg = 0;
      seg = 0;
      const p0 = at(lead + i * period);
      seg = 0;
      const p1 = at(lead + i * period + dash);
      const a = loc(k).at(p0.x, p0.y), b = loc(k).at(p1.x, p1.y);
      if (!a || !b) continue;
      dashTri.push(...a.tri, ...b.tri);
      dashW.push(...a.w, ...b.w);
      dashSign.push(signs[k], signs[k]);
      dashCol.push(ci);
    }
  };

  const zigzag = (k: number, ring: Pt[], col: string, T: (p: Pt) => Pt) => {
    // resample the closed outline and swing the needle +-AMP across it
    const pts = [...ring, ring[0]];
    const acc = [0];
    for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    const L = acc[acc.length - 1];
    if (L < 1) return;
    const N = Math.max(8, Math.round(L / 0.22)), AMP = 0.14;
    const at = (s: number) => {
      let j = 0;
      while (j < pts.length - 2 && acc[j + 1] < s) j++;
      const f = Math.max(0, Math.min(1, (s - acc[j]) / ((acc[j + 1] - acc[j]) || 1)));
      const dx = pts[j + 1].x - pts[j].x, dy = pts[j + 1].y - pts[j].y, dl = Math.hypot(dx, dy) || 1;
      return { x: pts[j].x + dx * f, y: pts[j].y + dy * f, nx: -dy / dl, ny: dx / dl };
    };
    let prev: Pt | null = null;
    for (let i = 0; i <= N; i++) {
      const q = at((i / N) * L), sg = i % 2 ? 1 : -1;
      const p = { x: q.x + q.nx * AMP * sg, y: q.y + q.ny * AMP * sg };
      if (prev) {
        const len = Math.hypot(p.x - prev.x, p.y - prev.y);
        line(k, [T(prev), T(p)], col, len * 0.97, 0);
      }
      prev = p;
    }
  };

  for (const a of attachments) {
    if (a.kind === 'print' || a.kind === 'embroidery' || a.kind === 'hardware') continue;
    // the attachment's own cloth panels (one per host copy); without any, the host copies it is meant for
    let targets = panels.map((P, k) => ({ P, k })).filter(({ P }) => P.attach?.id === a.id);
    if (a.instance !== undefined) targets = targets.filter(({ P }) => panels[P.attach!.host]?.instance === a.instance);
    const own = targets.length > 0;
    if (!own) targets = panels.map((P, k) => ({ P, k })).filter(({ P }) => !P.attach && P.piece.id === a.pieceId && (a.instance === undefined || P.instance === a.instance));
    const rings = attachmentRings(a);
    for (const [ti, { k }] of targets.entries()) {
      const c = own ? 1 : Math.cos(rad(a.rotation)), s = own ? 0 : Math.sin(rad(a.rotation));
      const ox = own ? 0 : a.x, oy = own ? 0 : a.y;
      const T = (p: Pt): Pt => ({ x: ox + c * p.x - s * p.y, y: oy + s * p.x + c * p.y });
      const col = a.thread || threadTone(panelHex(panels[k]));
      const poly = attachmentPolygon(a);
      const ring = inset(poly, INSET);

      if (a.kind === 'applique') {
        // own panels: one per ring (letter) per host copy, in ring order; on the host: every ring
        if (own) {
          const host = panels[k].attach!.host;
          const j = targets.filter((t, i) => i < ti && panels[t.k].attach!.host === host).length;
          zigzag(k, inset(rings[j % rings.length], 0.15), col, T);
        } else for (const r of rings) zigzag(k, inset(r, 0.15), col, T);
      } else if (a.kind === 'patch') {
        line(k, [...ring, ring[0]].map(T), col);
      } else if (a.kind === 'pocket') {
        // drop the top edge: vertices on the minimum y form one run; the stitch runs from the end of that run round to its start
        const minY = Math.min(...ring.map((p) => p.y));
        const top = ring.map((p) => p.y <= minY + 1e-3);
        const N = ring.length;
        let start = -1;
        for (let i = 0; i < N; i++) if (top[i] && !top[(i + 1) % N]) start = i; // last top vertex of the run
        if (start >= 0) {
          const path: Pt[] = [ring[start]];
          for (let j = 1; j <= N; j++) {
            const i = (start + j) % N;
            path.push(ring[i]);
            if (top[i]) break;
          }
          line(k, path.map(T), col);
          // bar tacks across the seam at both ends: three short bars stepping into the pocket
          for (const [e, f] of [[path[0], path[1]], [path[path.length - 1], path[path.length - 2]]] as [Pt, Pt][]) {
            const tl = Math.hypot(f.x - e.x, f.y - e.y) || 1;
            const tx = (f.x - e.x) / tl, ty = (f.y - e.y) / tl; // along the seam, into the pocket
            for (let b = 0; b < 3; b++) {
              const cx = e.x + tx * 0.25 * b, cy = e.y + ty * 0.25 * b;
              line(k, [{ x: cx - ty * 0.45, y: cy + tx * 0.45 }, { x: cx + ty * 0.45, y: cy - tx * 0.45 }].map(T), col, 0.45, 0);
            }
          }
        }
      } else if (a.kind === 'strap') {
        const lw = Math.max(a.w, a.h), sw = Math.min(a.w, a.h);
        const horiz = a.w >= a.h; // long axis along x in local coords
        const P = (u: number, v: number): Pt => (horiz ? { x: u, y: v } : { x: v, y: u });
        const hl = lw / 2 - INSET, hs = sw / 2 - INSET;
        const bx = Math.min(sw * 0.9, lw / 3); // box length along the strap
        for (const e of [-1, 1]) {
          const u0 = e * hl, u1 = e * (hl - bx);
          line(k, [P(u0, -hs), P(u0, hs), P(u1, hs), P(u1, -hs), P(u0, -hs)].map(T), col);
          line(k, [P(u0, -hs), P(u1, hs)].map(T), col);
          line(k, [P(u0, hs), P(u1, -hs)].map(T), col);
        }
        if (lw > 3 * bx) for (const v of [-hs, hs]) line(k, [P(-hl + bx, v), P(hl - bx, v)].map(T), col);
      }
    }
  }

  const D = dashCol.length;
  return {
    type: 'attachDetails',
    n: sim.n,
    dashCount: D,
    dashTri: new Uint32Array(dashTri), dashW: new Float32Array(dashW), dashSign: new Float32Array(dashSign), dashCol: new Uint8Array(dashCol),
    palette,
    anchorCount: 0,
    anchorKind: new Uint8Array(0), anchorTri: new Uint32Array(0), anchorW: new Float32Array(0), anchorUp: new Float32Array(0),
    anchorSign: new Float32Array(0), anchorCol: new Uint8Array(0), anchorSize: new Float32Array(0),
  };
}
