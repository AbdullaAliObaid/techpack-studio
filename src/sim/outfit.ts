// Outfits: several garment projects worn together (a tee tucked into jeans, a shirt over them, a jacket on top, a hat)
// assembled into ONE cloth simulation, so the garments touch and hold each other like real layers.
//
// How it works
//   1. every garment is assembled on its own by `assemble` (src/sim/setup.ts) with its own edits, fabrics and
//      attachments, on the outfit body and the same body collider
//   2. the particles, constraints and cloth layers of all of them are put end to end into one ClothSim; garment k
//      owns particles start..start+count and panels panelStart..panelStart+panelCount (OutfitGarment)
//   3. which garment lies over which comes from OutfitInput.layer (lower = closer to the skin) and, between a top and
//      bottoms, the tuck: 'in' puts the top under the bottoms (its hem inside the waistband), 'out' over them
//   4. garments start apart: an outer garment's start shape is pushed off the skin by one layer step per garment it
//      lies over (inner layers dress first, the outer ones go on over them)
//   5. every frame each outer garment point near an inner garment is bound to the inner triangle under it and kept
//      OUTFIT_GAP on its outer side, with friction (ClothSim.contactIdx). The push is shared by mass between the point
//      and the triangle, so both layers give way. Points of different garments also keep ClothSim.crossRadius apart
//      in the self collision hash. Garments that never come close (a hat) just coexist.

import type { Project } from '../store';
import { migrateGarment, styleById, type Category } from '../data/catalog';
import { EMPTY_EDITS } from '../data/edits';
import { bodyFrame, type Body } from '../three/body';
import { BodyCollider } from './collider';
import { ClothSim } from './cloth';
import { assemble, carryWithHead, contactCollider, displayPositions, warmStart, type BodyLike, type Garment3D, type PanelInst } from './setup';
import type { DetailsMsg } from './details';
import type { AttachDetailsMsg } from './detailsAttach';
import type { HardwareMsg } from './detailsHardware';

/** gap kept between two garments of an outfit (cm): about two fabric thicknesses */
export const OUTFIT_GAP = 0.3;
/** how far from a garment surface another garment's point is bound to it (cm) */
const REACH = 2.0;
/** start shape: each layer a garment lies over pushes it this much further off the skin (cm) */
const LAYER_STEP = 0.9;

export interface OutfitInput {
  project: Project;
  /** lower = closer to the skin (OutfitItem.layer) */
  layer: number;
  /** tops: tucked into the bottoms or worn out over them; unset = by layer */
  tuck?: 'in' | 'out';
}

/** One garment of an assembled outfit: where its particles and panels sit in the shared simulation. */
export interface OutfitGarment {
  projectId: string;
  style: string;
  category: Category;
  layer: number;
  tuck?: 'in' | 'out';
  /** particles start..start+count of the outfit sim */
  start: number;
  count: number;
  /** panels panelStart..panelStart+panelCount of Outfit3D.panels (and of the worker's groups / panels lists) */
  panelStart: number;
  panelCount: number;
  /** how many other garments this one lies over (0 = next to the skin) */
  rank: number;
  /** the garment assembled on its own (local particle indices); details and trims are built from it */
  own: Garment3D;
}

export interface Outfit3D extends Garment3D {
  garments: OutfitGarment[];
  /** ordered garment pairs [inner, outer] that touch each other */
  pairs: [number, number][];
  /** rebuild the layer contacts now (also runs at the start of every other frame) */
  rebind: () => void;
  /** let every garment go at once (a warm start: they are all sewn already) */
  release: () => void;
}

const TOP_ARM = new Set(['sleeve', 'cuff']);

/**
 * Is garment b worn over garment a? Between a top and bottoms the tuck decides ('in': the top is under), otherwise
 * the layer, then the order in the list.
 */
export function wornOver(a: { category: Category; layer: number; tuck?: 'in' | 'out'; index: number }, b: { category: Category; layer: number; tuck?: 'in' | 'out'; index: number }): boolean {
  if (a.category === 'tops' && b.category === 'bottoms' && a.tuck) return a.tuck === 'in';
  if (b.category === 'tops' && a.category === 'bottoms' && b.tuck) return b.tuck === 'out';
  if (a.layer !== b.layer) return b.layer > a.layer;
  return b.index > a.index;
}

/**
 * Assemble every garment of an outfit into one cloth simulation (see the top of this file). Returns null when no
 * garment could be assembled. Garments that fail to assemble are left out (they have no OutfitGarment entry).
 */
export function assembleOutfit(items: OutfitInput[], body: Body, collider?: ClothSim['collider'], spacing = 2.2): Outfit3D | null {
  const col = (collider ?? new BodyCollider(body)) as BodyLike;
  const built: { it: OutfitInput; G: Garment3D; category: Category; index: number }[] = [];
  items.forEach((it, index) => {
    const style = styleById(migrateGarment(it.project.garment));
    const G = assemble(it.project.garment, it.project.pieces, body, spacing, col as ClothSim['collider'], it.project.edits ?? EMPTY_EDITS);
    if (G) built.push({ it, G, category: style.category, index });
  });
  if (!built.length) return null;
  const info = built.map((b) => ({ category: b.category, layer: b.it.layer, tuck: b.category === 'tops' ? b.it.tuck : undefined, index: b.index }));
  // pairs that can touch: everything but headwear (a hat only meets the others through the self collision)
  const pairs: [number, number][] = [];
  for (let i = 0; i < built.length; i++) for (let j = 0; j < built.length; j++) {
    if (i === j || built[i].category === 'headwear' || built[j].category === 'headwear') continue;
    if (wornOver(info[i], info[j])) pairs.push([i, j]);
  }
  const rank = built.map((_, k) => pairs.filter(([, o]) => o === k).length);

  // ---- sizes and offsets ----
  let n = 0, nPanels = 0, nStretch = 0, nOther = 0, nAttachLayers = 0, nFoldLayers = 0;
  const starts: number[] = [], panelStarts: number[] = [];
  for (const { G } of built) {
    starts.push(n); panelStarts.push(nPanels);
    n += G.sim.n; nPanels += G.panels.length;
    nStretch += G.sim.nStretch; nOther += G.sim.ca.length - G.sim.nStretch;
    const nl = G.sim.layerIdx ? G.sim.layerIdx.length / 4 : 0, fl = Math.min(nl, G.foldLayers ?? nl);
    nAttachLayers += fl; nFoldLayers += nl - fl;
  }
  const params = built[0].G.sim.params;
  const sim = new ClothSim(n, [], [], [], { ...params });
  sim.substeps = built[0].G.sim.substeps;
  sim.ca = new Uint32Array(nStretch + nOther); sim.cb = new Uint32Array(nStretch + nOther);
  sim.rest = new Float32Array(nStretch + nOther); sim.comp = new Float32Array(nStretch + nOther);
  sim.maxStrain = new Float32Array(nStretch); sim.nStretch = nStretch;
  let ks = 0, ko = nStretch;
  const limits = new Float32Array(n), contact = new Uint8Array(n), panelOf = new Uint16Array(n), uv = new Float32Array(n * 2);
  const group = new Int32Array(n), nearSeam = new Uint8Array(n), garmentOf = new Uint8Array(n);
  const skipPanel = new Int32Array(n).fill(-1);
  let anySkip = false;
  const layerIdx = new Int32Array((nAttachLayers + nFoldLayers) * 4), layerW = new Float32Array((nAttachLayers + nFoldLayers) * 5);
  let la = 0, lf = nAttachLayers;
  const panels: PanelInst[] = [];
  const panelSign: number[] = [];
  const layerNear: NonNullable<Garment3D['layerNear']> = [];
  const seamLinks: Record<string, [number, number][]> = {};
  let selfRadius = 0, sewFrames = 0;
  built.forEach(({ G, it }, g) => {
    const o = starts[g], po = panelStarts[g], s = G.sim;
    sim.pos.set(s.pos, o * 3); sim.prev.set(s.prev, o * 3); sim.invMass.set(s.invMass, o);
    for (let c = 0; c < s.ca.length; c++) {
      const k = c < s.nStretch ? ks++ : ko++;
      sim.ca[k] = s.ca[c] + o; sim.cb[k] = s.cb[c] + o; sim.rest[k] = s.rest[c]; sim.comp[k] = s.comp[c];
      if (c < s.nStretch) sim.maxStrain[k] = s.maxStrain[c];
    }
    limits.set(G.limits, o);
    if (G.contact) contact.set(G.contact, o);
    for (let i = 0; i < s.n; i++) {
      panelOf[o + i] = (s.panelOf ? s.panelOf[i] : 0) + po;
      group[o + i] = (s.seamGroup ? s.seamGroup[i] : i) + o;
      if (s.skipPanel && s.skipPanel[i] >= 0) { skipPanel[o + i] = s.skipPanel[i] + po; anySkip = true; }
    }
    if (s.uv) uv.set(s.uv, o * 2);
    if (s.nearSeam) nearSeam.set(s.nearSeam, o);
    garmentOf.fill(g, o, o + s.n);
    if (s.layerIdx && s.layerW) {
      const nl = s.layerIdx.length / 4, fl = Math.min(nl, G.foldLayers ?? nl);
      for (let e = 0; e < nl; e++) {
        const d = e < fl ? la++ : lf++;
        for (let q = 0; q < 4; q++) layerIdx[d * 4 + q] = s.layerIdx[e * 4 + q] + o;
        for (let q = 0; q < 5; q++) layerW[d * 5 + q] = s.layerW[e * 5 + q];
      }
    }
    for (const P of G.panels) panels.push({ ...P, offset: P.offset + o, ...(P.attach ? { attach: { ...P.attach, host: P.attach.host + po } } : {}) });
    panelSign.push(...G.panelSign);
    for (const L of G.layerNear ?? []) layerNear.push({ ...L, a: L.a + o, tris: L.tris.map((v) => v + o) });
    for (const [id, links] of Object.entries(G.seamLinks)) seamLinks[`${it.project.id}:${id}`] = links.map(([a, b]) => [a + o, b + o]);
    selfRadius = Math.max(selfRadius, s.selfRadius);
    if (built[g].category !== 'headwear') sewFrames = Math.max(sewFrames, s.sewFrames);
    if (s.carry.length) carryWithHead(sim, col, o, o + s.n);
  });
  sim.sewFrames = sewFrames || Math.max(...built.map((b) => b.G.sim.sewFrames));
  sim.panelOf = panelOf; sim.uv = uv; sim.seamGroup = group; sim.nearSeam = nearSeam;
  sim.selfRadius = selfRadius; sim.garmentOf = garmentOf; sim.crossRadius = OUTFIT_GAP;
  if (layerIdx.length) { sim.layerIdx = layerIdx; sim.layerW = layerW; if (anySkip) sim.skipPanel = skipPanel; }
  sim.collider = contactCollider(contact, col);

  // ---- start shapes: outer garments go on over the inner ones ----
  const t0 = col.thickness;
  const hit = { nx: 0, ny: 0, nz: 0, depth: 0 };
  try {
    built.forEach(({ G }, g) => {
      if (!rank[g]) return;
      col.thickness = t0 + rank[g] * LAYER_STEP;
      for (let i = starts[g]; i < starts[g] + G.sim.n; i++) if (contact[i] !== 1) col.project(sim.pos, i * 3, hit);
    });
  } finally { col.thickness = t0; }
  sim.prev.set(sim.pos);

  const garments: OutfitGarment[] = built.map(({ it, G, category }, g) => ({
    projectId: it.project.id, style: it.project.garment, category, layer: it.layer, ...(info[g].tuck ? { tuck: info[g].tuck } : {}),
    start: starts[g], count: G.sim.n, panelStart: panelStarts[g], panelCount: G.panels.length, rank: rank[g], own: G,
  }));
  const O: Outfit3D = {
    sim, panels, limits, seamLinks, body: col, contact, panelSign: Int8Array.from(panelSign), collar: built[0].G.collar,
    foldLayers: nAttachLayers, ...(layerNear.length ? { layerNear } : {}), garments, pairs, rebind: () => {}, release: () => {},
  };
  const binder = contactBinder(O, bodyFrame(body));
  O.rebind = binder;
  // dressing in order: a garment is held in its start shape until the ones under it are sewn, then it is sewn over
  // them (all of it in the gravity free sewing phase, which is that much longer)
  const per = sim.sewFrames, maxRank = Math.max(...rank);
  const held = new Map<number, Float32Array>();
  if (maxRank > 0 && !(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.NOSTAGE) {
    garments.forEach((g, k) => {
      if (!rank[k]) return;
      held.set(k, sim.invMass.slice(g.start, g.start + g.count));
      sim.invMass.fill(0, g.start, g.start + g.count);
    });
    sim.sewFrames = per * (maxRank + 1);
  }
  const stage = () => {
    if (!held.size) return;
    for (const [k, m] of held) if (sim.frames >= rank[k] * per) { sim.invMass.set(m, garments[k].start); held.delete(k); }
  };
  O.release = () => { sim.frames = Math.max(sim.frames, maxRank * per); stage(); };
  // rebound every other frame: in between, the barycentric binding slides along with the cloth
  let tick = 0;
  sim.frameHook = () => { stage(); if ((tick++ & 1) === 0) binder(); };
  binder();
  return O;
}

/** per garment: its triangles (global particle triples), the outward sign of each (0: work it out round the neck) and its part */
interface Surface { tris: Int32Array; sign: Int8Array; part: Uint8Array; vpart: Uint8Array }
const PART_BODY = 0, PART_ARM = 1;

function surfaces(O: Outfit3D): Surface[] {
  return O.garments.map((g) => {
    const tris: number[] = [], sign: number[] = [], part: number[] = [];
    const vpart = new Uint8Array(g.count);
    for (let k = g.panelStart; k < g.panelStart + g.panelCount; k++) {
      const P = O.panels[k];
      const host = P.attach ? O.panels[P.attach.host] : P;
      const pt = g.category === 'tops' && TOP_ARM.has(host.piece.role) ? PART_ARM : PART_BODY;
      // the outward side of the cloth: the piece's outside face; an attachment on the inside face shows towards the body
      const sg = host.piece.role === 'collar' ? 0 : O.panelSign[k] * (P.attach?.face === 'inside' ? -1 : 1);
      const T = P.mesh.tris;
      for (let t = 0; t < T.length; t += 3) { tris.push(P.offset + T[t], P.offset + T[t + 1], P.offset + T[t + 2]); sign.push(sg); part.push(pt); }
      vpart.fill(pt, P.offset - g.start, P.offset - g.start + P.mesh.uv.length);
    }
    return { tris: Int32Array.from(tris), sign: Int8Array.from(sign), part: Uint8Array.from(part), vpart };
  });
}

/**
 * The contact binding of an outfit: for every [inner, outer] pair, the outer garment's points near the inner one are
 * bound outside the inner triangle under them (one per part: torso and sleeve). Writes ClothSim.contactIdx /
 * contactW / contactCount. A top tucked into bottoms also has its body points bound inside the bottoms (a tube in a
 * tube). Between two tops that rule is left out: a torso point lying beside an outer sleeve is outside that sleeve,
 * and binding it inside made the layering worse.
 */
function contactBinder(O: Outfit3D, f: ReturnType<typeof bodyFrame>) {
  const S = surfaces(O), sim = O.sim, pos = sim.pos;
  const neckCz = f.neckRing(f.neckH + 1).cz ?? 0;
  const C = 2.5, T = 1 << 14;
  const cell = (v: number) => Math.floor(v / C);
  const hkey = (x: number, y: number, z: number) => ((x * 92837111) ^ (y * 689287499) ^ (z * 283923481)) & (T - 1);
  let idx = new Int32Array(1024 * 4), w = new Float32Array(1024 * 5);
  /** per triangle, refreshed with the grid: unit normal turned outward (n), first corner (p0), edges u v, and the 2x2 solve */
  const grids = S.map((s) => {
    const nt = s.tris.length / 3;
    return { start: new Int32Array(T + 1), items: new Int32Array(nt), geo: new Float32Array(nt * 16) };
  });
  const bbox = (g: OutfitGarment) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = g.start; i < g.start + g.count; i++) for (let k = 0; k < 3; k++) { const v = pos[i * 3 + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
    return b;
  };
  const build = (gi: number) => {
    const s = S[gi], G = grids[gi], nt = s.tris.length / 3, geo = G.geo;
    const keys = new Int32Array(nt);
    G.start.fill(0);
    for (let t = 0; t < nt; t++) {
      const i0 = s.tris[t * 3] * 3, i1 = s.tris[t * 3 + 1] * 3, i2 = s.tris[t * 3 + 2] * 3;
      const ux = pos[i1] - pos[i0], uy = pos[i1 + 1] - pos[i0 + 1], uz = pos[i1 + 2] - pos[i0 + 2];
      const vx = pos[i2] - pos[i0], vy = pos[i2 + 1] - pos[i0 + 1], vz = pos[i2 + 2] - pos[i0 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const uu = ux * ux + uy * uy + uz * uz, uv2 = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
      const den = uu * vv - uv2 * uv2;
      const o = t * 16;
      if (l < 1e-9 || Math.abs(den) < 1e-12) { geo[o + 15] = 0; } else {
        nx /= l; ny /= l; nz /= l;
        let sg = s.sign[t];
        if (sg === 0) {
          // a collar: outward is away from the neck
          const mx = (pos[i0] + pos[i1] + pos[i2]) / 3, mz = (pos[i0 + 2] + pos[i1 + 2] + pos[i2 + 2]) / 3 - neckCz;
          sg = nx * mx + nz * mz >= 0 ? 1 : -1;
        }
        geo[o] = nx; geo[o + 1] = ny; geo[o + 2] = nz;
        geo[o + 3] = pos[i0]; geo[o + 4] = pos[i0 + 1]; geo[o + 5] = pos[i0 + 2];
        geo[o + 6] = ux; geo[o + 7] = uy; geo[o + 8] = uz; geo[o + 9] = vx; geo[o + 10] = vy; geo[o + 11] = vz;
        geo[o + 12] = uu / den; geo[o + 13] = uv2 / den; geo[o + 14] = vv / den; geo[o + 15] = sg;
      }
      keys[t] = hkey(cell(pos[i0] + (ux + vx) / 3), cell(pos[i0 + 1] + (uy + vy) / 3), cell(pos[i0 + 2] + (uz + vz) / 3));
      G.start[keys[t]]++;
    }
    let acc = 0;
    for (let c = 0; c <= T; c++) { const v = G.start[c]; G.start[c] = acc; acc += c < T ? v : 0; }
    G.start[T] = nt;
    const fill = new Int32Array(T);
    for (let t = 0; t < nt; t++) G.items[G.start[keys[t]] + fill[keys[t]]++] = t;
  };
  let count = 0;
  const push = (a: number, s: Surface, t: number, w0: number, w1: number, w2: number, sg: number) => {
    if ((count + 1) * 4 > idx.length) { const i2 = new Int32Array(idx.length * 2); i2.set(idx); idx = i2; const w2b = new Float32Array(w.length * 2); w2b.set(w); w = w2b; }
    idx[count * 4] = a; idx[count * 4 + 1] = s.tris[t * 3]; idx[count * 4 + 2] = s.tris[t * 3 + 1]; idx[count * 4 + 3] = s.tris[t * 3 + 2];
    w[count * 5] = w0; w[count * 5 + 1] = w1; w[count * 5 + 2] = w2; w[count * 5 + 3] = OUTFIT_GAP; w[count * 5 + 4] = sg;
    count++;
  };
  /** bind particle a to the nearest triangle of surface gi (parts allowed by `ok`), on its outward (+1) or inward (-1) side */
  const bind = (a: number, gi: number, side: number, ok: (part: number) => boolean) => {
    const s = S[gi], G = grids[gi], geo = G.geo;
    const x = pos[a * 3], y = pos[a * 3 + 1], z = pos[a * 3 + 2];
    const cx = cell(x), cy = cell(y), cz = cell(z);
    let best = REACH, bt = -1, bw0 = 0, bw1 = 0, bw2 = 0, bs = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const h = hkey(cx + dx, cy + dy, cz + dz);
      for (let q = G.start[h]; q < G.start[h + 1]; q++) {
        const t = G.items[q], o = t * 16;
        if (!geo[o + 15] || !ok(s.part[t])) continue;
        const px = x - geo[o + 3], py = y - geo[o + 4], pz = z - geo[o + 5];
        const d = px * geo[o] + py * geo[o + 1] + pz * geo[o + 2];
        if (d >= best || -d >= best) continue;
        // where the point projects onto the triangle (barycentric); off the triangle it is not over this cloth
        const qu = px * geo[o + 6] + py * geo[o + 7] + pz * geo[o + 8], qv = px * geo[o + 9] + py * geo[o + 10] + pz * geo[o + 11];
        const b1 = geo[o + 14] * qu - geo[o + 13] * qv, b2 = geo[o + 12] * qv - geo[o + 13] * qu, b0 = 1 - b1 - b2;
        if (b0 < -0.1 || b1 < -0.1 || b2 < -0.1) continue;
        best = Math.abs(d); bt = t; bs = geo[o + 15];
        const c0 = Math.max(0, b0), c1 = Math.max(0, b1), c2 = Math.max(0, b2), cs = c0 + c1 + c2 || 1;
        bw0 = c0 / cs; bw1 = c1 / cs; bw2 = c2 / cs;
      }
    }
    if (bt >= 0) push(a, s, bt, bw0, bw1, bw2, bs * side);
  };
  return () => {
    count = 0;
    if (!O.pairs.length) { sim.contactCount = 0; return; }
    const boxes = O.garments.map(bbox);
    const used = new Set<number>();
    for (const [i, j] of O.pairs) { used.add(i); if (O.garments[i].category === 'tops' && O.garments[j].category === 'bottoms') used.add(j); }
    for (const g of used) build(g);
    const within = (b: number[], k: number) => pos[k * 3] > b[0] - REACH && pos[k * 3] < b[3] + REACH && pos[k * 3 + 1] > b[1] - REACH && pos[k * 3 + 1] < b[4] + REACH && pos[k * 3 + 2] > b[2] - REACH && pos[k * 3 + 2] < b[5] + REACH;
    for (const [i, j] of O.pairs) {
      const gi = O.garments[i], gj = O.garments[j];
      // the outer garment stays outside every part of the inner one
      // (bound to the nearest triangle of each part: under the arm a point lies over the torso and the sleeve at once)
      const twoParts = gi.category === 'tops';
      for (let a = gj.start; a < gj.start + gj.count; a++) {
        if (O.contact![a] === 1 || !within(boxes[i], a)) continue;
        if (!twoParts) { bind(a, i, 1, () => true); continue; }
        bind(a, i, 1, (p) => p === PART_BODY);
        bind(a, i, 1, (p) => p === PART_ARM);
      }
      // a top tucked into bottoms: its body (not the sleeves) is also kept inside them, so the hem stays in the waistband
      if (gi.category === 'tops' && gj.category === 'bottoms') {
        for (let a = gi.start; a < gi.start + gi.count; a++) {
          if (O.contact![a] === 1 || S[i].vpart[a - gi.start] !== PART_BODY || !within(boxes[j], a)) continue;
          bind(a, j, -1, () => true);
        }
      }
    }
    sim.contactIdx = idx; sim.contactW = w; sim.contactCount = count;
  };
}

/** Display copy of an outfit: every garment as displayPositions shows it, then the layers kept apart once more. */
export function displayOutfit(O: Outfit3D, out: Float32Array) {
  displayPositions(O, out);
  const I = O.sim.contactIdx, W = O.sim.contactW;
  if (!I || !W) return;
  // two passes: a middle layer pushed out by the one under it then pushes the one over it
  for (let pass = 0; pass < 2; pass++) for (let e = 0, k = 0; e < O.sim.contactCount * 4; e += 4, k += 5) {
    const a = I[e] * 3, h0 = I[e + 1] * 3, h1 = I[e + 2] * 3, h2 = I[e + 3] * 3;
    const ux = out[h1] - out[h0], uy = out[h1 + 1] - out[h0 + 1], uz = out[h1 + 2] - out[h0 + 2];
    const vx = out[h2] - out[h0], vy = out[h2 + 1] - out[h0 + 1], vz = out[h2 + 2] - out[h0 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-9) continue;
    const sg = W[k + 4] / l;
    nx *= sg; ny *= sg; nz *= sg;
    const px = out[h0] * W[k] + out[h1] * W[k + 1] + out[h2] * W[k + 2], py = out[h0 + 1] * W[k] + out[h1 + 1] * W[k + 1] + out[h2 + 1] * W[k + 2], pz = out[h0 + 2] * W[k] + out[h1 + 2] * W[k + 1] + out[h2 + 2] * W[k + 2];
    const c = W[k + 3] * 0.5 - ((out[a] - px) * nx + (out[a + 1] - py) * ny + (out[a + 2] - pz) * nz);
    if (c <= 0) continue;
    out[a] += nx * c; out[a + 1] += ny * c; out[a + 2] += nz * c;
  }
}

/**
 * Warm start an outfit from the previous one: every garment that was already in it (same project, same pieces)
 * starts from its drape. If a garment is new or changed beyond a warm start, the whole outfit keeps the full sewing
 * phase (the warm garments only settle again) so the new one can be sewn; if the last outfit was still being sewn,
 * sewing carries on from where it was.
 */
export function warmStartOutfit(next: Outfit3D, prev: Outfit3D): boolean {
  let all = true, any = false;
  const sewFrames = next.sim.sewFrames;
  for (const g of next.garments) {
    const p = prev.garments.find((q) => q.projectId === g.projectId);
    const ok = !!p && warmStart(
      { ...next, panels: next.panels.slice(g.panelStart, g.panelStart + g.panelCount) },
      { ...prev, panels: prev.panels.slice(p.panelStart, p.panelStart + p.panelCount) },
    );
    if (ok) any = true; else all = false;
  }
  next.sim.prev.set(next.sim.pos);
  next.sim.sewFrames = sewFrames;
  if (prev.sim.frames < prev.sim.sewFrames) {
    // the last outfit was still being sewn (an edit right after opening it): carry on sewing where it was, or the
    // garments not yet sewn would get gravity and fall off
    next.sim.frames = Math.min(prev.sim.frames, sewFrames);
  } else if (all) {
    next.release();
    next.sim.frames = 0;
    next.sim.sewFrames = 4; // already sewn, just settle
  } else next.sim.frames = 0;
  if (any) next.rebind();
  return any;
}

// ---- details, stitching and trims: built per garment, then shifted into the outfit's particle numbering ----

type DashMsg = Pick<DetailsMsg, 'n' | 'dashCount' | 'dashTri' | 'dashW' | 'dashSign' | 'dashCol' | 'palette' | 'anchorCount' | 'anchorKind' | 'anchorTri' | 'anchorW' | 'anchorUp' | 'anchorSign' | 'anchorCol' | 'anchorSize'>;

/** Put the details (topstitching, buttons) or attachment stitching of every garment into one message. offsets[k] = OutfitGarment.start. */
export function mergeDetails<M extends DashMsg>(msgs: M[], offsets: number[], n: number): M {
  const palette: string[] = [];
  const cat = <A extends Float32Array | Uint32Array | Uint8Array>(make: (len: number) => A, parts: A[], map?: (v: number, k: number) => number): A => {
    const out = make(parts.reduce((s, p) => s + p.length, 0));
    let at = 0;
    parts.forEach((p, k) => { if (map) for (let i = 0; i < p.length; i++) out[at + i] = map(p[i], k); else out.set(p as never, at); at += p.length; });
    return out;
  };
  const remap = msgs.map((m) => m.palette.map((c) => { let i = palette.indexOf(c); if (i < 0) { i = palette.length; palette.push(c); } return i; }));
  const shift = (v: number, k: number) => v + offsets[k];
  return {
    ...msgs[0],
    n,
    palette,
    dashCount: msgs.reduce((s, m) => s + m.dashCount, 0),
    dashTri: cat((l) => new Uint32Array(l), msgs.map((m) => m.dashTri), shift),
    dashW: cat((l) => new Float32Array(l), msgs.map((m) => m.dashW)),
    dashSign: cat((l) => new Float32Array(l), msgs.map((m) => m.dashSign)),
    dashCol: cat((l) => new Uint8Array(l), msgs.map((m) => m.dashCol), (v, k) => remap[k][v] ?? 0),
    anchorCount: msgs.reduce((s, m) => s + m.anchorCount, 0),
    anchorKind: cat((l) => new Uint8Array(l), msgs.map((m) => m.anchorKind)),
    anchorTri: cat((l) => new Uint32Array(l), msgs.map((m) => m.anchorTri), shift),
    anchorW: cat((l) => new Float32Array(l), msgs.map((m) => m.anchorW)),
    anchorUp: cat((l) => new Float32Array(l), msgs.map((m) => m.anchorUp)),
    anchorSign: cat((l) => new Float32Array(l), msgs.map((m) => m.anchorSign)),
    anchorCol: cat((l) => new Uint8Array(l), msgs.map((m) => m.anchorCol), (v, k) => remap[k][v] ?? 0),
    anchorSize: cat((l) => new Float32Array(l), msgs.map((m) => m.anchorSize)),
  };
}
export type { AttachDetailsMsg };

/** Put the hardware (buttons, rivets, zips) of every garment into one message. offsets[k] = OutfitGarment.start. */
export function mergeHardware(msgs: HardwareMsg[], offsets: number[], n: number): HardwareMsg {
  const f32 = (get: (m: HardwareMsg) => Float32Array) => { const out = new Float32Array(msgs.reduce((s, m) => s + get(m).length, 0)); let at = 0; for (const m of msgs) { out.set(get(m), at); at += get(m).length; } return out; };
  const u8 = (get: (m: HardwareMsg) => Uint8Array) => { const out = new Uint8Array(msgs.reduce((s, m) => s + get(m).length, 0)); let at = 0; for (const m of msgs) { out.set(get(m), at); at += get(m).length; } return out; };
  const u32 = (get: (m: HardwareMsg) => Uint32Array, add: (m: HardwareMsg, k: number) => number) => {
    const out = new Uint32Array(msgs.reduce((s, m) => s + get(m).length, 0)); let at = 0;
    msgs.forEach((m, k) => { const a = get(m), d = add(m, k); for (let i = 0; i < a.length; i++) out[at + i] = a[i] + d; at += a.length; });
    return out;
  };
  const u16 = (get: (m: HardwareMsg) => Uint16Array) => {
    const out = new Uint16Array(msgs.reduce((s, m) => s + get(m).length, 0)); let at = 0, base = 0;
    for (const m of msgs) { const a = get(m); for (let i = 0; i < a.length; i++) out[at + i] = a[i] + base; at += a.length; base += m.designs.length; }
    return out;
  };
  const zipBase: number[] = [];
  let zb = 0;
  for (const m of msgs) { zipBase.push(zb); zb += m.zipTri.length / 3; }
  return {
    ...msgs[0],
    n,
    count: msgs.reduce((s, m) => s + m.count, 0),
    kind: u8((m) => m.kind), finish: u8((m) => m.finish), size: f32((m) => m.size),
    tri: u32((m) => m.tri, (_, k) => offsets[k]), w: f32((m) => m.w), sign: f32((m) => m.sign), up: f32((m) => m.up),
    zipCount: msgs.reduce((s, m) => s + m.zipCount, 0),
    zipFinish: u8((m) => m.zipFinish), zipSize: f32((m) => m.zipSize), zipOpen: u8((m) => m.zipOpen),
    zipStart: u32((m) => m.zipStart, (_, k) => zipBase[k]), zipLen: u32((m) => m.zipLen, () => 0),
    zipTri: u32((m) => m.zipTri, (_, k) => offsets[k]), zipW: f32((m) => m.zipW), zipSign: f32((m) => m.zipSign),
    designs: msgs.flatMap((m) => m.designs), design: u16((m) => m.design), zipDesign: u16((m) => m.zipDesign),
  };
}

// ---- checks (tests/outfit.ts, and the 3D view if it wants a warning) ----

/** signed distance of point p to the nearest triangle of garment g (outward positive), within REACH; NaN when not over it */
function sideOver(O: Outfit3D, S: Surface, p: number, P: Float32Array): number {
  const x = P[p * 3], y = P[p * 3 + 1], z = P[p * 3 + 2];
  let best = REACH, val = NaN;
  for (let t = 0; t < S.tris.length / 3; t++) {
    const i0 = S.tris[t * 3] * 3, i1 = S.tris[t * 3 + 1] * 3, i2 = S.tris[t * 3 + 2] * 3;
    const mx = (P[i0] + P[i1] + P[i2]) / 3 - x, my = (P[i0 + 1] + P[i1 + 1] + P[i2 + 1]) / 3 - y, mz = (P[i0 + 2] + P[i1 + 2] + P[i2 + 2]) / 3 - z;
    if (mx * mx + my * my + mz * mz > 16) continue;
    const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
    const vx = P[i2] - P[i0], vy = P[i2 + 1] - P[i0 + 1], vz = P[i2 + 2] - P[i0 + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l < 1e-9) continue;
    nx /= l; ny /= l; nz /= l;
    const px = x - P[i0], py = y - P[i0 + 1], pz = z - P[i0 + 2];
    const d = px * nx + py * ny + pz * nz;
    if (Math.abs(d) >= best) continue;
    const qx = px - d * nx, qy = py - d * ny, qz = pz - d * nz;
    const uu = ux * ux + uy * uy + uz * uz, uv2 = ux * vx + uy * vy + uz * vz, vv = vx * vx + vy * vy + vz * vz;
    const qu = qx * ux + qy * uy + qz * uz, qv = qx * vx + qy * vy + qz * vz, den = uu * vv - uv2 * uv2;
    if (Math.abs(den) < 1e-12) continue;
    const b1 = (vv * qu - uv2 * qv) / den, b2 = (uu * qv - uv2 * qu) / den;
    if (b1 < -0.05 || b2 < -0.05 || 1 - b1 - b2 < -0.05) continue;
    let sg = S.sign[t];
    if (sg === 0) sg = nx * (P[i0] + P[i1] + P[i2]) / 3 + nz * (P[i0 + 2] + P[i1 + 2] + P[i2 + 2]) / 3 >= 0 ? 1 : -1;
    best = Math.abs(d); val = d * sg;
  }
  return val;
}

/**
 * Layering check between two garments of an outfit (indices into O.garments): of the outer garment's points that lie
 * over the inner garment (within 2 cm of it), the share that is inside the inner garment's surface (past `tolerance`
 * cm); and how many points were over it. Uses the positions given (sim.pos, or the display copy).
 */
export function layerCheck(O: Outfit3D, inner: number, outer: number, P: Float32Array = O.sim.pos, tolerance = 0.05) {
  const S = surfaces(O)[inner], g = O.garments[outer];
  let over = 0, inside = 0;
  for (let a = g.start; a < g.start + g.count; a++) {
    const d = sideOver(O, S, a, P);
    if (Number.isNaN(d)) continue;
    over++;
    if (d < -tolerance) inside++;
  }
  return { over, inside, share: inside / Math.max(1, g.count) };
}

/** Points of garment `of` within REACH of garment `ref`'s surface, with their signed distance (outward positive). */
export function sidesOf(O: Outfit3D, of: number, ref: number, P: Float32Array = O.sim.pos, pick?: (particle: number) => boolean): number[] {
  const S = surfaces(O)[ref], g = O.garments[of], out: number[] = [];
  for (let a = g.start; a < g.start + g.count; a++) {
    if (pick && !pick(a)) continue;
    const d = sideOver(O, S, a, P);
    if (!Number.isNaN(d)) out.push(d);
  }
  return out;
}
