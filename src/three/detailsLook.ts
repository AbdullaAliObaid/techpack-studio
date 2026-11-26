import * as THREE from 'three';
import type { Label, LabelType, Sheen } from '../data/edits';

// Surface looks shared by prints, embroidery, clothing tags and trims: sheen presets for material parameters and the
// procedural weave / grain tiles the tag materials use.

export interface Look {
  roughness: number;
  metalness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  sheen: number;
  envMapIntensity: number;
}

/**
 * Material parameters for a Sheen. `metalBase` is true for metal trims (their metal finish stays metal; matte means
 * brushed, glossy means polished with a clear coat) and false for cloth, ink, thread and plastic.
 */
export function sheenLook(sheen: Sheen | undefined, metalBase: boolean): Look {
  const s: Sheen = sheen ?? (metalBase ? 'metallic' : 'matte');
  if (metalBase) {
    switch (s) {
      case 'matte': return { roughness: 0.58, metalness: 0.75, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, envMapIntensity: 0.9 };
      case 'satin': return { roughness: 0.4, metalness: 1, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, envMapIntensity: 1.1 };
      case 'glossy': return { roughness: 0.08, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.04, sheen: 0, envMapIntensity: 1.5 };
      default: return { roughness: 0.26, metalness: 1, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, envMapIntensity: 1.25 };
    }
  }
  switch (s) {
    case 'satin': return { roughness: 0.5, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.4, sheen: 0.85, envMapIntensity: 1 };
    case 'glossy': return { roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0, envMapIntensity: 1.3 };
    case 'metallic': return { roughness: 0.3, metalness: 0.8, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, envMapIntensity: 1.3 };
    default: return { roughness: 0.88, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, envMapIntensity: 1 };
  }
}

export function applyLook(m: THREE.MeshPhysicalMaterial, l: Look) {
  m.roughness = l.roughness;
  m.metalness = l.metalness;
  m.clearcoat = l.clearcoat;
  m.clearcoatRoughness = l.clearcoatRoughness;
  m.sheen = l.sheen;
  m.sheenRoughness = 0.4;
  m.envMapIntensity = l.envMapIntensity;
  m.needsUpdate = true;
}

/* ---------- procedural tiles ---------- */

const tiles = new Map<string, HTMLCanvasElement>();
const canvas = (n: number) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

/** Plain weave height tile (also usable as albedo variation): over / under threads, 8 threads across. */
export function weaveTile(): HTMLCanvasElement {
  const hit = tiles.get('weave');
  if (hit) return hit;
  const S = 64, c = canvas(S), g = c.getContext('2d')!, n = 8, t = S / n;
  g.fillStyle = '#707070';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const over = (i + j) % 2 === 0; // warp over weft
    const gr = over ? g.createLinearGradient(i * t, 0, (i + 1) * t, 0) : g.createLinearGradient(0, j * t, 0, (j + 1) * t);
    gr.addColorStop(0, '#9a9a9a'); gr.addColorStop(0.5, '#ffffff'); gr.addColorStop(1, '#9a9a9a');
    g.fillStyle = gr;
    g.fillRect(i * t + 0.5, j * t + 0.5, t - 1, t - 1);
  }
  tiles.set('weave', c);
  return c;
}

/** Leather grain: irregular pebbles with dark creases. */
export function grainTile(): HTMLCanvasElement {
  const hit = tiles.get('grain');
  if (hit) return hit;
  const S = 128, c = canvas(S), g = c.getContext('2d')!, r = rng(4242);
  g.fillStyle = '#b4b4b4';
  g.fillRect(0, 0, S, S);
  // pebbles: soft discs, wrapped so the tile repeats
  for (let i = 0; i < 520; i++) {
    const x = r() * S, y = r() * S, rad = 2.2 + r() * 3.2, v = 150 + Math.round(r() * 90);
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, rad);
      gr.addColorStop(0, `rgb(${v},${v},${v})`); gr.addColorStop(0.75, `rgb(${v - 40},${v - 40},${v - 40})`); gr.addColorStop(1, 'rgba(60,60,60,0.6)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(x + ox, y + oy, rad, 0, Math.PI * 2); g.fill();
    }
  }
  tiles.set('grain', c);
  return c;
}

/** Fine speckle for soft cotton. */
export function cottonTile(): HTMLCanvasElement {
  const hit = tiles.get('cotton');
  if (hit) return hit;
  const S = 64, c = canvas(S), g = c.getContext('2d')!, r = rng(99);
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    const v = 150 + Math.round(r() * 105);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.floor(r() * S), Math.floor(r() * S), 1 + Math.round(r()), 1);
  }
  tiles.set('cotton', c);
  return c;
}

const tex = (c: HTMLCanvasElement, repeat: number, srgb: boolean) => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/* ---------- clothing tags ---------- */

export interface LabelLook extends Look {
  /** thickness feel: bump strength of the grain / weave */
  bump: number;
  /** tiles per cm of the grain / weave, 0 for smooth */
  tilesPerCm: number;
  tile: 'weave' | 'grain' | 'cotton' | null;
  /** artwork is: 'woven' (thread-textured, flat), 'ink' (flat), 'raised' (moulded), 'debossed' (pressed in) */
  art: 'woven' | 'ink' | 'raised' | 'debossed';
  /** how thick the tag looks (cm), used for the edge rim */
  thickness: number;
}

const BASE: Record<LabelType, { sheen: Sheen; bump: number; tile: LabelLook['tile']; tilesPerCm: number; art: LabelLook['art']; thickness: number }> = {
  woven: { sheen: 'satin', bump: 1.4, tile: 'weave', tilesPerCm: 2.2, art: 'woven', thickness: 0.05 },
  printed: { sheen: 'matte', bump: 0, tile: null, tilesPerCm: 0, art: 'ink', thickness: 0.03 },
  satin: { sheen: 'satin', bump: 0, tile: null, tilesPerCm: 0, art: 'ink', thickness: 0.03 },
  cotton: { sheen: 'matte', bump: 0.6, tile: 'cotton', tilesPerCm: 3, art: 'ink', thickness: 0.05 },
  leather: { sheen: 'matte', bump: 1.6, tile: 'grain', tilesPerCm: 1.1, art: 'debossed', thickness: 0.2 },
  rubber: { sheen: 'glossy', bump: 0, tile: null, tilesPerCm: 0, art: 'raised', thickness: 0.28 },
};

export function labelLook(label: Label | undefined, sheen: Sheen | undefined): LabelLook {
  const b = BASE[label?.type ?? 'woven'];
  const l = sheenLook(sheen ?? b.sheen, false);
  // leather and rubber keep their own character under a plain 'matte' choice
  const look = label?.type === 'leather' ? { ...l, roughness: Math.min(l.roughness, 0.62) } : label?.type === 'rubber' ? { ...l, roughness: Math.min(l.roughness, 0.55), clearcoat: Math.max(l.clearcoat, 0.15) } : l;
  return { ...look, bump: b.bump, tilesPerCm: b.tilesPerCm, tile: b.tile, art: b.art, thickness: b.thickness };
}

const labelCache = new Map<string, THREE.MeshPhysicalMaterial>();

/**
 * Cloth material of a tag's own panel (uv are the cloth view's pattern uv, cm / 6). `side` is chosen by the caller.
 * Colour comes from Label.color; the type decides weave, grain, softness and gloss; Attachment.sheen overrides the gloss.
 */
export function labelMaterial(label: Label | undefined, sheen: Sheen | undefined, side: THREE.Side): THREE.MeshPhysicalMaterial {
  const look = labelLook(label, sheen);
  const color = label?.color ?? '#f2efe6';
  const key = [label?.type, color, sheen, side].join('|');
  let m = labelCache.get(key);
  if (m) return m;
  m = new THREE.MeshPhysicalMaterial({ color, side });
  applyLook(m, look);
  if (look.tile) {
    // the cloth uv are cm / 6, so tiles per cm times 6 gives the repeat
    const rep = look.tilesPerCm * 6 * (look.tile === 'weave' ? 8 / 8 : 1) / (look.tile === 'grain' ? 2 : look.tile === 'cotton' ? 1 : 1);
    const bump = tex(look.tile === 'weave' ? weaveTile() : look.tile === 'grain' ? grainTile() : cottonTile(), rep / (look.tile === 'weave' ? 1 : 1), false);
    m.bumpMap = bump;
    m.bumpScale = look.bump;
    if (look.tile === 'weave') m.map = tex(weaveTile(), rep, true);
  }
  labelCache.set(key, m);
  return m;
}
