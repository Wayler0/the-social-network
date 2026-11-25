/**
 * Notifications inbox, push subscriptions and push settings (docs/api-contract.md section 15). Real API only.
 */
import { call } from './api';

export type NotificationType = 'comment' | 'answer' | 'follow' | 'group_request' | 'group_approved' | 'event_cancelled';
export type Notification = {
  id: string; type: NotificationType; text: string; count: number;
  actor: { id: string; name: string; photoUrl: string | null } | null;
  target: { type: 'post' | 'question' | 'user' | 'group' | 'event'; id: string };
  url: string; read: boolean; createdAt: string;
};
export type Inbox = { items: Notification[]; unreadCount: number; nextCursor: string | null };

export const PUSH_KINDS = ['comments', 'answers', 'follows', 'groups', 'events', 'urgent'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushSettings = Record<PushKind, boolean>;

export const getNotifications = (cursor?: string | null, limit = 30) =>
  call<Inbox>('GET', `/api/notifications?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
export const markRead = (ids: string[]) => call<{ unreadCount: number }>('POST', '/api/notifications/read', { ids });
export const markAllRead = () => call<{ unreadCount: number }>('POST', '/api/notifications/read', { all: true });
export const getPushSettings = () => call<PushSettings>('GET', '/api/me/notification-settings');
export const updatePushSettings = (patch: Partial<PushSettings>) => call<PushSettings>('PATCH', '/api/me/notification-settings', patch);

/** What one notification says in the inbox. Uses the actor's name when we may show it (the API sends null otherwise). */
export function describe(n: Pick<Notification, 'type' | 'count' | 'actor' | 'text'>): string {
  const who = n.actor?.name;
  const others = n.count - 1;
  const by = who ? (others > 0 ? `${who} and ${others} ${others === 1 ? 'other' : 'others'}` : who) : null;
  switch (n.type) {
    case 'comment':
      if (by) return `${by} commented on your post`;
      return n.count > 1 ? `${n.count} new comments on your post` : n.text;
    case 'answer':
      if (by) return `${by} answered your question`;
      return n.count > 1 ? `${n.count} new answers to your question` : n.text;
    case 'follow':
      if (by) return `${by} started following you`;
      return n.count > 1 ? `${n.count} new followers` : n.text;
    case 'group_request':
      if (by) return `${by} asked to join your group`;
      return n.count > 1 ? `${n.count} people asked to join your group` : n.text;
    default:
      return n.text;
  }
}

/** Paths this app has a screen for; a notification pointing elsewhere is not a link. */
const SCREENS = [/^\/post\/[^/]+$/, /^\/ask\/[^/]+$/, /^\/groups\/[^/]+$/, /^\/events\/[^/]+$/, /^\/today$/, /^\/notifications$/];
export const hasScreen = (url: string) => SCREENS.some((r) => r.test(url));

// ---------------------------------------------------------------- Web Push in this browser

/** The VAPID public key (base64url) as the bytes PushManager.subscribe wants. */
export function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState =
  | 'unsupported'   // no service worker / Push API (e.g. iPhone Safari outside an installed app)
  | 'unavailable'   // the server has no VAPID keys yet
  | 'denied'        // the member blocked notifications for this site in the browser
  | 'off'           // possible, not turned on in this browser
  | 'on';

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

async function registration(): Promise<ServiceWorkerRegistration> {
  // Built app: /sw.js is the Workbox worker (vite.config.ts), which imports the push handlers.
  // Dev server: there is no /sw.js, so the push handlers are registered on their own.
  return (await navigator.serviceWorker.getRegistration('/'))
    ?? navigator.serviceWorker.register(import.meta.env.DEV ? '/push-sw.js' : '/sw.js');
}

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const { publicKey } = await call<{ publicKey: string | null }>('GET', '/api/push/key');
  if (!publicKey) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await (await registration()).pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Ask the browser's permission, subscribe, and tell the API. Must run from a tap (browsers require a user gesture). */
export async function turnPushOn(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const { publicKey } = await call<{ publicKey: string | null }>('GET', '/api/push/key');
  if (!publicKey) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registration();
  await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older server key can't receive; replace it.
  const current = sub?.options.applicationServerKey;
  if (sub && current && !sameBytes(new Uint8Array(current), keyBytes(publicKey))) { await sub.unsubscribe(); sub = null; }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource });
  await call<void>('PUT', '/api/push/subscriptions', sub.toJSON());
  return 'on';
}

/** Stop push in this browser only (other devices keep theirs). */
export async function turnPushOff(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const sub = await (await registration()).pushManager.getSubscription();
  if (sub) {
    await call<void>('DELETE', '/api/push/subscriptions', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
  }
  return 'off';
}

/**
 * On log out: unsubscribe this browser so the next person who signs in here doesn't get the last member's pushes.
 * Must run before the session ends (the DELETE needs it). Never throws.
 */
export async function forgetPushOnThisDevice(): Promise<void> {
  try { if (pushSupported() && (await navigator.serviceWorker.getRegistration('/'))) await turnPushOff(); } catch { /* best effort */ }
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}
