// Cloth simulation runs here, off the main thread, so the editor stays smooth while fabric drapes.
import { assemble, warmStart, type Garment3D } from './setup';
import type { GarmentType, Piece } from '../data/presets';
import type { Body } from '../three/body';
import { calibratedField } from '../three/bodyField';
import { meshField, PosedCollider } from '../three/mesher';
import { bodyFrame, type BodyFrame } from '../three/body';
import { boneMatrices, invert, poseAt, type Mode } from './pose';

let bodyKey = '';
let collider: PosedCollider | null = null;
let frame: BodyFrame | null = null;
let mode: Mode = 'stand';
let simTime = 0; // seconds of simulated time
let modeStart = 0;
let motionPeak = 0;
let motionPeakInfo: { ratio: number; strain: number; y: number; over: number } | null = null;

function applyPose(dt = 0) {
  if (!collider || !frame) return 0;
  const t = simTime - modeStart + dt;
  const M = boneMatrices(frame, poseAt(mode, t, frame));
  collider.setPose(M, invert(M));
  return t;
}

let G: Garment3D | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let gen = 0;

type BuildMsg = { type: 'build'; garment: GarmentType; pieces: Piece[]; body: Body; warm: boolean; spacing: number } | { type: 'mode'; mode: Mode };

function loop(myGen: number) {
  if (!G || myGen !== gen) return;
  const t0 = performance.now();
  const poseT = simTime - modeStart;
  // move the body a little on every substep so fast limbs cannot tunnel through the cloth
  G.sim.substepHook = (k, n) => applyPose(((k + 1) / n) / 60);
  G.sim.awake = mode !== 'stand' || poseT < 1.2;
  G.sim.step();
  simTime += 1 / 60;
  const pos = new Float32Array(G.sim.n * 3);
  G.sim.display(pos);
  let strain: Float32Array | undefined;
  let peak: { ratio: number; strain: number; y: number; over: number } | undefined;
  if (G.sim.frames % 6 === 0 || G.sim.sleeping) {
    strain = new Float32Array(G.sim.n);
    G.sim.strain(strain);
    // ratio of the fabric's safe stretch; the first 1% of strain is mesh noise, not fabric strain
    let over = 0;
    for (let i = 0; i < G.sim.n; i++) {
      const r = Math.max(0, strain[i] - 0.01) / Math.max(0.01, G.limits[i]);
      strain[i] = r;
      if (r > 1) over++;
    }
    // robust peak: the 98th percentile, so a single trapped point cannot set the reading
    const order = Array.from(strain.keys()).sort((a, b) => strain![a] - strain![b]);
    const wi = order[Math.floor(order.length * 0.98)];
    const worst = strain[wi];
    peak = { ratio: worst, strain: worst * G.limits[wi] + 0.01, y: G.sim.pos[wi * 3 + 1], over: over / G.sim.n };
    // during a movement keep the worst moment of the motion
    if (mode !== 'stand' && simTime - modeStart > 1) {
      if (worst > motionPeak) { motionPeak = worst; motionPeakInfo = peak; }
      if (motionPeakInfo) peak = motionPeakInfo;
    }
  }
  const msg = { type: 'frame', pos, strain, peak, sleeping: G.sim.sleeping, mode, t: simTime - modeStart };
  (self as unknown as Worker).postMessage(msg, [pos.buffer, ...(strain ? [strain.buffer] : [])]);
  if (!G.sim.sleeping) timer = setTimeout(() => loop(myGen), Math.max(0, 16 - (performance.now() - t0)));
}

self.onmessage = (e: MessageEvent<BuildMsg>) => {
  const m = e.data;
  if (m.type === 'mode') {
    mode = m.mode;
    modeStart = simTime;
    motionPeak = 0;
    motionPeakInfo = null;
    if (G) {
      G.sim.sleeping = false;
      G.sim.frames = Math.max(G.sim.frames, G.sim.sewFrames + 1);
      if (timer) clearTimeout(timer);
      loop(gen);
    }
    return;
  }
  if (m.type !== 'build') return;
  if (timer) clearTimeout(timer);
  const key = JSON.stringify(m.body);
  if (key !== bodyKey || !collider) {
    (self as unknown as Worker).postMessage({ type: 'status', text: 'Building body…' });
    const field = calibratedField(m.body);
    const mesh = meshField(field);
    const fr = field.f;
    frame = bodyFrame(m.body);
    collider = new PosedCollider(mesh.grid, [fr.ankleH + 6, fr.crotchH + 1], fr);
    bodyKey = key;
    (self as unknown as Worker).postMessage(
      { type: 'body', positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, skinIndex: mesh.skinIndex, skinWeight: mesh.skinWeight },
      [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.skinIndex.buffer, mesh.skinWeight.buffer],
    );
  }
  // a new garment is always assembled on the standing body, then the current movement plays again
  if (collider) collider.setPose(boneMatrices(frame!, poseAt('stand', 0, frame!)), invert(boneMatrices(frame!, poseAt('stand', 0, frame!))));
  modeStart = simTime + (m.warm ? 0 : 2.0);
  motionPeak = 0;
  motionPeakInfo = null;
  const next = assemble(m.garment, m.pieces, m.body, m.spacing, collider!);
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
