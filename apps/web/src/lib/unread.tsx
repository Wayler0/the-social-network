import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth';
import { getNotifications } from './notifications';

/**
 * The unread notifications count for the top bar. Checked on start, every minute while the app is
 * on screen, when the app comes back to the front, and when a push arrives (the service worker tells us).
 * No WebSocket yet: a minute's delay is fine for an inbox, and polling stops while the tab is hidden.
 */
const POLL_MS = 60_000;

type Unread = { count: number; setCount: (n: number) => void; refresh: () => void };
const UnreadContext = createContext<Unread>({ count: 0, setCount: () => undefined, refresh: () => undefined });

export function UnreadProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    if (status !== 'signedIn') return;
    getNotifications(null, 1).then((r) => setCount(r.unreadCount)).catch(() => undefined);
  }, [status]);

  useEffect(() => {
    if (status !== 'signedIn') { setCount(0); return; }
    refresh();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const onMessage = (e: MessageEvent) => { if (e.data?.type === 'push') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
    };
  }, [status, refresh]);

  const value = useMemo(() => ({ count, setCount, refresh }), [count, refresh]);
  return <UnreadContext.Provider value={value}>{children}</UnreadContext.Provider>;
}

export const useUnread = () => useContext(UnreadContext);
