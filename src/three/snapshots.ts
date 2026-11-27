import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { VertexPattern } from './printsAdapter';

// Close-up pictures of the draped garment for the tech pack (fine details a manufacturer needs to see).
//
// ClothView registers its live scene on a module level handle when it mounts (useSnapshotRegistration), so export
// code outside React can call captureDetails() without touching the user's camera. Every shot is rendered with a
// camera of its own into an offscreen float render target (the canvas can stay frameloop="demand" with
// preserveDrawingBuffer false), tone mapped and sRGB encoded in JS to match what the viewport shows.
//
// Only the garment group is drawn (layer 1): no floor, tape overlay, grid or the viewport's own lights. A small
// studio rig (key, fill, hemisphere) is added for the shot and removed again, so the lighting is the same in every
// picture whichever way the camera looks. Inside shots hide the body and look at the wrong side of the cloth.

export type DetailKind = 'attachment' | 'piece' | 'inside' | 'seam' | 'overview';

export interface DetailRequest {
  id: string;
  kind: DetailKind;
  /** which part of the garment: a point on a piece's flat pattern (cm, piece frame) and how far to show around it */
  target?: { pieceId: string; instance?: number; x?: number; y?: number; radiusCm?: number; face?: 'outside' | 'inside' };
  /** look from the front, back or the wearer's left side instead of along the cloth's own normal; overview shots default to front */
  view?: 'front' | 'back' | 'side';
}

export interface DetailShot { id: string; dataUrl: string }

export interface CaptureOptions {
  /** CSS colour behind the garment (default a neutral light grey); null keeps it transparent */
  background?: string | null;
}

interface Handle {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  root: RefObject<THREE.Object3D>;
  geo: THREE.BufferGeometry;
  pat: VertexPattern;
}

let handle: Handle | null = null;

/** True when a garment is mounted and captureDetails can render it. */
export const snapshotsReady = () => !!handle?.root.current;

/** Called by ClothView: makes its scene available to captureDetails while it is mounted and its cloth is built. */
export function useSnapshotRegistration(root: RefObject<THREE.Object3D>, topo: { geo: THREE.BufferGeometry; pat: VertexPattern } | null) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    if (!topo) { handle = null; return; }
    const h: Handle = { gl, scene, root, geo: topo.geo, pat: topo.pat };
    handle = h;
    return () => { if (handle === h) handle = null; };
  }, [gl, scene, root, topo]);
}

// ---------------------------------------------------------------- where on the cloth

interface Spot { pos: THREE.Vector3; normal: THREE.Vector3; radius: number }

/** 3D position, outward normal and a natural radius of a point on a piece's flat pattern, on the cloth as it is now. */
function locate(h: Handle, t: NonNullable<DetailRequest['target']>): Spot | null {
  const { pat, geo } = h;
  const k = pat.pieceIds.indexOf(t.pieceId);
  if (k < 0) return null;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nor = geo.getAttribute('normal') as THREE.BufferAttribute;
  const inst = t.instance ?? 0;
  // vertices of this placed copy (cloth attachments sit on top of it and are skipped)
  const verts: number[] = [];
  if (pat.panels) {
    for (const p of pat.panels) {
      if (p.pieceIndex !== k || p.instance !== inst || p.attachId) continue;
      for (let i = p.start; i < p.start + p.count; i++) verts.push(i);
    }
  }
  if (!verts.length) for (let i = 0; i < pat.vPiece.length; i++) if (pat.vPiece[i] === k) verts.push(i);
  if (!verts.length) return null;
  let x = t.x, y = t.y;
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const i of verts) box.expandByPoint(v.fromBufferAttribute(pos, i));
  if (x === undefined || y === undefined) {
    let sx = 0, sy = 0;
    for (const i of verts) { sx += pat.vUV[i * 2]; sy += pat.vUV[i * 2 + 1]; }
    x = sx / verts.length; y = sy / verts.length;
  }
  // the three nearest vertices on the flat pattern, blended
  const near: { i: number; d: number }[] = [];
  for (const i of verts) {
    const d = Math.hypot(pat.vUV[i * 2] - x, pat.vUV[i * 2 + 1] - y);
    if (near.length < 3 || d < near[near.length - 1].d) { near.push({ i, d }); near.sort((a, b) => a.d - b.d); if (near.length > 3) near.pop(); }
  }
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  let wsum = 0;
  for (const { i, d } of near) {
    const w = 1 / (d + 0.4);
    p.addScaledVector(v.fromBufferAttribute(pos, i), w);
    const front = pat.vPanel && pat.panels ? pat.panels[pat.vPanel[i]]?.front ?? 1 : 1;
    n.addScaledVector(new THREE.Vector3().fromBufferAttribute(nor, i), w * (front < 0 ? -1 : 1));
    wsum += w;
  }
  p.divideScalar(wsum);
  if (n.lengthSq() < 1e-9) n.set(0, 0, 1);
  n.normalize();
  const size = box.getSize(new THREE.Vector3());
  return { pos: p, normal: n, radius: Math.max(size.x, size.y, size.z) / 2 };
}

// ---------------------------------------------------------------- colour

const ACES_IN = [0.59719, 0.35458, 0.04823, 0.0760, 0.90834, 0.01566, 0.0284, 0.13383, 0.83777];
const ACES_OUT = [1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602];
const fit = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
const oetf = (c: number) => { c = Math.min(1, Math.max(0, c)); return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; };

/** Linear scene colour to display colour, the way three.js does it on screen (ACES filmic or none), then sRGB. */
function display(rgb: number[], aces: boolean, exposure: number): number[] {
  let [r, g, b] = rgb;
  if (aces) {
    r *= exposure / 0.6; g *= exposure / 0.6; b *= exposure / 0.6;
    const m = (M: number[], x: number, y: number, z: number) => [M[0] * x + M[1] * y + M[2] * z, M[3] * x + M[4] * y + M[5] * z, M[6] * x + M[7] * y + M[8] * z];
    const t = m(ACES_IN, r, g, b).map(fit);
    [r, g, b] = m(ACES_OUT, t[0], t[1], t[2]);
  }
  return [oetf(r), oetf(g), oetf(b)];
}

// ---------------------------------------------------------------- render

const FOV = 28;

interface Shot {
  target: THREE.Vector3; dir: THREE.Vector3; dist: number; hideBody: boolean;
  /** cut away everything closer to the camera than this many cm in front of the target (inside views: the rest of the garment would be in the way) */
  clipCm?: number;
}

function renderShot(h: Handle, shot: Shot, size: number, bg: string | null): string {
  const { gl, scene } = h;
  const root = h.root.current!;
  const cam = new THREE.PerspectiveCamera(FOV, 1, Math.max(0.2, shot.dist * 0.05), shot.dist + 600);
  const up = Math.abs(shot.dir.y) > 0.9 ? new THREE.Vector3(0, 0, -Math.sign(shot.dir.y)) : new THREE.Vector3(0, 1, 0);
  cam.position.copy(shot.target).addScaledVector(shot.dir, shot.dist);
  cam.up.copy(up);
  cam.lookAt(shot.target);
  cam.layers.set(1);
  cam.updateMatrixWorld();
  const right = new THREE.Vector3().crossVectors(up, shot.dir).normalize();
  const trueUp = new THREE.Vector3().crossVectors(shot.dir, right).normalize();

  // the studio rig, only for this picture (layer 1: the viewport's own lights are left out of it)
  const rig: THREE.Object3D[] = [];
  const light = (l: THREE.Light, p: THREE.Vector3) => { l.position.copy(p); l.layers.set(1); scene.add(l); rig.push(l); if ('target' in l) { const t = (l as THREE.DirectionalLight).target; t.position.copy(shot.target); scene.add(t); rig.push(t); } };
  const D = shot.dist;
  light(new THREE.DirectionalLight('#ffffff', 2.4), shot.target.clone().addScaledVector(shot.dir, D).addScaledVector(right, D * 0.7).addScaledVector(trueUp, D * 0.9));
  light(new THREE.DirectionalLight('#ffffff', 0.9), shot.target.clone().addScaledVector(shot.dir, D * 0.8).addScaledVector(right, -D * 0.9).addScaledVector(trueUp, -D * 0.3));
  light(new THREE.HemisphereLight('#ffffff', '#b7bcc6', 0.9), shot.target.clone());

  const touched: THREE.Object3D[] = [];
  const hidden: THREE.Object3D[] = [];
  root.traverse((o) => {
    o.layers.enable(1);
    touched.push(o);
    const m = (o as THREE.Mesh).material as THREE.Material | undefined;
    const overlay = m && !Array.isArray(m) && m.depthTest === false; // joint markers
    if (o.visible && (overlay || (shot.hideBody && (o as THREE.SkinnedMesh).isSkinnedMesh))) { o.visible = false; hidden.push(o); }
  });

  const prev = { clip: gl.clippingPlanes, rt: gl.getRenderTarget(), color: gl.getClearColor(new THREE.Color()), alpha: gl.getClearAlpha(), bg: scene.background, fog: scene.fog, auto: gl.autoClear };
  const type = gl.extensions.has('EXT_color_buffer_float') ? THREE.FloatType : THREE.UnsignedByteType; // linear 8 bit is the fallback
  const rt = new THREE.WebGLRenderTarget(size, size, { type, samples: 4, depthBuffer: true });
  const buf = type === THREE.FloatType ? new Float32Array(size * size * 4) : null;
  const bytes = buf ? null : new Uint8Array(size * size * 4);
  try {
    scene.background = null;
    scene.fog = null;
    gl.autoClear = true;
    gl.clippingPlanes = shot.clipCm ? [new THREE.Plane().setFromNormalAndCoplanarPoint(shot.dir.clone().negate(), shot.target.clone().addScaledVector(shot.dir, shot.clipCm))] : [];
    gl.setClearColor('#000000', 0);
    gl.setRenderTarget(rt);
    scene.updateMatrixWorld(true);
    gl.render(scene, cam);
    if (buf) gl.readRenderTargetPixels(rt, 0, 0, size, size, buf);
    else gl.readRenderTargetPixels(rt, 0, 0, size, size, bytes!);
  } finally {
    gl.clippingPlanes = prev.clip;
    gl.setRenderTarget(prev.rt);
    gl.setClearColor(prev.color, prev.alpha);
    gl.autoClear = prev.auto;
    scene.background = prev.bg;
    scene.fog = prev.fog;
    rt.dispose();
    for (const o of rig) { scene.remove(o); (o as THREE.Light).dispose?.(); }
    for (const o of touched) o.layers.disable(1);
    for (const o of hidden) o.visible = true;
  }

  const aces = gl.toneMapping === THREE.ACESFilmicToneMapping;
  const back = bg ? new THREE.Color(bg).convertLinearToSRGB().toArray() : null; // display space 0..1
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const si = ((size - 1 - y) * size + x) * 4, di = (y * size + x) * 4; // rows come bottom up
      const a = buf ? buf[si + 3] : bytes![si + 3] / 255;
      let c: number[];
      if (a > 0.002) {
        const lin = buf ? [buf[si] / a, buf[si + 1] / a, buf[si + 2] / a] : [bytes![si] / 255 / a, bytes![si + 1] / 255 / a, bytes![si + 2] / 255 / a];
        c = display(lin, aces, gl.toneMappingExposure);
      } else c = [0, 0, 0];
      const al = Math.min(1, a);
      if (back) {
        for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(255 * (c[k] * al + back[k] * (1 - al)));
        img.data[di + 3] = 255;
      } else {
        for (let k = 0; k < 3; k++) img.data[di + k] = Math.round(255 * c[k]);
        img.data[di + 3] = Math.round(255 * al);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

const VIEW_DIR = { front: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0] } as const;

function plan(h: Handle, r: DetailRequest): Shot | null {
  const fov = THREE.MathUtils.degToRad(FOV);
  const fitDist = (radius: number) => (radius / Math.tan(fov / 2)) * 1.12;
  if (r.kind === 'overview' || !r.target) {
    const box = new THREE.Box3().setFromBufferAttribute(h.geo.getAttribute('position') as THREE.BufferAttribute);
    const c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const [dx, dy, dz] = VIEW_DIR[r.view ?? 'front'] as readonly number[];
    const half = Math.max(s.y, r.view === 'side' ? s.z : s.x) / 2;
    return { target: c, dir: new THREE.Vector3(dx, dy, dz), dist: fitDist(half * 1.05), hideBody: false };
  }
  const spot = locate(h, r.target);
  if (!spot) return null;
  const inside = r.kind === 'inside' || r.target.face === 'inside';
  const radius = r.target.radiusCm ?? (r.kind === 'piece' ? spot.radius * 1.1 : r.kind === 'seam' ? 4 : 6);
  let dir = spot.normal.clone();
  if (r.view) { const [vx, vy, vz] = VIEW_DIR[r.view]; dir.set(vx, vy, vz); }
  if (inside) dir = r.view ? dir.negate() : spot.normal.clone().negate();
  // the camera sits on the outer side (outside shots) or the inner side (inside shots), looking at the point
  return { target: spot.pos, dir, dist: fitDist(radius), hideBody: inside, clipCm: inside ? Math.min(6, Math.max(2.5, radius * 0.6)) : undefined };
}

/**
 * Render close-up pictures of the draped garment as it is now (the live cloth geometry), one PNG data URL per
 * request, without touching the user's camera. Requests that cannot be placed (unknown piece) are left out of the
 * result. Returns an empty list when no garment is mounted.
 */
export async function captureDetails(requests: DetailRequest[], size = 640, opts: CaptureOptions = {}): Promise<DetailShot[]> {
  const h = handle;
  if (!h?.root.current) return [];
  const bg = opts.background === undefined ? '#eceef1' : opts.background;
  const out: DetailShot[] = [];
  for (const r of requests) {
    const shot = plan(h, r);
    if (!shot) continue;
    try {
      out.push({ id: r.id, dataUrl: renderShot(h, shot, size, bg) });
    } catch (e) {
      console.warn('captureDetails failed for', r.id, e);
    }
    await new Promise((res) => setTimeout(res, 0)); // let the page breathe between shots
  }
  return out;
}

/** Where a piece point is on the draped cloth right now (cm, world) and which way its outside faces; null when it cannot be placed. */
export function locateTarget(target: NonNullable<DetailRequest['target']>): { position: [number, number, number]; normal: [number, number, number]; radiusCm: number } | null {
  if (!handle) return null;
  const s = locate(handle, target);
  return s ? { position: s.pos.toArray(), normal: s.normal.toArray(), radiusCm: s.radius } : null;
}
