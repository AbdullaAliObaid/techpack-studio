import { useEffect, useState } from 'react';
import { useStore, writeTheme, type ThemePref } from '../store';

const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

/** Resolve the stored preference to the theme actually shown. */
export function resolveTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref === 'system') return mq().matches ? 'dark' : 'light';
  return pref;
}

/** Keep <html data-theme> in step with the preference and the system setting. */
export function useApplyTheme() {
  const theme = useStore((s) => s.theme);
  useEffect(() => {
    const apply = () => {
      document.documentElement.dataset.theme = resolveTheme(theme);
      document.documentElement.style.colorScheme = resolveTheme(theme);
      window.dispatchEvent(new Event('tps-theme'));
    };
    apply();
    writeTheme(theme);
    const m = mq();
    m.addEventListener('change', apply);
    return () => m.removeEventListener('change', apply);
  }, [theme]);
}

/** Read CSS variables for places CSS cannot reach (WebGL colours). Updates when the theme changes. */
export function useCssVars<K extends string>(names: readonly K[]): Record<K, string> {
  const read = () => {
    const cs = getComputedStyle(document.documentElement);
    return Object.fromEntries(names.map((n) => [n, cs.getPropertyValue(n).trim()])) as Record<K, string>;
  };
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => requestAnimationFrame(() => setV(read()));
    window.addEventListener('tps-theme', on);
    on();
    return () => window.removeEventListener('tps-theme', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
