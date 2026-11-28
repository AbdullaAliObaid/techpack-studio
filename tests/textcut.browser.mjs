// Run: npm run test:text  (needs `npx vite --port 5330` running; headless Chromium via playwright).
// Real fonts: B has 2 counters and 1 outer ring, o has 1 hole, the traced area of 'debayy' matches the canvas ink within
// 5%, and the 3D text painter (drawText) lands where the Design canvas SVG puts the same text.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
const URL = process.env.URL ?? 'http://localhost:5330/';
const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto(URL);
const res = await page.evaluate(async () => {
  const T = await import('/src/lib/textTrace.ts');
  const A = await import('/src/three/detailsArt.ts');
  const out = { fails: [], notes: [] };
  const ok = (c, m) => { if (!c) out.fails.push(m); else out.notes.push('ok ' + m); };
  const S = 160;
  const ink = (text, font) => { // ink area in em units squared, and the advance width
    const c = document.createElement('canvas'); const x = c.getContext('2d');
    x.font = A.fontOf({ font }, S); const mw = x.measureText(text).width;
    c.width = Math.ceil(mw) + S; c.height = S * 3; const g = c.getContext('2d');
    g.font = A.fontOf({ font }, S); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2);
    const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 3; i < d.length; i += 4) s += d[i] / 255;
    return { area: s / (S * S), mw: mw / S };
  };
  for (const font of [undefined, 'classic', 'varsity', 'script', 'block', 'mono']) {
    for (const text of ['B', 'o', 'debayy', 'BOB 88']) {
      const rings = T.traceTextUnit(text, font);
      const shapes = T.groupShapes(rings);
      const holes = shapes.reduce((n, s) => n + s.holes.length, 0);
      const i = ink(text, font);
      const traced = rings.reduce((s, r) => s + T.ringArea(r), 0) * i.mw; // unit x is in advance widths
      const err = Math.abs(traced / i.area - 1);
      ok(err < 0.05, `${font ?? 'default'} "${text}": traced area within 5% of ink (${(err * 100).toFixed(2)}%), ${shapes.length} outer, ${holes} holes`);
      if (text === 'B') ok(shapes.length === 1 && holes === 2, `${font ?? 'default'} B: 1 outer ring, 2 holes (${shapes.length}, ${holes})`);
      if (text === 'o') ok(shapes.length === 1 && holes === 1, `${font ?? 'default'} o: 1 hole (${shapes.length}, ${holes})`);
    }
  }
  // same place as the SVG of the Design canvas (textLength, central baseline): compare the ink boxes at 90 px per cm
  const W = 700, H = 260, k = 90, w = 6, h = 2;
  const inkBox = (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 127) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0: x0 / k, x1: x1 / k, y0: y0 / k, y1: y1 / k };
  };
  for (const font of [undefined, 'classic', 'script', 'block']) for (const text of ['debayy', 'BOB 88']) {
    const c1 = document.createElement('canvas'); c1.width = W; c1.height = H; const g = c1.getContext('2d');
    g.translate(W / 2, H / 2); g.scale(k, k); g.fillStyle = '#000'; A.drawText(g, { text, font }, h, w);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${-W / 2 / k} ${-H / 2 / k} ${W / k} ${H / k}"><text fontSize="${h}" font-size="${h}" textLength="${w}" lengthAdjust="spacingAndGlyphs" text-anchor="middle" dominant-baseline="central" fill="#000" style="font:${A.fontOf({ font }, h)}">${text}</text></svg>`;
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H; c2.getContext('2d').drawImage(img, 0, 0);
    const a1 = inkBox(c1), a2 = inkBox(c2);
    const dmax = Math.max(...Object.keys(a1).map((q) => Math.abs(a1[q] - a2[q])));
    out.notes.push(JSON.stringify([a1,a2].map(o=>Object.fromEntries(Object.entries(o).map(([q,v])=>[q,+v.toFixed(3)])))));
    ok(dmax < 0.06, `${font ?? "default"} "${text}": 3D text paints where the Design canvas does (max edge difference ${(dmax * 10).toFixed(2)} mm)`);
  }
  return out;
});
for (const n of res.notes) console.log(n);
for (const f of res.fails) console.error('FAIL', f);
await browser.close();
if (res.fails.length) process.exit(1);
