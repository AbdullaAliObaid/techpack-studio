export type Units = 'cm' | 'in';

export const toUnit = (cm: number, u: Units) => (u === 'cm' ? cm : cm / 2.54);
export const fromUnit = (v: number, u: Units) => (u === 'cm' ? v : v * 2.54);

export function fmt(cm: number, u: Units, digits?: number): string {
  const v = toUnit(cm, u);
  const d = digits ?? (u === 'cm' ? 1 : 2);
  return u === 'cm' ? `${v.toFixed(d)} cm` : `${v.toFixed(d)}″`;
}

export const uid = () => Math.random().toString(36).slice(2, 10);
