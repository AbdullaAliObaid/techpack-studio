import type { Piece, SpecDef, GarmentType } from '../data/presets';
import { bbox, dist, outlineLength, samplePoly, sliceSpan, type Pt } from './geometry';
import { derivedGirths, EASE, RIB, frontOffset, neckBase } from '../data/draft';
import { migrateGarment, styleById } from '../data/catalog';
import { bodyFrame, type Body } from '../three/body';

export interface SpecValue {
  label: string;
  value: number; // cm
  a: Pt; // measurement line endpoints, piece-local
  b: Pt;
  vertical?: boolean;
}

export const findTag = (p: Piece, tag: string) => p.points.find((q) => q.tag === tag);

export function computeSpec(p: Piece, s: SpecDef, poly = samplePoly(p.points)): SpecValue | null {
  switch (s.kind) {
    case 'length': {
      const bb = bbox(poly);
      const x = bb.maxX + 5;
      return { label: s.label, value: bb.h, a: { x, y: bb.minY }, b: { x, y: bb.maxY }, vertical: true };
    }
    case 'slice': {
      const t = findTag(p, s.tag);
      if (!t) return null;
      const y = t.y + (s.dy ?? 0);
      const span = s.full ? sliceSpan(poly, y) : sliceSpan(poly, y, t.x);
      if (!span) return null;
      return { label: s.label, value: span.x2 - span.x1, a: { x: span.x1, y }, b: { x: span.x2, y } };
    }
    case 'mirror': {
      const t = findTag(p, s.tag);
      if (!t) return null;
      const m = p.points.find((q) => q.id === t.mirror && q.id !== t.id) ?? p.points.find((q) => q.tag === s.tag && q.id !== t.id);
      if (!m) return null;
      const off = s.off ?? 0;
      return { label: s.label, value: dist(t, m), a: { x: m.x, y: m.y + off }, b: { x: t.x, y: t.y + off } };
    }
    case 'dist': {
      const a = findTag(p, s.tags[0]);
      const b = findTag(p, s.tags[1]);
      if (!a || !b) return null;
      const off = s.off ?? 0;
      return { label: s.label, value: dist(a, b), a: { x: a.x, y: a.y + off }, b: { x: b.x, y: b.y + off } };
    }
    case 'vdist': {
      const a = findTag(p, s.tags[0]);
      const b = findTag(p, s.tags[1]);
      if (!a || !b) return null;
      const x = Math.min(a.x, b.x) - 4;
      return { label: s.label, value: Math.abs(b.y - a.y), a: { x, y: a.y }, b: { x, y: b.y }, vertical: true };
    }
  }
}

export function pieceSpecs(p: Piece): SpecValue[] {
  const poly = samplePoly(p.points);
  return p.specs.map((s) => computeSpec(p, s, poly)).filter((v): v is SpecValue => !!v);
}

const famOf = (type: GarmentType) => styleById(migrateGarment(type)).family;
const isHat = (type: GarmentType) => ['bucket', 'cap'].includes(famOf(type));

/** Edge length along a piece between two keyed points (shorter way round). */
function edgeLen(p: Piece | undefined, a: string, b: string) {
  if (!p) return 0;
  const pa = p.points.find((q) => q.key === a), pb = p.points.find((q) => q.key === b);
  return pa && pb ? outlineLength(p.points, pa.id, pb.id) : 0;
}

function specOf(pieces: Piece[], role: string, label: string) {
  const p = pieces.find((q) => q.role === role);
  if (!p) return 0;
  const s = p.specs.find((q) => q.label === label);
  return s ? computeSpec(p, s)?.value ?? 0 : 0;
}

/** Neckline a trim is sewn to: front + back neck, both sides, plus the placket top on a polo. */
function necklineLen(type: GarmentType, pieces: Piece[]) {
  const f = pieces.find((p) => p.role === 'front'), bk = pieces.find((p) => p.role === 'back');
  const fo = frontOffset(migrateGarment(type));
  const pl = pieces.find((p) => p.role === 'placket');
  const plTop = pl ? 2 * edgeLen(pl, 'placket.0', 'placket.1') : 0;
  return 2 * (edgeLen(f, `front.${fo}`, `front.${fo + 2}`) + edgeLen(bk, 'back.0', 'back.2')) + plTop;
}

/** Hat band = the six crown panel bases. */
const hatBand = (pieces: Piece[]) => 6 * specOf(pieces, 'crown', 'Panel base');
const crownDepth = (pieces: Piece[]) => edgeLen(pieces.find((p) => p.role === 'crown'), 'crown.0', 'crown.3');

/** Finished garment measurements, i.e. what a factory spec sheet lists. */
export function garmentSpecs(type: GarmentType, pieces: Piece[]): { label: string; value: number }[] {
  const get = (role: string, label: string) => specOf(pieces, role, label);
  const fam = famOf(type);
  if (fam === 'pants') {
    const rows = [
      { label: 'Waist circumference', value: 2 * (get('front', 'Waist') + get('back', 'Waist')) },
      { label: 'Hip circumference', value: 2 * (get('front', 'Hip') + get('back', 'Hip')) },
      { label: 'Thigh circumference', value: get('front', 'Thigh') + get('back', 'Thigh') },
      { label: 'Knee circumference', value: get('front', 'Knee') + get('back', 'Knee') },
      { label: 'Leg opening', value: get('front', 'Leg opening') + get('back', 'Leg opening') },
      { label: 'Front rise', value: get('front', 'Rise') },
      { label: 'Back rise', value: get('back', 'Rise') },
      { label: 'Outseam', value: get('front', 'Length') },
    ].filter((r) => r.label !== 'Knee circumference' || r.value > 0);
    const wb = pieces.find((p) => p.role === 'waistband');
    if (wb?.elastic) rows.push({ label: 'Waist elastic (relaxed)', value: wb.elastic });
    if (pieces.some((p) => p.role === 'cuff')) rows.push({ label: 'Ankle cuff', value: get('cuff', 'Cuff length') });
    return rows;
  }
  if (isHat(type)) {
    return [
      { label: 'Head band circumference', value: hatBand(pieces) },
      { label: 'Crown depth', value: crownDepth(pieces) },
      fam === 'cap' ? { label: 'Visor depth', value: get('brim', 'Visor depth') } : { label: 'Brim width', value: get('brim', 'Brim width') },
    ];
  }
  const short = fam === 'tee' || fam === 'polo';
  const rows = [
    { label: 'Chest circumference', value: get('front', 'Chest') + get('back', 'Chest') },
    { label: 'Waist circumference', value: get('front', 'Waist') + get('back', 'Waist') },
    { label: 'Hem circumference', value: get('front', 'Hem') + get('back', 'Hem') },
    { label: 'Shoulder width', value: get('back', 'Shoulder') },
    { label: 'Body length (CB)', value: get('back', 'Length') },
    { label: 'Sleeve length', value: get('sleeve', 'Length') },
    { label: 'Bicep circumference', value: get('sleeve', 'Bicep') },
    short ? { label: 'Sleeve opening', value: get('sleeve', 'Opening') } : { label: 'Cuff opening', value: get('sleeve', 'Cuff') },
  ];
  if (fam === 'tee') rows.push({ label: 'Neck opening', value: necklineLen(type, pieces) }, { label: 'Neckband length', value: get('neckband', 'Neckband length') });
  if (pieces.some((p) => p.role === 'placket')) rows.push({ label: 'Placket length', value: get('placket', 'Length') });
  return rows;
}

export interface FitRow {
  label: string;
  body: number | null; // body measurement (cm), null when not comparable
  garment: number;
  estimated?: boolean; // body value derived from other measurements
  length?: boolean; // a length, where a difference is a style choice rather than tightness
}

/** Body vs garment, i.e. where the ease comes from. */
export function fitTable(type: GarmentType, pieces: Piece[], b: Body): FitRow[] {
  const gs = Object.fromEntries(garmentSpecs(type, pieces).map((r) => [r.label, r.value]));
  const d = derivedGirths(b);
  const f = bodyFrame(b);
  const fam = famOf(type);
  const collar = pieces.find((p) => p.role === 'collar');
  const collarLen = collar ? computeSpec(collar, collar.specs[0])?.value ?? 0 : 0;
  if (fam === 'pants') {
    const front = pieces.find((p) => p.role === 'front');
    const inseam = front ? computeSpec(front, { label: 'Inseam', kind: 'vdist', tags: ['crotch', 'hem'] })?.value ?? 0 : 0;
    const wb = pieces.find((p) => p.role === 'waistband');
    const rows: FitRow[] = [
      { label: 'Waist', body: b.waist, garment: gs['Waist circumference'] },
      ...(wb?.elastic ? [{ label: 'Waist elastic', body: b.waist, garment: wb.elastic }] : []),
      { label: 'Hip', body: b.hips, garment: gs['Hip circumference'] },
      { label: 'Thigh', body: d.thigh, garment: gs['Thigh circumference'], estimated: b.thigh === undefined },
      ...(gs['Knee circumference'] ? [{ label: 'Knee', body: d.knee, garment: gs['Knee circumference'], estimated: true }] : []),
      // shorts end on the thigh, everything else at the ankle
      gs['Knee circumference']
        ? { label: 'Leg opening', body: d.ankle, garment: gs['Leg opening'], estimated: b.ankle === undefined }
        : { label: 'Leg opening', body: d.thigh, garment: gs['Leg opening'], estimated: b.thigh === undefined },
      ...(gs['Ankle cuff'] ? [{ label: 'Ankle cuff', body: d.ankle, garment: gs['Ankle cuff'], estimated: b.ankle === undefined }] : []),
      { length: true, label: 'Front rise', body: f.waistH - f.crotchH, garment: gs['Front rise'] + bandH(pieces), estimated: true },
      { length: true, label: 'Inseam', body: b.inseam, garment: inseam },
      { length: true, label: 'Outseam', body: f.waistH, garment: gs['Outseam'] + bandH(pieces), estimated: true },
    ];
    return rows;
  }
  if (isHat(type)) {
    return [
      { label: 'Head', body: d.head, garment: gs['Head band circumference'], estimated: b.head === undefined },
      { length: true, label: 'Crown depth', body: null, garment: gs['Crown depth'] },
    ];
  }
  if (fam === 'tee' || fam === 'polo') {
    return [
      { label: 'Chest', body: b.chest, garment: gs['Chest circumference'] },
      { label: 'Waist', body: b.waist, garment: gs['Waist circumference'] },
      { label: 'Hem / hips', body: b.hips, garment: gs['Hem circumference'] },
      { length: true, label: 'Shoulder', body: b.shoulder, garment: gs['Shoulder width'] },
      // a knit neckline sits at the base of the neck, which is wider than the neck measurement
      { label: 'Neck base', body: neckBase(b), garment: fam === 'tee' ? gs['Neck opening'] : collarLen, estimated: true },
      { length: true, label: 'Sleeve length', body: null, garment: gs['Sleeve length'] },
      { label: 'Bicep', body: d.bicep, garment: gs['Bicep circumference'], estimated: b.bicep === undefined },
      { label: 'Sleeve opening', body: d.bicep, garment: gs['Sleeve opening'], estimated: b.bicep === undefined },
    ];
  }
  const shirt = fam === 'shirt';
  return [
    { label: 'Chest', body: b.chest, garment: gs['Chest circumference'] },
    { label: 'Waist', body: b.waist, garment: gs['Waist circumference'] },
    { label: 'Hem / hips', body: b.hips, garment: gs['Hem circumference'] },
    { length: true, label: 'Shoulder', body: b.shoulder, garment: gs['Shoulder width'] },
    { label: 'Neck', body: b.neck, garment: collarLen },
    { length: true, label: 'Sleeve / arm', body: b.arm, garment: gs['Sleeve length'] + (shirt ? 6 : 0) },
    { label: 'Bicep', body: d.bicep, garment: gs['Bicep circumference'], estimated: b.bicep === undefined },
    { label: 'Cuff / wrist', body: d.wrist, garment: shirt ? collarCuff(pieces) : gs['Cuff opening'], estimated: b.wrist === undefined },
  ];
}

function bandH(pieces: Piece[]) {
  const wb = pieces.find((p) => p.role === 'waistband');
  return wb ? bbox(wb.points).h : 0;
}

function collarCuff(pieces: Piece[]) {
  const c = pieces.find((p) => p.role === 'cuff');
  return c ? computeSpec(c, c.specs[0])?.value ?? 0 : 0;
}

export interface SeamRow {
  label: string;
  a: number; // first edge length (cm)
  b: number; // edge it is sewn to
  ease?: number; // intended difference (cap ease, pleat, rib stretch); undefined means the two must match
}

/** Every sewing line with both edge lengths, like a seam-walking check on a cutting table. */
export function seamReport(type: GarmentType, pieces: Piece[]): SeamRow[] {
  const P = (role: string) => pieces.find((p) => p.role === role);
  const L = edgeLen;
  const style = migrateGarment(type);
  const fam = famOf(type);
  const f = P('front'), bk = P('back'), sl = P('sleeve');
  if (fam === 'pants') {
    const wb = P('waistband');
    const wbLen = wb ? computeSpec(wb, wb.specs[0])?.value ?? 0 : 0;
    const rows: SeamRow[] = [
      { label: 'Inseam (front / back)', a: L(f, 'front.6', 'front.8'), b: L(bk, 'back.6', 'back.8') },
      { label: 'Outseam (front / back)', a: L(f, 'front.1', 'front.5'), b: L(bk, 'back.1', 'back.5') },
      { label: 'Waist edge / waistband', a: 2 * (L(f, 'front.0', 'front.1') + L(bk, 'back.0', 'back.1')), b: wbLen },
    ];
    const cuff = P('cuff');
    if (cuff) {
      // rib cuff is stretched onto the leg opening while sewing
      const open = L(f, 'front.5', 'front.6') + L(bk, 'back.5', 'back.6');
      rows.push({ label: 'Ankle cuff / leg opening (rib stretched on)', a: L(cuff, 'cuff.1', 'cuff.1m'), b: open, ease: (RIB.cuff - 1) * open });
      rows.push({ label: 'Ankle cuff join', a: L(cuff, 'cuff.1', 'cuff.2'), b: L(cuff, 'cuff.1m', 'cuff.2m') });
    }
    return rows;
  }
  if (isHat(type)) {
    const cr = P('crown'), br = P('brim');
    const band = 6 * L(cr, 'crown.3m', 'crown.3');
    const rows: SeamRow[] = [{ label: 'Crown panel seams (panel / next panel)', a: L(cr, 'crown.0', 'crown.3'), b: L(cr, 'crown.0', 'crown.3m') }];
    if (fam === 'bucket') {
      rows.push({ label: 'Crown band / brim', a: band, b: L(br, 'brim.0', 'brim.6') + L(br, 'brim.0', 'brim.6m') });
      rows.push({ label: 'Brim back seam', a: L(br, 'brim.6', 'brim.7'), b: L(br, 'brim.6m', 'brim.7m') });
    } else {
      rows.push({ label: 'Front half of band / visor', a: band / 2, b: L(br, 'brim.0', 'brim.3') + L(br, 'brim.0', 'brim.3m') });
    }
    return rows;
  }
  const fo = frontOffset(style);
  const F = (i: number, m = '') => `front.${i + fo}${m}`;
  const rows: SeamRow[] = [
    { label: 'Shoulder R (front / back)', a: L(f, F(2), F(3)), b: L(bk, 'back.2m', 'back.3m') },
    { label: 'Shoulder L (front / back)', a: L(f, F(2, 'm'), F(3, 'm')), b: L(bk, 'back.2', 'back.3') },
    { label: 'Side seam R (front / back)', a: L(f, F(5), F(7)), b: L(bk, 'back.5m', 'back.7m') },
    { label: 'Side seam L (front / back)', a: L(f, F(5, 'm'), F(7, 'm')), b: L(bk, 'back.5', 'back.7') },
    { label: 'Sleeve seam (underarm)', a: L(sl, 'sleeve.3', 'sleeve.4'), b: L(sl, 'sleeve.3m', 'sleeve.4m') },
    {
      label: 'Sleeve cap / armhole', a: L(sl, 'sleeve.0', 'sleeve.3') + L(sl, 'sleeve.0', 'sleeve.3m'),
      b: L(f, F(3), F(5)) + L(bk, 'back.3m', 'back.5m'), ease: EASE[style].capEase,
    },
  ];
  const neck = necklineLen(type, pieces);
  const collar = P('collar');
  if (collar) rows.push({ label: 'Collar / neckline', a: L(collar, 'collar.1', 'collar.1m'), b: neck });
  const nb = P('neckband');
  if (nb) {
    rows.push({ label: 'Neckband / neckline (rib stretched on)', a: L(nb, 'neckband.1', 'neckband.1m'), b: neck, ease: (RIB.neckband - 1) * neck });
    rows.push({ label: 'Neckband join', a: L(nb, 'neckband.1', 'neckband.2'), b: L(nb, 'neckband.1m', 'neckband.2m') });
  }
  const pl = P('placket');
  if (pl) {
    rows.push({ label: 'Placket R / front opening', a: L(pl, 'placket.1', 'placket.2'), b: L(f, 'front.1', 'front.2') });
    rows.push({ label: 'Placket L / front opening', a: L(pl, 'placket.1m', 'placket.2m'), b: L(f, 'front.1m', 'front.2m') });
    rows.push({ label: 'Placket base / opening base', a: L(pl, 'placket.2', 'placket.2m'), b: L(f, 'front.1', 'front.1m') });
  }
  const cuff = P('cuff');
  if (cuff && sl) {
    const end = sl.points.filter((q) => q.tag === 'cuff');
    rows.push({ label: 'Sleeve end / cuff (pleat)', a: end.length === 2 ? Math.abs(end[0].x - end[1].x) : 0, b: computeSpec(cuff, cuff.specs[0])?.value ?? 0, ease: 6 });
  }
  return rows;
}
