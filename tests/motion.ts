// Run: npx tsx tests/motion.ts   (cloth follows the moving body without blowing up)
import { makePreset } from '../src/data/presets';
import type { StyleId } from '../src/data/catalog';
import { DEFAULT_BODY, bodyFrame } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, PosedCollider } from '../src/three/mesher';
import { boneMatrices, invert, poseAt, type Mode } from '../src/sim/pose';
import { EMPTY_EDITS, type Edits } from '../src/data/edits';
import type { Piece } from '../src/data/presets';

/** jeans with a back pocket and a belt loop on both legs, and a knife pleat drafted into the front */
function pleatedJeans(): [Piece[], Edits] {
  const pieces = makePreset('jeans', DEFAULT_BODY);
  const fr = pieces.find((p) => p.role === 'front')!, bk = pieces.find((p) => p.role === 'back')!;
  fr.points.find((q) => q.key === 'front.1')!.x += 3;
  const a = { rotation: 0, layers: [], pieceId: bk.id };
  return [pieces, { ...EMPTY_EDITS,
    attachments: [{ ...a, id: 'pk', kind: 'pocket', name: 'Back pocket', x: 1, y: 13, w: 14, h: 15, outline: 'pointed' }, { ...a, id: 'bl', kind: 'strap', name: 'Belt loop', x: 6, y: 3, w: 1.2, h: 5, outline: 'rect' }],
    pleats: [{ id: 'kp', pieceId: fr.id, pointId: fr.points.find((q) => q.key === 'front.0')!.id, t: 0.55, depth: 1.5, length: 7, type: 'knife', direction: 1 }] }];
}

const f = bodyFrame(DEFAULT_BODY);
const field = calibratedField(DEFAULT_BODY);
const mesh = meshField(field);
let fails = 0;
const cases: [StyleId, Mode, (() => [Piece[], Edits])?][] = [
  ['jacket', 'jacks'], ['button-up', 'cross'], ['jeans', 'sit'], ['jeans', 'walk'], ['jacket', 'hug'],
  ['basic-tee', 'jacks'], ['polo', 'cross'], ['boxy-tee', 'hug'], ['sweatpants', 'walk'], ['baggy-jeans', 'sit'], ['shorts', 'walk'],
  ['bucket-hat', 'jacks'], ['cap', 'walk'],
  ['jeans', 'walk', pleatedJeans],
];
for (const [g, mode, make] of cases) {
  const col = new PosedCollider(mesh.grid, [f.ankleH + 6, f.crotchH + 1], f);
  const [pieces, edits] = make ? make() : [makePreset(g, DEFAULT_BODY), undefined];
  const G = assemble(g, pieces, DEFAULT_BODY, 1.8, col, edits)!;
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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${(make ? g + '+edits' : g).padEnd(12)} ${mode.padEnd(6)} ${ms.toFixed(1)}ms/frame  y ${before[0].toFixed(0)}..${before[1].toFixed(0)} -> ${after[0].toFixed(0)}..${after[1].toFixed(0)}  deep-inside ${(100 * inside / sim.n).toFixed(1)}%  peak (p99.5) ${(worst * 100).toFixed(0)}% of safe, ${(over * 100).toFixed(1)}% of cloth over its safe stretch`);
}
console.log(fails ? `${fails} FAILED` : 'all motion checks passed');
process.exit(fails ? 1 : 0);
