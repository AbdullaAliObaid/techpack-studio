// Run: npx tsx tests/drape.ts   (every catalog style drapes on the default body; BODY=female for the female preset)
// Sections (argv[2]): a style id, 'edits', 'collar', 'collar-edits'.
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
import { meshField, GridCollider } from '../src/three/mesher';
import { styleEdits } from '../src/data/construction';

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
    for (const bodyName of ['male', 'female'] as const) {
      if (bodyName === 'female' && DEFAULT_BODY.sex !== 'female' && st !== 'jacket') continue;
      const pieces = makePreset(st, DEFAULT_BODY);
      const edits = styleEdits(st, pieces, DEFAULT_BODY, E({ collar: 'down' }));
      const holes = edits.attachments.find((a) => a.buttonhole)!;
      const role = st === 'polo' ? 'placket' : 'front';
      const { ok, G } = drape(st, pieces, edits, `${st} buttoned`);
      const gaps = frontGaps(G, role, holes);
      const n = holes.hardware!.count!;
      verdict(ok && G.buttoned.length === n && Math.max(...gaps) < 0.5, `${st}: ${G.buttoned.length} of ${n} buttons buttoned, fronts between buttons ${gaps.map((g) => g.toFixed(2)).join(' / ')} cm apart`);
      break;
    }
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
        const r = run(assemble(st, pieces, DEFAULT_BODY, SP, collider, E({ collar: cs }))!);
        verdict(r.ok, `${st} collar ${cs}, ${name}: ${r.msg}`);
      }
    }
    {
      // warm start: drape the drafted shirt, then the user makes the collar longer and the neck edge no longer matches
      const pieces = makePreset(st, DEFAULT_BODY);
      const G0 = assemble(st, pieces, DEFAULT_BODY, SP, collider, E({ collar: 'down' }))!;
      for (let k = 0; k < 600 && !G0.sim.sleeping; k++) G0.sim.step();
      const p2 = pieces.map((p) => ({ ...p, points: p.points.map((q) => ({ ...q })) }));
      EDITS['neck edge +3 cm'](p2.find((p) => p.role === 'collar')!);
      EDITS['points 4 cm longer'](p2.find((p) => p.role === 'collar')!);
      const G = assemble(st, p2, DEFAULT_BODY, SP, collider, E({ collar: 'down' }))!;
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
      const r = run(assemble(st, re, DEFAULT_BODY, SP, collider, E({ collar: 'down' }))!);
      verdict(r.ok, `${st} collar down, 4 cm longer then regraded: ${r.msg}`);
    }
  }
}

console.log(fails ? `\n${fails} FAILED` : '\nall drape checks passed');
process.exit(fails ? 1 : 0);
