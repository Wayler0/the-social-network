import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { APP_SLUG } from '../config';
import { getMe, logout, onSignedOut } from './api';
import { clearFeed } from './feed-store';
import { forgetPushOnThisDevice } from './notifications';
import type { Me } from './profile';

/**
 * Who is signed in. The real session is an HttpOnly cookie set by the API, so on start we
 * ask GET /api/me. In mock mode a localStorage flag stands in for the cookie.
 */
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const FLAG = `${APP_SLUG}.mockSignedIn`;

/** 'unreachable': the server couldn't be asked (no data, weak Wi-Fi, a deploy restarting it). The session may be
 * perfectly fine, so we must NOT show sign-in: only a 401 means signed out. */
type Status = 'loading' | 'signedOut' | 'signedIn' | 'unreachable';
type Auth = {
  status: Status;
  me: Me | null;
  /** Call after the code is verified: loads the member. */
  signIn: () => Promise<Me | null>;
  signOut: () => Promise<void>;
  /** Try reaching the server again now (shown when it couldn't be reached). */
  retryNow: () => void;
  /** Replace the cached member after an update. */
  setMe: (me: Me | null) => void;
};
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMeState] = useState<Me | null>(null);

  const setMe = useCallback((next: Me | null) => {
    if (!next) clearFeed(); // signed out or account deleted: nothing from this account stays in memory
    setMeState(next);
    setStatus(next ? 'signedIn' : 'signedOut');
  }, []);

  // Who am I? Only a 401 (getMe → null) means signed out. Any other failure keeps the session and
  // retries: every few seconds, and as soon as the phone is back online.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    getMe()
      .then((m) => { if (alive) setMe(m); })
      .catch(() => { if (alive) setStatus((s) => (s === 'signedIn' ? s : 'unreachable')); });
    return () => { alive = false; };
  }, [setMe, attempt]);
  useEffect(() => {
    if (status !== 'unreachable') return;
    const retry = () => setAttempt((n) => n + 1);
    const timer = window.setTimeout(retry, Math.min(30_000, 3000 * 2 ** Math.min(attempt, 4)));
    window.addEventListener('online', retry);
    return () => { window.clearTimeout(timer); window.removeEventListener('online', retry); };
  }, [status, attempt]);
  const retryNow = useCallback(() => { setStatus('loading'); setAttempt((n) => n + 1); }, []);

  // A 401 from any later request means the session ended: back to sign-in.
  useEffect(() => onSignedOut(() => setMe(null)), [setMe]);

  const signIn = useCallback(async () => {
    if (MOCK) try { localStorage.setItem(FLAG, '1'); } catch { /* storage blocked */ }
    const m = await getMe();
    setMe(m);
    return m;
  }, [setMe]);

  const signOut = useCallback(async () => {
    // Unsubscribe this browser first (needs the session), so the next person here doesn't get our pushes.
    await forgetPushOnThisDevice();
    try { await logout(); } finally { setMe(null); }
  }, [setMe]);

  const value = useMemo(() => ({ status, me, signIn, signOut, setMe, retryNow }), [status, me, signIn, signOut, setMe, retryNow]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
