// Turns the 2D pattern into a 3D garment shell on the body and measures strain.
//
// Accuracy rules:
// 1. Every garment ring's perimeter equals the pattern circumference at that height exactly
//    (front width + back width for tops, 2 x (front + back) above the crotch and front + back per leg for pants).
// 2. Pattern landmarks sit on body landmarks: top pieces hang from the high point shoulder (HPS),
//    sleeve caps from the shoulder point (acromion), pants from the crotch.
// 3. Strain = body perimeter / garment perimeter - 1, compared with the fabric's safe stretch.
// Where the garment is smaller than the body it is drawn hugging the body (it is being stretched).

import { isSplitFront } from '../data/draft';
import type { Piece, GarmentType } from '../data/presets';
import { fabricById } from '../data/fabrics';
import { migrateGarment, styleById } from '../data/catalog';
import { samplePoly, sliceSpan, type Pt } from '../lib/geometry';
import { findTag } from '../lib/specs';
import { bodyFrame, ellipseCirc, hullAt, perimeter, type BRing, type Body, type BodyFrame, type Shape } from './body';
import type { Ring } from './rings';

export interface ShellPart {
  key: string;
  rings: Ring[];
  strains: number[]; // per ring, strain / safe stretch
  position: [number, number, number];
  rotationZ: number;
  front: Piece['fabric'];
  back: Piece['fabric'];
  refCirc: number;
}

export interface GarmentResult {
  parts: ShellPart[];
  peak: { ratio: number; strain: number; where: string };
}

const STEP = 1;

/** Sample positions from a to b every STEP, plus exact landmark positions (chest line, waist, hip...). */
function samples(a: number, b: number, marks: number[] = []): number[] {
  const out: number[] = [];
  for (let v = a; v <= b + 1e-6; v += STEP) out.push(v);
  for (const m of marks) if (m >= a && m <= b) out.push(m);
  out.sort((p, q) => p - q);
  return out.filter((v, i) => i === 0 || v - out[i - 1] > 0.05);
}
const GAP = 0.3; // cloth thickness off the skin
const TAU = Math.PI * 2;

function widthAt(poly: Pt[], y: number, nearX?: number): number {
  const s = sliceSpan(poly, y, nearX);
  return s ? s.x2 - s.x1 : 0;
}

/** width round the body of a front at y: a split front (cut twice) is twice centre front to side */
function frontWidthAt(front: Piece, poly: Pt[], y: number): number {
  if (!isSplitFront(front)) return widthAt(poly, y);
  const s = sliceSpan(poly, y);
  return s ? 2 * Math.max(0, s.x2) : 0;
}

function limitOf(...pieces: (Piece | undefined)[]) {
  const vals = pieces.filter(Boolean).map((p) => fabricById(p!.fabric.id).stretch);
  return Math.min(...vals, 1);
}

/**
 * Garment ring around a body section. The ring follows the body's cloth profile, scaled so its
 * perimeter is exactly C; anywhere that would cut into the body it is pushed out to the skin.
 */
export function clothRing(body: BRing, C: number | null, clothShape: Shape, y: number, cx = 0) {
  const target = C ?? body.C + 4;
  const s = Math.max(target, body.C * 1.005 + TAU * GAP) / perimeter(body.a, body.b, clothShape, 96);
  const gap = GAP / Math.min(body.a, body.b);
  const shape: Shape = (th) => Math.max(s * clothShape(th), body.shape(th) + gap);
  const strain = C ? body.C / C - 1 : 0;
  return { ring: { y, a: body.a, b: body.b, cx, cz: body.cz, shape } as Ring, strain };
}

function where(f: BodyFrame, h: number) {
  const marks: [string, number][] = [['chest', f.chestH], ['waist', f.waistH], ['hips', f.hipH], ['seat', f.crotchH]];
  return marks.reduce((best, m) => (Math.abs(m[1] - h) < Math.abs(best[1] - h) ? m : best))[0];
}

function torsoBody(f: BodyFrame, h: number): { body: BRing; cloth: Shape } {
  if (h >= f.crotchH + 3.5) {
    const body = f.torsoRing(h);
    return { body, cloth: f.torsoShape(h, true) };
  }
  // below the crotch a top hangs around both thighs: use a smooth hull
  const e = hullAt(f, h);
  const one = () => 1;
  return { body: { a: e.a, b: e.b, shape: one, C: ellipseCirc(e) }, cloth: one };
}

export function buildGarment(type: GarmentType, pieces: Piece[], body: Body): GarmentResult {
  const f = bodyFrame(body);
  const parts: ShellPart[] = [];
  const peak = { ratio: -Infinity, strain: 0, where: '' };
  const track = (ratio: number, strain: number, w: string) => {
    if (ratio > peak.ratio) Object.assign(peak, { ratio, strain, where: w });
  };

  const front = pieces.find((p) => p.role === 'front');
  const back = pieces.find((p) => p.role === 'back');
  const sleeve = pieces.find((p) => p.role === 'sleeve');
  const fam = styleById(migrateGarment(type)).family;
  const top = fam === 'tee' || fam === 'polo' || fam === 'shirt' || fam === 'jacket';

  if (top && front && back) {
    const fp = samplePoly(front.points), bp = samplePoly(back.points);
    // pattern y is measured down from the HPS; the body's HPS is the top of the torso at the neck
    const fTop = findTag(front, 'hps')?.y ?? 0;
    const bTop = findTag(back, 'hps')?.y ?? 0;
    const fUA = (findTag(front, 'underarm')?.y ?? 24) - fTop;
    const bUA = (findTag(back, 'underarm')?.y ?? 24) - bTop;
    const ua = Math.min(fUA, bUA);
    const fHem = (findTag(front, 'hem')?.y ?? 70) - fTop;
    const bHem = (findTag(back, 'hem')?.y ?? 70) - bTop;
    const len = Math.min(fHem, bHem);
    const limit = limitOf(front, back);
    const hps = f.neckH;
    const rings: Ring[] = [];
    const strains: number[] = [];

    const chestC = frontWidthAt(front, fp, fTop + ua) + widthAt(bp, bTop + ua);
    const chestBody = f.torsoRing(hps - ua).C;
    const ease = Math.max(2, chestC - chestBody);

    // yoke: neckline down to the chest line, follows the body plus the chest ease
    for (let y = 0.8; y < ua; y += STEP) {
      const h = hps - y;
      const t = y / ua;
      const { body: br, cloth } = torsoBody(f, h);
      const r = clothRing(br, br.C + 2 + (ease - 2) * t, cloth, h);
      rings.push(r.ring);
      strains.push(0);
    }
    // chest line to hem: exact pattern circumference at every height
    const fWaist = (findTag(front, 'waist')?.y ?? 44) - fTop;
    for (const y of samples(ua, len, [fWaist, len])) {
      const h = hps - y;
      const C = frontWidthAt(front, fp, fTop + y) + widthAt(bp, bTop + y);
      const { body: br, cloth } = torsoBody(f, h);
      const r = clothRing(br, C > 1 ? C : null, cloth, h);
      const ratio = r.strain / limit;
      rings.push(r.ring);
      strains.push(ratio);
      track(ratio, r.strain, where(f, h));
    }
    parts.push({ key: 'torso', rings, strains, position: [0, 0, 0], rotationZ: 0, front: front.fabric, back: back.fabric, refCirc: chestC });

    if (sleeve) {
      const sp = samplePoly(sleeve.points);
      const sTop = Math.min(...sleeve.points.map((p) => p.y));
      const capH = (findTag(sleeve, 'underarm')?.y ?? 15) - sTop;
      const sLen = (findTag(sleeve, 'cuff')?.y ?? 64) - sTop;
      const sLimit = limitOf(sleeve);
      const bicepC = widthAt(sp, sTop + capH);
      for (const side of [1, -1]) {
        const sr: Ring[] = [];
        const ss: number[] = [];
        const capEase = Math.max(2, bicepC - f.armRing(f.acromionS + capH, side).C);
        // cap: sleeve y = 0 sits on the shoulder point; s is distance along the arm from the shoulder joint
        for (let y = -1; y < capH; y += STEP) {
          const s = f.acromionS + y;
          const br = f.armRing(s, side);
          const r = clothRing(br, br.C + capEase * Math.min(1, 0.4 + Math.max(0, y) / capH), br.shape, -s);
          sr.push(r.ring);
          ss.push(0);
        }
        for (const y of samples(capH, sLen, [sLen])) {
          const s = f.acromionS + y;
          const C = widthAt(sp, sTop + y);
          const br = f.armRing(s, side);
          const r = clothRing(br, C > 1 ? C : null, br.shape, -s);
          const ratio = r.strain / sLimit;
          sr.push(r.ring);
          ss.push(ratio);
          track(ratio, r.strain, y < capH + (sLen - capH) * 0.45 ? 'upper arm' : 'forearm');
        }
        parts.push({
          key: 'sleeve' + side, rings: sr, strains: ss,
          position: [side * f.shoulderJoint.x, f.shoulderJoint.y, 0], rotationZ: side * f.armAngle,
          front: sleeve.fabric, back: sleeve.fabric, refCirc: bicepC,
        });
      }
    }
  }

  if (fam === 'pants' && front && back) {
    const fp = samplePoly(front.points), bp = samplePoly(back.points);
    const fCr = findTag(front, 'crotch')?.y ?? 26;
    const bCr = findTag(back, 'crotch')?.y ?? 27;
    const fTop = (findTag(front, 'waistC')?.y ?? 0) - fCr; // negative: waistline above the crotch
    const fHip = (findTag(front, 'hip')?.y ?? fCr - 8) - fCr;
    const fHem = (findTag(front, 'hem')?.y ?? 104) - fCr;
    const bHem = (findTag(back, 'hem')?.y ?? 104) - bCr;
    const len = Math.min(fHem, bHem);
    const limit = limitOf(front, back);

    // seat: both legs together. Below the hip line the crotch extensions wrap between the legs,
    // so the ring there is capped at the hip-line circumference.
    const hipCap = 2 * (widthAt(fp, fCr + fHip) + widthAt(bp, bCr + fHip));
    const rings: Ring[] = [];
    const strains: number[] = [];
    const hipEase = hipCap - torsoBody(f, f.crotchH - fHip).body.C;
    const thighC = widthAt(fp, fCr + 3) + widthAt(bp, bCr + 3);
    for (const d of samples(fTop + 0.3, 0.5, [fHip])) {
      const h = f.crotchH - d;
      const { body: br, cloth } = torsoBody(f, h);
      let C = 2 * (widthAt(fp, fCr + d) + widthAt(bp, bCr + d));
      // below the hip line the seat wraps between the legs, keeping the hip-line ease
      if (d > fHip) {
        C = Math.min(C, br.C + hipEase);
        // near the crotch the seat must also wrap around both leg tubes so the silhouette is continuous
        const t = (d - fHip) / -fHip;
        const legHull = 2 * Math.PI * (thighC / (2 * Math.PI)) + 4 * f.legX;
        C = Math.max(C, br.C + (legHull - br.C) * Math.min(1, Math.max(0, t)) ** 2 * 0.9);
      }
      const r = clothRing(br, C > 1 ? C : null, cloth, h);
      if (d > fHip) {
        // outline of both leg tubes (a capsule around them) so the seat flows into the legs
        const t = Math.min(1, 0.6 + (d - fHip) / -fHip);
        const rl = Math.max(thighC / (2 * Math.PI), f.legRing(h, 1).a + GAP);
        const ax = (f.legX + rl) / r.ring.a, bz = (rl * 1.05) / r.ring.b;
        const base = r.ring.shape!;
        r.ring.shape = (th) => {
          const c2 = Math.cos(th) ** 2;
          return Math.max(base(th), t * (ax * c2 + bz * (1 - c2)));
        };
      }
      const ratio = r.strain / limit;
      rings.push(r.ring);
      strains.push(ratio);
      track(ratio, r.strain, where(f, h));
    }
    parts.push({ key: 'seat', rings, strains, position: [0, 0, 0], rotationZ: 0, front: front.fabric, back: back.fabric, refCirc: hipCap });

    // legs: front leg width + back leg width = leg circumference
    for (const side of [1, -1]) {
      const lr: Ring[] = [];
      const ls: number[] = [];
      for (let d = 0; d <= len + 0.001; d += STEP) {
        const dd = Math.max(d, 1);
        const C = widthAt(fp, fCr + dd) + widthAt(bp, bCr + dd);
        const h = f.crotchH - d;
        const br = f.legRing(Math.min(h, f.hipJointH + 3), side);
        const r = clothRing(br, C > 1 ? C : null, br.shape, h);
        const ratio = r.strain / limit;
        lr.push(r.ring);
        ls.push(ratio);
        track(ratio, r.strain, h > f.kneeH + 10 ? 'thigh' : h > f.kneeH - 8 ? 'knee' : 'calf');
      }
      parts.push({ key: 'leg' + side, rings: lr, strains: ls, position: [side * f.legX, 0, 0], rotationZ: 0, front: front.fabric, back: back.fabric, refCirc: thighC });
    }
  }

  if (peak.ratio === -Infinity) peak.ratio = 0;
  return { parts, peak };
}
