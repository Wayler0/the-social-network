/**
 * Where to go after signing in. A signed-out member who opens a shared link (e.g. /post/123)
 * is sent to sign-in; this remembers the link for this tab so they land on the post afterwards.
 * Only paths inside the app are kept, so it can't be used to send someone to another site.
 */
const KEY = 'returnTo';

export const safeReturnPath = (path: string | null | undefined): string | null =>
  path && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\') ? path : null;

export function rememberReturnTo(path: string): void {
  const safe = safeReturnPath(path);
  if (!safe || safe === '/') return;
  try { sessionStorage.setItem(KEY, safe); } catch { /* storage blocked: they land on Home */ }
}

/** The remembered path (then forgets it), or null. */
export function takeReturnTo(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return safeReturnPath(path);
  } catch { return null; }
}
