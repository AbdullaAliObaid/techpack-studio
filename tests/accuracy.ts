// Run: npx tsx tests/accuracy.ts
import { bodyFrame, perimeter, tapePerimeter, DEFAULT_BODY, type Body } from '../src/three/body';
import { makePreset, type GarmentType } from '../src/data/presets';
import { draft, regradePoints, EASE } from '../src/data/draft';
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
  check('crown height', f.neckH + 0.034 * f.H + f.headH, b.height);
  check('crotch height (inseam)', f.crotchH, b.inseam);
  check('shoulder point to point', 2 * f.acromion.x, b.shoulder);
  check('shoulder point to wrist (arm)', Math.hypot(f.acromion.x - f.wrist.x, f.acromion.y - f.wrist.y), b.arm);

  // the rendered body mesh, measured like a tape (convex hull of the slice around the torso)
  const mesh = meshField(calibratedField(b));
  const slice = (h: number) => {
    const P = mesh.positions, I = mesh.indices, pts: [number, number][] = [];
    for (let t = 0; t < I.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = I[t + e] * 3, c = I[t + ((e + 1) % 3)] * 3;
        const ya = P[a + 1], yc = P[c + 1];
        if ((ya - h) * (yc - h) >= 0) continue;
        const u = (h - ya) / (yc - ya);
        const x = P[a] + (P[c] - P[a]) * u, z = P[a + 2] + (P[c + 2] - P[a + 2]) * u;
        if (Math.abs(x) < f.torsoAt(h).a + 0.6) pts.push([x, z]); // torso section only, not the arms
      }
    }
    return hullLength(pts);
  };
  check('rendered mesh chest (tape)', slice(f.chestH), b.chest, 0.25);
  check('rendered mesh waist (tape)', slice(f.waistH), b.waist, 0.25);
  check('rendered mesh hips (tape)', slice(f.hipH), b.hips, 0.25);
  let top = 0; for (let i = 1; i < mesh.positions.length; i += 3) top = Math.max(top, mesh.positions[i]);
  check('rendered mesh height', top, b.height, 0.25);

  for (const g of ['jacket', 'shirt', 'pants'] as GarmentType[]) {
    const pieces = makePreset(g, b);
    const rows = fitTable(g, pieces, b);
    const E: Record<string, number> = g === 'pants'
      ? { Waist: EASE.pants.waist, Hip: EASE.pants.hip, Inseam: -3 }
      : { Chest: EASE[g].chest, Waist: EASE[g].waist, 'Hem / hips': EASE[g].hem, 'Sleeve / arm': EASE[g].sleeve };
    for (const r of rows) if (r.label in E && r.body !== null) check(`${g} pattern ${r.label} = body + ease`, r.garment, r.body + E[r.label], 0.1);

    for (const r of seamReport(g, pieces)) check(`${g} seam ${r.label}`, r.a - r.b, r.ease ?? 0, 0.05);

    // 3D garment: chest / hip ring perimeter must equal the pattern circumference
    const res = buildGarment(g, pieces, b);
    const front = pieces.find((p) => p.role === 'front')!, back = pieces.find((p) => p.role === 'back')!;
    const fp = samplePoly(front.points), bp = samplePoly(back.points);
    const w = (poly: typeof fp, y: number) => { const s = sliceSpan(poly, y); return s ? s.x2 - s.x1 : 0; };
    if (g !== 'pants') {
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
      check('pants 3D hip ring = pattern hip', perimeter(ring.a, ring.b, ring.shape, 720), 2 * (w(fp, hipY) + w(bp, bcr + (hipY - cr))), 0.6);
      const legTop = Math.max(...seat.rings.map((r) => r.y));
      check('pants waistband lands on body waist', legTop, f.waistH, 1.2);
    }
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

console.log(fails ? `\n${fails} FAILED` : '\nall checks passed');
process.exit(fails ? 1 : 0);
