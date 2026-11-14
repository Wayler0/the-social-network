import type { Queryable } from '../images/store.js';

/**
 * Rate limits kept in PostgreSQL (no Redis in v0.1): one row in rate_limit_events per counted
 * event. A bucket can carry several limits at once, e.g. "1 per 30 s and 5 per hour".
 */
export type Limit = { bucket: string; key: string; max: number; windowSeconds: number };

/**
 * Checks every limit; if none is reached, counts this event once in each bucket and returns null.
 * Otherwise counts nothing and returns how many seconds to wait (the longest of the limits hit).
 *
 * Must run inside a transaction: it takes a lock per bucket and key, so two requests at the same
 * moment cannot both slip under a limit. Uses clock_timestamp(), the real time, not now(), which
 * is when the transaction started and would be stale for a request that waited on the lock.
 */
export async function takeRateLimits(tx: Queryable, limits: Limit[]): Promise<number | null> {
  const counters = [...new Map(limits.map((l) => [`${l.bucket}\u0000${l.key}`, l])).values()]
    .sort((a, b) => (a.bucket + a.key < b.bucket + b.key ? -1 : 1)); // fixed order: no deadlocks
  for (const c of counters) {
    await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`rate:${c.bucket}:${c.key}`]);
  }

  let wait = 0;
  for (const l of limits) {
    // The max-th most recent event inside the window: if it exists, the limit is reached until it leaves the window.
    const { rows } = await tx.query<{ retry: number }>(
      `select ceil(extract(epoch from created_at + make_interval(secs => $3) - clock_timestamp()))::int as retry
         from rate_limit_events
        where bucket = $1 and key = $2 and created_at > clock_timestamp() - make_interval(secs => $3)
        order by created_at desc
        offset $4 - 1 limit 1`,
      [l.bucket, l.key, l.windowSeconds, l.max],
    );
    if (rows[0]) wait = Math.max(wait, rows[0].retry, 1);
  }
  if (wait > 0) return wait;

  for (const c of counters) {
    await tx.query('insert into rate_limit_events (bucket, key, created_at) values ($1, $2, clock_timestamp())', [c.bucket, c.key]);
  }
  return null;
}

/** "45 seconds", "1 minute", "12 minutes": for messages members read. */
export function waitText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
