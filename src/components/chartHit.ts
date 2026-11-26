// Chart hit testing. One resolver decides what a click selects, in this order:
// handles of the selected design > designs and trims (small ones by nearest centre, big ones smallest first)
// > pleats > points > edges > pieces. Small items get a 22 px reach so a rivet is easy to hit, without blocking
// neighbours (the nearest centre wins). The same list drives the hover highlight and click-to-cycle.
import type { Attachment, Pleat } from '../data/edits';
import type { Piece } from '../data/presets';
import { nearestOnOutline, pointInPoly, type Pt } from '../lib/geometry';
import { pleatMarks } from './editHelpers';
import { attWorld, frameOn, onCopy, toWorldPt, type Entry } from './sides';
import { attsOnEntry, type Geo } from './chartLayout';

export type DS = { kind: string; piece?: string; inst?: string; att?: string; point?: string; handle?: string; pleat?: string };

export interface Cand {
  id: string;
  ds: DS;
  name: string;
  sub?: string;
  /** what to draw while hovering */
  hl:
    | { t: 'rect'; x: number; y: number; w: number; h: number; rot: number }
    | { t: 'ring'; x: number; y: number; r: number }
    | { t: 'piece'; key: string }
    | { t: 'edge'; key: string; seg: number }
    | { t: 'line'; a: Pt; b: Pt };
}

const REACH = 22; // px, minimum reach of a small design (44 pt touch target)
const rad = (d: number) => (d * Math.PI) / 180;

export function handlePositions(a: Attachment, pose: { x: number; y: number; rot: number }, k: number) {
  const px = (n: number) => n / k;
  const c = Math.cos(rad(pose.rot)), s = Math.sin(rad(pose.rot));
  const at = (lx: number, ly: number): Pt => ({ x: pose.x + c * lx - s * ly, y: pose.y + s * lx + c * ly });
  const gap = px(12);
  const rx = a.w / 2 + gap, ry = a.h / 2 + gap;
  const hy = -a.h / 2 - px(30);
  const hitR = (dx: number, dy: number) => Math.min(px(16), Math.max(px(8), Math.hypot(dx, dy) - px(12)));
  return { rotate: { p: at(0, hy), r: hitR(0, hy) }, resize: { p: at(rx, ry), r: hitR(rx, ry) } };
}

export function hitList(o: {
  w: Pt; k: number; entries: Entry[]; geos: Map<string, Geo>; atts: Attachment[]; pieces: Piece[]; pleats: Pleat[];
  selAttachment: string | null; selKey: string | null; tool: string;
}): Cand[] {
  const { w, k, entries, geos, atts, pieces, pleats, selAttachment, selKey } = o;
  const px = (n: number) => n / k;
  const out: { rank: number; sort: number; c: Cand }[] = [];
  const inst = (en: Entry) => String(en.inst);

  // 0. handles of the selected design
  if (selAttachment) {
    const a = atts.find((q) => q.id === selAttachment);
    if (a) {
      const root = (() => { let cur = a, n = 0; while (n++ < 6) { const p = atts.find((q) => q.id === cur.pieceId); if (!p) break; cur = p; } return cur.pieceId; })();
      for (const en of entries) {
        if (en.src.id !== root) continue;
        if (!attsOnEntry(atts, en).some((q) => q.id === a.id)) continue;
        const pose = attWorld(atts, a, en);
        const hp = handlePositions(a, pose, k);
        for (const [name, h] of [['rotate', hp.rotate], ['resize', hp.resize]] as const) {
          const d = Math.hypot(w.x - h.p.x, w.y - h.p.y);
          if (d <= h.r) out.push({ rank: 0, sort: d, c: { id: `h:${a.id}:${name}:${en.key}`, ds: { kind: 'handle', handle: name, att: a.id, piece: en.src.id, inst: inst(en) }, name: name === 'rotate' ? 'Turn' : 'Resize', hl: { t: 'ring', x: h.p.x, y: h.p.y, r: px(12) } } });
        }
      }
    }
  }

  for (const en of entries) {
    const g = geos.get(en.key);
    if (!g) continue;
    const local = { x: w.x - en.offset.x, y: w.y - en.offset.y };
    const slop = px(24);
    const nearBox = local.x > g.bb.minX - slop && local.x < g.bb.maxX + slop && local.y > g.bb.minY - slop && local.y < g.bb.maxY + slop;

    // 1. designs and trims
    for (const a of attsOnEntry(atts, en)) {
      const pose = attWorld(atts, a, en);
      const dx = w.x - pose.x, dy = w.y - pose.y;
      const c = Math.cos(rad(-pose.rot)), s = Math.sin(rad(-pose.rot));
      const lx = c * dx - s * dy, ly = s * dx + c * dy;
      const dc = Math.hypot(dx, dy) * k;
      const small = Math.max(a.w, a.h) * k < 40;
      const inRect = Math.abs(lx) <= a.w / 2 + px(3) && Math.abs(ly) <= a.h / 2 + px(3);
      const face = (a.face ?? 'outside') === 'inside' ? 'Inside' : undefined;
      const mk = (): Cand => ({
        id: `a:${a.id}:${en.key}`, ds: { kind: 'attach', att: a.id, piece: en.src.id, inst: inst(en) }, name: a.name, sub: [face, en.src.name].filter(Boolean).join(' · '),
        hl: small
          ? { t: 'ring', x: pose.x, y: pose.y, r: px(14) }
          : { t: 'rect', x: pose.x, y: pose.y, w: a.w, h: a.h, rot: pose.rot },
      });
      if (small) { if (dc <= REACH) out.push({ rank: 1, sort: dc, c: mk() }); }
      else if (inRect) out.push({ rank: 2, sort: a.w * a.h, c: mk() });
    }

    // patches drawn as separate pieces
    for (const gp of pieces) {
      if (gp.role !== 'custom' || gp.placement?.mode !== 'patch' || gp.placement.hostPieceId !== en.src.id) continue;
      if (!onCopy((gp.placement as { instance?: number }).instance, en)) continue;
      const pl = gp.placement;
      const fr = frameOn(en, { x: pl.x ?? 0, y: pl.y ?? 0, rotation: pl.rotation ?? 0 });
      const cx = en.offset.x + fr.x, cy = en.offset.y + fr.y;
      const dx = w.x - cx, dy = w.y - cy, c = Math.cos(rad(-fr.rotation)), s = Math.sin(rad(-fr.rotation));
      const q = { x: c * dx - s * dy, y: s * dx + c * dy };
      const xs = gp.points.map((p) => p.x), ys = gp.points.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      if (q.x >= minX && q.x <= maxX && q.y >= minY && q.y <= maxY && pointInPoly(gp.points, q)) {
        out.push({ rank: 2, sort: (maxX - minX) * (maxY - minY), c: { id: `g:${gp.id}:${en.key}`, ds: { kind: 'ghost', piece: gp.id, inst: inst(en) }, name: gp.name, sub: 'Patch', hl: { t: 'rect', x: cx, y: cy, w: maxX - minX, h: maxY - minY, rot: fr.rotation } } });
      }
    }

    if (!nearBox) continue;

    // 2. pleat lines
    for (const pl of pleats) {
      if (pl.pieceId !== en.src.id || !onCopy((pl as { instance?: number }).instance, en)) continue;
      const m = pleatMarks(pl, en.piece.points, g.bz, g.c);
      if (!m) continue;
      for (const l of m.lines) {
        const d = distSeg(local, l.a, l.b) * k;
        if (d <= 9) out.push({ rank: 3, sort: d, c: { id: `p:${pl.id}:${en.key}`, ds: { kind: 'pleat', pleat: pl.id, piece: en.src.id, inst: inst(en) }, name: 'Pleat', hl: { t: 'line', a: { x: en.offset.x + l.a.x, y: en.offset.y + l.a.y }, b: { x: en.offset.x + l.b.x, y: en.offset.y + l.b.y } } } });
      }
    }

    // 3. points
    const pr = en.key === selKey ? 16 : 10;
    for (const q of en.piece.points) {
      const d = Math.hypot(local.x - q.x, local.y - q.y) * k;
      if (d <= pr) out.push({ rank: 4, sort: d, c: { id: `pt:${q.id}:${en.key}`, ds: { kind: 'point', point: q.id, piece: en.src.id, inst: inst(en) }, name: 'Point', sub: en.src.name, hl: { t: 'ring', x: en.offset.x + q.x, y: en.offset.y + q.y, r: px(10) } } });
    }

    // 4. edges
    const near = nearestOnOutline(en.piece.points, local);
    if (near.d * k <= 9) out.push({ rank: 5, sort: near.d, c: { id: `e:${en.key}`, ds: { kind: 'edge', piece: en.src.id, inst: inst(en) }, name: `Edge of ${en.label}`, hl: { t: 'edge', key: en.key, seg: near.seg } } });
  }

  // 5. pieces, topmost first
  for (let i = entries.length - 1; i >= 0; i--) {
    const en = entries[i], g = geos.get(en.key);
    if (g && pointInPoly(g.poly, { x: w.x - en.offset.x, y: w.y - en.offset.y })) {
      out.push({ rank: 6, sort: entries.length - i, c: { id: `pc:${en.key}`, ds: { kind: 'piece', piece: en.src.id, inst: inst(en) }, name: en.label, sub: `Cut ${en.src.cut}`, hl: { t: 'piece', key: en.key } } });
    }
  }

  out.sort((a, b) => a.rank - b.rank || a.sort - b.sort);
  const seen = new Set<string>();
  return out.filter((r) => (seen.has(r.c.id) ? false : (seen.add(r.c.id), true))).map((r) => r.c);
}

function distSeg(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export { toWorldPt };
