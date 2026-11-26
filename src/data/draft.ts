// Pattern drafting from body measurements, the way a tailor drafts a block:
// every key point is body measurement + ease, so the 2D numbers always trace back to the body.
// All values in cm. Tops are drawn as full front / full back pieces (centre line at x = 0).
// Pants are drawn as single leg pieces with the grainline (crease) at x = 0.
// Hats are drawn as one crown panel (cut 6) and a brim, sized from the head circumference.
//
// Every style in src/data/catalog.ts is drafted from one of the family blocks below. Points carry
// stable keys (`role.index`) so a regrade (new body or new fit) keeps the user's edits as offsets.

import { outlineLength, type PPoint } from '../lib/geometry';
import { bodyFrame, limbGirths, type Body, type BodyFrame } from '../three/body';
import { migrateGarment, styleById, type Family, type StyleId } from './catalog';

const TAU = Math.PI * 2;

/** Rib trims are cut shorter than the edge they are sewn to and stretched on while sewing. */
export const RIB = {
  /** neckband length / neckline length */
  neckband: 0.9,
  /** ankle cuff length / leg opening */
  cuff: 0.72,
};

/** How far a collar's outer tip runs out past the end of its sewn edge (cm, pattern x): woven point collar, knit collar. */
export const COLLAR_TIP = { woven: 0.8, knit: 1.5 };

/** Ease = how much bigger the garment is than the body, in cm of circumference (or length). */
export type Ease = Record<string, number>;

// knit tops: neck ease is over the base of the neck (where the neckline sits), see neckBase()
const TEE: Ease = {
  chest: 12, waist: 20, hem: 10, neck: 5, armhole: 3, bicep: 9, opening: 7, sleeveRatio: 0.33, length: 5, shoulder: 1, capEase: 0.5,
  band: 2,
};
const JEANS: Ease = { waist: 2, hip: 6, thigh: 0, knee: 12, legOpening: 16, waistband: 4 };

export const EASE: Record<StyleId, Ease> = {
  jacket: { chest: 10, waist: 14, hem: 8, neck: 4, armhole: 6, bicep: 12, cuff: 14, sleeve: 3, length: 3, shoulder: 1, capEase: 2.5 },
  'button-up': { chest: 10, waist: 12, hem: 6, neck: 2, armhole: 4, bicep: 9, cuff: 8, sleeve: 1, length: 5, shoulder: 0, capEase: 1, pleat: 6 },
  'basic-tee': TEE,
  // boxy: much wider, cropped, the shoulder seam drops 5 cm down the arm, flatter cap, heavier neckband
  'boxy-tee': { ...TEE, chest: 32, waist: 46, hem: 30, neck: 7, armhole: 7, bicep: 16, opening: 12, sleeveRatio: 0.3, length: 1, drop: 5, band: 2.8 },
  polo: { ...TEE, chest: 14, waist: 22, hem: 12, neck: 1, bicep: 10, opening: 8, sleeveRatio: 0.36, length: 7, collar: 7.5, placket: 3, placketDepth: 14 },
  'collared-tee': { ...TEE, neck: 1, collar: 7 },
  jeans: JEANS,
  'straight-jeans': { ...JEANS, hip: 8, knee: 14, flare: 0 },
  'bootcut-jeans': { ...JEANS, knee: 10, flare: 5 },
  'flared-jeans': { ...JEANS, knee: 6, flare: 14 },
  'baggy-jeans': { ...JEANS, waist: 5, hip: 18, knee: 26, flare: 0, riseDrop: 3, inseam: 4, ext: 1.25 },
  sweatpants: { waist: 20, hip: 14, thigh: 0, knee: 18, legOpening: 12, waistband: 4.5, elastic: -4, cuffH: 7, blouse: 3 },
  shorts: { waist: 2, hip: 8, thigh: 0, legOpening: 0, waistband: 4, inseamLen: 18 },
  'bucket-hat': { head: 1.5, depth: 1, brim: 6.5, slope: 32 },
  cap: { head: 1, depth: 2, brim: 7 },
};

export type Fit = 'slim' | 'regular' | 'relaxed';
export const FITS: Fit[] = ['slim', 'regular', 'relaxed'];

const TOP_FIT: Record<string, [number, number]> = { chest: [-4, 8], waist: [-6, 8], hem: [-2, 8], bicep: [-4, 5], armhole: [-1, 1.5] };
const KNIT_FIT: Record<string, [number, number]> = { chest: [-4, 8], waist: [-6, 8], hem: [-2, 8], bicep: [-3, 4], opening: [-3, 4], armhole: [-1, 1.5] };
const FIT_ADJ: Record<Family, Record<string, [number, number]>> = {
  jacket: { ...TOP_FIT, cuff: [-3, 2] },
  shirt: { ...TOP_FIT, cuff: [0, 0] },
  tee: KNIT_FIT,
  polo: KNIT_FIT,
  pants: { hip: [-2, 4], knee: [-5, 6], legOpening: [-5, 6] },
  bucket: { head: [-0.5, 1] },
  cap: { head: [-0.5, 1] },
};

/** Ease for a style in a given fit. Regular is the base table; slim and relaxed take room out or add it. */
export function easeFor(style: StyleId, fit: Fit = 'regular'): Ease {
  const id = migrateGarment(style);
  const base = { ...EASE[id] };
  if (fit === 'regular') return base;
  const slim = fit === 'slim';
  for (const [k, [s, r]] of Object.entries(FIT_ADJ[styleById(id).family])) if (k in base) base[k] += slim ? s : r;
  return base;
}

/** Body girths that are not typed in but estimated from the typed ones (same formulas the 3D body uses). */
export function derivedGirths(b: Body) {
  const l = limbGirths(b);
  return { bicep: l.bicep, wrist: l.wrist, thigh: l.thigh, knee: l.thigh * 0.64, ankle: l.ankle, head: l.head };
}

type P = [number, number, boolean?, string?, string?]; // x, y, smooth, tag, key/pair

export interface DraftPiece {
  role: string;
  points: PPoint[];
  /** relaxed elastic length inside a waistband (cm) */
  elastic?: number;
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

/** Edge length between two keyed points (shorter way round the outline). */
export const edge = (pts: PPoint[], a: string, b: string) => {
  const pa = pts.find((p) => p.key === a), pb = pts.find((p) => p.key === b);
  return pa && pb ? outlineLength(pts, pa.id, pb.id) : 0;
};

/** Bisect x in [lo, hi] so that fn(x) = target (fn increasing in x). */
function solve(fn: (x: number) => number, target: number, lo: number, hi: number) {
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (fn(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Girth at the base of the neck (high point shoulder level), where a knit neckline sits: about 1.3 x the neck measurement. */
export const neckBase = (b: Body) => bodyFrame(b).neckRing(bodyFrame(b).neckH).C;

/** Index offset of the front outline: the polo front starts with its placket opening (2 extra points). */
export const frontOffset = (style: StyleId) => (style === 'polo' ? 2 : 0);

function tops(style: StyleId, b: Body, f: BodyFrame, fit: Fit): DraftPiece[] {
  const fam = styleById(style).family;
  const woven = fam === 'jacket' || fam === 'shirt';
  const shirt = fam === 'shirt';
  const polo = style === 'polo';
  const fo = frontOffset(style);
  const E = easeFor(style, fit);
  const g = derivedGirths(b);
  const hps = f.neckH; // high point shoulder height on the body; pattern y = 0 sits here
  const uaY = hps - f.chestH + E.armhole; // chest line, a little below the armpit
  const waistY = hps - f.waistH;
  const len = hps - f.crotchH + E.length;
  const xC = (b.chest + E.chest) / 4;
  const xW = (b.waist + E.waist) / 4;
  const xH = (b.hips + E.hem) / 4;
  let xN = (b.neck + E.neck) / TAU + 0.9;
  const drop = E.drop ?? 0; // dropped shoulder: the shoulder seam carries on down the arm
  const build = (xN: number) => {
    const xS0 = b.shoulder / 2 + E.shoulder / 2;
    const xS = xS0 + drop;
    const slope0 = 0.026 * b.height;
    const slope = drop ? slope0 * 0.8 * (xS - xN) / (xS0 - xN) : slope0;
    const midY = (slope + uaY) / 2 + 1;
    const fND = woven || fam === 'tee' ? xN + 1.5 : xN; // front neck depth (collared knits sit closer to the neck)
    const bND = 2; // back neck depth
    const inF = drop ? 0.6 : 1.8, inB = drop ? 0.3 : 1; // armhole shape (a dropped armhole is straighter)

    const tail: P[] = shirt ? [[xH * 0.5, len + 4.5, true], [0, len + 6, true]] : [[0, len]];
    const tailB: P[] = shirt ? [[xH * 0.5, len + 6.5, true], [0, len + 8, true]] : [[0, len]];

    const pw2 = (E.placket ?? 0) / 2;
    const yN0 = fND * Math.sqrt(Math.max(0, 1 - (pw2 / xN) ** 2)); // neckline height at the placket edge
    const plB = yN0 + (E.placketDepth ?? 0);
    const neckF: P[] = woven
      ? [[0, fND, true], [xN * 0.55, fND * 0.8, true], [xN, 0, false, 'hps']]
      : polo
        ? [[0, plB, false, 'placket'], [pw2, plB], [pw2, yN0], [xN * 0.62, fND * 0.78, true], [xN, 0, false, 'hps']]
        : [[0, fND, true], [xN * 0.62, fND * 0.78, true], [xN, 0, false, 'hps']];

    const front = half('front', [
      ...neckF, [xS, slope, false, 'shoulder'],
      [xS - inF, midY, true], [xC, uaY, false, 'underarm'], [xW, waistY, true, 'waist'], [xH, len, false, 'hem'], ...tail,
    ]);
    const back = half('back', [
      [0, bND, true], [xN * 0.55, bND * 0.8, true], [xN, 0, false, 'hps'], [xS, slope, false, 'shoulder'],
      [xS - inB, midY, true], [xC, uaY, false, 'underarm'], [xW, waistY, true, 'waist'], [xH, len, false, 'hem'], ...tailB,
    ]);
    return { front, back, slope, pw2, yN0, plB };
  };
  let { front, back, slope, pw2, yN0, plB } = build(xN);
  if (!woven) {
    // knit necklines: walk the neck width until the neckline is the base of the neck + ease
    const target = neckBase(b) + E.neck;
    const neckOf = (x: number) => { const r = build(x); return 2 * (edge(r.front, `front.${fo}`, `front.${fo + 2}`) + edge(r.back, 'back.0', 'back.2')) + 2 * r.pw2; };
    xN = solve(neckOf, target, 4, 14);
    ({ front, back, slope, pw2, yN0, plB } = build(xN));
  }
  const F = (i: number, m = '') => `front.${i + fo}${m}`;

  // sleeve: cap top sits on the shoulder point (acromion, or the dropped shoulder point); length = arm length + ease
  const short = !woven;
  const cuffH = shirt ? 6 : 0;
  const sLen = short ? b.arm * E.sleeveRatio : b.arm + E.sleeve - cuffH;
  const xB = (g.bicep + E.bicep) / 2;
  const cuffLen = short ? g.bicep + E.opening : g.wrist + E.cuff;
  const xCuff = (shirt ? cuffLen + EASE['button-up'].pleat : cuffLen) / 2; // shirt sleeve end is pleated into the cuff
  const armhole = edge(front, F(3), F(5)) + edge(back, 'back.3', 'back.5');
  const target = armhole / 2 + E.capEase / 2; // per half of the cap
  const makeSleeve = (capH: number, xb = xB) =>
    half('sleeve', [[0, 0, true], [xb * 0.38, capH * 0.12, true], [xb * 0.75, capH * 0.55, true], [xb, capH, false, 'underarm'], [xCuff, sLen, false, 'cuff'], [0, sLen]]);
  const capLen = (sv: PPoint[]) => edge(sv, 'sleeve.0', 'sleeve.3');
  // walk the cap: bisect the cap height until the cap is exactly armhole + ease
  const depth = uaY - slope;
  const hMin = depth * (woven ? 0.4 : drop ? 0.2 : 0.3), hMax = depth * 1.0;
  let sleeve = makeSleeve(hMin);
  if (capLen(sleeve) > target) {
    // even the flattest cap is too long for this armhole: narrow the bicep until it fits
    const xb = solve((x) => capLen(makeSleeve(hMin, x)), target, xB * 0.6, xB);
    sleeve = makeSleeve(hMin, xb);
  } else {
    const h = solve((x) => capLen(makeSleeve(x)), target, hMin, hMax);
    sleeve = makeSleeve(h);
  }

  // neckline the trim is sewn to (front + back, both sides, plus the placket top on a polo)
  const neckLen = 2 * (edge(front, F(0), F(2)) + edge(back, 'back.0', 'back.2')) + 2 * pw2;

  const out: DraftPiece[] = [
    { role: 'front', points: front },
    { role: 'back', points: back },
    { role: 'sleeve', points: sleeve },
  ];
  if (fam === 'tee') {
    // rib neckband: shorter than the neckline, stretched on while sewing so the neck lies flat
    const L = RIB.neckband * neckLen;
    out.push({ role: 'neckband', points: half('neckband', [[0, 0], [L / 2, 0, false, 'nb'], [L / 2, E.band], [0, E.band]]) });
  } else {
    // collar: the sewn edge (tip to tip) is walked to exactly the neckline length
    const cH = E.collar ?? (shirt ? 5.5 : 7);
    const make = (x: number) => woven
      ? half('collar', [[0, 0, true], [x, 1.2, false, 'tip'], [x + COLLAR_TIP.woven, cH + 0.8], [0, cH, true]])
      : half('collar', [[0, 0], [x, 0, false, 'tip'], [x + COLLAR_TIP.knit, cH], [0, cH]]); // knit collar: outer edge a little longer so the fall lies flat
    const x = solve((v) => edge(make(v), 'collar.1', 'collar.1m'), neckLen, neckLen * 0.3, neckLen * 0.6);
    out.push({ role: 'collar', points: make(x) });
  }
  if (polo) {
    out.push({ role: 'placket', points: half('placket', [[0, 0], [pw2, 0, false, 'pl'], [pw2, plB - yN0], [0, plB - yN0]]) });
  }
  if (shirt) {
    out.push({ role: 'cuff', points: half('cuff', [[0, 0], [cuffLen / 2, 0, false, 'c'], [cuffLen / 2, 6], [0, 6]]) });
  }
  return out;
}

function pants(style: StyleId, b: Body, f: BodyFrame, fit: Fit): DraftPiece[] {
  const E = easeFor(style, fit);
  const g = derivedGirths(b);
  // the waistband (E.waistband tall) sits on the natural waist (lower on a low rise), so the leg pieces start below it
  const wbH = E.waistband;
  const top = f.waistH - (E.riseDrop ?? 0) - wbH; // body height of the top edge of the leg pieces
  const rise = top - f.crotchH; // top of the leg piece to the crotch
  const hipD = top - f.hipH; // top of the leg piece to the hip line
  const kneeY = top - f.kneeH;
  const cuffH = E.cuffH ?? 0;
  const shorts = E.inseamLen !== undefined;
  // hem: 3 cm off the floor for jeans (+ extra length that stacks), at the ankle above a rib cuff, or a fixed inseam for shorts
  const hemY = shorts ? rise + E.inseamLen
    : cuffH ? rise + (f.crotchH - (f.ankleH - 1 + cuffH)) + (E.blouse ?? 0)
      : rise + b.inseam - 3 + (E.inseam ?? 0);
  const wF = (b.waist + E.waist) / 4 - 1, wB = (b.waist + E.waist) / 4 + 1;
  const hF = (b.hips + E.hip) / 4 - 1, hB = (b.hips + E.hip) / 4 + 1;
  const ext = E.ext ?? 1;
  const extF = (b.hips / 16) * ext, extB = (b.hips / 10) * ext;
  const kneeTot = g.knee + (E.knee ?? 0);
  const hemTot = shorts ? g.thigh + E.legOpening
    : E.flare !== undefined ? kneeTot + E.flare
      : cuffH ? g.ankle + E.legOpening
        : Math.max(g.ankle + E.legOpening, 36);
  const kF = kneeTot / 2 - 2, kB = kneeTot / 2 + 2;
  const oF = hemTot / 2 - 2, oB = hemTot / 2 + 2;

  /** knee outer, hem outer, hem inner, knee inner. Shorts end above the knee, so the knee points become mid-leg points. */
  const leg = (k: number, o: number, side: [number, number], crotch: [number, number]): P[] => {
    if (!shorts) return [[k / 2, kneeY, true, 'knee', 'k'], [o / 2, hemY, false, 'hem', 'h'], [-o / 2, hemY, false, undefined, 'h'], [-k / 2, kneeY, true, undefined, 'k']];
    const mid = (a: [number, number], c: [number, number]): [number, number] => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    const mo = mid(side, [o / 2, hemY]), mi = mid(crotch, [-o / 2, hemY]);
    return [[mo[0], mo[1], true], [o / 2, hemY, false, 'hem', 'h'], [-o / 2, hemY, false, undefined, 'h'], [mi[0], mi[1], true]];
  };

  const sxF = hF * 0.55, cfX = sxF - hF;
  const front = free('front', [
    [cfX + 0.8, 0, false, 'waistC'], [cfX + 0.8 + wF, 0, false, 'waistS'], [sxF, hipD, true, 'hip'], [sxF + 0.3, rise, true],
    ...leg(kF, oF, [sxF + 0.3, rise], [cfX - extF, rise]),
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
      ...leg(kB, oB, [sxB + 0.3 + u * 0.7, rise], [cbX - extB + u, rise + 1]),
      [cbX - extB + u, rise + 1, false, 'crotch'], [cbX - extB * 0.4 + u, rise - extB * 0.35 + 0.5, true],
      [cbX + u, Math.min(hipD + 1.5, (hipD + rise - extB * 0.35) / 2)], [cbX + u, hipD - 1.5],
    ]);
  };
  const fIn = edge(front, 'front.6', 'front.8'), fOut = edge(front, 'front.1', 'front.5');
  let u = 0, dW = 0, back = makeBack(0, 0);
  for (let pass = 0; pass < 6; pass++) {
    // moving the seat toward the leg shortens the inseam; lowering the waist side point shortens the outseam
    u = -solve((x) => edge(makeBack(-x, dW), 'back.6', 'back.8'), fIn, -14, 6);
    dW = -solve((x) => edge(makeBack(u, -x), 'back.1', 'back.5'), fOut, -10, 10);
  }
  back = makeBack(u, dW);
  const wb = b.waist + E.waist;
  const band = half('waistband', [[0, 0], [wb / 2, 0, false, 'wb'], [wb / 2, wbH], [0, wbH]]);
  const out: DraftPiece[] = [
    { role: 'front', points: front },
    { role: 'back', points: back },
    { role: 'waistband', points: band, ...(E.elastic !== undefined ? { elastic: b.waist + E.elastic } : {}) },
  ];
  if (cuffH) {
    const c = RIB.cuff * hemTot;
    out.push({ role: 'cuff', points: half('cuff', [[0, 0], [c / 2, 0, false, 'c'], [c / 2, cuffH], [0, cuffH]]) });
  }
  return out;
}

/** Crown depth from the hat band over the top of the head, along the surface (cm). */
export const crownArc = (head: number) => 0.26 * head;

function hat(style: StyleId, b: Body, f: BodyFrame, fit: Fit): DraftPiece[] {
  const E = easeFor(style, fit);
  const head = derivedGirths(b).head;
  const band = head + E.head; // the band is the head circumference plus ease
  const w = band / 6; // six crown panels
  const cap = style === 'cap';
  const p = cap ? 0.8 : 0.65; // panel side profile: a cap crown is rounder, a bucket crown has steeper sides
  const prof = (s: number) => (w / 2) * Math.sin((Math.PI / 2) * s) ** p;
  const gore = (H: number) => half('crown', [[0, 0], [prof(0.3), 0.3 * H, true], [prof(0.65), 0.65 * H, true], [w / 2, H, false, 'band'], [0, H]]);
  const arc = crownArc(head) + E.depth;
  const H = solve((h) => edge(gore(h), 'crown.0', 'crown.3'), arc, arc * 0.6, arc);
  const out: DraftPiece[] = [{ role: 'crown', points: gore(H) }];

  if (!cap) {
    // bucket brim: a flat cone development. The sector angle sets the slope, the inner edge is walked to the band.
    const alpha = (E.slope * Math.PI) / 180;
    const phi = TAU * Math.cos(alpha);
    const N = 6;
    const brim = (r1: number) => {
      const r2 = r1 + E.brim;
      const pts: P[] = [];
      for (let i = 0; i <= N; i++) { const ps = (i / N) * (phi / 2); pts.push([r1 * Math.sin(ps), r1 * Math.cos(ps), i < N, i === 0 ? 'brimIn' : undefined]); }
      for (let i = N; i >= 0; i--) { const ps = (i / N) * (phi / 2); pts.push([r2 * Math.sin(ps), r2 * Math.cos(ps), i < N, i === 0 ? 'brimOut' : i === N ? 'brimEnd' : undefined]); }
      return half('brim', pts);
    };
    const r1 = solve((r) => 2 * edge(brim(r), 'brim.0', `brim.${N}`), band, band / TAU, band / 2);
    out.push({ role: 'brim', points: brim(r1) });
  } else {
    // cap visor: the inner edge follows the front half of the head (an ellipse as deep as the head), walked to half the band
    const k = f.headK;
    const D = E.brim;
    const s30 = 0.5, c30 = Math.sqrt(3) / 2;
    const visor = (A: number) => {
      const B = A * k;
      return half('brim', [
        [0, B, true, 'visorIn'], [A * s30, B * c30, true], [A * c30, B * s30, true], [A, 0, false, 'visorEnd'],
        [A + 1, -0.2], [(A + 1) * c30, (B + D) * s30, true], [(A + 1) * s30, (B + D) * c30, true], [0, B + D, true, 'visorOut'],
      ]);
    };
    const A = solve((a) => 2 * edge(visor(a), 'brim.0', 'brim.3'), band / 2, 2, band / 4);
    out.push({ role: 'brim', points: visor(A) });
  }
  return out;
}

export function draft(style: StyleId, b: Body, fit: Fit = 'regular'): DraftPiece[] {
  const id = migrateGarment(style);
  const f = bodyFrame(b);
  const fam = styleById(id).family;
  if (fam === 'pants') return pants(id, b, f, fit);
  if (fam === 'bucket' || fam === 'cap') return hat(id, b, f, fit);
  return tops(id, b, f, fit);
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

