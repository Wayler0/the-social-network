import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { APP_SLUG } from '../config';
import { getMe, logout } from './api';
import type { Me } from './profile';

/**
 * Who is signed in. The real session is an HttpOnly cookie set by the API, so on start we
 * ask GET /api/me. In mock mode a localStorage flag stands in for the cookie.
 */
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const FLAG = `${APP_SLUG}.mockSignedIn`;

type Status = 'loading' | 'signedOut' | 'signedIn';
type Auth = {
  status: Status;
  me: Me | null;
  /** Call after the code is verified: loads the member. */
  signIn: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  /** Replace the cached member after an update. */
  setMe: (me: Me | null) => void;
};
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMeState] = useState<Me | null>(null);

  const setMe = useCallback((next: Me | null) => {
    setMeState(next);
    setStatus(next ? 'signedIn' : 'signedOut');
  }, []);

  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => { if (alive) setMe(m); })
      .catch(() => { if (alive) setMe(null); }); // offline or server down: show sign-in, not a blank page
    return () => { alive = false; };
  }, [setMe]);

  const signIn = useCallback(async () => {
    if (MOCK) try { localStorage.setItem(FLAG, '1'); } catch { /* storage blocked */ }
    const m = await getMe();
    setMe(m);
    return m;
  }, [setMe]);

  const signOut = useCallback(async () => {
    try { await logout(); } finally { setMe(null); }
  }, [setMe]);

  const value = useMemo(() => ({ status, me, signIn, signOut, setMe }), [status, me, signIn, signOut, setMe]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
