import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Db } from '../db.js';
import { fail, iso, parse, useContractErrors, uuid } from '../http.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { PUSH_KINDS, notificationText, notificationUrl, type NotificationType } from './notify.js';

const MAX_SUBSCRIPTIONS_PER_MEMBER = 10;

/**
 * Notifications and push (v0.2; docs/api-contract.md section 15).
 *   GET    /api/notifications?limit&cursor        the inbox, newest first, with unreadCount
 *   POST   /api/notifications/read                { ids: [...] } or { all: true }
 *   GET    /api/push/key                          { publicKey } (null when push is off)
 *   PUT    /api/push/subscriptions                { endpoint, keys: { p256dh, auth } }
 *   DELETE /api/push/subscriptions                { endpoint }
 *   GET    /api/me/notification-settings          { comments, answers, follows, groups, events, urgent }
 *   PATCH  /api/me/notification-settings          any of those booleans
 */
export async function notificationRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);

  app.get('/api/notifications', async (req, reply) => {
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const userId = req.auth!.userId;
    // Actors who are deleted now, or blocked either way since, are not shown.
    const { rows } = await db.query<{ id: string; type: NotificationType; target_type: string; target_id: string; count: number;
      created_at: Date; cursor_at: string; read_at: Date | null; actor_id: string | null; actor_name: string | null; actor_photo: string | null }>(
      `select n.id, n.type, n.target_type, n.target_id, n.count, n.created_at, n.created_at::text as cursor_at, n.read_at,
              case when a.deleted_at is null and not exists (select 1 from blocks b
                     where (b.blocker_id = $1 and b.blocked_id = a.id) or (b.blocker_id = a.id and b.blocked_id = $1)) then a.id end as actor_id,
              a.name as actor_name, a.photo_url as actor_photo
         from notifications n left join users a on a.id = n.actor_user_id
        where n.user_id = $1
          and ($2::timestamptz is null or (n.created_at, n.id) < ($2::timestamptz, $3::uuid))
        order by n.created_at desc, n.id desc
        limit $4`,
      [userId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1]);
    const unread = await db.query<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [userId]);
    const p = page(rows, q.limit);
    return {
      items: p.rows.map((n) => ({
        id: n.id, type: n.type, text: notificationText(n.type), count: n.count,
        // Official accounts never show which member posted for them (like announcements).
        actor: n.actor_id && n.type !== 'office_story' ? { id: n.actor_id, name: n.actor_name, photoUrl: n.actor_photo } : null,
        target: { type: n.target_type, id: n.target_id }, url: notificationUrl(n.type, n.target_id),
        read: n.read_at !== null, createdAt: iso(n.created_at),
      })),
      unreadCount: unread.rows[0]!.n,
      nextCursor: p.nextCursor,
    };
  });

  app.post('/api/notifications/read', async (req, reply) => {
    const body = parse(z.union([
      z.object({ ids: z.array(uuid).min(1).max(100) }).strict(),
      z.object({ all: z.literal(true) }).strict(),
    ]), req.body, reply);
    if (!body) return;
    const userId = req.auth!.userId;
    if ('all' in body) await db.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId]);
    else await db.query('update notifications set read_at = now() where user_id = $1 and id = any($2::uuid[]) and read_at is null', [userId, body.ids]);
    const unread = await db.query<{ n: number }>('select count(*)::int as n from notifications where user_id = $1 and read_at is null', [userId]);
    return { unreadCount: unread.rows[0]!.n };
  });

  app.get('/api/push/key', async () => ({ publicKey: config.VAPID_PUBLIC_KEY ?? null }));

  app.put('/api/push/subscriptions', async (req, reply) => {
    const body = parse(z.object({
      endpoint: z.string().url().max(2000).refine((u) => u.startsWith('https://'), 'must be https'),
      keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
      expirationTime: z.number().nullable().optional(),   // browsers send it; not used
    }).strict(), req.body, reply);
    if (!body) return;
    if (!config.VAPID_PUBLIC_KEY) return fail(reply, 503, 'push_unavailable', 'Notifications on this device are not available yet.');
    const userId = req.auth!.userId;
    // A browser that someone else used before belongs to whoever subscribes now.
    await db.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values ($1, $2, $3, $4, $5)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent, failures = 0`,
      [userId, body.endpoint, body.keys.p256dh, body.keys.auth, (req.headers['user-agent'] ?? '').slice(0, 400) || null]);
    // Keep the newest few per member.
    await db.query(
      `delete from push_subscriptions where user_id = $1 and id not in
         (select id from push_subscriptions where user_id = $1 order by created_at desc limit ${MAX_SUBSCRIPTIONS_PER_MEMBER})`, [userId]);
    return reply.code(204).send();
  });

  app.delete('/api/push/subscriptions', async (req, reply) => {
    const body = parse(z.object({ endpoint: z.string().max(2000) }).strict(), req.body, reply);
    if (!body) return;
    await db.query('delete from push_subscriptions where user_id = $1 and endpoint = $2', [req.auth!.userId, body.endpoint]);
    return reply.code(204).send();
  });

  const settings = (prefs: Record<string, unknown>) => Object.fromEntries(PUSH_KINDS.map((k) => [k, prefs[k] !== false]));

  app.get('/api/me/notification-settings', async (req) => {
    const { rows } = await db.query<{ prefs: Record<string, unknown> }>('select notification_prefs as prefs from users where id = $1', [req.auth!.userId]);
    return settings(rows[0]?.prefs ?? {});
  });

  app.patch('/api/me/notification-settings', async (req, reply) => {
    const body = parse(z.object(Object.fromEntries(PUSH_KINDS.map((k) => [k, z.boolean()]))).partial().strict(), req.body, reply);
    if (!body) return;
    const { rows } = await db.query<{ prefs: Record<string, unknown> }>(
      'update users set notification_prefs = notification_prefs || $2::jsonb where id = $1 returning notification_prefs as prefs',
      [req.auth!.userId, JSON.stringify(body)]);
    return settings(rows[0]!.prefs);
  });
}
