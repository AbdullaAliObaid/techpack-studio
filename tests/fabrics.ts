// Run: npx tsx tests/fabrics.ts
// Fabric library, procedural patterns (valid, seamless, small), photo tracing and total symmetry.
import { FABRICS, FABRIC_CATEGORIES, WEAVE_BASE, fabricById, fabricHex, colorName, type Weave } from '../src/data/fabrics';
import { PATTERNS, PATTERN_IDS, patternTile, withPatternDefaults, motifPlacements, REPEAT_LAYOUTS } from '../src/data/patterns';
import { detectRepeat, extractMotif, suggestLayout, encodePng } from '../src/lib/repeat';
import { FLEUR_PATHS } from './fixtures/fleur';
import { inflateSync } from 'node:zlib';
import type { FabricPattern, RepeatLayout } from '../src/data/fabrics';
import { pathRings } from '../src/lib/shapes';
import { prepareImage, removeBackground, posterize, traceToPaths, toLayers, traceGuidance, photoToLayers, type ImageLike } from '../src/lib/trace';
import { linkedMoves, applyMoves } from '../src/data/symmetry';
import { makePreset, type Piece } from '../src/data/presets';
import { outlineLength } from '../src/lib/geometry';
import { cutList, fabricBom, fabricInfo, seamReport } from '../src/lib/specs';
import { fabricThickness } from '../src/data/fabrics';
import { attachmentStack, stackOf } from '../src/data/stack';
import { useStore } from '../src/store';
import type { StyleId } from '../src/data/catalog';

let fails = 0;
const pass = (ok: boolean, name: string) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); };

// ---------------------------------------------------------------- fabrics
console.log('== fabric library ==');
{
  pass(FABRICS.length >= 40, `${FABRICS.length} fabrics`);
  pass(new Set(FABRICS.map((f) => f.id)).size === FABRICS.length, 'fabric ids are unique');
  // the original library keeps its ids, physics and first colours (old saves load and drape the same)
  const OLD: [string, number, number, number, number, string][] = [
    ['canvas', 0.03, 340, 1.0, 0.95, '#c8a978'], ['denim', 0.04, 400, 0.85, 0.9, '#2e3f66'], ['stretch-denim', 0.15, 340, 0.6, 0.88, '#2b3a5e'],
    ['poplin', 0.03, 120, 0.35, 0.8, '#f4f4f1'], ['linen', 0.02, 160, 0.4, 0.95, '#d9ccb2'], ['wool', 0.08, 280, 0.55, 1, '#4a4c52'],
    ['poly', 0.06, 150, 0.25, 0.45, '#1f2023'], ['jersey', 0.3, 180, 0.12, 0.9, '#f2f2f0'], ['rib', 0.6, 230, 0.15, 0.9, '#f2f2f0'],
    ['leather', 0.1, 900, 0.9, 0.55, '#1c1b1b'], ['spandex', 0.5, 220, 0.15, 0.5, '#1b1c20'],
  ];
  pass(OLD.every(([id, st, gsm, bend, rough, hex]) => { const f = FABRICS.find((q) => q.id === id); return !!f && f.stretch === st && f.gsm === gsm && f.bend === bend && f.roughness === rough && f.colors[0].hex === hex; }),
    'original 11 fabrics keep id, stretch, gsm, bend, roughness and colour 0');
  const OLD4: Record<string, string[]> = { denim: ['Indigo', 'Mid wash', 'Light wash', 'Black'], jersey: ['White', 'Heather grey', 'Black', 'Forest'], leather: ['Black', 'Brown', 'Tan', 'Oxblood'] };
  pass(Object.entries(OLD4).every(([id, names]) => names.every((n, i) => fabricById(id).colors[i].name === n)), 'saved colour indices still name the same colours');
  const badCards = FABRICS.filter((f) => f.colors.length < 8 || f.colors.length > 16 || new Set(f.colors.map((c) => c.name)).size !== f.colors.length || f.colors.some((c) => !/^#[0-9a-f]{6}$/.test(c.hex)));
  pass(!badCards.length, `every colour card has 8 to 16 uniquely named hex colours${badCards.length ? ': ' + badCards.map((f) => f.id).join(', ') : ''}`);
  pass(FABRICS.every((f) => FABRIC_CATEGORIES.some((c) => c.id === f.category)) && FABRIC_CATEGORIES.every((c) => FABRICS.some((f) => f.category === c.id)), 'every fabric in a category, no empty category');
  pass(FABRICS.every((f) => f.stretch > 0 && f.stretch < 1 && f.gsm >= 50 && f.gsm <= 1000 && f.bend > 0 && f.bend <= 1 && f.roughness > 0 && f.roughness <= 1 && (f.weave as Weave) in WEAVE_BASE), 'physical properties in range, every weave has a base texture');
  pass(fabricById('nope').id === 'canvas', 'unknown fabric id falls back to canvas');
  pass(fabricHex({ id: 'denim', color: 1 }) === '#5878a3' && fabricHex({ id: 'denim', color: 1, hex: '#AA0011' }) === '#aa0011' && fabricHex({ id: 'denim', color: 1, hex: 'red;}' }) === '#5878a3' && fabricHex({ id: 'denim', color: 99 }) === '#2e3f66',
    'fabricHex: custom hex wins, bad hex and bad index fall back');
  pass(colorName({ id: 'denim', color: 0, hex: '#2e3f66' }) === 'Indigo' && colorName({ id: 'denim', color: 0, hex: '#123456' }) === 'Custom #123456', 'colorName: card name for a matching hex, else Custom #hex');
}

// ---------------------------------------------------------------- patterns
console.log('\n== patterns ==');

type Shape = { fill: [number, number, number]; o: number; hit: (x: number, y: number) => boolean };
const rgbOf = (h: string): [number, number, number] => { const v = h.length === 4 ? h.slice(1).split('').map((c) => c + c).join('') : h.slice(1); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number]; };
/** Tiny rasteriser for the SVG subset patternTile emits (rect, circle, ellipse, path; fill, fill-opacity; even-odd). */
function parseSvg(svg: string): Shape[] {
  const out: Shape[] = [];
  for (const m of svg.matchAll(/<(rect|circle|ellipse|path) ([^>]*)\/>/g)) {
    const a: Record<string, string> = {};
    for (const q of m[2].matchAll(/([a-z-]+)="([^"]*)"/g)) a[q[1]] = q[2];
    const n = (k: string) => Number(a[k]);
    const fill = rgbOf(a.fill), o = a['fill-opacity'] ? Number(a['fill-opacity']) : 1;
    let hit: Shape['hit'];
    if (m[1] === 'rect') { const x = n('x'), y = n('y'), w = n('width'), h = n('height'); hit = (px, py) => px >= x && px <= x + w && py >= y && py <= y + h; }
    else if (m[1] === 'circle') { const cx = n('cx'), cy = n('cy'), r = n('r'); hit = (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r; }
    else if (m[1] === 'ellipse') { const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry'); hit = (px, py) => ((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2 <= 1; }
    else hit = ringsHit(pathRings(a.d, 24));
    out.push({ fill, o, hit });
  }
  return out;
}
function ringsHit(rings: { x: number; y: number }[][]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  return (px: number, py: number) => {
    if (px < x0 || px > x1 || py < y0 || py > y1) return false;
    let inside = false;
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[i], b = r[j];
      if ((a.y > py) !== (b.y > py) && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  };
}
const colourAt = (shapes: Shape[], x: number, y: number) => {
  let c = [0, 0, 0];
  for (const s of shapes) if (s.hit(x, y)) c = c.map((v, i) => v * (1 - s.o) + s.fill[i] * s.o);
  return c;
};
const differ = (a: number[], b: number[]) => a.some((v, i) => Math.abs(v - b[i]) > 6);

{
  pass(PATTERN_IDS.length === 26 && PATTERN_IDS.every((id) => PATTERNS[id].defaults.id === id && PATTERNS[id].defaults.colors.length === PATTERNS[id].colorsCount), `${PATTERN_IDS.length} patterns, defaults match their colour counts`);
  const SVG_RE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+" height="[\d.]+" viewBox="0 0 [\d.]+ [\d.]+">(<(rect|circle|ellipse|path) [^<>]*\/>)+<\/svg>$/;
  for (const id of PATTERN_IDS.filter((x) => x !== 'custom')) { // custom motifs are tested with the motif repeat code
    for (const variant of ['default', 'big custom'] as const) {
      const p = variant === 'default' ? PATTERNS[id].defaults : { ...PATTERNS[id].defaults, scale: 7.5, colors: ['#ffffff', '#000000', '#ff0000', '#00ff00'].slice(0, PATTERNS[id].colorsCount) };
      const t = patternTile(p);
      const [W, H] = t.size;
      const shapes = parseSvg(t.svg);
      const valid = SVG_RE.test(t.svg) && !/NaN|Infinity|undefined/.test(t.svg) && t.svg.length < 30000 && t.svg === patternTile(p).svg;
      // seamless: the colour just inside one edge equals the colour just inside the opposite edge
      const N = 240, e = 1e-5 * W;
      let miss = 0;
      for (let k = 0; k < N; k++) {
        const v = ((k + 0.5) / N);
        if (differ(colourAt(shapes, e, v * H), colourAt(shapes, W - e, v * H))) miss++;
        if (differ(colourAt(shapes, v * W, e), colourAt(shapes, v * W, H - e))) miss++;
      }
      const seen = new Set<string>();
      for (let i = 0; i < 48; i++) for (let j = 0; j < 48; j++) seen.add(colourAt(shapes, ((i + 0.37) / 48) * W, ((j + 0.61) / 48) * H).map(Math.round).join());
      const varied = id === 'solid' ? seen.size === 1 : seen.size >= 2;
      pass(valid && miss / (2 * N) < 0.03 && varied, `${id.padEnd(12)} ${variant.padEnd(10)} ${String(t.svg.length).padStart(5)} bytes, ${shapes.length} shapes, edge mismatch ${(100 * miss / (2 * N)).toFixed(1)}%, ${seen.size} colours`);
    }
  }
  const a = patternTile({ ...PATTERNS.floral.defaults, scale: 5 }), b = patternTile({ ...PATTERNS.floral.defaults, scale: 20 });
  pass(a.size[0] === 5 && b.size[0] === 20 && (a.svg.match(/</g) ?? []).length === (b.svg.match(/</g) ?? []).length, 'same layout at every scale, sized in cm');
  pass(!patternTile({ ...PATTERNS.polka.defaults, colors: ['"/><script>', '#fff'] }).svg.includes('script'), 'colours are sanitised before they reach the SVG');
  {
    // star stitch: two staggered five point stars per repeat, stars about 8% of the cloth (star area 1.23 R^2, twice)
    const st = patternTile(PATTERNS.star.defaults), [W, H] = st.size, sh = parseSvg(st.svg);
    const stars = (st.svg.match(/<path d="M[^"]*"/g) ?? []).filter((d) => (d.match(/L/g) ?? []).length === 9).length;
    let on = 0; const N = 80, ink = colourAt(sh, 0.25 * W, 0.25 * H).map(Math.round).join();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (colourAt(sh, ((i + 0.5) / N) * W, ((j + 0.5) / N) * H).map(Math.round).join() === ink) on++;
    const share = on / (N * N);
    pass(stars === 2 && share > 0.06 && share < 0.14 && ink !== colourAt(sh, 0.5 * W, 0.25 * H).map(Math.round).join(), `star stitch: ${stars} stars per ${W} cm repeat, stars cover ${(share * 100).toFixed(1)}%`);
    // on a whole piece, a rib band and a knit collar: the tech pack names it on each
    const pc = makePreset('polo');
    const starred = pc.map((q) => (['front', 'collar', 'placket'].includes(q.role) ? { ...q, fabric: { ...q.fabric, pattern: { ...PATTERNS.star.defaults } } } : q));
    const named = starred.filter((q) => q.fabric.pattern).every((q) => /Star stitch, 2\.4 cm repeat/.test(fabricInfo(q.fabric).pattern ?? ''));
    const tee = makePreset('basic-tee').map((q) => (q.role === 'neckband' ? { ...q, fabric: { ...q.fabric, pattern: { ...PATTERNS.star.defaults } } } : q));
    const nb = tee.find((q) => q.role === 'neckband')!;
    pass(named && /Star stitch/.test(fabricInfo(nb.fabric).pattern ?? '') && cutList(tee).some((r) => r.name === nb.name && /Star stitch/.test(r.detail ?? '')), 'star stitch on a front, knit collar, placket and rib neckband: named in the tech pack fabric');
  }
}

// ---------------------------------------------------------------- trace
console.log('\n== photo to design ==');
const img = (w: number, h: number, px: (x: number, y: number) => [number, number, number, number?]): ImageLike => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a = 255] = px(x + 0.5, y + 0.5); data.set([r, g, b, a], (y * w + x) * 4); }
  return { width: w, height: h, data };
};
/** filled area of an SVG path in the unit box, by sampling (even-odd) */
const pathArea = (d: string) => {
  const hit = ringsHit(pathRings(d, 16));
  let n = 0; const N = 300;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (hit(-0.5 + (i + 0.5) / N, -0.5 + (j + 0.5) / N)) n++;
  return n / (N * N);
};
{
  const W = 200, H = 160, R = 60;
  const circle = img(W, H, (x, y) => ((x - 100) ** 2 + (y - 80) ** 2 <= R * R ? [220, 30, 40] : [255, 255, 255]));
  const fg = removeBackground(circle, 20);
  const post = posterize(fg, 4);
  const paths = traceToPaths(post.index, W, H, post.palette);
  const want = (Math.PI * R * R) / (W * W);
  const got = paths[0] ? pathArea(paths[0].path) : 0;
  pass(post.palette.length === 1 && paths.length === 1, `red circle on white: background removed, ${post.palette.length} colour, ${paths.length} path`);
  pass(Math.abs(got - want) / want < 0.03 && Math.abs(paths[0].area - want) / want < 0.03, `circle area ${got.toFixed(4)} (reported ${paths[0]?.area.toFixed(4)}) vs ${want.toFixed(4)}`);
  const [r, g, b] = rgbOf(post.palette[0]);
  pass(Math.abs(r - 220) < 6 && g < 40 && b < 50, `palette colour ${post.palette[0]} is the red`);

  const two = img(240, 240, (x, y) => ((x - 70) ** 2 + (y - 120) ** 2 <= 50 * 50 ? [200, 20, 30] : x > 140 && x < 220 && y > 80 && y < 160 ? [20, 40, 200] : [250, 250, 250]));
  const p2 = posterize(removeBackground(two), 6);
  const t2 = traceToPaths(p2.index, 240, 240, p2.palette);
  pass(t2.length === 2 && t2.some((p) => rgbOf(p.color)[0] > 150) && t2.some((p) => rgbOf(p.color)[2] > 150), `two colours -> ${t2.length} paths (${t2.map((p) => p.color).join(', ')})`);
  const sq = t2.find((p) => rgbOf(p.color)[2] > 150);
  pass(!!sq && Math.abs(pathArea(sq.path) - (80 * 80) / (240 * 240)) / ((80 * 80) / (240 * 240)) < 0.03, `square area within 3% (${sq && pathArea(sq.path).toFixed(4)})`);

  const ring = img(200, 200, (x, y) => { const d = Math.hypot(x - 100, y - 100); return d <= 80 && d >= 45 ? [10, 10, 10] : [255, 255, 255]; });
  const pr = posterize(removeBackground(ring), 3);
  const tr = traceToPaths(pr.index, 200, 200, pr.palette);
  const wantR = (Math.PI * (80 * 80 - 45 * 45)) / (200 * 200);
  // the white middle does not touch the border, so it stays as its own (white) shape; the black ring keeps its hole
  const blk = tr.find((p) => rgbOf(p.color)[0] < 60);
  pass(!!blk && Math.abs(pathArea(blk.path) - wantR) / wantR < 0.03, `ring keeps its hole (even-odd), area ${blk && pathArea(blk.path).toFixed(4)} vs ${wantR.toFixed(4)}`);

  const big = prepareImage(img(2048, 1000, () => [10, 20, 30]), 1024);
  pass(big.width === 1024 && big.height === 500 && big.data[0] === 10 && big.data[3] === 255, `prepareImage 2048 x 1000 -> ${big.width} x ${big.height}`);
  const layers = toLayers(t2, { size: 8, kind: 'embroidery' });
  pass(layers.length === 2 && layers.every((l) => l.shape === 'path' && !!l.path && l.w === 8 && l.h === 8), 'toLayers: one path layer per colour, square box keeps proportions');
  pass(traceGuidance('embroidery', 12).ok && !traceGuidance('embroidery', 13).ok && traceGuidance('embroidery', 13).max === 12, 'embroidery guidance: up to 12 thread colours');
  const many = img(300, 40, (x) => { const k = Math.floor(x / 20); return [(k * 53) % 256, (k * 97) % 256, (k * 31 + 60) % 256]; });
  const pl = photoToLayers(many, { size: 10, kind: 'embroidery', colors: 20, removeBg: false });
  pass(pl.layers.length <= 12 && pl.palette.length <= 12, `photoToLayers caps embroidery at 12 colours (${pl.layers.length} layers)`);
}

// ---------------------------------------------------------------- custom motif repeats
console.log('\n== custom motif repeats ==');
const LSHAPE = [{ color: '#ff0000', path: 'M-0.4 -0.4L-0.1 -0.4L-0.1 0.1L0.4 0.1L0.4 0.4L-0.4 0.4Z' }, { color: '#0000ff', path: 'M0.1 -0.4L0.3 -0.4L0.3 -0.2L0.1 -0.2Z' }];
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const customP = (layout: RepeatLayout, extra: Partial<FabricPattern> = {}): FabricPattern =>
  ({ id: 'custom', colors: ['#ffffff'], scale: 6, rotation: 0, method: 'printed', layout, motif: { paths: LSHAPE, aspect: 1 }, motifScale: 0.7, ...extra });
/** colour of a custom tile at a point: ground, then every <use> in order, with translate / rotate / scale applied */
function customColour(svg: string, x: number, y: number): number[] {
  const ground = rgbOf(/<rect [^>]*fill="(#[0-9a-f]+)"/.exec(svg)![1]);
  const defs = new Map<string, { hit: (x: number, y: number) => boolean; fill: number[] }[]>();
  for (const g of svg.matchAll(/<g id="([^"]+)">(.*?)<\/g>/g)) {
    defs.set(g[1], [...g[2].matchAll(/<path d="([^"]*)" fill="(#[0-9a-f]+)"/g)].map((q) => ({ hit: ringsHit(pathRings(q[1], 24)), fill: rgbOf(q[2]) })));
  }
  let c = ground;
  for (const u of svg.matchAll(/<use href="#([^"]+)" transform="translate\(([-\d.]+) ([-\d.]+)\)(?: rotate\(([-\d.]+)\))? scale\(([-\d.]+) ([-\d.]+)\)"\/>/g)) {
    const [tx, ty, rot, sx, sy] = [u[2], u[3], u[4] ?? '0', u[5], u[6]].map(Number);
    const a = (rot * Math.PI) / 180, dx = x - tx, dy = y - ty;
    const qx = (dx * Math.cos(a) + dy * Math.sin(a)) / sx, qy = (-dx * Math.sin(a) + dy * Math.cos(a)) / sy;
    for (const s of defs.get(u[1]) ?? []) if (s.hit(qx, qy)) c = s.fill;
  }
  return c;
}
{
  const S = 6;
  const sizes: Record<RepeatLayout, [number, number]> = { block: [S, S], 'half-drop': [2 * S, S], brick: [S, 2 * S], mirror: [2 * S, S], turn: [2 * S, 2 * S], scatter: [3 * S, 3 * S] };
  for (const layout of REPEAT_LAYOUTS) {
    for (const ms of [0.7, 1]) {
      const p = customP(layout, { motifScale: ms });
      const t = patternTile(p), [W, H] = t.size;
      const valid = /^<svg [^>]*viewBox="0 0 [\d.]+ [\d.]+">.*<\/svg>$/.test(t.svg) && !/NaN|Infinity|undefined|script/.test(t.svg) && t.svg === patternTile(p).svg && t.svg.length < 20000 && t.body === t.svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
      const sizeOk = W === sizes[layout][0] && H === sizes[layout][1];
      // seamless: the colour just inside one edge equals the colour just inside the opposite edge
      const N = 300, e = 1e-4;
      let miss = 0, ink = 0;
      for (let k = 0; k < N; k++) {
        const v = (k + 0.37) / N;
        if (differ(customColour(t.svg, e, v * H), customColour(t.svg, W - e, v * H))) miss++;
        if (differ(customColour(t.svg, v * W, e), customColour(t.svg, v * W, H - e))) miss++;
      }
      for (let i = 0; i < 40; i++) for (let j = 0; j < 40; j++) if (differ(customColour(t.svg, ((i + 0.5) / 40) * W, ((j + 0.5) / 40) * H), [255, 255, 255])) ink++;
      pass(valid && sizeOk && miss / (2 * N) < 0.02 && ink > 40, `${layout.padEnd(9)} motifScale ${ms}: ${W} x ${H} cm, ${t.svg.length} bytes, valid, edge mismatch ${(100 * miss / (2 * N)).toFixed(1)}%, ${ink} ink samples`);
    }
  }
  // each layout puts the neighbouring cells where it says (an L shape has no symmetry, so flips and turns show)
  const rel = (layout: RepeatLayout, map: (x: number, y: number) => [number, number], from: [number, number]) => {
    const t = patternTile(customP(layout));
    let bad = 0, n = 0;
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) {
      const x = from[0] * S + ((i + 0.31) / 30) * S, y = from[1] * S + ((j + 0.47) / 30) * S;
      const [qx, qy] = map(x, y);
      const a = customColour(t.svg, x, y), b = customColour(t.svg, ((qx % t.size[0]) + t.size[0]) % t.size[0], ((qy % t.size[1]) + t.size[1]) % t.size[1]);
      n++; if (differ(a, b)) bad++;
    }
    return bad / n;
  };
  pass(rel('half-drop', (x, y) => [x + S, y + S / 2], [0, 0]) < 0.01 && rel('half-drop', (x, y) => [x + S, y - S / 2], [0, 0]) < 0.01, 'half-drop: the next column is dropped half a cell');
  pass(rel('brick', (x, y) => [x + S / 2, y + S], [0, 0]) < 0.01, 'brick: the next row is shifted half a cell');
  pass(rel('mirror', (x, y) => [4 * S / 2 - x, y], [0, 0]) < 0.01, 'mirror: the next column is the left to right mirror image');
  pass(rel('turn', (x, y) => [2 * S - x, S - y], [0, 0]) < 0.01 && rel('turn', (x, y) => [x + S, y + S], [0, 0]) < 0.01, 'turn: neighbours are turned 180 degrees, diagonals are upright');
  const mp = motifPlacements('scatter', S);
  pass(mp.items.length === 9 && new Set(mp.items.map((i) => i.rot)).size >= 5 && JSON.stringify(motifPlacements('scatter', S)) === JSON.stringify(mp) && mp.items.every((i) => Math.abs(i.x / S - Math.round(i.x / S - 0.5) - 0.5) <= 0.26), 'scatter: 9 seeded placements, jittered, turned, the same every time');
  const mp2 = motifPlacements('scatter', 20);
  pass(mp2.items.every((i, k) => Math.abs(i.x / 20 - mp.items[k].x / S) < 1e-9 && i.rot === mp.items[k].rot), 'scatter layout is the same at every scale');

  // image motif: embedded once, placed with <use>
  const im = patternTile(customP('half-drop', { motif: { image: PNG1, aspect: 1.5 } }));
  pass((im.svg.match(/data:image/g) ?? []).length === 1 && (im.svg.match(/<use /g) ?? []).length >= 2 && /<image [^>]*width="1" height="0.667"/.test(im.svg) && im.svg === patternTile(customP('half-drop', { motif: { image: PNG1, aspect: 1.5 } })).svg, `image motif: embedded once, ${(im.svg.match(/<use /g) ?? []).length} placements, aspect kept`);
  // recolour and the choice between picture and vector
  const rc = patternTile(customP('block', { recolor: ['#00ff00'] }));
  pass(rc.svg.includes('#00ff00') && rc.svg.includes('#0000ff') && !rc.svg.includes('#ff0000'), 'recolor replaces vector motif colours in order');
  const both = { image: PNG1, paths: LSHAPE, aspect: 1 };
  pass(patternTile(customP('block', { motif: both })).svg.includes('<image') && !patternTile(customP('block', { motif: both, recolor: ['#123456'] })).svg.includes('<image'), 'picture is used unless the motif is recoloured, then the vector shapes');
  // safety and defaults
  const bad = patternTile(customP('block', { motif: { image: 'javascript:alert(1)', paths: [{ color: '"/><script>', path: 'M0 0L1 1Z' }, { color: '#ff0000', path: 'M0 0"/><script>' }], aspect: 1 } }));
  pass(!/script|javascript|<image|<use/.test(bad.svg), 'unsafe image, colour and path data never reach the SVG');
  const none = patternTile({ id: 'custom', colors: ['#ff8800'], scale: 6, rotation: 0 });
  pass(none.size[0] === 6 && none.size[1] === 6 && !none.svg.includes('<use') && none.svg.includes('#ff8800'), 'no motif yet: a plain ground tile');
  const wd = withPatternDefaults({ id: 'custom', layout: 'weird' as RepeatLayout, motifScale: 9, motif: { paths: LSHAPE, aspect: -3 } });
  pass(wd.layout === 'block' && wd.motifScale === 1 && wd.motif?.aspect === 1 && !('motif' in withPatternDefaults({ id: 'stripe', motif: { paths: LSHAPE, aspect: 1 } })), 'withPatternDefaults keeps and cleans the motif fields (custom only)');
  const fl = patternTile(customP('half-drop', { motif: { paths: FLEUR_PATHS, aspect: 1 }, colors: ['#f3ece0'], motifScale: 0.8 }));
  pass(fl.svg.length < 8000, `fleur de lis half-drop tile: ${fl.svg.length} bytes`);
}

// ---------------------------------------------------------------- repeat detection and motif extraction
console.log('\n== recognise and extract ==');
{
  const WHITE: [number, number, number] = [255, 255, 255], INK: [number, number, number] = [30, 40, 120];
  /** a plus sign with a dot in one corner (not symmetric) centred at (cx, cy) */
  const cross = (x: number, y: number, cx: number, cy: number) => {
    const dx = x - cx, dy = y - cy;
    return (Math.abs(dx) < 3 && Math.abs(dy) < 16) || (Math.abs(dy) < 3 && Math.abs(dx) < 16) || ((dx - 9) ** 2 + (dy + 9) ** 2 < 16);
  };
  const tiled = (W: number, H: number, pw: number, ph: number, shiftX = 0, shiftY = 0, motif = cross) => img(W, H, (x, y) => {
    const col = Math.floor(x / pw), row = Math.floor(y / ph);
    // odd columns dropped (shiftY) / odd rows shifted (shiftX)
    const xx = x - (row % 2 ? shiftX : 0), yy = y - (col % 2 ? shiftY : 0);
    const c = Math.floor(xx / pw), r = Math.floor(yy / ph);
    return motif(xx, yy, (c + 0.5) * pw, (r + 0.5) * ph) ? INK : WHITE;
  });
  const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;
  const d1 = detectRepeat(tiled(300, 300, 47, 61));
  pass(d1.found && near(d1.w, 47) && near(d1.h, 61) && d1.layout === 'block' && d1.confidence > 0.8, `tiled cross 47 x 61: found ${d1.w.toFixed(1)} x ${d1.h.toFixed(1)}, ${d1.layout}, confidence ${d1.confidence.toFixed(2)}`);
  const d2 = detectRepeat(tiled(1200, 800, 100, 80));
  pass(d2.found && near(d2.w, 100) && near(d2.h, 80), `large picture, cross 100 x 80: found ${d2.w.toFixed(1)} x ${d2.h.toFixed(1)}`);
  const d3 = detectRepeat(tiled(400, 400, 60, 60, 0, 30));
  pass(d3.found && d3.layout === 'half-drop' && near(d3.w, 60) && near(d3.h, 60) && near(d3.offset.y, 30) && d3.offset.x === 0, `half-drop crosses: ${d3.layout}, cell ${d3.w.toFixed(1)} x ${d3.h.toFixed(1)}, offset y ${d3.offset.y.toFixed(1)}`);
  const d4 = detectRepeat(tiled(500, 400, 70, 50, 35, 0));
  pass(d4.found && d4.layout === 'brick' && near(d4.w, 70) && near(d4.h, 50) && near(d4.offset.x, 35) && d4.offset.y === 0, `brick crosses: ${d4.layout}, cell ${d4.w.toFixed(1)} x ${d4.h.toFixed(1)}, offset x ${d4.offset.x.toFixed(1)}`);
  const single = img(300, 300, (x, y) => (cross(x, y, 150, 140) ? INK : WHITE));
  const d5 = detectRepeat(single);
  pass(!d5.found, `one drawing is not a repeat (confidence ${d5.confidence.toFixed(2)})`);
  pass(!detectRepeat(img(200, 200, () => [200, 200, 200])).found && !detectRepeat(img(8, 8, () => [0, 0, 0])).found, 'a flat picture and a tiny one are not repeats');
  const stripes = detectRepeat(img(300, 200, (x) => (Math.floor(x / 25) % 2 ? INK : WHITE)));
  pass(stripes.found && near(stripes.w, 50) && stripes.layout === 'block', `vertical stripes: period ${stripes.w.toFixed(1)}`);
  const t0 = performance.now();
  detectRepeat(tiled(1600, 1200, 90, 90));
  pass(performance.now() - t0 < 2500, `detectRepeat on a 1600 x 1200 picture takes ${(performance.now() - t0).toFixed(0)} ms`);

  // one drawing: background removed, cropped to the motif and its nearby part, a far speck is left out
  const draw = img(400, 300, (x, y) => {
    const ring = Math.hypot(x - 180, y - 140) <= 70 && Math.hypot(x - 180, y - 140) >= 40;
    const dot = Math.hypot(x - 270, y - 140) <= 12; // 20 px from the ring: close, belongs to it
    const speck = Math.hypot(x - 20, y - 20) <= 8; // far away
    return ring || dot ? [180, 40, 60] : speck ? [0, 0, 0] : [248, 246, 240];
  });
  const em = await extractMotif(draw);
  const b = em?.bounds;
  pass(!!em && !!b && near(b.x, 110, 3) && near(b.y, 70, 3) && near(b.w, 172, 4) && near(b.h, 140, 4), `single drawing: bounds ${b && [b.x, b.y, b.w, b.h].map((v) => Math.round(v)).join(', ')} (want 110, 70, 172, 140)`);
  pass(!!em && near(em.aspect, 172 / 140, 0.05) && em.background === '#f8f6f0' && em.pixels.data[3] === 0, `aspect ${em?.aspect.toFixed(2)}, background ${em?.background} removed, corner transparent`);
  pass(!!em?.paths?.length && em.paths[0].color.startsWith('#') && em.flat, `traced ${em?.paths?.length} path(s), flat artwork`);
  // the PNG is a real PNG: signature, chunk checks, pixels decode back
  const png = Buffer.from(em!.image.split(',')[1], 'base64');
  const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
  const idatAt = png.indexOf('IDAT'), idatLen = png.readUInt32BE(idatAt - 4);
  const rawPx = inflateSync(png.subarray(idatAt + 4, idatAt + 4 + idatLen));
  pass(em!.image.startsWith('data:image/png;base64,') && png.subarray(1, 4).toString() === 'PNG' && w === em!.width && h === em!.height && rawPx.length === (w * 4 + 1) * h && png.subarray(png.length - 8, png.length - 4).toString() === 'IEND', `PNG ${w} x ${h}, ${Math.round(png.length / 1024)} KB, decodes`);
  // sub filter undone gives back the pixels
  let okPx = true;
  for (let y = 0; y < h && okPx; y += 17) { let prev = [0, 0, 0, 0]; for (let x = 0; x < w; x++) { const cur = [0, 1, 2, 3].map((c) => (rawPx[y * (w * 4 + 1) + 1 + x * 4 + c] + prev[c]) & 255); prev = cur; if (cur[3] !== em!.pixels.data[(y * w + x) * 4 + 3]) { okPx = false; break; } } }
  pass(okPx, 'PNG alpha matches the extracted pixels');
  const big = await extractMotif(img(2400, 2000, (x, y) => (Math.hypot(x - 1200, y - 1000) < 900 ? [20, 90, 40] : [255, 255, 255])), { trace: false });
  pass(!!big && Math.max(big.width, big.height) === 1024, `large upload: motif capped at ${big?.width} x ${big?.height}`);
  pass((await extractMotif(img(100, 100, () => [255, 255, 255]))) === null, 'a blank picture has no motif');
  // a repeating upload: one whole cross from the middle
  const tl = tiled(300, 300, 47, 61);
  const er = await extractMotif(tl, { repeat: detectRepeat(tl), trace: false });
  pass(!!er && near(er.bounds.w, 33, 3) && near(er.bounds.h, 33, 3) && er.detectedTile !== undefined && near(er.detectedTile.w, 47), `repeat upload: one whole motif ${er && Math.round(er.bounds.w)} x ${er && Math.round(er.bounds.h)} px (want 33), tile ${er?.detectedTile?.w.toFixed(1)} x ${er?.detectedTile?.h.toFixed(1)}`);

  // layout suggestion
  const sq = (f: (x: number, y: number) => boolean) => ({ width: 80, height: 80, data: (() => { const d = new Uint8ClampedArray(80 * 80 * 4); for (let y = 0; y < 80; y++) for (let x = 0; x < 80; x++) if (f(x, y)) d.set([0, 0, 0, 255], (y * 80 + x) * 4); return d; })() });
  const fleurLike = sq((x, y) => Math.abs(x - 40) < 6 + (y < 40 ? (40 - y) * 0.05 : 0) || (y > 40 && y < 60 && Math.abs(x - 40) < 26 && Math.abs(x - 40) > 10));
  const lshape = sq((x, y) => (x < 20 && y < 70) || (y > 55 && y < 70 && x < 60));
  const fs = suggestLayout(fleurLike), ls = suggestLayout(lshape);
  pass(fs.layout === 'half-drop' && fs.symmetry.lr > 0.9 && ls.layout === 'block' && ls.symmetry.lr < 0.5, `fleur de lis like -> ${fs.layout} (lr ${fs.symmetry.lr}), L shape -> ${ls.layout} (lr ${ls.symmetry.lr})`);
  pass(suggestLayout(lshape, d3).layout === 'half-drop' && suggestLayout(lshape, d1).layout === 'block', 'a picture that already repeats keeps its own arrangement');
  const png2 = await encodePng({ width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]) });
  pass(png2.startsWith('data:image/png;base64,iVBORw0KGgo'), 'encodePng gives a PNG data URL');
}

// ---------------------------------------------------------------- total symmetry
console.log('\n== total symmetry ==');
const P = (pieces: Piece[], role: string) => pieces.find((p) => p.role === role)!;
const K = (p: Piece, key: string) => p.points.find((q) => q.key === key)!;
const len = (p: Piece, a: string, b: string) => outlineLength(p.points, K(p, a).id, K(p, b).id);
// rib trims keep their stretch ratio, every other seam keeps its difference (cap ease, pleats, exact match)
const seamDiffs = (style: StyleId, pieces: Piece[]) => seamReport(style, pieces).map((r) => [r.label, /rib/i.test(r.label) ? 10 * r.a / r.b : r.a - r.b] as const);
const sameSeams = (style: StyleId, a: Piece[], b: Piece[], tol = 0.05) => {
  const A = seamDiffs(style, a), B = seamDiffs(style, b);
  const bad = A.filter(([l, d], i) => Math.abs(d - B[i][1]) > tol).map(([l]) => l);
  return { ok: A.length === B.length && !bad.length, bad };
};
{
  for (const style of ['jeans', 'flared-jeans', 'sweatpants', 'shorts'] as StyleId[]) {
    const pieces = makePreset(style);
    const fr = P(pieces, 'front'), bk = P(pieces, 'back');
    const after = applyMoves(pieces, linkedMoves(style, pieces, fr.id, K(fr, 'front.5').id, 2, 0));
    const f2 = P(after, 'front'), b2 = P(after, 'back');
    const dx = (p: Piece, q: Piece, k: string) => K(q, k).x - K(p, k).x;
    pass(Math.abs(dx(fr, f2, 'front.5') - 2) < 1e-9 && Math.abs(dx(fr, f2, 'front.6') + 2) < 1e-9 && Math.abs(dx(bk, b2, 'back.5') - 2) < 1e-9 && Math.abs(dx(bk, b2, 'back.6') + 2) < 1e-9,
      `${style}: front hem +2 per side -> back hem +2 per side too (front / back difference kept, all four leg copies)`);
    const fIn = len(f2, 'front.6', 'front.8'), bIn = len(b2, 'back.6', 'back.8'), fOut = len(f2, 'front.1', 'front.5'), bOut = len(b2, 'back.1', 'back.5');
    const dIn0 = len(fr, 'front.6', 'front.8') - len(bk, 'back.6', 'back.8'), dOut0 = len(fr, 'front.1', 'front.5') - len(bk, 'back.1', 'back.5');
    pass(Math.abs(fIn - bIn - dIn0) < 0.02 && Math.abs(fOut - bOut - dOut0) < 0.02, `${style}: inseam ${fIn.toFixed(2)} / ${bIn.toFixed(2)}, outseam ${fOut.toFixed(2)} / ${bOut.toFixed(2)} still walk`);
    const s = sameSeams(style, pieces, after);
    pass(s.ok, `${style}: every seam keeps its match after the hem edit${s.bad.length ? ' (' + s.bad.join(', ') + ')' : ''}`);
    // lengthen from the back leg: the front follows
    const longer = applyMoves(pieces, linkedMoves(style, pieces, bk.id, K(bk, 'back.6').id, 0, 3));
    pass(Math.abs(K(P(longer, 'front'), 'front.6').y - K(fr, 'front.6').y - 3) < 1e-9 && sameSeams(style, pieces, longer).ok, `${style}: back leg 3 cm longer -> front leg too, seams walk`);
    // waist: the waistband follows
    const wide = applyMoves(pieces, linkedMoves(style, pieces, fr.id, K(fr, 'front.1').id, 1, 0));
    const ws = sameSeams(style, pieces, wide);
    pass(ws.ok, `${style}: waist side point +1 -> back and waistband follow${ws.bad.length ? ' (' + ws.bad.join(', ') + ')' : ''}`);
  }
  for (const style of ['basic-tee', 'boxy-tee', 'polo', 'button-up', 'jacket'] as StyleId[]) {
    const pieces = makePreset(style);
    const fr = P(pieces, 'front'), bk = P(pieces, 'back');
    const fo = style === 'polo' ? 2 : 0;
    const fk = (i: number, m = '') => `front.${i + fo}${m}`;
    const after = applyMoves(pieces, linkedMoves(style, pieces, fr.id, K(fr, fk(6)).id, -1.5, 0));
    const b2 = P(after, 'back');
    pass(Math.abs(K(b2, 'back.6').x - K(bk, 'back.6').x + 1.5) < 1e-9 && Math.abs(K(b2, 'back.6m').x - K(bk, 'back.6m').x - 1.5) < 1e-9, `${style}: front waist taken in 1.5 per side -> back follows on both sides`);
    pass(Math.abs(len(P(after, 'front'), fk(5), fk(7)) - len(b2, 'back.5', 'back.7')) < 0.02 && sameSeams(style, pieces, after).ok, `${style}: side seams still walk`);
    const ua = applyMoves(pieces, linkedMoves(style, pieces, fr.id, K(fr, fk(5)).id, 1, 0.5));
    const su = sameSeams(style, pieces, ua);
    pass(su.ok, `${style}: underarm moved -> back, sleeve cap (ease kept) follow${su.bad.length ? ' (' + su.bad.join(', ') + ')' : ''}`);
    const nk = applyMoves(pieces, linkedMoves(style, pieces, fr.id, K(fr, fk(2)).id, 0.8, 0));
    const sn = sameSeams(style, pieces, nk);
    pass(sn.ok, `${style}: neck widened at the shoulder -> back, collar or neckband follow${sn.bad.length ? ' (' + sn.bad.join(', ') + ')' : ''}`);
  }
  // the other direction: edits on the sleeve, cuff, collar, neckband or waistband walk the body
  for (const style of ['basic-tee', 'boxy-tee', 'polo', 'button-up', 'jacket'] as StyleId[]) {
    const pieces = makePreset(style);
    const sl = P(pieces, 'sleeve');
    const drags: [string, string, number, number][] = [
      ['sleeve cap up 1 cm', 'sleeve.0', 0, -1], ['sleeve cap 1 cm taller', 'sleeve.3', 0, 1], ['bicep out 1 cm', 'sleeve.3', 1, 0],
    ];
    for (const [what, key, dx, dy] of drags) {
      const after = applyMoves(pieces, linkedMoves(style, pieces, sl.id, K(sl, key).id, dx, dy));
      const sn = sameSeams(style, pieces, after, 0.1);
      const armhole0 = len(P(pieces, 'front'), 'front.' + (3 + (style === 'polo' ? 2 : 0)), 'front.' + (5 + (style === 'polo' ? 2 : 0)));
      const armhole1 = len(P(after, 'front'), 'front.' + (3 + (style === 'polo' ? 2 : 0)), 'front.' + (5 + (style === 'polo' ? 2 : 0)));
      pass(sn.ok, `${style}: ${what} -> armhole re-walks (front ${armhole0.toFixed(2)} -> ${armhole1.toFixed(2)}), cap ease and every seam kept${sn.bad.length ? ' (' + sn.bad.join(', ') + ')' : ''}`);
      pass(P(after, 'sleeve').points.every((q, i) => q.x === P(after, 'sleeve').points[i].x) && K(P(after, 'sleeve'), key).y === K(sl, key).y + dy, `${style}: ${what}, the sleeve keeps the point where it was dragged`);
    }
    if (style === 'button-up') {
      const cf = P(pieces, 'cuff');
      const c2 = applyMoves(pieces, linkedMoves(style, pieces, cf.id, K(cf, 'cuff.1').id, 0.7, 0));
      const sc = sameSeams(style, pieces, c2);
      pass(sc.ok && K(P(c2, 'sleeve'), 'sleeve.4').x > K(sl, 'sleeve.4').x + 0.5, `${style}: cuff 0.7 wider per side -> sleeve hem follows, seams walk${sc.bad.length ? ' (' + sc.bad.join(', ') + ')' : ''}`);
    }
    const co = pieces.find((p) => p.role === 'collar' || p.role === 'neckband');
    if (co) {
      const key = co.role === 'collar' ? 'collar.1' : 'neckband.1';
      const c2 = applyMoves(pieces, linkedMoves(style, pieces, co.id, K(co, key).id, 0.6, 0));
      const sc = sameSeams(style, pieces, c2);
      pass(sc.ok && Math.abs(K(P(c2, 'front'), `front.${2 + (style === 'polo' ? 2 : 0)}`).x - K(P(pieces, 'front'), `front.${2 + (style === 'polo' ? 2 : 0)}`).x) > 0.05, `${style}: ${co.role} lengthened -> neckline follows, seams walk${sc.bad.length ? ' (' + sc.bad.join(', ') + ')' : ''}`);
    }
  }
  for (const style of ['jeans', 'sweatpants'] as StyleId[]) {
    const pieces = makePreset(style);
    for (const role of ['waistband', 'cuff']) {
      const pc = pieces.find((p) => p.role === role);
      if (!pc) continue;
      const k = role === 'waistband' ? 'waistband.2' : 'cuff.1';
      let after = applyMoves(pieces, linkedMoves(style, pieces, pc.id, K(pc, k).id, 0.8, 0));
      // the spec row measures the band's other long edge: widen it by the same amount, as a two point drag does
      if (role === 'waistband') after = applyMoves(after, linkedMoves(style, after, pc.id, K(P(after, role), 'waistband.1').id, 0.8, 0));
      const sc = sameSeams(style, pieces, after);
      pass(sc.ok, `${style}: ${role} widened -> legs follow, seams walk${sc.bad.length ? ' (' + sc.bad.join(', ') + ')' : ''}`);
    }
  }
  // through the store
  const st = useStore.getState();
  st.newProject('jeans');
  st.setTotalSymmetry(true);
  const s0 = useStore.getState().project.pieces;
  const f0 = P(s0, 'front'), p5 = K(f0, 'front.5');
  useStore.getState().movePoint(f0.id, p5.id, p5.x + 1.5, p5.y);
  const s1 = useStore.getState().project.pieces;
  pass(Math.abs(K(P(s1, 'back'), 'back.5').x - K(P(s0, 'back'), 'back.5').x - 1.5) < 1e-9 && useStore.getState().symmetry, 'store: movePoint in total symmetry moves the back leg too');
  useStore.getState().setTotalSymmetry(false);
  const s2 = useStore.getState().project.pieces;
  useStore.getState().movePoint(P(s2, 'front').id, p5.id, K(P(s2, 'front'), 'front.5').x + 1, p5.y);
  pass(K(P(useStore.getState().project.pieces, 'back'), 'back.5').x === K(P(s2, 'back'), 'back.5').x, 'store: plain symmetry leaves the back leg alone');
}

// ---------------------------------------------------------------- specs
console.log('\n== specs ==');
{
  const pieces = makePreset('button-up');
  pieces[0].fabric = { id: 'oxford', color: 0, hex: '#123456', pattern: { ...PATTERNS.gingham.defaults, colors: ['#f3f2ee', '#2b3651'] } };
  const i = fabricInfo(pieces[0].fabric);
  pass(i.category === 'Shirting' && i.colour === 'Custom #123456' && i.hex === '#123456' && i.pattern === 'Gingham, 0.8 cm repeat, woven' && i.colourway === 'White / Navy', `fabric info: ${JSON.stringify(i)}`);
  const row = cutList(pieces)[0];
  pass(!!row.material?.includes('Oxford Cloth (Shirting)') && !!row.detail?.includes('Gingham') && row.fabric === 'Oxford Cloth', `cut list: ${row.material}`);
}

// ---------------------------------------------------------------- thickness and layer stacks
console.log('\n== thickness and layer stacks ==');
{
  const T = FABRICS.map((f) => [f.id, fabricThickness(f.id)] as const);
  pass(T.every(([, t]) => t >= 0.08 && t <= 3), `every fabric has a thickness 0.08..3 mm (${T.map(([i, t]) => `${i} ${t}`).join(', ')})`);
  const th = (id: string) => fabricThickness(id);
  pass(th('voile') < th('poplin') && th('poplin') < th('jersey') && th('jersey') < th('denim') && th('denim') < th('leather') && th('leather') < th('melton') && th('melton') < th('fleece'),
    'thickness order: voile < poplin < jersey < denim < leather < melton < fleece');
  const tee = makePreset('basic-tee');
  const front = tee.find((p) => p.role === 'front')!;
  const plain = stackOf(front);
  const leather = stackOf(front, { insideFabric: { [front.id]: { id: 'leather', color: 0 } } });
  const linen = stackOf(front, { insideFabric: { [front.id]: { id: 'linen', color: 0 } } });
  const same = stackOf(front, { insideFabric: { [front.id]: { id: front.fabric.id, color: 2 } } });
  pass(plain.plies.length === 1 && same.plies.length === 1 && plain.bend === fabricById('jersey').bend, 'no inside fabric (or the same cloth): one ply, the fabric as it is');
  pass(leather.gsm === 180 + 900 && Math.abs(leather.thickness - 1.7) < 1e-9 && leather.stretch === 0.1, `jersey + leather lining: ${leather.gsm} g/m2, ${leather.thickness} mm, stretch ${leather.stretch}`);
  pass(leather.bend > 5 * plain.bend && leather.bend > fabricById('leather').bend && leather.bend ** 2 > 0.81 + 0.0144, `leather lined bends as a laminate: ${leather.bend.toFixed(3)} (jersey ${plain.bend}, leather 0.9)`);
  pass(linen.bend > plain.bend && linen.bend < leather.bend && linen.gsm === 340 && linen.stretch === 0.02, `jersey + linen lining: lighter and less stiff than leather (bend ${linen.bend.toFixed(3)}, ${linen.gsm} g/m2)`);
  const pocket = { kind: 'pocket' as const, layers: [], fabric: { id: 'jersey', color: 0 } };
  const lp = attachmentStack({ ...pocket, lining: { id: 'leather', color: 0 } }, 'jersey'), up = attachmentStack(pocket, 'jersey');
  pass(lp.bend > 5 * up.bend && lp.thickness > up.thickness && lp.gsm > up.gsm, `pocket with a leather lining: bend ${lp.bend.toFixed(2)} vs ${up.bend}, ${lp.thickness} mm vs ${up.thickness} mm`);
  const puff = attachmentStack({ kind: 'patch', layers: [{ id: 'l', shape: 'rect', x: 0, y: 0, w: 4, h: 4, rotation: 0, color: '#fff', relief: 2 }] }, 'canvas');
  pass(puff.plies.length === 2 && puff.bend > fabricById('canvas').bend && puff.thickness > th('canvas'), `padded patch (2 mm relief): ${puff.plies.length} plies, ${puff.thickness} mm`);
  const ext = stackOf(front, { insideFabric: { [front.id]: { id: 'fleece', color: 0 } } });
  pass(ext.bend <= 3 && ext.gsm <= 2500 && ext.thickness <= 10, 'stacks are capped');
  const edits = { attachments: [{ id: 'pk', kind: 'pocket' as const, name: 'Pocket', pieceId: front.id, x: 10, y: 25, rotation: 0, w: 12, h: 14, outline: 'rect' as const, layers: [], fabric: { id: 'jersey', color: 0 }, lining: { id: 'leather', color: 0 } }],
    customSeams: [], detachedSeams: [], pleats: [], insideFabric: { [front.id]: { id: 'leather', color: 0 } } };
  const rows = cutList(tee, edits, 'basic-tee');
  const fr = rows.find((r) => r.name === front.name)!, pr = rows.find((r) => r.name === 'Pocket')!;
  pass(fr.stack === 'Cotton Jersey + Leather lining, 1.7 mm, 1080 g/m2' && fr.thickness === 1.7 && fr.gsm === 1080, `cut list stack: ${fr.stack}`);
  pass(!!pr?.stack?.includes('Leather lining') && !!pr.note?.includes('lined with Leather'), `cut list pocket: ${pr?.stack}; ${pr?.note}`);
  const bom = fabricBom(tee, edits, 'basic-tee');
  const shell = bom.find((r) => r.face === 'outside')!, lin = bom.find((r) => r.face === 'lining');
  pass(shell.thickness === 0.5 && shell.stacks.some((s) => s.startsWith(`${front.name}: Cotton Jersey + Leather lining, 1.7 mm`)) && !!lin && lin.fabric === 'Leather', `fabric BOM layers: ${shell.stacks.join('; ')} | lining row ${lin?.fabric}`);
}

// ---------------------------------------------------------------- pattern opacity, hidden and recoloured colours, match garment
console.log('== pattern colour tools ==');
{
  const fx = await import('../src/data/patternFx');
  const { patternEditsText } = await import('../src/data/patterns');
  const base: FabricPattern = withPatternDefaults({ id: 'stripe', colors: ['#f4f4f1', '#7e9cc8'], scale: 1, rotation: 0 });
  const plain = patternTile(base);
  pass(JSON.stringify(withPatternDefaults(JSON.parse(JSON.stringify(base)))) === JSON.stringify(base) && !('opacity' in base) && !('hidden' in base), 'defaults add no new fields, old patterns unchanged');
  pass(!plain.svg.includes('<g ') && plain.svg.includes('#7e9cc8'), 'untouched tile has no group and keeps its colour');
  const hid = patternTile(withPatternDefaults({ ...base, hidden: [1] }));
  pass(!hid.svg.includes('#7e9cc8') && hid.svg.split('#f4f4f1').length > 2, 'hidden colour is drawn as the base cloth colour');
  pass(withPatternDefaults({ ...base, hidden: [0, 1, 7] }).hidden?.join() === '1,7', 'the ground cannot be hidden');
  const rec = patternTile(withPatternDefaults({ ...base, colors: ['#f4f4f1', '#aa2200'] }));
  pass(rec.svg.includes('#aa2200') && !rec.svg.includes('#7e9cc8'), 'recolour maps the colour');
  const op = patternTile(withPatternDefaults({ ...base, opacity: 0.4 }));
  pass(op.svg.includes('<g opacity="0.4">') && op.body.startsWith('<rect') && op.body.indexOf('#f4f4f1') < op.body.indexOf('<g opacity'), 'opacity fades the print over the base colour');
  pass(withPatternDefaults({ ...base, opacity: 1 }).opacity === undefined, 'opacity 100% is stored as nothing');
  const off = patternTile(withPatternDefaults({ ...base, offsetX: 0.25 }));
  pass((off.svg.match(/translate/g) ?? []).length === 2 && off.size[0] === plain.size[0], 'offset wraps round and keeps the tile size');
  const tart = patternTile(withPatternDefaults({ id: 'tartan', colors: ['#1f2a44', '#2f4a3a', '#7a1f2b', '#e0c36a'], scale: 10, rotation: 0, hidden: [2, 3] }));
  pass(!tart.svg.includes('#7a1f2b') && !tart.svg.includes('#e0c36a') && tart.svg.includes('#2f4a3a'), 'several colours hide together');
  // custom vector motif
  const paths = [{ color: '#112233', path: 'M-0.4 -0.4L0.4 -0.4L0.4 0.4L-0.4 0.4Z' }, { color: '#cc3344', path: 'M-0.2 -0.2L0.2 -0.2L0.2 0.2L-0.2 0.2Z' }];
  const cust: FabricPattern = { id: 'custom', colors: ['#eeeeee'], scale: 6, rotation: 0, motif: { aspect: 1, paths }, layout: 'block', motifScale: 0.7 };
  pass(patternTile(withPatternDefaults({ ...cust, hidden: [1] })).svg.includes('fill="#eeeeee" fill-rule') && !patternTile(withPatternDefaults({ ...cust, hidden: [1] })).svg.includes('#cc3344'), 'hidden motif colour shows the base');
  pass(patternTile(withPatternDefaults({ ...cust, recolor: ['#00ff00', '#cc3344'] })).svg.includes('#00ff00'), 'recoloured motif colour');
  pass(patternEditsText({ ...base, opacity: 0.6, hidden: [1] }, (h) => h).includes('opacity 60%') && patternEditsText({ ...base, hidden: [1] }).includes('hidden #7e9cc8') && patternEditsText({ ...base, colors: ['#f4f4f1', '#aa2200'] }).includes('recoloured'), 'tech pack words list opacity, hidden and recoloured colours');
  const bom = fabricInfo({ id: 'cotton', color: 0, pattern: { ...base, opacity: 0.6, hidden: [1] } });
  pass(!!bom.adjust?.includes('opacity 60%') && !!bom.adjust.includes('hidden'), `BOM carries the adjustments: ${bom.adjust}`);

  // palette of a picture, hide and recolour on pixels
  const W = 8, px = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) { const left = i % W < 4; px.set(left ? [200, 30, 30, 255] : [20, 20, 160, 255], i * 4); }
  const bm = { w: W, h: W, data: px };
  const pal = fx.quantizePalette(bm, 8);
  pass(pal.length === 2, `picture palette has 2 colours: ${pal}`);
  const redIdx = pal.findIndex((c) => fx.toOklch(c)[2] < 60 || fx.toOklch(c)[2] > 300);
  const hidB = fx.applyColourEdits(bm, pal, [redIdx]);
  pass(hidB.data[3] === 0 && hidB.data[(W - 1) * 4 + 3] === 255, 'hiding a picture colour makes its pixels transparent');
  const recB = fx.applyColourEdits(bm, pal, [], pal.map((_, i) => (i === redIdx ? '#00ff00' : undefined)));
  pass(recB.data[1] > 200 && recB.data[0] < 40 && recB.data[(W - 1) * 4 + 2] > 100, 'recolouring a picture colour changes only its pixels');
  pass(fx.quantizePalette({ w: 4, h: 4, data: new Uint8ClampedArray(64) }, 8).length === 0, 'a clear picture has no colours');

  // match garment: darkest to darkest, lightest to lightest
  const cols = ['#f0e8d0', '#202840', '#7a8cb0'];
  const garment = ['#101820', '#e8d8c0', '#406080'];
  const m = fx.matchPalette(cols, garment);
  pass(m[1] === '#101820' && m[0] === '#e8d8c0' && m[2] === '#406080', `match garment maps darkest to darkest: ${m}`);
  pass(fx.matchPalette(['#222222', '#dddddd'], ['#336699']).length === 2 && fx.lightness(fx.matchPalette(['#222222', '#dddddd'], ['#336699'])[0]) < fx.lightness(fx.matchPalette(['#222222', '#dddddd'], ['#336699'])[1]), 'a one colour garment still keeps contrast');
  const cw = fx.colourways(cols, garment);
  pass(cw.length === 4 && cw.every((c) => c.colors.length === 3 && c.colors.every((h) => /^#[0-9a-f]{6}$/.test(h))) && cw.every((c) => fx.lightness(c.colors[1]) <= fx.lightness(c.colors[0])), 'four colourways keep the lightness order');
}

console.log(fails ? `\n${fails} FAILED` : '\nall fabric checks passed');
process.exit(fails ? 1 : 0);
