import type { Attachment } from '../data/edits';
import { fabricById } from '../data/fabrics';
import { heightTile, weaveKind, weaveLook, type WeaveKind } from './detailsWeave';
import type { Look } from './detailsLook';

// Photo and print blend: an ink takes on the fabric it sits on. The weave's height tile darkens the ink in the grooves
// (a multiply), the same tile drives the ink's bump so the knit or twill shows through, and the gloss follows the host:
// leather and satin keep their shine, jersey and denim stay matte, ink on cloth soaks in a little (slightly see through).

export const DEFAULT_BLEND = 0.7;
/** is the print blended with its fabric (default on) and how strongly (0..1) */
export const blendOf = (a: Pick<Attachment, 'kind' | 'blend' | 'blendStrength'>): number =>
  a.kind === 'print' && a.blend !== false ? Math.max(0, Math.min(1, a.blendStrength ?? DEFAULT_BLEND)) : 0;

export interface HostLook { kind: WeaveKind; bump: number; periodCm: number; look: Look; opacity: number; denim: boolean }

export function hostLook(fabricId: string): HostLook {
  const f = fabricById(fabricId);
  const kind = weaveKind(f.weave, f.id);
  const w = weaveLook(kind);
  const denim = /denim|jean/.test(f.id);
  const base: Look = { roughness: Math.max(0.75, w.roughness ?? f.roughness), metalness: 0, clearcoat: 0, clearcoatRoughness: 0.5, sheen: 0, envMapIntensity: 1 };
  let opacity = denim ? 0.8 : 0.9; // ink absorption on cloth
  if (kind === 'leather') { Object.assign(base, { roughness: 0.34, clearcoat: 0.28, clearcoatRoughness: 0.22, envMapIntensity: 1.2 }); opacity = 1; }
  else if (kind === 'satin') { Object.assign(base, { roughness: 0.4, clearcoat: 0.15, clearcoatRoughness: 0.35, sheen: 0.7 }); opacity = 0.97; }
  else if (kind === 'poly' || kind === 'spandex') { Object.assign(base, { roughness: 0.6, sheen: 0.2 }); opacity = 0.95; }
  return { kind, bump: w.bump, periodCm: w.periodCm, look: base, opacity, denim };
}

const shade = new Map<string, HTMLCanvasElement>();
/** black with alpha = strength * (1 - height): painted source-atop over ink it multiplies the ink by the weave */
export function shadeTile(kind: WeaveKind, strength: number): HTMLCanvasElement {
  const q = Math.round(strength * 10);
  const key = kind + q;
  let c = shade.get(key);
  if (c) return c;
  const h = heightTile(kind);
  c = document.createElement('canvas');
  c.width = h.width; c.height = h.height;
  const src = h.getContext('2d')!.getImageData(0, 0, h.width, h.height), g = c.getContext('2d')!, out = g.createImageData(h.width, h.height);
  for (let i = 0; i < h.width * h.height; i++) { out.data[i * 4 + 3] = Math.round(255 * (q / 10) * 0.6 * (1 - src.data[i * 4] / 255)); }
  g.putImageData(out, 0, 0);
  shade.set(key, c);
  return c;
}

/** fill the whole canvas with a tile repeating every periodCm, anchored to the piece's cm origin, k px per cm */
export function fillWeave(ctx: CanvasRenderingContext2D, tile: HTMLCanvasElement, periodCm: number, x0: number, y0: number, k: number, mode: GlobalCompositeOperation = 'source-over') {
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  const s = (periodCm * k) / tile.width;
  pat.setTransform(new DOMMatrix().translate(-x0 * k, -y0 * k).scale(s, s));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = mode;
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
