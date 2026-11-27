import * as THREE from 'three';

// Procedural surface detail per weave: a 128 px height tile (bump), an optional albedo modulation for weaves the 2D
// fabric canvas (src/lib/textures.ts) does not know, and material parameters (sheen, roughness, holes). Every tile is
// built once and cached by weave. Weave values come from src/data/fabrics.ts (Fabric.weave); unknown names are read by
// keyword (corduroy, fleece, velvet ...), then by the fabric id, so new fabrics look right without code changes.
// The cloth uv are cm / 6, so a tile of `periodCm` repeats 6 / periodCm times per uv unit.

export type WeaveKind =
  | 'canvas' | 'twill' | 'poplin' | 'linen' | 'wool' | 'poly' | 'jersey' | 'leather' | 'spandex'
  | 'corduroy' | 'rib' | 'waffle' | 'fleece' | 'velvet' | 'satin' | 'suede' | 'mesh' | 'ripstop' | 'herringbone' | 'slub';

/** weaves the 2D fabric canvas already shades itself (its albedo carries the weave) */
export const LEGACY: ReadonlySet<string> = new Set(['canvas', 'twill', 'poplin', 'linen', 'wool', 'poly', 'jersey', 'leather', 'spandex']);

const RULES: [RegExp, WeaveKind][] = [
  [/cord/, 'corduroy'], [/waffle|thermal/, 'waffle'], [/\brib/, 'rib'], [/fleece|sherpa|terry|boucle|bouclé|pile|fur|towel/, 'fleece'],
  [/velvet|velour|plush|crushed/, 'velvet'], [/satin|silk|sateen|charmeuse/, 'satin'], [/suede|nubuck|moleskin|flannel|brushed/, 'suede'],
  [/mesh|net\b|tulle|lace|eyelet|airtex/, 'mesh'], [/ripstop|rip-stop|nylon/, 'ripstop'], [/herring|tweed|houndstooth/, 'herringbone'],
  [/slub|dobby|seersucker|crepe|crinkle|gauze/, 'slub'],
];

export function weaveKind(weave: string | undefined, id?: string): WeaveKind {
  const w = (weave ?? '').toLowerCase();
  const byId = (id ?? '').toLowerCase();
  // a legacy weave name with a telling fabric id (the rib knit is a 'jersey') takes the id's look
  for (const [re, k] of RULES) if (re.test(w)) return k;
  if (LEGACY.has(w)) {
    for (const [re, k] of RULES) if (re.test(byId) && (k === 'rib' || k === 'corduroy' || k === 'fleece' || k === 'velvet' || k === 'mesh')) return k;
    return w as WeaveKind;
  }
  for (const [re, k] of RULES) if (re.test(byId)) return k;
  return 'poplin';
}

export interface WeaveLook {
  kind: WeaveKind;
  /** tile edge in cm */
  periodCm: number;
  bump: number;
  /** override of Fabric.roughness */
  roughness?: number;
  sheen?: number;
  sheenRoughness?: number;
  /** sheen colour = fabric colour mixed this far towards white */
  sheenLift?: number;
  clearcoat?: number;
  /** the height tile is also the alpha map (holes at 0) */
  holes?: boolean;
  /** how much of the height tile darkens the albedo (weaves the 2D canvas does not shade) */
  lum: number;
}

const LOOKS: Record<WeaveKind, Omit<WeaveLook, 'kind'>> = {
  canvas: { periodCm: 6, bump: 0.9, lum: 0 },
  twill: { periodCm: 6, bump: 1.1, lum: 0 },
  poplin: { periodCm: 6, bump: 0.35, lum: 0 },
  linen: { periodCm: 6, bump: 0.8, lum: 0 },
  wool: { periodCm: 6, bump: 1.0, lum: 0 },
  poly: { periodCm: 6, bump: 0.2, lum: 0, sheen: 0.25, sheenRoughness: 0.5, sheenLift: 0.5 },
  jersey: { periodCm: 6, bump: 0.7, lum: 0 },
  leather: { periodCm: 4, bump: 1.5, lum: 0, clearcoat: 0.12 },
  spandex: { periodCm: 6, bump: 0.3, lum: 0, sheen: 0.3, sheenRoughness: 0.45, sheenLift: 0.4 },
  corduroy: { periodCm: 6, bump: 2.6, lum: 0.5, roughness: 1 },
  rib: { periodCm: 6, bump: 1.8, lum: 0.3, roughness: 0.95 },
  waffle: { periodCm: 6, bump: 2.6, lum: 0.4, roughness: 1 },
  fleece: { periodCm: 6, bump: 1.7, lum: 0.45, roughness: 1, sheen: 0.55, sheenRoughness: 0.9, sheenLift: 0.35 },
  velvet: { periodCm: 6, bump: 0.5, lum: 0.2, roughness: 0.9, sheen: 1, sheenRoughness: 0.35, sheenLift: 0.55 },
  satin: { periodCm: 6, bump: 0.12, lum: 0.05, roughness: 0.32, sheen: 0.7, sheenRoughness: 0.3, sheenLift: 0.6, clearcoat: 0.18 },
  suede: { periodCm: 4, bump: 0.7, lum: 0.35, roughness: 1, sheen: 0.45, sheenRoughness: 0.8, sheenLift: 0.3 },
  mesh: { periodCm: 3, bump: 1.4, lum: 0.1, roughness: 0.8, holes: true },
  ripstop: { periodCm: 6, bump: 0.9, lum: 0.1, roughness: 0.6, sheen: 0.2, sheenRoughness: 0.5, sheenLift: 0.4 },
  herringbone: { periodCm: 6, bump: 1.3, lum: 0.25, roughness: 1 },
  slub: { periodCm: 6, bump: 1.1, lum: 0.3, roughness: 0.95 },
};

export const weaveLook = (kind: WeaveKind): WeaveLook => ({ kind, ...LOOKS[kind] });

/* ---------- height tiles ---------- */

const S = 128;
const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const TAU = Math.PI * 2;
const wr = (v: number, n = S) => ((v % n) + n) % n;

/** smooth wrapping value noise, 0..1 */
function vnoise(cells: number, seed: number) {
  const r = rng(seed), g = Array.from({ length: cells * cells }, () => r());
  const v = (i: number, j: number) => g[wr(j, cells) * cells + wr(i, cells)];
  return (x: number, y: number) => {
    const gx = (x / S) * cells, gy = (y / S) * cells, ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (v(ix, iy) * (1 - sx) + v(ix + 1, iy) * sx) * (1 - sy) + (v(ix, iy + 1) * (1 - sx) + v(ix + 1, iy + 1) * sx) * sy;
  };
}

/** wrapping cellular (Worley) distances: nearest and second nearest, in pixels */
function worley(points: number, seed: number) {
  const r = rng(seed), P = Array.from({ length: points }, () => [r() * S, r() * S]);
  return (x: number, y: number) => {
    let d1 = 1e9, d2 = 1e9;
    for (const [px, py] of P) {
      const dx = Math.min(Math.abs(x - px), S - Math.abs(x - px)), dy = Math.min(Math.abs(y - py), S - Math.abs(y - py));
      const d = dx * dx + dy * dy;
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return [Math.sqrt(d1), Math.sqrt(d2)] as const;
  };
}

const smooth = (a: number, b: number, v: number) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

type Height = (x: number, y: number) => number;

function heightFn(kind: WeaveKind): Height {
  const n1 = vnoise(16, 11), n2 = vnoise(32, 23), n3 = vnoise(64, 37), r = rng(5);
  const px = Float32Array.from({ length: S * S }, () => r());
  const pn = (x: number, y: number) => px[wr(y) * S + wr(x)];
  switch (kind) {
    case 'canvas': return (x, y) => { const c = (((x >> 3) + (y >> 3)) & 1) ? 0.72 : 0.5; return c + 0.18 * Math.sin((x % 8) / 8 * Math.PI) * (((x >> 3) + (y >> 3)) & 1 ? 1 : 0) + 0.12 * Math.sin((y % 8) / 8 * Math.PI) * (((x >> 3) + (y >> 3)) & 1 ? 0 : 1) + (pn(x, y) - 0.5) * 0.1; };
    case 'twill': return (x, y) => 0.5 + 0.4 * Math.sin(((x + y) % 8) / 8 * TAU) + (pn(x, y) - 0.5) * 0.12;
    case 'poplin': return (x, y) => 0.5 + 0.12 * Math.sin((y % 2) * Math.PI) + 0.1 * Math.sin((x % 2) * Math.PI) + (pn(x, y) - 0.5) * 0.12;
    case 'linen': return (x, y) => 0.5 + 0.2 * Math.sin((y + n1(x, 0) * 60) * 1.1) + 0.18 * Math.sin((x + n1(0, y) * 60) * 1.3) + (n2(x, y) - 0.5) * 0.4;
    case 'wool': return (x, y) => 0.35 + n3(x, y) * 0.4 + (n2(x, y) - 0.5) * 0.3;
    case 'poly': return (x, y) => 0.5 + 0.06 * Math.sin((y % 4) / 4 * TAU) + (pn(x, y) - 0.5) * 0.06;
    case 'jersey': return (x, y) => { const col = x % 6; return 0.5 + 0.38 * (Math.abs(((y + (col < 3 ? col : 6 - col) * 1.5) % 6) - 3) / 3 - 0.5) + (pn(x, y) - 0.5) * 0.1; };
    case 'spandex': return (x, y) => 0.5 + 0.25 * Math.sin(((x + y * 2) % 6) / 6 * TAU) + (pn(x, y) - 0.5) * 0.08;
    case 'leather': {
      const w = worley(46, 91);
      return (x, y) => { const [d1, d2] = w(x, y); return 0.25 + 0.7 * smooth(0, 4.5, d2 - d1) + (n3(x, y) - 0.5) * 0.12; };
    }
    case 'corduroy': return (x, y) => {
      const t = (x % 8) / 8;
      const ridge = t < 0.74 ? Math.sin((Math.PI * t) / 0.74) ** 0.7 : 0;
      return 0.1 + 0.8 * ridge + (n3(x, y) - 0.5) * 0.06;
    };
    case 'rib': return (x, y) => 0.5 + 0.42 * Math.cos((x / 8) * TAU) + 0.06 * Math.sin((y % 4) / 4 * TAU) + (pn(x, y) - 0.5) * 0.06;
    case 'waffle': return (x, y) => {
      const a = Math.sin((Math.PI * (x % 16)) / 16), b = Math.sin((Math.PI * (y % 16)) / 16);
      return 1 - 0.9 * Math.min(1, (a * b) ** 0.8) + (pn(x, y) - 0.5) * 0.05;
    };
    case 'fleece': return (x, y) => 0.3 + 0.45 * n3(x, y) + 0.3 * n2(x + 17, y + 5) * pn(x, y) + (pn(x + 3, y) - 0.5) * 0.25;
    case 'velvet': return (x, y) => 0.5 + (n3(x, y) - 0.5) * 0.35 + (pn(x, y) - 0.5) * 0.25;
    case 'satin': return (x, y) => 0.5 + 0.08 * Math.sin(((x * 3 + y) % 16) / 16 * TAU) + (n1(x, y) - 0.5) * 0.12;
    case 'suede': return (x, y) => 0.5 + (pn(x, y) - 0.5) * 0.6 + (n3(x, y) - 0.5) * 0.4;
    case 'mesh': return (x, y) => {
      // 8 x 8 holes per tile; a hole is 0 (alpha cut), the net threads stand up around it
      const cx = (x % 16) - 7.5, cy = (y % 16) - 7.5, d = Math.hypot(cx, cy);
      return d < 4.6 ? 0 : 0.55 + 0.4 * smooth(4.6, 8, d) * 0.6 + (pn(x, y) - 0.5) * 0.1;
    };
    case 'ripstop': return (x, y) => {
      const grid = (x % 32 < 2 || y % 32 < 2) ? 0.35 : 0;
      return 0.45 + grid + 0.1 * Math.sin((x % 2) * Math.PI) * Math.sin((y % 2) * Math.PI) + (pn(x, y) - 0.5) * 0.08;
    };
    case 'herringbone': return (x, y) => {
      const flip = (x % 32) < 16;
      const d = flip ? x + y : x - y;
      return 0.5 + 0.38 * Math.sin((wr(d, 8) / 8) * TAU) + (pn(x, y) - 0.5) * 0.1;
    };
    case 'slub': return (x, y) => {
      const row = Math.floor(y / 3), th = 0.5 + 0.5 * pn(row * 7 % S, 3);
      const slub = smooth(0.55, 0.9, n2(x * 2, row * 9)) * 0.4;
      return 0.5 + 0.25 * Math.sin((y % 3) / 3 * Math.PI) * th + slub * (0.4 + th * 0.6) + (pn(x, y) - 0.5) * 0.1;
    };
  }
}

const heightCache = new Map<WeaveKind, HTMLCanvasElement>();

/** greyscale height tile (white = high), built once per weave */
export function heightTile(kind: WeaveKind): HTMLCanvasElement {
  let c = heightCache.get(kind);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, img = g.createImageData(S, S), h = heightFn(kind);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = Math.max(0, Math.min(255, Math.round(h(x, y) * 255)));
    const i = (y * S + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  heightCache.set(kind, c);
  return c;
}

const texCache = new Map<WeaveKind, THREE.CanvasTexture>();

/** shared bump (and, for mesh, alpha) texture of a weave, repeating every look.periodCm */
export function heightTexture(look: WeaveLook): THREE.CanvasTexture {
  let t = texCache.get(look.kind);
  if (!t) {
    t = new THREE.CanvasTexture(heightTile(look.kind));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(6 / look.periodCm, 6 / look.periodCm);
    t.anisotropy = 4;
    texCache.set(look.kind, t);
  }
  return t;
}

/** albedo: the fabric colour multiplied with the weave's light and dark (for weaves the 2D fabric canvas lacks) */
const albedoCache = new Map<string, HTMLCanvasElement>();
export function albedoCanvas(look: WeaveLook, hex: string): HTMLCanvasElement {
  const key = look.kind + hex;
  let c = albedoCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const src = heightTile(look.kind).getContext('2d')!.getImageData(0, 0, S, S), out = g.createImageData(S, S);
  // brightness follows the height around 1 (high = lighter), applied in sRGB space like the 2D fabric canvas does
  const hx = new THREE.Color(hex).getHex(), base = [(hx >> 16) & 255, (hx >> 8) & 255, hx & 255];
  for (let i = 0; i < S * S; i++) {
    const m = 1 + look.lum * ((src.data[i * 4] / 255 - 0.5) * 0.9);
    for (let k = 0; k < 3; k++) out.data[i * 4 + k] = Math.max(0, Math.min(255, base[k] * m));
    out.data[i * 4 + 3] = 255;
  }
  g.putImageData(out, 0, 0);
  albedoCache.set(key, c);
  if (albedoCache.size > 48) albedoCache.delete(albedoCache.keys().next().value!);
  return c;
}
