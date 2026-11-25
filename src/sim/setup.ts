// Garment assembly, CLO style: mesh each pattern piece, arrange it around the avatar,
// declare the sewing lines, then let the solver drape it.

import type { GarmentType, Piece } from '../data/presets';
import { fabricById } from '../data/fabrics';
import { samplePoly, sliceSpan, type Pt } from '../lib/geometry';
import { bodyFrame, ellipseCirc, hullAt, type Body, type BodyFrame } from '../three/body';
import { BodyCollider } from './collider';
import { ClothSim } from './cloth';
import { meshPanel, pathParams, seamPath, type PanelMesh } from './panels';

export interface PanelInst {
  piece: Piece;
  mesh: PanelMesh;
  offset: number; // first particle index
  mirror: boolean;
}

export interface Garment3D {
  sim: ClothSim;
  panels: PanelInst[];
  limits: Float32Array; // safe stretch per particle
}

const TAU = Math.PI * 2;
const SUB = 10;
const H2 = (1 / 60 / SUB) ** 2;

type Placer = (u: number, v: number) => [number, number, number];

function widthSpan(poly: Pt[], y: number) {
  return sliceSpan(poly, y) ?? { x1: -1, x2: 1 };
}

function torsoPoint(f: BodyFrame, h: number, th: number, C: number): [number, number, number] {
  const above = h >= f.crotchH + 3.5;
  const r = above ? f.torsoRing(h) : (() => { const e = hullAt(f, h); return { a: e.a, b: e.b, shape: () => 1, C: ellipseCirc(e) }; })();
  const m = r.shape(th);
  const k = Math.max(C / r.C, 1) + 1.2 / Math.min(r.a, r.b);
  return [r.a * m * Math.cos(th) * k, h, r.b * m * Math.sin(th) * k];
}

const key = (p: Piece, k: string) => p.points.find((q) => q.key === k)?.id;
const tag = (p: Piece, t: string) => p.points.find((q) => q.tag === t);

/** Warm start: copy 3D positions from a previous drape onto the new mesh (nearest pattern point per panel). */
export function warmStart(next: Garment3D, prev: Garment3D) {
  if (next.panels.length !== prev.panels.length) return false;
  for (let k = 0; k < next.panels.length; k++) {
    const a = next.panels[k], b = prev.panels[k];
    if (a.piece.role !== b.piece.role || a.mirror !== b.mirror) return false;
  }
  next.panels.forEach((a, k) => {
    const b = prev.panels[k];
    const buv = b.mesh.uv;
    a.mesh.uv.forEach((p, i) => {
      let best = 0, bd = Infinity;
      for (let j = 0; j < buv.length; j++) {
        const d = (buv[j].x - p.x) ** 2 + (buv[j].y - p.y) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      const s = (b.offset + best) * 3, t = (a.offset + i) * 3;
      next.sim.pos[t] = prev.sim.pos[s]; next.sim.pos[t + 1] = prev.sim.pos[s + 1]; next.sim.pos[t + 2] = prev.sim.pos[s + 2];
    });
  });
  next.sim.prev.set(next.sim.pos);
  next.sim.sewFrames = 4; // already sewn, just settle
  next.sim.frames = 0;
  return true;
}

export function assemble(type: GarmentType, pieces: Piece[], body: Body, spacing = 2.2, collider?: ClothSim['collider']): Garment3D | null {
  const f = bodyFrame(body);
  const front = pieces.find((p) => p.role === 'front');
  const back = pieces.find((p) => p.role === 'back');
  const sleeve = pieces.find((p) => p.role === 'sleeve');
  if (!front || !back) return null;
  const fp = samplePoly(front.points), bp = samplePoly(back.points);

  const insts: (PanelInst & { place: Placer })[] = [];
  let count = 0;
  const add = (piece: Piece, mirror: boolean, place: Placer, mesh?: PanelMesh) => {
    const m = mesh ?? meshPanel(piece.points, spacing);
    insts.push({ piece, mesh: m, offset: count, mirror, place });
    count += m.uv.length;
    return m;
  };
  const seams: [PanelInst, string | undefined, string | undefined, PanelInst, string | undefined, string | undefined][] = [];

  if (type !== 'pants') {
    const fH = tag(front, 'hps')?.y ?? 0, bH = tag(back, 'hps')?.y ?? 0;
    const hps = f.neckH;
    const rowC = (vr: number) => {
      const a = widthSpan(fp, fH + vr), b = widthSpan(bp, bH + vr);
      return (a.x2 - a.x1) + (b.x2 - b.x1);
    };
    const placeTorso = (poly: Pt[], top: number, isBack: boolean): Placer => (u, v) => {
      const span = widthSpan(poly, v);
      const half = Math.max(0.5, (span.x2 - span.x1) / 2);
      const frac = Math.max(-1, Math.min(1, (u - (span.x1 + span.x2) / 2) / half));
      const th = isBack ? (3 * Math.PI) / 2 - frac * (Math.PI / 2) : Math.PI / 2 - frac * (Math.PI / 2);
      const vr = v - top;
      return torsoPoint(f, hps - vr, th, rowC(vr));
    };
    add(front, false, placeTorso(fp, fH, false));
    add(back, false, placeTorso(bp, bH, true));
    const F = insts[0], B = insts[1];
    // right side of the body (+x): front keys without "m" meet back keys with "m"
    seams.push([F, key(front, 'front.2'), key(front, 'front.3'), B, key(back, 'back.2m'), key(back, 'back.3m')]);
    seams.push([F, key(front, 'front.2m'), key(front, 'front.3m'), B, key(back, 'back.2'), key(back, 'back.3')]);
    seams.push([F, key(front, 'front.5'), key(front, 'front.7'), B, key(back, 'back.5m'), key(back, 'back.7m')]);
    seams.push([F, key(front, 'front.5m'), key(front, 'front.7m'), B, key(back, 'back.5'), key(back, 'back.7')]);

    if (sleeve) {
      const sp = samplePoly(sleeve.points);
      const sTop = Math.min(...sleeve.points.map((p) => p.y));
      const capH = (tag(sleeve, 'underarm')?.y ?? 15) - sTop;
      const bicepW = (() => { const s = widthSpan(sp, sTop + capH); return s.x2 - s.x1; })();
      const mesh = meshPanel(sleeve.points, spacing);
      for (const side of [1, -1]) {
        const ca = Math.cos(side * f.armAngle), sa = Math.sin(side * f.armAngle);
        const place: Placer = (u, v) => {
          const vr = v - sTop;
          const s = f.acromionS + vr;
          const span = widthSpan(sp, v);
          const R = vr < capH ? bicepW / TAU : Math.max(0.5, span.x2 - span.x1) / TAU;
          const phi = Math.max(-Math.PI, Math.min(Math.PI, (u - (span.x1 + span.x2) / 2) / R));
          const ar = f.armRing(Math.max(s, -f.armDome * 0.9), side);
          const r = Math.max(R, Math.max(ar.a, ar.b) + 1.2);
          const lx = side * r * Math.cos(phi), lz = r * Math.sin(phi), ly = -s;
          return [f.shoulderJoint.x * side + lx * ca - ly * sa, f.shoulderJoint.y + lx * sa + ly * ca, lz];
        };
        add(sleeve, side < 0, place, mesh);
        const S = insts[insts.length - 1];
        seams.push([S, key(sleeve, 'sleeve.3'), key(sleeve, 'sleeve.4'), S, key(sleeve, 'sleeve.3m'), key(sleeve, 'sleeve.4m')]);
        const fr = side > 0 ? ['front.3', 'front.5'] : ['front.3m', 'front.5m'];
        const br = side > 0 ? ['back.3m', 'back.5m'] : ['back.3', 'back.5'];
        seams.push([S, key(sleeve, 'sleeve.0'), key(sleeve, 'sleeve.3'), F, key(front, fr[0]), key(front, fr[1])]);
        seams.push([S, key(sleeve, 'sleeve.0'), key(sleeve, 'sleeve.3m'), B, key(back, br[0]), key(back, br[1])]);
      }
    }
  } else {
    const fCr = tag(front, 'crotch')?.y ?? 26, bCr = tag(back, 'crotch')?.y ?? 27;
    const legC = (d: number) => {
      const a = widthSpan(fp, fCr + Math.max(d, 1)), b = widthSpan(bp, bCr + Math.max(d, 1));
      return (a.x2 - a.x1) + (b.x2 - b.x1);
    };
    const seatC = (d: number) => {
      const a = widthSpan(fp, fCr + d), b = widthSpan(bp, bCr + d);
      return 2 * ((a.x2 - a.x1) + (b.x2 - b.x1));
    };
    const placeLeg = (poly: Pt[], cr: number, isBack: boolean, side: number): Placer => (u, v) => {
      const d = v - cr;
      const span = widthSpan(poly, v);
      let p: [number, number, number];
      if (d < 0) {
        const frac = Math.max(0, Math.min(1, (span.x2 - u) / Math.max(0.5, span.x2 - span.x1)));
        const th = isBack ? TAU - frac * (Math.PI / 2) : frac * (Math.PI / 2);
        p = torsoPoint(f, f.crotchH - d, th, Math.min(seatC(d), 2 * f.torsoRing(f.hipH).C));
      } else {
        const half = Math.max(0.5, (span.x2 - span.x1) / 2);
        const frac = Math.max(-1, Math.min(1, (u - (span.x1 + span.x2) / 2) / half));
        const th = isBack ? (3 * Math.PI) / 2 + frac * (Math.PI / 2) : Math.PI / 2 - frac * (Math.PI / 2);
        const h = f.crotchH - d;
        const lr = f.legRing(Math.min(h, f.hipJointH + 3), 1);
        const k = Math.max(legC(d) / lr.C, 1) + 1.2 / lr.a;
        const m = lr.shape(th);
        p = [f.legX + lr.a * m * Math.cos(th) * k, h, lr.b * m * Math.sin(th) * k];
      }
      return side > 0 ? p : [-p[0], p[1], p[2]];
    };
    const fm = meshPanel(front.points, spacing), bm = meshPanel(back.points, spacing);
    add(front, false, placeLeg(fp, fCr, false, 1), fm);
    add(front, true, placeLeg(fp, fCr, false, -1), fm);
    add(back, false, placeLeg(bp, bCr, true, 1), bm);
    add(back, true, placeLeg(bp, bCr, true, -1), bm);
    const [FR, FL, BR, BL] = insts;
    for (const [Fp, Bp] of [[FR, BR], [FL, BL]]) {
      seams.push([Fp, key(front, 'front.1'), key(front, 'front.5'), Bp, key(back, 'back.1'), key(back, 'back.5')]); // outseam
      seams.push([Fp, key(front, 'front.6'), key(front, 'front.8'), Bp, key(back, 'back.6'), key(back, 'back.8')]); // inseam
    }
    seams.push([FR, key(front, 'front.8'), key(front, 'front.0'), FL, key(front, 'front.8'), key(front, 'front.0')]); // front rise
    seams.push([BR, key(back, 'back.8'), key(back, 'back.0'), BL, key(back, 'back.8'), key(back, 'back.0')]); // back rise
  }

  // ---- constraints ----
  const stretch: [number, number, number, number][] = [];
  const maxStrain: number[] = [];
  const bend: [number, number, number, number][] = [];
  const limits = new Float32Array(count);
  for (const pi of insts) {
    const fab = fabricById(pi.piece.fabric.id);
    const sc = fab.stretch * 0.3 * H2;
    const bc = (0.05 / (fab.bend * fab.bend)) * H2;
    const { uv, tris } = pi.mesh;
    const o = pi.offset;
    for (let i = 0; i < uv.length; i++) limits[o + i] = fab.stretch;
    const edges = new Map<string, number>(); // edge -> opposite vertex of first triangle
    const len = (a: number, b: number) => Math.hypot(uv[a].x - uv[b].x, uv[a].y - uv[b].y);
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + ((e + 1) % 3)], c = tris[t + ((e + 2) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        const other = edges.get(k);
        if (other === undefined) {
          edges.set(k, c);
          stretch.push([o + a, o + b, len(a, b), sc]);
          maxStrain.push(fab.stretch + 0.01);
        } else {
          bend.push([o + other, o + c, len(other, c), bc]);
        }
      }
    }
  }

  const sew: [number, number][] = [];
  const seen = new Set<string>();
  for (const [A, a0, a1, B, b0, b1] of seams) {
    if (!a0 || !a1 || !b0 || !b1) continue;
    const pa = seamPath(A.mesh, a0, a1), pb = seamPath(B.mesh, b0, b1);
    if (pa.length < 2 || pb.length < 2) continue;
    const ta = pathParams(A.mesh.uv, pa), tb = pathParams(B.mesh.uv, pb);
    const link = (i: number, j: number) => {
      const k = `${i},${j}`;
      if (i === j || seen.has(k)) return;
      seen.add(k);
      sew.push([i, j]);
    };
    const nearest = (ts: number[], t: number) => ts.reduce((bi, v, i) => (Math.abs(v - t) < Math.abs(ts[bi] - t) ? i : bi), 0);
    pa.forEach((v, i) => link(A.offset + v, B.offset + pb[nearest(tb, ta[i])]));
    pb.forEach((v, i) => link(A.offset + pa[nearest(ta, tb[i])], B.offset + v));
  }

  const sim = new ClothSim(count, stretch, bend, sew, { sewCompliance: 0, friction: 0.6, damping: 0.985 });
  maxStrain.forEach((v, i) => (sim.maxStrain[i] = v));
  sim.substeps = SUB;
  for (const pi of insts) {
    pi.mesh.uv.forEach((p, i) => {
      const [x, y, z] = pi.place(p.x, p.y);
      const j = (pi.offset + i) * 3;
      sim.pos[j] = x; sim.pos[j + 1] = y; sim.pos[j + 2] = z;
    });
  }
  sim.prev.set(sim.pos);
  sim.collider = collider ?? new BodyCollider(body);
  // fabric weight: heavier cloth (higher gsm) hangs and folds more under the same stiffness
  const panelOf = new Uint16Array(count), uvs = new Float32Array(count * 2);
  let heaviest = 0;
  insts.forEach((pi, k) => {
    const fab = fabricById(pi.piece.fabric.id);
    heaviest = Math.max(heaviest, fab.gsm);
    pi.mesh.uv.forEach((q, i) => {
      const v = pi.offset + i;
      sim.invMass[v] = Math.min(2, 250 / fab.gsm);
      panelOf[v] = k; uvs[v * 2] = q.x; uvs[v * 2 + 1] = q.y;
    });
  });
  const group = new Int32Array(count).map((_, i) => i);
  const find = (i: number): number => (group[i] === i ? i : (group[i] = find(group[i])));
  for (const [a, b] of sew) group[find(a)] = find(b);
  for (let i = 0; i < count; i++) group[i] = find(i);
  sim.panelOf = panelOf; sim.uv = uvs; sim.seamGroup = group;
  const nearSeam = new Uint8Array(count);
  const sewn = new Set<number>();
  for (const [a, b] of sew) { sewn.add(a); sewn.add(b); }
  for (const pi of insts) {
    const seamPts = [...sewn].filter((v) => v >= pi.offset && v < pi.offset + pi.mesh.uv.length).map((v) => pi.mesh.uv[v - pi.offset]);
    pi.mesh.uv.forEach((q, i) => {
      for (const sp of seamPts) if ((sp.x - q.x) ** 2 + (sp.y - q.y) ** 2 < 9) { nearSeam[pi.offset + i] = 1; break; }
    });
  }
  sim.nearSeam = nearSeam;
  sim.selfRadius = Math.min(spacing * 0.45, 0.5 + heaviest / 1500); // thicker cloth keeps layers further apart
  return { sim, panels: insts.map(({ place: _p, ...rest }) => rest), limits };
}
