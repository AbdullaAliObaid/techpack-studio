// Font stacks of the Design workspace's text layers, shared by every place that draws or traces text (the Design canvas,
// the chart, the 3D print pass and the letter outlines in src/lib/textTrace.ts). No DOM needed, so the worker can use it.

/** Font styles of text layers. The Design workspace sets `font` on a layer; without it the bold system face is used. */
export const FONT_STACKS: Record<string, string> = {
  classic: `700 {h}px Georgia, 'Times New Roman', serif`,
  varsity: `900 {h}px Rockwell, 'Roboto Slab', 'Arial Black', serif`,
  script: `italic 700 {h}px 'Snell Roundhand', 'Brush Script MT', 'Segoe Script', cursive`,
  block: `900 {h}px Impact, 'Arial Black', sans-serif`,
  mono: `700 {h}px 'SF Mono', Menlo, Consolas, monospace`,
};
/** canvas font for a font id at height h (px) */
export const fontCss = (font: string | undefined, h: number) => (FONT_STACKS[font ?? ''] ?? '700 {h}px system-ui, sans-serif').replace('{h}', String(h));
/** the text as every renderer shows it: runs of spaces collapse (SVG does) and the ends are trimmed */
export const cleanText = (t: string | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();

/**
 * How far below the middle line the alphabetic baseline sits for the font set on ctx (px). SVG text with
 * dominant-baseline "central" (the Design canvas) centres the font's ascent-descent box; canvas "middle" centres the em
 * square, which is a little higher. Everything that must land where the Design canvas does draws on the alphabetic
 * baseline at this offset instead.
 */
export function centralShift(ctx: { measureText(t: string): TextMetrics }, size: number): number {
  const m = ctx.measureText('Hg');
  return m.fontBoundingBoxAscent !== undefined && m.fontBoundingBoxDescent !== undefined ? (m.fontBoundingBoxAscent - m.fontBoundingBoxDescent) / 2 : 0.35 * size;
}
