// Run: npx tsx tests/clip.ts   (does the RENDERED cloth stay outside the RENDERED body?)
//
// Measures what the user sees: cloth positions exactly as the worker sends them for display, against the
// skinned body mesh exactly as ClothView draws it (rest positions from the 'body' message, skin weights,
// bone matrices: linear blend skinning). Samples are cloth vertices, edge midpoints and triangle centroids,
// because a triangle can cut through the body between its vertices.
//
// Part 2: cloth attachments (pocket, patch, applique) never sit on the wrong side of their host cloth.
//
// Env: STYLE=jeans only that style, BODY=male|female, QUICK=1 stand only, V=1 per case worst spots.
import { makePreset, type Piece } from '../src/data/presets';
import type { StyleId } from '../src/data/catalog';
import { DEFAULT_BODY, FEMALE_BODY, bodyFrame, type Body, type BodyFrame } from '../src/three/body';
import { assemble, displayPositions, type Garment3D } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, PosedCollider, type BodyMesh } from '../src/three/mesher';
import { PosedBody, closestOnTri } from './clipLib';
import { boneMatrices, invert, lerpPose, poseAt, stepPose, type Mode } from '../src/sim/pose';
import { EMPTY_EDITS, ZERO_POSE, ZERO_SIDE, type Attachment, type CustomPose, type Edits } from '../src/data/edits';

// ---------------------------------------------------------------------------------------------
// cloth samples: vertices, edge midpoints, triangle centroids of the displayed cloth
// ---------------------------------------------------------------------------------------------
interface ClipResult { samples: number; inside: number; maxDepth: number; worst: string }
function clipOf(G: Garment3D, B: PosedBody): ClipResult {
  const pos = new Float32Array(G.sim.n * 3);
  displayPositions(G, pos);
  let samples = 0, inside = 0, maxDepth = 0, worst = '';
  const test = (x: number, y: number, z: number, where: () => string) => {
    samples++;
    const d = B.signed(x, y, z);
    if (d < 0) {
      inside++;
      if (-d > maxDepth) { maxDepth = -d; worst = where(); }
    }
  };
  for (const P of G.panels) {
    const o = P.offset, T = P.mesh.tris;
    const name = () => `${P.attach ? 'attachment ' : ''}${P.piece.name}${P.mirror ? ' (L)' : ''}`;
    for (let i = 0; i < P.mesh.uv.length; i++) { const j = (o + i) * 3; test(pos[j], pos[j + 1], pos[j + 2], () => `${name()} vertex y ${pos[j + 1].toFixed(0)}`); }
    const edges = new Set<string>();
    for (let t = 0; t < T.length; t += 3) {
      const a = (o + T[t]) * 3, b = (o + T[t + 1]) * 3, c = (o + T[t + 2]) * 3;
      test((pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3, () => `${name()} triangle y ${pos[a + 1].toFixed(0)}`);
      for (let e = 0; e < 3; e++) {
        const p = T[t + e], q = T[t + ((e + 1) % 3)], k = p < q ? `${p},${q}` : `${q},${p}`;
        if (edges.has(k)) continue;
        edges.add(k);
        const u = (o + p) * 3, v = (o + q) * 3;
        test((pos[u] + pos[v]) / 2, (pos[u + 1] + pos[v + 1]) / 2, (pos[u + 2] + pos[v + 2]) / 2, () => `${name()} edge y ${pos[u + 1].toFixed(0)}`);
      }
    }
  }
  return { samples, inside, maxDepth, worst };
}

/**
 * Share of attachment vertices on the wrong side of their host cloth, displayed positions. The host's outer
 * face is its triangle winding turned outward once per panel (by majority against the body normal where the
 * cloth lies along the body), so a fold that stands up off the body is still judged by the cloth's own face.
 */
function wrongSide(G: Garment3D, B: PosedBody, id: string) {
  const pos = new Float32Array(G.sim.n * 3);
  displayPositions(G, pos);
  let n = 0, wrong = 0, worst = 0;
  const bn = { nx: 0, ny: 0, nz: 0 };
  const triN = (H: Garment3D['panels'][number], t: number) => {
    const a = (H.offset + H.mesh.tris[t]) * 3, b = (H.offset + H.mesh.tris[t + 1]) * 3, c = (H.offset + H.mesh.tris[t + 2]) * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    return { a, b, c, nx: nx / l, ny: ny / l, nz: nz / l };
  };
  const signOf = new Map<number, number>();
  for (const A of G.panels.filter((p) => p.attach?.id === id)) {
    const hi = A.attach!.host, H = G.panels[hi];
    if (!signOf.has(hi)) {
      let vote = 0;
      for (let t = 0; t < H.mesh.tris.length; t += 3) {
        const T = triN(H, t);
        const d = B.signed((pos[T.a] + pos[T.b] + pos[T.c]) / 3, (pos[T.a + 1] + pos[T.b + 1] + pos[T.c + 1]) / 3, (pos[T.a + 2] + pos[T.b + 2] + pos[T.c + 2]) / 3, bn, 30);
        if (!(Math.abs(d) < 3)) continue;
        const k = T.nx * bn.nx + T.ny * bn.ny + T.nz * bn.nz;
        if (Math.abs(k) > 0.5) vote += Math.sign(k);
      }
      signOf.set(hi, vote >= 0 ? 1 : -1);
    }
    const sg = signOf.get(hi)!;
    for (let i = 0; i < A.mesh.uv.length; i++) {
      const j = (A.offset + i) * 3, x = pos[j], y = pos[j + 1], z = pos[j + 2];
      let best = Infinity, bq = [0, 0, 0], bt = -1;
      for (let t = 0; t < H.mesh.tris.length; t += 3) {
        const a = (H.offset + H.mesh.tris[t]) * 3, b = (H.offset + H.mesh.tris[t + 1]) * 3, c = (H.offset + H.mesh.tris[t + 2]) * 3;
        const r = closestOnTri(pos, a, b, c, x, y, z);
        if (r.d2 < best) { best = r.d2; bt = t; bq = [0, 1, 2].map((k) => pos[a + k] * r.u + pos[b + k] * r.v + pos[c + k] * r.w); }
      }
      if (bt < 0) continue;
      n++;
      const T = triN(H, bt);
      const s = ((x - bq[0]) * T.nx + (y - bq[1]) * T.ny + (z - bq[2]) * T.nz) * sg;
      if (s < -0.02) { wrong++; worst = Math.max(worst, -s); }
    }
  }
  return { n, wrong, worst };
}

// ---------------------------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------------------------
const D = Math.PI / 180;
const ARMS_UP: CustomPose = { ...ZERO_POSE, s: [{ ...ZERO_SIDE, shAbd: 160 * D, elbow: 10 * D }, { ...ZERO_SIDE, shAbd: 160 * D, elbow: 10 * D }] };
const STYLES: StyleId[] = ['basic-tee', 'button-up', 'jacket', 'jeans', 'sweatpants', 'polo'];
const BODIES: [string, Body][] = [['male', DEFAULT_BODY], ['female', FEMALE_BODY]];
/** motion runs: frames to run and the frames at which the display is measured */
const MOTIONS: { mode: Mode; frames: number; at: number[]; custom?: CustomPose }[] = [
  { mode: 'walk', frames: 90, at: [60, 90] },
  { mode: 'sit', frames: 80, at: [80] },
  { mode: 'jacks', frames: 90, at: [60, 90] },
  { mode: 'custom', frames: 110, at: [110], custom: ARMS_UP },
];
const STAND_MAX = 0.5, STAND_DEPTH = 0.3, MOTION_MAX = 2;
let fails = 0;
const pct = (a: number, b: number) => (100 * a / Math.max(1, b)).toFixed(2) + '%';

interface World { f: BodyFrame; mesh: BodyMesh; body: Body }
const worlds = new Map<string, World>();
function world(name: string, body: Body): World {
  let w = worlds.get(name);
  if (!w) { const field = calibratedField(body); w = { f: bodyFrame(body), mesh: meshField(field), body }; worlds.set(name, w); }
  return w;
}
const posed = (w: World, M: Float64Array) => new PosedBody(w.mesh, M);

/** drape standing like the worker does (until the solver sleeps) */
function standing(w: World, style: StyleId, pieces: Piece[], edits?: Edits) {
  const col = new PosedCollider(w.mesh.grid, [w.f.ankleH + 6, w.f.crotchH + 1], w.f);
  const M0 = boneMatrices(w.f, poseAt('stand', 0, w.f));
  col.setPose(M0, invert(M0));
  const G = assemble(style, pieces, w.body, 1.8, col, edits)!;
  let frames = 0;
  while (!G.sim.sleeping && frames < 420) { G.sim.step(); frames++; }
  return { G, col, M0 };
}

/** play a movement from the standing drape like the worker (body moved on every substep) */
function* play(w: World, G: Garment3D, col: PosedCollider, m: (typeof MOTIONS)[number]) {
  const sim = G.sim;
  sim.sleeping = false; sim.awake = true;
  sim.frames = Math.max(sim.frames, sim.sewFrames + 1);
  let cur: CustomPose = ZERO_POSE;
  for (let i = 0; i < m.frames; i++) {
    const prev = cur;
    if (m.custom) cur = stepPose(cur, m.custom, 2.5 / 60);
    sim.substepHook = (k, n) => {
      const M = boneMatrices(w.f, poseAt(m.mode, (i + (k + 1) / n) / 60, w.f, m.custom ? lerpPose(prev, cur, (k + 1) / n) : undefined));
      col.setPose(M, invert(M));
    };
    sim.step();
    if (m.at.includes(i + 1)) yield { frame: i + 1, M: boneMatrices(w.f, poseAt(m.mode, (i + 1) / 60, w.f, m.custom ? cur : undefined)) };
  }
  sim.substepHook = null;
}

const save = (G: Garment3D) => ({ pos: G.sim.pos.slice(), prev: G.sim.prev.slice(), vel: G.sim.vel.slice(), frames: G.sim.frames });
const restore = (G: Garment3D, s: ReturnType<typeof save>) => { G.sim.pos.set(s.pos); G.sim.prev.set(s.prev); G.sim.vel.set(s.vel); G.sim.frames = s.frames; };

console.log('== body / cloth clipping (rendered cloth vs rendered skinned body) ==');
const totals = { stand: [0, 0], motion: [0, 0] };
for (const [bname, body] of process.env.ONLY === 'attach' ? [] : BODIES) {
  if (process.env.BODY && process.env.BODY !== bname) continue;
  const w = world(bname, body);
  for (const style of STYLES) {
    if (process.env.STYLE && process.env.STYLE !== style) continue;
    const { G, col, M0 } = standing(w, style, makePreset(style, body));
    const r = clipOf(G, posed(w, M0));
    totals.stand[0] += r.inside; totals.stand[1] += r.samples;
    const ok = r.inside / r.samples < STAND_MAX / 100 && r.maxDepth <= STAND_DEPTH;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${bname.padEnd(6)} ${style.padEnd(11)} stand        inside ${pct(r.inside, r.samples).padStart(6)} of ${r.samples} samples, max depth ${(r.maxDepth * 10).toFixed(1)} mm${r.inside && (process.env.V || !ok) ? `  (${r.worst})` : ''}`);
    if (process.env.QUICK) continue;
    const st = save(G);
    for (const m of MOTIONS) {
      restore(G, st);
      for (const { frame, M } of play(w, G, col, m)) {
        const q = clipOf(G, posed(w, M));
        totals.motion[0] += q.inside; totals.motion[1] += q.samples;
        const okm = q.inside / q.samples < MOTION_MAX / 100;
        if (!okm) fails++;
        const label = `${m.mode === 'custom' ? 'arms up' : m.mode} @${frame}`;
        console.log(`${okm ? 'ok  ' : 'FAIL'} ${bname.padEnd(6)} ${style.padEnd(11)} ${label.padEnd(12)} inside ${pct(q.inside, q.samples).padStart(6)}, max depth ${(q.maxDepth * 10).toFixed(1)} mm${q.inside && (process.env.V || !okm) ? `  (${q.worst})` : ''}`);
      }
    }
  }
}
console.log(`total: stand ${pct(totals.stand[0], totals.stand[1])}, motion ${pct(totals.motion[0], totals.motion[1])}`);

// ---------------------------------------------------------------------------------------------
// attachments stay on the outside of their host
// ---------------------------------------------------------------------------------------------
console.log('\n== attachments on the outside of the host cloth ==');
const att = (o: Partial<Attachment> & Pick<Attachment, 'id' | 'kind' | 'pieceId' | 'x' | 'y' | 'w' | 'h'>): Attachment => ({ name: o.id, rotation: 0, outline: 'rect', layers: [], ...o });
const attCases: { label: string; style: StyleId; id: string; edits: (p: Piece[]) => Edits; pieces?: (p: Piece[]) => Piece[] }[] = [
  { label: 'jeans back pocket, both legs', style: 'jeans', id: 'bp', edits: (p) => ({ ...EMPTY_EDITS, attachments: [att({ id: 'bp', kind: 'pocket', pieceId: p.find((q) => q.role === 'back')!.id, x: 1, y: 13, w: 14, h: 15, outline: 'pointed' })] }) },
  { label: 'tee chest patch', style: 'basic-tee', id: 'cp', edits: (p) => ({ ...EMPTY_EDITS, attachments: [att({ id: 'cp', kind: 'patch', pieceId: p.find((q) => q.role === 'front')!.id, x: 11, y: 26, rotation: 10, w: 8, h: 8, outline: 'rounded' })] }) },
  { label: 'jacket elbow patch', style: 'jacket', id: 'ep', edits: (p) => { const s = p.find((q) => q.role === 'sleeve')!; const ys = s.points.map((q) => q.y); return { ...EMPTY_EDITS, attachments: [att({ id: 'ep', kind: 'patch', pieceId: s.id, x: 0, y: Math.min(...ys) + 0.62 * (Math.max(...ys) - Math.min(...ys)), w: 9, h: 12, outline: 'rounded' })] }; } },
  { label: 'tee applique star (back)', style: 'basic-tee', id: 'as', edits: (p) => ({ ...EMPTY_EDITS, attachments: [att({ id: 'as', kind: 'applique', pieceId: p.find((q) => q.role === 'back')!.id, x: 0, y: 22, w: 14, h: 14, outline: 'shape', shape: 'star' })] }) },
];
for (const [bname, body] of BODIES.slice(0, 1)) {
  const w = world(bname, body);
  for (const c of attCases) {
    const pieces = makePreset(c.style, body);
    const edits = c.edits(pieces);
    const { G, col, M0 } = standing(w, c.style, pieces, edits);
    const r0 = wrongSide(G, posed(w, M0), c.id);
    let r1 = { n: 0, wrong: 0, worst: 0 };
    if (!process.env.QUICK) for (const { M } of play(w, G, col, MOTIONS[0])) { const r = wrongSide(G, posed(w, M), c.id); r1 = { n: r1.n + r.n, wrong: r1.wrong + r.wrong, worst: Math.max(r1.worst, r.worst) }; }
    const ok = r0.n > 0 && r0.wrong === 0 && r1.wrong === 0;
    if (!ok) fails++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.label.padEnd(30)} wrong side: stand ${r0.wrong}/${r0.n}${process.env.QUICK ? '' : `, walk ${r1.wrong}/${r1.n}`}  worst ${(Math.max(r0.worst, r1.worst) * 10).toFixed(1)} mm`);
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall clip checks passed');
process.exit(fails ? 1 : 0);
