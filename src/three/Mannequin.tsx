import { useMemo } from 'react';
import * as THREE from 'three';
import { bodyFrame, makeCurve, type Body, type BodyFrame, type Shape } from './body';
import { ringsGeometry, type Ring } from './rings';

// Rigged mannequin. Every limb hangs off a joint group (shoulder > elbow > wrist, hip > knee > ankle,
// neck > head) so movement modes can rotate joints and the children follow.

export interface Pose {
  shoulder: [number, number, number]; // extra rotation (rad) on top of the rest A-pose, per side mirrored
  elbow: number;
  hip: [number, number, number];
  knee: number;
}

export const REST_POSE: Pose = { shoulder: [0, 0, 0], elbow: 0, hip: [0, 0, 0], knee: 0 };

const TAU = Math.PI * 2;

function headShape(t: number): Shape {
  const nose = 0.13 * Math.exp(-0.5 * ((t - 0.42) / 0.07) ** 2);
  const tip = 0.05 * Math.exp(-0.5 * ((t - 0.36) / 0.03) ** 2);
  const brow = 0.035 * Math.exp(-0.5 * ((t - 0.62) / 0.04) ** 2);
  const eyes = 0.05 * Math.exp(-0.5 * ((t - 0.55) / 0.035) ** 2);
  const cheek = 0.035 * Math.exp(-0.5 * ((t - 0.42) / 0.06) ** 2);
  const lips = 0.03 * Math.exp(-0.5 * ((t - 0.25) / 0.03) ** 2);
  const chin = 0.05 * Math.exp(-0.5 * ((t - 0.08) / 0.05) ** 2);
  const occ = 0.04 * Math.exp(-0.5 * ((t - 0.55) / 0.12) ** 2);
  const F = Math.PI / 2, B = (3 * Math.PI) / 2;
  const ga = (th: number, mu: number, s: number) => {
    let d = (th - mu) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return Math.exp(-0.5 * (d / s) ** 2);
  };
  return (th) =>
    1 +
    (nose + tip) * ga(th, F, 0.13) +
    brow * ga(th, F, 0.7) -
    eyes * (ga(th, F - 0.38, 0.16) + ga(th, F + 0.38, 0.16)) +
    cheek * (ga(th, F - 0.7, 0.35) + ga(th, F + 0.7, 0.35)) +
    lips * ga(th, F, 0.3) +
    chin * ga(th, F, 0.35) +
    occ * ga(th, B, 0.8);
}

// [t, a, b, cz] in fractions of head height, t = 0 at the chin, 1 at the crown
const HEAD = makeCurve(
  [
    { k: 0, v: [0.05, 0.05, 0.2] },
    { k: 0.04, v: [0.15, 0.13, 0.15] },
    { k: 0.12, v: [0.22, 0.22, 0.09] },
    { k: 0.24, v: [0.27, 0.32, 0.04] },
    { k: 0.4, v: [0.31, 0.39, 0.015] },
    { k: 0.58, v: [0.335, 0.425, 0] },
    { k: 0.75, v: [0.34, 0.435, -0.012] },
    { k: 0.88, v: [0.3, 0.385, -0.02] },
    { k: 0.96, v: [0.2, 0.25, -0.02] },
    { k: 1, v: [0.04, 0.05, -0.02] },
  ],
  -1,
);

function buildGeometries(f: BodyFrame) {
  const H = f.H;
  const torso: Ring[] = [];
  for (let h = f.torsoBottom; h <= f.torsoTop + 0.01; h += 0.8) torso.push({ y: h, ...f.torsoAt(h), shape: f.torsoShape(h) });

  const neckR = (f.b.neck / TAU) * 0.97;
  const neck: Ring[] = [];
  const neckTop = f.neckH + 0.06 * H;
  for (let h = f.neckH - 5; h <= neckTop; h += 0.8) {
    const t = Math.max(0, (h - f.neckH) / (neckTop - f.neckH));
    const flare = 0.28 * Math.max(0, 1 - t / 0.45) ** 2; // widens into the trapezius
    neck.push({ y: h, a: neckR * (1.0 + flare * 1.3 - 0.05 * t), b: neckR * (0.95 + flare * 0.5), cz: 0.012 * H * t - flare * 2.2 });
  }

  const Hh = f.headH;
  const head: Ring[] = [];
  for (let t = 0; t <= 1.0001; t += 0.02) {
    const [a, b, cz] = HEAD(t);
    head.push({ y: t * Hh, a: a * Hh, b: b * Hh, cz: cz * Hh, shape: headShape(t) });
  }

  const arm = (side: number) => {
    const upper: Ring[] = [];
    for (let s = -f.armDome * 0.98; s <= f.upperArm + 1.5; s += 0.6) {
      const r = f.armAt(s);
      const [fx, fz] = f.armFlat(s);
      upper.push({ y: -s, a: r * fx, b: r * fz, shape: f.armShape(s, side) });
    }
    const fore: Ring[] = [];
    for (let s = -1.5; s <= f.foreArm + 0.5; s += 0.9) {
      const S = f.upperArm + s;
      const r = f.armAt(S);
      const [fx, fz] = f.armFlat(S);
      fore.push({ y: -s, a: r * fx, b: r * fz, shape: f.armShape(S, side) });
    }
    return { upper: ringsGeometry(upper, { N: 40 }), fore: ringsGeometry(fore, { N: 40 }) };
  };

  const leg = (side: number) => {
    const thigh: Ring[] = [];
    for (let h = f.hipJointH + 4; h >= f.kneeH - 1.5; h -= 1) thigh.push({ y: h - f.hipJointH, a: f.legAt(h), b: f.legAt(h), shape: f.legShape(h, side) });
    const shin: Ring[] = [];
    for (let h = f.kneeH + 1.5; h >= f.ankleH - 3.5; h -= 1) shin.push({ y: h - f.kneeH, a: f.legAt(h), b: f.legAt(h), shape: f.legShape(h, side) });
    return { thigh: ringsGeometry(thigh, { N: 44 }), shin: ringsGeometry(shin, { N: 44 }) };
  };

  // foot: rings along its length, rotated so the axis points forward and the sole is flat
  const FL = f.footLen;
  const footCurve = makeCurve([
    { k: 0, v: [0.1, 0.1] },
    { k: 0.06, v: [0.15, 0.15] },
    { k: 0.2, v: [0.16, 0.18] },
    { k: 0.42, v: [0.165, 0.13] },
    { k: 0.68, v: [0.19, 0.085] },
    { k: 0.86, v: [0.18, 0.065] },
    { k: 0.97, v: [0.12, 0.045] },
    { k: 1, v: [0.05, 0.03] },
  ], 0.01);
  const foot: Ring[] = [];
  for (let t = 0; t <= 1.0001; t += 0.025) {
    const [a, b] = footCurve(t);
    foot.push({ y: t * FL, a: a * FL, b: b * FL, cz: -b * FL });
  }

  return {
    torso: ringsGeometry(torso, { N: 64, capBottom: true }),
    neck: ringsGeometry(neck, { N: 40 }),
    head: ringsGeometry(head, { N: 56 }),
    arms: { 1: arm(1), [-1]: arm(-1) } as Record<number, ReturnType<typeof arm>>,
    legs: { 1: leg(1), [-1]: leg(-1) } as Record<number, ReturnType<typeof leg>>,
    foot: ringsGeometry(foot, { N: 36, capTop: true, capBottom: true }),
  };
}

const jointMat = new THREE.MeshBasicMaterial({ color: '#2563eb', depthTest: false, transparent: true, opacity: 0.9 });
const jointGeo = new THREE.SphereGeometry(1.4, 16, 12);

function Joint({ show }: { show: boolean }) {
  return show ? <mesh geometry={jointGeo} material={jointMat} renderOrder={10} /> : null;
}

function Hand({ f, side, mat }: { f: BodyFrame; side: number; mat: THREE.Material }) {
  const s = f.H / 175;
  const palmL = 9.8 * s;
  const palm = useMemo(() => {
    const rings: Ring[] = [];
    const w0 = f.wristR * 1.05;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const b = w0 + (4.3 * s - w0) * Math.min(1, t * 1.6);
      const a = (1.75 - 0.35 * t) * s;
      rings.push({ y: -t * palmL, a, b: b * (t > 0.9 ? 0.96 : 1), cx: -side * 0.2 * s * t });
    }
    return ringsGeometry(rings, { N: 28, capBottom: true });
  }, [f, side]);
  const fingers: [number, number, number][] = [
    [2.95, 7.0, 0.84], // index: z offset, length, radius
    [0.98, 7.8, 0.88],
    [-0.98, 7.3, 0.82],
    [-2.85, 5.9, 0.72],
  ];
  const curl = -side;
  return (
    <group>
      <mesh geometry={palm} material={mat} castShadow />
      {fingers.map(([z, len, r], i) => {
        const L1 = len * s * 0.55, L2 = len * s * 0.45, R = r * s;
        return (
          <group key={i} position={[-side * 0.25 * s, -palmL + 0.4 * s, z * s]} rotation={[0, 0, curl * 0.18]}>
            <mesh material={mat} position={[0, -L1 / 2, 0]} castShadow>
              <capsuleGeometry args={[R, L1, 4, 10]} />
            </mesh>
            <group position={[0, -L1, 0]} rotation={[0, 0, curl * 0.32]}>
              <mesh material={mat} position={[0, -L2 / 2, 0]} castShadow>
                <capsuleGeometry args={[R * 0.9, L2, 4, 10]} />
              </mesh>
            </group>
          </group>
        );
      })}
      {/* thumb */}
      <group position={[-side * 0.7 * s, -2.6 * s, 3.4 * s]} rotation={[0.55, 0, curl * 0.45]}>
        <mesh material={mat} position={[0, -2.2 * s, 0]} castShadow>
          <capsuleGeometry args={[1.05 * s, 3.6 * s, 4, 10]} />
        </mesh>
        <group position={[0, -4.2 * s, 0]} rotation={[0.25, 0, curl * 0.2]}>
          <mesh material={mat} position={[0, -1.4 * s, 0]} castShadow>
            <capsuleGeometry args={[0.95 * s, 2.4 * s, 4, 10]} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

export default function Mannequin({ body, skin, showJoints, pose = REST_POSE }: { body: Body; skin: string; showJoints: boolean; pose?: Pose }) {
  const f = useMemo(() => bodyFrame(body), [body]);
  const geo = useMemo(() => buildGeometries(f), [f]);
  const mat = useMemo(() => {
    const grey = skin.toLowerCase() === '#d9dce2';
    return new THREE.MeshPhysicalMaterial({
      color: skin,
      roughness: grey ? 0.62 : 0.5,
      sheen: grey ? 0 : 0.35,
      sheenColor: new THREE.Color(skin).lerp(new THREE.Color('#ffffff'), 0.4),
      sheenRoughness: 0.6,
      clearcoat: grey ? 0.15 : 0.05,
      clearcoatRoughness: 0.6,
    });
  }, [skin]);
  const two = [mat, mat];
  const H = f.H;
  const Hh = f.headH;

  return (
    <group>
      {/* spine */}
      <mesh geometry={geo.torso} material={two} castShadow receiveShadow />
      <group position={[0, f.neckH - 2, 0]}>
        <Joint show={showJoints} />
      </group>
      <mesh geometry={geo.neck} material={two} castShadow />
      <group position={[0, f.neckH + 0.034 * H, 0.016 * H]}>
        <mesh geometry={geo.head} material={two} castShadow />
        {[1, -1].map((side) => (
          <mesh key={side} material={mat} position={[side * 0.325 * Hh, 0.5 * Hh, -0.03 * Hh]} scale={[0.32, 1, 0.62]} castShadow>
            <sphereGeometry args={[0.1 * Hh, 16, 12]} />
          </mesh>
        ))}
      </group>

      {[1, -1].map((side) => {
        const arm = geo.arms[side];
        const leg = geo.legs[side];
        return (
          <group key={side}>
            {/* shoulder > elbow > wrist */}
            <group
              position={[side * f.shoulderJoint.x, f.shoulderJoint.y, 0]}
              rotation={[pose.shoulder[0], pose.shoulder[1] * side, side * (f.armAngle + pose.shoulder[2])]}
            >
              <Joint show={showJoints} />
              <mesh geometry={arm.upper} material={two} castShadow />
              <group position={[0, -f.upperArm, 0]} rotation={[-pose.elbow, 0, 0]}>
                <Joint show={showJoints} />
                <mesh geometry={arm.fore} material={two} castShadow />
                <group position={[0, -f.foreArm, 0]}>
                  <Joint show={showJoints} />
                  <Hand f={f} side={side} mat={mat} />
                </group>
              </group>
            </group>

            {/* hip > knee > ankle */}
            <group position={[side * f.legX, f.hipJointH, 0]} rotation={[pose.hip[0], pose.hip[1] * side, pose.hip[2] * side]}>
              <Joint show={showJoints} />
              <mesh geometry={leg.thigh} material={two} castShadow />
              <group position={[0, f.kneeH - f.hipJointH, 0]} rotation={[pose.knee, 0, 0]}>
                <Joint show={showJoints} />
                <mesh geometry={leg.shin} material={two} castShadow />
                <group position={[0, f.ankleH - f.kneeH, 0]}>
                  <Joint show={showJoints} />
                  <group position={[0, -f.ankleH, -0.24 * f.footLen]} rotation={[0, side * 0.1, 0]}>
                    <mesh geometry={geo.foot} material={two} rotation={[Math.PI / 2, 0, 0]} castShadow />
                  </group>
                </group>
              </group>
            </group>
          </group>
        );
      })}
    </group>
  );
}
