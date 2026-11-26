import { useEffect, useState } from 'react';

/** Wide screens dock the Design panel beside the chart; iPad and narrower screens use a bottom sheet under it. */
const WIDE = '(min-width: 1400px)';
export function useDockMode(): 'side' | 'bottom' {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide ? 'side' : 'bottom';
}
