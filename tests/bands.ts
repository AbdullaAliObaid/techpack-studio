// Run: npx tsx tests/bands.ts (part of npm test). A tilted band stays continuous across the side seams.
import { freshProject } from '../src/store';
import { bandRanges } from '../src/components/designDoc';
import type { Band } from '../src/data/edits';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

const p = freshProject('basic-tee');
const front = p.pieces.find((q) => q.role === 'front')!, back = p.pieces.find((q) => q.role === 'back')!;
const mk = (angle?: number): Band => ({ id: 'b', from: 'shoulder', offset: 20, stripes: [{ height: 3, color: '#c00' }], method: 'printed', ...(angle === undefined ? {} : { angle }) });
const sideX = (pc: typeof front, sign: 1 | -1) => sign * Math.max(...pc.points.map((q) => Math.abs(q.x)));
const yAt = (pc: typeof front, b: Band, x: number) => { const s = bandRanges(b, pc)![0]; return s.y0 + (s.slope ?? 0) * x; };

// level band: unchanged, no slope
{
  const f = bandRanges(mk(), front)![0], f0 = bandRanges(mk(0), front)![0];
  ok(f.slope === undefined && f0.slope === undefined && Math.abs(f.y0 - f0.y0) < 1e-9, 'angle 0 is the level band, as before');
  ok(Math.abs(f.y1 - f.y0 - 3) < 1e-9, 'stripe height kept');
}
// tilted: the wearer's left is +x on the front (as worn) and -x on the back (seen from outside)
for (const a of [20, -35, 60]) {
  const b = mk(a);
  const yf = yAt(front, b, sideX(front, 1)), yb = yAt(back, b, sideX(back, -1));
  ok(Math.abs(yf - yb) < 0.3, `angle ${a}: left side seam height matches front and back (${yf.toFixed(2)} vs ${yb.toFixed(2)})`);
  const rf = yAt(front, b, sideX(front, -1)), rb = yAt(back, b, sideX(back, 1));
  ok(Math.abs(rf - rb) < 0.3, `angle ${a}: right side seam matches too`);
}
// tilting lowers the wearer's left side for a positive angle
{
  const b = mk(20);
  ok(yAt(front, b, sideX(front, 1)) > yAt(front, b, 0) && yAt(front, b, sideX(front, -1)) < yAt(front, b, 0), 'positive angle lowers the wearer\'s left');
}
// angle outside the range is clamped
ok(Math.abs((bandRanges(mk(200), front)![0].slope ?? 0) - Math.tan(Math.PI / 3)) < 1e-9, 'angle is clamped to 60 degrees');
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('band tests passed');
