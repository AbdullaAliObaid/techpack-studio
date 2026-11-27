// Generic fabric patterns, drawn procedurally. One definition shared by the 2D chart (as an SVG <pattern>) and the 3D
// view (the renderer rasterises the same SVG into a canvas texture), so a piece looks the same in both.
//
// patternTile() returns ONE seamless repeat in cm, unrotated and on the grain: the consumer applies
// FabricPattern.rotation (patternTransform in SVG, texture rotation in 3D). Rules that keep every tile seamless:
//   - nothing has a colour boundary lying exactly on a tile edge (stripes and woven cells sit half a cell in);
//   - any motif that crosses an edge is drawn again one repeat over on the other side (wrap()), in the same order;
//   - layouts are seeded from the pattern id only, in unit coordinates, so a tile is identical across sessions and
//     at every scale.
// Only <rect>, <circle>, <ellipse> and <path> (absolute M L Q C Z) with fill / fill-opacity / fill-rule are used, no
// transforms or strokes, so the SVG is tiny and easy to rasterise anywhere. All designs are generic (generic setts,
// generic flowers, generic spots): nothing copies a trademarked or clan design.

import type { FabricPattern, PatternId, PatternMotif, RepeatLayout } from './fabrics';

export interface PatternDef {
  name: string;
  description: string;
  /** how many colours the pattern uses (FabricPattern.colors, first = ground) */
  colorsCount: number;
  defaults: FabricPattern;
}

const def = (id: PatternId, name: string, description: string, colors: string[], scale: number, method: 'printed' | 'woven'): PatternDef =>
  ({ name, description, colorsCount: colors.length, defaults: { id, colors, scale, rotation: 0, method } });

export const PATTERNS: Record<PatternId, PatternDef> = {
  solid: def('solid', 'Solid', 'One plain colour.', ['#f4f4f1'], 1, 'woven'),
  stripe: def('stripe', 'Stripe', 'Even stripes along the grain, shirting style.', ['#f4f4f1', '#7e9cc8'], 1, 'woven'),
  pinstripe: def('pinstripe', 'Pinstripe', 'Fine single thread lines on a dark ground, suiting style.', ['#28304a', '#d9dce3'], 1.2, 'woven'),
  breton: def('breton', 'Breton stripe', 'Bold stripes across the body, the classic sailor look.', ['#f3f1ea', '#1f2a44'], 2.2, 'woven'),
  awning: def('awning', 'Awning stripe', 'Wide, equal stripes, deckchair style.', ['#f3efe4', '#2f6f73'], 5, 'printed'),
  gingham: def('gingham', 'Gingham', 'Small even check where two colours cross to make a third.', ['#f5f5f2', '#2f4d8f'], 0.8, 'woven'),
  check: def('check', 'Check', 'Two tone check with a fine overcheck line.', ['#efe9dc', '#5d6b4a', '#a8573a'], 2.5, 'woven'),
  plaid: def('plaid', 'Plaid', 'Flannel shirt plaid with wide and narrow bands.', ['#9e2d2b', '#25262a', '#2f4a3a', '#d8b54a'], 8, 'woven'),
  tartan: def('tartan', 'Tartan', 'Symmetric woven sett of crossing bands (a generic sett, not a clan tartan).', ['#1f2a44', '#2f4a3a', '#7a1f2b', '#e0c36a'], 10, 'woven'),
  windowpane: def('windowpane', 'Windowpane', 'Large open check of thin lines, coat and suit style.', ['#4a4c52', '#c6a776'], 8, 'woven'),
  houndstooth: def('houndstooth', 'Houndstooth', 'Broken check with pointed teeth, woven in a 2/2 twill.', ['#efe9dc', '#202124'], 1.2, 'woven'),
  herringbone: def('herringbone', 'Herringbone', 'Twill that reverses direction to form a zigzag.', ['#a3a09a', '#45464a'], 1.6, 'woven'),
  chevron: def('chevron', 'Chevron', 'Bold printed zigzag bands.', ['#f3efe4', '#2b3651'], 6, 'printed'),
  polka: def('polka', 'Polka dot', 'Evenly spaced round dots.', ['#1f2742', '#f4f2ec'], 2, 'printed'),
  pindot: def('pindot', 'Pin dot', 'Tiny dots, tie and shirting style.', ['#25304a', '#e8e4da'], 0.6, 'printed'),
  grid: def('grid', 'Grid', 'Small regular grid of crisp lines.', ['#f4f4f1', '#2a3550'], 1.5, 'printed'),
  camo: def('camo', 'Camouflage', 'Generic woodland blobs in four tones.', ['#7a7a52', '#4b5236', '#8c7459', '#2c2c24'], 24, 'printed'),
  floral: def('floral', 'Floral', 'Simple five petal flowers with leaves.', ['#f3ece0', '#d77a7a', '#f0c75e', '#6b8f5e'], 10, 'printed'),
  paisley: def('paisley', 'Paisley', 'Generic teardrop motifs with an inner drop and dots.', ['#2a3550', '#b8684a', '#e3c58a', '#efe9dc'], 12, 'printed'),
  animal: def('animal', 'Animal spot', 'Generic big cat style rosettes and spots.', ['#d6b27a', '#2b2119', '#8a5a33'], 14, 'printed'),
  geo: def('geo', 'Geometric', 'Diamond lattice with inner diamonds.', ['#efe9dc', '#2f6f73', '#c39a3c'], 4, 'printed'),
  'tie-dye': def('tie-dye', 'Tie dye', 'Wobbly concentric rings, hand dyed look.', ['#f2efe8', '#5b6fb5', '#c86aa5'], 30, 'printed'),
  heather: def('heather', 'Heather', 'Fine flecks of mixed yarn colours, marl knit look.', ['#a3a5a8', '#7f8185', '#d0d2d4'], 2, 'woven'),
  custom: def('custom', 'Your motif', 'Your own drawing or picture, repeated across the fabric.', ['#f4f2ee'], 6, 'printed'),
  jacquard: def('jacquard', 'Jacquard', 'Tone on tone woven medallion and small diamonds.', ['#2b3651', '#3a4766', '#56648a'], 4, 'woven'),
};

export const PATTERN_IDS = Object.keys(PATTERNS) as PatternId[];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const REPEAT_LAYOUTS: RepeatLayout[] = ['block', 'half-drop', 'brick', 'mirror', 'turn', 'scatter'];

const DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const PATH_D = /^[MLQCZHVSTAmlqczhvsta0-9 ,.eE+-]+$/;

/** Keep only a motif that is safe to put into an SVG: base64 image data URL, hex colours, plain path data. */
export function cleanMotif(m: PatternMotif | undefined): PatternMotif | undefined {
  if (!m) return undefined;
  const image = typeof m.image === 'string' && m.image.length < 6_000_000 && DATA_URL.test(m.image) ? m.image : undefined;
  const paths = Array.isArray(m.paths)
    ? m.paths.filter((q) => q && typeof q.path === 'string' && PATH_D.test(q.path) && HEX.test(q.color)).slice(0, 24).map((q) => ({ color: q.color.toLowerCase(), path: q.path }))
    : undefined;
  if (!image && !paths?.length) return undefined;
  const aspect = Number.isFinite(m.aspect) && m.aspect > 0 ? Math.min(20, Math.max(0.05, m.aspect)) : 1;
  const out: PatternMotif = { aspect };
  if (image) out.image = image;
  if (paths?.length) out.paths = paths;
  if (m.detectedTile && m.detectedTile.w > 0 && m.detectedTile.h > 0) out.detectedTile = { w: m.detectedTile.w, h: m.detectedTile.h };
  return out;
}

/** Fill in anything missing (old saves, partial UI state) and keep colours to safe CSS hex values. */
export function withPatternDefaults(p: Partial<FabricPattern> & { id: PatternId }): FabricPattern {
  const d = (PATTERNS[p.id] ?? PATTERNS.solid).defaults;
  const colors = d.colors.map((c, i) => (p.colors?.[i] && HEX.test(p.colors[i]) ? p.colors[i].toLowerCase() : c));
  const scale = Number.isFinite(p.scale) && p.scale! > 0.05 ? p.scale! : d.scale;
  const out: FabricPattern = { id: PATTERNS[p.id] ? p.id : 'solid', colors, scale, rotation: Number.isFinite(p.rotation) ? p.rotation! : 0, method: p.method ?? d.method };
  if (out.id === 'custom') {
    const motif = cleanMotif(p.motif);
    if (motif) out.motif = motif;
    out.layout = p.layout && REPEAT_LAYOUTS.includes(p.layout) ? p.layout : 'block';
    out.motifScale = Number.isFinite(p.motifScale) ? Math.min(1, Math.max(0.2, p.motifScale!)) : 0.7;
    const rc = p.recolor?.filter((c) => HEX.test(c)).map((c) => c.toLowerCase());
    if (rc?.length) out.recolor = rc;
  }
  return out;
}

/** Plain language summary for specs and the PDF: 'Gingham, 0.8 cm repeat, woven'. */
export function patternLabel(p: FabricPattern): string {
  const d = PATTERNS[p.id] ?? PATTERNS.solid;
  if (p.id === 'solid') return d.name;
  const rot = p.rotation ? `, at ${Math.round(p.rotation)} deg` : '';
  return `${d.name}, ${Math.round(p.scale * 10) / 10} cm repeat${rot}, ${p.method ?? d.defaults.method}`;
}

// ---------------------------------------------------------------- drawing kit

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

/** Small seeded generator (mulberry32) so layouts repeat exactly. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

type Pt = [number, number];

class Tile {
  out: string[] = [];
  constructor(public W: number, public H: number) {}
  private op(o?: number) { return o !== undefined && o < 1 ? ` fill-opacity="${f(o)}"` : ''; }
  rect(x: number, y: number, w: number, h: number, fill: string, o?: number) {
    this.out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"${this.op(o)}/>`);
  }
  circle(cx: number, cy: number, r: number, fill: string, o?: number) {
    this.out.push(`<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r)}" fill="${fill}"${this.op(o)}/>`);
  }
  ellipse(cx: number, cy: number, rx: number, ry: number, fill: string, o?: number) {
    this.out.push(`<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${f(rx)}" ry="${f(ry)}" fill="${fill}"${this.op(o)}/>`);
  }
  path(d: string, fill: string, o?: number, evenodd = false) {
    this.out.push(`<path d="${d}" fill="${fill}"${this.op(o)}${evenodd ? ' fill-rule="evenodd"' : ''}/>`);
  }
  /** call draw(ox, oy) for every copy, one repeat over, that a motif with this bounding box reaches into the tile */
  wrap(x0: number, y0: number, x1: number, y1: number, draw: (ox: number, oy: number) => void) {
    for (const oy of [0, -this.H, this.H]) for (const ox of [0, -this.W, this.W]) {
      if (x1 + ox <= 0 || x0 + ox >= this.W || y1 + oy <= 0 || y0 + oy >= this.H) continue;
      draw(ox, oy);
    }
  }
  /** a rectangle that may run over an edge: drawn wrapped */
  wrect(x: number, y: number, w: number, h: number, fill: string, o?: number) {
    this.wrap(x, y, x + w, y + h, (ox, oy) => this.rect(x + ox, y + oy, w, h, fill, o));
  }
}

/** Closed smooth outline through points: quadratic curves through the midpoints, each point a control point. */
function smoothClosed(pts: Pt[], ox = 0, oy = 0): string {
  const n = pts.length;
  const m = (i: number): Pt => [(pts[i % n][0] + pts[(i + 1) % n][0]) / 2 + ox, (pts[i % n][1] + pts[(i + 1) % n][1]) / 2 + oy];
  let d = `M${f(m(0)[0])} ${f(m(0)[1])}`;
  for (let i = 1; i <= n; i++) { const c = pts[i % n], e = m(i); d += `Q${f(c[0] + ox)} ${f(c[1] + oy)} ${f(e[0])} ${f(e[1])}`; }
  return d + 'Z';
}

/** Irregular round blob: k points round a centre at radius r times a seeded wobble. */
function blobPts(cx: number, cy: number, r: number, k: number, wob: number, rnd: () => number, stretch = 1, rot = 0): Pt[] {
  const out: Pt[] = [];
  const ph = rnd() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const a = ph + (i / k) * Math.PI * 2;
    const rr = r * (1 - wob / 2 + wob * rnd());
    const x = Math.cos(a) * rr * stretch, y = Math.sin(a) * rr;
    out.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  return out;
}
const bboxOf = (pts: Pt[]) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return [x0, y0, x1, y1] as const;
};
/** blob drawn wrapped (one path per copy) */
function wblob(t: Tile, pts: Pt[], fill: string, o?: number) {
  const [x0, y0, x1, y1] = bboxOf(pts);
  t.wrap(x0, y0, x1, y1, (ox, oy) => t.path(smoothClosed(pts, ox, oy), fill, o));
}
/** lens shape from a to b, bulging w each side (petals, leaves) */
function lens(a: Pt, b: Pt, w: number, ox: number, oy: number) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const px = (-dy / L) * w, py = (dx / L) * w;
  return `M${f(a[0] + ox)} ${f(a[1] + oy)}Q${f(mx + px + ox)} ${f(my + py + oy)} ${f(b[0] + ox)} ${f(b[1] + oy)}Q${f(mx - px + ox)} ${f(my - py + oy)} ${f(a[0] + ox)} ${f(a[1] + oy)}Z`;
}

/**
 * Seeded scatter of n centres in the unit square, kept apart (Poisson style, distance measured across the wrap)
 * so motifs do not pile up.
 */
function scatter(n: number, minD: number, rnd: () => number): Pt[] {
  const pts: Pt[] = [];
  for (let tries = 0; pts.length < n && tries < n * 200; tries++) {
    const p: Pt = [rnd(), rnd()];
    const ok = pts.every((q) => {
      const dx = Math.min(Math.abs(p[0] - q[0]), 1 - Math.abs(p[0] - q[0])), dy = Math.min(Math.abs(p[1] - q[1]), 1 - Math.abs(p[1] - q[1]));
      return dx * dx + dy * dy >= minD * minD;
    });
    if (ok) pts.push(p);
  }
  return pts;
}

/** Bands across the warp and the weft (plaid, tartan, gingham): each band [start, width, colour, opacity] in units of S. */
function sett(t: Tile, S: number, bands: [number, number, string, number][]) {
  for (const [a, w, c, o] of bands) t.rect(a * S, 0, w * S, t.H, c, o); // warp (vertical)
  for (const [a, w, c, o] of bands) t.rect(0, a * S, t.W, w * S, c, o); // weft (horizontal)
}

/** Woven cells: n x m threads, cell (i, j) is dark when on(i, j). Cells sit half a thread in so no boundary is on an edge. */
function woven(t: Tile, n: number, m: number, fill: string, on: (i: number, j: number) => boolean) {
  const cw = t.W / n, ch = t.H / m;
  for (let j = 0; j < m; j++) {
    // merge runs along the row to keep the SVG small
    let i = 0;
    while (i < n) {
      if (!on(i, j)) { i++; continue; }
      let k = i;
      while (k + 1 < n && on(k + 1, j)) k++;
      t.wrect((i + 0.5) * cw, (j + 0.5) * ch, (k - i + 1) * cw, ch, fill);
      i = k + 1;
    }
  }
}

// ---------------------------------------------------------------- the tile

/**
 * One seamless repeat of a pattern as a standalone SVG document in cm (viewBox 0 0 w h). `body` is the same markup
 * without the <svg> wrapper, ready to drop inside an SVG <pattern width=w height=h patternUnits="userSpaceOnUse">.
 */
export function patternTile(pIn: FabricPattern): { size: [number, number]; svg: string; body: string } {
  const p = withPatternDefaults(pIn);
  if (p.id === 'custom') return customTile(p);
  const S = p.scale;
  const c = p.colors;
  const rnd = rng(hash(p.id));
  const H = p.id === 'chevron' ? S * 0.5 : S;
  const t = new Tile(S, H);
  t.rect(0, 0, S, H, c[0]); // ground
  switch (p.id) {
    case 'solid': break;
    case 'stripe': t.rect(0.3 * S, 0, 0.4 * S, H, c[1]); break;
    case 'pinstripe': { const w = Math.max(0.03 * S, 0.04); t.rect(0.5 * S - w / 2, 0, w, H, c[1]); break; }
    case 'breton': t.rect(0, 0.325 * S, S, 0.35 * S, c[1]); break;
    case 'awning': t.rect(0.25 * S, 0, 0.5 * S, H, c[1]); break;
    case 'gingham': sett(t, S, [[0.25, 0.5, c[1], 0.5]]); break;
    case 'check': sett(t, S, [[0.25, 0.5, c[1], 0.45], [0.49, 0.02, c[2], 0.85]]); break;
    case 'plaid':
      sett(t, S, [[0.08, 0.36, c[1], 0.55], [0.56, 0.2, c[2], 0.5], [0.7, 0.025, c[3], 0.9], [0.27, 0.02, c[3], 0.8]]);
      break;
    case 'tartan':
      // a generic symmetric sett: wide ground band, narrow accent band, wide band, fine overcheck lines
      sett(t, S, [[0.04, 0.3, c[1], 0.6], [0.37, 0.06, c[2], 0.6], [0.47, 0.06, c[1], 0.35], [0.57, 0.06, c[2], 0.6], [0.66, 0.3, c[1], 0.6],
        [0.19, 0.012, c[3], 0.95], [0.81, 0.012, c[3], 0.95], [0.5, 0.012, c[3], 0.9]]);
      break;
    case 'windowpane': { const w = 0.025 * S; t.rect(0.5 * S - w / 2, 0, w, H, c[1]); t.rect(0, 0.5 * S - w / 2, S, w, c[1]); break; }
    case 'grid': { const w = 0.07 * S; t.rect(0.5 * S - w / 2, 0, w, H, c[1]); t.rect(0, 0.5 * S - w / 2, S, w, c[1]); break; }
    case 'houndstooth':
      // 2/2 twill with 4 dark and 4 light threads in both warp and weft: the cell shows the warp on two of every four
      woven(t, 8, 8, c[1], (i, j) => ((i + j) % 4 < 2 ? i < 4 : j < 4));
      break;
    case 'herringbone':
      // dark warp, light weft, 2/2 twill that reverses every 8 threads
      woven(t, 16, 16, c[1], (i, j) => (((i < 8 ? j + i : j - i) % 4) + 4) % 4 < 2);
      break;
    case 'chevron': {
      const band = (y0: number, d: number, th: number) =>
        t.path(`M0 ${f(y0)}L${f(S / 2)} ${f(y0 + d)}L${f(S)} ${f(y0)}L${f(S)} ${f(y0 + th)}L${f(S / 2)} ${f(y0 + d + th)}L0 ${f(y0 + th)}Z`, c[1]);
      band(0.1 * S, 0.2 * S, 0.12 * S);
      break;
    }
    case 'polka': t.circle(0.25 * S, 0.25 * S, 0.16 * S, c[1]); t.circle(0.75 * S, 0.75 * S, 0.16 * S, c[1]); break;
    case 'pindot': t.circle(0.25 * S, 0.25 * S, 0.05 * S, c[1]); t.circle(0.75 * S, 0.75 * S, 0.05 * S, c[1]); break;
    case 'geo': {
      const dia = (cx: number, cy: number, r: number, fill: string) =>
        t.wrap(cx - r, cy - r, cx + r, cy + r, (ox, oy) => t.path(`M${f(cx + ox)} ${f(cy - r + oy)}L${f(cx + r + ox)} ${f(cy + oy)}L${f(cx + ox)} ${f(cy + r + oy)}L${f(cx - r + ox)} ${f(cy + oy)}Z`, fill));
      for (const [x, y] of [[0.5, 0.5], [0, 0]] as Pt[]) { dia(x * S, y * S, 0.3 * S, c[1]); dia(x * S, y * S, 0.13 * S, c[2]); }
      break;
    }
    case 'jacquard': {
      const cx = 0.5 * S, cy = 0.5 * S, r = 0.11 * S;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) t.circle(cx + dx * r, cy + dy * r, r, c[1]);
      t.path(`M${f(cx)} ${f(cy - 0.3 * S)}L${f(cx + 0.3 * S)} ${f(cy)}L${f(cx)} ${f(cy + 0.3 * S)}L${f(cx - 0.3 * S)} ${f(cy)}Z`, c[1], 0.55);
      t.circle(cx, cy, 0.05 * S, c[2]);
      const s = 0.08 * S;
      t.wrap(-s, -s, s, s, (ox, oy) => t.path(`M${f(ox)} ${f(-s + oy)}L${f(s + ox)} ${f(oy)}L${f(ox)} ${f(s + oy)}L${f(-s + ox)} ${f(oy)}Z`, c[2]));
      break;
    }
    case 'camo': {
      // four tones: big ground blobs, then smaller and darker layers on top
      const layers: [string, number, number][] = [[c[1], 9, 0.17], [c[2], 8, 0.13], [c[3], 8, 0.09]];
      for (const [col, n, r] of layers) {
        for (const [x, y] of scatter(n, r * 1.3, rnd)) wblob(t, blobPts(x * S, y * S, r * S, 9, 0.6, rnd, 1.2 + 0.6 * rnd(), rnd() * Math.PI), col);
      }
      break;
    }
    case 'floral': {
      for (const [x, y] of scatter(7, 0.3, rnd)) {
        const cx = x * S, cy = y * S, L = (0.09 + 0.04 * rnd()) * S, a0 = rnd() * Math.PI * 2;
        const R = L * 2.2;
        t.wrap(cx - R, cy - R, cx + R, cy + R, (ox, oy) => {
          // two leaves under the flower
          for (const k of [0.6, 3.6]) {
            const a = a0 + k;
            t.path(lens([cx, cy], [cx + Math.cos(a) * L * 2, cy + Math.sin(a) * L * 2], L * 0.45, ox, oy), c[3]);
          }
          for (let i = 0; i < 5; i++) {
            const a = a0 + (i / 5) * Math.PI * 2;
            t.path(lens([cx, cy], [cx + Math.cos(a) * L, cy + Math.sin(a) * L], L * 0.42, ox, oy), c[1]);
          }
          t.circle(cx + ox, cy + oy, L * 0.28, c[2]);
        });
      }
      break;
    }
    case 'paisley': {
      // generic teardrop (boteh) built in a local frame: round end at the origin, tail curling up and to one side
      const drop = (cx: number, cy: number, r: number, rot: number, ox: number, oy: number) => {
        const P = (x: number, y: number) => { const X = x * r, Y = y * r; return `${f(cx + X * Math.cos(rot) - Y * Math.sin(rot) + ox)} ${f(cy + X * Math.sin(rot) + Y * Math.cos(rot) + oy)}`; };
        return `M${P(-1, 0)}C${P(-1, 1.35)} ${P(1, 1.35)} ${P(1, 0)}C${P(1, -0.8)} ${P(0.3, -1.3)} ${P(0.9, -2.2)}C${P(-0.5, -1.9)} ${P(-1, -0.9)} ${P(-1, 0)}Z`;
      };
      for (const [x, y] of scatter(6, 0.36, rnd)) {
        const cx = x * S, cy = y * S, r = (0.07 + 0.02 * rnd()) * S, rot = rnd() * Math.PI * 2, R = r * 2.4;
        t.wrap(cx - R, cy - R, cx + R, cy + R, (ox, oy) => {
          t.path(drop(cx, cy, r, rot, ox, oy), c[1]);
          t.path(drop(cx, cy, r * 0.55, rot, ox, oy), c[2]);
          for (let k = 0; k < 3; k++) {
            const a = rot + Math.PI / 2 + (k - 1) * 0.55;
            t.circle(cx + Math.cos(a) * r * 1.45 + ox, cy + Math.sin(a) * r * 1.45 + oy, r * 0.14, c[3]);
          }
        });
      }
      break;
    }
    case 'animal': {
      for (const [x, y] of scatter(14, 0.2, rnd)) {
        const cx = x * S, cy = y * S, r = (0.045 + 0.03 * rnd()) * S;
        const outer = blobPts(cx, cy, r, 8, 0.45, rnd, 1.2, rnd() * Math.PI);
        if (rnd() < 0.65) {
          // rosette: broken ring with a lighter centre
          const inner = blobPts(cx, cy, r * 0.55, 7, 0.35, rnd, 1.1, rnd() * Math.PI);
          const [x0, y0, x1, y1] = bboxOf(outer);
          t.wrap(x0, y0, x1, y1, (ox, oy) => {
            t.path(smoothClosed(outer, ox, oy) + smoothClosed(inner, ox, oy), c[1], undefined, true);
            t.path(smoothClosed(inner, ox, oy), c[2], 0.85);
          });
        } else wblob(t, outer.map(([px, py]) => [cx + (px - cx) * 0.6, cy + (py - cy) * 0.6] as Pt), c[1]);
      }
      break;
    }
    case 'tie-dye': {
      // rings from the outside in, every copy of a ring before the next ring
      const rings = 7;
      for (let k = 0; k < rings; k++) {
        const r = (0.72 - k * 0.095) * S, col = k % 3 === 0 ? c[1] : k % 3 === 1 ? c[2] : c[0];
        wblob(t, blobPts(0.5 * S, 0.5 * S, r, 14, 0.18, rnd), col, k % 3 === 2 ? 0.8 : 0.75);
      }
      break;
    }
    case 'heather': {
      for (let k = 0; k < 150; k++) {
        const x = rnd() * S, y = rnd() * S, rx = (0.02 + 0.05 * rnd()) * S, ry = 0.006 * S, col = rnd() < 0.55 ? c[1] : c[2], o = 0.55 + 0.4 * rnd();
        t.wrap(x - rx, y - ry, x + rx, y + ry, (ox, oy) => t.ellipse(x + ox, y + oy, rx, ry, col, o));
      }
      break;
    }
  }
  const body = t.out.join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${f(S)}" height="${f(H)}" viewBox="0 0 ${f(S)} ${f(H)}">${body}</svg>`;
  return { size: [S, H], svg, body };
}

// ---------------------------------------------------------------- custom motif repeats

export interface MotifPlacement { x: number; y: number; rot: number; flip: boolean }

/**
 * Where the motif goes in one repeat of a layout. The cell is S x S; the tile is the smallest rectangle of whole
 * cells that repeats seamlessly: block 1 x 1, half-drop 2 x 1 (the odd column is dropped half a cell), brick 1 x 2
 * (the odd row is shifted half a cell), mirror 2 x 1 (the odd column is flipped), turn 2 x 2 (a chessboard of cells
 * turned 180 degrees), scatter 3 x 3 (seeded jitter and turn, same at every scale). rot is in degrees.
 */
export function motifPlacements(layout: RepeatLayout, S: number): { W: number; H: number; items: MotifPlacement[] } {
  const at = (cx: number, cy: number, rot = 0, flip = false): MotifPlacement => ({ x: cx * S, y: cy * S, rot, flip });
  switch (layout) {
    case 'half-drop': return { W: 2 * S, H: S, items: [at(0.5, 0.5), at(1.5, 1)] };
    case 'brick': return { W: S, H: 2 * S, items: [at(0.5, 0.5), at(1, 1.5)] };
    case 'mirror': return { W: 2 * S, H: S, items: [at(0.5, 0.5), at(1.5, 0.5, 0, true)] };
    case 'turn': return { W: 2 * S, H: 2 * S, items: [at(0.5, 0.5), at(1.5, 0.5, 180), at(0.5, 1.5, 180), at(1.5, 1.5)] };
    case 'scatter': {
      const rnd = rng(hash('custom-scatter'));
      const items: MotifPlacement[] = [];
      for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) items.push(at(i + 0.5 + (rnd() - 0.5) * 0.5, j + 0.5 + (rnd() - 0.5) * 0.5, Math.round(rnd() * 360)));
      return { W: 3 * S, H: 3 * S, items };
    }
    default: return { W: S, H: S, items: [at(0.5, 0.5)] };
  }
}

function customTile(p: FabricPattern): { size: [number, number]; svg: string; body: string } {
  const S = p.scale, layout = p.layout ?? 'block';
  const { W, H, items } = motifPlacements(layout, S);
  const out: string[] = [`<rect x="0" y="0" width="${f(W)}" height="${f(H)}" fill="${p.colors[0]}"/>`];
  const m = p.motif;
  const useImage = !!m?.image && !(m.paths?.length && p.recolor?.length);
  if (m && (useImage || m.paths?.length)) {
    const a = m.aspect, iw = a >= 1 ? 1 : a, ih = a >= 1 ? 1 / a : 1;
    const id = 'mt' + hash(useImage ? m.image! : JSON.stringify([m.paths, p.recolor])).toString(36);
    let def: string;
    if (useImage) def = `<image x="${f(-iw / 2)}" y="${f(-ih / 2)}" width="${f(iw)}" height="${f(ih)}" preserveAspectRatio="none" href="${m.image}"/>`;
    else def = m.paths!.map((q, i) => `<path d="${q.path}" fill="${p.recolor?.[i] ?? q.color}" fill-rule="evenodd"/>`).join('');
    out.push(`<defs><g id="${id}">${def}</g></defs>`);
    const sz = Math.min(1, Math.max(0.2, p.motifScale ?? 0.7)) * S;
    const r = (Math.hypot(iw, ih) / 2) * sz; // turn-proof radius of the motif
    for (const it of items) {
      for (const oy of [0, -H, H]) for (const ox of [0, -W, W]) {
        const x = it.x + ox, y = it.y + oy;
        if (x + r <= 0 || x - r >= W || y + r <= 0 || y - r >= H) continue;
        out.push(`<use href="#${id}" transform="translate(${f(x)} ${f(y)})${it.rot ? ` rotate(${f(it.rot)})` : ''} scale(${f(it.flip ? -sz : sz)} ${f(sz)})"/>`);
      }
    }
  }
  const body = out.join('');
  return { size: [W, H], svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${f(W)}" height="${f(H)}" viewBox="0 0 ${f(W)} ${f(H)}">${body}</svg>`, body };
}
