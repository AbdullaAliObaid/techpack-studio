// Movement modes: joint angles over time, and forward kinematics for the 9-bone rig.
// Bones: 0 torso, 1/2 upper arm / forearm (+x side), 3/4 upper arm / forearm (-x side),
//        5/6 thigh / shin (+x side), 7/8 thigh / shin (-x side). Hands ride on the forearm, feet on the shin.
// A bone matrix maps a point from the standing (rest) body to the posed body.

import type { BodyFrame } from '../three/body';

export type Mode = 'stand' | 'walk' | 'sit' | 'jacks' | 'cross' | 'hug';

export const MODES: { id: Mode; label: string }[] = [
  { id: 'stand', label: 'Standing' },
  { id: 'walk', label: 'Walking' },
  { id: 'sit', label: 'Sitting' },
  { id: 'jacks', label: 'Jumping jacks' },
  { id: 'cross', label: 'Crossed arms' },
  { id: 'hug', label: 'Hugging' },
];

export const NBONES = 9;

interface Side { shFlex: number; shAbd: number; shHoriz: number; elbow: number; hipFlex: number; hipAbd: number; knee: number }
export interface Angles { s: [Side, Side]; rootY: number } // s[0] = +x side, s[1] = -x side

const D = Math.PI / 180;
const zero = (): Side => ({ shFlex: 0, shAbd: 0, shHoriz: 0, elbow: 0, hipFlex: 0, hipAbd: 0, knee: 0 });
const ease = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const lerpSide = (a: Side, b: Side, t: number): Side => {
  const o = zero();
  (Object.keys(o) as (keyof Side)[]).forEach((k) => (o[k] = a[k] + (b[k] - a[k]) * t));
  return o;
};

function target(mode: Mode, t: number): [Side, Side] {
  const A = zero(), B = zero();
  switch (mode) {
    case 'walk': {
      const ph = (t / 1.1) * Math.PI * 2;
      for (const [S, sgn] of [[A, 1], [B, -1]] as [Side, number][]) {
        const p = ph + (sgn > 0 ? 0 : Math.PI);
        S.hipFlex = 24 * D * Math.sin(p);
        S.knee = (5 + 55 * Math.max(0, Math.sin(p + 1.2)) ** 1.6) * D;
        S.shFlex = -18 * D * Math.sin(p);
        S.elbow = (14 + 10 * Math.max(0, -Math.sin(p))) * D;
      }
      break;
    }
    case 'sit':
      for (const S of [A, B]) { S.hipFlex = 88 * D; S.knee = 88 * D; S.hipAbd = 4 * D; S.shFlex = 22 * D; S.shAbd = -8 * D; S.elbow = 55 * D; }
      break;
    case 'jacks': {
      const k = (1 - Math.cos((t / 1.0) * Math.PI * 2)) / 2;
      for (const S of [A, B]) { S.shAbd = 135 * D * k; S.hipAbd = 13 * D * k; S.knee = 8 * D * (1 - k); S.elbow = 10 * D; }
      break;
    }
    case 'cross':
      for (const S of [A, B]) { S.shFlex = 55 * D; S.shAbd = -6 * D; S.shHoriz = 38 * D; S.elbow = 118 * D; }
      break;
    case 'hug':
      for (const S of [A, B]) { S.shFlex = 78 * D; S.shAbd = 18 * D; S.shHoriz = 28 * D; S.elbow = 62 * D; }
      break;
  }
  return [A, B];
}

/** Joint angles at time t (seconds since the mode started), blending in from standing. */
export function poseAt(mode: Mode, t: number, f: BodyFrame): Angles {
  const blend = ease(t / 0.9);
  const [a, b] = target(mode, t);
  const s: [Side, Side] = [lerpSide(zero(), a, blend), lerpSide(zero(), b, blend)];
  const ang: Angles = { s, rootY: 0 };
  if (mode === 'sit' || mode === 'walk' || mode === 'jacks') {
    // keep the lowest ankle on the floor
    const M = boneMatrices(f, ang);
    let low = Infinity;
    for (const [bone, side] of [[6, 1], [8, -1]] as [number, number][]) {
      const y = apply(M, bone, side * f.legX, f.ankleH, 0)[1];
      low = Math.min(low, y);
    }
    ang.rootY = f.ankleH - low;
  }
  return ang;
}

// ---- 3x4 affine matrices stored row-major in a Float64Array (12 per bone) ----
type M34 = number[];
const I34 = (): M34 => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
function mul(a: M34, b: M34): M34 {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + (c === 3 ? a[r * 4 + 3] : 0);
    }
  }
  return o;
}
const T = (x: number, y: number, z: number): M34 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
function rotAxis(ax: number, ay: number, az: number, th: number): M34 {
  const l = Math.hypot(ax, ay, az) || 1;
  const x = ax / l, y = ay / l, z = az / l, c = Math.cos(th), s = Math.sin(th), C = 1 - c;
  return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, 0, y * x * C + z * s, c + y * y * C, y * z * C - x * s, 0, z * x * C - y * s, z * y * C + x * s, c + z * z * C, 0];
}
const about = (p: number[], R: M34): M34 => mul(T(p[0], p[1], p[2]), mul(R, T(-p[0], -p[1], -p[2])));

/** Bone matrices (rest -> posed) for the given joint angles. */
export function boneMatrices(f: BodyFrame, a: Angles): Float64Array {
  const out = new Float64Array(NBONES * 12);
  const root = T(0, a.rootY, 0);
  const put = (i: number, m: M34) => out.set(m, i * 12);
  put(0, root);
  [1, -1].forEach((side, k) => {
    const S = a.s[k];
    const J = [side * f.shoulderJoint.x, f.shoulderJoint.y, 0];
    const sh = mul(rotAxis(0, 1, 0, -side * S.shHoriz), mul(rotAxis(0, 0, 1, side * S.shAbd), rotAxis(1, 0, 0, -S.shFlex)));
    const upper = mul(root, about(J, sh));
    const ua = side * f.armAngle;
    const u = [Math.sin(ua), -Math.cos(ua), 0]; // rest arm direction
    const E = [J[0] + u[0] * f.upperArm, J[1] + u[1] * f.upperArm, 0];
    // elbow flexes the forearm forward: axis = arm direction x Z
    const fore = mul(upper, about(E, rotAxis(u[1] * 1 - 0, -u[0], 0, S.elbow)));
    put(k === 0 ? 1 : 3, upper);
    put(k === 0 ? 2 : 4, fore);
    const H = [side * f.legX, f.hipJointH, 0];
    const thigh = mul(root, about(H, mul(rotAxis(0, 0, 1, side * S.hipAbd), rotAxis(1, 0, 0, -S.hipFlex))));
    const K = [side * f.legX, f.kneeH, 0];
    const shin = mul(thigh, about(K, rotAxis(1, 0, 0, S.knee)));
    put(k === 0 ? 5 : 7, thigh);
    put(k === 0 ? 6 : 8, shin);
  });
  return out;
}

export function apply(M: Float64Array, b: number, x: number, y: number, z: number): [number, number, number] {
  const o = b * 12;
  return [M[o] * x + M[o + 1] * y + M[o + 2] * z + M[o + 3], M[o + 4] * x + M[o + 5] * y + M[o + 6] * z + M[o + 7], M[o + 8] * x + M[o + 9] * y + M[o + 10] * z + M[o + 11]];
}

/** Inverse of each rigid bone matrix (rotation transposed). */
export function invert(M: Float64Array): Float64Array {
  const out = new Float64Array(M.length);
  for (let b = 0; b < M.length / 12; b++) {
    const o = b * 12;
    const r = [M[o], M[o + 1], M[o + 2], M[o + 4], M[o + 5], M[o + 6], M[o + 8], M[o + 9], M[o + 10]];
    const t = [M[o + 3], M[o + 7], M[o + 11]];
    const rt = [r[0], r[3], r[6], r[1], r[4], r[7], r[2], r[5], r[8]];
    out.set([rt[0], rt[1], rt[2], -(rt[0] * t[0] + rt[1] * t[1] + rt[2] * t[2]), rt[3], rt[4], rt[5], -(rt[3] * t[0] + rt[4] * t[1] + rt[5] * t[2]), rt[6], rt[7], rt[8], -(rt[6] * t[0] + rt[7] * t[1] + rt[8] * t[2])], o);
  }
  return out;
}

/** Joint positions for markers (posed). */
export function jointPoints(f: BodyFrame, M: Float64Array): [number, number, number][] {
  const pts: [number, number, number][] = [apply(M, 0, 0, f.neckH - 2, 0)];
  [1, -1].forEach((side, k) => {
    const ua = side * f.armAngle, jx = side * f.shoulderJoint.x, jy = f.shoulderJoint.y;
    const along = (s: number): [number, number, number] => [jx + Math.sin(ua) * s, jy - Math.cos(ua) * s, 0];
    const up = k === 0 ? 1 : 3, fo = k === 0 ? 2 : 4, th = k === 0 ? 5 : 7, sh = k === 0 ? 6 : 8;
    pts.push(apply(M, up, jx, jy, 0), apply(M, fo, ...along(f.upperArm)), apply(M, fo, ...along(f.armSeg)));
    pts.push(apply(M, th, side * f.legX, f.hipJointH, 0), apply(M, sh, side * f.legX, f.kneeH, 0), apply(M, sh, side * f.legX, f.ankleH, 0));
  });
  return pts;
}
