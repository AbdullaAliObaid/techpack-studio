import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HardwareMsg, TrimDesign } from '../sim/detailsHardware';
import { HW_FINISHES, HW_TYPES } from '../sim/detailsHardware';
import type { DetailUpdater } from './Details';
import { applyLook, sheenLook } from './detailsLook';
import {
  coilLoops, cordPuller, customPuller, faceTextures, holesGeometry, metalTooth, moldedTooth, ringPuller, shellGeometry,
  sliderBody, standardPuller, tabPuller, type ShellType,
} from './detailsTrim';

// Hardware trims on the live cloth: rivets, eyelets, studs, buttons, snaps and zippers. Each trim is anchored to a
// cloth triangle (barycentric) and its pose is rebuilt from the latest particle positions every frame, so it follows
// the drape and the movement. One InstancedMesh per part and material keeps the draw calls low.
// Trim geometry is modelled for a diameter of 1, base on z = 0, pointing along +z (the cloth's outward normal).
// Every attachment has its own design (outline, holes, artwork, colour, sheen, zipper parts); a row made with `count`
// repeats that one design. Buttons, and any trim with a drawn outline or artwork, use the extruded shell from detailsTrim.

const LIFT = 0.05; // cm off the cloth surface
const FINISH_COLOR = ['#d8dadf', '#d6b25a', '#c8774a', '#6b7078', '#18181a', '#efeeea'];
const isMetal = (f: number) => f <= 3;

const lathe = (pts: [number, number][], seg = 28) => {
  const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg);
  g.rotateX(Math.PI / 2); // lathe axis y becomes z
  return g;
};
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g : g.toNonIndexed())), false) ?? gs[0];

/** Plain round trims without a drawn outline or artwork. */
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
  snap: () => lathe([[0.5, 0], [0.5, 0.05], [0.46, 0.1], [0.38, 0.11], [0.34, 0.08], [0.3, 0.1], [0.27, 0.17], [0.18, 0.21], [0, 0.225]]),
};

interface Entry { kind: 0 | 1 | 2 | 3 | 4; i: number; s?: number; side?: number; scale?: number }
interface PartSet { geo: () => THREE.BufferGeometry; mat: THREE.Material | THREE.Material[]; entries: Entry[] }

interface Built { group: THREE.Group; update: DetailUpdater; dispose: () => void }

function build(m: HardwareMsg, geo: THREE.BufferGeometry): Built {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const darkMat = new THREE.MeshStandardMaterial({ color: '#1b1815', metalness: 0, roughness: 0.7, side: THREE.DoubleSide });
  const tapeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  disposables.push(darkMat, tapeMat);

  const matCache = new Map<string, THREE.MeshPhysicalMaterial>();
  /** material for a finish (index) or CSS colour, with a sheen. Metal finishes stay metal unless matte makes them brushed. */
  const material = (finish: number, color: string | undefined, sheen: TrimDesign['sheen'], metalOverride?: boolean): THREE.MeshPhysicalMaterial => {
    const metal = metalOverride ?? isMetal(finish);
    const key = [finish, color, sheen, metal].join('|');
    let mt = matCache.get(key);
    if (!mt) {
      mt = new THREE.MeshPhysicalMaterial({ color: color ?? FINISH_COLOR[finish] ?? '#ffffff', side: THREE.DoubleSide });
      applyLook(mt, sheenLook(sheen ?? (metal ? 'metallic' : 'glossy'), metal));
      matCache.set(key, mt);
      disposables.push(mt);
    }
    return mt;
  };
  const finishOf = (f?: string) => Math.max(0, HW_FINISHES.indexOf((f ?? 'silver') as never));

  // ---- which instanced sets exist ----
  const sets = new Map<string, PartSet>();
  const add = (key: string, geoFn: () => THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], e: Entry) => {
    let st = sets.get(key);
    if (!st) { st = { geo: geoFn, mat, entries: [] }; sets.set(key, st); }
    st.entries.push(e);
  };
  const designs = m.designs ?? [];
  const designOf = (i: number): TrimDesign | undefined => designs[m.design?.[i] ?? 0];

  // drawn shells and their textures are built once per design
  const shellCache = new Map<string, ReturnType<typeof shellGeometry>>();
  const drawnSets = (di: number, d: TrimDesign, type: ShellType, e: Entry) => {
    const hw = d.hardware, f = finishOf(hw.finish), metal = isMetal(f);
    const sheen = hw.sheen ?? d.sheen;
    const key = `drawn:${di}`;
    let shell = shellCache.get(key);
    if (!shell) { shell = shellGeometry(hw.outline, type, 1); shellCache.set(key, shell); disposables.push(shell.geo); }
    const sh = shell;
    const body = material(f, hw.color, sheen);
    if (!sets.has(`${key}:shell`)) {
      const faceMat = body.clone();
      if (hw.layers && hw.layers.length) {
        const ft = faceTextures(sh, hw.layers, metal);
        faceMat.map = ft.map; faceMat.bumpMap = ft.bump; faceMat.bumpScale = metal ? 2.2 : 1.2;
        disposables.push(ft.map, ft.bump);
      }
      disposables.push(faceMat);
      add(`${key}:shell`, () => sh.geo, [body, faceMat], e);
      if (type === 'button') {
        const hg = holesGeometry(sh, hw.holes ?? (metal ? 'shank' : 4));
        if (hg) {
          disposables.push(hg.holes, hg.thread);
          add(`${key}:holes`, () => hg.holes, darkMat, e);
          add(`${key}:thread`, () => hg.thread, new THREE.MeshStandardMaterial({ color: d.thread, roughness: 0.9 }), e);
          disposables.push(sets.get(`${key}:thread`)!.mat as THREE.Material);
        }
      }
    } else {
      for (const k of ['shell', 'holes', 'thread']) sets.get(`${key}:${k}`)?.entries.push(e);
    }
  };

  for (let i = 0; i < m.count; i++) {
    const t = HW_TYPES[m.kind[i]], f = m.finish[i], d = designOf(i), di = m.design?.[i] ?? 0;
    const e: Entry = { kind: 0, i };
    const hw = d?.hardware;
    const sheen = hw?.sheen ?? d?.sheen;
    const drawn = !!d && (t === 'button' || ((t === 'snap' || t === 'stud' || t === 'rivet') && ((hw?.outline?.length ?? 0) > 2 || (hw?.layers?.length ?? 0) > 0)));
    if (drawn && d && (t === 'button' || t === 'snap' || t === 'stud' || t === 'rivet')) { drawnSets(di, d, t, e); continue; }
    const mt = material(f, hw?.color, sheen);
    if (t === 'rivet') add(`rivet:${mt.uuid}`, GEO.rivet, mt, e);
    else if (t === 'eyelet') { add(`eyelet:${mt.uuid}`, GEO.eyelet, mt, e); add('eyeletHole', GEO.eyeletHole, darkMat, e); }
    else if (t === 'stud') add(`stud:${mt.uuid}`, GEO.stud, mt, e);
    else if (t === 'snap') add(`snap:${mt.uuid}`, GEO.snap, mt, e);
  }
  // zipper samples, tape geometry, parts per zipper
  const Z = m.zipTri.length / 3;
  const customShells: (ReturnType<typeof customPuller> | null)[] = [];
  for (let z = 0; z < m.zipCount; z++) {
    const d = designs[m.zipDesign?.[z] ?? 0];
    const hw = d?.hardware;
    const zd = hw?.zipper;
    const f = m.zipFinish[z], sheen = hw?.sheen ?? d?.sheen;
    const tooth = zd?.teeth ?? 'metal';
    const pf = finishOf(zd?.pullerFinish ?? hw?.finish);
    const toothColor = zd?.teethColor ?? '#ece9e0';
    const toothMat = tooth === 'metal' ? material(f, hw?.color, sheen) : material(7, toothColor, tooth === 'coil' ? (sheen ?? 'satin') : (sheen ?? 'glossy'), false);
    const L = m.zipLen[z];
    for (let s = 0; s < L; s++) {
      if (tooth === 'coil') { add(`z${z}:coil`, coilLoops, toothMat, { kind: 1, i: z, s, side: -1 }); add(`z${z}:coil`, coilLoops, toothMat, { kind: 1, i: z, s, side: 1 }); }
      else add(`z${z}:tooth`, tooth === 'molded' ? moldedTooth : metalTooth, toothMat, { kind: 1, i: z, s });
    }
    const pm = material(pf, undefined, zd?.pullerFinish ? undefined : sheen);
    add(`z${z}:slider`, sliderBody, pm, { kind: 2, i: z });
    const pull = zd?.puller ?? 'standard';
    if (pull === 'ring') add(`z${z}:ring`, ringPuller, pm, { kind: 3, i: z });
    else if (pull === 'tab') add(`z${z}:tab`, tabPuller, material(pf, undefined, 'matte', false), { kind: 3, i: z });
    else if (pull === 'cord') {
      const cp = cordPuller();
      disposables.push(cp.cord, cp.tip);
      add(`z${z}:cord`, () => cp.cord, material(pf, undefined, 'matte', false), { kind: 3, i: z });
      add(`z${z}:cordtip`, () => cp.tip, material(0, undefined, 'metallic'), { kind: 3, i: z });
    } else if (pull === 'custom' && zd?.pullerOutline && zd.pullerOutline.length > 2) {
      const shell = customPuller(zd.pullerOutline);
      disposables.push(shell.geo);
      customShells[z] = shell;
      const body = material(pf, undefined, zd.pullerFinish ? 'glossy' : sheen);
      const faceMat = body.clone();
      if (zd.pullerLayers?.length) {
        const ft = faceTextures(shell, zd.pullerLayers, isMetal(pf));
        faceMat.map = ft.map; faceMat.bumpMap = ft.bump; faceMat.bumpScale = 2;
        disposables.push(ft.map, ft.bump);
      }
      disposables.push(faceMat);
      add(`z${z}:custom`, () => shell.geo, [body, faceMat], { kind: 3, i: z, scale: shell.ext });
    } else add(`z${z}:puller`, standardPuller, pm, { kind: 3, i: z });
  }

  const meshes: { mesh: THREE.InstancedMesh; set: PartSet; arr: Float32Array }[] = [];
  sets.forEach((set) => {
    const g = set.geo();
    const n = set.entries.length;
    const im = new THREE.InstancedMesh(g, set.mat, n);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.castShadow = true;
    group.add(im);
    disposables.push(g);
    meshes.push({ mesh: im, set, arr: im.instanceMatrix.array as Float32Array });
  });

  // zipper tape: 4 vertices per sample (outer left, inner left, inner right, outer right)
  const tPos = new Float32Array(Z * 12), tNor = new Float32Array(Z * 12), tCol = new Float32Array(Z * 12);
  const tIdx: number[] = [];
  const tapeFor = (z: number) => {
    const d = designs[m.zipDesign?.[z] ?? 0];
    const css = d?.hardware.zipper?.tape;
    return css ? new THREE.Color(css) : m.zipFinish[z] === 5 ? new THREE.Color('#e9e8e3') : new THREE.Color('#1d1d20');
  };
  for (let z = 0; z < m.zipCount; z++) {
    const c = tapeFor(z);
    const dark = new THREE.Color('#0b0a09');
    for (let s = 0; s < m.zipLen[z]; s++) {
      const v = (m.zipStart[z] + s) * 4;
      // faint rib every other sample so the tape reads as woven
      const rib = s % 2 ? 0.93 : 1;
      for (let q = 0; q < 4; q++) {
        const cc = m.zipOpen[z] && (q === 1 || q === 2) ? dark : c;
        tCol.set([cc.r * rib, cc.g * rib, cc.b * rib], (v + q) * 3);
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
            const g = gapAt(z, s), side = e.side ?? (s % 2 ? 1 : -1);
            const coil = e.side !== undefined;
            off = side * (g / 2 + (coil ? 0.17 : 0.06));
            sc = Math.min(1.3, Math.max(0.75, m.zipSize[z]));
            if (coil) {
              // the two chains interlock: offset half a winding along the tape
              const sh = side * 0.065 * sc;
              setM(arr, o, lx * sc, ly * sc, lz * sc, tx * sc, ty * sc, tz * sc, nx * sc, ny * sc, nz * sc,
                zP[i * 3] + nx * LIFT + lx * off + tx * sh, zP[i * 3 + 1] + ny * LIFT + ly * off + ty * sh, zP[i * 3 + 2] + nz * LIFT + lz * off + tz * sh);
              j++;
              continue;
            }
            setM(arr, o, lx * sc, ly * sc, lz * sc, tx * sc, ty * sc, tz * sc, nx * sc, ny * sc, nz * sc,
              zP[i * 3] + nx * LIFT + lx * off, zP[i * 3 + 1] + ny * LIFT + ly * off, zP[i * 3 + 2] + nz * LIFT + lz * off);
          } else {
            sc = e.scale ?? Math.min(1.4, Math.max(0.8, m.zipSize[z]));
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
