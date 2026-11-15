import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, parse, useContractErrors } from '../http.js';
import { attachImage, deleteImage, type Queryable } from '../images/store.js';
import { requireCompleteProfile } from '../me/routes.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { visibleComment, visibleGroup, visiblePost, type ViewerSql } from '../visibility.js';
import { COMMENT_SELECT, commentBody, POST_SELECT, postBody, type CommentRow, type PostRow } from './shape.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };

const pageSchema = z.object(pageQuery).strict();
const text = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().min(1, 'cannot be empty').max(max));

const POSTS_PER_HOUR = 20;
const COMMENTS_PER_HOUR = 60;

/** True for a current admin of the viewer's campus (they may delete anything on it). */
async function isAdmin(db: Queryable, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from roles where user_id = $1 and role = 'admin'
        and starts_at <= clock_timestamp() and (ends_at is null or ends_at > clock_timestamp())`,
    [userId],
  );
  return rows.length > 0;
}

function rateLimited(reply: FastifyReply, wait: number, what: string) {
  reply.header('Retry-After', String(wait));
  return fail(reply, 429, 'rate_limited', `You have ${what} a lot in the last hour. Try again in ${waitText(wait)}.`, { retryAfterSeconds: wait });
}

/**
 * Feed, posts, comments and likes (docs/api-contract.md section 5, issues #22, #24).
 * What a member may see comes from src/visibility.ts; anything they may not see is 404.
 */
export async function postRoutes(app: FastifyInstance, { config, db }: { config: Config; db: Db }) {
  useContractErrors(app);

  /** One post as the viewer sees it, or null if they may not see it. */
  async function loadPost(q: Queryable, viewer: { userId: string; campusId: string }, postId: string): Promise<PostRow | null> {
    const { rows } = await q.query<PostRow>(`${POST_SELECT} where p.id = $3 and ${visiblePost('p', V)}`, [viewer.userId, viewer.campusId, postId]);
    return rows[0] ?? null;
  }

  // ---- GET /api/feed   campus-wide posts, newest first
  app.get('/api/feed', async (req, reply) => {
    const q = parse(pageSchema, req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const { rows } = await db.query<PostRow>(
      `${POST_SELECT}
        where p.group_id is null and ${visiblePost('p', V)}
          and ($3::timestamptz is null or (p.created_at, p.id) < ($3::timestamptz, $4::uuid))
        order by p.created_at desc, p.id desc
        limit $5`,
      [req.auth!.userId, req.auth!.campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: p.rows.map(postBody), nextCursor: p.nextCursor };
  });

  // ---- POST /api/posts   { body, imageId?, groupId?, officeId? }
  app.post('/api/posts', async (req, reply) => {
    const body = parse(z.object({
      body: text(2000),
      imageId: z.string().uuid().optional(),
      groupId: z.string().uuid().optional(),
      /** Post as an office the member currently belongs to (owner or editor). */
      officeId: z.string().uuid().optional(),
    }).strict(), req.body, reply);
    if (!body) return;
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;

    type Outcome = { ok: true; id: string } | { ok: false; status: number; error: string; message: string } | { ok: false; wait: number };
    const outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
      if (body.groupId) {
        const { rows } = await tx.query<{ posting: string; role: string | null; status: string | null }>(
          `select g.posting, m.role, m.status
             from groups g left join group_members m on m.group_id = g.id and m.user_id = $1
            where g.id = $3 and ${visibleGroup('g', V)}`,
          [viewer.userId, viewer.campusId, body.groupId],
        );
        const g = rows[0];
        if (!g) return { ok: false, status: 404, error: 'not_found', message: 'Group not found.' };
        if (g.status !== 'active') return { ok: false, status: 403, error: 'forbidden', message: 'Join the group to post in it.' };
        if (g.posting === 'admins_only' && g.role !== 'admin') {
          return { ok: false, status: 403, error: 'forbidden', message: 'Only the group’s admins post here.' };
        }
      }
      if (body.officeId) {
        const { rows } = await tx.query(
          `select 1 from office_members om join office_accounts o on o.id = om.office_id
            where om.office_id = $3 and om.user_id = $1 and o.campus_id = $2
              and om.starts_at <= clock_timestamp() and (om.ends_at is null or om.ends_at > clock_timestamp())`,
          [viewer.userId, viewer.campusId, body.officeId],
        );
        if (rows.length === 0) return { ok: false, status: 403, error: 'forbidden', message: 'You can only post as an office you belong to.' };
      }
      const wait = await takeRateLimits(tx, [{ bucket: 'post_user', key: viewer.userId, max: POSTS_PER_HOUR, windowSeconds: 3600 }]);
      if (wait) return { ok: false, wait };

      let imageId: string | null = null;
      if (body.imageId) {
        const image = await attachImage(tx, body.imageId, viewer.userId);
        if (!image) return { ok: false, status: 400, error: 'invalid_input', message: 'imageId: upload the image first, then use the imageId you got back.' };
        imageId = image.id;
      }
      const { rows } = await tx.query<{ id: string }>(
        `insert into posts (campus_id, author_user_id, author_office_id, group_id, body, image_id)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [viewer.campusId, viewer.userId, body.officeId ?? null, body.groupId ?? null, body.body, imageId],
      );
      return { ok: true, id: rows[0]!.id };
    });

    if (!outcome.ok) {
      if ('wait' in outcome) return rateLimited(reply, outcome.wait, 'posted');
      return fail(reply, outcome.status, outcome.error, outcome.message);
    }
    return reply.code(201).send(postBody((await loadPost(db, viewer, outcome.id))!));
  });

  // ---- GET /api/posts/:id
  app.get('/api/posts/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const post = params.success ? await loadPost(db, req.auth!, params.data.id) : null;
    if (!post) return fail(reply, 404, 'not_found', 'Post not found.');
    return postBody(post);
  });

  // ---- DELETE /api/posts/:id   the author, or an admin
  app.delete('/api/posts/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return fail(reply, 404, 'not_found', 'Post not found.');
    const viewer = req.auth!;
    const { rows } = await db.query<{ author_user_id: string; image_id: string | null; open_reports: boolean }>(
      `select p.author_user_id, p.image_id,
              exists (select 1 from reports r where r.target_type = 'post' and r.target_id = p.id and r.status = 'open') as open_reports
         from posts p where p.id = $1 and p.campus_id = $2 and p.deleted_at is null`,
      [params.data.id, viewer.campusId],
    );
    const post = rows[0];
    // Hidden posts can still be deleted by their author; anything else they may not see is 404.
    if (!post || (post.author_user_id !== viewer.userId && !(await loadPost(db, viewer, params.data.id)))) {
      return fail(reply, 404, 'not_found', 'Post not found.');
    }
    if (post.author_user_id !== viewer.userId && !(await isAdmin(db, viewer.userId))) {
      return fail(reply, 403, 'forbidden', 'You can only delete your own posts.');
    }
    await db.query('update posts set deleted_at = clock_timestamp() where id = $1', [params.data.id]);
    // The photo goes too, unless moderators still need it as evidence for an open report.
    if (post.image_id && !post.open_reports) {
      await db.query('update posts set image_id = null where id = $1', [params.data.id]);
      await deleteImage(db, config.MEDIA_DIR, post.image_id);
    }
    return reply.code(204).send();
  });

  // ---- GET /api/posts/:id/comments   oldest first
  app.get('/api/posts/:id/comments', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const q = parse(pageSchema, req.query, reply);
    if (!q) return;
    if (!params.success || !(await loadPost(db, req.auth!, params.data.id))) return fail(reply, 404, 'not_found', 'Post not found.');
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const { rows } = await db.query<CommentRow>(
      `${COMMENT_SELECT}
        where c.post_id = $3 and ${visibleComment('c', V)}
          and ($4::timestamptz is null or (c.created_at, c.id) > ($4::timestamptz, $5::uuid))
          and $2::uuid is not null
        order by c.created_at, c.id
        limit $6`,
      [req.auth!.userId, req.auth!.campusId, params.data.id, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: p.rows.map(commentBody), nextCursor: p.nextCursor };
  });

  // ---- POST /api/posts/:id/comments   { body }
  app.post('/api/posts/:id/comments', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const body = parse(z.object({ body: text(1000) }).strict(), req.body, reply);
    if (!body) return;
    if (!params.success || !(await loadPost(db, req.auth!, params.data.id))) return fail(reply, 404, 'not_found', 'Post not found.');
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;

    const outcome = await inTransaction(db, async (tx) => {
      const wait = await takeRateLimits(tx, [{ bucket: 'comment_user', key: viewer.userId, max: COMMENTS_PER_HOUR, windowSeconds: 3600 }]);
      if (wait) return { ok: false as const, wait };
      const { rows } = await tx.query<CommentRow>(
        `with c as (insert into comments (post_id, user_id, body) values ($1, $2, $3) returning *)
         ${COMMENT_SELECT.replace('from comments c', 'from c')}`,
        [params.data.id, viewer.userId, body.body],
      );
      return { ok: true as const, comment: rows[0]! };
    });
    if (!outcome.ok) return rateLimited(reply, outcome.wait, 'commented');
    return reply.code(201).send(commentBody(outcome.comment));
  });

  // ---- DELETE /api/comments/:id   the comment's author, the post's author, or an admin
  app.delete('/api/comments/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    if (!params.success) return fail(reply, 404, 'not_found', 'Comment not found.');
    const viewer = req.auth!;
    const { rows } = await db.query<{ user_id: string; post_id: string; post_author: string }>(
      `select c.user_id, c.post_id, p.author_user_id as post_author
         from comments c join posts p on p.id = c.post_id
        where c.id = $1 and p.campus_id = $2 and c.deleted_at is null`,
      [params.data.id, viewer.campusId],
    );
    const c = rows[0];
    if (!c || (c.user_id !== viewer.userId && !(await loadPost(db, viewer, c.post_id)))) return fail(reply, 404, 'not_found', 'Comment not found.');
    if (c.user_id !== viewer.userId && c.post_author !== viewer.userId && !(await isAdmin(db, viewer.userId))) {
      return fail(reply, 403, 'forbidden', 'You can only delete your own comments, or comments on your posts.');
    }
    await db.query('update comments set deleted_at = clock_timestamp() where id = $1', [params.data.id]);
    return reply.code(204).send();
  });

  // ---- PUT / DELETE /api/posts/:id/like   idempotent
  for (const liked of [true, false]) {
    app.route({
      method: liked ? 'PUT' : 'DELETE',
      url: '/api/posts/:id/like',
      handler: async (req, reply) => {
        const params = idParam.safeParse(req.params);
        if (!params.success || !(await loadPost(db, req.auth!, params.data.id))) return fail(reply, 404, 'not_found', 'Post not found.');
        const userId = req.auth!.userId;
        await db.query(
          liked
            ? 'insert into likes (user_id, post_id) values ($1, $2) on conflict do nothing'
            : 'delete from likes where user_id = $1 and post_id = $2',
          [userId, params.data.id],
        );
        const { rows } = await db.query<{ n: number }>('select count(*)::int as n from likes where post_id = $1', [params.data.id]);
        return { liked, likeCount: rows[0]!.n };
      },
    });
  }
}

/** Housekeeping: post and comment rate-limit counts after a day. */
export async function cleanupPosts(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket in ('post_user', 'comment_user') and created_at < now() - interval '1 day'`);
}
