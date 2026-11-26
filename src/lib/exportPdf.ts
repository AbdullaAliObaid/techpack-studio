// Tech pack PDF: cover with the 3D render, flat pattern sheet, spec sheet (points of measure, fit, seams),
// and construction / bill of materials. Built entirely in the browser with jsPDF.

import { jsPDF } from 'jspdf';
import type { Project } from '../store';
import { GARMENT_LABEL } from '../data/presets';
import { styleById, type StyleId } from '../data/catalog';
import { fabricById } from '../data/fabrics';
import { BODY_FIELDS, limbGirths } from '../three/body';
import { bbox, centroid, offsetInward, samplePoly } from './geometry';
import { attachmentReport, cutList, fitTable, garmentSpecs, hardwareMarks, labelReport, pieceSpecs, placementMarks, pleatReport, seamReport, trimsReport } from './specs';
import { toUnit, type Units } from './units';

const W = 297, H = 210, M = 12;
const INK = '#1c2330', MUTED = '#6b7484', ACCENT = '#2563eb', LINE = '#d7dbe2';

function frame(doc: jsPDF, p: Project, page: number, title: string) {
  doc.setFillColor('#f6f7f9');
  doc.rect(0, 0, W, 16, 'F');
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(11).text('tech-it', M, 10.5);
  doc.setFont('helvetica', 'normal').setTextColor(MUTED).setFontSize(9).text(`${p.name}  ·  ${GARMENT_LABEL[p.garment]}  ·  ${title}`, M + 18, 10.5);
  doc.text(`Page ${page}`, W - M, 10.5, { align: 'right' });
  doc.setDrawColor(LINE).line(0, 16, W, 16);
  doc.setFontSize(7.5).text(`Generated ${new Date().toLocaleString()}. All measurements are finished garment sizes unless noted. Seam allowance 1 cm.`, M, H - 6);
}

function table(doc: jsPDF, x: number, y: number, cols: { title: string; w: number; align?: 'left' | 'right' }[], rows: string[][], title?: string) {
  if (title) { doc.setFont('helvetica', 'bold').setFontSize(10).setTextColor(INK).text(title, x, y); y += 5; }
  doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(MUTED);
  let cx = x;
  for (const c of cols) { doc.text(c.title.toUpperCase(), c.align === 'right' ? cx + c.w - 1 : cx, y, { align: c.align ?? 'left' }); cx += c.w; }
  y += 1.8;
  doc.setDrawColor(LINE).line(x, y, cx, y);
  y += 4;
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(INK);
  for (const r of rows) {
    cx = x;
    r.forEach((v, i) => { const c = cols[i]; doc.text(v, c.align === 'right' ? cx + c.w - 1 : cx, y, { align: c.align ?? 'left' }); cx += c.w; });
    y += 4.6;
  }
  return y + 3;
}

export function exportTechPack(p: Project, units: Units, snapshot: string | null) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const u = (cm: number) => `${toUnit(cm, units).toFixed(units === 'cm' ? 1 : 2)}`;
  const U = units === 'cm' ? 'cm' : 'in';
  const fit = p.fit ?? 'regular';

  // ---- 1. cover ----
  frame(doc, p, 1, 'Overview');
  doc.setTextColor(INK).setFont('helvetica', 'bold').setFontSize(24).text(p.name, M, 34);
  doc.setFont('helvetica', 'normal').setFontSize(12).setTextColor(MUTED).text(`${GARMENT_LABEL[p.garment]}  ·  ${fit[0].toUpperCase() + fit.slice(1)} fit`, M, 42);
  if (snapshot) {
    try { doc.addImage(snapshot, 'PNG', W - M - 110, 22, 110, 170, undefined, 'FAST'); } catch { /* no image */ }
  }
  const lg = limbGirths(p.body) as Record<string, number>;
  const bodyRows = BODY_FIELDS.map((f) => {
    const v = (p.body[f.key] as number | undefined) ?? lg[f.key];
    return [f.label + (p.body[f.key] === undefined ? ' (est.)' : ''), u(v)];
  });
  let y = table(doc, M, 56, [{ title: 'Body / fit model', w: 55 }, { title: U, w: 25, align: 'right' }], bodyRows, 'Fit model measurements');
  // shell fabrics, plus any fabric used on an inside face (under collar, placket facing)
  const fabrics = [...new Map([...p.pieces.map((pc) => pc.fabric), ...Object.values(p.edits?.insideFabric ?? {})].map((fb) => [fb.id + fb.color, fb])).values()];
  table(doc, M + 90, 56, [{ title: 'Fabric', w: 40 }, { title: 'Colour', w: 30 }, { title: 'gsm', w: 15, align: 'right' }], fabrics.map((fb) => {
    const f = fabricById(fb.id);
    return [f.name, f.colors[fb.color]?.name ?? '', String(f.gsm)];
  }), 'Materials');
  void y;

  // ---- 2. pattern sheet ----
  doc.addPage();
  frame(doc, p, 2, 'Pattern pieces');
  const all = p.pieces.flatMap((pc) => samplePoly(pc.points, 16).map((q) => ({ x: q.x + pc.offset.x, y: q.y + pc.offset.y })));
  const bb = bbox(all);
  const s = Math.min((W - 2 * M - 20) / bb.w, (H - 40 - 10) / bb.h);
  const ox = M + 10 - bb.minX * s + ((W - 2 * M - 20) - bb.w * s) / 2, oy = 26 - bb.minY * s;
  for (const pc of p.pieces) {
    const sew = samplePoly(pc.points, 20).map((q) => ({ x: (q.x + pc.offset.x) * s + ox, y: (q.y + pc.offset.y) * s + oy }));
    const cut = offsetInward(sew, -1 * s);
    const path = (pts: { x: number; y: number }[], style: string) => {
      const d = pts.slice(1).map((q, i) => [q.x - pts[i].x, q.y - pts[i].y]);
      doc.lines(d, pts[0].x, pts[0].y, [1, 1], style, true);
    };
    doc.setDrawColor('#94a3b8').setLineWidth(0.2);
    path(cut, 'S');
    doc.setDrawColor(INK).setLineWidth(0.35).setLineDashPattern([1.2, 0.8], 0);
    path(sew, 'S');
    doc.setLineDashPattern([], 0);
    const c = centroid(sew), pb = bbox(sew);
    doc.setDrawColor(INK).setLineWidth(0.25).line(c.x, c.y - pb.h * 0.25, c.x, c.y + pb.h * 0.25);
    doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(INK).text(pc.name, c.x + 1.5, c.y - 1);
    doc.setFont('helvetica', 'normal').setFontSize(6.5).setTextColor(MUTED).text(`Cut ${pc.cut}  ·  ${fabricById(pc.fabric.id).name}`, c.x + 1.5, c.y + 2.5);
    // placement marks: attachment outlines with a centre cross, pleat fold lines and notches
    const P = (q: { x: number; y: number }) => ({ x: (q.x + pc.offset.x) * s + ox, y: (q.y + pc.offset.y) * s + oy });
    const marks = placementMarks(pc, p.pieces, p.edits);
    doc.setDrawColor(ACCENT).setLineWidth(0.2).setLineDashPattern([0.8, 0.6], 0);
    for (const m of marks.outlines) path(m.pts.map(P), 'S');
    doc.setLineDashPattern([], 0);
    for (const h of hardwareMarks(pc, p.edits)) {
      if (h.line) { const A = P(h.line[0]), B = P(h.line[1]); doc.setLineWidth(0.4).line(A.x, A.y, B.x, B.y).setLineWidth(0.2); continue; }
      for (const { at, r } of h.points) { const c = P(at); doc.circle(c.x, c.y, Math.max(0.4, r * s), 'S'); }
    }
    for (const m of marks.outlines) {
      if (!m.name) continue;
      const c = P(m.centre);
      doc.line(c.x - 1, c.y, c.x + 1, c.y).line(c.x, c.y - 1, c.x, c.y + 1);
      doc.setFont('helvetica', 'normal').setFontSize(5.5).setTextColor(ACCENT).text(m.name, c.x + 1.2, c.y - 1.2);
    }
    for (const { marks: pm } of marks.pleats) {
      doc.setDrawColor(INK).setLineWidth(0.2).setLineDashPattern([0.4, 0.4], 0);
      for (const [a, b] of pm.folds) { const A = P(a), B = P(b); doc.line(A.x, A.y, B.x, B.y); }
      doc.setLineDashPattern([], 0).setLineWidth(0.3);
      for (const q of pm.notches) { const A = P(q), B = P({ x: q.x - pm.n.x, y: q.y - pm.n.y }); doc.line(A.x, A.y, B.x, B.y); }
    }
    // key measurements on the piece
    doc.setTextColor(ACCENT).setFontSize(6);
    for (const m of pieceSpecs(pc, p.edits).filter((q) => !q.vertical)) {
      const a = { x: (m.a.x + pc.offset.x) * s + ox, y: (m.a.y + pc.offset.y) * s + oy }, b = { x: (m.b.x + pc.offset.x) * s + ox, y: (m.b.y + pc.offset.y) * s + oy };
      doc.setDrawColor(ACCENT).setLineWidth(0.15).line(a.x, a.y, b.x, b.y);
      doc.text(`${m.label} ${u(m.value)}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 0.8, { align: 'center' });
    }
  }
  doc.setTextColor(MUTED).setFontSize(7.5).text(`Scale 1:${Math.round(1 / (s / 10))}. Dashed = sewing line (finished size), solid = cut line, blue dashed = placement, dotted = pleat fold. Use the DXF export for full-size cutting.`, M, H - 11);

  // ---- 3. spec sheet ----
  doc.addPage();
  frame(doc, p, 3, 'Specification');
  const gs = garmentSpecs(p.garment, p.pieces);
  y = table(doc, M, 26, [{ title: 'Point of measure', w: 52 }, { title: U, w: 22, align: 'right' }, { title: 'Tol ±', w: 16, align: 'right' }], gs.map((r) => [r.label, u(r.value), r.value > 60 ? u(1) : u(0.5)]), 'Points of measure');
  table(doc, M + 100, 26, [{ title: 'Fit check', w: 30 }, { title: 'Body', w: 18, align: 'right' }, { title: 'Garment', w: 20, align: 'right' }, { title: 'Ease', w: 18, align: 'right' }],
    fitTable(p.garment, p.pieces, p.body).map((r) => [r.label, r.body === null ? '' : u(r.body) + (r.estimated ? '*' : ''), u(r.garment), r.body === null ? '' : (r.garment - r.body > 0 ? '+' : '') + u(r.garment - r.body)]), 'Body vs garment');
  table(doc, M + 200, 26, [{ title: 'Seam', w: 40 }, { title: 'Edges', w: 26, align: 'right' }, { title: '', w: 10, align: 'right' }],
    seamReport(p.garment, p.pieces, p.edits).map((r) => [r.label.replace(' (front / back)', ''), `${u(r.a)}/${u(r.b)}`, r.ease !== undefined ? `${r.a - r.b >= 0 ? '+' : ''}${u(r.a - r.b)}` : Math.abs(r.a - r.b) < 0.1 ? 'OK' : 'CHECK']), 'Seam check');

  // ---- 4. construction + BOM ----
  doc.addPage();
  frame(doc, p, 4, 'Construction & materials');
  const area = p.pieces.reduce((sum, pc) => {
    const poly = offsetInward(samplePoly(pc.points, 12), -1);
    let a = 0;
    for (let i = 0; i < poly.length; i++) { const q = poly[i], r = poly[(i + 1) % poly.length]; a += q.x * r.y - r.x * q.y; }
    return sum + (Math.abs(a) / 2) * pc.cut;
  }, 0);
  const metres = (area / 150 / 100) * 1.25; // 150 cm wide roll, 25% marker waste
  y = table(doc, M, 26, [{ title: 'Item', w: 60 }, { title: 'Detail', w: 70 }, { title: 'Qty', w: 30, align: 'right' }], [
    ...fabrics.map((fb) => { const f = fabricById(fb.id); return [`Shell fabric: ${f.name}`, `${f.colors[fb.color]?.name ?? ''}, ${f.gsm} gsm, 150 cm wide`, `${metres.toFixed(2)} m`]; }),
    ['Thread', 'Polyester core-spun, colour matched', '1 cone'],
    ...trims(p.garment),
    // trims the user added: hardware, embroidery, appliques, with where they go
    ...trimsReport(p.pieces, p.edits, p.garment).map((t) => [t.item, `${t.detail}; ${t.placement}`, String(t.qty)]),
    ['Care label', 'Woven', '1'],
  ], 'Bill of materials');
  table(doc, M, y + 4, [{ title: 'Seam', w: 60 }, { title: 'Stitch', w: 70 }, { title: 'Allowance', w: 30, align: 'right' }],
    seamReport(p.garment, p.pieces, p.edits).map((r) => [r.label.replace(' (front / back)', ''), r.attachment ? 'Lockstitch 301, edge stitched' : r.ease !== undefined ? 'Lockstitch 301, ease distributed' : 'Lockstitch 301 + overlock 504', r.attachment ? '' : u(1) + ' ' + U]), 'Construction');

  // ---- 5. cut list, attachments and pleats ----
  const atts = attachmentReport(p.pieces, p.edits, p.garment), pls = pleatReport(p.pieces, p.edits, p.garment), tags = labelReport(p.pieces, p.edits, p.garment);
  doc.addPage();
  frame(doc, p, 5, 'Cut list, attachments & pleats');
  let ya = table(doc, M, 26, [{ title: 'Piece', w: 50 }, { title: 'Fabric', w: 40 }, { title: 'Cut', w: 14, align: 'right' }, { title: 'Note', w: 90 }],
    cutList(p.pieces, p.edits, p.garment).map((r) => [r.name, r.fabric, String(r.cut), r.note ?? '']), 'Cut list');
  if (atts.length) {
    ya = table(doc, M, ya + 4, [{ title: 'Name', w: 36 }, { title: 'Kind', w: 18 }, { title: 'Placement', w: 38 }, { title: `Size ${U}`, w: 24, align: 'right' }, { title: `Centre x / y ${U}`, w: 28, align: 'right' }, { title: 'Rotation', w: 16, align: 'right' }, { title: 'Sewn', w: 38 }, { title: 'Artwork layers', w: 24, align: 'right' }, { title: 'Qty', w: 12, align: 'right' }],
      atts.map((r) => [r.name, r.kind, r.side + (r.face ? ', inside' : ''), `${u(r.w)} x ${u(r.h)}`, `${u(r.x)} / ${u(r.y)}`, `${Math.round(r.rotation)}°`, r.stitched, String(r.layers), String(r.copies)]), 'Attachments');
  }
  if (tags.length) {
    // clothing tags: material, finished and cut size, how they are sewn on and where
    ya = table(doc, M, ya + 4, [{ title: 'Label', w: 30 }, { title: 'Material', w: 34 }, { title: `Size ${U}`, w: 22, align: 'right' }, { title: `Cut ${U}`, w: 22, align: 'right' }, { title: 'Sewn', w: 62 }, { title: 'Placement', w: 50 }, { title: 'Colour / finish', w: 34 }, { title: 'Qty', w: 12, align: 'right' }],
      tags.map((t) => [t.name, t.material, `${u(t.w)} x ${u(t.h)}`, t.purchased ? 'bought' : `${u(t.cutW)} x ${u(t.cutH)}`, t.sewn, t.placement, `${t.color}, ${t.sheen}`, String(t.qty)]), 'Labels');
  }
  if (pls.length) {
    table(doc, M, ya + 4, [{ title: 'Piece', w: 40 }, { title: 'Side', w: 34 }, { title: 'Type', w: 22 }, { title: `Depth ${U}`, w: 22, align: 'right' }, { title: `Intake ${U}`, w: 22, align: 'right' }, { title: `Stitched ${U}`, w: 24, align: 'right' }, { title: 'Position', w: 50 }],
      pls.map((r) => [r.piece, r.side, r.type, u(r.depth), u(r.intake), u(r.length), r.at]), 'Pleats');
  }

  doc.save(`${p.name.replace(/[^a-z0-9]+/gi, '_')}_techpack.pdf`);
}

/** Trims for the bill of materials, by style. */
function trims(id: StyleId): string[][] {
  const s = styleById(id);
  const out: string[][] = [];
  if (s.family === 'pants') {
    if (s.details.drawcord) out.push(['Elastic', '4 cm wide, knitted', '1'], ['Drawcord', 'Flat cotton, 140 cm', '1']);
    else out.push(['Shank button', '17 mm', '1'], ['Zip', 'Metal, 15 cm fly', '1']);
    if (s.details.rivets) out.push(['Rivets', 'Copper, 9 mm', '6']);
  } else if (s.family === 'cap') {
    out.push(['Top button', 'Fabric covered, 18 mm', '1'], ['Visor insert', 'Plastic, pre-curved', '1'], ['Sweatband', 'Cotton tape, 3 cm', '1']);
  } else if (s.family === 'bucket') {
    out.push(['Sweatband', 'Cotton tape, 3 cm', '1']);
  } else if (s.family === 'jacket') {
    out.push(['Buttons', '20 mm, 4 hole', String(s.details.buttons ?? 5)]);
  } else if (s.details.buttons) {
    out.push(['Buttons', s.family === 'polo' ? '15 mm, 4 hole' : '11 mm, 4 hole', String(s.details.buttons)]);
  }
  return out;
}
