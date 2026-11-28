// Real size pattern to print at home or in a copy shop: every piece at 1:1 (cm on paper = cm of cloth), tiled over
// A4 or Letter pages with page numbers, join marks and a 5 cm test square on page 1 to check the printer scale.
import { jsPDF } from 'jspdf';
import type { Piece } from '../data/presets';
import { bbox, offsetInward, samplePoly, type Pt } from './geometry';

export type Paper = 'a4' | 'letter';
const PAPER: Record<Paper, { w: number; h: number }> = { a4: { w: 21, h: 29.7 }, letter: { w: 21.59, h: 27.94 } };
const MARGIN = 1; // cm unprinted border each side
const GAP = 3; // cm between pieces

interface Placed { piece: Piece; sew: Pt[]; cut: Pt[]; x: number; y: number; w: number; h: number }

/** pieces laid out in rows (shelf packing) in cm, cut line included, each cut-count copy drawn once with its count */
export function layoutPieces(pieces: Piece[], allowance = 1, rowWidth = 120): { placed: Placed[]; w: number; h: number } {
  const placed: Placed[] = [];
  let x = 0, y = 0, rowH = 0, W = 0;
  for (const piece of pieces) {
    const sew0 = samplePoly(piece.points, 24);
    const cut0 = offsetInward(sew0, -allowance);
    const b = bbox(cut0);
    const w = b.maxX - b.minX, h = b.maxY - b.minY;
    if (x > 0 && x + w > rowWidth) { x = 0; y += rowH + GAP; rowH = 0; }
    const dx = x - b.minX, dy = y - b.minY;
    const mv = (p: Pt) => ({ x: p.x + dx, y: p.y + dy });
    placed.push({ piece, sew: sew0.map(mv), cut: cut0.map(mv), x, y, w, h });
    x += w + GAP; rowH = Math.max(rowH, h); W = Math.max(W, x - GAP);
  }
  return { placed, w: W, h: y + rowH };
}

/** how many pages across and down a layout needs on this paper */
export function pageGrid(w: number, h: number, paper: Paper) {
  const P = PAPER[paper], cw = P.w - 2 * MARGIN, ch = P.h - 2 * MARGIN;
  return { cols: Math.max(1, Math.ceil(w / cw)), rows: Math.max(1, Math.ceil(h / ch)), cw, ch };
}

export function realSizePdf(pieces: Piece[], name: string, paper: Paper = 'a4', allowance = 1): jsPDF {
  const P = PAPER[paper];
  const { placed, w, h } = layoutPieces(pieces, allowance);
  const { cols, rows, cw, ch } = pageGrid(w, h, paper);
  const doc = new jsPDF({ unit: 'cm', format: paper === 'a4' ? 'a4' : 'letter', orientation: 'portrait' });
  let first = true;
  const hits = (pl: Placed, c: number, r: number) => !(pl.x + pl.w < c * cw || pl.x > (c + 1) * cw || pl.y + pl.h < r * ch || pl.y > (r + 1) * ch);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    // pages with nothing on them are left out (their label is skipped, the others keep theirs for taping)
    if (!placed.some((pl) => hits(pl, c, r))) continue;
    if (!first) doc.addPage();
    const ox = MARGIN - c * cw, oy = MARGIN - r * ch;
    const T = (p: Pt): [number, number] => [p.x + ox, p.y + oy];
    // clip drawing to the printable area so neighbouring pages butt together exactly
    doc.saveGraphicsState();
    doc.rect(MARGIN, MARGIN, cw, ch, null);
    doc.clip();
    doc.discardPath();
    for (const pl of placed) {
      if (!hits(pl, c, r)) continue;
      doc.setLineDashPattern([], 0); doc.setLineWidth(0.03); doc.setDrawColor(0);
      line(doc, pl.cut.map(T));
      doc.setLineDashPattern([0.3, 0.2], 0); doc.setLineWidth(0.02); doc.setDrawColor(90);
      line(doc, pl.sew.map(T));
      // grain line down the middle, with arrow heads
      const gx = pl.x + pl.w / 2, gy0 = pl.y + pl.h * 0.25, gy1 = pl.y + pl.h * 0.75;
      doc.setLineDashPattern([], 0); doc.setDrawColor(0);
      doc.line(...T({ x: gx, y: gy0 }), ...T({ x: gx, y: gy1 }));
      doc.line(...T({ x: gx, y: gy0 }), ...T({ x: gx - 0.4, y: gy0 + 0.8 })); doc.line(...T({ x: gx, y: gy0 }), ...T({ x: gx + 0.4, y: gy0 + 0.8 }));
      doc.line(...T({ x: gx, y: gy1 }), ...T({ x: gx - 0.4, y: gy1 - 0.8 })); doc.line(...T({ x: gx, y: gy1 }), ...T({ x: gx + 0.4, y: gy1 - 0.8 }));
      doc.setFontSize(14); doc.setTextColor(0);
      doc.text(`${pl.piece.name}  ·  cut ${pl.piece.cut}`, ...T({ x: gx + 0.6, y: pl.y + pl.h / 2 }));
      doc.setFontSize(9);
      doc.text(`${pl.piece.fabric?.id ?? ''} · grain`, ...T({ x: gx + 0.6, y: pl.y + pl.h / 2 + 0.6 }));
    }
    doc.restoreGraphicsState();
    // page frame corners and labels so pages are taped in order
    doc.setLineDashPattern([], 0); doc.setLineWidth(0.01); doc.setDrawColor(150);
    for (const [x, y] of [[MARGIN, MARGIN], [MARGIN + cw, MARGIN], [MARGIN, MARGIN + ch], [MARGIN + cw, MARGIN + ch]]) {
      doc.line(x - 0.4, y, x + 0.4, y); doc.line(x, y - 0.4, x, y + 0.4);
    }
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`${name}  ·  page ${String.fromCharCode(65 + r)}${c + 1} (row ${String.fromCharCode(65 + r)}, column ${c + 1}; ${rows} rows x ${cols} columns, empty pages left out)  ·  print at 100%, no scaling`, MARGIN, P.h - 0.4);
    doc.text(`${String.fromCharCode(65 + r)}${c + 1}`, P.w / 2, 0.6, { align: 'center' });
    if (first) {
      // 5 cm test square: measure it after printing
      doc.setDrawColor(0); doc.setLineWidth(0.02); doc.setFillColor(255, 255, 255);
      const sx = P.w - MARGIN - 5.6, sy = P.h - MARGIN - 6.2;
      doc.rect(sx, sy, 5, 5, 'FD');
      doc.setFontSize(9); doc.setTextColor(0);
      doc.text('5 cm test square', sx + 2.5, sy + 2.4, { align: 'center' });
      doc.text('measure before cutting', sx + 2.5, sy + 2.9, { align: 'center' });
      first = false;
    }
  }
  return doc;
}

function line(doc: jsPDF, pts: [number, number][]) {
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; doc.line(a[0], a[1], b[0], b[1]); }
}
