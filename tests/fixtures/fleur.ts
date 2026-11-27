// A simple vector fleur de lis in the unit box (-0.5..0.5, y down) for tests and screenshots. Two colours: gold petals
// and a darker band. Left side is the mirror image of the right side.
type Pair = [number, number];
const num = (d: string) => d.match(/-?\d*\.?\d+/g)!.map(Number);
/** mirror an absolute M / L / C / Z path left to right */
const mirrorX = (d: string) => d.replace(/([MLC])([^MLCZ]*)/g, (_, c: string, args: string) => {
  const n = num(args);
  const out: Pair[] = [];
  for (let i = 0; i < n.length; i += 2) out.push([-n[i], n[i + 1]]);
  return c + out.map(([x, y]) => `${x} ${y}`).join(' ');
});

const RIGHT = 'M0.08 0.08C0.14 -0.08 0.3 -0.16 0.42 -0.1C0.5 -0.05 0.5 0.1 0.4 0.16C0.34 0.2 0.26 0.18 0.24 0.12C0.3 0.12 0.36 0.08 0.34 0.02C0.3 -0.04 0.2 0 0.15 0.12C0.12 0.16 0.1 0.18 0.06 0.16Z';
const CENTRE = 'M0 -0.5C0.12 -0.38 0.17 -0.22 0.13 -0.06C0.1 0.06 0.04 0.12 0 0.16C-0.04 0.12 -0.1 0.06 -0.13 -0.06C-0.17 -0.22 -0.12 -0.38 0 -0.5Z';
const BAND = 'M-0.24 0.2L0.24 0.2L0.24 0.29L-0.24 0.29Z';
const TAIL = 'M-0.11 0.31C-0.06 0.38 -0.02 0.44 0 0.5C0.02 0.44 0.06 0.38 0.11 0.31Z';

export const FLEUR_PATHS = [
  { color: '#c9a24a', path: CENTRE + RIGHT + mirrorX(RIGHT) + TAIL },
  { color: '#8a6a1f', path: BAND },
];
export const FLEUR_ASPECT = 1;
