import webpush from 'web-push';
import type { Config } from '../config.js';
import type { Db } from '../db.js';

/** One browser's push subscription, as the browser gave it. */
export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; url: string; tag: string };

/**
 * Sends one push. 'gone' means the browser unsubscribed (delete the subscription); 'retry' a
 * failure worth trying again later. Tests pass their own (buildApp deps / runPushWorker).
 */
export type PushSender = { send(sub: Subscription, msg: PushMessage): Promise<'ok' | 'gone' | 'retry'> };

/** The real sender (Web Push with VAPID), or null when push is not configured. */
export function createPushSender(config: Config): PushSender | null {
  if (!config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT) return null;
  const vapidDetails = { subject: config.VAPID_SUBJECT, publicKey: config.VAPID_PUBLIC_KEY, privateKey: config.VAPID_PRIVATE_KEY };
  return {
    async send(sub, msg) {
      try {
        // The payload is encrypted for the browser (RFC 8291); push services only see ciphertext.
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(msg),
          { vapidDetails, TTL: 24 * 3600, urgency: msg.tag === 'urgent' ? 'high' : 'normal', timeout: 10_000 },
        );
        return 'ok';
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return status === 404 || status === 410 ? 'gone' : 'retry';
      }
    },
  };
}

const BATCH = 100;
const MAX_ATTEMPTS = 5;
const MAX_FAILURES = 10;   // a subscription that keeps failing is dropped

/**
 * Sends due pushes from push_outbox, BATCH at a time. Safe to run in several processes:
 * rows are claimed with SKIP LOCKED. Returns how many outbox rows were handled.
 */
export async function runPushWorker(db: Db, sender: PushSender): Promise<number> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const { rows } = await client.query<{ id: string; user_id: string; kind: string; title: string; body: string; url: string; attempts: number }>(
      `select id, user_id, kind, title, body, url, attempts from push_outbox
        where sent_at is null and next_attempt_at <= now()
        order by next_attempt_at limit ${BATCH} for update skip locked`);
    for (const row of rows) {
      const subs = (await client.query<Subscription & { id: string }>(
        'select id, endpoint, p256dh, auth from push_subscriptions where user_id = $1', [row.user_id])).rows;
      let delivered = false;
      let failed = false;
      for (const sub of subs) {
        const result = await sender.send(sub, { title: row.title, body: row.body, url: row.url, tag: row.kind });
        if (result === 'ok') {
          delivered = true;
          await client.query('update push_subscriptions set last_success_at = now(), failures = 0 where id = $1', [sub.id]);
        } else if (result === 'gone') {
          await client.query('delete from push_subscriptions where id = $1', [sub.id]);
        } else {
          failed = true;
          await client.query('update push_subscriptions set failures = failures + 1 where id = $1', [sub.id]);
          await client.query(`delete from push_subscriptions where id = $1 and failures >= ${MAX_FAILURES}`, [sub.id]);
        }
      }
      // Retry only when no device got it: a retry goes to every device, and one that already has it would get it twice.
      if (failed && !delivered && row.attempts + 1 < MAX_ATTEMPTS) {
        // Back off: 1, 2, 4, 8 minutes.
        await client.query(
          `update push_outbox set attempts = attempts + 1, next_attempt_at = now() + make_interval(mins => power(2, attempts)::int) where id = $1`,
          [row.id]);
      } else {
        await client.query('update push_outbox set sent_at = now(), attempts = attempts + 1 where id = $1', [row.id]);
      }
    }
    await client.query('commit');
    return rows.length;
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

/** Housekeeping: sent or abandoned pushes after a day, read notifications after 90 days, any after a year. */
export async function cleanupNotifications(db: Pick<Db, 'query'>): Promise<void> {
  await db.query(`delete from push_outbox where created_at < now() - interval '1 day'`);
  await db.query(`delete from notifications where (read_at is not null and read_at < now() - interval '90 days') or created_at < now() - interval '1 year'`);
}
