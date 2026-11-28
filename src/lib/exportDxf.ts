// DXF R12 pattern export in the layer convention used by cutting rooms (AAMA style):
//   layer 1  = cut line (sewing line + seam allowance)
//   layer 14 = sewing line (finished size)
//   layer 7  = grain line
//   layer 15 = annotation text
//   layer 8  = internal lines: attachment placement outlines and centre marks, pleat fold lines
//   layer 4  = notches (pleat intake marks, cut into the seam allowance)
//   layer 13 = drill holes / trim placement: a small circle with a cross per rivet, button, stud, snap or eyelet
//   (a zip is a line on layer 8 with its length)
// Units: millimetres. Each piece is placed where it sits in the editor; cloth attachments (pockets,
// patches, straps, appliques: one piece per letter for text) are cut pieces of their own, laid out to the
// right of the pattern. Placement on a left or right copy is written next to the mark.
// Clothing tags (labels) are cut pieces too (a folded loop cut twice as long), except leather and rubber tags, which
// are bought finished: those get only their placement mark, written as a bought trim.

import type { Piece } from '../data/presets';
import type { Edits } from '../data/edits';
import type { StyleId } from '../data/catalog';
import { bbox, centroid, offsetInward, samplePoly, type Pt } from './geometry';
import { attachmentReport, hardwareMarks, labelReport, placementMarks } from './specs';
import { attachmentShapes } from './shapes';

const MM = 10;

function header(lines: string[]) {
  lines.push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC');
  lines.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4');
  for (const [name, color] of [['1', 7], ['14', 3], ['7', 1], ['15', 5], ['8', 4], ['4', 2], ['13', 6]] as [string, number][]) {
    lines.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
  }
  lines.push('0', 'ENDTAB', '0', 'ENDSEC');
}

function polyline(lines: string[], layer: string, pts: Pt[], closed: boolean) {
  lines.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0');
  for (const p of pts) lines.push('0', 'VERTEX', '8', layer, '10', (p.x * MM).toFixed(2), '20', (-p.y * MM).toFixed(2), '30', '0');
  lines.push('0', 'SEQEND', '8', layer);
}

function text(lines: string[], at: Pt, h: number, s: string) {
  lines.push('0', 'TEXT', '8', '15', '10', (at.x * MM).toFixed(2), '20', (-at.y * MM).toFixed(2), '30', '0', '40', (h * MM).toFixed(1), '1', s);
}

export function piecesToDxf(pieces: Piece[], meta: { project: string; size: string }, allowance = 1, edits?: Edits, style?: StyleId): string {
  const L: string[] = [];
  header(L);
  L.push('0', 'SECTION', '2', 'ENTITIES');
  const cutPiece = (sew: Pt[], name: string, cut: number) => {
    polyline(L, '1', offsetInward(sew, -allowance), true);
    polyline(L, '14', sew, true);
    const bb = bbox(sew), c = centroid(sew);
    const half = bb.h * 0.3;
    polyline(L, '7', [{ x: c.x, y: c.y - half }, { x: c.x, y: c.y + half }], false);
    text(L, { x: c.x + 1.5, y: c.y - 2 }, 1.6, name.toUpperCase());
    text(L, { x: c.x + 1.5, y: c.y + 0.5 }, 1.1, `CUT ${cut}`);
    text(L, { x: c.x + 1.5, y: c.y + 2.5 }, 1.0, `${meta.project} / ${meta.size}`);
  };
  for (const p of pieces) {
    // placement marks for attachments and pleats on this piece
    const o = (q: Pt) => ({ x: q.x + p.offset.x, y: q.y + p.offset.y });
    const marks = placementMarks(p, pieces, edits);
    const rows = attachmentReport(pieces, edits, style);
    const tagRows = labelReport(pieces, edits, style);
    for (const m of marks.outlines) {
      polyline(L, '8', m.pts.map(o), true);
      if (!m.name) continue; // further letters of a text applique: outline only
      const c = o(m.centre);
      polyline(L, '8', [{ x: c.x - 0.5, y: c.y }, { x: c.x + 0.5, y: c.y }], false);
      polyline(L, '8', [{ x: c.x, y: c.y - 0.5 }, { x: c.x, y: c.y + 0.5 }], false);
      const side = rows.find((r) => r.name === m.name && r.host === p.name)?.side;
      const tag = m.kind === 'label' ? tagRows.find((t) => t.name === m.name) : undefined;
      text(L, { x: c.x + 0.8, y: c.y - 0.8 }, 0.8, `${m.name.toUpperCase()} PLACEMENT${side && side !== p.name ? ` (${side.toUpperCase()})` : ''}${tag ? ` ${tag.placement.split(', ').pop()!.toUpperCase()}${tag.purchased ? ', BOUGHT TRIM' : ''}` : ''}`);
    }
    // hardware: drill / placement marks, and zip lines
    for (const h of hardwareMarks(p, edits)) {
      if (h.line) {
        polyline(L, '8', h.line.map(o), false);
        const a = o(h.line[0]);
        text(L, { x: a.x + 0.6, y: a.y }, 0.8, `${h.name.toUpperCase()} ZIP ${(Math.hypot(h.line[1].x - h.line[0].x, h.line[1].y - h.line[0].y)).toFixed(1)} CM`);
        continue;
      }
      for (const { at, r } of h.points) {
        const c = o(at);
        polyline(L, '13', Array.from({ length: 16 }, (_, k) => ({ x: c.x + r * Math.cos((k / 16) * 2 * Math.PI), y: c.y + r * Math.sin((k / 16) * 2 * Math.PI) })), true);
        polyline(L, '13', [{ x: c.x - r * 1.4, y: c.y }, { x: c.x + r * 1.4, y: c.y }], false);
        polyline(L, '13', [{ x: c.x, y: c.y - r * 1.4 }, { x: c.x, y: c.y + r * 1.4 }], false);
      }
      const c = o(h.points[0].at);
      text(L, { x: c.x + 0.8, y: c.y + 1.2 }, 0.7, `${h.name.toUpperCase()} ${h.type.toUpperCase()} x${h.points.length}`);
    }
    for (const { pleat, marks: pm } of marks.pleats) {
      for (const [a, b] of pm.folds) polyline(L, '8', [o(a), o(b)], false);
      for (const q of pm.notches) polyline(L, '4', [o(q), o({ x: q.x - pm.n.x * allowance, y: q.y - pm.n.y * allowance })], false);
      text(L, o({ x: pm.a.x + pm.n.x * (pleat.length + 1), y: pm.a.y + pm.n.y * (pleat.length + 1) }), 0.8, `${pleat.type.toUpperCase()} PLEAT ${pleat.depth} CM`);
    }
    cutPiece(samplePoly(p.points, 24).map(o), p.name, p.cut);
  }
  // cloth attachments are cut pieces of their own, in a row to the right of the pattern
  const all = pieces.flatMap((p) => p.points.map((q) => ({ x: q.x + p.offset.x, y: q.y + p.offset.y })));
  const pb = all.length ? bbox(all) : { minX: 0, minY: 0, maxX: 0, w: 0, h: 0 };
  let x = pb.minX + pb.w + 20;
  const rows = attachmentReport(pieces, edits, style);
  for (const t of labelReport(pieces, edits, style)) {
    if (t.purchased) continue;
    const sew = [{ x: x, y: pb.minY }, { x: x + t.cutW, y: pb.minY }, { x: x + t.cutW, y: pb.minY + t.cutH }, { x: x, y: pb.minY + t.cutH }];
    cutPiece(sew, `${t.name} label`, t.qty);
    x += t.cutW + 12;
  }
  for (const a of edits?.attachments ?? []) {
    if (a.kind !== 'pocket' && a.kind !== 'patch' && a.kind !== 'applique' && a.kind !== 'strap') continue;
    const row = rows.find((r) => r.id === a.id);
    const shapes = attachmentShapes(a), rings = shapes.map((sh) => sh.outer);
    rings.forEach((ring, i) => {
      // letters of a text applique are cut one by one, side by side
      const bb = bbox(ring);
      const sew = ring.map((q) => ({ x: x - bb.minX + q.x, y: pb.minY - bb.minY + q.y }));
      cutPiece(sew, rings.length > 1 ? `${a.name} ${i + 1}` : a.name, row?.copies ?? 1);
      // counters of letters (the hole in B, o, a ...) are cut out too
      for (const h of shapes[i].holes) polyline(L, '14', h.map((q) => ({ x: x - bb.minX + q.x, y: pb.minY - bb.minY + q.y })), true);
      x += bb.w + (rings.length > 1 ? 6 : 12);
    });
    if (rings.length > 1) x += 6;
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\r\n');
}

/** Download the DXF pattern for a manufacturer (full size, millimetres). */
export function exportDxfPattern(project: { name: string; pieces: Piece[]; edits?: Edits; garment: StyleId; body: { height: number; chest: number; waist: number; hips: number } }) {
  const b = project.body;
  const dxf = piecesToDxf(project.pieces, { project: project.name, size: `H${Math.round(b.height)} C${Math.round(b.chest)} W${Math.round(b.waist)} H${Math.round(b.hips)}` }, undefined, project.edits, project.garment);
  const url = URL.createObjectURL(new Blob([dxf], { type: 'application/dxf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9]+/gi, '_')}_pattern.dxf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
