// Run: npx tsx tests/artwork.ts (part of npm test). One artwork, three methods: make, read back and convert in place.
import { artOf, canConvert, convertMethod, makeArtwork, methodAllows, type Art, type Method } from '../src/components/artworkMethod';
import type { Attachment } from '../src/data/edits';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const DEFAULT_OPTS = { ink: '#eb5757', thread: '#f2c94c', text: 'ABC' };
const layer = (shape: string, over: object = {}) => ({ id: Math.random().toString(36), shape, x: 0, y: 0, w: 4, h: 4, rotation: 0, color: '#000', ...over }) as Attachment['layers'][number];
const asAtt = (t: ReturnType<typeof makeArtwork>): Attachment => ({ ...t, id: 'a', pieceId: 'p', x: 3, y: 4 } as Attachment);

const arts: Art[] = [{ type: 'shape', shape: 'star' }, { type: 'text' }, { type: 'stripe' }, { type: 'shape', shape: 'heart' }];
const methods: Method[] = ['print', 'embroidery', 'applique'];
for (const art of arts) {
  for (const m of methods) {
    const a = asAtt(makeArtwork(art, m, DEFAULT_OPTS));
    ok(a.kind === m, `${art.type} made as ${m}`);
    const back = artOf(a);
    ok(!!back && back.type === art.type && (art.type !== 'shape' || (back.type === 'shape' && back.shape === art.shape)), `${art.type} as ${m} reads back as the same artwork`);
    for (const to of methods) {
      if (to === m) { ok(!canConvert(a, to), 'same method is not a conversion'); continue; }
      const patch = convertMethod(a, to, DEFAULT_OPTS);
      ok(!!patch && patch.kind === to, `${art.type} ${m} to ${to}`);
      if (!patch) continue;
      const b = { ...a, ...patch } as Attachment;
      const again = artOf(b);
      ok(!!again && again.type === art.type, `${art.type} keeps its artwork after ${m} to ${to}`);
      ok(b.x === 3 && b.y === 4 && b.w === a.w && b.h === a.h && b.pieceId === 'p', 'place and size kept');
    }
  }
}
ok(!methodAllows({ type: 'shape', shape: 'ring' }, 'applique') && methodAllows({ type: 'shape', shape: 'ring' }, 'print'), 'a ring cannot be cut from cloth');
// a photo print cannot become thread or cloth without tracing
{
  const photo = { ...asAtt(makeArtwork({ type: 'shape', shape: 'star' }, 'print', DEFAULT_OPTS)), layers: [layer('image', { image: 'data:image/png;base64,AA' })] } as Attachment;
  ok(!canConvert(photo, 'embroidery') && !canConvert(photo, 'applique'), 'a photo print stays a print');
}
// a layered print becomes embroidery by swapping only the kind (no data loss)
{
  const two = { ...asAtt(makeArtwork({ type: 'shape', shape: 'star' }, 'print', DEFAULT_OPTS)), layers: [layer('star'), layer('circle')] } as Attachment;
  const p = convertMethod(two, 'embroidery', DEFAULT_OPTS);
  ok(!!p && p.kind === 'embroidery' && p.layers === undefined && !canConvert(two, 'applique'), 'layered print to embroidery keeps its layers');
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('artwork tests passed');
