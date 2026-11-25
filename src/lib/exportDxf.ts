// DXF R12 pattern export in the layer convention used by cutting rooms (AAMA style):
//   layer 1  = cut line (sewing line + seam allowance)
//   layer 14 = sewing line (finished size)
//   layer 7  = grain line
//   layer 15 = annotation text
//   layer 8  = internal lines: attachment placement outlines and centre marks, pleat fold lines
//   layer 4  = notches (pleat intake marks, cut into the seam allowance)
// Units: millimetres. Each piece is placed where it sits in the editor; cloth attachments (pockets,
// patches, straps) are cut pieces of their own, laid out to the right of the pattern.

import type { Piece } from '../data/presets';
import type { Edits } from '../data/edits';
import { bbox, centroid, offsetInward, samplePoly, type Pt } from './geometry';
import { attachmentReport, placementMarks } from './specs';
import { outlinePolygon } from './shapes';

const MM = 10;

function header(lines: string[]) {
  lines.push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC');
  lines.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4');
  for (const [name, color] of [['1', 7], ['14', 3], ['7', 1], ['15', 5], ['8', 4], ['4', 2]] as [string, number][]) {
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

export function piecesToDxf(pieces: Piece[], meta: { project: string; size: string }, allowance = 1, edits?: Edits): string {
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
    for (const m of marks.outlines) {
      polyline(L, '8', m.pts.map(o), true);
      const c = o(m.centre);
      polyline(L, '8', [{ x: c.x - 0.5, y: c.y }, { x: c.x + 0.5, y: c.y }], false);
      polyline(L, '8', [{ x: c.x, y: c.y - 0.5 }, { x: c.x, y: c.y + 0.5 }], false);
      text(L, { x: c.x + 0.8, y: c.y - 0.8 }, 0.8, `${m.name.toUpperCase()} PLACEMENT`);
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
  const rows = attachmentReport(pieces, edits);
  for (const a of edits?.attachments ?? []) {
    if (a.kind === 'print') continue;
    const sew = outlinePolygon(a.outline, a.w, a.h, a.points).map((q) => ({ x: x + a.w / 2 + q.x, y: pb.minY + a.h / 2 + q.y }));
    cutPiece(sew, a.name, rows.find((r) => r.id === a.id)?.copies ?? 1);
    x += a.w + 12;
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\r\n');
}
