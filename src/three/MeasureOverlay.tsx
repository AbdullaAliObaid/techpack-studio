import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { bodyFrame, type Body, type BRing } from './body';
import { fmt, type Units } from '../lib/units';

// Tape measure lines drawn on the 3D body. Each value is measured from the actual mesh geometry,
// so it proves the 3D body matches the numbers typed into the body panel.

type V3 = [number, number, number];

function ringPoints(r: BRing, y: number, n = 160): { pts: V3[]; len: number } {
  const pts: V3[] = [];
  let len = 0;
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2;
    const m = r.shape(th) * 1.004; // sit just on the skin
    const p: V3 = [r.a * m * Math.cos(th), y, (r.cz ?? 0) + r.b * m * Math.sin(th)];
    if (i) len += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
    pts.push(p);
  }
  return { pts, len: len / 1.004 };
}

const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function Tag({ at, text }: { at: V3; text: string }) {
  return (
    <Html position={at} center zIndexRange={[5, 0]}>
      <div className="tape-label">{text}</div>
    </Html>
  );
}

export default function MeasureOverlay({ body, units }: { body: Body; units: Units }) {
  const f = useMemo(() => bodyFrame(body), [body]);
  const items = useMemo(() => {
    const rings = [
      { label: 'Chest', h: f.chestH, r: f.torsoRing(f.chestH) },
      { label: 'Waist', h: f.waistH, r: f.torsoRing(f.waistH) },
      { label: 'Hips', h: f.hipH, r: f.torsoRing(f.hipH) },
      { label: 'Neck', h: f.neckMeasureH, r: f.neckRing(f.neckMeasureH) },
    ].map((x) => ({ ...x, ...ringPoints(x.r, x.h) }));

    const H = f.H;
    const back = -f.torsoAt(f.shoulderH - 2).b * 0.6;
    const acL: V3 = [-f.acromion.x, f.acromion.y, back];
    const acR: V3 = [f.acromion.x, f.acromion.y, back];
    const acF: V3 = [f.acromion.x, f.acromion.y, 0];
    const wr: V3 = [f.wrist.x, f.wrist.y, 0];
    const crotch: V3 = [0, f.crotchH, 0];
    const floor: V3 = [0, 0, 0];
    const hx = -(f.b.shoulder / 2 + 22);
    const top: V3 = [hx, H, 0];
    const bottom: V3 = [hx, 0, 0];
    return { rings, acL, acR, acF, wr, crotch, floor, top, bottom, H };
  }, [f]);

  const blue = '#2563eb';
  return (
    <group>
      {items.rings.map((r) => (
        <group key={r.label}>
          <Line points={r.pts} color={blue} lineWidth={2} depthTest={false} renderOrder={5} />
          <Tag at={[r.pts[0][0] + 6, r.h, 4]} text={`${r.label} ${fmt(r.len, units)}`} />
        </group>
      ))}
      <Line points={[items.acL, items.acR]} color={blue} lineWidth={2} depthTest={false} />
      <Tag at={[0, items.acL[1] + 4, items.acL[2]]} text={`Shoulder ${fmt(dist(items.acL, items.acR), units)}`} />
      <Line points={[items.acF, items.wr]} color={blue} lineWidth={2} dashed dashSize={2} gapSize={1} depthTest={false} />
      <Tag at={[(items.acF[0] + items.wr[0]) / 2 + 9, (items.acF[1] + items.wr[1]) / 2, 0]} text={`Arm ${fmt(dist(items.acF, items.wr), units)}`} />
      <Line points={[items.crotch, items.floor]} color={blue} lineWidth={2} dashed dashSize={2} gapSize={1} depthTest={false} />
      <Tag at={[0, items.crotch[1] / 2, 6]} text={`Inseam ${fmt(items.crotch[1], units)}`} />
      <Line points={[items.top, items.bottom]} color={blue} lineWidth={1.5} />
      <Line points={[[items.top[0] - 3, items.H, 0], [items.top[0] + 3, items.H, 0]]} color={blue} lineWidth={1.5} />
      <Tag at={[items.top[0], items.H / 2, 0]} text={`Height ${fmt(items.H, units)}`} />
    </group>
  );
}
