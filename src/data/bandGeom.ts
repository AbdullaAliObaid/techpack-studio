// Band geometry shared by the 2D chart and the 3D print pass. A band is a plane through the garment: with an angle it
// tilts, so on each piece its reference line is shifted by tan(angle) * the worn x of the point (worn x: + is the wearer's
// left, see CLAUDE.md Sides). Front pieces are drawn as worn, back pieces from outside, so their pattern x is mirrored.
import type { Band } from './edits';

export const BAND_MAX_ANGLE = 60;
export const clampBandAngle = (a: number | undefined) => Math.max(-BAND_MAX_ANGLE, Math.min(BAND_MAX_ANGLE, Number.isFinite(a) ? (a as number) : 0));

/** dy/dx of the band lines in a piece's own pattern coordinates (y runs down). Only front and back pieces tilt. */
export function bandSlope(b: Pick<Band, 'angle'>, role: string): number {
  const a = clampBandAngle(b.angle);
  if (!a) return 0;
  const t = Math.tan((a * Math.PI) / 180);
  return role === 'front' ? t : role === 'back' ? -t : 0;
}

/** the corners of a stripe between pattern x `xa` and `xb` (y0, y1 are at x = 0) */
export const stripeCorners = (s: { y0: number; y1: number; slope?: number }, xa: number, xb: number): [number, number][] => {
  const m = s.slope ?? 0;
  return [[xa, s.y0 + m * xa], [xb, s.y0 + m * xb], [xb, s.y1 + m * xb], [xa, s.y1 + m * xa]];
};
