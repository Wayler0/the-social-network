import type { Queryable } from '../images/store.js';

/**
 * Recording notifications (v0.2; docs/api-contract.md section 15). Call these inside the same
 * transaction as the action, after it succeeded. They never notify someone about their own
 * action, a deleted member, or across a block.
 *
 * The inbox always records. A push is queued only for a new unread notification (a burst of ten
 * comments makes one push), only if the member has a push subscription, and only if they did not
 * turn that kind off. Push text is generic on purpose: it shows on lock screens.
 */

export type NotificationType = 'comment' | 'answer' | 'follow' | 'group_request' | 'group_approved' | 'event_cancelled' | 'story' | 'office_story' | 'emergency';
type TargetType = 'post' | 'question' | 'user' | 'group' | 'event' | 'office' | 'emergency';

/** Push settings a member can turn off (GET/PATCH /api/me/notification-settings). */
export const PUSH_KINDS = ['comments', 'answers', 'follows', 'groups', 'events', 'urgent', 'stories'] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

const KINDS: Record<NotificationType, { kind: PushKind; target: TargetType; text: string; url: (id: string) => string }> = {
  comment:         { kind: 'comments', target: 'post',     text: 'New comment on your post',                 url: (id) => `/post/${id}` },
  answer:          { kind: 'answers',  target: 'question', text: 'Someone answered your question',           url: (id) => `/ask/${id}` },
  follow:          { kind: 'follows',  target: 'user',     text: 'You have a new follower',                  url: () => '/notifications' },
  group_request:   { kind: 'groups',   target: 'group',    text: 'Someone asked to join your group',         url: (id) => `/groups/${id}` },
  group_approved:  { kind: 'groups',   target: 'group',    text: 'Your request to join a group was approved', url: (id) => `/groups/${id}` },
  event_cancelled: { kind: 'events',   target: 'event',    text: 'An event you planned to go to was cancelled', url: (id) => `/events/${id}` },
  // Stories: generic text (lock screens); the stories row on Home shows whose.
  story:           { kind: 'stories',  target: 'user',     text: 'New story from someone you follow',       url: () => '/' },
  office_story:    { kind: 'stories',  target: 'office',   text: 'New story from an official account',      url: () => '/' },
  // Moderators and safety offices; its push is sent separately (src/emergency/routes.ts).
  emergency:       { kind: 'urgent',   target: 'emergency', text: 'A member pressed the emergency button',   url: () => '/admin?tab=alerts' },
};

export const notificationText = (type: NotificationType) => KINDS[type].text;
export const notificationUrl = (type: NotificationType, targetId: string) => KINDS[type].url(targetId);

/**
 * Notifies each of `userIds` that `actorId` did something of `type` to `targetId`.
 * `appName` is the push title (config APP_NAME). Returns how many members got a new notification.
 */
export async function notify(
  db: Queryable, appName: string,
  n: { type: NotificationType; userIds: string[]; actorId: string; targetId: string },
): Promise<number> {
  const k = KINDS[n.type];
  const recipients = [...new Set(n.userIds)].filter((id) => id !== n.actorId);
  if (recipients.length === 0) return 0;
  // Collapse into the unread one if there is one; otherwise a new row. xmax = 0 means "inserted".
  const { rows } = await db.query<{ user_id: string; inserted: boolean }>(
    `insert into notifications (user_id, type, actor_user_id, target_type, target_id, created_at)
     select u.id, $2, $3, $4, $5, clock_timestamp() from users u
      where u.id = any($1::uuid[]) and u.deleted_at is null
        and not exists (select 1 from blocks b where (b.blocker_id = u.id and b.blocked_id = $3) or (b.blocker_id = $3 and b.blocked_id = u.id))
     on conflict (user_id, type, target_id) where read_at is null
     do update set actor_user_id = excluded.actor_user_id, count = notifications.count + 1, created_at = clock_timestamp()
     returning user_id, (xmax = 0) as inserted`,
    [recipients, n.type, n.actorId, k.target, n.targetId],
  );
  const fresh = rows.filter((r) => r.inserted).map((r) => r.user_id);
  if (fresh.length) await queuePush(db, fresh, k.kind, { title: appName, body: k.text, url: k.url(n.targetId) });
  return fresh.length;
}

/** Queues one push for each member who has a subscription and has not turned `kind` off. */
export async function queuePush(db: Queryable, userIds: string[], kind: PushKind, p: { title: string; body: string; url: string }): Promise<number> {
  const { rowCount } = await db.query(
    `insert into push_outbox (user_id, kind, title, body, url)
     select u.id, $2, $3, $4, $5 from users u
      where u.id = any($1::uuid[]) and u.deleted_at is null
        and coalesce((u.notification_prefs ->> $2)::boolean, true)
        and exists (select 1 from push_subscriptions s where s.user_id = u.id)`,
    [userIds, kind, p.title.slice(0, 200), p.body.slice(0, 300), p.url],
  );
  return rowCount ?? 0;
}

/**
 * Urgent Today board announcement: a push to everyone on the campus who can use the app
 * (not suspended) and has push on. Official public information, so the title is shown.
 */
export async function queueUrgentAnnouncement(db: Queryable, appName: string, campusId: string, title: string): Promise<number> {
  const { rowCount } = await db.query(
    `insert into push_outbox (user_id, kind, title, body, url)
     select u.id, 'urgent', $2, $3, '/today' from users u
      where u.campus_id = $1 and u.deleted_at is null
        and (u.suspended_at is null or (u.suspended_until is not null and u.suspended_until <= now()))
        and coalesce((u.notification_prefs ->> 'urgent')::boolean, true)
        and exists (select 1 from push_subscriptions s where s.user_id = u.id)`,
    [campusId, `Urgent · ${appName}`.slice(0, 200), title.slice(0, 300)],
  );
  return rowCount ?? 0;
}
