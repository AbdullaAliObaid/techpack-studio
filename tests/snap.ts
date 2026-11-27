// Run: npx tsx tests/snap.ts  (part of npm test). Pure magnetism, align, distribute and marquee selection.
import { alignPoints, angleSnap, boxOf, distributePoints, placeBox, snapMove } from '../src/components/snap';
import { designTargets, layerBox, snapBox } from '../src/components/designSnap';
import { chartEntries, pointsInRect } from '../src/components/multi';
import { freshProject } from '../src/store';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const near = (a: number, b: number, e = 1e-9) => Math.abs(a - b) < e;

// a single point snaps exactly onto another point's x, and leaves y alone when nothing is close
{
  const r = snapMove([{ x: 10.04, y: 50 }], [{ x: 10, y: 0, label: 'A' }], 0.1);
  ok(near(10.04 + r.dx, 10), 'single point snaps to the same x exactly');
  ok(r.dy === 0, 'no snap on y when nothing is within the threshold');
  ok(r.guides.length === 1 && r.guides[0].axis === 'x' && r.guides[0].label === 'A', 'one vertical guide with the target label');
  ok(near(r.guides[0].a, 0) && near(r.guides[0].b, 50), 'guide spans from the target to the dragged point');
}
// outside the threshold: nothing happens
{
  const r = snapMove([{ x: 10.2, y: 5 }], [{ x: 10, y: 5.5, label: 'A' }], 0.1);
  ok(r.dx === 0 && r.dy === 0 && r.guides.length === 0, 'beyond the threshold: no snap, no guide');
}
// horizontal line, and both axes together
{
  const r = snapMove([{ x: 3.05, y: 7.97 }], [{ x: 3, y: 100, label: 'V' }, { x: 99, y: 8, label: 'H' }], 0.1);
  ok(near(3.05 + r.dx, 3) && near(7.97 + r.dy, 8), 'snaps x and y at once');
  ok(r.guides.length === 2, 'two guides');
}
// the closest pair wins, and a group moves by one delta
{
  const r = snapMove([{ x: 0, y: 0 }, { x: 10, y: 5 }], [{ x: 10.03, y: 40, label: 'near' }, { x: 0.08, y: 40, label: 'far' }], 0.1);
  ok(near(r.dx, 0.03), 'the closest pair decides the shared shift');
  ok(r.guides[0].label === 'near', 'guide names the winning target');
}
// threshold scales with zoom (caller divides px by k)
{
  const px = 6;
  for (const k of [2, 8]) {
    const thr = px / k;
    const hit = snapMove([{ x: thr * 0.9, y: 0 }], [{ x: 0, label: 'L' }], thr);
    const miss = snapMove([{ x: thr * 1.1, y: 0 }], [{ x: 0, label: 'L' }], thr);
    ok(hit.guides.length === 1 && miss.guides.length === 0, `6 px threshold at zoom ${k}`);
  }
}
// line targets (grainline) only constrain their own axis
{
  const r = snapMove([{ x: 20.02, y: 3 }], [{ x: 20, label: 'Grainline' }], 0.1);
  ok(near(20.02 + r.dx, 20) && r.dy === 0 && r.guides[0].label === 'Grainline', 'grainline snaps x only');
}
// angle snap
{
  const a = angleSnap({ x: 0, y: 0 }, { x: 10, y: 1 }, 45);
  ok(near(a.x, 10.04987562112089, 1e-6) && a.y === 0, 'near horizontal snaps to 0 degrees keeping length');
  const b = angleSnap({ x: 0, y: 0 }, { x: 0.5, y: 9 }, 45);
  ok(b.x === 0 && b.y > 9, 'near vertical snaps to exactly vertical');
  const c = angleSnap({ x: 1, y: 1 }, { x: 8, y: 7 }, 45);
  ok(near(c.x - 1, c.y - 1, 1e-9), 'near diagonal snaps to 45 degrees');
}
// align, distribute, place box
{
  const pts = [{ x: 0, y: 0 }, { x: 4, y: 10 }, { x: 10, y: 3 }];
  ok(alignPoints(pts, 'left').every((p) => p.x === 0), 'align left');
  ok(alignPoints(pts, 'centre').every((p) => p.x === 5), 'align centre');
  ok(alignPoints(pts, 'right').every((p) => p.x === 10), 'align right');
  ok(alignPoints(pts, 'top').every((p) => p.y === 0), 'align top');
  ok(alignPoints(pts, 'middle').every((p) => p.y === 5), 'align middle');
  ok(alignPoints(pts, 'bottom').every((p) => p.y === 10), 'align bottom');
  const d = distributePoints([{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 }, { x: 2, y: 0 }], 'x');
  ok(d.map((p) => p.x).join() === '0,6.666666666666667,10,3.3333333333333335', 'distribute keeps the ends and spaces the rest evenly by order');
  const m = placeBox(pts, { x: 100, y: 50, w: 20 });
  const b = boxOf(m)!;
  ok(near(b.x, 100) && near(b.y, 50) && near(b.w, 20) && near(b.h, 10), 'place box moves and scales about the corner');
}
// marquee over a real garment: hem of a tee front picks up both side points, once each
{
  const p = freshProject('basic-tee');
  const entries = chartEntries(p.garment, p.pieces, true, 'outside');
  const front = entries.find((e) => e.src.role === 'front')!;
  const hy = front.piece.points.find((q) => q.tag === 'hem')!.y;
  const hem = front.piece.points.filter((q) => Math.abs(q.y - hy) < 1e-6); // both hem corners and the centre front point
  ok(hem.length === 3, 'tee front has three hem points');
  const xs = hem.map((q) => front.offset.x + q.x), y = front.offset.y + hem[0].y;
  const hits = pointsInRect(entries, { x0: Math.min(...xs) - 1, y0: y - 1, x1: Math.max(...xs) + 1, y1: y + 1 });
  ok(hits.length === hem.length && hits.every((h) => h.pieceId === front.src.id), 'marquee around the hem selects exactly the hem points');
  const all = pointsInRect(entries, { x0: -1e4, y0: -1e4, x1: 1e4, y1: 1e4 });
  ok(new Set(all.map((h) => h.pieceId + h.pointId)).size === all.length, 'a point drawn on two copies is selected once');
}
// design artboard magnet: a layer near the centre line and another layer's edge lines up with both
{
  const tg = designTargets(20, 10, [layerBox({ x: 5, y: 0, w: 4, h: 2, rotation: 0 })]);
  const r = snapBox(layerBox({ x: 0.2, y: 3, w: 2, h: 2, rotation: 0 }), tg, 0.5);
  ok(near(r.dx, -0.2, 1e-6), 'layer centre snaps to the centre line');
  const e = snapBox(layerBox({ x: 8.9, y: 3, w: 2, h: 2, rotation: 0 }), tg, 0.5);
  ok(near(e.dx, 0.1, 1e-6), 'layer edge snaps to the piece edge');
  const none = snapBox(layerBox({ x: 4, y: 3.7, w: 1, h: 1, rotation: 0 }), tg, 0.2);
  ok(none.dx === 0 && none.dy === 0 && none.guides.length === 0, 'nothing in range, no shift');
  const b = layerBox({ x: 0, y: 0, w: 2, h: 2, rotation: 45 });
  ok(near(b.x1, Math.SQRT2), 'rotated layer box');
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('snap tests passed');
