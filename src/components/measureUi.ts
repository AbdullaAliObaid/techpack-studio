import { useStore } from '../store';
import type { MeasureTarget } from '../data/measureEdit';
import type { Units } from '../lib/units';

/** Apply a typed measurement through the store (units of the field). */
export const setMeasureFrom = (target: MeasureTarget, typed: number, units: Units) => useStore.getState().setMeasure(target, typed, units);
