// Run: npx tsx tests/outfit.ts   (several garments worn together in one simulation, src/sim/outfit.ts)
// Checks per outfit: no NaN, every garment stays on, the outer garment stays outside the inner one (share of outer
// points inside the inner garment's surface < 1%), a tucked hem stays inside the waistband, an untucked hem hangs over.
import { makePreset } from '../src/data/presets';
import type { StyleId } from '../src/data/catalog';
import { DEFAULT_BODY, bodyFrame } from '../src/three/body';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider, PosedCollider } from '../src/three/mesher';
import { assembleOutfit, displayOutfit, layerCheck, sidesOf, warmStartOutfit, type OutfitInput, type Outfit3D } from '../src/sim/outfit';
import { boneMatrices, invert, poseAt, type Mode } from '../src/sim/pose';
import { EMPTY_EDITS } from '../src/data/edits';
import type { Outfit, Project } from '../src/store';
import { assemble, setFloat, type Garment3D } from '../src/sim/setup';
import { outfitReport } from '../src/lib/specs';

const body = DEFAULT_BODY;
const f = bodyFrame(body);
const field = calibratedField(body);
const mesh = meshField(field);
const SP = Number(process.env.SP ?? 1.8);
/** a point counts as inside the inner garment past this depth (cm): about one fabric thickness, the cloth is flat
 *  triangles 1.8 cm across over a curved layer */
const TOL = 0.15;
let fails = 0;
const verdict = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

let ids = 0;
const project = (garment: StyleId): Project => ({ id: `p${ids++}`, name: garment, garment, pieces: makePreset(garment, body), body, linkPattern: true, fit: 'regular', edits: { ...EMPTY_EDITS }, updatedAt: 0 });
const item = (garment: StyleId, layer: number, tuck?: 'in' | 'out'): OutfitInput => ({ project: project(garment), layer, ...(tuck ? { tuck } : {}) });

function settle(O: Outfit3D, frames = 600) {
  let k = 0;
  while (!O.sim.sleeping && k < frames) { O.sim.step(); k++; }
  return k;
}

function report(label: string, O: Outfit3D, frames: number, ms: number) {
  const P = O.sim.pos;
  let bad = 0;
  for (const v of P) if (!Number.isFinite(v)) bad++;
  verdict(bad === 0 && O.sim.recoveries === 0, `${label}: ${O.sim.n} particles, ${frames} frames ${ms.toFixed(1)}ms/frame, NaN ${bad}, recoveries ${O.sim.recoveries}`);
  // every garment where it belongs
  for (const g of O.garments) {
    let mx = -1e9, mn = 1e9;
    for (let i = g.start; i < g.start + g.count; i++) { mx = Math.max(mx, P[i * 3 + 1]); mn = Math.min(mn, P[i * 3 + 1]); }
    const on = g.category === 'bottoms' ? mx > f.waistH - 6 && mx < f.waistH + 5 : g.category === 'headwear' ? mn > f.headY + 2 && mx < f.H + 4 : mx > f.neckH - 1 && mx < f.neckH + 12;
    verdict(on, `  ${g.style} (layer ${g.layer}${g.tuck ? `, ${g.tuck}` : ''}, rank ${g.rank}) stays on: y ${mn.toFixed(1)}..${mx.toFixed(1)}`);
  }
  // layering: outer outside inner
  // on screen (the display copy, src/sim/outfit.ts displayOutfit) under 1%; the solver's own positions a little looser
  const shown = new Float32Array(O.sim.n * 3);
  displayOutfit(O, shown);
  for (const [i, j] of O.pairs) {
    const c = layerCheck(O, i, j, shown, TOL), s = layerCheck(O, i, j, O.sim.pos, TOL);
    verdict(c.share < 0.01 && s.share < 0.05, `  ${O.garments[j].style} outside ${O.garments[i].style}: ${c.inside} of ${O.garments[j].count} points inside as shown (${(100 * c.share).toFixed(2)}%), solver ${(100 * s.share).toFixed(2)}%, ${c.over} over it`);
  }
}

/** the hem rows of a top's front and back: pattern points within 2 cm of the lowest point of the piece */
function hemPoints(O: Outfit3D, g: number) {
  const G = O.garments[g], set = new Set<number>();
  for (let k = G.panelStart; k < G.panelStart + G.panelCount; k++) {
    const p = O.panels[k];
    if (p.attach || (p.piece.role !== 'front' && p.piece.role !== 'back')) continue;
    const maxY = Math.max(...p.mesh.uv.map((q) => q.y));
    p.mesh.uv.forEach((q, i) => { if (q.y > maxY - 2) set.add(p.offset + i); });
  }
  return set;
}
function waistTop(O: Outfit3D, g: number) {
  const G = O.garments[g];
  let mx = -1e9;
  for (let i = G.start; i < G.start + G.count; i++) mx = Math.max(mx, O.sim.pos[i * 3 + 1]);
  return mx;
}

const cases: { label: string; items: OutfitInput[]; check?: (O: Outfit3D) => void }[] = [
  {
    label: 'tee tucked into jeans', items: [item('jeans', 0), item('basic-tee', 1, 'in')],
    check: (O) => {
      const tee = O.garments.findIndex((g) => g.style === 'basic-tee'), jeans = O.garments.findIndex((g) => g.style === 'jeans');
      const hem = hemPoints(O, tee), top = waistTop(O, jeans);
      const below = [...hem].filter((i) => O.sim.pos[i * 3 + 1] < top - 1);
      const d = sidesOf(O, tee, jeans, O.sim.pos, (i) => hem.has(i));
      const inside = d.filter((v) => v < 0).length / Math.max(1, d.length);
      verdict(below.length / hem.size > 0.95 && d.length > hem.size * 0.5 && inside > 0.95, `  tucked hem inside the waistband: ${below.length} of ${hem.size} hem points below the waistband top, ${(100 * inside).toFixed(1)}% of ${d.length} under the jeans`);
    },
  },
  {
    label: 'button-up untucked over jeans', items: [item('jeans', 0), item('button-up', 1, 'out')],
    check: (O) => {
      const sh = O.garments.findIndex((g) => g.style === 'button-up'), jeans = O.garments.findIndex((g) => g.style === 'jeans');
      const hem = hemPoints(O, sh);
      const d = sidesOf(O, sh, jeans, O.sim.pos, (i) => hem.has(i));
      const out = d.filter((v) => v >= -0.05).length / Math.max(1, d.length);
      verdict(out > 0.99, `  untucked hem hangs over the jeans: ${(100 * out).toFixed(1)}% of ${d.length} hem points near the jeans are outside`);
    },
  },
  { label: 'jacket over button-up over tee', items: [item('basic-tee', 0), item('button-up', 1), item('jacket', 2)] },
  { label: 'tee, jeans and a bucket hat', items: [item('basic-tee', 1, 'out'), item('jeans', 0), item('bucket-hat', 3)] },
];

const only = process.argv[2];
for (const c of cases) {
  if (only && !c.label.includes(only)) continue;
  const col = new GridCollider(mesh.grid, [field.f.ankleH + 6, field.f.crotchH + 1]);
  const t0 = performance.now();
  const O = assembleOutfit(c.items, body, col, SP)!;
  const t1 = performance.now();
  const frames = settle(O);
  const ms = (performance.now() - t1) / frames;
  console.log(`\n== ${c.label} == build ${(t1 - t0).toFixed(0)}ms`);
  report(c.label, O, frames, ms);
  c.check?.(O);
}

// ---- editing one garment warm starts the whole outfit ----
if (!only || only === 'warm') {
  console.log('\n== warm start ==');
  const col = new GridCollider(mesh.grid, [field.f.ankleH + 6, field.f.crotchH + 1]);
  const items = [item('jeans', 0), item('basic-tee', 1, 'in')];
  const A = assembleOutfit(items, body, col, SP)!;
  settle(A);
  // lengthen the tee a little
  const tee = items[1].project;
  const edited: OutfitInput = { ...items[1], project: { ...tee, pieces: tee.pieces.map((p) => ({ ...p, points: p.points.map((q) => ({ ...q, y: q.y > 40 ? q.y + 1 : q.y })) })) } };
  const B = assembleOutfit([items[0], edited], body, col, SP)!;
  const warm = warmStartOutfit(B, A);
  const frames = settle(B, 400);
  let bad = 0; for (const v of B.sim.pos) if (!Number.isFinite(v)) bad++;
  const [bi, bo] = B.pairs[0];
  const c = layerCheck(B, bi, bo, B.sim.pos, TOL);
  verdict(warm && B.sim.sewFrames === 4 && bad === 0 && c.share < 0.01, `edited tee warm starts the outfit (${frames} frames to settle), NaN ${bad}, jeans over tee ${(100 * c.share).toFixed(2)}%`);
}

// ---- motion: the outfit moves together ----
if (!only || only === 'motion') {
  console.log('\n== motion ==');
  for (const mode of ['walk', 'jacks'] as Mode[]) {
    const col = new PosedCollider(mesh.grid, [f.ankleH + 6, f.crotchH + 1], f);
    const O = assembleOutfit([item('jeans', 0), item('basic-tee', 1, 'in'), item('cap', 2)], body, col, SP)!;
    for (let i = 0; i < 200; i++) O.sim.step();
    O.sim.sleeping = false; O.sim.awake = true;
    for (let i = 0; i < 150; i++) {
      O.sim.substepHook = (k, n) => { const M = boneMatrices(f, poseAt(mode, (i + (k + 1) / n) / 60, f)); col.setPose(M, invert(M)); };
      O.sim.step();
    }
    let bad = 0; for (const v of O.sim.pos) if (!Number.isFinite(v)) bad++;
    const [pi, po] = O.pairs[0];
    const c = layerCheck(O, pi, po, O.sim.pos, TOL);
    const ins = 1 - c.share;
    verdict(bad === 0 && c.share < 0.02, `tee in jeans with a cap, ${mode}: NaN ${bad}, jeans points inside the tee ${(100 * c.share).toFixed(2)}% (${(100 * ins).toFixed(0)}% fine)`);
  }
}

// ---- float: with the body hidden the cloth holds its draped shape in the air, and drapes on again from there ----
if (!only || only === 'float') {
  console.log('\n== float ==');
  const check = (label: string, G: Garment3D) => {
    const sim = G.sim;
    for (let i = 0; i < 250; i++) sim.step();
    const before = sim.pos.slice();
    setFloat(G, true);
    // frozen: stepping it (as the worker would by mistake) changes nothing
    let k = 0;
    while (k < 100) { sim.step(); k++; }
    let moved = 0, sum = 0, bad = 0;
    for (let i = 0; i < sim.n; i++) {
      const d = Math.hypot(sim.pos[i * 3] - before[i * 3], sim.pos[i * 3 + 1] - before[i * 3 + 1], sim.pos[i * 3 + 2] - before[i * 3 + 2]);
      if (!Number.isFinite(d)) bad++; else { moved = Math.max(moved, d); sum += d; }
    }
    // centre of the cloth: it stays where it was (no falling)
    let cy0 = 0, cy1 = 0; for (let i = 0; i < sim.n; i++) { cy0 += before[i * 3 + 1]; cy1 += sim.pos[i * 3 + 1]; }
    const drop = (cy0 - cy1) / sim.n;
    setFloat(G, false);
    sim.sleeping = false;
    for (let i = 0; i < 150; i++) sim.step();
    let back = 0; for (let i = 0; i < sim.n; i++) back = Math.max(back, Math.abs(sim.pos[i * 3 + 1] - before[i * 3 + 1]));
    for (const v of sim.pos) if (!Number.isFinite(v)) bad++;
    verdict(bad === 0 && sum / sim.n < 0.01 && moved < 0.01 && Math.abs(drop) < 0.01 && sim.collider !== null && back < 5, `${label} floats in its drape shape: ${k} frames, points moved avg ${(sum / sim.n).toFixed(2)} cm max ${moved.toFixed(2)} cm, centre dropped ${drop.toFixed(2)} cm; body back on: within ${back.toFixed(1)} cm of the drape`);
  };
  const colA = new GridCollider(mesh.grid, [field.f.ankleH + 6, field.f.crotchH + 1]);
  check('jeans', assemble('jeans', makePreset('jeans', body), body, SP, colA)!);
  const colB = new PosedCollider(mesh.grid, [f.ankleH + 6, f.crotchH + 1], f);
  check('bucket hat', assemble('bucket-hat', makePreset('bucket-hat', body), body, SP, colB)!);
  const colC = new GridCollider(mesh.grid, [field.f.ankleH + 6, field.f.crotchH + 1]);
  check('outfit tee in jeans', assembleOutfit([item('jeans', 0), item('basic-tee', 1, 'in')], body, colC, SP)!);
}

// ---- outfit summary for the tech pack ----
if (!only || only === 'report') {
  console.log('\n== outfit report ==');
  const jeans = project('jeans'), tee = project('basic-tee'), shirt = project('button-up');
  shirt.edits = { ...EMPTY_EDITS, attachments: [{ id: 'r1', kind: 'hardware', name: 'Rivet', pieceId: jeans.pieces[0].id, x: 0, y: 5, rotation: 0, w: 1, h: 1, outline: 'circle', layers: [], hardware: { type: 'rivet', finish: 'brass', size: 0.9, count: 2 } }] };
  const o: Outfit = { id: 'o', name: 'Weekend', body, items: [{ projectId: shirt.id, layer: 2, tuck: 'out' }, { projectId: jeans.id, layer: 0 }, { projectId: tee.id, layer: 1, tuck: 'in' }, { projectId: 'gone', layer: 3 }], updatedAt: 0 };
  const r = outfitReport(o, [jeans, tee, shirt]);
  const denim = r.materials.find((m) => m.fabric.toLowerCase().includes('denim'));
  const order = r.garments.map((g) => g.style).join(' > ');
  const ok = r.garments.length === 3 && r.garments[0].style === 'Jeans' && r.garments[1].wear === 'Tucked in' && r.garments[2].wear === 'Worn out'
    && !!denim && denim.garments.length === 1 && r.totals.metres > 0 && r.totals.pieces === jeans.pieces.length + tee.pieces.length + shirt.pieces.length
    && r.trims.some((t) => t.garment === shirt.name && t.qty === 2);
  verdict(ok, `outfitReport: ${order}; ${r.materials.length} cloth rows, ${r.totals.metres} m, ${r.totals.kg} kg; ${r.trims.length} trim rows (${r.totals.trims} trims)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall outfit checks passed');
process.exit(fails ? 1 : 0);
