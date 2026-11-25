import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GarmentType, Piece } from '../data/presets';
import { bodyFrame, type Body } from './body';
import { riskColor } from './rings';
import { fabricMaterial, stretchMat } from './materials';
import { useStore } from '../store';

// Live cloth view. The simulation runs in a Web Worker (src/sim/worker.ts); this component sends it the
// pattern, fabric and body, and streams back positions and strain every frame.

const SPACING = 2.0;

interface Topo {
  geo: THREE.BufferGeometry;
  fabrics: Piece['fabric'][];
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

export default function ClothView({ type, pieces, body, stretch, showBody, showGarment, skin }: { type: GarmentType; pieces: Piece[]; body: Body; stretch: boolean; showBody: boolean; showGarment: boolean; skin: string }) {
  const [bodyGeo, setBodyGeo] = useState<THREE.BufferGeometry | null>(null);
  const skinMat = useMemo(() => skinMaterial(skin), [skin]);
  const worker = useMemo(() => new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' }), []);
  const [topo, setTopo] = useState<Topo | null>(null);
  const pending = useRef<{ pos?: Float32Array; strain?: Float32Array }>({});
  const lastStrain = useRef<Float32Array | null>(null);
  const set = useStore((s) => s.set);
  const redrape = useStore((s) => s.redrapeToken);
  const f = useMemo(() => bodyFrame(body), [body]);
  const fRef = useRef(f);
  fRef.current = f;

  useEffect(() => {
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'status') {
        set({ draping: true, simStatus: m.text });
      } else if (m.type === 'body') {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
        g.setIndex(new THREE.BufferAttribute(m.indices, 1));
        g.computeBoundingSphere();
        setBodyGeo((old) => {
          old?.dispose();
          return g;
        });
      } else if (m.type === 'built') {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(m.uv, 2));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(m.n * 3).fill(1), 3));
        geo.setIndex(new THREE.BufferAttribute(m.index, 1));
        for (const g of m.groups) geo.addGroup(g.start, g.count, g.panel);
        geo.computeVertexNormals();
        lastStrain.current = null;
        setTopo((old) => {
          old?.geo.dispose();
          return { geo, fabrics: m.fabrics };
        });
        set({ draping: true, simStatus: 'Simulating fabric…' });
      } else if (m.type === 'frame') {
        pending.current.pos = m.pos;
        if (m.strain) pending.current.strain = m.strain;
        if (m.peak) {
          const fr = fRef.current;
          const marks: [string, number][] = [['shoulders', fr.shoulderH], ['chest', fr.chestH], ['waist', fr.waistH], ['hips', fr.hipH], ['seat', fr.crotchH + 4], ['thigh', (fr.crotchH + fr.kneeH) / 2], ['knee', fr.kneeH], ['calf', fr.kneeH / 2]];
          const where = marks.reduce((b, k) => (Math.abs(k[1] - m.peak.y) < Math.abs(b[1] - m.peak.y) ? k : b))[0];
          set({ drapePeak: { ratio: m.peak.ratio, strain: m.peak.strain, where } });
        }
        if (m.sleeping) set({ draping: false });
      }
    };
    return () => worker.terminate();
  }, [worker]);

  // send a rebuild shortly after edits stop; pattern / fabric edits warm start from the current drape
  const lastBody = useRef<Body | null>(null);
  const lastToken = useRef(redrape);
  const lastType = useRef(type);
  useEffect(() => {
    const first = lastBody.current === null;
    const t = setTimeout(() => {
      const warm = !first && lastBody.current === body && lastToken.current === redrape && lastType.current === type;
      lastBody.current = body;
      lastToken.current = redrape;
      lastType.current = type;
      worker.postMessage({ type: 'build', garment: type, pieces, body, warm, spacing: SPACING });
    }, first ? 0 : 160);
    return () => clearTimeout(t);
  }, [type, pieces, body, redrape, worker]);

  const paint = (geo: THREE.BufferGeometry, ratios: Float32Array) => {
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    if (col.count !== ratios.length) return;
    for (let i = 0; i < ratios.length; i++) {
      const c = riskColor(ratios[i] <= 0.2 ? 0 : ratios[i]);
      col.setXYZ(i, c.r, c.g, c.b);
    }
    col.needsUpdate = true;
  };

  useFrame(() => {
    if (!topo) return;
    const p = pending.current;
    if (p.pos) {
      const attr = topo.geo.getAttribute('position') as THREE.BufferAttribute;
      if (attr.array.length === p.pos.length) {
        (attr.array as Float32Array).set(p.pos);
        attr.needsUpdate = true;
        topo.geo.computeVertexNormals();
        topo.geo.computeBoundingSphere();
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

  const mats = useMemo(() => (topo ? topo.fabrics.map((fb) => fabricMaterial(fb)) : []), [topo]);
  return (
    <group>
      {showBody && bodyGeo && <mesh geometry={bodyGeo} material={skinMat} castShadow receiveShadow />}
      {showGarment && topo && (
        <mesh geometry={topo.geo} material={stretch ? topo.fabrics.map(() => stretchMat) : mats} castShadow receiveShadow frustumCulled={false} />
      )}
    </group>
  );
}
