import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { bodyFrame, type Body } from '../three/body';
import { buildGarment, type ShellPart } from '../three/garment';
import { ringsGeometry, riskColor, type Ring } from '../three/rings';
import { fabricById } from '../data/fabrics';
import { fabricCanvas } from '../lib/textures';
import BodyPanel from './BodyPanel';

const skin = new THREE.MeshStandardMaterial({ color: '#d7dae0', roughness: 0.75, metalness: 0 });
const stretchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, side: THREE.DoubleSide });
const matCache = new Map<string, THREE.MeshStandardMaterial>();

function fabricMaterial(fab: { id: string; color: number }) {
  const f = fabricById(fab.id);
  const hex = f.colors[fab.color]?.hex ?? f.colors[0].hex;
  const key = f.id + hex;
  let m = matCache.get(key);
  if (!m) {
    const tex = new THREE.CanvasTexture(fabricCanvas(f, hex));
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    m = new THREE.MeshStandardMaterial({ map: tex, roughness: f.roughness, side: THREE.DoubleSide });
    matCache.set(key, m);
  }
  return m;
}

function Mannequin({ body }: { body: Body }) {
  const f = useMemo(() => bodyFrame(body), [body]);
  const geos = useMemo(() => {
    const torso: Ring[] = [];
    for (let h = f.torsoBottom; h <= f.torsoTop; h += 1) torso.push({ y: h, ...f.torsoAt(h) });
    const leg: Ring[] = [];
    for (let h = f.ankleH - 3; h <= f.crotchH + 8; h += 1.5) {
      const r = f.legAt(h);
      leg.push({ y: h, a: r, b: r });
    }
    const arm: Ring[] = [];
    const r0 = f.armAt(0);
    for (let s = -r0 * 1.1; s <= f.b.arm; s += 1.2) {
      const r = f.armAt(s);
      arm.push({ y: -s, a: r, b: r });
    }
    return { torso: ringsGeometry(torso), leg: ringsGeometry(leg), arm: ringsGeometry(arm) };
  }, [f]);

  const H = f.H;
  const neckR = (body.neck / (2 * Math.PI)) * 0.95;
  return (
    <group>
      <mesh geometry={geos.torso} material={[skin, skin]} castShadow />
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh geometry={geos.leg} material={[skin, skin]} position={[side * f.legX, 0, 0]} castShadow />
          <mesh material={skin} position={[side * f.legX, f.ankleH * 0.35, 4]} castShadow>
            <boxGeometry args={[8, f.ankleH * 0.7, 24]} />
          </mesh>
          <group position={[side * f.shoulderJoint.x, f.shoulderJoint.y, 0]} rotation={[0, 0, side * f.armAngle]}>
            <mesh geometry={geos.arm} material={[skin, skin]} castShadow />
            <mesh material={skin} position={[0, -body.arm - 0.045 * H, 0]} scale={[0.45, 1.8, 0.9]} castShadow>
              <sphereGeometry args={[0.026 * H, 20, 16]} />
            </mesh>
          </group>
        </group>
      ))}
      <mesh material={skin} position={[0, f.neckH + 0.025 * H, 0]} castShadow>
        <cylinderGeometry args={[neckR, neckR * 1.08, 0.06 * H, 28]} />
      </mesh>
      <mesh material={skin} position={[0, f.neckH + 0.09 * H, 0.4]} scale={[0.82, 1, 0.92]} castShadow>
        <sphereGeometry args={[0.068 * H, 32, 24]} />
      </mesh>
    </group>
  );
}

function GarmentPart({ part, stretch }: { part: ShellPart; stretch: boolean }) {
  const geo = useMemo(() => {
    const rings = part.rings.map((r, i) => (stretch ? { ...r, color: riskColor(part.strains[i]) } : r));
    return ringsGeometry(rings, { refCirc: part.refCirc });
  }, [part, stretch]);
  const mats = stretch ? [stretchMat, stretchMat] : [fabricMaterial(part.front), fabricMaterial(part.back)];
  return (
    <group position={part.position} rotation={[0, 0, part.rotationZ]}>
      <mesh geometry={geo} material={mats} castShadow />
    </group>
  );
}

export default function Viewport3D() {
  const { project, view3d, showBody, set } = useStore();
  const { body, pieces, garment } = project;
  const result = useMemo(() => buildGarment(garment, pieces, body), [garment, pieces, body]);
  const stretch = view3d === 'stretch';
  const H = body.height;
  const peak = result.peak;
  const peakFabric = fabricById(pieces.find((p) => p.role === 'front')?.fabric.id ?? 'canvas');

  return (
    <div className="viewport">
      <Canvas shadows dpr={[1, 2]} camera={{ position: [-H * 0.18, H * 0.6, H * 2.3], fov: 32, near: 1, far: 5000 }}>
        <color attach="background" args={['#f1f3f6']} />
        <hemisphereLight intensity={0.9} groundColor="#cfd3da" />
        <directionalLight position={[120, 260, 180]} intensity={1.5} castShadow shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-160, 120, -120]} intensity={0.45} />
        {showBody && <Mannequin body={body} />}
        {result.parts.map((p) => (
          <GarmentPart key={p.key} part={p} stretch={stretch} />
        ))}
        <ContactShadows position={[0, 0.05, 0]} scale={220} blur={2.6} opacity={0.35} far={60} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[70, 64]} />
          <meshStandardMaterial color="#e6e9ee" />
        </mesh>
        <OrbitControls target={[0, H * 0.5, 0]} minDistance={60} maxDistance={900} enablePan makeDefault />
      </Canvas>

      <div className="vp-top">
        <div className="seg">
          <button className={!stretch ? 'on' : ''} onClick={() => set({ view3d: 'fabric' })}>Fabric</button>
          <button className={stretch ? 'on' : ''} onClick={() => set({ view3d: 'stretch' })}>Stretch-Risk-O-Meter</button>
        </div>
        <label className="chk">
          <input type="checkbox" checked={showBody} onChange={(e) => set({ showBody: e.target.checked })} /> Body
        </label>
      </div>

      {stretch && (
        <div className="legend">
          <div className="legend-bar" />
          <div className="legend-row">
            <span>Relaxed</span>
            <span>At limit</span>
            <span>Rip risk</span>
          </div>
          <div className="legend-peak">
            {peak.strain <= 0 ? (
              <>Everything has room. Loose fit, no strain.</>
            ) : (
              <>
                Tightest at the <b>{peak.where}</b>: stretching {(peak.strain * 100).toFixed(1)}%
                {' '}({Math.round(peak.ratio * 100)}% of what {peakFabric.name.toLowerCase()} can safely take)
              </>
            )}
          </div>
          <div className="legend-note">Standing pose. Movement modes come next.</div>
        </div>
      )}

      <BodyPanel />
    </div>
  );
}
