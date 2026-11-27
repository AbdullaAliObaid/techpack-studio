// Run: npx tsx tests/drape.ts   (every catalog style drapes on the default body; BODY=female for the female preset)
// Sections (argv[2]): a style id, 'edits', 'collar', 'collar-edits', 'hats', 'height'.
// Checks: no NaN, seams closed, strain sane, the garment stays where it belongs (hats on the head, pants on the hips).
import { makePreset } from '../src/data/presets';
import { CATALOG } from '../src/data/catalog';
import { DEFAULT_BODY, DEFAULT_BODY as MALE, FEMALE_BODY, bodyFrame } from '../src/three/body';
import { assemble, locate, warmStart, type Garment3D } from '../src/sim/setup';
import { draft, regradePoints } from '../src/data/draft';
import type { Attachment, Edits } from '../src/data/edits';
import type { Piece } from '../src/data/presets';
import type { StyleId } from '../src/data/catalog';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider, PosedCollider } from '../src/three/mesher';
import { hatPose } from './hatLib';
import { styleEdits } from '../src/data/construction';
import { fabricThickness } from '../src/data/fabrics';

const DEFAULT_BODY = process.env.BODY === 'female' ? FEMALE_BODY : MALE;
const FF = calibratedField(DEFAULT_BODY);
const f = bodyFrame(DEFAULT_BODY);
const collider = new GridCollider(meshField(FF).grid, [FF.f.ankleH + 6, FF.f.crotchH + 1]);
const SP = Number(process.env.SP ?? 1.8);
const only = process.argv[2];
let fails = 0;

function drape(g: StyleId, pieces: Piece[], edits?: Edits, label: string = g, safe = 2.5): { ok: boolean; G: Garment3D } {
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
  const ok = bad === 0 && avgGap < 0.6 && open / ns < 0.02 && p99 < 0.2 && p50 < 0.03 && r98 < safe && placed;
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
/** edits with the style's own details (buttons and buttonholes): split fronts hang open without them, as worn unbuttoned */
const SE = (st: StyleId, pieces: Piece[], e: Partial<Edits>): Edits => styleEdits(st, pieces, DEFAULT_BODY, E(e));
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
// ---- collar up / down, inside face, tags, button-down collar ----
if (!only || only === 'collar') {
  console.log('\n== collar ==');
  /** centre back of the collar: neckline seam, highest point (the roll when down) and outer edge, heights over the neck base */
  const collarCB = (G: Garment3D) => {
    const C = G.panels.find((p) => p.piece.role === 'collar' && !p.attach)!, P = G.sim.pos;
    const cH = C.piece.points.find((q) => q.key === 'collar.3')!.y;
    const pick = (lo: number, hi: number) => C.mesh.uv.map((q, i) => ({ q, i: C.offset + i })).filter((e) => Math.abs(e.q.x) <= 3 && e.q.y >= lo && e.q.y <= hi);
    const avg = (vs: { i: number }[], k: number) => vs.reduce((a, e) => a + P[e.i * 3 + k], 0) / vs.length;
    const r = (vs: { i: number }[]) => vs.reduce((a, e) => a + Math.hypot(P[e.i * 3], P[e.i * 3 + 2]), 0) / vs.length;
    const seam = pick(0, 0.05), edge = pick(cH - 0.05, cH + 1), all = pick(-1, 99);
    // round the neck: every collar point within 13 cm of the neck axis, between the shoulders and the ears
    let around = true;
    for (let i = C.offset; i < C.offset + C.mesh.uv.length; i++) if (Math.hypot(P[i * 3], P[i * 3 + 2]) > 13 || P[i * 3 + 1] < f.neckH - 14 || P[i * 3 + 1] > f.neckH + 14) around = false;
    return { cH, seam: avg(seam, 1) - f.neckH, seamR: r(seam), edge: avg(edge, 1) - f.neckH, edgeR: r(edge), top: Math.max(...all.map((e) => P[e.i * 3 + 1])) - f.neckH, around };
  };
  for (const st of ['polo', 'button-up', 'collared-tee', 'jacket'] as StyleId[]) {
    for (const cs of ['down', 'up'] as const) {
      const pc = makePreset(st, DEFAULT_BODY);
      const { ok, G } = drape(st, pc, SE(st, pc, { collar: cs }), `${st} ${cs}`);
      const c = collarCB(G);
      const shape = cs === 'up'
        // popped: the outer edge stands well above the seam and the neck base
        ? c.edge - c.seam > 0.6 * c.cH && c.edge > 6
        // down: folded at the roll line, the fall outside the stand and down to the seam or past it
        : c.top - c.seam > 1.2 && c.edge < c.seam + 0.5 && c.edgeR > c.seamR;
      verdict(ok && c.around && shape, `${st} collar ${cs}: round the neck ${c.around}, CB seam +${c.seam.toFixed(1)} cm, ${cs === 'down' ? `roll +${c.top.toFixed(1)}, ` : ''}outer edge ${c.edge >= 0 ? '+' : ''}${c.edge.toFixed(1)} cm (${(c.edgeR - c.seamR).toFixed(1)} cm out from the seam), collar ${c.cH.toFixed(1)} cm`);
    }
  }
  {
    // attachments on the collar stay put up and down: a patch on the top collar fall at centre back, embroidery on the stand
    const pieces = makePreset('polo', DEFAULT_BODY);
    const collar = pieces.find((p) => p.role === 'collar')!;
    for (const cs of ['down', 'up'] as const) {
      const edits = E({ collar: cs, attachments: [
        { id: 'cp', kind: 'patch', name: 'Collar patch', pieceId: collar.id, x: 0, y: 5.5, rotation: 0, w: 4, h: 2, outline: 'rounded', layers: [] },
        { id: 'uc', kind: 'patch', name: 'Under collar patch', pieceId: collar.id, x: 8, y: 5.5, rotation: 0, w: 3, h: 2, outline: 'rect', layers: [], face: 'inside' },
      ] });
      const { ok, G } = drape('polo', pieces, edits, `polo patch ${cs}`);
      const a = staysOn(G, 'cp'), b = staysOn(G, 'uc');
      verdict(ok && a.copies === 1 && a.worst < 1.5 && b.worst < 1.5, `collar ${cs}: top collar patch stays on (worst ${a.worst.toFixed(2)} cm), under collar patch stays on (worst ${b.worst.toFixed(2)} cm)`);
    }
  }
  {
    // inside face: a patch on the inside of the tee back stays on and between the back and the body
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const edits = E({ attachments: [{ id: 'ip', kind: 'patch', name: 'Inside patch', pieceId: back.id, x: 0, y: 24, rotation: 0, w: 10, h: 8, outline: 'rect', layers: [], face: 'inside' }] });
    const { ok, G } = drape('basic-tee', pieces, edits, 'tee+inside');
    const s = staysOn(G, 'ip');
    const A = G.panels.find((p) => p.attach?.id === 'ip')!, H = G.panels[A.attach!.host];
    // the back faces -z: inside is the +z side of the back cloth near it
    let inner = 0;
    for (let i = 0; i < A.mesh.uv.length; i++) {
      let bj = 0, bd = Infinity;
      for (let j = 0; j < H.mesh.uv.length; j++) { const d = dist(G, A.offset + i, H.offset + j); if (d < bd) { bd = d; bj = j; } }
      if (G.sim.pos[(A.offset + i) * 3 + 2] > G.sim.pos[(H.offset + bj) * 3 + 2]) inner++;
    }
    verdict(ok && s.worst < 2 && inner / A.mesh.uv.length > 0.9, `inside patch stays on the back (worst ${s.worst.toFixed(2)} cm) and under it: ${inner} of ${A.mesh.uv.length} points between the back and the body`);
  }
  {
    // a woven neck tag folded into the back neck seam, and a leather tag sewn all round on the back
    const pieces = makePreset('basic-tee', DEFAULT_BODY);
    const back = pieces.find((p) => p.role === 'back')!;
    const edits = E({ attachments: [
      { id: 'nt', kind: 'label', name: 'Neck tag', pieceId: back.id, x: 0, y: 3.4, rotation: 0, w: 5, h: 2.5, outline: 'rect', layers: [], label: { type: 'woven', sewn: 'folded-loop', color: '#111' } },
      { id: 'lt', kind: 'label', name: 'Leather tag', pieceId: back.id, x: 0, y: 50, rotation: 0, w: 6, h: 4, outline: 'rect', layers: [], face: 'outside', label: { type: 'leather', sewn: 'all-round', color: '#7a4b2a' } },
    ] });
    const { ok, G } = drape('basic-tee', pieces, edits, 'tee+tags');
    const a = staysOn(G, 'nt'), b = staysOn(G, 'lt');
    const nt = G.panels.find((p) => p.attach?.id === 'nt')!;
    verdict(ok && a.copies === 1 && a.worst < 2.5 && b.worst < 1.5 && nt.attach!.face === 'inside', `neck tag inside the back neck stays on (worst ${a.worst.toFixed(2)} cm, the fold hangs free), leather tag stays on (worst ${b.worst.toFixed(2)} cm)`);
  }
  {
    // button-down collar: a button on each collar point buttons onto a button on the shirt front under it
    const pieces = makePreset('button-up', DEFAULT_BODY);
    const collar = pieces.find((p) => p.role === 'collar')!, front = pieces.find((p) => p.role === 'front')!;
    const c2 = collar.points.find((q) => q.key === 'collar.2')!;
    const bx = c2.x - 2.6, by = c2.y - 1.4;
    const btn = (id: string, pieceId: string, x: number, y: number): Attachment => ({ id, kind: 'hardware', name: id, pieceId, x, y, rotation: 0, w: 1, h: 1, outline: 'rect', layers: [], hardware: { type: 'button', finish: 'white', size: 1.1, holes: 4 } });
    const tips = [btn('cbr', collar.id, bx, by), btn('cbl', collar.id, -bx, by)];
    // where the collar points come to rest on their own: the front buttons go there
    const { G: G0 } = drape('button-up', pieces, E({ collar: 'down', attachments: tips }), 'shirt tips');
    // split fronts: each collar point rests on its own front (left front copy 0, right front copy 1)
    const C0 = G0.panels.find((p) => p.piece.role === 'collar')!, F0s = G0.panels.filter((p) => p.piece.role === 'front' && !p.attach);
    const at3 = (P: typeof C0, x: number, y: number) => { const L = locate(P.mesh, { x, y }); return [0, 1, 2].map((k) => L.v.reduce((s2, v, n) => s2 + G0.sim.pos[(P.offset + v) * 3 + k] * L.w[n], 0)); };
    const under = (x: number, y: number) => {
      const p = at3(C0, x, y);
      let best = { uv: F0s[0].mesh.uv[0], d: Infinity, inst: 0 };
      for (const F0 of F0s) F0.mesh.uv.forEach((uv, j) => { const q = F0.offset + j; const d = Math.hypot(G0.sim.pos[q * 3] - p[0], G0.sim.pos[q * 3 + 1] - p[1], G0.sim.pos[q * 3 + 2] - p[2]); if (d < best.d) best = { uv, d, inst: F0.instance }; });
      return best;
    };
    const ur = under(bx, by), ul = under(-bx, by);
    const all = [...tips, { ...btn('fbr', front.id, ur.uv.x, ur.uv.y), instance: ur.inst }, { ...btn('fbl', front.id, ul.uv.x, ul.uv.y), instance: ul.inst }];
    const { ok, G } = drape('button-up', pieces, E({ collar: 'down', attachments: all }), 'button-down');
    const pairs = Object.entries(G.seamLinks).filter(([k]) => k.startsWith('fasten:'));
    const gaps = pairs.map(([, ls]) => ls.map(([i, j]) => dist(G, i, j))[0] ?? Infinity);
    // the collar points stay on the shirt fronts
    const C = G.panels.find((p) => p.piece.role === 'collar')!, Fs = G.panels.filter((p) => p.piece.role === 'front' && !p.attach);
    const tipOff = [bx, -bx].map((x) => { const L = locate(C.mesh, { x, y: by }); const v = C.offset + L.v[L.w.indexOf(Math.max(...L.w))]; let bd = Infinity; for (const F of Fs) for (let j = 0; j < F.mesh.uv.length; j++) bd = Math.min(bd, dist(G, v, F.offset + j)); return bd; });
    verdict(ok && pairs.length === 2 && gaps.every((g) => g < 0.8) && tipOff.every((d) => d < 1.5), `button-down collar: ${pairs.length} collar points buttoned (gaps ${gaps.map((g) => g.toFixed(2)).join(', ')} cm), points ${tipOff.map((d) => d.toFixed(2)).join(' / ')} cm off the front (rest on their own ${ur.d.toFixed(2)} / ${ul.d.toFixed(2)} cm)`);
    // popped up, the points are far from the front buttons: nothing buttons
    const Gu = assemble('button-up', pieces, DEFAULT_BODY, SP, collider, E({ collar: 'up', attachments: all }))!;
    verdict(!Object.keys(Gu.seamLinks).some((k) => k.startsWith('fasten:')), 'collar up: the collar point buttons do not reach the front buttons');
  }
}

// ---- fronts that button: split fronts held closed only at the buttons, an open jacket, every style with its details ----
/** world position of a pattern point on a placed copy of a piece */
const at3 = (G: Garment3D, P: Garment3D['panels'][number], x: number, y: number) => {
  const L = locate(P.mesh, { x, y });
  return [0, 1, 2].map((k) => L.v.reduce((s2, v, n) => s2 + G.sim.pos[(P.offset + v) * 3 + k] * L.w[n], 0));
};
/** gap between the two fronts (or placket strips) along centre front, halfway between each pair of buttons (cm) */
export function frontGaps(G: Garment3D, role: string, holes: Attachment) {
  const O = G.panels.find((p) => !p.attach && p.piece.role === role && p.instance === holes.instance)!;
  const U = G.panels.find((p) => !p.attach && p.piece.role === role && p.instance !== holes.instance)!;
  const n = holes.hardware!.count ?? 1, sp = holes.hardware!.spacing ?? 0, y0 = holes.y - ((n - 1) / 2) * sp;
  const gaps: number[] = [];
  for (let k = 0; k + 1 < n; k++) {
    const y = y0 + (k + 0.5) * sp, a = at3(G, O, 0, y), b = at3(G, U, 0, y);
    gaps.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return gaps;
}
if (!only || only === 'closure') {
  console.log('\n== fronts that button ==');
  for (const st of ['button-up', 'jacket', 'polo'] as StyleId[]) {
    const pieces = makePreset(st, DEFAULT_BODY);
    const edits = styleEdits(st, pieces, DEFAULT_BODY, E({ collar: 'down' }));
    const holes = edits.attachments.find((a) => a.buttonhole)!;
    const { ok, G } = drape(st, pieces, edits, `${st} buttoned`);
    const gaps = frontGaps(G, st === 'polo' ? 'placket' : 'front', holes);
    const n = holes.hardware!.count!;
    verdict(ok && G.buttoned.length === n && Math.max(...gaps) < 0.5, `${st}: ${G.buttoned.length} of ${n} buttons buttoned, fronts between buttons ${gaps.map((g) => g.toFixed(2)).join(' / ')} cm apart`);
  }
  {
    // worn open: nothing buttons, the fronts hang apart at centre front
    const pieces = makePreset('jacket', DEFAULT_BODY);
    const edits = styleEdits('jacket', pieces, DEFAULT_BODY, E({ collar: 'down', closure: 'open' }));
    const { ok, G } = drape('jacket', pieces, edits, 'jacket open');
    const L = G.panels.find((p) => !p.attach && p.piece.role === 'front' && p.instance === 0)!, R = G.panels.find((p) => !p.attach && p.piece.role === 'front' && p.instance === 1)!;
    const ext = -Math.min(...L.piece.points.map((q) => q.x));
    const ys = [30, 45, 60];
    // the front edges: the left front's edge is at +x of the right front's edge when they overlap; open, they part
    const parts = ys.map((y) => at3(G, L, -ext, y)[0] - at3(G, R, -ext, y)[0]);
    const fastened = Object.keys(G.seamLinks).filter((k) => k.startsWith('fasten:')).length;
    verdict(ok && fastened === 0 && G.buttoned.length === 0 && parts.every((d) => d > 0.5), `open jacket: ${fastened} buttons fastened, front edges ${parts.map((d) => d.toFixed(1)).join(' / ')} cm apart at ${ys.join(', ')} cm down`);
  }
}
if (!only || only === 'details') {
  console.log('\n== every style with its details ==');
  for (const style of CATALOG) {
    const pieces = makePreset(style.id, DEFAULT_BODY);
    const edits = styleEdits(style.id, pieces, DEFAULT_BODY, E(pieces.some((p) => p.role === 'collar') ? { collar: 'down' } : {}));
    const { ok, G } = drape(style.id, pieces, edits, `${style.id}+det`);
    const cloth = edits.attachments.filter((a) => a.kind === 'pocket' || a.kind === 'strap');
    const worst = Math.max(0, ...cloth.map((a) => staysOn(G, a.id).worst));
    verdict(ok && worst < 3, `${style.id} with its ${edits.attachments.length} style details drapes, cloth details stay on (worst ${worst.toFixed(2)} cm)`);
  }
}

// ---- edited collars: made longer, taller, or with a neck edge that no longer matches the neckline ----
// A user drags collar points in the 2D editor (symmetry on: the mirror point follows). Every such collar must drape
// calmly: no NaN, no blow-up recovery, nothing thrown about once it has settled, nothing far from the body, the
// collar still round the neck. Also the same edits arriving as a warm start (how the app rebuilds after an edit)
// and after a regrade to new measurements with the pattern linked.
if (!only || only === 'collar-edits') {
  console.log('\n== edited collars ==');
  const BM = meshField(FF);
  const bv: number[] = [];
  for (let i = 0; i < BM.positions.length; i += 6) bv.push(BM.positions[i], BM.positions[i + 1], BM.positions[i + 2]);
  /** furthest cloth point from the body surface (cm, against every other body mesh vertex) */
  const farthest = (P: Float32Array, n: number) => {
    let w = 0;
    for (let i = 0; i < n; i++) {
      let b = Infinity;
      for (let j = 0; j < bv.length && b > w * w; j += 3) { const d = (P[i * 3] - bv[j]) ** 2 + (P[i * 3 + 1] - bv[j + 1]) ** 2 + (P[i * 3 + 2] - bv[j + 2]) ** 2; if (d < b) b = d; }
      if (b > w * w) w = Math.sqrt(b);
    }
    return w;
  };
  /** move a keyed collar point like movePoint with symmetry on */
  const mv = (p: Piece, k: string, dx: number, dy: number) => {
    const pt = p.points.find((q) => q.key === k)!, onAxis = pt.mirror === pt.id, nx = onAxis ? 0 : pt.x + dx, ny = pt.y + dy;
    p.points = p.points.map((q) => (q.id === pt.id ? { ...q, x: nx, y: ny } : !onAxis && q.id === pt.mirror ? { ...q, x: -nx, y: ny } : q));
  };
  const EDITS: Record<string, (c: Piece) => void> = {
    '2 cm longer': (c) => { mv(c, 'collar.1', 1, 0); mv(c, 'collar.2', 1, 0); },
    '4 cm longer': (c) => { mv(c, 'collar.1', 2, 0); mv(c, 'collar.2', 2, 0); },
    'points 4 cm longer': (c) => mv(c, 'collar.2', 2, 0),
    '2 cm taller': (c) => { mv(c, 'collar.2', 0, 2); mv(c, 'collar.3', 0, 2); },
    'neck edge +3 cm': (c) => mv(c, 'collar.1', 1.5, 0),
  };
  const run = (G: Garment3D) => {
    const sim = G.sim;
    let frames = 0, late = 0;
    while (!sim.sleeping && frames < 600) {
      sim.step(); frames++;
      // once the seams are closed and the cloth has had a second to fall: nothing may still be thrown about
      if (frames > sim.sewFrames + 60) for (let i = 0; i < sim.n; i++) late = Math.max(late, Math.hypot(sim.vel[i * 3], sim.vel[i * 3 + 1], sim.vel[i * 3 + 2]));
    }
    let bad = 0;
    for (let i = 0; i < sim.pos.length; i++) if (!Number.isFinite(sim.pos[i])) bad++;
    const C = G.panels.find((p) => p.piece.role === 'collar' && !p.attach)!, P = sim.pos;
    // round the neck: every collar point near the neck axis (a taller collar, popped, flares out further at its front
    // corners: allowed 0.6 cm per cm of collar height at centre back), between the shoulders and the ears
    const cH = C.piece.points.find((q) => q.key === 'collar.3')!.y - C.piece.points.find((q) => q.key === 'collar.0')!.y;
    const rMax = 12 + 0.6 * cH;
    let around = true;
    for (let i = C.offset; i < C.offset + C.mesh.uv.length; i++) if (Math.hypot(P[i * 3], P[i * 3 + 2]) > rMax || P[i * 3 + 1] < f.neckH - 14 || P[i * 3 + 1] > f.neckH + 16) around = false;
    // the neckline seam of the collar stays on the neckline (closed, no pulling apart)
    const links = G.seamLinks.collar ?? [];
    const gap = links.reduce((a, [i, j]) => a + Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]), 0) / (links.length || 1);
    const far = farthest(P, sim.n);
    const ok = bad === 0 && sim.recoveries === 0 && late < 500 && far < 25 && around && gap < 0.6;
    return { ok, msg: `NaN ${bad}, recoveries ${sim.recoveries}, settled max speed ${late.toFixed(0)} cm/s, furthest ${far.toFixed(1)} cm off the body, round the neck ${around}, collar seam gap ${gap.toFixed(2)} cm` };
  };
  for (const st of ['polo', 'collared-tee', 'button-up', 'jacket'] as StyleId[]) {
    for (const cs of ['down', 'up'] as const) {
      for (const [name, edit] of Object.entries(EDITS)) {
        const pieces = makePreset(st, DEFAULT_BODY);
        edit(pieces.find((p) => p.role === 'collar')!);
        const r = run(assemble(st, pieces, DEFAULT_BODY, SP, collider, SE(st, pieces, { collar: cs }))!);
        verdict(r.ok, `${st} collar ${cs}, ${name}: ${r.msg}`);
      }
    }
    {
      // warm start: drape the drafted shirt, then the user makes the collar longer and the neck edge no longer matches
      const pieces = makePreset(st, DEFAULT_BODY);
      const ed = SE(st, pieces, { collar: 'down' });
      const G0 = assemble(st, pieces, DEFAULT_BODY, SP, collider, ed)!;
      for (let k = 0; k < 600 && !G0.sim.sleeping; k++) G0.sim.step();
      const p2 = pieces.map((p) => ({ ...p, points: p.points.map((q) => ({ ...q })) }));
      EDITS['neck edge +3 cm'](p2.find((p) => p.role === 'collar')!);
      EDITS['points 4 cm longer'](p2.find((p) => p.role === 'collar')!);
      const G = assemble(st, p2, DEFAULT_BODY, SP, collider, ed)!;
      const warm = warmStart(G, G0);
      const r = run(G);
      verdict(warm && r.ok, `${st} collar down, edited after draping (warm start): ${r.msg}`);
    }
    {
      // pattern linked to the body: a collar edited on other measurements, then regraded to this body
      const from = { ...DEFAULT_BODY, neck: DEFAULT_BODY.neck + 3, chest: DEFAULT_BODY.chest + 6 };
      const pieces = makePreset(st, from);
      EDITS['4 cm longer'](pieces.find((p) => p.role === 'collar')!);
      const a = draft(st, from), b = draft(st, DEFAULT_BODY);
      const re = pieces.map((pc) => {
        const da = a.find((d) => d.role === pc.role), db = b.find((d) => d.role === pc.role);
        return da && db ? { ...pc, points: regradePoints(pc.points, da.points, db.points) } : pc;
      });
      const r = run(assemble(st, re, DEFAULT_BODY, SP, collider, SE(st, re, { collar: 'down' }))!);
      verdict(r.ok, `${st} collar down, 4 cm longer then regraded: ${r.msg}`);
    }
  }
}

// ---- hats stay on: a long settle on the posed collider the app uses, the crown centred on the head, the brim level ----
if (!only || only === 'hats') {
  console.log('\n== hats ==');
  const grid = meshField(FF).grid;
  for (const g of ['bucket-hat', 'cap'] as StyleId[]) {
    const col = new PosedCollider(grid, [FF.f.ankleH + 6, FF.f.crotchH + 1], f);
    const G = assemble(g, makePreset(g, DEFAULT_BODY), DEFAULT_BODY, SP, col)!;
    G.sim.awake = true; // never sleeps: any slow creep would show
    for (let i = 0; i < 60; i++) G.sim.step();
    const a = hatPose(G, f);
    for (let i = 0; i < 1140; i++) G.sim.step();
    const b = hatPose(G, f);
    const ok = b.axis < 2 && Math.abs(b.y - a.y) < 1 && b.lr < 1 && b.fb < 4 && b.y > f.headBandH;
    verdict(ok, `${g.padEnd(11)} after 20 s: crown centre ${b.axis.toFixed(2)} cm off the head axis, moved ${(b.y - a.y).toFixed(2)} cm, brim tilt left/right ${b.lr.toFixed(2)} cm, front/back ${b.fb.toFixed(2)} cm`);
  }
}

// ---- other heights: a top must not climb the body while sewn (it left the collar in the neck and a fold caught at the
// waist at 173 cm); drape on the posed collider the app uses, collar worn down as new projects have it ----
if (!only || only === 'height') {
  console.log('\n== height 173 ==');
  const body = { ...DEFAULT_BODY, height: 173 };
  const fb = bodyFrame(body);
  const FB = calibratedField(body), gridB = meshField(FB).grid;
  for (const g of ['basic-tee', 'button-up', 'polo', 'jacket', 'jeans'] as StyleId[]) {
    const col = new PosedCollider(gridB, [fb.ankleH + 6, fb.crotchH + 1], fb);
    const pieces = makePreset(g, body);
    const G = assemble(g, pieces, body, SP, col, pieces.some((p) => p.role === 'collar') ? E({ collar: 'down' }) : undefined)!;
    G.sim.awake = true; // the worker keeps it awake for the first seconds
    let k = 0, rise = 0;
    const neckband = G.panels.filter((p) => p.piece.role === 'collar' || p.piece.role === 'neckband');
    const y0 = neckband.length ? Math.max(...neckband.flatMap((p) => p.mesh.uv.map((_, i) => G.sim.pos[(p.offset + i) * 3 + 1]))) : 0;
    while (k < 420) {
      G.sim.step(); k++;
      if (neckband.length && k <= G.sim.sewFrames) rise = Math.max(rise, Math.max(...neckband.flatMap((p) => p.mesh.uv.map((_, i) => G.sim.pos[(p.offset + i) * 3 + 1]))) - y0);
    }
    // folds: along each pattern column of the body pieces, places where the cloth runs back up (a catch)
    let folds = 0;
    for (const P of G.panels) {
      if (P.attach || (P.piece.role !== 'front' && P.piece.role !== 'back')) continue;
      const cols = new Map<number, number[]>();
      P.mesh.uv.forEach((q, i) => { const c = Math.round(q.x / 2); if (!cols.has(c)) cols.set(c, []); cols.get(c)!.push(i); });
      for (const idx of cols.values()) {
        idx.sort((a, b) => P.mesh.uv[a].y - P.mesh.uv[b].y);
        for (let j = 1; j < idx.length; j++) if (P.mesh.uv[idx[j]].y - P.mesh.uv[idx[j - 1]].y > 1 && G.sim.pos[(P.offset + idx[j]) * 3 + 1] > G.sim.pos[(P.offset + idx[j - 1]) * 3 + 1] + 0.3) folds++;
      }
    }
    // collar or neckband inside the neck
    const probe = new PosedCollider(gridB); probe.thickness = -0.2;
    const tmp = new Float32Array(3), o = { nx: 0, ny: 0, nz: 0, depth: 0 };
    let inNeck = 0, nb = 0;
    for (const P of neckband) for (let i = 0; i < P.mesh.uv.length; i++) { nb++; tmp.set(G.sim.pos.subarray((P.offset + i) * 3, (P.offset + i) * 3 + 3)); if (probe.project(tmp, 0, o)) inNeck++; }
    let mx = -1e9; for (let i = 1; i < G.sim.pos.length; i += 3) mx = Math.max(mx, G.sim.pos[i]);
    const top = g !== 'jeans';
    const ok = folds <= 5 && inNeck === 0 && (top ? mx > fb.neckH - 1 && mx < fb.neckH + 10 && rise < 4 : mx > fb.waistH - 6 && mx < fb.waistH + 3);
    verdict(ok, `${g.padEnd(10)} at 173 cm: ${folds} folds on the body pieces, top at ${mx.toFixed(1)} (neck ${fb.neckH.toFixed(1)}, waist ${fb.waistH.toFixed(1)})${top ? `, collar rose ${rise.toFixed(1)} cm while sewn, ${inNeck} of ${nb} collar points in the neck` : ''}`);
  }
}

// ---- fabric thickness: a lining or stacked patches add weight, thickness and stiffness (src/data/stack.ts) ----
if (!only || only === 'thick') {
  console.log('\n== thickness and layer stacks ==');
  type P3 = Garment3D['panels'][number];
  const X = (G: Garment3D, i: number) => [G.sim.pos[i * 3], G.sim.pos[i * 3 + 1], G.sim.pos[i * 3 + 2]];
  const body = (G: Garment3D) => G.panels.filter((p) => !p.attach && (p.piece.role === 'front' || p.piece.role === 'back'));
  /** mean world height of the hem (the bottom 1.5 cm of the pattern) of the body panels */
  const hemY = (G: Garment3D) => {
    let s2 = 0, n = 0;
    for (const P of body(G)) {
      const maxY = Math.max(...P.mesh.uv.map((q) => q.y));
      P.mesh.uv.forEach((q, v) => { if (q.y > maxY - 1.5) { s2 += G.sim.pos[(P.offset + v) * 3 + 1]; n++; } });
    }
    return s2 / n;
  };
  /**
   * folds of the body panels: across rows of the lower body, each point that stands out from its neighbours two
   * points either side by over 2.5 mm is a fold crest (count); and the mean angle between neighbouring triangles away
   * from the edges and seams (deg): fewer, larger folds read as fewer crests and a smoother surface
   */
  const folds = (G: Garment3D) => {
    let crests = 0, sum = 0, n = 0;
    for (const P of body(G)) {
      const ys = P.mesh.uv.map((q) => q.y), y0 = Math.min(...ys), y1 = Math.max(...ys), sg = P.piece.role === 'front' ? 1 : -1;
      for (let t = 0.45; t <= 0.951; t += 0.05) {
        const yr = y0 + (y1 - y0) * t;
        const row = P.mesh.uv.map((q, v) => ({ q, v })).filter((r) => Math.abs(r.q.y - yr) < 0.9).sort((a, b) => a.q.x - b.q.x);
        const z = row.map((r) => sg * G.sim.pos[(P.offset + r.v) * 3 + 2]);
        for (let i = 2; i < z.length - 2; i++) if (z[i] - (z[i - 2] + z[i + 2]) / 2 > 0.25 && z[i] >= z[i - 1] && z[i] >= z[i + 1]) crests++;
      }
      const { tris, uv, boundary } = P.mesh, nrm: number[][] = [], seen = new Map<string, number>();
      const near = uv.map((q) => boundary.some((b) => (uv[b].x - q.x) ** 2 + (uv[b].y - q.y) ** 2 < 9));
      for (let t = 0; t < tris.length; t += 3) {
        const [a, b, c] = [tris[t], tris[t + 1], tris[t + 2]].map((v) => X(G, P.offset + v));
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const m = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], l = Math.hypot(m[0], m[1], m[2]) || 1;
        nrm.push(m.map((x) => x / l));
        for (let e = 0; e < 3; e++) {
          const i = tris[t + e], j = tris[t + ((e + 1) % 3)];
          if (near[i] || near[j]) continue;
          const k = i < j ? `${i},${j}` : `${j},${i}`, o = seen.get(k);
          if (o === undefined) { seen.set(k, t / 3); continue; }
          const A = nrm[o], B = nrm[t / 3];
          sum += (Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2]))) * 180) / Math.PI; n++;
        }
      }
    }
    return { crests, mean: sum / n };
  };
  /** share of body panel points resting on the skin */
  const onSkin = (G: Garment3D) => {
    const copy = Float32Array.from(G.sim.pos), out = { nx: 0, ny: 0, nz: 0, depth: 0 };
    let hit = 0, n = 0;
    for (const P of body(G)) for (let v = 0; v < P.mesh.uv.length; v++) { n++; if (collider.project(copy, (P.offset + v) * 3, out)) hit++; }
    return hit / n;
  };
  /** out of plane spread of points (cm rms about their mean plane): low = flat and stiff, high = sagging or buckled */
  const spread = (G: Garment3D, idx: number[]) => {
    const c = [0, 1, 2].map((k) => idx.reduce((s2, i) => s2 + G.sim.pos[i * 3 + k], 0) / idx.length);
    // the plane's normal: the smallest spread direction, by power iteration on the inverse is overkill; use the
    // normal of the best of three axis aligned cross products of the covariance
    const C = [0, 1, 2].map((a) => [0, 1, 2].map((b) => idx.reduce((s2, i) => s2 + (G.sim.pos[i * 3 + a] - c[a]) * (G.sim.pos[i * 3 + b] - c[b]), 0) / idx.length));
    const cr = (u: number[], w: number[]) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const cands = [cr(C[0], C[1]), cr(C[1], C[2]), cr(C[0], C[2])];
    const nv = cands.reduce((b, q) => (Math.hypot(...q) > Math.hypot(...b) ? q : b)), l = Math.hypot(...nv) || 1;
    return Math.sqrt(idx.reduce((s2, i) => s2 + (((G.sim.pos[i * 3] - c[0]) * nv[0] + (G.sim.pos[i * 3 + 1] - c[1]) * nv[1] + (G.sim.pos[i * 3 + 2] - c[2]) * nv[2]) / l) ** 2, 0) / idx.length);
  };
  const pieces = makePreset('basic-tee', DEFAULT_BODY);
  const front = pieces.find((p) => p.role === 'front')!;
  const lined = (id: string) => Object.fromEntries(pieces.map((p) => [p.id, { id, color: 0 }]));
  const plain = drape('basic-tee', pieces, E({}), 'tee');
  const lea = drape('basic-tee', pieces, E({ insideFabric: lined('leather') }), 'tee+leather');
  // a linen lining barely stretches (2%): the knit tee now strains past what linen takes (the Stretch-Risk-O-Meter shows it)
  const lin = drape('basic-tee', pieces, E({ insideFabric: lined('linen') }), 'tee+linen', 4);
  const [h0, h1, h2] = [plain, lea, lin].map((d) => hemY(d.G));
  const [f0, f1, f2] = [plain, lea, lin].map((d) => folds(d.G));
  const [k0, k1, k2] = [plain, lea, lin].map((d) => onSkin(d.G));
  const report = (n: string, h: number, fo: { crests: number; mean: number }, k: number) => `${n} hem y ${h.toFixed(1)}, ${fo.crests} fold crests, ${fo.mean.toFixed(2)} deg between triangles, ${(k * 100).toFixed(0)}% on skin`;
  console.log(`     ${report('plain', h0, f0, k0)} | ${report('leather', h1, f1, k1)} | ${report('linen', h2, f2, k2)}`);
  verdict(lea.ok && !!lea.G.thick && lea.G.panelThickness![lea.G.panels.findIndex((p) => p.piece.id === front.id)] > 0.16, 'leather lined tee: thicker stack keeps off the body (1.7 mm)');
  // the stiff stack stands a little off the body (it bridges instead of clinging), so the hem may sit up to 1 cm higher
  verdict(lea.ok && h1 <= h0 + 1, `leather lined tee: hem ${h1.toFixed(1)} vs ${h0.toFixed(1)} cm (about the same; it hangs off the shoulders, not the skin: ${(k1 * 100).toFixed(0)}% vs ${(k0 * 100).toFixed(0)}% on skin)`);
  verdict(lea.ok && f1.crests < f0.crests * 0.8 && f1.mean < f0.mean, `leather lined tee: fewer, larger folds (${f1.crests} vs ${f0.crests} crests, ${f1.mean.toFixed(2)} vs ${f0.mean.toFixed(2)} deg)`);
  verdict(lin.ok && Math.abs(h2 - h0) < 1.5 && k2 <= k0, `linen lined tee: light (340 vs 1080 g/m2), hem close to plain (${h2.toFixed(1)} vs ${h0.toFixed(1)}), crisp (${f2.crests} crests)`);
  // unlined garments are untouched: no extra thickness anywhere
  verdict(!plain.G.thick && plain.G.panelThickness!.every((t, i) => Math.abs(t - fabricThickness(plain.G.panels[i].piece.fabric.id) / 10) < 1e-6), 'plain tee: single ply everywhere, no extra thickness');

  // a pocket with a leather lining is stiffer: it sags and buckles less than the same pocket unlined
  const pk = (lining?: { id: string; color: number }): Attachment => ({ id: 'pk', kind: 'pocket', name: 'Pocket', pieceId: front.id, x: 11, y: 27, rotation: 0, w: 12, h: 13, outline: 'rect', layers: [], fabric: { id: 'jersey', color: 0 }, ...(lining ? { lining } : {}) });
  const pp = drape('basic-tee', pieces, E({ attachments: [pk()] }), 'tee+pocket');
  const pl = drape('basic-tee', pieces, E({ attachments: [pk({ id: 'leather', color: 0 })] }), 'tee+lined pkt');
  const pts = (G: Garment3D) => G.panels.filter((p) => p.attach?.id === 'pk').flatMap((P) => P.mesh.uv.map((_, v) => P.offset + v));
  const bcOf = (G: Garment3D) => { const P = G.panels.find((p) => p.attach?.id === 'pk')!; let m = Infinity; for (let c = G.sim.nStretch; c < G.sim.ca.length; c++) if (G.sim.ca[c] >= P.offset && G.sim.ca[c] < P.offset + P.mesh.uv.length && G.sim.cb[c] >= P.offset && G.sim.cb[c] < P.offset + P.mesh.uv.length && G.sim.comp[c] > 0) m = Math.min(m, G.sim.comp[c]); return m; };
  const [s0, s1] = [pp, pl].map((d) => spread(d.G, pts(d.G)));
  const [o0, o1] = [pp, pl].map((d) => staysOn(d.G, 'pk'));
  verdict(pp.ok && pl.ok && bcOf(pl.G) < bcOf(pp.G) / 10 && s1 <= s0 + 0.05 && o1.worst < 2.5, `leather lined pocket stiffer: bend compliance ${bcOf(pl.G).toExponential(1)} vs ${bcOf(pp.G).toExponential(1)}, out of plane ${s1.toFixed(2)} vs ${s0.toFixed(2)} cm, stays on (worst ${o1.worst.toFixed(2)} cm)`);

  // three patches stacked like layered emblems: thicker and stiffer where they overlap than one patch
  const patch = (id: string, w: number): Attachment => ({ id, kind: 'patch', name: id, pieceId: front.id, x: 10, y: 26, rotation: 0, w, h: w, outline: 'rounded', layers: [], fabric: { id: 'canvas', color: 0 } });
  const one = drape('basic-tee', pieces, E({ attachments: [patch('p1', 10)] }), 'tee+1 patch');
  const three = drape('basic-tee', pieces, E({ attachments: [patch('p1', 10), patch('p2', 8), patch('p3', 6)] }), 'tee+3 patches');
  const hostPts = (G: Garment3D) => { const H = G.panels.find((p) => p.piece.id === front.id && !p.attach)!; return H.mesh.uv.flatMap((q, v) => (Math.hypot(q.x - 10, q.y - 26) < 3.5 ? [H.offset + v] : [])); };
  const [r1, r3] = [one, three].map((d) => spread(d.G, hostPts(d.G)));
  const top = staysOn(three.G, 'p3'), single = staysOn(one.G, 'p1');
  const gaps = (G: Garment3D) => { const s3 = G.sim.layerW!; const g: number[] = []; for (let i = 3; i < s3.length; i += 5) g.push(s3[i]); return g; };
  const g3 = Math.max(...gaps(three.G)), g1 = Math.max(...gaps(one.G));
  verdict(one.ok && three.ok && g3 > g1 + 0.1 && r3 <= r1 + 0.05 && top.worst < 2.5, `3 stacked patches: top layer ${g3.toFixed(2)} cm off the host vs ${g1.toFixed(2)}, host under them out of plane ${r3.toFixed(2)} vs ${r1.toFixed(2)} cm, top patch stays on (avg ${top.avg.toFixed(2)} vs ${single.avg.toFixed(2)} cm)`);
}

console.log(fails ? `\n${fails} FAILED` : '\nall drape checks passed');
process.exit(fails ? 1 : 0);
