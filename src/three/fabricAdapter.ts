// The only place that knows whether the fabric library (src/data/fabrics.ts) already ships `patternTile` and
// `fabricHex`. Contract:
//   patternTile(p: FabricPattern): { size: [w, h] cm, svg: string }   one seamless repeat, drawn at p.scale
//   fabricHex(pf: { id, color, hex? }): string                         custom hex, else the fabric's palette colour
// Until the fabrics agent's versions land, a small local fallback (stripe, gingham, plaid, polka, camo and a few
// siblings) is used. Once src/data/fabrics.ts exports the real ones they win automatically, and this file can shrink.

import * as F from '../data/fabrics';
import type { FabricPattern } from '../data/fabrics';

export interface PatternTile { size: [number, number]; svg: string }
export interface FabricRef { id: string; color: number; hex?: string; pattern?: FabricPattern }

const lib = F as unknown as {
  patternTile?: (p: FabricPattern) => PatternTile;
  fabricHex?: (pf: FabricRef) => string;
};

export function fabricHex(pf: { id: string; color: number; hex?: string }): string {
  if (lib.fabricHex) return lib.fabricHex(pf);
  if (pf.hex) return pf.hex;
  const f = F.fabricById(pf.id);
  return (f.colors[pf.color] ?? f.colors[0]).hex;
}

export const hasRealPatterns = () => !!lib.patternTile;

export function patternTile(p: FabricPattern): PatternTile {
  if (lib.patternTile) return lib.patternTile(p);
  return fallbackTile(p);
}

/* ---------- local fallback ---------- */

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

function wrap(w: number, h: number, body: string, bg: string) {
  // drawn at 40 px per cm so the browser rasterises sharply
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 40}" height="${h * 40}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;
}

function fallbackTile(p: FabricPattern): PatternTile {
  const c = p.colors.length ? p.colors : ['#ffffff'];
  const g = c[0], a = c[1] ?? '#333333', b = c[2] ?? a;
  const s = Math.max(0.5, p.scale || 4);
  switch (p.id) {
    case 'stripe': case 'awning': case 'breton': {
      const body = p.id === 'breton'
        ? `<rect y="0" width="${s}" height="${s / 2}" fill="${a}"/>`
        : `<rect x="${s * 0.25}" width="${s * 0.5}" height="${s}" fill="${a}"/>`;
      return { size: [s, s], svg: wrap(s, s, body, g) };
    }
    case 'pinstripe': {
      const t = s * 0.04;
      return { size: [s, s], svg: wrap(s, s, `<rect x="${s / 2 - t / 2}" width="${t}" height="${s}" fill="${a}"/>`, g) };
    }
    case 'gingham': case 'check': {
      const o = p.id === 'gingham' ? 0.5 : 1;
      return { size: [s, s], svg: wrap(s, s, `<rect width="${s / 2}" height="${s}" fill="${a}" opacity="${o}"/><rect width="${s}" height="${s / 2}" fill="${a}" opacity="${o}"/>`, g) };
    }
    case 'plaid': case 'tartan': case 'windowpane': {
      const L = (x: number, w: number, col: string, o = 1) => `<rect x="${x}" width="${w}" height="${s}" fill="${col}" opacity="${o}"/><rect y="${x}" width="${s}" height="${w}" fill="${col}" opacity="${o}"/>`;
      const body = L(s * 0.1, s * 0.3, a, 0.55) + L(s * 0.55, s * 0.14, b, 0.6) + L(s * 0.8, s * 0.02, '#ffffff', 0.7) + L(s * 0.25, s * 0.03, g, 0.9);
      return { size: [s, s], svg: wrap(s, s, body, g) };
    }
    case 'polka': case 'pindot': {
      const r = s * (p.id === 'polka' ? 0.14 : 0.06);
      return { size: [s, s], svg: wrap(s, s, `<circle cx="${s / 4}" cy="${s / 4}" r="${r}" fill="${a}"/><circle cx="${s * 0.75}" cy="${s * 0.75}" r="${r}" fill="${a}"/>`, g) };
    }
    case 'camo': {
      const S = s * 2, r = rng(77);
      let body = '';
      [a, b, c[3] ?? '#222222'].forEach((col, k) => {
        for (let i = 0; i < 9; i++) {
          const x = r() * S, y = r() * S, rx = S * (0.07 + r() * 0.1), ry = rx * (0.5 + r() * 0.6), rot = r() * 180;
          for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S], [S, S], [-S, -S], [S, -S], [-S, S]]) {
            body += `<ellipse cx="${x + ox}" cy="${y + oy}" rx="${rx}" ry="${ry}" transform="rotate(${rot + k * 20} ${x + ox} ${y + oy})" fill="${col}"/>`;
          }
        }
      });
      return { size: [S, S], svg: wrap(S, S, body, g) };
    }
    default:
      return { size: [s, s], svg: wrap(s, s, '', g) };
  }
}
