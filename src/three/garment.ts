// Turns the 2D pattern into a simple 3D garment shell around the mannequin and measures strain.
// Phase 1 approach: horizontal slices of the front + back pieces give the garment circumference at each
// height, which is compared to the body circumference at the same height.

import type { Piece, GarmentType } from '../data/presets';
import { fabricById } from '../data/fabrics';
import { samplePoly, sliceSpan, type Pt } from '../lib/geometry';
import { findTag } from '../lib/specs';
import { bodyFrame, ellipseCirc, ellipseFromCirc, hullAt, type Body, type BodyFrame } from './body';
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

const STEP = 1.5;
const GAP = 0.35; // cloth thickness off the skin

function widthAt(poly: Pt[], y: number, nearX?: number): number {
  const s = sliceSpan(poly, y, nearX);
  return s ? s.x2 - s.x1 : 0;
}

function limitOf(...pieces: (Piece | undefined)[]) {
  const vals = pieces.filter(Boolean).map((p) => fabricById(p!.fabric.id).stretch);
  return Math.min(...vals, 1);
}

function torsoRing(f: BodyFrame, h: number, garmentCirc: number | null, limit: number, below = false) {
  const body = below ? hullAt(f, h) : f.torsoAt(h);
  const k = body.b / body.a;
  const bodyC = ellipseCirc(body);
  if (garmentCirc === null) return { ring: { y: h, a: body.a + 1.2, b: body.b + 1.2 }, ratio: 0, strain: 0 };
  const g = ellipseFromCirc(garmentCirc, k);
  const strain = bodyC / garmentCirc - 1;
  const a = Math.max(g.a, body.a + GAP);
  const b = Math.max(g.b, body.b + GAP);
  return { ring: { y: h, a, b }, ratio: strain / limit, strain };
}

function where(f: BodyFrame, h: number) {
  const marks: [string, number][] = [['chest', f.chestH], ['waist', f.waistH], ['hips', f.hipH], ['seat', f.crotchH]];
  return marks.reduce((best, m) => (Math.abs(m[1] - h) < Math.abs(best[1] - h) ? m : best))[0];
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

  if (type !== 'pants' && front && back) {
    const fp = samplePoly(front.points), bp = samplePoly(back.points);
    const fUA = findTag(front, 'underarm')?.y ?? 24;
    const bUA = findTag(back, 'underarm')?.y ?? 24;
    const fHem = (findTag(front, 'hem')?.y ?? 70) - fUA;
    const bHem = (findTag(back, 'hem')?.y ?? 70) - bUA;
    const len = Math.min(fHem, bHem);
    const limit = limitOf(front, back);
    const rings: Ring[] = [];
    const strains: number[] = [];

    // the part from underarm down to the hem follows the pattern exactly
    const chestC = widthAt(fp, fUA) + widthAt(bp, bUA);
    const chestBody = f.torsoAt(f.chestH);
    const chestG = ellipseFromCirc(chestC, chestBody.b / chestBody.a);
    const ease = Math.max(0.5, chestG.a - chestBody.a);
    // above the underarm: follow the body plus the chest ease, up to the neckline
    for (let h = f.neckH - 0.6; h > f.chestH + 0.5; h -= STEP) {
      const e = f.torsoAt(h);
      const t = (h - f.chestH) / (f.neckH - f.chestH);
      const add = ease * (1 - t) + 0.8 * t;
      rings.push({ y: h, a: e.a + add, b: e.b + add * 0.8 });
      strains.push(0);
    }
    for (let d = 0; d <= len + 0.01; d += STEP) {
      const C = widthAt(fp, fUA + d) + widthAt(bp, bUA + d);
      const h = f.chestH - d;
      const r = torsoRing(f, h, C > 1 ? C : null, limit, h < f.torsoBottom);
      rings.push(r.ring);
      strains.push(r.ratio);
      track(r.ratio, r.strain, where(f, h));
    }
    parts.push({ key: 'torso', rings, strains, position: [0, 0, 0], rotationZ: 0, front: front.fabric, back: back.fabric, refCirc: chestC });

    if (sleeve) {
      const sp = samplePoly(sleeve.points);
      const sUA = findTag(sleeve, 'underarm')?.y ?? 15;
      const sLen = (findTag(sleeve, 'cuff')?.y ?? 64) - sUA;
      const sLimit = limitOf(sleeve);
      const s0 = f.armholeDepth;
      const sr: Ring[] = [];
      const ss: number[] = [];
      const bicepC = widthAt(sp, sUA);
      const sEase = Math.max(0.5, bicepC / (2 * Math.PI) - f.armAt(s0));
      for (let s = -f.armAt(0) * 1.1; s < s0; s += STEP) {
        const r = f.armAt(s) + sEase * Math.min(1, (s + f.armAt(0)) / (s0 + f.armAt(0)) + 0.4);
        sr.push({ y: -s, a: r, b: r });
        ss.push(0);
      }
      for (let d = 0; d <= sLen + 0.01; d += STEP) {
        const C = widthAt(sp, sUA + d);
        const s = s0 + d;
        const rb = f.armAt(s);
        const rg = C / (2 * Math.PI);
        const strain = (2 * Math.PI * rb) / Math.max(C, 1) - 1;
        const ratio = strain / sLimit;
        const r = Math.max(rg, rb + GAP);
        sr.push({ y: -s, a: r, b: r });
        ss.push(ratio);
        track(ratio, strain, d < sLen * 0.4 ? 'upper arm' : 'forearm');
      }
      for (const side of [1, -1]) {
        parts.push({
          key: 'sleeve' + side, rings: sr, strains: ss,
          position: [side * f.shoulderJoint.x, f.shoulderJoint.y, 0], rotationZ: side * f.armAngle,
          front: sleeve.fabric, back: sleeve.fabric, refCirc: bicepC,
        });
      }
    }
  }

  if (type === 'pants' && front && back) {
    const fp = samplePoly(front.points), bp = samplePoly(back.points);
    const fc = findTag(front, 'crotch'), bc = findTag(back, 'crotch');
    const fCr = fc?.y ?? 26, bCr = bc?.y ?? 27;
    const fTop = Math.min(...front.points.map((p) => p.y)) - fCr;
    const bTop = Math.min(...back.points.map((p) => p.y)) - bCr;
    const top = Math.max(fTop, bTop); // negative: distance above the crotch
    const fHem = (findTag(front, 'hem')?.y ?? 104) - fCr;
    const bHem = (findTag(back, 'hem')?.y ?? 104) - bCr;
    const len = Math.min(fHem, bHem);
    const limit = limitOf(front, back);

    // seat: both legs together above the crotch
    const rings: Ring[] = [];
    const strains: number[] = [];
    // below the hip line the crotch extension wraps between the legs, so cap the ring at the hip circumference
    const fHip = (findTag(front, 'hip')?.y ?? fCr - 8) - fCr;
    const hipCap = 2 * (widthAt(fp, fCr + fHip) + widthAt(bp, bCr + fHip));
    for (let d = top + 0.5; d <= -2.5; d += STEP) {
      let C = 2 * (widthAt(fp, fCr + d) + widthAt(bp, bCr + d));
      if (d > fHip) C = Math.min(C, hipCap);
      const h = f.crotchH - d;
      const r = torsoRing(f, h, C > 1 ? C : null, limit);
      rings.push(r.ring);
      strains.push(r.ratio);
      track(r.ratio, r.strain, where(f, h));
    }
    const hipC = hipCap;
    parts.push({ key: 'seat', rings, strains, position: [0, 0, 0], rotationZ: 0, front: front.fabric, back: back.fabric, refCirc: hipC });

    // legs
    const lr: Ring[] = [];
    const ls: number[] = [];
    for (let d = -4; d <= len + 0.01; d += STEP) {
      const dd = Math.max(d, 1);
      const C = widthAt(fp, fCr + dd) + widthAt(bp, bCr + dd);
      const h = f.crotchH - d;
      const rb = f.legAt(h);
      const strain = (2 * Math.PI * rb) / Math.max(C, 1) - 1;
      const ratio = strain / limit;
      const r = Math.max(C / (2 * Math.PI), rb + GAP);
      lr.push({ y: h, a: r, b: r });
      ls.push(ratio);
      track(ratio, strain, h > f.kneeH + 10 ? 'thigh' : h > f.kneeH - 8 ? 'knee' : 'calf');
    }
    const thighC = widthAt(fp, fCr + 3) + widthAt(bp, bCr + 3);
    for (const side of [1, -1]) {
      parts.push({ key: 'leg' + side, rings: lr, strains: ls, position: [side * f.legX, 0, 0], rotationZ: 0, front: front.fabric, back: back.fabric, refCirc: thighC });
    }
  }

  if (peak.ratio === -Infinity) peak.ratio = 0;
  return { parts, peak };
}
