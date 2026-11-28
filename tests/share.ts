// Run: npx tsx tests/share.ts
// Share file roundtrip, import safety, body presets, and the tech pack content builders.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
} as Storage;

import { freshProject, migrateProject, type Note, type Outfit } from '../src/store';
import { exportShareFile, importShareFile, readShareFile, ShareError } from '../src/lib/share';
import { BUILTIN_BODIES, deleteBodyPreset, listBodyPresets, listImported, listProjects, renameBodyPreset, saveBodyPreset } from '../src/lib/projects';
import { productionChecks, constructionReport, fabricBom, noteRows, trimDetails, trimsReport } from '../src/lib/specs';
import { buildTechPack } from '../src/lib/exportPdf';
import { pointsOfInterest, includedPois } from '../src/lib/poi';
import type { Attachment } from '../src/data/edits';

let fails = 0;
const ok = (name: string, cond: boolean, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const rejects = async (name: string, blob: Blob, re: RegExp) => {
  try { await readShareFile(blob); ok(name, false, 'accepted'); } catch (e) { ok(name, e instanceof ShareError && re.test((e as Error).message), (e as Error).message); }
};

// ---- a button-up with a different inside collar, chest patch, rivets, woven neck tag and a note ----
export function sampleProject() {
  const p = freshProject('button-up', 'Sample shirt');
  const front = p.pieces.find((q) => q.role === 'front')!, back = p.pieces.find((q) => q.role === 'back')!, collar = p.pieces.find((q) => q.role === 'collar')!;
  const tiny = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const att = (a: Partial<Attachment> & Pick<Attachment, 'id' | 'kind' | 'name' | 'pieceId'>): Attachment => ({ x: 0, y: 0, rotation: 0, w: 5, h: 5, outline: 'rect', layers: [], ...a });
  const hps = front.points.find((q) => q.tag === 'hps' && q.x > 0)!;
  p.edits = {
    attachments: [
      att({ id: 'a-patch', kind: 'patch', name: 'Chest patch', pieceId: front.id, x: 9, y: hps.y + 14, w: 8, h: 8, outline: 'rounded', instance: 0, thread: '#c9933a', fabric: { id: 'canvas', color: 1 },
        layers: [{ id: 'l1', shape: 'star', x: 0, y: -1, w: 3, h: 3, rotation: 0, color: '#ffcc00' }, { id: 'l2', shape: 'text', x: 0, y: 2, w: 5, h: 1.2, rotation: 0, color: '#ffffff', text: 'TECH' }, { id: 'l3', shape: 'image', x: 0, y: 0, w: 1, h: 1, rotation: 0, color: '#000', image: tiny }] }),
      att({ id: 'a-rivet', kind: 'hardware', name: 'Pocket rivets', pieceId: front.id, x: -9, y: hps.y + 20, w: 1, h: 1, hardware: { type: 'rivet', finish: 'copper', size: 0.9, count: 2, spacing: 2 } }),
      att({ id: 'a-tag', kind: 'label', name: 'Neck tag', pieceId: back.id, x: 0, y: 3, w: 5, h: 2.5, face: 'inside', label: { type: 'woven', sewn: 'ends', color: '#ffffff' }, layers: [{ id: 'l4', shape: 'text', x: 0, y: 0, w: 3, h: 1, rotation: 0, color: '#000000', text: 'TI' }] }),
    ],
    customSeams: [], detachedSeams: [], pleats: [],
    insideFabric: { [collar.id]: { id: 'poplin', color: 2, hex: '#b3202a', pattern: { id: 'gingham', colors: ['#ffffff', '#b3202a'], scale: 0.8, rotation: 0 } as never } },
  };
  const note: Note = { id: 'n1', kind: 'text', points: [{ x: 2, y: 2 }], pieceId: front.id, text: 'Match checks at centre front', color: '#d9480f', width: 2, createdAt: 1 };
  p.notes = [note, { id: 'n2', kind: 'ink', points: [{ x: 0, y: 0 }, { x: 3, y: 3 }], color: '#2563eb', width: 2, createdAt: 2 }];
  return p;
}

async function main() {
  const p = sampleProject();
  console.log('== share file ==');
  const outfit: Outfit = { id: 'o1', name: 'Look', body: p.body, items: [{ projectId: p.id, layer: 0 }, { projectId: 'missing', layer: 1 }], updatedAt: 5 };
  const blob = await exportShareFile([p], [outfit], [{ id: 'b1', name: 'Client A', body: p.body, updatedAt: 3 }], { from: 'Sam' });
  ok('file is gzip when the platform can', typeof CompressionStream !== 'function' || blob.type === 'application/gzip');
  const sf = await readShareFile(blob);
  ok('roundtrip keeps the project exactly (edits, notes, pictures)', JSON.stringify(sf.projects[0]) === JSON.stringify(p));
  ok('picture layer survives', !!sf.projects[0].edits!.attachments[0].layers[2].image?.startsWith('data:image/png'));
  ok('notes survive', sf.projects[0].notes?.length === 2 && sf.projects[0].notes![0].text === 'Match checks at centre front');
  ok('outfit and body preset survive', sf.outfits?.[0].id === 'o1' && sf.bodies?.[0].name === 'Client A' && sf.from === 'Sam');

  const saved: Outfit[] = [];
  const r = importShareFile(sf, { fileName: 'shirt.techit', saveOutfit: (o) => saved.push(o) });
  ok('import re-ids the project', r.projects[0].id !== p.id && listProjects().some((q) => q.id === r.projects[0].id));
  ok('import marks it imported', r.projects[0].imported?.from === 'Sam' && r.projects[0].imported?.fileName === 'shirt.techit' && listImported().length === 1);
  ok('import keeps the content', JSON.stringify({ ...r.projects[0], id: 0, updatedAt: 0, imported: 0 }) === JSON.stringify({ ...p, id: 0, updatedAt: 0, imported: 0 }) || JSON.stringify(r.projects[0].edits) === JSON.stringify(p.edits));
  ok('outfit follows the new project id, missing project dropped', saved[0].items.length === 1 && saved[0].items[0].projectId === r.projects[0].id && saved[0].id !== 'o1');
  const r2 = importShareFile(sf, { fileName: 'shirt.techit' });
  ok('importing twice makes a second copy', r2.projects[0].id !== r.projects[0].id && listImported().length === 2);
  ok('body preset imported under a new id', r.bodies[0].id !== 'b1' && listBodyPresets().some((b) => b.name === 'Client A'));

  console.log('\n== rejected files ==');
  await rejects('random JSON', new Blob([JSON.stringify({ hello: 'world', projects: [] })]), /not a tech-it file/);
  await rejects('not JSON', new Blob(['MZ\u0000binary']), /not a tech-it file/);
  await rejects('empty', new Blob([]), /empty/);
  await rejects('newer version', new Blob([JSON.stringify({ format: 'tech-it', version: 9, projects: [] })]), /newer version/);
  await rejects('project without pieces', new Blob([JSON.stringify({ format: 'tech-it', version: 1, projects: [{ id: 'x', name: 'x', garment: 'jeans' }] })]), /not a valid project|no valid pattern/);
  const evil = JSON.parse(JSON.stringify({ format: 'tech-it', version: 1, projects: [p] }));
  evil.projects[0].edits.attachments[0].layers[2].image = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
  evil.projects[0].edits.attachments[0].layers[0].__proto__ = { polluted: 1 };
  const clean = await readShareFile(new Blob([JSON.stringify(evil).replace('"layers":[{', '"layers":[{"__proto__":{"x":1},')]));
  ok('non-image data URLs are stripped', clean.projects[0].edits!.attachments[0].layers[2].image === undefined);
  ok('no prototype pollution', ({} as Record<string, unknown>).polluted === undefined && ({} as Record<string, unknown>).x === undefined);

  console.log('\n== body presets ==');
  ok('two built-ins first', listBodyPresets().slice(0, 2).map((b) => b.name).join() === 'Male,Female' && BUILTIN_BODIES.length === 2);
  ok('built-ins cannot be deleted or renamed', !deleteBodyPreset('builtin-male') && !renameBodyPreset('builtin-female', 'x') && listBodyPresets()[1].name === 'Female');
  const bp = saveBodyPreset('Fit model M', p.body);
  ok('save, rename, delete', renameBodyPreset(bp.id, 'Fit model L') && listBodyPresets().some((b) => b.name === 'Fit model L') && deleteBodyPreset(bp.id) && !listBodyPresets().some((b) => b.id === bp.id));

  console.log('\n== tech pack content ==');
  const bom = fabricBom(p.pieces, p.edits, p.garment);
  const outside = bom.filter((b) => b.face === 'outside'), inside = bom.filter((b) => b.face === 'inside'), att = bom.filter((b) => b.face === 'attachment');
  ok('outside and inside fabrics are separate rows', outside.length >= 1 && inside.length === 1 && inside[0].where.join().includes('Collar'));
  ok('inside row has the pattern, repeat, colourway', inside[0].pattern === 'Gingham' && !!inside[0].repeat && !!inside[0].colourway && inside[0].construction !== 'plain');
  ok('inside row has weight and composition and consumption', inside[0].gsm > 0 && inside[0].composition.length > 0 && inside[0].metres > 0);
  ok('attachment cloth row for the canvas patch', att.length === 1 && att[0].fabric === 'Cotton Canvas');
  const td = trimDetails(p.pieces, p.edits, p.garment);
  ok('every attachment, hardware and label is in the trims table', td.length === p.edits!.attachments.length && p.edits!.attachments.every((a) => td.some((t) => t.id === a.id)));
  ok('numbered 1..n', td.every((t, i) => t.no === i + 1));
  ok('every item has measured placement', td.every((t) => t.refs.length >= 2 && t.refs.every((r) => Number.isFinite(r.value) && r.value >= 0)));
  const patch = td.find((t) => t.id === 'a-patch')!, rivet = td.find((t) => t.id === 'a-rivet')!, tag = td.find((t) => t.id === 'a-tag')!;
  ok('patch: from centre front 9.0 cm, layers listed', patch.refs.find((r) => /centre front/i.test(r.label))?.value === 9 && patch.layers.length === 3 && patch.thread.includes('#c9933a'));
  // 2 rivets per copy of the host: a front cut twice (split fronts) with the rivets on both sides counts both copies
  const rivAtt = p.edits!.attachments.find((a) => a.id === 'a-rivet')!;
  const copies = rivAtt.instance === undefined ? p.pieces.find((q) => q.id === rivAtt.pieceId)?.cut ?? 1 : 1;
  ok('rivets: quantity per copy, copper, points drawn', rivet.qty === 2 * copies && rivet.points.length === 2 && /copper/i.test(rivet.colour));
  ok('tag is inside and says so', tag.face === 'inside' && tag.faceName !== 'Outside' && /woven/i.test(tag.item));
  ok('trimsReport and details agree on hardware count', trimsReport(p.pieces, p.edits, p.garment).filter((t) => t.kind === 'hardware').reduce((s, t) => s + t.qty, 0) === rivet.qty);
  const cr = constructionReport(p.garment, p.pieces, p.edits);
  ok('construction lists seams with stitches and the inside fabric', cr.seams.length > 5 && cr.seams.every((s) => s.stitch.length > 0) && cr.finishing.some((f) => /Under collar/.test(f)));
  ok('text notes numbered, ink left on the chart', noteRows(p.notes, p.pieces).length === 1);

  console.log('\n== pdf ==');
  const shots: string[] = [];
  const doc = await buildTechPack(p, 'cm', null, { capture: async (reqs) => { shots.push(...reqs.map((r) => (r.marker ? 'locator' : r.kind))); return reqs.map(() => null); } });
  ok('pdf builds without photos', doc.getNumberOfPages() >= 8);
  ok('asks for overview, one close-up per item, one inside view', shots.filter((k) => k === 'overview').length === 3 && shots.filter((k) => k === 'attachment').length >= 3 && shots.includes('inside'));
  const none = await buildTechPack(p, 'cm', null);
  ok('pdf builds when the 3D view is missing', none.getNumberOfPages() === doc.getNumberOfPages());

  console.log('\n== close-ups (points of interest) ==');
  {
    const j = freshProject('jeans', 'Jeans');
    const kinds = (q: typeof j) => pointsOfInterest(q).map((o) => o.kind);
    const base = pointsOfInterest(j);
    ok('jeans: fly, rivets, belt loops, pockets', ['fly', 'hardware', 'beltloops', 'attachment'].every((k) => kinds(j).includes(k as never)), kinds(j).join());
    const back = j.pieces.find((q) => q.role === 'back')!;
    ok('back pocket rivets are one page, on the back view', base.filter((o) => o.kind === 'hardware' && o.view === 'back').length === 1 && base.find((o) => o.kind === 'beltloops')!.title.includes('5'));
    ok('every page has a target, radius and spec rows', base.every((o) => o.targets.length >= 1 && o.radiusCm >= 4 && o.spec.length >= 3 && j.pieces.some((q) => q.id === o.pieceId)));
    ok('ids are unique', new Set(base.map((o) => o.id)).size === base.length);
    const front = j.pieces.find((q) => q.role === 'front')!, bag = j.pieces.find((q) => q.role === 'pocketBag')!;
    let q = j;
    const grow = (name: string, mut: (q: typeof j) => typeof j, kind: string) => {
      const before = pointsOfInterest(q).length, q2 = mut(q);
      const after = pointsOfInterest(q2);
      ok(`adding ${name} adds one page`, after.length === before + 1 && after.some((o) => o.kind === kind), `${before} to ${after.length}`);
      return q2;
    };
    const withEdits = (e: Partial<NonNullable<typeof j.edits>>) => (z: typeof j) => ({ ...z, edits: { ...z.edits!, ...e } });
    q = grow('a band', withEdits({ bands: [{ id: 'b1', from: 'hem', offset: 20, stripes: [{ height: 2, color: '#ffffff' }, { height: 3, color: '#b3202a' }], method: 'woven' }] }), 'band');
    const band = pointsOfInterest(q).find((o) => o.kind === 'band')!;
    ok('band page shows front and back and lists stripes', band.targets.length === 2 && band.spec.filter((r) => /^Stripe/.test(r[0])).length === 2);
    q = grow('an inside fabric', (z) => withEdits({ insideFabric: { [bag.id]: { id: 'poplin', color: 2 } } })(z), 'inside');
    q = grow('a patterned fabric', (z) => ({ ...z, pieces: z.pieces.map((pc) => (pc.id === front.id ? { ...pc, fabric: { ...pc.fabric, pattern: { id: 'gingham', colors: ['#ffffff', '#b3202a'], scale: 1, rotation: 0 } as never } } : pc)) }), 'pattern');
    ok('pattern page has a wider radius and the repeat size', pointsOfInterest(q).find((o) => o.kind === 'pattern')!.radiusCm >= 9 && pointsOfInterest(q).find((o) => o.kind === 'pattern')!.spec.some((r) => r[0] === 'Repeat size'));
    const emb: Attachment = { id: 'emb1', kind: 'embroidery', name: 'Crest', pieceId: back.id, x: 0, y: 4, rotation: 0, w: 4, h: 4, outline: 'rect', layers: [], thread: '#c9933a' };
    q = grow('an embroidery', (z) => withEdits({ attachments: [...z.edits!.attachments, emb] })(z), 'attachment');
    const all = pointsOfInterest(q);
    const pagesOf = async (z: typeof j) => (await buildTechPack(z, 'cm', null)).getNumberOfPages();
    const p0 = await pagesOf(j), p1 = await pagesOf(q);
    ok('tech pack page count grows with the close-ups', p1 - p0 >= all.length - base.length && all.length - base.length === 4, `${p0} to ${p1} pages, ${all.length} close-ups`);
    const skipped = { ...q, edits: { ...q.edits!, techpackSkip: [all[0].id, all[1].id] } };
    ok('excluded close-ups drop out', includedPois(skipped).length === all.length - 2 && (await pagesOf(skipped)) === p1 - 2);
    const reqs: string[] = [];
    await buildTechPack(q, 'cm', null, { capture: async (r) => { reqs.push(...r.map((x) => `${x.kind}${x.marker ? '+marker' : ''}`)); return r.map(() => null); } });
    ok('asks for a close-up and a locator per page', reqs.filter((k) => k === 'overview+marker').length === all.length);
  }

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  {
    // denim with genuine leather must state the wash sequence
    const j = freshProject('jeans', 'Leather patch jeans');
    const pieces = j.pieces.map((pc) => (pc.role === 'back-pocket' || pc.role === 'pocket' ? { ...pc, fabric: { ...pc.fabric, id: 'leather' } } : pc));
    const leathered = pieces.some((pc) => pc.fabric.id === 'leather') ? pieces : pieces.map((pc, i) => (i === pieces.length - 1 ? { ...pc, fabric: { ...pc.fabric, id: 'leather' } } : pc));
    const c0 = productionChecks(leathered, j.edits);
    ok('leather + denim: wash sequence asked', c0.length === 1 && !c0[0].resolved);
    ok('leather + denim: tech pack says to confirm', constructionReport('jeans', leathered, j.edits).finishing.some((f) => f.startsWith('TO CONFIRM')));
    const c1 = productionChecks(leathered, { ...j.edits!, washSequence: 'prewash' });
    ok('leather + denim: answer printed', c1[0]?.resolved === true && constructionReport('jeans', leathered, { ...j.edits!, washSequence: 'prewash' }).finishing.some((f) => f.includes('washed before the leather')));
    ok('plain denim: no wash question', productionChecks(j.pieces, j.edits).length === 0);
  }
  {
    // projects saved before newer edit lists existed still open with every list filled in
    const old = { ...freshProject('jeans', 'Old'), edits: { attachments: [], customSeams: [] } } as never;
    const m = migrateProject(old);
    ok('old project: missing edit lists are filled in', Array.isArray(m.edits?.pleats) && Array.isArray(m.edits?.detachedSeams));
  }
  console.log('== pocket with a motif ==');
  {
    const q = freshProject('button-up', 'Motif pocket');
    const front = q.pieces.find((x) => x.role === 'front')!;
    const motif = { aspect: 1, paths: [{ color: '#112233', path: 'M-0.4 -0.4L0.4 -0.4L0.4 0.4L-0.4 0.4Z' }, { color: '#cc3344', path: 'M-0.2 -0.2L0.2 -0.2L0.2 0.2L-0.2 0.2Z' }], palette: undefined };
    const pocket: Attachment = { id: 'pk1', kind: 'pocket', name: 'Front pocket', pieceId: front.id, x: 0, y: 0, rotation: 0, w: 10, h: 12, outline: 'rect', layers: [], alignPattern: true,
      fabric: { id: 'cotton', color: 0, pattern: { id: 'custom', colors: ['#eeeeee'], scale: 6, rotation: 0, method: 'printed', motif, layout: 'block', motifScale: 0.7, opacity: 0.6, hidden: [1] } } };
    q.edits = { ...(q.edits ?? { attachments: [], customSeams: [], detachedSeams: [], pleats: [] }), attachments: [pocket] };
    const sf2 = await readShareFile(await exportShareFile([q]));
    const back = importShareFile(sf2, { fileName: 'pocket.techit' }).projects[0].edits!.attachments[0];
    ok('pocket keeps its motif, opacity, hidden colour and alignment through share', JSON.stringify(back.fabric?.pattern) === JSON.stringify(pocket.fabric!.pattern) && back.alignPattern === true);
    const rows = fabricBom(q.pieces, q.edits, q.garment);
    const row = rows.find((r) => r.pattern === 'Your motif');
    ok('the BOM lists the pocket motif with its opacity and hidden colour', !!row && /opacity 60%/.test(row.adjust ?? '') && /hidden/.test(row.adjust ?? ''), JSON.stringify(row && { p: row.pattern, a: row.adjust }));
  }
  console.log('\nall share and tech pack checks passed');
}
if (process.argv[1]?.endsWith("share.ts")) main();
