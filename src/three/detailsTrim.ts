import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ShapeLayer } from '../data/edits';
import type { Pt } from '../lib/geometry';
import { SHAPES } from '../lib/shapes';
import { holeOffsets, outlineExtent } from '../lib/trims';

// Geometry for designed trims: a drawn outline turned into a button / snap / stud / rivet / puller body (bevelled edge,
// slight dome), its face artwork as colour + bump textures, button holes with thread, and the zipper teeth and puller types.
// Coordinates: the outline is drawn in the pattern frame (x right, y down, as seen from outside). Trims are modelled in
// the cloth frame used by Hardware.tsx (x = r, y = u = down the garment, z = out), which is a mirror of the pattern in x,
// so a vertex is (-px, py). All shell geometry is normalised: the larger outline extent is 1.

const rad = (d: number) => (d * Math.PI) / 180;

export type ShellType = 'button' | 'snap' | 'stud' | 'rivet' | 'plate';

/** profile from the rim inwards: [scale of the outline about its centre, height]; the first `wall` entries are the edge */
const PROFILES: Record<ShellType, { pts: [number, number][]; wall: number }> = {
  button: { pts: [[1, 0], [1, 0.08], [0.975, 0.115], [0.94, 0.128], [0.86, 0.14], [0.74, 0.15], [0.6, 0.158], [0.45, 0.164], [0.3, 0.168], [0.15, 0.17], [0, 0.171]], wall: 4 },
  snap: { pts: [[1, 0], [1, 0.07], [0.97, 0.105], [0.92, 0.115], [0.84, 0.12], [0.8, 0.105], [0.72, 0.13], [0.6, 0.18], [0.45, 0.22], [0.3, 0.245], [0.15, 0.256], [0, 0.26]], wall: 4 },
  stud: { pts: [[1, 0], [1, 0.06], [0.96, 0.095], [0.88, 0.11], [0.7, 0.2], [0.55, 0.3], [0.4, 0.38], [0.25, 0.43], [0.12, 0.455], [0, 0.46]], wall: 3 },
  rivet: { pts: [[1, 0], [1, 0.05], [0.94, 0.09], [0.88, 0.1], [0.8, 0.18], [0.65, 0.29], [0.5, 0.35], [0.35, 0.39], [0.2, 0.41], [0, 0.42]], wall: 3 },
  plate: { pts: [[1, 0], [1, 0.14], [0.97, 0.19], [0.92, 0.205], [0.8, 0.21], [0.5, 0.215], [0, 0.22]], wall: 4 },
};

export interface Shell {
  geo: THREE.BufferGeometry;
  /** surface height at a relative radius (0 centre .. 1 rim) */
  zAt: (s: number) => number;
  /** inscribed radius about the centre, normalised units */
  rIn: number;
  /** pattern-frame bounding box of the normalised outline */
  box: { x0: number; y0: number; w: number; h: number };
  /** cm per normalised unit */
  ext: number;
}

function resample(pts: Pt[], n: number): Pt[] {
  const acc = [0];
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1], b = pts[i % pts.length];
    acc.push(acc[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const L = acc[acc.length - 1] || 1;
  const out: Pt[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / n) * L;
    while (seg < pts.length - 1 && acc[seg + 1] < d) seg++;
    const a = pts[seg], b = pts[(seg + 1) % pts.length];
    const f = (d - acc[seg]) / ((acc[seg + 1] - acc[seg]) || 1);
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return out;
}

const circlePts = (n = 48): Pt[] => Array.from({ length: n }, (_, i) => ({ x: 0.5 * Math.cos((i / n) * Math.PI * 2), y: 0.5 * Math.sin((i / n) * Math.PI * 2) }));

/** Build a shell from a drawn outline (cm), or a circle when none. Group 0 is the edge, group 1 the face (with uv). */
export function shellGeometry(outline: Pt[] | undefined, type: ShellType, circleExt = 1): Shell {
  const src = outline && outline.length > 2 ? outline : circlePts().map((p) => ({ x: p.x * circleExt, y: p.y * circleExt }));
  const ext = outlineExtent(src);
  const norm = src.map((p) => ({ x: p.x / ext, y: p.y / ext }));
  const ring = resample(norm, 72);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ring) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  let rIn = Infinity;
  for (const p of ring) rIn = Math.min(rIn, Math.hypot(p.x - cx, p.y - cy));
  // geometry frame is the mirror in x: make the ring counter clockwise there so the face normals point out (+z)
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; area += -a.x * b.y - -b.x * a.y; }
  if (area < 0) ring.reverse();
  const prof = PROFILES[type];
  const R = ring.length, P = prof.pts.length;
  const pos = new Float32Array(R * P * 3), uv = new Float32Array(R * P * 2);
  const bw = x1 - x0 || 1, bh = y1 - y0 || 1;
  for (let i = 0; i < P; i++) {
    const [s, z] = prof.pts[i];
    for (let j = 0; j < R; j++) {
      const px = cx + (ring[j].x - cx) * s, py = cy + (ring[j].y - cy) * s;
      const o = i * R + j;
      pos[o * 3] = -px; pos[o * 3 + 1] = py; pos[o * 3 + 2] = z;
      uv[o * 2] = (px - x0) / bw; uv[o * 2 + 1] = (py - y0) / bh;
    }
  }
  const wallIdx: number[] = [], faceIdx: number[] = [];
  for (let i = 0; i < P - 1; i++) for (let j = 0; j < R; j++) {
    const j1 = (j + 1) % R;
    const A = i * R + j, B = i * R + j1, C = (i + 1) * R + j, D = (i + 1) * R + j1;
    const t = i < prof.wall ? wallIdx : faceIdx;
    t.push(A, B, C, B, D, C);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex([...wallIdx, ...faceIdx]);
  geo.addGroup(0, wallIdx.length, 0);
  geo.addGroup(wallIdx.length, faceIdx.length, 1);
  geo.computeVertexNormals();
  const zAt = (s: number) => {
    const f = prof.pts;
    for (let i = f.length - 1; i > 0; i--) {
      if (s <= f[i - 1][0] && s >= f[i][0]) { const t = (s - f[i][0]) / ((f[i - 1][0] - f[i][0]) || 1); return f[i][1] + (f[i - 1][1] - f[i][1]) * t; }
    }
    return f[f.length - 1][1];
  };
  return { geo, zAt, rIn, box: { x0, y0, w: bw, h: bh }, ext };
}

/** Holes and thread for a button face. Returns null for none / shank. Dark recess discs and thread strands as two geometries. */
export function holesGeometry(shell: Shell, holes: 0 | 2 | 4 | 'shank' | undefined): { holes: THREE.BufferGeometry; thread: THREE.BufferGeometry } | null {
  if (holes !== 2 && holes !== 4) return null;
  const cx = shell.box.x0 + shell.box.w / 2, cy = shell.box.y0 + shell.box.h / 2;
  void cx; void cy;
  const hs = holeOffsets(holes, shell.rIn);
  const hr = Math.max(0.03, shell.rIn * 0.115);
  const discs = hs.map((h) => {
    const g = new THREE.CircleGeometry(hr, 16);
    const rim = new THREE.RingGeometry(hr, hr * 1.35, 16);
    const z = shell.zAt(Math.min(1, Math.hypot(h.x, h.y) / (shell.rIn || 0.5))) + 0.004;
    g.translate(-h.x, h.y, z + 0.002);
    rim.translate(-h.x, h.y, z);
    return [g, rim];
  }).flat();
  const strands: THREE.BufferGeometry[] = [];
  const strand = (a: { x: number; y: number }, b: { x: number; y: number }, off: number) => {
    const za = shell.zAt(Math.hypot(a.x, a.y) / (shell.rIn || 0.5)) + 0.014, zb = shell.zAt(Math.hypot(b.x, b.y) / (shell.rIn || 0.5)) + 0.014;
    const A = new THREE.Vector3(-a.x, a.y, za), B = new THREE.Vector3(-b.x, b.y, zb);
    const len = A.distanceTo(B);
    const g = new THREE.CylinderGeometry(hr * 0.42, hr * 0.42, len, 8);
    // cylinder along y -> along A..B
    g.rotateX(Math.PI / 2);
    g.rotateY(0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), B.clone().sub(A).normalize());
    g.applyQuaternion(q);
    const mid = A.clone().add(B).multiplyScalar(0.5);
    const side = B.clone().sub(A).cross(new THREE.Vector3(0, 0, 1)).normalize().multiplyScalar(off);
    g.translate(mid.x + side.x, mid.y + side.y, mid.z + 0.006);
    strands.push(g);
  };
  if (holes === 2) { strand(hs[0], hs[1], hr * 0.55); strand(hs[0], hs[1], -hr * 0.55); }
  else { strand(hs[0], hs[3], 0); strand(hs[1], hs[2], 0); }
  const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)), false)!;
  return { holes: merge(discs), thread: merge(strands) };
}

/** shade a CSS colour (0..1 factor) to rgb() text */
function shadeCss(css: string, f: number) {
  const c = new THREE.Color(css);
  return `rgb(${Math.round(Math.min(1, c.r * f) * 255)},${Math.round(Math.min(1, c.g * f) * 255)},${Math.round(Math.min(1, c.b * f) * 255)})`;
}

function paintLayer(ctx: CanvasRenderingContext2D, l: ShapeLayer, ext: number, fill: string) {
  ctx.save();
  // layer coords are in the pattern frame, cm centred on the trim; the canvas is in the same frame, normalised
  ctx.translate(l.x / ext, l.y / ext);
  ctx.rotate(rad(l.rotation));
  if (l.flipX) ctx.scale(-1, 1);
  ctx.fillStyle = fill;
  if (l.shape === 'text') {
    if (l.text) {
      ctx.font = `700 ${Math.max(0.02, l.h / ext)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, 0, 0, Math.max(0.02, l.w / ext));
    }
  } else {
    ctx.scale(l.w / ext, l.h / ext);
    ctx.fill(new Path2D(SHAPES[l.shape].d));
  }
  ctx.restore();
}

export interface FaceTextures { map: THREE.CanvasTexture; bump: THREE.CanvasTexture }

/**
 * Artwork on a trim face. Metal: engraved, darker recessed with a bump (deeper = lower). Plastic: enamel / print in the
 * layer colours, raised a hair. Canvas is in the shell's uv (the pattern frame, normalised).
 */
export function faceTextures(shell: Shell, layers: ShapeLayer[], metal: boolean, pxPerCm = 80): FaceTextures {
  const W = Math.min(768, Math.max(64, Math.round(shell.box.w * shell.ext * pxPerCm)));
  const H = Math.min(768, Math.max(64, Math.round(shell.box.h * shell.ext * pxPerCm)));
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const cm = mk(), cb = mk();
  const m = cm.getContext('2d')!, b = cb.getContext('2d')!;
  m.fillStyle = '#ffffff'; m.fillRect(0, 0, W, H);
  b.fillStyle = metal ? '#d0d0d0' : '#808080'; b.fillRect(0, 0, W, H);
  for (const x of [m, b]) x.setTransform(W / shell.box.w, 0, 0, H / shell.box.h, (-shell.box.x0 * W) / shell.box.w, (-shell.box.y0 * H) / shell.box.h);
  for (const l of layers) {
    m.globalAlpha = b.globalAlpha = l.opacity ?? 1;
    if (metal) {
      // recessed: a dark tone of the metal, tinted a little by the layer colour
      const tint = new THREE.Color(l.color);
      const lum = 0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b;
      paintLayer(m, l, shell.ext, shadeCss('#ffffff', 0.32 + 0.3 * lum));
      paintLayer(b, l, shell.ext, 'rgb(40,40,40)');
    } else {
      paintLayer(m, l, shell.ext, l.color);
      paintLayer(b, l, shell.ext, 'rgb(190,190,190)');
    }
  }
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.flipY = false;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(cm, true), bump: tex(cb, false) };
}

/* ---------- zipper parts, modelled for the zipper frame: x lateral, y along (down), z out; cm ---------- */

const lathe = (pts: [number, number][], seg = 20) => { const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(r, z)), seg); g.rotateX(Math.PI / 2); return g; };
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map((g) => (g.index ? g.toNonIndexed() : g)), false) ?? gs[0];

/** One tooth of a metal zipper: a rounded block with a head. */
export function metalTooth() {
  return merge([new THREE.BoxGeometry(0.3, 0.32, 0.12).translate(0, 0, 0.06), new THREE.BoxGeometry(0.2, 0.14, 0.17).translate(0, 0, 0.085)]);
}

/** Moulded plastic tooth: bigger, chunky, rounded. */
export function moldedTooth() {
  const body = new THREE.CapsuleGeometry(0.15, 0.2, 4, 10);
  body.rotateZ(Math.PI / 2); // along x
  body.scale(1, 0.95, 0.85);
  body.translate(0, 0, 0.1);
  const head = new THREE.SphereGeometry(0.12, 10, 8).translate(0, 0, 0.17);
  return merge([body, head]);
}

/** Coil: one side's windings over one sample step (0.4 cm): three flattened loops lying across the tape. */
export function coilLoops() {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = -1; k <= 1; k++) {
    const g = new THREE.CapsuleGeometry(0.055, 0.2, 3, 8);
    g.rotateZ(Math.PI / 2); // lies across (x)
    g.scale(1, 1, 1.15);
    g.rotateZ(k * 0.1);
    g.translate(0.1, k * 0.13, 0.07 + (k % 2 ? 0.012 : 0));
    parts.push(g);
  }
  return merge(parts);
}

export function sliderBody() {
  return merge([new THREE.BoxGeometry(0.8, 0.72, 0.16).translate(0, 0, 0.08), new THREE.BoxGeometry(0.4, 0.28, 0.12).translate(0, 0.34, 0.22)]);
}

export function standardPuller() {
  const w = 0.28, l = 1.3, r = 0.2;
  const s = new THREE.Shape();
  s.moveTo(-w + r, 0); s.lineTo(w - r, 0); s.quadraticCurveTo(w, 0, w, r); s.lineTo(w, l - r); s.quadraticCurveTo(w, l, w - r, l);
  s.lineTo(-w + r, l); s.quadraticCurveTo(-w, l, -w, l - r); s.lineTo(-w, r); s.quadraticCurveTo(-w, 0, -w + r, 0);
  const hole = new THREE.Path(); hole.absarc(0, l * 0.68, 0.11, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 10 });
  g.rotateX(0.2);
  g.translate(0, 0.38, 0.3);
  return g;
}

/** A ring puller: a small bail on the slider and a loose ring lying on the tape. */
export function ringPuller() {
  const ring = new THREE.TorusGeometry(0.5, 0.07, 10, 32);
  ring.rotateX(0.35);
  ring.translate(0, 1.15, 0.2);
  const bail = new THREE.TorusGeometry(0.12, 0.04, 8, 14);
  bail.rotateY(Math.PI / 2);
  bail.translate(0, 0.78, 0.3);
  return merge([ring, bail]);
}

/** A fabric or leather tab with a rivet hole. */
export function tabPuller() {
  const w = 0.36, l = 2.1, r = 0.18;
  const s = new THREE.Shape();
  s.moveTo(-w + r, 0); s.lineTo(w - r, 0); s.quadraticCurveTo(w, 0, w, r); s.lineTo(w, l - r); s.quadraticCurveTo(w, l, w - r, l);
  s.lineTo(-w + r, l); s.quadraticCurveTo(-w, l, -w, l - r); s.lineTo(-w, r); s.quadraticCurveTo(-w, 0, -w + r, 0);
  const hole = new THREE.Path(); hole.absarc(0, 0.38, 0.07, 0, Math.PI * 2, true); s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.07, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 10 });
  g.rotateX(0.12);
  g.translate(0, 0.5, 0.26);
  return g;
}

/** A cord loop with a tip. Returns the cord and the tip as separate geometries (the tip is metal). */
export function cordPuller() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.7, 0.3), new THREE.Vector3(0.28, 1.1, 0.16), new THREE.Vector3(-0.22, 1.7, 0.1), new THREE.Vector3(0.1, 2.3, 0.09), new THREE.Vector3(0, 2.7, 0.09),
  ]);
  const cord = new THREE.TubeGeometry(curve, 40, 0.05, 8, false);
  const tip = new THREE.CylinderGeometry(0.1, 0.1, 0.52, 14);
  const end = curve.getPoint(1), dir = curve.getTangent(1);
  tip.rotateX(Math.PI / 2); // axis z
  tip.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
  tip.translate(end.x + dir.x * 0.18, end.y + dir.y * 0.18, end.z + dir.z * 0.18);
  return { cord, tip };
}

/** A drawn puller plate, hanging from the slider; geometry is normalised (scale by the returned ext cm). */
export function customPuller(outline: Pt[]) {
  const shell = shellGeometry(outline, 'plate');
  let minY = Infinity;
  for (const p of outline) minY = Math.min(minY, p.y);
  // top of the drawn shape starts a little below the slider (y is down the garment)
  shell.geo.translate(0, (-minY) / shell.ext + 0.55 / shell.ext, 0.15 / shell.ext);
  return shell;
}
