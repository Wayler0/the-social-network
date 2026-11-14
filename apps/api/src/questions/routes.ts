import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, parse, useContractErrors } from '../http.js';
import type { Queryable } from '../images/store.js';
import { requireCompleteProfile } from '../me/routes.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { author, authorColumns, type AuthorRow } from '../posts/shape.js';
import { visibleAnswer, visibleQuestion, type ViewerSql } from '../visibility.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };
const QUESTIONS_PER_HOUR = 10;
const ANSWERS_PER_HOUR = 30;
const MAX_ANSWERS_SHOWN = 200;

/** Moderators and admins may see who asked, even when the name is hidden (CLAUDE.md section 4.5). */
const VIEWER_SEES_HIDDEN_NAMES = `exists (select 1 from roles vr where vr.user_id = $1 and vr.role in ('moderator', 'admin')
                                    and vr.starts_at <= clock_timestamp() and (vr.ends_at is null or vr.ends_at > clock_timestamp()))`;

const QUESTION_SELECT = `
  select q.id, q.body, q.hide_name, q.created_at, q.created_at::text as cursor_at, (q.user_id = $1) as is_mine,
         ${authorColumns('au')},
         (select count(*) from answers a where a.question_id = q.id and a.hidden_at is null)::int as answer_count,
         ${VIEWER_SEES_HIDDEN_NAMES} as sees_hidden
    from questions q join users au on au.id = q.user_id`;

type QuestionRow = AuthorRow & {
  id: string; body: string; hide_name: boolean; created_at: Date; cursor_at: string; is_mine: boolean;
  answer_count: number; sees_hidden: boolean;
};

const ANSWER_SELECT = `
  select a.id, a.body, a.created_at, (a.user_id = $1) as is_mine, ${authorColumns('au')},
         (a.user_id = q.user_id and q.hide_name) as by_hidden_asker,
         (select count(*) from answer_helpful h where h.answer_id = a.id)::int as helpful_count,
         exists (select 1 from answer_helpful h where h.answer_id = a.id and h.user_id = $1) as helpful_by_me,
         ${VIEWER_SEES_HIDDEN_NAMES} as sees_hidden
    from answers a join questions q on q.id = a.question_id join users au on au.id = a.user_id`;

type AnswerRow = AuthorRow & {
  id: string; body: string; created_at: Date; is_mine: boolean; by_hidden_asker: boolean;
  helpful_count: number; helpful_by_me: boolean; sees_hidden: boolean;
};

/** A hidden name stays hidden from everyone but the asker, moderators and admins. */
const nameShown = (hidden: boolean, r: { is_mine: boolean; sees_hidden: boolean }) => !hidden || r.is_mine || r.sees_hidden;

function questionBody(r: QuestionRow) {
  return {
    id: r.id, body: r.body,
    author: nameShown(r.hide_name, r) ? author(r) : null,
    nameHidden: r.hide_name, isMine: r.is_mine,
    answerCount: r.answer_count, createdAt: r.created_at.toISOString(),
  };
}

function answerBody(r: AnswerRow) {
  return {
    id: r.id, body: r.body,
    // The asker answering their own anonymous question must not give themselves away.
    author: nameShown(r.by_hidden_asker, r) ? author(r) : null,
    byAsker: r.by_hidden_asker,
    isMine: r.is_mine, helpfulCount: r.helpful_count, helpfulByMe: r.helpful_by_me,
    createdAt: r.created_at.toISOString(),
  };
}

const text = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().min(1, 'cannot be empty').max(max));

/**
 * Ask a Senior (docs/api-contract.md section 10, issue #27). Questions and answers stay
 * searchable. Hidden names are hidden from every member except the asker, moderators and admins.
 */
export async function questionRoutes(app: FastifyInstance, { db }: { db: Db }) {
  useContractErrors(app);
  const notFound = (reply: Parameters<typeof fail>[0]) => fail(reply, 404, 'not_found', 'Question not found.');

  async function loadQuestion(q: Queryable, viewer: { userId: string; campusId: string }, id: string) {
    const { rows } = await q.query<QuestionRow>(`${QUESTION_SELECT} where q.id = $3 and ${visibleQuestion('q', V)}`, [viewer.userId, viewer.campusId, id]);
    return rows[0] ?? null;
  }

  // ---- GET /api/questions?q=&limit&cursor   newest first; q searches questions and their answers
  app.get('/api/questions', async (req, reply) => {
    const query = parse(z.object({ ...pageQuery, q: z.string().trim().min(2).max(200).optional() }).strict(), req.query, reply);
    if (!query) return;
    let cursor;
    try { cursor = decodeCursor(query.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const { rows } = await db.query<QuestionRow>(
      `${QUESTION_SELECT}
        where ${visibleQuestion('q', V)}
          and ($3::timestamptz is null or (q.created_at, q.id) < ($3::timestamptz, $4::uuid))
          and ($6::text is null
               or to_tsvector('english', q.body) @@ plainto_tsquery('english', $6)
               or exists (select 1 from answers sa where sa.question_id = q.id and sa.hidden_at is null
                           and to_tsvector('english', sa.body) @@ plainto_tsquery('english', $6)))
        order by q.created_at desc, q.id desc
        limit $5`,
      [req.auth!.userId, req.auth!.campusId, cursor?.at ?? null, cursor?.id ?? null, query.limit + 1, query.q ?? null],
    );
    const p = page(rows, query.limit);
    return { items: p.rows.map(questionBody), nextCursor: p.nextCursor };
  });

  // ---- POST /api/questions   { body, hideName }
  app.post('/api/questions', async (req, reply) => {
    const body = parse(z.object({ body: text(2000), hideName: z.boolean().default(false) }).strict(), req.body, reply);
    if (!body) return;
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;
    const outcome = await inTransaction(db, async (tx) => {
      const wait = await takeRateLimits(tx, [{ bucket: 'question_user', key: viewer.userId, max: QUESTIONS_PER_HOUR, windowSeconds: 3600 }]);
      if (wait) return { ok: false as const, wait };
      const { rows } = await tx.query<{ id: string }>(
        'insert into questions (campus_id, user_id, hide_name, body) values ($1, $2, $3, $4) returning id',
        [viewer.campusId, viewer.userId, body.hideName, body.body],
      );
      return { ok: true as const, id: rows[0]!.id };
    });
    if (!outcome.ok) {
      reply.header('Retry-After', String(outcome.wait));
      return fail(reply, 429, 'rate_limited', `You have asked a lot in the last hour. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
    }
    return reply.code(201).send(questionBody((await loadQuestion(db, viewer, outcome.id))!));
  });

  // ---- GET /api/questions/:id   with its answers, most helpful first
  app.get('/api/questions/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const question = params.success ? await loadQuestion(db, req.auth!, params.data.id) : null;
    if (!question) return notFound(reply);
    const { rows } = await db.query<AnswerRow>(
      `${ANSWER_SELECT}
        where a.question_id = $3 and ${visibleAnswer('a', V)} and $2::uuid is not null
        order by helpful_count desc, a.created_at, a.id
        limit ${MAX_ANSWERS_SHOWN}`,
      [req.auth!.userId, req.auth!.campusId, question.id],
    );
    return { ...questionBody(question), answers: rows.map(answerBody) };
  });

  // ---- POST /api/questions/:id/answers   { body }
  app.post('/api/questions/:id/answers', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const body = parse(z.object({ body: text(5000) }).strict(), req.body, reply);
    if (!body) return;
    if (!params.success || !(await loadQuestion(db, req.auth!, params.data.id))) return notFound(reply);
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;
    const outcome = await inTransaction(db, async (tx) => {
      const wait = await takeRateLimits(tx, [{ bucket: 'answer_user', key: viewer.userId, max: ANSWERS_PER_HOUR, windowSeconds: 3600 }]);
      if (wait) return { ok: false as const, wait };
      const { rows } = await tx.query<{ id: string }>(
        'insert into answers (question_id, user_id, body) values ($1, $2, $3) returning id', [params.data.id, viewer.userId, body.body]);
      return { ok: true as const, id: rows[0]!.id };
    });
    if (!outcome.ok) {
      reply.header('Retry-After', String(outcome.wait));
      return fail(reply, 429, 'rate_limited', `You have answered a lot in the last hour. Try again in ${waitText(outcome.wait)}.`, { retryAfterSeconds: outcome.wait });
    }
    const { rows } = await db.query<AnswerRow>(`${ANSWER_SELECT} where a.id = $2`, [viewer.userId, outcome.id]);
    return reply.code(201).send(answerBody(rows[0]!));
  });

  // ---- PUT / DELETE /api/answers/:id/helpful   idempotent; not on your own answer
  for (const helpful of [true, false]) {
    app.route({
      method: helpful ? 'PUT' : 'DELETE',
      url: '/api/answers/:id/helpful',
      handler: async (req, reply) => {
        const params = idParam.safeParse(req.params);
        const answerNotFound = () => fail(reply, 404, 'not_found', 'Answer not found.');
        if (!params.success) return answerNotFound();
        const { userId, campusId } = req.auth!;
        const { rows } = await db.query<{ user_id: string }>(
          `select a.user_id from answers a join questions q on q.id = a.question_id
            where a.id = $3 and ${visibleAnswer('a', V)} and ${visibleQuestion('q', V)}`,
          [userId, campusId, params.data.id],
        );
        if (!rows[0]) return answerNotFound();
        if (helpful && rows[0].user_id === userId) return fail(reply, 400, 'invalid_input', 'You cannot mark your own answer as helpful.');
        await db.query(
          helpful
            ? 'insert into answer_helpful (answer_id, user_id) values ($1, $2) on conflict do nothing'
            : 'delete from answer_helpful where answer_id = $1 and user_id = $2',
          [params.data.id, userId],
        );
        const count = await db.query<{ n: number }>('select count(*)::int as n from answer_helpful where answer_id = $1', [params.data.id]);
        return { helpful, helpfulCount: count.rows[0]!.n };
      },
    });
  }
}

/** Housekeeping: question and answer rate-limit counts after a day. */
export async function cleanupQuestions(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket in ('question_user', 'answer_user') and created_at < now() - interval '1 day'`);
}
