// Shared hat checks (tests/drape.ts, tests/motion.ts): where a hat sits relative to the head.
import type { Garment3D } from '../src/sim/setup';
import type { BodyFrame } from '../src/three/body';

/**
 * Crown centre and brim tilt in the head's own frame (Minv: inverse bone matrices, head = bone 10; identity when
 * standing). axis: horizontal distance (cm) of the crown centre from the head's vertical axis through (0, headCz);
 * drop: how far the crown centre sits below where it sat at the start (`rest`, cm); tilt: brim height difference
 * left to right, and for a round brim front to back (cm).
 */
export function hatPose(G: Garment3D, f: BodyFrame, Minv?: Float64Array) {
  const P = G.sim.pos, o = 10 * 12;
  const at = (i: number): [number, number, number] => {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (!Minv) return [x, y, z];
    return [Minv[o] * x + Minv[o + 1] * y + Minv[o + 2] * z + Minv[o + 3], Minv[o + 4] * x + Minv[o + 5] * y + Minv[o + 6] * z + Minv[o + 7], Minv[o + 8] * x + Minv[o + 9] * y + Minv[o + 10] * z + Minv[o + 11]];
  };
  let cx = 0, cy = 0, cz = 0, n = 0;
  const side = { l: 0, ln: 0, r: 0, rn: 0, f: 0, fn: 0, b: 0, bn: 0 };
  for (const p of G.panels) for (let k = 0; k < p.mesh.uv.length; k++) {
    const [x, y, z] = at(p.offset + k);
    if (p.piece.role === 'crown' || p.piece.role === 'crownFront' || p.piece.role === 'headband' || p.piece.role === 'strap') { cx += x; cy += y; cz += z; n++; }
    if (p.piece.role === 'brim') {
      if (x > 3) { side.l += y; side.ln++; } else if (x < -3) { side.r += y; side.rn++; }
      if (z - f.headCz > 3) { side.f += y; side.fn++; } else if (z - f.headCz < -3) { side.b += y; side.bn++; }
    }
  }
  cx /= n; cy /= n; cz /= n;
  const lr = side.ln && side.rn ? Math.abs(side.l / side.ln - side.r / side.rn) : 0;
  const fb = side.fn && side.bn ? Math.abs(side.f / side.fn - side.b / side.bn) : 0;
  return { axis: Math.hypot(cx, cz - f.headCz), y: cy, lr, fb };
}
