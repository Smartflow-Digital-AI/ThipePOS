'use client';

import { useEffect, useState } from 'react';

export const THEMES = ['light', 'dim', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_KEY = 'beautypos-theme';
export const DEFAULT_THEME: Theme = 'dark';

/**
 * The script that runs BEFORE paint, inlined into <head>.
 *
 * Without this the page renders in the default theme for one frame and
 * then flips — which on a light-mode tablet is a white-to-black flash
 * in the cashier's face every time they open the till. Blocking script
 * in the head is the correct tool here.
 */
export const themeScript = `
(function(){
  try {
    var t = localStorage.getItem('${THEME_KEY}');
    if (t !== 'light' && t !== 'dim' && t !== 'dark') {
      // No stored choice — follow the operating system.
      t = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : '${DEFAULT_THEME}';
    }
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', '${DEFAULT_THEME}');
  }
})();
`;

export function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode — the choice just won't persist */
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  // Read what the head script already decided, so we never disagree with it.
  useEffect(() => {
    const current = document.documentElement.getAttribute('data-theme') as Theme | null;
    if (current && THEMES.includes(current)) setTheme(current);
  }, []);

  return {
    theme,
    setTheme: (t: Theme) => {
      setTheme(t);
      applyTheme(t);
    },
  };
}
