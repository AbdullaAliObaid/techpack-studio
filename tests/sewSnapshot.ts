// Snapshot of the sewing of every catalog style (sew pairs + start positions), used by tests/accuracy.ts
// to prove that sewing from builtinSeams is identical to the hand-written sewing it replaced.
// Regenerate (only after an intended change to drafting or sewing): npx tsx tests/sewSnapshot.ts --write
import { writeFileSync } from 'node:fs';
import { makePreset } from '../src/data/presets';
import { CATALOG } from '../src/data/catalog';
import { DEFAULT_BODY } from '../src/three/body';
import { assemble } from '../src/sim/setup';
import type { Edits } from '../src/data/edits';

export const NO_COLLIDER = { project: () => false, thickness: 0 };

function fnv(h: number, v: number) {
  h ^= v & 0xffff; h = Math.imul(h, 16777619);
  h ^= v >>> 16; h = Math.imul(h, 16777619);
  return h >>> 0;
}

export function sewSignature(style: string, edits?: Edits, pieces = makePreset(style as never, DEFAULT_BODY)) {
  const G = assemble(style as never, pieces, DEFAULT_BODY, 2.2, NO_COLLIDER, edits)!;
  const s = G.sim;
  let sew = 2166136261, n = 0, pos = 2166136261;
  for (let c = 0; c < s.ca.length; c++) if (s.rest[c] === 0) { sew = fnv(fnv(sew, s.ca[c]), s.cb[c]); n++; }
  for (let i = 0; i < s.pos.length; i++) pos = fnv(pos, Math.round(s.pos[i] * 100));
  return { n, sew, pos, particles: s.n, constraints: s.ca.length };
}

if (process.argv.includes('--write')) {
  const out: Record<string, ReturnType<typeof sewSignature>> = {};
  for (const st of CATALOG) out[st.id] = sewSignature(st.id);
  writeFileSync(new URL('./fixtures/sew-baseline.json', import.meta.url), JSON.stringify(out, null, 1) + '\n');
  console.log('wrote tests/fixtures/sew-baseline.json');
}
