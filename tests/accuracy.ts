// Run: npx tsx tests/accuracy.ts
import { bodyFrame, perimeter, tapePerimeter, DEFAULT_BODY, type Body } from '../src/three/body';
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
import { findTag } from '../src/lib/specs';

const bodies: Record<string, Body> = {
  default: DEFAULT_BODY,
  slim: { height: 168, chest: 86, waist: 70, hips: 90, shoulder: 41, arm: 58, inseam: 76, neck: 35 },
  big: { height: 182, chest: 124, waist: 112, hips: 116, shoulder: 51, arm: 64, inseam: 81, neck: 45 },
  tall: { height: 198, chest: 104, waist: 86, hips: 102, shoulder: 49, arm: 70, inseam: 92, neck: 40 },
};

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
