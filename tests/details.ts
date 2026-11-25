// Run: npx tsx tests/details.ts
import { makePreset, type GarmentType } from '../src/data/presets';
import { DEFAULT_BODY } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider } from '../src/three/mesher';
import { buildDetails, ANCHOR } from '../src/sim/details';
import { migrateGarment, styleById } from '../src/data/catalog';

const FF = calibratedField(DEFAULT_BODY);
const collider = new GridCollider(meshField(FF).grid, [FF.f.ankleH + 6, FF.f.crotchH + 1]);
let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fail++; console.log('FAIL', msg); } };

const expect: Record<string, { dashes: [number, number]; loops?: [number, number]; rivets?: [number, number]; buttons?: [number, number] }> = {
  jacket: { dashes: [300, 40000], buttons: [5, 5] },
  shirt: { dashes: [200, 40000], buttons: [7, 7] },
  pants: { dashes: [500, 40000], loops: [5, 5], rivets: [4, 20] },
};
for (const g of ['jacket', 'shirt', 'pants'] as GarmentType[]) {
  const G = assemble(g, makePreset(g, DEFAULT_BODY), DEFAULT_BODY, 1.8, collider)!;
  const t0 = performance.now();
  const m = buildDetails(G, styleById(migrateGarment(g)).details);
  const ms = performance.now() - t0;
  const kinds = (k: number) => Array.from(m.anchorKind).filter((x) => x === k).length;
  console.log(g, 'dashes', m.dashCount, 'loops', kinds(ANCHOR.loop), 'rivets', kinds(ANCHOR.rivet), 'buttons', kinds(ANCHOR.button), 'palette', m.palette.join(' '), ms.toFixed(0) + 'ms');
  const ex = expect[g];
  check(m.dashCount >= ex.dashes[0] && m.dashCount <= ex.dashes[1], `${g} dash count ${m.dashCount}`);
  const rng = (v: number, r?: [number, number]) => (r ? v >= r[0] && v <= r[1] : v === 0);
  check(rng(kinds(ANCHOR.loop), ex.loops), `${g} loops`);
  check(rng(kinds(ANCHOR.rivet), ex.rivets), `${g} rivets`);
  check(rng(kinds(ANCHOR.button), ex.buttons), `${g} buttons`);
  const okTri = (tri: Uint32Array, w: Float32Array, i: number) => {
    let s = 0;
    for (let j = 0; j < 3; j++) {
      check(tri[i * 3 + j] < m.n, `${g} index range`);
      const v = w[i * 3 + j];
      check(v >= -1e-6 && v <= 1 + 1e-6, `${g} weight ${v}`);
      s += v;
    }
    check(Math.abs(s - 1) < 1e-4, `${g} weights sum ${s}`);
  };
  for (let i = 0; i < m.dashCount * 2; i++) okTri(m.dashTri, m.dashW, i);
  for (let i = 0; i < m.anchorCount; i++) okTri(m.anchorTri, m.anchorW, i);
  // dashes should be short on the cloth (no teleporting between far apart particles)
  let longest = 0;
  for (let i = 0; i < m.dashCount; i++) {
    const p = (o: number) => { let x = 0, y = 0, z = 0; for (let j = 0; j < 3; j++) { const v = m.dashTri[i * 6 + o + j] * 3, w = m.dashW[i * 6 + o + j]; x += w * G.sim.pos[v]; y += w * G.sim.pos[v + 1]; z += w * G.sim.pos[v + 2]; } return [x, y, z]; };
    const a = p(0), b = p(3);
    longest = Math.max(longest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  let bad = 0; for (let i = 0; i < m.dashCount; i++) { const p = (o: number) => { let x = 0, y = 0, z = 0; for (let j = 0; j < 3; j++) { const v = m.dashTri[i * 6 + o + j] * 3, w = m.dashW[i * 6 + o + j]; x += w * G.sim.pos[v]; y += w * G.sim.pos[v + 1]; z += w * G.sim.pos[v + 2]; } return [x, y, z]; }; const a = p(0), b = p(3); if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1.2) bad++; }
  console.log("  long dashes", bad, "max", longest.toFixed(2));
  check(bad < m.dashCount * 0.03, `${g} long dashes ${bad}`);
}
console.log(fail ? `${fail} failures` : 'details ok');
process.exit(fail ? 1 : 0);
