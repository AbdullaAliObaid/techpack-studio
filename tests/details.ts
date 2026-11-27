// Run: npx tsx tests/details.ts
import { makePreset, type GarmentType } from '../src/data/presets';
import { DEFAULT_BODY } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import { calibratedField } from '../src/three/bodyField';
import { meshField, GridCollider } from '../src/three/mesher';
import { buildDetails, ANCHOR } from '../src/sim/details';
import { migrateGarment, styleById } from '../src/data/catalog';
import { buildHardware } from '../src/sim/detailsHardware';
import { buildAttachmentDetails, outwardSignsHosted } from '../src/sim/detailsAttach';
import { hardwareGlyph } from '../src/lib/trims';
import type { Attachment } from '../src/data/edits';

const FF = calibratedField(DEFAULT_BODY);
const collider = new GridCollider(meshField(FF).grid, [FF.f.ankleH + 6, FF.f.crotchH + 1]);
let fail = 0;
const check = (ok: boolean, msg: string) => { if (!ok) { fail++; console.log('FAIL', msg); } };

// buttons, belt loops and rivets are attachments on the pattern now (src/data/construction.ts): the stitching pass adds none
const expect: Record<string, { dashes: [number, number]; loops?: [number, number]; rivets?: [number, number]; buttons?: [number, number] }> = {
  jacket: { dashes: [300, 40000] },
  shirt: { dashes: [200, 40000] },
  pants: { dashes: [500, 40000] },
};
for (const g of ['jacket', 'shirt', 'pants'] as GarmentType[]) {
  const G = assemble(g, makePreset(g, DEFAULT_BODY), DEFAULT_BODY, 1.8, collider)!;
  const t0 = performance.now();
  const m = buildDetails(G, styleById(migrateGarment(g)).details);
  const ms = performance.now() - t0;
  const kinds = (k: number) => Array.from(m.anchorKind).filter((x) => x === k).length;
  console.log(g, 'dashes', m.dashCount, 'loops', kinds(ANCHOR.loop), 'rivets', kinds(ANCHOR.rivet), 'buttons', kinds(ANCHOR.button), 'palette', m.palette.join(' '), ms.toFixed(0) + 'ms');
  const ex = expect[g];
  check(m.dashCount >= ex.dashes[0] && m.dashCount <= ex.dashes[1], `${g} dash count ${m.dashCount}`);
  const rng = (v: number, r?: [number, number]) => (r ? v >= r[0] && v <= r[1] : v === 0);
  check(rng(kinds(ANCHOR.loop), ex.loops), `${g} loops`);
  check(rng(kinds(ANCHOR.rivet), ex.rivets), `${g} rivets`);
  check(rng(kinds(ANCHOR.button), ex.buttons), `${g} buttons`);
  const okTri = (tri: Uint32Array, w: Float32Array, i: number) => {
    let s = 0;
    for (let j = 0; j < 3; j++) {
      check(tri[i * 3 + j] < m.n, `${g} index range`);
      const v = w[i * 3 + j];
      check(v >= -1e-6 && v <= 1 + 1e-6, `${g} weight ${v}`);
      s += v;
    }
    check(Math.abs(s - 1) < 1e-4, `${g} weights sum ${s}`);
  };
  for (let i = 0; i < m.dashCount * 2; i++) okTri(m.dashTri, m.dashW, i);
  for (let i = 0; i < m.anchorCount; i++) okTri(m.anchorTri, m.anchorW, i);
  // dashes should be short on the cloth (no teleporting between far apart particles)
  let longest = 0;
  for (let i = 0; i < m.dashCount; i++) {
    const p = (o: number) => { let x = 0, y = 0, z = 0; for (let j = 0; j < 3; j++) { const v = m.dashTri[i * 6 + o + j] * 3, w = m.dashW[i * 6 + o + j]; x += w * G.sim.pos[v]; y += w * G.sim.pos[v + 1]; z += w * G.sim.pos[v + 2]; } return [x, y, z]; };
    const a = p(0), b = p(3);
    longest = Math.max(longest, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  let bad = 0; for (let i = 0; i < m.dashCount; i++) { const p = (o: number) => { let x = 0, y = 0, z = 0; for (let j = 0; j < 3; j++) { const v = m.dashTri[i * 6 + o + j] * 3, w = m.dashW[i * 6 + o + j]; x += w * G.sim.pos[v]; y += w * G.sim.pos[v + 1]; z += w * G.sim.pos[v + 2]; } return [x, y, z]; }; const a = p(0), b = p(3); if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) > 1.2) bad++; }
  console.log("  long dashes", bad, "max", longest.toFixed(2));
  check(bad < m.dashCount * 0.03, `${g} long dashes ${bad}`);
}
// hardware and stitching of an attachment with `instance` appear on that copy only
{
  const pcs = makePreset('pants', DEFAULT_BODY);
  const G = assemble('pants', pcs, DEFAULT_BODY, 1.8, collider)!;
  const leg = pcs.find((p) => p.role === 'front')!;
  const ys = leg.points.map((p) => p.y), xs = leg.points.map((p) => p.x);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, y0 = Math.min(...ys);
  const base = { kind: 'hardware' as const, name: 't', pieceId: leg.id, x: cx, y: y0 + 25, rotation: 0, w: 4, h: 1, outline: 'rect' as const, layers: [] };
  const mk = (id: string, instance: number | undefined, hw: Attachment['hardware']): Attachment => ({ ...base, id, instance, hardware: hw });
  const rivets = mk('r', 1, { type: 'rivet', finish: 'copper', size: 1, count: 3, spacing: 3 });
  const both = mk('b', undefined, { type: 'eyelet', finish: 'brass', size: 1, count: 2, spacing: 3 });
  const zip = { ...mk('z', 0, { type: 'zipper', finish: 'silver', size: 1.2, open: true }), h: 10 };
  const signs = outwardSignsHosted(G.panels, G.sim.pos);
  const panelOf = (v: number) => G.panels.findIndex((P) => v >= P.offset && v < P.offset + P.mesh.uv.length);
  const inst = (tri: Uint32Array, i: number) => G.panels[panelOf(tri[i * 3])].instance;
  const hm = buildHardware(G, [rivets, both, zip], signs);
  let r = 0, e = 0;
  for (let i = 0; i < hm.count; i++) { if (hm.kind[i] === 0) { r++; check(inst(hm.tri, i) === 1, 'instance 1 rivet on the wrong copy'); } else e++; }
  check(r === 3, `rivets on one copy: ${r}`);
  check(e === 4, `eyelets on both copies: ${e}`);
  check(hm.zipCount === 1, `zipper count ${hm.zipCount}`);
  for (let i = 0; i < hm.zipLen[0]; i++) check(inst(hm.zipTri, hm.zipStart[0] + i) === 0, 'zipper on the wrong copy');
  check(hm.zipLen[0] >= 20, `zipper samples ${hm.zipLen[0]}`);
  for (let i = 0; i < hm.count; i++) { let s = 0; for (let j = 0; j < 3; j++) s += hm.w[i * 3 + j]; check(Math.abs(s - 1) < 1e-4, 'hardware weights sum'); }
  // stitching: a patch on instance 1 only gets dashes on that copy
  const patch: Attachment = { ...base, id: 'p', kind: 'patch', instance: 1, w: 6, h: 6, outline: 'rect' };
  const ad = buildAttachmentDetails(G, [patch]);
  check(ad.dashCount > 10, `patch dashes ${ad.dashCount}`);
  for (let i = 0; i < ad.dashCount; i++) check(inst(ad.dashTri, i * 2) === 1, 'patch stitch on the wrong copy');
  const glyph = hardwareGlyph({ type: 'zipper', finish: 'silver', size: 1, open: false }, 10);
  check(glyph.length >= 3 && glyph.every((g) => /^M/.test(g.d)), 'zipper glyph');
  check(hardwareGlyph({ type: 'rivet', finish: 'silver', size: 1, count: 3, spacing: 2 }).length === 9, 'rivet row glyph');
  console.log('hardware per copy ok:', hm.count, 'trims', hm.zipLen[0], 'zip samples');
}
console.log(fail ? `${fail} failures` : 'details ok');
process.exit(fail ? 1 : 0);
