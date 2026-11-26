// Run: npx tsx tests/drape.ts   (every catalog style drapes on the default body; BODY=female for the female preset)
// Checks: no NaN, seams closed, strain sane, the garment stays where it belongs (hats on the head, pants on the hips).
import { makePreset } from '../src/data/presets';
import { CATALOG } from '../src/data/catalog';
import { DEFAULT_BODY, DEFAULT_BODY as MALE, FEMALE_BODY, bodyFrame } from '../src/three/body';
import { assemble, type Garment3D } from '../src/sim/setup';
import type { Edits } from '../src/data/edits';
import type { Piece } from '../src/data/presets';
import type { StyleId } from '../src/data/catalog';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider } from '../src/three/mesher';

const DEFAULT_BODY = process.env.BODY === 'female' ? FEMALE_BODY : MALE;
const FF = calibratedField(DEFAULT_BODY);
const f = bodyFrame(DEFAULT_BODY);
const collider = new GridCollider(meshField(FF).grid, [FF.f.ankleH + 6, FF.f.crotchH + 1]);
const SP = Number(process.env.SP ?? 1.8);
const only = process.argv[2];
let fails = 0;

function drape(g: StyleId, pieces: Piece[], edits?: Edits, label: string = g): { ok: boolean; G: Garment3D } {
  const style = CATALOG.find((s) => s.id === g)!;
  const t0 = performance.now();
  const G = assemble(g, pieces, DEFAULT_BODY, SP, collider, edits)!;
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
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(14)} ${sim.n} particles, ${ns} sew links | build ${(t1 - t0).toFixed(0)}ms | ${frames} frames ${((t3 - t2) / frames).toFixed(1)}ms/frame | NaN ${bad} | y ${minY.toFixed(1)}..${maxY.toFixed(1)} (${where}) | seam gap avg ${avgGap.toFixed(2)}cm, open ${open} | strain p50 ${(p50 * 100).toFixed(1)}% p99 ${(p99 * 100).toFixed(1)}%, p98 ${(r98 * 100).toFixed(0)}% of safe`);
  if (!ok || process.env.V) console.log(`     worst ${(st[wi] * 100).toFixed(0)}% on ${pan.piece.name}${pan.mirror ? ' (L)' : ''} at pattern (${uvw.x.toFixed(1)}, ${uvw.y.toFixed(1)}) world y ${sim.pos[wi * 3 + 1].toFixed(1)}`);
  return { ok, G };
}

for (const style of CATALOG) {
  if (only && style.id !== only) continue;
  drape(style.id, makePreset(style.id, DEFAULT_BODY));
}

// ---- garment edits: attachments, detached seams, pleats ----
const verdict = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
const dist = (G: Garment3D, a: number, b: number) => Math.hypot(G.sim.pos[a * 3] - G.sim.pos[b * 3], G.sim.pos[a * 3 + 1] - G.sim.pos[b * 3 + 1], G.sim.pos[a * 3 + 2] - G.sim.pos[b * 3 + 2]);
/** every attachment point stays on its host: close to the host cloth, never wandering off */
function staysOn(G: Garment3D, id: string) {
  const A = G.panels.filter((p) => p.attach?.id === id);
  let worst = 0, sum = 0, n = 0;
  for (const P of A) {
    const H = G.panels[P.attach!.host];
    for (let i = 0; i < P.mesh.uv.length; i++) {
      let best = Infinity;
      for (let j = 0; j < H.mesh.uv.length; j++) best = Math.min(best, dist(G, P.offset + i, H.offset + j));
      worst = Math.max(worst, best); sum += best; n++;
    }
  }
  return { copies: A.length, worst, avg: n ? sum / n : Infinity };
}
const E = (e: Partial<Edits>): Edits => ({ attachments: [], customSeams: [], detachedSeams: [], pleats: [], ...e });
if (!only || only === 'edits') {
  console.log('\n== edits ==');
  {
    const pieces = makePreset('jeans', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const edits = E({ attachments: [{ id: 'bp', kind: 'pocket', name: 'Back pocket', pieceId: back.id, x: 1, y: 13, rotation: 0, w: 14, h: 15, outline: 'pointed', layers: [] }] });
    const { ok, G } = drape('jeans', pieces, edits, 'jeans+pocket');
    const s = staysOn(G, 'bp');
    verdict(ok && s.copies === 2 && s.worst < 2.5 && s.avg < 1.2, `jeans back pocket on both back legs (${s.copies}), stays on: avg ${s.avg.toFixed(2)}cm worst ${s.worst.toFixed(2)}cm from the back leg`);
  }
  {
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const front = pieces.find((p) => p.role === 'front')!;
    const edits = E({ attachments: [{ id: 'cp', kind: 'patch', name: 'Chest patch', pieceId: front.id, x: 11, y: 26, rotation: 10, w: 8, h: 8, outline: 'rounded', layers: [] }] });
    const { ok, G } = drape('basic-tee', pieces, edits, 'tee+patch');
    const s = staysOn(G, 'cp');
    verdict(ok && s.copies === 1 && s.worst < 2 && s.avg < 1.2, `tee chest patch stays on: avg ${s.avg.toFixed(2)}cm worst ${s.worst.toFixed(2)}cm from the front`);
  }
  {
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const ref = assemble('basic-tee', pieces, DEFAULT_BODY, SP, collider)!;
    const links = ref.seamLinks['side-r'], other = ref.seamLinks['side-l'];
    const { G } = drape('basic-tee', pieces, E({ detachedSeams: ['side-r'] }), 'tee-side-r');
    const gap = (ls: [number, number][]) => ls.reduce((a, [i, j]) => a + dist(G, i, j), 0) / ls.length;
    const max = Math.max(...links.map(([i, j]) => dist(G, i, j)));
    verdict(gap(links) > 1 && max > 3 && gap(other) < 0.6, `detached right side seam opens: gap avg ${gap(links).toFixed(2)}cm max ${max.toFixed(1)}cm, left side stays shut ${gap(other).toFixed(2)}cm`);
  }
  {
    const pieces = makePreset('jeans', DEFAULT_BODY);
    const front = pieces.find((p) => p.role === 'front')!;
    const w0 = front.points.find((q) => q.key === 'front.0')!;
    // pleated trousers are drafted wider at the waist by the pleat intake, so the waistband still fits
    front.points.find((q) => q.key === 'front.1')!.x += 3;
    const edits = E({ pleats: [{ id: 'kp', pieceId: front.id, pointId: w0.id, t: 0.55, depth: 1.5, length: 7, type: 'knife', direction: 1 }] });
    const { ok, G } = drape('jeans', pieces, edits, 'jeans+pleat');
    const ls = G.seamLinks['pleat:kp'] ?? [];
    const gap = ls.reduce((a, [i, j]) => a + dist(G, i, j), 0) / (ls.length || 1);
    verdict(ok && ls.length === 2 && gap < 0.3, `knife pleat on both front legs: folded shut at the waist to ${gap.toFixed(2)}cm`);
  }
  {
    // a belt loop on the jeans: sewn at both ends, the middle stands off as a loop
    const pieces = makePreset('jeans', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const edits = E({ attachments: [{ id: 'bl', kind: 'strap', name: 'Belt loop', pieceId: back.id, x: 6, y: 3, rotation: 0, w: 1.2, h: 5, outline: 'rect', layers: [] }] });
    const { ok, G } = drape('jeans', pieces, edits, 'jeans+loop');
    const s = staysOn(G, 'bl');
    verdict(ok && s.copies === 2 && s.worst < 3 && s.worst > s.avg, `belt loop on both back legs stays on and stands off: avg ${s.avg.toFixed(2)}cm, middle ${s.worst.toFixed(2)}cm off the leg`);
  }
  {
    // user pieces: an elbow patch on both sleeves, and a hem extension sewn onto the front hem
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const sleeve = pieces.find((p) => p.role === 'sleeve')!, front = pieces.find((p) => p.role === 'front')!;
    const pt = (id: string, x: number, y: number) => ({ id, x, y, smooth: false, mirror: null });
    const patch: Piece = { id: 'up1', name: 'Elbow patch', role: 'custom', cut: 1, offset: { x: 0, y: 0 }, symmetric: false, fabric: sleeve.fabric, specs: [],
      points: [pt('a', 0, 0), pt('b', 6, 0), pt('c', 6, 5), pt('d', 0, 5)], placement: { mode: 'patch', hostPieceId: sleeve.id, x: 0, y: 12, rotation: 0 } };
    const ext: Piece = { id: 'up2', name: 'Hem extension', role: 'custom', cut: 1, offset: { x: 0, y: 0 }, symmetric: false, fabric: front.fabric, specs: [],
      points: [pt('e', 0, 0), pt('f', 27.5, 0), pt('g', 27.5, 6), pt('h', 0, 6)], placement: { mode: 'sewn' } };
    const k = (key: string) => front.points.find((q) => q.key === key)!.id;
    const edits = E({ customSeams: [{ id: 'ext', a: { pieceId: 'up2', fromId: 'e', toId: 'f' }, b: { pieceId: front.id, fromId: k('front.8'), toId: k('front.7') } }] });
    const { ok, G } = drape('basic-tee', [...pieces, patch, ext], edits, 'tee+user');
    const s = staysOn(G, 'up1');
    const ls = G.seamLinks.ext ?? [];
    const gap = ls.reduce((a, [i, j]) => a + dist(G, i, j), 0) / (ls.length || 1);
    const E2 = G.panels.find((p) => p.piece.id === 'up2');
    verdict(ok && s.copies === 2 && s.worst < 2 && !!E2 && ls.length > 10 && gap < 0.6, `user pieces: elbow patch on both sleeves (worst ${s.worst.toFixed(2)}cm off), hem extension sewn on (${ls.length} links, gap ${gap.toFixed(2)}cm)`);
  }
  {
    // an applique cut as letters on the tee back: every letter stays on the back
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const edits = E({ attachments: [{ id: 'tx', kind: 'applique', name: 'Letters', pieceId: back.id, x: 0, y: 20, rotation: 0, w: 22, h: 6, outline: 'shape', shape: 'text', text: 'TECH', layers: [] }] });
    const { ok, G } = drape('basic-tee', pieces, edits, 'tee+letters');
    const s = staysOn(G, 'tx');
    verdict(ok && s.copies === 4 && s.worst < 2 && s.avg < 1.2, `applique letters on the back: ${s.copies} pieces stay on, avg ${s.avg.toFixed(2)}cm worst ${s.worst.toFixed(2)}cm from the back`);
  }
  {
    // hardware: rivets on both front legs, a closed zip down the right front: drapes calmly, stays on the hips
    const pieces = makePreset('jeans', DEFAULT_BODY);
    const front = pieces.find((p) => p.role === 'front')!;
    const edits = E({ attachments: [
      { id: 'rv', kind: 'hardware', name: 'Rivets', pieceId: front.id, x: 10, y: 4, rotation: 0, w: 1, h: 1, outline: 'rect', layers: [], hardware: { type: 'rivet', finish: 'copper', size: 0.9, count: 3, spacing: 1.5 } },
      { id: 'zp', kind: 'hardware', name: 'Zip', pieceId: front.id, x: 6, y: 30, rotation: 0, w: 1, h: 18, outline: 'rect', layers: [], instance: 0, hardware: { type: 'zipper', finish: 'brass', size: 1 } },
    ] });
    const { ok } = drape('jeans', pieces, edits, 'jeans+trims');
    verdict(ok, 'rivets and a closed zip drape without trouble');
  }
}
console.log(fails ? `\n${fails} FAILED` : '\nall drape checks passed');
process.exit(fails ? 1 : 0);
