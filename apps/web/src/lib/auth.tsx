import { APP_SLUG } from '../config';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * Signed-in state for the app shell. The real session is an HttpOnly cookie set by the API;
 * once Kim's GET /api/me exists, this will ask the server instead.
 * In mock mode we remember the flag in localStorage so a refresh keeps you signed in.
 */
const MOCK = import.meta.env.VITE_API_MOCK === 'true';
const KEY = `${APP_SLUG}.mockSignedIn`;

function readFlag(): boolean {
  if (!MOCK) return false;
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

type Auth = { signedIn: boolean; signIn: () => void; signOut: () => void };
const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(readFlag);
  const signIn = useCallback(() => {
    setSignedIn(true);
    if (MOCK) try { localStorage.setItem(KEY, '1'); } catch { /* storage blocked */ }
  }, []);
  const signOut = useCallback(() => {
    setSignedIn(false);
    try { localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  }, []);
  const value = useMemo(() => ({ signedIn, signIn, signOut }), [signedIn, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
