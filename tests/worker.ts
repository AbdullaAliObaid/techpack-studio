// Run: npx tsx tests/worker.ts   (part of npm run test:motion)
// Drives the simulation worker (src/sim/worker.ts) in node exactly as the 3D view does (ClothView messages), and checks
// that what the app does around a drape never throws the garment off the body:
//   - body hidden (float) while a garment is built, then shown again: it was sewn in the air, through where the body
//     is, and fell off when the body came back ("the clothes fly away")
//   - the body hidden and shown again, a movement picked, or an edit made while the garment is still being sewn
// Each case must end where an undisturbed drape ends (top of the garment, its lowest point), with no NaN.
import { makePreset } from '../src/data/presets';
import { styleEdits } from '../src/data/construction';
import { DEFAULT_BODY, bodyFrame } from '../src/three/body';
import type { StyleId } from '../src/data/catalog';

const msgs: { type: string; [k: string]: unknown }[] = [];
const g = globalThis as unknown as { self: unknown; postMessage: (m: never) => void };
g.self = globalThis;
g.postMessage = (m: never) => msgs.push(m);
const W = await import('../src/sim/worker');
const send = (d: unknown) => (globalThis as unknown as { onmessage: (e: { data: unknown }) => void }).onmessage({ data: d });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const body = DEFAULT_BODY, f = bodyFrame(body);
let fails = 0;
const verdict = (ok: boolean, text: string) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${text}`); };

type Act = { at: number; msg: unknown | ((pieces: ReturnType<typeof makePreset>) => unknown) };
/** build a style, send the actions at their frame numbers, run until it sleeps (or freezes while floating) */
async function run(style: StyleId, acts: Act[], before: unknown[] = []) {
  const pieces = makePreset(style, body);
  const edits = styleEdits(style, pieces, body);
  msgs.length = 0;
  send({ type: 'float', on: false });
  send({ type: 'mode', mode: 'stand' });
  for (const m of before) send(m);
  send({ type: 'build', garment: style, pieces, body, warm: false, spacing: 1.8, edits });
  let frames = 0, last: { pos: Float32Array; sleeping: boolean } | null = null, idle = 0;
  const todo = [...acts];
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    await sleep(10);
    let got = false;
    for (const m of msgs.splice(0)) if (m.type === 'frame') { frames++; got = true; last = m as never; }
    while (todo.length && frames >= todo[0].at) {
      const a = todo.shift()!;
      send(typeof a.msg === 'function' ? (a.msg as (p: typeof pieces) => unknown)(pieces) : a.msg);
    }
    // a frozen (floating) garment stops posting frames
    idle = got ? 0 : idle + 1;
    if (last?.sleeping && !todo.length && idle > 30) break;
    if (!todo.length && idle > 200) break;
  }
  const q = last!.pos;
  let lo = Infinity, hi = -Infinity, bad = 0;
  for (let i = 1; i < q.length; i += 3) { if (!Number.isFinite(q[i])) bad++; lo = Math.min(lo, q[i]); hi = Math.max(hi, q[i]); }
  return { lo, hi, bad, frames };
}

const style: StyleId = 'jacket';
const ref = await run(style, []);
console.log(`reference ${style}: y ${ref.lo.toFixed(1)}..${ref.hi.toFixed(1)} (neck ${f.neckH.toFixed(0)}), ${ref.frames} frames`);
const cases: [string, Act[], unknown[]?][] = [
  ['built with the body hidden, then shown', [{ at: 1e9, msg: null }], [{ type: 'float', on: true }]],
  ['body hidden and shown while sewing', [{ at: 2, msg: { type: 'float', on: true } }, { at: 2, msg: { type: 'float', on: false } }]],
  ['body hidden during the build, shown at frame 1', [{ at: 1, msg: { type: 'float', on: false } }], [{ type: 'float', on: true }]],
  ['movement picked while sewing', [{ at: 2, msg: { type: 'mode', mode: 'walk' } }, { at: 3, msg: { type: 'mode', mode: 'stand' } }]],
  ['edit while sewing (warm start)', [{ at: 5, msg: (p: ReturnType<typeof makePreset>) => ({ type: 'build', garment: style, pieces: p.map((pc, k) => (k ? pc : { ...pc, points: pc.points.map((pt, i) => (i === 1 ? { ...pt, x: pt.x + 0.5 } : pt)) })), body, warm: true, spacing: 1.8, edits: styleEdits(style, p, body) }) }]],
];
// a different under collar fabric is the collar's other ply: it must not stiffen the collar and lift the shirt
{
  const st: StyleId = 'polo';
  const r0 = await run(st, []);
  const poly = (p: ReturnType<typeof makePreset>) => { const e = styleEdits(st, p, body); const col = p.find((q) => q.role === 'collar')!; return { type: 'build', garment: st, pieces: p, body, warm: true, spacing: 1.8, edits: { ...e, insideFabric: { ...(e.insideFabric ?? {}), [col.id]: { ...col.fabric, id: 'poly', color: 0 } } } }; };
  const r1 = await run(st, [{ at: 300, msg: poly }]);
  verdict(r1.bad === 0 && Math.abs(r1.hi - r0.hi) < 2 && Math.abs(r1.lo - r0.lo) < 2, `polo, polyester under collar: y ${r1.lo.toFixed(1)}..${r1.hi.toFixed(1)} vs ${r0.lo.toFixed(1)}..${r0.hi.toFixed(1)}`);
}
for (const [name, acts, before] of cases) {
  // the first case: show the body once the hidden drape has frozen
  let r: { lo: number; hi: number; bad: number; frames: number };
  if (acts[0].at === 1e9) {
    const pieces = makePreset(style, body);
    let idle = 0, any = false;
    msgs.length = 0;
    send({ type: 'float', on: true });
    send({ type: 'build', garment: style, pieces, body, warm: false, spacing: 1.8, edits: styleEdits(style, pieces, body) });
    const t1 = Date.now();
    while (Date.now() - t1 < 60000) { await sleep(10); const got = msgs.splice(0).some((m) => m.type === 'frame'); any ||= got; idle = got ? 0 : idle + 1; if (any && idle > 60) break; }
    send({ type: 'float', on: false });
    let last: { pos: Float32Array; sleeping: boolean } | null = null;
    const t2 = Date.now();
    while (Date.now() - t2 < 30000) { await sleep(10); for (const m of msgs.splice(0)) if (m.type === 'frame') last = m as never; if (last?.sleeping) break; }
    const q = last!.pos;
    let lo = Infinity, hi = -Infinity, bad = 0;
    for (let i = 1; i < q.length; i += 3) { if (!Number.isFinite(q[i])) bad++; lo = Math.min(lo, q[i]); hi = Math.max(hi, q[i]); }
    r = { lo, hi, bad, frames: 0 };
  } else r = await run(style, acts, before);
  const ok = r.bad === 0 && Math.abs(r.hi - ref.hi) < 3 && Math.abs(r.lo - ref.lo) < 4;
  verdict(ok, `${name}: y ${r.lo.toFixed(1)}..${r.hi.toFixed(1)}, NaN ${r.bad}`);
}

// ---- collar up and down (the "Collar up" button warm starts from the drape): the collar must move and the garment
// must stay put; a cold build after a popped collar must drape exactly like a fresh one ----
{
  console.log('\n== collar up and down ==');
  const pieces = makePreset(style, body);
  /** one build after the last, each run until it sleeps; returns the top and the lowest point of each */
  const seq = async (steps: ['up' | 'down', boolean][]) => {
    const out: { lo: number; hi: number; bad: number }[] = [];
    for (const [collar, warm] of steps) {
      msgs.length = 0;
      send({ type: 'build', garment: style, pieces, body, warm, spacing: 1.8, edits: { ...styleEdits(style, pieces, body), collar } });
      let last: { pos: Float32Array; sleeping: boolean } | null = null;
      const t0 = Date.now();
      while (Date.now() - t0 < 60000) { await sleep(10); for (const m of msgs.splice(0)) if (m.type === 'frame') last = m as never; if (last?.sleeping) break; }
      const q = last!.pos;
      let lo = Infinity, hi = -Infinity, bad = 0;
      for (let i = 1; i < q.length; i += 3) { if (!Number.isFinite(q[i])) bad++; lo = Math.min(lo, q[i]); hi = Math.max(hi, q[i]); }
      out.push({ lo, hi, bad });
    }
    return out;
  };
  const [up] = await seq([['up', false]]);
  const [down, wUp, wDown, cDown] = await seq([['down', false], ['up', true], ['down', true], ['down', false]]);
  const y = (r: { lo: number; hi: number }) => `${r.lo.toFixed(1)}..${r.hi.toFixed(1)}`;
  verdict(up.hi > down.hi + 2, `fresh builds: collar up tops out at ${up.hi.toFixed(1)}, down at ${down.hi.toFixed(1)}`);
  verdict(wUp.bad === 0 && Math.abs(wUp.hi - up.hi) < 1.5 && Math.abs(wUp.lo - down.lo) < 2, `collar turned up (warm): y ${y(wUp)}, fresh up ${y(up)}`);
  verdict(wDown.bad === 0 && Math.abs(wDown.hi - down.hi) < 1 && Math.abs(wDown.lo - down.lo) < 2, `then turned back down (warm): y ${y(wDown)}, fresh down ${y(down)}`);
  verdict(Math.abs(cDown.hi - down.hi) < 0.5 && Math.abs(cDown.lo - down.lo) < 0.5, `cold build after a popped collar: y ${y(cDown)}, fresh ${y(down)} (within 0.5 cm)`);
}

// ---- soft skin (src/sim/softSkin.ts): tight cloth presses the skin in, loose cloth and no cloth leave it as measured ----
{
  console.log('\n== soft skin ==');
  const S0 = W.softSkin()!;
  /** deepest dent (mm) among body vertices whose standing height is in [y0, y1] */
  const dentIn = (y0: number, y1: number) => {
    const S = W.softSkin()! as unknown as { rest: Float32Array; dent: Float32Array };
    let m = 0;
    for (let v = 0; v < S.dent.length; v++) { const y = S.rest[v * 3 + 1]; if (y >= y0 && y <= y1) m = Math.max(m, S.dent[v]); }
    return m * 10;
  };
  /** build, drape until it sleeps; returns the mean soft skin ms per frame */
  const drapeOn = async (style: StyleId, simBody: typeof body) => {
    const pieces = makePreset(style, body);
    msgs.length = 0;
    send({ type: 'build', garment: style, pieces, body: simBody, warm: false, spacing: 1.8, edits: styleEdits(style, pieces, body) });
    let frames = 0, ms = 0, last: { sleeping: boolean } | null = null;
    const t0 = Date.now();
    let seen = -1;
    while (Date.now() - t0 < 60000) { await sleep(10); for (const m of msgs.splice(0)) if (m.type === 'frame') { frames++; last = m as never; } if (W.softMs !== seen) { seen = W.softMs; ms += W.softMs; } if (last?.sleeping) break; }
    // the soft skin runs every other frame: its cost per frame is half the cost of a run
    return ms / Math.max(1, frames);
  };
  verdict(!!S0, 'soft skin built with the body');
  // a loose tee: chest, waist and hip girths stay exactly as measured
  await drapeOn('basic-tee', body);
  const tee = Math.max(dentIn(f.chestH - 4, f.chestH + 4), dentIn(f.waistH - 4, f.waistH + 4), dentIn(f.hipH - 4, f.hipH + 4));
  verdict(tee === 0, `loose tee: dent at chest, waist and hip girths ${tee.toFixed(2)} mm (must be 0)`);
  // jeans drafted for an 84 cm waist on an 89 cm waist: the waistband is 5 cm too small and presses in
  const tight = { ...body, waist: body.waist + 5 };
  const ms = await drapeOn('jeans', tight);
  const ft = bodyFrame(tight);
  const waist = dentIn(ft.waistH - 10, ft.waistH + 2);
  verdict(waist >= 2 && waist <= 13, `tight jeans waistband presses the waist in ${waist.toFixed(1)} mm (2 to 13)`);
  verdict(ms < 3, `soft skin costs ${ms.toFixed(2)} ms per frame (under 3)`);
  // turned off: every dent goes at once
  send({ type: 'soft', on: false });
  await sleep(200);
  verdict(dentIn(0, 300) === 0, 'soft skin off: no dents');
  send({ type: 'soft', on: true });
  // no garment on a fresh body: no dents
  msgs.length = 0;
  send({ type: 'build', garment: 'basic-tee', pieces: [], body: { ...body, height: body.height + 1 }, warm: false, spacing: 1.8 });
  await sleep(3000);
  verdict(dentIn(0, 300) === 0, 'no garment: no dents');
}

console.log(fails ? `\n${fails} worker path check(s) failed` : '\nworker path: all ok');
process.exit(fails ? 1 : 0);
