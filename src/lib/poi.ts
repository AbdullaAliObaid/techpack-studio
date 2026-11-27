// Points of interest: every spot on the garment the tech pack gives its own close-up page. One list, used by the PDF
// (src/lib/exportPdf.ts) and by the Review workspace (include / exclude each one, Edits.techpackSkip).
//
// Grouping: built-in hardware is grouped sensibly (the fly zip is one page, the rivets of one pocket are one page, all
// belt loops of a waistband are one page); everything the user adds gets a page of its own.

import type { Project } from '../store';
import type { Attachment, Band } from '../data/edits';
import type { Piece } from '../data/presets';
import { bandRanges } from '../components/designDoc';
import { patternTile, PATTERNS, colorName, patternLabel, withPatternDefaults, type FabricRef, type FabricPattern } from '../data/fabrics';
import { bbox, type Pt } from './geometry';
import { builtinSeams, faceOf } from '../sim/seams';
import { fabricText, pleatMarks, placementRefs, productionChecks, seamNear, trimDetails, type TrimDetail } from './specs';

export type PoiKind = 'fly' | 'hardware' | 'beltloops' | 'attachment' | 'inside' | 'lining' | 'band' | 'colourblock' | 'pattern' | 'pleat' | 'seam';
export type PoiView = 'front' | 'back' | 'side';
export interface PoiTarget { pieceId: string; instance: number; at: Pt; view: PoiView; face: 'outside' | 'inside' }

export interface Poi {
  id: string;
  kind: PoiKind;
  title: string;
  /** first (main) target; `targets` holds one more where two views are wanted (a band: front and back) */
  pieceId: string;
  instance: number;
  /** centre on the host piece (pattern cm) */
  at: Pt;
  radiusCm: number;
  face: 'outside' | 'inside';
  view: PoiView;
  targets: PoiTarget[];
  /** plain sentences printed under the photo: sizes, colours, warnings */
  callouts: string[];
  /** spec table rows: label and value */
  spec: [string, string][];
  /** marks on the flat pattern piece of the main target (pattern cm) */
  marks: { at: Pt; r: number }[];
  /** outlines on the main target's piece (pattern cm) */
  outlines: Pt[][];
  /** fabric ids involved, for production checks */
  fabricIds: string[];
  /** trim numbers (detail sheets) this page belongs to */
  trimNos: number[];
}

const KIND_ORDER: PoiKind[] = ['fly', 'hardware', 'beltloops', 'attachment', 'colourblock', 'band', 'inside', 'lining', 'pattern', 'pleat', 'seam'];
const LEATHER = new Set(['leather', 'suede']);
const r1 = (v: number) => Math.round(v * 10) / 10;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const viewOf = (p?: Piece): PoiView => (p?.role === 'back' ? 'back' : p?.role === 'sleeve' ? 'side' : 'front');
const sameFabric = (a?: FabricRef, b?: FabricRef) => !!a && !!b && a.id === b.id && a.color === b.color && (a.hex ?? '') === (b.hex ?? '') && JSON.stringify(a.pattern ?? null) === JSON.stringify(b.pattern ?? null);
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Where the pieces carrying a pattern sit, as plain words. */
const list = (xs: string[]) => [...new Set(xs)].join(', ');

export function pointsOfInterest(project: Pick<Project, 'garment' | 'pieces' | 'edits'>): Poi[] {
  const { pieces, edits, garment } = project;
  const out: Poi[] = [];
  const hostOf = (id: string) => pieces.find((q) => q.id === id);
  const trims = trimDetails(pieces, edits, garment);
  const trimOf = (id: string) => trims.find((t) => t.id === id);
  const add = (p: Omit<Poi, 'targets' | 'pieceId' | 'instance' | 'at' | 'view' | 'face' | 'marks' | 'outlines' | 'fabricIds' | 'trimNos' | 'spec' | 'callouts'> & Partial<Poi> & { target: PoiTarget }) => {
    const { target, ...rest } = p;
    out.push({ pieceId: target.pieceId, instance: target.instance, at: target.at, view: target.view, face: target.face, targets: [target], marks: [], outlines: [], fabricIds: [], trimNos: [], spec: [], callouts: [], ...rest });
  };
  /** the position rows every page carries: measured from the usual references and the nearest seam */
  const where = (host: Piece | undefined, at: Pt): [string, string][] => {
    const rows: [string, string][] = placementRefs(garment, host, at).map((r, i) => [i ? '' : 'Position', `${r.label} ${r.value} cm`]);
    const sn = host ? seamNear(garment, pieces, host, at, 12) : null;
    if (sn) rows.push(['Nearest seam', sn]);
    return rows;
  };
  const trimRows = (ts: TrimDetail[]): [string, string][] => {
    const t = ts[0];
    return [
      ['Item', ts.length > 1 ? `${t.item}, ${ts.length} items` : `${t.item}: ${t.name}`],
      ['Size', t.size],
      ['Material', [t.material, t.finish].filter(Boolean).join(', ')],
      ['Colour', t.colour],
      ...(t.thread && t.thread !== 'None' ? [['Thread', t.thread] as [string, string]] : []),
      ['Method', t.stitch.toLowerCase().includes(t.method.toLowerCase().replace(/\.$/, '')) ? t.stitch : `${t.method}. ${t.stitch}`],
      ['Quantity', `${ts.reduce((s, q) => s + q.qty, 0)} on the garment`],
      ...(t.layers.length ? [['Artwork', t.layers.slice(0, 4).map((l) => `${l.label} ${l.color}`).join('; ')] as [string, string]] : []),
    ];
  };

  const atts = edits?.attachments ?? [];
  const isLoop = (a: Attachment) => a.builtin && a.kind === 'strap' && /loop/i.test(a.name);

  // ---- 1. built-in hardware: fly, rivets per pocket, buttons, snaps, belt loops ----
  const clusters: Attachment[][] = [];
  const hw = atts.filter((a) => a.builtin && a.kind === 'hardware' && a.hardware && a.hardware.type !== 'zipper');
  for (const a of hw) {
    const key = (q: Attachment) => `${q.pieceId}|${q.instance ?? 0}|${q.buttonhole ? 'hole' : q.hardware!.type}`;
    const near = clusters.filter((c) => key(c[0]) === key(a) && c.some((q) => Math.hypot(q.x - a.x, q.y - a.y) < 18));
    if (near.length) { near[0].push(a); for (const extra of near.slice(1)) { near[0].push(...extra); clusters.splice(clusters.indexOf(extra), 1); } }
    else clusters.push([a]);
  }
  for (const a of atts.filter((q) => q.builtin && q.kind === 'hardware' && q.hardware?.type === 'zipper')) {
    const t = trimOf(a.id), host = hostOf(a.pieceId);
    if (!t || !host) continue;
    const mid = t.line ? { x: (t.line[0].x + t.line[1].x) / 2, y: (t.line[0].y + t.line[1].y) / 2 } : t.at;
    // the fly takes its rivets and tack with it: hardware within reach on the same piece joins this page
    add({
      id: `fly:${a.id}`, kind: 'fly', title: `${a.name}${/fly/i.test(a.name) ? '' : ', zip'}`, radiusCm: clamp(a.h * 0.6 + 4, 8, 22),
      target: { pieceId: a.pieceId, instance: a.instance ?? 0, at: mid, view: viewOf(host), face: 'outside' },
      spec: [...trimRows([t]), ...where(host, mid)], trimNos: [t.no], fabricIds: [host.fabric.id],
      callouts: [`${r1(a.h)} cm zip, ${t.colour}`, ...(t.note ? [t.note] : [])],
      marks: t.line ? [t.line[0], t.line[1]].map((q) => ({ at: q, r: 0.4 })) : [],
    });
  }
  for (const c of clusters) {
    const ts = c.map((a) => trimOf(a.id)).filter((t): t is TrimDetail => !!t);
    if (!ts.length) continue;
    const host = hostOf(c[0].pieceId);
    const pts = ts.flatMap((t) => t.points.map((q) => q.at));
    const bb = pts.length ? bbox(pts) : { minX: c[0].x, minY: c[0].y, w: 0, h: 0 };
    const at = { x: bb.minX + bb.w / 2, y: bb.minY + bb.h / 2 };
    const type = c[0].buttonhole ? 'buttonhole' : c[0].hardware!.type;
    const where1 = host?.name ?? '';
    add({
      id: `hw:${c[0].id}`, kind: 'hardware', title: `${cap(type)}s${where1 ? `, ${where1}` : ''} (${ts.reduce((s, t) => s + t.qty, 0)})`,
      radiusCm: clamp(Math.max(bb.w, bb.h) * 0.6 + 4, 4, 24), target: { pieceId: c[0].pieceId, instance: c[0].instance ?? 0, at, view: viewOf(host), face: faceOf(c[0]) },
      spec: [...trimRows(ts), ...where(host, at)], trimNos: ts.map((t) => t.no), fabricIds: host ? [host.fabric.id] : [],
      callouts: [`${ts.reduce((s, t) => s + t.points.length, 0)} per copy of the piece, ${ts[0].size}`, ...(ts[0].note ? [ts[0].note] : [])],
      marks: ts.flatMap((t) => t.points),
    });
  }
  // belt loops: one page per waistband and copy
  const loops = new Map<string, Attachment[]>();
  for (const a of atts.filter(isLoop)) loops.set(`${a.pieceId}|${a.instance ?? 0}`, [...(loops.get(`${a.pieceId}|${a.instance ?? 0}`) ?? []), a]);
  for (const [, ls] of loops) {
    const host = hostOf(ls[0].pieceId), ts = ls.map((a) => trimOf(a.id)).filter((t): t is TrimDetail => !!t);
    if (!ts.length || !host) continue;
    const bb = bbox(ls.map((a) => ({ x: a.x, y: a.y })));
    const at = { x: bb.minX + bb.w / 2, y: bb.minY + bb.h / 2 };
    const centre = ls.reduce((best, a) => (Math.abs(a.x - at.x) < Math.abs(best.x - at.x) ? a : best), ls[0]);
    add({
      id: `loops:${ls[0].id}`, kind: 'beltloops', title: `Belt loops (${ls.length})`, radiusCm: clamp(bb.w * 0.55 + 5, 10, 26),
      target: { pieceId: ls[0].pieceId, instance: ls[0].instance ?? 0, at: { x: centre.x, y: at.y }, view: viewOf(host), face: faceOf(ls[0]) },
      spec: [...trimRows(ts.slice(0, 1)).filter((r) => r[0] !== 'Quantity'), ['Quantity', `${ls.length} loops`], ['Spacing', ls.length > 1 ? `${r1(Math.abs(ls[1].x - ls[0].x))} cm apart along the waistband` : 'single'], ...where(host, { x: centre.x, y: centre.y })],
      trimNos: ts.map((t) => t.no), fabricIds: [host.fabric.id], callouts: [`${ls.length} loops, ${ts[0].size} each, bar tacked top and bottom`],
      marks: ls.map((a) => ({ at: { x: a.x, y: a.y }, r: 0.6 })), outlines: ts.flatMap((t) => t.outlines).slice(0, ls.length),
    });
  }

  // ---- 2. attachments (user made, and the style's pockets) and 4. colour blocks ----
  const blocks = new Map<string, Attachment[]>();
  for (const a of atts) {
    if (isLoop(a) || (a.builtin && a.kind === 'hardware')) continue;
    if (a.block) { blocks.set(a.name, [...(blocks.get(a.name) ?? []), a]); continue; }
    const t = trimOf(a.id), host = hostOf(a.pieceId);
    if (!t || !host) continue;
    let ext = Math.max(t.w, t.h);
    const pts = [...t.points.map((q) => q.at), ...(t.line ?? [])];
    if (pts.length) { const b = bbox(pts); ext = Math.max(b.w, b.h, ext) + 2; }
    const f = faceOf(a);
    add({
      id: `att:${a.id}`, kind: 'attachment', title: t.name, radiusCm: clamp(ext * 0.9 + 2.5, 4, 16),
      target: { pieceId: a.pieceId, instance: a.instance ?? 0, at: { x: a.x, y: a.y }, view: viewOf(host), face: f },
      spec: [...trimRows([t]), ['Side', `${t.side}, ${t.faceName.toLowerCase()}`], ...where(host, { x: a.x, y: a.y })], trimNos: [t.no],
      fabricIds: [a.fabric?.id ?? host.fabric.id, ...(a.lining ? [a.lining.id] : [])], callouts: [`${t.item}, ${t.size}`],
      marks: t.points, outlines: t.outlines,
    });
  }
  for (const [name, bs] of blocks) {
    const targets: PoiTarget[] = [];
    for (const a of bs) {
      const host = hostOf(a.pieceId);
      if (!host) continue;
      const view = viewOf(host);
      if (!targets.some((q) => q.view === view)) targets.push({ pieceId: a.pieceId, instance: a.instance ?? 0, at: { x: a.x, y: a.y }, view, face: 'outside' });
    }
    if (!targets.length) continue;
    const a0 = bs[0], host = hostOf(a0.pieceId)!;
    const colours = [...new Set(bs.flatMap((a) => a.layers.map((l) => l.color)))];
    add({
      id: `blk:${a0.id}`, kind: 'colourblock', title: name, radiusCm: clamp(Math.max(a0.w, a0.h) * 0.4 + 4, 8, 22), target: targets[0],
      spec: [['Colour block', name], ['Colours', colours.join(', ') || 'see artwork'], ['Size', `${r1(a0.w)} x ${r1(a0.h)} cm`], ['Method', a0.layers[0]?.opacity && a0.layers[0].opacity < 1 ? 'Printed ink' : 'Dyed or printed to the piece outline'],
        ['On', list(bs.map((a) => hostOf(a.pieceId)?.name ?? '')) ], ...where(host, { x: a0.x, y: a0.y })],
      callouts: [`Colour ${colours.join(' and ')}`], fabricIds: [host.fabric.id], outlines: trimOf(a0.id)?.outlines ?? [], trimNos: bs.flatMap((a) => trimOf(a.id)?.no ?? []),
    });
    out[out.length - 1].targets = targets.slice(0, 2);
  }

  // ---- 3. inside faces ----
  for (const [id, inner] of Object.entries(edits?.insideFabric ?? {})) {
    const pc = hostOf(id);
    if (!pc || sameFabric(inner, pc.fabric)) continue;
    const bb = bbox(pc.points);
    const at = { x: bb.minX + bb.w / 2, y: bb.minY + bb.h / 2 };
    add({
      id: `in:${id}`, kind: 'inside', title: `${pc.name}, inside`, radiusCm: clamp(Math.max(bb.w, bb.h) / 2 + 3, 6, 24),
      target: { pieceId: id, instance: 0, at, view: viewOf(pc), face: 'inside' },
      spec: [['Piece', `${pc.name}, cut ${pc.cut}`], ['Outside', fabricText(pc.fabric)], ['Inside', fabricText(inner)], ['Colour', `${colorName(inner)}`],
        ...(inner.pattern && inner.pattern.id !== 'solid' ? [['Pattern', patternLabel(withPatternDefaults(inner.pattern))] as [string, string]] : [])],
      callouts: [`Inside face is ${fabricText(inner)}; the outside is ${fabricText(pc.fabric)}`], fabricIds: [pc.fabric.id, inner.id],
    });
  }
  for (const a of atts) {
    if (!a.lining) continue;
    const t = trimOf(a.id), host = hostOf(a.pieceId);
    if (!t || !host) continue;
    const lin: FabricRef = { id: a.lining.id, color: a.lining.color, hex: a.lining.hex };
    add({
      id: `lin:${a.id}`, kind: 'lining', title: `${a.name}, lining`, radiusCm: clamp(Math.max(a.w, a.h) * 0.8 + 3, 5, 16),
      target: { pieceId: a.pieceId, instance: a.instance ?? 0, at: { x: a.x, y: a.y }, view: viewOf(host), face: 'inside' },
      spec: [['Item', `${t.item}: ${t.name}`], ['Outside cloth', t.fabric ?? 'Host fabric'], ['Lining', fabricText(lin)], ['Lining colour', colorName(lin)], ['Size', t.size], ...where(host, { x: a.x, y: a.y })],
      callouts: [`Lined with ${fabricText(lin)}, bagged inside`], fabricIds: [a.fabric?.id ?? host.fabric.id, a.lining.id], trimNos: [t.no], outlines: t.outlines,
    });
  }

  // ---- 4. bands ----
  for (const b of edits?.bands ?? []) {
    const targets: PoiTarget[] = [];
    let ys: number[] = [];
    for (const role of ['front', 'back']) {
      const pc = pieces.find((q) => q.role === role);
      const rng = pc ? bandRanges(b, pc) : null;
      if (!pc || !rng) continue;
      const y0 = rng[0].y0, y1 = rng[rng.length - 1].y1;
      targets.push({ pieceId: pc.id, instance: 0, at: { x: 0, y: (y0 + y1) / 2 }, view: role as PoiView, face: 'outside' });
      ys = [...ys, y0, y1];
    }
    if (!targets.length) continue;
    const total = b.stripes.reduce((s, q) => s + q.height, 0);
    const host = hostOf(targets[0].pieceId)!;
    add({
      id: `band:${b.id}`, kind: 'band', title: `Band, ${b.stripes.length} stripe${b.stripes.length === 1 ? '' : 's'}`, radiusCm: clamp(total * 1.2 + 8, 10, 24), target: targets[0],
      spec: [['Position', `${r1(b.offset)} cm ${b.from === 'shoulder' ? 'down from the high point shoulder' : 'up from the hem'} to the top edge`], ['Total height', `${r1(total)} cm`], ['Method', cap(b.method)],
        ['Tilt', b.angle ? `${r1(b.angle)} deg` : 'Level'], ['Crosses', list(pieces.filter((q) => bandRanges(b, q)).map((q) => q.name))],
        ...b.stripes.map((s, i): [string, string] => [`Stripe ${i + 1}`, `${r1(s.height)} cm, ${s.color}`])],
      callouts: b.stripes.map((s) => `${r1(s.height)} cm ${s.color}`), fabricIds: [host.fabric.id],
      outlines: [], marks: [],
    });
    out[out.length - 1].targets = targets;
    out[out.length - 1].callouts.push('Stripes line up at the side seams; front and back shown');
  }

  // ---- 5. patterned fabrics ----
  const pats = new Map<string, { p: FabricPattern; where: Piece[]; inside: boolean; label: string }>();
  const seePattern = (ref: FabricRef | undefined, pc: Piece | undefined, inside: boolean) => {
    if (!ref?.pattern || ref.pattern.id === 'solid' || !pc) return;
    const p = withPatternDefaults(ref.pattern);
    const key = `${p.id}|${p.scale}|${p.rotation}|${p.colors.join()}|${p.motif?.paths?.length ?? ''}${p.motif?.aspect ?? ''}`;
    const e = pats.get(key) ?? { p, where: [], inside: true, label: patternLabel(p) };
    e.where.push(pc);
    e.inside = e.inside && inside;
    pats.set(key, e);
  };
  for (const pc of pieces) { seePattern(pc.fabric, pc, false); seePattern(edits?.insideFabric?.[pc.id], pc, true); }
  for (const a of atts) seePattern(a.fabric, hostOf(a.pieceId), false);
  for (const [key, e] of pats) {
    const pc = e.where.reduce((m, q) => { const b = bbox(q.points), mb = bbox(m.points); return b.w * b.h > mb.w * mb.h ? q : m; }, e.where[0]);
    const bb = bbox(pc.points), tile = patternTile(e.p).size;
    const mkr = e.p.method ?? 'printed';
    add({
      id: `pat:${key}`, kind: 'pattern', title: `Pattern: ${e.p.id === 'custom' ? 'custom motif' : PATTERNS[e.p.id]?.name ?? e.p.id}`,
      radiusCm: clamp(Math.max(tile[0], tile[1]) * 2.5 + 2, 9, 26),
      target: { pieceId: pc.id, instance: 0, at: { x: bb.minX + bb.w / 2, y: bb.minY + bb.h * 0.45 }, view: viewOf(pc), face: e.inside ? 'inside' : 'outside' },
      spec: [['Pattern', e.label], ['Repeat size', `${r1(tile[0])} x ${r1(tile[1])} cm`], ['Rotation', `${Math.round(e.p.rotation)} deg to the grain`], ['Made', mkr === 'woven' ? 'Woven or knitted in, shows on both faces' : 'Printed on the face'],
        ['Colours', e.p.colors.join(', ')], ['Placed on', list(e.where.map((q) => q.name))], ['Matching', 'Match the repeat across the seams; start at centre front']],
      callouts: [`Repeat ${r1(tile[0])} x ${r1(tile[1])} cm, colours ${e.p.colors.join(', ')}`], fabricIds: [pc.fabric.id],
    });
  }

  // ---- 6. pleats, custom seams, detached seams ----
  for (const pl of edits?.pleats ?? []) {
    const pc = hostOf(pl.pieceId), m = pc ? pleatMarks(pc, pl) : null;
    if (!pc || !m) continue;
    const at = { x: (m.a.x + m.b.x) / 2, y: (m.a.y + m.b.y) / 2 + (m.n.y * pl.length) / 2 };
    add({
      id: `pl:${pl.id}`, kind: 'pleat', title: `${cap(pl.type)} pleat, ${pc.name}`, radiusCm: clamp(pl.length * 0.8 + pl.depth * 4 + 3, 7, 18),
      target: { pieceId: pc.id, instance: pl.instance ?? 0, at, view: viewOf(pc), face: 'outside' },
      spec: [['Type', `${cap(pl.type)} pleat`], ['Depth', `${r1(pl.depth)} cm per side`], ['Takes out of the edge', `${r1((pl.type === 'knife' ? 2 : 4) * pl.depth)} cm`], ['Fold length', `${r1(pl.length)} cm`], ...where(pc, at)],
      callouts: [`${cap(pl.type)} pleat, ${r1(pl.depth)} cm deep, ${r1(pl.length)} cm long`], fabricIds: [pc.fabric.id],
      marks: m.notches.map((q) => ({ at: q, r: 0.3 })),
    });
  }
  const mid = (pc: Piece, from: string, to: string): Pt | null => {
    const a = pc.points.find((q) => q.id === from), b = pc.points.find((q) => q.id === to);
    return a && b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
  };
  for (const cs of edits?.customSeams ?? []) {
    const pc = hostOf(cs.a.pieceId), at = pc ? mid(pc, cs.a.fromId, cs.a.toId) : null;
    if (!pc || !at) continue;
    const other = hostOf(cs.b.pieceId);
    add({
      id: `cs:${cs.id}`, kind: 'seam', title: `Added seam, ${pc.name}${other && other !== pc ? ` to ${other.name}` : ''}`, radiusCm: 9,
      target: { pieceId: pc.id, instance: cs.a.instance ?? 0, at, view: viewOf(pc), face: 'outside' },
      spec: [['Seam', `${pc.name} to ${other?.name ?? 'piece'}`], ['Stitch', 'Lockstitch 301 with overlock 504'], ['Allowance', '1 cm'], ['Sewn', cs.flip ? 'Second edge reversed' : 'Edges in the same direction'], ...where(pc, at)],
      callouts: ['Seam added to the standard construction'], fabricIds: [pc.fabric.id],
    });
  }
  for (const id of edits?.detachedSeams ?? []) {
    const bs = builtinSeams(garment, pieces, { collar: edits?.collar }).find((q) => q.id === id);
    const e = bs?.a[0], pc = e ? hostOf(e.pieceId) : undefined, at = pc && e ? mid(pc, e.fromId, e.toId) : null;
    if (!bs || !e || !pc || !at) continue;
    add({
      id: `ds:${id}`, kind: 'seam', title: `Left open: ${bs.label}`, radiusCm: 9,
      target: { pieceId: pc.id, instance: e.instance ?? 0, at, view: viewOf(pc), face: 'outside' },
      spec: [['Seam', bs.label], ['Instruction', 'Do not sew this seam. Finish the raw edges'], ...where(pc, at)],
      callouts: ['Left open on purpose'], fabricIds: [pc.fabric.id],
    });
  }

  // ---- 7. production checks go on the page they are about ----
  for (const c of productionChecks(pieces, edits)) {
    const hits = out.filter((o) => (c.id === 'leather-wash' ? o.fabricIds.some((f) => LEATHER.has(f)) : false));
    const target = hits.length ? hits : out.slice(0, 1);
    for (const o of target) o.callouts.push(`${c.resolved ? 'Production note' : 'TO CONFIRM'}: ${c.title}. ${c.resolved ? c.answer ?? '' : c.text}`.trim());
  }

  return out.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
}


/** The pages the PDF prints: every point of interest the designer has not switched off in the Review workspace. */
export function includedPois(project: Pick<Project, 'garment' | 'pieces' | 'edits'>): Poi[] {
  const skip = new Set(project.edits?.techpackSkip ?? []);
  return pointsOfInterest(project).filter((p) => !skip.has(p.id));
}

export const POI_KIND_LABEL: Record<PoiKind, string> = {
  fly: 'Fly and zip', hardware: 'Hardware', beltloops: 'Belt loops', attachment: 'Attachment', inside: 'Inside face', lining: 'Lining', band: 'Band', colourblock: 'Colour block', pattern: 'Pattern repeat', pleat: 'Pleat', seam: 'Seam',
};
