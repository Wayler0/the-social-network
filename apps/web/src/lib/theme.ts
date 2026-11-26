import { useSyncExternalStore } from 'react';
import { APP_SLUG, THEME_COLOR } from '../config';

/**
 * Light or dark theme. "System" (the default) follows the phone's setting; Light or Dark is
 * remembered on this phone only (a convenience, not account data). The colours are tokens in
 * styles/tokens.css; this only sets data-theme on <html> and the status-bar colour.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = `${APP_SLUG}.theme`;
const DARK_BAR = '#121119';
const media = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
const listeners = new Set<() => void>();

export function getTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch { return 'system'; }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const dark = choice === 'dark' || (choice === 'system' && !!media?.matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? DARK_BAR : THEME_COLOR);
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch { /* storage blocked: still applies for this visit */ }
  current = choice;
  apply(choice);
  listeners.forEach((l) => l());
}

let current: ThemeChoice = 'system';

/** Call once before the first render, so the page never flashes the wrong theme. */
export function startTheme() {
  current = getTheme();
  apply(current);
  media?.addEventListener?.('change', () => { if (current === 'system') apply('system'); });
}

export function useTheme(): ThemeChoice {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current, () => 'system');
}
