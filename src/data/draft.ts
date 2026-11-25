// Pattern drafting from body measurements, the way a tailor drafts a block:
// every key point is body measurement + ease, so the 2D numbers always trace back to the body.
// All values in cm. Tops are drawn as full front / full back pieces (centre line at x = 0).
// Pants are drawn as single leg pieces with the grainline (crease) at x = 0.

import type { PPoint } from '../lib/geometry';
import { bodyFrame, type Body, type BodyFrame } from '../three/body';
import type { GarmentType } from './presets';

const TAU = Math.PI * 2;

/** Ease = how much bigger the garment is than the body, in cm of circumference (or length). */
export const EASE = {
  jacket: { chest: 10, waist: 14, hem: 8, neck: 4, armhole: 3, bicep: 12, cuff: 14, sleeve: 3, length: 3, shoulder: 1 },
  shirt: { chest: 10, waist: 12, hem: 6, neck: 2, armhole: 2, bicep: 9, cuff: 9, sleeve: 1, length: 5, shoulder: 0 },
  pants: { waist: 2, hip: 6, thigh: 0, knee: 14, legOpening: 18 },
};

/** Body girths that are not typed in but estimated from the typed ones (same formulas the 3D body uses). */
export function derivedGirths(b: Body) {
  return {
    bicep: b.chest * 0.31,
    wrist: b.neck * 0.42,
    thigh: b.hips * 0.575,
    knee: b.hips * 0.365,
    ankle: b.hips * 0.215,
  };
}

type P = [number, number, boolean?, string?, string?]; // x, y, smooth, tag, key/pair

export interface DraftPiece {
  role: string;
  points: PPoint[];
}

let seq = 0;
const nid = () => 'p' + (++seq).toString(36) + Math.random().toString(36).slice(2, 6);

/** Symmetric piece from its right half: first and last points sit on the centre line. */
function half(role: string, pts: P[]): PPoint[] {
  const right: PPoint[] = pts.map(([x, y, s, tag], i) => ({ id: nid(), key: `${role}.${i}`, x, y, smooth: !!s, mirror: null, tag }));
  const out = [...right];
  for (let i = pts.length - 2; i >= 1; i--) {
    const r = right[i];
    const m: PPoint = { id: nid(), key: `${role}.${i}m`, x: -r.x, y: r.y, smooth: r.smooth, mirror: r.id, tag: r.tag };
    r.mirror = m.id;
    out.push(m);
  }
  right[0].mirror = right[0].id;
  right[right.length - 1].mirror = right[right.length - 1].id;
  return out;
}

/** Free outline (pants legs); points sharing a pair name mirror across the grainline. */
function free(role: string, pts: P[]): PPoint[] {
  const out: PPoint[] = pts.map(([x, y, s, tag], i) => ({ id: nid(), key: `${role}.${i}`, x, y, smooth: !!s, mirror: null, tag }));
  const pairs: Record<string, PPoint[]> = {};
  pts.forEach((p, i) => p[4] && (pairs[p[4]] ??= []).push(out[i]));
  for (const [a, c] of Object.values(pairs)) if (a && c) { a.mirror = c.id; c.mirror = a.id; }
  return out;
}

function tops(type: 'jacket' | 'shirt', b: Body, f: BodyFrame): DraftPiece[] {
  const E = EASE[type];
  const g = derivedGirths(b);
  const hps = f.neckH; // high point shoulder height on the body; pattern y = 0 sits here
  const uaY = hps - f.chestH + E.armhole; // chest line, a little below the armpit
  const waistY = hps - f.waistH;
  const len = hps - f.crotchH + E.length;
  const xC = (b.chest + E.chest) / 4;
  const xW = (b.waist + E.waist) / 4;
  const xH = (b.hips + E.hem) / 4;
  const xN = (b.neck + E.neck) / TAU + 0.9;
  const slope = 0.026 * b.height;
  const xS = b.shoulder / 2 + E.shoulder / 2;
  const midY = (slope + uaY) / 2 + 1;
  const fND = xN + 1.5; // front neck depth
  const bND = 2; // back neck depth

  const tail: P[] = type === 'shirt' ? [[xH * 0.5, len + 4.5, true], [0, len + 6, true]] : [[0, len]];
  const tailB: P[] = type === 'shirt' ? [[xH * 0.5, len + 6.5, true], [0, len + 8, true]] : [[0, len]];

  const front = half('front', [
    [0, fND, true], [xN * 0.55, fND * 0.8, true], [xN, 0, false, 'hps'], [xS, slope, false, 'shoulder'],
    [xS - 1.8, midY, true], [xC, uaY, false, 'underarm'], [xW, waistY, true, 'waist'], [xH, len, false, 'hem'], ...tail,
  ]);
  const back = half('back', [
    [0, bND, true], [xN * 0.55, bND * 0.8, true], [xN, 0, false, 'hps'], [xS, slope, false, 'shoulder'],
    [xS - 1, midY, true], [xC, uaY, false, 'underarm'], [xW, waistY, true, 'waist'], [xH, len, false, 'hem'], ...tailB,
  ]);

  // sleeve: cap top sits on the shoulder point (acromion); length = arm length + ease
  const capH = (uaY - slope) * 0.72;
  const cuffH = type === 'shirt' ? 6 : 0;
  const sLen = b.arm + E.sleeve - cuffH;
  const xB = (g.bicep + E.bicep) / 2;
  const xCuff = (g.wrist + E.cuff + (type === 'shirt' ? 6 : 0)) / 2; // shirt sleeve end is pleated into the cuff
  const sleeve = half('sleeve', [
    [0, 0, true], [xB * 0.38, capH * 0.12, true], [xB * 0.75, capH * 0.55, true], [xB, capH, false, 'underarm'], [xCuff, sLen, false, 'cuff'], [0, sLen],
  ]);

  const neckLen = b.neck + E.neck;
  const cH = type === 'shirt' ? 5.5 : 7;
  const collar = half('collar', [[0, 0, true], [neckLen / 2, 1.2, false, 'tip'], [neckLen / 2 + 0.8, cH + 0.8], [0, cH, true]]);

  const out: DraftPiece[] = [
    { role: 'front', points: front },
    { role: 'back', points: back },
    { role: 'sleeve', points: sleeve },
    { role: 'collar', points: collar },
  ];
  if (type === 'shirt') {
    const cuffLen = g.wrist + 8;
    out.push({ role: 'cuff', points: half('cuff', [[0, 0], [cuffLen / 2, 0, false, 'c'], [cuffLen / 2, 6], [0, 6]]) });
  }
  return out;
}

function pants(b: Body, f: BodyFrame): DraftPiece[] {
  const E = EASE.pants;
  const g = derivedGirths(b);
  const rise = f.waistH - f.crotchH; // waistline to crotch
  const hipD = f.waistH - f.hipH; // waistline to hip line
  const kneeY = f.waistH - f.kneeH;
  const hemY = rise + b.inseam - 3; // hem 3 cm off the floor
  const wF = (b.waist + E.waist) / 4 - 1, wB = (b.waist + E.waist) / 4 + 1;
  const hF = (b.hips + E.hip) / 4 - 1, hB = (b.hips + E.hip) / 4 + 1;
  const extF = b.hips / 16, extB = b.hips / 10;
  const kneeTot = g.knee + E.knee;
  const kF = kneeTot / 2 - 2, kB = kneeTot / 2 + 2;
  const hemTot = Math.max(g.ankle + E.legOpening, 36);
  const oF = hemTot / 2 - 2, oB = hemTot / 2 + 2;

  const sxF = hF * 0.55, cfX = sxF - hF;
  const front = free('front', [
    [cfX + 0.8, 0, false, 'waistC'], [cfX + 0.8 + wF, 0, false, 'waistS'], [sxF, hipD, true, 'hip'], [sxF + 0.3, rise, true],
    [kF / 2, kneeY, true, 'knee', 'k'], [oF / 2, hemY, false, 'hem', 'h'], [-oF / 2, hemY, false, undefined, 'h'], [-kF / 2, kneeY, true, undefined, 'k'],
    [cfX - extF, rise, false, 'crotch'], [cfX - extF * 0.45, rise - extF * 0.55, true],
    [cfX, Math.min(hipD + 1.5, (hipD + rise - extF * 0.55) / 2)], [cfX, hipD - 1.5],
  ]);
  const sxB = hB * 0.45, cbX = sxB - hB;
  const front_ = front;
  const back = free('back', [
    [cbX + 2.2, -3, false, 'waistC'], [cbX + 2.2 + Math.sqrt(wB * wB - 9), 0, false, 'waistS'], [sxB, hipD, true, 'hip'], [sxB + 0.3, rise, true],
    [kB / 2, kneeY, true, 'knee', 'k'], [oB / 2, hemY, false, 'hem', 'h'], [-oB / 2, hemY, false, undefined, 'h'], [-kB / 2, kneeY, true, undefined, 'k'],
    [cbX - extB, rise, false, 'crotch'], [cbX - extB * 0.4, rise - extB * 0.35, true],
    [cbX, Math.min(hipD + 1.5, (hipD + rise - extB * 0.35) / 2)], [cbX, hipD - 1.5],
  ]);
  const wb = b.waist + E.waist;
  const band = half('waistband', [[0, 0], [wb / 2, 0, false, 'wb'], [wb / 2, 4], [0, 4]]);
  return [
    { role: 'front', points: front_ },
    { role: 'back', points: back },
    { role: 'waistband', points: band },
  ];
}

export function draft(type: GarmentType, b: Body): DraftPiece[] {
  const f = bodyFrame(b);
  return type === 'pants' ? pants(b, f) : tops(type, b, f);
}

/**
 * Move an edited pattern from one body to another. Drafted points move by exactly their own draft delta,
 * so user tweaks are kept as offsets; points the user added follow their nearest drafted neighbours.
 */
export function regradePoints(points: PPoint[], from: PPoint[], to: PPoint[]): PPoint[] {
  const toByKey = new Map(to.map((p) => [p.key, p]));
  const deltas = from
    .filter((p) => p.key && toByKey.has(p.key))
    .map((p) => {
      const q = toByKey.get(p.key)!;
      return { x: p.x, y: p.y, dx: q.x - p.x, dy: q.y - p.y, key: p.key };
    });
  const byKey = new Map(deltas.map((d) => [d.key, d]));
  return points.map((p) => {
    const own = p.key ? byKey.get(p.key) : undefined;
    if (own) return { ...p, x: p.x + own.dx, y: p.y + own.dy };
    let wx = 0, wy = 0, ws = 0;
    for (const d of deltas) {
      const dist2 = (p.x - d.x) ** 2 + (p.y - d.y) ** 2 + 1e-6;
      const w = 1 / (dist2 * dist2);
      wx += d.dx * w; wy += d.dy * w; ws += w;
    }
    return ws ? { ...p, x: p.x + wx / ws, y: p.y + wy / ws } : p;
  });
}
