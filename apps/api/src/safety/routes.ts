import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, parse, useContractErrors } from '../http.js';
import type { Queryable } from '../images/store.js';
import { visibleAnswer, visibleComment, visibleGroup, visiblePost, visibleQuestion, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id, $2 their campus and $3 the target. */
const V: ViewerSql = { id: '$1', campusId: '$2' };

/** Open reports from this many different members hide content until a moderator reviews it. */
export const AUTO_HIDE_AT = 3;
const REPORTS_PER_HOUR = 20;

/**
 * "Can the reporter see this?" per target type. Members report what they can see; anything
 * else answers 404, so reports reveal nothing. People can be reported even after blocking them.
 * Table and column names are constants.
 */
const TARGETS = {
  post:     { table: 'posts',     visible: `select 1 from posts t where t.id = $3 and ${visiblePost('t', V)}` },
  comment:  { table: 'comments',  visible: `select 1 from comments t join posts p on p.id = t.post_id where t.id = $3 and ${visibleComment('t', V)} and ${visiblePost('p', V)}` },
  question: { table: 'questions', visible: `select 1 from questions t where t.id = $3 and ${visibleQuestion('t', V)}` },
  answer:   { table: 'answers',   visible: `select 1 from answers t join questions q on q.id = t.question_id where t.id = $3 and ${visibleAnswer('t', V)} and ${visibleQuestion('q', V)}` },
  group:    { table: null,        visible: `select 1 from groups t where t.id = $3 and ${visibleGroup('t', V)}` },
  user:     { table: null,        visible: `select 1 from users t where t.id = $3 and t.campus_id = $2 and t.deleted_at is null and t.id <> $1` },
} as const;
type TargetType = keyof typeof TARGETS;

/**
 * Report and block (docs/api-contract.md section 7, issue #23).
 *   POST   /api/reports            report a post, comment, person, group, question or answer
 *   PUT    /api/users/:id/block    block (idempotent);  DELETE unblocks
 *   GET    /api/me/blocks          the members I have blocked
 */
export async function safetyRoutes(app: FastifyInstance, { db }: { db: Db }) {
  useContractErrors(app);

  app.post('/api/reports', async (req, reply) => {
    const body = parse(z.object({
      targetType: z.enum(['post', 'comment', 'user', 'group', 'question', 'answer']),
      targetId: z.string().uuid(),
      reason: z.enum(['spam', 'harassment', 'hate', 'nudity', 'violence', 'self_harm', 'false_info', 'other']),
      details: z.string().trim().max(2000).optional(),
    }).strict(), req.body, reply);
    if (!body) return;
    const { userId, campusId } = req.auth!;
    const target = TARGETS[body.targetType as TargetType];

    const outcome = await inTransaction(db, async (tx) => {
      const seen = await tx.query(target.visible, [userId, campusId, body.targetId]);
      if (seen.rows.length === 0) return 'missing' as const;
      const wait = await takeRateLimits(tx, [{ bucket: 'report_user', key: userId, max: REPORTS_PER_HOUR, windowSeconds: 3600 }]);
      if (wait) return wait;
      // One report at a time per item, so simultaneous reports cannot all miss the auto-hide count.
      await tx.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`report:${body.targetType}:${body.targetId}`]);
      // A second report of the same item by the same member changes nothing (one open report each).
      await tx.query(
        `insert into reports (campus_id, reporter_id, target_type, target_id, reason, details)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (reporter_id, target_type, target_id) where status = 'open' and reporter_id is not null do nothing`,
        [campusId, userId, body.targetType, body.targetId, body.reason, body.details || null],
      );
      if (target.table) {
        const { rows } = await tx.query<{ n: number }>(
          `select count(*)::int as n from reports where target_type = $1 and target_id = $2 and status = 'open'`,
          [body.targetType, body.targetId],
        );
        if (rows[0]!.n >= AUTO_HIDE_AT) {
          // hidden_by stays null: that marks it as hidden by reports, not by a moderator.
          await tx.query(`update ${target.table} set hidden_at = clock_timestamp() where id = $1 and hidden_at is null`, [body.targetId]);
        }
      }
      return 'ok' as const;
    });

    if (outcome === 'missing') return fail(reply, 404, 'not_found', 'Not found.');
    if (typeof outcome === 'number') {
      reply.header('Retry-After', String(outcome));
      return fail(reply, 429, 'rate_limited', `You have sent a lot of reports. Try again in ${waitText(outcome)}.`, { retryAfterSeconds: outcome });
    }
    return reply.code(202).send({ received: true });
  });

  for (const blocking of [true, false]) {
    app.route({
      method: blocking ? 'PUT' : 'DELETE',
      url: '/api/users/:id/block',
      handler: async (req, reply) => {
        const params = idParam.safeParse(req.params);
        if (!params.success) return fail(reply, 404, 'not_found', 'Member not found.');
        const { userId, campusId } = req.auth!;
        if (params.data.id === userId) return fail(reply, 400, 'invalid_input', 'You cannot block yourself.');
        if (blocking) {
          const exists = await db.query('select 1 from users where id = $1 and campus_id = $2 and deleted_at is null', [params.data.id, campusId]);
          if (exists.rows.length === 0) return fail(reply, 404, 'not_found', 'Member not found.');
          await db.query('insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing', [userId, params.data.id]);
        } else {
          await db.query('delete from blocks where blocker_id = $1 and blocked_id = $2', [userId, params.data.id]);
        }
        return reply.code(204).send();
      },
    });
  }

  app.get('/api/me/blocks', async (req) => {
    const { rows } = await db.query<{ id: string; name: string | null }>(
      `select u.id, u.name from blocks b join users u on u.id = b.blocked_id
        where b.blocker_id = $1 and u.deleted_at is null
        order by b.created_at desc`,
      [req.auth!.userId],
    );
    return { items: rows };
  });
}

/** Housekeeping: report rate-limit counts after a day. */
export async function cleanupSafety(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket = 'report_user' and created_at < now() - interval '1 day'`);
}
