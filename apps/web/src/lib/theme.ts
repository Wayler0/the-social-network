import { useSyncExternalStore } from 'react';
import { APP_SLUG, DARK_SURFACE, THEME_COLOR } from '../config';

/**
 * Light or dark theme. Dark is the default look (DECIDED 25 Nov 2026: testers love it); members
 * can pick Light, or System to follow the phone. The choice is remembered on this phone only (a
 * convenience, not account data). index.html starts with data-theme="dark" so the first frame is
 * already dark; the colours are tokens in styles/tokens.css.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = `${APP_SLUG}.theme`;
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'system' ? v : 'dark';
  } catch { return 'dark'; }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const dark = choice === 'dark' || (choice === 'system' && !!media?.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? DARK_SURFACE : THEME_COLOR);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'dark') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* storage blocked: still applies for this visit */ }
  current = choice;
  apply(choice);
  listeners.forEach((l) => l());
}

let current: ThemeChoice = 'dark';

/** Call once before the first render, so the page never flashes the wrong theme. */
export function startTheme() {
  current = getTheme();
  apply(current);
  media?.addEventListener?.('change', () => { if (current === 'system') apply('system'); });
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => 'dark');
}
