import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getMe, logout, onSignedOut, type Me } from './api';

/**
 * Signed-in state for the whole app, from GET /api/me. The session itself is an HttpOnly cookie
 * the API sets and the app never reads; asking the API is the only way to know.
 *   loading   – still asking (show a splash, not the sign-up screen)
 *   signedOut – no session
 *   signedIn  – `me` is the member; `me.profileComplete` false means onboarding comes first
 */
type Status = 'loading' | 'signedOut' | 'signedIn';
type Auth = {
  status: Status;
  me: Me | null;
  /** Problem reaching the API on start-up (offline, server down); signed-out screens show it. */
  error: string | null;
  /** Ask the API again, e.g. right after verify-code set the cookie. */
  refresh: () => Promise<void>;
  /** Put an updated profile in place (PATCH /api/me returns it). */
  setMe: (me: Me) => void;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMeState] = useState<Me | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const found = await getMe();
      setMeState(found);
      setStatus(found ? 'signedIn' : 'signedOut');
      setError(null);
    } catch (err) {
      setMeState(null);
      setStatus('signedOut');
      setError(err instanceof Error ? err.message : 'Could not reach the server.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Any 401 from the API (session expired, logged out elsewhere, account deleted) signs the app out.
  useEffect(() => onSignedOut(() => { setMeState(null); setStatus('signedOut'); }), []);

  const setMe = useCallback((next: Me) => { setMeState(next); setStatus('signedIn'); }, []);

  const signOut = useCallback(async () => {
    try { await logout(); } catch { /* signed out on this device either way */ }
    setMeState(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo(() => ({ status, me, error, refresh, setMe, signOut }), [status, me, error, refresh, setMe, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
