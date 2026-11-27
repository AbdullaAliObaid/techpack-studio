// Run: npx tsx tests/accuracy.ts
import { bodyFrame, perimeter, tapePerimeter, DEFAULT_BODY, FEMALE_BODY, MALE_BODY, type Body } from '../src/three/body';
import { NBONES } from '../src/sim/pose';
import { makePreset } from '../src/data/presets';
import { draft, regradePoints, EASE, crownArc, derivedGirths, FITS, RIB, neckBase, isSplitFront } from '../src/data/draft';
import { CATALOG, migrateGarment, styleById } from '../src/data/catalog';
import { freshProject, migrateProject, useStore } from '../src/store';
import { BUILTIN_VERSION, stitchLines } from '../src/data/construction';
import { buildHardware } from '../src/sim/detailsHardware';
import { buildDetails } from '../src/sim/details';
import { INSIDE_ROLES } from '../src/data/presets';
import { computeSpec } from '../src/lib/specs';
import { pointInPoly } from '../src/lib/geometry';
import { fitTable, seamReport } from '../src/lib/specs';
import { calibratedField } from '../src/three/bodyField';
import { meshField } from '../src/three/mesher';
import { hullLength } from '../src/three/body';
import { buildGarment } from '../src/three/garment';
import { samplePoly, sliceSpan } from '../src/lib/geometry';
import { findTag, pieceSpecs } from '../src/lib/specs';
import { readFileSync } from 'node:fs';
import { builtinSeams, faceLabel, faceOf, instanceLabel, visibleFace } from '../src/sim/seams';
import { labelSewing, labelSize } from '../src/data/labels';
import { outwardSignsHosted } from '../src/sim/detailsAttach';
import { piecesToDxf } from '../src/lib/exportDxf';
import { shapePolygon, attachmentPolygons, SHAPE_IDS } from '../src/lib/shapes';
import { attachmentReport, cutList, labelReport, pleatReport, trimsReport } from '../src/lib/specs';
import type { Attachment, Hardware, Label } from '../src/data/edits';
import { assemble, trimWeight, ZIP_TEETH } from '../src/sim/setup';
import { meshPanel, seamPath } from '../src/sim/panels';
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

  const ROLES = new Set(['front', 'back', 'sleeve', 'neckband', 'collar', 'placket', 'cuff', 'waistband', 'crown', 'brim', 'facing', 'pocketFacing', 'pocketBag', 'flyFacing', 'flyShield']);
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
    // a split front (cut twice) goes round the body as twice centre front to side; the overlap is not ease
    const wf = (y: number) => { const s = sliceSpan(fp, y); return !s ? 0 : isSplitFront(front) ? 2 * Math.max(0, s.x2) : s.x2 - s.x1; };
    if (fam !== 'pants') {
      const ua = findTag(front, 'underarm')!.y - findTag(front, 'hps')!.y;
      const h = f.neckH - ua;
      const torso = res.parts.find((p) => p.key === 'torso')!;
      const ring = torso.rings.reduce((a, r) => (Math.abs(r.y - h) < Math.abs(a.y - h) ? r : a));
      check(`${g} 3D chest ring = pattern chest`, perimeter(ring.a, ring.b, ring.shape, 720), wf(findTag(front, 'underarm')!.y) + w(bp, findTag(back, 'underarm')!.y), 0.3);
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
  if (st.family === 'polo') want = SEAM_IDS.jacket.slice(0, 10).concat(pieces.some((q) => q.role === 'placket') ? ['placket-r', 'placket-l', 'placket-base', 'placket-base-l'] : [], ['collar']);
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

// ---- left / right copies, appliques, embroidery, hardware ----
console.log('\n== left / right, appliques, hardware ==');
{
  const area = (r: { x: number; y: number }[]) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p.x * q.y - q.x * p.y; }, 0) / 2);
  const rings = SHAPE_IDS.filter((s) => s !== 'text' && s !== 'path').map((s) => [s, shapePolygon(s, 10, 10)] as const);
  pass(rings.every(([, r]) => r.length === 1 && r[0].length >= 3 && area(r[0]) > 10), `every shape cuts as one outer ring (${rings.map(([s, r]) => `${s} ${r[0]?.length}`).join(', ')})`);
  check('circle cut area (holes ignored, ring = circle)', area(shapePolygon('ring', 10, 10)[0]), Math.PI * 25, 1.5);
  const txt = shapePolygon('text', 30, 8, 'Hi 2!');
  pass(txt.length === 3 && txt.every((r) => r.length >= 4) && txt[0][0].x < txt[2][0].x, `text applique: one piece per letter, in reading order (${txt.length} pieces for "Hi 2!")`);
  pass(txt.every((r) => r.every((q) => Math.abs(q.x) <= 15 + 1e-6 && Math.abs(q.y) <= 4 + 1e-6)), 'text letters stay inside the applique box');
}
{
  const pieces = makePreset('jeans', DEFAULT_BODY);
  const fr = pieces.find((q) => q.role === 'front')!, bk = pieces.find((q) => q.role === 'back')!;
  pass(instanceLabel('jeans', bk, 0) === 'Left back leg' && instanceLabel('jeans', bk, 1) === 'Right back leg' && instanceLabel('jeans', bk) === 'Both back legs'
    && instanceLabel('cap', makePreset('cap', DEFAULT_BODY)[0], 2) === 'Crown panel 3' && instanceLabel('basic-tee', makePreset('basic-tee', DEFAULT_BODY)[0], 0) === 'Front',
  `instanceLabel: ${instanceLabel('jeans', bk, 0)}, ${instanceLabel('jeans', bk, 1)}, ${instanceLabel('jeans', bk)}, ${instanceLabel('cap', makePreset('cap', DEFAULT_BODY)[0], 2)}`);
  const base = { rotation: 0, layers: [], outline: 'rect' as const };
  const A = (o: Partial<Attachment> & Pick<Attachment, 'id' | 'kind'>): Attachment => ({ ...base, name: o.id, pieceId: bk.id, x: 1, y: 13, w: 10, h: 6, ...o });
  const edits: Edits = { ...EMPTY_EDITS, attachments: [
    A({ id: 'ap', kind: 'applique', outline: 'shape', shape: 'text', text: 'AB', w: 10, h: 5 }),
    A({ id: 'apR', kind: 'applique', outline: 'shape', shape: 'star', instance: 0, y: 25 }),
    A({ id: 'em', kind: 'embroidery', thread: '#c00', y: 30 }),
    A({ id: 'rv', kind: 'hardware', x: 8, y: 2, w: 1, h: 1, hardware: { type: 'rivet', finish: 'copper', size: 0.9, count: 2, spacing: 2 } }),
  ], pleats: [{ id: 'kp', pieceId: fr.id, pointId: fr.points.find((q) => q.key === 'front.0')!.id, t: 0.55, depth: 1.5, length: 7, type: 'knife', direction: 1, instance: 1 }] };
  const G = build('jeans', pieces, edits);
  const plain = build('jeans', pieces, EMPTY_EDITS);
  const at = (id: string) => G.panels.filter((q) => q.attach?.id === id);
  pass(at('ap').length === 4 && at('apR').length === 1 && G.panels[at('apR')[0].attach!.host].instance === 0 && at('em').length === 0 && at('rv').length === 0,
    `applique text: a piece per letter on both legs (${at('ap').length}), star only on the right leg, embroidery and rivets add no cloth`);
  pass((G.seamLinks['pleat:kp'] ?? []).length === 1, 'pleat with instance 1 is folded on the left front leg only');
  // rivets weigh the cloth under them: heavier host particles
  const heavier = Array.from(G.sim.invMass).filter((v, i) => i < plain.sim.n && v < plain.sim.invMass[i] - 1e-6).length;
  pass(heavier > 0 && heavier < 40, `rivets add weight to ${heavier} back leg particles`);
  // left copy: placement mirrored, letters not flipped (A on the left leg sits where the mirror of B on the right leg is)
  const ctr = (P: (typeof G.panels)[number]) => { const c = [0, 0, 0]; for (let i = 0; i < P.mesh.uv.length; i++) for (let k = 0; k < 3; k++) c[k] += G.sim.pos[(P.offset + i) * 3 + k] / P.mesh.uv.length; return c; };
  const ap = at('ap'), onR = ap.filter((P) => G.panels[P.attach!.host].instance === 0), onL = ap.filter((P) => G.panels[P.attach!.host].instance === 1);
  const a1 = ctr(onL[0]), b0 = ctr(onR[1]);
  const off = Math.hypot(a1[0] + b0[0], a1[1] - b0[1], a1[2] - b0[2]);
  pass(onR.length === 2 && onL.length === 2 && off < 1 && ap.every((P) => !P.mirror), `left leg applique is the mirror placement with letters reading the right way (A left vs mirrored B right: ${off.toFixed(2)} cm)`);
  // specs: sides, trims, cut list
  const rows = attachmentReport(pieces, edits, 'jeans');
  pass(rows.find((r) => r.id === 'apR')?.side === 'Left back leg' && rows.find((r) => r.id === 'ap')?.side === 'Both back legs' && rows.find((r) => r.id === 'ap')?.cutPieces === 2, 'attachment report names the side and counts letter pieces');
  const trims = trimsReport(pieces, edits, 'jeans');
  const rv = trims.find((t) => t.item === 'Rivet'), em = trims.find((t) => t.item === 'Embroidery'), apT = trims.filter((t) => t.item === 'Applique');
  pass(!!rv && rv.qty === 4 && /Copper, 9 mm/.test(rv.detail) && rv.placement === 'Both back legs' && !!em && /#c00/.test(em.detail) && apT.length === 2, `trims list: ${trims.map((t) => `${t.qty} x ${t.item} (${t.detail}; ${t.placement})`).join(' | ')}`);
  const cl = cutList(pieces, edits, 'jeans');
  pass(cl.some((r) => r.name === 'ap' && r.cut === 4) && cl.some((r) => r.name === 'apR' && r.cut === 1) && !cl.some((r) => r.name === 'em' || r.name === 'rv'), 'cut list includes the applique pieces (2 letters x 2 legs), not embroidery or rivets');
  pass(pleatReport(pieces, edits, 'jeans')[0]?.side === 'Right front leg', 'pleat report names the side');
  pass(seamReport('jeans', pieces, edits).every((r) => r.attachment !== 'em' && r.attachment !== 'rv'), 'embroidery and rivets are not seams');
}
{
  // zips: a closed zip stiffens the cloth, an open zip on a seam leaves that stretch unsewn
  const pieces = makePreset('jeans', DEFAULT_BODY);
  const fr = pieces.find((q) => q.role === 'front')!;
  // along the right outseam: two edge points of the meshed front leg, 3 and 10 edge steps below the waist
  const m = meshPanel(fr.points, 2.2), path = seamPath(m, fr.points.find((q) => q.key === 'front.1')!.id, fr.points.find((q) => q.key === 'front.5')!.id);
  const e0 = m.uv[path[3]], e1 = m.uv[path[10]];
  const L = Math.hypot(e1.x - e0.x, e1.y - e0.y), ang = (Math.atan2(e1.y - e0.y, e1.x - e0.x) * 180) / Math.PI - 90;
  const zip = (open: boolean): Edits => ({ ...EMPTY_EDITS, attachments: [{ id: 'z', kind: 'hardware', name: 'Side zip', pieceId: fr.id, x: (e0.x + e1.x) / 2, y: (e0.y + e1.y) / 2, rotation: ang, w: 1, h: L, outline: 'rect', layers: [], instance: 0, hardware: { type: 'zipper', finish: 'silver', size: 1, open } }] });
  const plain = build('jeans', pieces, EMPTY_EDITS), closed = build('jeans', pieces, zip(false)), opened = build('jeans', pieces, zip(true));
  const n = (G: typeof plain, id: string) => (G.seamLinks[id] ?? []).length;
  pass(n(closed, 'outseam-r') === n(plain, 'outseam-r') && closed.sim.ca.length > plain.sim.ca.length, `closed zip keeps the seam and stiffens the cloth (+${closed.sim.ca.length - plain.sim.ca.length} links)`);
  pass(n(opened, 'outseam-r') < n(plain, 'outseam-r') - 4 && n(opened, 'outseam-l') === n(plain, 'outseam-l'), `open zip on the right outseam opens it (${n(plain, 'outseam-r')} -> ${n(opened, 'outseam-r')} links), left outseam untouched`);
}
{
  // user patch piece cut twice with a chosen side, and a sewn user piece cut twice (copy i on host copy i)
  const pieces = makePreset('basic-tee', DEFAULT_BODY);
  const sleeve = pieces.find((p) => p.role === 'sleeve')!;
  const pt = (id: string, x: number, y: number) => ({ id, x, y, smooth: false, mirror: null });
  const patch = { id: 'up1', name: 'Elbow patch', role: 'custom' as const, cut: 2, offset: { x: 0, y: 0 }, symmetric: false, fabric: sleeve.fabric, specs: [],
    points: [pt('a', 0, 0), pt('b', 6, 0), pt('c', 6, 5), pt('d', 0, 5)], placement: { mode: 'patch' as const, hostPieceId: sleeve.id, x: 0, y: 12, rotation: 0, instance: 1 } };
  const G = build('basic-tee', [...pieces, patch], EMPTY_EDITS);
  const on = G.panels.filter((p) => p.attach?.id === 'up1');
  pass(on.length === 1 && G.panels[on[0].attach!.host].instance === 1, 'user patch with placement instance 1 goes on the left sleeve only');
  const hem = { id: 'up2', name: 'Cuff band', role: 'custom' as const, cut: 2, offset: { x: 0, y: 0 }, symmetric: false, fabric: sleeve.fabric, specs: [],
    points: [pt('e', 0, 0), pt('f', 20, 0), pt('g', 20, 4), pt('h', 0, 4)], placement: { mode: 'sewn' as const } };
  const t3 = sleeve.points.find((q) => q.key === 'sleeve.4')!.id, t4 = sleeve.points.find((q) => q.key === 'sleeve.4m')!.id;
  const G2 = build('basic-tee', [...pieces, hem], { ...EMPTY_EDITS, customSeams: [{ id: 'cb', a: { pieceId: 'up2', fromId: 'e', toId: 'f' }, b: { pieceId: sleeve.id, fromId: t3, toId: t4 } }] });
  const copies = G2.panels.filter((p) => p.piece.id === 'up2');
  pass(copies.length === 2 && copies[1].mirror && copies[1].instance === 1, `sewn user piece cut twice: ${copies.length} copies, the second mirrored on the left sleeve`);
}
{
  // store: a new attachment on a piece cut twice goes on the right side unless chosen; old saves keep "every copy"
  const st = useStore.getState();
  st.newProject?.('jeans' as never);
  const bk = useStore.getState().project.pieces.find((p) => p.role === 'back');
  if (bk) {
    const id = useStore.getState().addAttachment({ kind: 'patch', name: 'p', pieceId: bk.id, x: 0, y: 10, rotation: 0, w: 5, h: 5, outline: 'rect', layers: [] } as never);
    const a = useStore.getState().project.edits?.attachments.find((q) => q.id === id);
    pass(a?.instance === 0, 'store: new attachment on a piece cut twice defaults to the right side (instance 0)');
  } else pass(false, 'store: jeans project has a back leg');
}

// ---- collar up / down, faces, labels, drawn buttons and zips ----
console.log('\n== collar, faces, labels, trims ==');
{
  const E2 = (e: Partial<Edits>): Edits => ({ ...EMPTY_EDITS, ...e });
  for (const st of ['polo', 'collared-tee', 'button-up', 'jacket']) {
    const pieces = makePreset(st as never, DEFAULT_BODY);
    const def = sewSignature(st, undefined, pieces), down = sewSignature(st, E2({ collar: 'down' }), pieces), up = sewSignature(st, E2({ collar: 'up' }), pieces);
    // no collar option (old saves): exactly as before, see the sew snapshot above; down and up sew the same, arranged apart
    pass(up.sew === down.sew && up.n === down.n && up.pos !== down.pos && down.pos !== def.pos, `${st}: collar down and up sew the same (${down.n} links) and only arrange the collar differently`);
  }
  {
    // the polo collar runs round the neck on both sides (it used to run down the placket opening on one side)
    const pieces = makePreset('polo', DEFAULT_BODY);
    const slitOf = (e: Edits) => {
      const G = build('polo', pieces, e);
      const front = G.panels.find((p) => p.piece.role === 'front')!;
      return (G.seamLinks.collar ?? []).filter(([, j]) => j >= front.offset && j < front.offset + front.mesh.uv.length && front.mesh.uv[j - front.offset].y > 12).length;
    };
    const legacy = slitOf(EMPTY_EDITS), down = slitOf(E2({ collar: 'down' }));
    pass(down === 0 && legacy > 0, `polo collar with the collar option is sewn to the neckline only (old saves: ${legacy} links down the placket opening, kept bit for bit)`);
  }
  {
    // faces: named for the UI, collar top / under, and which one shows in each state
    const pieces = makePreset('button-up', DEFAULT_BODY);
    const collar = pieces.find((p) => p.role === 'collar')!, front = pieces.find((p) => p.role === 'front')!;
    const vf = visibleFace('button-up', collar), vb = visibleFace('button-up', front);
    pass(vf.down === 'outside' && vf.up === 'inside' && vb.down === 'outside' && vb.up === 'outside', 'visibleFace: collar down shows the top collar, up shows the under collar; body pieces always outside');
    const polo = makePreset('polo', DEFAULT_BODY), placket = polo.find((p) => p.role === 'placket')!;
    const jk = makePreset('jacket', DEFAULT_BODY);
    pass(faceLabel('button-up', collar, 'outside') === 'Top collar' && faceLabel('button-up', collar, 'inside') === 'Under collar' && faceLabel('polo', placket, 'inside') === 'Placket facing'
      && faceLabel('jacket', jk[0], 'inside') === 'Lining side' && faceLabel('basic-tee', front, 'outside') === 'Outside' && faceLabel('basic-tee', front, 'inside') === 'Inside',
    'faceLabel: Top collar, Under collar, Placket facing, Lining side, Outside, Inside');
    // the 'built' panelSign: the setup's sides agree with the old vote on every plain panel of every style
    let bad = 0, n = 0;
    for (const s2 of CATALOG) {
      const G = build(s2.id, makePreset(s2.id, DEFAULT_BODY), EMPTY_EDITS);
      const old = outwardSignsHosted(G.panels, G.sim.pos);
      G.panels.forEach((P, k) => { if (P.piece.role === 'collar') return; n++; if (old[k] !== G.panelSign[k]) bad++; });
    }
    pass(bad === 0, `panelSign matches the outward vote on all ${n} plain panels of every style, mirrored copies included`);
    // collar: the top collar faces the neck on the stand, in both states
    for (const cs of ['down', 'up'] as const) {
      const G = build('button-up', pieces, E2({ collar: cs }));
      const k = G.panels.findIndex((P) => P.piece.role === 'collar'), P = G.panels[k], pos = G.sim.pos;
      let vote = 0;
      for (let t = 0; t < P.mesh.tris.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((e) => (P.offset + P.mesh.tris[t + e]) * 3);
        if (Math.max(...[0, 1, 2].map((e) => P.mesh.uv[P.mesh.tris[t + e]].y)) > 2) continue;
        const u = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]], v = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
        const nx = u[1] * v[2] - u[2] * v[1], nz = u[0] * v[1] - u[1] * v[0];
        vote += (nx * pos[a] + nz * pos[a + 2]) * G.panelSign[k] < 0 ? 1 : -1;
      }
      pass(vote > 0, `collar ${cs}: panelSign points at the top collar (faces the neck on the stand, ${vote} triangle vote)`);
    }
  }
  {
    // an inside patch starts between the host and the body, an outside one over the host
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const mk = (face: 'inside' | 'outside'): Attachment => ({ id: face, kind: 'patch', name: 'p', pieceId: back.id, x: 0, y: 22, rotation: 0, w: 8, h: 8, outline: 'rect', layers: [], face });
    const G = build('basic-tee', pieces, E2({ attachments: [mk('inside'), mk('outside')] }));
    const hostP = G.panels.find((p) => p.piece.id === back.id && !p.attach)!;
    const zOf = (P: (typeof G.panels)[number]) => { let z = 0; for (let i = 0; i < P.mesh.uv.length; i++) z += G.sim.pos[(P.offset + i) * 3 + 2]; return z / P.mesh.uv.length; };
    const hostZ = (() => { let z = 0, n = 0; hostP.mesh.uv.forEach((q, i) => { if (Math.abs(q.x) < 4 && Math.abs(q.y - 22) < 4) { z += G.sim.pos[(hostP.offset + i) * 3 + 2]; n++; } }); return z / n; })();
    const ins = G.panels.find((p) => p.attach?.id === 'inside')!, out = G.panels.find((p) => p.attach?.id === 'outside')!;
    // the back faces -z: inside is towards the body (larger z), outside away (smaller z)
    pass(zOf(ins) > hostZ && zOf(out) < hostZ && ins.attach!.face === 'inside' && out.attach!.face === 'outside', `inside patch starts under the back (${(zOf(ins) - hostZ).toFixed(2)} cm in), outside patch over it (${(hostZ - zOf(out)).toFixed(2)} cm out)`);
    // show face (panelSign side) of each: the inside patch faces the body (+z here), the outside one faces out (-z)
    const showZ = (P: (typeof G.panels)[number]) => {
      const k = G.panels.indexOf(P), pos = G.sim.pos;
      let nz = 0;
      for (let t = 0; t < P.mesh.tris.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((e) => (P.offset + P.mesh.tris[t + e]) * 3);
        nz += (pos[b] - pos[a]) * (pos[c + 1] - pos[a + 1]) - (pos[b + 1] - pos[a + 1]) * (pos[c] - pos[a]);
      }
      return nz * G.panelSign[k];
    };
    pass(showZ(ins) > 0 && showZ(out) < 0, 'attachment panelSign: the inside patch shows towards the body, the outside one away from it');
  }
  {
    // labels: default size and face, sewing by method, BOM / cut list / DXF
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const tag = (id: string, type: Label['type'], sewn: Label['sewn'], y: number, extra: Partial<Attachment> = {}): Attachment => ({ id, kind: 'label', name: `Tag ${id}`, pieceId: back.id, x: 0, y, rotation: 0, w: 0, h: 0, outline: 'rect', layers: [], label: { type, sewn, color: '#111111' }, ...extra });
    const near = tag('n', 'woven', 'folded-loop', 3.4), far = tag('f', 'woven', 'folded-loop', 12), lea = tag('l', 'leather', 'all-round', 30, { w: 6, h: 4 });
    const sw = labelSewing({ ...near, ...labelSize(near) }, back), sf = labelSewing({ ...far, ...labelSize(far) }, back);
    pass(labelSize(near).w === 5 && labelSize(near).h === 2.5 && faceOf(near) === 'inside' && faceOf({ kind: 'patch' }) === 'outside', 'tag: 5 x 2.5 cm and inside by default, other attachments outside');
    pass(sw.method === 'loop' && sw.open!.dir.y === -1 && sw.cut.h === 5 && sf.method === 'ends', `folded loop near the back neck is caught in the seam (open end up, cut ${sw.cut.w} x ${sw.cut.h} cm); far from a seam it is sewn at both ends`);
    const edits = E2({ attachments: [near, far, lea] });
    const rows = labelReport(pieces, edits, 'basic-tee');
    const rn = rows.find((r) => r.id === 'n')!;
    pass(/neckband seam/.test(rn.sewn) && rn.placement === 'Back, inside' && rows.find((r) => r.id === 'l')!.purchased, `label report: "${rn.sewn}", "${rn.placement}", leather is bought finished`);
    const trims = trimsReport(pieces, edits, 'basic-tee').filter((t) => t.kind === 'label');
    pass(trims.length === 3 && trims.some((t) => /leather/.test(t.item) && /bought finished/.test(t.detail)), `BOM lists 3 labels: ${trims.map((t) => t.item).join(', ')}`);
    const cuts = cutList(pieces, edits, 'basic-tee');
    pass(cuts.some((c) => c.name === 'Tag n' && /cut 5 x 5 cm/.test(c.note ?? '')) && !cuts.some((c) => c.name === 'Tag l'), 'cut list: woven tags are cut (the loop twice as long), the leather tag is not');
    const dxf = piecesToDxf(pieces, { project: 't', size: 'M' }, 1, edits, 'basic-tee');
    pass(dxf.includes('TAG N LABEL') && !dxf.includes('TAG L LABEL') && dxf.includes('BOUGHT TRIM'), 'DXF: woven tags are cut pieces, the leather one is a placement mark for a bought trim');
    const G = build('basic-tee', pieces, edits);
    const tp = G.panels.filter((p) => p.attach?.kind === 'label');
    pass(tp.length === 3 && tp.every((p) => p.attach!.face === 'inside'), `${tp.length} tag panels in the sim, all on the inside`);
    const sn = attachmentReport(pieces, edits, 'basic-tee');
    pass(sn.find((r) => r.id === 'n')!.sewnLength === 5 && Math.abs(sn.find((r) => r.id === 'f')!.sewnLength - 5) < 1e-6, 'tag stitching length: the loop is caught along its 5 cm open end, ends-sewn: two 2.5 cm ends');
  }
  {
    // drawn buttons and designed zips: weight and BOM
    const round = trimWeight({ type: 'button', finish: 'silver', size: 1.8 });
    const sq = (s2: number) => [{ x: -s2, y: -s2 }, { x: s2, y: -s2 }, { x: s2, y: s2 }, { x: -s2, y: s2 }];
    const big = trimWeight({ type: 'button', finish: 'silver', size: 1.8, outline: sq(1.4) }), plastic = trimWeight({ type: 'button', finish: 'black', size: 1.8 });
    pass(big.grams > round.grams * 1.5 && big.radius > 1.9 && plastic.grams < round.grams, `drawn 2.8 cm square button ${big.grams.toFixed(2)} g vs round 18 mm ${round.grams.toFixed(2)} g, plastic ${plastic.grams.toFixed(2)} g`);
    pass(ZIP_TEETH.metal.grams > ZIP_TEETH.molded.grams && ZIP_TEETH.molded.grams > ZIP_TEETH.coil.grams && ZIP_TEETH.metal.compliance < ZIP_TEETH.coil.compliance, 'zip teeth: metal heavier and stiffer than moulded, moulded than coil');
    const pieces = makePreset('jacket', DEFAULT_BODY);
    const fr = pieces.find((p) => p.role === 'front')!;
    const hw = (id: string, h: Hardware, extra: Partial<Attachment> = {}): Attachment => ({ id, kind: 'hardware', name: id, pieceId: fr.id, x: 5, y: 30, rotation: 0, w: 1, h: 20, outline: 'rect', layers: [], hardware: h, ...extra });
    const edits = E2({ attachments: [
      hw('b1', { type: 'button', finish: 'brass', size: 2, outline: sq(1), holes: 2, sheen: 'glossy', layers: [{ id: 'l', shape: 'star', x: 0, y: 0, w: 1, h: 1, rotation: 0, color: '#000' }] }),
      hw('b2', { type: 'button', finish: 'white', size: 1.5, holes: 'shank', color: '#ff0000' }),
      hw('z1', { type: 'zipper', finish: 'gunmetal', size: 1, zipper: { teeth: 'coil', tape: '#222222', teethColor: '#ffffff', puller: 'ring' } }),
    ] });
    const t = trimsReport(pieces, edits, 'jacket');
    const d = (id: string) => t.find((r) => r.detail && edits.attachments.find((a) => a.id === id) && r.item === (id[0] === 'z' ? 'Zip' : 'Button') && (id === 'b1' ? /custom/.test(r.detail) : id === 'b2' ? /shank/.test(r.detail) : true))?.detail ?? '';
    pass(/custom drawn shape/.test(d('b1')) && /Brass/.test(d('b1')) && /glossy/.test(d('b1')) && /2 hole/.test(d('b1')) && /artwork 1 layer/.test(d('b1')), `drawn button BOM: ${d('b1')}`);
    pass(/round/.test(d('b2')) && /white plastic/.test(d('b2')) && /colour #ff0000/.test(d('b2')) && /shank/.test(d('b2')) && /matte/.test(d('b2')), `plastic button BOM: ${d('b2')}`);
    pass(/Nylon coil #ffffff/.test(d('z1')) && /tape #222222/.test(d('z1')) && /ring puller/.test(d('z1')), `zip BOM: ${d('z1')}`);
    const plain = build('jacket', pieces, E2({ attachments: [hw('z', { type: 'zipper', finish: 'silver', size: 1, zipper: { teeth: 'metal', tape: '#000', puller: 'standard' } })] }));
    const coil = build('jacket', pieces, E2({ attachments: [hw('z', { type: 'zipper', finish: 'silver', size: 1, zipper: { teeth: 'coil', tape: '#000', puller: 'standard' } })] }));
    const massOf = (G: typeof plain) => { let m = 0; for (let i = 0; i < G.sim.n; i++) m += 1 / G.sim.invMass[i]; return m; };
    pass(massOf(plain) > massOf(coil), `metal zip weighs the front down more than a coil zip (${(massOf(plain) - massOf(coil)).toFixed(3)} mass units)`);
  }
  {
    // inside fabric shows in the cut list
    const pieces = makePreset('button-up', DEFAULT_BODY);
    const collar = pieces.find((p) => p.role === 'collar')!;
    const rows = cutList(pieces, E2({ insideFabric: { [collar.id]: { id: 'denim', color: 0 } } }), 'button-up');
    const r = rows.find((q) => q.name === collar.name)!;
    pass(r.note === 'Inside: Denim, Indigo (under collar)', `cut list: ${r.name} "${r.note}"`);
  }
}

// ---- construction on the pattern: split fronts, buttons and buttonholes, style details as attachments ----
console.log('\n== construction on the pattern ==');
{
  const count = (as: Attachment[], f: (a: Attachment) => boolean) => as.filter(f).reduce((n, a) => n + (a.hardware?.count ?? 1), 0);
  for (const s2 of CATALOG) {
    const p = freshProject(s2.id);
    const as = p.edits?.attachments ?? [];
    const btn = count(as, (a) => a.hardware?.type === 'button' && !a.buttonhole), holes = count(as, (a) => !!a.buttonhole);
    const want = s2.details.buttons ?? 0;
    const holesWant = s2.family === 'cap' ? 0 : want;
    const loops = as.filter((a) => a.kind === 'strap').length, rivets = count(as, (a) => a.hardware?.type === 'rivet');
    const ok = p.edits?.builtin === BUILTIN_VERSION && as.every((a) => a.builtin) && btn === want && holes === holesWant
      && loops === (s2.details.beltLoops ?? 0) && rivets === (s2.details.rivets ? 4 : 0);
    pass(ok, `${s2.id}: style details on the pattern: ${btn} buttons, ${holes} buttonholes, ${loops} belt loops, ${rivets} rivets, ${as.length} in all`);
  }
  {
    // jacket and shirt: split fronts, buttons on the front that goes under, buttonholes on the one that laps over
    for (const [sex, over] of [['male', 1], ['female', 0]] as const) {
      const body = sex === 'female' ? FEMALE_BODY : MALE_BODY;
      const p = freshProject('jacket', undefined, body);
      const fr = p.pieces.find((q) => q.role === 'front')!;
      const b = p.edits!.attachments.find((a) => a.name === 'Front buttons')!, h = p.edits!.attachments.find((a) => a.buttonhole)!;
      pass(isSplitFront(fr) && fr.cut === 2 && b.instance === 1 - over && h.instance === over && b.x === 0 && h.x === 0 && b.pieceId === fr.id,
        `${sex} jacket: fronts split (cut 2), buttons on the ${instanceLabel('jacket', fr, b.instance).toLowerCase()}, buttonholes on the ${instanceLabel('jacket', fr, h.instance).toLowerCase()} (laps over)`);
    }
    const pieces = makePreset('jacket', DEFAULT_BODY);
    const fr = pieces.find((q) => q.role === 'front')!, bk = pieces.find((q) => q.role === 'back')!;
    const span = sliceSpan(samplePoly(fr.points), findTag(fr, 'underarm')!.y)!;
    check('jacket front runs past centre front by the extension', -span.x1, EASE.jacket.buttonExt, 0.01);
    const chest = fitTable('jacket', pieces, DEFAULT_BODY).find((r) => r.label === 'Chest')!.garment;
    check('jacket chest = 2 x (centre front to side) + back, overlap left out', chest, 2 * span.x2 + (sliceSpan(samplePoly(bk.points), findTag(bk, 'underarm')!.y)!.x2 - sliceSpan(samplePoly(bk.points), findTag(bk, 'underarm')!.y)!.x1), 0.05);
    check('button-up extension (each front past centre front)', computeSpec(makePreset('button-up', DEFAULT_BODY)[0], { label: 'x', kind: 'dist', tags: ['cfNeck', 'edgeNeck'] })!.value, EASE['button-up'].buttonExt, 0.01);
    const fc = pieces.find((q) => q.role === 'facing')!;
    pass(!!fc && fc.cut === 2 && seamReport('jacket', pieces).some((r) => /Front facing/.test(r.label) && Math.abs(r.a - r.b) < 0.01), 'jacket front facing is cut 2 and walks to the front edge');
  }
  {
    // the sim: the fronts are held only by their buttons; worn open nothing buttons
    const p = freshProject('jacket');
    const G = build('jacket', p.pieces, p.edits!);
    const fasten = Object.entries(G.seamLinks).filter(([k]) => k.startsWith('fasten:'));
    const links = fasten.reduce((n, [, l]) => n + l.length, 0);
    const fronts = G.panels.filter((q) => q.piece.role === 'front' && !q.attach);
    const frontSew = Object.entries(G.seamLinks).filter(([k]) => !k.startsWith('fasten:')).some(([, l]) => l.some(([i, j]) => fronts.every((F) => [i, j].some((v) => v >= F.offset && v < F.offset + F.mesh.uv.length))));
    pass(fronts.length === 2 && links === 5 && G.buttoned.length === 5 && !frontSew, `jacket: 2 fronts, joined only by ${links} buttons through their buttonholes, no seam between them`);
    const Go = build('jacket', p.pieces, { ...p.edits!, closure: 'open' });
    pass(!Object.keys(Go.seamLinks).some((k) => k.startsWith('fasten:')) && Go.buttoned.length === 0, 'jacket worn open: nothing buttons');
    const hm = buildHardware(G, p.edits!.attachments, Array.from(G.panelSign));
    const O = fronts.find((F) => F.instance === 1)!;
    const onOver = Array.from({ length: hm.count }, (_, i) => hm.tri[i * 3]).filter((v) => v >= O.offset && v < O.offset + O.mesh.uv.length).length;
    pass(hm.count === 5 && onOver === 5, `buttoned: the ${hm.count} buttons draw on the front that laps over (${onOver}), the holes under them do not draw twice`);
    const hmo = buildHardware(Go, p.edits!.attachments, Array.from(Go.panelSign));
    pass(hmo.count === 5 && Array.from({ length: hmo.count }, (_, i) => hmo.tri[i * 3]).every((v) => !(v >= O.offset && v < O.offset + O.mesh.uv.length)), 'worn open: the buttons draw on the front they are sewn to');
    const det = buildDetails(G, styleById('jacket').details);
    pass(det.anchorCount === 0, `3D details add no buttons, rivets or loops of their own (${det.anchorCount} anchors)`);
    const t = trimsReport(p.pieces, p.edits, 'jacket');
    const tb = t.find((r) => r.item === 'Button'), th = t.find((r) => r.item === 'Buttonhole');
    pass(tb?.qty === 5 && th?.qty === 5 && th.kind === 'buttonhole' && tb.placement === 'Left front' && th.placement === 'Right front', `trims: ${tb?.qty} x Button (${tb?.placement}), ${th?.qty} x Buttonhole (${th?.placement}, ${th?.detail})`);
    const massB = (q: typeof G) => { let m = 0; for (let i = 0; i < q.sim.n; i++) m += 1 / q.sim.invMass[i]; return m; };
    const noHoles = build('jacket', p.pieces, { ...p.edits!, attachments: p.edits!.attachments.filter((a) => !a.buttonhole) });
    check('buttonholes add no weight', massB(G), massB(noHoles), 1e-3);
  }
  {
    // polo: two placket strips that button; jeans: pocket and fly pieces in the cut list, details on the pattern
    const polo = freshProject('polo');
    const G = build('polo', polo.pieces, polo.edits!);
    pass(G.panels.filter((q) => q.piece.role === 'placket').length === 2 && G.buttoned.length === 2, `polo: 2 placket strips, ${G.buttoned.length} buttons buttoned`);
    const jeans = freshProject('jeans');
    const cl = cutList(jeans.pieces, jeans.edits, 'jeans').map((r) => r.name);
    pass(['Pocket facing', 'Pocket bag', 'Fly facing', 'Fly shield', 'Back pocket', 'Coin pocket', 'Belt loop'].every((n) => cl.includes(n)), `jeans cut list: ${cl.join(', ')}`);
    const lines = stitchLines('jeans', jeans.pieces, jeans.edits);
    const kinds = new Set(lines.map((l) => l.kind));
    pass(['topstitch', 'hem', 'opening', 'pocket', 'fly'].every((k) => kinds.has(k as never)), `jeans stitch lines: ${[...kinds].join(', ')}`);
    // every stitch row lies on its piece
    let bad = 0, all = 0;
    for (const s2 of CATALOG) {
      const pcs = makePreset(s2.id, DEFAULT_BODY);
      for (const l of stitchLines(s2.id, pcs)) {
        const pc = pcs.find((q) => q.id === l.pieceId)!, poly = samplePoly(pc.points, 12);
        all++;
        if (l.points.filter((q) => pointInPoly(poly, q)).length < 0.8 * l.points.length) bad++;
      }
    }
    pass(bad === 0 && all > 50, `every stitch row of every style lies on its piece (${all} rows, ${bad} off)`);
    const hidden = build('jeans', jeans.pieces, jeans.edits!);
    pass(!hidden.panels.some((q) => INSIDE_ROLES.has(q.piece.role)), 'inside pieces (facings, pocket bags, fly pieces) are not simulated');
  }
  {
    // old saves: a closed jacket front becomes split fronts; its edits on the right half move to the right front
    const p = freshProject('jacket');
    const fr = p.pieces.find((q) => q.role === 'front')!;
    const base = fr.points.filter((q) => !q.key?.startsWith('front.ext')).map((q) => ({ ...q }));
    const right = base.slice(1, -1).reverse().map((q) => ({ ...q, id: q.id + 'm', key: q.key + 'm', x: -q.x }));
    const old = { ...fr, cut: 1, points: [...base, ...right] };
    const k = (key: string) => old.points.find((q) => q.key === key)!.id;
    const legacy = { ...p, pieces: p.pieces.filter((q) => q.role !== 'facing').map((q) => (q.id === fr.id ? old : q)), edits: {
      ...EMPTY_EDITS, attachments: [{ id: 'pk', kind: 'pocket' as const, name: 'Pocket', pieceId: fr.id, x: -12, y: 45, rotation: 0, w: 14, h: 15, outline: 'rect' as const, layers: [] }],
      customSeams: [{ id: 'cs', a: { pieceId: fr.id, fromId: k('front.5m'), toId: k('front.7m') }, b: { pieceId: fr.id, fromId: k('front.5'), toId: k('front.7') } }],
    } };
    const m = migrateProject(legacy as never);
    const nf = m.pieces.find((q) => q.role === 'front')!;
    const pk = m.edits!.attachments.find((a) => a.id === 'pk')!, cs = m.edits!.customSeams[0];
    pass(isSplitFront(nf) && nf.id === fr.id && pk.instance === 1 && pk.x === 12 && cs?.a.instance === 1 && cs.a.fromId === k('front.5') && m.pieces.some((q) => q.role === 'facing') && m.edits!.builtin === BUILTIN_VERSION,
      'old closed front opens as split fronts: pocket and seam on its right half move to the right front, facing and style details added');
    const kept = migrateProject({ ...p, edits: { ...p.edits!, attachments: [] } });
    pass(kept.edits!.attachments.length === 0, 'a project whose style details were deleted does not get them back');
  }
  {
    // regrade: the style details follow the pattern; a change of body type moves the lap to the other side
    const st = useStore.getState();
    st.newProject('jacket');
    const p0 = useStore.getState().project;
    useStore.getState().setBody('chest', p0.body.chest + 12);
    const p1 = useStore.getState().project;
    const b0 = p0.edits!.attachments.find((a) => a.name === 'Front buttons')!, b1 = p1.edits!.attachments.find((a) => a.name === 'Front buttons')!;
    pass(b1.x === 0 && b1.instance === b0.instance, `regrade: front buttons stay on centre front (${b0.y.toFixed(1)} -> ${b1.y.toFixed(1)} cm down)`);
    useStore.getState().setBodyPreset('female');
    const b2 = useStore.getState().project.edits!.attachments.find((a) => a.name === 'Front buttons')!;
    pass(b2.instance === 1 - b0.instance!, 'female body: buttons move to the other front (left over right)');
  }
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
