import { Canvas } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import { useStore } from '../store';
import { SKIN_TONES } from '../three/body';
import { MODES } from '../sim/pose';
import { fabricById } from '../data/fabrics';
import ClothView from '../three/ClothView';
import StudioLight from '../three/StudioLight';
import BodyCard from './BodyPanel';
import MeasureOverlay from '../three/MeasureOverlay';
import { useCssVars } from './theme';
import Icon from './Icon';
import { PaneTitle } from './controls';
import { CATALOG, migrateGarment } from '../data/catalog';

const Tgl = ({ on, icon, label, onChange }: { on: boolean; icon: string; label: string; onChange: (v: boolean) => void }) => (
  <button className={`tgl ${on ? 'on' : ''}`} aria-pressed={on} title={`${on ? 'Hide' : 'Show'} ${label.toLowerCase()}`} onClick={() => onChange(!on)}>
    <Icon name={icon} size={16} /><span>{label}</span>
  </button>
);

export default function Viewport3D() {
  const { project, view3d, showBody, skin, showJoints, showGarment, showTape, units, set, draping, drapePeak, redrapeToken, simStatus, mode } = useStore();
  const { body, pieces, garment } = project;
  const tv = useCssVars(['--viewport', '--floor', '--hemi-ground', '--shadow-opacity'] as const);
  const stretch = view3d === 'stretch';
  const H = body.height;
  const peak = drapePeak;
  const peakFabric = fabricById(pieces.find((p) => p.role === 'front')?.fabric.id ?? 'canvas');

  const style = CATALOG.find((x) => x.id === migrateGarment(garment))?.name ?? 'Garment';
  return (
    <section className="pane view3d" aria-label="3D view">
    <PaneTitle icon="cube" title="3D view" meta={style}>
      <div className="seg" role="group" aria-label="3D view mode">
        <button className={!stretch ? 'on' : ''} aria-pressed={!stretch} onClick={() => set({ view3d: 'fabric' })}>Fabric</button>
        <button className={stretch ? 'on' : ''} aria-pressed={stretch} onClick={() => set({ view3d: 'stretch' })}>Stretch-Risk-O-Meter</button>
      </div>
    </PaneTitle>
    <div className="viewport">
      <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true }} camera={{ position: [-H * 0.18, H * 0.6, H * 2.3], fov: 32, near: 1, far: 5000 }}>
        <color attach="background" args={[tv['--viewport'] || '#f2f2f7']} />
        <StudioLight />
        <hemisphereLight intensity={0.45} groundColor={tv['--hemi-ground'] || '#c9ccd3'} />
        <directionalLight position={[120, 260, 180]} intensity={1.9} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
          shadow-camera-left={-120} shadow-camera-right={120} shadow-camera-top={220} shadow-camera-bottom={-20} shadow-camera-far={800} />
        <directionalLight position={[-160, 140, -120]} intensity={0.55} />
        <directionalLight position={[0, 80, 260]} intensity={0.25} />
        
        <ClothView type={garment} pieces={pieces} body={body} stretch={stretch} showBody={showBody} showGarment={showGarment} skin={SKIN_TONES[skin]?.hex ?? SKIN_TONES[0].hex} mode={mode} showJoints={showJoints} />
        {showTape && <MeasureOverlay body={body} units={units} />}
        <ContactShadows position={[0, 0.05, 0]} scale={220} blur={2.6} opacity={parseFloat(tv['--shadow-opacity']) || 0.35} far={60} />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[70, 64]} />
          <meshStandardMaterial color={tv['--floor'] || '#e5e5ea'} />
        </mesh>
        <OrbitControls target={[0, H * 0.5, 0]} minDistance={60} maxDistance={900} enablePan makeDefault />
      </Canvas>

      <div className="vp-top">
        <div className="vp-toolbar material" role="toolbar" aria-label="Show in 3D view">
          <Tgl on={showBody} icon="body" label="Body" onChange={(v) => set({ showBody: v })} />
          <Tgl on={showGarment} icon="garment" label="Garment" onChange={(v) => set({ showGarment: v })} />
          <Tgl on={showJoints} icon="joints" label="Joints" onChange={(v) => set({ showJoints: v })} />
          <Tgl on={showTape} icon="tape" label="Tape" onChange={(v) => set({ showTape: v })} />
        </div>
      </div>

      <div className="vp-bottom">
        {stretch && (
          <div className="legend material">
            <div className="legend-bar" />
            <div className="legend-row">
              <span>Relaxed</span>
              <span>At limit</span>
              <span>Rip risk</span>
            </div>
            <div className="legend-peak">
              {peak.ratio < 0.15 ? (
                <>Everything has room. Loose fit, no strain.</>
              ) : (
                <>
                  {mode !== 'stand' ? 'Worst moment while ' + MODES.find((m) => m.id === mode)!.label.toLowerCase() + ': ' : ''}Tightest at the <b>{peak.where}</b>: stretching {(peak.strain * 100).toFixed(1)}%
                  {' '}({Math.round(peak.ratio * 100)}% of what {peakFabric.name.toLowerCase()} can safely take)
                  {peak.over !== undefined && peak.over > 0.005 && <>. {(peak.over * 100).toFixed(0)}% of the garment is past its safe stretch.</>}
                </>
              )}
            </div>
            <div className="legend-note">Measured from the simulated cloth{mode === 'stand' ? ', standing. Pick a movement to stress test it.' : ' through the movement.'}</div>
          </div>
        )}

        <div className="vp-bar material">
          <div className="vp-bar-group" role="group" aria-label="Movement">
            <span className="vp-bar-label"><Icon name="pose" size={16} /> Movement</span>
            <div className="move-grid">
              {MODES.map((m) => (
                <button key={m.id} className={mode === m.id ? 'on' : ''} aria-pressed={mode === m.id} onClick={() => set(m.id === 'custom' ? { mode: m.id, inspectorTab: 'body', ...(window.innerWidth <= 960 ? { drawer: true } : {}) } : { mode: m.id })}>{m.id === 'custom' ? 'Pose' : m.label}</button>
              ))}
            </div>
          </div>
          <div className="vp-bar-group status" role="status">
            <span className={`drape-dot ${draping ? 'on' : ''}`} aria-hidden="true" />
            <span className="drape-text">{draping ? simStatus || 'Simulating fabric…' : 'Draped'}</span>
            <button className="btn small" onClick={() => set({ redrapeToken: redrapeToken + 1 })}><Icon name="refresh" size={14} /> Re-drape</button>
          </div>
        </div>
      </div>

      <BodyCard />
    </div>
    </section>
  );
}
