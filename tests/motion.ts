// Run: npx tsx tests/motion.ts   (cloth follows the moving body without blowing up)
import { makePreset } from '../src/data/presets';
import type { StyleId } from '../src/data/catalog';
import { DEFAULT_BODY, FEMALE_BODY, bodyFrame, type Body } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, PosedCollider } from '../src/three/mesher';
import { boneMatrices, invert, jointPoints, lerpPose, poseAt, stepPose, POSE_LIMITS, clampPose, type Mode } from '../src/sim/pose';
import { EMPTY_EDITS, ZERO_POSE, ZERO_SIDE, type CustomPose, type Edits, type SideAngles } from '../src/data/edits';
import type { Piece } from '../src/data/presets';
import { hatPose } from './hatLib';
import { styleEdits } from '../src/data/construction';
import { locate } from '../src/sim/setup';
import type { Attachment } from '../src/data/edits';
import type { Garment3D } from '../src/sim/setup';

/** gap between the two fronts (or placket strips) along centre front, halfway between each pair of buttons (cm) */
function frontGaps(G: Garment3D, role: string, holes: Attachment) {
  const O = G.panels.find((p) => !p.attach && p.piece.role === role && p.instance === holes.instance)!;
  const U = G.panels.find((p) => !p.attach && p.piece.role === role && p.instance !== holes.instance)!;
  const at3 = (P: typeof O, x: number, y: number) => { const L = locate(P.mesh, { x, y }); return [0, 1, 2].map((k) => L.v.reduce((s2, v, n) => s2 + G.sim.pos[(P.offset + v) * 3 + k] * L.w[n], 0)); };
  const n = holes.hardware!.count ?? 1, sp = holes.hardware!.spacing ?? 0, y0 = holes.y - ((n - 1) / 2) * sp;
  const gaps: number[] = [];
  for (let k = 0; k + 1 < n; k++) { const y = y0 + (k + 0.5) * sp, a = at3(O, 0, y), b = at3(U, 0, y); gaps.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])); }
  return gaps;
}

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

/** polo with the collar popped up */
const poppedPolo = (): [Piece[], Edits] => [makePreset('polo', DEFAULT_BODY), { ...EMPTY_EDITS, collar: 'up' }];
/** tee with a folded neck tag caught in the back neck seam and a patch on the inside of the front */
function taggedTee(): [Piece[], Edits] {
  const pieces = makePreset('basic-tee', DEFAULT_BODY);
  const bk = pieces.find((p) => p.role === 'back')!, fr = pieces.find((p) => p.role === 'front')!;
  return [pieces, { ...EMPTY_EDITS, attachments: [
    { id: 'nt', kind: 'label', name: 'Neck tag', pieceId: bk.id, x: 0, y: 3.4, rotation: 0, w: 5, h: 2.5, outline: 'rect', layers: [], label: { type: 'woven', sewn: 'folded-loop', color: '#111' } },
    { id: 'ip', kind: 'patch', name: 'Inside patch', pieceId: fr.id, x: 8, y: 25, rotation: 0, w: 8, h: 8, outline: 'rect', layers: [], face: 'inside' },
  ] }];
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
  ['polo', 'jacks', poppedPolo], ['basic-tee', 'hug', taggedTee],
];
for (const [g, mode, make] of process.env.CUSTOM_ONLY ? ([] as typeof cases) : cases) {
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
// ---- hats stay on through every movement: the crown centre and brim checked in the head's own frame ----
console.log('\n== hats in motion ==');
for (const g of process.env.CUSTOM_ONLY ? [] : (['bucket-hat', 'cap'] as StyleId[])) for (const mode of ['walk', 'sit', 'jacks', 'cross', 'hug'] as Mode[]) {
  const col = new PosedCollider(mesh.grid, [f.ankleH + 6, f.crotchH + 1], f);
  const G = assemble(g, makePreset(g, DEFAULT_BODY), DEFAULT_BODY, 1.8, col)!;
  const sim = G.sim;
  for (let i = 0; i < 200; i++) sim.step();
  const rest = hatPose(G, f);
  sim.sleeping = false; sim.awake = true;
  let worst = 0, worstY = 0, M = boneMatrices(f, poseAt(mode, 0, f));
  for (let i = 0; i < 300; i++) {
    sim.substepHook = (k, n) => { const Mk = boneMatrices(f, poseAt(mode, (i + (k + 1) / n) / 60, f)); col.setPose(Mk, invert(Mk)); };
    sim.step();
    M = boneMatrices(f, poseAt(mode, (i + 1) / 60, f));
    const p = hatPose(G, f, invert(M));
    worst = Math.max(worst, p.axis); worstY = Math.max(worstY, Math.abs(p.y - rest.y));
  }
  const end = hatPose(G, f, invert(M));
  let bad = 0; for (const v of sim.pos) if (!Number.isFinite(v)) bad++;
  const ok = bad === 0 && worst < 2 && worstY < 1.5 && end.lr < 1;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${g.padEnd(11)} ${mode.padEnd(6)} stays on the head: crown centre up to ${worst.toFixed(2)} cm off the axis, up to ${worstY.toFixed(2)} cm up or down, brim tilt ${end.lr.toFixed(2)} cm, NaN ${bad}`);
}

// ---- fronts that button: held closed by their buttons while moving (gap between the fronts halfway between buttons) ----
console.log('\n== buttoned fronts in motion ==');
for (const [g, mode] of ([['button-up', 'walk'], ['jacket', 'jacks'], ['jacket', 'hug'], ['polo', 'walk']] as [StyleId, Mode][]).filter(() => !process.env.CUSTOM_ONLY)) {
  const col = new PosedCollider(mesh.grid, [f.ankleH + 6, f.crotchH + 1], f);
  const pieces = makePreset(g, DEFAULT_BODY);
  const edits = styleEdits(g, pieces, DEFAULT_BODY, { ...EMPTY_EDITS, collar: 'down' });
  const holes = edits.attachments.find((a) => a.buttonhole)!;
  const role = g === 'polo' ? 'placket' : 'front';
  const G = assemble(g, pieces, DEFAULT_BODY, 1.8, col, edits)!;
  const sim = G.sim;
  for (let i = 0; i < 200; i++) sim.step();
  sim.sleeping = false; sim.awake = true;
  let worst = 0;
  for (let i = 0; i < 150; i++) {
    sim.substepHook = (k, n) => { const M = boneMatrices(f, poseAt(mode, (i + (k + 1) / n) / 60, f)); col.setPose(M, invert(M)); };
    sim.step();
    if (i % 10 === 9) worst = Math.max(worst, ...frontGaps(G, role, holes));
  }
  let bad = 0; for (const v of sim.pos) if (!Number.isFinite(v)) bad++;
  const ok = bad === 0 && worst < 0.5 && G.buttoned.length === holes.hardware!.count;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${g.padEnd(10)} ${mode.padEnd(6)} ${G.buttoned.length} buttons buttoned, widest gap between buttons while moving ${worst.toFixed(2)} cm, NaN ${bad}`);
}

// ---- custom pose: the user moves joints with sliders; the body follows at a capped joint speed like the worker ----
console.log('\n== custom pose ==');
const D = Math.PI / 180;
const side = (o: Partial<SideAngles>): SideAngles => ({ ...ZERO_SIDE, ...o });
const pose = (a: Partial<SideAngles>, b: Partial<SideAngles>, rest: Partial<CustomPose> = {}): CustomPose => ({ ...ZERO_POSE, s: [side(a), side(b)], ...rest });
const ARMS_UP = pose({ shAbd: 160 * D, elbow: 10 * D }, { shAbd: 160 * D, elbow: 10 * D });
const KNEE = pose({ hipFlex: 70 * D, knee: 100 * D }, {});
const LEAN = pose({ shFlex: 60 * D, elbow: 50 * D }, { shFlex: -30 * D }, { spineBend: 35 * D, spineTwist: 25 * D, headTurn: 50 * D });
// clamping: out of range angles stop at the anatomical limit
{
  const c = clampPose(pose({ elbow: 4, knee: -1 }, { shAbd: 99 }, { spineTwist: Number.NaN }));
  const lim = (k: string) => POSE_LIMITS.find((l) => l.key === k)!.range;
  const ok = c.s[0].elbow === lim('elbow')[1] && c.s[0].knee === 0 && c.s[1].shAbd === lim('shAbd')[1] && c.spineTwist === 0;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} custom pose angles clamp to POSE_LIMITS`);
}
const POSE_SPEED = 2.5; // rad/s, same as the worker
const customCases: [string, StyleId, Body, CustomPose, CustomPose?][] = [
  ['arms raised', 'jacket', DEFAULT_BODY, ARMS_UP],
  ['arms raised', 'basic-tee', FEMALE_BODY, ARMS_UP],
  ['one knee bent', 'jeans', DEFAULT_BODY, KNEE],
  ['one knee bent', 'sweatpants', FEMALE_BODY, KNEE],
  ['lean, twist, head turn', 'button-up', DEFAULT_BODY, LEAN],
  ['slider jump: arms up then knee', 'polo', FEMALE_BODY, ARMS_UP, KNEE],
];
for (const [label, g, body, p1, p2] of customCases) {
  const fb = bodyFrame(body);
  const fieldB = body === DEFAULT_BODY ? field : calibratedField(body);
  const meshB = body === DEFAULT_BODY ? mesh : meshField(fieldB);
  const col = new PosedCollider(meshB.grid, [fb.ankleH + 6, fb.crotchH + 1], fb);
  const G = assemble(g, makePreset(g, body), body, 1.8, col)!;
  const sim = G.sim;
  for (let i = 0; i < 200; i++) sim.step();
  sim.sleeping = false; sim.awake = true;
  let cur: CustomPose = ZERO_POSE, target = p1;
  const N = p2 ? 220 : 150;
  for (let i = 0; i < N; i++) {
    if (p2 && i === 90) target = p2; // the user drags another slider before the first move settled
    const prev = cur;
    cur = stepPose(cur, target, POSE_SPEED / 60);
    sim.substepHook = (k, n) => { const M = boneMatrices(fb, poseAt('custom', (i + (k + 1) / n) / 60, fb, lerpPose(prev, cur, (k + 1) / n))); col.setPose(M, invert(M)); };
    sim.step();
  }
  let bad = 0; for (const v of sim.pos) if (!Number.isFinite(v)) bad++;
  const M = boneMatrices(fb, poseAt('custom', N / 60, fb, cur));
  const probe = new PosedCollider(meshB.grid); probe.thickness = -1.0; probe.setPose(M, invert(M));
  const tmp = new Float32Array(3), o = { nx: 0, ny: 0, nz: 0, depth: 0 };
  let inside = 0;
  for (let i = 0; i < sim.n; i++) { tmp.set(sim.pos.subarray(i * 3, i * 3 + 3)); if (probe.project(tmp, 0, o)) inside++; }
  let mx = -1e9, mn = 1e9; for (let i = 1; i < sim.pos.length; i += 3) { mx = Math.max(mx, sim.pos[i]); mn = Math.min(mn, sim.pos[i]); }
  // still on the body: a top keeps its neckline at the (posed) neck, trousers keep the waistband at the waist
  const J = jointPoints(fb, M);
  const pants = g === 'jeans' || g === 'sweatpants';
  const on = pants ? mx > fb.waistH - 8 && mx < fb.waistH + 6 && mn < fb.kneeH : mx > J[0][1] - 4 && mn < fb.waistH;
  const reached = Math.abs(cur.s[0].shAbd - target.s[0].shAbd) < 1e-9 && Math.abs(cur.s[0].knee - target.s[0].knee) < 1e-9;
  const ok = bad === 0 && inside / sim.n < 0.03 && on && reached;
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} custom ${label.padEnd(32)} ${g.padEnd(11)} ${body.sex ?? 'male'}  y ${mn.toFixed(0)}..${mx.toFixed(0)}  neck ${J[0][1].toFixed(0)}  deep-inside ${(100 * inside / sim.n).toFixed(1)}%  NaN ${bad}${on ? '' : '  (slid off)'}${reached ? '' : '  (pose not reached)'}`);
}

console.log(fails ? `${fails} FAILED` : 'all motion checks passed');
process.exit(fails ? 1 : 0);
