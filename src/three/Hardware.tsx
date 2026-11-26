import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HardwareMsg } from '../sim/detailsHardware';
import { HW_TYPES } from '../sim/detailsHardware';
import type { DetailUpdater } from './Details';

// Hardware trims on the live cloth: rivets, eyelets, studs, buttons, snaps and zippers. Each trim is anchored to a
// cloth triangle (barycentric) and its pose is rebuilt from the latest particle positions every frame, so it follows
// the drape and the movement. One InstancedMesh per part and material class keeps the draw calls low.
// Trim geometry is modelled for a diameter of 1, base on z = 0, pointing along +z (the cloth's outward normal).

const LIFT = 0.05; // cm off the cloth surface
const FINISH_COLOR = ['#d8dadf', '#d6b25a', '#c8774a', '#6b7078', '#18181a', '#efeeea'];
const isMetal = (f: number) => f <= 3;

const lathe = (pts: [number, number][], seg = 28) => {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2); // lathe axis y becomes z
  return g;
};
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g : g.toNonIndexed())), false) ?? gs[0];
const moved = (g: THREE.BufferGeometry, x: number, y: number, z: number) => { g.translate(x, y, z); return g; };

/** Parts per trim: 'finish' parts take the finish colour (metal or plastic by finish), 'dark' parts are fixed dark. */
const GEO = {
  rivet: () => lathe([[0.5, 0], [0.5, 0.05], [0.46, 0.09], [0.41, 0.09], ...Array.from({ length: 6 }, (_, k) => {
    const t = ((k + 1) / 6) * (Math.PI / 2);
    return [0.41 * Math.cos(t), 0.09 + 0.27 * Math.sin(t)] as [number, number];
  })]),
  eyelet: () => lathe([[0.24, 0], [0.24, 0.07], [0.27, 0.12], [0.34, 0.14], [0.44, 0.11], [0.5, 0.06], [0.5, 0]]),
  eyeletHole: () => lathe([[0.25, 0.012], [0, 0.012]]),
  stud: () => {
    const cone = new THREE.ConeGeometry(0.42, 0.34, 4);
    cone.rotateY(Math.PI / 4);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, 0, 0.06 + 0.17);
    return merge([lathe([[0.5, 0], [0.5, 0.05], [0.44, 0.07], [0.3, 0.07]]), cone]);
  },
  button4: () => lathe([[0.5, 0], [0.5, 0.1], [0.47, 0.14], [0.39, 0.155], [0.33, 0.1], [0.22, 0.085], [0, 0.08]], 36),
  button4Holes: () => merge([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => moved(lathe([[0.065, 0.088], [0, 0.088]], 12), sx * 0.13, sy * 0.13, 0))),
  buttonShank: () => lathe([[0.5, 0], [0.5, 0.06], [0.47, 0.13], [0.42, 0.18], [0.35, 0.19], [0.32, 0.17], [0.2, 0.16], [0, 0.155]], 36),
  snap: () => lathe([[0.5, 0], [0.5, 0.05], [0.46, 0.1], [0.38, 0.11], [0.34, 0.08], [0.3, 0.1], [0.27, 0.17], [0.18, 0.21], [0, 0.225]]),
  tooth: () => merge([new THREE.BoxGeometry(0.3, 0.32, 0.12).translate(0, 0, 0.06), new THREE.BoxGeometry(0.2, 0.14, 0.17).translate(0.0, 0.0, 0.085)]),
  slider: () => merge([new THREE.BoxGeometry(1.05, 0.95, 0.2).translate(0, 0, 0.1), new THREE.BoxGeometry(0.5, 0.35, 0.16).translate(0, 0.45, 0.28)]),
  puller: () => {
    const w = 0.28, l = 1.3, r = 0.2;
    const s = new THREE.Shape();
    s.moveTo(-w + r, 0); s.lineTo(w - r, 0); s.quadraticCurveTo(w, 0, w, r); s.lineTo(w, l - r); s.quadraticCurveTo(w, l, w - r, l);
    s.lineTo(-w + r, l); s.quadraticCurveTo(-w, l, -w, l - r); s.lineTo(-w, r); s.quadraticCurveTo(-w, 0, -w + r, 0);
    const hole = new THREE.Path(); hole.absarc(0, l * 0.68, 0.11, 0, Math.PI * 2, true); s.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false, curveSegments: 10 });
    g.rotateX(0.2); // lifts the far end a little
    g.translate(0, 0.38, 0.3);
    return g;
  },
};

type Cls = 'metal' | 'plastic' | 'dark';
interface Entry { kind: 0 | 1 | 2 | 3; i: number; s?: number }
interface PartSet { geo: () => THREE.BufferGeometry; cls: Cls; entries: Entry[]; finish: number[] }

interface Built { group: THREE.Group; update: DetailUpdater; dispose: () => void }

function build(m: HardwareMsg, geo: THREE.BufferGeometry): Built {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const metalMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 1, roughness: 0.28, side: THREE.DoubleSide, envMapIntensity: 1.2 });
  const plasticMat = new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0, roughness: 0.4, side: THREE.DoubleSide });
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1815', metalness: 0, roughness: 0.7, side: THREE.DoubleSide });
  const tapeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  disposables.push(metalMat, plasticMat, darkMat, tapeMat);
  const matOf = { metal: metalMat, plastic: plasticMat, dark: darkMat };

  // ---- which instanced sets exist ----
  const sets = new Map<string, PartSet>();
  const add = (key: string, geoFn: () => THREE.BufferGeometry, cls: Cls, e: Entry, finish: number) => {
    let s = sets.get(key);
    if (!s) { s = { geo: geoFn, cls, entries: [], finish: [] }; sets.set(key, s); }
    s.entries.push(e);
    s.finish.push(finish);
  };
  for (let i = 0; i < m.count; i++) {
    const t = HW_TYPES[m.kind[i]], f = m.finish[i], c: Cls = isMetal(f) ? 'metal' : 'plastic', e: Entry = { kind: 0, i };
    if (t === 'rivet') add(`rivet:${c}`, GEO.rivet, c, e, f);
    else if (t === 'eyelet') { add(`eyelet:${c}`, GEO.eyelet, c, e, f); add('eyeletHole', GEO.eyeletHole, 'dark', e, f); }
    else if (t === 'stud') add(`stud:${c}`, GEO.stud, c, e, f);
    else if (t === 'snap') add(`snap:${c}`, GEO.snap, c, e, f);
    else if (t === 'button') {
      if (c === 'metal') add('buttonShank', GEO.buttonShank, 'metal', e, f);
      else { add(`button4:${c}`, GEO.button4, c, e, f); add('button4Holes', GEO.button4Holes, 'dark', e, f); }
    }
  }
  // zipper samples, tape geometry
  const Z = m.zipTri.length / 3;
  for (let z = 0; z < m.zipCount; z++) {
    const f = m.zipFinish[z], c: Cls = isMetal(f) ? 'metal' : 'plastic';
    for (let s = 0; s < m.zipLen[z]; s++) add(`tooth:${c}`, GEO.tooth, c, { kind: 1, i: z, s }, f);
    add(`slider:${c}`, GEO.slider, c, { kind: 2, i: z }, f);
    add(`puller:${c}`, GEO.puller, c, { kind: 3, i: z }, f);
  }

  const meshes: { mesh: THREE.InstancedMesh; set: PartSet; arr: Float32Array }[] = [];
  const col = new THREE.Color();
  sets.forEach((set) => {
    const g = set.geo();
    const n = set.entries.length;
    const im = new THREE.InstancedMesh(g, matOf[set.cls], n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.castShadow = true;
    if (set.cls !== 'dark') set.finish.forEach((f, j) => im.setColorAt(j, col.set(FINISH_COLOR[f] ?? '#ffffff')));
    group.add(im);
    disposables.push(g);
    meshes.push({ mesh: im, set, arr: im.instanceMatrix.array as Float32Array });
  });

  // zipper tape: 4 vertices per sample (outer left, inner left, inner right, outer right)
  const tPos = new Float32Array(Z * 12), tNor = new Float32Array(Z * 12), tCol = new Float32Array(Z * 12);
  const tIdx: number[] = [];
  const tapeFor = (f: number) => (f === 5 ? new THREE.Color('#e9e8e3') : new THREE.Color('#1d1d20'));
  for (let z = 0; z < m.zipCount; z++) {
    const c = tapeFor(m.zipFinish[z]);
    const dark = new THREE.Color('#0b0a09');
    for (let s = 0; s < m.zipLen[z]; s++) {
      const v = (m.zipStart[z] + s) * 4;
      for (let q = 0; q < 4; q++) {
        const cc = m.zipOpen[z] && (q === 1 || q === 2) ? dark : c;
        tCol.set([cc.r, cc.g, cc.b], (v + q) * 3);
      }
      if (s + 1 < m.zipLen[z]) {
        const w = v + 4;
        // left tape, centre gap, right tape
        tIdx.push(v, w, w + 1, v, w + 1, v + 1, v + 1, w + 1, w + 2, v + 1, w + 2, v + 2, v + 2, w + 2, w + 3, v + 2, w + 3, v + 3);
      }
    }
  }
  const tGeo = new THREE.BufferGeometry();
  const tPosA = new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage);
  const tNorA = new THREE.BufferAttribute(tNor, 3).setUsage(THREE.DynamicDrawUsage);
  tGeo.setAttribute('position', tPosA);
  tGeo.setAttribute('normal', tNorA);
  tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
  tGeo.setIndex(tIdx);
  const tape = new THREE.Mesh(tGeo, tapeMat);
  tape.frustumCulled = false;
  if (Z > 0) group.add(tape);
  disposables.push(tGeo);

  // ---- per frame ----
  const zP = new Float32Array(Z * 3), zN = new Float32Array(Z * 3);
  const sliderAt = new Int32Array(m.zipCount);
  for (let z = 0; z < m.zipCount; z++) sliderAt[z] = m.zipOpen[z] ? Math.floor(m.zipLen[z] * 0.78) : Math.max(0, Math.round(m.zipLen[z] * 0.04));
  const gapAt = (z: number, s: number) => {
    if (!m.zipOpen[z]) return 0;
    const k = Math.max(0, Math.min(1, (sliderAt[z] - s) / 3));
    return m.zipSize[z] * 0.5 * k * k * (3 - 2 * k);
  };

  let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0;
  let ux = 0, uy = 0, uz = 0, rx = 0, ry = 0, rz = 0;
  const nrmArr = geo.getAttribute('normal') as THREE.BufferAttribute;

  /** point, smooth outward normal at weights over a triangle */
  const surface = (pos: Float32Array, t: Uint32Array, w: Float32Array, sg: number, o: number) => {
    const a = t[o] * 3, b = t[o + 1] * 3, c = t[o + 2] * 3;
    const w0 = w[o], w1 = w[o + 1], w2 = w[o + 2];
    px = w0 * pos[a] + w1 * pos[b] + w2 * pos[c];
    py = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1];
    pz = w0 * pos[a + 2] + w1 * pos[b + 2] + w2 * pos[c + 2];
    const ex = pos[b] - pos[a], ey = pos[b + 1] - pos[a + 1], ez = pos[b + 2] - pos[a + 2];
    const fx = pos[c] - pos[a], fy = pos[c + 1] - pos[a + 1], fz = pos[c + 2] - pos[a + 2];
    let fnx = (ey * fz - ez * fy) * sg, fny = (ez * fx - ex * fz) * sg, fnz = (ex * fy - ey * fx) * sg;
    const fl = Math.hypot(fnx, fny, fnz);
    if (fl < 1e-12) { nx = 0; ny = 1; nz = 0; return; }
    fnx /= fl; fny /= fl; fnz /= fl;
    const N = nrmArr.array as Float32Array;
    if (N.length === pos.length) {
      const sx = w0 * N[a] + w1 * N[b] + w2 * N[c], sy = w0 * N[a + 1] + w1 * N[b + 1] + w2 * N[c + 1], sz = w0 * N[a + 2] + w1 * N[b + 2] + w2 * N[c + 2];
      const sl = Math.hypot(sx, sy, sz);
      if (sl > 1e-6) {
        const d = (sx * fnx + sy * fny + sz * fnz) >= 0 ? 1 / sl : -1 / sl;
        nx = sx * d; ny = sy * d; nz = sz * d;
        return;
      }
    }
    nx = fnx; ny = fny; nz = fnz;
  };
  const setM = (arr: Float32Array, o: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, tx: number, ty: number, tz: number) => {
    arr[o] = ax; arr[o + 1] = ay; arr[o + 2] = az; arr[o + 3] = 0;
    arr[o + 4] = bx; arr[o + 5] = by; arr[o + 6] = bz; arr[o + 7] = 0;
    arr[o + 8] = cx; arr[o + 9] = cy; arr[o + 10] = cz; arr[o + 11] = 0;
    arr[o + 12] = tx; arr[o + 13] = ty; arr[o + 14] = tz; arr[o + 15] = 1;
  };

  const update: DetailUpdater = (pos) => {
    if (pos.length !== m.n * 3) return;
    // zipper centre line: points, normals, tangents
    for (let z = 0; z < m.zipCount; z++) {
      const s0 = m.zipStart[z], L = m.zipLen[z];
      for (let s = 0; s < L; s++) {
        const i = s0 + s;
        surface(pos, m.zipTri, m.zipW, m.zipSign[i], i * 3);
        zP[i * 3] = px; zP[i * 3 + 1] = py; zP[i * 3 + 2] = pz; zN[i * 3] = nx; zN[i * 3 + 1] = ny; zN[i * 3 + 2] = nz;
      }
    }
    for (let z = 0; z < m.zipCount; z++) {
      const s0 = m.zipStart[z], L = m.zipLen[z];
      for (let s = 0; s < L; s++) {
        const i = s0 + s, a = s0 + Math.max(0, s - 1), b = s0 + Math.min(L - 1, s + 1);
        const n0 = zN[i * 3], n1 = zN[i * 3 + 1], n2 = zN[i * 3 + 2];
        let tx = zP[b * 3] - zP[a * 3], ty = zP[b * 3 + 1] - zP[a * 3 + 1], tz = zP[b * 3 + 2] - zP[a * 3 + 2];
        const d = tx * n0 + ty * n1 + tz * n2;
        tx -= d * n0; ty -= d * n1; tz -= d * n2;
        const tl = Math.hypot(tx, ty, tz) || 1;
        tx /= tl; ty /= tl; tz /= tl;
        const lx = ty * n2 - tz * n1, ly = tz * n0 - tx * n2, lz = tx * n1 - ty * n0; // lateral = t x n
        const g = gapAt(z, s), hs = m.zipSize[z] / 2;
        const o = i * 12, bx = zP[i * 3] + n0 * LIFT, by = zP[i * 3 + 1] + n1 * LIFT, bz = zP[i * 3 + 2] + n2 * LIFT;
        const offs = [-(g / 2 + hs), -g / 2, g / 2, g / 2 + hs];
        for (let q = 0; q < 4; q++) {
          tPos[o + q * 3] = bx + lx * offs[q]; tPos[o + q * 3 + 1] = by + ly * offs[q]; tPos[o + q * 3 + 2] = bz + lz * offs[q];
          tNor[o + q * 3] = n0; tNor[o + q * 3 + 1] = n1; tNor[o + q * 3 + 2] = n2;
        }
        // stash tangent for the teeth in the unused tail of the matrix pass below (recomputed there)
      }
    }
    tPosA.needsUpdate = true;
    tNorA.needsUpdate = true;

    for (const { mesh, set, arr } of meshes) {
      let j = 0;
      for (const e of set.entries) {
        const o = j * 16;
        if (e.kind === 0) {
          surface(pos, m.tri, m.w, m.sign[e.i], e.i * 3);
          const al = m.up[e.i * 2], be = m.up[e.i * 2 + 1];
          const a0 = m.tri[e.i * 3] * 3, b0 = m.tri[e.i * 3 + 1] * 3, c0 = m.tri[e.i * 3 + 2] * 3;
          ux = al * (pos[b0] - pos[a0]) + be * (pos[c0] - pos[a0]);
          uy = al * (pos[b0 + 1] - pos[a0 + 1]) + be * (pos[c0 + 1] - pos[a0 + 1]);
          uz = al * (pos[b0 + 2] - pos[a0 + 2]) + be * (pos[c0 + 2] - pos[a0 + 2]);
          const d = ux * nx + uy * ny + uz * nz;
          ux -= d * nx; uy -= d * ny; uz -= d * nz;
          const l = Math.hypot(ux, uy, uz) || 1;
          ux /= l; uy /= l; uz /= l;
          rx = uy * nz - uz * ny; ry = uz * nx - ux * nz; rz = ux * ny - uy * nx;
          const sz = m.size[e.i];
          setM(arr, o, rx * sz, ry * sz, rz * sz, ux * sz, uy * sz, uz * sz, nx * sz, ny * sz, nz * sz, px + nx * LIFT, py + ny * LIFT, pz + nz * LIFT);
        } else {
          const z = e.i, s = e.kind === 1 ? e.s! : sliderAt[z];
          const i = m.zipStart[z] + s, L = m.zipLen[z], s0 = m.zipStart[z];
          const a = s0 + Math.max(0, s - 1), b = s0 + Math.min(L - 1, s + 1);
          nx = zN[i * 3]; ny = zN[i * 3 + 1]; nz = zN[i * 3 + 2];
          let tx = zP[b * 3] - zP[a * 3], ty = zP[b * 3 + 1] - zP[a * 3 + 1], tz = zP[b * 3 + 2] - zP[a * 3 + 2];
          const d = tx * nx + ty * ny + tz * nz;
          tx -= d * nx; ty -= d * ny; tz -= d * nz;
          const tl = Math.hypot(tx, ty, tz) || 1;
          tx /= tl; ty /= tl; tz /= tl;
          const lx = ty * nz - tz * ny, ly = tz * nx - tx * nz, lz = tx * ny - ty * nx;
          // geometry x = lateral, y = along (down), z = out
          let off = 0, sc = 1;
          if (e.kind === 1) {
            const g = gapAt(z, s), side = s % 2 ? 1 : -1;
            off = side * (g / 2 + 0.06);
            sc = Math.min(1.3, Math.max(0.75, m.zipSize[z]));
            setM(arr, o, lx * sc, ly * sc, lz * sc, tx * sc, ty * sc, tz * sc, nx * sc, ny * sc, nz * sc,
              zP[i * 3] + nx * LIFT + lx * off, zP[i * 3 + 1] + ny * LIFT + ly * off, zP[i * 3 + 2] + nz * LIFT + lz * off);
          } else {
            sc = Math.min(1.4, Math.max(0.8, m.zipSize[z]));
            setM(arr, o, lx * sc, ly * sc, lz * sc, tx * sc, ty * sc, tz * sc, nx * sc, ny * sc, nz * sc,
              zP[i * 3] + nx * (LIFT + 0.02), zP[i * 3 + 1] + ny * (LIFT + 0.02), zP[i * 3 + 2] + nz * (LIFT + 0.02));
          }
        }
        j++;
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  };

  return { group, update, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export default function Hardware({ data, geo, visible, updater }: {
  data: HardwareMsg;
  geo: THREE.BufferGeometry;
  visible: boolean;
  updater: { current: DetailUpdater | null };
}) {
  const built = useMemo(() => build(data, geo), [data, geo]);
  useEffect(() => () => built.dispose(), [built]);
  useEffect(() => {
    updater.current = visible ? built.update : null;
    if (visible) built.update((geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
    return () => { updater.current = null; };
  }, [built, geo, visible, updater]);
  return visible ? <primitive object={built.group} /> : null;
}
