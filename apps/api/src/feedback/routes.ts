import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStaff } from '../admin/shared.js';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import { inTransaction, type Db } from '../db.js';
import type { RequireUser } from '../guard.js';
import { fail, iso, parse, useContractErrors } from '../http.js';
import type { Queryable } from '../images/store.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';

/** Days after "Not now" before asking again. */
const ASK_AGAIN_AFTER_DAYS = 3;
const FEEDBACK_PER_DAY = 5;

/**
 * Counts the different days (Nairobi time) a member opens the app: called from GET /api/me, so it
 * writes at most once a day per member. The prompt shows once active_days reaches
 * feedback_ask_at_day (3 at first) and they haven't given feedback yet.
 */
export async function countActiveDay(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `update users set active_days = active_days + 1, last_active_on = (now() at time zone 'Africa/Nairobi')::date
      where id = $1 and (last_active_on is null or last_active_on < (now() at time zone 'Africa/Nairobi')::date)`,
    [userId]);
}

/**
 * Feedback (docs/api-contract.md, "Feedback").
 *   POST /api/feedback         { rating: 1-5, body? } → 201; never asks again
 *   POST /api/feedback/later   "Not now": ask again 3 active days later → 204
 *   GET  /api/admin/feedback   admins: newest first, with the average; WITHOUT who wrote it
 */
export async function feedbackRoutes(app: FastifyInstance, { db, requireUser }: { db: Db; requireUser: RequireUser }) {
  useContractErrors(app);

  app.post('/api/feedback', async (req, reply) => {
    const body = parse(z.object({
      rating: z.number().int().min(1).max(5),
      body: z.string().trim().max(2000).optional(),
    }).strict(), req.body, reply);
    if (!body) return;
    const { userId, campusId } = req.auth!;
    const wait = await inTransaction(db, async (tx) => {
      const w = await takeRateLimits(tx, [{ bucket: 'feedback_user', key: userId, max: FEEDBACK_PER_DAY, windowSeconds: 86_400 }]);
      if (w) return w;
      await tx.query('insert into feedback (campus_id, user_id, rating, body) values ($1, $2, $3, $4)',
        [campusId, userId, body.rating, body.body || null]);
      await tx.query('update users set feedback_given_at = coalesce(feedback_given_at, clock_timestamp()) where id = $1', [userId]);
      return 0;
    });
    if (wait) {
      reply.header('Retry-After', String(wait));
      return fail(reply, 429, 'rate_limited', `Thanks, that's plenty for today. Try again in ${waitText(wait)}.`, { retryAfterSeconds: wait });
    }
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/feedback/later', async (req, reply) => {
    await db.query('update users set feedback_ask_at_day = active_days + $2 where id = $1', [req.auth!.userId, ASK_AGAIN_AFTER_DAYS]);
    return reply.code(204).send();
  });

  app.get('/api/admin/feedback', async (req, reply) => {
    const actor = await requireStaff(db, requireUser, req, reply, 'admin');
    if (!actor) return;
    const q = parse(z.object(pageQuery).strict(), req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (err) {
      if (err instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not a cursor from this list.');
      throw err;
    }
    const { rows } = await db.query<{ id: string; cursor_at: string; rating: number; body: string | null; created_at: Date }>(
      `select f.id, f.created_at::text as cursor_at, f.rating, f.body, f.created_at
         from feedback f
        where f.campus_id = $1 and ($2::timestamptz is null or (f.created_at, f.id) < ($2::timestamptz, $3::uuid))
        order by f.created_at desc, f.id desc limit $4`,
      [actor.campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1]);
    const summary = (await db.query<{ count: number; average: string | null }>(
      'select count(*)::int as count, round(avg(rating), 1)::text as average from feedback where campus_id = $1', [actor.campusId])).rows[0]!;
    const p = page(rows, q.limit);
    return {
      count: summary.count, average: summary.average === null ? null : Number(summary.average),
      items: p.rows.map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: iso(r.created_at) })),
      nextCursor: p.nextCursor,
    };
  });
}
