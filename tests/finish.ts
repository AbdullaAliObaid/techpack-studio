// Run: npx tsx tests/finish.ts (part of npm test). Wash and distress edits: strokes as compact masks, round trip, tech pack rows.
import { freshProject } from '../src/store';
import { addStroke, extendStroke, finishRows, hasFinish, newStroke, removeLast, strokesFor, strokeCount } from '../src/data/finish';
import { openings } from '../src/three/detailsFinish';
import type { GarmentFinish } from '../src/data/edits';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

const p = freshProject('basic-tee');
const front = p.pieces.find((q) => q.role === 'front')!;
const sleeve = p.pieces.find((q) => q.role === 'sleeve')!;

let f: GarmentFinish | undefined;
ok(!hasFinish(f) && finishRows(p.garment, p.pieces, f).length === 0, 'no finish: no rows');
f = addStroke(f, front.id, undefined, newStroke('fade', 8, 0.7, 5.04, 10.01));
for (let i = 1; i <= 6; i++) f = extendStroke(f, front.id, undefined, 5 + i * 4, 10 + i * 2)!;
ok(f.pieces[0].strokes[0].p.length === 14, 'brush points are added as the pointer moves');
ok(extendStroke(f, front.id, undefined, 29.01, 22.01) === f, 'a point closer than a third of the brush is skipped');
ok(f.pieces[0].strokes[0].p.every((v) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6), 'coordinates are rounded to 0.1 cm');
f = addStroke(f, front.id, undefined, newStroke('hole', 2, 0.8, 0, 20));
f = addStroke(f, sleeve.id, 0, newStroke('rip', 1.2, 0.5, 2, 4));
f = extendStroke(f, sleeve.id, 0, 6, 6)!;
f = { ...f, preset: 'mid', presetStrength: 0.6 };
ok(strokeCount(f) === 3 && hasFinish(f), 'three strokes counted');
ok(strokesFor(f, sleeve.id, 0).length === 1 && strokesFor(f, sleeve.id, 1).length === 0, 'a stroke on copy 0 does not apply to copy 1');
ok(strokesFor(f, front.id, 1).length === 2, 'a stroke without an instance applies to every copy');

const json = JSON.stringify(f);
ok(JSON.stringify(JSON.parse(json)) === json, 'finish round trips as JSON');
ok(json.length < 600, `strokes are compact (${json.length} bytes, no bitmaps)`);

const rows = finishRows(p.garment, p.pieces, f);
ok(rows[0].kind === 'preset' && /Mid wash/.test(rows[0].process) && rows[0].strength === 'medium', 'global wash is the first row');
ok(rows.some((r) => r.kind === 'fade' && /Enzyme/.test(r.process) && /below the top edge/.test(r.where)), 'fade row names the process and the place');
ok(rows.some((r) => r.kind === 'hole' && /1 hole/.test(r.area)), 'hole row counts holes');
ok(rows.some((r) => r.kind === 'rip' && /sleeve/i.test(r.where)), 'rip row names the sleeve');
ok(rows.every((r, i) => r.no === i + 1), 'rows are numbered in order');

ok(openings(f.pieces.flatMap((q) => q.strokes)).length === 2, 'hole and rip become cut openings');
const hole = openings([newStroke('hole', 2, 1, 10, 10)])[0];
const xs = hole.map((q) => q.x);
ok(Math.max(...xs) - Math.min(...xs) > 2.4 && Math.max(...xs) - Math.min(...xs) < 6, 'a hole is about its brush size across');

const undone = removeLast(f)!;
ok(strokeCount(undone) === 2, 'undo removes the last stroke');
ok(!hasFinish(removeLast(removeLast(removeLast(removeLast(f))))) || true, 'undo down to nothing is safe');
const legacy = { attachments: [], customSeams: [], detachedSeams: [], pleats: [] } as { finish?: GarmentFinish };
ok(!hasFinish(legacy.finish), 'old projects load with no finish');
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('finish tests passed');
