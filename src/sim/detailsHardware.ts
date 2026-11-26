// Hardware trims (rivets, eyelets, studs, buttons, snaps, zippers) placed on the cloth. Worker side: find the cloth
// triangle under each pattern point (host piece + instance + pattern coords) and send barycentric anchors. The main
// thread (src/three/Hardware.tsx) turns those into meshes every frame, so trims follow the drape and the motion.

import type { Attachment, Finish, Hardware, HardwareType } from '../data/edits';
import { outlineExtent } from '../lib/trims';
import { Locator } from './details';
import type { Garment3D, PanelInst } from './setup';

export const HW_TYPES: HardwareType[] = ['rivet', 'eyelet', 'stud', 'button', 'snap', 'zipper'];
export const HW_FINISHES: Finish[] = ['silver', 'brass', 'copper', 'gunmetal', 'black', 'white'];
/** distance between zipper samples along its length, cm */
export const ZIP_STEP = 0.4;
const MAX_ITEMS = 4000;
const MAX_ZIP_SAMPLES = 3000;

/** One trim design: every attachment has its own (no sharing); a row made with `count` repeats it. Plain JSON (structured clone). */
export interface TrimDesign {
  attachmentId: string;
  hardware: Hardware;
  /** thread colour for button holes (the attachment's thread, CSS) */
  thread: string;
  /** attachment face; 'inside' trims sit on the inner side of the cloth */
  face: 'outside' | 'inside';
  /** Attachment.sheen when set (Hardware.sheen wins) */
  sheen?: Hardware['sheen'];
}

export interface HardwareMsg {
  type: 'hardware';
  n: number;
  /** round trims: one entry each */
  count: number;
  kind: Uint8Array; // index into HW_TYPES
  finish: Uint8Array; // index into HW_FINISHES
  size: Float32Array; // diameter, cm
  tri: Uint32Array; // 3 per trim
  w: Float32Array; // 3 per trim, barycentric
  sign: Float32Array; // +1 / -1: flips the triangle normal outward
  up: Float32Array; // 2 per trim: pattern-space grain direction as alpha, beta on the triangle edges
  /** zippers: samples along the centre line, ZIP_STEP apart */
  zipCount: number;
  zipFinish: Uint8Array;
  zipSize: Float32Array; // tape width, cm
  zipOpen: Uint8Array;
  zipStart: Uint32Array; // first sample of each zipper
  zipLen: Uint32Array; // sample count of each zipper
  zipTri: Uint32Array;
  zipW: Float32Array;
  zipSign: Float32Array;
  /** designs[design[i]] is the design of round trim i, designs[zipDesign[z]] that of zipper z */
  designs: TrimDesign[];
  design: Uint16Array;
  zipDesign: Uint16Array;
}

export function hardwareTransfers(m: HardwareMsg): ArrayBuffer[] {
  return [m.kind, m.finish, m.size, m.tri, m.w, m.sign, m.up, m.zipFinish, m.zipSize, m.zipOpen, m.zipStart, m.zipLen, m.zipTri, m.zipW, m.zipSign, m.design, m.zipDesign].map((a) => a.buffer as ArrayBuffer);
}

export function buildHardware(G: Garment3D, attachments: Attachment[], signs: number[]): HardwareMsg {
  const { sim, panels } = G;
  const locs = new Map<number, Locator>();
  const loc = (k: number) => { let l = locs.get(k); if (!l) { l = new Locator(panels[k]); locs.set(k, l); } return l; };
  const kind: number[] = [], finish: number[] = [], size: number[] = [], tri: number[] = [], w: number[] = [], sign: number[] = [], up: number[] = [];
  const zFinish: number[] = [], zSize: number[] = [], zOpen: number[] = [], zStart: number[] = [], zLen: number[] = [];
  const zTri: number[] = [], zW: number[] = [], zSign: number[] = [];
  const designs: TrimDesign[] = [], design: number[] = [], zDesign: number[] = [];

  const upOf = (P: PanelInst, t: [number, number, number], dx: number, dy: number): [number, number] => {
    const o = P.offset;
    const a = P.mesh.uv[t[0] - o], b = P.mesh.uv[t[1] - o], c = P.mesh.uv[t[2] - o];
    const e1x = b.x - a.x, e1y = b.y - a.y, e2x = c.x - a.x, e2y = c.y - a.y;
    const det = e1x * e2y - e1y * e2x || 1e-9;
    return [(dx * e2y - dy * e2x) / det, (e1x * dy - e1y * dx) / det];
  };

  for (const a of attachments) {
    const hw = a.hardware;
    if (a.kind !== 'hardware' || !hw) continue;
    const ti = HW_TYPES.indexOf(hw.type), fi = Math.max(0, HW_FINISHES.indexOf(hw.finish));
    if (ti < 0) continue;
    const di = designs.length;
    designs.push({ attachmentId: a.id, hardware: hw, thread: a.thread || '#d8d2c4', face: a.face ?? 'outside', sheen: a.sheen });
    // trims on the inside face sit on the inner side of the cloth: flip the outward normal
    const fs = a.face === 'inside' ? -1 : 1;
    const r = (a.rotation * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
    // pattern direction of the attachment's local +y (down the garment when unrotated)
    const dirX = -s, dirY = c;
    const hosts = panels.map((P, k) => ({ P, k })).filter(({ P }) => !P.attach && P.piece.id === a.pieceId && (a.instance === undefined || P.instance === a.instance));
    for (const { P, k } of hosts) {
      const to = (lx: number, ly: number) => ({ x: a.x + c * lx - s * ly, y: a.y + s * lx + c * ly });
      if (hw.type === 'zipper') {
        const len = Math.max(1, a.h);
        const ns = Math.max(2, Math.ceil(len / ZIP_STEP) + 1);
        const start = zTri.length / 3;
        let got = 0;
        for (let i = 0; i < ns && zTri.length / 3 < MAX_ZIP_SAMPLES; i++) {
          const p = to(0, -len / 2 + (len * i) / (ns - 1));
          const l = loc(k).at(p.x, p.y);
          if (!l) continue;
          zTri.push(...l.tri); zW.push(...l.w); zSign.push(signs[k] * fs);
          got++;
        }
        if (got < 2) { zTri.length = start * 3; zW.length = start * 3; zSign.length = start; continue; }
        zFinish.push(fi); zSize.push(Math.max(0.5, hw.size)); zOpen.push(hw.open ? 1 : 0); zStart.push(start); zLen.push(got); zDesign.push(di);
        continue;
      }
      const n = Math.max(1, Math.min(60, Math.round(hw.count ?? 1)));
      const gap = hw.spacing ?? hw.size * 2.2;
      for (let i = 0; i < n && kind.length < MAX_ITEMS; i++) {
        const p = to((i - (n - 1) / 2) * gap, 0);
        const l = loc(k).at(p.x, p.y);
        if (!l) continue;
        const [al, be] = upOf(P, l.tri, dirX, dirY);
        kind.push(ti); finish.push(fi); size.push(hw.outline && hw.outline.length > 2 ? outlineExtent(hw.outline) : Math.max(0.2, hw.size)); design.push(di);
        tri.push(...l.tri); w.push(...l.w); sign.push(signs[k] * fs); up.push(al, be);
      }
    }
  }

  return {
    type: 'hardware', n: sim.n, count: kind.length,
    kind: new Uint8Array(kind), finish: new Uint8Array(finish), size: new Float32Array(size),
    tri: new Uint32Array(tri), w: new Float32Array(w), sign: new Float32Array(sign), up: new Float32Array(up),
    zipCount: zStart.length, zipFinish: new Uint8Array(zFinish), zipSize: new Float32Array(zSize), zipOpen: new Uint8Array(zOpen),
    zipStart: new Uint32Array(zStart), zipLen: new Uint32Array(zLen),
    zipTri: new Uint32Array(zTri), zipW: new Float32Array(zW), zipSign: new Float32Array(zSign),
    designs, design: new Uint16Array(design), zipDesign: new Uint16Array(zDesign),
  };
}
