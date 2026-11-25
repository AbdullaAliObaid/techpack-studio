import { useMemo } from 'react';
import * as THREE from 'three';
import { bodyFrame, type Body } from './body';

const mat = new THREE.MeshBasicMaterial({ color: '#2563eb', depthTest: false, transparent: true, opacity: 0.9 });
const geo = new THREE.SphereGeometry(1.4, 16, 12);

/** Joint pivots of the rig: neck, shoulders, elbows, wrists, hips, knees, ankles. */
export default function Joints({ body }: { body: Body }) {
  const pts = useMemo(() => {
    const f = bodyFrame(body);
    const out: [number, number, number][] = [[0, f.neckH - 2, 0]];
    for (const side of [1, -1]) {
      const a = side * f.armAngle, jx = side * f.shoulderJoint.x, jy = f.shoulderJoint.y;
      const along = (s: number): [number, number, number] => [jx + Math.sin(a) * s, jy - Math.cos(a) * s, 0];
      out.push([jx, jy, 0], along(f.upperArm), along(f.armSeg));
      const lx = side * f.legX;
      out.push([lx, f.hipJointH, 0], [lx, f.kneeH, 0], [lx, f.ankleH, 0]);
    }
    return out;
  }, [body]);
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} geometry={geo} material={mat} position={p} renderOrder={10} />
      ))}
    </group>
  );
}
