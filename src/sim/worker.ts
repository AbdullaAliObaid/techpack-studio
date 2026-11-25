// Cloth simulation runs here, off the main thread, so the editor stays smooth while fabric drapes.
import { assemble, warmStart, type Garment3D } from './setup';
import type { GarmentType, Piece } from '../data/presets';
import type { Body } from '../three/body';

let G: Garment3D | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let gen = 0;

type BuildMsg = { type: 'build'; garment: GarmentType; pieces: Piece[]; body: Body; warm: boolean; spacing: number };

function loop(myGen: number) {
  if (!G || myGen !== gen) return;
  const t0 = performance.now();
  G.sim.step();
  const pos = new Float32Array(G.sim.n * 3);
  G.sim.display(pos);
  let strain: Float32Array | undefined;
  let peak: { ratio: number; strain: number; y: number } | undefined;
  if (G.sim.frames % 6 === 0 || G.sim.sleeping) {
    strain = new Float32Array(G.sim.n);
    G.sim.strain(strain);
    let wi = 0, worst = 0;
    for (let i = 0; i < G.sim.n; i++) {
      const r = strain[i] / Math.max(0.01, G.limits[i]);
      strain[i] = r; // send as ratio of the fabric's safe stretch
      if (r > worst) { worst = r; wi = i; }
    }
    peak = { ratio: worst, strain: worst * G.limits[wi], y: G.sim.pos[wi * 3 + 1] };
  }
  const msg = { type: 'frame', pos, strain, peak, sleeping: G.sim.sleeping };
  (self as unknown as Worker).postMessage(msg, [pos.buffer, ...(strain ? [strain.buffer] : [])]);
  if (!G.sim.sleeping) timer = setTimeout(() => loop(myGen), Math.max(0, 16 - (performance.now() - t0)));
}

self.onmessage = (e: MessageEvent<BuildMsg>) => {
  const m = e.data;
  if (m.type !== 'build') return;
  if (timer) clearTimeout(timer);
  const next = assemble(m.garment, m.pieces, m.body, m.spacing);
  if (!next) { G = null; return; }
  if (m.warm && G) warmStart(next, G);
  G = next;
  gen++;
  const index: number[] = [];
  const groups: { start: number; count: number; panel: number }[] = [];
  const uv = new Float32Array(G.sim.n * 2);
  G.panels.forEach((p, k) => {
    p.mesh.uv.forEach((q, i) => {
      uv[(p.offset + i) * 2] = (p.mirror ? -q.x : q.x) / 6;
      uv[(p.offset + i) * 2 + 1] = -q.y / 6;
    });
    const start = index.length;
    for (let t = 0; t < p.mesh.tris.length; t += 3) {
      const a = p.offset + p.mesh.tris[t], b = p.offset + p.mesh.tris[t + 1], c = p.offset + p.mesh.tris[t + 2];
      p.mirror ? index.push(a, c, b) : index.push(a, b, c);
    }
    groups.push({ start, count: index.length - start, panel: k });
  });
  const pos = new Float32Array(G.sim.n * 3);
  G.sim.display(pos);
  (self as unknown as Worker).postMessage({
    type: 'built', n: G.sim.n, index: new Uint32Array(index), groups, uv, pos,
    fabrics: G.panels.map((p) => p.piece.fabric),
  });
  loop(gen);
};
