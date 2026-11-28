import * as THREE from 'three';
import { fabricById, type FabricPattern } from '../data/fabrics';
import { fabricCanvas } from '../lib/textures';
import { fabricHex, patternTile, type FabricRef } from './fabricAdapter';
import { albedoCanvas, heightTexture, LEGACY, weaveKind, weaveLook } from './detailsWeave';
import { bumpArt } from './detailsArt';

// Patterned and custom colour cloth.
//  - A pattern is rasterised once from its SVG repeat (patternTile) into a cached canvas, keyed by the pattern JSON
//    (id, colours, scale), power of two sized and at most 1024 px per side. Rotation is not in the key: it only changes
//    the texture matrix, so one canvas serves every angle. The canvas shows the ground colour until the SVG has decoded.
//  - The cloth uv are cm / 6 in the piece's own pattern frame, already negated in x on mirrored copies. The texture
//    matrix turns them into repeats of the tile (cm / tile size) after rotating by pattern.rotation relative to the
//    grainline, so a stripe runs the same way on every piece cut the same way, matches across a seam in the same frame,
//    never stretches, and a mirrored copy mirrors the print like cloth cut for a left and a right.
//  - Woven patterns show on both faces (the inside a little duller); printed ones only on the outside, the inside is
//    the ground colour. Weave relief (bump, sheen, holes) comes from detailsWeave and is shared per weave.

const MAX_TEX = 1024;
const MIN_PX_PER_CM = 16;
/** a picture motif needs more texels per cm than a woven check */
const CUSTOM_PX_PER_CM = 40;
const p2 = (n: number) => Math.min(MAX_TEX, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n)))));

interface Raster { canvas: HTMLCanvasElement; size: [number, number]; ready: boolean; textures: Set<THREE.CanvasTexture>; ground: string; finish?: { key: string; canvas: HTMLCanvasElement; textures: Set<THREE.CanvasTexture> }[] }
const rasters = new Map<string, Raster>();

export const isWoven = (p: FabricPattern) => p.method === 'woven';
export const isPlain = (p: FabricPattern | undefined): p is undefined => !p || p.id === 'solid';

const motifHashes = new WeakMap<object, string>();
/** short fingerprint of a custom motif (its picture can be a megabyte, so it is hashed once per object) */
function motifHash(p: FabricPattern): string {
  if (p.id !== 'custom' || !p.motif) return '';
  let h = motifHashes.get(p.motif);
  if (!h) {
    let a = 2166136261;
    const s = (p.motif.image ?? '') + JSON.stringify(p.motif.paths ?? []);
    for (let i = 0; i < s.length; i++) a = Math.imul(a ^ s.charCodeAt(i), 16777619);
    h = (a >>> 0).toString(36) + ':' + s.length;
    motifHashes.set(p.motif, h);
  }
  return h + '|' + (p.layout ?? 'block') + '|' + (p.motifScale ?? 0.7) + '|' + (p.recolor ?? []).join(',') + '|' + (p.hidden ?? []).join(',');
}

/** cache key of a pattern's raster: everything but the rotation */
export const patternKey = (p: FabricPattern) => JSON.stringify([p.id, p.colors, p.scale, motifHash(p), p.opacity, p.offsetX, p.offsetY, p.hidden]);

export function patternRaster(p: FabricPattern): Raster {
  const key = patternKey(p);
  let r = rasters.get(key);
  if (r) return r;
  const tile = patternTile(p);
  const [w, h] = tile.size;
  const canvas = document.createElement('canvas');
  const ppc = p.id === 'custom' ? CUSTOM_PX_PER_CM : MIN_PX_PER_CM;
  canvas.width = p2(w * ppc);
  canvas.height = p2(h * ppc);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = p.colors[0] ?? '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  r = { canvas, size: [w, h], ready: false, textures: new Set(), ground: p.colors[0] ?? '#ffffff' };
  rasters.set(key, r);
  const rr = r;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    rr.ready = true;
    rr.textures.forEach((t) => { t.needsUpdate = true; });
    rr.finish?.forEach((fm) => { paintFinish(rr, fm.canvas, fm.key); fm.textures.forEach((t) => { t.needsUpdate = true; }); });
    bumpArt();
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(tile.svg);
  if (rasters.size > 60) {
    const old = rasters.keys().next().value!;
    rasters.delete(old);
  }
  return r;
}

const patTex = new Map<string, THREE.CanvasTexture>();

/** texture of a pattern on cloth uv (cm / 6): rotation about the grainline, then one repeat per tile */
export function patternTexture(p: FabricPattern): THREE.CanvasTexture {
  const key = patternKey(p) + '|' + (p.rotation || 0);
  let t = patTex.get(key);
  if (t) return t;
  const r = patternRaster(p);
  t = new THREE.CanvasTexture(r.canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.matrixAutoUpdate = false;
  const a = ((p.rotation || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), [w, h] = r.size;
  // uv * 6 = cm in the cloth frame (v up); the pattern turns clockwise by `rotation` as seen on the cloth
  t.matrix.set((6 * c) / w, (-6 * s) / w, 0, (6 * s) / h, (6 * c) / h, 0, 0, 0, 1);
  r.textures.add(t);
  patTex.set(key, t);
  return t;
}

/** A pattern as a canvas fill in cm space (attachment art and prints that carry a fabric), rotation applied. */
export function patternFill(ctx: CanvasRenderingContext2D, p: FabricPattern, host?: { x: number; y: number; rotation: number }): CanvasPattern | null {
  const r = patternRaster(p);
  const pat = ctx.createPattern(r.canvas, 'repeat');
  if (!pat) return null;
  // canvas y runs down, like the piece: rotate(+deg) turns it clockwise, the same way as patternTexture
  // `host`: the attachment sits at (x, y) turned by rotation on its piece; laying the pattern out in the piece's frame continues the body's repeat
  const lead = host ? new DOMMatrix().rotate(-host.rotation).translate(-host.x, -host.y) : new DOMMatrix();
  pat.setTransform(lead.rotate(p.rotation || 0).scale(r.size[0] / r.canvas.width, r.size[1] / r.canvas.height));
  return pat;
}

/* ---------- finish (PieceFabric.sheen) ---------- */

export type Finish = 'matte' | 'satin' | 'glossy' | 'metallic';

interface FinishLook { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number; sheen: number; sheenRoughness: number; sheenLift: number; anisotropy: number; env: number; bump: number }

/**
 * Cloth finishes. matte flattens any sheen the weave has; satin is a soft, stretched highlight (sheen plus a little
 * anisotropy); glossy is coated fabric (PU, vinyl: clear coat over a low roughness); metallic is lame or foil.
 * An unset finish leaves the fabric's own look untouched.
 */
const FINISH: Record<Finish, FinishLook> = {
  matte: { roughness: 0.92, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, sheenRoughness: 0.5, sheenLift: 0, anisotropy: 0, env: 0.28, bump: 1 },
  satin: { roughness: 0.32, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.5, sheen: 1, sheenRoughness: 0.3, sheenLift: 0.6, anisotropy: 0.6, env: 0.6, bump: 0.55 },
  glossy: { roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0, sheenRoughness: 0.5, sheenLift: 0, anisotropy: 0, env: 0.55, bump: 0.5 },
  metallic: { roughness: 0.3, metalness: 0.85, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, sheenRoughness: 0.5, sheenLift: 0, anisotropy: 0.5, env: 1.1, bump: 0.6 },
};
const isFinish = (f: unknown): f is Finish => f === 'matte' || f === 'satin' || f === 'glossy' || f === 'metallic';
/** (env = envMapIntensity once the scene's environment map is set on the material) */
/** how much of the finish the cloth under a printed pattern shows (the ink shows all of it) */
const GROUND_SHARE = 0.4;

const hexRgb = (h: string) => { const v = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0); };

/** Fill a finish map: R = clear coat, G = roughness, B = metalness (each 1 = the material value, lower = less) from the ink mask. */
function paintFinish(r: Raster, out: HTMLCanvasElement, finish: string) {
  const look = FINISH[finish as Finish];
  const ctx = out.getContext('2d')!;
  ctx.drawImage(r.canvas, 0, 0, out.width, out.height);
  const px = ctx.getImageData(0, 0, out.width, out.height), D = px.data, g = hexRgb(r.ground);
  const rg = Math.min(1, look.roughness + (0.9 - look.roughness) * (1 - GROUND_SHARE)); // ground roughness, between the finish and plain cloth
  for (let i = 0; i < D.length; i += 4) {
    const m = Math.max(0, Math.min(1, (Math.abs(D[i] - g[0]) + Math.abs(D[i + 1] - g[1]) + Math.abs(D[i + 2] - g[2]) - 24) / 90));
    D[i] = Math.round(255 * (GROUND_SHARE + (1 - GROUND_SHARE) * m));
    D[i + 1] = Math.round(255 * (1 + (look.roughness / rg - 1) * m));
    D[i + 2] = Math.round(255 * (GROUND_SHARE + (1 - GROUND_SHARE) * m));
    D[i + 3] = 255;
  }
  ctx.putImageData(px, 0, 0);
}

const finTex = new Map<string, THREE.CanvasTexture>();

/** Finish map of a printed pattern on the same texture matrix as its colour map: the ink takes the full finish. */
function finishTexture(p: FabricPattern, finish: Finish): THREE.CanvasTexture {
  const key = patternKey(p) + '|' + (p.rotation || 0) + '|' + finish;
  let t = finTex.get(key);
  if (t) return t;
  const r = patternRaster(p);
  const canvas = document.createElement('canvas');
  canvas.width = Math.min(256, r.canvas.width);
  canvas.height = Math.min(256, r.canvas.height);
  const c = canvas.getContext('2d')!;
  c.fillStyle = `rgb(${Math.round(255 * GROUND_SHARE)},255,${Math.round(255 * GROUND_SHARE)})`;
  c.fillRect(0, 0, canvas.width, canvas.height);
  t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.matrixAutoUpdate = false;
  t.matrix.copy(patternTexture(p).matrix);
  const entry = { key: finish, canvas, textures: new Set([t]) };
  (r.finish ??= []).push(entry);
  if (r.ready) { paintFinish(r, canvas, finish); t.needsUpdate = true; }
  finTex.set(key, t);
  return t;
}

/* ---------- materials ---------- */

/** a fabric with its finish (PieceFabric.sheen; an attachment's own sheen when it has one) */
type Cloth = FabricRef & { sheen?: Finish };
const mats = new Map<string, THREE.Material>();
const plainTex = new Map<string, THREE.CanvasTexture>();
const MAX_PLAIN = 96;

function plainTexture(fid: string, hex: string, kind: ReturnType<typeof weaveKind>): THREE.CanvasTexture {
  const f = fabricById(fid);
  const key = fid + '|' + kind + '|' + hex;
  let t = plainTex.get(key);
  if (t) { plainTex.delete(key); plainTex.set(key, t); return t; }
  t = new THREE.CanvasTexture(LEGACY.has(f.weave) ? fabricCanvas(f, hex) : albedoCanvas(weaveLook(kind), hex));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  plainTex.set(key, t);
  if (plainTex.size > MAX_PLAIN) {
    const k = plainTex.keys().next().value!;
    plainTex.get(k)!.dispose();
    plainTex.delete(k);
  }
  return t;
}

export interface ClothOpts {
  /** the face is the wrong side of a printed pattern: ground colour only */
  ground?: boolean;
}

/** Cloth material for a fabric (with its custom colour and pattern) on one side, `dark` scaling the colour. */
export function clothMaterial(fb: Cloth, side: THREE.Side, dark = 1, opts: ClothOpts = {}): THREE.Material {
  const f = fabricById(fb.id);
  const pat = isPlain(fb.pattern) || (opts.ground && !isWoven(fb.pattern)) ? undefined : fb.pattern;
  // a plain-pattern or ground-only face uses the pattern's first colour as the cloth colour
  const hex = fb.pattern && !pat ? (fb.pattern.colors[0] ?? fabricHex(fb)) : fabricHex(fb);
  const fin = isFinish(fb.sheen) ? fb.sheen : undefined;
  const key = [fb.id, hex, pat ? patternKey(pat) + '|' + (pat.rotation || 0) : '', side, dark, fin ?? ''].join('~');
  let m = mats.get(key);
  if (m) { mats.delete(key); mats.set(key, m); return m; }
  const kind = weaveKind(f.weave, f.id);
  const look = weaveLook(kind);
  const physical = (look.sheen ?? 0) > 0 || (look.clearcoat ?? 0) > 0 || !!fin;
  const base: THREE.MeshStandardMaterialParameters = {
    side, roughness: look.roughness ?? f.roughness, metalness: 0,
    map: pat ? patternTexture(pat) : plainTexture(f.id, hex, kind),
    bumpMap: heightTexture(look), bumpScale: look.bump,
  };
  if (look.holes) { base.alphaMap = heightTexture(look); base.alphaTest = 0.35; }
  let mat: THREE.MeshStandardMaterial;
  if (fin) {
    // a finish replaces the weave's own sheen and gloss; a printed pattern gives its ink the full finish and the cloth under it a share
    const F = FINISH[fin];
    const inked = !!pat && !isWoven(pat) && fin !== 'matte';
    base.bumpScale = look.bump * F.bump;
    base.roughness = inked ? Math.min(1, F.roughness + (0.9 - F.roughness) * (1 - GROUND_SHARE)) : Math.max(F.roughness, fin === 'matte' ? (look.roughness ?? f.roughness) : 0);
    base.metalness = F.metalness;
    base.envMapIntensity = F.env;
    if (inked) { const ft = finishTexture(pat, fin); base.roughnessMap = ft; if (F.metalness > 0) base.metalnessMap = ft; }
    const p = new THREE.MeshPhysicalMaterial(base);
    p.sheen = F.sheen;
    p.sheenRoughness = F.sheenRoughness;
    p.sheenColor = new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), F.sheenLift);
    p.clearcoat = F.clearcoat;
    p.clearcoatRoughness = F.clearcoatRoughness;
    if (inked && F.clearcoat > 0) p.clearcoatMap = base.roughnessMap!;
    if (F.anisotropy > 0) { p.anisotropy = F.anisotropy; p.anisotropyRotation = Math.PI / 2; }
    // the viewport's reflections come from scene.environment at a low intensity: a finish that reflects gets the same
    // map set on the material (ClothView does that) so envMapIntensity can lift it
    if (fin !== 'matte') p.userData.finishEnv = true;
    mat = p;
  } else if (physical) {
    const p = new THREE.MeshPhysicalMaterial(base);
    p.sheen = look.sheen ?? 0;
    p.sheenRoughness = look.sheenRoughness ?? 0.5;
    p.sheenColor = new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), look.sheenLift ?? 0.4);
    p.clearcoat = look.clearcoat ?? 0;
    p.clearcoatRoughness = 0.4;
    mat = p;
  } else mat = new THREE.MeshStandardMaterial(base);
  mat.shadowSide = THREE.DoubleSide;
  if (dark !== 1) mat.color.multiplyScalar(dark);
  mats.set(key, mat);
  if (mats.size > 240) {
    const k = mats.keys().next().value!;
    mats.get(k)!.dispose();
    mats.delete(k);
  }
  return mat;
}
