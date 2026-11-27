// Browser check of the outfit 3D path: jeans + basic tee in one outfit, both must drape (screenshot to $OUT).
// Needs puppeteer-core and Chrome (not dependencies of the app): run from a folder that has them, e.g.
//   cp tests/browser/outfit.mjs /home/claude/shots/ && cd /home/claude/shots && PORT=5297 node outfit.mjs
// against `npx vite --port 5297`. Prints the worker messages and how many frames were drawn.
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 1000 });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error' || m.text().startsWith('[outfit]')) errs.push(m.type() + ': ' + m.text()); });
await p.evaluateOnNewDocument(() => {
  const post = Worker.prototype.postMessage;
  window.__log = [];
  Worker.prototype.postMessage = function (m, t) {
    window.__log.push('to ' + m?.type + (m?.type === 'outfit' ? ' items=' + m.items.length + ' warm=' + m.warm : '') + ' @' + Math.round(performance.now()));
    if (!this.__hooked) { this.__hooked = true; this.addEventListener('message', (e) => { if (e.data?.type === 'status') window.__log.push('status ' + e.data.text); else if (e.data?.type === 'frame') { window.__frames = (window.__frames ?? 0) + 1; window.__last = e.data.sleeping; } else window.__log.push('from ' + e.data?.type + (e.data?.garments ? ' garments=' + e.data.garments.length : '') + (e.data?.n ? ' n=' + e.data.n : '') + ' @' + Math.round(performance.now())); }); this.addEventListener('error', (e) => window.__log.push('worker error ' + e.message)); }
    return post.call(this, m, t);
  };
});
await p.goto('http://localhost:' + (process.env.PORT ?? 5297) + '/?nosplash&screen=editor', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 5000));
const r = await p.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => /\/src\/store\.ts/.test(n));
  const { useStore } = await import(url);
  const projects = await import('/src/lib/projects.ts');
  const S = () => useStore.getState();
  S().createProject({ style: 'jeans', name: 'Jeans', fit: 'regular', sex: 'male' });
  const jeans = S().project; projects.saveProject(jeans);
  S().createProject({ style: 'basic-tee', name: 'Tee', fit: 'regular', sex: 'male' });
  const tee = S().project; projects.saveProject(tee);
  S().newOutfit('Test fit', jeans.body);
  S().addToOutfit(jeans.id); S().addToOutfit(tee.id); S().setTuck(tee.id, 'out');
  S().setScreen('editor');
  return { items: S().outfit?.items.length };
});
console.log(JSON.stringify(r));
await new Promise((r) => setTimeout(r, Number(process.env.WAIT ?? 60000)));
await p.screenshot({ path: '' + (process.env.OUT ?? '/tmp/hatprobe/outfit_3d.png') + '', clip: { x: 640, y: 90, width: 640, height: 900 } });
console.log((await p.evaluate(() => window.__log)).join('\n'));
console.log('frames', await p.evaluate(() => [window.__frames, window.__last]));
console.log('errors:', errs.slice(0, 4).join('\n') || 'none');
await b.close();
