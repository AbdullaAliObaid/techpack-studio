// Run: npx tsx tests/sampleTechpack.ts [out.pdf]   Writes a sample tech pack with stand-in photos (flat colour PNGs) to check the layout.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as Storage;
const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(w: number, h: number, f: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, c = f(x, y); raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2]; }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
async function main() {
  const { sampleProject } = await import('./share');
  const { buildTechPack } = await import('../src/lib/exportPdf');
  const p = sampleProject();
  const out = process.argv[2] ?? '/tmp/sample_techpack.pdf';
  const doc = await buildTechPack(p, 'cm', null, {
    capture: async (reqs) => reqs.map((r, i) => (r.kind === 'overview' ? png(200, 400, (x, y) => [225 - y / 8, 230 - x / 6, 240]) : png(480, 480, (x, y) => (Math.hypot(x - 240, y - 240) < 60 ? [200, 120, 60] : [70 + (i * 30) % 90 + x / 10, 90 + y / 12, 130])))),
  });
  writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
  console.log('wrote', out, doc.getNumberOfPages(), 'pages');
}
main();
