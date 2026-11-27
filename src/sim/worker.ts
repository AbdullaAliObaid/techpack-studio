// Cloth simulation runs here, off the main thread, so the editor stays smooth while fabric drapes.
import { assemble, displayPositions, warmStart, type Garment3D } from './setup';
import type { GarmentType, Piece } from '../data/presets';
import type { Body } from '../three/body';
import { calibratedField } from '../three/bodyField';
import { meshField, PosedCollider } from '../three/mesher';
import { bodyFrame, type BodyFrame } from '../three/body';
import { buildDetails, detailTransfers } from './details';
import { buildAttachmentDetails, outwardSignsHosted } from './detailsAttach';
import { buildHardware, hardwareTransfers } from './detailsHardware';
import type { Attachment } from '../data/edits';
import { migrateGarment, styleById } from '../data/catalog';
import { boneMatrices, clampPose, invert, lerpPose, poseAt, poseDistance, stepPose, type Mode } from './pose';
import { ZERO_POSE, type CustomPose, type Edits } from '../data/edits';
import { loadBody, saveBody } from './bodyCache';
import type { BodyMesh } from '../three/mesher';

let bodyKey = '';
let collider: PosedCollider | null = null;
let frame: BodyFrame | null = null;
let mode: Mode = 'stand';
let simTime = 0; // seconds of simulated time
let modeStart = 0;
let motionPeak = 0;
let motionPeakInfo: { ratio: number; strain: number; y: number; over: number } | null = null;

// custom pose: the body eases toward the slider pose at a capped joint speed so the cloth cannot be torn
const POSE_SPEED = 2.5; // radians per second
let poseTarget: CustomPose = ZERO_POSE;
let poseCur: CustomPose = ZERO_POSE;
let posePrev: CustomPose = ZERO_POSE;
let poseMovedAt = -1e9;

function applyPose(dt = 0) {
  if (!collider || !frame) return 0;
  const t = simTime - modeStart + dt;
  const custom = mode === 'custom' ? lerpPose(posePrev, poseCur, Math.min(1, dt * 60)) : undefined;
  const M = boneMatrices(frame, poseAt(mode, t, frame, custom));
  collider.setPose(M, invert(M));
  return t;
}

let G: Garment3D | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let gen = 0;

type BuildMsg =
  /** edits (attachments, seam edits, pleats from src/data/edits.ts) are optional; without them the garment is the plain pattern */
  | { type: 'build'; garment: GarmentType; pieces: Piece[]; body: Body; warm: boolean; spacing: number; edits?: Edits }
  | { type: 'mode'; mode: Mode }
  | { type: 'attachments'; attachments: Attachment[] }
  | { type: 'pose'; pose: CustomPose };

let attachments: Attachment[] = [];
/** what the last posted stitching / hardware were built from; an attachments message rebuilds only what changed */
let sentKeys = { stitch: '', hardware: '' };
function postAttachDetails(force = true) {
  if (!G) return;
  const keys = {
    stitch: JSON.stringify(attachments.filter((a) => a.kind !== 'hardware' && a.kind !== 'print' && a.kind !== 'embroidery')),
    hardware: JSON.stringify(attachments.filter((a) => a.kind === 'hardware')),
  };
  const stitch = force || keys.stitch !== sentKeys.stitch, hardware = force || keys.hardware !== sentKeys.hardware;
  sentKeys = keys;
  if (stitch) try {
    const det = buildAttachmentDetails(G, attachments);
    (self as unknown as Worker).postMessage(det, detailTransfers(det as never));
  } catch (err) {
    console.warn('attachment details failed', err);
  }
  if (hardware) try {
    // hardware trims: anchors on the host cloth per copy (instance), drawn by src/three/Hardware.tsx
    const hw = buildHardware(G, attachments, G.panelSign ? Array.from(G.panelSign) : outwardSignsHosted(G.panels, G.sim.pos));
    (self as unknown as Worker).postMessage(hw, hardwareTransfers(hw));
  } catch (err) {
    console.warn('hardware failed', err);
  }
}

function wake() {
  if (!G || !G.sim.sleeping) return;
  G.sim.sleeping = false;
  G.sim.frames = Math.max(G.sim.frames, G.sim.sewFrames + 1);
  if (timer) clearTimeout(timer);
  loop(gen);
}

function loop(myGen: number) {
  if (!G || myGen !== gen) return;
  const t0 = performance.now();
  const poseT = simTime - modeStart;
  // move the body a little on every substep so fast limbs cannot tunnel through the cloth
  posePrev = poseCur;
  if (mode === 'custom' && poseDistance(poseCur, poseTarget) > 0) { poseCur = stepPose(poseCur, poseTarget, POSE_SPEED / 60); poseMovedAt = simTime; }
  G.sim.substepHook = (k, n) => applyPose(((k + 1) / n) / 60);
  G.sim.awake = mode === 'custom' ? poseT < 1.2 || simTime - poseMovedAt < 1.0 : mode !== 'stand' || poseT < 1.2;
  G.sim.step();
  simTime += 1 / 60;
  const pos = new Float32Array(G.sim.n * 3);
  displayPositions(G, pos);
  let strain: Float32Array | undefined;
  let peak: { ratio: number; strain: number; y: number; over: number } | undefined;
  if (G.sim.frames % 6 === 0 || G.sim.sleeping) {
    strain = new Float32Array(G.sim.n);
    G.sim.strain(strain);
    // ratio of the fabric's safe stretch; the first 1% of strain is mesh noise, not fabric strain
    let over = 0;
    for (let i = 0; i < G.sim.n; i++) {
      const r = Math.max(0, strain[i] - 0.01) / Math.max(0.01, G.limits[i]);
      strain[i] = r;
      if (r > 1) over++;
    }
    // robust peak: the 98th percentile, so a single trapped point cannot set the reading
    const order = Array.from(strain.keys()).sort((a, b) => strain![a] - strain![b]);
    const wi = order[Math.floor(order.length * 0.98)];
    const worst = strain[wi];
    peak = { ratio: worst, strain: worst * G.limits[wi] + 0.01, y: G.sim.pos[wi * 3 + 1], over: over / G.sim.n };
    // during a movement keep the worst moment of the motion
    if (mode !== 'stand' && simTime - modeStart > 1) {
      if (worst > motionPeak) { motionPeak = worst; motionPeakInfo = peak; }
      if (motionPeakInfo) peak = motionPeakInfo;
    }
  }
  const msg = { type: 'frame', pos, strain, peak, sleeping: G.sim.sleeping, mode, t: simTime - modeStart, pose: mode === 'custom' ? poseCur : undefined };
  (self as unknown as Worker).postMessage(msg, [pos.buffer, ...(strain ? [strain.buffer] : [])]);
  if (!G.sim.sleeping) timer = setTimeout(() => loop(myGen), Math.max(0, 16 - (performance.now() - t0)));
}

// messages are handled in order; a build may wait for the body cache (IndexedDB) first
let queue: Promise<void> = Promise.resolve();
self.onmessage = (e: MessageEvent<BuildMsg>) => {
  queue = queue.then(() => handle(e.data)).catch((err) => console.warn('worker message failed', err));
};

const copyMesh = (m: BodyMesh): BodyMesh => ({
  positions: m.positions.slice(), normals: m.normals.slice(), indices: m.indices.slice(), skinIndex: m.skinIndex.slice(), skinWeight: m.skinWeight.slice(),
  grid: { ...m.grid },
});

async function handle(m: BuildMsg) {
  if (m.type === 'pose') {
    poseTarget = clampPose(m.pose);
    if (mode !== 'custom') { poseCur = posePrev = poseTarget; return; }
    wake();
    return;
  }
  if (m.type === 'mode') {
    if (m.mode === 'custom') poseCur = posePrev = poseTarget; // the mode blends in from standing on its own
    mode = m.mode;
    modeStart = simTime;
    motionPeak = 0;
    motionPeakInfo = null;
    if (G) {
      G.sim.sleeping = false;
      G.sim.frames = Math.max(G.sim.frames, G.sim.sewFrames + 1);
      if (timer) clearTimeout(timer);
      loop(gen);
    }
    return;
  }
  if (m.type === 'attachments') {
    attachments = m.attachments;
    postAttachDetails(false);
    return;
  }
  if (m.type !== 'build') return;
  if (timer) clearTimeout(timer);
  const key = JSON.stringify(m.body);
  if (key !== bodyKey || !collider) {
    (self as unknown as Worker).postMessage({ type: 'status', text: 'Building body…' });
    let mesh = await loadBody(key);
    if (!mesh) {
      mesh = meshField(calibratedField(m.body));
      // the display arrays are transferred to the page below, so the cache gets its own copy (the grid stays here)
      void saveBody(key, copyMesh(mesh));
    }
    frame = bodyFrame(m.body);
    const fr = frame;
    collider = new PosedCollider(mesh.grid, [fr.ankleH + 6, fr.crotchH + 1], fr);
    bodyKey = key;
    (self as unknown as Worker).postMessage(
      { type: 'body', positions: mesh.positions, normals: mesh.normals, indices: mesh.indices, skinIndex: mesh.skinIndex, skinWeight: mesh.skinWeight },
      [mesh.positions.buffer, mesh.normals.buffer, mesh.indices.buffer, mesh.skinIndex.buffer, mesh.skinWeight.buffer],
    );
  }
  // a new garment is always assembled on the standing body, then the current movement plays again
  if (collider) collider.setPose(boneMatrices(frame!, poseAt('stand', 0, frame!)), invert(boneMatrices(frame!, poseAt('stand', 0, frame!))));
  modeStart = simTime + (m.warm ? 0 : 2.0);
  motionPeak = 0;
  motionPeakInfo = null;
  const next = assemble(m.garment, m.pieces, m.body, m.spacing, collider!, m.edits);
  if (!next) { G = null; return; }
  if (m.warm && G) warmStart(next, G);
  G = next;
  gen++;
  const index: number[] = [];
  const groups: { start: number; count: number; panel: number }[] = [];
  const uv = new Float32Array(G.sim.n * 2);
  G.panels.forEach((p, k) => {
    p.mesh.uv.forEach((q, i) => {
      uv[(p.offset + i) * 2] = (p.mirror ? -q.x : q.x) / 6;
      uv[(p.offset + i) * 2 + 1] = -q.y / 6;
    });
    const start = index.length;
    for (let t = 0; t < p.mesh.tris.length; t += 3) {
      const a = p.offset + p.mesh.tris[t], b = p.offset + p.mesh.tris[t + 1], c = p.offset + p.mesh.tris[t + 2];
      p.mirror ? index.push(a, c, b) : index.push(a, b, c);
    }
    groups.push({ start, count: index.length - start, panel: k });
  });
  const pos = new Float32Array(G.sim.n * 3);
  displayPositions(G, pos);
  // ---- picking and prints: which pattern piece and pattern point every cloth vertex is ----
  //   pieceIds[k]         id of entry k: a pattern piece id, or for a cloth attachment panel the attachment id
  //                       (a user piece patched on keeps its own piece id)
  //   vertexPiece[v]      index into pieceIds for cloth vertex v (Uint16Array, length n)
  //   vertexPatternUv     Float32Array(n * 2): x, y of vertex v in cm in that piece's own local pattern coords
  //                       (not mirrored for a left side copy; for an attachment, its own coords centred on 0,0
  //                       before rotation). Barycentric interpolation of these over a raycast hit triangle
  //                       gives the pattern point under the cursor, which is where a print or attachment goes.
  //   panels[k]           per placed panel (same order as groups): vertex range start..start+count, pieceIndex,
  //                       instance (placed copy of a piece cut more than once: 0 right / 1 left, crown 0..5), mirror,
  //                       and for an attachment panel hostInstance (the host copy it sits on). A text applique has
  //                       one panel per letter, all with the attachment id. Labels: instanceLabel in src/sim/seams.ts
  //   attachmentPanels    cloth attachment panels: attachment id, vertex range, kind (pocket, patch, applique, strap,
  //                       label), host piece id, host instance, face (the host face it sits on: 'outside', or 'inside'
  //                       = between the host and the body)
  // ---- faces (Face in src/data/edits.ts; names and rules in src/sim/seams.ts: faceOf, visibleFace, faceLabel) ----
  //   panelSign[k]        +1 / -1: which side of panel k's mesh triangle order (P.mesh.tris, NOT the swapped render
  //                       order of a mirrored copy) is the 'outside' face. Fixed by the pattern, not by the drape:
  //                       - body pieces, sleeves, cuffs, plackets, bands: the right side of the fabric, away from the
  //                         body (mirrored copies included); the placket's other side is its facing
  //                       - brim: the top of the brim
  //                       - collar: the TOP COLLAR. On the stand it faces the neck; it rolls over the fold line and is
  //                         the visible top of the fall when the collar is down. The other side ('inside') is the
  //                         under collar, which shows when the collar is up (visibleFace)
  //                       - attachment panels: the attachment's own show face, the side away from its host cloth. For
  //                         face 'inside' that side faces the body
  //                       In render order: front = panelSign[k] * (panels[k].mirror ? -1 : 1)
  //   panels[k].role      pattern role of the piece ('custom' for an attachment panel)
  //   panels[k].face      attachment panels only: the host face it is on ('outside' | 'inside')
  //   insideFabrics[k]    fabric of panel k's 'inside' face (Edits.insideFabric by piece id; under collar, placket
  //                       facing, lining look), or null when it is the same as the outside (panel fabric = fabrics[k])
  //   collar              'down' | 'up': how the collar was arranged in this build
  const pieceIds: string[] = [];
  const pieceIndex = (id: string) => { let k = pieceIds.indexOf(id); if (k < 0) { k = pieceIds.length; pieceIds.push(id); } return k; };
  const vertexPiece = new Uint16Array(G.sim.n), vertexPatternUv = new Float32Array(G.sim.n * 2);
  const panels = G.panels.map((p) => {
    const k = pieceIndex(p.attach?.id ?? p.piece.id);
    p.mesh.uv.forEach((q, i) => { vertexPiece[p.offset + i] = k; vertexPatternUv[(p.offset + i) * 2] = q.x; vertexPatternUv[(p.offset + i) * 2 + 1] = q.y; });
    // an attachment panel also says which copy of its host it sits on (0 right, 1 left)
    return { start: p.offset, count: p.mesh.uv.length, pieceIndex: k, instance: p.instance, mirror: p.mirror, role: p.piece.role, ...(p.attach ? { hostInstance: G!.panels[p.attach.host].instance, face: p.attach.face } : {}) };
  });
  const attachmentPanels = G.panels.flatMap((p) => p.attach ? [{
    attachmentId: p.attach.id, start: p.offset, count: p.mesh.uv.length, kind: p.attach.kind,
    hostPieceId: G!.panels[p.attach.host].piece.id, hostInstance: G!.panels[p.attach.host].instance, face: p.attach.face,
  }] : []);
  const insideFabrics = G.panels.map((p) => (p.attach ? null : m.edits?.insideFabric?.[p.piece.id] ?? null));
  (self as unknown as Worker).postMessage({
    type: 'built', n: G.sim.n, index: new Uint32Array(index), groups, uv, pos,
    fabrics: G.panels.map((p) => p.piece.fabric),
    pieceIds, vertexPiece, vertexPatternUv, panels, attachmentPanels,
    panelSign: Array.from(G.panelSign), insideFabrics, collar: G.collar,
  }, [vertexPiece.buffer, vertexPatternUv.buffer]);
  try {
    const det = buildDetails(G, styleById(migrateGarment(m.garment)).details);
    (self as unknown as Worker).postMessage(det, detailTransfers(det));
  } catch (err) {
    console.warn('details failed', err);
  }
  postAttachDetails();
  loop(gen);
}
