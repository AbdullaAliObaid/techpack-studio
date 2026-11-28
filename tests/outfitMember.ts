// Run: npx tsx tests/outfitMember.ts   (resolving an outfit hit to its garment, src/lib/outfitMember.ts)
import { memberOfPiece, memberOfVertex } from '../src/lib/outfitMember';

let fails = 0;
const is = (ok: boolean, msg: string) => { if (!ok) fails++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };
const members = [{ projectId: 'jeans', start: 0, count: 100 }, { projectId: 'shirt', start: 100, count: 250 }, { projectId: 'cap', start: 350, count: 40 }];
is(memberOfVertex(members, 0) === 'jeans', 'first vertex is the first garment');
is(memberOfVertex(members, 99) === 'jeans', 'last vertex of a range');
is(memberOfVertex(members, 100) === 'shirt', 'first vertex of the next garment');
is(memberOfVertex(members, 389) === 'cap', 'last vertex of the last garment');
is(memberOfVertex(members, 390) === undefined, 'past the end is nobody');
is(memberOfVertex(undefined, 5) === undefined, 'no outfit, no member');
const owners = [{ projectId: 'jeans', ids: ['a', 'b'] }, { projectId: 'shirt', ids: ['c', 'att1'] }];
is(memberOfPiece('att1', owners) === 'shirt', 'an attachment id maps to its garment');
is(memberOfPiece('zzz', owners) === undefined, 'unknown piece');
if (fails) { console.log(`${fails} failed`); process.exit(1); }
