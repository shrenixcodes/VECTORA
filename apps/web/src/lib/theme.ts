import { useEffect, useSyncExternalStore } from 'react';
import type { Settings } from '@vectora/shared';
import { type Palette, paletteFor } from './tokens';

const media = (q: string) => ({
  subscribe: (cb: () => void) => {
    const m = window.matchMedia(q);
    m.addEventListener('change', cb);
    return () => m.removeEventListener('change', cb);
  },
  get: () => window.matchMedia(q).matches,
});
const darkMedia = media('(prefers-color-scheme: dark)');
const motionMedia = media('(prefers-reduced-motion: reduce)');

export type ThemeSetting = 'light' | 'dark' | 'system';

/** Resolves the theme setting against the system preference and applies it to the document. */
export function useTheme(setting: ThemeSetting | undefined): 'light' | 'dark' {
  const systemDark = useSyncExternalStore(darkMedia.subscribe, darkMedia.get, () => false);
  const stored = (
    typeof localStorage !== 'undefined' ? localStorage.getItem('vectora-theme') : null
  ) as ThemeSetting | null;
  const effective = setting ?? stored ?? 'system';
  const theme = effective === 'system' ? (systemDark ? 'dark' : 'light') : effective;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (setting) localStorage.setItem('vectora-theme', setting);
  }, [theme, setting]);
  return theme;
}

/** True when motion should be reduced, from settings or the system preference. */
export function useReducedMotion(settings: Settings | null): boolean {
  const system = useSyncExternalStore(motionMedia.subscribe, motionMedia.get, () => false);
  const pref = settings?.performance.reducedMotion ?? 'system';
  const reduced =
    pref === 'on' || settings?.graph.animationIntensity === 'none' || (pref === 'system' && system);
  useEffect(() => {
    const el = document.documentElement;
    if (pref === 'on' || settings?.graph.animationIntensity === 'none') el.dataset.motion = 'reduced';
    else if (pref === 'off') el.dataset.motion = 'full';
    else delete el.dataset.motion;
  }, [pref, settings?.graph.animationIntensity]);
  return reduced;
}

export const usePalette = (theme: 'light' | 'dark'): Palette => paletteFor(theme);
