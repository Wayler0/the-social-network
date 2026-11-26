import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { takeRateLimits, waitText } from '../auth/rate-limit.js';
import type { Config } from '../config.js';
import { inTransaction, type Db } from '../db.js';
import { fail, idParam, parse, useContractErrors } from '../http.js';
import { attachImage, deleteImage, type Queryable } from '../images/store.js';
import { requireCompleteProfile } from '../me/routes.js';
import { notify } from '../notifications/notify.js';
import { CursorError, decodeCursor, page, pageQuery } from '../paging.js';
import { followsOrMemberOf, notBlocked, visibleEvent, visibleComment, visibleGroup, visiblePost, type ViewerSql } from '../visibility.js';
import { COMMENT_SELECT, commentBody, POST_SELECT, postBody, REACTIONS, type CommentRow, type PostRow, type Reaction } from './shape.js';

/** In every query here, $1 is the viewer's id and $2 their campus. */
const V: ViewerSql = { id: '$1', campusId: '$2' };

const pageSchema = z.object(pageQuery).strict();
const text = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().min(1, 'cannot be empty').max(max));

const POSTS_PER_HOUR = 20;
/** Edits per member per hour: plenty for fixing typos, not for flooding moderators with versions. */
const EDITS_PER_HOUR = 30;
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

  // ---- GET /api/feed   campus-wide posts plus announcements of clubs I follow or belong to, newest first
  app.get('/api/feed', async (req, reply) => {
    const q = parse(pageSchema, req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const { rows } = await db.query<PostRow>(
      `${POST_SELECT}
        where (p.group_id is null or (p.announcement and ${followsOrMemberOf('p.group_id', V)}))
          and ${visiblePost('p', V)}
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
      /** Required, except when sharing an event (then a caption is optional). */
      body: z.string().transform((s) => s.trim()).pipe(z.string().max(2000)).default(''),
      /** Share an event as this post: it shows the event's card. */
      eventId: z.string().uuid().optional(),
      imageId: z.string().uuid().optional(),
      groupId: z.string().uuid().optional(),
      /** Post as an office the member currently belongs to (owner or editor). */
      officeId: z.string().uuid().optional(),
      /** Club pages: an announcement (club admins only) instead of a discussion post. */
      announcement: z.boolean().default(false),
    }).strict().refine((b) => !b.announcement || b.groupId, { message: 'announcement: only in a club (send groupId)' })
      .refine((b) => b.body.length > 0 || b.eventId, { message: 'body: cannot be empty' }), req.body, reply);
    if (!body) return;
    if (!(await requireCompleteProfile(db, req, reply))) return;
    const viewer = req.auth!;

    type Outcome = { ok: true; id: string } | { ok: false; status: number; error: string; message: string } | { ok: false; wait: number };
    const outcome = await inTransaction(db, async (tx): Promise<Outcome> => {
      if (body.groupId) {
        const { rows } = await tx.query<{ posting: string; kind: string; role: string | null; status: string | null }>(
          `select g.posting, g.kind, m.role, m.status
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
        if (body.announcement && g.kind !== 'club') {
          return { ok: false, status: 400, error: 'invalid_input', message: 'announcement: only clubs have announcements.' };
        }
        if (body.announcement && g.role !== 'admin') {
          return { ok: false, status: 403, error: 'forbidden', message: 'Only the club’s admins post announcements.' };
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
      if (body.eventId) {
        // Only events everyone on the campus may see: campus-wide, an office's, or a public club's (not student-only).
        const { rows } = await tx.query(
          `select 1 from events e left join groups eg on eg.id = e.group_id
            where e.id = $3 and ${visibleEvent('e', V)}
              and (e.group_id is null or (eg.kind = 'club' and eg.visibility = 'public' and not eg.student_only))`,
          [viewer.userId, viewer.campusId, body.eventId]);
        if (rows.length === 0) return { ok: false, status: 404, error: 'not_found', message: 'That event can’t be shared: only events open to the whole campus can.' };
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
        `insert into posts (campus_id, author_user_id, author_office_id, group_id, body, image_id, announcement, event_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
        [viewer.campusId, viewer.userId, body.officeId ?? null, body.groupId ?? null, body.body, imageId, body.announcement, body.eventId ?? null],
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
    // Earlier versions go too, unless moderators still need them for an open report.
    if (!post.open_reports) await db.query('delete from post_edits where post_id = $1', [params.data.id]);
    // The photo goes too, unless moderators still need it as evidence for an open report.
    if (post.image_id && !post.open_reports) {
      await db.query('update posts set image_id = null where id = $1', [params.data.id]);
      await deleteImage(db, config.MEDIA_DIR, post.image_id);
    }
    return reply.code(204).send();
  });

  // ---- PATCH /api/posts/:id   { body }   the author changes the text; the post shows "Edited".
  // Only the text (not the photo, group or office). Not for hidden or deleted posts. The earlier
  // text is kept in post_edits for moderators, so editing can't hide what someone reported.
  app.patch('/api/posts/:id', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const body = parse(z.object({ body: z.string().transform((s) => s.trim()).pipe(z.string().max(2000)) }).strict(), req.body, reply);
    if (!body) return;
    const viewer = req.auth!;
    const post = params.success ? await loadPost(db, viewer, params.data.id) : null;
    if (!post) return fail(reply, 404, 'not_found', 'Post not found.');
    if (post.author_id !== viewer.userId) return fail(reply, 403, 'forbidden', 'You can only edit your own posts.');
    if (body.body.length === 0 && !post.event_id) return fail(reply, 400, 'invalid_input', 'body: cannot be empty');
    if (body.body === post.body) return postBody(post);

    const wait = await inTransaction(db, async (tx) => {
      const w = await takeRateLimits(tx, [{ bucket: 'post_edit_user', key: viewer.userId, max: EDITS_PER_HOUR, windowSeconds: 3600 }]);
      if (w) return w;
      await tx.query('insert into post_edits (post_id, body) values ($1, $2)', [post.id, post.body]);
      await tx.query('update posts set body = $2, edited_at = clock_timestamp() where id = $1', [post.id, body.body]);
      return null;
    });
    if (wait) return rateLimited(reply, wait, 'edited');
    return postBody((await loadPost(db, viewer, post.id))!);
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
      const { rows: owner } = await tx.query<{ author_user_id: string }>('select author_user_id from posts where id = $1', [params.data.id]);
      await notify(tx, config.APP_NAME, { type: 'comment', userIds: owner.map((o) => o.author_user_id), actorId: viewer.userId, targetId: params.data.id });
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

  // ---- GET /api/users/:id/posts   a member's own posts (not as an office), newest first:
  //      the campus feed ones and those in groups the viewer can see. 404 like GET /api/users/:id.
  app.get('/api/users/:id/posts', async (req, reply) => {
    const params = idParam.safeParse(req.params);
    const q = parse(pageSchema, req.query, reply);
    if (!q) return;
    const notFound = () => fail(reply, 404, 'not_found', 'Member not found.');
    if (!params.success) return notFound();
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const member = await db.query(
      `select 1 from users u where u.id = $3 and u.campus_id = $2 and u.deleted_at is null and ${notBlocked('u.id', V)}`,
      [req.auth!.userId, req.auth!.campusId, params.data.id]);
    if (member.rows.length === 0) return notFound();
    const { rows } = await db.query<PostRow>(
      `${POST_SELECT}
        where p.author_user_id = $3 and p.author_office_id is null and ${visiblePost('p', V)}
          and ($4::timestamptz is null or (p.created_at, p.id) < ($4::timestamptz, $5::uuid))
        order by p.created_at desc, p.id desc
        limit $6`,
      [req.auth!.userId, req.auth!.campusId, params.data.id, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: p.rows.map(postBody), nextCursor: p.nextCursor };
  });

  // ---- GET /api/me/saved   posts I saved, newest save first; ones I can no longer see are left out
  app.get('/api/me/saved', async (req, reply) => {
    const q = parse(pageSchema, req.query, reply);
    if (!q) return;
    let cursor;
    try { cursor = decodeCursor(q.cursor); } catch (e) { if (e instanceof CursorError) return fail(reply, 400, 'invalid_input', 'cursor: not one we gave you.'); throw e; }
    const { rows } = await db.query<PostRow>(
      `${POST_SELECT.replace('p.created_at::text as cursor_at', 'sp.created_at::text as cursor_at')}
        join saved_posts sp on sp.post_id = p.id and sp.user_id = $1
        where ${visiblePost('p', V)}
          and ($3::timestamptz is null or (sp.created_at, p.id) < ($3::timestamptz, $4::uuid))
        order by sp.created_at desc, p.id desc
        limit $5`,
      [req.auth!.userId, req.auth!.campusId, cursor?.at ?? null, cursor?.id ?? null, q.limit + 1],
    );
    const p = page(rows, q.limit);
    return { items: p.rows.map(postBody), nextCursor: p.nextCursor };
  });

  // ---- PUT / DELETE /api/posts/:id/save   idempotent; private to the member
  for (const saved of [true, false]) {
    app.route({
      method: saved ? 'PUT' : 'DELETE',
      url: '/api/posts/:id/save',
      handler: async (req, reply) => {
        const params = idParam.safeParse(req.params);
        if (!params.success) return fail(reply, 404, 'not_found', 'Post not found.');
        // Unsaving always works (even a post that is now hidden); saving needs a post you can see.
        if (saved && !(await loadPost(db, req.auth!, params.data.id))) return fail(reply, 404, 'not_found', 'Post not found.');
        await db.query(
          saved
            ? 'insert into saved_posts (user_id, post_id) values ($1, $2) on conflict do nothing'
            : 'delete from saved_posts where user_id = $1 and post_id = $2',
          [req.auth!.userId, params.data.id],
        );
        return { saved };
      },
    });
  }

  /** Total reactions and the count of each, after a change. */
  async function reactionSummary(postId: string) {
    const { rows } = await db.query<{ reaction: Reaction; n: number }>(
      'select reaction, count(*)::int as n from likes where post_id = $1 group by reaction', [postId]);
    return { likeCount: rows.reduce((sum, r) => sum + r.n, 0), reactions: Object.fromEntries(rows.map((r) => [r.reaction, r.n])) };
  }

  // ---- PUT / DELETE /api/posts/:id/reaction   { reaction } — one per member per post; PUT replaces it
  // ---- PUT / DELETE /api/posts/:id/like        v0.1: the same with reaction 'like'
  for (const path of ['reaction', 'like'] as const) {
    for (const on of [true, false]) {
      app.route({
        method: on ? 'PUT' : 'DELETE',
        url: `/api/posts/:id/${path}`,
        handler: async (req, reply) => {
          let reaction: Reaction = 'like';
          if (path === 'reaction' && on) {
            const body = parse(z.object({ reaction: z.enum(REACTIONS) }).strict(), req.body, reply);
            if (!body) return;
            reaction = body.reaction;
          }
          const params = idParam.safeParse(req.params);
          if (!params.success || !(await loadPost(db, req.auth!, params.data.id))) return fail(reply, 404, 'not_found', 'Post not found.');
          const userId = req.auth!.userId;
          if (!on) {
            await db.query('delete from likes where user_id = $1 and post_id = $2', [userId, params.data.id]);
          } else if (path === 'like') {
            // A v0.1 like never overwrites a reaction already given.
            await db.query('insert into likes (user_id, post_id) values ($1, $2) on conflict do nothing', [userId, params.data.id]);
          } else {
            await db.query(
              `insert into likes (user_id, post_id, reaction) values ($1, $2, $3)
               on conflict (user_id, post_id) do update set reaction = excluded.reaction, created_at = now()`,
              [userId, params.data.id, reaction]);
          }
          const summary = await reactionSummary(params.data.id);
          if (path === 'like') return { liked: on, likeCount: summary.likeCount };
          return { myReaction: on ? reaction : null, ...summary };
        },
      });
    }
  }
}

/** Housekeeping: post and comment rate-limit counts after a day. */
export async function cleanupPosts(db: Queryable): Promise<void> {
  await db.query(`delete from rate_limit_events where bucket in ('post_user', 'comment_user') and created_at < now() - interval '1 day'`);
}
