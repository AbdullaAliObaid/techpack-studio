import { subscribeArt } from './detailsArt';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GarmentType, Piece } from '../data/presets';
import { bodyFrame, type Body } from './body';
import { riskColor } from './rings';
import { stretchMat } from './materials';
import { useStore } from '../store';
import Details, { type DetailUpdater } from './Details';
import type { DetailsMsg } from '../sim/details';
import Prints from './Prints';
import FinishBrush from './FinishBrush';
import { holesVersion, subscribeHoles, withHoles } from './detailsFinish';
import { clothMaterials } from './detailsCloth';
import Hardware from './Hardware';
import Pull from './Pull';
import type { HardwareMsg } from '../sim/detailsHardware';
import { vertexPattern, type VertexPattern } from './printsAdapter';
import { useSnapshotRegistration } from './snapshots';
import { boneMatrices, jointPoints, poseAt, NBONES, JOINT_COUNT, type Mode } from '../sim/pose';
import { EMPTY_EDITS, type Attachment, type CustomPose, type Edits } from '../data/edits';
import { listProjects } from '../lib/projects';

// Live cloth view. The simulation runs in a Web Worker (src/sim/worker.ts); this component sends it the
// pattern, fabric and body, and streams back positions and strain every frame.

const SPACING = 1.8;

interface Topo {
  geo: THREE.BufferGeometry;
  fabrics: Piece['fabric'][];
  pat: VertexPattern;
}

function skinMaterial(skin: string) {
  const grey = skin.toLowerCase() === '#d9dce2';
  return new THREE.MeshPhysicalMaterial({
    color: skin,
    roughness: grey ? 0.55 : 0.5,
    sheen: grey ? 0 : 0.35,
    sheenColor: new THREE.Color(skin).lerp(new THREE.Color('#ffffff'), 0.4),
    sheenRoughness: 0.6,
    clearcoat: grey ? 0.25 : 0.06,
    clearcoatRoughness: 0.5,
  });
}

const jointMat = new THREE.MeshBasicMaterial({ color: '#2563eb', depthTest: false, transparent: true, opacity: 0.9 });
const jointGeo = new THREE.SphereGeometry(1.4, 16, 12);

function setBone(bone: THREE.Bone, M: Float64Array, b: number) {
  const o = b * 12;
  bone.matrix.set(M[o], M[o + 1], M[o + 2], M[o + 3], M[o + 4], M[o + 5], M[o + 6], M[o + 7], M[o + 8], M[o + 9], M[o + 10], M[o + 11], 0, 0, 0, 1);
}

function ClothView({ type, pieces, body, stretch, showBody, showGarment, skin, mode, showJoints }: { type: GarmentType; pieces: Piece[]; body: Body; stretch: boolean; showBody: boolean; showGarment: boolean; skin: string; mode: Mode; showJoints: boolean }) {
  const [bodyGeo, setBodyGeo] = useState<THREE.BufferGeometry | null>(null);
  const pose = useRef<{ mode: Mode; t: number; custom?: CustomPose }>({ mode: 'stand', t: 0 });
  const customPose = useStore((s) => s.customPose);
  const softSkin = useStore((s) => s.softSkin);
  /** standing body positions and normals: soft skin dents move vertices in from these (worker 'skin' message) */
  const bodyRest = useRef<{ pos: Float32Array; nrm: Float32Array } | null>(null);
  const bones = useMemo(() => Array.from({ length: NBONES }, () => { const b = new THREE.Bone(); b.matrixAutoUpdate = false; return b; }), []);
  const skinned = useMemo(() => {
    if (!bodyGeo) return null;
    const m = new THREE.SkinnedMesh(bodyGeo, undefined);
    bones.forEach((b) => m.add(b));
    m.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    return m;
  }, [bodyGeo, bones]);
  const jointRefs = useRef<THREE.Mesh[]>([]);
  const skinMat = useMemo(() => skinMaterial(skin), [skin]);
  const worker = useMemo(() => new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' }), []);
  const [topo, setTopo] = useState<Topo | null>(null);
  const [details, setDetails] = useState<DetailsMsg | null>(null);
  const detailUpdater = useRef<DetailUpdater | null>(null);
  const [attachDetails, setAttachDetails] = useState<DetailsMsg | null>(null);
  const attachUpdater = useRef<DetailUpdater | null>(null);
  const [hardware, setHardware] = useState<HardwareMsg | null>(null);
  const hardwareUpdater = useRef<DetailUpdater | null>(null);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const attachments = useStore((s) => s.project.edits?.attachments);
  const pending = useRef<{ pos?: Float32Array; strain?: Float32Array }>({});
  const lastStrain = useRef<Float32Array | null>(null);
  const set = useStore((s) => s.set);
  const projectId = useStore((s) => s.project.id);
  const loading = useStore((s) => s.garmentLoading);
  // a new garment or design: hide the old one before the next paint, show it again once the first frame of the new drape arrives
  const seq = useRef({ posted: 0, built: 0, phantom: false });
  const countPost = () => { if (seq.current.phantom) seq.current.phantom = false; else seq.current.posted++; };
  const wantFrame = useRef(false);
  useLayoutEffect(() => { wantFrame.current = true; if (!seq.current.phantom && seq.current.posted === seq.current.built) { seq.current.posted++; seq.current.phantom = true; } useStore.getState().set({ garmentLoading: true }); invalidate(); }, [type, projectId]);
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => { wantFrame.current = false; useStore.getState().set({ garmentLoading: false }); }, 12000); // never stuck
    return () => clearTimeout(t);
  }, [loading]);
  const redrape = useStore((s) => s.redrapeToken);
  const f = useMemo(() => bodyFrame(body), [body]);
  const fRef = useRef(f);
  fRef.current = f;
  // the canvas renders on demand: a new cloth frame, a store change (prints, materials, toggles) or the camera
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => useStore.subscribe(() => invalidate()), [invalidate]);
  // pictures and pattern tiles decode asynchronously; redraw once their textures have been repainted
  useEffect(() => subscribeArt(() => { requestAnimationFrame(() => invalidate()); setTimeout(() => invalidate(), 120); }), [invalidate]);
  /** set store fields only when they change, so subscribers are not woken by every simulation frame */
  const setIf = (patch: Partial<ReturnType<typeof useStore.getState>>) => {
    const cur = useStore.getState() as unknown as Record<string, unknown>;
    if (Object.entries(patch).some(([k, v]) => cur[k] !== v)) set(patch);
  };

  useEffect(() => {
    worker.onerror = (ev) => { ev.preventDefault?.(); wantFrame.current = false; setIf({ garmentLoading: false, draping: false, simStatus: 'The simulation stopped. Press Re-drape to try again.' }); };
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'error') {
        if (m.of === 'build') { wantFrame.current = false; seq.current.built = seq.current.posted; setIf({ garmentLoading: false, draping: false, simStatus: `Could not simulate this garment: ${m.text}` }); }
        return;
      }
      if (m.type === 'status') {
        setIf({ draping: true, simStatus: m.text });
      } else if (m.type === 'body') {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(m.skinIndex, 4));
        g.setAttribute('skinWeight', new THREE.BufferAttribute(m.skinWeight, 4));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeBoundingSphere();
        bodyRest.current = { pos: (m.positions as Float32Array).slice(), nrm: (m.normals as Float32Array).slice() };
        setBodyGeo((old) => {
          old?.dispose();
          return g;
        });
      } else if (m.type === 'built') {
        seq.current.built++;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.n * 3).fill(1), 3));
        geo.setIndex(new THREE.BufferAttribute(m.index, 1));
        for (const g of m.groups) geo.addGroup(g.start, g.count, g.panel);
        geo.computeVertexNormals();
        lastStrain.current = null;
        setDetails(null);
        setAttachDetails(null);
        setHardware(null);
        setTopo((old) => {
          old?.geo.dispose();
          return { geo, fabrics: m.fabrics, pat: vertexPattern(m, piecesRef.current) };
        });
        setIf({ draping: true, simStatus: 'Simulating fabric…' });
      } else if (m.type === 'skin') {
        // soft skin: each body vertex pressed in along its standing normal (the skinned mesh poses it from there)
        const R = bodyRest.current, d = m.dent as Float32Array;
        setBodyGeo((g) => {
          const attr = g?.getAttribute('position') as THREE.BufferAttribute | undefined;
          if (!g || !R || !attr || attr.count !== d.length || R.pos.length !== d.length * 3) return g;
          const P = attr.array as Float32Array;
          for (let v = 0, j = 0; v < d.length; v++, j += 3) {
            const k = d[v];
            P[j] = R.pos[j] - R.nrm[j] * k; P[j + 1] = R.pos[j + 1] - R.nrm[j + 1] * k; P[j + 2] = R.pos[j + 2] - R.nrm[j + 2] * k;
          }
          attr.needsUpdate = true;
          return g;
        });
        invalidate();
      } else if (m.type === 'details') {
        setDetails(m);
      } else if (m.type === 'hardware') {
        setHardware(m);
      } else if (m.type === 'attachDetails') {
        setAttachDetails({ ...m, type: 'details' });
      } else if (m.type === 'frame') {
        if (wantFrame.current && seq.current.built >= seq.current.posted) { wantFrame.current = false; setIf({ garmentLoading: false }); }
        pending.current.pos = m.pos;
        invalidate();
        pose.current = { mode: m.mode, t: m.t, custom: m.pose };
        if (m.strain) pending.current.strain = m.strain;
        if (m.peak) {
          const fr = fRef.current;
          const marks: [string, number][] = [['shoulders', fr.shoulderH], ['chest', fr.chestH], ['waist', fr.waistH], ['hips', fr.hipH], ['seat', fr.crotchH + 4], ['thigh', (fr.crotchH + fr.kneeH) / 2], ['knee', fr.kneeH], ['calf', fr.kneeH / 2]];
          const where = marks.reduce((b, k) => (Math.abs(k[1] - m.peak.y) < Math.abs(b[1] - m.peak.y) ? k : b))[0];
          // the readout shows a percent with one decimal: skip updates it would not show
          const q = (v: number | undefined) => (v === undefined ? -1 : Math.round(v * 1000));
          const old = useStore.getState().drapePeak;
          if (old.where !== where || q(old.ratio) !== q(m.peak.ratio) || q(old.strain) !== q(m.peak.strain) || q(old.over) !== q(m.peak.over)) {
            set({ drapePeak: { ratio: m.peak.ratio, strain: m.peak.strain, where, over: m.peak.over } });
          }
        }
        if (m.sleeping) setIf({ draping: false });
      }
    };
    return () => worker.terminate();
  }, [worker]);

  // only edits that change the cloth (not artwork, names or prints) trigger a rebuild
  const edits = useStore((s) => s.project.edits ?? EMPTY_EDITS);
  const simKey = JSON.stringify({ ...edits, attachments: edits.attachments.filter((a) => a.kind !== 'print' && a.kind !== 'embroidery' && a.kind !== 'hardware').map(({ layers: _l, name: _n, ...a }) => a) });
  const simEdits = useMemo(() => JSON.parse(simKey) as Edits, [simKey]);

  // an outfit: every visible garment in one simulation (src/sim/outfit.ts); the open project is the live copy of its
  // garment, the others come as saved. `others` keeps their attachments and inside fabrics for the materials and prints
  const outfit = useStore((s) => s.outfit);
  const pullMode = useStore((s) => s.pullMode);
  const liveProject = useStore((s) => s.project);
  const others = useRef<{ attachments: Attachment[]; insideFabric: Edits['insideFabric'] }>({ attachments: [], insideFabric: {} });
  const outfitKey = outfit ? JSON.stringify({ b: outfit.body, i: outfit.items.filter((i) => !i.hidden).map((i) => [i.projectId, i.layer, i.tuck]), a: liveProject.id, g: type, p: pieces, e: simKey }) : '';
  const lastOutfit = useRef<string | null>(null);
  useEffect(() => {
    if (!outfit) { lastOutfit.current = null; return; }
    const saved = new Map(listProjects().map((p) => [p.id, p]));
    const live = useStore.getState().project;
    const items = outfit.items.filter((i) => !i.hidden).flatMap((i) => {
      const p = i.projectId === live.id ? live : saved.get(i.projectId);
      return p ? [{ project: p, layer: i.layer, ...(i.tuck ? { tuck: i.tuck } : {}) }] : [];
    });
    const rest = items.filter((i) => i.project.id !== live.id).map((i) => i.project.edits);
    others.current = { attachments: rest.flatMap((e) => e?.attachments ?? []), insideFabric: Object.assign({}, ...rest.map((e) => e?.insideFabric ?? {})) };
    if (!items.length) { setTopo((old) => { old?.geo.dispose(); return null; }); lastOutfit.current = null; return; }
    // the same garments with one of them edited warm start from the drape; a new body, a garment added, removed,
    // moved to another layer or tucked the other way drapes again (the garments must pass each other)
    const shape = JSON.stringify({ b: outfit.body, ids: items.map((i) => [i.project.id, i.layer, i.tuck]) });
    const warm = lastOutfit.current === shape;
    const first = lastOutfit.current === null;
    const t = setTimeout(() => {
      lastOutfit.current = shape;
      countPost();
      worker.postMessage({ type: 'outfit', items, body: outfit.body, spacing: SPACING, warm });
    }, first ? 0 : 160);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outfitKey, redrape, worker]);

  // the body display off: the cloth floats in its draped shape (no gravity, no body)
  useEffect(() => { worker.postMessage({ type: 'float', on: !showBody }); }, [showBody, worker]);

  // send a rebuild shortly after edits stop; pattern / fabric edits warm start from the current drape
  const lastBody = useRef<Body | null>(null);
  const lastToken = useRef(redrape);
  const lastType = useRef(type);
  const lastProject = useRef(projectId);
  useEffect(() => {
    if (outfit) { lastBody.current = null; return; } // the outfit effect above builds
    const first = lastBody.current === null;
    const t = setTimeout(() => {
      const warm = !first && lastBody.current === body && lastToken.current === redrape && lastType.current === type && lastProject.current === projectId;
      lastProject.current = projectId;
      lastBody.current = body;
      lastToken.current = redrape;
      lastType.current = type;
      countPost();
      worker.postMessage({ type: 'build', garment: type, pieces, body, warm, spacing: SPACING, edits: simEdits });
    }, first ? 0 : 160);
    return () => clearTimeout(t);
  }, [type, projectId, pieces, body, redrape, worker, simEdits, outfit === null]);

  // stitching around pockets, patches and straps follows the attachments (debounced while dragging)
  // prints and embroidery are painted here on the main thread (Prints.tsx), so moving one does not rebuild them
  const detailKey = JSON.stringify((attachments ?? []).filter((a) => a.kind !== 'print' && a.kind !== 'embroidery'));
  useEffect(() => {
    const t = setTimeout(() => worker.postMessage({ type: 'attachments', attachments: JSON.parse(detailKey), ...(outfit ? { projectId: liveProject.id } : {}) }), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey, worker]);

  useEffect(() => {
    worker.postMessage({ type: 'mode', mode });
  }, [mode, worker]);

  useEffect(() => {
    worker.postMessage({ type: 'pose', pose: customPose });
  }, [customPose, worker]);

  useEffect(() => {
    worker.postMessage({ type: 'soft', on: softSkin });
  }, [softSkin, worker]);

  const paint = (geo: THREE.BufferGeometry, ratios: Float32Array) => {
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    if (col.count !== ratios.length) return;
    for (let i = 0; i < ratios.length; i++) {
      const c = riskColor(ratios[i] <= 0.15 ? 0 : ratios[i]);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };

  useFrame(() => {
    // pose the body and joints with the same pose the cloth was simulated against
    const M = boneMatrices(fRef.current, poseAt(pose.current.mode, pose.current.t, fRef.current, pose.current.custom));
    bones.forEach((b, i) => setBone(b, M, i));
    if (showJoints) jointPoints(fRef.current, M).forEach((p, i) => jointRefs.current[i]?.position.set(p[0], p[1], p[2]));
    if (!topo) return;
    const p = pending.current;
    if (p.pos) {
      const attr = topo.geo.getAttribute('position') as THREE.BufferAttribute;
      if (attr.array.length === p.pos.length) {
        (attr.array as Float32Array).set(p.pos);
        attr.needsUpdate = true;
        topo.geo.computeVertexNormals();
        topo.geo.computeBoundingSphere();
        detailUpdater.current?.(attr.array as Float32Array);
        attachUpdater.current?.(attr.array as Float32Array);
        hardwareUpdater.current?.(attr.array as Float32Array);
      }
      p.pos = undefined;
    }
    if (p.strain) {
      lastStrain.current = p.strain;
      if (stretch) paint(topo.geo, p.strain);
      p.strain = undefined;
    }
  });

  useEffect(() => {
    if (stretch && topo && lastStrain.current) paint(topo.geo, lastStrain.current);
  }, [stretch, topo]);

  // the tech pack export takes close-up pictures of this scene (src/three/snapshots.ts)
  const rootRef = useRef<THREE.Group>(null);
  useSnapshotRegistration(rootRef, topo);
  const sceneRef = useThree((s) => s.scene);
  const ownInside = useStore((s) => s.project.edits?.insideFabric);
  // in an outfit the cloth holds every garment: their attachments and inside fabrics count too
  const allAttachments = useMemo(() => (outfit ? [...(attachments ?? []), ...others.current.attachments] : undefined), [outfit, attachments, topo]);
  const insideFabric = useMemo(() => (outfit ? { ...others.current.insideFabric, ...(ownInside ?? {}) } : ownInside), [outfit, ownInside, topo]);
  const labelKey = JSON.stringify((allAttachments ?? attachments ?? []).filter((a) => a.kind === 'label').map((a) => [a.id, a.label, a.sheen]));
  const cloth = useMemo(
    () => (topo ? clothMaterials(topo.fabrics, topo.pat, { insideFabric }, allAttachments ?? attachments ?? []) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topo, insideFabric, labelKey],
  );
  // holes and rips of the Finish workspace are cut out of the cloth through an alpha map per panel (detailsFinish.ts)
  const holesV = useSyncExternalStore(subscribeHoles, holesVersion);
  const clothH = useMemo(() => (cloth ? { ...cloth, outside: withHoles(cloth.outside), inside: withHoles(cloth.inside) } : null), [cloth, holesV]);
  useEffect(() => () => {
    if (!cloth || !clothH) return;
    for (const m of [...clothH.outside, ...clothH.inside]) if (!cloth.outside.includes(m) && !cloth.inside.includes(m)) m.dispose();
  }, [cloth, clothH]);
  // satin, glossy and metallic finishes reflect the studio environment a little stronger than plain cloth
  useEffect(() => {
    if (!clothH) return;
    for (const m of [...clothH.outside, ...clothH.inside]) if (m.userData.finishEnv) { (m as THREE.MeshStandardMaterial).envMap = sceneRef.environment; m.needsUpdate = true; }
    invalidate();
  }, [clothH, sceneRef, invalidate]);
  return (
    <group ref={rootRef}>
      {showBody && skinned && <primitive object={skinned} material={skinMat} />}
      {showJoints && Array.from({ length: JOINT_COUNT }, (_, i) => (
        <mesh key={i} ref={(el) => { if (el) jointRefs.current[i] = el; }} geometry={jointGeo} material={jointMat} renderOrder={10} />
      ))}
      {showGarment && !loading && topo && (
        <mesh geometry={topo.geo} material={stretch || !clothH ? topo.fabrics.map(() => stretchMat) : clothH.outside} castShadow receiveShadow frustumCulled={false} />
      )}
      {showGarment && !loading && topo && clothH?.twoSided && !stretch && (
        <mesh geometry={topo.geo} material={clothH.inside} receiveShadow frustumCulled={false} />
      )}
      {showGarment && !loading && topo && <FinishBrush />}
      {showGarment && !loading && topo && <Prints geo={topo.geo} pat={topo.pat} visible={!stretch} all={allAttachments} />}
      {showGarment && !loading && topo && hardware && <Hardware data={hardware} geo={topo.geo} visible={!stretch} updater={hardwareUpdater} />}
      {showGarment && !loading && topo && attachDetails && <Details data={attachDetails} geo={topo.geo} visible={!stretch} updater={attachUpdater} />}
      {showGarment && !loading && topo && details && <Details data={details} geo={topo.geo} visible={!stretch} updater={detailUpdater} />}
      {showGarment && !loading && topo && <Pull geo={topo.geo} worker={worker} enabled={pullMode && showBody} />}
    </group>
  );
}

// re-render only when its own props change, not whenever the 3D view's toolbar state does
export default memo(ClothView);
