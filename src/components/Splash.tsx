import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../splash.css';

/* Start screen. The whole screen is one sheet of woven cloth with a stitched cut line across the middle and a pair of
   scissors resting in a short starting slit. Press Start: the scissors snip along the line, the cloth opens behind the
   blades as a V, then both halves fold back like cloth and reveal Home (already mounted underneath).
   One canvas, redrawn each frame, removed completely when the cut is done. Reduced motion: a quick crossfade. */

const T_MS = 2500; // the whole cut, first snip to the last cloth leaving
const BL = 56; // blade length in drawing units
const EA = 2.2; // how far the cutting edge sits from the pivot axis; blade edges cross at EA / sin(theta) ahead of the pivot
const TH_OPEN = (28 * Math.PI) / 180;
const TH_SHUT = (2.4 * Math.PI) / 180;
const D_OPEN = EA / Math.sin(TH_OPEN); // crossing distance when open
const D_SHUT = EA / Math.sin(TH_SHUT); // crossing distance when nearly closed
const D_ADV = D_SHUT - D_OPEN; // one snip advances the cut by this much
const CLOSE_FRAC = 0.62; // share of a snip spent closing (the cut advances), the rest opening (the scissors slide forward)
const CW = 20; // cloth strip width in px
const K = 8; // segments along a strip
const FRINGE = 7; // px of loose fibre along a cut edge
const PERSP = 2600;

const firstCut = (st: Uint8Array, n: number) => { for (let i = 0; i < n; i++) if (st[i] === 1) return i; return n; };
const clamp = (t: number, a = 0, b = 1) => Math.min(b, Math.max(a, t));
const smoother = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const smooth = (t: number) => t * t * (3 - 2 * t);
const skip = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('nosplash');
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type RGB = [number, number, number];
const parse = (s: string): RGB => {
  s = s.trim();
  if (s[0] === '#') {
    if (s.length === 4) s = '#' + [...s.slice(1)].map((c) => c + c).join('');
    return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  }
  const m = s.match(/[\d.]+/g) || ['128', '128', '128'];
  return [+m[0], +m[1], +m[2]];
};
const rgba = (c: RGB, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

type Pal = { base: RGB; hi: RGB; lo: RGB; fibre: RGB; thread: RGB; shade: RGB; steelHi: RGB; steelMid: RGB; steelLo: RGB; handle: RGB; handleHi: RGB; dark: boolean };
function readPalette(): Pal {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => parse(cs.getPropertyValue(n));
  const base = v('--fabric');
  return {
    base, hi: v('--fabric-hi'), lo: v('--fabric-lo'), fibre: v('--fabric-fibre'), thread: v('--fabric-thread'), shade: v('--fabric-shade'),
    steelHi: v('--steel-hi'), steelMid: v('--steel-mid'), steelLo: v('--steel-lo'), handle: v('--handle'), handleHi: v('--handle-hi'),
    dark: base[0] + base[1] + base[2] < 300,
  };
}

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };

/* ---------- the cloth: woven texture, soft light, and a frayed cut edge, rendered once per size and theme ---------- */
type Cloth = { full: HTMLCanvasElement; top: HTMLCanvasElement; bot: HTMLCanvasElement };

function buildCloth(w: number, h: number, dpr: number, pal: Pal): Cloth {
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  const full = mk(W, H);
  const c = full.getContext('2d')!;
  const rand = rng(7);
  const k = pal.dark ? 0.8 : 1;
  c.fillStyle = rgba(pal.base, 1);
  c.fillRect(0, 0, W, H);

  // plain weave: 2 x 2 tile of threads, each one a little cylinder of light
  const TW = Math.max(4, Math.round(6 * dpr)), cell = TW / 2;
  const tile = mk(TW, TW);
  const t = tile.getContext('2d')!;
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) {
    const warp = (cx + cy) % 2 === 0;
    const x0 = cx * cell, y0 = cy * cell;
    const g = warp ? t.createLinearGradient(x0, 0, x0 + cell, 0) : t.createLinearGradient(0, y0, 0, y0 + cell);
    g.addColorStop(0, rgba(pal.lo, 0.2 * k));
    g.addColorStop(0.5, rgba(pal.hi, 0.12 * k));
    g.addColorStop(1, rgba(pal.lo, 0.2 * k));
    t.fillStyle = g;
    t.fillRect(x0, y0, cell, cell);
  }
  c.fillStyle = c.createPattern(tile, 'repeat')!;
  c.fillRect(0, 0, W, H);

  // grain
  const NS = 96;
  const nc = mk(NS, NS);
  const nx = nc.getContext('2d')!;
  const id = nx.createImageData(NS, NS);
  for (let i = 0; i < NS * NS; i++) { const v = (rand() * 255) | 0; id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 22; }
  nx.putImageData(id, 0, 0);
  c.fillStyle = c.createPattern(nc, 'repeat')!;
  c.fillRect(0, 0, W, H);

  c.save();
  c.scale(dpr, dpr);
  // slubs: a few uneven threads
  c.lineCap = 'round';
  for (let i = 0; i < (w * h) / 5200; i++) {
    const horiz = rand() < 0.6;
    const x = rand() * w, y = rand() * h, len = 20 + rand() * 160;
    c.strokeStyle = rgba(rand() < 0.5 ? pal.hi : pal.lo, (0.025 + rand() * 0.04) * k);
    c.lineWidth = 0.6 + rand() * 0.8;
    c.beginPath(); c.moveTo(x, y); c.lineTo(horiz ? x + len : x, horiz ? y : y + len); c.stroke();
  }
  // soft light from the top left, gentle undulation, quiet vignette
  const lg = c.createLinearGradient(0, 0, w, h);
  lg.addColorStop(0, rgba(pal.hi, pal.dark ? 0.07 : 0.2));
  lg.addColorStop(0.5, rgba(pal.hi, 0));
  lg.addColorStop(1, rgba(pal.lo, pal.dark ? 0.3 : 0.14));
  c.fillStyle = lg; c.fillRect(0, 0, w, h);
  for (const f of [0.22, 0.52, 0.82]) {
    const bg = c.createLinearGradient(w * f - w * 0.16, 0, w * f + w * 0.16, h * 0.5);
    bg.addColorStop(0, rgba(pal.hi, 0)); bg.addColorStop(0.5, rgba(pal.hi, pal.dark ? 0.025 : 0.06)); bg.addColorStop(1, rgba(pal.hi, 0));
    c.fillStyle = bg; c.fillRect(0, 0, w, h);
  }
  const vg = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.78);
  vg.addColorStop(0, rgba(pal.lo, 0)); vg.addColorStop(1, rgba(pal.lo, pal.dark ? 0.4 : 0.17));
  c.fillStyle = vg; c.fillRect(0, 0, w, h);
  c.restore();

  // the two halves, each with the hinge (screen edge) at row 0 and the cut edge at row S, then a margin of loose fibres
  const S = h / 2, Sd = Math.round(S * dpr), Md = Math.round(FRINGE * dpr);
  const top = mk(W, Sd + Md), bot = mk(W, Sd + Md);
  const tc = top.getContext('2d')!, bc = bot.getContext('2d')!;
  tc.drawImage(full, 0, 0, W, Sd, 0, 0, W, Sd);
  bc.save(); bc.translate(0, Sd); bc.scale(1, -1);
  bc.drawImage(full, 0, H - Sd, W, Sd, 0, 0, W, Sd);
  bc.restore();
  for (const hc of [tc, bc]) {
    hc.save(); hc.scale(dpr, dpr);
    const Sy = Sd / dpr;
    // the thickness of the cloth at the cut: a paler band of exposed threads
    hc.fillStyle = rgba(pal.fibre, 0.5); hc.fillRect(0, Sy - 2.2, w, 2.2);
    hc.fillStyle = rgba(pal.lo, 0.16); hc.fillRect(0, Sy - 2.4, w, 0.7);
    hc.lineCap = 'round';
    for (let i = 0; i < w * 1.5; i++) {
      const x = rand() * w, len = 0.8 + Math.pow(rand(), 1.8) * (FRINGE - 1), a = (rand() - 0.5) * 1.0;
      hc.strokeStyle = rgba(rand() < 0.75 ? pal.fibre : pal.base, 0.3 + rand() * 0.5);
      hc.lineWidth = 0.45 + rand() * 0.55;
      hc.beginPath(); hc.moveTo(x, Sy - 0.9); hc.lineTo(x + Math.sin(a) * len, Sy + Math.cos(a) * len); hc.stroke();
    }
    hc.restore();
  }
  return { full, top, bot };
}

/* ---------- the scissors, drawn in blade units (pivot at 0,0, blades pointing +x, cutting edge on y = EA) ---------- */
type Ctx = CanvasRenderingContext2D;
function bladePath(c: Ctx) {
  c.beginPath();
  c.moveTo(-4, EA);
  c.lineTo(BL - 2.6, EA);
  c.quadraticCurveTo(BL + 0.5, EA - 0.05, BL, EA - 0.95);
  c.quadraticCurveTo(BL * 0.5, EA - 5.0, -4, EA - 6.3);
  c.closePath();
}
function frame(c: Ctx, px: number, py: number, s: number, theta: number, upper: boolean) {
  c.translate(px, py);
  c.rotate(upper ? -theta : theta);
  if (!upper) c.scale(1, -1);
  c.scale(s, s);
}
function drawBlade(c: Ctx, pal: Pal, steel: CanvasGradient) {
  bladePath(c);
  c.fillStyle = steel; c.fill();
  c.lineJoin = 'round';
  c.strokeStyle = rgba(pal.lo, 0.35); c.lineWidth = 0.45; c.stroke();
  // fuller groove and the bright bevel along the cutting edge
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(2, EA - 3.1); c.lineTo(BL - 16, EA - 2.25);
  c.strokeStyle = 'rgba(0,0,0,0.2)'; c.lineWidth = 0.55; c.stroke();
  c.beginPath(); c.moveTo(2, EA - 2.55); c.lineTo(BL - 16, EA - 1.75);
  c.strokeStyle = 'rgba(255,255,255,0.55)'; c.lineWidth = 0.4; c.stroke();
  c.beginPath(); c.moveTo(-3, EA - 0.28); c.lineTo(BL - 3, EA - 0.28);
  c.strokeStyle = 'rgba(255,255,255,0.95)'; c.lineWidth = 0.5; c.stroke();
  c.beginPath(); c.moveTo(-2, EA - 5.8); c.quadraticCurveTo(BL * 0.5, EA - 4.7, BL - 1, EA - 1.1);
  c.strokeStyle = 'rgba(255,255,255,0.5)'; c.lineWidth = 0.4; c.stroke();
}
function drawHandle(c: Ctx, pal: Pal) {
  c.lineCap = 'round';
  c.beginPath(); c.moveTo(-2.5, EA - 2.2); c.bezierCurveTo(-8, EA + 0.5, -12, EA + 4.5, -17.2, EA + 9.2);
  c.strokeStyle = rgba(pal.handle, 1); c.lineWidth = 4.8; c.stroke();
  c.beginPath(); c.ellipse(-27.4, EA + 14.2, 11.3, 8.2, 0.62, 0, Math.PI * 2);
  c.strokeStyle = rgba(pal.handle, 1); c.lineWidth = 4.6; c.stroke();
  // soft highlight on the top of the grip
  c.beginPath(); c.ellipse(-27.4, EA + 14.2, 12.4, 9.3, 0.62, Math.PI * 1.05, Math.PI * 1.75);
  c.strokeStyle = rgba(pal.handleHi, 0.5); c.lineWidth = 0.9; c.stroke();
  c.beginPath(); c.moveTo(-3.5, EA - 3.6); c.bezierCurveTo(-8.5, EA - 1, -12, EA + 2.8, -16.5, EA + 7.2);
  c.strokeStyle = rgba(pal.handleHi, 0.35); c.lineWidth = 0.8; c.stroke();
}

type Scene = {
  draw: (f: Frame) => void;
  x0: number; // where the cut front rests before Start
  s: number;
  dispose: () => void;
};
type Frame = { front: number; pivot: number; theta: number; fold: number; showScissors: boolean; split: number; backing: number };

function createScene(cv: HTMLCanvasElement, w: number, h: number): Scene {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const ctx = cv.getContext('2d')!;
  const pal = readPalette();
  const cloth = buildCloth(w, h, dpr, pal);
  const s = clamp(Math.min(w, h * 1.45) / 400, 2.5, 4.4);
  const x0 = 38 * s;
  const lineY = h / 2, S = h / 2;
  const nS = Math.ceil(w / CW);
  const G = 70 * (s / 3.6), GK = 150 * (s / 3.6), LIFT = 180;
  const D0 = w * 0.12, SP = w * 0.38;
  const stride = K + 2;
  const ptY = new Float32Array((nS + 2) * stride), ptF = new Float32Array((nS + 2) * stride), ptA = new Float32Array((nS + 2) * stride);
  const state = new Uint8Array(nS + 1); // 0 intact, 1 opening or folding, 2 gone

  // steel, light along the bevel and darker toward the back, defined once in blade units
  const steel = ctx.createLinearGradient(0, EA - 6.3, 0, EA);
  steel.addColorStop(0, rgba(pal.steelMid, 1)); steel.addColorStop(0.3, rgba(pal.steelHi, 1)); steel.addColorStop(0.72, rgba(pal.steelMid, 1)); steel.addColorStop(1, rgba(pal.steelLo, 1));

  const draw = (f: Frame) => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const { front, pivot, theta, fold } = f;
    const cutOn = front > 0;
    let gSum = 0;

    // 1. geometry along every column edge of the cut part (columns, so neighbouring strips share their edge heights)
    // the last column ends exactly at the cut front, so the slit apex is where the blades cross
    const xsAt = (c: number) => Math.min(c * CW, front, w);
    let firstIntact = nS;
    for (let i = 0; i < nS; i++) {
      if (i * CW >= front) { state[i] = 0; if (i < firstIntact) firstIntact = i; continue; }
      const xi = (xsAt(i) + xsAt(i + 1)) / 2;
      const uB = clamp((fold - xi - D0) / SP); gSum += smoother(uB); state[i] = uB >= 1 ? 2 : 1;
    }
    const gProg = nS ? gSum / nS : 0;
    const c0 = Math.max(0, firstCut(state, nS)), c1 = Math.min(nS, firstIntact + 1);
    for (let c = c0; c <= c1; c++) {
      const xc = xsAt(c);
      const dl = Math.max(0, front - xc);
      const uB = clamp((fold - xc - D0) / SP);
      const phi = (Math.PI / 2) * smoother(uB);
      const gap = G * (1 - Math.exp(-dl / GK));
      const ds = S / K;
      let y = 0, z = 0;
      const o = c * stride;
      for (let j = 0; j <= K; j++) {
        const l = j * ds;
        const lift = gap * Math.pow(Math.max(0, 1 - (S - l) / LIFT), 2);
        const fp = PERSP / (PERSP - Math.min(z, PERSP * 0.6));
        ptY[o + j] = lineY + (y - lift - lineY) * fp;
        ptF[o + j] = fp;
        if (j < K) {
          const am = Math.min(Math.PI / 2, phi * (1 + 0.55 * ((l + ds / 2) / S)));
          ptA[o + j] = am;
          y += Math.cos(am) * ds; z += Math.sin(am) * ds;
        }
      }
      ptA[o + K] = ptA[o + K - 1];
      ptY[o + K + 1] = ptY[o + K] + Math.cos(ptA[o + K]) * FRINGE * ptF[o + K];
    }
    const colX = (c: number, _j: number) => xsAt(c);

    // the opening: the cloth edges cast a soft shadow on whatever lies below
    const veil = (a: number, solid = 0) => {
      if (a <= 0.002 && solid <= 0.002) return;
      let iA = -1, iB = -1;
      for (let i = 0; i < nS; i++) if (state[i] === 1) { if (iA < 0) iA = i; iB = i; }
      if (iA < 0) return;
      const edge = (bottom: boolean) => {
        ctx.beginPath();
        for (let c = iA; c <= iB + 1; c++) {
          const X = colX(c, K), Y = bottom ? h - ptY[c * stride + K] : ptY[c * stride + K];
          if (c === iA) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
        }
      };
      ctx.save();
      ctx.beginPath();
      for (let c = iA; c <= iB + 1; c++) { const X = colX(c, K), Y = ptY[c * stride + K]; if (c === iA) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      for (let c = iB + 1; c >= iA; c--) ctx.lineTo(colX(c, K), h - ptY[c * stride + K]);
      ctx.closePath();
      ctx.clip();
      if (solid > 0.002) { ctx.fillStyle = rgba(pal.shade, solid); ctx.fillRect(0, 0, w, h); }
      ctx.lineJoin = 'round';
      for (const bottom of [false, true]) {
        edge(bottom);
        for (let q = 0; q < 12; q++) { ctx.lineWidth = (8 + q * q * 0.75) * (s / 3.6); ctx.strokeStyle = rgba(pal.shade, a * 0.035); ctx.stroke(); }
      }
      ctx.restore();
    };

    // 2. the opening, then the lower blade riding under the sheet
    const sc = f.showScissors;
    if (cutOn) veil(1 - gProg * 0.6, f.backing);
    if (sc) {
      ctx.save();
      ctx.beginPath(); ctx.rect(f.pivot, 0, w, h); ctx.clip();
      frame(ctx, pivot, lineY, s, theta, false);
      drawBlade(ctx, pal, steel);
      ctx.restore();
      if (cutOn) veil(0.7 * (1 - gProg * 0.6));
    }

    // 3. the cloth: untouched part in one piece, cut part strip by strip, each sheared to meet its neighbours
    if (firstIntact < nS) {
      const xs = Math.min(front, w);
      ctx.drawImage(cloth.full, xs * dpr, 0, cloth.full.width - xs * dpr, cloth.full.height, xs, 0, w - xs, h);
    }
    for (let hh = 0; hh < 2; hh++) {
      const img = hh === 0 ? cloth.top : cloth.bot;
      for (let i = 0; i < nS; i++) {
        if (state[i] !== 1) continue;
        const oL = i * stride, oR = (i + 1) * stride;
        const sx = i * CW, sw = xsAt(i + 1) - xsAt(i);
        const dl = front - (xsAt(i) + xsAt(i + 1)) / 2;
        for (let j = 0; j <= K; j++) {
          let yl1: number, yl2: number, yr1: number, yr2: number, srcY: number, srcH: number, alpha = 1;
          if (j < K) { yl1 = ptY[oL + j]; yl2 = ptY[oL + j + 1]; yr1 = ptY[oR + j]; yr2 = ptY[oR + j + 1]; srcY = (j * S) / K; srcH = S / K; }
          else { yl1 = ptY[oL + K]; yl2 = ptY[oL + K + 1]; yr1 = ptY[oR + K]; yr2 = ptY[oR + K + 1]; srcY = S; srcH = FRINGE; alpha = clamp(dl / 26) * clamp(Math.cos((ptA[oL + K] + ptA[oR + K]) / 2) * 1.6); }
          const mL = (yl1 + yl2) / 2, mR = (yr1 + yr2) / 2;
          const dh = Math.max(Math.abs(yl2 - yl1), Math.abs(yr2 - yr1)) + 1.1;
          if (dh < 1.15 || alpha <= 0) continue;
          const jj = Math.min(j, K - 1);
          const xL = colX(i, j === K ? K : j), xR = colX(i + 1, j === K ? K : j);
          const dw = xR - xL + 0.8;
          const slope = (mR - mL) / Math.max(1, xR - xL);
          const ytop = mL - dh / 2;
          if (hh === 0) ctx.setTransform(dpr, dpr * slope, 0, dpr, dpr * xL, dpr * ytop);
          else ctx.setTransform(dpr, -dpr * slope, 0, -dpr, dpr * xL, dpr * (h - ytop));
          ctx.globalAlpha = alpha;
          ctx.drawImage(img, sx * dpr, srcY * dpr, sw * dpr, srcH * dpr, 0, 0, dw, dh);
          const am = (ptA[oL + jj] + ptA[oR + jj]) / 2;
          let sh = 0.62 * (1 - Math.cos(am)) * 0.5;
          if (am > Math.PI / 2) sh += 0.1;
          if (sh > 0.02) { ctx.globalAlpha = Math.min(0.85, sh) * alpha; ctx.fillStyle = rgba(pal.shade, 1); ctx.fillRect(0, 0, dw, dh); }
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 4. the stitched guide on the uncut cloth, anchored to the cloth so it does not crawl
    ctx.save();
    ctx.beginPath(); ctx.rect(front, lineY - 8, w - front + 8, 16); ctx.clip();
    ctx.lineCap = 'round';
    ctx.setLineDash([8, 7.5]);
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = rgba(pal.dark ? pal.lo : pal.hi, pal.dark ? 0.5 : 0.7);
    ctx.beginPath(); ctx.moveTo(-4, lineY + 1.3); ctx.lineTo(w + 4, lineY + 1.3); ctx.stroke();
    ctx.strokeStyle = rgba(pal.thread, 0.92);
    ctx.beginPath(); ctx.moveTo(-4, lineY); ctx.lineTo(w + 4, lineY); ctx.stroke();
    ctx.restore();

    if (!sc) return;

    // 5. the lower blade, felt as a ridge under the sheet ahead of the cut
    ctx.save();
    ctx.beginPath(); ctx.rect(front - 1, 0, w, h); ctx.clip();
    frame(ctx, pivot, lineY, s, theta, false);
    bladePath(ctx);
    const dLoc = (front - pivot) / s;
    const rg = ctx.createLinearGradient(dLoc, 0, dLoc + 14, 0);
    rg.addColorStop(0, rgba(pal.shade, 0)); rg.addColorStop(1, rgba(pal.shade, 0.11));
    ctx.fillStyle = rg; ctx.fill();
    const rl = ctx.createLinearGradient(dLoc, 0, dLoc + 14, 0);
    rl.addColorStop(0, rgba(pal.hi, 0)); rl.addColorStop(1, rgba(pal.hi, pal.dark ? 0.1 : 0.45));
    ctx.strokeStyle = rl; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.restore();

    // 6. the lower handle (outside the cloth, always on top), then the upper blade over the cloth with its shadow
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, pivot, h); ctx.clip();
    frame(ctx, pivot, lineY, s, theta, false);
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetY = 4 * dpr;
    drawHandle(ctx, pal);
    ctx.shadowColor = 'transparent';
    ctx.restore();

    ctx.save();
    frame(ctx, pivot, lineY, s, theta, true);
    bladePath(ctx);
    ctx.shadowColor = 'rgba(0,0,0,0.34)'; ctx.shadowBlur = 10 * dpr; ctx.shadowOffsetY = 5 * dpr;
    ctx.fillStyle = rgba(pal.steelMid, 1); ctx.fill();
    ctx.shadowColor = 'transparent';
    drawBlade(ctx, pal, steel);
    ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 8 * dpr; ctx.shadowOffsetY = 4 * dpr;
    drawHandle(ctx, pal);
    ctx.shadowColor = 'transparent';
    ctx.restore();

    // 7. the pivot screw
    ctx.save();
    ctx.translate(pivot, lineY);
    const R = 2.9 * s;
    const sg = ctx.createRadialGradient(-R * 0.3, -R * 0.35, R * 0.1, 0, 0, R);
    sg.addColorStop(0, rgba(pal.steelHi, 1)); sg.addColorStop(1, rgba(pal.steelLo, 1));
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 4 * dpr; ctx.shadowOffsetY = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fillStyle = sg; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 0.9; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-R * 0.55, R * 0.25); ctx.lineTo(R * 0.55, -R * 0.25);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(1, s * 0.35); ctx.lineCap = 'round'; ctx.stroke();
    ctx.restore();
    void f.split;
  };
  return { draw, x0, s, dispose: () => { cv.width = 1; cv.height = 1; } };
}

export default function Splash() {
  const [phase, setPhase] = useState<'idle' | 'cutting' | 'done'>(() => (skip() ? 'done' : 'idle'));
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [themeTick, setThemeTick] = useState(0);
  const { w, h } = size;
  const rootRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const t0 = useRef(0);
  const idleTheta = useRef(0.4);
  const rm = reduced();

  useEffect(() => {
    let raf = 0;
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => setSize({ w: window.innerWidth, h: window.innerHeight })); };
    window.addEventListener('resize', on);
    const mo = new MutationObserver(() => setThemeTick((n) => n + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onMq = () => setThemeTick((n) => n + 1);
    mq.addEventListener?.('change', onMq);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', on); mo.disconnect(); mq.removeEventListener?.('change', onMq); };
  }, []);

  // keep the app underneath out of the tab order and away from screen readers while the front door is up
  useLayoutEffect(() => {
    if (phase === 'done') return;
    const app = document.querySelector('.app');
    app?.setAttribute('inert', '');
    return () => app?.removeAttribute('inert');
  }, [phase]);

  const start = () => {
    if (phase !== 'idle') return;
    if (rm) {
      setPhase('cutting');
      window.setTimeout(() => setPhase('done'), 260);
      return;
    }
    t0.current = performance.now();
    setPhase('cutting');
  };

  // Enter or Space starts, even before the button has focus
  useEffect(() => {
    if (phase !== 'idle') return;
    const on = (e: KeyboardEvent) => {
      if ((e.key === 'Enter' || e.key === ' ') && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); start(); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  });

  // when the splash goes, give Home its size back and land focus on its main action
  useEffect(() => {
    if (phase !== 'done') return;
    const home = document.querySelector<HTMLElement>('.home');
    if (home) home.style.removeProperty('scale');
    if (!document.activeElement || document.activeElement === document.body) document.querySelector<HTMLElement>('.new-card')?.focus({ preventScroll: true });
  }, [phase]);

  // build the cloth whenever the size or theme changes
  useLayoutEffect(() => {
    const cv = cvRef.current;
    if (!cv || phase === 'done') return;
    sceneRef.current?.dispose();
    sceneRef.current = createScene(cv, w, h);
    return () => { sceneRef.current?.dispose(); sceneRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, h, themeTick, phase === 'done']);

  // rAF loop: idle snipping, then the cut
  useEffect(() => {
    if (phase === 'done') return;
    const sc = sceneRef.current;
    if (!sc) return;
    const { s, x0 } = sc;
    const homeEl = document.querySelector<HTMLElement>('.home');
    const idleFrame = (th: number) => {
      const d = (EA / Math.sin(th)) * s;
      return { front: x0, pivot: x0 - d, theta: th, fold: 0, showScissors: true, split: 0, backing: 0.88 };
    };
    if (rm) { sc.draw(idleFrame((23 * Math.PI) / 180)); return; }

    // cut schedule: psi counts snips; the cloth's own fold follows the smooth reference fold = x0 + psi * snip length
    const snip = D_ADV * s;
    const X_end = w + w * 0.12 + w * 0.38 + 8;
    const psiEnd = (X_end - x0) / snip;
    const th0 = idleTheta.current;
    const dIdle0 = EA / Math.sin(th0);
    let raf = 0;
    const t00 = performance.now();
    const tick = (now: number) => {
      if (phase === 'idle') {
        const th = ((23 + 5 * Math.sin(((now - t00) / 2800) * Math.PI * 2)) * Math.PI) / 180;
        idleTheta.current = th;
        sc.draw(idleFrame(th));
      } else {
        const t = now - t0.current;
        const k = clamp(t / T_MS);
        const e = 0.3 * k + 0.7 * smoother(k);
        const psi = psiEnd * e;
        const n = Math.floor(psi), tau = psi - n;
        let dU: number, pivot: number;
        const xb = x0 - D_OPEN * s + n * snip; // pivot at the start of this snip
        if (tau < CLOSE_FRAC) {
          const q = smooth(tau / CLOSE_FRAC);
          dU = D_OPEN + D_ADV * q; pivot = xb;
        } else {
          const q = smooth((tau - CLOSE_FRAC) / (1 - CLOSE_FRAC));
          dU = D_SHUT - D_ADV * q; pivot = xb + snip * q;
        }
        // ease from wherever the idle snip was into the cutting rhythm
        const bl = smooth(clamp(t / 180));
        const dEff = dIdle0 + (dU - dIdle0) * bl;
        const front = n === 0 && t < 180 ? x0 : pivot + dEff * s;
        const piv = n === 0 && t < 180 ? x0 - dEff * s : pivot;
        const th = Math.asin(clamp(EA / dEff, 0, 1));
        sc.draw({ front: Math.max(front, x0), pivot: piv, theta: th, fold: x0 + psi * snip, showScissors: true, split: 0, backing: 0.88 * (1 - smooth(clamp(t / 450))) });
        const g = clamp((x0 + psi * snip - w * 0.2) / (w * 0.7));
        if (homeEl) homeEl.style.scale = String(0.96 + 0.04 * smoother(g));
        if (k >= 1) { setPhase('done'); return; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, w, h, themeTick, rm]);

  if (phase === 'done') return null;
  const cutting = phase === 'cutting';
  return createPortal(
    <div ref={rootRef} className={`splash ${phase} ${rm ? 'rm' : ''}`} role="dialog" aria-label="tech-it start screen">
      <canvas ref={cvRef} className="splash-canvas" aria-hidden="true" />
      <div className={`splash-head ${cutting ? 'away' : ''}`}>
        <h1>tech-it</h1>
        <p>Patterns, fit and tech packs in one place</p>
      </div>
      <div className={`splash-foot ${cutting ? 'away' : ''}`}>
        <button className={`splash-start ${cutting ? 'pressed' : ''}`} onClick={start} tabIndex={cutting ? -1 : 0} aria-hidden={cutting}>Start</button>
      </div>
    </div>,
    document.body,
  );
}

// blade geometry shared with the scene
const _unused = [BL, TH_SHUT];
void _unused;
