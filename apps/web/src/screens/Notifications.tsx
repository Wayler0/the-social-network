import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar } from '../components/Avatar';
import { Icon, type IconName } from '../components/Icon';
import { timeAgo } from '../lib/feed';
import {
  describe, getNotifications, getPushState, hasScreen, markAllRead, markRead, turnPushOn,
  type Notification, type NotificationType, type PushState,
} from '../lib/notifications';
import { useUnread } from '../lib/unread';
import { APP_SLUG } from '../config';

const ICONS: Record<NotificationType, IconName> = {
  comment: 'comment', answer: 'question', follow: 'profile', group_request: 'people', group_approved: 'people', event_cancelled: 'calendar',
  story: 'plus', office_story: 'megaphone',
};
const DISMISS_KEY = `${APP_SLUG}.pushPromptDismissed`;

/** The inbox (docs/api-contract.md section 15): newest first, unread marked, tap to open and mark read. */
export function Notifications() {
  const navigate = useNavigate();
  const { count, setCount } = useUnread();
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (from: string | null) => {
    if (from) setLoadingMore(true);
    try {
      const page = await getNotifications(from);
      setItems((prev) => (from ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setCount(page.unreadCount);
      setState('ready');
    } catch { if (!from) setState('error'); }
    finally { setLoadingMore(false); }
  }, [setCount]);

  useEffect(() => { void load(null); }, [load]);

  async function open(n: Notification) {
    if (!n.read) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      markRead([n.id]).then((r) => setCount(r.unreadCount)).catch(() => undefined);
    }
    if (hasScreen(n.url) && n.url !== '/notifications') navigate(n.url);
  }

  async function readAll() {
    setItems((list) => list.map((x) => ({ ...x, read: true })));
    setCount(0);
    markAllRead().then((r) => setCount(r.unreadCount)).catch(() => void load(null));
  }

  return (
    <>
      <header className="topbar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={() => navigate(-1)}><Icon name="back" /></button>
        <h1 className="topbar-title">Notifications</h1>
        <Link to="/settings/notifications" className="icon-btn" aria-label="Notification settings"><Icon name="settings" /></Link>
      </header>

      <PushPrompt />

      {state === 'loading' && <p className="feed-foot" role="status">Loading…</p>}
      {state === 'error' && (
        <section className="empty"><h1>Didn’t load</h1><p>Check your connection.</p>
          <button type="button" className="btn secondary" style={{ maxWidth: 200 }} onClick={() => { setState('loading'); void load(null); }}>Try again</button></section>
      )}
      {state === 'ready' && items.length === 0 && (
        <section className="empty"><h1>Nothing yet</h1><p>Comments on your posts, answers to your questions, new followers and group requests show here.</p></section>
      )}

      {items.length > 0 && (
        <>
          {count > 0 && (
            <div className="notif-bar">
              <span className="muted">{count} unread</span>
              <button type="button" className="linkish" onClick={readAll}>Mark all as read</button>
            </div>
          )}
          <ul className="list">
            {items.map((n) => {
              const linked = hasScreen(n.url) && n.url !== '/notifications';
              return (
                <li key={n.id}>
                  <button type="button" className={`list-row notif${n.read ? '' : ' unread'}`} onClick={() => open(n)}
                    aria-label={`${describe(n)}, ${timeAgo(n.createdAt)}${n.read ? '' : ', unread'}`}
                    style={linked || !n.read ? undefined : { cursor: 'default' }}>
                    {n.actor
                      ? <Avatar name={n.actor.name} photoUrl={n.actor.photoUrl} size={44} />
                      : <span className="notif-icon"><Icon name={ICONS[n.type]} size={22} /></span>}
                    <span className="list-main">
                      <span className="notif-text">{describe(n)}</span>
                      <time className="muted small" dateTime={n.createdAt}>{timeAgo(n.createdAt)}</time>
                    </span>
                    {!n.read && <span className="notif-dot" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {cursor
            ? <button type="button" className="linkish comments-more" disabled={loadingMore} onClick={() => load(cursor)}>{loadingMore ? 'Loading…' : 'Show older'}</button>
            : <p className="feed-foot">That’s everything from the last 90 days.</p>}
        </>
      )}
    </>
  );
}

/** One-time invitation to turn on push in this browser. Hidden once on, blocked, unsupported, or dismissed. */
function PushPrompt() {
  const [push, setPush] = useState<PushState | null>(null);
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => { if (!dismissed) getPushState().then(setPush).catch(() => setPush(null)); }, [dismissed]);
  if (dismissed || push !== 'off') return null;

  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage blocked */ } setDismissed(true); };
  return (
    <div className="notice push-prompt">
      <p><strong>Get notified on this phone?</strong> Replies, answers and urgent campus news, even when the app is closed. No names or messages show on your lock screen.</p>
      {error && <p className="error" role="alert">Couldn’t turn them on. Try again.</p>}
      <div className="row-actions">
        <button type="button" className="btn small-btn" disabled={busy} onClick={async () => {
          setBusy(true); setError(false);
          try { setPush(await turnPushOn()); } catch { setError(true); } finally { setBusy(false); }
        }}>{busy ? 'Turning on…' : 'Turn on'}</button>
        <button type="button" className="btn secondary small-btn" onClick={dismiss}>Not now</button>
      </div>
    </div>
  );
}
