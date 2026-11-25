// Run: npx tsx tests/drape.ts
import { makePreset, type GarmentType } from '../src/data/presets';
import { DEFAULT_BODY } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider } from '../src/three/mesher';
const FF = calibratedField(DEFAULT_BODY);
const collider = new GridCollider(meshField(FF).grid, [FF.f.ankleH + 6, FF.f.crotchH + 1]);

for (const g of ['jacket', 'shirt', 'pants'] as GarmentType[]) {
  const pieces = makePreset(g, DEFAULT_BODY);
  const t0 = performance.now();
  const G = assemble(g, pieces, DEFAULT_BODY, Number(process.env.SP ?? 2.0), collider)!;
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
  // seam gaps
  let gap = 0, ns = 0;
  for (let c = 0; c < sim.ca.length; c++) if (sim.rest[c] === 0) {
    const a = sim.ca[c] * 3, b = sim.cb[c] * 3;
    gap += Math.hypot(sim.pos[a] - sim.pos[b], sim.pos[a + 1] - sim.pos[b + 1], sim.pos[a + 2] - sim.pos[b + 2]); ns++;
  }
  const st = new Float32Array(sim.n); sim.strain(st);
  const sorted = [...st].sort((a, b) => a - b);
  // where is the worst strain?
  let wi = 0; for (let i = 0; i < sim.n; i++) if (st[i] > st[wi]) wi = i;
  const pan = G.panels.find((p) => wi >= p.offset && wi < p.offset + p.mesh.uv.length)!;
  const uvw = pan.mesh.uv[wi - pan.offset];
  console.log(`   worst ${(st[wi] * 100).toFixed(0)}% on ${pan.piece.name}${pan.mirror ? ' (L)' : ''} at pattern (${uvw.x.toFixed(1)}, ${uvw.y.toFixed(1)}) world y ${sim.pos[wi * 3 + 1].toFixed(1)}`);
  console.log(`${g}: ${sim.n} particles, ${sim.ca.length} constraints, ${ns} sew links | build ${(t1 - t0).toFixed(0)}ms | ${frames} frames ${((t3 - t2) / frames).toFixed(1)}ms/frame | NaN ${bad} | y ${minY.toFixed(1)}..${maxY.toFixed(1)} | seam gap avg ${(gap / ns).toFixed(2)}cm | strain p50 ${(sorted[sorted.length >> 1] * 100).toFixed(1)}% p99 ${(sorted[Math.floor(sorted.length * 0.99)] * 100).toFixed(1)}%`);
}
