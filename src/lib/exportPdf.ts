// Tech pack PDF a manufacturer can build from, A4 landscape, built in the browser with jsPDF.
//
//   1  Cover: style, size, fit, revision, 3D overview front / back / side
//   2  Materials: bill of materials for cloth (outside and inside faces apart), trims and findings
//   3  Trims and details list: every item numbered, with its measured position
//   4+ Detail sheets: per item a close-up photo of the draped garment, a placement drawing with measurements from
//      the usual references, the specs and the artwork layers
//   .. Close-ups: one page per point of interest (src/lib/poi.ts): 3D close-up, locator, flat piece and spec table
//   .. Construction: seams, stitches, inside finishing, pleats, custom and detached seams, notes
//   .. Pattern pieces (with placement marks, callout numbers and the notes drawn on the chart)
//   .. Cut list, points of measure, body vs garment, seam check
//
// Photos come from src/lib/detailShots.ts (the live 3D view). Without them the sheets still print, with a blank photo box.

import { jsPDF } from 'jspdf';
import type { Project } from '../store';
import { GARMENT_LABEL } from '../data/presets';
import { styleById, type StyleId } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import { BODY_FIELDS, limbGirths } from '../three/body';
import { bbox, centroid, offsetInward, samplePoly, type Pt } from './geometry';
import { constructionReport, seamReport, cutList, fabricBom, fabricText, fitTable, garmentSpecs, hardwareMarks, noteRows, pieceSpecs, placementMarks, trimDetails, trimsReport, type TrimDetail, FABRIC_WIDTH, MARKER_WASTE } from './specs';
import { pathRings, shapePolygon } from './shapes';
import { ringArea, scaleRings, traceTextUnit } from './textTrace';
import { edgeTrimRows } from '../data/edgeTrim';
import { finishRows } from '../data/finish';
import { includedPois, POI_KIND_LABEL, type Poi } from './poi';
import { bandRanges } from '../components/designDoc';
import { captureShots, type ShotProvider, type ShotRequest } from './detailShots';
import { toUnit, type Units } from './units';

const W = 297, H = 210, M = 12, TOP = 23, BOTTOM = H - 14;
const INK = '#1c2330', MUTED = '#6b7484', ACCENT = '#2563eb', LINE = '#d7dbe2', PANEL = '#f6f7f9', SOFT = '#cfe0fd';
const css = (c?: string, d = INK) => (c && /^#([0-9a-f]{6})/i.test(c) ? c.slice(0, 7) : c && /^#[0-9a-f]{3}$/i.test(c) ? c : d);

type Cell = string | { t: string; sw?: string; bold?: boolean };
interface Col { title: string; w: number; align?: 'left' | 'right' }

class Sheet {
  y = TOP;
  titles: string[] = [];
  cur = '';
  constructor(readonly doc: jsPDF) {}
  page(title: string) {
    if (this.titles.length) this.doc.addPage();
    this.titles.push(title);
    this.cur = title;
    this.y = TOP;
  }
  /** start a new page when h mm do not fit */
  need(h: number) {
    if (this.y + h <= BOTTOM) return false;
    this.page(`${this.cur.replace(/ \(cont\.\)$/, '')} (cont.)`);
    return true;
  }
}

function h2(sh: Sheet, text: string) {
  sh.need(14);
  sh.doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK).text(text, M, sh.y + 3);
  sh.doc.setDrawColor(INK).setLineWidth(0.3).line(M, sh.y + 5, W - M, sh.y + 5);
  sh.y += 9;
}

/** Table with wrapped cells; the header repeats on a new page. Returns nothing, advances sh.y. */
function table(sh: Sheet, cols: Col[], rows: Cell[][], opts: { x?: number; title?: string; size?: number } = {}) {
  const { doc } = sh;
  const x = opts.x ?? M, fs = opts.size ?? 8, lh = fs * 0.42, pad = 1.6;
  if (opts.title && opts.x === undefined) h2(sh, opts.title);
  else if (opts.title) { sh.need(16); doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK).text(opts.title, x, sh.y + 3); sh.y += 6; }
  const total = cols.reduce((s, c) => s + c.w, 0);
  const header = () => {
    doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(MUTED);
    let cx = x;
    for (const c of cols) { doc.text(c.title.toUpperCase(), c.align === 'right' ? cx + c.w - pad : cx + pad, sh.y + 3, { align: c.align ?? 'left' }); cx += c.w; }
    doc.setDrawColor(LINE).setLineWidth(0.2).line(x, sh.y + 4.6, x + total, sh.y + 4.6);
    sh.y += 5.6;
  };
  sh.need(16);
  header();
  for (const r of rows) {
    doc.setFont('helvetica', 'normal').setFontSize(fs);
    const cells = r.map((c, i) => {
      const t = typeof c === 'string' ? c : c.t;
      const sw = typeof c === 'string' ? undefined : c.sw;
      return { lines: doc.splitTextToSize(t, cols[i].w - 2 * pad - (sw ? 4.5 : 0)) as string[], sw, bold: typeof c === 'string' ? false : !!c.bold };
    });
    const rh = Math.max(...cells.map((c) => c.lines.length), 1) * lh + 2 * pad - 0.4;
    if (sh.need(rh)) header();
    let cx = x;
    cells.forEach((c, i) => {
      const col = cols[i];
      doc.setFont('helvetica', c.bold ? 'bold' : 'normal').setFontSize(fs).setTextColor(INK);
      let tx = col.align === 'right' ? cx + col.w - pad : cx + pad;
      if (c.sw) { doc.setFillColor(css(c.sw, '#888888')).setDrawColor('#9aa3b2').setLineWidth(0.15).roundedRect(cx + pad, sh.y + pad - 0.9, 3.4, 3.4, 0.6, 0.6, 'FD'); tx += 4.5; }
      doc.text(c.lines, tx, sh.y + pad + lh * 0.75, { align: col.align ?? 'left', lineHeightFactor: 1.05 });
      cx += col.w;
    });
    sh.y += rh;
    doc.setDrawColor('#e8ebf0').setLineWidth(0.15).line(x, sh.y, x + total, sh.y);
  }
  sh.y += 4;
}

/** key / value block of two columns */
function pairs(sh: Sheet, x: number, w: number, rows: [string, string][], size = 8.5) {
  const { doc } = sh;
  doc.setFontSize(size);
  for (const [k, v] of rows) {
    const lines = doc.splitTextToSize(v || '-', w - 30) as string[];
    doc.setFont('helvetica', 'normal').setTextColor(MUTED).text(k, x, sh.y + 3);
    doc.setFont('helvetica', 'normal').setTextColor(INK).text(lines, x + 30, sh.y + 3);
    sh.y += Math.max(1, lines.length) * size * 0.43 + 1.4;
  }
}

function badge(doc: jsPDF, x: number, y: number, n: number, r = 3) {
  doc.setFillColor(ACCENT).setDrawColor('#ffffff').setLineWidth(0.3).circle(x, y, r, 'FD');
  doc.setFont('helvetica', 'bold').setFontSize(r * 2.4).setTextColor('#ffffff').text(String(n), x, y + r * 0.35, { align: 'center' });
}

/** picture fitted into a box (contain), with a frame; null draws an empty box with a hint */
function picture(doc: jsPDF, img: string | null, x: number, y: number, w: number, h: number, hint = 'No photo') {
  doc.setFillColor(PANEL).setDrawColor(LINE).setLineWidth(0.2).roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
  if (!img) {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED).text(hint, x + w / 2, y + h / 2, { align: 'center' });
    return;
  }
  try {
    const pr = doc.getImageProperties(img);
    const k = Math.min(w / pr.width, h / pr.height);
    doc.addImage(img, 'PNG', x + (w - pr.width * k) / 2, y + (h - pr.height * k) / 2, pr.width * k, pr.height * k, undefined, 'FAST');
  } catch {
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED).text('Photo could not be read', x + w / 2, y + h / 2, { align: 'center' });
  }
}

function poly(doc: jsPDF, pts: Pt[], style: string) {
  if (pts.length < 2) return;
  doc.lines(pts.slice(1).map((q, i) => [q.x - pts[i].x, q.y - pts[i].y]), pts[0].x, pts[0].y, [1, 1], style, true);
}

const VIEW_NAME = { front: 'Front view', back: 'Back view', side: "Side view, wearer's left" } as const;

/** One close-up page: the 3D picture, where it is on the garment, the flat piece with the spot marked, and the numbers. */
function poiPage(sh: Sheet, o: Poi, p: Project, pics: (string | null)[], loc: string | null, no: number, of: number, u: (cm: number) => string, U: string) {
  const { doc } = sh;
  sh.page(`Close-up ${no} of ${of}`);
  doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(ACCENT).text(POI_KIND_LABEL[o.kind].toUpperCase(), M, sh.y + 2);
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(INK).text(o.title, M, sh.y + 9);
  const y0 = sh.y + 13;
  const two = o.targets.length > 1, ps = two ? 74 : 112;
  o.targets.forEach((tg, k) => {
    const x = M + k * (ps + 2);
    picture(doc, pics[k] ?? null, x, y0, ps, ps, 'No photo (export from the 3D view)');
    if (pics[k]) { doc.setDrawColor(ACCENT).setLineWidth(0.4).circle(x + ps / 2, y0 + ps / 2, ps * 0.07, 'S'); }
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED).text(`${VIEW_NAME[tg.view]}${tg.face === 'inside' ? ', inside face' : ''}`, x + 1.5, y0 + ps - 1.5);
  });
  // spec table and callouts on the right
  const sx = M + (two ? 2 * ps + 6 : ps + 6), sw = W - M - sx;
  sh.y = y0 - 1;
  doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(INK).text('Specification', sx, sh.y + 3);
  doc.setDrawColor(INK).setLineWidth(0.3).line(sx, sh.y + 4.5, sx + sw, sh.y + 4.5);
  sh.y += 6;
  pairs(sh, sx, sw, o.spec.map(([k, v]) => [k, v] as [string, string]), 7.8);
  if (o.callouts.length) {
    sh.y += 2;
    doc.setFont('helvetica', 'bold').setFontSize(8.5).setTextColor(INK).text('Notes for the factory', sx, sh.y + 3);
    sh.y += 5.5;
    doc.setFont('helvetica', 'normal').setFontSize(7.8);
    for (const c of o.callouts) {
      const lines = doc.splitTextToSize(c, sw - 4) as string[];
      if (sh.y + lines.length * 3.4 > BOTTOM) break;
      doc.setTextColor(c.startsWith('TO CONFIRM') ? '#b42318' : INK).text('•', sx, sh.y + 3).text(lines, sx + 3.5, sh.y + 3);
      sh.y += lines.length * 3.4 + 1;
    }
  }
  // locator and flat piece along the bottom of the left block
  const by = y0 + ps + 5, bh = BOTTOM - by;
  if (bh > 24) {
    const lw = Math.min(bh, 52);
    picture(doc, loc, M, by, lw, lw, 'No locator');
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED).text('Where on the garment', M, by + lw + 3);
    flatPiece(doc, o, p, M + lw + 4, by, (two ? 2 * ps + 2 : ps) - lw - 4, bh, u, U);
  }
}

/** The flat pattern piece with the spot marked (and the band stripes, where the page is about a band). */
function flatPiece(doc: jsPDF, o: Poi, p: Project, x: number, y: number, w: number, h: number, u: (cm: number) => string, U: string) {
  doc.setFillColor('#ffffff').setDrawColor(LINE).setLineWidth(0.2).roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
  const pc = p.pieces.find((q) => q.id === o.pieceId);
  if (!pc) return;
  const outline = samplePoly(pc.points, 16), bb = bbox(outline);
  const pad = 5, s = Math.min((w - 2 * pad) / bb.w, (h - 2 * pad - 3) / bb.h);
  const ox = x + (w - bb.w * s) / 2 - bb.minX * s, oy = y + pad - bb.minY * s;
  const P = (q: Pt) => ({ x: ox + q.x * s, y: oy + q.y * s });
  doc.setFillColor(PANEL).setDrawColor(INK).setLineWidth(0.3);
  poly(doc, outline.map(P), 'FD');
  const band = o.kind === 'band' ? p.edits?.bands?.find((b) => `band:${b.id}` === o.id) : undefined;
  const rng = band ? bandRanges(band, pc) : null;
  if (rng) for (const st of rng) { doc.setFillColor(css(st.color, '#888888')); poly(doc, [{ x: bb.minX, y: st.y0 }, { x: bb.maxX, y: st.y0 }, { x: bb.maxX, y: st.y1 }, { x: bb.minX, y: st.y1 }].map(P), 'F'); }
  doc.setDrawColor(ACCENT).setLineWidth(0.3);
  for (const m of o.outlines) poly(doc, m.map(P), 'S');
  for (const m of o.marks) { const c = P(m.at); doc.circle(c.x, c.y, Math.max(0.5, m.r * s), 'S'); }
  const c = P(o.at), rr = Math.max(1.6, Math.min(4, o.radiusCm * s * 0.5));
  doc.setDrawColor(ACCENT).setLineWidth(0.45).circle(c.x, c.y, rr, 'S').line(c.x - rr - 1, c.y, c.x + rr + 1, c.y).line(c.x, c.y - rr - 1, c.x, c.y + rr + 1);
  doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED).text(`${pc.name}, flat piece, ${u(bb.w)} x ${u(bb.h)} ${U}`, x + 1.5, y + h - 1.5);
}

/** Placement drawing: host outline, the item, and the measured distances from the references. */
function placementDrawing(doc: jsPDF, t: TrimDetail, host: Project['pieces'][number] | undefined, x: number, y: number, w: number, h: number, u: (cm: number) => string, U: string) {
  doc.setFillColor('#ffffff').setDrawColor(LINE).setLineWidth(0.2).roundedRect(x, y, w, h, 1.5, 1.5, 'FD');
  if (!host) return;
  const outline = samplePoly(host.points, 16);
  const bb = bbox(outline);
  const pad = 9;
  const s = Math.min((w - 2 * pad) / bb.w, (h - 2 * pad - 4) / bb.h);
  const ox = x + (w - bb.w * s) / 2 - bb.minX * s, oy = y + pad - 1 - bb.minY * s;
  const P = (q: Pt) => ({ x: ox + q.x * s, y: oy + q.y * s });
  doc.setFillColor(PANEL).setDrawColor(INK).setLineWidth(0.3);
  poly(doc, outline.map(P), 'FD');
  if (host.symmetric && host.role !== 'custom' && bb.minX < -1 && bb.maxX > 1) {
    doc.setDrawColor('#9aa3b2').setLineWidth(0.15).setLineDashPattern([1, 0.8], 0);
    const a = P({ x: 0, y: bb.minY }), b = P({ x: 0, y: bb.maxY });
    doc.line(a.x, a.y, b.x, b.y).setLineDashPattern([], 0);
  }
  // measurement lines first, so the item sits on top
  doc.setLineWidth(0.2);
  for (const r of t.refs) {
    const a = P(r.from), b = P(r.to);
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.8) continue;
    doc.setDrawColor(ACCENT).setLineWidth(0.2).line(a.x, a.y, b.x, b.y);
    const horizontal = Math.abs(a.y - b.y) < 0.01;
    if (horizontal) { doc.line(a.x, a.y - 1, a.x, a.y + 1); } else { doc.line(a.x - 1, a.y, a.x + 1, a.y); }
    doc.setFont('helvetica', 'bold').setFontSize(6.5);
    const label = `${u(r.value)} ${U}`;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, tw = doc.getTextWidth(label) + 1.2;
    doc.setFillColor('#ffffff').rect(mx - tw / 2, my - 1.9, tw, 3.2, 'F');
    doc.setTextColor(ACCENT).text(label, mx, my + 0.6, { align: 'center' });
  }
  const inside = t.face === 'inside';
  doc.setFillColor(SOFT).setDrawColor(ACCENT).setLineWidth(0.35);
  if (inside) doc.setLineDashPattern([0.9, 0.6], 0);
  for (const ring of t.outlines) poly(doc, ring.map(P), inside ? 'S' : 'FD');
  doc.setLineDashPattern([], 0);
  doc.setFillColor(ACCENT);
  for (const { at, r } of t.points) { const c = P(at); doc.circle(c.x, c.y, Math.max(0.7, r * s), 'F'); }
  if (t.line) { const a = P(t.line[0]), b = P(t.line[1]); doc.setDrawColor(ACCENT).setLineWidth(0.7).line(a.x, a.y, b.x, b.y); }
  const c = P(t.at);
  badge(doc, c.x + 4, c.y + 4, t.no, 2.6);
  doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED);
  doc.text(`${host.name}, outside view  ·  scale 1:${Math.round(10 / s)}${inside ? '  ·  dashed = on the inside face' : ''}`, x + w / 2, y + h - 2, { align: 'center' });
}

/** Artwork layers drawn flat in a box, so the maker sees what goes on the item. */
function artwork(doc: jsPDF, t: TrimDetail, att: NonNullable<Project['edits']>['attachments'][number] | undefined, x: number, y: number, size: number) {
  doc.setFillColor('#ffffff').setDrawColor(LINE).setLineWidth(0.2).roundedRect(x, y, size, size, 1, 1, 'FD');
  if (!att?.layers.length) return;
  let ext = Math.max(att.w, att.h, 0.5);
  for (const l of att.layers) ext = Math.max(ext, Math.abs(l.x) * 2 + l.w, Math.abs(l.y) * 2 + l.h);
  const s = (size - 4) / ext, cx = x + size / 2, cy = y + size / 2;
  for (const l of att.layers) {
    const rot = ((l.rotation ?? 0) * Math.PI) / 180, co = Math.cos(rot), si = Math.sin(rot), fx = l.flipX ? -1 : 1;
    const T = (q: Pt) => ({ x: cx + (l.x + (q.x * fx) * co - q.y * si) * s, y: cy + (l.y + (q.x * fx) * si + q.y * co) * s });
    if (l.shape === 'image' && l.image) {
      try { doc.addImage(l.image, 'PNG', cx + (l.x - l.w / 2) * s, cy + (l.y - l.h / 2) * s, l.w * s, l.h * s, undefined, 'FAST'); } catch { /* skip */ }
      continue;
    }
    // text: the letters of the layer's own font, counters (holes) knocked out in the white of the artwork box
    const traced = l.shape === 'text' ? traceTextUnit(l.text, (l as { font?: string }).font) : null;
    const rings = traced?.length ? scaleRings(traced, l.w, l.h) : l.shape === 'path' && l.path ? pathRings(l.path).map((r) => r.map((q) => ({ x: q.x * l.w, y: q.y * l.h }))) : shapePolygon(l.shape, l.w, l.h, l.text);
    for (const r of [...rings].sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)))) {
      doc.setFillColor(traced?.length && ringArea(r) < 0 ? '#ffffff' : css(l.color, '#444444'));
      poly(doc, r.map(T), 'F');
    }
  }
  doc.setFont('helvetica', 'normal').setFontSize(6).setTextColor(MUTED).text('Artwork', x + size / 2, y + size + 2.6, { align: 'center' });
}

/** Trims for the bill of materials, by style. */
function styleTrims(id: StyleId): string[][] {
  const s = styleById(id);
  const out: string[][] = [];
  if (s.family === 'pants') {
    if (s.details.drawcord) out.push(['Elastic', '4 cm wide, knitted', '1'], ['Drawcord', 'Flat cotton, 140 cm', '1']);
    else out.push(['Shank button', '17 mm', '1'], ['Zip', 'Metal, 15 cm fly', '1']);
    if (s.details.rivets) out.push(['Rivets', 'Copper, 9 mm', '6']);
  } else if (s.family === 'cap') {
    if (s.details.buttons) out.push(['Top button', 'Fabric covered, 18 mm', '1']);
    out.push(['Visor insert', s.id === 'five-panel' ? 'Soft plastic, lightly curved' : 'Plastic, pre-curved', '1'], ['Sweatband', 'Cotton tape, 3 cm', '1']);
  } else if (s.family === 'visor') {
    out.push(['Visor insert', 'Plastic, pre-curved', '1'], ['Sweatband', 'Terry tape, 3 cm', '1'], ['Elastic', '2.5 cm wide, knitted', '1']);
  } else if (s.family === 'beanie') {
    out.push(['Thread', 'Stretch overlock, matching', '1']);
  } else if (s.family === 'bucket') {
    out.push(['Sweatband', 'Cotton tape, 3 cm', '1']);
  } else if (s.family === 'jacket') {
    out.push(['Buttons', '20 mm, 4 hole', String(s.details.buttons ?? 5)]);
  } else if (s.details.buttons) {
    out.push(['Buttons', s.family === 'polo' ? '15 mm, 4 hole' : '11 mm, 4 hole', String(s.details.buttons)]);
  }
  return out;
}

export interface TechPackOptions {
  /** supply the camera (tests, tools); default is the live 3D view */
  capture?: ShotProvider;
  /** photo size in pixels */
  photoSize?: number;
  /** style number printed on every page; default derived from the project id */
  styleNo?: string;
  season?: string;
}

const dateStamp = (t: number) => new Date(t).toISOString().slice(0, 10);

/**
 * Build the tech pack. `snapshot` is a screenshot of the 3D canvas, used for the front view when the 3D close-up
 * camera is not available.
 */
export async function buildTechPack(p: Project, units: Units, snapshot: string | null = null, opts: TechPackOptions = {}): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const sh = new Sheet(doc);
  const u = (cm: number) => `${toUnit(cm, units).toFixed(units === 'cm' ? 1 : 2)}`;
  const U = units === 'cm' ? 'cm' : 'in';
  const fit = p.fit ?? 'regular';
  const styleName = GARMENT_LABEL[p.garment];
  const styleNo = opts.styleNo ?? `TI-${p.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase()}`;
  const rev = `Rev ${dateStamp(p.updatedAt)}`;
  const edits = p.edits;

  // ---- content ----
  const bom = fabricBom(p.pieces, edits, p.garment);
  const trims = trimDetails(p.pieces, edits, p.garment);
  const cons = constructionReport(p.garment, p.pieces, edits);
  const seamRows = seamReport(p.garment, p.pieces, edits);
  const notes = noteRows(p.notes, p.pieces);
  const hostOf = (id: string) => p.pieces.find((q) => q.id === id);

  // ---- photos, one call ----
  const size = opts.photoSize ?? 480;
  const requests: ShotRequest[] = [{ kind: 'overview', view: 'front' }, { kind: 'overview', view: 'back' }, { kind: 'overview', view: 'side' }];
  const tIdx: number[] = [];
  for (const t of trims) {
    const host = hostOf(t.hostId);
    let ext = Math.max(t.w, t.h);
    const pts = [...t.points.map((q) => q.at), ...(t.line ?? [])];
    if (pts.length) { const b = bbox(pts); ext = Math.max(b.w, b.h, ext && t.kind !== 'hardware' ? ext : 0) + 2; }
    tIdx.push(requests.length);
    requests.push({
      kind: 'attachment',
      view: host?.role === 'back' ? 'back' : host?.role === 'sleeve' ? 'side' : 'front',
      target: { pieceId: t.hostId, instance: t.instance ?? 0, x: t.at.x, y: t.at.y, radiusCm: Math.min(16, Math.max(4, ext * 0.9 + 2.5)), face: t.face },
    });
  }
  const innerIds = Object.keys(edits?.insideFabric ?? {}).filter((id) => p.pieces.some((q) => q.id === id));
  const iIdx: number[] = [];
  for (const id of innerIds) {
    const pc = p.pieces.find((q) => q.id === id)!;
    const bb = bbox(pc.points);
    iIdx.push(requests.length);
    requests.push({ kind: 'inside', view: pc.role === 'back' ? 'back' : 'front', target: { pieceId: id, instance: 0, x: bb.minX + bb.w / 2, y: bb.minY + bb.h / 2, radiusCm: Math.min(24, Math.max(6, Math.max(bb.w, bb.h) / 2 + 3)), face: 'inside' } });
  }
  const shots = await captureShots(requests, size, opts.capture);
  // close-up pages: a big picture per target and a small whole-garment locator with a ring on the spot
  const pois = includedPois(p);
  const poiReq: ShotRequest[] = [], locReq: ShotRequest[] = [];
  const poiIdx: number[][] = [];
  for (const o of pois) {
    poiIdx.push(o.targets.map((tg) => {
      poiReq.push({ kind: tg.face === 'inside' ? 'inside' : 'attachment', view: tg.view, target: { pieceId: tg.pieceId, instance: tg.instance, x: tg.at.x, y: tg.at.y, radiusCm: o.radiusCm, face: tg.face } });
      return poiReq.length - 1;
    }));
    locReq.push({ kind: 'overview', view: o.view, marker: true, target: { pieceId: o.pieceId, instance: o.instance, x: o.at.x, y: o.at.y, radiusCm: o.radiusCm, face: o.face } });
  }
  const poiShots = await captureShots(poiReq, Math.round(size * 1.4), opts.capture);
  const locShots = await captureShots(locReq, 360, opts.capture);
  const overview = [shots[0] ?? snapshot, shots[1], shots[2]];
  const haveOverview = overview.some(Boolean);

  // ================= 1. cover =================
  sh.page('Cover');
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(26).text(p.name, M, 36);
  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(MUTED).text(`${styleName}  ·  ${fit[0].toUpperCase() + fit.slice(1)} fit`, M, 44);
  sh.y = 52;
  pairs(sh, M, 100, [
    ['Style', styleName],
    ['Style number', styleNo],
    ['Season', opts.season ?? '____________'],
    ['Revision', `${rev}${p.imported ? `  (imported${p.imported.from ? ` from ${p.imported.from}` : ''})` : ''}`],
    ['Fit', `${fit[0].toUpperCase() + fit.slice(1)}`],
    ['Fit model', `H ${u(p.body.height)}  Chest ${u(p.body.chest)}  Waist ${u(p.body.waist)}  Hips ${u(p.body.hips)} ${U}`],
    ['Shell fabric', bom.filter((r) => r.face === 'outside').map((r) => `${r.fabric}, ${r.colour}`).join('; ') || '-'],
    ['Items to place', trims.length ? `${trims.length} (numbered on the detail sheets)` : 'none'],
    ['Pattern pieces', `${p.pieces.length}`],
  ], 9);
  sh.y += 3;
  const lg = limbGirths(p.body) as Record<string, number>;
  const half = Math.ceil(BODY_FIELDS.length / 2);
  const bodyRows = BODY_FIELDS.map((f) => {
    const v = (p.body[f.key] as number | undefined) ?? lg[f.key];
    return [f.label + (p.body[f.key] === undefined ? ' (est.)' : ''), u(v)];
  });
  const yBody = sh.y;
  table(sh, [{ title: 'Fit model', w: 42 }, { title: U, w: 20, align: 'right' }], bodyRows.slice(0, half), { size: 7.5 });
  const yEnd = sh.y;
  sh.y = yBody;
  table(sh, [{ title: 'Fit model', w: 42 }, { title: U, w: 20, align: 'right' }], bodyRows.slice(half), { x: M + 68, size: 7.5 });
  sh.y = Math.max(yEnd, sh.y);
  // sign-off
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
  const sy = Math.max(sh.y + 4, H - 40);
  doc.setDrawColor(LINE).setLineWidth(0.2);
  ['Designer', 'Manufacturer', 'Approved'].forEach((l, i) => { const lx = M + i * 46; doc.line(lx, sy + 8, lx + 42, sy + 8); doc.text(l, lx, sy + 11.5); });
  // overview
  const ox = 150, ow = (W - M - ox - 4) / 3 + 0;
  ['Front', 'Back', 'Side'].forEach((l, i) => {
    const bx = ox + i * (ow + 2);
    picture(doc, overview[i] ?? null, bx, 24, ow, 150, i === 0 && !haveOverview ? 'No 3D picture' : 'No photo');
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(INK).text(l, bx + ow / 2, 179, { align: 'center' });
  });
  doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED).text('3D render of the draped garment on the fit model. Colours on screen can differ from the cloth.', ox, 185);

  // ================= 2. materials =================
  sh.page('Materials');
  const col = (r: (typeof bom)[number]) => ({ t: `${r.colour}\n${r.hex}`, sw: r.hex });
  table(sh, [
    { title: 'Face', w: 24 }, { title: 'Fabric', w: 42 }, { title: 'Colour', w: 30 }, { title: 'gsm', w: 12, align: 'right' }, { title: 'Pattern, repeat, colourway', w: 56 },
    { title: 'Finish', w: 26 }, { title: 'Used on', w: 55 }, { title: `Use, m x ${FABRIC_WIDTH} cm`, w: 28, align: 'right' },
  ], bom.map((r) => [
    { t: r.faceLabel, bold: true },
    `${r.fabric}\n${r.category}\n${r.composition}`,
    col(r),
    `${r.gsm}\n${r.thickness} mm`,
    r.pattern ? `${r.pattern}\nRepeat ${r.repeat}\n${r.construction === 'woven' ? 'Woven in' : 'Printed'}, colourway ${r.colourway}${r.adjust ? `\nAdjusted: ${r.adjust}` : ''}` : 'Plain, no pattern',
    r.finish,
    `${r.where.join(', ')}${r.face === 'outside' && r.insideToo.length ? `\nInside face is the same cloth on: ${r.insideToo.join(', ')}` : ''}${r.stacks.length ? `\nLayers: ${r.stacks.join('; ')}` : ''}`,
    `${r.metres.toFixed(2)} m\n${(r.kg).toFixed(2)} kg`,
  ]), { title: 'Fabrics: outside and inside faces' });
  const totalM = bom.reduce((s, r) => s + r.metres, 0);
  doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED);
  doc.text(doc.splitTextToSize(`Consumption = cut area (sewing line plus 1 cm seam allowance, every copy) on a ${FABRIC_WIDTH} cm roll with ${Math.round((MARKER_WASTE - 1) * 100)}% marker waste. Total ${totalM.toFixed(2)} m of cloth. Composition is typical for the fabric type: confirm with the mill. Inside rows exist only where the inside face differs from the outside.`, W - 2 * M), M, sh.y - 1);
  sh.y += 9;
  const tr = trimsReport(p.pieces, edits, p.garment);
  table(sh, [{ title: 'Trim or finding', w: 56 }, { title: 'Specification', w: 130 }, { title: 'Placement', w: 60 }, { title: 'Qty', w: 20, align: 'right' }], [
    ...styleTrims(p.garment).map((r) => [r[0], r[1], 'Per style', r[2]]),
    ['Thread', 'Polyester core-spun, colour matched to each cloth' + (cons.topstitch ? `; topstitch: ${cons.topstitch}` : ''), 'All seams', '1 cone'],
    ...tr.map((t) => [t.item, t.detail, t.placement, String(t.qty)]),
    ...edgeTrimRows(p.garment, p.pieces, edits).map((t) => [t.item, t.detail, t.placement, String(t.qty)]),
    ['Care label', 'Woven, as per target market rules', 'Inside, centre back neck', '1'],
  ], { title: 'Trims and findings (totals)' });

  // ================= 3. trims and details list =================
  if (trims.length) {
    sh.page('Trims and details');
    table(sh, [
      { title: 'No', w: 9 }, { title: 'Item', w: 32 }, { title: 'Specification', w: 88 }, { title: 'On', w: 52 }, { title: `Position (${U})`, w: 74 }, { title: 'Qty', w: 14, align: 'right' },
    ], trims.map((t) => [
      { t: String(t.no), bold: true },
      { t: `${t.item}\n${t.name}`, bold: false },
      [t.material, t.finish, t.colour, t.size, t.thread !== 'None' ? `Thread ${t.thread}` : ''].filter(Boolean).join('; '),
      `${t.side}\n${t.faceName}`,
      t.refs.length ? t.refs.map((r) => `${r.label} ${u(r.value)}`).join('\n') : `Centre ${u(t.at.x)} / ${u(t.at.y)}`,
      String(t.qty),
    ]), { title: 'Every item to place, numbered' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED).text('Numbers match the photos, the placement drawings and the callouts on the pattern sheet. Positions are to the centre of the item, measured flat on the pattern piece, outside face unless noted.', M, sh.y);
  }

  // ================= 3b. wash and distress =================
  const wash = finishRows(p.garment, p.pieces, edits?.finish);
  if (wash.length) {
    sh.page('Wash and distress');
    table(sh, [{ title: 'No', w: 9 }, { title: 'Process', w: 84 }, { title: 'Location', w: 100 }, { title: 'Area', w: 36 }, { title: 'Strength', w: 18 }], wash.map((r) => [
      { t: String(r.no), bold: true }, r.process, r.where, r.area, r.strength,
    ]), { title: 'Wash and distress: processes and where they go' });
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(MUTED).text(doc.splitTextToSize('Positions are measured on the flat pattern piece, outside face. Marks on a piece cut twice are listed per side. Confirm every process on a sample with the laundry before bulk: wash results vary with the cloth and the batch.', W - 2 * M), M, sh.y);
  }

  // ================= 4. detail sheets =================
  const BH = 84;
  trims.forEach((t, i) => {
    if (i % 2 === 0) sh.page('Detail sheets');
    const y0 = TOP + (i % 2) * (BH + 4);
    const host = hostOf(t.hostId);
    const att = edits?.attachments.find((q) => q.id === t.id);
    // header
    badge(doc, M + 3.2, y0 + 3.4, t.no, 3.2);
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(INK).text(`${t.item}: ${t.name}`, M + 8.5, y0 + 4.6);
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(MUTED).text(`${t.side}  ·  ${t.faceName}  ·  Qty ${t.qty}`, W - M, y0 + 4.6, { align: 'right' });
    doc.setDrawColor(LINE).setLineWidth(0.2).line(M, y0 + 7.2, W - M, y0 + 7.2);
    const by = y0 + 9, bh = BH - 11;
    // photo with callout
    const px = M, pw = 78;
    picture(doc, shots[tIdx[i]] ?? null, px, by, pw, bh, 'No photo (export from the 3D view)');
    if (shots[tIdx[i]]) {
      badge(doc, px + 4, by + 4, t.no, 3);
      doc.setDrawColor(ACCENT).setLineWidth(0.4);
      doc.circle(px + pw / 2, by + bh / 2, Math.min(pw, bh) * 0.14, 'S');
    }
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED).text(t.face === 'inside' ? 'Close-up, inside face' : 'Close-up', px + 1.5, by + bh - 1.5);
    // placement drawing
    const dx = px + pw + 5;
    placementDrawing(doc, t, host, dx, by, pw, bh, u, U);
    // specs
    const sx = dx + pw + 6, sw = W - M - sx;
    const saveY = sh.y;
    sh.y = by - 1;
    const rows: [string, string][] = [
      ['Item', `${t.item}${t.kind === 'hardware' && t.note ? '' : ''}`],
      ['Material', t.material],
      ['Finish', t.finish],
      ['Colour', t.colour],
      ['Thread', t.thread],
      ['Stitch', t.stitch],
      ['Sewn', t.method],
      ['Size', t.size + (t.rotation ? `, rotated ${Math.round(t.rotation)} deg` : '')],
      ['Quantity', `${t.qty} on the garment`],
      ...t.refs.map((r, k): [string, string] => [k ? '' : 'Position', `${r.label} ${u(r.value)} ${U}`]),
    ];
    if (t.note && t.kind === 'hardware') rows.splice(2, 0, ['Detail', t.note]);
    pairs(sh, sx, sw, rows, 7.8);
    if (t.layers.length) {
      sh.y += 1;
      const ay = sh.y;
      doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(INK).text(`Artwork layers (${t.layers.length})`, sx, ay + 3);
      let ly = ay + 6.5;
      doc.setFont('helvetica', 'normal').setFontSize(7.2);
      t.layers.slice(0, 7).forEach((l, k) => {
        doc.setFillColor(css(l.color, '#888888')).setDrawColor('#9aa3b2').setLineWidth(0.15).roundedRect(sx, ly - 2.4, 3, 3, 0.5, 0.5, 'FD');
        doc.setTextColor(INK).text(`${k + 1}. ${l.label}, ${l.color}, ${l.size}`, sx + 4.2, ly);
        ly += 3.5;
      });
      if (t.layers.length > 7) doc.setTextColor(MUTED).text(`and ${t.layers.length - 7} more`, sx + 4.2, ly);
      const aw = Math.min(30, BOTTOM);
      if (by + bh - (ay) > 40) artwork(doc, t, att, sx + sw - aw, Math.max(ay + 1, by + bh - aw - 3), aw);
    }
    sh.y = saveY;
  });

  // ================= 4b. close-ups, one page per point of interest =================
  pois.forEach((o, i) => poiPage(sh, o, p, poiIdx[i].map((k) => poiShots[k] ?? null), locShots[i] ?? null, i + 1, pois.length, u, U));

  // ================= 5. construction =================
  sh.page('Construction');
  h2(sh, 'Stitching and finishing');
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(INK);
  for (const f of cons.finishing) {
    const lines = doc.splitTextToSize(f, W - 2 * M - 5) as string[];
    sh.need(lines.length * 4 + 2);
    doc.text('•', M + 1, sh.y + 3).text(lines, M + 5, sh.y + 3);
    sh.y += lines.length * 3.8 + 1.4;
  }
  if (p.edits?.collar) { doc.text(cons.collar ?? '', M + 5, sh.y + 3); sh.y += 5; }
  else if (cons.collar) { doc.text(`•`, M + 1, sh.y + 3).text(cons.collar, M + 5, sh.y + 3); sh.y += 5; }
  sh.y += 3;
  table(sh, [{ title: 'Seam', w: 76 }, { title: 'Type', w: 24 }, { title: 'Stitch', w: 92 }, { title: 'Allow.', w: 22, align: 'right' }, { title: `Edges ${U}`, w: 30, align: 'right' }, { title: 'Note', w: 29 }],
    cons.seams.map((r, i) => [r.label, r.type, r.stitch, r.allowance, seamRows[i] ? `${u(seamRows[i].a)} / ${u(seamRows[i].b)}` : '', r.note ?? '']), { title: 'Seams' });
  if (cons.pleats.length) {
    table(sh, [{ title: 'Piece', w: 44 }, { title: 'Side', w: 42 }, { title: 'Type', w: 22 }, { title: `Depth ${U}`, w: 24, align: 'right' }, { title: `Intake ${U}`, w: 24, align: 'right' }, { title: `Fold length ${U}`, w: 28, align: 'right' }, { title: 'Position', w: 50 }],
      cons.pleats.map((r) => [r.piece, r.side, r.type, u(r.depth), u(r.intake), u(r.length), r.at]), { title: 'Pleats' });
  }
  if (cons.custom.length || cons.detached.length) {
    table(sh, [{ title: 'Seam edit', w: 120 }, { title: 'Detail', w: 150 }], [
      ...cons.custom.map((c) => ['Added seam: ' + c.label, `Edges ${u(c.a)} / ${u(c.b)} ${U}${c.flip ? ', sewn reversed' : ''}; lockstitch 301 + overlock 504, 1 cm allowance`]),
      ...cons.detached.map((d) => ['Left open: ' + d, 'Do not sew this seam']),
    ], { title: 'Custom and detached seams' });
  }
  if (iIdx.some((k) => shots[k])) {
    sh.need(66);
    h2(sh, 'Inside views');
    let bx = M;
    innerIds.forEach((id, k) => {
      const pc = hostOf(id)!;
      sh.need(0);
      picture(doc, shots[iIdx[k]] ?? null, bx, sh.y, 56, 56);
      doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(MUTED).text(doc.splitTextToSize(`${pc.name}, inside: ${fabricText(edits!.insideFabric![id])}`, 56), bx, sh.y + 59.5);
      bx += 60;
      if (bx + 56 > W - M) { bx = M; sh.y += 70; sh.need(66); }
    });
    sh.y += 70;
  }
  if (notes.length) {
    table(sh, [{ title: 'No', w: 10 }, { title: 'On', w: 40 }, { title: 'Note', w: 220 }], notes.map((n) => [{ t: `N${n.no}`, bold: true }, n.piece, n.text]), { title: 'Notes from the designer' });
  }

  // ================= 6. pattern pieces =================
  sh.page('Pattern pieces');
  const all = p.pieces.flatMap((pc) => samplePoly(pc.points, 16).map((q) => ({ x: q.x + pc.offset.x, y: q.y + pc.offset.y })));
  const bb = bbox(all);
  const s = Math.min((W - 2 * M - 20) / bb.w, (H - 40 - 10) / bb.h);
  const ox2 = M + 10 - bb.minX * s + ((W - 2 * M - 20) - bb.w * s) / 2, oy2 = 26 - bb.minY * s;
  for (const pc of p.pieces) {
    const sew = samplePoly(pc.points, 20).map((q) => ({ x: (q.x + pc.offset.x) * s + ox2, y: (q.y + pc.offset.y) * s + oy2 }));
    const cut = offsetInward(sew, -1 * s);
    doc.setDrawColor('#94a3b8').setLineWidth(0.2);
    poly(doc, cut, 'S');
    doc.setDrawColor(INK).setLineWidth(0.35).setLineDashPattern([1.2, 0.8], 0);
    poly(doc, sew, 'S');
    doc.setLineDashPattern([], 0);
    const c = centroid(sew), pb = bbox(sew);
    doc.setDrawColor(INK).setLineWidth(0.25).line(c.x, c.y - pb.h * 0.25, c.x, c.y + pb.h * 0.25);
    const inner = edits?.insideFabric?.[pc.id];
    const fi = (f: Project['pieces'][number]['fabric']) => `${fabricById(f.id).name}, ${fabricText(f).split(', ').slice(1).join(', ')}`;
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(INK).text(pc.name, c.x + 1.5, c.y - 1);
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED).text(`Cut ${pc.cut}  ·  ${fi(pc.fabric)}`, c.x + 1.5, c.y + 2.5, { maxWidth: 55 });
    if (inner) doc.text(`Inside: ${fi(inner)}`, c.x + 1.5, c.y + 5.5, { maxWidth: 55 });
    const P = (q: { x: number; y: number }) => ({ x: (q.x + pc.offset.x) * s + ox2, y: (q.y + pc.offset.y) * s + oy2 });
    const marks = placementMarks(pc, p.pieces, edits);
    doc.setDrawColor(ACCENT).setLineWidth(0.2).setLineDashPattern([0.8, 0.6], 0);
    for (const m of marks.outlines) poly(doc, m.pts.map(P), 'S');
    doc.setLineDashPattern([], 0);
    for (const h of hardwareMarks(pc, edits)) {
      if (h.line) { const A = P(h.line[0]), B = P(h.line[1]); doc.setLineWidth(0.4).line(A.x, A.y, B.x, B.y).setLineWidth(0.2); continue; }
      if (h.slots) { for (const sl of h.slots) poly(doc, sl.map(P), 'S'); continue; } // buttonholes: the stitched slot
      for (const { at, r } of h.points) { const cc = P(at); doc.circle(cc.x, cc.y, Math.max(0.4, r * s), 'S'); }
    }
    for (const m of marks.outlines) {
      if (!m.name) continue;
      const cc = P(m.centre);
      doc.line(cc.x - 1, cc.y, cc.x + 1, cc.y).line(cc.x, cc.y - 1, cc.x, cc.y + 1);
      doc.setFont('helvetica', 'normal').setFontSize(5.5).setTextColor(ACCENT).text(m.name, cc.x + 1.2, cc.y - 1.2);
    }
    for (const t of trims) if (t.hostId === pc.id) { const cc = P(t.at); badge(doc, cc.x - 3.4, cc.y - 3.4, t.no, 2.4); }
    for (const { marks: pm } of marks.pleats) {
      doc.setDrawColor(INK).setLineWidth(0.2).setLineDashPattern([0.4, 0.4], 0);
      for (const [a, b] of pm.folds) { const A = P(a), B = P(b); doc.line(A.x, A.y, B.x, B.y); }
      doc.setLineDashPattern([], 0).setLineWidth(0.3);
      for (const q of pm.notches) { const A = P(q), B = P({ x: q.x - pm.n.x, y: q.y - pm.n.y }); doc.line(A.x, A.y, B.x, B.y); }
    }
    doc.setTextColor(ACCENT).setFontSize(6);
    for (const m of pieceSpecs(pc, edits).filter((q) => !q.vertical)) {
      const a = P(m.a), b = P(m.b);
      doc.setDrawColor(ACCENT).setLineWidth(0.15).line(a.x, a.y, b.x, b.y);
      doc.text(`${m.label} ${u(m.value)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 0.8, { align: 'center' });
    }
  }
  // notes drawn on the chart (anchored to a piece, or to the chart)
  const pieceById = new Map(p.pieces.map((q) => [q.id, q]));
  for (const n of p.notes ?? []) {
    const own = n.pieceId ? pieceById.get(n.pieceId) : undefined;
    const P = (q: { x: number; y: number }) => ({ x: (q.x + (own?.offset.x ?? 0)) * s + ox2, y: (q.y + (own?.offset.y ?? 0)) * s + oy2 });
    const pts = n.points.map(P);
    const colr = css(n.color, '#d9480f');
    doc.setDrawColor(colr).setLineWidth(Math.min(0.8, Math.max(0.2, n.width * 0.12)));
    if (n.kind === 'ink' && pts.length > 1) poly(doc, pts, 'S');
    else if (n.kind === 'arrow' && pts.length > 1) {
      const [a, b] = [pts[0], pts[pts.length - 1]], ang = Math.atan2(b.y - a.y, b.x - a.x);
      doc.line(a.x, a.y, b.x, b.y);
      poly(doc, [b, { x: b.x - 2.4 * Math.cos(ang - 0.4), y: b.y - 2.4 * Math.sin(ang - 0.4) }, { x: b.x - 2.4 * Math.cos(ang + 0.4), y: b.y - 2.4 * Math.sin(ang + 0.4) }], 'S');
    } else if (n.kind === 'text' && pts[0] && n.text?.trim()) {
      const no = notes.find((q) => q.text === n.text!.trim())?.no;
      doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(colr);
      const lines = doc.splitTextToSize(n.text.trim(), 46) as string[];
      const hh = lines.length * 3 + 1.6, ww = Math.max(...lines.map((l) => doc.getTextWidth(l))) + 2;
      doc.setFillColor('#ffffff').setLineWidth(0.25).roundedRect(pts[0].x, pts[0].y, ww, hh, 0.8, 0.8, 'FD');
      doc.text(lines, pts[0].x + 1, pts[0].y + 3);
      if (no) { doc.setFontSize(5.5).text(`N${no}`, pts[0].x, pts[0].y - 0.8); }
    }
  }
  doc.setTextColor(MUTED).setFont('helvetica', 'normal').setFontSize(7.5).text(`Scale 1:${Math.round(1 / (s / 10))}. Dashed = sewing line (finished size), solid = cut line, blue dashed = placement, numbered blue circles = items on the detail sheets, dotted = pleat fold. Use the DXF export for full-size cutting.`, M, H - 17);

  // ================= 7. cut list and specification =================
  sh.page('Cut list');
  table(sh, [{ title: 'Piece', w: 48 }, { title: 'Cut', w: 12, align: 'right' }, { title: 'Outside fabric', w: 78 }, { title: 'Inside fabric', w: 78 }, { title: 'Note', w: 57 }],
    cutList(p.pieces, edits, p.garment).map((r) => {
      const pc = p.pieces.find((q) => q.name === r.name && q.fabric);
      const inner = pc ? edits?.insideFabric?.[pc.id] : undefined;
      return [r.name, String(r.cut), r.material ?? r.fabric, inner ? fabricText(inner) : 'Same as outside', (inner ? '' : [r.detail && !r.material ? r.detail : '', r.note].filter(Boolean).join('. ')) || (r.note && !inner ? r.note : '')];
    }), { title: 'Cut list' });

  sh.page('Specification');
  const gs = garmentSpecs(p.garment, p.pieces);
  const y0 = sh.y;
  table(sh, [{ title: 'Point of measure', w: 52 }, { title: U, w: 22, align: 'right' }, { title: 'Tol ±', w: 16, align: 'right' }], gs.map((r) => [r.label, u(r.value), r.value > 60 ? u(1) : u(0.5)]), { title: 'Points of measure', x: M });
  const yA = sh.y;
  sh.y = y0;
  table(sh, [{ title: 'Fit check', w: 30 }, { title: 'Body', w: 18, align: 'right' }, { title: 'Garment', w: 20, align: 'right' }, { title: 'Ease', w: 18, align: 'right' }],
    fitTable(p.garment, p.pieces, p.body).map((r) => [r.label, r.body === null ? '' : u(r.body) + (r.estimated ? '*' : ''), u(r.garment), r.body === null ? '' : (r.garment - r.body > 0 ? '+' : '') + u(r.garment - r.body)]), { title: 'Body vs garment', x: M + 100 });
  sh.y = Math.max(yA, sh.y);
  sh.y = y0;
  table(sh, [{ title: 'Seam', w: 44 }, { title: 'Edges', w: 26, align: 'right' }, { title: '', w: 14, align: 'right' }],
    seamRows.map((r) => [r.label.replace(' (front / back)', ''), `${u(r.a)}/${u(r.b)}`, r.ease !== undefined ? `${r.a - r.b >= 0 ? '+' : ''}${u(r.a - r.b)}` : Math.abs(r.a - r.b) < 0.1 ? 'OK' : 'CHECK']), { title: 'Seam check', x: M + 190 });

  // ---- headers and footers, with page x of y ----
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    doc.setFillColor(PANEL).rect(0, 0, W, 16, 'F');
    doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(11).text('tech-it', M, 10.5);
    doc.setFont('helvetica', 'normal').setTextColor(MUTED).setFontSize(9).text(`${p.name}  ·  ${styleName}  ·  ${styleNo}`, M + 18, 10.5);
    doc.text(sh.titles[i - 1] ?? '', W - M, 10.5, { align: 'right' });
    doc.setDrawColor(LINE).setLineWidth(0.2).line(0, 16, W, 16);
    doc.setFontSize(7.5).text(`${rev}  ·  Generated ${new Date().toLocaleDateString()}  ·  Finished garment sizes unless noted. Seam allowance 1 cm. ${U === 'in' ? 'Inches.' : 'Centimetres.'}`, M, H - 6);
    doc.text(`Page ${i} of ${n}`, W - M, H - 6, { align: 'right' });
  }
  return doc;
}

/** Build and save the tech pack as `<project>_techpack.pdf`. */
export async function exportTechPack(p: Project, units: Units, snapshot: string | null = null, opts: TechPackOptions = {}): Promise<void> {
  const doc = await buildTechPack(p, units, snapshot, opts);
  doc.save(`${p.name.replace(/[^a-z0-9]+/gi, '_')}_techpack.pdf`);
}
