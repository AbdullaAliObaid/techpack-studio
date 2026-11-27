// Run: npx tsx tests/measure.ts  (part of npm test). Typed measurements: the number reads back and the seams still walk.
import { makePreset } from '../src/data/presets';
import { DEFAULT_BODY } from '../src/three/body';
import { applyMoves } from '../src/data/symmetry';
import { measureValue, setMeasurement, type MeasureTarget } from '../src/data/measureEdit';
import { seamReport } from '../src/lib/specs';
import { presetBlocks, shapeBlocks } from '../src/data/colourBlock';
import type { StyleId } from '../src/data/catalog';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

function check(style: StyleId, name: string, t: (p: ReturnType<typeof makePreset>) => MeasureTarget, value: number, total: boolean) {
  const pieces = makePreset(style, DEFAULT_BODY);
  const before = seamReport(style, pieces).filter((r) => Math.abs(r.a - r.b - (r.ease ?? 0)) > 0.1).length;
  const target = t(pieces);
  const moves = setMeasurement(style, pieces, target, value, { total });
  const after = applyMoves(pieces, moves);
  const got = measureValue(style, after, target);
  ok(moves.length > 0 && got !== null && Math.abs(got - value) < 0.05, `${style} ${name} reads ${got?.toFixed(3)} for ${value}${total ? ' (total symmetry)' : ''}`);
  if (total) {
    const bad = seamReport(style, after).filter((r) => Math.abs(r.a - r.b - (r.ease ?? 0)) > 0.1);
    ok(bad.length <= before, `${style} ${name}: seams still walk${bad.length ? ' (' + bad.map((r) => r.label).join(', ') + ')' : ''}`);
  }
  // symmetric pieces stay symmetric
  for (const p of after) for (const q of p.points) {
    const m = q.mirror && q.mirror !== q.id ? p.points.find((x) => x.id === q.mirror) : null;
    if (m && (Math.abs(m.x + q.x) > 1e-6 || Math.abs(m.y - q.y) > 1e-6) && pieces.find((o) => o.id === p.id)!.symmetric && p.role !== 'front' && p.role !== 'back') { ok(false, `${name}: ${p.name} stayed symmetric`); return; }
  }
}
const spec = (role: string, label: string) => (ps: ReturnType<typeof makePreset>): MeasureTarget => ({ kind: 'spec', pieceId: ps.find((p) => p.role === role)!.id, label });

for (const total of [false, true]) {
  check('basic-tee', 'chest width', spec('front', 'Chest'), 61, total);
  check('basic-tee', 'sleeve opening', spec('sleeve', 'Opening'), 40, total);
  check('basic-tee', 'sleeve length', spec('sleeve', 'Length'), 25, total);
  check('polo', 'collar length', spec('collar', 'Collar length'), 48, total);
  check('polo', 'placket length', spec('placket', 'Length'), 12, total);
  check('jeans', 'inseam', spec('front', 'Inseam'), 80, total);
  check('jeans', 'hip', spec('front', 'Hip'), 50, total);
}
check('basic-tee', 'garment chest', () => ({ kind: 'garment', label: 'Chest circumference' }), 108, true);
check('button-up', 'fit neck', () => ({ kind: 'fit', label: 'Neck' }), 42, true);
check('jeans', 'fit waist', () => ({ kind: 'fit', label: 'Waist' }), 88, true);
check('basic-tee', 'edge', (ps) => { const f = ps.find((p) => p.role === 'sleeve')!; return { kind: 'edge', pieceId: f.id, fromId: f.points[3].id, toId: f.points[4].id }; }, 15, false);
// colour blocks: sleeve tips cover both sleeves, hem bands on front and back meet at the side seams
{
  const style: StyleId = 'basic-tee';
  const ps = makePreset(style, DEFAULT_BODY);
  const look = { colour: '#111111', sheen: 'matte' as const, look: 'dyed' as const };
  const tip = presetBlocks(style, ps, 'tip', 6, look, { total: true, symmetry: true });
  ok(tip.length === 1 && tip[0].instance === undefined && tip[0].block === true && tip[0].pieceId === ps.find((p) => p.role === 'sleeve')!.id, 'sleeve tip: one block on the sleeve, both copies');
  const hem = presetBlocks(style, ps, 'hem', 5, look, { total: true, symmetry: true }, ps.find((p) => p.role === 'front')!.id);
  const top = (a: (typeof hem)[number]) => a.y - a.h / 2;
  const hemY = (role: string) => Math.max(...ps.find((p) => p.role === role)!.points.filter((q) => q.tag === 'hem').map((q) => q.y));
  ok(hem.length === 2 && Math.abs((hemY('front') - top(hem[0])) - (hemY('back') - top(hem[1]))) < 1e-9 && Math.abs(hemY('front') - top(hem[0]) - 5) < 1e-9, 'total symmetry: hem bands 5 cm above the hem on front and back');
  const sleeve = ps.find((p) => p.role === 'sleeve')!;
  const tri = [{ x: 2, y: 2 }, { x: 8, y: 2 }, { x: 5, y: 9 }];
  const drawn = shapeBlocks(style, ps, sleeve.id, tri, false, look, { total: false, symmetry: true });
  ok(drawn.length >= 2 && drawn.some((a) => a.instance === 1 && a.layers[0].flipX), 'free shape on a sleeve: left and right blocks, the right one flipped');
}
if (fails) { console.error(fails + ' failed'); process.exit(1); }
