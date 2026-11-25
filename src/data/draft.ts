// Pattern drafting from body measurements, the way a tailor drafts a block:
// every key point is body measurement + ease, so the 2D numbers always trace back to the body.
// All values in cm. Tops are drawn as full front / full back pieces (centre line at x = 0).
// Pants are drawn as single leg pieces with the grainline (crease) at x = 0.

import { outlineLength, type PPoint } from '../lib/geometry';
import { bodyFrame, limbGirths, type Body, type BodyFrame } from '../three/body';
import type { GarmentType } from './presets';

const TAU = Math.PI * 2;

/** Ease = how much bigger the garment is than the body, in cm of circumference (or length). */
export const EASE = {
  jacket: { chest: 10, waist: 14, hem: 8, neck: 4, armhole: 6, bicep: 12, cuff: 14, sleeve: 3, length: 3, shoulder: 1, capEase: 2.5 },
  shirt: { chest: 10, waist: 12, hem: 6, neck: 2, armhole: 4, bicep: 9, cuff: 8, sleeve: 1, length: 5, shoulder: 0, capEase: 1, pleat: 6 },
  pants: { waist: 2, hip: 6, thigh: 0, knee: 12, legOpening: 16, waistband: 4 },
};

export type Fit = 'slim' | 'regular' | 'relaxed';
export const FITS: Fit[] = ['slim', 'regular', 'relaxed'];

/** Ease for a garment in a given fit. Regular is the base table; slim and relaxed take room out or add it. */
export function easeFor<T extends GarmentType>(type: T, fit: Fit = 'regular'): (typeof EASE)[T] {
  const base = { ...EASE[type] } as Record<string, number>;
  if (fit === 'regular') return base as (typeof EASE)[T];
  const slim = fit === 'slim';
  const adj: Record<string, [number, number]> = type === 'pants'
    ? { hip: [-2, 4], knee: [-5, 6], legOpening: [-5, 6] }
    : { chest: [-4, 8], waist: [-6, 8], hem: [-2, 8], bicep: [-4, 5], cuff: type === 'jacket' ? [-3, 2] : [0, 0], armhole: [-1, 1.5] };
  for (const [k, [s, r]] of Object.entries(adj)) base[k] += slim ? s : r;
  return base as (typeof EASE)[T];
}

/** Body girths that are not typed in but estimated from the typed ones (same formulas the 3D body uses). */
export function derivedGirths(b: Body) {
  const l = limbGirths(b);
  return { bicep: l.bicep, wrist: l.wrist, thigh: l.thigh, knee: l.thigh * 0.64, ankle: l.ankle };
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

function tops(type: 'jacket' | 'shirt', b: Body, f: BodyFrame, fit: Fit): DraftPiece[] {
  const E = easeFor(type, fit);
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
  const cuffH = type === 'shirt' ? 6 : 0;
  const sLen = b.arm + E.sleeve - cuffH;
  const xB = (g.bicep + E.bicep) / 2;
  const cuffLen = g.wrist + E.cuff;
  const xCuff = (type === 'shirt' ? cuffLen + EASE.shirt.pleat : cuffLen) / 2; // shirt sleeve end is pleated into the cuff
  const armhole = (side: 'r' | 'l') =>
    outlineLength(front, front[side === 'r' ? 3 : front.length - 3].id, front[side === 'r' ? 5 : front.length - 5].id) +
    outlineLength(back, back[side === 'r' ? 3 : back.length - 3].id, back[side === 'r' ? 5 : back.length - 5].id);
  const target = armhole('r') / 2 + E.capEase / 2; // per half of the cap
  const makeSleeve = (capH: number, xb = xB) =>
    half('sleeve', [[0, 0, true], [xb * 0.38, capH * 0.12, true], [xb * 0.75, capH * 0.55, true], [xb, capH, false, 'underarm'], [xCuff, sLen, false, 'cuff'], [0, sLen]]);
  const capLen = (sv: PPoint[]) => outlineLength(sv, sv[0].id, sv[3].id);
  // walk the cap: bisect the cap height until the cap is exactly armhole + ease
  const depth = uaY - slope;
  const hMin = depth * 0.4, hMax = depth * 1.0;
  let sleeve = makeSleeve(hMin);
  if (capLen(sleeve) > target) {
    // even the flattest cap is too long for this armhole: narrow the bicep until it fits
    let lo = xB * 0.6, hi = xB;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      sleeve = makeSleeve(hMin, mid);
      if (capLen(sleeve) > target) hi = mid; else lo = mid;
    }
  } else {
    let lo = hMin, hi = hMax;
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      sleeve = makeSleeve(mid);
      if (capLen(sleeve) < target) lo = mid; else hi = mid;
    }
  }

  // collar = the actual neckline it is sewn to (front + back, both sides)
  const neckLen = 2 * (outlineLength(front, front[0].id, front[2].id) + outlineLength(back, back[0].id, back[2].id));
  const cH = type === 'shirt' ? 5.5 : 7;
  const collar = half('collar', [[0, 0, true], [neckLen / 2, 1.2, false, 'tip'], [neckLen / 2 + 0.8, cH + 0.8], [0, cH, true]]);

  const out: DraftPiece[] = [
    { role: 'front', points: front },
    { role: 'back', points: back },
    { role: 'sleeve', points: sleeve },
    { role: 'collar', points: collar },
  ];
  if (type === 'shirt') {
    out.push({ role: 'cuff', points: half('cuff', [[0, 0], [cuffLen / 2, 0, false, 'c'], [cuffLen / 2, 6], [0, 6]]) });
  }
  return out;
}

function pants(b: Body, f: BodyFrame, fit: Fit): DraftPiece[] {
  const E = easeFor('pants', fit);
  const g = derivedGirths(b);
  // the waistband (E.waistband tall) sits on the natural waist, so the leg pieces start that much lower
  const wbH = E.waistband;
  const rise = f.waistH - f.crotchH - wbH; // top of the leg piece to the crotch
  const hipD = f.waistH - f.hipH - wbH; // top of the leg piece to the hip line
  const kneeY = f.waistH - f.kneeH - wbH;
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
  // u shifts the back seat (waist, hip, crotch) sideways relative to the leg; dWaist raises or lowers the
  // waist side point. Both are walked so the back inseam and outseam equal the front ones exactly.
  const makeBack = (u: number, dWaist: number) => {
    const vy = dWaist + 3; // waist side point height relative to the raised centre back
    return free('back', [
      [cbX + 2.2 + u, -3, false, 'waistC'], [cbX + 2.2 + u + Math.sqrt(Math.max(1, wB * wB - vy * vy)), dWaist, false, 'waistS'], [sxB + u, hipD, true, 'hip'], [sxB + 0.3 + u * 0.7, rise, true],
      [kB / 2, kneeY, true, 'knee', 'k'], [oB / 2, hemY, false, 'hem', 'h'], [-oB / 2, hemY, false, undefined, 'h'], [-kB / 2, kneeY, true, undefined, 'k'],
      [cbX - extB + u, rise + 1, false, 'crotch'], [cbX - extB * 0.4 + u, rise - extB * 0.35 + 0.5, true],
      [cbX + u, Math.min(hipD + 1.5, (hipD + rise - extB * 0.35) / 2)], [cbX + u, hipD - 1.5],
    ]);
  };
  const seam = (p: PPoint[], a: number, c: number) => outlineLength(p, p[a].id, p[c].id);
  const fIn = seam(front, 6, 8), fOut = seam(front, 1, 5);
  let u = 0, dW = 0, back = makeBack(0, 0);
  for (let pass = 0; pass < 6; pass++) {
    let lo = -6, hi = 14;
    for (let it = 0; it < 40; it++) {
      u = (lo + hi) / 2;
      back = makeBack(u, dW);
      if (seam(back, 6, 8) > fIn) lo = u; else hi = u; // moving the seat toward the leg shortens the inseam
    }
    lo = -10; hi = 10;
    for (let it = 0; it < 40; it++) {
      dW = (lo + hi) / 2;
      back = makeBack(u, dW);
      if (seam(back, 1, 5) > fOut) lo = dW; else hi = dW; // lowering the waist side point shortens the outseam
    }
  }
  const front_ = front;
  const wb = b.waist + E.waist;
  const band = half('waistband', [[0, 0], [wb / 2, 0, false, 'wb'], [wb / 2, wbH], [0, wbH]]);
  return [
    { role: 'front', points: front_ },
    { role: 'back', points: back },
    { role: 'waistband', points: band },
  ];
}

export function draft(type: GarmentType, b: Body, fit: Fit = 'regular'): DraftPiece[] {
  const f = bodyFrame(b);
  return type === 'pants' ? pants(b, f, fit) : tops(type, b, f, fit);
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
