// Run: npx tsx tests/edges.ts (part of npm test). Edge paint on both faces, edge trims (thread, binding, piping) and their tech pack rows.
import { freshProject } from '../src/store';
import { presetBlocks } from '../src/data/colourBlock';
import { presetEdgeTrims, edgeTrimRows, edgeLength, edgePolyline, segmentEdgeTrim, showsOn } from '../src/data/edgeTrim';
import type { Edits } from '../src/data/edits';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

const p = freshProject('basic-tee');
const look = { colour: '#111111', sheen: 'matte' as const, look: 'dyed' as const };
const both = presetBlocks(p.garment, p.pieces, 'hem', 6, look, { total: false, symmetry: false });
ok(both.some((a) => a.face === 'inside') && both.some((a) => !a.face), 'edge paint goes on both faces by default');
const one = presetBlocks(p.garment, p.pieces, 'hem', 6, look, { total: false, symmetry: false, bothFaces: false });
ok(one.length * 2 === both.length && one.every((a) => !a.face), 'both faces off paints the outside only');

const base = { colour: '#c0392b', width: 0.8, tex: 45, bothFaces: true };
const hem = presetEdgeTrims(p.pieces, 'hem', { ...base, method: 'thread' }, true);
ok(hem.length >= 2, `hem edge trims on front and back (${hem.length})`);
const front = p.pieces.find((q) => q.role === 'front')!;
const len = edgeLength(front, hem[0].edge);
const bbw = Math.max(...front.points.map((q) => q.x)) - Math.min(...front.points.map((q) => q.x));
ok(len > 20 && len < bbw * 1.3, `hem edge length is about the hem width (${len.toFixed(1)} cm)`);
ok(edgePolyline(front, hem[0].edge).length > 10, 'edge has a polyline for drawing');

const mkEdits = (method: 'thread' | 'binding' | 'piping'): Edits => ({
  attachments: [], customSeams: [], detachedSeams: [], pleats: [],
  edgeTrims: presetEdgeTrims(p.pieces, 'hem', { ...base, method }, false).map((t, i) => ({ ...t, id: 't' + i })),
});
for (const m of ['thread', 'binding', 'piping'] as const) {
  const e = mkEdits(m);
  const rows = edgeTrimRows(p.garment, p.pieces, e);
  ok(rows.length === 1 && /C0392B/.test(rows[0].detail), `${m}: one tech pack row with the colour`);
  ok(m !== 'thread' || /Tex 45/.test(rows[0].detail) && /m of thread/.test(rows[0].detail), 'thread row has weight and length');
  ok(m !== 'binding' || /8 mm finished/.test(rows[0].detail) && /cm incl/.test(rows[0].detail), 'binding row has tape width and length');
  ok(m !== 'piping' || /cord 8 mm/.test(rows[0].detail), 'piping row has cord thickness');
  const round: Edits = JSON.parse(JSON.stringify(e));
  ok(JSON.stringify(round) === JSON.stringify(e), `${m}: edits round trip as JSON`);
}
ok(showsOn(mkEdits('piping').edgeTrims![0], 'inside') === false && showsOn(mkEdits('thread').edgeTrims![0], 'inside'), 'piping shows outside only, thread on both');
ok(edgeTrimRows(p.garment, p.pieces, { attachments: [], customSeams: [], detachedSeams: [], pleats: [] }).length === 0, 'old projects (no edge trims) give no rows and load as paint');
const seg = segmentEdgeTrim(front, 0, { ...base, method: 'binding' });
ok(seg.method === 'binding' && edgeLength(front, seg.edge) > 0, 'a clicked segment becomes a binding run');
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('edge tests passed');
