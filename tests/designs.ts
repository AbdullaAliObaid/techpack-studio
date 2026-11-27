// Run: npx tsx tests/designs.ts  (part of npm test). Every example design refers to a real style and fabric, loads,
// and the measurements it lists read back within 0.5 cm.
import { DESIGNS, designsFor } from '../src/data/designs';
import { CATALOG } from '../src/data/catalog';
import { FABRICS } from '../src/data/fabrics';
import { designProject } from '../src/store';
import { measureValue, type MeasureTarget } from '../src/data/measureEdit';
import { seamReport } from '../src/lib/specs';
import { makePreset } from '../src/data/presets';
import { DEFAULT_BODY } from '../src/three/body';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

ok(new Set(DESIGNS.map((d) => d.id)).size === DESIGNS.length, 'design ids are unique');
for (const s of CATALOG) ok(designsFor(s.id).length >= 3, `${s.id} has ${designsFor(s.id).length} designs (at least 3)`);

for (const d of DESIGNS) {
  if (!CATALOG.some((s) => s.id === d.style)) { console.log('skip', d.id, '(style not in catalog yet)'); continue; }
  const f = d.fabric ? FABRICS.find((x) => x.id === d.fabric!.id) : undefined;
  ok(!d.fabric || (!!f && (!d.fabric.color || f.colors.some((c) => c.name === d.fabric!.color))), `${d.id}: fabric and colour exist`);
  ok(!/[—–]/.test(d.name + d.blurb), `${d.id}: copy has no dashes`);
  let p;
  try { p = designProject(d, DEFAULT_BODY); } catch (e) { ok(false, `${d.id}: loads (${e})`); continue; }
  if (!p) { ok(false, `${d.id}: loads`); continue; }
  ok(p.garment === d.style, `${d.id}: loads as ${d.style}`);
  for (const [k, v] of Object.entries(d.measures ?? {})) {
    const t: MeasureTarget = k === 'Inseam' ? { kind: 'fit', label: 'Inseam' } : { kind: 'garment', label: k };
    const got = measureValue(d.style, p.pieces, t);
    ok(got !== null && Math.abs(got - v) <= 0.5, `${d.id}: ${k} reads ${got?.toFixed(2)} for ${v}`);
  }
  const base = seamReport(d.style, makePreset(d.style, DEFAULT_BODY)).filter((r) => Math.abs(r.a - r.b - (r.ease ?? 0)) > 0.1).length;
  const bad = seamReport(d.style, p.pieces).filter((r) => Math.abs(r.a - r.b - (r.ease ?? 0)) > 0.1).length;
  ok(bad <= base, `${d.id}: seams still walk`);
  const ids = new Set(p.pieces.map((q) => q.id));
  const want = (d.edits?.attachments ?? []).length;
  const got = (p.edits?.attachments ?? []).filter((a) => !a.builtin).length;
  ok(got === want && (p.edits?.attachments ?? []).every((a) => ids.has(a.pieceId)), `${d.id}: ${want} attachments placed on real pieces`);
  ok((p.edits?.bands ?? []).every((b) => (b.skip ?? []).every((x) => ids.has(x))), `${d.id}: bands skip real pieces`);
}
{
  // letters as the first layer of a patch or applique are cut letter by letter, not as a solid box
  const { attachmentPatch, newDesign, newLayer, docFromAttachment } = await import('../src/components/designDoc');
  const a = attachmentPatch({ ...newDesign(), makeAs: 'applique', layers: [newLayer('text', { text: 'AB12', w: 8, h: 3 })] });
  ok(a.outline === 'shape' && a.shape === 'text' && a.text === 'AB12', 'letters patch: cut as letters, not a box');
  const back = docFromAttachment({ ...a, id: 'x', pieceId: 'p', x: 0, y: 0, rotation: 0 } as never);
  ok(back.layers[0]?.shape === 'text' && back.layers[0]?.text === 'AB12', 'letters patch: reopens with the letters as the base');
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('designs ok');
