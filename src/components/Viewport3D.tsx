import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useStore } from '../store';
import { SKIN_TONES } from '../three/body';
import Mannequin from '../three/Mannequin';
import { buildGarment, type ShellPart } from '../three/garment';
import { ringsGeometry, riskColor } from '../three/rings';
import { fabricById } from '../data/fabrics';
import { fabricCanvas } from '../lib/textures';
import BodyPanel from './BodyPanel';
import MeasureOverlay from '../three/MeasureOverlay';

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
  const { project, view3d, showBody, skin, showJoints, showGarment, showTape, units, set } = useStore();
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
        <hemisphereLight intensity={0.75} groundColor="#c9ccd3" />
        <directionalLight position={[120, 260, 180]} intensity={1.6} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
          shadow-camera-left={-120} shadow-camera-right={120} shadow-camera-top={220} shadow-camera-bottom={-20} shadow-camera-far={800} />
        <directionalLight position={[-160, 140, -120]} intensity={0.55} />
        <directionalLight position={[0, 80, 260]} intensity={0.25} />
        {showBody && <Mannequin body={body} skin={SKIN_TONES[skin]?.hex ?? SKIN_TONES[0].hex} showJoints={showJoints} />}
        {showGarment && result.parts.map((p) => (
          <GarmentPart key={p.key} part={p} stretch={stretch} />
        ))}
        {showTape && <MeasureOverlay body={body} units={units} />}
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
        <label className="chk">
          <input type="checkbox" checked={showGarment} onChange={(e) => set({ showGarment: e.target.checked })} /> Garment
        </label>
        <label className="chk">
          <input type="checkbox" checked={showJoints} onChange={(e) => set({ showJoints: e.target.checked })} /> Joints
        </label>
        <label className="chk">
          <input type="checkbox" checked={showTape} onChange={(e) => set({ showTape: e.target.checked })} /> Tape measure
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
