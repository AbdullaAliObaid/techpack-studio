// Run: npx tsx tests/drape.ts   (every catalog style drapes on the default body; BODY=female for the female preset)
// Checks: no NaN, seams closed, strain sane, the garment stays where it belongs (hats on the head, pants on the hips).
import { makePreset } from '../src/data/presets';
import { CATALOG } from '../src/data/catalog';
import { DEFAULT_BODY as MALE, FEMALE_BODY, bodyFrame } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider } from '../src/three/mesher';

const DEFAULT_BODY = process.env.BODY === 'female' ? FEMALE_BODY : MALE;
const FF = calibratedField(DEFAULT_BODY);
const f = bodyFrame(DEFAULT_BODY);
const collider = new GridCollider(meshField(FF).grid, [FF.f.ankleH + 6, FF.f.crotchH + 1]);
const SP = Number(process.env.SP ?? 1.8);
const only = process.argv[2];
let fails = 0;

for (const style of CATALOG) {
  if (only && style.id !== only) continue;
  const g = style.id;
  const pieces = makePreset(g, DEFAULT_BODY);
  const t0 = performance.now();
  const G = assemble(g, pieces, DEFAULT_BODY, SP, collider)!;
  const t1 = performance.now();
  const sim = G.sim;
  let frames = 0;
  const t2 = performance.now();
  while (!sim.sleeping && frames < 600) { sim.step(); frames++; }
  const t3 = performance.now();
  let bad = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < sim.n; i++) {
    const y = sim.pos[i * 3 + 1];
    if (!Number.isFinite(y)) bad++;
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // seam gaps: sewn particle pairs should end up together
  let gap = 0, ns = 0, open = 0;
  for (let c = 0; c < sim.ca.length; c++) if (sim.rest[c] === 0) {
    const a = sim.ca[c] * 3, b = sim.cb[c] * 3;
    const d = Math.hypot(sim.pos[a] - sim.pos[b], sim.pos[a + 1] - sim.pos[b + 1], sim.pos[a + 2] - sim.pos[b + 2]);
    gap += d; ns++;
    if (d > 3) open++;
  }
  const st = new Float32Array(sim.n); sim.strain(st);
  const ratio = Array.from(st, (v, i) => Math.max(0, v - 0.01) / G.limits[i]).sort((a, b) => a - b);
  const sorted = [...st].sort((a, b) => a - b);
  let wi = 0; for (let i = 0; i < sim.n; i++) if (st[i] > st[wi]) wi = i;
  const pan = G.panels.find((p) => wi >= p.offset && wi < p.offset + p.mesh.uv.length)!;
  const uvw = pan.mesh.uv[wi - pan.offset];
  const p50 = sorted[sorted.length >> 1], p99 = sorted[Math.floor(sorted.length * 0.99)];
  const r98 = ratio[Math.floor(ratio.length * 0.98)];
  const avgGap = gap / ns;

  // where it should sit
  const fam = style.family;
  let placed = true, where = '';
  if (fam === 'bucket' || fam === 'cap') {
    // on the head: nothing below the chin, the crown resting on the top of the head
    placed = minY > f.headY + 2 && maxY > f.H - 1 && maxY < f.H + 3;
    where = `head ${f.headY.toFixed(0)}..${f.H.toFixed(0)}`;
  } else if (fam === 'pants') {
    placed = maxY > f.waistH - 6 && maxY < f.waistH + 3;
    where = `waist ${f.waistH.toFixed(0)}`;
  } else {
    placed = maxY > f.neckH - 1 && maxY < f.neckH + 12; // collars stand above the neckline
    where = `neck ${f.neckH.toFixed(0)}`;
  }
  // strain: no runaway stretch anywhere, the bulk of the cloth relaxed; the crotch fork of woven trousers is the expected hot spot
  const ok = bad === 0 && avgGap < 0.6 && open / ns < 0.02 && p99 < 0.2 && p50 < 0.03 && r98 < 2.5 && placed;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${g.padEnd(14)} ${sim.n} particles, ${ns} sew links | build ${(t1 - t0).toFixed(0)}ms | ${frames} frames ${((t3 - t2) / frames).toFixed(1)}ms/frame | NaN ${bad} | y ${minY.toFixed(1)}..${maxY.toFixed(1)} (${where}) | seam gap avg ${avgGap.toFixed(2)}cm, open ${open} | strain p50 ${(p50 * 100).toFixed(1)}% p99 ${(p99 * 100).toFixed(1)}%, p98 ${(r98 * 100).toFixed(0)}% of safe`);
  if (!ok || process.env.V) console.log(`     worst ${(st[wi] * 100).toFixed(0)}% on ${pan.piece.name}${pan.mirror ? ' (L)' : ''} at pattern (${uvw.x.toFixed(1)}, ${uvw.y.toFixed(1)}) world y ${sim.pos[wi * 3 + 1].toFixed(1)}`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall drape checks passed');
process.exit(fails ? 1 : 0);
