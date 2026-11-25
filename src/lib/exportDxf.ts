// DXF R12 pattern export in the layer convention used by cutting rooms (AAMA style):
//   layer 1  = cut line (sewing line + seam allowance)
//   layer 14 = sewing line (finished size)
//   layer 7  = grain line
//   layer 15 = annotation text
// Units: millimetres. Each piece is placed where it sits in the editor.

import type { Piece } from '../data/presets';
import { bbox, centroid, offsetInward, samplePoly, type Pt } from './geometry';

const MM = 10;

function header(lines: string[]) {
  lines.push('0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC');
  lines.push('0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '4');
  for (const [name, color] of [['1', 7], ['14', 3], ['7', 1], ['15', 5]] as [string, number][]) {
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

export function piecesToDxf(pieces: Piece[], meta: { project: string; size: string }, allowance = 1): string {
  const L: string[] = [];
  header(L);
  L.push('0', 'SECTION', '2', 'ENTITIES');
  for (const p of pieces) {
    const sew = samplePoly(p.points, 24).map((q) => ({ x: q.x + p.offset.x, y: q.y + p.offset.y }));
    const cut = offsetInward(sew, -allowance);
    polyline(L, '1', cut, true);
    polyline(L, '14', sew, true);
    const bb = bbox(sew), c = centroid(sew);
    const half = bb.h * 0.3;
    polyline(L, '7', [{ x: c.x, y: c.y - half }, { x: c.x, y: c.y + half }], false);
    text(L, { x: c.x + 1.5, y: c.y - 2 }, 1.6, p.name.toUpperCase());
    text(L, { x: c.x + 1.5, y: c.y + 0.5 }, 1.1, `CUT ${p.cut}`);
    text(L, { x: c.x + 1.5, y: c.y + 2.5 }, 1.0, `${meta.project} / ${meta.size}`);
  }
  L.push('0', 'ENDSEC', '0', 'EOF');
  return L.join('\r\n');
}
