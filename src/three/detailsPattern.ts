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
const p2 = (n: number) => Math.min(MAX_TEX, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, n)))));

interface Raster { canvas: HTMLCanvasElement; size: [number, number]; ready: boolean; textures: Set<THREE.CanvasTexture> }
const rasters = new Map<string, Raster>();

export const isWoven = (p: FabricPattern) => p.method === 'woven';
export const isPlain = (p: FabricPattern | undefined): p is undefined => !p || p.id === 'solid';

/** cache key of a pattern's raster: everything but the rotation */
export const patternKey = (p: FabricPattern) => JSON.stringify([p.id, p.colors, p.scale]);

export function patternRaster(p: FabricPattern): Raster {
  const key = patternKey(p);
  let r = rasters.get(key);
  if (r) return r;
  const tile = patternTile(p);
  const [w, h] = tile.size;
  const canvas = document.createElement('canvas');
  canvas.width = p2(w * MIN_PX_PER_CM);
  canvas.height = p2(h * MIN_PX_PER_CM);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = p.colors[0] ?? '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  r = { canvas, size: [w, h], ready: false, textures: new Set() };
  rasters.set(key, r);
  const rr = r;
  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    rr.ready = true;
    rr.textures.forEach((t) => { t.needsUpdate = true; });
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
export function patternFill(ctx: CanvasRenderingContext2D, p: FabricPattern): CanvasPattern | null {
  const r = patternRaster(p);
  const pat = ctx.createPattern(r.canvas, 'repeat');
  if (!pat) return null;
  // canvas y runs down, like the piece: rotate(+deg) turns it clockwise, the same way as patternTexture
  pat.setTransform(new DOMMatrix().rotate(p.rotation || 0).scale(r.size[0] / r.canvas.width, r.size[1] / r.canvas.height));
  return pat;
}

/* ---------- materials ---------- */

type Cloth = FabricRef;
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
  const key = [fb.id, hex, pat ? patternKey(pat) + '|' + (pat.rotation || 0) : '', side, dark].join('~');
  let m = mats.get(key);
  if (m) { mats.delete(key); mats.set(key, m); return m; }
  const kind = weaveKind(f.weave, f.id);
  const look = weaveLook(kind);
  const physical = (look.sheen ?? 0) > 0 || (look.clearcoat ?? 0) > 0;
  const base: THREE.MeshStandardMaterialParameters = {
    side, roughness: look.roughness ?? f.roughness, metalness: 0,
    map: pat ? patternTexture(pat) : plainTexture(f.id, hex, kind),
    bumpMap: heightTexture(look), bumpScale: look.bump,
  };
  if (look.holes) { base.alphaMap = heightTexture(look); base.alphaTest = 0.35; }
  let mat: THREE.MeshStandardMaterial;
  if (physical) {
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
