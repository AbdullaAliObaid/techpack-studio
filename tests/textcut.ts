// Run: npx tsx tests/textcut.ts  (part of npm test). Letter outlines traced from a coverage mask: counters become holes,
// the traced area matches the ink, old projects with block-letter text still load. The real fonts are checked in the
// browser by tests/textcut.browser.mjs (npm run test:text).
import { cleanRings, groupShapes, ringArea, traceMask } from '../src/lib/textTrace';
import { attachmentPolygons, attachmentShapes, withTextRings } from '../src/lib/shapes';
import { offsetRing } from '../src/sim/detailsAttach';
import { meshPanel } from '../src/sim/panels';
import { freshProject, migrateProject } from '../src/store';
import type { Attachment } from '../src/data/edits';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

const W = 120, H = 100;
/** anti-aliased coverage of a union/difference of rectangles and ellipses (4x4 supersampling) */
function mask(inside: (x: number, y: number) => boolean) {
  const cov = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    let n = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
    cov[y * W + x] = n / 16;
  }
  return cov;
}
const rect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
const ell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const sum = (c: Float32Array) => c.reduce((s, v) => s + v, 0);
const trace = (cov: Float32Array) => groupShapes(cleanRings(traceMask(cov, W, H), 4, 0.4));
const shapeArea = (s: ReturnType<typeof groupShapes>) => s.reduce((t, sh) => t + ringArea(sh.outer) + sh.holes.reduce((u, h) => u + ringArea(h), 0), 0);

// a block B: stem plus two bowls, each with a counter
const B = mask((x, y) => (rect(x, y, 20, 15, 40, 85) || ell(x, y, 50, 33, 22, 18) || ell(x, y, 50, 66, 25, 19)) && !ell(x, y, 50, 33, 10, 8) && !ell(x, y, 50, 66, 12, 9));
const b = trace(B);
ok(b.length === 1, `B: one outer ring (${b.length})`);
ok(b[0]?.holes.length === 2, `B: two counters (${b[0]?.holes.length})`);
ok(Math.abs(shapeArea(b) / sum(B) - 1) < 0.02, `B: traced area ${shapeArea(b).toFixed(0)} vs ink ${sum(B).toFixed(0)}`);

const O = mask((x, y) => ell(x, y, 60, 50, 35, 40) && !ell(x, y, 60, 50, 18, 24));
const o = trace(O);
ok(o.length === 1 && o[0].holes.length === 1, `o: one outer, one hole (${o.length}, ${o[0]?.holes.length})`);
ok(ringArea(o[0].outer) > 0 && ringArea(o[0].holes[0]) < 0, 'outer rings positive, holes negative');
ok(Math.abs(shapeArea(o) / sum(O) - 1) < 0.02, 'o: traced area matches ink');

// separate letters and an island inside a counter
const two = mask((x, y) => rect(x, y, 10, 20, 30, 80) || (ell(x, y, 80, 50, 30, 35) && !ell(x, y, 80, 50, 20, 25)) || ell(x, y, 80, 50, 8, 8));
const t2 = trace(two);
ok(t2.length === 3, `stem, ring and island in the ring are three shapes (${t2.length})`);
ok(Math.abs(shapeArea(t2) / sum(two) - 1) < 0.03, 'multi letter area matches ink within 3%');

// stitching offset moves into the cloth on the outer ring and away from the counter on a hole
const sh = o[0];
const rOut = (r: { x: number; y: number }[]) => Math.hypot(r[0].x - 60, r[0].y - 50);
ok(rOut(offsetRing(sh.outer, 2)) < rOut(sh.outer), 'outer stitch line is inside the letter');
ok(rOut(offsetRing(sh.holes[0], 2)) > rOut(sh.holes[0]), 'counter stitch line is away from the counter');

// the cloth mesh leaves the counter open
const sq = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const pts = sq(-3, -3, 3, 3).map((q, i) => ({ id: `p${i}`, ...q, smooth: false, mirror: null }));
const m = meshPanel(pts as never, 0.4, [sq(-1, -1, 1, 1)]);
const inHole = m.tris.filter((_, i) => i % 3 === 0).filter((_, k) => { const a = m.uv[m.tris[k * 3]], c = m.uv[m.tris[k * 3 + 1]], d = m.uv[m.tris[k * 3 + 2]]; const cx = (a.x + c.x + d.x) / 3, cy = (a.y + c.y + d.y) / 3; return Math.abs(cx) < 0.9 && Math.abs(cy) < 0.9; });
ok(inHole.length === 0 && (m.holeLoops?.length ?? 0) === 1, 'mesh has no triangles inside the hole and keeps its loop');

// old projects: text appliques with no traced rings still load and still give letters (block letters without a canvas)
const old = { id: 'a1', kind: 'applique', name: 'Old', pieceId: 'front', x: 0, y: 0, rotation: 0, w: 12, h: 3, outline: 'shape', shape: 'text', text: 'BOB 88', layers: [] } as unknown as Attachment;
const p = freshProject('polo', 'P');
const mp = migrateProject({ ...p, edits: { ...p.edits!, attachments: [old] } });
ok(mp.edits!.attachments.length === 1 && attachmentPolygons(mp.edits!.attachments[0]).length > 0, 'old cut text loads and has letters');
ok(withTextRings(old) === old || !!withTextRings(old).outlineRings, 'withTextRings is safe without a canvas');
const unit = [{ x: -0.5, y: -0.5 }, { x: 0.5, y: -0.5 }, { x: 0.5, y: 0.5 }, { x: -0.5, y: 0.5 }];
const hole = [{ x: -0.2, y: -0.2 }, { x: -0.2, y: 0.2 }, { x: 0.2, y: 0.2 }, { x: 0.2, y: -0.2 }];
const st = { ...old, text: 'x', font: 'block', outlineRings: [unit, hole], outlineKey: 'block|x' } as Attachment;
const shapes = attachmentShapes(st);
ok(shapes.length === 1 && shapes[0].holes.length === 1 && Math.abs(shapes[0].outer[1].x - 6) < 1e-6, 'stored rings are scaled by w and h and used as they are');

if (fails) { console.error(`${fails} failed`); process.exit(1); }

// ---- clip to the outline ----
import { clipAttachmentLayers, artworkExtent, layerArea, layerRings, shownBox } from '../src/lib/clipLayers';
import { attachmentPatch, droppedLayers, newDesign, newLayer } from '../src/components/designDoc';
{
  // a 6 x 3 tag with a hexagon (4 cm) centred on its bottom left corner: only the quarter-ish inside stays
  const tag = { kind: 'label', outline: 'rect', w: 6, h: 3, layers: [] } as unknown as Attachment;
  const hex = { id: 'h', shape: 'hexagon', x: -3, y: 1.5, w: 4, h: 4, rotation: 0, color: '#f00' } as never;
  const far = { id: 'f', shape: 'rect', x: 9, y: 0, w: 2, h: 2, rotation: 0, color: '#0f0' } as never;
  const inner = { id: 'i', shape: 'rect', x: 0, y: 0, w: 1, h: 1, rotation: 0, color: '#00f' } as never;
  const pic = { id: 'p', shape: 'image', image: 'x', x: 3, y: 0, w: 4, h: 2, rotation: 0, color: '#000' } as never;
  const r = clipAttachmentLayers({ ...tag, layers: [hex, far, inner, pic] });
  const full = layerArea(hex);
  const h2 = r.layers.find((l) => l.id === 'h')!;
  ok(r.dropped === 1 && !r.layers.some((l) => l.id === 'f'), 'a layer wholly outside is dropped');
  ok(r.layers.find((l) => l.id === 'i') === inner, 'a layer inside is untouched');
  const kept = layerArea(h2);
  ok(kept > 0 && kept < full * 0.5, `hexagon half outside keeps only the inside part (${kept.toFixed(2)} of ${full.toFixed(2)} cm2)`);
  const bb = shownBox(h2);
  ok(bb.x0 >= -3.001 && bb.y1 <= 1.501 && bb.x1 <= 3 && bb.y0 >= -1.5, 'hexagon box lies inside the tag');
  ok(!!r.layers.find((l) => l.id === 'p')?.clip, 'a picture sticking out gets a clip path');
  ok(artworkExtent({ w: 6, h: 3, layers: r.layers }) <= 6.01, 'tech pack artwork stays inside the tag');
  ok(layerRings(h2)!.flat().every((q) => Math.abs(q.x) <= 3.001 && Math.abs(q.y) <= 1.501), 'every clipped vertex is inside the tag');
  // design doc: the doc keeps the original, the placed attachment is cut
  const d = { ...newDesign(), makeAs: 'patch' as const, layers: [newLayer('rect', { w: 6, h: 3 }), newLayer('hexagon', { x: -3, y: 1.5, w: 4, h: 4 }), newLayer('rect', { x: 20, y: 0, w: 1, h: 1 })] };
  const ap = attachmentPatch(d);
  ok(ap.layers.length === 1 && droppedLayers(d) === 1, 'design: base is the outline, hexagon cut, far layer dropped');
  ok(layerArea(ap.layers[0]) < layerArea(d.layers[1]) * 0.5, 'design: stored hexagon is the inside part only');
}
console.log(fails ? `${fails} failed` : 'all ok');
process.exit(fails ? 1 : 0);
