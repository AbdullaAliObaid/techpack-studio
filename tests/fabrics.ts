// Run: npx tsx tests/fabrics.ts
// Fabric library, procedural patterns (valid, seamless, small), photo tracing and total symmetry.
import { FABRICS, FABRIC_CATEGORIES, WEAVE_BASE, fabricById, fabricHex, colorName, type Weave } from '../src/data/fabrics';
import { PATTERNS, PATTERN_IDS, patternTile } from '../src/data/patterns';
import { pathRings } from '../src/lib/shapes';
import { prepareImage, removeBackground, posterize, traceToPaths, toLayers, traceGuidance, photoToLayers, type ImageLike } from '../src/lib/trace';
import { linkedMoves, applyMoves } from '../src/data/symmetry';
import { makePreset, type Piece } from '../src/data/presets';
import { outlineLength } from '../src/lib/geometry';
import { cutList, fabricInfo, seamReport } from '../src/lib/specs';
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
  pass(PATTERN_IDS.length === 24 && PATTERN_IDS.every((id) => PATTERNS[id].defaults.id === id && PATTERNS[id].defaults.colors.length === PATTERNS[id].colorsCount), `${PATTERN_IDS.length} patterns, defaults match their colour counts`);
  const SVG_RE = /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+" height="[\d.]+" viewBox="0 0 [\d.]+ [\d.]+">(<(rect|circle|ellipse|path) [^<>]*\/>)+<\/svg>$/;
  for (const id of PATTERN_IDS) {
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

console.log(fails ? `\n${fails} FAILED` : '\nall fabric checks passed');
process.exit(fails ? 1 : 0);
