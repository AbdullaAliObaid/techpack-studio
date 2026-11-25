// Run: npx tsx tests/motion.ts   (cloth follows the moving body without blowing up)
import { makePreset, type GarmentType } from '../src/data/presets';
import { DEFAULT_BODY, bodyFrame } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, PosedCollider } from '../src/three/mesher';
import { boneMatrices, invert, poseAt, type Mode } from '../src/sim/pose';

const f = bodyFrame(DEFAULT_BODY);
const field = calibratedField(DEFAULT_BODY);
const mesh = meshField(field);
let fails = 0;
for (const [g, mode] of [['jacket', 'jacks'], ['shirt', 'cross'], ['pants', 'sit'], ['pants', 'walk'], ['jacket', 'hug']] as [GarmentType, Mode][]) {
  const col = new PosedCollider(mesh.grid, [f.ankleH + 6, f.crotchH + 1], f);
  const G = assemble(g, makePreset(g, DEFAULT_BODY), DEFAULT_BODY, 1.8, col)!;
  const sim = G.sim;
  for (let i = 0; i < 200; i++) sim.step(); // drape standing
  const ext = () => { let mx = -1e9, mn = 1e9; for (let i = 1; i < sim.pos.length; i += 3) { mx = Math.max(mx, sim.pos[i]); mn = Math.min(mn, sim.pos[i]); } return [mn, mx]; };
  const before = ext();
  sim.sleeping = false; sim.awake = true;
  const t0 = performance.now();
  let inside = 0;
  for (let i = 0; i < 150; i++) {
    sim.substepHook = (k, n) => { const M = boneMatrices(f, poseAt(mode, (i + (k + 1) / n) / 60, f)); col.setPose(M, invert(M)); };
    sim.step();
  }
  const ms = (performance.now() - t0) / 150;
  let bad = 0; for (const v of sim.pos) if (!Number.isFinite(v)) bad++;
  // how many cloth points ended up deep inside the posed body?
  const M = boneMatrices(f, poseAt(mode, 150 / 60, f));
  // sleeve / leg tracking: share of garment points far from the body

  const probe = new PosedCollider(mesh.grid); probe.thickness = -1.0; probe.setPose(M, invert(M));
  const tmp = new Float32Array(3), o = { nx: 0, ny: 0, nz: 0, depth: 0 };
  for (let i = 0; i < sim.n; i++) { tmp.set(sim.pos.subarray(i * 3, i * 3 + 3)); if (probe.project(tmp, 0, o)) inside++; }
  const after = ext();
  const st = new Float32Array(sim.n); sim.strain(st);
  const r = Array.from(st, (v, i) => v / G.limits[i]).sort((a, b) => a - b);
  const worst = r[Math.floor(r.length * 0.995)];
  const over = r.filter((v) => v > 1).length / r.length;
  const ok = bad === 0 && inside / sim.n < 0.03;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${g} ${mode.padEnd(6)} ${ms.toFixed(1)}ms/frame  y ${before[0].toFixed(0)}..${before[1].toFixed(0)} -> ${after[0].toFixed(0)}..${after[1].toFixed(0)}  deep-inside ${(100 * inside / sim.n).toFixed(1)}%  peak (p99.5) ${(worst * 100).toFixed(0)}% of safe, ${(over * 100).toFixed(1)}% of cloth over its safe stretch`);
}
console.log(fails ? `${fails} FAILED` : 'all motion checks passed');
