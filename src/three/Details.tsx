import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { DetailsMsg } from '../sim/details';
import { ANCHOR, DASH } from '../sim/details';

// Draws construction details on the live cloth. Positions come from barycentric points on cloth triangles,
// refreshed from the latest particle positions every frame with no allocations.

const LIFT = 0.06; // cm along the cloth normal, avoids z-fighting
const HALF_W = 0.085; // half width of a stitch, cm

export type DetailUpdater = (pos: Float32Array) => void;

interface Built {
  group: THREE.Group;
  update: DetailUpdater;
  dispose: () => void;
}

function build(m: DetailsMsg): Built {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];

  /* ---- stitches ---- */
  const D = m.dashCount;
  const sPos = new Float32Array(D * 12), sNor = new Float32Array(D * 12), sCol = new Float32Array(D * 12);
  const sIdx = new Uint32Array(D * 6);
  const pal = m.palette.map((h) => new THREE.Color(h));
  for (let i = 0; i < D; i++) {
    const c = pal[m.dashCol[i]] ?? pal[0];
    for (let v = 0; v < 4; v++) { sCol[i * 12 + v * 3] = c.r; sCol[i * 12 + v * 3 + 1] = c.g; sCol[i * 12 + v * 3 + 2] = c.b; }
    const b = i * 4;
    sIdx.set([b, b + 1, b + 2, b, b + 2, b + 3], i * 6);
  }
  const sGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(sPos, 3).setUsage(THREE.DynamicDrawUsage);
  const norAttr = new THREE.BufferAttribute(sNor, 3).setUsage(THREE.DynamicDrawUsage);
  sGeo.setAttribute('position', posAttr);
  sGeo.setAttribute('normal', norAttr);
  sGeo.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  sGeo.setIndex(new THREE.BufferAttribute(sIdx, 1));
  const sMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stitches = new THREE.Mesh(sGeo, sMat);
  stitches.frustumCulled = false;
  group.add(stitches);
  disposables.push(sGeo, sMat);

  /* ---- instanced anchors ---- */
  const A = m.anchorCount;
  const idx = (kind: number) => { const r: number[] = []; for (let i = 0; i < A; i++) if (m.anchorKind[i] === kind) r.push(i); return r; };
  const loops = idx(ANCHOR.loop), rivets = idx(ANCHOR.rivet), buttons = idx(ANCHOR.button), covered = idx(ANCHOR.coveredButton);

  const cyl = (r: number, h: number, seg = 20) => { const g = new THREE.CylinderGeometry(r, r, h, seg); g.rotateX(Math.PI / 2); return g; };
  const make = (geo: THREE.BufferGeometry, mat: THREE.Material, count: number) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.frustumCulled = false;
    im.count = count;
    group.add(im);
    disposables.push(geo, mat);
    return im;
  };
  const tint = (im: THREE.InstancedMesh, list: number[]) => {
    list.forEach((a, j) => im.setColorAt(j, pal[m.anchorCol[a]] ?? pal[0]));
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  };
  const loopMesh = make(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.9 }), loops.length);
  const rivetMesh = make(cyl(1, 0.14), new THREE.MeshStandardMaterial({ color: '#d28a4a', metalness: 0.85, roughness: 0.3 }), rivets.length);
  const rivetCap = make(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#e0a060', metalness: 0.9, roughness: 0.22 }), rivets.length);
  const btnMesh = make(cyl(1, 0.2, 24), new THREE.MeshStandardMaterial({ roughness: 0.35 }), buttons.length);
  const holeMesh = make(cyl(0.11, 0.24, 8), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6 }), buttons.length * 4);
  const covMesh = make(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ roughness: 0.9 }), covered.length);
  tint(loopMesh, loops); tint(btnMesh, buttons); tint(covMesh, covered);
  // loops are slightly darker than the cloth they sit on so they read as a separate strap
  loopMesh.material = loopMesh.material as THREE.Material;

  const mats: [THREE.InstancedMesh, number[]][] = [[loopMesh, loops], [rivetMesh, rivets], [rivetCap, rivets], [btnMesh, buttons], [covMesh, covered]];
  void mats;

  // scratch values, allocated once
  let nx = 0, ny = 0, nz = 0, px = 0, py = 0, pz = 0;
  const tri = (pos: Float32Array, t: Uint32Array, w: Float32Array, sg: number, ti: number, wi: number) => {
    const a = t[ti] * 3, b = t[ti + 1] * 3, c = t[ti + 2] * 3;
    const w0 = w[wi], w1 = w[wi + 1], w2 = w[wi + 2];
    px = w0 * pos[a] + w1 * pos[b] + w2 * pos[c];
    py = w0 * pos[a + 1] + w1 * pos[b + 1] + w2 * pos[c + 1];
    pz = w0 * pos[a + 2] + w1 * pos[b + 2] + w2 * pos[c + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    nx = uy * vz - uz * vy; ny = uz * vx - ux * vz; nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) { nx = 0; ny = 1; nz = 0; } else { nx = (nx / l) * sg; ny = (ny / l) * sg; nz = (nz / l) * sg; }
  };

  const setM = (arr: Float32Array, o: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, tx: number, ty: number, tz: number) => {
    arr[o] = ax; arr[o + 1] = ay; arr[o + 2] = az; arr[o + 3] = 0;
    arr[o + 4] = bx; arr[o + 5] = by; arr[o + 6] = bz; arr[o + 7] = 0;
    arr[o + 8] = cx; arr[o + 9] = cy; arr[o + 10] = cz; arr[o + 11] = 0;
    arr[o + 12] = tx; arr[o + 13] = ty; arr[o + 14] = tz; arr[o + 15] = 1;
  };

  // frame of an anchor: n = outward normal, u = "down the garment" along the surface, r = u x n
  let ux = 0, uy = 0, uz = 0, rx = 0, ry = 0, rz = 0;
  const frame = (pos: Float32Array, a: number) => {
    const ti = a * 3, wi = a * 3;
    tri(pos, m.anchorTri, m.anchorW, m.anchorSign[a], ti, wi);
    const a0 = m.anchorTri[ti] * 3, b0 = m.anchorTri[ti + 1] * 3, c0 = m.anchorTri[ti + 2] * 3;
    const al = m.anchorUp[a * 2], be = m.anchorUp[a * 2 + 1];
    ux = al * (pos[b0] - pos[a0]) + be * (pos[c0] - pos[a0]);
    uy = al * (pos[b0 + 1] - pos[a0 + 1]) + be * (pos[c0 + 1] - pos[a0 + 1]);
    uz = al * (pos[b0 + 2] - pos[a0 + 2]) + be * (pos[c0 + 2] - pos[a0 + 2]);
    const d = ux * nx + uy * ny + uz * nz;
    ux -= d * nx; uy -= d * ny; uz -= d * nz;
    const l = Math.hypot(ux, uy, uz) || 1;
    ux /= l; uy /= l; uz /= l;
    rx = uy * nz - uz * ny; ry = uz * nx - ux * nz; rz = ux * ny - uy * nx;
  };

  const update: DetailUpdater = (pos) => {
    if (pos.length !== m.n * 3) return;
    // stitches
    for (let i = 0; i < D; i++) {
      tri(pos, m.dashTri, m.dashW, m.dashSign[i * 2], i * 6, i * 6);
      const x0 = px, y0 = py, z0 = pz, n0x = nx, n0y = ny, n0z = nz;
      tri(pos, m.dashTri, m.dashW, m.dashSign[i * 2 + 1], i * 6 + 3, i * 6 + 3);
      let mx = n0x + nx, my = n0y + ny, mz = n0z + nz;
      const ml = Math.hypot(mx, my, mz) || 1;
      mx /= ml; my /= ml; mz /= ml;
      const dx = px - x0, dy = py - y0, dz = pz - z0;
      let wx = my * dz - mz * dy, wy = mz * dx - mx * dz, wz = mx * dy - my * dx;
      const wl = Math.hypot(wx, wy, wz) || 1;
      const k = HALF_W / wl;
      wx *= k; wy *= k; wz *= k;
      const lx = mx * LIFT, ly = my * LIFT, lz = mz * LIFT;
      const o = i * 12;
      sPos[o] = x0 + lx - wx; sPos[o + 1] = y0 + ly - wy; sPos[o + 2] = z0 + lz - wz;
      sPos[o + 3] = x0 + lx + wx; sPos[o + 4] = y0 + ly + wy; sPos[o + 5] = z0 + lz + wz;
      sPos[o + 6] = px + lx + wx; sPos[o + 7] = py + ly + wy; sPos[o + 8] = pz + lz + wz;
      sPos[o + 9] = px + lx - wx; sPos[o + 10] = py + ly - wy; sPos[o + 11] = pz + lz - wz;
      for (let v = 0; v < 4; v++) { sNor[o + v * 3] = mx; sNor[o + v * 3 + 1] = my; sNor[o + v * 3 + 2] = mz; }
    }
    posAttr.needsUpdate = true;
    norAttr.needsUpdate = true;

    // belt loops: strap lying on the cloth
    let arr = loopMesh.instanceMatrix.array as Float32Array;
    loops.forEach((a, j) => {
      frame(pos, a);
      const len = m.anchorSize[a * 2], wid = m.anchorSize[a * 2 + 1], th = 0.32;
      const h = LIFT + th / 2 + 0.02;
      setM(arr, j * 16, rx * wid, ry * wid, rz * wid, ux * len, uy * len, uz * len, nx * th, ny * th, nz * th, px + nx * h, py + ny * h, pz + nz * h);
    });
    loopMesh.instanceMatrix.needsUpdate = true;

    // rivets: flat disc plus a domed head
    const arr2 = rivetMesh.instanceMatrix.array as Float32Array, arr3 = rivetCap.instanceMatrix.array as Float32Array;
    rivets.forEach((a, j) => {
      frame(pos, a);
      const r = m.anchorSize[a * 2];
      setM(arr2, j * 16, rx * r, ry * r, rz * r, ux * r, uy * r, uz * r, nx, ny, nz, px + nx * (LIFT + 0.07), py + ny * (LIFT + 0.07), pz + nz * (LIFT + 0.07));
      const rc = r * 0.82, hc = 0.16;
      setM(arr3, j * 16, rx * rc, ry * rc, rz * rc, ux * rc, uy * rc, uz * rc, nx * hc, ny * hc, nz * hc, px + nx * (LIFT + 0.13), py + ny * (LIFT + 0.13), pz + nz * (LIFT + 0.13));
    });
    rivetMesh.instanceMatrix.needsUpdate = true;
    rivetCap.instanceMatrix.needsUpdate = true;

    // buttons with four holes
    const arr4 = btnMesh.instanceMatrix.array as Float32Array, arr5 = holeMesh.instanceMatrix.array as Float32Array;
    buttons.forEach((a, j) => {
      frame(pos, a);
      const r = m.anchorSize[a * 2];
      const h = LIFT + 0.1;
      setM(arr4, j * 16, rx * r, ry * r, rz * r, ux * r, uy * r, uz * r, nx, ny, nz, px + nx * h, py + ny * h, pz + nz * h);
      for (let q = 0; q < 4; q++) {
        const sx = (q & 1 ? 1 : -1) * 0.2 * r / 0.62, sy = (q & 2 ? 1 : -1) * 0.2 * r / 0.62;
        const hh = h + 0.02;
        setM(arr5, (j * 4 + q) * 16, rx, ry, rz, ux, uy, uz, nx, ny, nz,
          px + nx * hh + rx * sx + ux * sy, py + ny * hh + ry * sx + uy * sy, pz + nz * hh + rz * sx + uz * sy);
      }
    });
    btnMesh.instanceMatrix.needsUpdate = true;
    holeMesh.instanceMatrix.needsUpdate = true;

    // covered buttons (hat top)
    const arr6 = covMesh.instanceMatrix.array as Float32Array;
    covered.forEach((a, j) => {
      frame(pos, a);
      const r = m.anchorSize[a * 2];
      setM(arr6, j * 16, rx * r, ry * r, rz * r, ux * r, uy * r, uz * r, nx * r * 0.6, ny * r * 0.6, nz * r * 0.6, px + nx * LIFT, py + ny * LIFT, pz + nz * LIFT);
    });
    covMesh.instanceMatrix.needsUpdate = true;
  };

  void DASH;
  return { group, update, dispose: () => disposables.forEach((d) => d.dispose()) };
}

export default function Details({ data, geo, visible, updater }: {
  data: DetailsMsg;
  geo: THREE.BufferGeometry;
  visible: boolean;
  updater: { current: DetailUpdater | null };
}) {
  const built = useMemo(() => build(data), [data]);
  useEffect(() => () => built.dispose(), [built]);
  useEffect(() => {
    updater.current = visible ? built.update : null;
    if (visible) built.update((geo.getAttribute('position') as THREE.BufferAttribute).array as Float32Array);
    return () => { updater.current = null; };
  }, [built, geo, visible, updater]);
  return visible ? <primitive object={built.group} /> : null;
}
