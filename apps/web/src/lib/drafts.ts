import { APP_SLUG } from '../config';

/**
 * What you were typing in a post or story, kept on this phone so leaving the screen doesn't lose
 * it. Text only (never photos). Cleared when it is posted, and all of it when you sign out
 * (shared phones). Storage blocked: nothing is kept, which is fine.
 */
const PREFIX = `${APP_SLUG}.draft.`;

export function loadDraft(key: string): string {
  try { return localStorage.getItem(PREFIX + key) ?? ''; } catch { return ''; }
}
export function saveDraft(key: string, text: string): void {
  try {
    if (text.trim()) localStorage.setItem(PREFIX + key, text.slice(0, 5000));
    else localStorage.removeItem(PREFIX + key);
  } catch { /* storage blocked */ }
}
export function clearDraft(key: string): void {
  try { localStorage.removeItem(PREFIX + key); } catch { /* storage blocked */ }
}
export function clearAllDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* storage blocked */ }
}
