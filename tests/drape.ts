// Run: npx tsx tests/drape.ts   (every catalog style drapes on the default body; BODY=female for the female preset)
// Checks: no NaN, seams closed, strain sane, the garment stays where it belongs (hats on the head, pants on the hips).
import { makePreset } from '../src/data/presets';
import { CATALOG } from '../src/data/catalog';
import { DEFAULT_BODY, DEFAULT_BODY as MALE, FEMALE_BODY, bodyFrame } from '../src/three/body';
import { assemble, locate, type Garment3D } from '../src/sim/setup';
import type { Attachment, Edits } from '../src/data/edits';
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
      const { ok, G } = drape(st, makePreset(st, DEFAULT_BODY), E({ collar: cs }), `${st} ${cs}`);
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
    const C0 = G0.panels.find((p) => p.piece.role === 'collar')!, F0 = G0.panels.find((p) => p.piece.role === 'front')!;
    const at3 = (P: typeof C0, x: number, y: number) => { const L = locate(P.mesh, { x, y }); return [0, 1, 2].map((k) => L.v.reduce((s2, v, n) => s2 + G0.sim.pos[(P.offset + v) * 3 + k] * L.w[n], 0)); };
    const under = (x: number, y: number) => {
      const p = at3(C0, x, y);
      let bj = 0, bd = Infinity;
      F0.mesh.uv.forEach((_, j) => { const q = F0.offset + j; const d = Math.hypot(G0.sim.pos[q * 3] - p[0], G0.sim.pos[q * 3 + 1] - p[1], G0.sim.pos[q * 3 + 2] - p[2]); if (d < bd) { bd = d; bj = j; } });
      return { uv: F0.mesh.uv[bj], d: bd };
    };
    const ur = under(bx, by), ul = under(-bx, by);
    const all = [...tips, btn('fbr', front.id, ur.uv.x, ur.uv.y), btn('fbl', front.id, ul.uv.x, ul.uv.y)];
    const { ok, G } = drape('button-up', pieces, E({ collar: 'down', attachments: all }), 'button-down');
    const pairs = Object.entries(G.seamLinks).filter(([k]) => k.startsWith('fasten:'));
    const gaps = pairs.map(([, ls]) => ls.map(([i, j]) => dist(G, i, j))[0] ?? Infinity);
    // the collar points stay on the shirt front
    const C = G.panels.find((p) => p.piece.role === 'collar')!, F = G.panels.find((p) => p.piece.role === 'front')!;
    const tipOff = [bx, -bx].map((x) => { const L = locate(C.mesh, { x, y: by }); const v = C.offset + L.v[L.w.indexOf(Math.max(...L.w))]; let bd = Infinity; for (let j = 0; j < F.mesh.uv.length; j++) bd = Math.min(bd, dist(G, v, F.offset + j)); return bd; });
    verdict(ok && pairs.length === 2 && gaps.every((g) => g < 0.8) && tipOff.every((d) => d < 1.5), `button-down collar: ${pairs.length} collar points buttoned (gaps ${gaps.map((g) => g.toFixed(2)).join(', ')} cm), points ${tipOff.map((d) => d.toFixed(2)).join(' / ')} cm off the front (rest on their own ${ur.d.toFixed(2)} / ${ul.d.toFixed(2)} cm)`);
    // popped up, the points are far from the front buttons: nothing buttons
    const Gu = assemble('button-up', pieces, DEFAULT_BODY, SP, collider, E({ collar: 'up', attachments: all }))!;
    verdict(!Object.keys(Gu.seamLinks).some((k) => k.startsWith('fasten:')), 'collar up: the collar point buttons do not reach the front buttons');
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall drape checks passed');
process.exit(fails ? 1 : 0);
