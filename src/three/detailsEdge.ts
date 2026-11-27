import type { EdgeTrim } from '../data/edits';
import type { Piece } from '../data/presets';
import { edgePolyline, insetPolyline } from '../data/edgeTrim';
import type { Pt } from '../lib/geometry';

// Contrast edges painted into a piece's canvases (pattern space, centimetres): binding tape into the ink pass, topstitch
// and piping cord into the thread pass (colour plus height map, so stitches and the cord catch the light).

const trace = (ctx: CanvasRenderingContext2D, line: Pt[]) => { ctx.beginPath(); line.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); };

/** binding: tape over the edge, with a stitch line near each tape edge */
export function drawBinding(ctx: CanvasRenderingContext2D, piece: Piece, trims: EdgeTrim[]) {
  for (const t of trims) {
    const line = edgePolyline(piece, t.edge, 20);
    if (line.length < 2) continue;
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
    // the tape wraps the edge: it covers from the edge in by its width, a little darker at the fold
    trace(ctx, insetPolyline(piece, line, t.width / 2)); ctx.strokeStyle = t.colour; ctx.lineWidth = t.width; ctx.stroke();
    trace(ctx, line); ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = Math.min(0.12, t.width / 5); ctx.stroke();
    ctx.restore();
  }
}

/** topstitch dashes and piping cord */
export function drawEdgeThread(cc: CanvasRenderingContext2D, hc: CanvasRenderingContext2D, piece: Piece, trims: EdgeTrim[]) {
  for (const t of trims) {
    const line = edgePolyline(piece, t.edge, 20);
    if (line.length < 2) continue;
    for (const [c, h] of [[cc, false], [hc, true]] as const) {
      c.save();
      c.lineJoin = 'round';
      if (t.method === 'thread') {
        // stitch length about 3 mm, gap 1.5 mm; the line is as thick as the thread
        const w = Math.max(0.07, (t.tex ?? 45) / 520);
        c.lineCap = 'round'; c.lineWidth = w; c.setLineDash([0.3, 0.16]);
        trace(c, insetPolyline(piece, line, 0.3)); c.strokeStyle = h ? '#ffffff' : t.colour; c.stroke();
      } else if (t.method === 'binding') {
        // topstitch holding the tape: two fine lines near the tape's inner edge (in the ink pass the tape itself)
        c.lineCap = 'round'; c.lineWidth = 0.06; c.setLineDash([0.28, 0.14]);
        trace(c, insetPolyline(piece, line, t.width * 0.85)); c.strokeStyle = h ? '#ffffff' : t.colour; c.stroke();
      } else {
        // piping: a round cord on the edge, lit across its width
        c.lineCap = 'round';
        const steps = h ? [[1, '#707070'], [0.66, '#c0c0c0'], [0.33, '#ffffff']] as const : [[1, t.colour]] as const;
        for (const [f, col] of steps) { trace(c, line); c.strokeStyle = col; c.lineWidth = t.width * f; c.stroke(); }
      }
      c.restore();
    }
  }
}
