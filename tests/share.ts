// Run: npx tsx tests/share.ts
// Share file roundtrip, import safety, body presets, and the tech pack content builders.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(), key: () => null, get length() { return mem.size; },
} as Storage;

import { freshProject, type Note, type Outfit } from '../src/store';
import { exportShareFile, importShareFile, readShareFile, ShareError } from '../src/lib/share';
import { BUILTIN_BODIES, deleteBodyPreset, listBodyPresets, listImported, listProjects, renameBodyPreset, saveBodyPreset } from '../src/lib/projects';
import { constructionReport, fabricBom, noteRows, trimDetails, trimsReport } from '../src/lib/specs';
import { buildTechPack } from '../src/lib/exportPdf';
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
  const doc = await buildTechPack(p, 'cm', null, { capture: async (reqs) => { shots.push(...reqs.map((r) => r.kind)); return reqs.map(() => null); } });
  ok('pdf builds without photos', doc.getNumberOfPages() >= 8);
  ok('asks for overview, one close-up per item, one inside view', shots.filter((k) => k === 'overview').length === 3 && shots.filter((k) => k === 'attachment').length === 3 && shots.includes('inside'));
  const none = await buildTechPack(p, 'cm', null);
  ok('pdf builds when the 3D view is missing', none.getNumberOfPages() === doc.getNumberOfPages());

  if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
  console.log('\nall share and tech pack checks passed');
}
if (process.argv[1]?.endsWith("share.ts")) main();
