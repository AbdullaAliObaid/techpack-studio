import { WEAVE_BASE } from '../data/fabrics';
import type { Fabric } from '../data/fabrics';

// Procedural, seamless fabric tiles drawn on a canvas. Shared by the 2D pattern fills and the 3D materials.

const cache = new Map<string, HTMLCanvasElement>();
const urlCache = new Map<string, string>();

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

export function fabricCanvas(f: Fabric, hex: string): HTMLCanvasElement {
  const key = f.id + hex;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  const [r0, g0, b0] = hexToRgb(hex);
  const rand = rng(f.id.length * 977 + 13);
  const noiseGrid = Array.from({ length: 16 * 16 }, () => rand());
  const blob = (x: number, y: number) => {
    // smooth value noise over a 16x16 wrapping grid
    const gx = (x / S) * 16, gy = (y / S) * 16;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const v = (i: number, j: number) => noiseGrid[((j + 16) % 16) * 16 + ((i + 16) % 16)];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = v(ix, iy) * (1 - sx) + v(ix + 1, iy) * sx;
    const b = v(ix, iy + 1) * (1 - sx) + v(ix + 1, iy + 1) * sx;
    return a * (1 - sy) + b * sy;
  };

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let k = 0; // brightness offset, roughly -0.2..0.2
      const n = rand() - 0.5;
      switch (WEAVE_BASE[f.weave] ?? f.weave) {
        case 'twill': {
          const d = (x + y) % 8;
          k = (d < 3 ? 0.1 : -0.06) + n * 0.12 + (blob(x, y) - 0.5) * 0.12;
          if (f.id.includes('denim') && (x * 7 + y * 3) % 23 === 0) k += 0.18; // white weft flecks
          break;
        }
        case 'canvas': {
          const cell = ((x >> 2) + (y >> 2)) % 2;
          const edge = x % 4 === 0 || y % 4 === 0 ? -0.08 : 0;
          k = (cell ? 0.05 : -0.04) + edge + n * 0.08;
          break;
        }
        case 'poplin':
          k = ((y % 2) ? 0.02 : -0.02) + n * 0.04;
          break;
        case 'linen': {
          const slubX = Math.sin((y + blob(x, 0) * 40) * 0.9) * 0.05;
          const slubY = Math.sin((x + blob(0, y) * 40) * 1.1) * 0.05;
          k = slubX + slubY + n * 0.1 + (blob(x * 3 % S, y) - 0.5) * 0.15;
          break;
        }
        case 'wool':
          k = n * 0.28 + (blob(x, y) - 0.5) * 0.15;
          break;
        case 'poly':
          k = Math.sin((x / S) * Math.PI * 2) * 0.04 + n * 0.03;
          break;
        case 'jersey': {
          const col = x % 6;
          const v = Math.abs(((y + (col < 3 ? col : 6 - col)) % 6) - 3) / 3;
          k = (v - 0.5) * 0.14 + n * 0.06;
          break;
        }
        case 'leather':
          k = (blob(x, y) - 0.5) * 0.25 + (blob((x * 4) % S, (y * 4) % S) - 0.5) * 0.12 + n * 0.04;
          break;
        case 'spandex':
          k = ((x + y * 2) % 6 < 2 ? 0.05 : -0.02) + n * 0.03;
          break;
      }
      const i = (y * S + x) * 4;
      const m = (v: number) => Math.max(0, Math.min(255, v + v * k + 255 * k * 0.35));
      img.data[i] = m(r0);
      img.data[i + 1] = m(g0);
      img.data[i + 2] = m(b0);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  cache.set(key, c);
  return c;
}

export function fabricDataUrl(f: Fabric, hex: string): string {
  const key = f.id + hex;
  let u = urlCache.get(key);
  if (!u) {
    u = fabricCanvas(f, hex).toDataURL();
    urlCache.set(key, u);
  }
  return u;
}
