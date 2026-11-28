// Run: npx tsx tests/colours.ts  (part of npm test). The saved colours palette: storage, repeats, order, bad data.
import { addColour, cleanColours, loadColours, moveColour, removeColour, saveColours, SAVED_COLOURS_KEY } from '../src/lib/savedColours';

let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const fake = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

const s = fake();
ok(loadColours(s).length === 0, 'starts empty');
addColour('#FF0000', 'Brand red', s); addColour('#00ff00', undefined, s); addColour('#0000ff', '  ', s);
ok(loadColours(s).map((c) => c.hex).join() === '#ff0000,#00ff00,#0000ff', 'adds in order, lower case');
ok(loadColours(s)[0].name === 'Brand red' && loadColours(s)[1].name === undefined, 'optional name kept');
addColour('#ff0000', undefined, s);
ok(loadColours(s).length === 3 && loadColours(s)[0].name === 'Brand red', 'no repeats, name not lost');
addColour('nope', undefined, s); addColour('#12345', undefined, s);
ok(loadColours(s).length === 3, 'invalid colours are refused');
moveColour(2, 0, s);
ok(loadColours(s).map((c) => c.hex).join() === '#0000ff,#ff0000,#00ff00', 'reorder');
removeColour('#FF0000', s);
ok(loadColours(s).map((c) => c.hex).join() === '#0000ff,#00ff00', 'delete');
ok(JSON.parse(s.m.get(SAVED_COLOURS_KEY)!).length === 2, 'saved under techit.savedColours');
s.m.set(SAVED_COLOURS_KEY, '{not json');
ok(loadColours(s).length === 0, 'damaged storage falls back to empty');
s.m.set(SAVED_COLOURS_KEY, JSON.stringify([{ hex: '#abcdef' }, 7, null, '#123456', { hex: 'zzz' }, { hex: '#ABCDEF' }]));
ok(loadColours(s).map((c) => c.hex).join() === '#abcdef,#123456', 'bad entries dropped, plain strings accepted');
ok(cleanColours(Array.from({ length: 80 }, (_, i) => `#${(i * 777 + 100000).toString(16).padStart(6, '0')}`)).length === 48, 'capped at 48');
const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
ok(Array.isArray(loadColours(blocked)) && saveColours([{ hex: '#111111' }], blocked).length === 1, 'blocked storage does not throw');
if (fails) { console.error(`\n${fails} failed`); process.exit(1); }
console.log('\nall saved colour checks passed');
