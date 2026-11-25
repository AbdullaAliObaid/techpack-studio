// Run: npx tsx tests/accuracy.ts
import { bodyFrame, perimeter, tapePerimeter, DEFAULT_BODY, FEMALE_BODY, MALE_BODY, type Body } from '../src/three/body';
import { NBONES } from '../src/sim/pose';
import { makePreset } from '../src/data/presets';
import { draft, regradePoints, EASE, crownArc, derivedGirths, FITS, RIB, neckBase } from '../src/data/draft';
import { CATALOG, migrateGarment, styleById } from '../src/data/catalog';
import { freshProject } from '../src/store';
import { fitTable, seamReport } from '../src/lib/specs';
import { calibratedField } from '../src/three/bodyField';
import { meshField } from '../src/three/mesher';
import { hullLength } from '../src/three/body';
import { buildGarment } from '../src/three/garment';
import { samplePoly, sliceSpan } from '../src/lib/geometry';
import { findTag, pieceSpecs } from '../src/lib/specs';
import { readFileSync } from 'node:fs';
import { builtinSeams } from '../src/sim/seams';
import { assemble } from '../src/sim/setup';
import { EMPTY_EDITS, type Edits } from '../src/data/edits';
import { NO_COLLIDER, sewSignature } from './sewSnapshot';

const bodies: Record<string, Body> = {
  default: DEFAULT_BODY,
  slim: { height: 168, chest: 86, waist: 70, hips: 90, shoulder: 41, arm: 58, inseam: 76, neck: 35 },
  big: { height: 182, chest: 124, waist: 112, hips: 116, shoulder: 51, arm: 64, inseam: 81, neck: 45 },
  tall: { height: 198, chest: 104, waist: 86, hips: 102, shoulder: 49, arm: 70, inseam: 92, neck: 40 },
  female: FEMALE_BODY,
  'female curvy': { ...FEMALE_BODY, chest: 104, waist: 80, hips: 112, height: 170, inseam: 78, shoulder: 40, neck: 35 },
};
const meshes: Record<string, ReturnType<typeof meshField>> = {};

let fails = 0;
const check = (name: string, got: number, want: number, tol = 0.05) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(42)} got ${got.toFixed(2).padStart(7)}  want ${want.toFixed(2).padStart(7)}`);
};

for (const [name, b] of Object.entries(bodies)) {
  console.log(`\n== ${name} body ==`);
  const f = bodyFrame(b);
  const tape = (r: { a: number; b: number; shape: (t: number) => number }) => tapePerimeter(r.a, r.b, r.shape, 720);
  check('mesh chest girth', tape(f.torsoRing(f.chestH)), b.chest);
  check('mesh waist girth', tape(f.torsoRing(f.waistH)), b.waist);
  check('mesh hip girth', tape(f.torsoRing(f.hipH)), b.hips);
  check('mesh neck girth', tape(f.neckRing(f.neckMeasureH)), b.neck);
  check('crown height', f.neckH + 0.029 * f.H + f.headH, b.height);
  check('crotch height (inseam)', f.crotchH, b.inseam);
  check('shoulder point to point', 2 * f.acromion.x, b.shoulder);
  check('shoulder point to wrist (arm)', Math.hypot(f.acromion.x - f.wrist.x, f.acromion.y - f.wrist.y), b.arm);

  // the rendered body mesh, measured like a tape (convex hull of the slice around the torso)
  const field = calibratedField(b);
  const mesh = meshField(field);
  meshes[name] = mesh;
  const d = derivedGirths(b);
  check('rendered head at hat band (tape)', field.girthAt(f.headBandH, 0, f.headCz, 16), d.head, 0.25);
  // slice the rendered mesh, link the cut segments into closed loops, take the loop around the torso centre
  const slice = (h: number) => {
    const P = mesh.positions, I = mesh.indices;
    const pt = new Map<string, [number, number]>();
    const adj = new Map<string, string[]>();
    const key = (a: number, c: number) => (a < c ? `${a}_${c}` : `${c}_${a}`);
    for (let t = 0; t < I.length; t += 3) {
      const cut: string[] = [];
      for (let e = 0; e < 3; e++) {
        const a = I[t + e], c = I[t + ((e + 1) % 3)];
        const ya = P[a * 3 + 1], yc = P[c * 3 + 1];
        if ((ya - h) * (yc - h) >= 0) continue;
        const u = (h - ya) / (yc - ya), k = key(a, c);
        pt.set(k, [P[a * 3] + (P[c * 3] - P[a * 3]) * u, P[a * 3 + 2] + (P[c * 3 + 2] - P[a * 3 + 2]) * u]);
        cut.push(k);
      }
      if (cut.length === 2) {
        (adj.get(cut[0]) ?? adj.set(cut[0], []).get(cut[0])!).push(cut[1]);
        (adj.get(cut[1]) ?? adj.set(cut[1], []).get(cut[1])!).push(cut[0]);
      }
    }
    const seen = new Set<string>();
    let best: [number, number][] = [];
    for (const start of adj.keys()) {
      if (seen.has(start)) continue;
      const loop: [number, number][] = [];
      let cur: string | undefined = start;
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        loop.push(pt.get(cur)!);
        cur = adj.get(cur)!.find((n) => !seen.has(n));
      }
      // keep the loop that encloses the torso centre (x = 0, z = 0)
      let inside = false;
      for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
        const [xi, zi] = loop[i], [xj, zj] = loop[j];
        if (zi > 0 !== zj > 0 && 0 < ((xj - xi) * (0 - zi)) / (zj - zi) + xi) inside = !inside;
      }
      if (inside && loop.length > best.length) best = loop;
    }
    return hullLength(best);
  };
  check('rendered mesh chest (tape)', slice(f.chestH), b.chest, 0.25);
  check('rendered mesh waist (tape)', slice(f.waistH), b.waist, 0.25);
  check('rendered mesh hips (tape)', slice(f.hipH), b.hips, 0.25);
  let top = 0; for (let i = 1; i < mesh.positions.length; i += 3) top = Math.max(top, mesh.positions[i]);
  check('rendered mesh height', top, b.height, 0.25);

  const ROLES = new Set(['front', 'back', 'sleeve', 'neckband', 'collar', 'placket', 'cuff', 'waistband', 'crown', 'brim']);
  for (const style of CATALOG) {
    const g = style.id, fam = style.family;
    const pieces = makePreset(g, b);
    const E = EASE[g];
    const rows = fitTable(g, pieces, b);
    const row = (label: string) => rows.find((r) => r.label === label);
    const want = (label: string, value: number, tol = 0.1) => {
      const r = row(label);
      if (!r) { fails++; console.log(`FAIL ${g} has no "${label}" row`); return; }
      check(`${g} ${label}`, r.garment, value, tol);
    };
    if (!pieces.every((p) => ROLES.has(p.role))) { fails++; console.log(`FAIL ${g} has a piece without a known role`); }
    if (pieces[0].fabric.id !== style.defaultFabric) { fails++; console.log(`FAIL ${g} does not start in ${style.defaultFabric}`); }
    if (fam === 'pants') {
      want('Waist', b.waist + E.waist);
      want('Hip', b.hips + E.hip);
      if (E.elastic !== undefined) want('Waist elastic', b.waist + E.elastic);
      if (E.knee !== undefined) want('Knee', d.knee + E.knee);
      const knee = d.knee + (E.knee ?? 0);
      const opening = E.inseamLen !== undefined ? d.thigh + E.legOpening : E.flare !== undefined ? knee + E.flare : E.cuffH ? d.ankle + E.legOpening : Math.max(d.ankle + E.legOpening, 36);
      want('Leg opening', opening);
      const inseam = E.inseamLen ?? (E.cuffH ? f.crotchH - (f.ankleH - 1 + E.cuffH) + E.blouse : b.inseam - 3 + (E.inseam ?? 0));
      want('Inseam', inseam);
      if (E.cuffH) want('Ankle cuff', RIB.cuff * opening);
    } else if (fam === 'bucket' || fam === 'cap') {
      want('Head', d.head + E.head);
      want('Crown depth', crownArc(d.head) + E.depth);
    } else {
      want('Chest', b.chest + E.chest);
      want('Waist', b.waist + E.waist);
      want('Hem / hips', b.hips + E.hem);
      want('Shoulder', b.shoulder + E.shoulder + 2 * (E.drop ?? 0));
      if (fam === 'tee' || fam === 'polo') {
        want('Sleeve length', b.arm * E.sleeveRatio);
        want('Neck base', neckBase(b) + E.neck);
      }
      else want('Sleeve / arm', b.arm + E.sleeve);
    }

    for (const fit of FITS) {
      const pf = fit === 'regular' ? pieces : makePreset(g, b, fit);
      for (const r of seamReport(g, pf)) check(`${g}${fit === 'regular' ? '' : ' ' + fit} seam ${r.label}`, r.a - r.b, r.ease ?? 0, 0.05);
    }

    // 3D garment: chest / hip ring perimeter must equal the pattern circumference
    if (fam === 'bucket' || fam === 'cap') continue;
    const res = buildGarment(g, pieces, b);
    const front = pieces.find((p) => p.role === 'front')!, back = pieces.find((p) => p.role === 'back')!;
    const fp = samplePoly(front.points), bp = samplePoly(back.points);
    const w = (poly: typeof fp, y: number) => { const s = sliceSpan(poly, y); return s ? s.x2 - s.x1 : 0; };
    if (fam !== 'pants') {
      const ua = findTag(front, 'underarm')!.y - findTag(front, 'hps')!.y;
      const h = f.neckH - ua;
      const torso = res.parts.find((p) => p.key === 'torso')!;
      const ring = torso.rings.reduce((a, r) => (Math.abs(r.y - h) < Math.abs(a.y - h) ? r : a));
      check(`${g} 3D chest ring = pattern chest`, perimeter(ring.a, ring.b, ring.shape, 720), w(fp, findTag(front, 'underarm')!.y) + w(bp, findTag(back, 'underarm')!.y), 0.3);
      const top = res.parts.find((p) => p.key === 'torso')!.rings.reduce((m, r) => Math.max(m, r.y), 0);
      check(`${g} 3D garment top at body HPS`, top + 0.8, f.neckH, 0.6);
    } else {
      const seat = res.parts.find((p) => p.key === 'seat')!;
      const hipY = findTag(front, 'hip')!.y, cr = findTag(front, 'crotch')!.y, bcr = findTag(back, 'crotch')!.y;
      const h = f.crotchH - (hipY - cr);
      const ring = seat.rings.reduce((a, r) => (Math.abs(r.y - h) < Math.abs(a.y - h) ? r : a));
      check(`${g} 3D hip ring = pattern hip`, perimeter(ring.a, ring.b, ring.shape, 720), 2 * (w(fp, hipY) + w(bp, bcr + (hipY - cr))), 0.6);
      const legTop = Math.max(...seat.rings.map((r) => r.y));
      check(`${g} leg pieces + waistband reach the waist`, legTop + E.waistband + (E.riseDrop ?? 0), f.waistH, 1.2);
    }
  }
}

// female fit model: bust shape, mesh sanity, skin weights of the 11-bone rig
console.log('\n== female body and rig ==');
{
  const b = FEMALE_BODY, f = bodyFrame(b), mesh = meshes.female;
  const ok = (name: string, cond: boolean, info = '') => { if (!cond) fails++; console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${info ? '  ' + info : ''}`); };
  const front = (h: number) => { const r = f.torsoRing(h); let z = -1e9; for (let i = 0; i < 720; i++) { const th = (i / 720) * Math.PI * 2; z = Math.max(z, r.b * r.shape(th) * Math.sin(th)); } return z; };
  const under = f.chestH - 0.05 * f.H;
  ok('bust apex forward of the underbust (rings)', front(f.chestH) - front(under) > 2.5, `${(front(f.chestH) - front(under)).toFixed(2)} cm`);
  ok('bust apex forward of the upper chest (rings)', front(f.chestH) - front(f.chestH + 0.04 * f.H) > 1, `${(front(f.chestH) - front(f.chestH + 0.04 * f.H)).toFixed(2)} cm`);
  // the same on the rendered mesh: most forward vertex near the bust line vs near the underbust
  const P = mesh.positions;
  const zMax = (h: number) => { let z = -1e9; for (let i = 0; i < P.length; i += 3) if (Math.abs(P[i + 1] - h) < 0.6 && Math.abs(P[i]) < 14) z = Math.max(z, P[i + 2]); return z; };
  ok('rendered bust apex forward of the underbust', zMax(f.chestH) - zMax(under) > 2.5, `${(zMax(f.chestH) - zMax(under)).toFixed(2)} cm`);
  let bad = 0; for (const v of P) if (!Number.isFinite(v)) bad++;
  ok('female mesh has only finite vertices', bad === 0 && P.length > 3000);
  const fM = bodyFrame(MALE_BODY);
  const halfW = (fr: typeof f, h: number) => { const r = fr.torsoRing(h); return r.a * Math.max(r.shape(0), r.shape(Math.PI)); };
  ok('female hips wider than her bust', halfW(f, f.hipH) > halfW(f, f.chestH));
  ok('female waist to hip drop deeper than male', b.hips / b.waist > MALE_BODY.hips / MALE_BODY.waist && halfW(f, f.hipH) / halfW(f, f.waistH) > halfW(fM, fM.hipH) / halfW(fM, fM.waistH));
  ok('female arms slimmer than male for the same chest', derivedGirths({ ...MALE_BODY, sex: 'female' }).bicep < derivedGirths(MALE_BODY).bicep);
  const tops = CATALOG.filter((s) => s.family !== 'pants' && s.family !== 'bucket' && s.family !== 'cap');
  ok(`every top drafts at least the bust at the bust line (${tops.length} styles)`, tops.every((s) => fitTable(s.id, makePreset(s.id, b), b).find((r) => r.label === 'Chest')!.garment >= b.chest + 4));
  for (const [name, m] of Object.entries(meshes)) {
    let worst = 0, range = true;
    for (let v = 0; v < m.skinWeight.length / 4; v++) {
      let sum = 0;
      for (let q = 0; q < 4; q++) { sum += m.skinWeight[v * 4 + q]; if (m.skinIndex[v * 4 + q] >= NBONES) range = false; }
      worst = Math.max(worst, Math.abs(sum - 1));
    }
    ok(`${name} skin weights sum to 1 on ${NBONES} bones`, worst < 1e-5 && range, `worst ${worst.toExponential(1)}`);
  }
}

// old saves and new projects
console.log('\n== projects ==');
for (const [old, id] of [['pants', 'jeans'], ['shirt', 'button-up'], ['jacket', 'jacket'], ['nonsense', 'jacket']]) {
  const ok = migrateGarment(old) === id;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} old garment "${old}" opens as ${migrateGarment(old)}`);
}
for (const s of CATALOG) {
  const p = freshProject(s.id);
  const ok = p.garment === s.id && p.pieces.length > 0 && p.pieces[0].fabric.id === styleById(s.id).defaultFabric;
  if (!ok) fails++;
  if (!ok) console.log(`FAIL new project for ${s.id}`);
}
console.log(`ok   new project works for all ${CATALOG.length} styles`);

// ---- built-in seams and garment edits ----
console.log('\n== seams and edits ==');
const pass = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
const SEAM_IDS: Record<string, string[]> = {
  tee: ['shoulder-r', 'shoulder-l', 'side-r', 'side-l', 'underarm-r', 'sleeve-cap-front-r', 'sleeve-cap-back-r', 'underarm-l', 'sleeve-cap-front-l', 'sleeve-cap-back-l', 'neckband-join', 'neckband'],
  shirt: ['shoulder-r', 'shoulder-l', 'side-r', 'side-l', 'underarm-r', 'sleeve-cap-front-r', 'sleeve-cap-back-r', 'underarm-l', 'sleeve-cap-front-l', 'sleeve-cap-back-l', 'cuff-join-r', 'cuff-join-l', 'collar', 'cuff-r', 'cuff-l'],
  jacket: ['shoulder-r', 'shoulder-l', 'side-r', 'side-l', 'underarm-r', 'sleeve-cap-front-r', 'sleeve-cap-back-r', 'underarm-l', 'sleeve-cap-front-l', 'sleeve-cap-back-l', 'collar'],
  pants: ['outseam-r', 'inseam-r', 'outseam-l', 'inseam-l', 'crotch-front', 'crotch-back', 'waistband-join', 'waistband'],
  bucket: ['crown-1', 'crown-2', 'crown-3', 'crown-4', 'crown-5', 'crown-6', 'brim-join', 'brim'],
  cap: ['crown-1', 'crown-2', 'crown-3', 'crown-4', 'crown-5', 'crown-6', 'visor'],
};
const baseline = JSON.parse(readFileSync(new URL('./fixtures/sew-baseline.json', import.meta.url), 'utf8'));
for (const st of CATALOG) {
  const pieces = makePreset(st.id, DEFAULT_BODY);
  const seams = builtinSeams(st.id, pieces);
  const ids = seams.map((q) => q.id);
  const unique = new Set(ids).size === ids.length && seams.every((q) => q.label && q.a.length && q.b.length);
  // the same ids whatever the body or fit: they are stored in a project's detached seams
  const stable = JSON.stringify(builtinSeams(st.id, makePreset(st.id, bodies.big, 'relaxed')).map((q) => q.id)) === JSON.stringify(ids);
  let want = SEAM_IDS[st.family] ?? [];
  if (st.family === 'polo') want = SEAM_IDS.jacket.slice(0, 10).concat(pieces.some((q) => q.role === 'placket') ? ['placket-r', 'placket-l', 'placket-base'] : [], ['collar']);
  if (st.family === 'pants' && pieces.some((q) => q.role === 'cuff')) want = [...want.slice(0, 7), 'cuff-join-r', 'cuff-join-l', 'waistband', 'cuff-r', 'cuff-l'];
  const expected = JSON.stringify(ids) === JSON.stringify(want);
  pass(unique && stable && expected, `${st.id} built-in seams: ${ids.length} unique, stable ids${expected ? '' : ` (got ${ids.join(',')})`}`);
  const sig = sewSignature(st.id, undefined, pieces);
  pass(JSON.stringify(sig) === JSON.stringify(baseline[st.id]), `${st.id} sews exactly as before (${sig.n} sew links, start shape unchanged)`);
}
const pairSet = (G: NonNullable<ReturnType<typeof assemble>>) => { const r = new Set<string>(); for (let c = 0; c < G.sim.ca.length; c++) if (G.sim.rest[c] === 0) r.add(`${G.sim.ca[c]},${G.sim.cb[c]}`); return r; };
const build = (g: string, pieces: ReturnType<typeof makePreset>, edits: Edits) => assemble(g as never, pieces, DEFAULT_BODY, 2.2, NO_COLLIDER, edits)!;
for (const [g, id] of [['basic-tee', 'side-r'], ['button-up', 'cuff-l'], ['jeans', 'inseam-l'], ['polo', 'collar'], ['cap', 'visor'], ['bucket-hat', 'crown-3']] as const) {
  const pieces = makePreset(g, DEFAULT_BODY);
  const full = build(g, pieces, EMPTY_EDITS), cut = build(g, pieces, { ...EMPTY_EDITS, detachedSeams: [id] });
  const A = pairSet(full), B = pairSet(cut), own = new Set(full.seamLinks[id].map(([i, j]) => `${i},${j}`));
  const removed = [...A].filter((k) => !B.has(k));
  const ok = own.size > 0 && [...B].every((k) => A.has(k)) && removed.length === own.size && removed.every((k) => own.has(k)) && !cut.seamLinks[id];
  pass(ok, `${g}: detaching ${id} removes exactly its ${own.size} sew links, nothing else`);
}
{
  // custom seam: close the right half of a tee hem, front to back
  const pieces = makePreset('basic-tee', DEFAULT_BODY);
  const fr = pieces.find((q) => q.role === 'front')!, bk = pieces.find((q) => q.role === 'back')!;
  const id = (p: typeof fr, k: string) => p.points.find((q) => q.key === k)!.id;
  const cs = { id: 'hem', a: { pieceId: fr.id, fromId: id(fr, 'front.8'), toId: id(fr, 'front.7') }, b: { pieceId: bk.id, fromId: id(bk, 'back.8'), toId: id(bk, 'back.7') } };
  for (const flip of [false, true]) {
    const G = build('basic-tee', pieces, { ...EMPTY_EDITS, customSeams: [{ ...cs, flip }] });
    const F = G.panels[0], B = G.panels[1];
    const links = G.seamLinks.hem ?? [];
    const across = links.every(([i, j]) => i >= F.offset && i < F.offset + F.mesh.uv.length && j >= B.offset && j < B.offset + B.mesh.uv.length);
    // first link: centre front meets centre back, or (flipped) the side of the back
    const [i0, j0] = links[0] ?? [0, 0];
    const fx = F.mesh.uv[i0 - F.offset]?.x ?? NaN, bx = B.mesh.uv[j0 - B.offset]?.x ?? NaN;
    const dir = flip ? Math.abs(fx) < 1 && bx > 25 : Math.abs(fx) < 1 && Math.abs(bx) < 1;
    pass(links.length > 10 && across && dir, `custom seam ${flip ? '(flipped) ' : ''}sews front hem to back hem: ${links.length} links, ends matched ${flip ? 'crossed' : 'in order'}`);
  }
  const rep = seamReport('basic-tee', pieces, { ...EMPTY_EDITS, customSeams: [cs], detachedSeams: ['side-r'] });
  const row = rep.find((r) => r.seams?.includes('hem'));
  pass(!!row && Math.abs(row.a - row.b) < 0.05 && !rep.some((r) => r.seams?.includes('side-r')) && rep.some((r) => r.seams?.includes('side-l')), 'seam report lists the custom seam and drops the detached side seam');
}
{
  // pleats: the intake comes off the edge in the seam report, and shows in the piece specs
  const pieces = makePreset('jeans', DEFAULT_BODY);
  const fr = pieces.find((q) => q.role === 'front')!;
  const w0 = fr.points.find((q) => q.key === 'front.0')!;
  const pleated: Edits = { ...EMPTY_EDITS, pleats: [{ id: 'kp', pieceId: fr.id, pointId: w0.id, t: 0.55, depth: 1.5, length: 7, type: 'knife', direction: 1 }] };
  const waist = (e?: Edits) => seamReport('jeans', pieces, e).find((r) => r.label.startsWith('Waist edge'))!;
  check('knife pleat takes 2 x depth per front leg off the waist', waist().a - waist(pleated).a, 2 * 2 * 1.5);
  const box: Edits = { ...pleated, pleats: [{ ...pleated.pleats[0], type: 'box' }] };
  check('box pleat takes 4 x depth per front leg off the waist', waist().a - waist(box).a, 2 * 4 * 1.5);
  check('pleat does not touch the outseam', seamReport('jeans', pieces, pleated)[1].a, seamReport('jeans', pieces)[1].a);
  check('piece spec lists the pleat intake', pieceSpecs(fr, pleated).find((q) => q.label === 'Pleat intake (knife)')?.value ?? 0, 3);
  // drafted wider by the intake, the pleated waist walks with the waistband again
  const wide = makePreset('jeans', DEFAULT_BODY);
  const wf = wide.find((q) => q.role === 'front')!;
  const before = waist().a;
  wf.points.find((q) => q.key === 'front.1')!.x += 3;
  const wr = seamReport('jeans', wide, { ...pleated, pleats: [{ ...pleated.pleats[0], pieceId: wf.id, pointId: wf.points.find((q) => q.key === 'front.0')!.id }] }).find((r) => r.label.startsWith('Waist edge'))!;
  check('front spread by the intake + pleat walks to the original waist', wr.a, before, 0.05);
  // the sim sews the pleat shut at the edge on both legs
  const G = build('jeans', pieces, pleated);
  pass((G.seamLinks['pleat:kp'] ?? []).length === 2, 'pleat is stitched shut on both front legs');
}
{
  // attachments: a pocket on both back legs, a patch, a strap, a print (no cloth)
  const pieces = makePreset('jeans', DEFAULT_BODY);
  const bk = pieces.find((q) => q.role === 'back')!;
  const base = { name: 'x', rotation: 0, layers: [], outline: 'rect' as const, pieceId: bk.id };
  const edits: Edits = { ...EMPTY_EDITS, attachments: [
    { ...base, id: 'pk', kind: 'pocket', name: 'Back pocket', x: 1, y: 13, w: 14, h: 15, outline: 'pointed' },
    { ...base, id: 'st', kind: 'strap', name: 'Belt loop', x: 5, y: 1.5, w: 1.2, h: 5, instance: 1 },
    { ...base, id: 'pr', kind: 'print', name: 'Logo', x: 0, y: 40, w: 6, h: 6, layers: [{ id: 'l', shape: 'star', x: 0, y: 0, w: 5, h: 5, rotation: 0, color: '#fff' }] },
  ] };
  const G = build('jeans', pieces, edits);
  const at = (id: string) => G.panels.filter((q) => q.attach?.id === id);
  const plain = build('jeans', pieces, EMPTY_EDITS);
  pass(at('pk').length === 2 && at('st').length === 1 && at('pr').length === 0 && G.panels.length === plain.panels.length + 3, 'pocket on both back legs, strap on the chosen leg, print adds no cloth');
  pass(JSON.stringify([...pairSet(G)]) === JSON.stringify([...pairSet(plain)]), 'attachments leave the garment seams alone (pinned, not sewn)');
  const sr = seamReport('jeans', pieces, edits);
  pass(sr.some((r) => r.attachment === 'pk' && /3 sides/.test(r.label)) && sr.some((r) => r.attachment === 'st') && !sr.some((r) => r.attachment === 'pr'), 'seam report lists the sewn attachments');
}

// regrade keeps user edits
console.log('\n== regrade ==');
const A = DEFAULT_BODY, B = bodies.big;
const pieces = makePreset('jacket', A);
const front = pieces.find((p) => p.role === 'front')!;
const waist = front.points.find((p) => p.tag === 'waist' && p.x > 0)!;
waist.x -= 3; // user slims the waist by 3 cm on one side
const moved = regradePoints(front.points, draft('jacket', A)[0].points, draft('jacket', B)[0].points);
const target = draft('jacket', B)[0].points.find((p) => p.key === waist.key)!;
check('slimmed waist keeps its -3 cm after regrade', moved.find((p) => p.key === waist.key)!.x, target.x - 3);
const ua = moved.find((p) => p.tag === 'underarm' && p.x > 0)!;
check('chest regrades to new body + ease', 4 * ua.x, B.chest + EASE.jacket.chest);
// every style regrades across bodies and fits with its keys intact
for (const s of CATALOG) {
  const a = draft(s.id, A), c = draft(s.id, B, 'relaxed');
  const ok = a.length === c.length && a.every((p, i) => p.role === c[i].role && p.points.length === c[i].points.length && p.points.every((q, j) => q.key === c[i].points[j].key));
  if (!ok) fails++;
  if (!ok) console.log(`FAIL ${s.id} keys change between bodies or fits`);
}
console.log(`ok   all ${CATALOG.length} styles keep their point keys across bodies and fits`);

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
