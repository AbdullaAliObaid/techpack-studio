// Garment assembly, CLO style: mesh each pattern piece, arrange it around the avatar,
// declare the sewing lines, then let the solver drape it.

import type { GarmentType, Piece } from '../data/presets';
import { fabricById } from '../data/fabrics';
import { migrateGarment, styleById, type Style } from '../data/catalog';
import { frontOffset, RIB } from '../data/draft';
import { samplePoly, sliceSpan, type Pt } from '../lib/geometry';
import { bodyFrame, ellipseCirc, ellipseFromCirc, hullAt, type Body, type BodyFrame } from '../three/body';
import { BodyCollider } from './collider';
import { ClothSim } from './cloth';
import { meshPanel, seamPath, type PanelMesh } from './panels';

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

/** How a piece behaves in the solver: fabric properties, adjusted for its role (rib trims, elastic, stiff brims). */
interface Mech {
  stretch: number; // safe stretch, also the strain limit
  sc: number; // stretch compliance
  bc: number; // bend compliance
  /** rest lengths come from the placed 3D shape instead of the flat pattern (pre-shaped, stiff parts) */
  shaped: boolean;
  /** extra long-range links for a plate that must hold its shape (cap visor) */
  plate: boolean;
  /** bending rest shape comes from the placed 3D shape (a pressed fold line), stretch still from the flat pattern */
  foldBend: boolean;
  /** horizontal rest-length scale (elastic gathering) */
  gather: number;
}

function mechanics(p: Piece, style: Style): Mech {
  const fab = fabricById(p.fabric.id);
  let stretch = fab.stretch, bend = fab.bend, scK = 1, shaped = false, plate = false, gather = 1, foldBend = false;
  const knit = !!style.details.rib;
  const ribTrim = fab.id === 'rib' || (knit && (p.role === 'neckband' || p.role === 'cuff' || (p.role === 'collar' && style.family === 'polo')));
  if (ribTrim) {
    // rib is cut short and stretched on: it may stretch a lot, and springs back about as hard as the body fabric
    stretch = Math.max(stretch, 0.5);
    scK = 0.5;
  }
  if (p.role === 'waistband' && p.elastic) {
    // elastic inside the band: the band relaxes to the elastic length and grips the waist
    const W = Math.max(...p.points.map((q) => q.x)) * 2;
    gather = Math.min(1, p.elastic / W);
    stretch = 0.09; // stretches over the waist (elastic is cut about 5% short), but not over the hips: that holds the pants up
    scK = 0.1; // elastic is much stronger than the fabric it gathers
  }
  if (p.role === 'brim') {
    if (style.family === 'cap') {
      // visor with a pre-curved plastic insert: holds its shape
      stretch = 0.01; scK = 0; bend = 50; shaped = true; plate = true;
    } else {
      // bucket brim: rows of stitching make it stiffer than the crown
      bend = Math.max(bend, 1) * 3; scK = 0.5;
    }
  }
  if (p.role === 'crown' && style.family === 'cap') bend = Math.max(bend, 1) * 2; // structured crown (buckram front)
  if (p.role === 'collar' && style.family === 'shirt') bend *= 2; // interfaced collar
  if (p.role === 'collar' && style.family === 'polo') { foldBend = true; bend = Math.max(bend, 0.4); } // knit collar with a pressed fold
  return { stretch, sc: stretch * 0.3 * scK * H2, bc: (0.05 / (bend * bend)) * H2, shaped, plate, gather, foldBend };
}

export function assemble(type: GarmentType, pieces: Piece[], body: Body, spacing = 2.2, collider?: ClothSim['collider']): Garment3D | null {
  const style = styleById(migrateGarment(type));
  const fam = style.family;
  const f = bodyFrame(body);
  const hat = fam === 'bucket' || fam === 'cap';
  const front = pieces.find((p) => p.role === 'front');
  const back = pieces.find((p) => p.role === 'back');
  const sleeve = pieces.find((p) => p.role === 'sleeve');
  const crown = pieces.find((p) => p.role === 'crown');
  if (hat ? !crown : !front || !back) return null;

  const insts: (PanelInst & { place: Placer; shape?: Placer })[] = [];
  let count = 0;
  /** place: where each pattern point starts; shape: the rest shape of a pre-shaped part (defaults to place) */
  const add = (piece: Piece, mirror: boolean, place: Placer, mesh?: PanelMesh, shape?: Placer) => {
    const m = mesh ?? meshPanel(piece.points, spacing);
    insts.push({ piece, mesh: m, offset: count, mirror, place, shape });
    count += m.uv.length;
    return insts[insts.length - 1];
  };
  type Side = [PanelInst, string | undefined, string | undefined][];
  const seams: [PanelInst, string | undefined, string | undefined, PanelInst, string | undefined, string | undefined][] = [];
  const multi: [Side, Side][] = []; // one edge sewn along several pieces in a row (waistband, collar, cuff, hat band)
  // seam lines allowed to pass inside the body: the upper inseam lies between thighs that touch on most bodies
  const between: Side[] = [];
  const freePanels = new Set<PanelInst>(); // pieces that do not collide with the body (a visor is held by its band)

  if (fam === 'pants') assemblePants();
  else if (hat) assembleHat();
  else assembleTop();

  function assembleTop() {
    const fr = front!, bk = back!;
    const fp = samplePoly(fr.points), bp = samplePoly(bk.points);
    const fo = frontOffset(style.id);
    const FK = (i: number, m = '') => key(fr, `front.${i + fo}${m}`);
    const BK = (i: number, m = '') => key(bk, `back.${i}${m}`);
    const fH = tag(fr, 'hps')?.y ?? 0, bH = tag(bk, 'hps')?.y ?? 0;
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
    const frontPlace = placeTorso(fp, fH, false);
    const F = add(fr, false, frontPlace);
    const B = add(bk, false, placeTorso(bp, bH, true));
    // right side of the body (+x): front keys without "m" meet back keys with "m"
    seams.push([F, FK(2), FK(3), B, BK(2, 'm'), BK(3, 'm')]);
    seams.push([F, FK(2, 'm'), FK(3, 'm'), B, BK(2), BK(3)]);
    seams.push([F, FK(5), FK(7), B, BK(5, 'm'), BK(7, 'm')]);
    seams.push([F, FK(5, 'm'), FK(7, 'm'), B, BK(5), BK(7)]);

    const sleeveInst: Record<number, PanelInst> = {};
    if (sleeve) {
      const sp = samplePoly(sleeve.points);
      const sTop = Math.min(...sleeve.points.map((p) => p.y));
      const capH = (tag(sleeve, 'underarm')?.y ?? 15) - sTop;
      const bicepW = (() => { const s = widthSpan(sp, sTop + capH); return s.x2 - s.x1; })();
      // a dropped shoulder puts the sleeve seam that far down the arm
      const drop = Math.max(0, (tag(fr, 'shoulder')?.x ?? 0) - body.shoulder / 2 - 1);
      const mesh = meshPanel(sleeve.points, spacing);
      for (const side of [1, -1]) {
        const ca = Math.cos(side * f.armAngle), sa = Math.sin(side * f.armAngle);
        const place: Placer = (u, v) => {
          const vr = v - sTop;
          const s = f.acromionS + drop + vr;
          const span = widthSpan(sp, v);
          const R = vr < capH ? bicepW / TAU : Math.max(0.5, span.x2 - span.x1) / TAU;
          const phi = Math.max(-Math.PI, Math.min(Math.PI, (u - (span.x1 + span.x2) / 2) / R));
          const ar = f.armRing(Math.max(s, -f.armDome * 0.9), side);
          const r = Math.max(R, Math.max(ar.a, ar.b) + 1.2);
          const lx = side * r * Math.cos(phi), lz = r * Math.sin(phi), ly = -s;
          return [f.shoulderJoint.x * side + lx * ca - ly * sa, f.shoulderJoint.y + lx * sa + ly * ca, lz];
        };
        const S = add(sleeve, side < 0, place, mesh);
        sleeveInst[side] = S;
        seams.push([S, key(sleeve, 'sleeve.3'), key(sleeve, 'sleeve.4'), S, key(sleeve, 'sleeve.3m'), key(sleeve, 'sleeve.4m')]);
        const fa = side > 0 ? [FK(3), FK(5)] : [FK(3, 'm'), FK(5, 'm')];
        const ba = side > 0 ? [BK(3, 'm'), BK(5, 'm')] : [BK(3), BK(5)];
        seams.push([S, key(sleeve, 'sleeve.0'), key(sleeve, 'sleeve.3'), F, fa[0], fa[1]]);
        seams.push([S, key(sleeve, 'sleeve.0'), key(sleeve, 'sleeve.3m'), B, ba[0], ba[1]]);
      }
    }

    // ---- neckline trims: neckband, collar, placket ----
    const fND = tag(fr, 'hps') ? (fr.points.find((q) => q.key === `front.${fo}`)?.y ?? 8) - fH : 8;
    const nr = f.neckRing(f.neckH + 1);
    const neckDepth = (th: number) => fND * Math.max(0, Math.sin(th)) ** 1.5 + 2 * Math.max(0, -Math.sin(th));
    const placket = pieces.find((p) => p.role === 'placket');
    let PL: PanelInst | null = null;
    if (placket) {
      const top = fr.points.find((q) => q.key === 'front.2')?.y ?? 0;
      PL = add(placket, false, (u, v) => {
        const p = frontPlace(u, top + v);
        return [p[0], p[1], p[2] + 0.35];
      });
      seams.push([PL, key(placket, 'placket.1'), key(placket, 'placket.2'), F, key(fr, 'front.2'), key(fr, 'front.1')]);
      seams.push([PL, key(placket, 'placket.1m'), key(placket, 'placket.2m'), F, key(fr, 'front.2m'), key(fr, 'front.1m')]);
      seams.push([PL, key(placket, 'placket.2'), key(placket, 'placket.2m'), F, key(fr, 'front.1'), key(fr, 'front.1m')]);
    }
    const band = pieces.find((p) => p.role === 'neckband');
    if (band) {
      const L = Math.max(...band.points.map((p) => p.x)) * 2;
      const neckLen = L / RIB.neckband;
      const NB = add(band, false, (u, v) => {
        const th = Math.PI / 2 - (u / L) * TAU; // centre front at u = 0, the join at centre back
        const r = Math.max(neckLen / TAU, Math.max(nr.a, nr.b) + 1.2);
        return [r * Math.cos(th), f.neckH - neckDepth(th) + v, (nr.cz ?? 0) + r * 0.95 * Math.sin(th)];
      });
      multi.push([
        [[NB, key(band, 'neckband.1'), key(band, 'neckband.1m')]],
        [[B, BK(0), BK(2, 'm')], [F, FK(2), FK(0)], [F, FK(0), FK(2, 'm')], [B, BK(2), BK(0)]],
      ]);
      seams.push([NB, key(band, 'neckband.1'), key(band, 'neckband.2'), NB, key(band, 'neckband.1m'), key(band, 'neckband.2m')]);
    }
    const collar = pieces.find((p) => p.role === 'collar');
    if (collar) {
      const L = Math.max(...collar.points.map((p) => p.x)) * 2;
      const knit = fam === 'polo';
      const C = add(collar, false, (u, v) => {
        const th = Math.PI / 2 - ((L / 2 - u) / L) * TAU; // tips at centre front, centre of the collar at centre back
        const r0 = Math.max(L / TAU, Math.max(nr.a, nr.b) + 1.2);
        if (!knit) return [(r0 + 0.15 * v) * Math.cos(th), f.neckH - neckDepth(th) + v * 0.9, (nr.cz ?? 0) + (r0 + 0.15 * v) * Math.sin(th)];
        // knit collar: a short stand, then it folds over and the fall lies down over the stand and the neckline
        const stand = Math.min(v, 2.5), fall = Math.max(0, v - 2.5);
        const fold = Math.min(1, fall / 0.8); // round over the fold line
        const r = r0 + 0.1 * stand + 0.6 * fold + 0.15 * fall;
        return [r * Math.cos(th), f.neckH - neckDepth(th) + stand + 0.3 * fold - 0.95 * fall, (nr.cz ?? 0) + r * Math.sin(th)];
      });
      const neck: Side = [[F, FK(0), FK(2)], [B, BK(2, 'm'), BK(0)], [B, BK(0), BK(2)], [F, FK(2, 'm'), FK(0)]];
      if (PL && placket) {
        // polo: the collar runs from the middle of the placket, round the neck, back to the middle of the placket
        neck.unshift([PL, key(placket, 'placket.0'), key(placket, 'placket.1')]);
        neck.push([PL, key(placket, 'placket.1m'), key(placket, 'placket.0')]);
      }
      multi.push([[[C, key(collar, 'collar.1'), key(collar, 'collar.1m')]], neck]);
    }
    const cuff = pieces.find((p) => p.role === 'cuff');
    if (fam === 'shirt' && cuff && sleeve) {
      const cw = Math.max(...cuff.points.map((p) => p.x)) * 2;
      const sTop = Math.min(...sleeve.points.map((p) => p.y));
      const sEnd = (tag(sleeve, 'cuff')?.y ?? 60) - sTop;
      for (const side of [1, -1]) {
        const S = sleeveInst[side];
        if (!S) continue;
        const ca = Math.cos(side * f.armAngle), sa = Math.sin(side * f.armAngle);
        const place: Placer = (u, v) => {
          const s = f.acromionS + sEnd + v;
          const R = cw / TAU;
          const ar = f.armRing(s, side);
          const r = Math.max(R, Math.max(ar.a, ar.b) + 0.8);
          const phi = Math.max(-Math.PI, Math.min(Math.PI, u / R));
          const lx = side * r * Math.cos(phi), lz = r * Math.sin(phi), ly = -s;
          return [f.shoulderJoint.x * side + lx * ca - ly * sa, f.shoulderJoint.y + lx * sa + ly * ca, lz];
        };
        const K = add(cuff, side < 0, place);
        multi.push([[[K, key(cuff, 'cuff.1'), key(cuff, 'cuff.1m')]], [[S, key(sleeve, 'sleeve.4'), key(sleeve, 'sleeve.4m')]]]);
        seams.push([K, key(cuff, 'cuff.1'), key(cuff, 'cuff.2'), K, key(cuff, 'cuff.1m'), key(cuff, 'cuff.2m')]);
      }
    }
  }

  function assemblePants() {
    const fr = front!, bk = back!;
    const fp = samplePoly(fr.points), bp = samplePoly(bk.points);
    const fCr = tag(fr, 'crotch')?.y ?? 26, bCr = tag(bk, 'crotch')?.y ?? 27;
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
        // the fork of the inseam starts a little below the crotch, in the crease between the thighs, where front and back can meet
        const inner = Math.max(0, -Math.cos(th)) ** 2 * Math.max(0, 1 - d / 6);
        const h = Math.max(0.5, f.crotchH - d - 5 * inner);
        const lr = f.legRing(Math.min(h, f.hipJointH + 3), 1);
        const k = Math.max(legC(d) / lr.C, 1) + 1.2 / lr.a;
        const m = lr.shape(th);
        // a wide leg starts flattened against the centre line rather than inside the other leg
        p = [Math.max(0.4, f.legX + lr.a * m * Math.cos(th) * k), h, lr.b * m * Math.sin(th) * k];
      }
      return side > 0 ? p : [-p[0], p[1], p[2]];
    };
    const fm = meshPanel(fr.points, spacing), bm = meshPanel(bk.points, spacing);
    const FR = add(fr, false, placeLeg(fp, fCr, false, 1), fm);
    const FL = add(fr, true, placeLeg(fp, fCr, false, -1), fm);
    const BR = add(bk, false, placeLeg(bp, bCr, true, 1), bm);
    const BL = add(bk, true, placeLeg(bp, bCr, true, -1), bm);
    for (const [Fp, Bp] of [[FR, BR], [FL, BL]]) {
      seams.push([Fp, key(fr, 'front.1'), key(fr, 'front.5'), Bp, key(bk, 'back.1'), key(bk, 'back.5')]); // outseam
      seams.push([Fp, key(fr, 'front.6'), key(fr, 'front.8'), Bp, key(bk, 'back.6'), key(bk, 'back.8')]); // inseam
      between.push([[Fp, key(fr, 'front.6'), key(fr, 'front.8')]], [[Bp, key(bk, 'back.6'), key(bk, 'back.8')]]);
    }
    seams.push([FR, key(fr, 'front.8'), key(fr, 'front.0'), FL, key(fr, 'front.8'), key(fr, 'front.0')]); // front rise
    seams.push([BR, key(bk, 'back.8'), key(bk, 'back.0'), BL, key(bk, 'back.8'), key(bk, 'back.0')]); // back rise

    const band = pieces.find((p) => p.role === 'waistband');
    if (band) {
      const W = Math.max(...band.points.map((p) => p.x)) * 2;
      const bandH = Math.max(...band.points.map((p) => p.y));
      // the band sits on top of the leg pieces: its top is the rise above the crotch plus the band height
      const legTop = f.crotchH + (fCr - (tag(fr, 'waistC')?.y ?? 0));
      const top = legTop + bandH;
      const WB = add(band, false, (u, v) => {
        const th = Math.PI / 2 - ((u + W / 2) / W) * TAU; // starts at centre front, runs round the right side
        return torsoPoint(f, top - v * (1 - 0.02), th, W);
      });
      multi.push([
        [[WB, key(band, 'waistband.2m'), key(band, 'waistband.2')]],
        [[FR, key(fr, 'front.0'), key(fr, 'front.1')], [BR, key(bk, 'back.1'), key(bk, 'back.0')], [BL, key(bk, 'back.0'), key(bk, 'back.1')], [FL, key(fr, 'front.1'), key(fr, 'front.0')]],
      ]);
      seams.push([WB, key(band, 'waistband.1'), key(band, 'waistband.2'), WB, key(band, 'waistband.1m'), key(band, 'waistband.2m')]);
    }
    const cuff = pieces.find((p) => p.role === 'cuff');
    if (cuff) {
      const c = Math.max(...cuff.points.map((p) => p.x)) * 2;
      const hemH = f.crotchH - ((tag(fr, 'hem')?.y ?? 90) - fCr);
      const cm = meshPanel(cuff.points, spacing);
      for (const [side, Fp, Bp] of [[1, FR, BR], [-1, FL, BL]] as [number, PanelInst, PanelInst][]) {
        const K = add(cuff, side < 0, (u, v) => {
          const th = ((c / 2 - u) / c) * TAU; // the join sits on the outseam
          const h = Math.max(0.5, hemH - v);
          const lr = f.legRing(h, 1);
          const r = Math.max(c / TAU, Math.max(lr.a, lr.b) + 0.8);
          return [side * (f.legX + r * Math.cos(th)), h, r * Math.sin(th)];
        }, cm);
        multi.push([[[K, key(cuff, 'cuff.1'), key(cuff, 'cuff.1m')]], [[Fp, key(fr, 'front.5'), key(fr, 'front.6')], [Bp, key(bk, 'back.6'), key(bk, 'back.5')]]]);
        seams.push([K, key(cuff, 'cuff.1'), key(cuff, 'cuff.2'), K, key(cuff, 'cuff.1m'), key(cuff, 'cuff.2m')]);
      }
    }
  }

  function assembleHat() {
    const cr = crown!;
    const gp = samplePoly(cr.points);
    const Hg = Math.max(...cr.points.map((p) => p.y));
    const W = 6 * 2 * (tag(cr, 'band')?.x ?? 9.5);
    const e = ellipseFromCirc(W, f.headK);
    const brim = pieces.find((p) => p.role === 'brim');
    // a cap band sits on exactly the visor's inner curve (the rigid visor and the band must agree); a bucket band a touch off the head
    const visorEnd = fam === 'cap' && brim ? Math.max(...brim.points.filter((q) => q.tag === 'visorEnd').map((q) => q.x)) : 0;
    const A = visorEnd || e.a + 0.25, B = visorEnd ? brim!.points[0].y : e.b + 0.25, yb = f.headBandH, cz = f.headCz;
    // starting dome built from the panel itself (radius from the panel width, height from the seam length),
    // so the crown starts at its own sewn shape and settles onto the head without being squeezed
    const R0 = W / TAU, N = 64;
    const prof: { r: number; y: number }[] = [];
    for (let i = 0; i <= N; i++) {
      const v = (i / N) * Hg, sp = widthSpan(gp, Math.min(v, Hg - 1e-3));
      prof.push({ r: i === 0 ? 0 : (6 * (sp.x2 - sp.x1)) / TAU, y: 0 });
    }
    prof[N].r = R0;
    for (let i = N - 1; i >= 0; i--) {
      const dv = Hg / N, dr = prof[i].r - prof[i + 1].r;
      prof[i].y = prof[i + 1].y + Math.sqrt(Math.max(0.05 * dv * dv, dv * dv - dr * dr));
    }
    // start clear of the head everywhere (contact during the gravity-free sewing phase would launch the hat)
    const lift = Math.max(1, f.H + 1 - (yb + prof[0].y));
    const sx = (A + 0.6) / R0, sz = (B + 0.6) / R0;
    const gm = meshPanel(cr.points, spacing);
    const G: PanelInst[] = [];
    for (let k = 0; k < 6; k++) {
      // panel centres every 60 degrees with a seam at centre front; pattern +x runs towards the wearer's left (+x)
      const thk = Math.PI / 2 - Math.PI / 6 - (k * Math.PI) / 3;
      G.push(add(cr, false, (u, v) => {
        const span = widthSpan(gp, v);
        const hw = Math.max(0.3, (span.x2 - span.x1) / 2);
        const th = thk - Math.max(-1, Math.min(1, u / hw)) * (Math.PI / 6);
        const fi = Math.max(0, Math.min(N, (v / Hg) * N)), i0 = Math.min(N - 1, Math.floor(fi)), t = fi - i0;
        const r = prof[i0].r + (prof[i0 + 1].r - prof[i0].r) * t, y = prof[i0].y + (prof[i0 + 1].y - prof[i0].y) * t;
        return [r * sx * Math.cos(th), yb + lift + y, cz + r * sz * Math.sin(th)];
      }, gm));
    }
    for (let k = 0; k < 6; k++) {
      seams.push([G[k], key(cr, 'crown.0'), key(cr, 'crown.3'), G[(k + 1) % 6], key(cr, 'crown.0'), key(cr, 'crown.3m')]);
    }
    const base = (k: number): Side => [[G[k], key(cr, 'crown.3m'), key(cr, 'crown.4')], [G[k], key(cr, 'crown.4'), key(cr, 'crown.3')]];
    if (!brim) return;
    if (fam === 'bucket') {
      const end = brim.points.find((q) => q.key === 'brim.6')!;
      const r1 = Math.hypot(brim.points[0].x, brim.points[0].y);
      const half = Math.atan2(end.x, end.y); // half the sector angle
      const cosA = Math.min(1, half / Math.PI); // sector angle / 2 pi = cos(slope)
      const sinA = Math.sqrt(1 - cosA * cosA);
      const BR = add(brim, false, (u, v) => {
        const r = Math.hypot(u, v), ps = Math.atan2(u, v);
        const th = Math.PI / 2 - ps * (Math.PI / half);
        const s = Math.max(0, r - r1);
        return [(A + 0.6 + s * cosA) * Math.cos(th), yb + lift - s * sinA, cz + (B + 0.6 + s * cosA) * Math.sin(th)];
      });
      multi.push([
        [[BR, key(brim, 'brim.0'), key(brim, 'brim.6')], [BR, key(brim, 'brim.6m'), key(brim, 'brim.0')]],
        [0, 1, 2, 3, 4, 5].flatMap(base),
      ]);
      seams.push([BR, key(brim, 'brim.6'), key(brim, 'brim.7'), BR, key(brim, 'brim.6m'), key(brim, 'brim.7m')]);
    } else {
      const visor = (grow: number, up: number): Placer => (u, v) => {
        const xi = Math.max(-1, Math.min(1, u / A));
        const d = Math.max(0, v - B * Math.sqrt(1 - xi * xi)); // distance out from the band
        return [u * (A + grow) / A, yb + up - d * (0.16 + 0.35 * xi * xi), cz + v * (B + grow) / B];
      };
      // rest shape on the exact band curve; it starts a little out and up, with the crown
      const BR = add(brim, false, visor(0.6, lift), undefined, visor(0, 0));
      freePanels.add(BR);
      // the visor covers the front half of the band: from the middle of the left side panel to the middle of the right one
      multi.push([
        [[BR, key(brim, 'brim.3m'), key(brim, 'brim.0')], [BR, key(brim, 'brim.0'), key(brim, 'brim.3')]],
        [base(4)[1], ...base(5), ...base(0), base(1)[0]],
      ]);
    }
  }

  // ---- initial placement ----
  const init = new Float32Array(count * 3);
  for (const pi of insts) {
    pi.mesh.uv.forEach((p, i) => {
      const [x, y, z] = pi.place(p.x, p.y);
      const j = (pi.offset + i) * 3;
      init[j] = x; init[j + 1] = y; init[j + 2] = z;
    });
  }

  // ---- constraints ----
  const stretch: [number, number, number, number][] = [];
  const maxStrain: number[] = [];
  const bend: [number, number, number, number][] = [];
  const limits = new Float32Array(count);
  // an elastic waist gathers the top of the legs too: the fabric there takes up the extra length in small folds
  const band = pieces.find((p) => p.role === 'waistband' && p.elastic);
  const bandGather = band ? Math.min(1, band.elastic! / (Math.max(...band.points.map((q) => q.x)) * 2)) : 1;
  for (const pi of insts) {
    const M = mechanics(pi.piece, style);
    const { uv, tris } = pi.mesh;
    const o = pi.offset;
    const legTop = Math.min(...pi.piece.points.map((q) => q.y));
    const shirr = bandGather < 1 && (pi.piece.role === 'front' || pi.piece.role === 'back')
      ? (y: number) => bandGather + (1 - bandGather) * Math.min(1, Math.max(0, (y - legTop) / 8))
      : null;
    for (let i = 0; i < uv.length; i++) limits[o + i] = M.stretch;
    const edges = new Map<string, number>(); // edge -> opposite vertex of first triangle
    const len = (a: number, b: number) => {
      if (M.shaped) {
        const sh = pi.shape ?? pi.place;
        const p = sh(uv[a].x, uv[a].y), q = sh(uv[b].x, uv[b].y);
        return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      }
      const g = shirr ? shirr((uv[a].y + uv[b].y) / 2) : M.gather;
      return Math.hypot((uv[a].x - uv[b].x) * g, uv[a].y - uv[b].y);
    };
    for (let t = 0; t < tris.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = tris[t + e], b = tris[t + ((e + 1) % 3)], c = tris[t + ((e + 2) % 3)];
        const k = a < b ? `${a},${b}` : `${b},${a}`;
        const other = edges.get(k);
        if (other === undefined) {
          edges.set(k, c);
          stretch.push([o + a, o + b, len(a, b), M.sc]);
          maxStrain.push(M.stretch + 0.01);
        } else {
          // a pressed fold only shortens the distance across an edge; spreading in the start shape does not count
          const rest = M.foldBend ? (() => { const P = pi.place(uv[other].x, uv[other].y), Q = pi.place(uv[c].x, uv[c].y); return Math.min(len(other, c), Math.hypot(P[0] - Q[0], P[1] - Q[1], P[2] - Q[2])); })() : len(other, c);
          bend.push([o + other, o + c, rest, M.bc]);
        }
      }
    }
    if (M.plate) {
      // a stiff plate: tie every point to its neighbours a few cm away, keeping the pre-curved shape
      for (let a = 0; a < uv.length; a++) for (let b = a + 1; b < uv.length; b++) {
        const d2 = (uv[a].x - uv[b].x) ** 2 + (uv[a].y - uv[b].y) ** 2;
        if (d2 > (1.6 * spacing) ** 2 && d2 < (3.4 * spacing) ** 2) bend.push([o + a, o + b, len(a, b), 0]);
      }
    }
  }

  const sew: [number, number][] = [];
  const seen = new Set<string>();
  // a side is one or more piece edges in a row; both sides are matched by arc length, so ease or
  // gathering (sleeve cap, cuff pleat, rib trims) is spread evenly along the seam
  const sideVerts = (side: Side) => {
    const verts: number[] = [];
    const uvs: Pt[] = [];
    for (const [P, a, b] of side) {
      if (!a || !b) return null;
      const path = seamPath(P.mesh, a, b);
      if (path.length < 2) return null;
      for (const v of path) { verts.push(P.offset + v); uvs.push(P.mesh.uv[v]); }
    }
    // arc length over the whole side (piece-to-piece jumps add nothing)
    const t = [0];
    for (let i = 1; i < verts.length; i++) {
      const d = Math.hypot(uvs[i].x - uvs[i - 1].x, uvs[i].y - uvs[i - 1].y);
      t.push(t[i - 1] + (d > 3 * spacing ? 0 : d));
    }
    const L = t[t.length - 1] || 1;
    return { verts, t: t.map((x) => x / L) };
  };
  const all: [Side, Side][] = [...seams.map(([A, a0, a1, B, b0, b1]) => [[[A, a0, a1]], [[B, b0, b1]]] as [Side, Side]), ...multi];
  for (const [sa, sb] of all) {
    const A = sideVerts(sa), B = sideVerts(sb);
    if (!A || !B) continue;
    const link = (i: number, j: number) => {
      const k = `${i},${j}`;
      if (i === j || seen.has(k)) return;
      seen.add(k);
      sew.push([i, j]);
    };
    const nearest = (ts: number[], t: number) => ts.reduce((bi, v, i) => (Math.abs(v - t) < Math.abs(ts[bi] - t) ? i : bi), 0);
    A.verts.forEach((v, i) => link(v, B.verts[nearest(B.t, A.t[i])]));
    B.verts.forEach((v, i) => link(A.verts[nearest(A.t, B.t[i])], v));
  }

  const sim = new ClothSim(count, stretch, bend, sew, { sewCompliance: 0, friction: 0.35, damping: 0.985 });
  maxStrain.forEach((v, i) => (sim.maxStrain[i] = v));
  sim.substeps = SUB;
  // hat pieces start in place, practically sewn: gravity and friction from the start keep them seated on the head
  if (hat) sim.sewFrames = 6;
  sim.pos.set(init);
  sim.prev.set(sim.pos);
  // body contact per particle: 0 normal, 1 none (a visor is held off the body by its band),
  // 2 may sink up to 3.5 cm (the inseam fork and upper inseam lie in the crease between thighs that touch on most bodies)
  const contact = new Uint8Array(count);
  for (const P of freePanels) contact.fill(1, P.offset, P.offset + P.mesh.uv.length);
  // a strip a few cm wide along those seams, so the cloth can fold into the crease
  for (const side of between) for (const [P, a, b] of side) {
    if (!a || !b) continue;
    const seamUv = seamPath(P.mesh, a, b).filter((v) => { const y = init[(P.offset + v) * 3 + 1]; return y > f.crotchH - 25 && y < f.crotchH + 2; }).map((v) => P.mesh.uv[v]);
    P.mesh.uv.forEach((q, v) => {
      for (const s of seamUv) if ((s.x - q.x) ** 2 + (s.y - q.y) ** 2 < 16) { contact[P.offset + v] = 2; break; }
    });
  }
  // 3: rubber elastic grips the skin much harder than fabric (the solver's friction scales with contact depth)
  if (band) for (const P of insts) if (P.piece === band) contact.fill(3, P.offset, P.offset + P.mesh.uv.length);
  const body3d = (collider ?? new BodyCollider(body)) as NonNullable<ClothSim['collider']> & { thickness: number };
  sim.collider = contact.some((v) => v)
    ? {
      project: (p, j, out) => {
        const c = contact[j / 3];
        if (c === 1) { out.depth = 0; return false; }
        if (c === 0) return body3d.project(p, j, out);
        if (c === 3) { const hit = body3d.project(p, j, out); out.depth *= 6; return hit; }
        const t = body3d.thickness;
        body3d.thickness = -3.5;
        const hit = body3d.project(p, j, out);
        body3d.thickness = t;
        return hit;
      },
    }
    : body3d;
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
  // the cloth folded into the crease between the thighs is out of sight: layers there may overlap freely
  for (let i = 0; i < count; i++) if (contact[i] === 2) nearSeam[i] = 1;
  sim.nearSeam = nearSeam;
  sim.selfRadius = Math.min(spacing * 0.45, 0.5 + heaviest / 1500); // thicker cloth keeps layers further apart
  return { sim, panels: insts.map(({ place: _p, shape: _s, ...rest }) => rest), limits };
}
