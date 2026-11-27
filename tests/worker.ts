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
await import('../src/sim/worker');
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

console.log(fails ? `\n${fails} worker path check(s) failed` : '\nworker path: all ok');
process.exit(fails ? 1 : 0);
